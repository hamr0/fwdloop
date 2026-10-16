// M9 amendment 10 (docs/wiki/the-module-ladder.md): Cancel schedule always works, even while a run is starting, working or waiting at its ask;
// it only stops future runs. M9 am20 (signed) replaces the last sentence: a NEW schedule is allowed while a run is going too (it never touches the job).
// Real HTTP, the gated model step, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readHistory } from '../src/books.js';
import { GATED_STEP, killChildrenAfter, until } from './m4e-world.mjs';
import { DAILY, greenWorld, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();

async function gated(open) {
  const g = await greenWorld({ step: GATED_STEP });
  if (open) writeFileSync(g.w.gate, 'go');
  // the panel's resume child inherits this process's env (no loadEnv in the world): give it the same test door the run child has
  Object.assign(process.env, {
    NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: path.join(g.w.work, 'cfg', 'fwdloop'), FWDLOOP_TEST_MODEL_STEP: GATED_STEP, FWDLOOP_TEST_GATE: g.w.gate, DEEPSEEK_API_KEY: 'sk-test-am10',
  });
  return g;
}
const startRun = async (g) => {
  const run = await g.w.post('/api/author/run', { flow: 'job2', inputs: g.w.inputs(), runId: '' });
  assert.equal(run.status, 202, run.text);
  return run.json().startId;
};

test('Must fail: Cancel is refused because a run is waiting at its ask; the run stays waiting and answered after the Cancel it still finishes (am10)', async () => {
  const g = await gated(true);
  assert.equal((await setTrigger(g.w, DAILY)).status, 200);
  const sid = await startRun(g);
  await until(async () => { const v = (await g.w.get(`/api/author/start/${sid}`)).json(); return v.state === 'parked' ? v : null; });
  const before = g.read().signature.flow;
  const c = await setTrigger(g.w, null);
  assert.equal(c.status, 200, c.text);
  assert.equal(existsSync(path.join(g.flowDir, 'schedule.json')), false, 'the schedule is gone');
  assert.equal(g.read().signature.flow, before, 'the job was not touched (am20)');
  const ask = (await g.w.get('/api/runs/job2/run-1/asks')).json().asks?.[0];
  assert.ok(ask?.askId, 'the waiting run still shows its ask');
  const a = await g.w.post('/api/answer', { flow: 'job2', runId: 'run-1', askId: ask.askId, decision: 'accept' });
  assert.equal(a.status, 202, a.text);
  const row = await until(() => readHistory(g.flowDir).find((r) => String(r.runId) === 'run-1' && r.outcome) ?? null, 30_000);
  assert.equal(row.outcome, 'complete', JSON.stringify(row));
});

test('Must fail: Cancel is refused because a run is working, or Cancel stops/changes that run (am10)', async () => {
  const g = await gated(false);
  assert.equal((await setTrigger(g.w, DAILY)).status, 200);
  const sid = await startRun(g);
  await until(async () => { const v = (await g.w.get(`/api/author/start/${sid}`)).json(); return v.phase === 'started' && v.state === 'working' ? v : null; });
  const c = await setTrigger(g.w, null);
  assert.equal(c.status, 200, c.text);
  assert.equal(existsSync(path.join(g.flowDir, 'schedule.json')), false);
  const v = (await g.w.get(`/api/author/start/${sid}`)).json();
  assert.equal(v.state, 'working', 'the run was not stopped');
  writeFileSync(g.w.gate, 'go');
  await until(async () => { const s = (await g.w.get(`/api/author/start/${sid}`)).json(); return s.state === 'parked' || s.state === 'done' ? s : null; });
});

test('Must fail: a new schedule is refused because a run waits at its ask: it is accepted, the job is untouched, the run finishes (am20 item 3)', async () => {
  const g = await gated(true);
  const sid = await startRun(g);
  await until(async () => { const v = (await g.w.get(`/api/author/start/${sid}`)).json(); return v.state === 'parked' ? v : null; });
  const before = g.read().signature.flow;
  const p = await setTrigger(g.w, DAILY);
  assert.equal(p.status, 200, p.text);
  assert.equal(existsSync(path.join(g.flowDir, 'schedule.json')), true);
  assert.equal(g.read().signature.flow, before);
  const ask = (await g.w.get('/api/runs/job2/run-1/asks')).json().asks?.[0];
  const a = await g.w.post('/api/answer', { flow: 'job2', runId: 'run-1', askId: ask.askId, decision: 'accept' });
  assert.equal(a.status, 202, a.text);
  const row = await until(() => readHistory(g.flowDir).find((r) => String(r.runId) === 'run-1' && r.outcome) ?? null, 30_000);
  assert.equal(row.outcome, 'complete', JSON.stringify(row));
});
