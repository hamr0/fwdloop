// M10b piece 4 (docs/wiki/the-module-ladder.md "M10b amendment 2", items 4 and 7): the ONE builder of what a job line that reads a sheet shows -
//   { guardrails, checked: [{id, name, words, covers, text}], notChecked: [guardrail, ...] | 'none' }
// from the signed declaration (the step's `close.sheet`, each check's `covers` tag) and the job line's own `~` rules. After a run, `record` (the
// `sheet-checks.json` lines, src/sheet-record.js) adds to each check its verdict and what was found: `{ok, found}`. Every surface (the Chat plan card, the Job tab, the
// Result tab, the Audit's check rows) shows this block's strings; none of them words a check itself.
// Throws away: the check's id, claim, range and the other typed fields that do not change what it says (src/sheetchecks.js `sheetCheckSentence` drops them too).
// A green "found" is the step's OWN claimed value in plain words (a number, or a count of rows / days / bands / groups); a string claim (a looked-up cell) is never
// repeated, because it is cell text. A red "found" is bareguard's gap words (row numbers and counts), never a cell's text.
// Third outcomes, named: a line the run never reached (no record) carries no verdict; a check the record lacks carries none (the page shows no mark).
import { rubricVocabulary } from 'bareguard';
import { lineRules } from './pagebits.js';
import { sheetCheckSentence } from './sheetchecks.js';
import { isColumnChoiceRule } from './sheetoffer.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the short plain name of each bareguard op (the ONE table; a test fails when bareguard gains an op this table does not name). `noDuplicates` and `noEmpty` add the column. */
export const SHEET_OP_NAMES = Object.freeze({
  count: 'count', countEmpty: 'empty count', countIf: 'count', uniqueCount: 'unique count',
  sum: 'sum', sumIf: 'sum', average: 'average', averageIf: 'average', median: 'median', min: 'min', max: 'max',
  found: 'found', lookup: 'lookup', rows: 'rows', topN: 'top', duplicates: 'duplicates', groupTotals: 'group totals', percentOfTotal: 'percent of total',
  band: 'bucket', daysBetween: 'days between', daysSince: 'date', earliest: 'earliest date', latest: 'latest date',
  allNumbers: 'all numbers', allDates: 'all dates', noEmpty: 'no empty', noDuplicates: 'no duplicate', rowCount: 'row count', rowMath: 'row math',
});

/** the ops of bareguard that a name is needed for @returns {string[]} */
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

/**
 * What the step claimed for one check, in plain words (a green check's "found"). Null when the claim has nothing to say (a `table` check, a missing box, a string).
 * @param {any} check @param {unknown} claims the step's answer @returns {string|null}
 */
