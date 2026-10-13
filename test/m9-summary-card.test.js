// M9 piece 5 and 6, server side: the trigger card each listed job carries (the dropdown's data) and the summary block on a run's detail.
// Real HTTP against the M4e world, $0. Words are asserted exactly: they are set by code from typed facts.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { NO_GREEN_SAY } from '../src/panel/authortrigger.js';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { DAILY, greenWorld, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();
const cardOf = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2').trigger;
const detail = async (w, id = 'seed-pass') => (await w.get(`/api/runs/job2/${id}`)).json();

test('Must fail: the dropdown is refused on a job with no green run, with the server\'s sentence, and nothing about it is settable', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2'); // listed (a passed run), but not a run of THIS job
  const c = await cardOf(w);
  assert.equal(c.hasGreenRun, false);
  assert.equal(c.refusal, NO_GREEN_SAY);
  assert.equal(c.trigger, null);
  assert.equal(c.words, null);
  assert.equal(c.editNote, null);
  const p = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(p.json().refused, 'no-green-run');
});

test('a job with one green run: card is open, then carries the trigger words and the am1 edit warning once set', async () => {
  const { w } = await greenWorld();
  const c0 = await cardOf(w);
  assert.deepEqual([c0.hasGreenRun, c0.refusal, c0.trigger, c0.words, c0.editNote], [true, null, null, null, null]);
  const r = await setTrigger(w, { kind: 'weekly', day: 'mon', hour: 9, minute: 0 });
  assert.equal(r.status, 200, r.text);
  const c1 = await cardOf(w);
  assert.equal(c1.words, 'Mondays at 09:00');
  assert.deepEqual(c1.trigger, { kind: 'weekly', day: 'mon', hour: 9, minute: 0 });
  assert.equal(c1.hasGreenRun, true, 'changing only the trigger keeps the green run');
  assert.match(c1.editNote, /^This job runs by itself \(Mondays at 09:00\)\. Signing this edit clears that back to By hand\./);
});

test('a passed run: ENDED "Goal met." / NEXT names the destination; no trigger = no SCHEDULED', async () => {
  const { w } = await greenWorld();
  const d = await detail(w);
  assert.equal(d.summary.ended.reason, 'Goal met.');
  assert.match(d.summary.ended.next, /^The result is in .+\.$|^The result is in the step cards below\.$/);
  assert.equal(d.summary.scheduled, null);
  assert.equal(d.summary.catchUp, null);
});

test('a job with a trigger: SCHEDULED and NEXT (next run); monthly-exhausted row -> the signed paused sentence with the amounts', async () => {
  const { w, flowDir } = await greenWorld();
  await setTrigger(w, DAILY);
  const d = await detail(w);
  assert.equal(d.summary.scheduled.text, 'Every day at 09:00');
  assert.match(d.summary.scheduled.next, /^Next run (Mon|Tue|Wed|Thu|Fri|Sat|Sun) \d{1,2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec), 09:00\.$/);
  appendFileSync(path.join(flowDir, 'triggers.jsonl'), `${JSON.stringify({
    at: new Date().toISOString(), flow: 'job2', trigger: 'daily 09:00', outcome: 'monthly-exhausted', leftUsd: 0.12, needUsd: 0.5, atLeast: false,
  })}\n`);
  const d2 = await detail(w);
  assert.equal(d2.summary.scheduled.next,
    'Paused: not enough money left this month ($0.12 left, a run needs up to $0.50). Raise the monthly limit in Settings, or it starts again on the 1st.');
});

test('a catch-up run says so; an unknown ending gets the fixed fallback; a stopped run names how to go on', async () => {
  const { w, flowDir } = await greenWorld();
  const runDir = path.join(flowDir, 'runs', 'seed-pass');
  writeFileSync(path.join(runDir, 'trigger.json'), JSON.stringify({ kind: 'clock', catchUp: true, trigger: 'daily 09:00' }));
  assert.match((await detail(w)).summary.catchUp, /catch-up/);
  mkdirSync(path.join(flowDir, 'runs', 'odd'), { recursive: true });
  appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId: 'odd', at: '2026-10-07T10:00:00.000Z', outcome: 'sky-fell', spentUsd: 0, spendComplete: true, capUsd: 0.25, wallMs: 1, signatureHash: 'x' })}\n`);
  assert.equal((await detail(w, 'odd')).summary.ended.reason, 'It ended with "sky-fell", which this panel has no sentence for.');
  mkdirSync(path.join(flowDir, 'runs', 'stp'), { recursive: true });
  appendFileSync(path.join(flowDir, 'history.jsonl'), `${JSON.stringify({ runId: 'stp', at: '2026-10-07T11:00:00.000Z', outcome: 'stopped', spentUsd: 0, spendComplete: true, capUsd: 0.25, wallMs: 1, signatureHash: 'x' })}\n`);
  const s = (await detail(w, 'stp')).summary.ended;
  assert.deepEqual(s, { reason: 'Stopped by you.', next: 'Run it again from the Chat card.' });
});
