// M10b item 2: the sheet is read right (quoted cells, real row numbers, cells in header order) and handed to bareguard as its table shape.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { tableSha } from 'bareguard';
import { parseCsv, sheetTable } from '../src/csv.js';

const fixture = (n) => readFileSync(new URL(`./fixtures/m10b-sheets/${n}`, import.meta.url), 'utf8');

test('a quoted cell with a comma is one cell', () => {
  const { header, rows } = parseCsv('Item,Amount,Tax\nrent,"1,200.50",5\n');
  assert.equal(header.length, 3);
  assert.equal(rows[0].cells.B, '1,200.50');
  assert.equal(rows[0].cells.C, '5');
  assert.equal(rows[0].byName.Amount, '1,200.50');
});

test('a doubled quote inside a quoted cell is one quote', () => {
  const { rows } = parseCsv('Item,Note\nrent,"say ""hi"", ok"\n');
  assert.equal(rows[0].cells.B, 'say "hi", ok');
});

test('a line break inside quotes stays in the cell and the next row keeps its real line', () => {
  const { rows } = parseCsv('Item,Note\nrent,"two\nlines"\nbeans,x\n');
  assert.equal(rows[0].cells.B, 'two\nlines');
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[1].rowNumber, 4);
  assert.equal(rows[1].cells.A, 'beans');
});

test('CRLF ends a row and leaves no \\r in a cell', () => {
  const { header, rows } = parseCsv('A,B\r\n1,2\r\n3,"4"\r\n');
  assert.deepEqual(header, ['A', 'B']);
  assert.deepEqual(rows.map((r) => [r.rowNumber, r.cells.A, r.cells.B]), [[2, '1', '2'], [3, '3', '4']]);
});

test('a blank line in the middle is skipped but later rows keep their real sheet row number', () => {
  const { rows } = parseCsv('A,B\n1,2\n\n3,4\n\n\n5,6\n');
  assert.deepEqual(rows.map((r) => [r.rowNumber, r.cells.A]), [[2, '1'], [4, '3'], [7, '5']]);
});

test('sheetTable: cells in header order, header exactly as in the file', () => {
  const t = sheetTable(parseCsv(' Invoice # ,Due date,Amount\nINV-1,2026-01-15,"1,000.00"\n'));
  assert.deepEqual(t.header, [' Invoice # ', 'Due date', 'Amount']);
  assert.deepEqual(t.rows, [{ rowNumber: 2, cells: ['INV-1', '2026-01-15', '1,000.00'] }]);
});

test('a ragged row reaches bareguard raw: short and long rows are not padded or cut, so tableSha refuses the table', () => {
  const t = sheetTable(parseCsv('A,B,C\n1\n1,2,3,4,5\n'));
  assert.deepEqual(t.rows, [{ rowNumber: 2, cells: ['1'] }, { rowNumber: 3, cells: ['1', '2', '3', '4', '5'] }]);
  assert.equal(tableSha(t), null);
  assert.equal(typeof tableSha(sheetTable(parseCsv('A,B,C\n1,2,3\n'))), 'string');
});

test('a trailing all-blank row (commas only) is a row of empty cells; a trailing empty line is not a row', () => {
  const t = sheetTable(parseCsv('A,B\n1,2\n,\n\n'));
  assert.deepEqual(t.rows, [{ rowNumber: 2, cells: ['1', '2'] }, { rowNumber: 3, cells: ['', ''] }]);
});

test('the frozen-sheet shapes read whole: 40 expense rows (quoted cells kept) and 8 aging rows', () => {
  const exp = sheetTable(parseCsv(fixture('expenses.csv')));
  const age = sheetTable(parseCsv(fixture('aging.csv')));
  assert.equal(exp.rows.length, 40);
  assert.equal(age.rows.length, 8);
  assert.ok(exp.rows.every((r) => r.cells.length === exp.header.length));
  assert.equal(exp.rows[3].cells[1], 'Office supplies, bulk');
  assert.equal(exp.rows[5].cells[2], '1,200.50');
  assert.deepEqual(exp.rows.map((r) => r.rowNumber), Array.from({ length: 40 }, (_, i) => i + 2));
});

test('bareguard accepts the table: tableSha is a sha256, and moves when one cell changes', () => {
  const t = sheetTable(parseCsv(fixture('aging.csv')));
  const sha = tableSha(t);
  assert.match(String(sha), /^[0-9a-f]{64}$/);
  const u = sheetTable(parseCsv(fixture('aging.csv').replace('200.00', '201.00')));
  assert.notEqual(tableSha(u), sha);
});
