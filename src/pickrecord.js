// borrowed-from: bareloop src/pickrecord.js@v0.57.0 (c18df406)
// M10 am17 + am18: the ONE record of check picks, carried from plan to plan. A pick is tied to its job line's WORDS (plus its order among lines with the same words)
// and to its guardrail's exact words, never to a line or rule number: both are recomputed on the new card. This file is the only writer of a record's entries
// (`entriesFromAnswers`) and the only reader that decides keep-or-ask (`matchRecord`); the logic is the one F146 / F146b proved (poc/m10-am17/keep-picks-am18.mjs).
// Throws away: line and rule numbers (recomputed), the model's words (it never sees a pick), a pick whose line or guardrail words no longer match.
import path from 'node:path';
import { readFileInside } from './flow.js';

/** the record's file, inside a drafting folder only (never a run folder) */
export const RECORD_FILE = 'picks-record.json';
/** the exact words a kept pick is marked with in the draft log, the Audit and the plan card (M10 am17 (6)) */
export const KEPT_WORDS = 'kept from last draft';

/** @typedef {{lineWords: string, occurrence: number, ruleText: string, added?: string|null, check: Record<string, any>|null, own: boolean, left: boolean}} Entry */
/** @typedef {{line: number, rule: number, text: string}} Rule */

const norm = (/** @type {unknown} */ t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();
/** @param {unknown} a @param {unknown} b the two texts are the same words (case and spacing aside) */
export const sameWords = (a, b) => norm(a) === norm(b);
const id = (/** @type {Rule} */ r) => `${r.line}:${r.rule}`;

/**
 * The key of every job line: its own words, plus how many lines before it have the same words (equal lines match in their order).
 * @param {{n: number, text: string}[]} lines @returns {Map<number, {lineWords: string, occurrence: number}>}
 */
export function lineKeys(lines) {
  /** @type {Map<string, number>} */
  const seen = new Map();
  return new Map(lines.map((l) => {
    const w = norm(l.text);
    const occurrence = seen.get(w) ?? 0;
    seen.set(w, occurrence + 1);
    return [l.n, { lineWords: w, occurrence }];
  }));
}

/**
 * The entries for answers just given, numbered on THIS card (the answer redraft's card: its line and rule numbers are the ones the asks carried; the rule's text is the FINAL rule's words).
 * @param {{n: number, text: string}[]} lines @param {Rule[]} rules
 * @param {{line: number, rule: number, check?: Record<string, any>|null, own?: boolean}[]} picks @param {{line: number, rule: number}[]} left
 * @returns {Entry[]}
 */
export function entriesFromAnswers(lines, rules, picks, left) {
  const keys = lineKeys(lines);
  /** @param {number} line @param {number} rule */
  const base = (line, rule) => {
    const r = rules.find((x) => x.line === line && x.rule === rule);
    const k = keys.get(line);
    return r === undefined || k === undefined ? null : { ...k, ruleText: r.text };
  };
  /** @type {Entry[]} */
  const out = [];
  for (const p of picks) {
    const b = base(p.line, p.rule);
    if (b) out.push({ ...b, check: p.check ?? null, own: p.own === true, left: false });
  }
  for (const l of left) {
    const b = base(l.line, l.rule);
    if (b) out.push({ ...b, check: null, own: false, left: true });
  }
  return out;
}

/**
 * Decide, for the card in hand, which stored picks are kept and which guardrails must be asked.
 * A pick is KEPT when the job line with its words (same order among equal lines) still has a guardrail with the pick's exact words. One rule in, one rule out (hamr 2026-11-14): an answer REPLACED the
 * rule it was asked about, so the stored words are the final rule's words and there is no second line to pair; a rule whose words changed is simply new and asked. Pure.
 * @param {Entry[]} entries @param {{n: number, text: string}[]} lines @param {Rule[]} rules every guardrail the call settles
 * @returns {{picks: {line: number, rule: number, check: Record<string, any>|null, own?: boolean}[], left: {line: number, rule: number}[],
 *   kept: {line: number, rule: number, entry: Entry}[], askRules: Rule[]}}
 */
export function matchRecord(entries, lines, rules) {
  const byKey = new Map([...lineKeys(lines)].map(([n, k]) => [`${k.lineWords}#${k.occurrence}`, n]));
  /** @type {Set<string>} */
  const claimed = new Set();
  const kept = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const n = byKey.get(`${e.lineWords}#${e.occurrence}`);
    const src = n === undefined ? undefined : rules.find((r) => r.line === n && !claimed.has(id(r)) && norm(r.text) === norm(e.ruleText));
    if (!src) continue;
    claimed.add(id(src));
    kept.push({ line: /** @type {number} */ (n), rule: src.rule, entry: e });
  }
  const picks = [];
  const left = [];
  for (const k of kept) {
    const e = k.entry;
    if (e.left) left.push({ line: k.line, rule: k.rule });
    else picks.push({ line: k.line, rule: k.rule, check: e.check, ...(e.own ? { own: true } : {}) });
  }
  return { picks, left, kept, askRules: rules.filter((r) => !claimed.has(id(r))) };
}

