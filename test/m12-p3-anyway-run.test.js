// M12 piece 3, hamr's ruling 2026-10-30: a ticket sent with "Run it anyway" skips the skip decision (the label filter AND closed). The mark is a typed field,
// `anyway: true`, carried ledger row -> scheduler cause -> run source (`--anyway`) -> run.json `filter`; never read from the reason text. A normal arrival and a
// watched-change arrival (which also carries a `reason`) are filtered exactly as before. $0: a fake MCP server, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { runFlow } from '../src/runner.js';
import { loadCatalogue } from '../src/catalogue.js';
import { createScheduler } from '../src/panel/scheduler.js';
import { arriveAnywayOf } from '../src/panel/tickets.js';
import { ledgerOf } from '../src/schedule.js';
import { readSeen, appendSeen } from '../src/trigger-files.js';
import { readHistory, readAudit } from '../src/books.js';
import { skippedWorld } from './m12-p3-world.mjs';
import { LIST, ticketJob } from './m12-p2-world.mjs';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { seedGreen } from './m9-trigger-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const cat = loadCatalogue();
const FAKE = path.join(HERE, 'fixtures', 'fake-mcp-server.mjs');
const ARGV_ECHO = path.join(HERE, 'fixtures', 'm4d-argv-echo', 'fwdloop');

// ---- the run: the skip decision is skipped for an anyway source -------------------------------------------------------------------------------------------------
async function runTicket(w, runId, issue, ticket, paid = false) {
  writeFileSync(path.join(w.home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [path.join(HERE, 'fixtures', 'fake-mcp-issue.mjs')], env: { FAKE_MCP_SERVER: '1', FAKE_ISSUE: JSON.stringify(issue) } } } }));
  const calls = { model: 0 };
  const r = await runFlow({
    root: w.root, name: 'tick', runId, catalogue: cat.primitives, primitives: {}, businessDate: '2026-06-01', sources: [{ id: 'issues', path: LIST, ticket }],
    modelStep: async () => { calls.model += 1; if (paid) return { ok: true, costUsd: 0.001, artifact: { text: 'x', done: false, blocker: 'stopped for the test' } }; throw new Error('a model step ran'); }, askStep: async () => { throw new Error('ask'); }, sendStep: async () => { throw new Error('send'); },
  }).catch((e) => ({ outcome: 'threw', red: e.message }));
  const rec = JSON.parse(readFileSync(path.join(w.root, 'tick', 'runs', runId, 'run.json'), 'utf8'));
  return { r, calls, filter: rec.inputs[0].filter };
}
const P3 = { number: 8, title: 'Docs typo', state: 'open', labels: ['P3'] };
const CLOSED = { number: 9, title: 'Old one', state: 'closed' };

test('an anyway arrival of a P3 ticket on a P1-or-P2 job runs: not skipped, it reaches its step, and the record says why', async (t) => {
  const w = await skippedWorld(t);
  const { r, calls, filter } = await runTicket(w, 'run-3', P3, { number: 8, anyway: true });
  assert.notEqual(r.outcome, 'skipped');
  assert.ok(calls.model >= 1, 'the first step was reached');
  assert.equal(filter.outcome, 'anyway');
  assert.equal(filter.was.outcome, 'skip');
  assert.equal(filter.was.reason, 'priority P3, not P1 or P2');
});

test('an anyway arrival of a closed ticket runs', async (t) => {
  const w = await skippedWorld(t);
  const { r, calls, filter } = await runTicket(w, 'run-3', CLOSED, { number: 9, anyway: true });
  assert.notEqual(r.outcome, 'skipped');
  assert.ok(calls.model >= 1);
  assert.deepEqual([filter.outcome, filter.was.reason], ['anyway', 'closed']);
});

test('a normal new P3 arrival is still skipped (no anyway mark)', async (t) => {
  const w = await skippedWorld(t);
  const { r, calls, filter } = await runTicket(w, 'run-3', P3, { number: 8 });
  assert.equal(r.outcome, 'skipped');
  assert.equal(calls.model, 0);
  assert.deepEqual(filter, { outcome: 'skip', reason: 'priority P3, not P1 or P2' });
});

test('the books balance on an anyway run: the history row\'s spend is the sum of the audit rows', async (t) => {
  const w = await skippedWorld(t);
  const { r } = await runTicket(w, 'run-3', P3, { number: 8, anyway: true }, true);
  assert.notEqual(r.outcome, 'skipped');
  const flowDir = path.join(w.root, 'tick');
  const h = readHistory(flowDir).find((x) => x.runId === 'run-3');
  const sum = readAudit(path.join(flowDir, 'runs', 'run-3')).reduce((s, x) => s + (x.usd ?? 0), 0);
  assert.ok(h.spentUsd > 0, 'the run spent something, so the sum is not 0 = 0');
  assert.equal(h.spentUsd, sum);
  assert.match(h.signatureHash, /^[0-9a-f]{64}$/);
});

