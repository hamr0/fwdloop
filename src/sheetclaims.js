// M10b piece 2 (docs/wiki/the-module-ladder.md "M10b scope" item 5): what a step that reads a sheet is told and what box it answers in.
// A step answers each `cells` check's CLAIM in bareguard's typed box ({value}, {rows}, {days}, {bands}, ...), never a cite or a formula. The schema of every box is
// bareguard's `claimSchema` of the check; the box the step is TOLD is bareguard's own worked example for the op (`rubricVocabulary.rules.cells.ops.<op>.example`). Never hand-copied here. The step is told the box, not the
// check: no op, no condition, no bound, no column ever reaches it (the construction test in test/m10b-sheet-run.test.js proves the request carries none).
// Throws away: a check with no claim (a `table` check judges the sheet itself) adds no box; two checks with the same claim name share one box.
import { rubricVocabulary, claimSchema } from 'bareguard';
import { bareguardChecks } from './sheetchecks.js';
import { isRec } from './isrec.js';

/**
 * The claim box of every `cells` check in the list: `[{claim, example}]`, one per claim name, in order. `example` is the op's worked-example answer (the box's shape
 * with example values). A check bareguard has no example for, and a `table` check, add nothing.
 * @param {any[]} checks a step's `close.sheet` @returns {Array<{claim: string, example: Record<string, any>, ops: string[]}>}
 */
export function sheetClaims(checks) {
  /** @type {Map<string, {claim: string, example: Record<string, any>, ops: string[]}>} */
  const out = new Map();
  const ops = /** @type {any} */ (rubricVocabulary).rules?.cells?.ops ?? {};
  for (const c of Array.isArray(checks) ? checks : []) {
    if (!isRec(c) || c.rule !== 'cells' || typeof c.claim !== 'string' || typeof c.op !== 'string') continue;
    const ex = ops[c.op]?.example;
    const shape = isRec(ex) && isRec(ex.output) && isRec(ex.check) ? ex.output[ex.check.claim] : undefined;
    if (!isRec(shape)) continue;
    const have = out.get(c.claim);
    if (have) { Object.assign(have.example, shape); have.ops.push(c.op); } else out.set(c.claim, { claim: c.claim, example: { ...shape }, ops: [c.op] });
  }
  return [...out.values()];
}

/**
 * The `emit_artifact` tool's properties for a step that reads a sheet: one typed box per claim, each required, the box's schema bareguard's `claimSchema` of the check
 * (two checks that share a claim name share one box: their keys merge). `covers` is fwdloop's own and is stripped before bareguard reads the check. (`done` is added by the caller.)
 * @param {any[]} checks @returns {{properties: Record<string, any>, required: string[]}}
 */
export function sheetAnswerProps(checks) {
  /** @type {Record<string, any>} */
  const properties = {};
  for (const c of Array.isArray(checks) ? checks : []) {
    if (!isRec(c) || c.rule !== 'cells' || typeof c.claim !== 'string') continue;
    const box = /** @type {any} */ (claimSchema(bareguardChecks([c])[0]));
    if (box === null) continue;
    const have = properties[c.claim];
    properties[c.claim] = have === undefined ? box : { ...have, ...box, properties: { ...have.properties, ...box.properties }, required: [...new Set([...(have.required ?? []), ...(box.required ?? [])])] };
  }
  return { properties, required: Object.keys(properties) };
}

/**
 * What the step is told about its answer (one key of its request): the name and the shape of each box, with the worked example's values. Never the check.
 * @param {any[]} checks @returns {{answer: string, fields: Record<string, Record<string, any>>}}
 */
export function sheetBrief(checks) {
  return {
    answer: 'Answer with one field for each name in "fields", in the shape shown for it. Give the values themselves, worked out from the input - never a cell reference and never a formula. The values shown only illustrate the shape; use the real ones from the input and the job line.',
    fields: Object.fromEntries(sheetClaims(checks).map(({ claim, example }) => [claim, example])),
  };
}

// borrowed-from: bareloop src/sheetclaims.js@v0.60.0 (sheetTotalLines, PLAIN_CELL_NUMBER, ROW_MATH_OPS, fmt; the F356 strict number test). Adapted (M15 am3a): fwd's boxes are separate, so the rows come from the line's `rows` check of the same table and `where`.
export const ROW_MATH_OPS = Object.freeze(['sumIf', 'countIf']);

/** A strict plain number: optional sign, digits (commas only as thousands groups of three), optional decimals. `12,50`, `1e3`, `0x10` are not numbers. */
const PLAIN_CELL_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const fmt = (/** @type {number} */ n, /** @type {number} */ d) => Number(n.toFixed(d)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
const sameWhere = (/** @type {any} */ a, /** @type {any} */ b) => a.table === b.table && JSON.stringify(a.where ?? null) === JSON.stringify(b.where ?? null);

/**
 * The plain lines the report carries for each sumIf / countIf check: `Count of rows 3, 5, 9: 3 (computed by code from the rows named)` and `Total of rows 3, 5, 9: 1,234.50 (computed by code from the rows named)`.
 * Computed from the FROZEN table and the rows the step named in the `rows` check of the same table and `where` (M15 am3a), never from a number the step wrote. A check with no such `rows` check, or whose box holds no list
 * of integers, writes no line. A named row that is no row of the sheet adds nothing; a blank cell is skipped; a cell that is no strict number makes the total "not computed", naming the row and the column.
 * @param {any[]} checks the step's sheet checks as signed @param {any} claims the step's boxes by claim name @param {Record<string, {header: string[], rows: {rowNumber: number, cells: string[]}[]}>} tables by input label
 * @returns {string[]}
 */
export function sheetTotalLines(checks, claims, tables) {
  /** @type {string[]} */
  const out = [];
  for (const c of checks) {
    if (!isRec(c) || c.rule !== 'cells' || !ROW_MATH_OPS.includes(c.op)) continue;
    const rowsCheck = checks.find((x) => isRec(x) && x.rule === 'cells' && x.op === 'rows' && typeof x.claim === 'string' && sameWhere(x, c));
    const box = rowsCheck && isRec(claims) && isRec(claims[rowsCheck.claim]) ? claims[rowsCheck.claim].rows : undefined;
    const table = tables[c.table];
    if (!table || !Array.isArray(box) || !box.every((/** @type {unknown} */ x) => Number.isInteger(x))) continue;
    const named = [...new Set(/** @type {number[]} */ (box))].sort((a, b) => a - b);
    const byRow = new Map(table.rows.map((r) => [r.rowNumber, r]));
    const rows = named.filter((n) => byRow.has(n));
    const list = rows.length > 0 ? `rows ${rows.join(', ')}` : 'no rows';
    if (c.op === 'countIf') { out.push(`Count of ${list}: ${rows.length} (computed by code from the rows named)`); continue; }
    const col = table.header.indexOf(c.column);
    let sum = 0;
    let decimals = 0;
    /** @type {number|null} */
    let bad = null;
    for (const n of rows) {
      const cell = String(byRow.get(n)?.cells[col] ?? '').trim();
      if (cell === '') continue;
      if (!PLAIN_CELL_NUMBER.test(cell)) { bad = n; break; }
      sum += Number(cell.replaceAll(',', ''));
      decimals = Math.max(decimals, (cell.split('.')[1] ?? '').length);
    }
    out.push(bad === null
      ? `Total of ${list}: ${fmt(sum, Math.min(decimals, 6))} (computed by code from the rows named)`
      : `Total of ${list}: not computed (row ${bad} has no number in the column "${c.column}")`);
  }
  return out;
}
