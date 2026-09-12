import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeFileSync, mkdtempSync, readFileSync, mkdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';
import { hashFile } from './close.mjs';
import {
  renderCsvArtifact, renderTextArtifact, generatePlantCCsv, applyPlant, BUSINESS_DATE, runDeclaration,
} from './runner.mjs';

// F9/finding 2: runDeclaration's rate lookup now delegates to provider.mjs's resolveModelRate —
// the ONE writer for suffix-strip + table-lookup — rather than a second hand-rolled copy. A
// model suffix naming an inherited Object.prototype member ("constructor") is the proof: the old
// hand-rolled `RATES_BY_SUFFIX[suffix]` truthiness check would have resolved to the inherited
// function and never thrown, letting the run proceed with rates.in/rates.out undefined.
test('runDeclaration rejects a poisoned model suffix via the shared resolveModelRate, never silently proceeding', async () => {
  await assert.rejects(
    () => runDeclaration({
      modelId: 'constructor', plant: 'd', runId: `test-poisoned-rate-${Date.now()}`, apiKeyOverride: 'stub-key',
    }),
    /no hand-entered rate for model suffix "constructor"/,
  );
});

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

// ---------------------------------------------------------------------------
// Fold-level happened() wiring (Ruling 3), proven with a stubbed `modelStep`
// injected into runDeclaration — $0, no network. A clean derive1 result
// (real fixture, real customer match) is shared by every stub below so each
// test only needs to vary the step under test.
// ---------------------------------------------------------------------------

const CLEAN_DERIVE1_ARGS = {
  citations: [
    { id: 'c1', quote: 'Northwind', source: { kind: 'text', artifact: 'a2', line: 1 } },
    { id: 'c2', value: 'Northwind Trading', source: { kind: 'csv', artifact: 'a1', cell: 'A2' } },
  ],
  matches: ['c2'],
};

// The fully correct derive2 citations for Northwind Trading (rows E2=4200 due 2026-06-09,
// E3=1500 due 2026-05-20) against BUSINESS_DATE 2026-06-01: total 5700, earliest due
// 2026-05-20, one invoice (INV-1009) overdue by 12 days.
const CLEAN_DERIVE2_ARGS = {
  citations: [
    { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'a1', cell: 'E2' } },
    { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'a1', cell: 'E3' } },
    {
      id: 'c3', value: 5700, formula: 'sum', inputs: ['c1', 'c2'],
    },
    { id: 'c4', value: '2026-05-20', source: { kind: 'csv', artifact: 'a1', cell: 'D3' } },
    {
      id: 'c5', value: 12, formula: 'daysBetween', inputs: ['c4'],
    },
    { id: 'c6', value: '2026-06-09', source: { kind: 'csv', artifact: 'a1', cell: 'D2' } },
    {
      id: 'c7', value: -8, formula: 'daysBetween', inputs: ['c6'],
    },
    {
      id: 'c8', value: 1, formula: 'count', inputs: ['c5'],
    },
  ],
  fields: { total_owed: 'c3', earliest_due: 'c4', count_overdue: 'c8' },
};

const CLEAN_COMPOSE_ARGS = {
  citations: CLEAN_DERIVE2_ARGS.citations,
  text: 'Northwind Trading owes 5700[c3], earliest due 2026-05-20[c4], with 1[c8] invoice overdue.',
};

/** Injected modelStep stub: returns a canned `args` per stepLabel, no network, no metering. */
function stubModelStep(argsByStep) {
  return async ({ stepLabel }) => {
    if (!(stepLabel in argsByStep)) throw new Error(`stubModelStep: no stub wired for step "${stepLabel}"`);
    return {
      args: argsByStep[stepLabel], metering: null, wallMs: 1, stopReason: 'end_turn', attempt: 1,
    };
  };
}

/** Pre-answer the runner's final send-ask so a stubbed run can reach `send` without a human. */
function preAnswerFinalAsk(runId) {
  const outDir = join(process.cwd(), 'poc', 'm0', 'out', runId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'answer.json'), JSON.stringify({ decision: 'accept', text: null }));
  return outDir;
}

