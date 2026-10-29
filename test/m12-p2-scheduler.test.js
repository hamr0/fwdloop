// M12 piece 2, the scheduler's ticket schedule (ladder "M12 scope (restart)" items 5-8; M9 am2, am3, am8, am17): a look every 15 minutes, the first look is the starting
// point, new tickets queue oldest first in schedule-ledger.jsonl, a busy job keeps them waiting, a watched change arrives once, an unreadable list is never "0 new".
// Injected clock, a stub door, the REAL look against the fake MCP server (test/fixtures/fake-mcp-server.mjs). No network, no model, no real waits.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScheduler } from '../src/panel/scheduler.js';
import { ledgerOf } from '../src/schedule.js';
import { readSeen, queueOf } from '../src/trigger-files.js';
import { TICKET_LOOK_MS } from '../src/trigger-tickets.js';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-server.mjs');
const SIG = 'sig-1';
const LIST = 'https://github.com/flutter/flutter/issues';
const issue = (number, extra = {}) => ({ number, state: 'OPEN', labels: [], ...extra });
const newestFirst = (n) => Array.from({ length: n }, (_, i) => issue(n - i));
const MIN = 60_000;

/** a scheduler over one ticket schedule; `fires` records what the door was asked to start */
function setup(t, { issues = newestFirst(5), env = {}, watch, busy = false } = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p2-sched-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const listFile = path.join(dir, 'list.json');
  const calls = path.join(dir, 'calls.jsonl');
  const config = path.join(dir, 'mcp.json');
  writeFileSync(listFile, JSON.stringify(issues));
  writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile, FAKE_CALLS: calls, ...env } } } }));
  const trigger = { kind: 'new-ticket', role: 'issues', list: LIST, server: 'github', tool: 'list_issues', ...(watch ? { watch } : {}) };
  const job = { flow: 'tk', flowDir: dir, sig: SIG, trigger, schedule: { sig: SIG } };
  const clock = { t: 1_000_000 };
  const fires = [];
  const state = { busy };
  const door = {
    scan: () => [job],
    retireStale() {},
    busy: () => state.busy,
    note() {},
    refuse() {},
    fire(j, cause, hooks = {}) {
      if (state.busy) { fires.push({ busy: true, number: cause.number }); return; }
      hooks.beforeStart?.();
      fires.push({ number: cause.number, why: cause.why, role: cause.role, list: cause.list });
    },
  };
  const s = createScheduler({ door, now: () => clock.t, intervalMs: 0, mcpConfig: config });
  const ledger = ledgerOf(dir);
  return {
    s, clock, fires, state, ledger, setList: (l) => writeFileSync(listFile, JSON.stringify(l)),
    lookCalls: () => (existsSync(calls) ? readFileSync(calls, 'utf8').trim().split('\n').length : 0),
    /** one tick (a look may start), the look settles, a second tick takes the queue: what two ticks 500 ms apart do */
    async step(advanceMs = 0) { clock.t += advanceMs; s.tick(); await s.settled(); s.tick(); },
    rows: (kind) => readSeen(ledger, SIG).filter((r) => !kind || r.kind === kind),
  };
}

test('the first look is the starting point: baseline rows for the tickets on the list, nothing arrives, nothing runs', async (t) => {
  const f = setup(t);
  await f.step();
  assert.deepEqual(f.rows('baseline').map((r) => r.number).sort((a, b) => a - b), [1, 2, 3, 4, 5]);
  assert.deepEqual(f.rows('arrived'), []);
  await f.step(1000);
  assert.deepEqual(f.fires, []);
});

test('a look every 15 minutes, no oftener: a tick before the time makes no call; the tick at 15 minutes looks', async (t) => {
  const f = setup(t);
  await f.step();
  const first = f.lookCalls();
  assert.equal(first, 1);
  await f.step(14 * MIN);
  assert.equal(f.lookCalls(), first, 'no look at 14 minutes');
  await f.step(MIN);
  assert.equal(f.lookCalls(), first + 1, 'a look at 15 minutes');
  assert.equal(TICKET_LOOK_MS, 15 * MIN);
});

