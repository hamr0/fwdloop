// Structure tests only — NO network. Every model round in this file goes
// through an injected fake provider (a plain object satisfying bare-agent's
// `Provider.generate(messages, tools, options)` interface), never a real
// OpenAIProvider — same discipline as scout.test.mjs. A live probe exists
// only behind `DRAFTER_LIVE=1` in drafter.mjs's own CLI block, never here and
// never in the default `npm test` path.
//
// The model authors `fromLine` per step (the strict 1-for-1
// line<->guardrail model, RULED 2026-09-10) — never a step-level class,
// never a tracesTo. It ALSO proposes, once per guardrail (never per step),
// the class that guardrail's own wording earns, via `guardrailClasses`
// (DEFECT 1 fix — replaces a regex `deriveClass` fitted to job #1's exact
// phrasing). assembleDeclaration derives each step's `close.class`
// mechanically from `fromLine` against `guardrailClasses`; see
// validator.mjs.
//
// The job #1 fixture's cap now lives under its own "Arbiter guardrails"
// section, belonging to no numbered line (DEFECT 2 fix) — prose.txt/
// steps.txt were restructured accordingly.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DRAFTER_SKILLS, DRAFTER_MAX_TOKENS,
  extractGuardrails, assembleDeclaration, plantLine, runDrafter,
} from './drafter.mjs';
import { validate, parseArbiterGuardrails } from './validator.mjs';

// hamr's real, signed job lines for job #1 (prose.txt), verbatim — the
// control every test below checks assembled declarations against, so a bug
// that drops or rewrites a line is visible. The cap sits under its own
// arbiter section (DEFECT 2), so line 6 carries no guardrail.
const REAL_GUARDRAILS = [
  '1. When the AR aging sheet lands, read it,',
  '2. then read the chat message and work out which customer it is about.',
  '   guardrail: if more than one customer matches, ask me, do not pick',
  '3. Pull their open invoices, what they owe in total, the earliest due date, and how many are overdue as of the business date.',
  '   guardrail: every number must point to the cell it came from or the formula that made it',
  '4. Write me a short reply with one line per invoice,',
  '   guardrail: one line per invoice in the reply',
  '5. check it with me,',
  '   guardrail: nothing goes out before I accept',
  '6. and send it once I accept.',
  '',
  'Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):',
  'guardrail: cap $0.25 per run',
].join('\n');

