import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  writeFileSync, mkdtempSync, readFileSync, mkdirSync, existsSync, symlinkSync, rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseCsv } from './csv.mjs';
import { hashFile } from './close.mjs';
import { parseArbiterSlots } from './validator.mjs';
import {
  renderCsvArtifact, renderTextArtifact, generatePlantCCsv, applyPlant, BUSINESS_DATE, runDeclaration, OUT_DIR,
  freezeInputs, bindSteps, checkGrants, checkSendDestination, checkFreshRunDir, preflight, runOnPrimitives,
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
        goal: 'compose reply', primitives: [], reads: ['ar-summary'], emits: 'reply-draft', fromLine: 4, close: { class: 'softgreen', shape: { linesPerInvoice: 1 } },
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

// The runner now agrees with the drafter's menu (catalogue.mjs): addressCells alone reads the
// sheet. readFrozenCsv (line ~558) never calls a separate "read" primitive at runtime — it goes
// straight through shell_read then addressCells's own parseCsv — so sheetRead's grant requirement
// must not demand "read" too, or a declaration that follows the menu refuses at preflight forever.

test('checkGrants passes for a sheet-read stage granted ONLY "addressCells" (no "read") — the menu-matching shape', () => {
  const decl = primitivesDeclaration();
  decl.steps[0].primitives = ['addressCells']; // menu shape: addressCells alone
  const { slots } = parseArbiterSlots(decl.guardrails);
  const { stages } = bindSteps(decl, slots);
  assert.equal(checkGrants(stages).ok, true);
});

test('PROOF checkGrants can fail: a sheet-read stage granted ONLY "read" (no "addressCells") still refuses, naming "addressCells"', () => {
  const decl = primitivesDeclaration();
  decl.steps[0].primitives = ['read']; // the inverse shape: read alone is never enough
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

test('checkSendDestination refuses a target that resolves outside the repo via ..', () => {
  const result = checkSendDestination('file:../outside');
  assert.equal(result.ok, false);
  assert.match(result.red, /resolves outside the repo/);
});

test('checkSendDestination refuses a symlink inside the repo that resolves outside it', () => {
  const outsideDir = mkdtempSync(join(tmpdir(), 'fwdloop-outside-'));
  const linkName = `symlink-escape-${Date.now()}`;
  const linkPath = join(REPO_ROOT, 'poc', 'm0', 'out', linkName);
  try {
    symlinkSync(outsideDir, linkPath);
    const result = checkSendDestination(`file:poc/m0/out/${linkName}`);
    assert.equal(result.ok, false);
    assert.match(result.red, /symlink/);
  } finally {
    rmSync(linkPath, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

test('checkSendDestination passes for a symlink inside the repo that resolves to another dir inside the repo', () => {
  const linkName = `symlink-internal-${Date.now()}`;
  const linkPath = join(REPO_ROOT, 'poc', 'm0', 'out', linkName);
  try {
    symlinkSync(join(REPO_ROOT, 'poc', 'm0'), linkPath);
    const result = checkSendDestination(`file:poc/m0/out/${linkName}`);
    assert.equal(result.ok, true);
  } finally {
    rmSync(linkPath, { force: true });
  }
});

test('checkSendDestination still passes a target that normalizes back inside the repo', () => {
  const result = checkSendDestination('file:poc/m0/out/../out');
  assert.equal(result.ok, true);
  assert.match(result.dir, /poc\/m0\/out$/);
});

test('checkSendDestination: an absolute-looking target stays inside the repo (join, not resolve, semantics)', () => {
  // join(REPO_ROOT, '/tmp') === REPO_ROOT/tmp — this is documented, existing
  // behaviour of node:path join and is NOT changed here; it just needs a
  // writable poc/m0/out-shaped equivalent to assert against, so use a target
  // that also resolves under REPO_ROOT via the leading-slash join quirk.
  const result = checkSendDestination('file:/poc/m0/out');
  assert.equal(result.ok, true);
  assert.match(result.dir, /poc\/m0\/out$/);
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

// Real evidence: two fresh live drafts (deepseek and Qwen/synthetic) both wrote line 1's
// primitives as ["addressCells"] alone, matching the drafter's own menu (catalogue.mjs:117,179),
// and both refused at preflight under the old ['read','addressCells'] requirement. Their
// `declaration` fields are untracked in poc/m0/out/, so they are copied here as fixtures rather
// than depended on live: fixture-declaration-deepseek-1789376520136.json and
// fixture-declaration-qwen-1789376657229.json.
test('preflight passes on the REAL deepseek and Qwen draft declarations that follow the menu (addressCells alone on line 1)', () => {
  for (const fixture of ['fixture-declaration-deepseek-1789376520136.json', 'fixture-declaration-qwen-1789376657229.json']) {
    const decl = JSON.parse(readFileSync(join(__dirname, fixture), 'utf8'));
    const runDir = tempRunDir();
    const result = preflight(decl, { runDir, sources: realSources(), spendPath: join(runDir, 'spend.jsonl') });
    assert.equal(result.ok, true, `${fixture}: expected preflight to pass, got red: ${result.red}`);
  }
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

// --- FIX 3 (2026-09-13 live run): stale answer.json/ask.json = pre-accept ---
// A run dir reused across runs (same --run-id) that already holds an answer
// from an EARLIER run must never be treated as this run's accept. Refuses at
// $0, before freeze — checkFreshRunDir is a pure filesystem check.

test('checkFreshRunDir passes on a brand-new run dir', () => {
  assert.equal(checkFreshRunDir(tempRunDir()).ok, true);
});

test('PROOF checkFreshRunDir can fail: a run dir already holding ask.json refuses, naming the file and the path', () => {
  const runDir = tempRunDir();
  writeFileSync(join(runDir, 'ask.json'), '{}');
  const result = checkFreshRunDir(runDir);
  assert.equal(result.ok, false);
  assert.match(result.red, new RegExp(`run dir ${runDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} already holds ask\\.json from an earlier run`));
});

test('checkFreshRunDir also refuses on a pre-existing answer.json alone (no ask.json)', () => {
  const runDir = tempRunDir();
  writeFileSync(join(runDir, 'answer.json'), '{}');
  const result = checkFreshRunDir(runDir);
  assert.equal(result.ok, false);
  assert.match(result.red, /already holds answer\.json from an earlier run — use a new --run-id/);
});

// The real evidence named in the fix: two run dirs from hamr's live M0b run (2026-09-13)
// genuinely held answer.json (and ask.json) from that earlier run. poc/m0/out/* is
// git-ignored, so those dirs are absent on CI — a fixture is a committed, verbatim copy of
// the two files from that run, under poc/m0/fixtures/stale-run/<runId>/. The test copies the
// fixture into a fresh tempRunDir() so it runs the same locally and on CI.
test('preflight refuses on a stale run dir seeded from the REAL m0b-ds-c and m0b-ds-d live-run evidence', () => {
  for (const runId of ['m0b-ds-c', 'm0b-ds-d']) {
    const fixtureDir = join(__dirname, 'fixtures', 'stale-run', runId);
    assert.ok(existsSync(join(fixtureDir, 'answer.json')), `expected ${fixtureDir}/answer.json to exist (committed fixture)`);
    const runDir = tempRunDir();
    writeFileSync(join(runDir, 'answer.json'), readFileSync(join(fixtureDir, 'answer.json')));
    writeFileSync(join(runDir, 'ask.json'), readFileSync(join(fixtureDir, 'ask.json')));
    const result = preflight(primitivesDeclaration(), {
      runDir, sources: realSources(), spendPath: join(tempRunDir(), 'spend.jsonl'),
    });
    assert.equal(result.ok, false);
    assert.match(result.red, /already holds (ask|answer)\.json from an earlier run — use a new --run-id/);
  }
});

test('PROOF the above can fail: preflight passes on a FRESH run dir with the same declaration/sources', () => {
  const runDir = tempRunDir();
  const result = preflight(primitivesDeclaration(), { runDir, sources: realSources(), spendPath: join(runDir, 'spend.jsonl') });
  assert.equal(result.ok, true);
});

test('runOnPrimitives on a stale run dir never calls modelStep — the stale-answer refusal happens before any model round', async () => {
  // Seeded from the committed fixture (poc/m0/fixtures/stale-run/m0b-ds-d/), a verbatim copy of
  // hamr's real 2026-09-13 live-run answer.json/ask.json — poc/m0/out/* is git-ignored so the
  // original run dir is absent on CI.
  const fixtureDir = join(__dirname, 'fixtures', 'stale-run', 'm0b-ds-d');
  assert.ok(existsSync(join(fixtureDir, 'answer.json')), `expected ${fixtureDir}/answer.json to exist (committed fixture)`);
  const runDir = tempRunDir();
  writeFileSync(join(runDir, 'answer.json'), readFileSync(join(fixtureDir, 'answer.json')));
  writeFileSync(join(runDir, 'ask.json'), readFileSync(join(fixtureDir, 'ask.json')));
  let modelStepCalls = 0;
  const spyModelStep = async () => { modelStepCalls += 1; return { ok: false, red: 'must not be called' }; };
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: 'm0b-ds-d', outDir: runDir, sources: realSources(),
    spendPath: join(tempRunDir(), 'spend.jsonl'), plant: 'd', modelStep: spyModelStep,
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'preflight');
  assert.match(result.red, /already holds (ask|answer)\.json from an earlier run/);
  assert.equal(modelStepCalls, 0);
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

test('PROOF the above can fail: a genuinely clean declaration passes preflight and DOES reach modelStep (2.3\'s execution phase is real)', async () => {
  const runId = `test-preflight-clean-${Date.now()}`;
  const runDir = join(OUT_DIR, runId);
  const spendPath = join(runDir, 'spend.jsonl');
  let modelStepCalls = 0;
  const spyModelStep = async () => { modelStepCalls += 1; return { ok: false, red: 'spy: stub does not answer' }; };
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId, outDir: runDir, sources: realSources(), spendPath, modelStep: spyModelStep,
  });
  // Once 2.3 landed, a clean declaration's preflight passes and the fold genuinely reaches
  // modelStep at the messageMatch stage — this is the negative-proof twin of the test above: a
  // preflight REFUSAL never calls modelStep, but a preflight PASS must.
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'messageMatch');
  assert.ok(modelStepCalls >= 1, 'modelStep must be reachable once preflight passes');
});

// ---------------------------------------------------------------------------
// M0b PART 2.2 — PRIMITIVES DO THE I/O (2026-09-13). readFrozenText/Csv/
// TextArtifact (shell_read + hash/truncation), checkpointAsk (Checkpoint,
// the real answer.mjs file protocol), sendViaPrimitive (shell_write),
// runModelStepOnPrimitives (makeProvider + metering that sums every round).
// ---------------------------------------------------------------------------

import {
  readFrozenText, readFrozenCsv, readFrozenTextArtifact, checkpointAsk, sendViaPrimitive, runModelStepOnPrimitives,
  LIVE_PROVIDER_OPTIONS,
} from './runner.mjs';

// --- readFrozenText / readFrozenCsv / readFrozenTextArtifact --------------

test('readFrozenText reads the frozen copy through shell_read and matches the manifest hash', async () => {
  const runDir = tempRunDir();
  const { manifest } = freezeInputs(runDir, [{ id: 'sheet', path: join(REPO_ROOT, 'fixtures', 'ar-aging.csv') }]);
  const result = await readFrozenText(manifest[0]);
  assert.equal(result.ok, true);
  assert.equal(result.text, readFileSync(manifest[0].frozen, 'utf8'));
});

test('PROOF readFrozenText can fail: a truncated read (small maxBytes) reds, never parsed as a complete row', async () => {
  const runDir = tempRunDir();
  const { manifest } = freezeInputs(runDir, [{ id: 'sheet', path: join(REPO_ROOT, 'fixtures', 'ar-aging.csv') }]);
  const result = await readFrozenText(manifest[0], { maxBytes: 16 }); // real fixture is far bigger than 16 bytes
  assert.equal(result.ok, false);
  assert.match(result.red, /was truncated by shell_read/);
});

test('PROOF readFrozenText can fail: a mismatched manifest hash reds, naming both hashes', async () => {
  const runDir = tempRunDir();
  const { manifest } = freezeInputs(runDir, [{ id: 'sheet', path: join(REPO_ROOT, 'fixtures', 'ar-aging.csv') }]);
  const poisoned = { ...manifest[0], sha256: '0'.repeat(64) };
  const result = await readFrozenText(poisoned);
  assert.equal(result.ok, false);
  assert.match(result.red, /re-hashed to .* the frozen manifest recorded 0{64}/);
});

test('readFrozenCsv parses the frozen CSV and stamps it with the bound step\'s emits id, never a1/a2', async () => {
  const runDir = tempRunDir();
  const { manifest } = freezeInputs(runDir, [{ id: 'sheet', path: join(REPO_ROOT, 'fixtures', 'ar-aging.csv') }]);
  const artifact = await readFrozenCsv('aging-sheet', manifest[0]);
  assert.equal(artifact.ok, true);
  assert.equal(artifact.id, 'aging-sheet');
  assert.ok(artifact.header.includes('Customer'));
  assert.ok(artifact.rows.length > 0);
});

test('readFrozenTextArtifact parses the frozen text file into 1-based lines, stamped with the emits id', async () => {
  const runDir = tempRunDir();
  const { manifest } = freezeInputs(runDir, [{ id: 'message', path: join(REPO_ROOT, 'fixtures', 'message.txt') }]);
  const artifact = await readFrozenTextArtifact('message-artifact', manifest[0]);
  assert.equal(artifact.ok, true);
  assert.equal(artifact.id, 'message-artifact');
  assert.ok(artifact.lines.length > 0);
});

// --- checkpointAsk ----------------------------------------------------------

test('checkpointAsk accepts once answer.mjs\'s real protocol writes {decision:"accept"}', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm0-checkpoint-'));
  const pending = checkpointAsk('ok to send?', { text: 'draft' }, { outDir, timeoutMs: 3000, pollMs: 20 });
  await new Promise((r) => setTimeout(r, 50));
  writeFileSync(join(outDir, 'answer.json'), JSON.stringify({ decision: 'accept', text: null }));
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.accepted, true);
  assert.ok(existsSync(join(outDir, 'ask.json')), 'checkpointAsk must write ask.json through Checkpoint\'s send callback');
});

// FIX 2 (2026-09-13, hamr's first live run): both of hamr's live asks expired because
// checkpointAsk wrote ask.json and polled in total silence — a human in another terminal had no
// way to know a run was waiting. `writeLine` is injected (never a global console/stderr spy) so
// this proves the notice is emitted without capturing real process output.
test('checkpointAsk prints an ASK OPEN notice (via the injected writeLine) naming the runId, question and the answer.mjs command', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm0-checkpoint-notice-'));
  const lines = [];
  const pending = checkpointAsk('ok to send?', { text: 'draft' }, {
    outDir, timeoutMs: 3000, pollMs: 20, runId: 'test-run-42', writeLine: (l) => lines.push(l),
  });
  await new Promise((r) => setTimeout(r, 50));
  writeFileSync(join(outDir, 'answer.json'), JSON.stringify({ decision: 'accept', text: null }));
  await pending;
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^ASK OPEN \(test-run-42, expires in 3s\): ok to send\? — answer with: node poc\/m0\/answer\.mjs test-run-42 accept$/);
});

test('PROOF checkpointAsk can fail: no answer ever arrives -> "ask expired" (Checkpoint\'s own TimeoutError)', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm0-checkpoint-timeout-'));
  const result = await checkpointAsk('ok to send?', {}, { outDir, timeoutMs: 200, pollMs: 20 });
  assert.equal(result.ok, false);
  assert.equal(result.red, 'ask expired');
});

test('checkpointAsk reds a "rerun" decision naming it as Amendment A\'s redo edge, out of scope', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm0-checkpoint-rerun-'));
  const pending = checkpointAsk('ok to send?', {}, { outDir, timeoutMs: 3000, pollMs: 20 });
  await new Promise((r) => setTimeout(r, 50));
  writeFileSync(join(outDir, 'answer.json'), JSON.stringify({ decision: 'rerun', text: 'try again' }));
  const result = await pending;
  assert.equal(result.ok, false);
  assert.match(result.red, /Amendment A's redo edge, out of this brief's scope/);
});

// --- sendViaPrimitive -------------------------------------------------------

test('sendViaPrimitive writes through shell_write and the happened() check passes on real bytes', async () => {
  const dirName = `m0-sendprim-${Date.now()}`;
  const dir = join(REPO_ROOT, 'poc', 'm0', 'out', dirName);
  mkdirSync(dir, { recursive: true });
  const result = await sendViaPrimitive(`file:poc/m0/out/${dirName}`, 'sent.txt', 'INV-1021 [c1]\n');
  assert.equal(result.ok, true);
  assert.equal(readFileSync(result.path, 'utf8'), 'INV-1021 [c1]\n');
});

test('PROOF sendViaPrimitive can fail: an empty write reds on "happened", reading the bytes actually on disk', async () => {
  const dirName = `m0-sendprim-empty-${Date.now()}`;
  const dir = join(REPO_ROOT, 'poc', 'm0', 'out', dirName);
  mkdirSync(dir, { recursive: true });
  const result = await sendViaPrimitive(`file:poc/m0/out/${dirName}`, 'sent.txt', '');
  assert.equal(result.ok, false);
  assert.match(result.red, /^happened:/);
});

test('sendViaPrimitive refuses at write time when the destination became a symlink outside the repo after preflight', async () => {
  const dirName = `m0-sendprim-toctou-${Date.now()}`;
  const target = `file:poc/m0/out/${dirName}`;
  const dir = join(REPO_ROOT, 'poc', 'm0', 'out', dirName);
  mkdirSync(dir, { recursive: true });
  const preflightCheck = checkSendDestination(target);
  assert.equal(preflightCheck.ok, true);

  const outsideDir = mkdtempSync(join(tmpdir(), 'fwdloop-outside-sendprim-'));
  try {
    rmSync(dir, { recursive: true, force: true });
    symlinkSync(outsideDir, dir);

    const result = await sendViaPrimitive(target, 'x.txt', 'hi');
    assert.equal(result.ok, false);
    assert.match(result.red, /symlink/);
    assert.equal(existsSync(join(outsideDir, 'x.txt')), false);
  } finally {
    rmSync(dir, { force: true });
    rmSync(outsideDir, { recursive: true, force: true });
  }
});

// F27 (2026-09-14) — LIVE_PROVIDER_OPTIONS is the runner's ONE live call site's config, frozen
// and exported so a revert (deleting `deadlineMs: 240_000` from the live makeProvider(...) call)
// reds THIS test even though it never touches a network or a real provider. `< timeoutMs` is the
// intended relationship (F27's brief): the deadline must trip BEFORE the idle bound would ever
// have a chance to (300s idle vs 240s deadline — a hung request reds in 4 min, not 15).
// `> 0` is load-bearing, not decorative: bare-agent's `applyRequestDeadline` treats `deadlineMs`
// as DISABLED whenever `!(deadlineMs > 0)` — so `deadlineMs: 0` is a NUMBER, and IS `< timeoutMs`,
// yet silently reintroduces the exact zombie-stream hang F27 exists to close. Without this
// assertion a revert to `0` passes this test while turning the deadline back off in production.
test('LIVE_PROVIDER_OPTIONS carries a positive, finite deadlineMs strictly under its timeoutMs (F27)', () => {
  assert.equal(typeof LIVE_PROVIDER_OPTIONS.timeoutMs, 'number');
  assert.equal(typeof LIVE_PROVIDER_OPTIONS.deadlineMs, 'number');
  assert.ok(Number.isFinite(LIVE_PROVIDER_OPTIONS.deadlineMs));
  assert.ok(LIVE_PROVIDER_OPTIONS.deadlineMs > 0, 'deadlineMs must be > 0 — bare-agent treats 0 (and any !(deadlineMs > 0)) as DISABLED');
  assert.ok(LIVE_PROVIDER_OPTIONS.deadlineMs < LIVE_PROVIDER_OPTIONS.timeoutMs);
  assert.ok(Object.isFrozen(LIVE_PROVIDER_OPTIONS));
});

// F27's runner-level proof: a provider whose FIRST round rejects exactly like a tripped BA-19
// deadline (`code: 'EDEADLINE', retryable: false`) must be classified NON-retryable by
// `transportRetryable` (retryable !== true, status not 502/503/524) — so the standing "one retry
// then red" rule (rule 1) does NOT retry it, and exactly one spend row is written (rule 2, cost
// unknown -> null) before the red. This exercises the exact catch branch a live deadline trip
// would hit; only the transport call is stubbed ($0, no network).
test('a provider rejecting with EDEADLINE/retryable:false is never retried — one spend row, provider-red names the deadline', async () => {
  const runId = `test-deadline-${Date.now()}`;
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-spend-deadline-')), 'spend.jsonl');
  let calls = 0;
  const deadlineErr = Object.assign(new Error('[OpenAIProvider] request exceeded its total deadline of 240000ms'), {
    code: 'EDEADLINE', retryable: false,
  });
  const provider = {
    generate: async () => {
      calls += 1;
      throw deadlineErr;
    },
  };
  const result = await runModelStepOnPrimitives({
    runId, stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(calls, 1, 'EDEADLINE/retryable:false must not trigger rule 1\'s one retry');
  assert.equal(result.ok, false);
  assert.match(result.red, /provider-red: .*deadline/);
  const rows = readFileSync(spendPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1, 'exactly one spend row — no retry means no second row');
  assert.equal(rows[0].costUsd, null, 'an attempt that threw carries an unknown cost, never $0');
});

// PROOF the test above can fail: a RETRYABLE transport error (502) on attempt 1 DOES retry —
// contrast with EDEADLINE above to prove transportRetryable's classification is doing real work,
// not just always-false.
test('PROOF the deadline test above can fail: a retryable 502 IS retried once, writing two spend rows', async () => {
  const runId = `test-retry-${Date.now()}`;
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-spend-retry-')), 'spend.jsonl');
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      throw Object.assign(new Error('bad gateway'), { status: 502 });
    },
  };
  const result = await runModelStepOnPrimitives({
    runId, stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(calls, 2, 'a 502 gets exactly one retry (attempt 1 + attempt 2)');
  assert.equal(result.ok, false);
  const rows = readFileSync(spendPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2, 'both attempts each write a row');
});

// --- runModelStepOnPrimitives — metering sums every round -------------------

test('runModelStepOnPrimitives sums every round via sumMeterings, never just the last one (F15)', async () => {
  const runId = `test-metering-${Date.now()}`;
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-spend-')), 'spend.jsonl');
  const envVar = 'DEEPSEEK_API_KEY';
  const saved = process.env[envVar];
  process.env[envVar] = 'test-key-not-real';
  // Stub bare-agent's Loop is not injected here (runModelStepOnPrimitives builds its own) — instead
  // this proves the metering FOLD itself via sumMeterings on a realistic two-round event list, the
  // same shape onLlmResult delivers: round 1 emits the tool call, round 2 is the short finishing
  // round. This is the exact F15 scenario (drafter.mjs/scout.mjs already fixed; the OLD runModelStep
  // in this same file still has NOT: `metering = event` drops round 1 entirely).
  try {
    const { sumMeterings } = await import('./spend.mjs');
    const rounds = [
      { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.001, model: 'deepseek-flash' },
      { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0001, model: 'deepseek-flash' },
    ];
    const metered = sumMeterings(rounds);
    assert.equal(metered.rounds, 2);
    assert.equal(metered.tokens.outputTokens, 55, 'both rounds\' output tokens must be summed, not just the last');
    assert.ok(Math.abs(metered.costUsd - 0.0011) < 1e-9);
  } finally {
    if (saved !== undefined) process.env[envVar] = saved; else delete process.env[envVar];
  }
});

test('PROOF the metering test can fail: reading only the LAST round (the F15 bug) understates both tokens and cost', async () => {
  const { sumMeterings } = await import('./spend.mjs');
  const rounds = [
    { usage: { inputTokens: 100, outputTokens: 50 }, costUsd: 0.001, model: 'deepseek-flash' },
    { usage: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0001, model: 'deepseek-flash' },
  ];
  const lastRoundOnly = rounds[rounds.length - 1]; // the F15 bug: `metering = event`
  assert.notEqual(lastRoundOnly.usage.outputTokens, sumMeterings(rounds).tokens.outputTokens);
});

// A fake provider matching bare-agent's own `generate(messages, tools, options)` contract (same
// shape drafter.test.mjs's fakeProvider uses) — Loop calls .generate() itself and fires
// onLlmResult once per round; the FIRST round emits the tool call, the SECOND (the "finishing"
// round" after the tool result) returns plain text. This is the exact F15 shape: a call site that
// keeps only the last round's metering understates every tool-calling run.
function fakeTwoRoundProvider() {
  let n = 0;
  return {
    generate: async () => {
      n += 1;
      if (n === 1) {
        return {
          text: null,
          toolCalls: [{ id: 't1', name: 'emit_x', arguments: { ok: true } }],
          usage: { inputTokens: 100, outputTokens: 50 },
          stopReason: 'tool_calls',
          model: 'deepseek-flash',
        };
      }
      return {
        text: '', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'stop', model: 'deepseek-flash',
      };
    },
  };
}

test('runModelStepOnPrimitives ($0, injected stub provider — zero live model calls) writes one spend row summing EVERY round, never just the last', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-modelstep-'));
  const spendPath = join(runDir, 'spend.jsonl');
  const provider = fakeTwoRoundProvider();
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { ok: true });
  const rows = readFileSync(spendPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rounds, 2, 'both rounds must be folded into ONE spend row (F15)');
  assert.equal(rows[0].tokens.outputTokens, 55, '50 (tool-call round) + 5 (finishing round), never just 5');
  assert.equal(rows[0].modelReturned, 'deepseek-flash');
  assert.equal(rows[0].modelMatch, 'match');
});

test('PROOF the above can fail: a stub provider that returns text instead of the tool reds, naming the step', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-modelstep-notool-'));
  const spendPath = join(runDir, 'spend.jsonl');
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      return {
        text: 'not a tool call', toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'stop', model: 'deepseek-flash',
      };
    },
  };
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /derive1: a FINISHED round \(stopReason=stop\) returned text instead of the tool/);
  assert.ok(calls >= 1);
});

