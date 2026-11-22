// M19 S3: the check block holds a sheet line's rows (bareloop v0.60.0 `setSheet`, `matchSheetRule`, `buildSheetPartOf`, `rowChoice`) in fwd's words; fwd's own rules stay (no `[default]` sheet row, no `$prose` row, the
// dropped-check record in fwd's shape). The repo rows are inert here (fwd never sets `repo`) and `namedPaths` is hand-written from the tag's pattern. $0. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CheckBlock } from '../src/checkblock.js';
import { buildSheetChecks } from '../src/sheetbuild.js';
import { parseCsv, sheetTable } from '../src/csv.js';

const CSV = 'Invoice #,Amount,Due date\n1,600,2026-10-01\n2,20,2026-09-01\n3,900,2026-08-01\n';
const TABLES = { aging: sheetTable(parseCsv(CSV)) };
const LINE = { n: 2, text: 'Put each invoice in its bucket as of 2026-10-11', guardrail: 'every invoice appears exactly once; flag amounts over 500' };
const ROWS = { rule: 'cells', table: 'aging', claim: 'x', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] };
const NODUP = { rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #' };

async function sheetBlock() {
  const b = new CheckBlock({ texts: {}, labels: ['aging'], asks: true, split: true, cited: false });
  b.setSheetLines([2]);
  b.fromJob([{ n: 1, text: 'Read the report', rules: [] }, { n: 2, text: LINE.text, rules: ['every invoice appears exactly once', 'flag amounts over 500'] }]);
  b.reconcile();
  b.setSheet(await buildSheetChecks({ lines: [LINE], tables: TABLES, suggestions: [{ line: 2, ...NODUP, covers: [1] }, { line: 2, ...ROWS, covers: [2] }] }));
  return b;
}

test('before the sheet is built a sheet line asks nothing and says it has no pick; after setSheet the rule rows are built and the table check is its own [agent] row', async () => {
  const b = new CheckBlock({ texts: {}, labels: ['aging'], asks: true, split: true, cited: false });
  b.setSheetLines([2]);
  b.fromJob([{ n: 2, text: LINE.text, rules: ['every invoice appears exactly once', 'flag amounts over 500'] }]);
  b.reconcile();
  assert.deepEqual(b.open, [], 'break: leave the sheet line out of matchRule and the rule "every invoice ..." is asked as a count');
  const done = await sheetBlock();
  const rule = (n) => done.rows.find((r) => r.key === `L2.~${n}`);
  assert.equal(rule(2).state, 'built');
  assert.equal(rule(1).state, 'not-checked', 'a table check judges the sheet, never a rule');
  assert.deepEqual(done.rows.filter((r) => r.kind === 'sheet').map((r) => [r.by, r.state]), [['agent', 'built']]);
  assert.ok(!done.rows.some((r) => r.kind === 'sheet' && r.by === 'default'), 'fwd keeps: no `[default]` sheet row (M16 am4)');
  assert.ok(!done.rows.some((r) => r.kind === 'prose'), 'fwd keeps: no `$prose` row');
});

test('Drop on the [agent] sheet row: the check leaves the sheet part, the row is a suggestion with Add, the record is fwd\'s shape; Add puts it back; a [you] row has no Drop', async () => {
  const b = await sheetBlock();
  const agent = b.rows.find((r) => r.kind === 'sheet');
  const partChecks = () => (b.reconcile().parts.find((p) => p.class === 'sheet')?.checks ?? []).map((c) => c.id);
  assert.deepEqual(partChecks().sort(), ['l2a1', 'l2r2']);
  assert.deepEqual(b.rowChoice(agent.key, 'drop'), { ok: true });
  assert.deepEqual(partChecks(), ['l2r2'], 'break: keep a held row in the part');
  assert.equal(b.suggestedView().find((x) => x.key === agent.key)?.dropped, true);
  const rec = b.sheetDroppedRecord();
  assert.deepEqual(Object.keys(rec[0]).sort(), ['check', 'index', 'key', 'line', 'text'], 'fwd keeps the record shape of M17 am3');
  assert.equal(rec[0].index, 1);
  assert.deepEqual(b.rowChoice(agent.key, 'add'), { ok: true });
  assert.deepEqual(partChecks().sort(), ['l2a1', 'l2r2']);
  assert.match(String(b.rowChoice('L2.~2', 'drop').why), /comes from a rule you wrote/);
});

test('a Revise keeps a Drop only for the very same check (its typed fields), by line, never by id', async () => {
  const first = await sheetBlock();
  first.rowChoice(first.rows.find((r) => r.kind === 'sheet').key, 'drop');
  const rec = first.sheetDroppedRecord();
  const again = await sheetBlock();
  again.carrySheetDropped(rec);
  assert.equal(again.rows.find((r) => r.kind === 'sheet').choice, 'drop');
  const other = await sheetBlock();
  other.carrySheetDropped([{ ...rec[0], check: { ...rec[0].check, column: 'Amount' } }]);
  assert.equal(other.rows.find((r) => r.kind === 'sheet').choice, undefined, 'break: match on the id and a different check is dropped');
});

test('the repo rows are inert without `repo`; namedPaths (the tag builds a pattern, fwd writes the same two tests by hand) agrees with the tag\'s pattern on a table of texts', () => {
  const b = new CheckBlock({ texts: {}, labels: [], repo: { files: ['src/a.js', 'src/b.js', 'docs/x.md', 'README.md'], writeScope: ['src/'] } });
  const cases = [
    ['keep README.md as it is', ['README.md']],
    ['keep README.mdx as it is', []],
    ['keep docs/ as it is', ['docs']],
    ['keep docs/x.md untouched', ['docs/x.md']],
    ['do not touch src/a.js.', ['src/a.js']],
    ['do not touch src/a.js.bak', []],
    ['edit only src/a.js and src/b.js', ['src/a.js', 'src/b.js']],
    ['myREADME.md is not it', []],
    ['(README.md)', ['README.md']],
    ['"docs/"', ['docs']],
    ['docs/x.md-old', []],
  ];
  for (const [text, want] of cases) assert.deepEqual([...b.namedPaths(text)].sort(), want.sort(), text);
  const off = new CheckBlock({ texts: {}, labels: [] });
  assert.deepEqual(off.namedPaths('keep README.md'), [], 'no repo: nothing is named');
  assert.equal(off.repo, null);
});
