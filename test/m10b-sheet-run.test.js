// M10b piece 2 (items 5, 6 and amendment 1): a step that reads a sheet answers in bareguard's typed claim boxes; bareguard's `checkStep` judges them on the table made
// from the run's OWN frozen copy, locked by the `tableSha` recorded with the run's inputs at its start. $0: fake model steps, synthetic fixtures (test/fixtures/m10b-sheets).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rubricVocabulary, tableSha } from 'bareguard';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { freezeInputs, runStepRalph, runFlow, readArtifactsMapChecked } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readAudit, readHistory } from '../src/books.js';
import { parseCsv, sheetTable } from '../src/csv.js';
import { readRunSheets, sheetRolesOf } from '../src/sheetrun.js';
import { sheetClaims, sheetAnswerProps, sheetBrief } from '../src/sheetclaims.js';
import { buildEmitArtifactSchema, makeLiveModelStep } from '../src/model-step.js';
import { parseSignedText } from '../src/signed-text.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SHEETS = path.join(HERE, 'fixtures', 'm10b-sheets');
const EXPENSES = path.join(SHEETS, 'expenses.csv');
const AGING = path.join(SHEETS, 'aging.csv');
const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m10b-run-'));
const cat = loadCatalogue();

// ---- the truth, computed here and not by src/csv.js or bareguard: a small quote-aware split of the fixture's lines ----
function cellsOf(line) {
  const out = [];
  let cell = ''; let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === ',' && !q) { out.push(cell); cell = ''; } else cell += ch;
  }
  out.push(cell);
  return out;
}
const linesOf = (file) => readFileSync(file, 'utf8').split('\n').filter((l) => l !== '').map(cellsOf);
/** the sheet row numbers (header is row 1) whose Amount is over `limit` */
const rowsOver = (file, limit) => linesOf(file).map((c, i) => [i + 1, Number(c[2].replaceAll(',', ''))]).slice(1).filter(([, v]) => v > limit).map(([r]) => r);
const dayDiff = (from, to) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000);
const bandOf = (d) => (d <= 0 ? 'Current' : d <= 30 ? '1-30' : d <= 60 ? '31-60' : d <= 90 ? '61-90' : '90+');

const OVER = rowsOver(EXPENSES, 500);
const EXP_CHECKS = () => [
  { id: 'c_over', rule: 'cells', table: 'expenses', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] },
  { id: 'c_count', rule: 'cells', table: 'expenses', claim: 'count', op: 'countIf', where: [{ column: 'Amount', cmp: 'gt', value: 500 }] },
];
const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
const AS_OF = '2026-10-11';
const AGING_CHECKS = () => [
  { id: 'c_days', rule: 'cells', table: 'aging', claim: 'days', op: 'daysSince', column: 'Due date', asOf: AS_OF, dateFormats: ISO },
  { id: 'c_bands', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: AS_OF, dateFormats: ISO, bands: BANDS },
  { id: 'c_dup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #' },
];
const sheetAnswer = (bands) => ({ days: { days: AGING_DAYS }, bands: { bands } });
const agingRows = linesOf(AGING).map((c, i) => [i + 1, c[2]]).slice(1);
const AGING_DAYS = Object.fromEntries(agingRows.map(([r, d]) => [String(r), dayDiff(d, AS_OF)]));
const AGING_BANDS = Object.fromEntries(Object.entries(AGING_DAYS).map(([r, d]) => [r, bandOf(d)]));

