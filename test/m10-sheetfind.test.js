// M10 piece 5 (item 7, F71 Test 3): when a job word is not a column of the sheet, CODE finds the column that passes the same test (numbers in the rows) and
// builds the ask; the model names no column and decides no ask. $0, synthetic sheets.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { findColumn, columnQuestion, FIT_RATIO } from '../src/sheetfind.js';

/** a sheet of `n` rows: Date, Description, Amount (a number in `amountRows` of them), Tax (a number in `taxRows`) */
const sheet = (n, amountRows, taxRows, { amount = 'Amount', tax = 'Tax' } = {}) => {
  const head = ['Date', 'Description', amount, tax].filter((h) => h !== '');
  const rows = [];
  for (let i = 1; i <= n; i += 1) {
    const cells = [`2026-09-${String((i % 28) + 1).padStart(2, '0')}`, `Office item ${i}`];
    if (amount !== '') cells.push(i <= amountRows ? `${100 + i}.50` : '');
    if (tax !== '') cells.push(i <= taxRows ? `${i}.25` : '');
    rows.push(cells.join(','));
  }
  return `${[head.join(','), ...rows].join('\n')}\n`;
};

// C1: exactly one ask, naming the column and the true count
test('a word that is not a column asks once, naming the one column with numbers and its true count', () => {
  const r = findColumn(sheet(40, 40, 10), 'Price');
  assert.deepEqual(r, { kind: 'ask', column: 'Amount', numbers: 40, rows: 40 });
  assert.equal(columnQuestion('Price', r, 1), `no column 'Price'; 'Amount' has numbers in 40 of 40 rows. Use it? Answer "agree", or type your own words (your answer is added as a new ~ rule on line 1).`);
});

// C2: a decoy never wins; two columns that fit equally offer nothing
test('a column with numbers in only a few rows and a text column are not offered', () => {
  const r = findColumn(sheet(40, 40, 10), 'Price');
  assert.equal(r.kind === 'ask' && r.column, 'Amount');
});
test('two columns that fit equally: no ask, both named', () => {
  const r = findColumn(sheet(40, 40, 40), 'Price');
  assert.deepEqual(r, { kind: 'tie', columns: ['Amount', 'Tax'], rows: 40 });
});

// C3: nothing fits -> no ask, a reason
test('no column with numbers: no ask, the rows counted', () => {
  const r = findColumn(sheet(40, 0, 10, { amount: '' }), 'Price');
  assert.deepEqual(r, { kind: 'none', rows: 40 });
});

// C4: the count shown is the true count, not the row total
test('numbers in 39 of 40 rows says 39 of 40', () => {
  const r = findColumn(sheet(40, 39, 0), 'Price');
  assert.equal(columnQuestion('Price', r, 3), `no column 'Price'; 'Amount' has numbers in 39 of 40 rows. Use it? Answer "agree", or type your own words (your answer is added as a new ~ rule on line 3).`);
});

test('the word that IS a header (any case, spaces around) is kept as that header: nothing to ask', () => {
  assert.deepEqual(findColumn(sheet(5, 5, 5), ' amount '), { kind: 'header', column: 'Amount' });
});

test('a column that fills less than FIT_RATIO of the rows is not offered (35 of 40 is under 0.9)', () => {
  assert.equal(FIT_RATIO, 0.9);
  assert.deepEqual(findColumn(sheet(40, 35, 0), 'Price'), { kind: 'none', rows: 40 });
  assert.equal(findColumn(sheet(40, 36, 0), 'Price').kind, 'ask'); // 36 of 40 = 0.9
});

test('dates, words and n/a are not numbers; signs, thousands commas and decimals are', () => {
  const text = 'When,Note,Value\n2026-09-01,n/a,1200.5\n2026-09-02,x,-3\n2026-09-03,y,4\n';
  assert.deepEqual(findColumn(text, 'Price'), { kind: 'ask', column: 'Value', numbers: 3, rows: 3 });
});

test('no data rows: nothing fits', () => {
  assert.deepEqual(findColumn('Date,Amount\n', 'Price'), { kind: 'none', rows: 0 });
});
