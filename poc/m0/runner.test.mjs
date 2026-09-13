import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeFileSync, mkdtempSync, readFileSync, mkdirSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.mjs';
import { hashFile } from './close.mjs';
import { parseArbiterSlots } from './validator.mjs';
import {
  renderCsvArtifact, renderTextArtifact, generatePlantCCsv, applyPlant, BUSINESS_DATE, runDeclaration, OUT_DIR,
  freezeInputs, bindSteps, checkGrants, checkSendDestination, preflight, runOnPrimitives,
} from './runner.mjs';

// Derived from this file's own location, never process.cwd() — the same pattern every sibling
// test file (drafter.test.mjs, scout.test.mjs) already uses. A path built off process.cwd()
// only works when `node --test` happens to be invoked from the repo root; from poc/m0 itself it
// silently resolves to a poc/m0/poc/m0/ litter directory instead of failing loudly.
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');

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
  const fixturePath = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
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
  const outDir = join(OUT_DIR, runId);
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
  const sentPath = join(OUT_DIR, runId, 'sent.txt');
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

// ---------------------------------------------------------------------------
// M0b PART 2.1 — PREFLIGHT (2026-09-13). freezeInputs / bindSteps /
// checkGrants / checkSendDestination / preflight / runOnPrimitives. Every
// check runs at $0, before any model call: tests prove zero modelStep calls
// and zero spend rows on every refusal.
// ---------------------------------------------------------------------------

const SIGNED_GUARDRAILS = [
  '1. When the AR aging sheet lands, read it,',
  '2. then read the chat message and work out which customer it is about.',
  '   guardrail: if more than one customer matches, ask me, do not pick',
  '3. Pull their open invoices, what they owe in total, the earliest due date, and how many are overdue as of the business date.',
  '   guardrail: every number must point to the cell it came from or the formula that made it',
  '4. Write me a short reply with one line per invoice,',
  '   guardrail: one line per invoice in the reply',
  '5. check it with me,',
  '   guardrail: nothing goes out before I accept',
  '6. and send it once I accept.',
  '',
  'Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):',
  'guardrail: cap $0.25 per run',
  'guardrail: ask at line 5',
  'guardrail: send at line 6 to file:poc/m0/out',
].join('\n');

function primitivesDeclaration() {
  return {
    skills: ['core'],
    guardrails: SIGNED_GUARDRAILS,
    guardrailClasses: {
      2: 'hitl', 3: 'green', 4: 'softgreen', 5: 'hitl',
    },
    steps: [
      {
        goal: 'read the sheet', primitives: ['read', 'addressCells'], reads: [], emits: 'aging-sheet', fromLine: 1,
      },
      {
        goal: 'read the message and match the customer', primitives: ['read'], reads: ['aging-sheet'], emits: 'customer-match', fromLine: 2,
      },
      {
        goal: 'derive totals', primitives: [], reads: ['aging-sheet', 'customer-match'], emits: 'ar-summary', fromLine: 3, close: { class: 'green' },
      },
      {
        goal: 'compose reply', primitives: [], reads: ['ar-summary'], emits: 'reply-draft', fromLine: 4, close: { class: 'softgreen', shape: { linePerInvoice: true } },
      },
      {
        goal: 'check with me', primitives: ['checkpoint'], reads: ['reply-draft'], emits: 'accepted-reply', fromLine: 5,
      },
      {
        goal: 'send', primitives: ['write'], reads: ['accepted-reply'], emits: 'sent-confirmation', fromLine: 6,
      },
    ],
  };
}

function tempRunDir() {
  return mkdtempSync(join(tmpdir(), 'm0-preflight-'));
}

function realSources() {
  return [
    { id: 'sheet', path: join(REPO_ROOT, 'fixtures', 'ar-aging.csv') },
    { id: 'message', path: join(REPO_ROOT, 'fixtures', 'message.txt') },
  ];
}

// --- freezeInputs -----------------------------------------------------

test('freezeInputs copies real sources into <runDir>/inputs/, hashes the FROZEN copy, writes inputs.json', () => {
  const runDir = tempRunDir();
  const result = freezeInputs(runDir, realSources());
  assert.equal(result.ok, true);
  assert.equal(result.manifest.length, 2);
  for (const entry of result.manifest) {
    assert.equal(hashFile(entry.frozen), entry.sha256, 'the manifest hash must match the frozen copy on disk');
    assert.ok(entry.bytes > 0);
  }
  const written = JSON.parse(readFileSync(join(runDir, 'inputs.json'), 'utf8'));
  assert.deepEqual(written, result.manifest);
});

