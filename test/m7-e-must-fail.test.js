// M7 "Must fail when" (docs/wiki/the-module-ladder.md, M7 scope — SIGNED), through the real path:
// resolvePrimitives (the grant) -> makeLiveModelStep -> bare-agent Loop, with a scripted fake provider ($0).
//   1. a step that isn't granted `recall` calls it, and is refused;
//   2. a second run can't see the first run's `stash`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { makeLiveModelStep } from '../src/model-step.js';
import { resolvePrimitives } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runStoreDir } from '../src/run-store.js';

const CTX = { goal: 'park a thing', primitives: [], reads: {}, gap: null };

/** Round 1 makes `calls`; round 2 emits the artifact. `seen` collects the tool results the Loop fed back. */
function scripted(calls) {
  const seen = [];
  let n = 0;
  return {
    seen,
    async generate(messages) {
      n += 1;
      const usage = { inputTokens: 10, outputTokens: 5 };
      if (n === 1) return { text: null, toolCalls: calls.map((c, i) => ({ id: `t${i}`, name: c.name, arguments: c.args })), usage, stopReason: 'tool_calls', model: 'deepseek-flash' };
      if (n === 2) {
        for (const m of messages) if (m.role === 'tool') seen.push(String(m.content));
        return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { text: 'done' } }], usage, stopReason: 'tool_calls', model: 'deepseek-flash' };
      }
      return { text: '', toolCalls: [], usage, stopReason: 'stop', model: 'deepseek-flash' };
    },
  };
}

/** One step of one run: the grant is `resolvePrimitives(catalogue, granted)` — exactly what bin/fwdloop hands the runner. */
async function step(runDir, granted, calls) {
  mkdirSync(runDir, { recursive: true });
  const { tools, reds } = resolvePrimitives(loadCatalogue().primitives, granted, { runDir });
  assert.deepEqual(reds, []);
  const provider = scripted(calls);
  const modelStep = makeLiveModelStep({ spendPath: path.join(runDir, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  const result = await modelStep(CTX, tools, { class: 'hitl' });
  return { result, seen: provider.seen };
}

const runs = () => path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m7e-')), 'flow', 'runs');

test('M7 must fail: a step not granted recall that calls it is refused, and nothing ran', async () => {
  const runDir = path.join(runs(), 'run-1');
  const { result, seen } = await step(runDir, ['stash'], [{ name: 'recall', args: { query: 'x' } }]);
  assert.deepEqual(result.ungranted, ['recall'], 'recorded as an ungranted call');
  assert.match(seen.join('\n'), /Unknown tool: recall/, 'the model is told it does not exist');
  assert.equal(existsSync(runStoreDir(runDir)), false, 'the refused call opened no store');
});

test('M7 control: the same call from a step that IS granted recall runs (so the refusal above is the grant, not a broken tool)', async () => {
  const runDir = path.join(runs(), 'run-1');
  const { result, seen } = await step(runDir, ['recall'], [{ name: 'recall', args: { query: 'x' } }]);
  assert.equal(result.ungranted, undefined);
  assert.match(seen.join('\n'), /no hits/);
});

test('M7 must fail: a second run cannot see the first run\'s stash', async () => {
  const dir = runs();
  const r1 = await step(path.join(dir, 'run-1'), ['stash', 'peek'], [{ name: 'stash', args: { id: 'carry', text: 'run one wrote this' } }]);
  assert.match(r1.seen.join('\n'), /parked 18 bytes under "carry"/);
  const own = await step(path.join(dir, 'run-1'), ['peek'], [{ name: 'peek', args: { id: 'carry' } }]);
  assert.match(own.seen.join('\n'), /run one wrote this/, 'the same run still sees its own stash');
  const r2 = await step(path.join(dir, 'run-2'), ['stash', 'peek'], [{ name: 'peek', args: { id: 'carry' } }]);
  assert.match(r2.seen.join('\n'), /nothing stashed under "carry"/);
});

test('M7: remember and forget are refused at the grant (memory lasts one run)', async () => {
  const { tools, reds } = resolvePrimitives(loadCatalogue().primitives, ['remember', 'forget'], { runDir: path.join(runs(), 'run-1') });
  assert.deepEqual(Object.keys(tools), []);
  assert.equal(reds.length, 2);
});
