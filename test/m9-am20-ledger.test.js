// M9 amendment 20 item 2: ONE ledger per job, every row carries the `sig` of the schedule signing that wrote it; "since this signing" is a filter on `sig`, never a wall-clock compare.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';

import { armTrigger, due, readRows, recordFire } from '../src/trigger-clock.js';
import { queueOf, readSeen, recordArrived, recordDropped, recordRan } from '../src/trigger-files.js';

const dir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m9am20-ledger-'));
const item = { sha: 'a'.repeat(64), path: '/in/a.md', size: 3 };

test('clock rows are stamped with their signing and read back per signing; the same id may exist under two signings', () => {
  const f = path.join(dir(), 'schedule-ledger.jsonl');
  armTrigger(f, 1000, 'S1');
  armTrigger(f, 1000, 'S2');   // the same id `armed:1000`, another signing: not a duplicate
  recordFire(f, { fire: true, slot: 2000, catchUp: false, missed: 0 }, 2001, 'S1');
  assert.deepEqual(readRows(f, 'S1').map((r) => r.id), ['armed:1000', 'fire:2000']);
  assert.deepEqual(readRows(f, 'S2').map((r) => r.id), ['armed:1000']);
  assert.equal(readRows(f).length, 3);
  assert.throws(() => armTrigger(f, 1000, 'S1'), /already written/);
  // S2 never saw S1's fire: its starting point is its own arm time
  const sched = { kind: 'daily', hour: 0, minute: 0 };
  assert.equal(due(sched, readRows(f, 'S2'), 1000 + 60_000).fire, false);
});

test('file rows are stamped and the queue is the queue of ONE signing', () => {
  const f = path.join(dir(), 'schedule-ledger.jsonl');
  recordArrived(f, item, 5, 'S1');
  assert.equal(queueOf(readSeen(f, 'S1')).length, 1);
  assert.equal(queueOf(readSeen(f, 'S2')).length, 0, 'another signing does not see it');
  recordDropped(f, queueOf(readSeen(f, 'S1'))[0], 'schedule-changed', 6, 'S1');
  assert.equal(queueOf(readSeen(f, 'S1')).length, 0);
  recordRan(f, item, 7, 'S2');
  assert.deepEqual(readSeen(f).map((r) => r.sig), ['S1', 'S1', 'S2']);
  assert.ok(readFileSync(f, 'utf8').endsWith('\n'));
});

test('a file-updated baseline still blocks its own version when the ledger also holds `armed` / `fire` rows: they are not "the file changed away"', async () => {
  const { writeFileSync } = await import('node:fs');
  const { createFileTrigger } = await import('../src/trigger-files.js');
  const d = dir();
  const watched = path.join(d, 'w.md'); writeFileSync(watched, 'v1\n');
  const ledger = path.join(d, 'schedule-ledger.jsonl');
  const t = createFileTrigger({ mode: 'updated', target: watched, ledger, sig: 'S1' });
  t.arm();
  armTrigger(ledger, 1, 'S1');
  const arrived = [];
  for (let i = 0; i < 6; i++) arrived.push(...t.poll().arrived);
  assert.deepEqual(arrived, [], 'the version present at arm never runs');
  writeFileSync(watched, 'v2 changed\n');
  for (let i = 0; i < 6; i++) arrived.push(...t.poll().arrived);
  assert.equal(arrived.length, 1, 'the changed version does');
});
