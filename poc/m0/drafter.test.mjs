// Structure tests only — NO network. Every model round in this file goes
// through an injected fake provider (a plain object satisfying bare-agent's
// `Provider.generate(messages, tools, options)` interface), never a real
// OpenAIProvider — same discipline as scout.test.mjs. A live probe exists
// only behind `DRAFTER_LIVE=1` in drafter.mjs's own CLI block, never here and
// never in the default `npm test` path.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFTER_SKILLS, DRAFTER_MAX_TOKENS,
  extractGuardrails, assembleDeclaration, plantLine, runDrafter,
} from './drafter.mjs';
import { validate } from './validator.mjs';

// hamr's real, signed guardrails for job #1 (prose.txt), verbatim — the
// control every test below checks assembled declarations against, so a bug
// that leaks prose into guardrails (or drops a guardrail line) is visible.
const REAL_GUARDRAILS = [
  '- every number must point to the cell it came from or the formula that made it',
  '- one line per invoice in the reply',
  '- if more than one customer matches, ask me, do not pick',
  '- nothing goes out before I accept',
  '- cap $0.25 per run',
].join('\n');

// A well-behaved model calls the tool once, then finishes (no further tool
// calls) once it sees the tool result — same fake shape as scout.test.mjs.
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

// A fully valid job #1 declaration, exactly what a well-behaved model should
// emit (steps only — skills/guardrails are stitched in by the harness, never
// authored by the model).
function job1ModelSteps() {
  return {
    steps: [
      {
        goal: 'read the sheet', primitives: ['addressCells'], reads: [], emits: 'a1', close: { class: 'hitl' },
      },
      {
        goal: 'read the message', primitives: ['read'], reads: [], emits: 'a2', close: { class: 'hitl' },
      },
      {
        goal: 'match customer, derive totals',
        primitives: [],
        reads: ['a1', 'a2'],
        emits: 'a3',
        close: { class: 'green', tracesTo: 'every number must point to the cell it came from or the formula that made it' },
      },
      {
        // Softgreen, and only because a guardrail says so. Before 2026-09-10 the
        // shape lived in the prose alone and this step correctly fell to hitl.
        goal: 'compose reply',
        primitives: [],
        reads: ['a3'],
        emits: 'a4',
        close: {
          class: 'softgreen',
          shape: { linesPerInvoice: 1, mustCarry: ['total', 'earliestDueDate'] },
          tracesTo: 'one line per invoice in the reply',
        },
      },
      {
        goal: 'check with me', primitives: ['checkpoint'], reads: ['a4'], emits: 'a5', close: { class: 'hitl' },
      },
      {
        goal: 'send (dry-run egress)', primitives: ['write'], reads: ['a4'], emits: 'a6', close: { class: 'hitl' },
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// extractGuardrails / plantLine — pure functions, checked directly first.
// ---------------------------------------------------------------------------

test('extractGuardrails pulls the human-authored bullets verbatim out of prose.txt, nothing else', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const proseText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prose.txt'), 'utf8');
  assert.equal(extractGuardrails(proseText), REAL_GUARDRAILS);
});

test('plantLine adds the extra job line before "Guardrails:" without touching the guardrails block', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const proseText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prose.txt'), 'utf8');
  const planted = plantLine(proseText, 'flag anything that looks unusual', { prose: true });
  assert.match(planted, /flag anything that looks unusual/);
  assert.equal(extractGuardrails(planted), REAL_GUARDRAILS, 'the plant must land in the prose, never the guardrails block');
});

// ---------------------------------------------------------------------------
// Must-have 1 — a drafted declaration passes validator.mjs's validate() end
// to end, with the real signed guardrails stitched in.
// ---------------------------------------------------------------------------

test('a drafted declaration for job #1 passes validate() end to end', async () => {
  const provider = fakeProvider(toolReply(job1ModelSteps()));
  const report = await runDrafter('fake-model', {
    prose: true, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(report.toolCalled, true);
  assert.deepEqual(report.declaration.skills, DRAFTER_SKILLS);
  assert.equal(report.declaration.guardrails, REAL_GUARDRAILS);
  const result = validate(report.declaration);
  assert.equal(result.verdict, 'green', result.red);
});

test('PROOF the test can fail: dropping a step\'s "emits" makes the same declaration red', async () => {
  const steps = job1ModelSteps();
  delete steps.steps[0].emits;
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  assert.equal(validate(report.declaration).verdict, 'red');
});

// ---------------------------------------------------------------------------
// Must-have 2 — a primitive not in the catalogue is surfaced as a red, never
// silently dropped and never invented into something real.
// ---------------------------------------------------------------------------

test('a primitive the model invents is passed through untouched and surfaces as a red at validate() — never silently dropped', async () => {
  const steps = job1ModelSteps();
  steps.steps[0].primitives = ['telepathy'];
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  // Not silently dropped: the invented verb is still right there in the declaration.
  assert.ok(report.declaration.steps[0].primitives.includes('telepathy'));
  const result = validate(report.declaration);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /unknown primitive verb "telepathy" — not in the catalogue/);
});

test('PROOF the test can fail: the same declaration with a real catalogue verb validates green', async () => {
  const steps = job1ModelSteps();
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  assert.equal(validate(report.declaration).verdict, 'green');
});

// ---------------------------------------------------------------------------
// Must-have 3 — zero arbiter-field leaks. Even a model that tries to emit
// trigger/cap/askTtlMs/egress/"done"/its own skills or guardrails is ignored.
// ---------------------------------------------------------------------------

test('zero arbiter-field leaks: a model trying to smuggle trigger/cap/askTtlMs/egress/done/skills/guardrails is ignored', async () => {
  const args = {
    ...job1ModelSteps(),
    skills: ['god-mode'],
    guardrails: 'FAKE OVERRIDE — nothing matters',
    trigger: { cron: '* * * * *' },
    cap: { usd: 999999 },
    askTtlMs: 999999,
    egress: { allowList: ['evil.example.com'] },
    done: 'whenever the model feels like it',
  };
  const provider = fakeProvider(toolReply(args));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  const decl = report.declaration;
  assert.deepEqual(decl.skills, DRAFTER_SKILLS, 'skills must be the harness grant, never the model\'s own');
  assert.equal(decl.guardrails, REAL_GUARDRAILS, 'guardrails must be the real signed text, never a model override');
  for (const forbidden of ['trigger', 'cap', 'askTtlMs', 'egress', 'done']) {
    assert.equal(Object.prototype.hasOwnProperty.call(decl, forbidden), false, `declaration must not carry arbiter field "${forbidden}"`);
  }
  const serialized = JSON.stringify(decl);
  assert.ok(!serialized.includes('evil.example.com'));
  assert.ok(!serialized.includes('FAKE OVERRIDE'));
});

test('PROOF the test can fail: a clean model call (no smuggled fields) carries no arbiter keys either, by the same check', async () => {
  const provider = fakeProvider(toolReply(job1ModelSteps()));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  for (const forbidden of ['trigger', 'cap', 'askTtlMs', 'egress', 'done']) {
    assert.equal(Object.prototype.hasOwnProperty.call(report.declaration, forbidden), false);
  }
});

// ---------------------------------------------------------------------------
// Must-have 4 — the uncovered-line plant (negative scenario vi). A step for
// a line no guardrail covers must land at hitl; the drafter's own guardrail
// extraction must not accidentally give it coverage.
// ---------------------------------------------------------------------------

test('the uncovered-line plant lands at hitl and validates green', async () => {
  const steps = job1ModelSteps();
  steps.steps.splice(2, 0, {
    goal: 'flag anything that looks unusual', primitives: [], reads: ['a2'], emits: 'a2b', close: { class: 'hitl' },
  });
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', {
    prose: true, uncovered: true, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(
    report.declaration.guardrails.includes('flag anything that looks unusual'),
    false,
    'the plant must never end up inside the guardrails text',
  );
  assert.equal(validate(report.declaration).verdict, 'green');
});

test('the uncovered-line plant claimed as green/softgreen is a red, not a pass — the drafter never invents coverage for it', async () => {
  const steps = job1ModelSteps();
  steps.steps.splice(2, 0, {
    goal: 'flag anything that looks unusual',
    primitives: [],
    reads: ['a2'],
    emits: 'a2b',
    close: { class: 'green', tracesTo: 'flag anything that looks unusual' },
  });
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', {
    prose: true, uncovered: true, provider, rates: { in: 0, out: 0 },
  });
  const result = validate(report.declaration);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /an uncovered line must fall to hitl/);
});

