// F119 ($0, no model, no pass): how many times does one Tickets run start its MCP server, up to the first ask?
// F119_PHASE=before (default): today's declaration shape. F119_PHASE=after: the M13 piece 4 shape (flowType tickets, no step lists the job's tools).
// Exit code 0 = the phase's bar passed. Pre-registered in docs/logs/FINDINGS.md.
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../../../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..', '..');
const phase = process.env.F119_PHASE ?? 'before';
const { loadCatalogue } = await import(path.join(REPO, 'src/catalogue.js'));
const { writeFlow } = await import(path.join(REPO, 'src/flow.js'));
const { runFlow } = await import(path.join(REPO, 'src/runner.js'));
const { makeLiveModelStep } = await import(path.join(REPO, 'src/model-step.js'));
const { runPrimitives } = await import(path.join(REPO, 'test/m12-p3-world.mjs'));
const { sandboxSend } = await import(path.join(REPO, 'test/send-sandbox.js'));
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
const tools = ['issue_read', 'list_issues'];
const step1 = { goal: 'Read the ticket and say what is broken,', primitives: ['read'], reads: ['issues'], emits: 'ticket_note', fromLine: 1, close: { class: 'hitl' } };
if (phase === 'before') step1.mcpTools = tools;
const DECL = {
  steps: [
    step1,
    { goal: 'check it with me,', primitives: [], reads: ['ticket_note'], emits: 'ask_check', fromLine: 2, close: { class: 'hitl' } },
    { goal: 'and once I accept, write it out.', primitives: ['write'], reads: ['ask_check'], emits: 'written', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'hitl', 2: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {},
  mcp: { server: 'github', tools }, ticketFilter: { priority: ['P1', 'P2'] },
  ...(phase === 'after' ? { flowType: 'tickets' } : {}),
};

const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-f119-'));
const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-f119-home-'));
const startsFile = path.join(home, 'starts.jsonl');
const callsFile = path.join(home, 'calls.jsonl');
const realHome = process.env.HOME;
let code = 1;
try {
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify({ mcpServers: { github: { command: process.execPath, args: [path.join(HERE, 'wrapper.mjs')], env: { FAKE_MCP_SERVER: '1', F119_STARTS: startsFile, F119_FAKE: path.join(REPO, 'test/fixtures/fake-mcp-server.mjs'), FAKE_CALLS: callsFile } } } }));
  process.env.HOME = home;
  const w = writeFlow({ root, name: 'tick', proseText: sandboxSend(PROSE), declaration: DECL, signedBy: 'hamr', signedAt: '2026-10-31T12:00:00Z', catalogue: cat.primitives });
  if (!w.ok) throw new Error(`writeFlow refused: ${w.reds.join(' | ')}`);
  const sources = [{ id: 'issues', path: LIST, ticket: { number: 7 } }];
  const primitives = runPrimitives(root, 'tick', 'run-1', DECL, sources);
  let n = 0;
  const reply = (toolCalls, stopReason) => ({ text: toolCalls.length ? null : '', toolCalls, usage: { inputTokens: 10, outputTokens: 5 }, stopReason, model: 'deepseek-flash' });
  const emit = reply([{ id: 'e1', name: 'emit_artifact', arguments: { text: 'ticket 7: Crash on tap', done: true, blocker: null } }], 'tool_calls');
  const script = phase === 'before'
    ? [reply([{ id: 'c1', name: 'github_issue_read', arguments: { issue_number: 7 } }], 'tool_calls'), emit, reply([], 'stop')]
    : [emit, reply([], 'stop')];
  const provider = { generate: async () => script[Math.min(n++, script.length - 1)] };
  const runDir = path.join(root, 'tick', 'runs', 'run-1');
  const modelStep = makeLiveModelStep({ spendPath: path.join(runDir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  const r = await runFlow({
    root, name: 'tick', runId: 'run-1', catalogue: cat.primitives, primitives, businessDate: '2026-06-01', sources, modelStep,
    askStep: async () => ({ decision: 'park' }), sendStep: async () => { throw new Error('send'); },
  });
  const starts = existsSync(startsFile) ? readFileSync(startsFile, 'utf8').trim().split('\n').length : 0;
  const calls = existsSync(callsFile) ? readFileSync(callsFile, 'utf8').trim().split('\n').map((l) => JSON.parse(l).name) : [];
  const count = (nm) => calls.filter((c) => c === nm).length;
  const reachedAsk = r.outcome === 'paused' || r.outcome === 'parked' || r.outcome === 'waiting' || /ask/.test(String(r.outcome));
  console.log(JSON.stringify({ phase, outcome: r.outcome, red: r.red ?? null, starts, calls, reachedAsk }));
  const bar = phase === 'before' ? starts === 2 && reachedAsk : starts === 1 && reachedAsk && count('issue_read') === 1 && count('list_issues') === 0;
  console.log(bar ? 'PASS' : 'FAIL');
  code = bar ? 0 : 1;
} catch (e) {
  console.log(`FAIL (script error): ${e?.stack ?? e}`);
} finally {
  process.env.HOME = realHome;
  rmSync(root, { recursive: true, force: true });
  rmSync(home, { recursive: true, force: true });
}
process.exit(code);
