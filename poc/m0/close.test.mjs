import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';
import {
  hashFile, verifyArtifactHash, checkCitation, closeCitations, closeDerive,
  closeCompose, matchingCustomers, daysBetween, parseNumeric,
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

test('PROOF the test can fail: a bracket pointing at a nonexistent citation id is red', () => {
  const output = {
    citations: [{ id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } }],
    text: 'INV-1021 is 4200 [c1] and [c9]',
  };
  const result = closeCompose(output, artifacts, '2026-06-01');
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /\[c9\]/);
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