// ---------------------------------------------------------------------------
// F28 — a malformed tool-call ("arguments" not valid JSON) must be METERED
// (a real costUsd, never null) and named distinctly from "the model just
// returned text". `loop.run()`'s own return doesn't forward a round's
// `malformedToolCall` field, so the provider stub sets `lastMalformedToolCall`
// on itself exactly like the real `MalformedToolCallTolerantOpenAI` wrapper
// does — that instance property is the channel runModelStepOnPrimitives reads.
// ---------------------------------------------------------------------------

/** A stub provider whose generate() always returns the malformed-tool-call shape. */
function fakeAlwaysMalformedProvider() {
  return {
    lastMalformedToolCall: null,
    generate: async function generate() {
      const malformedToolCall = { name: 'emit_x', rawArguments: '{"a":1}}', error: 'Unexpected non-whitespace character after JSON at position 8' };
      this.lastMalformedToolCall = malformedToolCall;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 }, stopReason: 'tool_use', model: 'deepseek-flash', malformedToolCall,
      };
    },
  };
}

test('F28: a malformed tool-call twice in a row is metered on BOTH attempts (costUsd a number, never null) and reds naming the malformed case', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-modelstep-malformed-'));
  const spendPath = join(runDir, 'spend.jsonl');
  const provider = fakeAlwaysMalformedProvider();
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 1, out: 1 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /derive1: the tool call's arguments were not valid JSON twice in a row/);
  assert.match(result.red, /position 8/);
  assert.match(result.red, /\{"a":1\}\}/);
  const rows = readFileSync(spendPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2, 'one spend row per attempt');
  for (const row of rows) {
    assert.equal(typeof row.costUsd, 'number', `expected a real costUsd, never null, for row ${JSON.stringify(row)}`);
    assert.ok(row.costUsd > 0);
  }
});

