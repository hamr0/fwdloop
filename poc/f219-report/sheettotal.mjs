// borrowed-from: bareloop src/sheetclaims.js@v0.60.0 (sheetTotalLines, PLAIN_CELL_NUMBER, ROW_MATH_OPS, fmt; 5852b9a9 strict number test; POC copy, F219)
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const ROW_MATH_OPS = Object.freeze(['sumIf', 'countIf']);

/** A strict plain number: optional sign, digits (commas only as thousands groups of three), optional decimals. `12,50`, `1e3`, `0x10` are not numbers (F356). */
const PLAIN_CELL_NUMBER = /^[+-]?(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?$/;
const fmt = (n, d) => Number(n.toFixed(d)).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });

/**
 * The plain line(s) the report carries for each sumIf / countIf check: `Total of rows 3, 5, 9: 1,234.50 (computed by code from the rows named)` and `Count of rows 3, 5, 9: 3 (computed by code from the rows named)`.
 * Computed from the FROZEN table and the rows the worker named (`claims.<claim>.rows`), never from a number the worker wrote. A named row that is no row of the sheet adds nothing (the rows check is the red for it);
 * a blank cell is skipped (as bareguard's sum skips it); a cell that is not a number makes the total "not computed", naming the row number and the column, never a guess. A check whose box holds no list of integers writes no line.
 * @param {any[]} checks the step's sheet checks as signed @param {any} claims the step file's `claims` @param {Record<string, {header: string[], rows: {rowNumber: number, cells: string[]}[]}>} tables by input label
 * @returns {string[]}
 */
export function sheetTotalLines(checks, claims, tables) {
  /** @type {string[]} */
  const out = [];
  for (const c of checks) {
    if (!isRec(c) || c.rule !== 'cells' || !ROW_MATH_OPS.includes(c.op)) continue;
    const box = isRec(claims) && isRec(claims[c.claim]) ? claims[c.claim].rows : undefined;
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
    let bad = null;
    for (const n of rows) {
      const cell = String(byRow.get(n)?.cells[col] ?? '').trim();
      if (cell === '') continue;
      if (!PLAIN_CELL_NUMBER.test(cell)) { bad = n; break; }
      const v = Number(cell.replaceAll(',', ''));
      sum += v;
      decimals = Math.max(decimals, (cell.split('.')[1] ?? '').length);
    }
    out.push(bad === null
      ? `Total of ${list}: ${fmt(sum, Math.min(decimals, 6))} (computed by code from the rows named)`
      : `Total of ${list}: not computed (row ${bad} has no number in the column "${c.column}")`);
  }
  return out;
}
