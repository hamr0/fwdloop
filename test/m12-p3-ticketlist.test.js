// M12 piece 3 (item 9, mockup E): the ticket list data - groups, newest first, one row per ticket number, reasons, and "Run it anyway" refusals.
// Real files in a scratch flow dir (a real signed schedule.json, real run.json records, a real ledger); the run glyphs are injected. Written red-first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync, utimesSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeSchedule, sigOf, ledgerOf } from '../src/schedule.js';
import { triggerHash } from '../src/trigger-line.js';
import { writeRunStart } from '../src/runfile.js';
import { appendSeen } from '../src/trigger-files.js';
import { ticketListOf, ticketAnyway, TICKET_GROUPS } from '../src/panel/tickets.js';

function world(t, { from = 'run-1', kind = 'new-ticket' } = {}) {
  const flowDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-list-'));
  t.after(() => rmSync(flowDir, { recursive: true, force: true }));
  const trigger = kind === 'new-ticket' ? { kind, role: 'issues', list: 'https://github.com/flutter/flutter/issues', server: 'github', tool: 'list_issues' } : { kind: 'daily', hour: 9, minute: 0 };
  const base = { flow: 'tick', flowSignatureHash: 'f'.repeat(64), trigger, model: null, destination: null, inputs: null, plan: null };
  const bound = triggerHash(base);
  const signedAt = '2026-10-29T12:00:00Z';
  const sig = sigOf(bound, signedAt);
  writeSchedule(flowDir, { v: 1, ...base, bound, sig, signedBy: 'hamr', signedAt, from });
  return { flowDir, sig };
}
const addRun = (flowDir, id, number, title, secs) => {
  const dir = path.join(flowDir, 'runs', id);
  mkdirSync(dir, { recursive: true });
  writeRunStart(dir, { model: null, thinking: false, inputs: [{ id: 'issues', source: 'x', frozen: 'y', sha256: 'z', bytes: 1, ticket: { number, title } }] });
  utimesSync(dir, secs, secs);
};
const GL = { 'run-1': ['[✓]', 'passed'], 'run-2': ['[–]', 'skipped — no P1 or P2 label'], 'run-3': ['[·]', 'waiting for you'], 'run-4': ['[✗]', 'failed (red)'], 'run-5': ['[✓]', 'passed'], 'run-6': ['[–]', 'skipped — closed'] };
const glyphOf = (id) => (GL[id] ? { glyph: GL[id][0], label: GL[id][1] } : null);
const idsOf = (flowDir) => ['run-1', 'run-2', 'run-3', 'run-4', 'run-5', 'run-6'].filter((id) => { try { return require_ok(flowDir, id); } catch { return false; } });
import { existsSync } from 'node:fs';
const require_ok = (flowDir, id) => existsSync(path.join(flowDir, 'runs', id));
const list = (w, runId = 'run-1') => ticketListOf({ flowDir: w.flowDir, runId, runIdsOf: idsOf, glyphOf });

test('the group names and order are the mockup\'s', () => {
  assert.deepEqual(TICKET_GROUPS.map((g) => [g.key, g.label, g.open]), [['wait', 'Needs you', true], ['stop', 'Stopped', true], ['done', 'Passed', false], ['skip', 'Skipped', false]]);
});

test('only the run the ticket schedule was set from shows the list; another run, or a clock schedule, shows none', (t) => {
  const w = world(t);
  addRun(w.flowDir, 'run-1', 10, 'a', 1000);
  assert.ok(list(w, 'run-1'));
  assert.equal(list(w, 'run-2'), null);
  const c = world(t, { kind: 'daily' });
  addRun(c.flowDir, 'run-1', 10, 'a', 1000);
  assert.equal(list(c, 'run-1'), null);
});

test('rows fall into groups by the run\'s sign, newest first inside each group, with the skip reason', (t) => {
  const w = world(t);
  addRun(w.flowDir, 'run-1', 101, 'Passed old', 1000);
  addRun(w.flowDir, 'run-2', 102, 'Odd docs', 2000);
  addRun(w.flowDir, 'run-3', 103, 'Waiting', 3000);
  addRun(w.flowDir, 'run-4', 104, 'Broke', 4000);
  addRun(w.flowDir, 'run-5', 105, 'Passed new', 5000);
  addRun(w.flowDir, 'run-6', 106, 'Closed one', 6000);
  const l = list(w);
  assert.equal(l.line, 'When a new ticket arrives in issues · looks every 15 min');
  const by = Object.fromEntries(l.groups.map((g) => [g.key, g.rows.map((r) => r.number)]));
  assert.deepEqual(by, { wait: [103], stop: [104], done: [105, 101], skip: [106, 102] });
  const skip = l.groups.find((g) => g.key === 'skip').rows;
  assert.deepEqual(skip.map((r) => r.reason), ['closed', 'no P1 or P2 label']);
  assert.equal(skip[0].title, 'Closed one');
});