test('PROOF the above can fail: a malformed round FOLLOWED by a valid one is ok:true and writes two rows', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-modelstep-malformed-then-ok-'));
  const spendPath = join(runDir, 'spend.jsonl');
  let attempt = 0;
  const provider = {
    lastMalformedToolCall: null,
    generate: async function generate() {
      attempt += 1;
      if (attempt === 1) {
        const malformedToolCall = { name: 'emit_x', rawArguments: '{"a":1}}', error: 'bad json' };
        this.lastMalformedToolCall = malformedToolCall;
        return {
          text: '', toolCalls: [], usage: { inputTokens: 100, outputTokens: 20 }, stopReason: 'tool_use', model: 'deepseek-flash', malformedToolCall,
        };
      }
      this.lastMalformedToolCall = null;
      return {
        text: null,
        toolCalls: [{ id: 't1', name: 'emit_x', arguments: { ok: true } }],
        usage: { inputTokens: 10, outputTokens: 5 },
        stopReason: 'tool_use',
        model: 'deepseek-flash',
      };
    },
  };
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 1, out: 1 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { ok: true });
  const rows = readFileSync(spendPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(typeof row.costUsd, 'number');
  }
});

// ---------------------------------------------------------------------------
// M0b PART 2.3 — PLANTS a-e THROUGH THE REAL FOLD (2026-09-13). Only the
// model round is stubbed ($0, zero live calls); freeze, bind, grants,
// destination, shell_read/shell_write, and the REAL Checkpoint/answer.mjs
// file protocol all run for real, through runOnPrimitives. Artifact ids
// match what the fold ACTUALLY names them (stages.sheetRead.emits =
// "aging-sheet", the raw message read = "message-raw") — never the OLD
// fold's "a1"/"a2", which resolve to nothing in this artifact space.
// ---------------------------------------------------------------------------

