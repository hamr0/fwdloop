// M10b piece 1 (docs/wiki/the-module-ladder.md "M10b scope" item 4 and amendment 1): the signed checks of a sheet live in the job, in the step's close
// (`close.sheet`). Each entry is a bareguard `cells` / `table` check object, kept as DATA exactly as bareguard defines it (src/primitives/rubric.js
// `rubricVocabulary`); fwdloop has no check language of its own. Three things live here, each once:
//   - `sheetCheckColumns`  every column name a check holds, wherever bareguard puts one (the code proves each is an exact header of the sheet);
//   - `sheetCheckReds`     the $0 sign-time test: the checks are built into a bareguard rubric over the drafting copy's table (its `tableSha`), and a
//                          refusal comes back as a red naming the job line;
//   - `sheetCheckSentence` the plain words of one check, written from its typed fields, for the plan card and the readout.
// Throws away: nothing is stored here; the sentence leaves out fields that do not change what the check says (id, claim, range, tolerance, valueKind).
// Third outcomes, each named, never silently fine: a sheet bareguard cannot read as a table (`tableSha` null: a row with another cell count than the header,
// a repeated header), a role with no drafting copy, a refusal by `createRubric`.

import { createRubric, tableSha } from 'bareguard';
import { numbersSaid } from './citedwords.js';
import { wordsSaidOn, lineRules } from './pagebits.js';

