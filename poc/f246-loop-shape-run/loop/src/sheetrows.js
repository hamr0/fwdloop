// borrowed-from: bareloop src/sheetrows.js@v0.61.0 (fc56e1f3)
// borrowed-from: fwdloop src/sheetblock.js@v0.35.0 (`SHEET_OP_NAMES`, `sheetCheckName`, `sheetPlainText`, `coversWords`, `sheetByCheck`'s rule: who a check comes from) and src/sheetrows.js@v0.35.0 (`sheetRowKey`, `keyOfSameCheck`'s
// "same check" = the typed fields without the names code gives), docs/product/ITEM33-BUILD.md "Addendum 2026-11-17", S4. The WORDS of the sheet rows of the one list, and the pure readers of a signed close's sheet part.
// The ROWS themselves live in the one owner, src/checkblock.js (`setSheet`, `rowChoice`): this file only names them and reads them back, so the confirm card, the signed card, the Job tab and the Result tab say the same thing.
// What this throws away: a check's fields (id, claim, range ...): a row keeps its line, tag, part and key, and the card says the check in `sheetCheckSentence`'s words (src/sheetchecks.js).
// Not copied from fwd (S4): `sheetChoice` / `droppedSheetOf` / `withSheetRows` (they edited fwd's declaration; bareloop's Drop and Add are `CheckBlock.rowChoice`), `askSheetCard` / `claimLines` (the Ask is skipped, S5).
import { rubricVocabulary } from 'bareguard';
import { sheetCheckSentence } from './sheetchecks.js';
import { isSheetInput } from './inputlook.js';
import { lineRules } from './rubricstep.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the short plain name of each bareguard op (the ONE table; a test fails when bareguard gains an op this table does not name). `noDuplicates` and `noEmpty` add the column. */
export const SHEET_OP_NAMES = Object.freeze({
  count: 'count', countEmpty: 'empty count', countIf: 'count', uniqueCount: 'unique count',
  sum: 'sum', sumIf: 'sum', average: 'average', averageIf: 'average', median: 'median', min: 'min', max: 'max',
  found: 'found', lookup: 'lookup', rows: 'rows', topN: 'top', duplicates: 'duplicates', groupTotals: 'group totals', percentOfTotal: 'percent of total',
  band: 'bucket', daysBetween: 'days between', daysSince: 'date', earliest: 'earliest date', latest: 'latest date',
  allNumbers: 'all numbers', allDates: 'all dates', noEmpty: 'no empty', noDuplicates: 'no duplicate', rowCount: 'row count', rowMath: 'row math',
});

/** the ops of bareguard's cells and table rules, once each @returns {string[]} */
export function vocabularyOps() {
  const V = /** @type {any} */ (rubricVocabulary);
  return [...new Set(['cells', 'table'].flatMap((r) => Object.keys(V.rules[r].ops)))];
}

/** @param {any} check a bareguard cells / table check @returns {string} the short name: `rows`, `count`, `sum`, `no duplicate Invoice #` ... */
export function sheetCheckName(check) {
  if (!isRec(check)) return 'a check';
  const base = Object.hasOwn(SHEET_OP_NAMES, check.op) ? /** @type {Record<string, string>} */ (SHEET_OP_NAMES)[check.op] : String(check.op);
  return (check.op === 'noDuplicates' || check.op === 'noEmpty') && typeof check.column === 'string' ? `${base} ${check.column}` : base;
}

/** the "covers ..." words of one check @param {string[]} rules @returns {string} "" when it covers none */
export const coversWords = (rules) => rules.map((r) => `covers "${r}"`).join(' · ');

/**
 * What the step claimed for one check, in plain words (a green check's "found"): a number or yes/no as it is, else a count of rows / values / groups. Null when the claim has nothing to say (a `table` check, a missing box). A string claim is
 * never repeated, because it is cell text. Copied from fwdloop src/sheetblock.js@v0.35.0 `sheetFoundWords`, words as they are.
 * @param {any} check @param {unknown} claims the step's answer @returns {string|null}
 */
export function sheetFoundWords(check, claims) {
  if (!isRec(check) || typeof check.claim !== 'string' || !isRec(claims) || !isRec(/** @type {any} */ (claims)[check.claim])) return null;
  const box = /** @type {Record<string, any>} */ (/** @type {any} */ (claims)[check.claim]);
  const plural = (/** @type {number} */ n, /** @type {string} */ one, /** @type {string} */ many) => `${n} ${n === 1 ? one : many}`;
  if (typeof box.value === 'number' || typeof box.value === 'boolean') return typeof box.value === 'boolean' ? (box.value ? 'yes' : 'no') : String(box.value);
  if (Array.isArray(box.rows)) return plural(box.rows.length, 'row', 'rows');
  if (Array.isArray(box.keys)) return plural(box.keys.length, 'row', 'rows');
  if (Array.isArray(box.values)) return plural(box.values.length, 'value', 'values');
  if (Array.isArray(box.totals)) return plural(box.totals.length, 'group', 'groups');
  if (isRec(box.days)) return plural(Object.keys(box.days).length, 'row', 'rows');
  if (isRec(box.bands)) return plural(Object.keys(box.bands).length, 'row', 'rows');
  return null;
}

