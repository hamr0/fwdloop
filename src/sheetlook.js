// M10 piece 5 (item 3 + item 7, for a sheet): the sheet-word look for ONE CSV input. One AI call names the job's own word for each rule (the column it means);
// CODE keeps a word only when it is a real column of the sheet, and when it is not, finds the column to offer (src/sheetfind.js) and builds the ask. The model
// names a word and a kind and nothing else: it never names a column to offer, never decides an ask, and never writes a question (the words are code's).
// The page look's call shape is reused (src/pagelook.js `lookAtPage`): the same system words, one retry on an unreadable answer, the same stop words.
//
// Throws away: nothing silently. A word that is no column and gets no offer comes back in `dropped` with its reason code (src/pagedropwords.js, the one table)
// and as a Not-checked line. Third outcomes: an unreadable answer twice (stop), a cut-off answer (unreadable), a failed call (stop, its reason).
// A rule the model gave no word for is left alone: a cells guardrail is checked by the cells close as it always was (this look adds checks, it removes none).
import { parseCsv } from './csv.js';
import { MAP_UNREADABLE } from './pagemap.js';
import { tieOf } from './pagerules.js';
import { lineRules, countPhrase } from './pagebits.js';
import { findColumn, columnQuestion } from './sheetfind.js';

/** how many data rows the prompt shows (the header is always shown): enough to see what a column holds, never the whole sheet */
export const SHEET_PROMPT_ROWS = 5;
/** the line every sheet prompt carries, so a test provider can tell a sheet call from a page call (the system words are the same) */
export const SHEET_MARK = 'THE SHEET:';

/**
 * The `~` rule an `agree` writes, and a person's own words replace it: PROPOSED words, not signed (reported to hamr with this piece).
 * @param {string} word @param {string} column @returns {string}
 */
export const columnRuleWords = (word, column) => `use the column '${column}' for '${word}'`;

/**
 * What the AI is told for ONE sheet: the job, and the sheet's header and first rows. It names the job's word for each rule; it does not pick a column to offer.
 * @param {{jobLines: {n: number, text: string, rule?: string, rules?: string[]}[], label: string, text: string}} o @returns {string}
 */
export function sheetPrompt({ jobLines, label, text }) {
  const job = jobLines.map((l) => `LINE ${l.n}: ${l.text}${lineRules(l).map((r, i) => `\n~ rule ${i + 1}: ${r}`).join('')}`).join('\n');
  const { header, rows } = parseCsv(text);
  const shown = rows.slice(0, SHEET_PROMPT_ROWS).map((r) => header.map((h) => r.byName[h] ?? '').join(' | '));
  return `THE JOB (each ~ rule applies to the line above it):\n${job}\n\n`
    + `${SHEET_MARK} the input "${label}" is a spreadsheet. Its columns, then its first rows:\n${header.join(' | ')}\n${shown.join('\n')}\n\n`
    + 'For each job line and each ~ rule that is about a value in the sheet, give the JOB\'S OWN WORD for the column it means. If the sheet has a column for it, copy that column\'s name exactly. '
    + 'If it has none, give the word the job uses. Say whether the word means a column of numbers ("number") or anything else ("other"). Leave out a rule that is not about a column.\n\n'
    + 'Return ONLY a JSON object, no prose, no code fence:\n'
    + '{"facts":[{"from":"<line N | line N rule M>","word":"<the column name, or the job\'s own word>","kind":"number|other"}]}';
}

/**
 * Read the AI's answer: ONE JSON object of the answer form, nothing else. No repair: text that is not JSON, or a fact without a `from`, a `word` or a kind of
 * "number" / "other", is a malformed answer.
 * @param {unknown} text @returns {{ok: true, words: {from: string, word: string, kind: 'number'|'other'}[]}|{ok: false}}
 */
export function parseSheetAnswer(text) {
  /** @type {any} */
  let m;
  try { m = JSON.parse(String(text ?? '').trim()); } catch { return { ok: false }; }
  if (m === null || typeof m !== 'object' || Array.isArray(m) || !Array.isArray(m.facts)) return { ok: false };
  /** @type {{from: string, word: string, kind: 'number'|'other'}[]} */
  const words = [];
  for (const f of m.facts) {
    if (f === null || typeof f !== 'object' || Array.isArray(f)) return { ok: false };
    if (typeof f.from !== 'string' || typeof f.word !== 'string' || f.word.trim() === '' || f.word.length > 100) return { ok: false };
    if (f.kind !== 'number' && f.kind !== 'other') return { ok: false };
    words.push({ from: f.from, word: f.word.trim(), kind: f.kind });
  }
  return { ok: true, words };
}

