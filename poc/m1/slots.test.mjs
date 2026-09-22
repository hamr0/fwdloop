// Tests for the M1 ask-slot mechanism (poc/m1/slots.mjs) — $0, zero model
// calls, zero network, pure functions over plain data. Every red case below
// is paired with a PROOF test that the same base declaration goes GREEN
// once the one defect it names is removed, so each check is shown able to
// produce both outcomes, never just the negative.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAskSlots, checkAskSlots } from './slots.mjs';

// M1 amendment 3 (signed 2026-09-21): the ask is now a MARK on the numbered
// line's own text, never the bottom-block "ask at line N" form.
const RAW_TEXT = [
  '1. read the sheet',
  '2. read the message and work out which customer it is about.',
  '   guardrail: if more than one customer matches, ask me, do not pick',
  '3. derive the figures',
  '4. compose the reply',
  '5. ask: check it with me,',
  '   guardrail: nothing goes out before I accept',
  '6. send it once I accept.',
  '',
  'Arbiter guardrails (belong to no line):',
  'guardrail: cap $0.25 per run',
  'guardrail: send at line 6 to file:poc/m0/out',
].join('\n');

// ---------------------------------------------------------------------------
// parseAskSlots
// ---------------------------------------------------------------------------

test('parseAskSlots collects a single signed ask mark', () => {
  const { lines, errors } = parseAskSlots(RAW_TEXT);
  assert.deepEqual(lines, [5]);
  assert.deepEqual(errors, []);
});

test('parseAskSlots collects EVERY ask mark, sorted, over m0\'s parseArbiterSlots which keeps only the last', () => {
  const multi = RAW_TEXT.replace(
    '2. read the message and work out which customer it is about.',
    '2. ask: which customer is this about?',
  );
  const { lines, errors } = parseAskSlots(multi);
  assert.deepEqual(lines, [2, 5], 'both signed ask lines must survive, sorted ascending');
  assert.deepEqual(errors, []);
});

test('parseAskSlots dedupes a repeated identical ask line (each numbered line appears once by construction)', () => {
  const { lines } = parseAskSlots(RAW_TEXT);
  assert.deepEqual(lines, [5]);
});

test('parseAskSlots names a malformed ask-mark attempt as an error, never silently drops it', () => {
  const malformed = RAW_TEXT.replace('5. ask: check it with me,', '5. ask x check it with me,');
  const { lines, errors } = parseAskSlots(malformed);
  assert.deepEqual(lines, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ask x check it with me,/);
});

test('parseAskSlots leaves other arbiter lines (cap, send) alone', () => {
  const { lines, errors } = parseAskSlots(RAW_TEXT);
  assert.deepEqual(lines, [5]);
  assert.deepEqual(errors, []);
});

test('PROOF the test can fail: a line with no "ask:"/"ask " prefix is never reported as a malformed mark', () => {
  const { errors } = parseAskSlots(RAW_TEXT); // "cap $0.25 per run" / "send at line 6 ..." present, no false positive
  assert.deepEqual(errors, []);
});

// ---------------------------------------------------------------------------
// The retired bottom-block "ask at line N" grammar — refused by name, never
// silently accepted as a slot (M1 amendment 3: this form is no longer
// grammar at all, unlike M0's own parseArbiterSlots which still accepts it
// for M0 fixtures).
// ---------------------------------------------------------------------------

test('parseAskSlots refuses the retired "ask at line N" bottom-block form, naming it, and it is NOT counted as a line', () => {
  const legacy = `${RAW_TEXT}\nguardrail: ask at line 2`;
  const { lines, errors } = parseAskSlots(legacy);
  assert.deepEqual(lines, [5], 'the retired form must never be counted as a signed ask line');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /arbiter guardrail "ask at line 2" is no longer grammar — mark the numbered line itself with "ask:" \(or "ask <int><s\|m\|h>:"\) instead/);
});

test('PROOF the test can fail: removing the retired line leaves no such error', () => {
  const legacy = `${RAW_TEXT}\nguardrail: ask at line 2`;
  assert.equal(parseAskSlots(legacy).errors.length, 1);
  assert.deepEqual(parseAskSlots(RAW_TEXT).errors, []);
});

// ---------------------------------------------------------------------------
// checkAskSlots — a conforming declaration, one signed ask line (5)
// ---------------------------------------------------------------------------