// ---- the scheduler: the mark rides the typed ledger field, never the reason text --------------------------------------------------------------------------------
function sched(t) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-anyrun-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const listFile = path.join(dir, 'list.json');
  const config = path.join(dir, 'mcp.json');
  writeFileSync(listFile, JSON.stringify([3, 2, 1].map((number) => ({ number, state: 'OPEN', labels: [] }))));
  writeFileSync(config, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile } } } }));
  const trigger = { kind: 'new-ticket', role: 'issues', list: LIST, server: 'github', tool: 'list_issues' };
  const job = { flow: 'tk', flowDir: dir, sig: 'sig-1', trigger, schedule: { sig: 'sig-1' } };
  const clock = { t: 1_000_000 };
  const fires = [];
  const door = { scan: () => [job], retireStale() {}, busy: () => false, note() {}, refuse() {}, fire(j, cause, hooks = {}) { hooks.beforeStart?.(); fires.push(cause); } };
  const s = createScheduler({ door, now: () => clock.t, intervalMs: 0, mcpConfig: config });
  return { s, clock, fires, dir, queue: arriveAnywayOf({ scan: door.scan, now: () => clock.t }), async step(ms = 0) { clock.t += ms; s.tick(); await s.settled(); s.tick(); } };
}

test('the scheduler fires an anyway arrival with `anyway: true`, and a watched-change arrival (it also has a reason) without it', async (t) => {
  const f = sched(t);
  await f.step();
  assert.equal(f.queue.arriveAnyway({ flow: 'tk', runId: 'run-1', number: 2, reason: 'it is valid' }).ok, true);
  await f.step(1000);
  assert.equal(f.fires.length, 1);
  assert.deepEqual([f.fires[0].number, f.fires[0].why, f.fires[0].anyway], [2, 'it is valid', true]);
  // a watched change: the very row shape the look writes (an arrived row with a reason, no anyway field)
  appendSeen(ledgerOf(f.dir), { id: 'arrived:ticket:3:1', kind: 'arrived', sha: 'ticket:3:1', name: '#3', path: '#3', size: 0, at: f.clock.t, number: 3, reason: 'labels changed' }, 'sig-1');
  await f.step(1000);
  assert.equal(f.fires.length, 2);
  assert.deepEqual([f.fires[1].number, f.fires[1].why, f.fires[1].anyway], [3, 'labels changed', undefined]);
  assert.equal(readSeen(ledgerOf(f.dir), 'sig-1').filter((r) => r.kind === 'arrived' && r.anyway === true).length, 1);
});

// ---- the panel's own start: `--anyway` follows the ticket in the spawned run's argv only for an anyway arrival ----------------------------------------------------
test('the panel starts an anyway ticket with `--anyway`, and a watched-change ticket without it', async (t) => {
  const clock = { t: new Date(2026, 9, 13, 8).getTime() };
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-anyrun-door-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const listFile = path.join(dir, 'list.json');
  writeFileSync(listFile, JSON.stringify(Array.from({ length: 5 }, (_, i) => ({ number: 5 - i, state: 'OPEN', labels: [] }))));
  const mcpConfig = path.join(dir, 'mcp.json');
  writeFileSync(mcpConfig, JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [FAKE], env: { FAKE_MCP_SERVER: '1', FAKE_LIST: listFile } } } }));
  const w = await world({ limit: 5, bin: ARGV_ECHO, authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0, mcpConfig } });
  w.env.ARGV_FILE = path.join(w.work, 'argv.jsonl');
  ticketJob(w.root, 'tk');
  seedGreen(w, 'tk');
  const flowDir = path.join(w.root, 'tk');
  const argv = () => { try { return readFileSync(w.env.ARGV_FILE, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
  const trigger = { kind: 'new-ticket', role: 'jd' };
  const p = await w.post('/api/author/trigger-prepare', { flow: 'tk', trigger });
  assert.equal((await w.post('/api/author/trigger', { flow: 'tk', trigger, hash: p.json().hash })).status, 200);
  w.h.tick();
  await until(() => readSeen(ledgerOf(flowDir)).filter((r) => r.kind === 'baseline').length === 5);
  const sc = JSON.parse(readFileSync(path.join(flowDir, 'schedule.json'), 'utf8'));
  const { recordAnyway } = await import('../src/trigger-tickets.js');
  assert.equal(recordAnyway(ledgerOf(flowDir), sc.sig, { number: 4, reason: 'it is valid' }, clock.t).ok, true);
  await until(() => { w.h.tick(); return argv().length > 0; });
  const a = argv()[0];
  assert.equal(a[a.indexOf('--ticket') + 1], '4');
  assert.ok(a.includes('--anyway'), JSON.stringify(a));
  // a watched-change row: same shape, reason, no anyway field
  appendSeen(ledgerOf(flowDir), { id: 'arrived:ticket:3:1', kind: 'arrived', sha: 'ticket:3:1', name: '#3', path: '#3', size: 0, at: clock.t, number: 3, reason: 'labels changed' }, sc.sig);
  await until(() => { w.h.tick(); return argv().length > 1; });
  const b = argv()[1];
  assert.equal(b[b.indexOf('--ticket') + 1], '3');
  assert.equal(b.includes('--anyway'), false, JSON.stringify(b));
});
