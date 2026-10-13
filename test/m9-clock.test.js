// M9 piece 1 (docs/wiki/the-module-ladder.md, "M9" items 1 and 3, amendment 2 item 1): the clock trigger.
// $0, no network, no real sleeps. Local-time slots are built with the Date constructor so the
// suite is timezone-independent; the DST cases run in a child with TZ=Europe/Berlin.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import path from 'node:path';
import { readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import {
  GRACE_MS, validateSchedule, due, nextSlot, armTrigger, recordFire, readRows,
} from '../src/trigger-clock.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dir = () => mkdtempSync(path.join(tmpdir(), 'm9clock-'));
const at = (y, mo, d, h, mi, s = 0) => new Date(y, mo - 1, d, h, mi, s).getTime();
// 2026-10-12 is a Monday.
const daily9 = { kind: 'daily', hour: 9, minute: 0 };

test('validateSchedule: three kinds, typed object, anything else refused by name', () => {
  assert.deepEqual(validateSchedule({ kind: 'daily', hour: 9, minute: 5 }), { kind: 'daily', hour: 9, minute: 5 });
  assert.deepEqual(validateSchedule({ kind: 'weekdays', hour: 0, minute: 0 }), { kind: 'weekdays', hour: 0, minute: 0 });
  assert.deepEqual(validateSchedule({ kind: 'weekly', day: 'mon', hour: 23, minute: 59 }), { kind: 'weekly', day: 'mon', hour: 23, minute: 59 });
  const bad = [
    ['*/5 * * * *', /schedule/], [null, /schedule/], [{ kind: 'hourly', hour: 1, minute: 0 }, /kind "hourly"/],
    [{ kind: 'daily', hour: 24, minute: 0 }, /hour/], [{ kind: 'daily', hour: 9, minute: 60 }, /minute/],
    [{ kind: 'daily', hour: 9.5, minute: 0 }, /hour/], [{ kind: 'daily', hour: '9', minute: 0 }, /hour/],
    [{ kind: 'weekly', hour: 9, minute: 0 }, /day/], [{ kind: 'weekly', day: 'monday', hour: 9, minute: 0 }, /day/],
    [{ kind: 'daily', hour: 9, minute: 0, day: 'mon' }, /day/], [{ kind: 'daily', hour: 9, minute: 0, cron: '* * * * *' }, /cron/],
  ];
  for (const [b, re] of bad) assert.throws(() => validateSchedule(b), re, JSON.stringify(b));
});

test('due: nothing before the first slot; the arm time is the starting point', () => {
  const armed = [{ id: 'a', kind: 'armed', at: at(2026, 10, 12, 10, 0) }];
  // armed Monday 10:00, daily 09:00: Monday's 09:00 is before arming and never fires
  assert.equal(due(daily9, armed, at(2026, 10, 12, 10, 1)).fire, false);
  assert.equal(due(daily9, armed, at(2026, 10, 13, 8, 59)).fire, false);
  const d = due(daily9, armed, at(2026, 10, 13, 9, 0));
  assert.equal(d.fire, true);
  assert.equal(d.catchUp, false);
  assert.equal(d.slot, at(2026, 10, 13, 9, 0));
  assert.equal(due(daily9, [], at(2026, 10, 13, 9, 0)).fire, false, 'not armed = never fires');
});

test('catch-up: more than 120000 ms late is catch-up; exactly 120000 ms is NOT (the tie)', () => {
  assert.equal(GRACE_MS, 120000);
  const armed = [{ id: 'a', kind: 'armed', at: at(2026, 10, 12, 8, 0) }];
  const slot = at(2026, 10, 12, 9, 0);
  assert.equal(due(daily9, armed, slot).catchUp, false);
  assert.equal(due(daily9, armed, slot + 119999).catchUp, false);
  const tie = due(daily9, armed, slot + 120000);
  assert.deepEqual([tie.fire, tie.catchUp], [true, false], 'exactly 2:00 late is on time');
  assert.equal(due(daily9, armed, slot + 120001).catchUp, true);
  const five = due(daily9, armed, slot + 5 * 60000);
  assert.deepEqual([five.fire, five.catchUp, five.slot], [true, true, slot], '5 minutes late -> catchUp true');
});

test('three missed times give ONE fire, marked catch-up (item 3)', () => {
  const armed = [{ id: 'a', kind: 'armed', at: at(2026, 10, 9, 12, 0) }]; // Fri
  // panel off; back Tuesday 08:00: Sat, Sun, Mon 09:00 were missed
  const now = at(2026, 10, 13, 8, 0);
  const d = due(daily9, armed, now);
  assert.equal(d.fire, true);
  assert.equal(d.catchUp, true);
  assert.equal(d.missed, 3, 'Sat, Sun, Mon; Fri 09:00 is before arming');
});

test('three missed: exactly three slots -> one fire with missed 3', () => {
  const armed = [{ id: 'a', kind: 'armed', at: at(2026, 10, 9, 10, 0) }];
  const now = at(2026, 10, 12, 9, 30); // Sat, Sun, Mon 09:00 missed
  const d = due(daily9, armed, now);
  assert.deepEqual([d.fire, d.catchUp, d.missed, d.slot], [true, true, 3, at(2026, 10, 12, 9, 0)]);
  const f = dir() + '/ledger.jsonl';
  armTrigger(f, at(2026, 10, 9, 10, 0));
  recordFire(f, d, now);
  assert.equal(readRows(f).filter((r) => r.kind === 'fire').length, 1);
  assert.equal(due(daily9, readRows(f), now + 60000).fire, false, 'after the one fire, nothing is still due');
  assert.equal(due(daily9, readRows(f), at(2026, 10, 13, 9, 0)).fire, true, 'next slot is normal');
});

test('several missed slots with the latest on time are still a catch-up', () => {
  const armed = [{ id: 'a', kind: 'armed', at: at(2026, 10, 9, 10, 0) }];
  const d = due(daily9, armed, at(2026, 10, 12, 9, 1));
  assert.deepEqual([d.fire, d.catchUp, d.missed], [true, true, 3]);
});

test('weekdays skips Sat/Sun; weekly fires on its day only', () => {
  const wk = { kind: 'weekdays', hour: 9, minute: 0 };
  const armed = [{ id: 'a', kind: 'armed', at: at(2026, 10, 9, 10, 0) }]; // Fri 10:00
  assert.equal(due(wk, armed, at(2026, 10, 10, 9, 0)).fire, false, 'Sat');
  assert.equal(due(wk, armed, at(2026, 10, 11, 9, 0)).fire, false, 'Sun');
  const m = due(wk, armed, at(2026, 10, 12, 9, 0));
  assert.deepEqual([m.fire, m.catchUp, m.missed], [true, false, 0], 'Mon, one slot, on time');
  const w = { kind: 'weekly', day: 'mon', hour: 9, minute: 0 };
  assert.equal(due(w, armed, at(2026, 10, 11, 23, 0)).fire, false);
  assert.equal(due(w, armed, at(2026, 10, 12, 9, 0)).fire, true);
  const w2 = { kind: 'weekly', day: 'sun', hour: 9, minute: 0 };
  assert.equal(due(w2, armed, at(2026, 10, 11, 9, 0)).fire, true);
});

test('nextSlot: the next time, strictly after; weekly and weekdays skip ahead', () => {
  assert.equal(nextSlot(daily9, at(2026, 10, 12, 8, 0)), at(2026, 10, 12, 9, 0));
  assert.equal(nextSlot(daily9, at(2026, 10, 12, 9, 0)), at(2026, 10, 13, 9, 0), 'strictly after');
  assert.equal(nextSlot({ kind: 'weekdays', hour: 9, minute: 0 }, at(2026, 10, 9, 9, 30)), at(2026, 10, 12, 9, 0));
  assert.equal(nextSlot({ kind: 'weekly', day: 'mon', hour: 9, minute: 0 }, at(2026, 10, 12, 9, 30)), at(2026, 10, 19, 9, 0));
});

test('ledger: append-only JSONL, write-once by id, survives restart (reread from disk)', () => {
  const f = path.join(dir(), 'sub', 'clock.jsonl');
  assert.deepEqual(readRows(f), [], 'missing file = no rows');
  armTrigger(f, at(2026, 10, 12, 8, 0));
  const armedId = readRows(f)[0].id;
  assert.throws(() => armTrigger(f, at(2026, 10, 12, 8, 0)), /already/, 'same id is write-once');
  const d = due(daily9, readRows(f), at(2026, 10, 12, 9, 0));
  recordFire(f, d, at(2026, 10, 12, 9, 0));
  assert.throws(() => recordFire(f, d, at(2026, 10, 12, 9, 0)), /already/, 'a slot fires once');
  const raw = readFileSync(f, 'utf8').split('\n').filter(Boolean);
  assert.equal(raw.length, 2);
  assert.equal(JSON.parse(raw[0]).id, armedId);
  // "restart": no process state is kept, so a fresh read decides
  const rows = readRows(f);
  assert.equal(due(daily9, rows, at(2026, 10, 12, 9, 0, 30)).fire, false, 'already fired');
  assert.equal(due(daily9, rows, at(2026, 10, 13, 9, 0)).fire, true);
  assert.ok(!existsSync(path.join(path.dirname(f), 'latest.json')));
});

test('a fire row records catchUp and missed for the history row', () => {
  const f = path.join(dir(), 'c.jsonl');
  armTrigger(f, at(2026, 10, 12, 8, 0));
  const now = at(2026, 10, 12, 9, 5);
  recordFire(f, due(daily9, readRows(f), now), now);
  const row = readRows(f).find((r) => r.kind === 'fire');
  assert.equal(row.catchUp, true);
  assert.equal(row.slot, at(2026, 10, 12, 9, 0));
  assert.equal(row.at, now);
});

function berlin(code) {
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', code], {
    env: { ...process.env, TZ: 'Europe/Berlin' }, encoding: 'utf8', timeout: 20000, cwd: path.join(HERE, '..'),
  });
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
}
const dstScript = (armISO, nows) => `
import { due, armTrigger, recordFire, readRows } from './src/trigger-clock.js';
import { mkdtempSync, rmSync } from 'node:fs'; import { tmpdir } from 'node:os'; import path from 'node:path';
const d = mkdtempSync(path.join(tmpdir(), 'm9dst-')); const f = path.join(d, 'l.jsonl');
const s = { kind: 'daily', hour: 2, minute: 30 };
armTrigger(f, Date.parse(${JSON.stringify(armISO)}));
const out = [];
for (const n of ${JSON.stringify(nows)}) { const t = Date.parse(n); const x = due(s, readRows(f), t); if (x.fire) recordFire(f, x, t); out.push([n, x.fire, x.catchUp]); }
rmSync(d, { recursive: true, force: true });
console.log(JSON.stringify(out));`;

test('DST spring (Berlin, 02:30 does not exist on 2026-03-29): fires once, shifted, not a catch-up', () => {
  const out = berlin(dstScript('2026-03-28T02:30:00+01:00', [
    '2026-03-29T03:30:00+02:00', '2026-03-29T12:00:00+02:00', '2026-03-29T23:59:00+02:00', '2026-03-30T02:30:00+02:00']));
  assert.deepEqual(out.map((o) => [o[1], o[2]]), [[true, false], [false, false], [false, false], [true, false]]);
});

test('DST autumn (Berlin, 02:30 happens twice on 2026-10-25): fires once', () => {
  const out = berlin(dstScript('2026-10-24T02:30:00+02:00', [
    '2026-10-25T02:30:00+02:00', '2026-10-25T02:30:00+01:00', '2026-10-25T12:00:00+01:00', '2026-10-26T02:30:00+01:00']));
  assert.deepEqual(out.map((o) => [o[1], o[2]]), [[true, false], [false, false], [false, false], [true, false]]);
});