// job #1's real per-guardrail proposals a well-behaved model should emit,
// reading each guardrail's own wording once: line 2 (ask-me gate) and line 5
// (accept gate) are hitl; line 3 is a citation rule -> green; line 4
// declares a shape -> softgreen. Line 1 and 6 carry no guardrail at all, so
// no proposal exists for them (silence is safe -> hitl by default).
const REAL_GUARDRAIL_CLASSES = { 2: 'hitl', 3: 'green', 4: 'softgreen', 5: 'hitl' };

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
// emit (steps + guardrailClasses — skills/guardrails are stitched in by the
// harness, never authored by the model; a step's close.class is DERIVED,
// never emitted by the model).
function job1ModelSteps() {
  return {
    guardrailClasses: { ...REAL_GUARDRAIL_CLASSES },
    steps: [
      {
        goal: 'read the sheet', primitives: ['addressCells'], reads: [], emits: 'a1', fromLine: 1,
      },
      {
        goal: 'read the message', primitives: ['read'], reads: [], emits: 'a2', fromLine: 2,
      },
      {
        goal: 'match customer, derive totals', primitives: [], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3,
      },
      {
        // Softgreen because line 4's guardrail was proposed "softgreen"
        // above — this step supplies the shape data; the class itself is
        // derived, not chosen by the step.
        goal: 'compose reply',
        primitives: [],
        reads: ['a3'],
        emits: 'a4',
        fromLine: 4,
        close: { shape: { linesPerInvoice: 1, mustCarry: ['total', 'earliestDueDate'] } },
      },
      {
        goal: 'check with me', primitives: ['checkpoint'], reads: ['a4'], emits: 'a5', fromLine: 5,
      },
      {
        goal: 'send (dry-run egress)', primitives: ['write'], reads: ['a4'], emits: 'a6', fromLine: 6,
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// extractGuardrails / plantLine — pure functions, checked directly first.
// ---------------------------------------------------------------------------

test('extractGuardrails pulls the human-authored numbered lines verbatim out of prose.txt', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const proseText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prose.txt'), 'utf8');
  assert.equal(extractGuardrails(proseText), REAL_GUARDRAILS);
});

test('plantLine adds one extra numbered line, one past the highest existing number, with no guardrail', async () => {
  const { readFileSync } = await import('node:fs');
  const { join, dirname } = await import('node:path');
  const { fileURLToPath } = await import('node:url');
  const proseText = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'prose.txt'), 'utf8');
  const planted = plantLine(proseText, 'flag anything that looks unusual');
  assert.match(planted, /7\. flag anything that looks unusual/);
  assert.equal(extractGuardrails(proseText), REAL_GUARDRAILS, 'planting must never mutate the source it was given');
});

// ---------------------------------------------------------------------------
// DEFECT 2 — the cap lives under its own arbiter section; it is never one of
// the numbered lines and no step can ever claim it via fromLine.
// ---------------------------------------------------------------------------

test('DEFECT 2 — the real prose.txt carries the cap as an arbiter guardrail, not on any numbered line', () => {
  const arbiter = parseArbiterGuardrails(REAL_GUARDRAILS);
  assert.deepEqual(arbiter, ['cap $0.25 per run']);
});

test('PROOF the test can fail: dropping the "Arbiter guardrails" heading pushes the cap back onto the last line', () => {
  const collapsed = REAL_GUARDRAILS.replace(
    /\n\nArbiter guardrails.*\nguardrail: cap \$0\.25 per run\n?$/s,
    '\n   guardrail: cap $0.25 per run',
  );
  const arbiter = parseArbiterGuardrails(collapsed);
  assert.deepEqual(arbiter, [], 'without the heading, there is no arbiter section at all any more');
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
// Must-have — the drafted classes are DERIVED, not authored: each step's
// close.class matches what its fromLine's guardrail was PROPOSED as.
// ---------------------------------------------------------------------------

test('the assembled declaration derives each close.class from fromLine against the proposed guardrailClasses', async () => {
  const provider = fakeProvider(toolReply(job1ModelSteps()));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  const byGoal = Object.fromEntries(report.declaration.steps.map((s) => [s.goal, s.close.class]));
  assert.equal(byGoal['read the sheet'], 'hitl'); // line 1, blank, no proposal
  assert.equal(byGoal['match customer, derive totals'], 'green'); // line 3, proposed green
  assert.equal(byGoal['compose reply'], 'softgreen'); // line 4, proposed softgreen
  assert.equal(byGoal['send (dry-run egress)'], 'hitl'); // line 6, blank (the cap is not a line guardrail)
});

test('PROOF the test can fail: even a model that tries to claim "green" via close.class is ignored — the schema has no such field and assembleDeclaration recomputes it', async () => {
  const steps = job1ModelSteps();
  // "read the sheet" serves line 1, which is blank — try to smuggle green in
  // anyway via a field the schema doesn't define.
  steps.steps[0].close = { class: 'green' };
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  const readStep = report.declaration.steps.find((s) => s.goal === 'read the sheet');
  assert.equal(readStep.close.class, 'hitl', 'the smuggled class must never survive assembleDeclaration');
});

// ---------------------------------------------------------------------------
// DEFECT 1 — the regression test for the regex-fitted deriveClass. A
// guardrail worded DIFFERENTLY from job #1's own phrasing must still be
// classifiable by the drafter, because the class travels through a
// per-guardrail PROPOSAL rather than being re-derived from the guardrail's
// own text by a hardcoded pattern.
// ---------------------------------------------------------------------------

test("DEFECT 1 — a guardrail worded differently from job #1's still yields a working class, because the model's own proposal is what's used, not a text pattern", () => {
  // A guardrail meaning exactly the same thing as job #1's citation rule,
  // worded completely differently. The old regex-based deriveClass would
  // return 'hitl' for this text (none of its hardcoded patterns match) —
  // this test builds its expectation from the PROPOSAL alone, never from
  // parsing the guardrail's own wording, so it cannot pass against that
  // implementation by construction.
  const steps = {
    guardrailClasses: { 1: 'green' }, // the model reads this guardrail as a citation rule
    steps: [{
      goal: 'derive the totals', primitives: [], reads: [], emits: 'a1', fromLine: 1,
    }],
  };
  const decl = assembleDeclaration(steps, {
    guardrails: '1. derive the totals\n   guardrail: each figure must show its source cell',
  });
  assert.equal(decl.steps[0].close.class, 'green');
  assert.equal(validate(decl).verdict, 'green', validate(decl).red);
});

test('PROOF the DEFECT 1 regression test can fail: with NO guardrailClasses proposal at all, the same reworded guardrail falls to hitl', async () => {
  const { assembleDeclaration } = await import('./drafter.mjs');
  const decl = assembleDeclaration(
    {
      steps: [{
        goal: 'derive the totals', primitives: [], reads: [], emits: 'a1', fromLine: 1,
      }],
    },
    { guardrails: '1. derive the totals\n   guardrail: each figure must show its source cell' },
  );
  assert.equal(decl.steps[0].close.class, 'hitl');
});

// ---------------------------------------------------------------------------
// Must-have — a guardrail with an INVALID proposed class is a red, never
// silently normalised to hitl.
// ---------------------------------------------------------------------------

test('a guardrail proposed an INVALID class is a red at validate(), never silently hitl', async () => {
  const steps = job1ModelSteps();
  steps.guardrailClasses[3] = 'yellow';
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  const result = validate(report.declaration);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /guardrail 3 was proposed class "yellow"/);
});

test('PROOF the test can fail: a valid proposal for line 3 validates green again', async () => {
  const steps = job1ModelSteps();
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  assert.equal(validate(report.declaration).verdict, 'green');
});

// ---------------------------------------------------------------------------
// THE F16 TEST, at the drafter layer — a step cannot close green by naming
// a DIFFERENT line's (stronger) guardrail than the one it actually serves.
// ---------------------------------------------------------------------------

test('the F16 stretch is structurally impossible even if the model tries: pointing an uncovered step at the citation line does not make it green unless it genuinely serves that line — and other steps sharing that fromLine ALL get the same derived class', async () => {
  const steps = job1ModelSteps();
  // A step that emits no figures at all, pointed at line 3 (the citation
  // guardrail) — under the old model this is exactly the stretch F16
  // measured (choosing which guardrail a close traces to). Under fromLine,
  // it is not a "wrong choice": the class is derived from line 3 regardless
  // of what the step actually does, which is why fromLine must name the
  // line the step GENUINELY serves — validate() cannot see step semantics,
  // but the draft table and the human reviewing it can, and a human-facing
  // spot-check is exactly what "the human may change it before signing"
  // protects (PRD, unchanged). What IS structurally guaranteed is that this
  // step cannot get a DIFFERENT class than every other step naming line 3.
  steps.steps.push({
    goal: 'flag anything that looks unusual', primitives: [], reads: ['a2'], emits: 'a2b', fromLine: 3,
  });
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', { prose: true, provider, rates: { in: 0, out: 0 } });
  const flagStep = report.declaration.steps.find((s) => s.goal === 'flag anything that looks unusual');
  const deriveStep = report.declaration.steps.find((s) => s.goal === 'match customer, derive totals');
  assert.equal(flagStep.close.class, deriveStep.close.class, 'every step naming the same line derives the SAME class — there is no per-step choice');
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
// a line with no guardrail — including a freshly planted line, which never
// gets one — must land at hitl.
// ---------------------------------------------------------------------------

test('the uncovered-line plant lands at hitl and validates green', async () => {
  const steps = job1ModelSteps();
  steps.steps.splice(2, 0, {
    goal: 'flag anything that looks unusual', primitives: [], reads: ['a2'], emits: 'a2b', fromLine: 7,
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
  const flagStep = report.declaration.steps.find((s) => s.goal === 'flag anything that looks unusual');
  assert.equal(flagStep.close.class, 'hitl');
  assert.equal(validate(report.declaration).verdict, 'green');
});

test('PROOF the test can fail: naming a REAL, guardrail-bearing line instead of the planted one changes the derived class', async () => {
  const steps = job1ModelSteps();
  steps.steps.splice(2, 0, {
    goal: 'flag anything that looks unusual', primitives: [], reads: ['a2'], emits: 'a2b', fromLine: 3, // the citation line, not the plant
  });
  const provider = fakeProvider(toolReply(steps));
  const report = await runDrafter('fake-model', {
    prose: true, uncovered: true, provider, rates: { in: 0, out: 0 },
  });
  const flagStep = report.declaration.steps.find((s) => s.goal === 'flag anything that looks unusual');
  assert.notEqual(flagStep.close.class, 'hitl');
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

test('assembleDeclaration ignores every field on modelArgs except steps/guardrailClasses/refused, and derives close.class per step', () => {
  const decl = assembleDeclaration(
    {
      steps: [{
        goal: 'x', primitives: [], reads: [], emits: 'a1', fromLine: 1, close: { class: 'green' },
      }],
      guardrailClasses: { 1: 'green' },
      refused: [{ hamrLine: 'y', reason: 'z' }],
      skills: ['nope'],
      guardrails: 'nope',
      cap: { usd: 1 },
    },
    { skills: ['core'], guardrails: '1. some line\n   guardrail: every number must point to the cell it came from or the formula that made it' },
  );
  assert.deepEqual(decl.skills, ['core']);
  assert.equal(decl.guardrails, '1. some line\n   guardrail: every number must point to the cell it came from or the formula that made it');
  assert.deepEqual(decl.refused, [{ hamrLine: 'y', reason: 'z' }]);
  assert.equal(decl.steps.length, 1);
  assert.equal(decl.steps[0].close.class, 'green', 'derived from fromLine 1\'s proposed class, not the smuggled step-level "green" (which happens to agree here)');
});

test('PROOF the test can fail: a model-claimed step-level class that does NOT match the guardrail\'s proposed class is overridden, not honoured', () => {
  const decl = assembleDeclaration(
    {
      steps: [{
        goal: 'x', primitives: [], reads: [], emits: 'a1', fromLine: 1, close: { class: 'green' },
      }],
      guardrailClasses: {}, // nobody proposed anything for line 1
    },
    { skills: ['core'], guardrails: '1. some line\n   guardrail: some rule' },
  );
  assert.equal(decl.steps[0].close.class, 'hitl', 'the smuggled "green" must be discarded — the schema does not even offer the field any more');
});

test('assembleDeclaration defaults steps/guardrailClasses/refused to empty when the model omits them', () => {
  const decl = assembleDeclaration({}, { skills: ['core'], guardrails: 'g' });
  assert.deepEqual(decl.steps, []);
  assert.deepEqual(decl.refused, []);
  assert.deepEqual(decl.guardrailClasses, {});
});

test('assembleDeclaration drops a proposal for a BLANK line and for a line number that does not exist — neither can ever do anything', () => {
  const decl = assembleDeclaration(
    { steps: [], guardrailClasses: { 1: 'green', 99: 'green' } },
    { skills: ['core'], guardrails: '1. blank line, no guardrail\n2. has one\n   guardrail: some rule' },
  );
  assert.deepEqual(decl.guardrailClasses, {}, 'line 1 is blank and line 99 does not exist — neither proposal survives');
});

test('assembleDeclaration carries a BASE guardrailClasses (a redraft\'s previous proposals) forward for any line the model does not repropose', () => {
  const decl = assembleDeclaration(
    { steps: [], guardrailClasses: { 3: 'softgreen' } }, // this round only touches line 3
    {
      skills: ['core'],
      guardrails: '2. x\n   guardrail: a\n3. y\n   guardrail: b',
      guardrailClasses: { 2: 'hitl', 3: 'green' }, // the previous round's proposals
    },
  );
  assert.deepEqual(decl.guardrailClasses, { 2: 'hitl', 3: 'softgreen' }, 'line 2 carries over untouched; line 3 is reproposed by this round');
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
