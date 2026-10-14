// Trigger/scheduler ledger fixes (fix/trigger-ledger): a refused start does not spend the file; the told-once key includes the reason; the NEXT line
// reads only the current signed trigger's outcomes; a torn ledger line is skipped. $0: the clock is injected, the starter is a stub, tick() is called by hand.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendFileSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTriggerDoor, readOutcomes, triggerLedgerDir } from '../src/panel/authortrigger.js';
import { createScheduler } from '../src/panel/scheduler.js';
import { queueOf, readSeen, recordArrived, recordRan, STABLE_POLLS } from '../src/trigger-files.js';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { armTrigger, readRows } from '../src/trigger-clock.js';
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

test('a torn line in the clock or seen ledger is skipped like readOutcomes does, never thrown; the good rows still read', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'm9torn-'));
  const clock = path.join(dir, 'clock.jsonl'); const seen = path.join(dir, 'seen.jsonl');
  const good = { id: 'armed:1', kind: 'armed', at: 1 };
  writeFileSync(clock, `${JSON.stringify(good)}\n{"id":"fire:2","kind":"fi\n`);
  assert.deepEqual(readRows(clock), [good]);
  const row = { id: 'arrived:x', kind: 'arrived', sha: 'x', name: 'a', size: 1, at: 1, path: '/a' };
  writeFileSync(seen, `{"id":"arri\n${JSON.stringify(row)}\n`);
  appendFileSync(seen, '{"id":"ran:x","ki');
  assert.deepEqual(readSeen(seen), [row]);
});

test('a seen ledger torn mid-append (no trailing newline): the next row starts on its own line, so a ran row stays readable and the file does not run twice', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'm9glue-'));
  const seen = path.join(dir, 'seen.jsonl');
  const item = { sha: 'a'.repeat(64), path: path.join(dir, 'd.md'), size: 5 };
  assert.equal(recordArrived(seen, item, 1), true);
  appendFileSync(seen, '{"id":"dropped:arr');   // the crash: a fragment, no newline
  assert.equal(recordRan(seen, item, 2), true);
  const rows = readSeen(seen);
  assert.deepEqual(rows.map((r) => r.kind), ['arrived', 'ran'], 'the ran row is readable, the fragment alone is skipped');
  assert.equal(queueOf(rows).length, 0, 'ran: the file is not queued again, so it does not run a second time');
  assert.equal(recordArrived(seen, item, 3), false, 'and it does not arrive again');
  const clock = path.join(dir, 'clock.jsonl');
  writeFileSync(clock, '{"id":"armed:1","ki');
  armTrigger(clock, 5);
  assert.deepEqual(readRows(clock).map((r) => r.id), ['armed:5'], 'the clock ledger starts a fresh line too');
});
