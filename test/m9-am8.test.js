// M9 amendment 8 (docs/wiki/the-module-ladder.md): a run waiting at its ask does not make the job busy for the SCHEDULE; a run still working does.
// Edit's own refusal is unchanged (M6). The answer at an ask is never held back by another run of the job. The SCHEDULE line 2 words.
// No real waits: the clock is injected, tick() is called by hand, the runs are the real `fwdloop run` child with the test model step ($0).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { readOutcomes } from '../src/panel/authortrigger.js';
import { STABLE_POLLS } from '../src/trigger-files.js';
import { scheduleBlockWords, fireRowWords } from '../src/summary-words.js';
import {
  GATED_STEP, killChildrenAfter, until,
} from './m4e-world.mjs';
import {
  DAILY, greenWorld, ls, setTrigger,
} from './m9-trigger-world.mjs';

killChildrenAfter();
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
const iso = (ms) => new Date(ms).toISOString();

/** A job2 world on the gated model step; with `open` the gate file exists (a run parks at its ask), without it a run is held "working". */
async function gatedWorld(open) {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ step: GATED_STEP, authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  if (open) writeFileSync(g.w.gate, 'go');
  const rows = () => readOutcomes(g.flowDir);
  const runs = () => ls(path.join(g.flowDir, 'runs')).filter((n) => /^run-\d+$/.test(n));
  const state = async (i) => (await g.w.get(`/api/author/start/${g.w.starts()[i]}`)).json();
  return { ...g, clock, rows, runs, tick: () => g.w.h.tick(), state };
}

test('Must fail: a run waiting at its ask stops the next time\'s run from starting (am8 item 1)', async () => {
  const f = await gatedWorld(true);
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(13, 9, 0, 10); f.tick();
  await until(async () => { const v = await f.state(0); return v.state === 'parked' ? v : null; });
  f.clock.t = at(14, 9, 0, 10); f.tick();
  assert.deepEqual(f.rows().map((r) => r.outcome), ['started', 'started'], JSON.stringify(f.rows()));
  assert.deepEqual(f.runs(), ['run-1', 'run-2']);
});

test('Must fail: the schedule starts a run while another run of the job is working; the busy row says "still working" (am8 item 1, 3)', async () => {
  const f = await gatedWorld(false);
  assert.equal((await setTrigger(f.w, DAILY)).status, 200);
  f.clock.t = at(13, 9, 0, 10); f.tick();
  await until(async () => { const v = await f.state(0); return v.phase === 'started' && v.state === 'working' ? v : null; });
  f.clock.t = at(14, 9, 0, 10); f.tick();
  const rows = f.rows();
  assert.equal(rows[1].outcome, 'busy', JSON.stringify(rows));
  assert.equal(rows[1].say, 'a run of this job was still working');
  assert.deepEqual(f.runs(), ['run-1'], 'nothing started');
});

test('Edit\'s refusal is unchanged: a run waiting at its ask still refuses setting a trigger with the Edit sentence (M6)', async () => {
  const f = await gatedWorld(true);
  const run = await f.w.post('/api/author/run', { flow: 'job2', inputs: f.w.inputs(), runId: '' });
  assert.equal(run.status, 202, run.text);
  await until(async () => { const v = (await f.w.get(`/api/author/start/${run.json().startId}`)).json(); return v.state === 'parked' ? v : null; });
  const p = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  assert.equal(p.status, 409, p.text);
  assert.match(p.json().say, /finish or stop run-1 first/);
});

test('Must fail: your answer at an ask is held back because another run of the job is working (am8 item 1)', async () => {
  const f = await gatedWorld(true);
  const r1 = await f.w.post('/api/author/run', { flow: 'job2', inputs: f.w.inputs(), runId: '' });
  assert.equal(r1.status, 202, r1.text);
  await until(async () => { const v = await f.state(0); return v.state === 'parked' ? v : null; });
  unlinkSync(f.w.gate); // the next run is held working
  const r2 = await f.w.post('/api/author/run', { flow: 'job2', inputs: f.w.inputs(), runId: '' });
  assert.equal(r2.status, 202, r2.text);
  await until(async () => { const v = await f.state(1); return v.phase === 'started' && v.state === 'working' ? v : null; });
  const ask = (await f.w.get('/api/runs/job2/run-1')).json();
  const askId = ask.ask?.askId ?? ask.asks?.[0]?.askId ?? (await f.w.get('/api/runs/job2/run-1/asks')).json().asks?.[0]?.askId;
  assert.ok(askId, JSON.stringify(ask).slice(0, 300));
  const a = await f.w.post('/api/answer', { flow: 'job2', runId: 'run-1', askId, decision: 'accept' });
  assert.equal(a.status, 202, a.text);
});

