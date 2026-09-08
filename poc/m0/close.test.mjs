import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';
import {
  hashFile, verifyArtifactHash, checkCitation, closeCitations, closeDerive,
  closeCompose, matchingCustomers, closeCustomerMatch, daysBetween, parseNumeric,
} from './close.mjs';

const dir = mkdtempSync(join(tmpdir(), 'm0-close-'));
const csvPath = join(dir, 'ar-aging.csv');
const csvText = 'Customer,Invoice #,Invoice date,Due date,Amount\n'
  + 'Northwind Trading,INV-1021,2026-05-10,2026-06-09,4200\n'
  + 'Northwind Trading,INV-1009,2026-04-20,2026-05-20,1500\n';
writeFileSync(csvPath, csvText);
const parsed = parseCsv(csvText);
const csvSha = hashFile(csvPath);
const csvArtifact = { id: 'a1', kind: 'csv', path: csvPath, sha256: csvSha, ...parsed };

const textPath = join(dir, 'message.txt');
writeFileSync(textPath, 'what does Northwind owe and when is it due?\n');
const textSha = hashFile(textPath);
const textArtifact = { id: 'a2', kind: 'text', path: textPath, sha256: textSha, lines: ['what does Northwind owe and when is it due?'] };

const artifacts = { a1: csvArtifact, a2: textArtifact };

test('parseNumeric strips commas/currency and reports source precision', () => {
  assert.deepEqual(parseNumeric('1,250.00'), { value: 1250, decimals: 2 });
  assert.deepEqual(parseNumeric('4200'), { value: 4200, decimals: 0 });
});

test('daysBetween computes whole UTC days', () => {
  assert.equal(daysBetween('2026-06-09', '2026-06-01'), -8);
  assert.equal(daysBetween('2026-05-20', '2026-06-01'), 12);
});

test('a copied citation with the CORRECT value is green', () => {
  const c = { id: 'c1', value: 4200, asStated: '4200', source: { kind: 'csv', artifact: 'a1', cell: 'E2' } };
  const { ok, red } = checkCitation(c, artifacts, { c1: c }, '2026-06-01');
  assert.equal(ok, true);
  assert.equal(red, null);
});

test('PROOF the test can fail: a copied citation with a WRONG value is red, naming the cell (plant b shape)', () => {
  const c = { id: 'c1', value: 4300, asStated: '4300', source: { kind: 'csv', artifact: 'a1', cell: 'E2' } };
  const { ok, red } = checkCitation(c, artifacts, { c1: c }, '2026-06-01');
  assert.equal(ok, false);
  assert.equal(red, 'c1 4300 ≠ cell E2 = 4200');
});

test('a sum derived citation over correct inputs is green', () => {
  const c1 = { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } };
  const c2 = { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } };
  const c3 = { id: 'c3', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] };
  const result = closeCitations([c1, c2, c3], artifacts, '2026-06-01');
  assert.equal(result.verdict, 'green');
});

test('PROOF the test can fail: a planted wrong total is red, naming the figure and formula (plant a)', () => {
  const c1 = { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } };
  const c2 = { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } };
  const c3 = { id: 'c3', value: 5850, formula: 'sum', inputs: ['c1', 'c2'] };
  const result = closeCitations([c1, c2, c3], artifacts, '2026-06-01');
  assert.equal(result.verdict, 'red');
  assert.equal(result.red, 'c3 5850 ≠ sum(E2,E3) = 5700');
});

test('closeDerive re-labels a red with the human field name instead of the opaque citation id', () => {
  const output = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c3', value: 5850, formula: 'sum', inputs: ['c1', 'c2'] },
    ],
    fields: { total: 'c3' },
  };
  const result = closeDerive(output, artifacts, '2026-06-01');
  assert.equal(result.verdict, 'red');
  assert.equal(result.red, 'total 5850 ≠ sum(E2,E3) = 5700');
});

test('closeDerive is green when every figure resolves and no plant is present (clean run)', () => {
  const output = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c3', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
    ],
    fields: { total: 'c3' },
  };
  assert.equal(closeDerive(output, artifacts, '2026-06-01').verdict, 'green');
});

test('a quote citation matching the verbatim line is green; a fabricated quote is red', () => {
  const good = { id: 'q1', quote: 'Northwind', source: { kind: 'text', artifact: 'a2', line: 1 } };
  assert.equal(checkCitation(good, artifacts, {}, '2026-06-01').ok, true);
  const bad = { id: 'q1', quote: 'Acme', source: { kind: 'text', artifact: 'a2', line: 1 } };
  const { ok, red } = checkCitation(bad, artifacts, {}, '2026-06-01');
  assert.equal(ok, false);
  assert.match(red, /not a verbatim substring/);
});

