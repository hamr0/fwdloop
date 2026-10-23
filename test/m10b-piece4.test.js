// M10b piece 4 (docs/wiki/the-module-ladder.md "M10b amendment 2"): each guardrail shows what checked it. The drafter's `covers` tag is KEPT on the signed check (inside the
// hash), stripped only on the way into bareguard (`bareguardChecks`); ONE builder (src/sheetblock.js `sheetLineBlocks`) makes the per-line block every surface draws; after a
// run the block carries ✓ / ✗ and what was found, from the run's own sheet-checks.json. $0: synthetic sheets (test/fixtures/m10b-sheets), real bareguard, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRubric } from 'bareguard';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { parseCsv, sheetTable } from '../src/csv.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';
import { WIRED_VERBS } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import { buildReadout, specHash } from '../src/authoring.js';
import { checkedLines } from '../src/checked.js';
import { bareguardChecks, sheetCheckReds } from '../src/sheetchecks.js';
import { sheetLineBlocks, sheetCheckName, vocabularyOps, SHEET_OP_NAMES, csvRolesOf, uncoveredRules } from '../src/sheetblock.js';
import { freezeInputs } from '../src/runner.js';
import { closeSheet, readRunSheets, sheetRolesOf } from '../src/sheetrun.js';
import { writeSheetLine, readSheetChecks } from '../src/sheet-record.js';
import { buildResult } from '../src/panel/result.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHEETS = path.join(HERE, 'fixtures', 'm10b-sheets');
const AGING = path.join(SHEETS, 'aging.csv');
const AGING_DUP = path.join(SHEETS, 'aging-dup.csv');
const EXPENSES = path.join(SHEETS, 'expenses.csv');
const cat = loadCatalogue();
const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m10b-p4-'));

// ---- the two jobs ------------------------------------------------------------------------------------------------------------------------------
const tail = (role, file) => `
Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source ${role} = file:${file}
`;
const AGING_PROSE = `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+
   guardrail: every invoice appears exactly once; amounts over 500 are flagged
3. ask 1h: check it with me
4. Write it out
${tail('aging', AGING)}`;
const EXP_PROSE = `1. Read the expense report
2. List the expenses over 500, their count and their sum
   guardrail: only amounts over 500; the sum is exact
3. ask 1h: check it with me
4. Write it out
${tail('expenses', EXPENSES)}`;
const agingJob = parseSignedText(AGING_PROSE);
const expJob = parseSignedText(EXP_PROSE);
assert.equal(agingJob.ok, true, JSON.stringify(agingJob.reds));
assert.equal(expJob.ok, true, JSON.stringify(expJob.reds));

const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
const AGING_CHECKS = () => [
  { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #', covers: [1] },
  { id: 'over', rule: 'cells', table: 'aging', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [2] },
  { id: 'bands', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, bands: BANDS },
];
const EXP_CHECKS = () => [
  { id: 'over', rule: 'cells', table: 'expenses', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [1] },
  { id: 'cnt', rule: 'cells', table: 'expenses', claim: 'count', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [1] },
  { id: 'sum', rule: 'cells', table: 'expenses', claim: 'total', op: 'sumIf', column: 'Amount', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [2] },
];
const decl = (role, sheet, firstLine = 'Read') => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'text_in', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: [role], emits: 'figures', fromLine: 2, close: { class: 'green', sheet } },
    { primitives: [], reads: ['figures'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['figures', 'human_ok'], emits: 'report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [], firstLine,
});
const strip = (d) => {
  const { firstLine: _f, ...rest } = d;
  const text = { 1: 'Read the aging report', 2: 'Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+', 3: 'ask 1h: check it with me', 4: 'Write it out' };
  return { ...rest, inputFacts: {}, steps: rest.steps.map((st) => ({ ...st, goal: text[st.fromLine] })) };
};
const agingDecl = (sheet = AGING_CHECKS()) => strip(decl('aging', sheet));
const expDecl = (sheet = EXP_CHECKS()) => strip(decl('expenses', sheet));
const tablesOf = (file) => ({ [file === EXPENSES ? 'expenses' : 'aging']: sheetTable(parseCsv(readFileSync(file, 'utf8'))) });
const validate = (d, job, file) => validateDeclaration(d, {
  arbiter: job.arbiter, lines: job.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: false, fitJobLine: true,
  sheetWords: { headers: { [Object.keys(tablesOf(file))[0]]: Object.values(tablesOf(file))[0].header }, facts: [], tables: tablesOf(file) },
});

