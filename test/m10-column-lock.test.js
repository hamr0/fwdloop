// M10 am8 item 2: the column is locked. Each fact from a sheet names its column in the step's check (close.columns, written by the drafter); code checks at $0
// that it is a real column (and the agreed one when there was an ask) and, at run time, that every cited cell is from that column. $0, synthetic sheet.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { closeByClass } from '../src/closers.js';
import { parseCsv } from '../src/csv.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';

const SHEET = parseCsv('Date,Description,Amount,Tax\n2026-09-01,rent,429.34,5.70\n2026-09-02,beans,817.68,3.21\n');
const reads = { aging: { kind: 'cells', ...SHEET } };
const step = (columns) => ({ close: { class: 'green', ...(columns === undefined ? {} : { columns }) } });
const art = (cite, value) => ({ fields: { total: { value, cite } } });
const ctx = { reads, businessDate: '2026-10-11' };
const LOCK = [{ source: 'aging', column: 'Amount' }];
// M10b piece 5: a green step that reads a CSV now carries close.sheet (the old cell cite no longer drafts), so each close these declaration tests expect to pass has one
const CLAIMS = [{ id: 'n', rule: 'cells', table: 'aging', claim: 'n', op: 'count', column: 'Amount', covers: [] }];

test('a cell from the locked column is green; with no lock a cell from any column is green, as today', async () => {
  assert.equal((await closeByClass(step(LOCK), art('aging!C2', 429.34), ctx)).verdict, 'green');
  assert.equal((await closeByClass(step(), art('aging!D2', 5.7), ctx)).verdict, 'green');
});

// must fail (signed): a cell from another column is red, naming the column
test('a cell from another column is red, naming that column and the locked one', async () => {
  const r = await closeByClass(step(LOCK), art('aging!D2', 5.7), ctx);
  assert.equal(r.verdict, 'red');
  assert.match(r.red, /aging!D2/);
  assert.match(r.red, /column 'Tax'/);
  assert.match(r.red, /locked to column 'Amount'/);
});

test('a formula whose argument is from another column is red too; a #field reference is not a cell', async () => {
  const r = await closeByClass(step(LOCK), art('sum(aging!C2,aging!D3)', 1), ctx);
  assert.equal(r.verdict, 'red');
  assert.match(r.red, /column 'Tax'/);
  const ok = await closeByClass(step(LOCK), { fields: { a: { value: 429.34, cite: 'aging!C2' }, b: { value: 429.34, cite: '#a' } } }, ctx);
  assert.equal(ok.verdict, 'green');
});

test('several locked columns allow each of them; a lock on another source does not touch this one', async () => {
  const two = [{ source: 'aging', column: 'Amount' }, { source: 'aging', column: 'Tax' }];
  assert.equal((await closeByClass(step(two), art('sum(aging!C2,aging!D2)', 429.34 + 5.7), ctx)).verdict, 'green');
  assert.equal((await closeByClass(step([{ source: 'other', column: 'X' }]), art('aging!B2', 'rent'), ctx)).verdict, 'green');
});

// ---- the declaration at $0 ----
const HERE = path.dirname(fileURLToPath(import.meta.url));
const prose = readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8');
const parsed = parseSignedText(prose);
const cat = loadCatalogue();
const base = () => {
  const d = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
  d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment'];
  return d;
};
const sheetWords = { headers: { aging: SHEET.header }, facts: [{ line: 2, source: 'aging', column: 'Amount', shape: 'column' }] };
const check = (d, extra = {}) => validateDeclaration(d, { arbiter: parsed.arbiter, lines: parsed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true, ...extra });

test('declaration: columns is a green step\'s list of {source, column}; any other shape is refused', () => {
  const d = base(); d.steps[1].close = { class: 'green', columns: LOCK, sheet: CLAIMS };
  assert.equal(check(d).ok, true, JSON.stringify(check(d).reds));
  for (const bad of ['Amount', [], [{ source: 'aging' }], [{ source: 'aging', column: '' }], [{ source: 'aging', column: 'Amount', x: 1 }], [{ source: 'nope', column: 'Amount' }]]) {
    const e = base(); e.steps[1].close = { class: 'green', columns: bad };
    assert.equal(check(e).ok, false, JSON.stringify(bad));
  }
  const soft = base(); soft.steps[1].close = { class: 'hitl', columns: LOCK };
  assert.equal(check(soft).ok, false);
});

// must fail (signed): a kept word the sheet does not hold / a column the drafter made up
test('declaration with the sheet: a column that is not a real column is red, naming the line', () => {
  const d = base(); d.steps[1].close = { class: 'green', columns: [{ source: 'aging', column: 'Amount' }, { source: 'aging', column: 'Price' }] };
  const r = check(d, { sheetWords });
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes('line 2') && x.includes("'Price'") && /real column/.test(x)), JSON.stringify(r.reds));
});

test('declaration with the sheet: the column the code kept (an agreed one) must be in the step\'s columns, else red naming the line; a line with no kept fact needs none', () => {
  const missing = base(); missing.steps[1].close = { class: 'green', columns: [{ source: 'aging', column: 'Tax' }] };
  const r = check(missing, { sheetWords });
  assert.ok(r.reds.some((x) => x.includes('line 2') && x.includes("'Amount'")), JSON.stringify(r.reds));
  const none = base(); none.steps[1].close = { class: 'green', sheet: CLAIMS };
  assert.ok(check(none, { sheetWords }).reds.some((x) => x.includes('line 2') && x.includes("'Amount'")));
  assert.equal(check(none, { sheetWords: { headers: sheetWords.headers, facts: [] } }).ok, true);
  const ok = base(); ok.steps[1].close = { class: 'green', columns: LOCK, sheet: CLAIMS };
  assert.equal(check(ok, { sheetWords }).ok, true, JSON.stringify(check(ok, { sheetWords }).reds));
});