/** Injected modelStep stub matching runModelStepOnPrimitives's real { ok, args } contract. */
function stubModelStepOnPrimitives(argsByStep) {
  const calls = {};
  const fn = async ({ stepLabel }) => {
    calls[stepLabel] = (calls[stepLabel] ?? 0) + 1;
    if (!(stepLabel in argsByStep)) return { ok: false, red: `stub: no wiring for step "${stepLabel}"` };
    return {
      ok: true, args: argsByStep[stepLabel], metered: { rounds: 1 }, wallMs: 1, stopReason: 'tool_calls',
    };
  };
  fn.calls = calls;
  return fn;
}

/** Writes answer.json BEFORE the run starts, so checkpointAsk's very first poll finds it. */
// FIX 3 (2026-09-13): preflight now refuses a run dir that already holds ask.json/answer.json
// (checkFreshRunDir), so pre-writing answer.json before the run starts would itself trip the
// stale-answer refusal. Schedule the write on a macrotask instead: the ENTIRE synchronous
// preflight chain (including checkFreshRunDir) runs before runOnPrimitives' first `await`
// (inside readFrozenCsv) ever yields to the event loop, so a setTimeout scheduled here — however
// short — cannot fire until preflight has already completed and found no file. By the time
// checkpointAsk's own poll loop checks for answer.json (after the ask/send stages), it is there.
function acceptFinalAsk(runDir) {
  mkdirSync(runDir, { recursive: true });
  setTimeout(() => {
    writeFileSync(join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', text: null }));
  }, 0);
}

const FOLD_DERIVE1_ARGS = {
  citations: [
    { id: 'c1', quote: 'Northwind', source: { kind: 'text', artifact: 'message-raw', line: 1 } },
    { id: 'c2', value: 'Northwind Trading', source: { kind: 'csv', artifact: 'aging-sheet', cell: 'A2' } },
  ],
  matches: ['c2'],
};

// Northwind Trading: E2=4200 due 2026-06-09, E3=1500 due 2026-05-20, against BUSINESS_DATE
// 2026-06-01 -> total 5700, earliest due 2026-05-20, 1 invoice (INV-1009) overdue by 12 days.
const FOLD_DERIVE2_ARGS = {
  citations: [
    { id: 'c1', value: 4200, source: { kind: 'csv', artifact: 'aging-sheet', cell: 'E2' } },
    { id: 'c2', value: 1500, source: { kind: 'csv', artifact: 'aging-sheet', cell: 'E3' } },
    { id: 'c3', value: 5700, formula: 'sum', inputs: ['c1', 'c2'] },
    { id: 'c4', value: '2026-05-20', source: { kind: 'csv', artifact: 'aging-sheet', cell: 'D3' } },
    { id: 'c5', value: 12, formula: 'daysBetween', inputs: ['c4'] },
    { id: 'c6', value: '2026-06-09', source: { kind: 'csv', artifact: 'aging-sheet', cell: 'D2' } },
    { id: 'c7', value: -8, formula: 'daysBetween', inputs: ['c6'] },
    { id: 'c8', value: 1, formula: 'count', inputs: ['c5'] },
  ],
  fields: { total_owed: 'c3', earliest_due: 'c4', count_overdue: 'c8' },
};

const FOLD_COMPOSE_ARGS = {
  citations: FOLD_DERIVE2_ARGS.citations,
  text: 'Northwind Trading owes 5700[c3], earliest due 2026-05-20[c4], with 1[c8] invoice overdue.',
};

function foldStub(overrides = {}) {
  return stubModelStepOnPrimitives({
    messageMatch: FOLD_DERIVE1_ARGS, derive: FOLD_DERIVE2_ARGS, compose: FOLD_COMPOSE_ARGS, ...overrides,
  });
}

test('plant d (clean) reaches send through the REAL fold — shell_read, Checkpoint/answer.mjs, shell_write — with non-zero bytes on disk', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-d-'));
  acceptFinalAsk(runDir);
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-d-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'd', modelStep: foldStub(),
  });
  assert.equal(result.outcome, 'complete', result.red);
  const bytes = readFileSync(result.deliveryId);
  assert.ok(bytes.byteLength > 0, 'the sent file must carry non-zero bytes');
});