/** the bareguard rules a sheet check may use (`diff` is out of scope for M10b) */
export const SHEET_RULES = Object.freeze(['cells', 'table']);
/** most checks one step may carry */
export const MAX_SHEET_CHECKS = 20;

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the fields of a check that hold a column name as a plain string (the ONE list: {@link sheetCheckColumns} reads it, the drafter's tool schema offers a header enum on each) */
export const COLUMN_STRING_FIELDS = Object.freeze(['column', 'keyColumn', 'groupColumn', 'result']);
/** the row-math operands: a column name, or (for `b`) `{const}` */
export const COLUMN_OPERAND_FIELDS = Object.freeze(['a', 'b']);
/** the date-cell fields: `{column, row}` */
export const COLUMN_CELL_FIELDS = Object.freeze(['from', 'to', 'cell']);
/** the list fields whose entries hold a `column` */
export const COLUMN_LIST_FIELDS = Object.freeze(['where', 'dateFormats']);

/**
 * Every column name one check holds: its own `column`, `keyColumn`, `groupColumn`, `result`, a row-math operand `a` / `b` (a name; `{const}` is no column), the
 * date cells `from` / `to` / `cell`, and the column of each `where` condition and `dateFormats` entry.
 * @param {any} check @returns {string[]}
 */
export function sheetCheckColumns(check) {
  if (!isRec(check)) return [];
  const out = [];
  for (const k of [...COLUMN_STRING_FIELDS, ...COLUMN_OPERAND_FIELDS]) if (typeof check[k] === 'string') out.push(check[k]);
  for (const k of COLUMN_CELL_FIELDS) if (isRec(check[k]) && typeof check[k].column === 'string') out.push(check[k].column);
  for (const k of COLUMN_LIST_FIELDS) if (Array.isArray(check[k])) for (const e of check[k]) if (isRec(e) && typeof e.column === 'string') out.push(e.column);
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
 * M10b piece 4: a signed check may carry fwdloop's own `covers` (the numbers of the job line's `~` rules the drafter tagged it to; signed, so the person sees it).
 * bareguard does not know it, so the checks are cleaned HERE, the ONE place, on the way into bareguard (`createRubric` at sign time and at run time).
 * @param {any[]} checks @returns {any[]} a copy without `covers`
 */
export function bareguardChecks(checks) {
  return checks.map((c) => { if (!isRec(c) || !('covers' in c)) return c; const { covers: _kept, ...rest } = c; return rest; });
}

/**
 * M10b piece 4: `covers`, when a check has it, is a list of rule numbers of its job line (counted from 1 over the line's `~` rules). A check without it is fine (an old draft).
 * @param {any[]} checks @param {{n: number, rule?: string, rules?: string[]}} jobLine @returns {string[]} reds, each naming the line and the check
 */
export function sheetCoversReds(checks, jobLine) {
  const reds = [];
  const nRules = lineRules(jobLine).length;
  for (const c of checks) {
    if (!isRec(c) || c.covers === undefined) continue;
    if (!Array.isArray(c.covers) || c.covers.some((x) => !Number.isInteger(x) || x < 1 || x > nRules)) {
      reds.push(`declaration: line ${jobLine.n}: the sheet check${typeof c.id === 'string' ? ` '${c.id}'` : ''} "covers" must list rule numbers of line ${jobLine.n}'s guardrail (it has ${nRules} rule${nRules === 1 ? '' : 's'}, counted from 1)`);
    }
  }
  return reds;
}

/** The rows for a step's `close.sheet`, one per check, in order. @param {unknown} sheet @returns {string[]} */
export function sheetCheckRows(sheet) {
  return Array.isArray(sheet) ? sheet.map(sheetCheckSentence) : [];
}

/**
 * The $0 sign-time test of one step's sheet checks (M10b item 4): bareguard's `createRubric` is given the checks and the signed fingerprint of each sheet
 * they read (`tableSha` of the drafting copy's table). A refusal is a red that names the job line (and the check). A column that is no header of its sheet is
 * a red naming the line and the column. Never throws.
 * @param {any[]} checks the step's `close.sheet` (already known to be a list of objects) @param {number} line the job line the step comes from
 * @param {Record<string, {header: string[], rows: any[]}>} tables the drafting copy's table of each sheet role @returns {string[]} reds, each naming the line
 */
export function sheetCheckReds(checks, line, tables) {
  const reds = [];
  const at = `declaration: line ${line}:`;
  /** @type {Map<string, string|null>} */
  const shas = new Map();
  for (const c of checks) {
    if (!isRec(c) || typeof c.table !== 'string' || shas.has(c.table)) continue;
    const t = tables[c.table];
    if (!t) { shas.set(c.table, null); reds.push(`${at} the sheet check reads "${c.table}", which has no saved copy to test against`); continue; }
    shas.set(c.table, tableSha(t));
    if (shas.get(c.table) === null) reds.push(`${at} bareguard cannot read "${c.table}" as a table (a row with more or fewer cells than the header, or a repeated column name); fix the sheet`);
  }
  for (const c of checks) {
    const t = isRec(c) && typeof c.table === 'string' ? tables[c.table] : undefined;
    if (!t) continue;
    for (const name of sheetCheckColumns(c)) {
      if (!t.header.includes(name)) reds.push(`${at} '${name}' is not a real column of "${c.table}" (its columns: ${t.header.map((h) => `'${h}'`).join(', ')}). Copy a column name exactly.`);
    }
  }
  if (reds.length > 0) return reds;
  const inputs = [...shas].map(([name, sha256]) => ({ name, sha256 }));
  try {
    createRubric({ schema: 1, goal: `line ${line}`, inputs, checkpoints: { sheet: { gating: true, checks: bareguardChecks(checks) } }, maxReds: 3 });
  } catch (err) {
    const msg = String(/** @type {any} */ (err).message).replace(/^invalid rubric: /, '');
    const idx = /checks\[(\d+)\]/.exec(String(/** @type {any} */ (err).path ?? msg));
    const who = idx && isRec(checks[Number(idx[1])]) && typeof checks[Number(idx[1])].id === 'string' ? ` '${checks[Number(idx[1])].id}'` : '';
    reds.push(`${at} bareguard refuses the sheet check${who}: ${msg}`);
  }
  return reds;
}

const NUMBER_CMPS = Object.freeze(['gt', 'gte', 'lt', 'lte', 'eq', 'between']);
const DATE_CMPS = Object.freeze(['before', 'after', 'dateOn', 'dateBetween']);

/**
 * M10b piece 3: a number or a date in a check comes from the job, never from the model. Every number in a `where` condition (gt gte lt lte eq between) must be a
 * number the person said on the job line or its `~` rules (the SAME reader as the page number rules, src/citedwords.js `numbersSaid`: a bare number or an amount,
 * not a piece of a time, a date or another amount), and every date (`asOf`, and the values of before / after / dateOn / dateBetween) must be a date they wrote
 * exactly. Throws away: a text value (`equals`, `needle`), band bounds, `n`, `tolerance`, `range` are not read here (the job's words do not have to carry them).
 * @param {any[]} checks the step's `close.sheet` @param {{n: number, text?: string, rule?: string, rules?: string[]}} jobLine @returns {string[]} reds, each naming the line
 */
export function sheetCheckWordReds(checks, jobLine) {
  const said = numbersSaid(wordsSaidOn(jobLine));
  const reds = [];
  const n = jobLine.n;
  const who = (/** @type {any} */ c) => (isRec(c) && typeof c.id === 'string' ? ` '${c.id}'` : '');
  const num = (/** @type {any} */ c, /** @type {unknown} */ v, /** @type {string} */ where) => {
    if (typeof v === 'number' && !said.bare.has(v) && !said.amount.has(v)) reds.push(`declaration: line ${n}: the sheet check${who(c)} has the number ${v} (${where}), but ${v} is not in your words on line ${n}. A number in a check must come from the job line or a ~ rule you wrote. Say it there, or leave the condition out.`);
  };
  const date = (/** @type {any} */ c, /** @type {unknown} */ v, /** @type {string} */ where) => {
    if (typeof v === 'string' && !said.date.has(v)) reds.push(`declaration: line ${n}: the sheet check${who(c)} has the date ${v} (${where}), but ${v} is not a date in your words on line ${n}. A date in a check must be written on the job line or a ~ rule, as YYYY-MM-DD. Say it there, or leave it out.`);
  };
  for (const c of checks) {
    if (!isRec(c)) continue;
    if (c.asOf !== undefined) date(c, c.asOf, 'as of');
    for (const w of Array.isArray(c.where) ? c.where : []) {
      if (!isRec(w)) continue;
      const at = `where ${String(w.column)}`;
      if (NUMBER_CMPS.includes(w.cmp)) for (const k of w.cmp === 'between' ? ['lo', 'hi'] : ['value']) num(c, w[k], at);
      else if (DATE_CMPS.includes(w.cmp)) for (const k of w.cmp === 'dateBetween' ? ['lo', 'hi'] : ['value']) date(c, w[k], at);
    }
  }
  return reds;
}

/**
 * M10b piece 3: a step whose sheet checks are ALL `table` checks has nothing to answer (a table check judges the sheet itself and carries no claim), so the
 * step would be asked for nothing. Refused at $0, naming the line. @param {any[]} checks @param {number} line @returns {string[]}
 */
export function sheetNoClaimReds(checks, line) {
  if (checks.length === 0 || !checks.every((c) => isRec(c) && c.rule === 'table')) return [];
  return [`declaration: line ${line}: every sheet check on this step is a table check, which judges the sheet itself and leaves the step nothing to answer. Pair it with at least one cells check that has a claim (for example rows, countIf, sumIf or band).`];
}
