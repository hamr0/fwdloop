// M13 piece 2 (docs/wiki/the-module-ladder.md, "M13 scope" items 3 and 5): a model step with `mcpTools` really gets those tools at run time, behind the step's
// bareguard Gate, and nothing else. REAL: runFlow, resolvePrimitives, makeLiveModelStep (diary rows), bare-agent's bridge, a fake stdio MCP server.
// FAKE: the provider (a scripted list of answers; no key, no network). The user's MCP config is `~/.mcp.json` under a scratch HOME. Scratch dirs are removed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { runFlow } from '../src/runner.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { resolvePrimitives, stepMcp, GateRefusal } from '../src/primitives.js';
import { readTools } from '../src/diary.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SERVER = path.join(HERE, 'fixtures', 'fake-mcp-server.mjs');
const cat = loadCatalogue();
const PROSE = '1. Look the ticket up with the tool and write what it says.\n\nArbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):\nguardrail: cap $0.25 per run\n';
const TOOLS = JSON.stringify([{ name: 'issue_read' }, { name: 'list_issues' }]);   // the server offers both; the job signs only issue_read

/** a scratch root and HOME with a `github` server in ~/.mcp.json (`serverEnv` overrides the fake's own settings; `config` replaces the whole file) */
function setup(t, { serverEnv = {}, config } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p2-'));
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p2-home-'));
  const oldHome = process.env.HOME;
  const callsFile = path.join(home, 'calls.jsonl');
  t.after(() => { process.env.HOME = oldHome; rmSync(root, { recursive: true, force: true }); rmSync(home, { recursive: true, force: true }); });
  writeFileSync(path.join(home, '.mcp.json'), JSON.stringify(config ?? { mcpServers: { github: { command: process.execPath, args: [SERVER], env: { FAKE_MCP_SERVER: '1', FAKE_TOOLS: TOOLS, FAKE_CALLS: callsFile, ...serverEnv } } } }));
  process.env.HOME = home;
  const declaration = {
    guardrailClasses: {}, unjudgeable: {}, refused: [], inputFacts: {}, mcp: { server: 'github', tools: ['issue_read'] },
    steps: [{ goal: 'Look the ticket up with the tool and write what it says.', primitives: ['read'], reads: [], emits: 'note', fromLine: 1, close: { class: 'hitl' }, mcpTools: ['issue_read'] }],
  };
  const w = writeFlow({ root, name: 'm13', proseText: PROSE, declaration, signedBy: 'hamr', signedAt: '2026-10-31T12:00:00Z', catalogue: cat.primitives });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const runDir = path.join(root, 'm13', 'runs', 'run-1');
  return { root, runDir, callsFile, declaration };
}
const serverCalls = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)) : []);

/** a scripted provider: each generate() answers the next item (the last repeats); an item may be a function that runs first (a hook) */
let nextId = 0;
const reply = (toolCalls, stopReason) => ({ text: toolCalls.length ? null : '', toolCalls, usage: { inputTokens: 10, outputTokens: 5 }, stopReason, model: 'deepseek-flash' });
const callOf = (name, args) => reply([{ id: `c${nextId += 1}`, name, arguments: args }], 'tool_calls');
const STOP = reply([], 'stop');
const emit = (text, done = true) => callOf('emit_artifact', { text, done, blocker: done ? null : 'could not finish' });
function scripted(items) {
  let n = 0;
  return { count: () => n, generate: async () => { const it = items[Math.min(n, items.length - 1)]; n += 1; return typeof it === 'function' ? it() : it; } };
}

