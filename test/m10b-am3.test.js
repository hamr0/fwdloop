// M10b am3: the column lock follows the sheet checks. A job word that matches a header (the aging buckets Current, 1-30, ...) does nothing by itself for a step with
// close.sheet; a column the person AGREED to in a column ask must be used by one of the line's checks. A step with no close.sheet keeps the old kept-column red. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from '../src/csv.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const SHEET = parseCsv(readFileSync(path.join(ROOT, 'fixtures', 'ar-aging.csv'), 'utf8'));
const parsed = parseSignedText(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8'));
const cat = loadCatalogue();
const base = () => {
  const d = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
  d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment'];
  return d;
};
const check = (d, extra = {}) => validateDeclaration(d, { arbiter: parsed.arbiter, lines: parsed.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true, ...extra });
const DF = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
// the live rejected plan's checks (draft d-00mvkmbx5j-a98a): band over 'Due date', daysSince, noDuplicates on 'Invoice #'
const LIVE = [
  { id: 'buckets', rule: 'cells', table: 'aging', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: DF, claim: 'bucketByInvoice', covers: [],
    bands: [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }] },
  { id: 'days', rule: 'cells', table: 'aging', op: 'daysSince', column: 'Due date', asOf: '2026-10-11', dateFormats: DF, claim: 'daysPastDueByInvoice', covers: [] },
  { id: 'dups', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #', covers: [1] },
];
// the sheet look keeps the bucket names as column facts for line 2 (they are headers of the aging sheet)
const bucketFacts = ['Current', '1-30', '31-60', '61-90', '90+'].map((column) => ({ line: 2, source: 'aging', column, shape: 'column' }));
const sheetWords = (facts) => ({ headers: { aging: SHEET.header }, facts });
// a column ask the person answered writes this ~ rule on the line
const agreedLines = (column) => parsed.lines.map((l) => (l.n === 2 ? { ...l, rules: [l.guardrail, `use the column '${column}' for 'overdue'`] } : l));

test('am3: the live plan (bucket names are headers, close.sheet present) passes with no close.columns for the buckets', () => {
  const d = base(); d.steps[1].close = { class: 'green', sheet: LIVE };
  const r = check(d, { sheetWords: sheetWords(bucketFacts) });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
});

test('am3: an agreed column no sheet check uses is refused, naming the line and the column; used by a check (any column field), it passes', () => {
  const d = base(); d.steps[1].close = { class: 'green', sheet: LIVE };
  const facts = sheetWords([{ line: 2, source: 'aging', column: 'Amount', shape: 'column' }]);
  const bad = check(d, { sheetWords: facts, lines: agreedLines('Amount') });
  assert.equal(bad.ok, false);
  assert.ok(bad.reds.some((x) => x.includes('line 2') && x.includes("'Amount'")), JSON.stringify(bad.reds));
  // not agreed (a plain header match): no red
  assert.equal(check(d, { sheetWords: facts }).ok, true);
  // used as the check's own column
  const own = base(); own.steps[1].close = { class: 'green', sheet: [...LIVE, { id: 'n', rule: 'cells', table: 'aging', op: 'count', column: 'Amount', claim: 'n', covers: [] }] };
  assert.equal(check(own, { sheetWords: facts, lines: agreedLines('Amount') }).ok, true);
  // used only in a where condition
  const wh = base(); wh.steps[1].close = { class: 'green', sheet: [...LIVE, { id: 'n', rule: 'cells', table: 'aging', op: 'count', column: 'Invoice #', where: [{ column: 'Amount', op: 'gt', value: 0 }], claim: 'n', covers: [] }] };
  const w = check(wh, { sheetWords: facts, lines: agreedLines('Amount') });
  assert.ok(!(w.reds ?? []).some((x) => x.includes("'Amount'") && x.includes('agreed')), JSON.stringify(w.reds));
});

test('am3: a step with no close.sheet keeps the old kept-column red', () => {
  const d = base(); d.steps[1].close = { class: 'green', columns: [{ source: 'aging', column: 'Amount' }] };
  const r = check(d, { sheetWords: sheetWords(bucketFacts) });
  assert.ok(r.reds.some((x) => x.includes('line 2') && x.includes("'Current'") && x.includes('close.columns')), JSON.stringify(r.reds));
});
