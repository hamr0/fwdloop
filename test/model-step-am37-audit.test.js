// M4d am37 item 5: the audit row says which way a model step saved (first round, forced, fallback); a try that did not save has no such key. $0: a fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { makeLiveModelStep } from '../src/model-step.js';
import { runStepRalph } from '../src/runner.js';
import { appendAudit, readAudit } from '../src/books.js';

const U = { inputTokens: 10, outputTokens: 5 };
const text = { text: 'prose', toolCalls: [], usage: U, stopReason: 'stop', model: 'm-1' };
const save = { text: '', toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { text: 'fine', done: true } }], usage: U, stopReason: 'tool_calls', model: 'm-1' };

function provider(script) {
  let n = 0;
  return {
    generate: async (messages, tools, options = {}) => {
      n += 1;
      if (messages[messages.length - 1]?.role === 'tool') return text;
      return script(n, options);
    },
  };
}

async function runOne(script) {
  const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-am37a-'));
  const modelStep = makeLiveModelStep({ spendPath: path.join(d, 'spend.jsonl'), provider: provider(script), rates: { in: 0.001, out: 0.002 }, modelId: 'm-1' });
  const out = await runStepRalph({
    step: { goal: 'g', emits: 'one', primitives: [], reads: [], close: { class: 'hitl' } }, primitivesMap: {}, readsMap: {}, businessDate: '2026-06-01', modelStep, spent: { value: 0 }, capUsd: 5, ceilingUsd: 0.01, runDir: d,
    recordAudit: (row) => appendAudit(d, row), now: () => '2026-11-03T10:00:00.000Z',
  });
  return { out, rows: readAudit(d) };
}

test('a first-round save: savedBy first', async () => {
  const { out, rows } = await runOne(() => save);
  assert.equal(out.ok, true);
  assert.equal(rows[0].savedBy, 'first');
});

test('a forced save: savedBy forced on the try\'s row', async () => {
  const { out, rows } = await runOne((n) => (n === 1 ? text : save));
  assert.equal(out.ok, true);
  assert.equal(rows[0].savedBy, 'forced');
});

test('a fallback save: savedBy fallback', async () => {
  const { out, rows } = await runOne((n, o) => { if (n === 1) return text; if (o.toolChoice) throw new Error('400 tool_choice'); return save; });
  assert.equal(out.ok, true);
  assert.equal(rows[0].savedBy, 'fallback');
});

test('a try that never saved has no savedBy key', async () => {
  const { rows } = await runOne(() => text);
  assert.ok(rows.length >= 1);
  assert.ok(rows.every((r) => !('savedBy' in r)));
});
