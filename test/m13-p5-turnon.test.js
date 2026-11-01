// M13 piece 5 (signed item 7 and the F114f cut of item 6). A schedule signed with the job is OFF until the job's first green run; then the panel's next check turns it on once.
// Must fail: a schedule turns on before a green run; an older ticket runs. Real trigger door, real scheduler, real ticket look on the fake MCP server, injected clock. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync } from 'node:fs';

import { scheduleBlockWords, scheduledNextFor, SCHEDULE_WAITING_SAY } from '../src/summary-words.js';
import { MIN, p5World, T0 } from './m13-p5-world.mjs';

const mk = (t, o) => { const w = p5World(o); t.after(() => rmSync(w.dir, { recursive: true, force: true })); w.sign(); return w; };

test('Must fail: a schedule turns on before a green run. No run, a red run, a cap-halted run, a run whose job copy differs: still off, never looked at, never fires', async (t) => {
  const w = mk(t);
  await w.ticks(4);
  assert.deepEqual([w.armed().length, w.starts.length, w.lookCalls()], [0, 0, 0], 'no run at all');
  w.run('r-red', { ticket: 5, rows: [['not-done', w.clock.t]] });
  await w.ticks(3);
  w.run('r-cap', { ticket: 5, rows: [['cap-halt', w.clock.t]] });
  await w.ticks(3);
  w.run('r-stale', { ticket: 5, rows: [['complete', w.clock.t]], mutate: true });
  await w.ticks(3);
  assert.deepEqual([w.armed().length, w.starts.length, w.lookCalls()], [0, 0, 0]);
  assert.equal(w.door.read('tk').waiting, true, 'the Run card still says it is waiting');
});

test('the first green run turns it on once: one armed row, the next checks add none; the Run card is no longer waiting', async (t) => {
  const w = mk(t);
  w.run('r-red', { ticket: 5, rows: [['not-done', w.clock.t]] });
  await w.ticks(2);
  assert.equal(w.armed().length, 0);
  w.run('r-green', { ticket: 5, rows: [['complete', w.clock.t]] });
  assert.equal(w.door.read('tk').waiting, false, 'a green run is not "waiting for a green run", even before the next check');
  await w.tick();
  assert.equal(w.armed().length, 1);
  await w.ticks(4);
  assert.equal(w.armed().length, 1);
  assert.equal(w.door.read('tk').armed, true);
});

test('a resume that ends green counts: the same run, red first, then complete', async (t) => {
  const w = mk(t);
  w.run('r-one', { ticket: 5, rows: [['not-done', w.clock.t]] });
  await w.ticks(3);
  assert.equal(w.armed().length, 0);
  w.clock.t += 20 * MIN;
  w.run('r-one', { rows: [['complete', w.clock.t]] });   // the resume is the same run's later history row
  await w.tick();
  assert.equal(w.armed().length, 1);
});

test('Must fail: an older ticket runs. The first green run read #5: #1 to #5 never run; #6, which came in during the wait, runs once; nothing more after', async (t) => {
  const w = mk(t);
  w.run('r-first', { ticket: 5, rows: [['not-done', w.clock.t]] });   // read #5 at T0
  w.setList(6);                                                         // #6 comes in during the wait
  await w.ticks(2, 5 * MIN);
  w.run('r-first', { ticket: 5, rows: [['complete', w.clock.t]] });
  await w.ticks(5);
  assert.deepEqual(w.starts, [6]);
  assert.deepEqual(w.seen('baseline').map((r) => r.number).sort(), [1, 2, 3, 4, 5]);
  assert.equal(w.armed()[0].ticketN, 5);
  await w.ticks(4);
  assert.deepEqual(w.starts, [6], 'still one start');
});

test('a flood during the wait is all seen: with 25 tickets and a page of 10, #6 to #25 arrive and #1 to #5 are baselined; none at or below the cut starts', async (t) => {
  const w = mk(t, { listSize: 5 });
  w.run('r-first', { ticket: 5, rows: [['complete', w.clock.t]] });
  w.setList(25);
  await w.ticks(1);
  assert.deepEqual(w.seen('arrived').map((r) => r.number).sort((a, b) => a - b), Array.from({ length: 20 }, (_, i) => i + 6));
  assert.deepEqual(w.seen('baseline').map((r) => r.number).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.equal(w.starts.every((n) => n >= 6), true, 'nothing at or below the cut starts');
});

test('a green run that read no ticket number leaves no cut: the first look baselines the whole list and nothing runs (today\'s rule)', async (t) => {
  const w = mk(t);
  w.setList(6);
  w.run('r-first', { rows: [['complete', w.clock.t]] });
  await w.ticks(5);
  assert.equal(w.armed().length, 1);
  assert.equal('ticketN' in w.armed()[0], false);
  assert.deepEqual(w.starts, []);
  assert.equal(w.seen('baseline').length, 6);
});

test('a daily schedule signed with the job is off until the green run, and no slot before the turn-on ever fires', async (t) => {
  const w = mk(t, { trigger: { kind: 'daily', hour: 9, minute: 0 } });
  await w.tick(65 * MIN);   // 09:05, no green run
  assert.deepEqual([w.armed().length, w.starts.length], [0, 0]);
  w.run('r-first', { rows: [['complete', w.clock.t]] });
  await w.tick(5 * MIN);    // 09:10 turns on
  assert.equal(w.armed().length, 1);
  assert.equal(w.starts.length, 0, 'the 09:00 slot before the turn-on never fires');
  await w.tick(24 * 60 * MIN);
  assert.equal(w.starts.length, 1);
});

test('the Run card words: a waiting schedule says the grey line, never red; an armed one does not', () => {
  const t = { kind: 'new-ticket', role: 'jd', list: 'x', server: 's', tool: 't' };
  const blk = scheduleBlockWords({ trigger: t, last: null, nextSlotMs: null, armed: false, waiting: true, problem: null });
  assert.deepEqual(blk, { line1: 'when a new ticket arrives in jd', line2: 'Schedule waiting for a green run', red: false, grey: true });
  assert.equal(SCHEDULE_WAITING_SAY, 'Schedule waiting for a green run');
  assert.notEqual(scheduleBlockWords({ trigger: t, last: null, nextSlotMs: null, armed: true, problem: null }).line2, SCHEDULE_WAITING_SAY);
  assert.deepEqual(scheduledNextFor({ trigger: t, armed: false, waiting: true, nextSlotMs: null, lastOutcome: null, waitingLine: null, now: T0 }), { text: SCHEDULE_WAITING_SAY, red: false });
});
