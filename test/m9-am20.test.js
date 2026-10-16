// M9 amendment 20 (docs/wiki/the-module-ladder.md, SIGNED 2026-10-16): a schedule lives in its own signed file, flows/<job>/schedule.json, with its own
// queue file, flows/<job>/schedule-ledger.jsonl. The four "Must fail when" lines are the four tests below. $0: injected clock, stub starter, fake model step.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { writeFlow, readFlow } from '../src/flow.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { createTriggerDoor, readOutcomes } from '../src/panel/authortrigger.js';
import { createScheduler } from '../src/panel/scheduler.js';
import { queueOf, readSeen, STABLE_POLLS } from '../src/trigger-files.js';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld, setTrigger } from './m9-trigger-world.mjs';
import { CAT, scheduledJob } from './m9-sched-job.mjs';

killChildrenAfter();
const DAILY = { kind: 'daily', hour: 9, minute: 0 };
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
const SAY = (f) => `${f} was waiting when the schedule changed, so it will not run. Drop it in again to run it.`;
const jobFiles = (flowDir) => Object.fromEntries(['prose.txt', 'declaration.json', 'signature.json'].map((f) => [f, readFileSync(path.join(flowDir, f), 'utf8')]));

// ---------------------------------------------------------------- (a) a schedule change changes the job's signature

test('Must fail: setting, changing or cancelling a schedule changes the job or its signature (am20 item 1)', async () => {
  const g = await greenWorld();
  const before = jobFiles(g.flowDir);
  assert.equal((await setTrigger(g.w, DAILY)).status, 200);
  assert.deepEqual(jobFiles(g.flowDir), before, 'set: the job\'s three signed files are byte-identical');
  assert.equal((await setTrigger(g.w, { kind: 'weekdays', hour: 8, minute: 30 })).status, 200);
  assert.deepEqual(jobFiles(g.flowDir), before, 'change');
  assert.equal((await setTrigger(g.w, null)).status, 200);
  assert.deepEqual(jobFiles(g.flowDir), before, 'cancel');
  assert.equal(g.read().signature.flow, JSON.parse(before['signature.json']).flow);
});

// ---------------------------------------------------------------- (b) Cancel stops or changes a starting run

test('Must fail: Cancel stops or changes a starting run: the run carries on, keeps its job copy, and a run with signed values resumes after its ask (am20 item 3)', async () => {
  const w = await scheduledJob({ values: true });
  const sigBefore = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
  let cancelled = null;
  // the existing seam (m6-runcopy F3): runFlow reads `primitiveReds.length` after reading the job and before writing its copy = the run is STARTING
  const primitiveReds = { get length() { cancelled = w.click(null); return 0; } };
  const r = await runFlow({ ...w.args('run-1'), askStep: makeParkingAskStep(), primitiveReds });
  assert.equal(cancelled?.status, 200, JSON.stringify(cancelled));
  assert.equal(r.outcome, 'paused', `the starting run carried on: ${JSON.stringify(r)}`);
  assert.equal(existsSync(path.join(w.runDir, 'job', 'prose.txt')), true, 'it keeps its own job copy');
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow, sigBefore, 'the job was not re-signed');
  assert.equal(answerAsk({ runDir: w.runDir, askId: r.askId, decision: 'accept' }).ok, true);
  const done = await resumeRun({ ...w.args('run-1'), askStep: makeParkingAskStep() });
  assert.equal(done.outcome, 'complete', done.red);
});

test('Must fail: a new schedule is refused because a run is starting, working or waiting (am20 item 3 replaces am10\'s last sentence)', async () => {
  const w = await scheduledJob({ values: true });
  const live = createTriggerDoor({
    root: w.root,
    flowsDoor: { editBlock: () => 'finish or stop run-1 first', scheduleBusy: () => null, lastSourcesOf: () => ({ sources: {} }) },
    starter: /** @type {any} */ ({}), loadEnv: () => ({ ok: true, env: {}, keyNames: [] }), monthlyClaim: () => null, modelRefusal: () => [], now: () => at(13, 9),
  });
  const p = live.prepare({ flow: 'job2', trigger: { kind: 'weekdays', hour: 7, minute: 0 } });
  assert.equal(p.status, 200, JSON.stringify(p.body));
  assert.equal(live.set({ flow: 'job2', trigger: { kind: 'weekdays', hour: 7, minute: 0 }, hash: p.body.hash }).status, 200);
});

// ---------------------------------------------------------------- (c) a change leaves a waiting file behind

/** Every file still waiting in ANY queue of the job: the one schedule ledger (per signing) and, on today's layout, each per-signing folder. */
function waitingAnywhere(flowDir) {
  const out = [];
  const one = path.join(flowDir, 'schedule-ledger.jsonl');
  if (existsSync(one)) {
    const rows = readSeen(one);
    for (const sig of new Set(rows.map((r) => r.sig))) out.push(...queueOf(readSeen(one, sig)).map((q) => q.name));
  }
  const old = path.join(flowDir, 'triggers');
  if (existsSync(old)) for (const h of readdirSync(old)) out.push(...queueOf(readSeen(path.join(old, h, 'seen.jsonl'))).map((q) => q.name));
  return out.sort();
}