export function sheetFoundWords(check, claims) {
  if (!isRec(check) || typeof check.claim !== 'string' || !isRec(claims) || !isRec(claims[check.claim])) return null;
  const box = /** @type {Record<string, any>} */ (claims[check.claim]);
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

/** @param {any} l a job line `{rules?, guardrail?, rule?}` @returns {string[]} its `~` rules, numbered from 1 by position */
export const rulesOfLine = (l) => lineRules({ ...(Array.isArray(l?.rules) ? { rules: l.rules } : {}), rule: l?.guardrail ?? l?.rule });

/** the "covers ..." words of one check @param {string[]} rules @returns {string} "" when it covers none */
export const coversWords = (rules) => rules.map((r) => `covers "${r}"`).join(' · ');

/**
 * The block of every job line whose step reads a sheet. A line qualifies when its green step carries `close.sheet`, or (with `csvRoles`) reads a CSV input and carries no
 * older `close.columns` / `close.cited` check (then every guardrail is Not checked).
 * @param {{declaration: any, lines: Array<{n: number, rules?: string[], guardrail?: string, rule?: string}>, csvRoles?: string[], record?: any}} o
 *   `record` = the parsed `sheet-checks.json` (`{lines: [...]}`), only after a run
 * @returns {Array<{line: number, guardrails: string[], checked: Array<{id: string, name: string, words: string, covers: string[], coversWords: string, text: string, ok?: boolean, found?: string}>, notChecked: string[]|'none'}>}
 */
export function sheetLineBlocks({ declaration, lines, csvRoles = [], record }) {
  const out = [];
  if (!isRec(declaration) || !Array.isArray(declaration.steps)) return out;
  const seen = new Set();
  for (const st of declaration.steps) {
    if (!isRec(st) || !isRec(st.close) || st.close.class !== 'green' || !Number.isInteger(st.fromLine) || seen.has(st.fromLine)) continue;
    const hasSheet = Array.isArray(st.close.sheet) && st.close.sheet.length > 0;
    const readsCsv = Array.isArray(st.reads) && st.reads.some((/** @type {string} */ r) => csvRoles.includes(r));
    if (!hasSheet && (!readsCsv || st.close.columns !== undefined || st.close.cited !== undefined)) continue;
    seen.add(st.fromLine);
    const guardrails = rulesOfLine((Array.isArray(lines) ? lines : []).find((l) => l.n === st.fromLine));
    const covered = new Set();
    const tried = Array.isArray(record?.lines) ? record.lines.filter((/** @type {any} */ l) => isRec(l) && l.n === st.fromLine && Number.isInteger(l.try)) : [];
    const newest = tried.reduce((/** @type {any} */ m, /** @type {any} */ l) => (m === null || l.try >= m.try ? l : m), null);
    const checked = (hasSheet ? st.close.sheet : []).map((/** @type {any} */ c) => {
      const nums = Array.isArray(c.covers) ? c.covers.filter((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1 && /** @type {number} */ (x) <= guardrails.length) : [];
      for (const x of nums) covered.add(x);
      const rules = [...new Set(nums)].sort((a, b) => a - b).map((x) => guardrails[x - 1]);
      const name = sheetCheckName(c);
      const words = sheetCheckSentence(c);
      const cw = coversWords(rules);
      /** @type {any} */
      const e = { id: typeof c.id === 'string' ? c.id : '', name, words, covers: rules, coversWords: cw, text: [name, ...(words === name ? [] : [words]), ...(cw ? [cw] : [])].join(' — ') };
      const res = newest && Array.isArray(newest.results) ? newest.results.find((/** @type {any} */ r) => isRec(r) && r.id === c.id) : undefined;
      if (isRec(res) && typeof res.ok === 'boolean') {
        e.ok = res.ok;
        if (res.ok) {
          const f = sheetFoundWords(c, newest.claims);
          e.found = f === null ? `${name} checked` : `${name} checked — ${f}`;
        } else {
          const gap = typeof res.result === 'string' ? res.result.split('\n').map((/** @type {string} */ x) => x.trim().replace(`${e.id}: `, '')).filter(Boolean).join('; ') : '';
          e.found = `${name} — ${gap || 'did not pass'}`;
        }
      }
      return e;
    });
    const notChecked = guardrails.filter((r, i) => !isColumnChoiceRule(r) && !covered.has(i + 1));
    out.push({ line: st.fromLine, guardrails, checked, notChecked: notChecked.length === 0 ? 'none' : notChecked });
  }
  return out;
}

/**
 * The guardrail rules of a sheet step that no check covers, as the drafter's Not-checked lines (`line N: "rule" - no sheet check covers it`): the block's own
 * `notChecked`, one list for the plan card and the drafter's saved record.
 * @param {any} declaration @param {Array<{n: number, rules?: string[], guardrail?: string, rule?: string}>} lines @param {string[]} csvRoles @returns {string[]}
 */
export function uncoveredRules(declaration, lines, csvRoles) {
  if (csvRoles.length === 0) return [];
  return sheetLineBlocks({ declaration, lines, csvRoles }).flatMap((b) => (b.notChecked === 'none' ? [] : b.notChecked.map((r) => `line ${b.line}: "${r}" \u2014 no sheet check covers it`)));
}

/** @param {any} arbiter @returns {string[]} the roles of the signed sources that are a CSV file (the sheets a check reads) */
export function csvRolesOf(arbiter) {
  return (Array.isArray(arbiter?.sources) ? arbiter.sources : [])
    .filter((/** @type {any} */ s) => isRec(s) && s.kind !== 'page' && typeof s.path === 'string' && s.path.toLowerCase().endsWith('.csv') && typeof s.role === 'string')
    .map((/** @type {any} */ s) => s.role);
}