test('one row per ticket number: the newest run decides (a skipped ticket run anyway moves out of Skipped)', (t) => {
  const w = world(t);
  addRun(w.flowDir, 'run-2', 7, 'Same ticket', 1000);   // skipped
  addRun(w.flowDir, 'run-5', 7, 'Same ticket', 2000);   // passed, later
  const l = list(w);
  assert.deepEqual(l.groups.find((g) => g.key === 'skip').rows, []);
  assert.deepEqual(l.groups.find((g) => g.key === 'done').rows.map((r) => [r.number, r.runId]), [[7, 'run-5']]);
});

test('a ticket that arrived again by a watched change carries the ledger\'s reason', (t) => {
  const w = world(t);
  addRun(w.flowDir, 'run-1', 9, 'T', 1000);
  appendSeen(ledgerOf(w.flowDir), { id: 'arrived:ticket:9', kind: 'arrived', sha: 'ticket:9', name: '#9', size: 0, at: 5, number: 9 }, w.sig);
  appendSeen(ledgerOf(w.flowDir), { id: 'arrived:ticket:9:1', kind: 'arrived', sha: 'ticket:9:1', name: '#9', size: 0, at: 9, number: 9, reason: 'status changed: open → closed' }, w.sig);
  const row = list(w).groups.find((g) => g.key === 'done').rows[0];
  assert.equal(row.changed, 'status changed: open → closed');
  assert.equal(row.at, 9);
});

test('a run with no ticket in its record is not a row', (t) => {
  const w = world(t);
  const dir = path.join(w.flowDir, 'runs', 'run-1');
  mkdirSync(dir, { recursive: true });
  writeRunStart(dir, { model: null, thinking: false, inputs: [{ id: 'issues', source: 'x', frozen: 'y', sha256: 'z', bytes: 1 }] });
  assert.equal(list(w).groups.every((g) => g.rows.length === 0), true);
});

// ---- Run it anyway ----
const listOf = (w) => () => list(w);
test('Run it anyway: no reason, a blank reason, or a reason of spaces starts nothing and never reaches the queue', (t) => {
  const w = world(t);
  addRun(w.flowDir, 'run-2', 102, 'Odd', 2000);
  const calls = [];
  const queue = { arriveAnyway: (a) => { calls.push(a); return { ok: true }; } };
  for (const reason of [undefined, '', '   ', null]) {
    const r = ticketAnyway({ body: { flow: 'tick', runId: 'run-1', number: 102, reason }, listOf: listOf(w), queue });
    assert.equal(r.status, 400);
    assert.equal(r.body.refused, 'reason-required');
  }
  assert.deepEqual(calls, []);
});

test('Run it anyway: with a reason a skipped ticket is queued once through the seam; the reason is passed on', (t) => {
  const w = world(t);
  addRun(w.flowDir, 'run-2', 102, 'Odd', 2000);
  const calls = [];
  const r = ticketAnyway({ body: { flow: 'tick', runId: 'run-1', number: 102, reason: ' the label is wrong ' }, listOf: listOf(w), queue: { arriveAnyway: (a) => { calls.push(a); return { ok: true }; } } });
  assert.equal(r.status, 202);
  assert.deepEqual(calls, [{ flow: 'tick', runId: 'run-1', number: 102, reason: 'the label is wrong' }]);
});

test('Run it anyway: a ticket that is not skipped refuses with nothing queued', (t) => {
  const w = world(t);
  addRun(w.flowDir, 'run-1', 101, 'Passed', 1000);
  addRun(w.flowDir, 'run-2', 102, 'Odd', 2000);
  const calls = [];
  const queue = { arriveAnyway: (a) => { calls.push(a); return { ok: true }; } };
  assert.equal(ticketAnyway({ body: { flow: 'tick', runId: 'run-1', number: 101, reason: 'x' }, listOf: listOf(w), queue }).status, 409);
  assert.equal(ticketAnyway({ body: { flow: 'tick', runId: 'run-1', number: 999, reason: 'x' }, listOf: listOf(w), queue }).status, 409);
  assert.deepEqual(calls, []);
});
