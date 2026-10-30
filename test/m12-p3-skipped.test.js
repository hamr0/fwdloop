// M12 piece 3 (item 9): a ticket the signed labels do not match, or a closed ticket, ends SKIPPED: grey, $0, the books balance, never red. An unsure label
// (off-scale) is never skipped: the run goes on to its ask. Through runFlow with a fake MCP server (no network, no model). Written red-first.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { runFlow } from '../src/runner.js';
import { computeGlyph } from '../src/panel/data.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
const LIST = 'https://github.com/flutter/flutter/issues';

function world(t, issue, filter) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-'));
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-home-'));
  const oldHome = process.env.HOME;
  t.after(() => { process.env.HOME = oldHome; rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const declaration = JSON.parse(fixture('job2.m1.declaration.json'));
  declaration.mcp = { server: 'github', tools: ['issue_read'] };
  declaration.steps[0].mcpTools = ['issue_read'];
  if (filter) declaration.ticketFilter = filter;
  const w = writeFlow({
    root, name: 'tick', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration, signedBy: 'hamr', signedAt: '2026-10-29T12:00:00Z', catalogue: cat.primitives,
  });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [path.join(HERE, 'fixtures', 'fake-mcp-issue.mjs')], env: { FAKE_MCP_SERVER: '1', FAKE_ISSUE: JSON.stringify(issue) } } } }));
  process.env.HOME = home;
  return root;
}
const start = (root, calls) => runFlow({
  root, name: 'tick', runId: 'run-1', catalogue: cat.primitives, primitives: {}, businessDate: '2026-06-01',
  sources: [{ id: 'issue', path: LIST, ticket: { number: 7 } }],
  modelStep: async () => { calls.model += 1; throw new Error('a model step ran'); }, askStep: async () => { throw new Error('ask'); }, sendStep: async () => { throw new Error('send'); },
}).catch((e) => ({ outcome: 'threw', red: e.message }));
const history = (root) => readFileSync(path.join(root, 'tick', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('a P3 ticket under "P1 or P2" ends skipped at $0: no step, no spend file, a history row that balances, grey not red', async (t) => {
  const root = world(t, { number: 7, title: 'Slow scroll', state: 'open', labels: ['P3'] }, { priority: ['P1', 'P2'] });
  const calls = { model: 0 };
  const r = await start(root, calls);
  assert.equal(r.outcome, 'skipped');
  assert.equal(r.spentUsd, 0);
  assert.equal(calls.model, 0, 'no step ran');
  const h = history(root).at(-1);
  assert.deepEqual([h.outcome, h.spentUsd, h.spendComplete, h.skipReason], ['skipped', 0, true, 'priority P3, not P1 or P2']);
  assert.match(h.signatureHash, /^[0-9a-f]{64}$/, 'a halt always writes a real signature hash');
  const runDir = path.join(root, 'tick', 'runs', 'run-1');
  assert.equal(existsSync(path.join(runDir, 'spend.jsonl')), false);
  const log = JSON.parse(readFileSync(path.join(runDir, 'log.json'), 'utf8'));
  assert.equal(log.outcome, 'skipped');
  assert.equal(log.skipReason, 'priority P3, not P1 or P2');
  const start1 = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  assert.equal(start1.inputs[0].ticket.number, 7);
  assert.equal(start1.inputs[0].ticket.title, 'Slow scroll');
  assert.deepEqual(start1.inputs[0].filter, { outcome: 'skip', reason: 'priority P3, not P1 or P2' });
  const g = computeGlyph({ historyRow: h, askJson: null, consumedAnswerExists: false, hasStateJson: false });
  assert.deepEqual(g, { glyph: '[–]', label: 'skipped — priority P3, not P1 or P2' });
});

test('a closed ticket is skipped even with no filter', async (t) => {
  const root = world(t, { number: 7, title: 'Old', state: 'closed' });
  const r = await start(root, { model: 0 });
  assert.equal(r.outcome, 'skipped');
  assert.equal(history(root).at(-1).skipReason, 'closed');
});

test('an off-scale priority label is NOT skipped: the run goes on to its steps, and the run record keeps the unsure note', async (t) => {
  const root = world(t, { number: 7, title: 'Odd', state: 'open', labels: ['priority/important-soon'] }, { priority: ['P1', 'P2'] });
  const calls = { model: 0 };
  const r = await start(root, calls);
  assert.notEqual(r.outcome, 'skipped');
  assert.ok(calls.model >= 1, 'the first model step was reached');
  const rec = JSON.parse(readFileSync(path.join(root, 'tick', 'runs', 'run-1', 'run.json'), 'utf8'));
  assert.equal(rec.inputs[0].filter.outcome, 'run');
  assert.match(rec.inputs[0].filter.unsure, /priority/);
});

test('a matching ticket is not skipped', async (t) => {
  const root = world(t, { number: 7, title: 'Crash', state: 'open', labels: ['Priority: P2'] }, { priority: ['P1', 'P2'] });
  const calls = { model: 0 };
  const r = await start(root, calls);
  assert.notEqual(r.outcome, 'skipped');
  assert.ok(calls.model >= 1);
});

test('the ended words and the learnings: a skipped run has its own sentence and is no run end for the notes', async () => {
  const { endedWords } = await import('../src/summary-words.js');
  const { NOT_A_RUN_END } = await import('../src/learnstore.js');
  const w = endedWords({ outcome: 'skipped', line: null, destination: null, canResume: false, skipReason: 'closed' });
  assert.equal(w.reason, 'Skipped: closed. Nothing was spent.');
  assert.ok(NOT_A_RUN_END.has('skipped'));
});
