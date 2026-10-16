// M9 am17 (signed): before a queued file is marked as run, the panel checks it can start (no run of this job starting, the root exists, the run number
// is free). If not, the file stays queued and tries again next turn, with NOTHING written. A refusal after the run began still counts as its run.
// $0: the clock is injected, the starter is a stub whose `canStart` and `start` the test controls, tick() is called by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { createTriggerDoor, readOutcomes, triggerLedgerDir } from '../src/panel/authortrigger.js';
import { createScheduler } from '../src/panel/scheduler.js';
import { readSeen, STABLE_POLLS } from '../src/trigger-files.js';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld, ls, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
const LIVE = { status: 409, body: { ok: false, refused: 'start-live', say: 'A run of this flow is already starting. Wait for it.' } };

async function world() {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  const inbox = path.join(g.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(g.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  const slot = JSON.parse(readFileSync(path.join(g.flowDir, 'model.json'), 'utf8')).slot;
  const ctl = { gate: /** @type {any} */ (null), start: () => ({ status: 202, body: { ok: true, runId: 'run-9', startId: 's' } }), starts: 0, gates: 0 };
  const door = createTriggerDoor({
    root: g.w.root,
    flowsDoor: { editBlock: () => null, scheduleBusy: () => null, lastSourcesOf: () => ({ sources: { resume: path.join(g.w.inDir, 'resume.md'), jd: path.join(g.w.inDir, 'jd.md') } }) },
    starter: { canStart: () => { ctl.gates++; return ctl.gate; }, start: (/** @type {any} */ a) => { ctl.starts++; return ctl.start(a); } },
    loadEnv: () => ({ ok: true, env: {}, keyNames: [slot] }),
    monthlyClaim: () => null,
    modelRefusal: () => [],
    now: () => clock.t,
  });
  const sched = createScheduler({ door, now: () => clock.t, intervalMs: 0 });
  const ledger = () => readSeen(path.join(triggerLedgerDir(g.flowDir, g.read().signature.flow), 'seen.jsonl'));
  const kinds = () => ledger().filter((r) => r.kind !== 'baseline').map((r) => r.kind);
  const polls = (n = STABLE_POLLS + 2) => { for (let i = 0; i < n; i++) sched.tick(); };
  return { ...g, clock, inbox, ctl, ledger, kinds, polls, rows: () => readOutcomes(g.flowDir) };
}

test('am17 (a): a start refused once (start-live) is not marked run; the next turn runs the file once', async () => {
  const f = await world();
  writeFileSync(path.join(f.inbox, 'd.md'), '# jd\n');
  f.ctl.gate = LIVE;
  f.polls();
  assert.deepEqual(f.kinds(), ['arrived'], 'no ran row while it cannot start');
  assert.equal(f.ctl.starts, 0);
  f.ctl.gate = null;
  f.polls();
  assert.deepEqual(f.kinds(), ['arrived', 'ran']);
  assert.equal(f.ctl.starts, 1, 'the file ran once');
});

test('am17 (b): a persistent refusal over 20 ticks writes nothing: no ledger rows, no outcome rows, no start or run folders', async () => {
  const f = await world();
  writeFileSync(path.join(f.inbox, 'd.md'), '# jd\n');
  f.ctl.gate = LIVE;
  f.polls();
  const ledgerAt = JSON.stringify(f.ledger()); const rowsAt = JSON.stringify(f.rows()); const runsAt = ls(path.join(f.flowDir, 'runs'));
  f.polls(20);
  assert.equal(JSON.stringify(f.ledger()), ledgerAt);
  assert.equal(JSON.stringify(f.rows()), rowsAt);
  assert.deepEqual(ls(path.join(f.flowDir, 'runs')), runsAt);
  assert.equal(f.ctl.starts, 0);
  assert.ok(f.ctl.gates >= 20, 'it asked again every turn');
});

test('am17 (c): a file never runs twice', async () => {
  const f = await world();
  writeFileSync(path.join(f.inbox, 'd.md'), '# jd\n');
  f.ctl.gate = LIVE; f.polls(5); f.ctl.gate = null; f.polls(30);
  assert.equal(f.ctl.starts, 1);
  assert.equal(f.kinds().filter((k) => k === 'ran').length, 1);
});

test('am17 (d): a refusal after the run began (the starter itself says no) still counts as its run and shows as a refused start', async () => {
  const f = await world();
  writeFileSync(path.join(f.inbox, 'd.md'), '# jd\n');
  f.ctl.start = () => ({ status: 500, body: { ok: false, refused: 'spawn', say: 'The run could not be started (EAGAIN). Nothing spent.' } });
  f.polls(); f.polls(10);
  assert.deepEqual(f.kinds(), ['arrived', 'ran'], 'ran is written before the start, as today');
  assert.equal(f.ctl.starts, 1, 'not tried again');
  assert.deepEqual(f.rows().map((r) => [r.outcome, r.why]), [['refused', 'The run could not be started (EAGAIN). Nothing spent.']]);
});