test('plant a (wrong derived total) reds through the REAL fold, naming the figure and formula', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-a-'));
  acceptFinalAsk(runDir);
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-a-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'a', modelStep: foldStub(),
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'derive');
  assert.match(result.red, /5850/);
  assert.match(result.red, /sum/);
});

test('plant b (wrong copied cell) reds through the REAL fold, naming the cell', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-b-'));
  acceptFinalAsk(runDir);
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-b-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'b', modelStep: foldStub(),
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'derive');
  assert.match(result.red, /E2/);
});

test('plant c (two Northwinds) lands at an ask through the REAL fold — never a pick, zero derive calls', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-c-'));
  // The planted row (generatePlantCCsv) is the 10th data row -> cell A10; deliberately NOT
  // pre-answering the ambiguity ask, so the run must stop there rather than proceed.
  const ambiguousDerive1 = {
    citations: [
      { id: 'c1', quote: 'Northwind', source: { kind: 'text', artifact: 'message-raw', line: 1 } },
      { id: 'c2', value: 'Northwind Trading', source: { kind: 'csv', artifact: 'aging-sheet', cell: 'A2' } },
      { id: 'c3', value: 'Northwind Supplies', source: { kind: 'csv', artifact: 'aging-sheet', cell: 'A10' } },
    ],
    matches: ['c2', 'c3'],
  };
  const modelStep = foldStub({ messageMatch: ambiguousDerive1 });
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-c-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'c', modelStep, askTimeoutMs: 300,
  });
  assert.notEqual(result.outcome, 'complete');
  assert.equal(result.phase, 'messageMatch-ambiguous');
  assert.equal(modelStep.calls.derive ?? 0, 0, 'zero derive calls after an ambiguous match — never a pick');
  assert.ok(existsSync(join(runDir, 'ask.json')), 'the ambiguity ask must actually be asked (ask.json written)');
  const askedQuestion = JSON.parse(readFileSync(join(runDir, 'ask.json'), 'utf8'));
  assert.match(askedQuestion.question, /Northwind Trading/);
  assert.match(askedQuestion.question, /Northwind Supplies/);
});

