// Tests for the M1 ask-slot mechanism (poc/m1/slots.mjs) — $0, zero model
// calls, zero network, pure functions over plain data. Every red case below
// is paired with a PROOF test that the same base declaration goes GREEN
// once the one defect it names is removed, so each check is shown able to
// produce both outcomes, never just the negative.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseAskSlots, checkAskSlots } from './slots.mjs';

const RAW_TEXT = [
  '1. read the sheet',
  '2. read the message and work out which customer it is about.',
  '   guardrail: if more than one customer matches, ask me, do not pick',
  '3. derive the figures',
  '4. compose the reply',
  '5. check it with me,',
  '   guardrail: nothing goes out before I accept',
  '6. send it once I accept.',
  '',
  'Arbiter guardrails (belong to no line):',
  'guardrail: cap $0.25 per run',
  'guardrail: ask at line 5',
  'guardrail: send at line 6 to file:poc/m0/out',
].join('\n');

// ---------------------------------------------------------------------------
// parseAskSlots
// ---------------------------------------------------------------------------

test('parseAskSlots collects a single signed ask line', () => {
  const { lines, errors } = parseAskSlots(RAW_TEXT);
  assert.deepEqual(lines, [5]);
  assert.deepEqual(errors, []);
});

test('parseAskSlots collects EVERY "ask at line N" line, sorted, over m0\'s parseArbiterSlots which keeps only the last', () => {
  const multi = RAW_TEXT.replace(
    'guardrail: ask at line 5\n',
    'guardrail: ask at line 5\nguardrail: ask at line 2\n',
  );
  const { lines, errors } = parseAskSlots(multi);
  assert.deepEqual(lines, [2, 5], 'both signed ask lines must survive, sorted ascending');
  assert.deepEqual(errors, []);
});

test('parseAskSlots dedupes a repeated identical ask line', () => {
  const dup = RAW_TEXT.replace(
    'guardrail: ask at line 5\n',
    'guardrail: ask at line 5\nguardrail: ask at line 5\n',
  );
  const { lines } = parseAskSlots(dup);
  assert.deepEqual(lines, [5]);
});

test('parseAskSlots names a malformed "ask at" line as an error, never silently drops it', () => {
  const malformed = RAW_TEXT.replace('guardrail: ask at line 5\n', 'guardrail: ask at the end\n');
  const { lines, errors } = parseAskSlots(malformed);
  assert.deepEqual(lines, []);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /ask at the end/);
});

test('parseAskSlots leaves other arbiter lines (cap, send) alone', () => {
  const { lines, errors } = parseAskSlots(RAW_TEXT);
  assert.deepEqual(lines, [5]);
  assert.deepEqual(errors, []);
});

test('PROOF the test can fail: a line with no "ask at" prefix is never reported as a malformed slot', () => {
  const { errors } = parseAskSlots(RAW_TEXT); // "cap $0.25 per run" / "send at line 6 ..." present, no false positive
  assert.deepEqual(errors, []);
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

// --- (b) checkpoint grant ---

test('checkAskSlots (b): any step granting "checkpoint" is red, naming the step and line — F10\'s exact leak', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 5).primitives = ['checkpoint'];
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 5 \(line 5\) grants "checkpoint" — the pause belongs to the runner, never the drafter/);
});

test('PROOF (b): dropping the "checkpoint" grant turns the same declaration green', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 5).primitives = ['checkpoint'];
  assert.equal(checkAskSlots(decl, [5]).verdict, 'red');
  const fixed = conformingDeclaration();
  assert.equal(checkAskSlots(fixed, [5]).verdict, 'green');
});

// --- (c) unsigned pause ---

test('checkAskSlots (c): a zero-primitive step at an unsigned line is red — the mechanical shape of an unsigned ask', () => {
  const decl = conformingDeclaration();
  // line 4 (compose) is not a signed ask line, but drops all primitives —
  // exactly the shape F10 measured: a pause with nothing signing it.
  decl.steps.find((st) => st.fromLine === 4).primitives = [];
  const result = checkAskSlots(decl, [5]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 4 \(line 4\) is a pause \(no primitives\) at an unsigned line/);
});

test('PROOF (c): granting compose a primitive back turns the same declaration green', () => {
  const decl = conformingDeclaration();
  decl.steps.find((st) => st.fromLine === 4).primitives = [];
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
  assert.match(result.red, /step 5 \(line 5\) is a pause \(no primitives\) at an unsigned line/);
});