test('PROOF the test can fail: the same plant step correctly landed at hitl validates green', async () => {
  const steps = job1ModelSteps();
  steps.steps.splice(2, 0, {
    goal: 'flag anything that looks unusual', primitives: [], reads: ['a2'], emits: 'a2b', close: { class: 'hitl' },
  });
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', {
    prose: true, uncovered: true, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(validate(report.declaration).verdict, 'green');
});

// ---------------------------------------------------------------------------
// Must-have 5 — F11 guard: the output cap must actually bind.
// ---------------------------------------------------------------------------

test('F11: the deepseek slot the drafter can run against carries legacyMaxTokens — provider.mjs is the one writer', async () => {
  const { makeProvider } = await import('./provider.mjs');
  const saved = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = 'test-key-not-real';
  try {
    assert.equal(makeProvider('deepseek', { model: 'deepseek-v4-flash' }).provider.legacyMaxTokens, true);
  } finally {
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved; else delete process.env.DEEPSEEK_API_KEY;
  }
});

test('the fixed DRAFTER_MAX_TOKENS reaches every request option — no call site or caller can widen it', async () => {
  const provider = fakeProvider(toolReply(job1ModelSteps()));
  await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  assert.ok(provider.calls.length >= 1 && provider.calls.length <= 2, `expected 1-2 provider calls, got ${provider.calls.length}`);
  for (const call of provider.calls) assert.equal(call.options.maxTokens, DRAFTER_MAX_TOKENS);
});