test('PROOF the test can fail: a clean stubbed run (derive1/derive2/compose all well-formed) completes and sends non-empty bytes', async () => {
  const runId = `test-happened-clean-${Date.now()}`;
  preAnswerFinalAsk(runId);
  const modelStep = stubModelStep({
    derive1: CLEAN_DERIVE1_ARGS, derive2: CLEAN_DERIVE2_ARGS, compose: CLEAN_COMPOSE_ARGS,
  });
  const result = await runDeclaration({
    modelId: 'deepseek-flash', plant: 'd', runId, apiKeyOverride: 'stub-key', askTimeoutMs: 3000, modelStep,
  });
  assert.equal(result.outcome, 'complete');
  const sentPath = join(process.cwd(), 'poc', 'm0', 'out', runId, 'sent.txt');
  const sentBytes = readFileSync(sentPath);
  assert.ok(sentBytes.byteLength > 0, 'sent.txt must not be 0 bytes on a clean run');
  const sendStep = result.log.steps.find((s) => s.step === 'send');
  assert.equal(sendStep.outcome, 'green');
});

test('derive2 returning {citations: [], fields: {}} reds on "happened:", naming derive2, before closeDerive ever runs', async () => {
  const runId = `test-happened-derive2-empty-${Date.now()}`;
  const modelStep = stubModelStep({
    derive1: CLEAN_DERIVE1_ARGS, derive2: { citations: [], fields: {} },
  });
  const result = await runDeclaration({
    modelId: 'deepseek-flash', plant: 'd', runId, apiKeyOverride: 'stub-key', askTimeoutMs: 3000, modelStep,
  });
  assert.equal(result.outcome, 'red');
  assert.match(result.red, /^happened:/);
  assert.match(result.red, /derive2/);
  const derive2Step = result.log.steps.find((s) => s.step === 'derive2');
  assert.match(derive2Step.red, /^happened:/);
  // closeDerive's own completeness/grounding reds never fire — this must be the happened() red,
  // not e.g. "output missing required field" or a citation/evidence gap message.
  assert.doesNotMatch(derive2Step.red, /missing required field|does not resolve|input drift/);
});

test('compose returning text: "" reds on "happened:", not on completeness/bracket checks', async () => {
  const runId = `test-happened-compose-empty-${Date.now()}`;
  const modelStep = stubModelStep({
    derive1: CLEAN_DERIVE1_ARGS,
    derive2: CLEAN_DERIVE2_ARGS,
    compose: { citations: CLEAN_DERIVE2_ARGS.citations, text: '' },
  });
  const result = await runDeclaration({
    modelId: 'deepseek-flash', plant: 'd', runId, apiKeyOverride: 'stub-key', askTimeoutMs: 3000, modelStep,
  });
  assert.equal(result.outcome, 'red');
  assert.match(result.red, /^happened:/);
  const composeStep = result.log.steps.find((s) => s.step === 'compose');
  assert.match(composeStep.red, /^happened:/);
  assert.doesNotMatch(composeStep.red, /declared field|bracket|bare \(uncited\) number/);
});

test('send writing a 0-byte sent.txt reds the run on "happened:" and is never logged green', async () => {
  // Goes through the real fold: every step before send is clean, and the injected send writes
  // zero bytes to disk no matter what it is handed — a truncated or failed write. The effect
  // check must read the file actually on disk, so this is the only way to reach it: compose's own
  // happened() check stops an empty reply before send ever sees it.
  const runId = `test-happened-send-zero-${Date.now()}`;
  preAnswerFinalAsk(runId);
  const modelStep = stubModelStep({
    derive1: CLEAN_DERIVE1_ARGS, derive2: CLEAN_DERIVE2_ARGS, compose: CLEAN_COMPOSE_ARGS,
  });
  const zeroByteSend = (id, target, _content, { outDir }) => {
    const deliveryPath = join(outDir, 'sent.txt');
    writeFileSync(deliveryPath, '');
    return { deliveryId: deliveryPath };
  };
  const result = await runDeclaration({
    modelId: 'deepseek-flash', plant: 'd', runId, apiKeyOverride: 'stub-key', askTimeoutMs: 3000,
    modelStep, sendFn: zeroByteSend,
  });
  assert.equal(result.outcome, 'red');
  assert.match(result.red, /^happened:.*zero bytes/);
  const sendSteps = result.log.steps.filter((st) => st.step === 'send');
  assert.equal(sendSteps.length, 1);
  assert.equal(sendSteps[0].outcome, 'red');
});