async function queueWorld() {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  const inbox = path.join(g.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(g.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  const slot = JSON.parse(readFileSync(path.join(g.flowDir, 'model.json'), 'utf8')).slot;
  const ctl = { busy: false, starts: /** @type {string[]} */ ([]) };
  const door = createTriggerDoor({
    root: g.w.root,
    flowsDoor: { editBlock: () => null, scheduleBusy: () => (ctl.busy ? 'A run of this job is working.' : null), lastSourcesOf: () => ({ sources: { resume: path.join(g.w.inDir, 'resume.md'), jd: path.join(g.w.inDir, 'jd.md') } }) },
    starter: /** @type {any} */ ({ canStart: () => null, start: (a) => { ctl.starts.push(path.basename(a.sources.find((s) => s.path.startsWith(inbox)).path)); return { status: 202, body: { ok: true, runId: `run-${ctl.starts.length}`, startId: 's' } }; } }),
    loadEnv: () => ({ ok: true, env: {}, keyNames: [slot] }),
    monthlyClaim: () => null,
    modelRefusal: () => [],
    now: () => clock.t,
  });
  const sched = createScheduler({ door, now: () => clock.t, intervalMs: 0 });
  const polls = (n = STABLE_POLLS + 2) => { for (let i = 0; i < n; i++) sched.tick(); };
  const drop = (n) => writeFileSync(path.join(inbox, n), `# ${n}\n`);
  drop('one.md'); polls();
  ctl.busy = true;
  drop('q1.md'); drop('q2.md'); polls();
  assert.deepEqual(ctl.starts, ['one.md'], 'q1 and q2 wait');
  return { ...g, clock, inbox, ctl, polls, rows: () => readOutcomes(g.flowDir).filter((r) => r.outcome === 'schedule-changed') };
}

test('Must fail: a change leaves a waiting file behind: a new folder -> in the same click each waiting file has its am16 row and no queue holds it (no tick needed)', async () => {
  const f = await queueWorld();
  assert.deepEqual(waitingAnywhere(f.flowDir), ['q1.md', 'q2.md']);
  const other = path.join(f.w.work, 'inbox2'); mkdirSync(other);
  f.clock.t = at(13, 9);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'jd', folder: other })).status, 200);
  assert.deepEqual(waitingAnywhere(f.flowDir), [], 'nothing waits, and no scheduler tick has run since the click');
  assert.deepEqual(f.rows().map((r) => r.say).sort(), [SAY('q1.md'), SAY('q2.md')]);
  f.ctl.busy = false; f.polls(20);
  assert.deepEqual(f.ctl.starts, ['one.md'], 'neither ever ran');
  assert.equal(f.rows().length, 2, 'one row each');
});

test('Must fail: Cancel leaves a waiting file behind (same click, am16 words)', async () => {
  const f = await queueWorld();
  f.clock.t = at(13, 9);
  assert.equal((await setTrigger(f.w, null)).status, 200);
  assert.deepEqual(waitingAnywhere(f.flowDir), []);
  assert.deepEqual(f.rows().map((r) => r.say).sort(), [SAY('q1.md'), SAY('q2.md')]);
  f.ctl.busy = false; f.polls(20);
  assert.deepEqual(f.ctl.starts, ['one.md']);
});

test('the same folder, a changed schedule -> both waiting files are still queued (nothing waits twice) and both run in their turn', async () => {
  const f = await queueWorld();
  f.clock.t = at(13, 9);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'resume', folder: f.inbox })).status, 200);
  assert.deepEqual(waitingAnywhere(f.flowDir), ['q1.md', 'q2.md'], 'each waits in exactly one queue');
  assert.deepEqual(f.rows(), []);
  f.ctl.busy = false; f.polls();
  assert.deepEqual(f.ctl.starts.slice(1), ['q1.md', 'q2.md']);
  f.polls(20);
  assert.equal(f.ctl.starts.length, 3);
});

// ---------------------------------------------------------------- (d) an old schedule line still fires

