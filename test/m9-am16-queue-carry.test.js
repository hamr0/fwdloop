// M9 am16 (signed): when a New file trigger is changed or cancelled while files wait in its queue: the same folder -> the waiting files stay queued and run in
// their turn; the folder changed, or the trigger cancelled -> each waiting file gets ONE row ('<file> was waiting when the schedule changed, so it will not run.
// Drop it in again to run it.'). $0: the clock is injected, the door's flowsDoor/starter are stubs, the trigger is changed through the real panel, tick() by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createTriggerDoor, readOutcomes, triggerLedgerDir } from '../src/panel/authortrigger.js';
import { createScheduler } from '../src/panel/scheduler.js';
import { readSeen, STABLE_POLLS } from '../src/trigger-files.js';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
const SAY = (f) => `${f} was waiting when the schedule changed, so it will not run. Drop it in again to run it.`;

/** A job with a New file trigger on `inbox`; one.md has started and is still working (busy), q1.md and q2.md wait in the queue. */
async function world() {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  const inbox = path.join(g.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(g.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  const slot = JSON.parse(readFileSync(path.join(g.flowDir, 'model.json'), 'utf8')).slot;
  const ctl = { busy: false, starts: /** @type {string[]} */ ([]) };
  const door = createTriggerDoor({
    root: g.w.root,
    flowsDoor: { editBlock: () => null, scheduleBusy: () => (ctl.busy ? 'A run of this job is working.' : null), lastSourcesOf: () => ({ sources: { resume: path.join(g.w.inDir, 'resume.md'), jd: path.join(g.w.inDir, 'jd.md') } }) },
    starter: { canStart: () => null, start: (/** @type {any} */ a) => { ctl.starts.push(path.basename(a.sources.find((/** @type {any} */ s) => s.path.startsWith(inbox)).path)); return { status: 202, body: { ok: true, runId: `run-${ctl.starts.length}`, startId: 's' } }; } },
    loadEnv: () => ({ ok: true, env: {}, keyNames: [slot] }),
    monthlyClaim: () => null,
    modelRefusal: () => [],
    now: () => clock.t,
  });
  const sched = createScheduler({ door, now: () => clock.t, intervalMs: 0 });
  const ledger = () => readSeen(path.join(triggerLedgerDir(g.flowDir, g.read().signature.flow), 'seen.jsonl'));
  const polls = (n = STABLE_POLLS + 2) => { for (let i = 0; i < n; i++) sched.tick(); };
  const drop = (n) => writeFileSync(path.join(inbox, n), `# ${n}\n`);
  drop('one.md'); polls();
  assert.deepEqual(ctl.starts, ['one.md']);
  ctl.busy = true;
  drop('q1.md'); drop('q2.md'); polls();
  assert.deepEqual(ctl.starts, ['one.md'], 'q1 and q2 wait');
  return { ...g, clock, inbox, ctl, ledger, polls, drop, rows: () => readOutcomes(g.flowDir) };
}
const told = (f) => f.rows().filter((r) => r.outcome === 'schedule-changed');

test('am16 (a): the same folder, the schedule changed -> both waiting files stay queued and run in their turn', async () => {
  const f = await world();
  f.clock.t = at(13, 9);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'resume', folder: f.inbox })).status, 200);   // same folder, a different signing (new ledger folder)
  f.polls(20);
  assert.deepEqual(f.ctl.starts, ['one.md'], 'still busy: nothing runs yet');
  assert.deepEqual(told(f), [], 'no row: they were not dropped');
  f.ctl.busy = false;
  f.polls();
  assert.deepEqual(f.ctl.starts.slice(1), ['q1.md', 'q2.md'], 'in their turn, each once');
  f.polls(20);
  assert.equal(f.ctl.starts.length, 3);
});

test('am16 (b): the folder changed -> each waiting file gets exactly one row with the signed words and never runs; (d) no row repeats over 20 ticks', async () => {
  const f = await world();
  const other = path.join(f.w.work, 'inbox2'); mkdirSync(other);
  f.clock.t = at(13, 9);
  assert.equal((await setTrigger(f.w, { kind: 'new-file', role: 'jd', folder: other })).status, 200);
  f.polls(); f.ctl.busy = false; f.polls(20);
  assert.deepEqual(told(f).map((r) => r.say).sort(), [SAY('q1.md'), SAY('q2.md')]);
  assert.deepEqual(f.ctl.starts, ['one.md'], 'neither ever ran');
  assert.equal(told(f).length, 2, 'one row each over 20 ticks');
  assert.ok(told(f).every((r) => typeof r.file === 'string' && typeof r.sha === 'string'));
});

test('am16 (c): the trigger cancelled -> the same: one row each, never runs, no row repeated', async () => {
  const f = await world();
  f.clock.t = at(13, 9);
  assert.equal((await setTrigger(f.w, null)).status, 200);
  f.polls(); f.ctl.busy = false; f.polls(20);
  assert.deepEqual(told(f).map((r) => r.say).sort(), [SAY('q1.md'), SAY('q2.md')]);
  assert.deepEqual(f.ctl.starts, ['one.md']);
});
