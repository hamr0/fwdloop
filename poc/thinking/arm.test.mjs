// POC test (run: node --test poc/thinking/arm.test.mjs). Fails if the arm mapping is wrong, at the pure function AND at the provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { thinkingModeFor } from './arm.mjs';
import { makeEngine } from './make-engine.mjs';
import { median, summarize, f69Verdict } from './score.mjs';

test('arm mapping: today sends nothing, on always on, retry off then on', () => {
  for (const a of [1, 2, 3]) assert.equal(thinkingModeFor('today', a), undefined);
  for (const a of [1, 2, 3]) assert.equal(thinkingModeFor('on', a), 'on');
  assert.equal(thinkingModeFor('retry', 1), 'off');
  assert.equal(thinkingModeFor('retry', 2), 'on');
  assert.equal(thinkingModeFor('retry', 3), 'on');
  assert.throws(() => thinkingModeFor('nope', 1));
});

test('engine copy: thinkingMode (or none) reaches provider.generate, per arm and attempt', async () => {
  const { engine } = makeEngine();
  const dir = mkdtempSync(join(tmpdir(), 'poc-thinking-'));
  try {
    const { makeFakeProvider } = await import('./fake-step.mjs');
    const { makeLiveModelStep } = await import(join(engine, 'src', 'model-step.js'));
    const want = { today: [null, null], on: ['on', 'on'], retry: ['off', 'on'] };
    for (const [arm, expected] of Object.entries(want)) {
      process.env.FWDLOOP_POC_ARM = arm;
      const calls = join(dir, `${arm}.jsonl`);
      process.env.FWDLOOP_POC_CALLS = calls;
      const step = makeLiveModelStep({ spendPath: join(dir, `${arm}-spend.jsonl`), provider: makeFakeProvider(), rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
      for (const attempt of [1, 2]) await step({ goal: 'g', reads: {}, gap: null, primitives: [] }, {}, { class: 'hitl', attempt, stepId: 's' });
      const rows = readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const byAttempt = [1, 2].map((a) => rows.find((r) => r.attempt === a).modeSent);
      assert.deepEqual(byAttempt, expected, arm);
      if (arm === 'today') assert.ok(rows.every((r) => r.hasKey === false), 'today must send no thinkingMode key at all');
    }
  } finally { delete process.env.FWDLOOP_POC_ARM; delete process.env.FWDLOOP_POC_CALLS; rmSync(dir, { recursive: true, force: true }); }
});

const row = (job, arm, pass, costUsd, wallMs) => ({ job, arm, pass, costUsd, wallMs, turns: 4 });
test('F69 verdict follows the written win rule', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, null]), null);
  const J = ['a', 'b'];
  const mk = (rows) => f69Verdict(summarize(rows), J).verdict;
  const base = [row('a', 'on', true, 2, 20), row('b', 'on', true, 2, 20)];
  assert.equal(mk([...base, row('a', 'retry', true, 1, 10), row('b', 'retry', true, 3, 30)]), 'BUILD');
  assert.equal(mk([...base, row('a', 'retry', false, 1, 10), row('b', 'retry', true, 1, 10)]), 'NO BUILD'); // fewer passes on one job
  assert.equal(mk([...base, row('a', 'retry', true, 2, 20), row('b', 'retry', true, 3, 30)]), 'NO BUILD'); // not faster or cheaper anywhere
  assert.equal(mk([...base, row('a', 'retry', true, null, 10), row('b', 'retry', true, 1, 10)]), 'INCOMPLETE');
});
