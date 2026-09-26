// Tests for M3 piece 1 (docs/wiki/the-module-ladder.md, "M3 — scope, exit,
// negative — SIGNED", scope items 1, 2, 4-6): park-and-exit at a signed ask,
// and resuming into the SAME fold (`resumeRun`) from a separate call later.
// Every run happens at $0 against a fake modelStep/sendStep — no provider,
// no key, no network. Every wait is driven by an injected clock or a
// canned answer file, never a real sleep-then-assert.

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
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-25T12:00:00Z';
const BUSINESS_DATE = '2026-06-01';

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-${prefix}-`));
}

function writeTempFile(dir, name, text) {
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
}

function writeSources(srcDir) {
  const resume = writeTempFile(srcDir, 'resume.docx', 'Resume text goes here.');
  const jd = writeTempFile(srcDir, 'jd.md', 'JD text goes here.');
  return [{ id: 'resume', path: resume }, { id: 'jd', path: jd }];
}

// job #2's fixture prose, with the ask mark on line 4 swappable so a test can
// prove the SIGNED ttl governs (item 1) without a real wait.
function job2Prose({ askMark = 'ask:' } = {}) {
  const base = fixture('job2-with-sources.signed.txt');
  assert.ok(base.includes('4. ask: check it with me,'), 'fixture line 4 must still read "ask: check it with me,"');
  return base.replace('4. ask: check it with me,', `4. ${askMark} check it with me,`);
}

function writeJob2Flow(root, { name = 'job2', askMark } = {}) {
  const result = writeFlow({
    root,
    name,
    proseText: job2Prose({ askMark }),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

/** Fake modelStep for job #2's three model-backed steps, counting calls per
 *  emitted id so a test can prove a pre-ask step never re-runs across a
 *  park/resume boundary. */
function makeJob2ModelStep() {
  const calls = { 'resume-text': 0, 'jd-text': 0, 'resume-summary': 0 };
  const fn = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) {
      calls['resume-text'] += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    }
    if (ctx.goal.includes('job description markdown')) {
      calls['jd-text'] += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    }
    if (ctx.goal.includes('Draft the summary resume')) {
      calls['resume-summary'] += 1;
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected job2 goal: ${ctx.goal}`);
  };
  return { fn, calls };
}

const NOOP_SEND = async (target, filename, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });

function baseRunArgs({
  root, name = 'job2', runId = 'run-1', modelStep, askStep, clock, nowMs,
}) {
  return {
    root,
    name,
    runId,
    catalogue: CATALOGUE,
    modelStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
    ...(askStep ? { askStep } : {}),
    ...(clock ? { clock } : {}),
    ...(nowMs ? { nowMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// Item 1 (fixes F43): the signed ttl governs, never a code default.
// ---------------------------------------------------------------------------

test('M3 item 1: a signed "ask 2s:" expires at 2s, not the code default — proven with a controlled clock, no real wait', async () => {
  const root = tmpRoot('ttl-2s');
  writeJob2Flow(root, { askMark: 'ask 2s:' });
  const srcDir = tmpRoot('ttl-2s-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const FIXED_NOW = '2026-01-01T00:00:00.000Z';

  const result = await runFlow({
    ...baseRunArgs({
      root, modelStep, askStep: makeParkingAskStep(), clock: () => FIXED_NOW,
    }),
    sources: writeSources(srcDir),
  });

  assert.equal(result.outcome, 'paused', result.red);
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const ask = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8'));
  const state = JSON.parse(readFileSync(path.join(runDir, 'state.json'), 'utf8'));
  assert.equal(ask.askedAt, FIXED_NOW);
  assert.equal(Date.parse(ask.expiresAt) - Date.parse(ask.askedAt), 2000, 'ask.json must expire 2s after askedAt, not the 30m default');
  assert.equal(state.expiresAt, ask.expiresAt);
});

// ---------------------------------------------------------------------------
// Item 2/4: park -> answerAsk accept -> resumeRun, artifacts equal an
// in-process run, pre-ask model steps called exactly once.
// ---------------------------------------------------------------------------

test('park -> answerAsk accept -> resumeRun completes job #2, artifacts equal an in-process run, pre-ask model steps called once', async () => {
  // Reference: a plain in-process run (M2 shape), never parked.
  const refRoot = tmpRoot('ref');
  writeJob2Flow(refRoot);
  const refSrc = tmpRoot('ref-src');
  const { fn: refModelStep } = makeJob2ModelStep();
  const refResult = await runFlow({
    ...baseRunArgs({ root: refRoot, modelStep: refModelStep, askStep: async () => ({ decision: 'accept' }) }),
    sources: writeSources(refSrc),
  });
  assert.equal(refResult.outcome, 'complete', refResult.red);

  // The park/resume path.
  const root = tmpRoot('park-accept');
  writeJob2Flow(root);
  const srcDir = tmpRoot('park-accept-src');
  const { fn: modelStep, calls } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.ok(parked.askId);
  assert.equal(existsSync(path.join(parked.runDir, 'ask.json')), true);
  assert.equal(existsSync(path.join(parked.runDir, 'resume.lock')), false, 'a paused run must hold no lock — nothing is waiting');

  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true, ans.ok ? '' : ans.red);

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'complete', resumed.red);
  assert.deepEqual(resumed.artifacts, refResult.artifacts);

  assert.equal(calls['resume-text'], 1, 'resume-text must not be re-run on resume');
  assert.equal(calls['jd-text'], 1, 'jd-text must not be re-run on resume');
  assert.equal(calls['resume-summary'], 1, 'resume-summary must not be re-run on resume');
});

// ---------------------------------------------------------------------------
// park -> reject -> resume redoes the prior step once and re-parks under a
// NEW askId, with the signed ttl (not the POC's hard-coded 30m) -> accept ->
// complete.
// ---------------------------------------------------------------------------

test('park -> reject -> resume redoes the prior step once and re-parks with a NEW askId under the signed ttl -> accept -> complete', async () => {
  const root = tmpRoot('park-reject');
  writeJob2Flow(root, { askMark: 'ask 2s:' });
  const srcDir = tmpRoot('park-reject-src');
  const { fn: modelStep, calls } = makeJob2ModelStep();

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const askId1 = parked.askId;

  const rej = answerAsk({
    runDir: parked.runDir, askId: askId1, decision: 'reject', reason: 'tighten the skills section',
  });
  assert.equal(rej.ok, true, rej.ok ? '' : rej.red);

  const afterReject = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(afterReject.outcome, 'paused', afterReject.red);
  assert.ok(afterReject.askId);
  assert.notEqual(afterReject.askId, askId1, 'a re-park after reject must mint a NEW askId, never reuse the dead one');

  const askJson = JSON.parse(readFileSync(path.join(parked.runDir, 'ask.json'), 'utf8'));
  assert.equal(askJson.askId, afterReject.askId);
  assert.equal(
    Date.parse(askJson.expiresAt) - Date.parse(askJson.askedAt),
    2000,
    'the re-park must use the SIGNED ttl, never a hard-coded default (the M3 POC\'s own bug, F44)',
  );

  const acc = answerAsk({ runDir: parked.runDir, askId: afterReject.askId, decision: 'accept' });
  assert.equal(acc.ok, true, acc.ok ? '' : acc.red);

  const done = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(done.outcome, 'complete', done.red);

  assert.equal(calls['resume-text'], 1);
  assert.equal(calls['jd-text'], 1);
  assert.equal(calls['resume-summary'], 2, 'the reject must redo the prior step exactly once more, never re-run the whole flow');
});

// ---------------------------------------------------------------------------
// Negative (i): an answer arriving after expiresAt cancels the run.
// ---------------------------------------------------------------------------

test('negative (i): resuming after expiresAt cancels the run — ask-expired, adds nothing further, nothing sent', async () => {
  const root = tmpRoot('expired');
  writeJob2Flow(root);
  const srcDir = tmpRoot('expired-src');
  const { fn: modelStep, calls } = makeJob2ModelStep();
  const PARK_TIME = '2000-01-01T00:00:00.000Z'; // long past, even under the 30m default ttl

  const parked = await runFlow({
    ...baseRunArgs({
      root, modelStep, askStep: makeParkingAskStep(), clock: () => PARK_TIME,
    }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  // Write the answer directly — this test is about resumeRun's OWN cancel,
  // not answerAsk's (which would also refuse an expired askId).
  writeFileSync(path.join(parked.runDir, 'answer.json'), JSON.stringify({
    askId: parked.askId, decision: 'accept', answeredAt: PARK_TIME,
  }, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'ask-expired');
  // Orchestrator review fix (2): "a pause spends nothing" means the pause
  // itself adds nothing further — never that the run's already-real total
  // resets to 0. The three pre-ask model rounds already cost real money.
  assert.equal(resumed.spentUsd, parked.spentUsd);
  assert.ok(resumed.spentUsd > 0, 'the pre-ask rounds already spent something real');
  assert.equal(calls['resume-summary'], 1, 'no step must run again on an expired resume');
  assert.equal(existsSync(path.join(parked.runDir, 'sent')), false, 'nothing must be sent on an expired resume');

  const history = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(history.some((r) => r.outcome === 'ask-expired' && r.spentUsd === parked.spentUsd));
});

// ---------------------------------------------------------------------------
// Negative (iii): a frozen input changed while parked.
// ---------------------------------------------------------------------------

test('negative (iii): a frozen input changed while parked makes resume refuse, naming the input, at $0', async () => {
  const root = tmpRoot('tamper');
  writeJob2Flow(root);
  const srcDir = tmpRoot('tamper-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true, ans.ok ? '' : ans.red);

  const frozenResume = path.join(parked.runDir, 'inputs', 'resume.docx');
  assert.ok(existsSync(frozenResume));
  writeFileSync(frozenResume, 'TAMPERED CONTENT');

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /frozen input "resume" changed while parked/);
});

// ---------------------------------------------------------------------------
// Negative (iv): a second answerAsk to an already-answered ask is refused;
// the first stands.
// ---------------------------------------------------------------------------

test('negative (iv): a second answerAsk to an already-answered ask is refused; the first stands', async () => {
  const root = tmpRoot('second-answer');
  writeJob2Flow(root);
  const srcDir = tmpRoot('second-answer-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  const first = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(first.ok, true, first.ok ? '' : first.red);

  const second = answerAsk({
    runDir: parked.runDir, askId: parked.askId, decision: 'reject', reason: 'changed my mind',
  });
  assert.equal(second.ok, false);
  assert.match(second.red, /already answered/);

  const answerJson = JSON.parse(readFileSync(path.join(parked.runDir, 'answer.json'), 'utf8'));
  assert.equal(answerJson.decision, 'accept', 'the FIRST answer must still stand, untouched by the refused second');

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'complete', resumed.red);

  // And after resume consumes it, a THIRD answerAsk naming the same (now
  // long-dead) askId is refused too — the consumed marker outlives the run.
  const third = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(third.ok, false);
  assert.match(third.red, /already answered/);
});

// ---------------------------------------------------------------------------
// Negative (v): two concurrent resumeRun calls — exactly one proceeds.
// ---------------------------------------------------------------------------

test('negative (v): two concurrent resumeRun calls — exactly one proceeds, the other refuses naming the run', async () => {
  const root = tmpRoot('concurrent');
  writeJob2Flow(root);
  const srcDir = tmpRoot('concurrent-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const resumeArgs = baseRunArgs({ root, modelStep });
  const [a, b] = await Promise.all([resumeRun(resumeArgs), resumeRun(resumeArgs)]);
  const outcomes = [a.outcome, b.outcome].sort();
  assert.deepEqual(outcomes, ['complete', 'refused']);
  const refused = a.outcome === 'refused' ? a : b;
  assert.match(refused.red, /run "run-1" is locked by another resumer/);
});

// ---------------------------------------------------------------------------
// A stale lock left behind by a killed resumer is a red naming it, never
// stolen.
// ---------------------------------------------------------------------------

test('a stale resume.lock left behind by a killed resumer is a red naming it, never stolen', async () => {
  const root = tmpRoot('stale-lock');
  writeJob2Flow(root);
  const srcDir = tmpRoot('stale-lock-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const lockPath = path.join(parked.runDir, 'resume.lock');
  writeFileSync(lockPath, '');
  assert.ok(existsSync(lockPath));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /locked by another resumer/);
  assert.ok(existsSync(lockPath), 'a stale lock must never be deleted/stolen by a refused resumer');
});

// ---------------------------------------------------------------------------
// Orchestrator review of piece 1 — six defects, each with its own test.
// ---------------------------------------------------------------------------

// (1) Unknown cost is never rendered as 0: a missing/non-number/non-finite
// state.json "spent" refuses the resume by name, naming the run and the
// field, $0 further spend.
test('orchestrator fix 1: a non-finite state.json "spent" refuses the resume, naming the run and the field', async () => {
  const root = tmpRoot('bad-spent');
  writeJob2Flow(root);
  const srcDir = tmpRoot('bad-spent-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const statePath = path.join(parked.runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.spent = 'not-a-number';
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /run "run-1" state\.json field "spent" is not a finite number/);
});

// A present-but-unparseable state.json "expiresAt" (Date.parse -> NaN) must
// never be treated as "not expired" — refused by name, before the answer
// is consumed (answer.json must survive the refusal untouched).
test('debrief fix: a garbage (unparseable) state.json "expiresAt" refuses the resume, naming the run, before consuming the answer', async () => {
  const root = tmpRoot('bad-expiry');
  writeJob2Flow(root);
  const srcDir = tmpRoot('bad-expiry-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const statePath = path.join(parked.runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.expiresAt = 'not-a-real-date';
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /run "run-1" state\.json field "expiresAt" \("not-a-real-date"\) is not a parseable date/);
  assert.equal(existsSync(path.join(parked.runDir, 'answer.json')), true, 'the refusal must happen BEFORE the answer is consumed');
});

// ---------------------------------------------------------------------------
// Debrief fix: a negative or implausible state.json "spent" is never
// trusted by the cap — refused by name, exactly like a non-finite one.
// ---------------------------------------------------------------------------

test('debrief fix: a negative state.json "spent" refuses the resume, naming the run and the field', async () => {
  const root = tmpRoot('negative-spent');
  writeJob2Flow(root);
  const srcDir = tmpRoot('negative-spent-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const statePath = path.join(parked.runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.spent = -0.5;
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /run "run-1" state\.json field "spent" is negative \(-0\.5\)/);
});

test('debrief fix: a state.json "spent" lower than the run\'s own audit.jsonl sum refuses the resume, naming both figures', async () => {
  const root = tmpRoot('under-spent');
  writeJob2Flow(root);
  const srcDir = tmpRoot('under-spent-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.ok(parked.spentUsd > 0, 'the pre-ask rounds must have already cost something real');
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const statePath = path.join(parked.runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  // Books (audit.jsonl) already recorded parked.spentUsd; claim less.
  state.spent = parked.spentUsd / 2;
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /run "run-1" state\.json field "spent" \(\$[\d.]+\) is less than its own audit\.jsonl sum \(\$[\d.]+\)/);
});

test('debrief fix: an honest state.json "spent" (matching the audit sum) still resumes normally', async () => {
  const root = tmpRoot('honest-spent');
  writeJob2Flow(root);
  const srcDir = tmpRoot('honest-spent-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'complete', resumed.red);
});

// Debrief round 2: a HONEST resume must not be refused merely because
// `state.spent` (accumulated via repeated `spent.value +=`) and
// `sumAuditUsd`'s re-summed total land on a different float by a single ULP
// from summation-order alone — reproduced through the REAL runFlow -> park
// -> answerAsk accept -> resumeRun path with a fake modelStep that throws a
// transport fault (retried once by runStepRalph) on the first two pre-ask
// steps, using the exact floor/retry costs from the debrief repro so the
// float drift is the real IEEE 754 non-associativity, not a contrived value.
test('debrief round 2: an honest resume is never refused over a single-ULP float drift between state.spent and the audit sum', async () => {
  const root = tmpRoot('ulp-drift');
  writeJob2Flow(root);
  const srcDir = tmpRoot('ulp-drift-src');

  const callCounts = { 'resume-text': 0, 'jd-text': 0, 'resume-summary': 0 };
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) {
      callCounts['resume-text'] += 1;
      if (callCounts['resume-text'] === 1) {
        // First call: a transport fault with a known partial floor.
        return { ok: false, transport: true, costUsd: 0.001134, red: 'ECONNRESET on first attempt' };
      }
      // Retry: succeeds.
      return { ok: true, costUsd: 0.00075, artifact: { text: 'resume text', done: true } };
    }
    if (ctx.goal.includes('job description markdown')) {
      callCounts['jd-text'] += 1;
      if (callCounts['jd-text'] === 1) {
        return { ok: false, transport: true, costUsd: 0.003383, red: 'ECONNRESET on first attempt' };
      }
      return { ok: true, costUsd: 0.000607, artifact: { text: 'jd text', done: true } };
    }
    if (ctx.goal.includes('Draft the summary resume')) {
      callCounts['resume-summary'] += 1;
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected job2 goal: ${ctx.goal}`);
  };

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  // Prove the drift is real (this is the debrief repro's own numbers, not a
  // contrived one) before trusting the resume assertion below.
  const statePath = path.join(parked.runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  const auditLines = readFileSync(path.join(parked.runDir, 'audit.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const auditTotal = auditLines.reduce((sum, row) => sum + row.usd, 0);
  assert.equal(state.spent, 0.006874, 'state.spent must match the debrief repro\'s own accumulated total');
  assert.ok(auditTotal > state.spent, 'the audit sum must land strictly above state.spent by float drift alone');
  assert.ok(auditTotal - state.spent < 1e-9, 'the drift must be sub-ULP noise, never a real discrepancy');

  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true, ans.ok ? '' : ans.red);

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  // FAIL-FIRST: with the fix reverted to the strict `state.spent <
  // auditSum.total`, this assertion goes red as:
  //   AssertionError [ERR_ASSERTION]: resume: run "run-1" state.json field
  //   "spent" ($0.006874) is less than its own audit.jsonl sum
  //   ($0.006874000000000001) — the books are the source of truth for money
  //   already spent; refusing rather than trusting state.json's lower figure
  //   Expected values to be strictly equal:
  //   + actual - expected
  //   + 'refused'
  //   - 'complete'
  assert.equal(resumed.outcome, 'complete', resumed.red);
});

// (2) The ask-expired history row must carry the run's REAL total spend,
// never a hard-coded 0 — "a pause spends nothing" means the pause itself
// adds nothing, not that the run's already-spent total resets.
test('orchestrator fix 2: an ask-expired history row carries the run\'s real spend total, never 0', async () => {
  const root = tmpRoot('expired-spend');
  writeJob2Flow(root);
  const srcDir = tmpRoot('expired-spend-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const PARK_TIME = '2000-01-01T00:00:00.000Z';

  const parked = await runFlow({
    ...baseRunArgs({
      root, modelStep, askStep: makeParkingAskStep(), clock: () => PARK_TIME,
    }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.ok(parked.spentUsd > 0, 'the three pre-ask model rounds must have real, nonzero cost to make this test meaningful');

  writeFileSync(path.join(parked.runDir, 'answer.json'), JSON.stringify({
    askId: parked.askId, decision: 'accept', answeredAt: PARK_TIME,
  }, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'ask-expired');
  assert.equal(resumed.spentUsd, parked.spentUsd, 'resumeRun\'s own return must carry the real total, not 0');

  const history = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const expiredRow = history.find((r) => r.outcome === 'ask-expired');
  assert.ok(expiredRow, 'an ask-expired history row must exist');
  assert.equal(expiredRow.spentUsd, parked.spentUsd, 'the ask-expired history row must carry the real spend total, never 0');
});

// (3) History is ONE row per run: park writes only an AUDIT row "paused",
// never a history row. The run's one history row lands at its final
// outcome. park -> reject -> re-park -> accept -> complete must leave
// EXACTLY one history row for that runId.
test('orchestrator fix 3: park -> reject -> re-park -> accept -> complete leaves exactly ONE history row for the run', async () => {
  const root = tmpRoot('one-history-row');
  writeJob2Flow(root, { askMark: 'ask 2s:' });
  const srcDir = tmpRoot('one-history-row-src');
  const { fn: modelStep } = makeJob2ModelStep();

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  const rej = answerAsk({
    runDir: parked.runDir, askId: parked.askId, decision: 'reject', reason: 'one more pass',
  });
  assert.equal(rej.ok, true, rej.ok ? '' : rej.red);
  const afterReject = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(afterReject.outcome, 'paused', afterReject.red);

  const acc = answerAsk({ runDir: parked.runDir, askId: afterReject.askId, decision: 'accept' });
  assert.equal(acc.ok, true, acc.ok ? '' : acc.red);
  const done = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(done.outcome, 'complete', done.red);

  const history = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const rowsForRun = history.filter((r) => r.runId === 'run-1');
  assert.equal(rowsForRun.length, 1, `expected exactly one history row for run-1, got ${rowsForRun.length}: ${JSON.stringify(rowsForRun)}`);
  assert.equal(rowsForRun[0].outcome, 'complete');
});

// (4) spendComplete is a floor, carried across a park: a resumed run whose
// state.json says spendComplete:false must still say spendComplete:false
// on its final history row, never silently reset to true.
test('orchestrator fix 4: a spendComplete:false floor persisted in state.json survives into the resumed run\'s final history row', async () => {
  const root = tmpRoot('spend-floor');
  writeJob2Flow(root);
  const srcDir = tmpRoot('spend-floor-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  // Simulate what a pre-park row with `spendComplete: false` (e.g. a
  // retried transport fault whose retry still failed short of a halt)
  // would have persisted — the mechanism under test is restore-and-fold,
  // not runStepRalph's own fault injection (out of scope here).
  const statePath = path.join(parked.runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.spendComplete = false;
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'complete', resumed.red);

  const history = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const last = history[history.length - 1];
  assert.equal(last.outcome, 'complete');
  assert.equal(last.spendComplete, false, 'a floor from BEFORE the pause must survive into the resumed run\'s final row');
});

// (5) answerAsk's check-then-act race: a pre-existing answer.json (however
// it got there — this test writes it directly rather than racing two real
// concurrent callers, which Node's single-threaded model can't show for a
// synchronous check-then-act without OS-level processes; see the M3 POC for
// that variant) must never be overwritten by a second answerAsk call.
test('orchestrator fix 5: answerAsk never overwrites an existing answer.json — "wx" semantics, first content stands', async () => {
  const root = tmpRoot('answer-race');
  writeJob2Flow(root);
  const srcDir = tmpRoot('answer-race-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  // A first answer lands (simulating a racing writer that got there just
  // before this call, or simply a first legitimate answer).
  writeFileSync(path.join(parked.runDir, 'answer.json'), JSON.stringify({
    askId: parked.askId, decision: 'reject', reason: 'first answer wins', answeredAt: new Date().toISOString(),
  }, null, 2));

  const second = answerAsk({
    runDir: parked.runDir, askId: parked.askId, decision: 'accept',
  });
  assert.equal(second.ok, false);
  assert.match(second.red, /already answered/);

  const answerJson = JSON.parse(readFileSync(path.join(parked.runDir, 'answer.json'), 'utf8'));
  assert.equal(answerJson.decision, 'reject', 'the FIRST answer\'s content must stand, byte for byte — never overwritten by the second');
  assert.equal(answerJson.reason, 'first answer wins');
});

// (6) resumeRun must use its OWN root/name arguments as the source of
// truth, never state.flow.root/state.flow.name silently — a mismatch
// refuses by name. (`runDir` is itself derived from the caller's root/name,
// so the only way `state.flow.{root,name}` can legitimately disagree with
// them is a tampered/miscopied state.json — exactly what this simulates;
// changing resumeRun's OWN `name` argument instead would just fail to find
// the run directory at all, which is a different, already-covered case.)
test('orchestrator fix 6: resumeRun refuses when the parked state\'s recorded flow disagrees with its own root/name arguments', async () => {
  const root = tmpRoot('flow-mismatch');
  writeJob2Flow(root);
  const srcDir = tmpRoot('flow-mismatch-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true);

  const statePath = path.join(parked.runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  state.flow.name = 'some-other-flow';
  writeFileSync(statePath, JSON.stringify(state, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /was parked against flow .*some-other-flow.*not the requested .*job2/);
});

// ---------------------------------------------------------------------------
// F45 finding 2: a parked ask.json must carry the same evidence a human sees
// in-process — the draft under review, and it must be the REDRAFTED one
// after a reject, not the stale first draft.
// ---------------------------------------------------------------------------

test('F45 fix 2: ask.json.evidence.artifact equals the prior step\'s artifact on disk, and the redrafted one after reject+re-park', async () => {
  const root = tmpRoot('evidence-in-ask');
  writeJob2Flow(root, { askMark: 'ask 2s:' });
  const srcDir = tmpRoot('evidence-in-ask-src');
  const { fn: modelStep } = makeJob2ModelStep();

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  const priorArtifact = JSON.parse(readFileSync(path.join(parked.runDir, 'artifacts', 'resume-summary.json'), 'utf8'));
  const askJson1 = JSON.parse(readFileSync(path.join(parked.runDir, 'ask.json'), 'utf8'));
  assert.deepEqual(askJson1.evidence.artifact, priorArtifact, 'the first park must carry the resume-summary artifact as evidence');
  assert.equal(askJson1.evidence.unjudged.length, 2, 'job #2\'s two pre-ask hitl reads (resume-text, jd-text) carry through as unjudged evidence');

  const rej = answerAsk({
    runDir: parked.runDir, askId: parked.askId, decision: 'reject', reason: 'tighten the skills section',
  });
  assert.equal(rej.ok, true, rej.ok ? '' : rej.red);

  const afterReject = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(afterReject.outcome, 'paused', afterReject.red);

  const redraftedArtifact = JSON.parse(readFileSync(path.join(parked.runDir, 'artifacts', 'resume-summary.json'), 'utf8'));
  const askJson2 = JSON.parse(readFileSync(path.join(parked.runDir, 'ask.json'), 'utf8'));
  assert.notEqual(askJson2.askId, askJson1.askId, 'the re-park must mint a new askId');
  assert.deepEqual(
    askJson2.evidence.artifact,
    redraftedArtifact,
    'the re-park after reject must carry the REDRAFTED artifact, never the stale pre-reject one',
  );
});

// ---------------------------------------------------------------------------
// F45 finding 3: the run's history row wallMs times the WHOLE run — from its
// first process's start, through the pause, to completion — never just the
// last process. Driven by the additive `nowMs` epoch-ms clock (mirrors the
// existing ISO `clock` hook), so no real wait is needed.
// ---------------------------------------------------------------------------

test('F45 fix 3: history wallMs times the whole run (through the pause), not just the resuming process', async () => {
  const root = tmpRoot('wallms');
  writeJob2Flow(root);
  const srcDir = tmpRoot('wallms-src');
  const { fn: modelStep } = makeJob2ModelStep();

  const T0 = 1_000_000; // arbitrary epoch ms — the run's true start
  const PAUSE_MS = 5 * 60 * 1000; // 5 simulated minutes parked
  const T1 = T0 + PAUSE_MS; // when resume runs

  const parked = await runFlow({
    ...baseRunArgs({
      root, modelStep, askStep: makeParkingAskStep(), nowMs: () => T0,
    }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true, ans.ok ? '' : ans.red);

  const resumed = await resumeRun(baseRunArgs({ root, modelStep, nowMs: () => T1 }));
  assert.equal(resumed.outcome, 'complete', resumed.red);

  const history = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const row = history[history.length - 1];
  assert.equal(row.outcome, 'complete');
  // The pause itself (5 simulated minutes) counts as elapsed wall time — a
  // parked run really was sitting there waiting on a human, so wallMs must
  // be AT LEAST the pause duration, never just however long the resuming
  // process's own work took.
  assert.ok(
    row.wallMs >= PAUSE_MS,
    `wallMs (${row.wallMs}) must be at least the ${PAUSE_MS}ms pause — it must time the whole run, not just the last process`,
  );
});