test('PROOF freezeInputs can fail: an unreadable source refuses by name, before writing any manifest entry for it', () => {
  const runDir = tempRunDir();
  const result = freezeInputs(runDir, [{ id: 'ghost', path: join(REPO_ROOT, 'fixtures', 'does-not-exist.csv') }]);
  assert.equal(result.ok, false);
  assert.match(result.red, /freeze: input "ghost" is unreadable at/);
});

// --- bindSteps ----------------------------------------------------------

test('bindSteps finds exactly one step per stage, keyed by fromLine, including the SIGNED ask/send lines', () => {
  const decl = primitivesDeclaration();
  const { slots } = parseArbiterSlots(decl.guardrails);
  const result = bindSteps(decl, slots);
  assert.equal(result.ok, true);
  assert.equal(result.stages.sheetRead.fromLine, 1);
  assert.equal(result.stages.messageMatch.fromLine, 2);
  assert.equal(result.stages.derive.fromLine, 3);
  assert.equal(result.stages.compose.fromLine, 4);
  assert.equal(result.stages.ask.fromLine, 5);
  assert.equal(result.stages.send.fromLine, 6);
});

test('PROOF bindSteps can fail: a line with 0 steps refuses naming the line and the count', () => {
  const decl = primitivesDeclaration();
  decl.steps.splice(2, 1); // drop the fromLine:3 (derive) step
  const { slots } = parseArbiterSlots(decl.guardrails);
  const result = bindSteps(decl, slots);
  assert.equal(result.ok, false);
  assert.match(result.red, /bind: line 3 \(stage "derive"\) has 0 step\(s\)/);
});

test('bindSteps refuses a line with 2+ steps, naming the line and the count', () => {
  const decl = primitivesDeclaration();
  decl.steps.push({
    goal: 'duplicate derive', primitives: [], reads: ['aging-sheet'], emits: 'ar-summary-2', fromLine: 3,
  });
  const { slots } = parseArbiterSlots(decl.guardrails);
  const result = bindSteps(decl, slots);
  assert.equal(result.ok, false);
  assert.match(result.red, /bind: line 3 \(stage "derive"\) has 2 step\(s\)/);
});

// --- checkGrants ----------------------------------------------------------

test('checkGrants passes when every stage carries the primitives the brief requires', () => {
  const decl = primitivesDeclaration();
  const { slots } = parseArbiterSlots(decl.guardrails);
  const { stages } = bindSteps(decl, slots);
  assert.equal(checkGrants(stages).ok, true);
});

test('PROOF checkGrants can fail: the sheet-read stage missing "addressCells" refuses naming the step, line and verb', () => {
  const decl = primitivesDeclaration();
  decl.steps[0].primitives = ['read']; // drops addressCells
  const { slots } = parseArbiterSlots(decl.guardrails);
  const { stages } = bindSteps(decl, slots);
  const result = checkGrants(stages);
  assert.equal(result.ok, false);
  assert.match(result.red, /grants: step for line 1 \(stage "sheetRead"\) is not granted "addressCells"/);
});

test('checkGrants: the send stage missing "write" refuses naming it', () => {
  const decl = primitivesDeclaration();
  decl.steps[5].primitives = [];
  const { slots } = parseArbiterSlots(decl.guardrails);
  const { stages } = bindSteps(decl, slots);
  const result = checkGrants(stages);
  assert.equal(result.ok, false);
  assert.match(result.red, /grants: step for line 6 \(stage "send"\) is not granted "write"/);
});

test('checkGrants never checks the ask stage — Checkpoint carries no grant requirement (its position is arbiter)', () => {
  const decl = primitivesDeclaration();
  decl.steps[4].primitives = []; // ask stage, no primitives granted at all
  const { slots } = parseArbiterSlots(decl.guardrails);
  const { stages } = bindSteps(decl, slots);
  assert.equal(checkGrants(stages).ok, true);
});

// --- checkSendDestination ------------------------------------------------

test('checkSendDestination passes for the real, writable poc/m0/out directory', () => {
  const result = checkSendDestination('file:poc/m0/out');
  assert.equal(result.ok, true);
  assert.match(result.dir, /poc\/m0\/out$/);
});

test('PROOF checkSendDestination can fail: a non-existent directory refuses, naming it', () => {
  const result = checkSendDestination(`file:poc/m0/does-not-exist-${Date.now()}`);
  assert.equal(result.ok, false);
  assert.match(result.red, /destination: send target directory .* is not writable/);
});