// ---- 1. covers is kept, validated, and inside the hash -----------------------------------------------------------------------------------------
test('covers stays on the signed check, is validated against the line\'s rules, and a changed tag changes the spec hash', () => {
  const ok = validate(agingDecl(), agingJob, AGING);
  assert.equal(ok.ok, true, JSON.stringify(ok.reds));
  assert.deepEqual(agingDecl()[ 'steps' ][1].close.sheet.map((c) => c.covers), [[1], [2], undefined], 'the declaration keeps what the drafter said');
  const hashOf = (d) => {
    const h = specHash({ proseText: AGING_PROSE, declarationText: JSON.stringify(d), inputFactsText: '{}', readoutText: 'same readout', targetText: '{}' });
    assert.equal(h.ok, true);
    return h.hash;
  };
  const retagged = agingDecl(); retagged.steps[1].close.sheet[0].covers = [2];
  assert.notEqual(hashOf(agingDecl()), hashOf(retagged), 'a changed covers tag changes the hash (it is signed)');
  assert.equal(hashOf(agingDecl()), hashOf(agingDecl()), 'and the same tags hash the same');
  const readout = (d) => buildReadout({ declaration: d, arbiter: agingJob.arbiter, lines: agingJob.lines, name: 'x', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true, root: 'r' });
  assert.match(readout(agingDecl()), /\n {5}sheet check: no duplicate Invoice # — covers "every invoice appears exactly once"\n/);
  assert.match(readout(agingDecl()), /\n {5}sheet check: rows — rows where Amount > 500 — covers "amounts over 500 are flagged"\n/);
  assert.match(readout(agingDecl()), /\n {5}sheet check: bucket — band on Due date as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90\+\n/, 'no tag, no covers words');
});

test('a covers that is not a list of rule numbers of the line is refused at sign, naming the line and the check; an old check without covers still signs', () => {
  const bad = agingDecl(); bad.steps[1].close.sheet[0].covers = [3]; // the line has 2 rules
  const r = validate(bad, agingJob, AGING);
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes('line 2') && x.includes("'nodup'") && x.includes('"covers"')), r.reds.join('\n'));
  for (const v of [0, 'one', 1.5, [0], ['1'], 'x']) {
    const b = agingDecl(); b.steps[1].close.sheet[0].covers = v;
    assert.equal(validate(b, agingJob, AGING).ok, false, JSON.stringify(v));
  }
  const old = agingDecl(AGING_CHECKS().map(({ covers: _c, ...rest }) => rest));
  assert.equal(validate(old, agingJob, AGING).ok, true, 'an old draft without covers keeps working');
});