test('Must fail: a folder of several new files starts one run per file, one after another, each waiting at its own ask (am8 item 1)', async () => {
  const f = await gatedWorld(true);
  const inbox = path.join(f.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  for (const n of ['a.md', 'b.md', 'c.md']) writeFileSync(path.join(inbox, n), `# ${n}\n`);
  for (let i = 0; i < 3; i++) {
    for (let k = 0; k < STABLE_POLLS + 2; k++) f.tick();
    // eslint-disable-next-line no-await-in-loop
    await until(async () => { const v = await f.state(i); return v?.state === 'parked' ? v : null; });
  }
  for (let k = 0; k < STABLE_POLLS + 2; k++) f.tick();
  assert.deepEqual(f.rows().filter((r) => r.outcome === 'started').map((r) => path.basename(r.file)), ['a.md', 'b.md', 'c.md']);
  assert.deepEqual(f.runs(), ['run-1', 'run-2', 'run-3']);
});

// ---- the words -------------------------------------------------------------------------------------------------------------------------------
const DAILY_T = { kind: 'daily', hour: 8, minute: 15 };
const base = { trigger: DAILY_T, home: '/h', nextSlotMs: at(16, 8, 15), armed: true, last: null, problem: null, nowMs: at(15, 9) };
const NEXT = 'next Fri 10/16 08:15';

test('am8 words: busy is not red, no "fix it"; it names the stamp (items 2, 3)', () => {
  const b = scheduleBlockWords({ ...base, problem: { at: iso(at(15, 8, 15)), outcome: 'busy', say: 'run-2 is running; finish or stop it first' } });
  assert.deepEqual(b.line2, `last 10/15 08:15 · busy: a run of this job was still working · ${NEXT}`);
  assert.equal(b.red, false);
});

test('am8 words: a run waiting at its ask reads the signed phrase, normal colour (item 4)', () => {
  const b = scheduleBlockWords({ ...base, last: { at: iso(at(15, 8, 15)), runId: 'run-15', outcome: 'waiting', catchUp: false } });
  assert.equal(b.line2, `last 10/15 08:15 · run-15 · waiting for your answer (the next run does not wait) · ${NEXT}`);
  assert.equal(b.red, false);
});

test('am8 words: month used up is red only while it is still that month; it never says Cancel / modify schedule (items 5, 8)', () => {
  const problem = { at: iso(at(15, 8, 15)), outcome: 'monthly-exhausted', leftUsd: 0.01, needUsd: 0.5 };
  const b = scheduleBlockWords({ ...base, problem });
  assert.equal(b.line2, 'last 10/15 08:15 · month used up: $0.01 left, needs $0.50 · next: raise the limit in Settings, or it starts on the 1st');
  assert.equal(b.red, true);
  assert.doesNotMatch(b.line2, /Cancel/);
  const later = scheduleBlockWords({ ...base, problem, nowMs: at(11 + 20, 9) }); // 10/31 is the same month; 11/01 is the next
  assert.equal(later.red, true);
  const nextMonth = scheduleBlockWords({ ...base, problem, nowMs: new Date(2026, 10, 1, 9).getTime() });
  assert.equal(nextMonth.red, false, 'the 1st of the next month clears it');
});

test('am8 words: refused is red with the reason, then the fix-it ending (item 6)', () => {
  const b = scheduleBlockWords({ ...base, problem: { at: iso(at(15, 8, 15)), outcome: 'refused', why: 'The input "jd" is not there.' } });
  assert.equal(b.line2, 'last 10/15 08:15 · refused: The input "jd" is not there. · next: fix it in Cancel / modify schedule');
  assert.equal(b.red, true);
});

test('am8 words: before any fire "no run yet"; a schedule not armed ends "next: not armed yet" (items 2, 7)', () => {
  assert.equal(scheduleBlockWords(base).line2, `no run yet · ${NEXT}`);
  assert.equal(scheduleBlockWords({ ...base, armed: false }).line2, 'no run yet · next: not armed yet');
});

test('am8: the Audit schedule group\'s busy row says "still working" when the books hold no sentence', () => {
  assert.match(fireRowWords({ at: iso(at(15, 8, 15)), outcome: 'busy' }), /still working/);
});
