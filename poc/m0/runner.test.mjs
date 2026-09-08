import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';
import { hashFile } from './close.mjs';
import {
  renderCsvArtifact, renderTextArtifact, generatePlantCCsv, applyPlant, BUSINESS_DATE,
} from './runner.mjs';

test('BUSINESS_DATE is the fixed run date, never the wall clock', () => {
  assert.equal(BUSINESS_DATE, '2026-06-01');
});

test('renderCsvArtifact: rows carry row numbers and column letters, matching the brief', () => {
  const text = 'Customer,Amount\nAcme,100\n';
  const parsed = parseCsv(text);
  const artifact = { id: 'a1', sha256: 'deadbeef', ...parsed };
  const rendered = renderCsvArtifact(artifact);
  assert.match(rendered, /Row 2: A=Acme B=100/);
  assert.match(rendered, /A=Customer B=Amount/);
});

test('renderTextArtifact: lines are 1-based numbered', () => {
  const artifact = { id: 'a2', sha256: 'deadbeef', lines: ['hello', 'world'] };
  const rendered = renderTextArtifact(artifact);
  assert.match(rendered, /Line 1: hello/);
  assert.match(rendered, /Line 2: world/);
});

test('PROOF the test can fail: generatePlantCCsv appends exactly the declared row, from the real fixture, not hand-edited', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-plantc-'));
  const sourcePath = join(dir, 'ar-aging.csv');
  writeFileSync(sourcePath, 'Customer,Invoice #,Invoice date,Due date,Amount,Days overdue,Current,1-30,31-60,61-90,90+\r\n'
    + 'Northwind Trading,INV-1021,2026-05-10,2026-06-09,4200,,,,,,\r\n');
  const destPath = join(dir, 'ar-aging.plant-c.csv');
  generatePlantCCsv(sourcePath, destPath);
  const written = readFileSync(destPath, 'utf8');
  assert.match(written, /Northwind Supplies,INV-1050,2026-06-01,2026-07-01,300,,,,,,\r\n$/);
  const parsed = parseCsv(written);
  assert.equal(parsed.rows.length, 2);
  const matches = parsed.rows.filter((r) => r.byName.Customer.toLowerCase().includes('northwind'));
  assert.equal(matches.length, 2);
});

test('generatePlantCCsv against the REAL fixture produces the ambiguous set from fixtures/README.md', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-plantc-real-'));
  const destPath = join(dir, 'ar-aging.plant-c.csv');
  const fixturePath = join(process.cwd(), 'fixtures', 'ar-aging.csv');
  generatePlantCCsv(fixturePath, destPath);
  const parsed = parseCsv(readFileSync(destPath, 'utf8'));
  assert.equal(parsed.rows.length, 9); // 8 real invoices + 1 planted
  const names = parsed.rows.map((r) => r.byName.Customer);
  assert.ok(names.includes('Northwind Supplies'));
  const uniqueNorthwindNames = new Set(names.filter((n) => n.toLowerCase().includes('northwind')));
  assert.deepEqual([...uniqueNorthwindNames].sort(), ['Northwind Supplies', 'Northwind Trading']);
});

test('applyPlant a: sets the sum-formula citation value to 5850, leaving copied citations untouched', () => {
  const args = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
      { id: 'c3', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
    ],
    fields: { total_owed: 'c3' },
  };
  const mutated = applyPlant('a', 'derive2', args);
  assert.equal(mutated.citations.find((c) => c.id === 'c3').value, 5850);
  assert.equal(mutated.citations.find((c) => c.id === 'c1').value, 4200);
  // the original captured args must never be mutated in place — the runner reports both.
  assert.equal(args.citations.find((c) => c.id === 'c3').value, 5700);
});

test('applyPlant b: sets the E2 copied citation value to 4300', () => {
  const args = {
    citations: [
      { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
      { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
    ],
    fields: {},
  };
  const mutated = applyPlant('b', 'derive2', args);
  assert.equal(mutated.citations.find((c) => c.source?.cell === 'E2').value, 4300);
  assert.equal(args.citations.find((c) => c.source?.cell === 'E2').value, 4200);
});

test('PROOF the test can fail: applyPlant d (clean) and applyPlant on a different step are no-ops', () => {
  const args = { citations: [{ id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } }], fields: {} };
  assert.deepEqual(applyPlant('d', 'derive2', args), args);
  assert.deepEqual(applyPlant('a', 'compose', args), args);
});
