// Tests for src/runner.js — M2 piece 1 (docs/wiki/the-module-ladder.md,
// "M2 — scope, exit, negative — SIGNED"). Every run happens at $0 against
// fake modelStep/askStep/sendStep/primitives — no provider, no key.
//
// Every temp directory is created under `fs.mkdtempSync(path.join(os.tmpdir(),
// ...))`, never a `flows/`/`runs/` directory inside the repo.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, mkdtempSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { makeFileAskStep } from '../src/ask.js';
import {
  runFlow, buildExecutorContext, findForbiddenInContext, STRIKE_LIMIT, MAX_ATTEMPTS, writeArtifact, readArtifact,
} from '../src/runner.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-24T12:00:00Z';
const BUSINESS_DATE = '2026-06-01';

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-${prefix}-`));
}

function writeTempCsv(dir) {
  const csvPath = path.join(dir, 'aging.csv');
  writeFileSync(
    csvPath,
    'Customer,Invoice #,Invoice date,Due date,Amount,Days overdue,Current,1-30,31-60,61-90,90+\n'
    + 'Acme Corp,INV-1,2026-05-01,2026-05-15,150.00,,,,,,\n'
    + 'Acme Corp,INV-2,2026-05-05,2026-05-20,50.50,,,,,,\n',
  );
  return csvPath;
}

function writeTempDocxLike(dir, name, text) {
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
}

function writeJob1Flow(root, name = 'job1') {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job1.m1.signed.txt'),
    declaration: fixtureJson('job1.m1.declaration.json'),
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

function writeJob2Flow(root, name = 'job2') {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

// ---------------------------------------------------------------------------
// Job #1's fake modelStep — keyed off the DECLARATION's own goal text (test
// fixture logic; src/runner.js itself never branches on any of this — see
// the "no job-name branch" test below).
// ---------------------------------------------------------------------------

function makeJob1ModelStep({ step3Behavior = 'green', step1Behavior = 'green' } = {}) {
  return async function job1ModelStep(ctx) {
    if (ctx.goal.includes('addressable cells')) {
      if (step1Behavior === 'empty') return { ok: true, artifact: { done: true }, costUsd: 0.001 };
      return {
        ok: true,
        costUsd: 0.001,
        artifact: {
          kind: 'cells',
          rows: [
            { rowNumber: 2, cells: { A: 'Acme Corp', B: 'INV-1', C: '2026-05-01', D: '2026-05-15', E: '150.00' } },
            { rowNumber: 3, cells: { A: 'Acme Corp', B: 'INV-2', C: '2026-05-05', D: '2026-05-20', E: '50.50' } },
          ],
          done: true,
        },
      };
    }
    if (ctx.goal.includes('work out which customer')) {
      return { ok: true, costUsd: 0.001, artifact: { matchedCustomer: 'Acme Corp', done: true } };
    }
    if (ctx.goal.includes('pull their open invoices')) {
      if (step3Behavior === 'always-wrong') {
        return {
          ok: true,
          costUsd: 0.001,
          artifact: { fields: { total_owed: { value: 999, cite: 'aging_cells!E2' } }, done: true },
        };
      }
      return {
        ok: true,
        costUsd: 0.001,
        artifact: {
          fields: {
            invoice1: { value: 150, cite: 'aging_cells!E2' },
            invoice2: { value: 50.5, cite: 'aging_cells!E3' },
            total_owed: { value: 200.5, cite: 'sum(#invoice1,#invoice2)' },
          },
          done: true,
        },
      };
    }
    if (ctx.goal.includes('Write a short reply')) {
      const text = 'Invoice # INV-1 Due date 2026-05-15 Amount 150\n'
        + 'Invoice # INV-2 Due date 2026-05-20 Amount 50.50';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected step goal in test fake: ${ctx.goal}`);
  };
}

function job1ModelStepWithContexts(opts) {
  const contexts = [];
  const inner = makeJob1ModelStep(opts);
  const fn = async (ctx, tools) => {
    contexts.push(ctx);
    return inner(ctx, tools);
  };
  return { fn, contexts };
}

const ACCEPT_ASK = async () => ({ decision: 'accept' });
const NOOP_SEND = async (target, filename, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });

test('runFlow: job #1 fixture runs end to end, complete, no forbidden context leak', async (t) => {
  const root = tmpRoot('job1-e2e');
  writeJob1Flow(root);
  const runDir = tmpRoot('job1-e2e-sources');
  const aging = writeTempCsv(runDir);

  const { fn: modelStep, contexts } = job1ModelStepWithContexts();

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);
  assert.ok(result.artifacts.sent_reply);
  assert.ok(result.auditRows.length > 0);

  for (const ctx of contexts) {
    const found = findForbiddenInContext(ctx);
    assert.equal(found, null, found ?? '');
  }
});