// Note: check (c) reds any ZERO-primitive step at an UNSIGNED line — this is
// deliberately stricter than a real drafted declaration's "match a customer,
// derive figures" step (poc/m0/catalogue.mjs's JOB1_NEEDS: `own: true`, no
// primitive at all) would normally carry. That mechanical shape check is
// exactly the point: a step with no primitives IS what a pause looks like,
// and the only place that shape is allowed to appear is a signed ask line.
// So this fixture's derive/compose steps carry a placeholder "read" grant
// purely to stay out of check (c)'s way while exercising (a)/(b) in
// isolation — the m0 catalogue's own "own: true" (no-primitive) rows are
// exactly the case checkAskSlots' header calls out as this check's known,
// deliberate shape.
function conformingDeclaration() {
  return {
    steps: [
      { goal: 'read sheet', primitives: ['addressCells'], reads: [], emits: 'a1', fromLine: 1 },
      { goal: 'read message', primitives: ['read'], reads: [], emits: 'a2', fromLine: 2 },
      { goal: 'derive', primitives: ['read'], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3 },
      { goal: 'compose', primitives: ['read'], reads: ['a3'], emits: 'a4', fromLine: 4 },
      {
        goal: 'ask', primitives: [], reads: ['a4'], emits: 'a5', fromLine: 5, close: { class: 'hitl' },
      },
      { goal: 'send', primitives: ['write'], reads: ['a5'], emits: 'a6', fromLine: 6 },
    ],
  };
}

test('checkAskSlots: green on a conforming declaration', () => {
  const result = checkAskSlots(conformingDeclaration(), [5]);
  assert.deepEqual(result, { verdict: 'green' });
});

// --- (a) 0 steps at the signed line ---

test('checkAskSlots (a): 0 steps at a signed ask line is red, naming the line', () => {
  const decl = conformingDeclaration();
  decl.steps = decl.steps.filter((st) => st.fromLine !== 5); // drop the ask step entirely
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /ask at line 5 has no step/);
});

test('PROOF (a)/0-steps: restoring the ask step turns the same declaration green', () => {
  const decl = conformingDeclaration();
  decl.steps = decl.steps.filter((st) => st.fromLine !== 5);
  assert.equal(checkAskSlots(decl, [5]).verdict, 'red');
  const restored = conformingDeclaration();
  assert.equal(checkAskSlots(restored, [5]).verdict, 'green');
});

// --- (a) 2+ steps at the signed line ---

test('checkAskSlots (a): 2+ steps at a signed ask line is red, naming the count', () => {
  const decl = conformingDeclaration();
  decl.steps.push({
    goal: 'ask again', primitives: [], reads: ['a4'], emits: 'a5b', fromLine: 5, close: { class: 'hitl' },
  });
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /ask at line 5 has 2 steps bound to it — exactly 1 required/);
});

test('PROOF (a)/2-steps: removing the duplicate turns the same declaration green', () => {
  const decl = conformingDeclaration();
  decl.steps.push({
    goal: 'ask again', primitives: [], reads: ['a4'], emits: 'a5b', fromLine: 5, close: { class: 'hitl' },
  });
  assert.equal(checkAskSlots(decl, [5]).verdict, 'red');
  const fixed = conformingDeclaration();
  assert.equal(checkAskSlots(fixed, [5]).verdict, 'green');
});

// --- (a) wrong class ---

test('checkAskSlots (a): a signed ask step whose close.class is not "hitl" is red, naming the class found', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 5).close = { class: 'green' };
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class is "green" — must be "hitl"/);
});

test('PROOF (a)/wrong-class: setting close.class back to "hitl" turns the same declaration green', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 5).close = { class: 'green' };
  assert.equal(checkAskSlots(decl, [5]).verdict, 'red');
  const fixed = conformingDeclaration();
  assert.equal(checkAskSlots(fixed, [5]).verdict, 'green');
});

// --- (a2) stop only — the signed ask step grants no primitive ---
//
// RED-FIRST (M1 amendment 3 item 4, 2026-09-21): before this check existed,
// a signed ask step carrying work (a primitive) validated GREEN — quoted in
// this file's report. The fix reds it, naming the line, the step, and the
// verbs granted.

test('checkAskSlots (a2): the signed ask step granting a primitive is red, naming the line, step, and verbs', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 5).primitives = ['write'];
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /ask at line 5 \(step 5\) is a stop only — granting \[write\] is work, which belongs on its own line/);
});

test('PROOF (a2): dropping the primitive back to [] turns the same declaration green', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 5).primitives = ['write'];
  assert.equal(checkAskSlots(decl, [5]).verdict, 'red');
  const fixed = conformingDeclaration();
  assert.equal(checkAskSlots(fixed, [5]).verdict, 'green');
});

// --- (b) checkpoint grant ---

// (b) is exercised on line 4 (compose), NOT the signed ask line 5 — a
// "checkpoint" grant AT the signed line is now caught first by (a2) (it is
// also a primitive on the stop-only step), so isolating (b) needs a
// checkpoint grant somewhere else entirely.
test('checkAskSlots (b): any step granting "checkpoint" is red, naming the step and line — F10\'s exact leak', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 4).primitives = ['checkpoint'];
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 4 \(line 4\) grants "checkpoint" — the pause belongs to the runner, never the drafter/);
});

test('PROOF (b): dropping the "checkpoint" grant turns the same declaration green', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 4).primitives = ['checkpoint'];
  assert.equal(checkAskSlots(decl, [5]).verdict, 'red');
  const fixed = conformingDeclaration();
  assert.equal(checkAskSlots(fixed, [5]).verdict, 'green');
});

