// Structure tests only — NO network. Every model round in this file goes
// through an injected fake provider, same discipline as drafter.test.mjs and
// scout.test.mjs. A live probe exists only behind REDRAFT_LIVE=1 in
// redraft.mjs's own CLI block, never here and never in the default `npm
// test` path.
//
// Steps declare `fromLine`, never a class or tracesTo (the strict 1-for-1
// line<->guardrail model, RULED 2026-09-10) — assembleDeclaration derives
// close.class mechanically from the guardrail's own PROPOSED class
// (`guardrailClasses`, DEFECT 1 fix), which carries over from the previous
// declaration unless this round's model explicitly reproposes a line.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runRedraft } from './redraft.mjs';
import { validate } from './validator.mjs';

const REAL_GUARDRAILS = [
  '1. read the sheet',
  '2. read the message and work out which customer',
  '   guardrail: if more than one customer matches, ask me, do not pick',
  '3. list their open invoices, total owed, earliest due, count overdue as of today',
  '   guardrail: every number must point to the cell it came from or the formula that made it',
  '4. write a short reply, one line per invoice',
  '   guardrail: one line per invoice in the reply',
  '5. check with me',
  '   guardrail: nothing goes out before I accept',
  '6. on accept, send',
  '',
  'Arbiter guardrails (belong to no line):',
  'guardrail: cap $0.25 per run',
].join('\n');

const REAL_GUARDRAIL_CLASSES = { 2: 'hitl', 3: 'green', 4: 'softgreen', 5: 'hitl' };

function job1Declaration() {
  return {
    skills: ['core'],
    guardrails: REAL_GUARDRAILS,
    guardrailClasses: { ...REAL_GUARDRAIL_CLASSES },
    steps: [
      {
        goal: 'read the sheet', primitives: ['addressCells'], reads: [], emits: 'a1', fromLine: 1, close: { class: 'hitl' },
      },
      {
        goal: 'read the message', primitives: ['read'], reads: [], emits: 'a2', fromLine: 2, close: { class: 'hitl' },
      },
      {
        goal: 'match customer, derive totals', primitives: [], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3, close: { class: 'green' },
      },
      {
        goal: 'compose reply',
        primitives: [],
        reads: ['a3'],
        emits: 'a4',
        fromLine: 4,
        close: { class: 'softgreen', shape: { linesPerInvoice: 1, mustCarry: ['total', 'earliestDueDate'] } },
      },
      {
        goal: 'check with me', primitives: ['checkpoint'], reads: ['a4'], emits: 'a5', fromLine: 5, close: { class: 'hitl' },
      },
      {
        goal: 'send (dry-run egress)', primitives: ['write'], reads: ['a4'], emits: 'a6', fromLine: 6, close: { class: 'hitl' },
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

// "merge 3 and 4": collapse the derive+compose steps into one step, serving
// line 3 (the citation guardrail) — a merged step keeping only one derived
// class is a legitimate redraft outcome; the guardrails it can derive from,
// and their proposed classes, do not change. The model need not repropose
// guardrailClasses at all here — line 3's "green" proposal from the previous
// round carries straight over.
function mergedSteps() {
  const prev = job1Declaration();
  return {
    steps: [
      prev.steps[0],
      prev.steps[1],
      {
        goal: 'match customer, derive totals, and compose reply', primitives: [], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3,
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
// Must-have — a redraft's guardrailClasses carry over unchanged unless this
// round explicitly reproposes a line (DEFECT 1's mechanism, exercised
// through a second round).
// ---------------------------------------------------------------------------

test('guardrailClasses carry over from the previous declaration when the redraft model says nothing about them', async () => {
  const previous = job1Declaration();
  const provider = fakeProvider(toolReply(mergedSteps())); // no guardrailClasses at all in this round's reply
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  assert.deepEqual(result.declaration.guardrailClasses, previous.guardrailClasses);
});

test('PROOF the test can fail: a redraft that DOES repropose one line changes only that line\'s class, leaving the rest untouched', async () => {
  const previous = job1Declaration();
  const args = { ...mergedSteps(), guardrailClasses: { 4: 'hitl' } }; // "make the reply shape my call"
  const provider = fakeProvider(toolReply(args));
  const result = await runRedraft('fake-model', previous, 'make step 4 my call', { provider, rates: { in: 0, out: 0 } });
  assert.equal(result.declaration.guardrailClasses['4'], 'hitl');
  assert.equal(result.declaration.guardrailClasses['3'], previous.guardrailClasses['3'], 'line 3 was not touched by this round, so it must carry over');
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
// Must-have — the result still passes validate(), and the merged step's
// class is DERIVED from line 3 (green), not carried over or chosen.
// ---------------------------------------------------------------------------

test('a redrafted declaration ("merge 3 and 4") still passes validate() and derives the merged step\'s class from its fromLine', async () => {
  const previous = job1Declaration();
  const provider = fakeProvider(toolReply(mergedSteps()));
  const result = await runRedraft('fake-model', previous, 'merge 3 and 4', { provider, rates: { in: 0, out: 0 } });
  const verdict = validate(result.declaration);
  assert.equal(verdict.verdict, 'green', verdict.red);
  const merged = result.declaration.steps.find((s) => s.goal.includes('and compose reply'));
  assert.equal(merged.close.class, 'green');
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