test('plant e (green-by-omission, NEW) reds through the REAL fold when total/earliest-due are stripped from the composed text', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-e-'));
  acceptFinalAsk(runDir);
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-e-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'e', modelStep: foldStub(),
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'compose');
  // Report item 5: WHICH check catches it — closeCompose's completeness check (F7's fix, keyed on
  // derive's declaredFields), never a "declared close.shape" checker — nothing mechanically
  // enforces step.close.shape today (softgreen's `{form, perInvoice, ...}` is descriptive only).
  assert.match(result.red, /compose: declared field "(total_owed|earliest_due)"/);
});

test('PROOF plant e can fail: the SAME declaration and stub, with plant "d" instead of "e", goes green through send', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-e-control-'));
  acceptFinalAsk(runDir);
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-e-control-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'd', modelStep: foldStub(),
  });
  assert.equal(result.outcome, 'complete', result.red);
});

// ---------------------------------------------------------------------------
// F28 fix (2026-09-15) — a red run kept nothing but the red string, so a
// compose bracket miss could never be told apart from closeCompose
// mis-reading a label. `<runDir>/log.json` now carries every stage's model
// args (green AND red), written once per run. Temp dirs only — never
// poc/m0/out/.
// ---------------------------------------------------------------------------

test('F28: plant e (red at compose) writes <runDir>/log.json carrying the composed text closeCompose actually judged', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-e-log-'));
  acceptFinalAsk(runDir);
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-e-log-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'e', modelStep: foldStub(),
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'compose');

  const logPath = join(runDir, 'log.json');
  assert.ok(existsSync(logPath), 'log.json must exist after a red-at-compose run');
  const log = JSON.parse(readFileSync(logPath, 'utf8'));
  assert.equal(log.outcome, 'red');
  assert.equal(log.phase, 'compose');
  assert.ok(log.stages.compose.args, 'stages.compose.args must be present on a compose red');
  // Literal substring from FOLD_COMPOSE_ARGS.text (the stub's own fixture) — proves this is the
  // model's ACTUAL returned text, never a copy of the red string or a stand-in value.
  assert.match(log.stages.compose.args.text, /Northwind Trading owes 5700\[c3\]/);
});

