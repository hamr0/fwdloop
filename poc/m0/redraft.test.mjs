// Structure tests only — NO network. Every model round in this file goes
// through an injected fake provider, same discipline as drafter.test.mjs and
// scout.test.mjs. A live probe exists only behind REDRAFT_LIVE=1 in
// redraft.mjs's own CLI block, never here and never in the default `npm
// test` path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRedraft } from './redraft.mjs';
import { validate } from './validator.mjs';

const REAL_GUARDRAILS = [
  'every number must point to the cell it came from or the formula that made it',
  'one line per invoice in the reply',
  'if more than one customer matches, ask me, do not pick',
  'nothing goes out before I accept',
  'cap $0.25 per run',
].join('\n');

function job1Declaration() {
  return {
    skills: ['core'],
    guardrails: REAL_GUARDRAILS,
    steps: [
      {
        goal: 'read the sheet', primitives: ['addressCells'], reads: [], emits: 'a1', close: { class: 'hitl' },
      },
      {
        goal: 'read the message', primitives: ['read'], reads: [], emits: 'a2', close: { class: 'hitl' },
      },
      {
        goal: 'match customer, derive totals', primitives: [], reads: ['a1', 'a2'], emits: 'a3', close: { class: 'green', tracesTo: 1 },
      },
      {
        goal: 'compose reply',
        primitives: [],
        reads: ['a3'],
        emits: 'a4',
        close: {
          class: 'softgreen', shape: { linesPerInvoice: 1, mustCarry: ['total', 'earliestDueDate'] }, tracesTo: 2,
        },
      },
      {
        goal: 'check with me', primitives: ['checkpoint'], reads: ['a4'], emits: 'a5', close: { class: 'hitl' },
      },
      {
        goal: 'send (dry-run egress)', primitives: ['write'], reads: ['a4'], emits: 'a6', close: { class: 'hitl' },
      },
    ],
    refused: [],
  };
}

// A well-behaved model calls the tool once, then finishes — same fake shape
// as drafter.test.mjs/scout.test.mjs.
function fakeProvider(toolCallReply) {
  const calls = [];
  let n = 0;
  return {
    calls,
    generate: async (messages, tools, options) => {
      calls.push({ messages, tools, options });
      n += 1;
      if (n === 1) return toolCallReply;
      return {
        text: '', toolCalls: [], usage: { inputTokens: 5, outputTokens: 1 }, stopReason: 'stop', model: 'fake-model',
      };
    },
  };
}

function toolReply(args) {
  return {
    text: null,
    toolCalls: [{ id: 't1', name: 'emit_declaration', arguments: args }],
    usage: { inputTokens: 200, outputTokens: 150 },
    stopReason: 'tool_calls',
    model: 'fake-model',
  };
}

// "merge 3 and 4": collapse the derive+compose steps into one step. Still
// closes green on guardrail 1 (the derive rule) — a merged step keeping only
// one close class is a legitimate redraft outcome; the guardrails it can
// point at do not change.
function mergedSteps() {
  const prev = job1Declaration();
  return {
    steps: [
      prev.steps[0],
      prev.steps[1],
      {
        goal: 'match customer, derive totals, and compose reply', primitives: [], reads: ['a1', 'a2'], emits: 'a3', close: { class: 'green', tracesTo: 1 },
      },
      { ...prev.steps[4], reads: ['a3'] },
      { ...prev.steps[5], reads: ['a3'] },
    ],
  };
}

// ---------------------------------------------------------------------------
// Must-have — the guardrails are byte-identical before and after a redraft.
// ---------------------------------------------------------------------------

test('the guardrails are byte-identical before and after a redraft round', async () => {
  const previous = job1Declaration();
  const provider = fakeProvider(toolReply(mergedSteps()));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  assert.equal(result.declaration.guardrails, previous.guardrails);
});

