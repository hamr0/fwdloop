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
  root, name = 'job2', runId = 'run-1', modelStep, askStep, clock,
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