test('F28: a clean run to completion writes log.json with outcome complete and derive.args present', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-d-log-'));
  acceptFinalAsk(runDir);
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-d-log-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'd', modelStep: foldStub(),
  });
  assert.equal(result.outcome, 'complete', result.red);

  const logPath = join(runDir, 'log.json');
  assert.ok(existsSync(logPath), 'log.json must exist after a clean completion');
  const log = JSON.parse(readFileSync(logPath, 'utf8'));
  assert.equal(log.outcome, 'complete');
  assert.ok(log.stages.derive.args, 'stages.derive.args must be present on a clean run');
  assert.equal(log.stages.derive.args.fields.total_owed, 'c3');
});

// ---------------------------------------------------------------------------
// Coordinator fix (2026-09-13) — runModelStepOnPrimitives had DROPPED the
// standing round rules the old runModelStep carries: no try/catch around
// loop.run (a live provider error would throw straight out of
// runOnPrimitives, crash the run, and write NO spend row), and no retry at
// all. Ported: rule 1 (retryable transport error retries once), rule 2
// (every failed attempt gets a spend row, costUsd null unless partial
// meterings priced something real), rule 3 (no-tool-call retries once),
// rule 4 (max_tokens never retried), rule 5 (never throws for a model
// failure). $0, fake providers only.
// ---------------------------------------------------------------------------

