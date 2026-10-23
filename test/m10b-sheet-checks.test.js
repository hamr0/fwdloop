// M10b piece 1: a signed sheet check lives in the step's close (`close.sheet`, a list of bareguard cells / table checks) and passes bareguard's sign-time test
// at $0 over the drafting copy's table. $0, synthetic fixtures (test/fixtures/m10b-sheets, test/fixtures/m4d-am8.*).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv, sheetTable } from '../src/csv.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import { checkedLines } from '../src/checked.js';
import { buildReadout, specHash } from '../src/authoring.js';
import { sheetCheckSentence, sheetCheckRows } from '../src/sheetchecks.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
// piece 3: a number in a check must be in the person's words on the line, so the line says the 500 the checks use
const parsed = parseSignedText(fx('m4d-am8.aging.signed.txt').replace('exactly once', 'exactly once; amounts over 500 are flagged'));
const cat = loadCatalogue();
const AGING = fx('m10b-sheets/aging.csv');
const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
const CHECKS = () => [
  { id: 'over', rule: 'cells', table: 'aging', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] },
  { id: 'bands', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, bands: BANDS },
  { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #' },
];
const base = (sheet) => {
  const d = JSON.parse(fx('m4d-am8.aging.declaration.json'));
  d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment'];
  if (sheet !== undefined) d.steps[1].close = { class: 'green', sheet };
  return d;
};
const tablesOf = (csv = AGING) => ({ aging: sheetTable(parseCsv(csv)) });
const check = (d, tables = tablesOf()) => validateDeclaration(d, {
  arbiter: parsed.arbiter, lines: parsed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
  sheetWords: { headers: { aging: parseCsv(AGING).header }, facts: [], tables },
});
const redsOf = (sheet, tables) => check(base(sheet), tables).reds.join('\n');

test('valid sheet checks sign (rows, band, noDuplicates over the real header), and a draft with no close.sheet is unchanged', () => {
  const r = check(base(CHECKS()));
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(check(base()).ok, true);
});

test('a column that is no header of the sheet is refused, naming the line and the column', () => {
  const c = CHECKS(); c[0].where[0].column = 'Total';
  const r = redsOf(c);
  assert.match(r, /line 2: 'Total' is not a real column of "aging"/);
  const n = CHECKS(); n[2].column = 'Invoice';
  assert.match(redsOf(n), /line 2: 'Invoice' is not a real column/);
  const d = CHECKS(); d[1].dateFormats = [{ column: 'Due', format: 'YYYY-MM-DD' }];
  assert.match(redsOf(d), /line 2: 'Due' is not a real column/);
});

test('overlapping bands are refused by bareguard, naming the line', () => {
  const c = CHECKS(); c[1].bands = [{ name: 'Current', lte: 10 }, { name: '1-30', gte: 5, lte: 30 }, { name: '90+', gt: 30 }];
  const r = redsOf(c);
  assert.match(r, /line 2: bareguard refuses the sheet check 'bands'/);
  assert.match(r, /overlap/i);
});

test('a tolerance on countIf is refused by bareguard, naming the line and the check', () => {
  const c = [{ id: 'n', rule: 'cells', table: 'aging', claim: 'n', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], tolerance: 1 }];
  assert.match(redsOf(c), /line 2: bareguard refuses the sheet check 'n'/);
});

test('a sheet bareguard cannot read as a table (a ragged row) is refused, naming the line and the sheet', () => {
  const ragged = `${AGING}INV-999,Customer 9,2026-03-01\n`;
  assert.match(redsOf(CHECKS(), tablesOf(ragged)), /line 2: bareguard cannot read "aging" as a table/);
});

test('shape: a green step only, a signed sheet input the step reads, a list of 1 to 20 check objects, no arbiter word', () => {
  assert.match(redsOf([]), /close\.sheet must be a list of 1 to 20/);
  assert.match(redsOf(['x']), /close\.sheet\[0\] must be a check object/);
  const other = CHECKS(); other[0].table = 'nope';
  assert.match(redsOf(other), /\.table "nope" is not a signed spreadsheet input/);
  const rule = CHECKS(); rule[0].rule = 'diff';
  assert.match(redsOf(rule), /\.rule must be one of cells, table/);
  const arb = CHECKS(); arb[0].send = 'x';
  assert.match(redsOf(arb), /arbiter field "send"/);
  const soft = base(CHECKS()); soft.steps[1].close = { class: 'softgreen', shape: { maxWords: 5 }, sheet: CHECKS() };
  assert.match(check(soft).reds.join('\n'), /close\.sheet is for a green step only/);
});

test('the spec hash changes when one sheet check changes', () => {
  const hashOf = (sheet) => specHash({
    proseText: 'p', declarationText: JSON.stringify(base(sheet)), inputFactsText: '{}', readoutText: 'r', targetText: '{}',
  }).hash;
  const a = hashOf(CHECKS());
  const c = CHECKS(); c[0].where[0].value = 501;
  assert.notEqual(hashOf(c), a);
  assert.equal(hashOf(CHECKS()), a);
});

test('each check reads as its own plain row, from one function, on the Checked list and in the readout', () => {
  assert.equal(sheetCheckSentence(CHECKS()[0]), 'rows where Amount > 500');
  assert.equal(sheetCheckSentence(CHECKS()[1]), 'band on Due date as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+');
  assert.equal(sheetCheckSentence(CHECKS()[2]), 'no duplicate Invoice #');
  assert.deepEqual(sheetCheckRows(CHECKS()), ['rows where Amount > 500', 'band on Due date as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+', 'no duplicate Invoice #']);
  const d = base(CHECKS());
  const rows = checkedLines(d, { hasAsk: true }).find((l) => l.line === 2).sentences;
  assert.ok(rows.includes('no duplicate Invoice #') && rows.includes('rows where Amount > 500'));
  const text = buildReadout({ declaration: d, arbiter: parsed.arbiter, lines: parsed.lines, name: 'x', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, root: 'r' });
  assert.match(text, /\n {5}sheet check: no duplicate Invoice #\n/);
  assert.match(text, /\n {5}sheet check: rows \u2014 rows where Amount > 500\n/, 'M10b piece 4: the readout row is the block\'s `name \u2014 words`');
});