/**
 * Read a carried record (the folder's file). A missing or unreadable file is no record (a plan from before am17 has none).
 * @param {string} file @returns {Entry[]|null}
 */
export function readRecordFile(file) {
  try {
    const g = readFileInside(path.dirname(file), path.basename(file));
    if (!g.ok) return null;
    const j = JSON.parse(g.text);
    return Array.isArray(j?.picks) ? j.picks.filter((/** @type {any} */ e) => e && typeof e.lineWords === 'string' && Number.isInteger(e.occurrence) && typeof e.ruleText === 'string') : null;
  } catch { return null; }
}

// borrowed-from: bareloop src/pickrecord.js@v0.56.0 (3383cce) (readRowChoices; read through readFileInside; writeRecordPart not taken, see the M16 p1 report)
/**
 * The Drop/Add choices a draft's person made on the confirm card (hamr 2026-11-13, N-2), carried the same way as the picks: tied to the line's words and the row's own name, never to a number.
 * @param {string} file @returns {{lineWords: string, occurrence: number, tail: string, choice: string}[]|null}
 */
export function readRowChoices(file) {
  try {
    const g = readFileInside(path.dirname(file), path.basename(file));
    if (!g.ok) return null;
    const j = JSON.parse(g.text);
    return Array.isArray(j?.rowChoices) ? j.rowChoices.filter((/** @type {any} */ e) => e && typeof e.lineWords === 'string' && Number.isInteger(e.occurrence) && typeof e.tail === 'string' && (e.choice === 'drop' || e.choice === 'add')) : null;
  } catch { return null; }
}

/**
 * The sheet checks the person dropped from a plan (hamr 2026-11-14: a Revise keeps a sheet Drop), carried like the page-row choices: the record's `sheetDropped` entries, each `{key, line, index, check, text}`;
 * the next draft drops a new check with the same id again. Read through readFileInside; a missing or unreadable record is no record.
 * @param {string} file @returns {{key: string, line: number, index: number, check: Record<string, any>, text: string}[]|null}
 */
export function readSheetDropped(file) {
  try {
    const g = readFileInside(path.dirname(file), path.basename(file));
    if (!g.ok) return null;
    const j = JSON.parse(g.text);
    return Array.isArray(j?.sheetDropped) ? j.sheetDropped.filter((/** @type {any} */ d) => d && typeof d.key === 'string' && Number.isInteger(d.line) && d.check && typeof d.check === 'object' && !Array.isArray(d.check)) : null;
  } catch { return null; }
}

/**
 * M17 ruling 2: the columns a person agreed for a word of the job's prose (or a word that is not in the rule it was asked about), kept in the same record as the picks and carried like them:
 * tied to the job line's WORDS (and its order among equal lines), never to a number. `columns` entries are `{lineWords, occurrence, word, column}`.
 * @param {string} file @returns {{lineWords: string, occurrence: number, word: string, column: string}[]|null}
 */
export function readColumns(file) {
  try {
    const g = readFileInside(path.dirname(file), path.basename(file));
    if (!g.ok) return null;
    const j = JSON.parse(g.text);
    return Array.isArray(j?.columns) ? j.columns.filter((/** @type {any} */ e) => e && typeof e.lineWords === 'string' && Number.isInteger(e.occurrence) && typeof e.word === 'string' && typeof e.column === 'string') : null;
  } catch { return null; }
}

/** @param {{n: number, text: string}[]} lines @param {{line: number, word: string, column: string}[]} cols @returns {{lineWords: string, occurrence: number, word: string, column: string}[]} the answers as the record keeps them */
export function columnEntries(lines, cols) {
  const keys = lineKeys(lines);
  return cols.flatMap((c) => { const k = keys.get(c.line); return k === undefined ? [] : [{ ...k, word: c.word, column: c.column }]; });
}

/** @param {{lineWords: string, occurrence: number, word: string, column: string}[]} entries @param {{n: number, text: string}[]} lines @returns {{line: number, word: string, column: string}[]} the record's answers whose job line is still on the card (same words, same order) */
export function columnsOnLines(entries, lines) {
  const byKey = new Map([...lineKeys(lines)].map(([n, k]) => [`${k.lineWords}#${k.occurrence}`, n]));
  return entries.flatMap((e) => { const n = byKey.get(`${e.lineWords}#${e.occurrence}`); return n === undefined ? [] : [{ line: n, word: e.word, column: e.column }]; });
}

/** where a plan folder keeps its record @param {string} planDir */
export const recordPath = (planDir) => path.join(planDir, RECORD_FILE);
