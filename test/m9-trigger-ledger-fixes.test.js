// Trigger/scheduler ledger fixes (fix/trigger-ledger): a refused start does not spend the file; the told-once key includes the reason; the NEXT line
// reads only the current signed trigger's outcomes; a torn ledger line is skipped. $0: the clock is injected, the starter is a stub, tick() is called by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createTriggerDoor, readOutcomes, triggerLedgerDir } from '../src/panel/authortrigger.js';
import { createScheduler } from '../src/panel/scheduler.js';
import { queueOf, readSeen, STABLE_POLLS } from '../src/trigger-files.js';
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

test('a start the starter refuses (409) leaves the file queued, not ran: it runs on the next free tick; and ran is on disk BEFORE the start', async () => {
  const f = await stubWorld();
  writeFileSync(path.join(f.inbox, 'd.md'), '# jd\n');
  let ranBeforeStart = null;
  f.ctl.start = () => {
    ranBeforeStart = f.ledger().some((r) => r.kind === 'ran');
    return { status: 409, body: { ok: false, refused: 'start-live', say: 'A run of this flow is already starting. Wait for it.' } };
  };
  f.polls();
  assert.equal(ranBeforeStart, true, 'a crash between the ran row and the start loses a run, never doubles one');
  assert.deepEqual(f.rows().map((r) => r.outcome), ['refused'], 'one refused row, told once over many ticks');
  assert.equal(queueOf(f.ledger()).length, 1, 'the refused file is still in the queue');
  f.ctl.start = () => ({ status: 202, body: { ok: true, runId: 'run-9', startId: 's' } });
  const before = f.ctl.starts;
  f.polls(1);
  assert.equal(f.ctl.starts, before + 1, 'started on the next tick');
  assert.equal(f.rows().at(-1).outcome, 'started');
  f.polls(3);
  assert.equal(f.ctl.starts, before + 1, 'and only once');
  assert.equal(queueOf(f.ledger()).length, 0);
});
