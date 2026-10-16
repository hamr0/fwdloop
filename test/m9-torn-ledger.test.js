// Fix ledger (2026-10-14, reverted twice): a torn last line (a crash mid-append) in the clock or seen ledger must not take the trigger down, and must
// never let a file run twice. Skipping the torn line AND starting every append on a fresh line land together: skip alone let a torn line glue the next
// `ran` row, which then read as one unparseable line, so the file's ran row vanished and the file ran again.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import {
  createFileTrigger, queueOf, readSeen, recordArrived, recordRan,
} from '../src/trigger-files.js';
import { armTrigger, due, readRows, recordFire } from '../src/trigger-clock.js';

const tmp = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-torn-'));
const SHA_A = 'a'.repeat(64);
const SHA_B = 'b'.repeat(64);

test('seen ledger: a torn last line is skipped, and the next ran row lands on its own line (nothing runs twice)', () => {
  const dir = tmp();
  const ledger = path.join(dir, 'seen.jsonl');
  const A = { sha: SHA_A, path: path.join(dir, 'a.md'), size: 3 };
  const B = { sha: SHA_B, path: path.join(dir, 'b.md'), size: 3 };
  recordArrived(ledger, A, 1); recordArrived(ledger, B, 2);
  appendFileSync(ledger, '{"id":"ran:aaaa","kind":"ra');   // the crash: a ran row cut off mid-write, no newline
  assert.doesNotThrow(() => readSeen(ledger), 'one torn line does not take the ledger down');
  assert.deepEqual(queueOf(readSeen(ledger)).map((q) => q.name), ['a.md', 'b.md'], 'the torn row counts as not written: both still wait');
  recordRan(ledger, A, 3);   // the scheduler writes A's ran row, then starts A
  assert.deepEqual(queueOf(readSeen(ledger)).map((q) => q.name), ['b.md'], 'A\'s ran row was read back: A is out of the queue, it cannot run twice');
  assert.equal(readFileSync(ledger, 'utf8').split('\n').filter((l) => l.includes('ran:' + SHA_A)).length, 1);
});

test('clock ledger: a torn last line is skipped, and the next fire row lands on its own line (a slot fires once)', () => {
  const dir = tmp();
  const ledger = path.join(dir, 'clock.jsonl');
  const sc = { kind: 'daily', hour: 9, minute: 0 };
  const day = (d, h, m) => new Date(2026, 9, d, h, m).getTime();
  armTrigger(ledger, day(12, 8, 0));
  appendFileSync(ledger, '{"id":"fire:1","kind":"fi');   // torn
  assert.doesNotThrow(() => readRows(ledger));
  const d1 = due(sc, readRows(ledger), day(13, 9, 0));
  assert.equal(d1.fire, true);
  recordFire(ledger, d1, day(13, 9, 0));
  assert.equal(due(sc, readRows(ledger), day(13, 9, 1)).fire, false, 'the slot just fired is read back: it does not fire twice');
});

test('a ledger whose torn line is the only content: appends still work and read back', () => {
  const dir = tmp(); mkdirSync(dir, { recursive: true });
  const ledger = path.join(dir, 'seen.jsonl');
  writeFileSync(ledger, '{"id":"x');
  recordArrived(ledger, { sha: SHA_A, path: path.join(dir, 'a.md'), size: 1 }, 1);
  assert.equal(readSeen(ledger).length, 1);
});

test('file trigger poll over a ledger with a torn line does not throw', () => {
  const dir = tmp();
  const inbox = path.join(dir, 'in'); mkdirSync(inbox);
  const ledger = path.join(dir, 'seen.jsonl');
  const t = createFileTrigger({ mode: 'new', target: inbox, ledger });
  t.arm();
  appendFileSync(ledger, '{"id":"ran:');
  assert.doesNotThrow(() => t.poll());
});
