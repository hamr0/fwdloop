// M10 am17 + am18: the ONE record of check picks, carried from plan to plan. A pick is tied to its job line's WORDS (plus its order among lines with the same words)
// and to its guardrail's exact words, never to a line or rule number: both are recomputed on the new card. This file is the only writer of a record's entries
// (`entriesFromAnswers`) and the only reader that decides keep-or-ask (`matchRecord`); the logic is the one F146 / F146b proved (poc/m10-am17/keep-picks-am18.mjs).
// Throws away: line and rule numbers (recomputed), the model's words (it never sees a pick), a pick whose line or guardrail words no longer match.
import { readFileSync } from 'node:fs';
import path from 'node:path';

/** the record's file, inside a drafting folder only (never a run folder) */
export const RECORD_FILE = 'picks-record.json';
/** the exact words a kept pick is marked with in the draft log, the Audit and the plan card (M10 am17 (6)) */
export const KEPT_WORDS = 'kept from last draft';

/** @typedef {{lineWords: string, occurrence: number, ruleText: string, added: string|null, check: Record<string, any>|null, own: boolean, left: boolean}} Entry */
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
 * The entries for answers just given, numbered on THIS card (the answer redraft's card: its line and rule numbers are the ones the asks carried).
 * @param {{n: number, text: string}[]} lines @param {Rule[]} rules
 * @param {{line: number, rule: number, check?: Record<string, any>|null, added?: string|null, own?: boolean}[]} picks @param {{line: number, rule: number}[]} left
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
    if (b) out.push({ ...b, added: typeof p.added === 'string' ? p.added : null, check: p.check ?? null, own: p.own === true, left: false });
  }
  for (const l of left) {
    const b = base(l.line, l.rule);
    if (b) out.push({ ...b, added: null, check: null, own: false, left: true });
  }
  return out;
}

/**
 * Decide, for the card in hand, which stored picks are kept and which guardrails must be asked.
 * A pick is KEPT when the job line with its words (same order among equal lines) still has its source guardrail with the exact words and, if the pick wrote a `~` line,
 * that line with its exact words too. Otherwise the pick is dropped (never partly kept) and its guardrails are asked: a pair broken on one side is ONE ask, so the
 * partner left on the card is folded (neither asked nor given the old check). Pure.
 * @param {Entry[]} entries @param {{n: number, text: string}[]} lines @param {Rule[]} rules every guardrail the call settles
 * @returns {{picks: {line: number, rule: number, check: Record<string, any>|null, added?: string, own?: boolean}[], left: {line: number, rule: number}[],
 *   kept: {line: number, rule: number, entry: Entry}[], askRules: Rule[]}}
 */
export function matchRecord(entries, lines, rules) {
  const byKey = new Map([...lineKeys(lines)].map(([n, k]) => [`${k.lineWords}#${k.occurrence}`, n]));
  /** @type {Set<string>} */
  const claimed = new Set();
  /** @type {Set<string>} */
  const folded = new Set();
  const free = (/** @type {number} */ n, /** @type {string} */ text) => rules.find((r) => r.line === n && !claimed.has(id(r)) && !folded.has(id(r)) && norm(r.text) === norm(text));
  const kept = [];
  /** @type {{e: Entry, n: number|undefined}[]} */
  const broken = [];
  for (const e of Array.isArray(entries) ? entries : []) {
    const n = byKey.get(`${e.lineWords}#${e.occurrence}`);
    const src = n === undefined ? undefined : free(n, e.ruleText);
    if (src) claimed.add(id(src)); // held while the partner is looked for, so a pair never takes one rule twice
    const add = n === undefined || !src || e.added === null ? undefined : free(n, e.added);
    if (n !== undefined && src && (e.added === null || add)) {
      if (add) claimed.add(id(add));
      kept.push({ line: n, rule: src.rule, entry: e });
    } else {
      if (src) claimed.delete(id(src));
      broken.push({ e, n });
    }
  }
  // a pair broken on one side is ONE pick, so ONE ask: the partner that is left folds into it (it keeps no old check and is not asked on its own)
  for (const { e, n } of broken) {
    if (e.added === null) continue;
    if (n === undefined) {
      // the line's own words changed: it is a new line, all its guardrails are asked; its old `~` line with its source still there rides the source's ask
      for (const l of lines) {
        const s = free(l.n, e.ruleText);
        const a = s ? rules.find((r) => r.line === l.n && r !== s && !claimed.has(id(r)) && !folded.has(id(r)) && norm(r.text) === norm(e.added ?? '')) : undefined;
        if (a) { folded.add(id(a)); break; }
      }
      continue;
    }
    const src = free(n, e.ruleText);
    const add = free(n, e.added);
    if (src && !add) {
      // the added line was edited (or deleted): the unclaimed rule right after the source on that line is it
      const p = rules.find((r) => r.line === n && r.rule > src.rule && !claimed.has(id(r)) && !folded.has(id(r)));
      if (p) folded.add(id(p));
    } else if (add && !src) {
      // the source was edited: the unclaimed rule right before the added line is it; the old added line rides that ask
      const p = [...rules].reverse().find((r) => r.line === n && r.rule < add.rule && !claimed.has(id(r)) && !folded.has(id(r)));
      if (p) folded.add(id(add));
    }
  }
  const picks = [];
  const left = [];
  for (const k of kept) {
    const e = k.entry;
    if (e.left) left.push({ line: k.line, rule: k.rule });
    else picks.push({ line: k.line, rule: k.rule, check: e.check, ...(e.added === null ? {} : { added: e.added }), ...(e.own ? { own: true } : {}) });
  }
  return { picks, left, kept, askRules: rules.filter((r) => !claimed.has(id(r)) && !folded.has(id(r))) };
}

/**
 * Read a carried record (the folder's file). A missing or unreadable file is no record (a plan from before am17 has none).
 * @param {string} file @returns {Entry[]|null}
 */
export function readRecordFile(file) {
  try {
    const j = JSON.parse(readFileSync(file, 'utf8'));
    return Array.isArray(j?.picks) ? j.picks.filter((/** @type {any} */ e) => e && typeof e.lineWords === 'string' && Number.isInteger(e.occurrence) && typeof e.ruleText === 'string') : null;
  } catch { return null; }
}

/** where a plan folder keeps its record @param {string} planDir */
export const recordPath = (planDir) => path.join(planDir, RECORD_FILE);
