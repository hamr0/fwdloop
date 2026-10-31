// M12 piece 3 test world: two REAL skipped ticket runs (runFlow + a fake MCP server, $0) of a signed ticket job and a signed ticket schedule set from run-1.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { runFlow } from '../src/runner.js';
import { resolvePrimitives, stepMcp } from '../src/primitives.js';
import { writeSchedule, sigOf } from '../src/schedule.js';
import { triggerHash } from '../src/trigger-line.js';
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
export const DECL = {
  steps: [
    { goal: 'Read the ticket and say what is broken,', primitives: ['read'], reads: ['issues'], emits: 'ticket_note', fromLine: 1, close: { class: 'hitl' }, mcpTools: ['issue_read'] },
    { goal: 'check it with me,', primitives: [], reads: ['ticket_note'], emits: 'ask_check', fromLine: 2, close: { class: 'hitl' } },
    { goal: 'and once I accept, write it out.', primitives: ['write'], reads: ['ask_check'], emits: 'written', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'hitl', 2: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {},
  mcp: { server: 'github', tools: ['issue_read'] }, ticketFilter: { priority: ['P1', 'P2'] },
};
/** The run's primitives built the way bin/fwdloop builds them: the real resolvePrimitives with the job's signed MCP tools (stepMcp), frozen-input paths predicted as the CLI does. */
export function runPrimitives(root, name, runId, declaration, sources) {
  const runDir = path.join(root, name, 'runs', runId);
  const inputs = sources.map((s) => ({ id: s.id, frozen: path.join(runDir, 'inputs', `${s.id}${path.extname(s.path)}`) }));
  const allVerbs = [...new Set(declaration.steps.flatMap((s) => s.primitives ?? []))];
  const { tools, reds } = resolvePrimitives(cat.primitives, allVerbs, { runDir, inputs, mcp: stepMcp(declaration) });
  assert.deepEqual(reds, []);
  return tools;
}
export async function skippedWorld(t) {
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
