// borrowed-from: bareloop src/sheetchecks.js@v0.61.0 (fc56e1f3)
// borrowed-from: fwdloop src/sheetchecks.js@v0.35.0 (M10b piece 1; docs/product/ITEM33-BUILD.md "Addendum 2026-11-17", S2). A sheet check is a bareguard `cells` / `table` check object, kept as DATA exactly as bareguard
// defines it (`rubricVocabulary`); bareloop has no check language of its own. What lives here, each once:
//   - `sheetCheckColumns`  every column name a check holds, read from bareguard's vocabulary (`columnAt` on each field; the code proves each is an exact header of the sheet);
//   - `sheetCheckReds`     the $0 test: bareguard's `checkTables` judges the checks over the drafting copy's tables; each problem comes back as a red naming the job line;
//   - `sheetCheckSentence` the plain words of one check, written from its typed fields (never from model text);
//   - `bareguardChecks`    the code-only fields (`covers`, `row`) cleaned off on the way into bareguard;
//   - `sheetNoClaimReds`   a stage-shape red for S3: a stage whose checks are ALL table checks has nothing to answer.
// Not copied (docs/product/ITEM33-BUILD.md S2): `sheetCoversReds` and `sheetCheckWordReds` (the build refuses the same things itself with `groundedLiterals`: src/sheetbuild.js) and `sheetCheckRows` (S4 shows the rows).
// Throws away: nothing is stored here; the sentence leaves out fields that do not change what the check says (id, claim, range, tolerance, valueKind).
// Third outcomes, each named, never silently fine: a sheet bareguard cannot read as a table (`tableSha` null: a row with another cell count than the header, a repeated header), a name with no drafting copy, a refusal by `createRubric`.

import { checkTables, tableSha, rubricVocabulary } from 'bareguard';

/** the bareguard rules a sheet check may use (`diff` is out of scope) */
export const SHEET_RULES = Object.freeze(['cells', 'table']);
/** most checks one step may carry */
export const MAX_SHEET_CHECKS = 20;

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const V = /** @type {any} */ (rubricVocabulary);

/**
 * Every column name one check holds, read from bareguard's own vocabulary: each field of the check's rule that carries `columnAt` ("self": a name; "self.column": a cell
 * `{column, row}`; "each.column": a list of `{column}`; "each": a list of names). A row-math `b` of `{const}` is no column. bareguard owns which fields these are.
 * @param {any} check @returns {string[]}
 */
export function sheetCheckColumns(check) {
  if (!isRec(check)) return [];
  const out = [];
  for (const [k, f] of Object.entries(V.rules[check.rule]?.fields ?? {})) {
    const at = /** @type {any} */ (f).columnAt;
    const v = check[k];
    if (!at || v === undefined) continue;
    if (at === 'self') { if (typeof v === 'string') out.push(v); } else if (at === 'self.column') { if (isRec(v) && typeof v.column === 'string') out.push(v.column); } else if (Array.isArray(v)) for (const e of v) { if (at === 'each.column' ? isRec(e) && typeof e.column === 'string' : typeof e === 'string') out.push(at === 'each.column' ? e.column : e); }
  }
  return out;
}

const CMP_WORDS = Object.freeze({
  gt: '>', gte: '>=', lt: '<', lte: '<=', eq: '=', before: 'before', after: 'after', dateOn: 'on', equals: 'is',
});

/** @param {any} w one `where` condition @returns {string} */
function conditionWords(w) {
  if (!isRec(w)) return '?';
  const col = String(w.column);
  const v = (/** @type {unknown} */ x) => (typeof x === 'string' ? `"${x}"` : String(x));
  if (w.cmp === 'between' || w.cmp === 'dateBetween') return `${col} between ${v(w.lo)} and ${v(w.hi)}`;
  if (w.cmp === 'empty') return `${col} is empty`;
  if (w.cmp === 'notEmpty') return `${col} is not empty`;
  const sym = /** @type {Record<string, string>} */ (CMP_WORDS)[w.cmp];
  return `${col} ${sym ?? String(w.cmp)} ${v(w.value)}`;
}

/** @param {any} check @returns {string} " where A > 1 and B is empty", or "" */
const whereWords = (check) => (Array.isArray(check.where) && check.where.length > 0 ? ` where ${check.where.map(conditionWords).join(' and ')}` : '');

/** @param {any} b one band @returns {string} */
const bandName = (b) => (isRec(b) ? String(b.name) : '?');

/**
 * The plain words of ONE sheet check, written from its typed fields (never from model text). The ONE function; the plan card, the readout and the Checked
 * list all call it. An op with no sentence of its own reads `<rule> <op> on <column>` plus its conditions, so a check can never be shown as nothing.
 * @param {any} check a bareguard cells / table check object @returns {string}
 */
