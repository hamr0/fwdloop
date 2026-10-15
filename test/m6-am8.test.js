// M6 amendment 8: (1) the schedule button stays as M11 am3 item 1 signed it; (2) Reuse workflow is open while a run starts, runs or waits, and a
// changed job signs as a new workflow while the waiting run (and its workflow) stay byte-identical and the run can still be answered.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');

function snapshot(dir, rel = '') {
  const out = {};
  for (const n of readdirSync(path.join(dir, rel)).sort()) {
    const r = path.join(rel, n);
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}
const flowEntry = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
async function parked() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  const run = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: '' });
  assert.equal(run.status, 202, run.text);
  await until(async () => { const v = (await w.get(`/api/author/start/${run.json().startId}`)).json(); return v.state === 'parked' ? v : null; });
  return w;
}

test('am8 item 1 (a): the schedule button stays — Schedule run / Cancel / modify schedule sit in the Run tab row right after Reuse workflow, one door', () => {
  const i = PAGE.indexOf('function renderRunActions');
  const body = PAGE.slice(i, PAGE.indexOf('stopSay && stopSay.key', i));
  const at = (s) => body.indexOf(s);
  assert.ok(at('makeButton("Reuse workflow"') > 0 && at('makeButton("Reuse workflow"') < at('makeButton("Cancel / modify schedule"') && at('makeButton("Cancel / modify schedule"') < at('makeButton("Schedule run"'));
  assert.match(body, /summary\.scheduled\) el\.appendChild\(makeButton\("Cancel \/ modify schedule", "run-cancel-schedule", schedDoor\)\)/);
  assert.match(body, /summary\.canSchedule\) el\.appendChild\(makeButton\("Schedule run", "run-schedule", schedDoor\)\)/);
});

test('am8 item 2 (b): Reuse workflow is never greyed — the page has no disabled state for it and the server offers the card while a run waits', async () => {
  const i = PAGE.indexOf('function renderRunActions');
  const body = PAGE.slice(i, PAGE.indexOf('makeButton("Cancel / modify schedule"', i));
  assert.doesNotMatch(body, /disabled/);
  const w = await parked();
  const entry = await flowEntry(w);
  assert.equal(entry.edit.ok, true, JSON.stringify(entry.edit));
  const check = await w.post('/api/author/reuse-check', { flow: 'job2', job: `${entry.edit.card.job}\nmore`, inputs: w.inputs() });
  assert.equal(check.json().kind, 'draft', check.text);
});

test('am8 item 2 (c): signing a changed job while a run waits leaves that run and its workflow byte-identical, and the run can still be answered', async () => {
  const w = await parked();
  const flowDir = path.join(w.root, 'job2');
  const entry = await flowEntry(w);
  const before = snapshot(flowDir);
  const job = entry.edit.card.job.replace('nothing goes out before I accept', 'nothing goes out before I say so');
  const d = await w.post('/api/author/draft', { ...w.card({ flowName: 'job2-2', job }), reuseOf: { flow: 'job2' } });
  assert.equal(d.status, 202, d.text);
  const id = d.json().draftId;
  const g = await until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g));
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 202, s.text);
  assert.deepEqual(snapshot(flowDir), before, 'the waiting run and its workflow are untouched');
  const ask = JSON.parse(readFileSync(path.join(flowDir, 'runs', 'run-1', 'ask.json'), 'utf8'));
  const ans = await w.post('/api/answer', { flow: 'job2', runId: 'run-1', askId: ask.askId, decision: 'accept' });
  assert.equal(ans.status, 202, ans.text);
});
