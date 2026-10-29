// M12 piece 3 (item 9), through the real panel server: two REAL skipped ticket runs (runFlow + a fake MCP server, $0), a signed ticket schedule set from run-1, then the
// Result tab's JSON carries the ticket list, and "Run it anyway" refuses without a reason / queues through the seam with one. Written red-first.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import path from 'node:path';

import { createPanelServer } from '../src/panel/server.js';
import { skippedWorld } from './m12-p3-world.mjs';

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

const open = async (world, extra = {}) => {
  const h = await createPanelServer({ port: 0, root: world.root, settings: { home: path.join(world.home, 'cfg'), env: {} }, scheduler: { intervalMs: 0 }, ...extra });
  HANDLES.push(h);
  return h;
};
const post = (h, body) => fetch(`http://127.0.0.1:${h.port}/api/author/ticket-anyway`, { method: 'POST', headers: { 'content-type': 'application/json', origin: `http://127.0.0.1:${h.port}` }, body: JSON.stringify(body) });

test('the Result JSON of the run the schedule was set from carries the ticket list; another run carries none', async (t) => {
  const w = await skippedWorld(t);
  const h = await open(w);
  const a = await (await fetch(`http://127.0.0.1:${h.port}/api/runs/tick/run-1/result`)).json();
  const skip = a.tickets.groups.find((g) => g.key === 'skip').rows;
  assert.deepEqual(skip.map((r) => [r.number, r.title, r.reason, r.runId]).sort(), [[102, 'Docs typo', 'priority P3, not P1 or P2', 'run-1'], [103, 'Old one', 'closed', 'run-2']]);
  assert.equal(a.tickets.line, 'When a new ticket arrives in issues · looks every 15 min');
  const b = await (await fetch(`http://127.0.0.1:${h.port}/api/runs/tick/run-2/result`)).json();
  assert.equal(b.tickets, undefined);
});

test('Run it anyway over HTTP: no reason refuses; a reason queues through the seam exactly once; without the seam it says so', async (t) => {
  const w = await skippedWorld(t);
  const calls = [];
  const h = await open(w, { ticketQueue: { arriveAnyway: (a) => { calls.push(a); return { ok: true }; } } });
  assert.equal((await post(h, { flow: 'tick', runId: 'run-1', number: 102, reason: '  ' })).status, 400);
  assert.deepEqual(calls, []);
  const ok = await post(h, { flow: 'tick', runId: 'run-1', number: 102, reason: 'the label is wrong' });
  assert.equal(ok.status, 202);
  assert.deepEqual(calls, [{ flow: 'tick', runId: 'run-1', number: 102, reason: 'the label is wrong' }]);
  assert.equal((await post(h, { flow: 'tick', runId: 'run-1', number: 555, reason: 'x' })).status, 409);
  const h2 = await open(w);
  const un = await post(h2, { flow: 'tick', runId: 'run-1', number: 102, reason: 'x' });
  assert.equal(un.status, 501);
  assert.equal((await un.json()).refused, 'not-wired');
});
