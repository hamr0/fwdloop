// Tests for M3 piece 2 (docs/wiki/the-module-ladder.md, "M3 — scope, exit,
// negative — SIGNED", scope item 7, hamr "2A"): `rerun "<reason>"` ends the
// current run (outcome `rerun`, one history row, real spend, $0 added) and
// starts a brand-new run on the same signed flow, with fresh inputs, its
// own redo counter/cap, and the reason as the first step's starting gap.
// Every run happens at $0 against a fake modelStep — no provider, no key,
// no network.

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

function writeJob2Flow(root, { name = 'job2' } = {}) {
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

/** Fake modelStep for job #2's three model-backed steps. Records every call
 *  (goal + gap) in order, so a test can prove which gap a specific attempt
 *  actually saw — the mechanism under test (M3 scope item 7: "the reason
 *  carried as the first step's starting gap"). */
function makeJob2ModelStep() {
  const calls = { 'resume-text': 0, 'jd-text': 0, 'resume-summary': 0 };
  const callLog = [];
  const fn = async (ctx) => {
    callLog.push({ goal: ctx.goal, gap: ctx.gap });
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
  return { fn, calls, callLog };
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
// Negative (ii): `rerun "<reason>"` starts a new runId whose redo counter
// starts at 0 and whose cap is its own, and the old run's history.jsonl row
// says `rerun`. Also proves the reason lands as the new run's FIRST step's
// starting gap.
// ---------------------------------------------------------------------------

test('negative (ii): rerun ends the old run "rerun" (real spend), starts a new runId with its own fresh accounting, reason as the first step\'s gap', async () => {
  const root = tmpRoot('rerun-basic');
  writeJob2Flow(root);
  const srcDir = tmpRoot('rerun-basic-src');
  const { fn: modelStep, calls: oldCalls } = makeJob2ModelStep();

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.ok(parked.spentUsd > 0, 'the three pre-ask model rounds already spent something real');

  const ans = answerAsk({
    runDir: parked.runDir, askId: parked.askId, decision: 'rerun', reason: 'start over with a sharper angle',
  });
  assert.equal(ans.ok, true, ans.ok ? '' : ans.red);

  // A DIFFERENT modelStep for the new run, so the two runs' call logs never
  // collide (this is what a fresh child process would do too — the old
  // run's `oldCalls` counters must not move at all).
  const { fn: newModelStep, calls: newCalls, callLog: newCallLog } = makeJob2ModelStep();

  const resumed = await resumeRun(baseRunArgs({ root, modelStep: newModelStep }));
  assert.equal(resumed.outcome, 'rerun', resumed.red);
  assert.equal(resumed.runId, 'run-1');
  assert.equal(resumed.newRunId, 'run-1-rerun-1');
  assert.equal(resumed.spentUsd, parked.spentUsd, 'the OLD run\'s own return carries its real spend, unchanged by the rerun');

  // Old run's own book: exactly one history row, saying "rerun".
  const history = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const oldRows = history.filter((r) => r.runId === 'run-1');
  assert.equal(oldRows.length, 1, `expected exactly one history row for run-1, got ${oldRows.length}`);
  assert.equal(oldRows[0].outcome, 'rerun');
  assert.equal(oldRows[0].spentUsd, parked.spentUsd, 'the rerun history row carries real spend, never 0');
  assert.equal(oldCalls['resume-text'], 1, 'the OLD run\'s pre-ask steps are untouched by starting a new run');

  // The new run parked on the SAME flow, fresh — a new runId dir exists.
  assert.ok(resumed.newRun, 'resumeRun must return the new run\'s own result');
  assert.equal(resumed.newRun.outcome, 'paused', resumed.newRun.red);
  const newRunDir = path.join(root, 'job2', 'runs', 'run-1-rerun-1');
  assert.ok(existsSync(newRunDir), 'the new run\'s own directory must exist');
  assert.ok(existsSync(path.join(newRunDir, 'ask.json')));

  // The new run's own redo counter/attempt numbering starts fresh at 1 —
  // never continuing the old run's attempt count.
  const newAudit = readFileSync(path.join(newRunDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const firstStepRows = newAudit.filter((r) => r.step === 'resume-text');
  assert.equal(firstStepRows[0].attempt, 1, 'the new run\'s own step attempts start at 1, its own fresh cap/redo accounting');

  // The reason landed as the FIRST step's starting gap, and nothing else's.
  assert.equal(newCallLog[0].gap, 'start over with a sharper angle', 'the rerun reason must be the new run\'s first step\'s starting gap');
  assert.equal(newCallLog[1].gap, null, 'only the first step gets the rerun reason as its gap');
  assert.equal(newCallLog[2].gap, null, 'only the first step gets the rerun reason as its gap');
  assert.equal(newCalls['resume-text'], 1);
  assert.equal(newCalls['jd-text'], 1);
  assert.equal(newCalls['resume-summary'], 1);
});

// ---------------------------------------------------------------------------
// A second rerun on the same old run would collide on the deterministic
// runId — refused by name, never silently renumbered.
// ---------------------------------------------------------------------------

test('a rerun target runId that already exists is refused by name, never silently renumbered', async () => {
  const root = tmpRoot('rerun-collide');
  writeJob2Flow(root);
  const srcDir = tmpRoot('rerun-collide-src');
  const { fn: modelStep } = makeJob2ModelStep();

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  // Pre-create the deterministic target dir this rerun would want to use.
  const { mkdirSync } = await import('node:fs');
  const collidingDir = path.join(root, 'job2', 'runs', 'run-1-rerun-1');
  mkdirSync(collidingDir, { recursive: true });

  const ans = answerAsk({
    runDir: parked.runDir, askId: parked.askId, decision: 'rerun', reason: 'again',
  });
  assert.equal(ans.ok, true, ans.ok ? '' : ans.red);

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /rerun target run "run-1-rerun-1" already exists/);
});

// ---------------------------------------------------------------------------
// rerun with a blank reason is refused, at both the answerAsk layer (write
// time) and resumeRun's own defensive re-check (a direct answer.json write
// that bypasses answerAsk, exactly like the M3 piece 1 "orchestrator fix 5"
// tests exercise for reject).
// ---------------------------------------------------------------------------

test('rerun with a blank reason is refused by answerAsk, at write time', async () => {
  const root = tmpRoot('rerun-blank-answerask');
  writeJob2Flow(root);
  const srcDir = tmpRoot('rerun-blank-answerask-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'rerun', reason: '   ' });
  assert.equal(ans.ok, false);
  assert.match(ans.red, /needs a non-blank reason to rerun/);
  assert.equal(existsSync(path.join(parked.runDir, 'answer.json')), false, 'a refused rerun must never write answer.json');
});

test('rerun with a blank reason is refused by resumeRun\'s own re-check, even if answer.json somehow carries one', async () => {
  const root = tmpRoot('rerun-blank-resume');
  writeJob2Flow(root);
  const srcDir = tmpRoot('rerun-blank-resume-src');
  const { fn: modelStep } = makeJob2ModelStep();
  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);

  // Bypass answerAsk entirely — write the file directly, as a tampered or
  // buggy caller might.
  writeFileSync(path.join(parked.runDir, 'answer.json'), JSON.stringify({
    askId: parked.askId, decision: 'rerun', reason: '   ', answeredAt: new Date().toISOString(),
  }, null, 2));

  const resumed = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(resumed.outcome, 'refused');
  assert.match(resumed.red, /rerun answer for run "run-1" carries a blank reason/);
  assert.equal(existsSync(path.join(root, 'job2', 'runs', 'run-1-rerun-1')), false, 'no new run must ever start from a blank-reason rerun');
});