async function run({ root, runDir, declaration }, provider) {
  const { tools: primitives, reds } = resolvePrimitives(cat.primitives, ['read'], { runDir, inputs: [], mcp: stepMcp(declaration) });
  assert.deepEqual(reds, []);
  const modelStep = makeLiveModelStep({ spendPath: path.join(runDir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  return runFlow({
    root, name: 'm13', runId: 'run-1', catalogue: cat.primitives, primitives, businessDate: '2026-06-01', sources: [], modelStep,
    askStep: async () => { throw new Error('ask'); }, sendStep: async () => { throw new Error('send'); },
  });
}

test('a step with mcpTools calls the signed tool through the gate, closes green, and the call is a diary allow row', async (t) => {
  const s = setup(t);
  const r = await run(s, scripted([callOf('github_issue_read', { issue_number: 7 }), emit('ticket 7: Crash on tap'), STOP]));
  assert.equal(r.outcome, 'complete', r.red);
  assert.deepEqual(serverCalls(s.callsFile), [{ name: 'issue_read', arguments: { issue_number: 7 } }]);
  const rows = readTools(s.runDir).filter((x) => x.tool === 'github_issue_read');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].decision, 'allow');
  assert.equal(rows[0].rule, null);
});

test('an unsigned tool is denied with a diary deny row and the server tool never executes', async (t) => {
  const s = setup(t);
  const r = await run(s, scripted([callOf('github_issue_read', { issue_number: 7 }), callOf('github_list_issues', {}), emit('ticket 7: Crash on tap'), STOP]));
  assert.equal(r.outcome, 'complete', r.red);
  const rows = readTools(s.runDir);
  assert.equal(rows.find((x) => x.tool === 'github_issue_read')?.decision, 'allow');
  const denied = rows.find((x) => x.tool === 'github_list_issues');
  assert.equal(denied?.decision, 'deny');
  assert.deepEqual(serverCalls(s.callsFile).map((c) => c.name), ['issue_read'], 'list_issues never reached the server');
});

test("a step's own fs verbs still work beside mcpTools (the allowlist lists them)", async (t) => {
  const s = setup(t);
  const seeNote = () => { writeFileSync(path.join(s.runDir, 'note.txt'), 'hello from the run'); return callOf('read', { path: 'note.txt' }); };
  const r = await run(s, scripted([seeNote, callOf('github_issue_read', { issue_number: 7 }), emit('done'), STOP]));
  assert.equal(r.outcome, 'complete', r.red);
  const rows = readTools(s.runDir);
  assert.equal(rows.find((x) => x.tool === 'read')?.decision, 'allow');
  assert.equal(rows.find((x) => x.tool === 'github_issue_read')?.decision, 'allow');
});

test('a server missing from ~/.mcp.json refuses by name at $0: no provider call, no spend', async (t) => {
  const s = setup(t, { config: { mcpServers: { other: { command: process.execPath, args: [SERVER], env: { FAKE_MCP_SERVER: '1' } } } } });
  const provider = scripted([emit('never')]);
  const r = await run(s, provider);
  assert.equal(r.outcome, 'preflight-red');
  assert.match(r.red, /github is not in ~\/\.mcp\.json/);
  assert.equal(provider.count(), 0);
  assert.equal(existsSync(path.join(s.runDir, 'spend.jsonl')), false);
});

test('a server that will not start refuses by name at $0: no provider call', async (t) => {
  const s = setup(t, { config: { mcpServers: { github: { command: '/nonexistent/fwdloop-m13p2', args: [] } } } });
  const provider = scripted([emit('never')]);
  const r = await run(s, provider);
  assert.equal(r.outcome, 'preflight-red');
  assert.match(r.red, /github did not start: /);
  assert.equal(provider.count(), 0);
});

test('a signed tool the server does not offer refuses by name at $0: no provider call', async (t) => {
  const s = setup(t, { serverEnv: { FAKE_TOOLS: JSON.stringify([{ name: 'list_issues' }]) } });
  const provider = scripted([emit('never')]);
  const r = await run(s, provider);
  assert.equal(r.outcome, 'preflight-red');
  assert.match(r.red, /github does not offer issue_read/);
  assert.equal(provider.count(), 0);
  assert.equal(existsSync(path.join(s.runDir, 'spend.jsonl')), false);
});

/** every descendant of this test process, by a parent-pid walk (own PIDs only; never a name match) */
function descendants() {
  const rows = execFileSync('ps', ['-e', '-o', 'pid=,ppid=,comm=']).toString().trim().split('\n').map((l) => l.trim().split(/\s+/)).filter((c) => c[2] !== 'ps').map((c) => [Number(c[0]), Number(c[1])]);
  const kids = new Set([process.pid]);
  for (let grew = true; grew;) { grew = false; for (const [p, pp] of rows) if (kids.has(pp) && !kids.has(p)) { kids.add(p); grew = true; } }
  kids.delete(process.pid);
  return [...kids];
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function gone(pids) {
  for (let i = 0; i < 40 && pids.some(alive); i += 1) await new Promise((res) => { setTimeout(res, 100); });
  return pids.filter(alive);
}

for (const [label, done] of [['a green step', true], ['a red try (done:false)', false]]) {
  test(`the MCP child is gone after ${label}`, async (t) => {
    const s = setup(t);
    const during = /** @type {number[]} */ ([]);
    const spy = () => { during.push(...descendants()); return callOf('github_issue_read', { issue_number: 7 }); };
    const r = await run(s, scripted([spy, emit('x', done), STOP]));
    assert.equal(r.outcome, done ? 'complete' : 'not-done', r.red);
    assert.ok(during.length > 0, 'the bridge had started a child while the step ran');
    assert.deepEqual(await gone(during), [], 'a bridge child outlived the step');
  });
}

test('a job with no mcpTools: resolvePrimitives gives only its verbs, and gates no tool names', () => {
  assert.equal(stepMcp({ steps: [{ goal: 'g', primitives: ['read'] }] }), undefined);
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p2-prim-'));
  try {
    const { tools, reds } = resolvePrimitives(cat.primitives, ['read'], { runDir: dir, inputs: [] });
    assert.deepEqual(Object.keys(tools), ['read']);
    assert.deepEqual(reds, []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a tool refusal says it is a tool refusal, naming the tool, not the filesystem wording', () => {
  const e = new GateRefusal('github_issue_read', '', 'tools.allowlist.exclusive', { tool: true });
  assert.match(e.message, /github_issue_read/);
  assert.doesNotMatch(e.message, /sandbox|""/);
  assert.match(e.message, /tools\.allowlist\.exclusive/);
  assert.equal(e.rule, 'tools.allowlist.exclusive');
  // the filesystem wording is unchanged
  assert.match(new GateRefusal('read', '/x/y', 'fs.readScope').message, /read: "\/x\/y" is outside the sandbox — refused \(bareguard rule: fs\.readScope\)/);
});