function readSpendRows(spendPath) {
  if (!existsSync(spendPath)) return [];
  return readFileSync(spendPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** A provider whose generate() consumes a fixed script of responses/throws in order — needed
 *  because bare-agent's Loop keeps calling generate() (tool round -> finishing round) until it
 *  sees a FINISHED round with no tool call, so a naive "throw once, then always return a tool
 *  call" stub loops forever re-issuing the same tool call. */
function scriptedProvider(script) {
  let i = 0;
  return {
    calls: () => i,
    generate: async () => {
      const step = script[i];
      i += 1;
      if (typeof step === 'function') return step();
      return step;
    },
  };
}

const TOOL_CALL_ROUND = {
  text: null, toolCalls: [{ id: 't1', name: 'emit_x', arguments: { ok: true } }], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'tool_calls', model: 'deepseek-flash',
};
const FINISHING_ROUND = {
  text: '', toolCalls: [], usage: { inputTokens: 2, outputTokens: 1 }, stopReason: 'stop', model: 'deepseek-flash',
};

test('rule 1: a retryable transport error (status 502) on attempt 1 retries once, then succeeds', async () => {
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-retry-')), 'spend.jsonl');
  const provider = scriptedProvider([
    () => { const e = new Error('gateway timeout'); e.status = 502; throw e; }, // attempt 1: fails outright
    TOOL_CALL_ROUND, // attempt 2, round 1: the tool call
    FINISHING_ROUND, // attempt 2, round 2: the finishing round that ends the loop cleanly
  ]);
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, true);
  assert.equal(provider.calls(), 3, 'one failed call (attempt 1) + two rounds for the succeeding attempt 2');
  const rows = readSpendRows(spendPath);
  assert.equal(rows.length, 2, 'the failed attempt AND the succeeding attempt each get a row');
  assert.equal(rows[0].costUsd, null, 'a transport failure with no partial metering is never asserted at $0');
  assert.match(rows[0].error, /gateway timeout/);
});

test('PROOF rule 1 can fail: a SECOND transport error (no more retries) reds "provider-red", with an error row for BOTH attempts', async () => {
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-retry-fail-')), 'spend.jsonl');
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      const e = new Error(`gateway timeout #${calls}`); e.status = 503; throw e;
    },
  };
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /^provider-red: gateway timeout #2$/);
  assert.equal(calls, 2, 'exactly one retry, never a third attempt');
  const rows = readSpendRows(spendPath);
  assert.equal(rows.length, 2, 'both the retried AND the final failed attempt get their own row');
  assert.ok(rows.every((r) => r.costUsd === null));
  assert.match(rows[0].error, /gateway timeout #1/);
  assert.match(rows[1].error, /gateway timeout #2/);
});

test('rule 2 (corrected): costUsd is ALWAYS null on a caught error, even when round 1 priced for real — the known part lands in knownPartialUsd only', async () => {
  // Realistic two-round shape through the REAL Loop: round 1 emits the tool call (priced for real,
  // onLlmResult fires with real usage against non-zero rates), THEN the finishing round (bare-
  // agent's second internal generate() call, after the tool executes) throws a transport error.
  // throwOnError:true (the default) means loop.run() throws straight out with round 1's pricing
  // already captured by onLlmResult. Round 2's own request left the machine with an unknown cost
  // — a known partial (round 1) passed off as the ATTEMPT's cost would understate spend and let
  // assertUnderGlobalCap wave the row through, so costUsd stays null; the known part is kept
  // separately, informational only.
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-partial-metering-')), 'spend.jsonl');
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      if (calls === 1) {
        return {
          text: null, toolCalls: [{ id: 't1', name: 'emit_x', arguments: { ok: true } }], usage: { inputTokens: 100, outputTokens: 50 }, stopReason: 'tool_calls', model: 'deepseek-flash',
        };
      }
      const e = new Error('finishing round: socket reset'); e.status = 502; throw e;
    },
  };
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash',
  });
  // 502 is retryable, but this happens on the SAME attempt's internal second round — attempt 1
  // as a whole fails and (being attempt 1) gets one retry at the OUTER loop; the retried attempt's
  // provider call count restarts from 1 (a fresh Loop/messages each attempt), so it succeeds the
  // second time around (calls 3 = attempt 2's first round: tool call; loop finishes there since a
  // captured tool call ends the round cleanly). What matters for THIS rule is the FIRST attempt's
  // error row: costUsd is null (the attempt as a whole has an unknown cost — round 2 never
  // completed), but knownPartialUsd carries round 1's real, non-zero priced cost, never lost.
  const rows = readSpendRows(spendPath);
  const errorRows = rows.filter((r) => r.error);
  assert.ok(errorRows.length >= 1, 'the failed attempt must have its own row');
  assert.equal(errorRows[0].costUsd, null, 'the attempt\'s cost is unknown — round 2\'s request left the machine and never priced');
  assert.ok(errorRows[0].knownPartialUsd > 0, `expected round 1's real priced cost in knownPartialUsd, got ${errorRows[0].knownPartialUsd}`);
  assert.equal(errorRows[0].rounds, 1, 'exactly the one round that completed before the throw');
  assert.match(errorRows[0].error, /finishing round: socket reset/);
});

test('rule 3: a FINISHED round with no tool call retries once, then succeeds', async () => {
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-notool-retry-')), 'spend.jsonl');
  const provider = scriptedProvider([
    { text: 'thinking out loud', toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'stop', model: 'deepseek-flash' }, // attempt 1: no tool call
    TOOL_CALL_ROUND, // attempt 2, round 1: the tool call
    FINISHING_ROUND, // attempt 2, round 2: the finishing round
  ]);
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.args, { ok: true });
  assert.equal(provider.calls(), 3);
});

test('PROOF rule 3 can fail: no tool call twice in a row reds, naming the step and quoting the text', async () => {
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-notool-twice-')), 'spend.jsonl');
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      return {
        text: `still thinking #${calls}`, toolCalls: [], usage: { inputTokens: 5, outputTokens: 5 }, stopReason: 'stop', model: 'deepseek-flash',
      };
    },
  };
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /derive1: a FINISHED round \(stopReason=stop\) returned text instead of the tool twice in a row\. Text: "still thinking #2"/);
  assert.equal(calls, 2, 'exactly one retry, never a third attempt');
});

test('rule 4: max_tokens is an immediate red, never retried', async () => {
  const spendPath = join(mkdtempSync(join(tmpdir(), 'm0-maxtok-')), 'spend.jsonl');
  let calls = 0;
  const provider = {
    generate: async () => {
      calls += 1;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 16000 }, stopReason: 'max_tokens', model: 'deepseek-flash',
      };
    },
  };
  const result = await runModelStepOnPrimitives({
    runId: 'test-run', stepLabel: 'derive1', spendPath,
    systemPrompt: 'x', userContent: 'y', toolName: 'emit_x', toolDescription: 'd',
    toolSchema: { type: 'object', properties: {} },
    provider, rates: { in: 0, out: 0 }, modelId: 'deepseek-flash',
  });
  assert.equal(result.ok, false);
  assert.match(result.red, /^truncated: 16000 tokens, no tool call$/);
  assert.equal(calls, 1, 'max_tokens must never be retried');
});

test('rule 5: runOnPrimitives never throws when the model round fails — returns { outcome: "red", red, phase }', async () => {
  const runDir = mkdtempSync(join(tmpdir(), 'm0-fold-provider-red-'));
  acceptFinalAsk(runDir);
  let calls = 0;
  const throwingModelStep = async () => {
    calls += 1;
    return { ok: false, red: 'provider-red: simulated transport failure' };
  };
  const result = await runOnPrimitives({
    declaration: primitivesDeclaration(), runId: `fold-provider-red-${Date.now()}`, outDir: runDir,
    sources: realSources(), spendPath: join(runDir, 'spend.jsonl'), plant: 'd', modelStep: throwingModelStep,
  });
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'messageMatch');
  assert.match(result.red, /provider-red: simulated transport failure/);
  assert.ok(calls >= 1);
});
