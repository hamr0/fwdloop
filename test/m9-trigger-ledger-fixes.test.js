// Trigger/scheduler ledger fixes (fix/trigger-ledger): the told-once key includes the reason; the NEXT line
// reads only the current signed trigger's outcomes. $0: the clock is injected, the starter is a stub, tick() is called by hand.
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

/** A green job with a New file trigger, and a door of our own whose starter and model check the test controls. */
async function stubWorld(o = {}) {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  const inbox = path.join(g.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(g.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  const slot = JSON.parse(readFileSync(path.join(g.flowDir, 'model.json'), 'utf8')).slot;
  const ctl = { start: () => ({ status: 202, body: { ok: true, runId: 'run-9', startId: 's' } }), model: /** @type {any[]} */ ([]), starts: 0 };
  const door = createTriggerDoor({
    root: g.w.root,
    flowsDoor: { editBlock: () => null, lastSourcesOf: () => ({ sources: { resume: path.join(g.w.inDir, 'resume.md'), jd: path.join(g.w.inDir, 'jd.md') } }) },
    starter: { start: (/** @type {any} */ a) => { ctl.starts++; return ctl.start(a); } },
    loadEnv: () => ({ ok: true, env: {}, keyNames: [slot] }),
    monthlyClaim: () => null,
    modelRefusal: () => ctl.model,
    now: () => clock.t,
  });
  const sched = createScheduler({ door, now: () => clock.t, intervalMs: 0 });
  const ledger = () => readSeen(path.join(triggerLedgerDir(g.flowDir, g.read().signature.flow), 'seen.jsonl'));
  const polls = (n = STABLE_POLLS + 2) => { for (let i = 0; i < n; i++) sched.tick(); };
  return { ...g, clock, inbox, ctl, door, sched, ledger, polls, rows: () => readOutcomes(g.flowDir), ...o };
}

test('a queued file refused for a NEW reason is told again; the same reason over many ticks is told once', async () => {
  const f = await stubWorld();
  writeFileSync(path.join(f.inbox, 'd.md'), '# jd\n');
  f.ctl.model = [{ say: 'Base URL is not set.' }];
  f.polls(); f.polls();
  assert.deepEqual(f.rows().map((r) => r.why), ['Base URL is not set.'], 'same reason: one row');
  f.ctl.model = [{ say: 'The model is not ticked in Settings.' }];
  f.polls(); f.polls();
  assert.deepEqual(f.rows().map((r) => r.why), ['Base URL is not set.', 'The model is not ticked in Settings.'], 'a different reason is a new row');
  assert.equal(f.ctl.starts, 0);
});

test('lastOutcome reads only the current signed trigger: a red from an older trigger does not lead a newly signed schedule', async () => {
  const f = await stubWorld();
  f.door.refuse(f.door.scan()[0], 'folder gone');   // the old file trigger's refusal
  assert.equal(f.door.read('job2').lastOutcome.outcome, 'refused', 'it is the current trigger\'s own row now');
  f.clock.t = at(13, 9);
  assert.equal((await setTrigger(f.w, { kind: 'daily', hour: 10, minute: 0 })).status, 200);
  assert.equal(f.door.read('job2').lastOutcome, null, 'the new schedule has had no outcome yet');
  f.clock.t = at(13, 9, 5);
  f.door.refuse(f.door.scan()[0], 'again');
  assert.equal(f.door.read('job2').lastOutcome.why, 'again', 'its own outcome counts');
});