// ---------------------------------------------------------------------------
// assembleDeclaration as a pure function — independent of the model round.
// ---------------------------------------------------------------------------

test('assembleDeclaration ignores every field on modelArgs except steps/refused', () => {
  const decl = assembleDeclaration(
    {
      steps: [{ goal: 'x' }], refused: [{ hamrLine: 'y', reason: 'z' }], skills: ['nope'], guardrails: 'nope', cap: { usd: 1 },
    },
    { skills: ['core'], guardrails: 'real guardrails text' },
  );
  assert.deepEqual(decl, {
    skills: ['core'],
    guardrails: 'real guardrails text',
    steps: [{ goal: 'x' }],
    refused: [{ hamrLine: 'y', reason: 'z' }],
  });
});

test('assembleDeclaration defaults steps/refused to empty arrays when the model omits them', () => {
  const decl = assembleDeclaration({}, { skills: ['core'], guardrails: 'g' });
  assert.deepEqual(decl.steps, []);
  assert.deepEqual(decl.refused, []);
});

// ---------------------------------------------------------------------------
// A refusal (negative scenario ii) still flows through untouched.
// ---------------------------------------------------------------------------

test('a refused line flows through to declaration.refused untouched', async () => {
  const steps = job1ModelSteps();
  steps.refused = [{ hamrLine: 'rate how friendly the customer sounds', reason: 'no groundable check — subjective, no citation is possible' }];
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', {
    prose: true, ungroundable: true, provider, rates: { in: 0, out: 0 },
  });
  assert.equal(report.declaration.refused.length, 1);
  assert.match(report.declaration.refused[0].hamrLine, /friendly/);
});