test('new tickets get one `arrived` row each and start oldest first, one at a time; each `ran` row is written before its start; a seen ticket never runs again', async (t) => {
  const f = setup(t);
  await f.step();
  f.setList(newestFirst(7));
  await f.step(15 * MIN);
  assert.deepEqual(f.rows('arrived').map((r) => r.number), [6, 7], 'oldest arrival first');
  assert.deepEqual(f.fires.map((x) => x.number), [6], 'the first start came on the tick after the look');
  assert.deepEqual(f.rows('ran').map((r) => r.sha), ['ticket:6']);
  assert.deepEqual(queueOf(readSeen(f.ledger, SIG)).map((q) => q.number), [7]);
  await f.step(1000);
  assert.deepEqual(f.fires.map((x) => x.number), [6, 7]);
  assert.equal(f.fires[0].role, 'issues');
  assert.equal(f.fires[0].list, LIST);
  await f.step(15 * MIN);   // looks again: 6 and 7 are seen
  await f.step(1000);
  assert.deepEqual(f.fires.map((x) => x.number), [6, 7], 'a seen ticket never runs again');
  assert.equal(f.rows('arrived').length, 2);
});

test('Must fail: a busy job starts nothing; the ticket stays queued and is taken once the job is free', async (t) => {
  const f = setup(t, { busy: true });
  await f.step();
  f.setList(newestFirst(6));
  await f.step(15 * MIN);
  assert.deepEqual(f.fires, [{ busy: true, number: 6 }]);
  assert.deepEqual(f.rows('ran'), [], 'no ran row while busy');
  f.state.busy = false;
  await f.step(1000);
  assert.deepEqual(f.fires.at(-1).number, 6);
  assert.equal(f.rows('ran').length, 1);
});

test('Must fail: an unreadable list reads as "0 new"; it is an `unreadable` row with its cause, starts nothing, and a first look that failed is tried again as a first look', async (t) => {
  const f = setup(t, { env: { FAKE_REPLY: 'device' } });
  await f.step();
  const u = f.rows('unreadable');
  assert.equal(u.length, 1);
  assert.equal(u[0].why, 'GitHub token unavailable — is pass locked?');
  assert.deepEqual(f.rows('baseline'), [], 'no starting point from an unreadable list');
  await f.step(15 * MIN);
  assert.equal(f.rows('unreadable').length, 2);
  assert.deepEqual(f.fires, []);
});

test('Must fail: a later unreadable look neither arrives nor loses the seen list', async (t) => {
  const f = setup(t);
  await f.step();
  f.setList([]);
  await f.step(15 * MIN);
  assert.match(f.rows('unreadable')[0].why, /came back empty/);
  f.setList(newestFirst(6));
  await f.step(15 * MIN);
  assert.deepEqual(f.rows('arrived').map((r) => r.number), [6], 'the starting point survived the bad look');
});

test('watched state: a change arrives once with its reason and runs once; an unwatched edit arrives nothing; the same value later arrives nothing', async (t) => {
  const f = setup(t, { watch: ['state'] });
  await f.step();
  f.setList(newestFirst(5).map((i) => (i.number === 3 ? { ...i, state: 'CLOSED' } : i.number === 4 ? { ...i, title: 'edited' } : i)));
  await f.step(15 * MIN);
  const arrived = f.rows('arrived');
  assert.deepEqual(arrived.map((r) => [r.number, r.reason]), [[3, 'state open→closed']]);
  assert.deepEqual(f.fires.map((x) => [x.number, x.why]), [[3, 'state open→closed']]);
  await f.step(15 * MIN);
  await f.step(1000);
  assert.equal(f.rows('arrived').length, 1, 'the same value again is no change');
  assert.equal(f.fires.length, 1);
});

test('Must fail: with NO watched field, a ticket closing arrives nothing (the signed schedule names what to watch)', async (t) => {
  const f = setup(t);
  await f.step();
  f.setList(newestFirst(5).map((i) => (i.number === 3 ? { ...i, state: 'CLOSED' } : i)));
  await f.step(15 * MIN);
  assert.deepEqual(f.rows('arrived'), []);
  assert.deepEqual(f.fires, []);
});
