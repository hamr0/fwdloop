// M13 am3: `Run it anyway` on a skipped ticket while the ticket schedule is OFF starts that ticket's run at once, by hand (kind `run`, `anyway: true`), instead of queuing it;
// armed, it queues as before (M12). A skipped run never arms; a green one does. Every refusal starts nothing. Real trigger door + scheduler on the fake MCP server, stub starter, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync } from 'node:fs';

import { arriveAnywayOf, ticketAnyway } from '../src/panel/tickets.js';
import { loadCatalogue } from '../src/catalogue.js';
import { getJobGrid } from '../src/panel/data.js';
import { p5World } from './m13-p5-world.mjs';
import { skippedWorld } from './m12-p3-world.mjs';

const mk = (t, o) => { const w = p5World(o); t.after(() => rmSync(w.dir, { recursive: true, force: true })); w.sign(); return w; };
const queueOf = (w) => arriveAnywayOf({ scan: () => w.door.scan(), now: () => w.clock.t, startAnyway: (a) => w.door.startAnyway(a) });
const ask = (w, number = 4) => queueOf(w).arriveAnyway({ flow: 'tk', runId: 'run-1', number, reason: 'the label is wrong' });
const listOf = () => ({ groups: [{ key: 'skip', rows: [{ number: 4 }] }] });

test('unarmed: Run it anyway starts the named ticket at once, by hand, with anyway:true; no arrived row; the route says so in one plain line', async (t) => {
  const w = mk(t);
  assert.equal(w.door.read('tk').armed, false);
  const r = ticketAnyway({ body: { flow: 'tk', runId: 'run-1', number: 4, reason: 'the label is wrong' }, listOf, queue: queueOf(w) });
  assert.equal(r.status, 202);
  assert.deepEqual([r.body.ok, r.body.started, r.body.queued], [true, true, undefined]);
  assert.equal(r.body.say, 'Ticket #4 started now; the schedule is still off until a green run.');
  assert.equal(w.reqs.length, 1);
  const req = w.reqs[0];
  assert.equal(req.kind, 'run', 'by hand, not a trigger fire');
  assert.equal(req.flow, 'tk');
  assert.deepEqual(req.sources.filter((s) => s.ticket !== undefined).map((s) => [s.role, s.ticket, s.anyway]), [['jd', 4, true]]);
  assert.deepEqual(w.seen('arrived'), [], 'not queued');
  await w.ticks(3);
  assert.deepEqual(w.seen('arrived'), []);
  assert.equal(w.armed().length, 0, 'the start itself arms nothing');
});

test('armed: unchanged, it queues exactly one arrived row and starts nothing by hand', async (t) => {
  const w = mk(t);
  w.run('r-green', { ticket: 5, rows: [['complete', w.clock.t]] });
  await w.tick();
  assert.equal(w.armed().length, 1);
  const before = w.reqs.length;
  const r = ask(w);
  assert.equal(r.ok, true);
  assert.notEqual(r.started, true);
  assert.deepEqual(w.seen('arrived').map((x) => [x.number, x.reason]), [[4, 'the label is wrong']]);
  assert.equal(w.reqs.length, before, 'no by-hand start');
});

test('no schedule at all: the old refusal, nothing written or started', (t) => {
  const w = p5World();   // never signed: no schedule.json
  t.after(() => rmSync(w.dir, { recursive: true, force: true }));
  const r = ask(w);
  assert.equal(r.ok, false);
  assert.match(r.say, /no live ticket schedule/);
  assert.equal(w.reqs.length, 0);
});

test('a skipped run leaves the schedule off; a green one arms it (the existing path)', async (t) => {
  const w = mk(t);
  assert.equal(ask(w).ok, true);
  w.run('r-skip', { ticket: 4, rows: [['skipped', w.clock.t]] });
  await w.ticks(3);
  assert.equal(w.armed().length, 0, 'a skipped run never turns it on');
  assert.equal(w.door.read('tk').waiting, true);
  w.run('r-ok', { ticket: 4, rows: [['complete', w.clock.t]] });
  await w.tick();
  assert.equal(w.armed().length, 1);
  assert.equal(w.armed()[0].ticketN, 4);
});

const refusals = [
  ['the monthly limit has no room', { monthlyClaim: () => ({ ok: false, room: { leftUsd: 0, needUsd: 0.25, atLeast: false } }) }, /month/i],
  ['the monthly check has a problem', { monthlyClaim: () => ({ problem: 'The monthly limit is unreadable' }) }, /unreadable/],
  ['a run is busy', { scheduleBusy: () => 'A run of this job is working.' }, /working.*Nothing started/],
  ['the key is empty / missing', { loadEnv: () => ({ ok: false, refusal: 'The key is empty.' }) }, /key is empty/],
  ['the model is not ticked', { modelRefusal: () => [{ field: 'model', say: 'That model is not ticked. Nothing was spent.' }] }, /not ticked.*Nothing started/],
];
for (const [name, over, re] of refusals) {
  test(`refusal, ${name}: nothing starts, $0, nothing queued`, async (t) => {
    const w = mk(t, { over });
    const r = ticketAnyway({ body: { flow: 'tk', runId: 'run-1', number: 4, reason: 'why' }, listOf, queue: queueOf(w) });
    assert.equal(r.status, 409);
    assert.equal(r.body.ok, false);
    assert.match(r.body.say, re);
    assert.equal(w.reqs.length, 0);
    assert.deepEqual(w.seen('arrived'), []);
  });
}

test('the Result grid offers Run it anyway for a skipped ticket while the schedule is unarmed (no armed row in the world)', async (t) => {
  const w = await skippedWorld(t);
  const g = getJobGrid({ root: w.root, flow: 'tick', catalogue: loadCatalogue().primitives });
  assert.equal(g.anywayRunId, 'run-1');
  const skipped = Object.values(g).flatMap((v) => (Array.isArray(v) ? v : [])).flatMap((x) => (Array.isArray(x?.rows) ? x.rows : [x])).filter((r) => r && r.anyway === true);
  assert.ok(skipped.length >= 1, 'a skipped row carries anyway:true');
});