test('checkAskSlots (a2) vs (b): a "checkpoint" grant AT the signed ask line is caught by (a2) first (checkpoint is itself work)', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 5).primitives = ['checkpoint'];
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /ask at line 5 \(step 5\) is a stop only — granting \[checkpoint\] is work/);
});

// --- (c) unsigned pause ---
//
// RED-FIRST (2026-09-21): checkAskSlots' live batch (poc/m1/out/slot-batch-
// slot-2026-09-21c/draft-{1,5,12}.json) reds 3/20 declarations at their
// DERIVE step — fromLine 3, close.class "green", primitives [] — which is
// not a pause at all. poc/m0/catalogue.mjs's JOB1_NEEDS row `{ need: 'match
// a customer, derive figures', own: true }` is fwdloop's OWN model round: it
// takes no catalogue primitive by design, and a "green" close is closed by
// the MACHINE (validator.mjs), never a human. Check (c) as first specified
// ("zero primitives" alone) mistook that shape for a pause. The mechanical
// shape of a pause is a step that does nothing AND waits on a human: zero
// primitives AND close.class === 'hitl'. The test below is the RED this
// file started at against the OLD check (c) — the assertion is GREEN, but
// the code at the time returned red `slot: step 1 (line 3) is a pause (no
// primitives) at an unsigned line`, quoted verbatim in the commit that adds
// this test.

test('checkAskSlots (c) RED-FIRST: a green-class, zero-primitive DERIVE step at an unsigned line is not a pause — green', () => {
  const decl = {
    steps: [
      { goal: 'read sheet', primitives: ['addressCells'], reads: [], emits: 'a1', fromLine: 1 },
      { goal: 'read message', primitives: ['read'], reads: [], emits: 'a2', fromLine: 2 },
      // fwdloop's own model round (JOB1_NEEDS: own: true) — no primitive,
      // closed green by the machine, at an UNSIGNED line (3). Not a pause.
      {
        goal: 'derive', primitives: [], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3, close: { class: 'green' },
      },
      {
        goal: 'ask', primitives: [], reads: ['a3'], emits: 'a4', fromLine: 5, close: { class: 'hitl' },
      },
    ],
  };
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'green', `expected green, got: ${JSON.stringify(result)}`);
});

test('checkAskSlots (c): a zero-primitive HITL step at an unsigned line is red — the mechanical shape of an unsigned pause', () => {
  const decl = conformingDeclaration();
  // line 4 (compose) is not a signed ask line, drops all primitives AND
  // waits on a human — exactly the shape F10 measured: a pause with nothing
  // signing it.
  const composeStep = decl.steps.find((st) => st.fromLine === 4);
  composeStep.primitives = [];
  composeStep.close = { class: 'hitl' };
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 4 \(line 4\) is a pause \(no primitives, hitl\) at an unsigned line/);
});

test('PROOF (c): granting compose a primitive back turns the same declaration green', () => {
  const decl = conformingDeclaration();
  const composeStep = decl.steps.find((st) => st.fromLine === 4);
  composeStep.primitives = [];
  composeStep.close = { class: 'hitl' };
  assert.equal(checkAskSlots(decl, [5]).verdict, 'red');
  const fixed = conformingDeclaration();
  assert.equal(checkAskSlots(fixed, [5]).verdict, 'green');
});

// --- tolerant of nothing: never throws ---

test('checkAskSlots never throws: non-array "steps" is a red', () => {
  assert.doesNotThrow(() => checkAskSlots({ steps: 'nope' }, [5]));
  const result = checkAskSlots({ steps: 'nope' }, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /"steps" must be an array/);
});

test('checkAskSlots never throws: a non-object step is a red, naming its position', () => {
  const decl = conformingDeclaration();
  decl.steps[2] = null;
  assert.doesNotThrow(() => checkAskSlots(decl, [5]));
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 3 is not an object/);
});

test('checkAskSlots never throws: a non-object declaration is a red', () => {
  assert.doesNotThrow(() => checkAskSlots('nope', [5]));
  assert.equal(checkAskSlots('nope', [5]).verdict, 'red');
  assert.doesNotThrow(() => checkAskSlots(null, [5]));
  assert.equal(checkAskSlots(null, [5]).verdict, 'red');
});

test('checkAskSlots with no signed ask lines at all: only checks (b) and (c) still apply', () => {
  const decl = conformingDeclaration();
  // No signed lines means the ask step itself (fromLine 5, zero primitives) is now an
  // unsigned pause — this is (c) firing correctly, not a bug in the empty-slots path.
  // It is the FIRST zero-primitive step in declared order, so it is the one named.
  const result = checkAskSlots(decl, []);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 5 \(line 5\) is a pause \(no primitives, hitl\) at an unsigned line/);
});
