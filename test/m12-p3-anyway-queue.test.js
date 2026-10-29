// M12 piece 3 (item 9): "Run it anyway" wired for real. ONE `arrived` row (with the reason) in the schedule ledger through the ledger's writer, then the scheduler's
// queue starts the ticket once, as a new arrival. No reason = no row, nothing starts. Real scheduler + real look against the fake MCP server; a stub door records the start.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createScheduler } from '../src/panel/scheduler.js';
import { createPanelServer } from '../src/panel/server.js';
import { ticketAnyway, arriveAnywayOf } from '../src/panel/tickets.js';
import { ledgerOf } from '../src/schedule.js';
import { readSeen } from '../src/trigger-files.js';
import { skippedWorld } from './m12-p3-world.mjs';

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'fake-mcp-server.mjs');
const SIG = 'sig-1';
const LIST = 'https://github.com/flutter/flutter/issues';
const MIN = 60_000;

function setup(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-anyway-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const listFile = path.join(dir, 'list.json');
  const config = path.join(dir, 'mcp.json');
  writeFileSync(listFile, JSON.stringify([3, 2, 1].map((number) => ({ number, state: 'OPEN', labels: [] }))));
  writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile } } } }));
  const trigger = { kind: 'new-ticket', role: 'issues', list: LIST, server: 'github', tool: 'list_issues' };
  const job = { flow: 'tk', flowDir: dir, sig: SIG, trigger, schedule: { sig: SIG } };
  const clock = { t: 1_000_000 };
  const fires = [];
  const door = {
    scan: () => [job], retireStale() {}, busy: () => false, note() {}, refuse() {},
    fire(j, cause, hooks = {}) { hooks.beforeStart?.(); fires.push({ number: cause.number, why: cause.why }); },
  };
  const s = createScheduler({ door, now: () => clock.t, intervalMs: 0, mcpConfig: config });
  const queue = arriveAnywayOf({ scan: door.scan, now: () => clock.t });
  const ledger = ledgerOf(dir);
  return {
    s, clock, fires, queue, ledger, rows: (kind) => readSeen(ledger, SIG).filter((r) => r.kind === kind),
    async step(ms = 0) { clock.t += ms; s.tick(); await s.settled(); s.tick(); },
  };
}

test('with a reason: exactly one arrived row carrying it, and the ticket runs once through the queue; a second click while queued adds nothing', async (t) => {
  const f = setup(t);
  await f.step();   // first look: tickets 1-3 are the starting point, nothing runs
  assert.deepEqual(f.fires, []);
  const r = f.queue.arriveAnyway({ flow: 'tk', runId: 'run-1', number: 2, reason: 'the label is wrong' });
  assert.equal(r.ok, true);
  assert.deepEqual(f.rows('arrived').map((x) => [x.number, x.reason]), [[2, 'the label is wrong']]);
  assert.equal(f.queue.arriveAnyway({ flow: 'tk', runId: 'run-1', number: 2, reason: 'again' }).ok, false, 'still queued: not a second run');
  assert.equal(f.rows('arrived').length, 1);
  await f.step(1000);
  await f.step(1000);
  assert.deepEqual(f.fires, [{ number: 2, why: 'the label is wrong' }], 'started once, with the reason');
  assert.equal(f.rows('ran').length, 1);
  await f.step(15 * MIN);
  assert.equal(f.fires.length, 1, 'a later look does not run it again');
});

test('no reason: no row, nothing starts (the route refuses before the queue is reached)', async (t) => {
  const f = setup(t);
  await f.step();
  const listOf = () => ({ groups: [{ key: 'skip', rows: [{ number: 2 }] }] });
  for (const reason of ['', '   ', undefined]) {
    const r = ticketAnyway({ body: { flow: 'tk', runId: 'run-1', number: 2, reason }, listOf, queue: f.queue });
    assert.equal(r.status, 400);
  }
  await f.step(1000);
  assert.deepEqual(f.rows('arrived'), []);
  assert.deepEqual(f.fires, []);
});

test('a job with no live ticket schedule is refused by name; nothing is written', (t) => {
  const f = setup(t);
  const none = arriveAnywayOf({ scan: () => [], now: () => 1 });
  const r = none.arriveAnyway({ flow: 'tk', runId: 'run-1', number: 2, reason: 'x' });
  assert.equal(r.ok, false);
  assert.match(r.say, /"tk" has no live ticket schedule/);
  assert.equal(existsSync(f.ledger), false);
});

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));
test('the production panel passes a real queue: a skipped ticket on a job whose schedule is not armed is refused by name, not "not connected"', async (t) => {
  const w = await skippedWorld(t);
  const h = await createPanelServer({ port: 0, root: w.root, settings: { home: path.join(w.home, 'cfg'), env: {} }, scheduler: { intervalMs: 0 } });
  HANDLES.push(h);
  const res = await fetch(`http://127.0.0.1:${h.port}/api/author/ticket-anyway`, {
    method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${h.port}` }, body: JSON.stringify({ flow: 'tick', runId: 'run-1', number: 102, reason: 'the label is wrong' }),
  });
  const b = await res.json();
  assert.equal(res.status, 409);
  assert.equal(b.refused, 'queue');
  assert.match(b.say, /no live ticket schedule/);
});