test('input drift: a re-hashed artifact that no longer matches its recorded sha256 is red', () => {
  const driftedPath = join(dir, 'drift.csv');
  writeFileSync(driftedPath, csvText);
  const driftedArtifact = { id: 'a3', kind: 'csv', path: driftedPath, sha256: 'deadbeef', ...parsed };
  const c = { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a3', cell: 'E2' } };
  const { ok, red } = checkCitation(c, { a3: driftedArtifact }, { c1: c }, '2026-06-01');
  assert.equal(ok, false);
  assert.match(red, /input drift/);
  assert.equal(verifyArtifactHash(driftedArtifact).ok, false);
});

test('daysBetween derived citation recomputes against businessDate, not the wall clock', () => {
  const due = { id: 'd1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } };
  const overdue = { id: 'd2', value: -8, formula: 'daysBetween', inputs: ['d1'] };
  const result = closeCitations([due, overdue], artifacts, '2026-06-01');
  assert.equal(result.verdict, 'green');
});

test('PROOF: a wrong daysBetween value is red', () => {
  const due = { id: 'd1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } };
  const overdue = { id: 'd2', value: 8, formula: 'daysBetween', inputs: ['d1'] };
  const result = closeCitations([due, overdue], artifacts, '2026-06-01');
  assert.equal(result.verdict, 'red');
});

test('compose close: every bracketed id resolves and no bare uncited number survives', () => {
  const output = {
    citations: [{ id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } }],
    text: 'INV-1021 is 4200 [c1]',
  };
  assert.equal(closeCompose(output, artifacts, '2026-06-01').verdict, 'green');
});

test('PROOF the test can fail: a bare number outside any citation bracket is red', () => {
  const output = {
    citations: [{ id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } }],
    text: 'INV-1021 is 4200 [c1], also owes 99',
  };
  const result = closeCompose(output, artifacts, '2026-06-01');
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /bare \(uncited\) number/);
});

test('compose close: a bracketed ISO date (YYYY-MM-DD [cN]) is not a false-positive bare number '
  + '(regression: the plain-number cleanup regex stops at the first hyphen and leaves "2026-06-" behind)', () => {
  const output = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c3', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
    ],
    text: 'INV-1021 is 4200 [c1], due 2026-06-09 [c3]',
  };
  const result = closeCompose(output, artifacts, '2026-06-01');
  assert.equal(result.verdict, 'green');
});

test('PROOF the test can fail: a bracket pointing at a nonexistent citation id is red', () => {
  const output = {
    citations: [{ id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } }],
    text: 'INV-1021 is 4200 [c1] and [c9]',
  };
  const result = closeCompose(output, artifacts, '2026-06-01');
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /\[c9\]/);
});

// --- compose completeness: every field the prior derive step declared must
// appear, cited, in the composed text (the gpt-oss-120b hole: 3/3 green on
// evidence alone by omitting total/earliest-due/overdue-count entirely). ---