test('PROOF the test can fail: a model trying to smuggle an edited guardrails string is ignored, not passed through', async () => {
  const previous = job1Declaration();
  const args = { ...mergedSteps(), guardrails: 'FAKE OVERRIDE — the human never wrote this' };
  const provider = fakeProvider(toolReply(args));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  assert.equal(result.declaration.guardrails, previous.guardrails);
  assert.notEqual(result.declaration.guardrails, 'FAKE OVERRIDE — the human never wrote this');
});

// ---------------------------------------------------------------------------
// Must-have — an arbiter field in the redraft output is dropped.
// ---------------------------------------------------------------------------

test('an arbiter field the model tries to emit in a redraft is dropped, same as a first draft', async () => {
  const previous = job1Declaration();
  const args = {
    ...mergedSteps(),
    skills: ['god-mode'],
    trigger: { cron: '* * * * *' },
    cap: { usd: 999999 },
    askTtlMs: 999999,
    egress: { allowList: ['evil.example.com'] },
  };
  const provider = fakeProvider(toolReply(args));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  const decl = result.declaration;
  assert.deepEqual(decl.skills, previous.skills, 'skills must carry over from the previous declaration, never the model');
  for (const forbidden of ['trigger', 'cap', 'askTtlMs', 'egress']) {
    assert.equal(Object.prototype.hasOwnProperty.call(decl, forbidden), false, `redraft must not carry arbiter field "${forbidden}"`);
  }
  assert.ok(!JSON.stringify(decl).includes('evil.example.com'));
});

test('PROOF the test can fail: a clean redraft (no smuggled fields) carries no arbiter keys either, by the same check', async () => {
  const previous = job1Declaration();
  const provider = fakeProvider(toolReply(mergedSteps()));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  for (const forbidden of ['trigger', 'cap', 'askTtlMs', 'egress']) {
    assert.equal(Object.prototype.hasOwnProperty.call(result.declaration, forbidden), false);
  }
});

// ---------------------------------------------------------------------------
// Must-have — the result still passes validate().
// ---------------------------------------------------------------------------

test('a redrafted declaration ("merge 3 and 4") still passes validate()', async () => {
  const previous = job1Declaration();
  const provider = fakeProvider(toolReply(mergedSteps()));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  const verdict = validate(result.declaration);
  assert.equal(verdict.verdict, 'green', verdict.red);
});

test('PROOF the test can fail: dropping the merged step\'s "emits" makes the same redraft red', async () => {
  const previous = job1Declaration();
  const steps = mergedSteps();
  delete steps.steps[2].emits;
  const provider = fakeProvider(toolReply(steps));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  assert.equal(validate(result.declaration).verdict, 'red');
});

// ---------------------------------------------------------------------------
// Draft-time only: a redraft produces a declaration + a table, nothing else
// — no artifact is written, no step executes. Asserted structurally: the
// report carries no execution/effect fields, only declaration + table +
// metering.
// ---------------------------------------------------------------------------

test('a redraft round produces a declaration and its table, nothing that looks like execution', async () => {
  const previous = job1Declaration();
  const provider = fakeProvider(toolReply(mergedSteps()));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  assert.equal(result.toolCalled, true);
  assert.ok(typeof result.table === 'string' && result.table.includes('STEPS'));
  for (const field of ['ran', 'executed', 'effects', 'sent', 'artifacts']) {
    assert.equal(Object.prototype.hasOwnProperty.call(result, field), false);
  }
});

// ---------------------------------------------------------------------------
// The fixed output cap reaches the redraft round too (same F11 discipline).
// ---------------------------------------------------------------------------

test('the fixed DRAFTER_MAX_TOKENS reaches the redraft request options too', async () => {
  const { DRAFTER_MAX_TOKENS } = await import('./drafter.mjs');
  const previous = job1Declaration();
  const provider = fakeProvider(toolReply(mergedSteps()));
  await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  assert.ok(provider.calls.length >= 1 && provider.calls.length <= 2);
  for (const call of provider.calls) assert.equal(call.options.maxTokens, DRAFTER_MAX_TOKENS);
});
