// M6 am9 piece 1: a run executes the plan it keeps (`runs/<id>/job/` marked by `plan.json`), in EVERY executor path; a run with no marker
// reads the flow folder exactly as before. $0: fake modelStep, in-process. Signed text: "Each run keeps the plan it ran."
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

import { readHistory } from '../src/books.js';
import { readFlow } from '../src/flow.js';
import { answerAsk } from '../src/ask.js';
import { continueRun, makeParkingAskStep, runFlow, requestStop, resumeRun } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { getRunControls } from '../src/panel/data.js';
import { CAT, GOOD, givePlanB, planWorld } from './m6-am9-helpers.mjs';

const stepper = (runDir, stopAtSummary) => async (ctx) => {
  const emits = ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary';
  if (emits === 'resume-summary' && stopAtSummary) requestStop(runDir);
  return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits === 'resume-summary' ? GOOD : emits, done: true } };
};
const go = (w, runId, stop) => runFlow({
  root: w.root, name: 'job2', runId, catalogue: CAT, modelStep: stepper(path.join(w.flowDir, 'runs', runId), stop), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, sources: w.sources, askStep: undefined,
});
const hashesOf = (w, runId) => readHistory(w.flowDir).filter((r) => r.runId === runId).map((r) => r.signatureHash);

test('piece 1: a run with plan.json executes ITS plan (fresh run and resume), not the flow\'s', async () => {
  const w = planWorld('p1');
  const a = w.sign(w.root, 'job2');
  const b = givePlanB(w, 'run-1');
  assert.notEqual(a.signature.flow, b.flow);
  const first = await go(w, 'run-1', true);
  assert.equal(first.outcome, 'stopped', first.red);
  assert.deepEqual(hashesOf(w, 'run-1'), [b.flow], 'the stopped row carries plan B, not the flow\'s plan A');
  const again = await continueRun({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: stepper(path.join(w.flowDir, 'runs', 'run-1'), false), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01,
  });
  assert.notEqual(again.outcome, 'refused', again.red);
  assert.deepEqual([...new Set(hashesOf(w, 'run-1'))], [b.flow], 'the continue ran plan B too');
  assert.equal(JSON.parse(readFileSync(path.join(w.flowDir, 'runs', 'run-1', 'job', 'signature.json'), 'utf8')).flow, b.flow);
});

test('piece 1: the Resume button reads the run\'s plan (a plan-B run stays resumable while the flow holds plan A)', async () => {
  const w = planWorld('p1c');
  w.sign(w.root, 'job2');
  givePlanB(w, 'run-1');
  const first = await go(w, 'run-1', true);
  assert.equal(first.outcome, 'stopped', first.red);
  const c = getRunControls({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
  assert.equal(c.canResume, true, JSON.stringify(c));
});

test('piece 1 (compat): a run with NO plan.json runs the flow\'s plan, as before', async () => {
  const w = planWorld('p1n');
  const a = w.sign(w.root, 'job2');
  const r = await go(w, 'run-2', true);
  assert.equal(r.outcome, 'stopped', r.red);
  assert.deepEqual(hashesOf(w, 'run-2'), [a.signature.flow]);
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow, a.signature.flow);
});

test('piece 1: a run parked at an ask, answered, then resumed, finishes under plan B', async () => {
  const w = planWorld('p1r');
  w.sign(w.root, 'job2');
  const b = givePlanB(w, 'run-1');
  const parked = await runFlow({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: stepper(b.runDir, false), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, sources: w.sources, askStep: makeParkingAskStep(),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.equal(answerAsk({ runDir: b.runDir, askId: parked.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun({
    root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep: stepper(b.runDir, false), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01,
  });
  assert.equal(done.outcome, 'complete', done.red);
  assert.deepEqual([...new Set(hashesOf(w, 'run-1'))], [b.flow]);
});