const stepOf = (checks, role) => ({
  goal: 'Work out the figures from the sheet', primitives: [], reads: [role], emits: 'figures', fromLine: 2, close: { class: 'green', sheet: checks },
});
/** freeze a sheet into a run folder (tableSha recorded) and run ONE step on a fake model that answers `answers[i]` on try i */
async function runStep(file, role, checks, answers, { mutate } = {}) {
  const run = tmp();
  const frozen = await freezeInputs(run, [{ id: role, path: file }], { tableRoles: sheetRolesOf([stepOf(checks, role)]) });
  assert.equal(frozen.ok, true, frozen.red);
  if (mutate) mutate(run);
  const read = readArtifactsMapChecked(run, [role]);
  const rows = []; const spent = { value: 0 };
  let calls = 0;
  const out = await runStepRalph({
    step: stepOf(checks, role), primitivesMap: {}, readsMap: read.ok ? read.map : {}, businessDate: AS_OF,
    modelStep: async () => { const a = answers[Math.min(calls, answers.length - 1)]; calls += 1; return { ok: true, costUsd: 0.001 * calls, artifact: { ...a, done: true } }; },
    spent, capUsd: 1, ceilingUsd: 0.01, recordAudit: (r) => rows.push(r), runDir: run,
  });
  return { run, out, rows, calls: () => calls, spent };
}
const lastRecord = (run) => JSON.parse(readFileSync(path.join(run, 'sheet-checks.json'), 'utf8')).lines;
const checksRows = (run) => readFileSync(path.join(run, 'checks.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('the lock: the run\'s inputs.json records the tableSha of the frozen sheet, once, for a sheet a step\'s close.sheet names (and for no other input)', async () => {
  const run = tmp();
  try {
    const other = path.join(run, 'notes.csv');
    writeFileSync(other, 'a,b\n1,2\n');
    const f = await freezeInputs(run, [{ id: 'expenses', path: EXPENSES }, { id: 'notes', path: other }], { tableRoles: ['expenses'] });
    assert.equal(f.ok, true, f.red);
    const m = JSON.parse(readFileSync(path.join(run, 'inputs.json'), 'utf8'));
    const want = tableSha(sheetTable(parseCsv(readFileSync(path.join(run, 'inputs', 'expenses.csv'), 'utf8'))));
    assert.match(want, /^[0-9a-f]{64}$/);
    assert.equal(m.find((e) => e.id === 'expenses').tableSha, want, 'recorded from the FROZEN copy');
    assert.equal('tableSha' in m.find((e) => e.id === 'notes'), false, 'an input no sheet check names gets none');
    // read back: a later step (or a resumed run) gets the recorded sha, and nothing rewrites the file
    const before = readFileSync(path.join(run, 'inputs.json'), 'utf8');
    const read = readRunSheets(run, EXP_CHECKS());
    assert.equal(read.ok, true, read.red);
    assert.deepEqual(read.inputs, [{ name: 'expenses', sha256: want }]);
    assert.equal(readFileSync(path.join(run, 'inputs.json'), 'utf8'), before);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('the lock: a sheet bareguard cannot read as a table stops the run at start, naming the input, with no model call and $0', async () => {
  const run = tmp();
  try {
    const ragged = path.join(run, 'ragged.csv');
    writeFileSync(ragged, `${readFileSync(AGING, 'utf8')}INV-999,Customer 9,2026-03-01\n`);
    const f = await freezeInputs(path.join(run, 'r'), [{ id: 'aging', path: ragged }], { tableRoles: ['aging'] });
    assert.equal(f.ok, false);
    assert.match(f.red, /input "aging" cannot be read as a table/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('honest claims (rows over 500 and their count, computed here) are green; the run records them write-once and lists one row per signed check', async () => {
  assert.ok(OVER.length > 10, 'the truth is not trivial');
  const { run, out, rows } = await runStep(EXPENSES, 'expenses', EXP_CHECKS(), [{ over: { rows: OVER }, count: { value: OVER.length } }]);
  try {
    assert.equal(out.ok, true, out.red);
    assert.equal(rows.at(-1).verdict, 'green');
    const rec = lastRecord(run);
    assert.deepEqual(rec.map((l) => [l.n, l.try, l.passed]), [[2, 1, true]]);
    assert.equal(rec[0].tables[0].tableSha, JSON.parse(readFileSync(path.join(run, 'inputs.json'), 'utf8'))[0].tableSha, 'the check used the recorded tableSha');
    assert.deepEqual(rec[0].checks, EXP_CHECKS(), 'the signed checks are kept as they were signed');
    const tried = checksRows(run).at(-1).checks.filter((c) => c.n >= 3);
    assert.deepEqual(tried.map((c) => [c.text, c.ok]), [['rows \u2014 rows where Amount > 500', true], ['count \u2014 count of rows where Amount > 500', true]]);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a wrong count is red and names the claim; the wrong row list names the missing row; a red goes through the retry path, and the books balance', async () => {
  const wrongCount = { over: { rows: OVER }, count: { value: OVER.length + 1 } };
  const missing = { over: { rows: OVER.slice(1) }, count: { value: OVER.length } };
  const good = { over: { rows: OVER }, count: { value: OVER.length } };
  const one = await runStep(EXPENSES, 'expenses', EXP_CHECKS(), [wrongCount, missing, good]);
  try {
    assert.equal(one.out.ok, true, one.out.red);
    assert.deepEqual(one.rows.map((r) => r.verdict), ['red', 'red', 'green']);
    assert.match(one.rows[0].gap, /c_count: /);
    assert.ok(one.rows[0].gap.includes(`(${OVER.length + 1})`), `bareguard shows the claimed figure: ${one.rows[0].gap}`);
    assert.match(one.rows[1].gap, new RegExp(`c_over: .*rows: ${OVER[0]}\\b`));
    assert.equal(one.rows[0].gap.includes('Office'), false, 'no cell text');
    const sum = one.rows.reduce((a, r) => a + r.usd, 0);
    assert.ok(Math.abs(sum - one.spent.value) < 1e-9, `audit ${sum} vs spent ${one.spent.value}`);
    const rec = lastRecord(one.run);
    assert.deepEqual(rec.map((l) => [l.try, l.passed]), [[1, false], [2, false], [3, true]]);
    const cr = checksRows(one.run);
    assert.deepEqual(cr[0].checks.filter((c) => c.n >= 3).map((c) => c.ok), [true, false]);
  } finally { rmSync(one.run, { recursive: true, force: true }); }
});

test('a number given as a string is red claim-malformed, not green', async () => {
  const r = await runStep(EXPENSES, 'expenses', EXP_CHECKS(), [{ over: { rows: OVER }, count: { value: String(OVER.length) } }], {});
  try {
    assert.equal(r.rows[0].verdict, 'red');
    assert.match(r.rows[0].gap, /c_count: claim is malformed/);
  } finally { rmSync(r.run, { recursive: true, force: true }); }
});

test('days and bands on the aging sheet (computed here): honest is green; one wrong band is red naming that row; a table check needs no claim', async () => {
  const wrongBands = { ...AGING_BANDS, 3: 'Current' };
  const r = await runStep(AGING, 'aging', AGING_CHECKS(), [sheetAnswer(wrongBands), sheetAnswer(AGING_BANDS)]);
  try {
    assert.equal(r.out.ok, true, r.out.red);
    assert.deepEqual(r.rows.map((x) => x.verdict), ['red', 'green']);
    assert.match(r.rows[0].gap, /c_bands: .*: 3\b/);
    assert.equal(r.rows[0].gap.includes('c_days'), false, 'only the failing check is named');
    assert.deepEqual(checksRows(r.run)[0].checks.filter((c) => c.n >= 3).map((c) => [c.ok]), [[true], [false], [true]]);
  } finally { rmSync(r.run, { recursive: true, force: true }); }
});

test('the signed Negative: a saved sheet changed by one cell after the run started stops the check, naming the input (the model step is never trusted over the sheet)', async () => {
  const r = await runStep(EXPENSES, 'expenses', EXP_CHECKS(), [{ over: { rows: OVER }, count: { value: OVER.length } }], {
    mutate: (run) => { const f = path.join(run, 'inputs', 'expenses.csv'); writeFileSync(f, readFileSync(f, 'utf8').replace('item 0,336.19', 'item 0,336.20')); },
  });
  try {
    assert.equal(r.out.ok, false);
    assert.equal(r.out.outcome, 'close-casualty');
    assert.match(r.out.red, /input "expenses" - the saved sheet no longer gives the table this run recorded at its start/);
    assert.deepEqual(r.rows.map((x) => x.verdict), ['close-casualty']);
  } finally { rmSync(r.run, { recursive: true, force: true }); }
});

test('a run that recorded no fingerprint for the sheet (nothing named it at start) is never green', async () => {
  const run = tmp();
  try {
    await freezeInputs(run, [{ id: 'expenses', path: EXPENSES }]);
    const read = readRunSheets(run, EXP_CHECKS());
    assert.equal(read.ok, false);
    assert.match(read.red, /input "expenses": this run recorded no table fingerprint/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

// ---- a whole run: start records the sha, the frozen copy changed mid-run stops the next read at $0, books balance across a red then a green ----
const prose = readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8');
function agingWorld(checks) {
  const root = tmp();
  const d = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
  d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment'];
  d.steps[1].close = { class: 'green', sheet: checks };
  const csv = path.join(root, 'aging.csv');
  writeFileSync(csv, readFileSync(AGING));
  const text = sandboxSend(prose.replace('file:/home/hamr/fwdloop-out', 'file:poc/m0/out').replace(/source aging = file:.*/, `source aging = file:${csv}`));
  assert.equal(parseSignedText(text).ok, true);
  const w = writeFlow({ root, name: 'aging', proseText: text, declaration: d, signedBy: 'hamr', signedAt: '2026-10-22T00:00:00Z', catalogue: cat.primitives });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const go = (modelStep, runId = 'run-1', sources = [{ id: 'aging', path: csv }]) => runFlow({
    root, name: 'aging', runId, sources, catalogue: cat.primitives, modelStep, askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: AS_OF,
  });
  return { root, csv, go, runDir: (id = 'run-1') => path.join(root, 'aging', 'runs', id), flowDir: path.join(root, 'aging') };
}
const textStep = (ctx) => (ctx.goal.startsWith('Put each') ? null : { ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } });

test('a whole run: the start records the sha; a wrong band retries and goes green; the history total equals the audit sum', async () => {
  const w = agingWorld(AGING_CHECKS());
  try {
    let tries = 0;
    const r = await w.go(async (ctx) => textStep(ctx) ?? { ok: true, costUsd: 0.002, artifact: { ...sheetAnswer(tries++ === 0 ? { ...AGING_BANDS, 2: 'Current' } : AGING_BANDS), done: true } });
    assert.notEqual(r.outcome, 'red', r.red);
    const aud = readAudit(w.runDir());
    assert.deepEqual(aud.filter((x) => x.step === 'bucket_assignment').map((x) => x.verdict), ['red', 'green']);
    const manifest = JSON.parse(readFileSync(path.join(w.runDir(), 'inputs.json'), 'utf8'));
    assert.equal(manifest[0].tableSha, tableSha(sheetTable(parseCsv(readFileSync(w.csv, 'utf8')))));
    const hist = readHistory(w.flowDir).at(-1);
    const sum = aud.reduce((a, x) => a + (typeof x.usd === 'number' ? x.usd : 0), 0);
    assert.ok(Math.abs(hist.spentUsd - sum) < 1e-9, `history ${hist.spentUsd} vs audit ${sum}`);
    assert.deepEqual(lastRecord(w.runDir()).map((l) => [l.n, l.try, l.passed]), [[2, 1, false], [2, 2, true]]);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test('a whole run: a ragged sheet stops the run at start ($0, no model call), naming the input', async () => {
  const w = agingWorld(AGING_CHECKS());
  try {
    const bad = path.join(w.root, 'ragged.csv');
    writeFileSync(bad, `${readFileSync(AGING, 'utf8')}INV-999,Customer 9,2026-03-01\n`);
    let calls = 0;
    const r = await w.go(async () => { calls += 1; return { ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } }; }, 'run-2', [{ id: 'aging', path: bad }]);
    assert.equal(r.outcome, 'preflight-red');
    assert.match(r.red, /input "aging" cannot be read as a table/);
    assert.equal(calls, 0);
    assert.equal(readHistory(w.flowDir).at(-1).spentUsd, 0);
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

test('a whole run: the frozen copy changed after the start stops the next read at $0, naming the input; the model is not asked', async () => {
  const w = agingWorld(AGING_CHECKS());
  try {
    let sheetCalls = 0;
    const r = await w.go(async (ctx) => {
      if (!ctx.goal.startsWith('Put each')) {
        const f = path.join(w.runDir(), 'inputs', 'aging.csv');
        writeFileSync(f, readFileSync(f, 'utf8').replace('200.00', '200.01'));
        return { ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } };
      }
      sheetCalls += 1;
      return { ok: true, costUsd: 0.001, artifact: { ...sheetAnswer(AGING_BANDS), done: true } };
    });
    assert.equal(sheetCalls, 0, 'the sheet step never reached the model');
    assert.match(String(r.red), /input "aging"/);
    assert.notEqual(r.outcome, 'accepted');
  } finally { rmSync(w.root, { recursive: true, force: true }); }
});

// ---- what the step is told and the box it answers in ----
test('the box per op is generated from bareguard\'s worked example: required keys and values match it, for every cells op that has a claim', () => {
  const ops = rubricVocabulary.rules.cells.ops;
  const typeOk = (s, v) => {
    if (Array.isArray(s.type)) return s.type.some((t) => typeOk({ ...s, type: t }, v));
    if (s.type === 'boolean') return typeof v === 'boolean';
    if (s.type === 'number') return typeof v === 'number';
    if (s.type === 'integer') return Number.isInteger(v);
    if (s.type === 'string') return typeof v === 'string';
    if (s.type === 'array') return Array.isArray(v) && v.every((x) => !s.items || typeOk(s.items, x));
    if (s.type === 'object' && s.additionalProperties) return Object.values(v).every((x) => typeOk(s.additionalProperties, x));
    if (s.type === 'object') return (s.required ?? []).every((k) => k in v) && Object.entries(s.properties ?? {}).every(([k, p]) => !(k in v) || typeOk(p, v[k]));
    return true;
  };
  let n = 0;
  for (const [op, d] of Object.entries(ops)) {
    const claim = d.example.check.claim;
    const checks = [{ ...d.example.check, table: 't' }];
    const { properties, required } = sheetAnswerProps(checks);
    assert.deepEqual(required, [claim], op);
    assert.ok(typeOk(properties[claim], d.example.output[claim]), `${op}: ${JSON.stringify(properties[claim])} vs ${JSON.stringify(d.example.output[claim])}`);
    assert.deepEqual(sheetBrief(checks).fields[claim], d.example.output[claim], `${op}: the step is told the example, as bareguard has it`);
    n += 1;
  }
  assert.ok(n >= 20, `${n} ops`);
  // a wrong-typed claim does not fit its box
  assert.equal(typeOk(sheetAnswerProps(EXP_CHECKS()).properties.count, { value: '18' }), false);
  assert.equal(typeOk(sheetAnswerProps(EXP_CHECKS()).properties.over, { rows: [2.5] }), false);
});

test('the tool schema of a sheet step: one box per claim plus done, no cite, no fields; a step without close.sheet is unchanged', () => {
  const s = buildEmitArtifactSchema('green', false, [...AGING_CHECKS()]);
  assert.deepEqual(Object.keys(s.properties).sort(), ['bands', 'blocker', 'days', 'done'], 'the table check has no claim, so no box');
  assert.deepEqual(s.required.sort(), ['bands', 'days', 'done']);
  assert.equal(s.additionalProperties, false);
  assert.equal(JSON.stringify(s).includes('cite'), false);
  assert.deepEqual(buildEmitArtifactSchema('green'), buildEmitArtifactSchema('green', false, null));
  assert.ok(buildEmitArtifactSchema('green').properties.fields.additionalProperties.properties.cite);
  assert.deepEqual(sheetClaims(AGING_CHECKS()).map((c) => c.claim), ['days', 'bands']);
});

test('the request of a sheet step carries the claim names and shapes and nothing of its checks', async () => {
  const d = tmp();
  try {
    let first = null;
    const provider = { generate: async (messages, tools) => {
      first ??= JSON.stringify({ messages, tools });
      return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
    } };
    const step = makeLiveModelStep({ spendPath: path.join(d, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
    await step({ goal: 'Count the expenses over 500', primitives: [], reads: {}, gap: null }, {}, { class: 'green', cited: null, sheet: [...EXP_CHECKS(), ...AGING_CHECKS()] });
    assert.ok(first.includes('Count the expenses over 500'), 'the goal is the signed line');
    for (const claim of ['over', 'count', 'days', 'bands']) assert.ok(first.includes(`\\"${claim}\\"`) || first.includes(`"${claim}"`), claim);
    assert.ok(first.includes(JSON.stringify(rubricVocabulary.rules.cells.ops.rows.example.output.answer).replaceAll('"', '\\"')), 'the rows example is told as bareguard has it');
    assert.ok(first.includes('never a cell reference and never a formula'));
    for (const secret of ['c_over', 'c_count', 'c_days', 'c_bands', 'c_dup', 'countIf', 'daysSince', 'noDuplicates', 'where', 'cmp', 'Amount', 'Due date', 'Invoice #', 'asOf', '2026-10-11', 'dateFormats', 'lte', 'rule', 'daysBetween']) {
      assert.equal(first.includes(secret), false, `the request carries "${secret}"`);
    }
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test('no second writer: inputs.json is written by freezeInputs only', () => {
  const writers = readdirSync(path.join(HERE, '..', 'src')).filter((f) => f.endsWith('.js') && /writeFileSync\([^)]*inputs\.json/.test(readFileSync(path.join(HERE, '..', 'src', f), 'utf8')));
  assert.deepEqual(writers, ['runner.js']);
});
