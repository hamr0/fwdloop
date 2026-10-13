// M7 POC, $0. The two must-fail cases of the signed M7 scope, through fwdloop's REAL
// model-step (makeLiveModelStep -> bare-agent Loop) with a scripted fake provider.
//   (a) a step NOT granted `recall` that calls it is refused (never executed);
//   (b) run-2 of the same flow cannot see run-1's `stash`.
// Usage: node poc.mjs            -> green (the real wiring)
//        node poc.mjs --red      -> deliberately breaks each guard; both checks must FAIL
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeLiveModelStep } from '../../src/model-step.js';
import { openRunStore, makeCtxTools, ISOLATE_MAX_BYTES } from './ctx-tools.mjs';

const RED = process.argv.includes('--red');
const CTX = { goal: 'park a thing', primitives: [], reads: {}, gap: null };
const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m7poc-'));

/** Fake provider: round 1 calls `calls` (one tool call each), round 2 emits the artifact.
 *  Every tool result the Loop feeds back is captured from the messages of round 2. */
function scripted(calls) {
  const seen = { toolResults: [] };
  let n = 0;
  return {
    seen,
    async generate(messages) {
      n += 1;
      if (n === 1) {
        return { text: null, toolCalls: calls.map((c, i) => ({ id: `t${i}`, name: c.name, arguments: c.args })), usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
      }
      if (n === 2) {
        for (const m of messages) if (m.role === 'tool') seen.toolResults.push(String(m.content));
        return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { text: 'done' } }], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
      }
      return { text: '', toolCalls: [], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop', model: 'deepseek-flash' };
    },
  };
}

/** Run ONE step as a run: fresh runDir + store. `granted` picks which verbs the step gets
 *  (the grant path: only granted verbs become tools handed to the model). */
async function runStep({ runName, granted, calls, storeRoot }) {
  const runDir = path.join(root, runName);
  mkdirSync(runDir, { recursive: true });
  const lc = openRunStore(runDir, storeRoot);
  const executed = [];
  const all = makeCtxTools(lc, (name) => executed.push(name));
  const grantedTools = Object.fromEntries(granted.map((v) => [v, all[v]]));
  const provider = scripted(calls);
  const step = makeLiveModelStep({ spendPath: path.join(runDir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  const result = await step(CTX, grantedTools, { class: 'hitl' });
  lc.close();
  return { result, executed, seen: provider.seen.toolResults };
}

const checks = [];
async function check(name, fn) {
  try { await fn(); checks.push([name, 'PASS']); } catch (e) { checks.push([name, `FAIL: ${e.message.split('\n')[0]}`]); }
}

// (a) ungranted recall is refused
await check('(a) step not granted recall: its recall call is refused, never executed', async () => {
  const granted = RED ? ['stash', 'recall'] : ['stash']; // RED: wrongly grant recall
  const r = await runStep({ runName: 'a', granted, calls: [{ name: 'recall', args: { query: 'x' } }] });
  console.log('  (a) granted=%j executed=%j ungranted=%j toolResult=%j', granted, r.executed, r.result.ungranted ?? [], r.seen);
  assert.deepEqual(r.executed, [], 'recall must not execute');
  assert.deepEqual(r.result.ungranted, ['recall'], 'recall must be recorded as ungranted');
  assert.match(r.seen.join('\n'), /Unknown tool: recall/);
});

// (b) run-2 cannot see run-1's stash
await check("(b) run-2 of the same flow cannot see run-1's stash", async () => {
  const shared = RED ? path.join(root, 'shared-store') : undefined; // RED: both runs share one store
  if (shared) mkdirSync(shared, { recursive: true });
  const r1 = await runStep({ runName: 'run-1', granted: ['stash', 'peek'], storeRoot: shared, calls: [{ name: 'stash', args: { id: 'secret-note', text: 'run one wrote this' } }] });
  const r2 = await runStep({ runName: 'run-2', granted: ['stash', 'peek'], storeRoot: shared, calls: [{ name: 'peek', args: { id: 'secret-note' } }] });
  console.log('  (b) run-1 result=%j ; run-2 peek result=%j', r1.seen, r2.seen);
  assert.equal(r1.result.ok, true);
  assert.match(r2.seen.join('\n'), /nothing stashed under "secret-note"/, 'run-2 must not see run-1 stash');
});

// (c) 64 KB cap (the signed number), positive control in same run so it can fail
await check('(c) stash refuses over 64 KB and accepts exactly 64 KB', async () => {
  const big = 'x'.repeat(ISOLATE_MAX_BYTES + 1);
  const ok = 'x'.repeat(RED ? ISOLATE_MAX_BYTES + 1 : ISOLATE_MAX_BYTES);
  const r = await runStep({ runName: 'c', granted: ['stash'], calls: [{ name: 'stash', args: { id: 'big', text: big } }, { name: 'stash', args: { id: 'ok', text: ok } }] });
  console.log('  (c) results=%j', r.seen.map((s) => s.slice(0, 60)));
  assert.match(r.seen[0], /limit is 65536/);
  assert.match(r.seen[1], /^parked 65536 bytes/);
});

console.log(`\nM7 POC ${RED ? '(RED variant: guards deliberately broken)' : '(green)'}`);
for (const [n, s] of checks) console.log(`${s.startsWith('PASS') ? 'PASS' : 'FAIL'}  ${n}${s.startsWith('PASS') ? '' : '  -> ' + s}`);
rmSync(root, { recursive: true, force: true });
process.exit(checks.every(([, s]) => s === 'PASS') ? 0 : 1);
