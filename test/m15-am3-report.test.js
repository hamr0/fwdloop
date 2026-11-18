// M15 am3 (items 2, 3, 4, 5, 1): the report's words, from fwd's own run data. Pure renderer, the head and the next free name.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renderReportBody, reportFileText, reportHead, nextFreeName, runNumberOf, plainDate, REPORT_RENAMED } from '../src/report.js';

const where = [{ column: 'Amount', cmp: 'gt', value: 500 }];
const SHEET = [
  { id: 'rows', rule: 'cells', table: 'expenses', op: 'rows', claim: 'expenseRows', where },
  { id: 'total', rule: 'cells', table: 'expenses', op: 'sumIf', claim: 'expenseTotal', column: 'Amount', where },
  { id: 'count', rule: 'cells', table: 'expenses', op: 'countIf', claim: 'expenseCount', where },
];
const TABLES = { expenses: { header: ['Amount'], rows: [{ rowNumber: 2, cells: ['600'] }, { rowNumber: 3, cells: ['1,200.50'] }, { rowNumber: 4, cells: ['20'] }] } };
const SHEET_ART = { expenseRows: { rows: [2, 3] }, expenseTotal: { value: 99999 }, expenseCount: { value: 1 } };
const NOW = new Date(2026, 10, 18, 12);

test('a sheet line: Count then Total from the rows named, never the AI\'s numbers, whatever the check order', () => {
  const body = renderReportBody([{ n: 2, kind: 'work', text: 'List the big ones', rules: ['Amount over 500'], artifact: SHEET_ART, checks: SHEET }], TABLES);
  assert.equal(body, '## 2. List the big ones\nRule: Amount over 500\n\n### Checked by code\n- Rows where Amount > 500: 2, 3\n- Count: 2\n- Total: 1,800.50');
  assert.doesNotMatch(body, /99999/);
});
test('a text line: the AI\'s answer sits under the not-checked heading, a checked one under "The answer"; its own markdown stays', () => {
  const a = { text: '# own heading\nhello' };
  assert.equal(renderReportBody([{ n: 1, kind: 'work', text: 'Say hi', artifact: a }], {}), '## 1. Say hi\n\n### The AI\'s answer (not checked — you judge it at Accept)\n# own heading\nhello');
  assert.equal(renderReportBody([{ n: 1, kind: 'work', text: 'Say hi', artifact: a, proseChecked: true }], {}), '## 1. Say hi\n\n### The answer\n# own heading\nhello');
});
test('facts: #### Result k blocks, names as words, the quote byte for byte; an Ask line keeps its M13 am9 words', () => {
  const art = { results: [{ quote: ' Wizz "Air" 08:00 — €99 \n', values: { airline: 'Wizz Air', priceEur: 99, nonstop: true } }] };
  const body = renderReportBody([{ n: 1, kind: 'ask' }, { n: 2, kind: 'work', text: 'Flights', rules: ['under $150', 'nonstop'], artifact: art, checks: [] }], {});
  assert.equal(body, 'Line 1: you accepted this at the Ask.\n\n## 2. Flights\nRule: under $150\nRule: nonstop\n\n### Checked by code\n#### Result 1\n- Airline: Wizz Air\n- Price eur: 99\n- Nonstop: true\n\nfrom the page: " Wizz "Air" 08:00 — €99 \n"');
});
test('a work line with nothing to write has no section (bareloop v0.60.0)', () => {
  assert.equal(renderReportBody([{ n: 1, kind: 'work', text: 'Read', artifact: { cells: ['A1'] } }], {}), '');
});
test('a sheet box no check carries is left out; a map of rows writes one bullet per row', () => {
  const checks = [{ id: 'b', rule: 'cells', table: 't', op: 'band', claim: 'bands', column: 'Days', bands: [] }];
  const body = renderReportBody([{ n: 1, kind: 'work', text: 'Bands', artifact: { bands: { bands: { 2: 'Current', 3: '1-30' } }, stray: { value: 1 } }, checks }], {});
  assert.match(body, /- Band on Days: , row 2: Current\n- Band on Days: , row 3: 1-30$/);
  assert.doesNotMatch(body, /stray|Stray/);
});
test('the head, the title without a run number, the file text', () => {
  assert.equal(reportHead('job', 3, NOW), '# job — run-3\nPassed · 18 Nov 2026');
  assert.equal(reportHead('job', null, NOW), '# job\nPassed · 18 Nov 2026');
  assert.equal(reportFileText('job', 3, NOW, 'BODY'), '# job — run-3\nPassed · 18 Nov 2026\n\nBODY\n');
  assert.equal(runNumberOf('run-12'), 12);
  assert.equal(runNumberOf('run-1-rerun-1'), null);
  assert.equal(plainDate(new Date(2026, 0, 5)), '5 Jan 2026');
});
test('nextFreeName: dated name, then -2, -3; a dangling symlink counts as taken; the note names the first choice', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fwdloop-am3-'));
  try {
    assert.deepEqual(nextFreeName(dir, 'my job', NOW), { name: 'my job-2026-11-18.md', taken: null });
    writeFileSync(join(dir, 'my job-2026-11-18.md'), 'x');
    assert.deepEqual(nextFreeName(dir, 'my job', NOW), { name: 'my job-2026-11-18-2.md', taken: 'my job-2026-11-18.md' });
    symlinkSync(join(dir, 'nowhere'), join(dir, 'my job-2026-11-18-2.md'));
    const third = nextFreeName(dir, 'my job', NOW);
    assert.equal(third.name, 'my job-2026-11-18-3.md');
    assert.equal(REPORT_RENAMED(third.taken), 'saved under a new name because my job-2026-11-18.md was already taken');
    assert.equal(nextFreeName(dir, '../evil', NOW).name, '-evil-2026-11-18.md');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