/**
 * Keep the words that are real columns; for the rest, find the column to offer (or say why none is). Decided by code from the word, the rule and the sheet.
 * @param {string} text the sheet's text @param {{from: string, word: string, kind: 'number'|'other'}[]} words
 * @param {{n: number, text?: string, rule?: string, rules?: string[]}[]} jobLines @param {string} label the input's role
 * @returns {{facts: {line: number, forRule?: number, name: string, shape: 'column', column: string, words: string[], source: string}[], asks: {line: number, rule: number|null, source: 'look', ask: 'reading', ruleText: string, question: string, reading: string, word: string, column: string}[], dropped: import('./pagerules.js').Dropped[]}}
 */
export function applySheetWords(text, words, jobLines, label) {
  /** @type {any[]} */
  const facts = [];
  /** @type {any[]} */
  const asks = [];
  /** @type {import('./pagerules.js').Dropped[]} */
  const dropped = [];
  const seen = new Set();
  for (const w of words) {
    const at = tieOf(w.from, jobLines);
    const key = `${at.line}\u0000${at.rule ?? ''}\u0000${w.word.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const jl = jobLines.find((l) => l.n === at.line);
    const rules = lineRules(jl);
    const ruleText = at.rule === undefined ? String(jl?.text ?? '') : rules[at.rule - 1];
    const fact = (/** @type {string} */ column) => ({ line: at.line, ...(at.rule === undefined ? {} : { forRule: at.rule }), name: column, shape: /** @type {const} */ ('column'), column, words: [column], source: label });
    const rec = { line: at.line, ...(at.rule === undefined ? {} : { rule: at.rule }), fact: w.word, source: label };
    const found = findColumn(text, w.word);
    if (found.kind === 'header') { facts.push(fact(found.column)); continue; }
    if (w.kind !== 'number') { dropped.push({ ...rec, reason: 'no-column' }); continue; }
    if (found.kind === 'tie') { dropped.push({ ...rec, reason: 'column-tie', other: found.columns.map((c) => `"${c}"`).join(', ') }); continue; }
    if (found.kind === 'none') { dropped.push({ ...rec, reason: 'no-fit', other: String(found.rows) }); continue; }
    // the person already named this column in ANOTHER rule of the line (an answer they gave, or their own words): the word is that column, asked no more
    if (rules.some((r, i) => i + 1 !== at.rule && countPhrase(r, found.column) > 0)) { facts.push(fact(found.column)); continue; }
    asks.push({
      line: at.line, rule: at.rule ?? null, source: 'look', ask: 'reading', ruleText, question: columnQuestion(w.word, found), reading: columnRuleWords(w.word, found.column), word: w.word, column: found.column,
    });
  }
  return { facts, asks, dropped };
}

/**
 * Look at ONE sheet input: the call (once; once more if the answer is unreadable), then the rules.
 * `callModel(content, attempt)` makes and meters ONE model round and returns `{text}`, `{text, cutOff: true}` or `{error}` (the same seam as `lookAtPage`).
 * @param {{label: string, text: string, jobLines: {n: number, text: string, rule?: string, rules?: string[]}[], callModel: (content: string, attempt: number) => Promise<{text?: string, cutOff?: boolean, error?: string}>}} o
 * @returns {Promise<({ok: true, attempts: number} & ReturnType<typeof applySheetWords>)|{ok: false, reason: string, attempts: number}>}
 */
export async function lookAtSheet({ label, text, jobLines, callModel }) {
  const content = sheetPrompt({ jobLines, label, text });
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const r = await callModel(content, attempts);
    if (r.error !== undefined) return { ok: false, reason: `the call about the sheet failed: ${r.error}`, attempts };
    const parsed = r.cutOff === true ? { ok: false } : parseSheetAnswer(r.text);
    if (parsed.ok) return { ok: true, attempts, ...applySheetWords(text, /** @type {any} */ (parsed).words, jobLines, label) };
    if (attempts >= 2) return { ok: false, reason: MAP_UNREADABLE.replace('about the page', 'about the sheet'), attempts };
  }
}