// ---- 2. stripped on the way into bareguard, in one place ---------------------------------------------------------------------------------------
test('bareguard never sees covers: bareguardChecks strips it, sign-time and run-time both go through it, the input is not changed', async () => {
  const checks = AGING_CHECKS();
  const clean = bareguardChecks(checks);
  assert.ok(clean.every((c) => !('covers' in c)));
  assert.ok(checks.slice(0, 2).every((c) => Array.isArray(c.covers)), 'the signed checks keep theirs');
  const spec = (cs) => ({ schema: 1, goal: 't', inputs: [], checkpoints: { sheet: { gating: true, checks: cs } }, maxReds: 3 });
  const tables = tablesOf(AGING);
  assert.throws(() => createRubric({ ...spec(checks), inputs: [{ name: 'aging', sha256: 'a'.repeat(64) }] }), /covers|unknown|invalid/i, 'bareguard itself refuses the field (so the strip is needed)');
  assert.deepEqual(sheetCheckReds(checks, 2, tables), [], 'the sign-time test accepts a check that carries covers');
  const run = tmp();
  try {
    const frozen = await freezeInputs(run, [{ id: 'aging', path: AGING }], { tableRoles: sheetRolesOf(agingDecl().steps) });
    assert.equal(frozen.ok, true, frozen.red);
    const sheet = readRunSheets(run, checks);
    const closed = await closeSheet(checks, { over: { rows: [] }, bands: { bands: bandsOf(AGING) } }, sheet);
    assert.equal(closed.verdict, 'green', closed.red);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

const daysBetween = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const bandName = (d) => (d <= 0 ? 'Current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+');
/** the truth for the aging sheet, worked here from the file's lines */
function bandsOf(file) {
  const rows = readFileSync(file, 'utf8').split('\n').filter(Boolean).slice(1);
  return Object.fromEntries(rows.map((l, i) => [String(i + 2), bandName(daysBetween(l.split(',')[2], '2026-10-11'))]));
}

// ---- 3. the block builder: the plan card ----------------------------------------------------------------------------------------------------------
test('the block for the aging job: guardrails, Checked with name / words / covers, Not checked: none', () => {
  const [b, ...rest] = sheetLineBlocks({ declaration: agingDecl(), lines: agingJob.lines, csvRoles: ['aging'] });
  assert.equal(rest.length, 0);
  assert.equal(b.line, 2);
  assert.deepEqual(b.guardrails, ['every invoice appears exactly once', 'amounts over 500 are flagged']);
  assert.deepEqual(b.checked.map((c) => c.text), [
    'no duplicate Invoice # — covers "every invoice appears exactly once"',
    'rows — rows where Amount > 500 — covers "amounts over 500 are flagged"',
    'bucket — band on Due date as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+',
  ]);
  assert.deepEqual(b.checked.map((c) => c.name), ['no duplicate Invoice #', 'rows', 'bucket']);
  assert.equal(b.notChecked, 'none', 'every guardrail has a check that covers it');
});

test('the block for the expenses job, and a REAL uncovered guardrail shown as Not checked', () => {
  const [b] = sheetLineBlocks({ declaration: expDecl(), lines: expJob.lines, csvRoles: ['expenses'] });
  assert.deepEqual(b.checked.map((c) => c.text), [
    'rows — rows where Amount > 500 — covers "only amounts over 500"',
    'count — count of rows where Amount > 500 — covers "only amounts over 500"',
    'sum — sum of Amount where Amount > 500 — covers "the sum is exact"',
  ]);
  assert.equal(b.notChecked, 'none');
  const d = expDecl(); d.steps[1].close.sheet[2].covers = []; // the sum check no longer claims the second guardrail
  const [u] = sheetLineBlocks({ declaration: d, lines: expJob.lines, csvRoles: ['expenses'] });
  assert.deepEqual(u.notChecked, ['the sum is exact']);
  assert.deepEqual(uncoveredRules(d, expJob.lines, ['expenses']), ['line 2: "the sum is exact" — no sheet check covers it'], 'the drafter\'s saved list is the same block');
  const none = expDecl(EXP_CHECKS().map(({ covers: _c, ...rest }) => rest)); // an old draft: nothing is claimed, everything is Not checked
  assert.deepEqual(sheetLineBlocks({ declaration: none, lines: expJob.lines })[0].notChecked, ['only amounts over 500', 'the sum is exact']);
});

test('every bareguard op has a short plain name in the one table; a no-duplicate / no-empty name carries its column', () => {
  for (const op of vocabularyOps()) assert.ok(Object.hasOwn(SHEET_OP_NAMES, op), `bareguard's op "${op}" has no short name in src/sheetblock.js`);
  assert.equal(sheetCheckName({ op: 'noDuplicates', column: 'Invoice #' }), 'no duplicate Invoice #');
  assert.equal(sheetCheckName({ op: 'band' }), 'bucket');
  assert.equal(sheetCheckName({ op: 'daysSince' }), 'date');
  assert.equal(sheetCheckName({ op: 'sumIf' }), 'sum');
  assert.equal(sheetCheckName({ op: 'average' }), 'average');
});

test('the Chat Checked list and the Job tab carry the block on the line\'s step; without job lines the older one-row-per-check sentences remain', () => {
  const withLines = checkedLines(agingDecl(), { askLines: [3], lines: agingJob.lines, csvRoles: ['aging'] });
  const s = withLines.find((x) => x.line === 2);
  assert.equal(s.sheet.checked.length, 3);
  assert.equal(s.sentences.length, 1, 'only the lead sentence; the surfaces draw the block');
  assert.equal(withLines.filter((x) => x.sheet).length, 1, 'one block per line');
  const without = checkedLines(agingDecl(), { askLines: [3] }).find((x) => x.line === 2);
  assert.equal(without.sheet, undefined);
  assert.equal(without.sentences.length, 4);
  assert.deepEqual(csvRolesOf({ sources: [{ role: 'aging', kind: 'file', path: '/x/A.CSV' }, { role: 'p', kind: 'page', path: 'https://x/y.csv' }, { role: 'd', kind: 'file', path: '/x/d.docx' }] }), ['aging']);
});

// ---- 4. the Result: ✓ / ✗ and what was found --------------------------------------------------------------------------------------------------------
/** freeze `file`, run the checks on `claims` through the real judge, write the run's record, and return the run's folder and the verdict */
async function ran(file, role, checks, claims) {
  const run = tmp();
  const frozen = await freezeInputs(run, [{ id: role, path: file }], { tableRoles: [role] });
  assert.equal(frozen.ok, true, frozen.red);
  const closed = await closeSheet(checks, claims, readRunSheets(run, checks));
  assert.ok(['green', 'red'].includes(closed.verdict), closed.red);
  writeSheetLine(run, { n: 2, try: 1, checks, closed });
  return { run, closed };
}
const result = (run, d, job, extra = {}) => buildResult({
  flow: 'j', runId: 'run-1', runDir: run, root: path.dirname(run), flowRead: { declaration: d, lines: job.lines },
  arbiter: { asks: [], sends: [], sources: job.arbiter.sources, ...extra.arbiter }, historyRow: null, auditRows: extra.auditRows ?? [], logJson: null, notChecked: [], ...extra.rest,
});

test('Result after a green run: ✓ count checked — N, with the step\'s own claimed values in plain words, and Not checked: none', async () => {
  // the truth, worked here from the file (rows over 500 and their sum), not by the code under test
  const lines = readFileSync(EXPENSES, 'utf8').split('\n').filter(Boolean).slice(1);
  const amounts = lines.map((l) => { const m = /^[^,]*,(?:"[^"]*"|[^,]*),("[^"]*"|[^,]*),/.exec(l); return Number(m[1].replace(/"/g, '').replace(/,/g, '')); });
  const over = amounts.map((a, i) => [a, i + 2]).filter(([a]) => a > 500);
  assert.ok(over.length >= 3);
  const cents = over.reduce((s, [a]) => s + Math.round(a * 100), 0);
  const total = cents / 100;
  const claims = { over: { rows: over.map(([, r]) => r) }, count: { value: over.length }, total: { value: total } };
  const { run, closed } = await ran(EXPENSES, 'expenses', EXP_CHECKS(), claims);
  try {
    assert.equal(closed.verdict, 'green', closed.red);
    const res = result(run, expDecl(), expJob);
    const line = res.lines.find((l) => l.n === 2);
    assert.deepEqual(line.sheet.checked.map((c) => c.ok), [true, true, true]);
    assert.deepEqual(line.sheet.checked.map((c) => c.found), [`rows checked — ${over.length} rows`, `count checked — ${over.length}`, `sum checked — ${total}`]);
    assert.equal(line.sheet.notChecked, 'none');
    assert.ok(line.sheet.checked.every((c) => c.words && c.coversWords.startsWith('covers "')), 'the plain words and covers ride along');
    assert.deepEqual(res.lines.filter((l) => l.n !== 2).map((l) => l.sheet), [null, null, null], 'a line that reads no sheet has no block');
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('Result after a red run: the no-duplicate check is red naming rows 2 and 3, beside the checks that passed', async () => {
  const claims = { over: { rows: [] }, bands: { bands: bandsOf(AGING_DUP) } };
  const { run, closed } = await ran(AGING_DUP, 'aging', AGING_CHECKS(), claims);
  try {
    assert.equal(closed.verdict, 'red');
    const line = result(run, agingDecl(), agingJob).lines.find((l) => l.n === 2);
    const by = Object.fromEntries(line.sheet.checked.map((c) => [c.id, c]));
    assert.equal(by.nodup.ok, false);
    assert.equal(by.nodup.found, 'no duplicate Invoice # \u2014 rows sharing a value: 2, 3', "bareguard's own gap words, without the check id");
    assert.equal(by.nodup.found.includes('INV-100'), false, 'row numbers, never cell text');
    assert.equal(by.over.ok, true);
    assert.equal(by.over.found, 'rows checked — 0 rows');
    assert.equal(by.bands.ok, true);
    assert.equal(by.bands.found, `bucket checked — ${Object.keys(bandsOf(AGING_DUP)).length} rows`);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('Result with NO rows found still shows the block (rows checked — 0 rows), and so when the result is written to a doc', async () => {
  const { run, closed } = await ran(AGING, 'aging', AGING_CHECKS(), { over: { rows: [] }, bands: { bands: bandsOf(AGING) } });
  try {
    assert.equal(closed.verdict, 'green', closed.red);
    const res = result(run, agingDecl(), agingJob);
    const line = res.lines.find((l) => l.n === 2);
    assert.deepEqual(line.sheet.checked.map((c) => [c.ok, c.found]), [[true, 'no duplicate Invoice # checked'], [true, 'rows checked — 0 rows'], [true, 'bucket checked — 8 rows']]);
    assert.equal(line.rows ?? null, null, 'the run found no rows to list');
    // the result is written to a doc: a .docx source and a send to a file, the send step green in the audit
    const doc = result(run, agingDecl(), agingJob, {
      arbiter: { sends: [{ line: 4, target: { kind: 'file', path: path.join(run, 'out') } }], sources: [...agingJob.arbiter.sources, { role: 'report', kind: 'file', path: '/x/report.docx' }] },
      auditRows: [{ step: 'report', verdict: 'green' }],
    });
    assert.equal(doc.delivered.length, 1, 'a delivered file is listed');
    assert.deepEqual(doc.lines.find((l) => l.n === 2).sheet, line.sheet, 'and the block is the same');
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a run that never reached the check shows the plan block with no mark; the newest try of a line is the one shown; a damaged record shows no verdicts', async () => {
  const run = tmp();
  try {
    const none = result(run, agingDecl(), agingJob).lines.find((l) => l.n === 2).sheet;
    assert.ok(none.checked.every((c) => c.ok === undefined && c.found === undefined));
    assert.equal(readSheetChecks(run), null, 'no file, no record');
    const red = await ran(AGING_DUP, 'aging', AGING_CHECKS(), { over: { rows: [] }, bands: { bands: bandsOf(AGING_DUP) } });
    const green = await closeSheet(AGING_CHECKS(), { over: { rows: [] }, bands: { bands: bandsOf(AGING) } }, readRunSheets(red.run, AGING_CHECKS()));
    // a second try in the same run is judged on the same frozen copy (still the duplicate sheet), so it is red again: the NEWEST try is the one shown
    writeSheetLine(red.run, { n: 2, try: 2, checks: AGING_CHECKS(), closed: green });
    const rec = readSheetChecks(red.run);
    assert.deepEqual(rec.lines.map((l) => l.try), [1, 2]);
    const blocks = sheetLineBlocks({ declaration: agingDecl(), lines: agingJob.lines, record: rec });
    assert.equal(blocks[0].checked.find((c) => c.id === 'nodup').ok, false);
    assert.equal(sheetLineBlocks({ declaration: agingDecl(), lines: agingJob.lines, record: { lines: 'x' } })[0].checked[0].ok, undefined);
    rmSync(red.run, { recursive: true, force: true });
  } finally { rmSync(run, { recursive: true, force: true }); }
});
