// M12 piece 3 (item 9), through the real panel server: two REAL skipped ticket runs (runFlow + a fake MCP server, $0), a signed ticket schedule set from run-1, then the
// Result tab's JSON carries the ticket list, and "Run it anyway" refuses without a reason / queues through the seam with one. Written red-first.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { runFlow } from '../src/runner.js';
import { writeSchedule, sigOf } from '../src/schedule.js';
import { triggerHash } from '../src/trigger-line.js';
import { createPanelServer } from '../src/panel/server.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const cat = loadCatalogue();
const LIST = 'https://github.com/flutter/flutter/issues';
const PROSE = `1. Read the ticket and say what is broken,
   guardrail: priority P1 or P2 only
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source issues = page:${LIST}
`;
const DECL = {
  steps: [
    { goal: 'Read the ticket and say what is broken,', primitives: ['read'], reads: ['issues'], emits: 'ticket_note', fromLine: 1, close: { class: 'hitl' }, mcpTools: ['issue_read'] },
    { goal: 'check it with me,', primitives: [], reads: ['ticket_note'], emits: 'ask_check', fromLine: 2, close: { class: 'hitl' } },
    { goal: 'and once I accept, write it out.', primitives: ['write'], reads: ['ask_check'], emits: 'written', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'hitl', 2: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {},
  mcp: { server: 'github', tools: ['issue_read'] }, ticketFilter: { priority: ['P1', 'P2'] },
};
const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

async function skippedWorld(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-api-'));
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m12p3-api-home-'));
  const oldHome = process.env.HOME;
  t.after(() => { process.env.HOME = oldHome; rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  const w = writeFlow({ root, name: 'tick', proseText: sandboxSend(PROSE), declaration: DECL, signedBy: 'hamr', signedAt: '2026-10-29T12:00:00Z', catalogue: cat.primitives });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  process.env.HOME = home;
  for (const [i, issue] of [[1, { number: 102, title: 'Docs typo', state: 'open', labels: ['P3'] }], [2, { number: 103, title: 'Old one', state: 'closed' }]]) {
    writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [path.join(HERE, 'fixtures', 'fake-mcp-issue.mjs')], env: { FAKE_MCP_SERVER: '1', FAKE_ISSUE: JSON.stringify(issue) } } } }));
    const r = await runFlow({
      root, name: 'tick', runId: `run-${i}`, catalogue: cat.primitives, primitives: {}, businessDate: '2026-06-01', sources: [{ id: 'issues', path: LIST, ticket: { number: issue.number } }],
      modelStep: async () => { throw new Error('model'); }, askStep: async () => { throw new Error('ask'); }, sendStep: async () => { throw new Error('send'); },
    });
    assert.equal(r.outcome, 'skipped');
  }
  const flowDir = path.join(root, 'tick');
  const sigFile = JSON.parse(readFileSync(path.join(flowDir, 'signature.json'), 'utf8'));
  const base = { flow: 'tick', flowSignatureHash: sigFile.flow, trigger: { kind: 'new-ticket', role: 'issues', list: LIST, server: 'github', tool: 'list_issues' }, model: null, destination: null, inputs: null, plan: null };
  const bound = triggerHash(base);
  writeSchedule(flowDir, { v: 1, ...base, bound, sig: sigOf(bound, '2026-10-29T13:00:00Z'), signedBy: 'hamr', signedAt: '2026-10-29T13:00:00Z', from: 'run-1' });
  return { root, home };
}
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