const derive2Fields = { total_owed: 'c7', earliest_due: 'c8', count_overdue: 'c9' };
const derive2Citations = [
  { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
  { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
  { id: 'c3', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
  { id: 'c4', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
  { id: 'c7', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
  { id: 'c8', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
  { id: 'd1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
  { id: 'c9', value: 1, formula: 'count', inputs: ['e1'] },
  { id: 'e1', value: -8, formula: 'daysBetween', inputs: ['d1'] },
];

test('PROOF the test can fail (RED before the fix, per the brief): gpt-oss-120b\'s exact '
  + 'text — evidence-clean but omits total/earliest-due/overdue-count entirely — is red, '
  + 'naming a missing declared field', () => {
  const output = {
    citations: [
      { id: 'c_amt1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c_due1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
      { id: 'c_amt2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c_due2', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
    ],
    text: 'INV-1: 4200[c_amt1] due 2026-06-09[c_due1]\nINV-2: 1500[c_amt2] due 2026-05-20[c_due2]',
  };
  const result = closeCompose(output, artifacts, '2026-06-01', derive2Fields, derive2Citations);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /compose: declared field/);
  assert.match(result.red, /"total_owed"|"earliest_due"|"count_overdue"/);
});

test('compose completeness: gpt-oss-120b\'s exact text is GREEN when no fields were declared '
  + '(pre-fix behavior preserved — completeness is opt-in via the new parameter, not a change '
  + 'to the existing evidence/bracket/bare-number gates)', () => {
  const output = {
    citations: [
      { id: 'c_amt1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c_due1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
      { id: 'c_amt2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c_due2', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
    ],
    text: 'INV-1: 4200[c_amt1] due 2026-06-09[c_due1]\nINV-2: 1500[c_amt2] due 2026-05-20[c_due2]',
  };
  assert.equal(closeCompose(output, artifacts, '2026-06-01').verdict, 'green');
});

test('compose completeness: Qwen run3\'s exact text stays GREEN, including earliest_due cited '
  + 'under a DIFFERENT citation id (c4) than derive2 originally assigned (c8) — a model may '
  + 'legitimately re-cite the same resolved value under a new id', () => {
  const output = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c3', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
      { id: 'c4', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
      { id: 'c7', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
      { id: 'd1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
      { id: 'c8', value: 1, formula: 'count', inputs: ['e1'] },
      { id: 'e1', value: -8, formula: 'daysBetween', inputs: ['d1'] },
    ],
    text: '- 4200[c1] due 2026-06-09[c3]\n- 1500[c2] due 2026-05-20[c4]\n'
      + '- Total owed: 5700[c7], earliest due 2026-05-20[c4], 1[c8] invoice overdue',
  };
  // derive2 declared earliest_due -> c8 in THIS test's fixture (derive2Fields), but Qwen's
  // compose citations reuse c8 for count_overdue and re-cite the earliest-due VALUE under c4
  // instead (the id derive2 assigned to earliest_due never appears in compose's own array at
  // all — it was legitimately dropped as a redundant duplicate of the invoice-2 due-date cell).
  const result = closeCompose(output, artifacts, '2026-06-01', derive2Fields, derive2Citations);
  assert.equal(result.verdict, 'green');
});

test('compose completeness: all three declared fields present and cited — green', () => {
  const output = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c7', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
      { id: 'c8', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
      { id: 'd1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
      { id: 'c9', value: 1, formula: 'count', inputs: ['e1'] },
      { id: 'e1', value: -8, formula: 'daysBetween', inputs: ['d1'] },
    ],
    text: 'Total owed: 5700[c7], earliest due 2026-05-20[c8], 1[c9] invoice overdue',
  };
  const result = closeCompose(output, artifacts, '2026-06-01', derive2Fields, derive2Citations);
  assert.equal(result.verdict, 'green');
});

test('compose completeness: PROOF the test can fail — removing "total_owed" alone (c7\'s '
  + 'bracket + its equal-value fallback) turns green red, naming exactly that field', () => {
  const output = {
    citations: [
      { id: 'c8', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
      { id: 'd1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
      { id: 'c9', value: 1, formula: 'count', inputs: ['e1'] },
      { id: 'e1', value: -8, formula: 'daysBetween', inputs: ['d1'] },
    ],
    text: 'Earliest due 2026-05-20[c8], 1[c9] invoice overdue',
  };
  const result = closeCompose(output, artifacts, '2026-06-01', derive2Fields, derive2Citations);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /"total_owed"/);
});

test('compose completeness: PROOF the test can fail — removing "earliest_due" alone turns '
  + 'green red, naming exactly that field', () => {
  const output = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c7', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
      { id: 'd1', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
      { id: 'c9', value: 1, formula: 'count', inputs: ['e1'] },
      { id: 'e1', value: -8, formula: 'daysBetween', inputs: ['d1'] },
    ],
    text: 'Total owed: 5700[c7], 1[c9] invoice overdue',
  };
  const result = closeCompose(output, artifacts, '2026-06-01', derive2Fields, derive2Citations);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /"earliest_due"/);
});

test('compose completeness: PROOF the test can fail — removing "count_overdue" alone turns '
  + 'green red, naming exactly that field', () => {
  const output = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c7', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
      { id: 'c8', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
    ],
    text: 'Total owed: 5700[c7], earliest due 2026-05-20[c8]',
  };
  const result = closeCompose(output, artifacts, '2026-06-01', derive2Fields, derive2Citations);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /"count_overdue"/);
});

test('matchingCustomers: a single unambiguous name match', () => {
  assert.deepEqual(matchingCustomers('Northwind', csvArtifact), ['Northwind Trading']);
});

test('matchingCustomers: two distinct customers matching (plant c) is detected mechanically, from the artifact', () => {
  const ambiguousText = csvText + 'Northwind Supplies,INV-1050,2026-06-01,2026-07-01,300\n';
  const ambiguousParsed = parseCsv(ambiguousText);
  const ambiguousPath = join(dir, 'ar-aging.plant-c.csv');
  writeFileSync(ambiguousPath, ambiguousText);
  const ambiguousArtifact = { id: 'a4', kind: 'csv', path: ambiguousPath, sha256: hashFile(ambiguousPath), ...ambiguousParsed };
  const matches = matchingCustomers('Northwind', ambiguousArtifact);
  assert.equal(matches.length, 2);
  assert.deepEqual(matches.sort(), ['Northwind Supplies', 'Northwind Trading']);
});

// --- closeCustomerMatch: PRD §5 "two rows matching is an ask, never a pick" ---
// (item 4's "test that path with a hand-made artifact first", ahead of wiring the runner.)

const ambiguousText = csvText + 'Northwind Supplies,INV-1050,2026-06-01,2026-07-01,300\n';
const ambiguousParsed = parseCsv(ambiguousText);
const ambiguousPath = join(dir, 'ar-aging.plant-c-close-test.csv');
writeFileSync(ambiguousPath, ambiguousText);
const ambiguousArtifact = { id: 'a3', kind: 'csv', path: ambiguousPath, sha256: hashFile(ambiguousPath), ...ambiguousParsed };
const artifactsWithAmbiguous = { a1: csvArtifact, a2: textArtifact, a3: ambiguousArtifact };

test('closeCustomerMatch: a single unambiguous match, correctly cited, is green', () => {
  const output = {
    citations: [
      { id: 'q1', quote: 'Northwind', source: { kind: 'text', artifact: 'a2', line: 1 } },
      { id: 'c1', value: 'Northwind Trading', asStated: 'Northwind Trading', source: { kind: 'csv', artifact: 'a1', cell: 'A2' } },
    ],
    matches: ['c1'],
  };
  const result = closeCustomerMatch(output, artifacts, 'a1');
  assert.equal(result.verdict, 'green');
  assert.equal(result.ambiguous, false);
  assert.equal(result.matchedCustomer, 'Northwind Trading');
});

test('closeCustomerMatch: two customers really match and the model correctly cites both — green, flagged ambiguous (plant c, happy path)', () => {
  const output = {
    citations: [
      { id: 'q1', quote: 'Northwind', source: { kind: 'text', artifact: 'a2', line: 1 } },
      { id: 'c1', value: 'Northwind Trading', asStated: 'Northwind Trading', source: { kind: 'csv', artifact: 'a3', cell: 'A2' } },
      { id: 'c2', value: 'Northwind Supplies', asStated: 'Northwind Supplies', source: { kind: 'csv', artifact: 'a3', cell: 'A4' } },
    ],
    matches: ['c1', 'c2'],
  };
  const result = closeCustomerMatch(output, artifactsWithAmbiguous, 'a3');
  assert.equal(result.verdict, 'green');
  assert.equal(result.ambiguous, true);
  assert.deepEqual(result.groundTruthMatches.sort(), ['Northwind Supplies', 'Northwind Trading']);
});

test('PROOF the test can fail: two customers really match but the model picks only ONE — red, never a silent pick (plant c, the case the close must catch)', () => {
  const output = {
    citations: [
      { id: 'q1', quote: 'Northwind', source: { kind: 'text', artifact: 'a2', line: 1 } },
      { id: 'c1', value: 'Northwind Trading', asStated: 'Northwind Trading', source: { kind: 'csv', artifact: 'a3', cell: 'A2' } },
    ],
    matches: ['c1'],
  };
  const result = closeCustomerMatch(output, artifactsWithAmbiguous, 'a3');
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /2 customer\(s\) match "Northwind"/);
  assert.match(result.red, /never a pick/);
});

test('PROOF the test can fail: a quote that matches nothing in the sheet is red', () => {
  const output = {
    citations: [
      // "does" is a verbatim substring of the message (so the quote citation itself is
      // green) but matches no Customer cell — the no-match path, not the bad-quote path.
      { id: 'q1', quote: 'does', source: { kind: 'text', artifact: 'a2', line: 1 } },
    ],
    matches: [],
  };
  const result = closeCustomerMatch(output, artifacts, 'a1');
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /matches no customer/);
});