test('Must fail: an old schedule line inside a job still fires (am20 item 5): no schedule.json -> By hand, never armed, never fires', async () => {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  // a job signed before am20: its prose carries the old line
  const cur = g.read();
  const prose = `${readFileSync(path.join(g.flowDir, 'prose.txt'), 'utf8').replace(/\s*$/, '')}\nguardrail: trigger daily 09:00\n`;
  const r = writeFlow({ root: g.w.root, name: 'job2', proseText: prose, declaration: JSON.parse(readFileSync(path.join(g.flowDir, 'declaration.json'), 'utf8')), signedBy: 'hamr', signedAt: '2026-10-10T10:00:00Z', catalogue: CAT, replaces: { flowHash: cur.signature.flow } });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  assert.equal(existsSync(path.join(g.flowDir, 'schedule.json')), false);
  const starts = [];
  const door = createTriggerDoor({
    root: g.w.root,
    flowsDoor: { editBlock: () => null, scheduleBusy: () => null, lastSourcesOf: () => ({ sources: { resume: path.join(g.w.inDir, 'resume.md'), jd: path.join(g.w.inDir, 'jd.md') } }) },
    starter: /** @type {any} */ ({ canStart: () => null, start: (a) => { starts.push(a); return { status: 202, body: { ok: true, runId: 'run-9', startId: 's' } }; } }),
    loadEnv: () => ({ ok: true, env: {}, keyNames: [JSON.parse(readFileSync(path.join(g.flowDir, 'model.json'), 'utf8')).slot] }),
    monthlyClaim: () => null,
    modelRefusal: () => [],
    now: () => clock.t,
  });
  const sched = createScheduler({ door, now: () => clock.t, intervalMs: 0 });
  sched.tick();
  clock.t = at(13, 9, 30); sched.tick();
  clock.t = at(14, 9, 30); sched.tick();
  assert.equal(starts.length, 0, 'the old line never fires');
  assert.deepEqual(readOutcomes(g.flowDir), [], 'and says nothing');
  assert.equal(existsSync(path.join(g.flowDir, 'schedule-ledger.jsonl')), false, 'nothing was armed');
  const card = door.card('job2');
  assert.equal(card.trigger, null, 'the job reads as By hand');
  assert.equal(card.armed, false);
});

// ---------------------------------------------------------------- beyond the four lines: an Edit of the job (M9 am1) and a changed schedule file

test('an Edit of the job (a new signing of the job) puts it By hand again: the next tick cancels the schedule the way Cancel does, with the am16 rows and no waiting file left', async () => {
  const f = await queueWorld();
  const cur = f.read();
  const r = writeFlow({
    root: f.w.root, name: 'job2', proseText: readFileSync(path.join(f.flowDir, 'prose.txt'), 'utf8').replace('write it out.', 'write it out, then tidy it.'),
    declaration: JSON.parse(readFileSync(path.join(f.flowDir, 'declaration.json'), 'utf8')), signedBy: 'else', signedAt: '2026-10-10T12:00:00Z', catalogue: CAT, replaces: { flowHash: cur.signature.flow },
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  assert.equal(existsSync(path.join(f.flowDir, 'schedule.json')), true, 'nothing has ticked yet');
  f.clock.t = at(13, 9);
  f.polls(1);
  assert.equal(existsSync(path.join(f.flowDir, 'schedule.json')), false);
  assert.deepEqual(waitingAnywhere(f.flowDir), []);
  assert.deepEqual(f.rows().map((x) => x.say).sort(), [SAY('q1.md'), SAY('q2.md')]);
  f.ctl.busy = false; f.polls(20);
  assert.deepEqual(f.ctl.starts, ['one.md'], 'neither ever ran');
});

test('a schedule.json changed after it was signed is not a schedule: it reads as By hand and nothing fires', async () => {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  assert.equal((await setTrigger(g.w, DAILY)).status, 200);
  const file = path.join(g.flowDir, 'schedule.json');
  const doc = JSON.parse(readFileSync(file, 'utf8'));
  writeFileSync(file, JSON.stringify({ ...doc, trigger: { kind: 'daily', hour: 10, minute: 0 } }));
  clock.t = at(13, 10, 0, 30); g.w.h.tick();
  assert.deepEqual(readOutcomes(g.flowDir), [], 'nothing fired');
  assert.equal((await g.w.get('/api/author/flows')).json().flows.find((x) => x.flow === 'job2').trigger.trigger, null);
});

// ---------------------------------------------------------------- a Set that cannot arm changes nothing ("Nothing was changed" must be true)

test('Must fail: a Set to a folder that cannot be armed says "Nothing was changed" and the old schedule, its waiting files and its ledger are untouched', { skip: process.getuid?.() === 0 && 'root reads a chmod 000 folder' }, async () => {
  const f = await queueWorld();
  const closed = path.join(f.w.work, 'closed'); mkdirSync(closed); chmodSync(closed, 0o000);
  try {
    const schedBefore = readFileSync(path.join(f.flowDir, 'schedule.json'), 'utf8');
    const ledgerBefore = readFileSync(path.join(f.flowDir, 'schedule-ledger.jsonl'), 'utf8');
    f.clock.t = at(13, 9);
    const r = await setTrigger(f.w, { kind: 'new-file', role: 'jd', folder: closed });
    assert.equal(r.status, 409, JSON.stringify(r.json()));
    assert.match(r.json().say, /Nothing was changed/);
    assert.equal(readFileSync(path.join(f.flowDir, 'schedule.json'), 'utf8'), schedBefore, 'the old schedule stands');
    assert.deepEqual(waitingAnywhere(f.flowDir), ['q1.md', 'q2.md'], 'the waiting files still wait');
    assert.equal(f.rows().length, 0, 'no "will not run" row');
    assert.equal(readFileSync(path.join(f.flowDir, 'schedule-ledger.jsonl'), 'utf8'), ledgerBefore, 'the ledger is byte-identical');
  } finally { chmodSync(closed, 0o700); }
});