test('checkSendDestination refuses a non-"file:" target outright', () => {
  const result = checkSendDestination('mailto:someone@example.com');
  assert.equal(result.ok, false);
  assert.match(result.red, /is not a "file:<path>" target/);
});

// --- preflight (full chain) -----------------------------------------------

test('preflight passes end to end on a clean, slotted declaration with real inputs', () => {
  const runDir = tempRunDir();
  const spendPath = join(runDir, 'spend.jsonl'); // fresh — no rows, well under cap
  const result = preflight(primitivesDeclaration(), { runDir, sources: realSources(), spendPath });
  assert.equal(result.ok, true);
  assert.equal(result.stages.send.fromLine, 6);
  assert.equal(result.inputsManifest.length, 2);
  assert.equal(result.arbiterSlots.send.target, 'file:poc/m0/out');
});

test('PROOF preflight can fail: validate()\'s own red (Part 1\'s send lock) surfaces through preflight unchanged', () => {
  const runDir = tempRunDir();
  const decl = primitivesDeclaration();
  decl.steps[5].primitives = []; // Part 1's send-lock red: send step not granted "write"
  const result = preflight(decl, { runDir, sources: realSources(), spendPath: join(runDir, 'spend.jsonl') });
  assert.equal(result.ok, false);
  assert.match(result.red, /the send step \(fromLine 6\) is not granted "write"/);
});

test('PROOF preflight can fail: an unwritable send destination refuses even though validate()/bind/grants all pass', () => {
  const runDir = tempRunDir();
  const decl = primitivesDeclaration();
  decl.guardrails = decl.guardrails.replace('send at line 6 to file:poc/m0/out', `send at line 6 to file:poc/m0/no-such-dir-${Date.now()}`);
  const result = preflight(decl, { runDir, sources: realSources(), spendPath: join(runDir, 'spend.jsonl') });
  assert.equal(result.ok, false);
  assert.match(result.red, /destination: send target directory .* is not writable/);
});

test('preflight refuses under the global spend cap, naming the cap, before freezing anything', () => {
  const runDir = tempRunDir();
  const spendPath = join(runDir, 'spend.jsonl');
  mkdirSync(dirname(spendPath), { recursive: true });
  writeFileSync(spendPath, `${JSON.stringify({ costUsd: 5.0 })}\n`); // already at the $5 global cap
  const result = preflight(primitivesDeclaration(), { runDir, sources: realSources(), spendPath });
  assert.equal(result.ok, false);
  assert.match(result.red, /^cap: global spend cap reached/);
});

// --- runOnPrimitives — zero modelStep calls, zero spend rows on refusal --

test('runOnPrimitives never calls modelStep and appends zero spend rows on a preflight refusal', async () => {
  const runId = `test-preflight-refusal-${Date.now()}`;
  const runDir = join(OUT_DIR, runId);
  const spendPath = join(runDir, 'spend.jsonl');
  const decl = primitivesDeclaration();
  decl.steps[5].primitives = []; // any preflight red will do — this one is Part 1's send lock
  let modelStepCalls = 0;
  const spyModelStep = async () => { modelStepCalls += 1; return {}; };
  const result = await runOnPrimitives({
    declaration: decl, runId, outDir: runDir, sources: realSources(), spendPath, modelStep: spyModelStep,
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'preflight');
  assert.equal(modelStepCalls, 0, 'modelStep must never be called when preflight refuses');
  const spendRows = existsSync(spendPath) ? readFileSync(spendPath, 'utf8').split('\n').filter((l) => l.trim()) : [];
  assert.equal(spendRows.length, 0, 'no spend row may be appended on a preflight refusal');
});

test('PROOF the above can fail: a genuinely clean declaration passes preflight and modelStep WOULD be reachable (execution phase not yet built)', async () => {
  const runId = `test-preflight-clean-${Date.now()}`;
  const runDir = join(OUT_DIR, runId);
  const spendPath = join(runDir, 'spend.jsonl');
  let modelStepCalls = 0;
  const spyModelStep = async () => { modelStepCalls += 1; return {}; };
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId, outDir: runDir, sources: realSources(), spendPath, modelStep: spyModelStep,
  });
  // 2.1 ships preflight only — the execution phase (2.2/2.3) lands in later commits, so a clean
  // declaration reaches "execution not yet built" today rather than actually calling modelStep.
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'execution');
  assert.equal(result.pre.ok, true, 'preflight itself must have passed for this declaration');
  assert.equal(modelStepCalls, 0);
});
