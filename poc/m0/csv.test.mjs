import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { parseCsv, colLetter, colIndex } from './csv.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixturePath = join(__dirname, '..', '..', 'fixtures', 'ar-aging.csv');

test('colLetter / colIndex round-trip', () => {
  assert.equal(colLetter(0), 'A');
  assert.equal(colLetter(4), 'E');
  assert.equal(colIndex('A'), 0);
  assert.equal(colIndex('E'), 4);
});

test('parses the real ar-aging fixture into addressable cells', () => {
  const text = readFileSync(fixturePath, 'utf8');
  const { header, rows } = parseCsv(text);
  assert.deepEqual(header, [
    'Customer', 'Invoice #', 'Invoice date', 'Due date', 'Amount',
    'Days overdue', 'Current', '1-30', '31-60', '61-90', '90+',
  ]);
  assert.equal(rows.length, 8);
  // Row 2 (sheet row) is the first data row: Northwind Trading, E2 = 4200.
  assert.equal(rows[0].rowNumber, 2);
  assert.equal(rows[0].cells.E, '4200');
  assert.equal(rows[0].byName.Customer, 'Northwind Trading');
  // Row 9 (sheet row) is the last data row: Sunrise Retail, E9 = 2400.
  assert.equal(rows[7].rowNumber, 9);
  assert.equal(rows[7].cells.E, '2400');
});

test('a wrong cell value in a hand-made CSV is visible as a different string (parser does not silently coerce)', () => {
  const { rows } = parseCsv('Customer,Amount\nAcme,4200\n');
  assert.equal(rows[0].cells.B, '4200');
  assert.notEqual(rows[0].cells.B, '4300'); // proves the parser can produce a value that fails a later equality check
});