test('runFlow: job #2 fixture runs end to end, complete', async () => {
  const root = tmpRoot('job2-e2e');
  writeJob2Flow(root);
  const srcDir = tmpRoot('job2-e2e-sources');
  const resume = writeTempDocxLike(srcDir, 'resume.docx', 'Resume text goes here.');
  const jd = writeTempDocxLike(srcDir, 'jd.md', 'JD text goes here.');

  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected job2 goal: ${ctx.goal}`);
  };

  const result = await runFlow({
    root,
    name: 'job2',
    runId: 'run-1',
    sources: [{ id: 'resume', path: resume }, { id: 'jd', path: jd }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);
  assert.ok(result.artifacts['resume-summary-output']);
});

test('runFlow: src/runner.js itself never branches on a job name or step goal text', () => {
  const source = readFileSync(path.join(HERE, '..', 'src', 'runner.js'), 'utf8');
  for (const literal of ['job1', 'job2', 'aging', 'resume']) {
    assert.equal(source.includes(literal), false, `src/runner.js must not mention "${literal}"`);
  }
});

test('construction test: the real executor context carries no close/shape/cap/strike identifier, and a leaky double is caught', () => {
  const real = buildExecutorContext({
    goal: 'write a reply', primitives: ['write'], reads: { x: { text: 'hi' } }, gap: 'a prior gap',
  });
  assert.equal(findForbiddenInContext(real), null);

  const leaky = { ...real, close: { class: 'green' } };
  const found = findForbiddenInContext(leaky);
  assert.notEqual(found, null);
  assert.match(found, /close/);
});

test('buildExecutorContext: refuses an unknown field outright (e.g. "close")', () => {
  assert.throws(() => buildExecutorContext({
    goal: 'x', primitives: [], reads: {}, gap: null, close: { class: 'green' },
  }), /unknown field "close"/);
});

// ---------------------------------------------------------------------------
// Negative (i): a step whose happened check fails halts the run naming the step.
// ---------------------------------------------------------------------------
test('negative (i): a 0-byte/empty artifact halts the run naming the step', async () => {
  const root = tmpRoot('neg-i');
  writeJob1Flow(root);
  const srcDir = tmpRoot('neg-i-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts({ step1Behavior: 'empty' });

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'struck-out');
  assert.match(result.red, /AR aging sheet as addressable cells/);
});

// ---------------------------------------------------------------------------
// Negative (ii): a step that reds its close with the SAME gap twice strikes
// out at the second strike, under cap.
// ---------------------------------------------------------------------------
test('negative (ii): the same close-red gap twice strikes out at the second strike', async () => {
  const root = tmpRoot('neg-ii');
  writeJob1Flow(root);
  const srcDir = tmpRoot('neg-ii-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts({ step3Behavior: 'always-wrong' });

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'struck-out');
  assert.match(result.red, /"total_owed" 999/);

  const auditPath = path.join(root, 'job1', 'runs', 'run-1', 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const reds = rows.filter((r) => r.step === 'invoice_facts');
  assert.equal(reds.length, 3, 'expects exactly 3 attempts before struck-out');
  assert.equal(reds[0].strike, false);
  assert.equal(reds[1].strike, true);
  assert.equal(reds[2].strike, true);
});

// ---------------------------------------------------------------------------
// Negative (iii): a run whose NEXT attempt cannot be funded under the cap
// halts cap-halt BEFORE the attempt starts, never after.
// ---------------------------------------------------------------------------
test('negative (iii): cap-halt fires before the attempt starts, never after', async () => {
  const root = tmpRoot('neg-iii');
  writeJob1Flow(root);
  const srcDir = tmpRoot('neg-iii-sources');
  const aging = writeTempCsv(srcDir);

  let modelStepCalled = false;
  const modelStep = async () => {
    modelStepCalled = true;
    return { ok: true, costUsd: 0.001, artifact: { x: 1, done: true } };
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
    ceilingUsd: 1, // job1's signed cap is $0.25 — a $1 ceiling can never be funded.
  });

  assert.equal(result.outcome, 'cap-halt');
  assert.equal(modelStepCalled, false, 'modelStep must never be called once the cap check fails');
});

// ---------------------------------------------------------------------------
// Negative (iv): a flow whose files do not hash to signature.json is refused
// by name, at $0.
// ---------------------------------------------------------------------------
test('negative (iv): a corrupted declaration.json is refused by name, at $0', async () => {
  const root = tmpRoot('neg-iv');
  writeJob1Flow(root);
  const declPath = path.join(root, 'job1', 'declaration.json');
  const original = readFileSync(declPath, 'utf8');
  writeFileSync(declPath, `${original.slice(0, -2)}\n`); // one-byte edit after signing

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [],
    catalogue: CATALOGUE,
    modelStep: async () => { throw new Error('modelStep must never be called'); },
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'refused');
  assert.match(result.red, /declaration\.json/);

  const historyPath = path.join(root, 'job1', 'history.jsonl');
  const rows = readFileSync(historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'refused');
  assert.equal(rows[0].spentUsd, 0);
  assert.equal(rows[0].spendComplete, true);
  // The signature was never read/verified — `readFlow` refused before it got
  // that far — so this row must keep `signatureHash: null`, unlike a halt
  // reached after a successful `readFlow` (see the done:false test below).
  assert.equal(rows[0].signatureHash, null);
});

// ---------------------------------------------------------------------------
// Negative (v): a transport fault twice on one attempt parks the run
// provider-red with spendComplete:false, and the ledger shows the floor,
// never 0 when spend has actually happened.
// ---------------------------------------------------------------------------
test('negative (v): a transport fault twice parks the run provider-red, spendComplete:false', async () => {
  const root = tmpRoot('neg-v');
  writeJob1Flow(root);
  const srcDir = tmpRoot('neg-v-sources');
  const aging = writeTempCsv(srcDir);

  let calls = 0;
  const modelStep = async () => {
    calls += 1;
    return { ok: false, transport: true, red: 'ECONNRESET' };
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'provider-red');
  assert.equal(calls, 2, 'exactly one retry on the same attempt');

  const historyPath = path.join(root, 'job1', 'history.jsonl');
  const rows = readFileSync(historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows[rows.length - 1].spendComplete, false);
});

// M2 piece 2's own fix to piece 1's gap (flagged in piece 1's report): a
// KNOWN partial cost priced before a transport throw must survive as the
// floor in `spent`/`history.jsonl`'s `spentUsd` — never dropped to 0 just
// because the attempt as a whole ended in a provider-red.
test('a transport fault\'s known partial cost survives as the floor in spentUsd, never dropped to 0', async () => {
  const root = tmpRoot('transport-floor');
  writeJob1Flow(root);
  const srcDir = tmpRoot('transport-floor-sources');
  const aging = writeTempCsv(srcDir);

  let calls = 0;
  const modelStep = async () => {
    calls += 1;
    // Both the first (retried) attempt AND the final failing one priced
    // something real before the transport throw — the floor must be the
    // SUM of both, never just the last one.
    return {
      ok: false, transport: true, costUsd: 0.002, spendComplete: false, red: 'ECONNRESET',
    };
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'provider-red');
  assert.equal(calls, 2);
  assert.equal(result.spentUsd, 0.004, 'both priced rounds (retry + final) must be summed into the floor');

  const historyPath = path.join(root, 'job1', 'history.jsonl');
  const rows = readFileSync(historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = rows[rows.length - 1];
  assert.equal(last.spendComplete, false);
  assert.equal(last.spentUsd, 0.004, 'history.jsonl must record the floor, never 0, when money was actually spent');
});

// F41 books gap 2: a retried transport fault's own known floor must land on
// the ATTEMPT'S audit row, not just the run total — the fault's cost was
// previously only ever added to `spent.value`, never to the audit row of the
// attempt that then went on to succeed (or fault again).
test('F41 fix: a transport fault (priced) that then succeeds carries the fault\'s cost on the attempt\'s own audit row, summed with the audit rows equal to history', async () => {
  const root = tmpRoot('audit-floor-success');
  writeJob1Flow(root);
  const srcDir = tmpRoot('audit-floor-success-sources');
  const aging = writeTempCsv(srcDir);

  let calls = 0;
  const inner = makeJob1ModelStep();
  const modelStep = async (ctx, tools) => {
    calls += 1;
    if (calls === 1 && ctx.goal.includes('addressable cells')) {
      return {
        ok: false, transport: true, costUsd: 0.05, red: 'socket hang up',
      };
    }
    const stepResult = await inner(ctx, tools);
    if (ctx.goal.includes('addressable cells')) return { ...stepResult, costUsd: 0.02 };
    return stepResult;
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  const runDir = path.join(root, 'job1', 'runs', 'run-1');
  const auditPath = path.join(runDir, 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const firstStepRow = rows.find((r) => r.step === 'aging_cells');
  assert.equal(firstStepRow.usd, 0.07, 'the retried attempt\'s audit row must carry the fault\'s floor (0.05) summed with its own cost (0.02)');

  const historyPath = path.join(root, 'job1', 'history.jsonl');
  const historyRows = readFileSync(historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const lastHistory = historyRows[historyRows.length - 1];
  const auditSum = rows.reduce((a, r) => a + (typeof r.usd === 'number' ? r.usd : 0), 0);
  assert.ok(Math.abs(auditSum - lastHistory.spentUsd) < 1e-9, `audit rows' usd must sum to history's spentUsd (audit sum ${auditSum}, history ${lastHistory.spentUsd})`);
  assert.equal(result.outcome, 'complete');
});

test('F41 fix: two priced transport faults on the same attempt sum both known costs on the provider-red audit row', async () => {
  const root = tmpRoot('audit-floor-double-fault');
  writeJob1Flow(root);
  const srcDir = tmpRoot('audit-floor-double-fault-sources');
  const aging = writeTempCsv(srcDir);

  let calls = 0;
  const modelStep = async () => {
    calls += 1;
    return { ok: false, transport: true, costUsd: calls === 1 ? 0.05 : 0.03, red: 'ECONNRESET' };
  };

  await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  const runDir = path.join(root, 'job1', 'runs', 'run-1');
  const auditPath = path.join(runDir, 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = rows[rows.length - 1];
  assert.equal(last.verdict, 'provider-red');
  assert.equal(last.usd, 0.08, 'both faults\' known costs (0.05 + 0.03) must be summed on the provider-red row');
  assert.equal(last.spendComplete, false);
});

// ---------------------------------------------------------------------------
// Negative (vi): covered by the "construction test" above (real context vs.
// a leaky double smuggling `close` in).
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M2 amendment 1 item 1 ("done"/"blocker" on every artifact) — SIGNED
// 2026-09-24. The model's own typed word is taken at face value, mechanically,
// BEFORE the happened check or the close ever runs: `done: false` is a HALT
// naming the step and the blocker, never a strike, never a retry, and
// `closeByClass` never runs for that attempt (proved here by the closer's
// own effect — no artifact file, and the step AFTER it never gets a chance
// to run its modelStep at all).
// ---------------------------------------------------------------------------

function makeJob1ModelStepDoneVariant(step3Artifact) {
  const goalsSeen = [];
  const fn = async (ctx) => {
    goalsSeen.push(ctx.goal);
    if (ctx.goal.includes('addressable cells')) {
      return {
        ok: true,
        costUsd: 0.001,
        artifact: {
          kind: 'cells',
          rows: [{ rowNumber: 2, cells: { A: 'Acme Corp', B: 'INV-1', C: '2026-05-01', D: '2026-05-15', E: '150.00' } }],
          done: true,
        },
      };
    }
    if (ctx.goal.includes('work out which customer')) {
      return { ok: true, costUsd: 0.001, artifact: { matchedCustomer: 'Acme Corp', done: true } };
    }
    if (ctx.goal.includes('pull their open invoices')) {
      return { ok: true, costUsd: 0.001, artifact: step3Artifact };
    }
    throw new Error(`unexpected step goal in test fake: ${ctx.goal} — a step AFTER a not-done halt must never run`);
  };
  return { fn, goalsSeen };
}

test('M2 amendment 1 item 1: done:false halts "not-done", names the step and blocker, closeByClass never runs, no artifact, later steps never run', async () => {
  const root = tmpRoot('done-false');
  writeJob1Flow(root);
  const srcDir = tmpRoot('done-false-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep, goalsSeen } = makeJob1ModelStepDoneVariant({
    fields: { total_owed: { value: 999, cite: 'aging_cells!E2' } }, done: false, blocker: 'jd not readable',
  });

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'not-done');
  assert.match(result.red, /"invoice_facts"/);
  assert.match(result.red, /jd not readable/);

  // closeByClass never ran for this attempt: no artifact was written (a
  // green close would have written one), and the step immediately after
  // (reply_draft, "Write a short reply") never got a chance to call
  // modelStep at all — proof by effect, since closeByClass would only ever
  // be reached AFTER this check in the same attempt.
  const runDir = path.join(root, 'job1', 'runs', 'run-1');
  assert.equal(readArtifact(runDir, 'invoice_facts'), undefined, 'a not-done halt must never write an artifact');
  assert.ok(!goalsSeen.some((g) => g.includes('Write a short reply')), 'a step after a not-done halt must never run');

  const auditPath = path.join(runDir, 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const lastRow = rows[rows.length - 1];
  assert.equal(lastRow.step, 'invoice_facts');
  assert.equal(lastRow.verdict, 'not-done');

  const historyPath = path.join(root, 'job1', 'history.jsonl');
  const historyRows = readFileSync(historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(historyRows[historyRows.length - 1].outcome, 'not-done');

  // F41 books gap 1: a halt still names the flow version it halted on — the
  // signature was read and verified before this halt happened (readFlow
  // succeeded), so the history row must carry `signature.json`'s own `flow`
  // hash, never null.
  const signatureOnDisk = JSON.parse(readFileSync(path.join(root, 'job1', 'signature.json'), 'utf8'));
  assert.match(signatureOnDisk.flow, /^[0-9a-f]{64}$/, 'signature.json\'s own flow hash must be a 64-hex sha256 digest');
  assert.equal(historyRows[historyRows.length - 1].signatureHash, signatureOnDisk.flow, 'a halt AFTER readFlow succeeded must carry the flow\'s own signature hash, never null');
});

test('M2 amendment 1 item 1: a missing/non-boolean "done" halts naming the step, same as done:false', async () => {
  const root = tmpRoot('done-missing');
  writeJob1Flow(root);
  const srcDir = tmpRoot('done-missing-sources');
  const aging = writeTempCsv(srcDir);

  // A legacy/non-compliant provider that never emits "done" at all.
  const { fn: modelStep } = makeJob1ModelStepDoneVariant({
    fields: {
      invoice1: { value: 150, cite: 'aging_cells!E2' },
      total_owed: { value: 150, cite: '#invoice1' },
    },
  });

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'not-done');
  assert.match(result.red, /"invoice_facts" artifact has no boolean "done"/);

  const runDir = path.join(root, 'job1', 'runs', 'run-1');
  assert.equal(readArtifact(runDir, 'invoice_facts'), undefined);
});

test('M2 amendment 1 item 1: done:true proves nothing — a bad shape still reds through the ordinary close path', async () => {
  // negative (ii), above, already exercises this exact path with `done: true`
  // on every artifact (the fixture fakes were updated for the M2 amendment 1
  // item 1 mechanism) — struck-out on the SAME close-red gap, never waved
  // through by a true "done". Re-asserted explicitly here per the signed
  // scope's own wording.
  const root = tmpRoot('done-true-bad-shape');
  writeJob1Flow(root);
  const srcDir = tmpRoot('done-true-bad-shape-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts({ step3Behavior: 'always-wrong' });

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'struck-out');
  assert.match(result.red, /"total_owed" 999/);
});

// ---------------------------------------------------------------------------
// M2 amendment 1 item 2 (unjudged artifacts as evidence at the next signed
// ask) — SIGNED 2026-09-24. job #1's OWN fixture has two hitl steps not
// bound to any signed ask line (fromLine 1 and 2, "silent default hitl") —
// they must show up as `evidence.unjudged` on job #1's real ask (fromLine 5).
// ---------------------------------------------------------------------------

test('M2 amendment 1 item 2: job #1\'s unasked hitl steps (aging_cells, customer_match) are carried as evidence.unjudged into the signed ask', async () => {
  const root = tmpRoot('unjudged-evidence');
  writeJob1Flow(root);
  const srcDir = tmpRoot('unjudged-evidence-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts();

  let seenEvidence = null;
  const askStep = async ({ evidence }) => {
    seenEvidence = evidence;
    return { decision: 'accept' };
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);
  assert.ok(seenEvidence, 'the ask must have been called at least once');
  assert.ok('artifact' in seenEvidence, 'evidence still carries the ask step\'s own artifact');
  assert.equal(seenEvidence.unjudged.length, 2, 'both silent-default hitl steps (aging_cells, customer_match) must be carried');
  assert.deepEqual(seenEvidence.unjudged.map((u) => u.emits), ['aging_cells', 'customer_match']);
  assert.equal(seenEvidence.unjudged[0].artifact.kind, 'cells');
  assert.equal(seenEvidence.unjudged[1].artifact.matchedCustomer, 'Acme Corp');
  // Neither unjudged artifact carries the model's raw done/blocker self-report —
  // it was stripped before this artifact was written/carried, same as any
  // other artifact downstream of a "done:true" check.
  assert.equal('done' in seenEvidence.unjudged[0].artifact, false);

  const auditPath = path.join(root, 'job1', 'runs', 'run-1', 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const askRow = rows.find((r) => r.step === 'approved_reply' && r.verdict === 'green');
  assert.ok(askRow, 'the ask\'s own accept row must exist');
  assert.equal(askRow.unjudgedCount, 2);

  const askJsonPath = path.join(root, 'job1', 'runs', 'run-1', 'ask.json');
  // ask.json is renamed away (consumed) once ACCEPT_ASK-style stand-ins are
  // used with the real file protocol — here the fake askStep never wrote
  // ask.json at all (it's a plain injected function), so this simply proves
  // no stray ask.json was left behind.
  assert.equal(existsSync(askJsonPath), false);
});

// A synthetic TWO-ask flow (job #1's own fixture, plus an extra ask inserted
// at line 3 — same shape as poc/m1/fixtures/twoask.prose.txt) proves the
// reset: ask #1 (line 3) must show the two unasked hitl steps before it
// (aging_cells, customer_match); ask #2 (line 6) must show NOTHING, because
// nothing unjudged happened between the two asks (invoice_facts is green,
// reply_draft is softgreen — neither is hitl).
const TWO_ASK_PROSE = `1. When the AR aging sheet lands, read it,
2. then read the chat message and work out which customer it is about.
   guardrail: if more than one customer matches, ask me, do not pick
3. ask: which customer is this about?
4. Pull their open invoices, what they owe in total, the earliest due date, and how many are overdue as of the business date.
   guardrail: every number must point to the cell it came from or the formula that made it
5. Write me a short reply with one line per invoice,
   guardrail: one line per invoice in the reply
6. ask: check it with me,
   guardrail: nothing goes out before I accept
7. and send it once I accept.

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: send at line 7 to file:poc/m0/out
guardrail: source aging = file:/home/hamr/Documents/ar/aging.csv
`;

const AGING_LISTING = [
  'Customer', 'Invoice #', 'Invoice date', 'Due date', 'Amount', 'Days overdue', 'Current', '1-30', '31-60', '61-90', '90+',
];

const TWO_ASK_DECLARATION = {
  guardrailClasses: { 2: 'hitl', 4: 'green', 5: 'softgreen' },
  unjudgeable: {},
  refused: [],
  inputFacts: { aging: AGING_LISTING },
  steps: [
    {
      goal: 'Read the AR aging sheet as addressable cells so every figure downstream can be cited back to a cell.',
      primitives: ['addressCells'],
      reads: [],
      emits: 'aging_cells',
      picks: { aging: AGING_LISTING },
      fromLine: 1,
      close: { class: 'hitl' },
    },
    {
      goal: 'Read the chat message and work out which customer in the aging sheet it is about; if more than one customer matches, ask the human instead of picking one.',
      primitives: ['read'],
      reads: ['aging_cells'],
      emits: 'customer_match',
      picks: { aging: ['Customer'] },
      fromLine: 2,
      close: { class: 'hitl' },
    },
    {
      goal: 'Confirm with the human which customer this is about.',
      primitives: [],
      reads: ['customer_match'],
      emits: 'customer_confirmed',
      fromLine: 3,
      close: { class: 'hitl' },
    },
    {
      goal: 'For the matched customer, pull their open invoices, total owed, earliest due date, and count of invoices overdue as of the business date, each figure tied to the cell or formula it came from.',
      primitives: ['addressCells'],
      reads: ['aging_cells', 'customer_confirmed'],
      emits: 'invoice_facts',
      picks: { aging: ['Customer', 'Invoice #', 'Due date', 'Amount'] },
      fromLine: 4,
      close: { class: 'green' },
    },
    {
      goal: 'Write a short reply to the customer containing one line per open invoice.',
      primitives: ['write'],
      reads: ['invoice_facts'],
      emits: 'reply_draft',
      picks: { aging: ['Invoice #', 'Due date', 'Amount'] },
      fromLine: 5,
      close: {
        class: 'softgreen',
        shape: { linesPerInvoice: 1, mustCarry: ['Invoice #', 'Due date', 'Amount'] },
      },
    },
    {
      goal: 'Show the drafted reply to the human and wait for their acceptance before anything leaves.',
      primitives: [],
      reads: ['reply_draft'],
      emits: 'approved_reply',
      fromLine: 6,
      close: { class: 'hitl' },
    },
    {
      goal: 'Send the accepted reply to the customer.',
      primitives: ['write'],
      reads: ['approved_reply'],
      emits: 'sent_reply',
      fromLine: 7,
      close: { class: 'hitl' },
    },
  ],
};

test('M2 amendment 1 item 2: the unjudged list resets after an ask — a synthetic two-ask flow only shows what happened since the previous ask', async () => {
  const root = tmpRoot('unjudged-two-ask');
  const written = writeFlow({
    root,
    name: 'twoask',
    proseText: TWO_ASK_PROSE,
    declaration: TWO_ASK_DECLARATION,
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

  const srcDir = tmpRoot('unjudged-two-ask-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts();

  const evidences = [];
  const askStep = async ({ evidence }) => {
    evidences.push(evidence);
    return { decision: 'accept' };
  };

  const result = await runFlow({
    root,
    name: 'twoask',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);
  assert.equal(evidences.length, 2, 'two signed asks, two evidence payloads');

  assert.equal(evidences[0].unjudged.length, 2, 'ask #1 carries both silent-default hitl steps before it');
  assert.deepEqual(evidences[0].unjudged.map((u) => u.emits), ['aging_cells', 'customer_match']);

  assert.equal(evidences[1].unjudged.length, 0, 'ask #2 carries nothing — invoice_facts/reply_draft are not hitl, and the list reset after ask #1');

  const auditPath = path.join(root, 'twoask', 'runs', 'run-1', 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const ask1Row = rows.find((r) => r.step === 'customer_confirmed' && r.verdict === 'green');
  const ask2Row = rows.find((r) => r.step === 'approved_reply' && r.verdict === 'green');
  assert.equal(ask1Row.unjudgedCount, 2);
  assert.equal(ask2Row.unjudgedCount, 0);
});

test('M2 amendment 1 item 2: ask.json on disk (the real file protocol) carries evidence.unjudged', async () => {
  const root = tmpRoot('unjudged-ask-json');
  const written = writeFlow({
    root,
    name: 'twoask',
    proseText: TWO_ASK_PROSE,
    declaration: TWO_ASK_DECLARATION,
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

  const srcDir = tmpRoot('unjudged-ask-json-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts();
  const runId = 'run-1';
  const runDir = path.join(root, 'twoask', 'runs', runId);
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000 });

  const runPromise = runFlow({
    root,
    name: 'twoask',
    runId,
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 3000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => { setTimeout(r, 10); }); }
  assert.ok(existsSync(askPath), 'the first ask must reach disk');
  const askJson = JSON.parse(readFileSync(askPath, 'utf8'));
  assert.equal(askJson.evidence.unjudged.length, 2);
  assert.deepEqual(askJson.evidence.unjudged.map((u) => u.emits), ['aging_cells', 'customer_match']);

  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: new Date().toISOString() }));

  // Wait for the SECOND ask to land, then answer it too.
  const secondAskDeadline = Date.now() + 3000;
  let secondAskJson = null;
  while (Date.now() < secondAskDeadline) {
    if (existsSync(askPath)) {
      const parsed = JSON.parse(readFileSync(askPath, 'utf8'));
      if (parsed.attempt === 2) { secondAskJson = parsed; break; }
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 10); });
  }
  assert.ok(secondAskJson, 'the second ask must reach disk');
  assert.equal(secondAskJson.evidence.unjudged.length, 0, 'nothing unjudged happened between the two asks');
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: new Date().toISOString() }));

  const result = await runPromise;
  assert.equal(result.outcome, 'complete', result.red);
});

// ---------------------------------------------------------------------------
// A reject "<reason>" on job #1's ask re-runs the compose step with that
// reason as the gap, and the audit shows attempt 2.
// ---------------------------------------------------------------------------
test('a reject with a reason on job #1\'s ask re-runs the compose step with the reason as the gap', async () => {
  const root = tmpRoot('reject-redo');
  writeJob1Flow(root);
  const srcDir = tmpRoot('reject-redo-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts();

  let asked = 0;
  const askStep = async () => {
    asked += 1;
    if (asked === 1) return { decision: 'reject', reason: 'add labels to each figure' };
    return { decision: 'accept' };
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);
  assert.match(result.artifacts.sent_reply.text, /Due date/);

  const auditPath = path.join(root, 'job1', 'runs', 'run-1', 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const composeRows = rows.filter((r) => r.step === 'reply_draft');
  assert.equal(composeRows.length, 2, 'attempt 1 (before reject) and attempt 2 (after reject, with the reason as gap)');
  assert.equal(composeRows[1].attempt, 2);
});

// ---------------------------------------------------------------------------
// A reason-less rejection/rerun is refused and re-asked, never advances.
// ---------------------------------------------------------------------------
test('a reason-less rejection is refused and re-asked, never advances', async () => {
  const root = tmpRoot('reasonless');
  writeJob1Flow(root);
  const srcDir = tmpRoot('reasonless-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts();

  let asked = 0;
  const askStep = async () => {
    asked += 1;
    if (asked === 1) return { decision: 'reject', reason: '' };
    return { decision: 'accept' };
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);
  assert.equal(asked, 2);
});

test('STRIKE_LIMIT and MAX_ATTEMPTS are the frozen constants the ladder signs', () => {
  assert.equal(STRIKE_LIMIT, 2);
  assert.equal(MAX_ATTEMPTS, 4);
});

// ---------------------------------------------------------------------------
// Item 2: every emitted artifact lands on disk under runs/<runId>/artifacts/
// the moment its step closes; a second write to the same id within a run is
// refused (unless the caller deliberately asks to overwrite it).
// ---------------------------------------------------------------------------

test('writeArtifact/readArtifact: writes and reads back an artifact file', () => {
  const runDir = tmpRoot('artifact-io');
  writeArtifact(runDir, 'some-id', { text: 'hello' });
  assert.deepEqual(readArtifact(runDir, 'some-id'), { text: 'hello' });
});

test('writeArtifact: refuses (throws) to overwrite an existing artifact id within a run', () => {
  const runDir = tmpRoot('artifact-overwrite');
  writeArtifact(runDir, 'some-id', { text: 'first' });
  assert.throws(() => writeArtifact(runDir, 'some-id', { text: 'second' }), /already exists/);
  assert.deepEqual(readArtifact(runDir, 'some-id'), { text: 'first' }, 'the refused write must not have touched the file');
});

test('writeArtifact: an explicit overwrite:true replaces the file (the ask-redo path\'s own case)', () => {
  const runDir = tmpRoot('artifact-overwrite-allowed');
  writeArtifact(runDir, 'some-id', { text: 'first' });
  writeArtifact(runDir, 'some-id', { text: 'second' }, { overwrite: true });
  assert.deepEqual(readArtifact(runDir, 'some-id'), { text: 'second' });
});

test('readArtifact: undefined for an artifact never written', () => {
  const runDir = tmpRoot('artifact-missing');
  assert.equal(readArtifact(runDir, 'never-written'), undefined);
});

test('runFlow: job #2 fixture writes all five artifacts to disk with the right content, and log.json reflects them', async () => {
  const root = tmpRoot('job2-artifacts');
  writeJob2Flow(root);
  const srcDir = tmpRoot('job2-artifacts-sources');
  const resume = writeTempDocxLike(srcDir, 'resume.docx', 'Resume text goes here.');
  const jd = writeTempDocxLike(srcDir, 'jd.md', 'JD text goes here.');

  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected job2 goal: ${ctx.goal}`);
  };

  const result = await runFlow({
    root,
    name: 'job2',
    runId: 'run-1',
    sources: [{ id: 'resume', path: resume }, { id: 'jd', path: jd }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);

  const expectedIds = ['resume-text', 'jd-text', 'resume-summary', 'resume-summary-approved', 'resume-summary-output'];
  for (const id of expectedIds) {
    const onDisk = readArtifact(result.runDir, id);
    assert.notEqual(onDisk, undefined, `artifact "${id}" must exist on disk`);
    assert.deepEqual(onDisk, result.artifacts[id], `artifact "${id}" on disk must match the run's own result`);
  }
  assert.equal(readArtifact(result.runDir, 'resume-text').text, 'resume text');
  assert.equal(readArtifact(result.runDir, 'jd-text').text, 'jd text');

  const logJson = JSON.parse(readFileSync(path.join(result.runDir, 'log.json'), 'utf8'));
  for (const id of expectedIds) {
    assert.deepEqual(logJson.artifacts[id], result.artifacts[id]);
  }
});

