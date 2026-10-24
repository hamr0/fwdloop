// M8b piece 3: `line-checks.json`, one file for what were cited-checks.json and sheet-checks.json, two sections (`cited`, `sheet`); same writers' keys (line, and line + try),
// same write (temporary file, then rename). $0, in-process, mkdtemp.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { LINE_CHECKS_FILE, readLineSection, writeLineSection } from '../src/line-checks.js';
import { writeCitedLine } from '../src/cited-record.js';
import { writeSheetLine, readSheetChecks } from '../src/sheet-record.js';
import { readCitedChecks } from '../src/panel/result.js';

const dirs = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-m8b-lc-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });

const citedLine = (n, passed = true) => ({
  n, source: 'jd', passed, facts: [{ name: 'price', kind: 'value', sentence: 'the price' }], rows: [{ n: 1, quote: 'q', cells: ['1'] }], notChecked: [],
});
const sheetClosed = (verdict = 'green') => ({ verdict, red: verdict === 'green' ? null : 'wrong', sheetRecord: { inputs: [{ name: 'aging', sha256: 'a'.repeat(64) }], claims: { x: 1 }, checks: [{ id: 'c1', text: 't', ok: verdict === 'green', result: null }] } });

test('the cited and the sheet writers share ONE file; each keeps the other\'s section; no old name, no leftover temporary file', () => {
  const dir = tmp();
  assert.equal(LINE_CHECKS_FILE, 'line-checks.json');
  writeCitedLine(dir, citedLine(3));
  writeSheetLine(dir, { n: 2, try: 1, checks: [{ id: 'c1' }], closed: sheetClosed() });
  writeCitedLine(dir, citedLine(1));
  assert.deepEqual(readdirSync(dir), ['line-checks.json']);
  const rec = JSON.parse(readFileSync(path.join(dir, 'line-checks.json'), 'utf8'));
  assert.deepEqual(Object.keys(rec).sort(), ['cited', 'sheet']);
  assert.deepEqual(rec.cited.lines.map((l) => l.n), [1, 3], 'cited lines kept in order of n');
  assert.deepEqual(rec.sheet.lines.map((l) => [l.n, l.try]), [[2, 1]]);
});

test('cited key = the line: a later write of the same line replaces it. sheet key = line + try: a repeat of the same line and try writes nothing', () => {
  const dir = tmp();
  writeCitedLine(dir, citedLine(1, false));
  writeCitedLine(dir, citedLine(1, true));
  const c = readLineSection(dir, 'cited');
  assert.equal(c.ok && c.lines.length, 1);
  assert.equal(c.ok && c.lines[0].passed, true);
  writeSheetLine(dir, { n: 2, try: 1, checks: [], closed: sheetClosed('red') });
  writeSheetLine(dir, { n: 2, try: 1, checks: [], closed: sheetClosed('green') });
  writeSheetLine(dir, { n: 2, try: 2, checks: [], closed: sheetClosed('green') });
  const s = readSheetChecks(dir);
  assert.deepEqual(s?.lines.map((l) => [l.n, l.try, l.passed]), [[2, 1, false], [2, 2, true]]);
});

test('the readers read only line-checks.json; a missing section reads as no record', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'cited-checks.json'), JSON.stringify({ lines: [citedLine(1)] }));
  writeFileSync(path.join(dir, 'sheet-checks.json'), JSON.stringify({ lines: [{ n: 1, try: 1 }] }));
  assert.deepEqual(readCitedChecks(dir), { present: false });
  assert.equal(readSheetChecks(dir), null);
  writeCitedLine(dir, citedLine(5));
  assert.equal(readSheetChecks(dir), null, 'the cited write made no sheet section');
  const c = readCitedChecks(dir);
  assert.equal(c.present && c.ok && c.lines[0].n, 5);
});

test('an unreadable file is named by the cited reader and started again by the writer', () => {
  const dir = tmp();
  writeFileSync(path.join(dir, 'line-checks.json'), '{nope');
  const bad = readCitedChecks(dir);
  assert.equal(bad.present && !bad.ok && /line-checks\.json/.test(bad.red), true);
  assert.equal(readSheetChecks(dir), null);
  writeCitedLine(dir, citedLine(1));
  assert.equal(readCitedChecks(dir).present, true);
  assert.equal(/** @type {any} */ (readCitedChecks(dir)).ok, true);
  const shaped = tmp();
  writeFileSync(path.join(shaped, 'line-checks.json'), JSON.stringify({ cited: { lines: 'x' } }));
  assert.equal(/** @type {any} */ (readCitedChecks(shaped)).ok, false);
  writeLineSection(shaped, 'sheet', (lines) => { assert.deepEqual(lines, []); return null; });
  assert.deepEqual(readdirSync(shaped), ['line-checks.json'], 'null from change writes nothing');
});
