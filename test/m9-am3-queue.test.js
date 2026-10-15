// M9 amendment 3 (docs/wiki/the-module-ladder.md, "M9 amendment 3"): files queue by arrival. The scheduler is the only writer of the file
// ledger: `arrived` when it first sees a finished file, `ran` right before that file's run starts. Queue = arrived minus ran (minus dropped),
// oldest arrival first, then by name, then by sha. No real waits: the clock is injected and tick() is called by hand; a run is ended with the
// human's Stop between ticks.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, rmSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { readOutcomes, triggerLedgerDir } from '../src/panel/authortrigger.js';
import { readSeen, STABLE_POLLS } from '../src/trigger-files.js';
import { GATED_STEP, killChildrenAfter, until } from './m4e-world.mjs';
import { existsSync, unlinkSync } from 'node:fs';
import { greenWorld, ls, setTrigger } from './m9-trigger-world.mjs';

killChildrenAfter();
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();

// M9 am8: a run waiting at its ask no longer blocks the next file, only a run still WORKING does. So these runs are held working (the gated model step,
// gate file absent) and `endRun` lets the held run reach its ask and Stops it there.
async function qWorld() {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ step: GATED_STEP, authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  const inbox = path.join(g.w.work, 'inbox'); mkdirSync(inbox);
  assert.equal((await setTrigger(g.w, { kind: 'new-file', role: 'jd', folder: inbox })).status, 200);
  const rows = () => readOutcomes(g.flowDir);
  const started = () => rows().filter((r) => r.outcome === 'started').map((r) => path.basename(r.file));
  const runs = () => ls(path.join(g.flowDir, 'runs')).filter((n) => /^run-\d+$/.test(n));
  const tick = () => g.w.h.tick();
  const polls = (n = STABLE_POLLS + 2) => { for (let i = 0; i < n; i++) tick(); };
  const ledger = () => readSeen(path.join(triggerLedgerDir(g.flowDir, g.read().signature.flow), 'seen.jsonl'));
  const drop = (n, body = `# ${n}\n`) => writeFileSync(path.join(inbox, n), body);
  /** Stop the newest run (it is parked at its ask) and wait until the job is free again. */
  const endRun = async () => {
    const id = runs().at(-1);
    writeFileSync(g.w.gate, 'go');
    await until(async () => ((await g.w.post('/api/stop', { flow: 'job2', runId: id })).status === 202 ? true : null));
    await until(async () => ((await g.w.get('/api/author/flows')).json().flows.find((x) => x.flow === 'job2').edit.ok === true ? true : null));
    if (existsSync(g.w.gate)) unlinkSync(g.w.gate);
  };
  return { ...g, clock, inbox, rows, started, runs, tick, polls, ledger, drop, endRun };
}

test('Must fail: 3 files land at once -> 3 runs, one after another, in arrival order (identical arrival times: by name)', async () => {
  const f = await qWorld();
  for (const n of ['c.md', 'a.md', 'b.md']) f.drop(n); // written in a different order than their names
  f.polls();
  assert.deepEqual(f.started(), ['a.md'], 'one at a time: the first of the queue started, the others wait');
  assert.equal(f.ledger().filter((r) => r.kind === 'arrived').length, 3);
  assert.equal(f.ledger().filter((r) => r.kind === 'ran').length, 1, 'ran is written only for the file that started');
  assert.equal(new Set(f.ledger().filter((r) => r.kind === 'arrived').map((r) => r.at)).size, 1, 'identical arrival times (the scheduler\'s clock)');
  await f.endRun(); f.polls();
  assert.deepEqual(f.started(), ['a.md', 'b.md']);
  await f.endRun(); f.polls();
  assert.deepEqual(f.started(), ['a.md', 'b.md', 'c.md']);
  await f.endRun(); f.polls(10);
  assert.deepEqual(f.started(), ['a.md', 'b.md', 'c.md'], 'nothing left in the queue, nothing runs twice');
  assert.equal(f.runs().length, 3);
});