// ---------------------------------------------------------------------------
// Item 3: log.json keeps every attempt's raw model output, red attempts
// included — a planted red on attempt 1 then green on 2 must show both.
// ---------------------------------------------------------------------------

test('log.json: a red attempt 1 then a green attempt 2 both appear in "attempts", attempt 1 with its own output', async () => {
  const root = tmpRoot('log-attempts');
  writeJob1Flow(root);
  const srcDir = tmpRoot('log-attempts-sources');
  const aging = writeTempCsv(srcDir);

  let calls = 0;
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('addressable cells')) {
      return {
        ok: true,
        costUsd: 0.001,
        artifact: {
          kind: 'cells',
          rows: [
            { rowNumber: 2, cells: { A: 'Acme Corp', B: 'INV-1', C: '2026-05-01', D: '2026-05-15', E: '150.00' } },
            { rowNumber: 3, cells: { A: 'Acme Corp', B: 'INV-2', C: '2026-05-05', D: '2026-05-20', E: '50.50' } },
          ],
          done: true,
        },
      };
    }
    if (ctx.goal.includes('work out which customer')) return { ok: true, costUsd: 0.001, artifact: { matchedCustomer: 'Acme Corp', done: true } };
    if (ctx.goal.includes('pull their open invoices')) {
      calls += 1;
      if (calls === 1) {
        // Attempt 1: a deliberately wrong artifact — must close-red.
        return { ok: true, costUsd: 0.001, artifact: { fields: { total_owed: { value: 999, cite: 'aging_cells!E2' } }, done: true } };
      }
      return {
        ok: true,
        costUsd: 0.001,
        artifact: {
          fields: {
            invoice1: { value: 150, cite: 'aging_cells!E2' },
            invoice2: { value: 50.5, cite: 'aging_cells!E3' },
            total_owed: { value: 200.5, cite: 'sum(#invoice1,#invoice2)' },
          },
          done: true,
        },
      };
    }
    if (ctx.goal.includes('Write a short reply')) {
      const text = 'Invoice # INV-1 Due date 2026-05-15 Amount 150\n'
        + 'Invoice # INV-2 Due date 2026-05-20 Amount 50.50';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected step goal in test fake: ${ctx.goal}`);
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);

  const logJson = JSON.parse(readFileSync(path.join(result.runDir, 'log.json'), 'utf8'));
  const invoiceAttempts = logJson.attempts.filter((a) => a.step === 'invoice_facts');
  assert.equal(invoiceAttempts.length, 2, 'both the red attempt 1 and the green attempt 2 must be recorded');
  assert.equal(invoiceAttempts[0].attempt, 1);
  assert.equal(invoiceAttempts[0].verdict, 'red');
  assert.equal(invoiceAttempts[0].modelOutput.fields.total_owed.value, 999, 'attempt 1\'s own (wrong) output must be kept, not overwritten by attempt 2');
  assert.equal(invoiceAttempts[1].attempt, 2);
  assert.equal(invoiceAttempts[1].verdict, 'green');
  assert.equal(invoiceAttempts[1].modelOutput.fields.total_owed.value, 200.5);
});

test('log.json: a struck-out run still keeps every attempt\'s output', async () => {
  const root = tmpRoot('log-struckout');
  writeJob1Flow(root);
  const srcDir = tmpRoot('log-struckout-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts({ step3Behavior: 'always-wrong' });

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'struck-out');

  const runDir = path.join(root, 'job1', 'runs', 'run-1');
  const logJson = JSON.parse(readFileSync(path.join(runDir, 'log.json'), 'utf8'));
  assert.equal(logJson.outcome, 'struck-out');
  assert.ok(logJson.red, 'a halted log.json must still carry the red');
  const invoiceAttempts = logJson.attempts.filter((a) => a.step === 'invoice_facts');
  assert.equal(invoiceAttempts.length, 3, 'every attempt before striking out must be kept, including the model\'s output each time');
  for (const a of invoiceAttempts) {
    assert.equal(a.modelOutput.fields.total_owed.value, 999);
  }
});

test('log.json: a model failure that emits no artifact keeps the model step\'s red string as modelOutput', async () => {
  const root = tmpRoot('log-no-artifact');
  writeJob1Flow(root);
  const srcDir = tmpRoot('log-no-artifact-sources');
  const aging = writeTempCsv(srcDir);

  const modelStep = async (ctx) => {
    if (ctx.goal.includes('addressable cells')) {
      return {
        ok: true,
        costUsd: 0.001,
        artifact: {
          kind: 'cells',
          rows: [{ rowNumber: 2, cells: { A: 'Acme Corp', B: 'INV-1', C: '2026-05-01', D: '2026-05-15', E: '150.00' } }],
          done: true,
        },
      };
    }
    if (ctx.goal.includes('work out which customer')) return { ok: false, red: 'the model refused to answer' };
    throw new Error(`unexpected step goal in test fake: ${ctx.goal}`);
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.notEqual(result.outcome, 'complete');
  const runDir = path.join(root, 'job1', 'runs', 'run-1');
  const logJson = JSON.parse(readFileSync(path.join(runDir, 'log.json'), 'utf8'));
  const found = logJson.attempts.find((a) => a.modelOutput === 'the model refused to answer');
  assert.ok(found, 'the model step\'s own red string must be kept as modelOutput when nothing was emitted');
});

// ---------------------------------------------------------------------------
// Item 4: an answer.json still on disk, unconsumed, at run end gets one
// audit row so a human can see their late answer changed nothing.
// ---------------------------------------------------------------------------

test('a late answer.json (written after the run\'s own ask already decided) is recorded, never applied', async () => {
  const root = tmpRoot('late-answer');
  writeJob1Flow(root);
  const srcDir = tmpRoot('late-answer-sources');
  const aging = writeTempCsv(srcDir);

  const { fn: modelStep } = job1ModelStepWithContexts();

  // Simulates the live race: a human's answer arrives on disk through the
  // real file-ask channel AFTER this ask already resolved via some other
  // path (here: the injected fake's own return value) — the file is never
  // consumed by anything in the run.
  const askStep = async ({ runDir }) => {
    writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'reject', reason: 'late', answeredAt: new Date().toISOString() }));
    return { decision: 'accept' };
  };

  const result = await runFlow({
    root,
    name: 'job1',
    runId: 'run-1',
    sources: [{ id: 'aging', path: aging }],
    catalogue: CATALOGUE,
    modelStep,
    askStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(result.outcome, 'complete', result.red);

  const runDir = path.join(root, 'job1', 'runs', 'run-1');
  assert.ok(existsSync(path.join(runDir, 'answer.json')), 'the late answer file itself is left in place, only noted');

  const auditPath = path.join(runDir, 'audit.jsonl');
  const rows = readFileSync(auditPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const lateRow = rows.find((r) => r.kind === 'answer-after-run');
  assert.ok(lateRow, 'must record one audit row for the unconsumed late answer');
  assert.equal(lateRow.file, path.join(runDir, 'answer.json'));

  // The run itself completed on the fake's OWN accept — the late reject on
  // disk changed nothing about the outcome.
  assert.ok(result.artifacts.sent_reply);
});