export function sheetCheckSentence(check) {
  if (!isRec(check)) return 'a check that is not readable';
  const col = typeof check.column === 'string' ? check.column : '';
  const asOf = typeof check.asOf === 'string' ? ` as of ${check.asOf}` : '';
  switch (check.op) {
    case 'rows': return `rows${whereWords(check)}`;
    case 'countIf': return `count of rows${whereWords(check)}`;
    case 'count': return `count of ${col}`;
    case 'sumIf': return `sum of ${col}${whereWords(check)}`;
    case 'sum': return `sum of ${col}`;
    case 'averageIf': return `average of ${col}${whereWords(check)}`;
    case 'average': return `average of ${col}`;
    case 'band': return `band on ${col}${asOf}: ${(Array.isArray(check.bands) ? check.bands : []).map(bandName).join(', ')}${whereWords(check)}`;
    case 'daysSince': return `days since ${col || 'a date cell'}${asOf}${whereWords(check)}`;
    case 'noDuplicates': return `no duplicate ${col}`;
    case 'noEmpty': return `no empty ${col}`;
    case 'allNumbers': return `every ${col} is a number`;
    case 'allDates': return `every ${col} is a date`;
    case 'rowCount': return `the sheet has ${check.n} rows`;
    default: return `${check.rule} ${check.op}${col ? ` on ${col}` : ''}${whereWords(check)}`;
  }
}

/**
 * A built check may carry bareloop's own `covers` (the numbers of the job line's `~` rules it verifies).
 * bareguard does not know it, so the checks are cleaned HERE, the ONE place, on the way into bareguard (`createRubric` at sign time and at run time).
 * `row` (bareloop's own typed tag of a check code made an `[agent]` row) is cleaned here too.
 * @param {any[]} checks @returns {any[]} a copy without `covers` and `row`
 */
export function bareguardChecks(checks) {
  return checks.map((c) => { if (!isRec(c) || !('covers' in c || 'row' in c)) return c; const { covers: _kept, row: _row, ...rest } = c; return rest; });
}

/**
 * The $0 test of one line's sheet checks: bareguard's `checkTables` is given the checks and the signed fingerprint of each sheet they read
 * (`tableSha` of the drafting copy's table) and returns every problem; each becomes a red that names the job line (and the check) in bareloop's words. A sheet with no
 * saved copy, a sheet bareguard cannot read as a table, or a column that is no header of its sheet is reported first; a check bareguard refuses only when none of those is.
 * Never throws.
 * @param {any[]} checks the step's `close.sheet` (already known to be a list of objects) @param {number} line the job line the step comes from
 * @param {Record<string, {header: string[], rows: any[]}>} tables the drafting copy's table of each sheet role @returns {string[]} reds, each naming the line
 */
export function sheetCheckReds(checks, line, tables) {
  const at = `line ${line}:`;
  /** @type {Map<string, string>} */
  const shas = new Map();
  for (const c of checks) if (isRec(c) && typeof c.table === 'string' && !shas.has(c.table)) shas.set(c.table, (tables[c.table] ? tableSha(tables[c.table]) : null) ?? '0'.repeat(64));
  const inputs = [...shas].map(([name, sha256]) => ({ name, sha256 }));
  const problems = checkTables({ schema: 1, goal: `line ${line}`, inputs, checkpoints: { sheet: { gating: true, checks: bareguardChecks(checks) } }, maxReds: 3 }, tables);
  const reds = [];
  const seen = new Set();
  /** @param {string} name @param {string} table */
  const columnRed = (name, table) => `${at} '${name}' is not a real column of "${table}" (its columns: ${tables[table].header.map((h) => `'${h}'`).join(', ')}). Copy a column name exactly.`;
  for (const p of problems) {
    const key = `${p.kind}\u0000${p.table}`;
    if (p.kind === 'no-table' && !seen.has(key)) reds.push(`${at} the sheet check reads "${p.table}", which has no saved copy to test against`);
    else if (p.kind === 'unreadable-table' && !seen.has(key)) reds.push(`${at} bareguard cannot read "${p.table}" as a table (a row with more or fewer cells than the header, or a repeated column name); fix the sheet`);
    else if (p.kind === 'not-a-column') reds.push(columnRed(String(p.column), String(p.table)));
    else if (p.kind === 'refused' && typeof p.index === 'number' && isRec(checks[p.index]) && tables[checks[p.index].table]) {
      // bareguard names no column of a check it refuses; the person is told the wrong column first, as before
      for (const name of sheetCheckColumns(checks[p.index])) if (!tables[checks[p.index].table].header.includes(name)) reds.push(columnRed(name, checks[p.index].table));
    }
    seen.add(key);
  }
  if (reds.length > 0) return reds;
  const refused = problems.find((p) => p.kind === 'refused' || p.kind === 'sha-mismatch');
  if (refused) {
    const msg = String(refused.message ?? refused.kind).replace(/^invalid rubric: /, '');
    reds.push(`${at} bareguard refuses the sheet check${typeof refused.id === 'string' ? ` '${refused.id}'` : ''}: ${msg}`);
  }
  return reds;
}

/**
 * A stage whose sheet checks are ALL `table` checks has nothing to answer (a table check judges the sheet itself and carries no claim), so the
 * step would be asked for nothing. Refused at $0, naming the line. @param {any[]} checks @param {number} line @returns {string[]}
 */
export function sheetNoClaimReds(checks, line) {
  if (checks.length === 0 || !checks.every((c) => isRec(c) && c.rule === 'table')) return [];
  return [`line ${line}: every sheet check on this step is a table check, which judges the sheet itself and leaves the step nothing to answer. Pair it with at least one cells check that has a claim (for example rows, countIf, sumIf or band).`];
}