test('arrival order beats name order when the arrival times differ', async () => {
  const f = await qWorld();
  f.drop('first.md'); f.polls();
  assert.deepEqual(f.started(), ['first.md']);
  f.clock.t = at(13, 8, 1); f.drop('z.md'); f.polls();
  f.clock.t = at(13, 8, 2); f.drop('a.md'); f.polls();
  await f.endRun(); f.polls();
  await f.endRun(); f.polls();
  assert.deepEqual(f.started(), ['first.md', 'z.md', 'a.md'], 'z arrived before a');
});

test('Must fail: busy -> exactly one busy row per queued file over many ticks, and the file stays queued', async () => {
  const f = await qWorld();
  f.drop('one.md'); f.polls();
  assert.deepEqual(f.started(), ['one.md']);
  f.drop('two.md'); f.drop('three.md');
  f.polls(40);
  const busy = f.rows().filter((r) => r.outcome === 'busy');
  assert.deepEqual(busy.map((r) => path.basename(r.file)).sort(), ['three.md', 'two.md'], JSON.stringify(busy));
  assert.equal(f.runs().length, 1);
  assert.equal(f.ledger().filter((r) => r.kind === 'ran').length, 1, 'a busy file never got a ran row');
  await f.endRun(); f.polls(); await f.endRun(); f.polls(); await f.endRun(); f.polls(6);
  assert.deepEqual(f.started(), ['one.md', 'three.md', 'two.md'].sort((a, b) => (a === 'one.md' ? -1 : b === 'one.md' ? 1 : a < b ? -1 : 1)));
  assert.equal(f.rows().filter((r) => r.outcome === 'busy').length, 2, 'no more busy rows later');
});

test('a month that cannot fund a run: one monthly-exhausted row per queued file, the file stays queued and runs when the month can', async () => {
  const f = await qWorld();
  const cfg = path.join(f.w.home, 'config.json');
  const { readFileSync } = await import('node:fs');
  const good = readFileSync(cfg, 'utf8');
  writeFileSync(cfg, JSON.stringify({ ...JSON.parse(good), monthlyLimitUsd: 0.1 }));
  f.drop('late.md'); f.polls(30);
  assert.equal(f.rows().filter((r) => r.outcome === 'monthly-exhausted').length, 1, 'one row, not one per tick');
  assert.deepEqual(f.runs(), []);
  assert.equal(f.ledger().filter((r) => r.kind === 'ran').length, 0, 'never got a ran row');
  writeFileSync(cfg, good);
  f.polls();
  assert.deepEqual(f.started(), ['late.md'], 'still queued, now it runs');
});

test('restart: a fresh scheduler re-reads the ledger and the queued file still runs, once', async () => {
  const f = await qWorld();
  f.drop('one.md'); f.polls();
  f.drop('two.md'); f.polls(6);
  assert.deepEqual(f.started(), ['one.md']);
  await f.endRun();
  await f.w.h.close();
  const h2 = await f.w.open(); // a fresh server, a fresh scheduler, the same flows folder
  for (let i = 0; i < 6; i++) h2.tick();
  assert.deepEqual(f.started(), ['one.md', 'two.md']);
  for (let i = 0; i < 6; i++) h2.tick();
  assert.equal(f.started().length, 2);
  await h2.close();
});

test('deleted before its turn -> never runs, one row says deleted, the queue moves on', async () => {
  const f = await qWorld();
  f.drop('one.md'); f.polls();
  f.drop('gone.md'); f.drop('stay.md'); f.polls();
  rmSync(path.join(f.inbox, 'gone.md'));
  await f.endRun(); f.polls(6);
  assert.deepEqual(f.started(), ['one.md', 'stay.md'], 'gone.md never ran; stay.md took its turn');
  const del = f.rows().filter((r) => r.outcome === 'deleted');
  assert.equal(del.length, 1);
  assert.match(del[0].file, /gone\.md$/);
  assert.match(del[0].say, /deleted/);
  await f.endRun(); f.polls(10);
  assert.deepEqual(f.started(), ['one.md', 'stay.md']);
  assert.equal(f.rows().filter((r) => r.outcome === 'deleted').length, 1);
});

