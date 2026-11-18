// M15 am3 item 4 and am3a: Count and Total are code's, from the rows of the line's `rows` check with the same `where`, by bareloop v0.60.0's strict number test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sheetTotalLines } from '../src/sheetclaims.js';

const where = [{ column: 'Amount', cmp: 'gt', value: 500 }];
const checks = (over = {}) => [
  { id: 'rows', rule: 'cells', table: 't', op: 'rows', claim: 'r', where },
  { id: 'count', rule: 'cells', table: 't', op: 'countIf', claim: 'n', where },
  { id: 'total', rule: 'cells', table: 't', op: 'sumIf', claim: 'v', column: 'Amount', where, ...over },
];
const tableOf = (cells) => ({ t: { header: ['Amount'], rows: cells.map((c, i) => ({ rowNumber: i + 2, cells: [c] })) } });
const claimsOf = (cells) => ({ r: { rows: cells.map((_, i) => i + 2) }, n: { value: 999 }, v: { value: 123456 } });
const totalOf = (cells) => sheetTotalLines(checks(), claimsOf(cells), tableOf(cells)).find((l) => l.startsWith('Total'));

test('the rows come from the rows check of the same where, in fwd\'s separate boxes; the AI\'s count and total are never read', () => {
  const out = sheetTotalLines(checks(), claimsOf(['600', '1,200.50']), tableOf(['600', '1,200.50']));
  assert.deepEqual(out, ['Count of rows 2, 3: 2 (computed by code from the rows named)', 'Total of rows 2, 3: 1,800.50 (computed by code from the rows named)']);
});
test('rows from a check with a different where are not used: no Count and no Total', () => {
  const other = checks().map((c) => (c.op === 'rows' ? { ...c, where: [{ column: 'Amount', cmp: 'gt', value: 100 }] } : c));
  assert.deepEqual(sheetTotalLines(other, claimsOf(['600']), tableOf(['600'])), []);
});
test('no rows check on the line: neither line', () => {
  assert.deepEqual(sheetTotalLines(checks().filter((c) => c.op !== 'rows'), claimsOf(['600']), tableOf(['600'])), []);
});
test('a sumIf\'s own box holding rows is not read either (only the rows check)', () => {
  const noRows = checks().filter((c) => c.op !== 'rows');
  assert.deepEqual(sheetTotalLines(noRows, { n: { rows: [2] }, v: { rows: [2] } }, tableOf(['600'])), []);
});
test('F356 strict number: 12,50, 1e3 and 0x10 are not numbers', () => {
  for (const c of ['12,50', '1e3', '0x10']) assert.match(totalOf([c]), /^Total of rows 2: not computed \(row 2 has no number in the column "Amount"\)/, c);
});
test('F356: thousands groups sum, a blank cell is skipped', () => {
  assert.equal(totalOf(['1,234.50', ' 10 ', '']), 'Total of rows 2, 3, 4: 1,244.50 (computed by code from the rows named)');
});
test('a row the table does not have adds nothing; no rows left reads "no rows"', () => {
  const out = sheetTotalLines(checks(), { r: { rows: [40] } }, tableOf(['600']));
  assert.deepEqual(out, ['Count of no rows: 0 (computed by code from the rows named)', 'Total of no rows: 0 (computed by code from the rows named)']);
});
