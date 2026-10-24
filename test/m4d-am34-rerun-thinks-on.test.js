// M4d am34 (docs/wiki/the-module-ladder.md "M4d amendment 34"): a rerun is a retry of the whole job. Every try of every step in a rerun run thinks ON and is
// handed the earlier runs' block, its first try included; a plain run is unchanged (first try off / no block, unless the Chat box is ticked: thinking only).
// ONE decider (`triesCount`) says which tries count; thinking and learnings both ask it. $0: a fake model step, in-process runs on job2's fixture, scratch
// config homes (mkdtemp, cleaned up).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, continueRun, requestStop, makeParkingAskStep } from '../src/runner.js';
import { writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { readRunIsRerun, RUN_RERUN_FILE } from '../src/flowmodel.js';
import { triesCount, stepThinkingMode } from '../src/thinking.js';
import { cardsOf } from './m8-learn-fixtures.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-am34-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.';
const NOW = new Date();
const row = () => ({
  ...countLedger(emptyLedger(), { runid: 'r0', cards: cardsOf('ms2c0ls7').cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: NOW }).rows[0],
  lastSeen: NOW.toISOString(),
});

/** a job2 world with learningHints ON and one ledger row; `thinkingBox` is the job's Chat box (kept in model.json is not needed: the run copy defaults off) */
function world(tag) {
  const home = tmp('home');
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: true }));
  writeLedger({ ...emptyLedger(), rows: [row()] }, home);
  process.env.FWDLOOP_CONFIG_HOME = home;
  const root = tmp(`${tag}-root`);
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  const args = (modelStep, runId = 'run-1', extra = {}) => ({
    root, name: 'job2', runId, catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', askStep: makeParkingAskStep(), sources, ...extra,
  });
  return { root, args, runDir: (id = 'run-1') => path.join(root, 'job2', 'runs', id) };
}

/** every model call is noted as {step, attempt, mode, hints}; the summary step is red on the summary tries in `redOn` */
function recorder(calls, redOn = []) {
  let n = 0;
  return async (ctx, _granted, meta) => {
    const step = ctx.goal.includes('resume .docx') ? 'resume' : ctx.goal.includes('job description markdown') ? 'jd' : 'summary';
    calls.push({ step, attempt: meta.attempt, mode: meta.thinkingMode, hints: ctx.hints });
    if (step === 'resume') return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (step === 'jd') return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    n += 1;
    return { ok: true, costUsd: 0.001, artifact: { text: redOn.includes(n) ? BAD : GOOD, done: true } };
  };
}

test('the decider: a retry or redo (2nd+ try) and any try of a rerun run count; a plain first try never does', () => {
  assert.equal(triesCount({ attempt: 1, rerun: false }), false);
  for (const attempt of [2, 3, 4]) assert.equal(triesCount({ attempt, rerun: false }), true);
  for (const attempt of [1, 2, 3]) assert.equal(triesCount({ attempt, rerun: true }), true);
});

test('thinking = the box OR the decider; they cannot disagree (thinking on without the box iff the decider counts)', () => {
  for (const attempt of [1, 2, 3]) {
    for (const rerun of [false, true]) {
      assert.equal(stepThinkingMode({ boxOn: false, attempt, rerun }) === 'on', triesCount({ attempt, rerun }), `attempt ${attempt} rerun ${rerun}`);
      assert.equal(stepThinkingMode({ boxOn: true, attempt, rerun }), 'on');
    }
  }
});

test('a rerun run: EVERY try of EVERY step (2+ steps, a retry inside) thinks on and is handed the block', async () => {
  const w = world('rerun');
  const calls = [];
  const r = await runFlow(w.args(recorder(calls, [1]), 'run-1-rerun-1', { initialGap: 'start over' }));
  assert.notEqual(r.outcome, 'refused', r.red);
  assert.equal(readRunIsRerun(w.runDir('run-1-rerun-1')), true, 'the run folder says it is a rerun');
  assert.ok(new Set(calls.map((c) => c.step)).size >= 3, 'three steps ran');
  assert.ok(calls.filter((c) => c.step === 'summary').length >= 2, 'a retry ran inside the rerun');
  for (const c of calls) {
    assert.equal(c.mode, 'on', `thinking on: ${JSON.stringify(c)}`);
    assert.equal(typeof c.hints, 'string', `handed a block: ${JSON.stringify(c)}`);
  }
});

test('a plain run: a first try thinks off and gets no block; the retry thinks on and gets one; no rerun record', async () => {
  const w = world('plain');
  const calls = [];
  const r = await runFlow(w.args(recorder(calls, [1])));
  assert.notEqual(r.outcome, 'refused', r.red);
  assert.equal(readRunIsRerun(w.runDir()), false);
  assert.equal(existsSync(path.join(w.runDir(), RUN_RERUN_FILE)), false);
  const firsts = calls.filter((c) => c.attempt === 1);
  assert.ok(firsts.length >= 3);
  for (const c of firsts) { assert.equal(c.mode, 'off', JSON.stringify(c)); assert.equal(c.hints, null, JSON.stringify(c)); }
  const retry = calls.find((c) => c.attempt === 2);
  assert.ok(retry, 'a retry ran');
  assert.equal(retry.mode, 'on');
  assert.equal(typeof retry.hints, 'string');
});

test('a resumed leg of a rerun run still counts: after a Stop, Continue\'s first try of the next step thinks on and gets the block', async () => {
  const w = world('resume');
  const calls = [];
  const rid = 'run-1-rerun-1';
  const rec = recorder(calls);
  const stopAfterFirst = async (...a) => { const out = await rec(...a); if (calls.length === 1) requestStop(w.runDir(rid)); return out; };
  const r = await runFlow(w.args(stopAfterFirst, rid, { initialGap: 'start over' }));
  assert.equal(r.outcome, 'stopped', r.red);
  assert.equal(calls.length, 1, 'the first leg made one call');
  const r2 = await continueRun(w.args(recorder(calls), rid));
  assert.notEqual(r2.outcome, 'refused', r2.red);
  const second = calls.slice(1);
  assert.ok(second.some((c) => c.step === 'jd' && c.attempt === 1), `the resumed leg ran a step's first try: ${JSON.stringify(second.map((c) => [c.step, c.attempt]))}`);
  for (const c of second) {
    assert.equal(c.mode, 'on', JSON.stringify(c));
    assert.equal(typeof c.hints, 'string', JSON.stringify(c));
  }
});