test('changed before its turn -> the old version never runs, the new version arrives again, queues at the back and runs once', async () => {
  const f = await qWorld();
  f.drop('one.md'); f.polls();
  f.clock.t = at(13, 8, 1); f.drop('doc.md', 'version 1\n'); f.polls();
  f.clock.t = at(13, 8, 2); f.drop('other.md'); f.polls();
  f.clock.t = at(13, 8, 3); f.drop('doc.md', 'version 2 is longer\n'); // replaced while its v1 waits (before the next poll sees it)
  await f.endRun(); f.polls(8);
  assert.deepEqual(f.started().slice(0, 2), ['one.md', 'other.md'], 'v1 of doc.md is dropped; other.md was ahead of the new version');
  const changed = f.rows().filter((r) => r.outcome === 'changed');
  assert.equal(changed.length, 1);
  assert.match(changed[0].say, /changed/);
  await f.endRun(); f.polls(8);
  assert.deepEqual(f.started(), ['one.md', 'other.md', 'doc.md']);
  const sha1 = f.ledger().filter((r) => r.kind === 'ran' && r.name === 'doc.md');
  assert.equal(sha1.length, 1, 'only the new version ran');
  await f.endRun(); f.polls(10);
  assert.equal(f.started().length, 3);
});

test('file-updated: a queued version replaced before its turn is "changed"; the new version runs', async () => {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ step: GATED_STEP, authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  const watched = path.join(g.w.work, 'watched.md'); writeFileSync(watched, 'v0\n');
  assert.equal((await setTrigger(g.w, { kind: 'file-updated', role: 'resume', path: watched })).status, 200);
  const tick = () => g.w.h.tick();
  const polls = () => { for (let i = 0; i < STABLE_POLLS + 2; i++) tick(); };
  const started = () => readOutcomes(g.flowDir).filter((r) => r.outcome === 'started').length;
  writeFileSync(watched, 'v1 first\n'); polls();
  assert.equal(started(), 1);
  writeFileSync(watched, 'v2 second\n'); polls(); // queued behind the live run (busy)
  clock.t = at(13, 8, 1);
  writeFileSync(watched, 'v3 third version\n');   // replaced before its turn
  polls();
  const id = ls(path.join(g.flowDir, 'runs')).filter((n) => /^run-\d+$/.test(n)).at(-1);
  writeFileSync(g.w.gate, 'go');
  await until(async () => ((await g.w.post('/api/stop', { flow: 'job2', runId: id })).status === 202 ? true : null));
  await until(async () => ((await g.w.get('/api/author/flows')).json().flows.find((x) => x.flow === 'job2').edit.ok === true ? true : null));
  unlinkSync(g.w.gate);
  polls(); polls();
  assert.equal(started(), 2, 'v2 never ran, v3 ran once');
  const rows = readOutcomes(g.flowDir);
  assert.equal(rows.filter((r) => r.outcome === 'changed').length, 1);
  const seen = readSeen(path.join(triggerLedgerDir(g.flowDir, g.read().signature.flow), 'seen.jsonl'));
  assert.equal(seen.filter((r) => r.kind === 'ran').length, 2);
});

test('queueOf: identical arrival times and names still order deterministically (by sha), whatever order the rows were written', async () => {
  const { queueOf } = await import('../src/trigger-files.js');
  const row = (sha, name, atMs) => ({ id: `arrived:${sha}`, kind: 'arrived', sha, name, size: 1, path: `/x/${name}`, at: atMs });
  const rows = [row('b2', 'f.md', 5), row('a1', 'f.md', 5), row('c3', 'a.md', 5), row('d4', 'z.md', 4), { id: 'ran:c3', kind: 'ran', sha: 'c3', name: 'a.md', size: 1, at: 6 }];
  assert.deepEqual(queueOf(rows).map((r) => r.sha), ['d4', 'a1', 'b2']);
  assert.deepEqual(queueOf([...rows].reverse()).map((r) => r.sha), ['d4', 'a1', 'b2']);
});