/** the Result tab's line for a check that passed: `rows checked — 17 rows` (fwdloop's composition, `sheetblock.js` `e.found`) @param {any} check @param {unknown} claims @returns {string} */
export function sheetFoundLine(check, claims) {
  const name = sheetCheckName(check);
  const f = sheetFoundWords(check, claims);
  return f === null ? `${name} checked` : `${name} checked \u2014 ${f}`;
}

/** the words of one sheet check, its tag aside: the ONE composition (the card, the Job tab and the Suggested list all use it) @param {string} name @param {string} words @param {string} cw @returns {string} */
export const sheetPlainText = (name, words, cw) => [name, ...(words === name ? [] : [words]), ...(cw ? [cw] : [])].join(' — ');

/** the words of the `[default]` row of a sheet line: what code itself guarantees about the sheet (the stage stops when the frozen copy is not the one recorded at the run's start) */
export const SHEET_DEFAULT_WORDS = "the sheet is this run's own saved copy of the input, and the checks stop if it has changed";

/** the key of an `[agent]` sheet row and of a line's `[default]` sheet row @param {number} line @param {string} id */
export const sheetRowKey = (line, id) => `L${line}.sheet.${id}`;
/** @param {number} line */
export const sheetDefaultKey = (line) => `L${line}.$sheet`;

/** the fields that say what a check IS: all but the names code gives it (id, claim), the rules it covers and its row tag. Two drafts name checks differently, so "the very same check" is read on these @param {any} c @returns {Record<string, any>} */
export function sheetCheckBody(c) { const { id: _i, claim: _c, covers: _v, row: _r, ...rest } = c; return rest; }

/**
 * The job lines that read a sheet: a line with a `~` rule, when the job has a CSV input whose text is known. ONE owner for the check block's early rule (a rule of such a line is decided by the sheet checks alone) and the
 * row-edit turn's `sheetLines` (src/authorflow.js).
 * @param {{inputs: any[]|null|undefined, texts: Record<string, string>|null|undefined, jobLines: any[]|null|undefined}} o @returns {number[]}
 */
export function sheetLineNumbers({ inputs, texts, jobLines }) {
  const has = (Array.isArray(inputs) ? inputs : []).some((i) => isSheetInput(i) && typeof texts?.[i.label] === 'string');
  return has ? (Array.isArray(jobLines) ? jobLines : []).filter((l) => lineRules(l).length > 0).map((l) => l.n) : [];
}

/**
 * The sheet rows of a signed close, read from its sheet parts: one per check (a `[you]` rule row's check, an `[agent]` row's), then the line's `[default]` row. A close with no sheet part has none.
 * `key` is the row key the list carries; `rule` the rule a `[you]` row is. Text is code's (never a model's).
 * @param {any} closeDecl @param {any[]|null} [jobLines] the person's numbered lines, so a rule reads in their own words
 * @returns {{line: number, key: string, by: 'you'|'agent'|'default', text: string, id?: string, rule?: number}[]}
 */
export function sheetRowsOf(closeDecl, jobLines = null) {
  const stages = isRec(closeDecl) && Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  /** @type {{line: number, key: string, by: 'you'|'agent'|'default', text: string, id?: string, rule?: number}[]} */
  const out = [];
  for (const st of stages) {
    if (!isRec(st) || st.kind !== 'rubric-step' || !isRec(st.params) || !Array.isArray(st.params.parts)) continue;
    const part = st.params.parts.find((/** @type {any} */ p) => isRec(p) && p.class === 'sheet' && Array.isArray(p.checks));
    if (!part) continue;
    const n = st.params.step;
    const rules = lineRules((jobLines ?? []).find((/** @type {any} */ l) => isRec(l) && l.n === n));
    for (const c of part.checks.filter(isRec)) {
      const nums = Array.isArray(c.covers) ? c.covers.filter((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1) : [];
      const said = [...new Set(/** @type {number[]} */ (nums))].sort((a, b) => a - b).map((x) => rules[x - 1] ?? `rule ${x}`);
      const text = sheetPlainText(sheetCheckName(c), sheetCheckSentence(c), coversWords(said));
      const mine = c.row !== 'agent' && c.rule !== 'table' && nums.length > 0;
      out.push(mine
        ? { line: n, key: `L${n}.~${Math.min(...nums)}`, by: 'you', text, id: String(c.id), rule: Math.min(...nums) }
        : { line: n, key: sheetRowKey(n, String(c.id)), by: 'agent', text, id: String(c.id) });
    }
    out.push({ line: n, key: sheetDefaultKey(n), by: 'default', text: SHEET_DEFAULT_WORDS });
  }
  return out;
}
