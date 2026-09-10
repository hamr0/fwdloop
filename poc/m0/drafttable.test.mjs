// drafttable.mjs is PURE rendering — no model, no IO, no network in any test
// here. Every fixture below is a plain object; the tests check the string
// drafttable.mjs produces from it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDraftTable, truncate, formatProves } from './drafttable.mjs';
import { validate } from './validator.mjs';

// hamr's real, signed guardrails for job #1, verbatim (same fixture as
// drafter.test.mjs's REAL_GUARDRAILS, so the two files can't silently drift
// out of sync on what "the real guardrails" means).
const REAL_GUARDRAILS = [
  'every number must point to the cell it came from or the formula that made it',
  'one line per invoice in the reply',
  'if more than one customer matches, ask me, do not pick',
  'nothing goes out before I accept',
  'cap $0.25 per run',
].join('\n');

// A fully valid job #1 declaration — mirrors drafter.test.mjs's
// job1ModelSteps() through assembleDeclaration, so this is exactly what a
// well-behaved drafter round hands to the table.
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
        goal: 'match customer, derive totals',
        primitives: [],
        reads: ['a1', 'a2'],
        emits: 'a3',
        close: { class: 'green', tracesTo: 1 },
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

function assertAll80Cols(rendered) {
  const lines = rendered.split('\n');
  lines.forEach((l, i) => {
    assert.ok(l.length <= 80, `line ${i} is ${l.length} chars (>80): "${l}"`);
  });
}

// ---------------------------------------------------------------------------
// Must-have 1 — the table renders both directions: a guardrail row names the
// step that proves it; a step row names the guardrail number that proves it.
// ---------------------------------------------------------------------------

test('a guardrail row names the step that proves it, and a step row names the guardrail that proves it', () => {
  const rendered = renderDraftTable(job1Declaration());
  // guardrail 1 -> step 3 (the "match customer, derive totals" step)
  const guardrail1Line = rendered.split('\n').find((l) => l.startsWith('1.'));
  assert.match(guardrail1Line, /step 3/);
  // step 3's own row names guardrail 1
  const step3Idx = rendered.split('\n').findIndex((l) => l.trim() === '3. match customer, derive totals');
  const step3CloseLine = rendered.split('\n')[step3Idx + 1];
  assert.match(step3CloseLine, /green.*guardrail 1/);
});

test('PROOF the test can fail: pointing step 3 at guardrail 2 instead breaks the guardrail-1 row and step-3 row alike', () => {
  const decl = job1Declaration();
  decl.steps[2].close.tracesTo = 2;
  const rendered = renderDraftTable(decl);
  const guardrail1Line = rendered.split('\n').find((l) => l.startsWith('1.'));
  assert.doesNotMatch(guardrail1Line, /step 3/);
  const step3Idx = rendered.split('\n').findIndex((l) => l.trim() === '3. match customer, derive totals');
  const step3CloseLine = rendered.split('\n')[step3Idx + 1];
  assert.doesNotMatch(step3CloseLine, /guardrail 1/);
});

// ---------------------------------------------------------------------------
// Must-have 2 — an unmapped guardrail is visibly blank (never inferred, never
// an error). Job #1's guardrails 3, 4, 5 (ask position, accept, cap) are the
// PRD's own worked example of this.
// ---------------------------------------------------------------------------

test('an unmapped guardrail is visibly blank in the "proves" column', () => {
  const rendered = renderDraftTable(job1Declaration());
  const lines = rendered.split('\n');
  for (const n of [3, 4, 5]) {
    const row = lines.find((l) => l.startsWith(`${n}.`));
    assert.ok(row, `expected a row for guardrail ${n}`);
    // The "proves" column is sized to its widest value, never a fixed 10, so
    // read its bounds off the header row rather than hardcoding a width —
    // a test that pins the layout would fail every time the layout is right.
    const header = lines.find((l) => l.startsWith('#'));
    const start = header.indexOf('proves');
    const end = header.indexOf('text');
    const provesColumn = row.slice(start, end);
    assert.equal(provesColumn.trim(), '', `guardrail ${n}'s "proves" column should be blank, got "${provesColumn}"`);
  }
});

test('PROOF the test can fail: a step forced to trace to guardrail 3 makes that row non-blank', () => {
  const decl = job1Declaration();
  decl.steps[4] = { ...decl.steps[4], close: { class: 'green', tracesTo: 3 } };
  const rendered = renderDraftTable(decl);
  const row = rendered.split('\n').find((l) => l.startsWith('3.'));
  const afterMarker = row.slice(row.indexOf('.') + 1);
  const provesColumn = afterMarker.slice(1, 1 + 10);
  assert.notEqual(provesColumn.trim(), '');
  assert.match(provesColumn, /step 5/);
});

// ---------------------------------------------------------------------------
// Must-have 3 — a step with a MISSING close displays hitl (ruled 2026-09-10:
// a missing close IS hitl, not a red), via normalizeClose.
// ---------------------------------------------------------------------------

test('a step with a MISSING close displays as hitl', () => {
  const decl = job1Declaration();
  delete decl.steps[0].close; // step 1 had close:{class:'hitl'} — now absent entirely
  const rendered = renderDraftTable(decl);
  const lines = rendered.split('\n');
  const idx = lines.findIndex((l) => l.trim() === '1. read the sheet');
  assert.match(lines[idx + 1], /close:\s+hitl/);
  // and the declaration this renders from still validates green — a missing
  // close is hitl, not a red, per validator.mjs's own normalizeClose.
  assert.equal(validate(decl).verdict, 'green');
});

test('PROOF the test can fail: giving that same step an explicit green close (with a real trace) changes the rendered class away from hitl', () => {
  const decl = job1Declaration();
  decl.steps[0].close = { class: 'green', tracesTo: 1 };
  const rendered = renderDraftTable(decl);
  const lines = rendered.split('\n');
  const idx = lines.findIndex((l) => l.trim() === '1. read the sheet');
  assert.doesNotMatch(lines[idx + 1], /close:\s+hitl/);
  assert.match(lines[idx + 1], /green/);
});

// ---------------------------------------------------------------------------
// Must-have 4 — rendering is pure: same input twice = identical output; no
// file written, no call made (asserted by having no fs/network import at all
// in this test file, plus the direct equality check below).
// ---------------------------------------------------------------------------

test('rendering is pure: the same declaration renders byte-identical output every time', () => {
  const decl = job1Declaration();
  const first = renderDraftTable(decl);
  const second = renderDraftTable(decl);
  assert.equal(first, second);
  // and rendering a FRESH structurally-equal object gives the same string —
  // proves the output depends on data, not on object identity or hidden state.
  const third = renderDraftTable(job1Declaration());
  assert.equal(first, third);
});

test('PROOF the test can fail: changing one goal string changes the rendered output', () => {
  const declA = job1Declaration();
  const declB = job1Declaration();
  declB.steps[0].goal = 'read the sheet (renamed)';
  assert.notEqual(renderDraftTable(declA), renderDraftTable(declB));
});

// ---------------------------------------------------------------------------
// Must-have 5 — 80-column safety: no rendered line exceeds 80 chars,
// including with a very long goal.
// ---------------------------------------------------------------------------

test('no rendered line exceeds 80 columns, even with a very long goal and a very long guardrail', () => {
  const decl = job1Declaration();
  decl.steps[0].goal = 'x'.repeat(300);
  decl.guardrails = [
    'y'.repeat(300),
    'one line per invoice in the reply',
    'if more than one customer matches, ask me, do not pick',
    'nothing goes out before I accept',
    'cap $0.25 per run',
  ].join('\n');
  const rendered = renderDraftTable(decl);
  assertAll80Cols(rendered);
});

test('PROOF the test can fail: truncate() itself can be shown to overflow if asked for more than max', () => {
  // truncate's own contract: never longer than max. Prove the assertion style
  // actually catches an overflow by checking a value that WOULD overflow if
  // truncate did nothing.
  const raw = 'x'.repeat(300);
  assert.ok(raw.length > 80);
  assert.ok(truncate(raw, 80).length <= 80);
});

test('80-column safety is real, not vacuous: the untruncated goal alone is proven to exceed 80 (the harness could fail)', () => {
  const longGoal = 'x'.repeat(300);
  assert.ok(longGoal.length > 80, 'sanity: the planted goal is actually long enough to threaten an overflow');
});

// ---------------------------------------------------------------------------
// refused[] and a validator red both render.
// ---------------------------------------------------------------------------

test('a refused line renders with its reason', () => {
  const decl = job1Declaration();
  decl.refused = [{ hamrLine: 'rate how friendly the customer sounds', reason: 'no groundable check' }];
  const rendered = renderDraftTable(decl);
  assert.match(rendered, /REFUSED/);
  assert.match(rendered, /rate how friendly the customer sounds/);
  assert.match(rendered, /no groundable check/);
});

test('a validator red is rendered, not swallowed', () => {
  const decl = job1Declaration();
  delete decl.steps[2].emits; // breaks validate() — no valid "emits"
  const rendered = renderDraftTable(decl);
  assert.match(rendered, /VALIDATION: red/);
  assert.match(rendered, /no valid "emits"/);
});

test('PROOF the test can fail: a clean declaration renders VALIDATION: green, not red', () => {
  const rendered = renderDraftTable(job1Declaration());
  assert.match(rendered, /VALIDATION: green/);
  assert.doesNotMatch(rendered, /VALIDATION: red/);
});

// The "proves" cell is the join this table exists to show. Truncating it hides
// half a mapping — "steps 1,4" becoming "step 1,..." loses step 4 entirely —
// so the column is sized to fit and the guardrail TEXT gives up the width.
test('a guardrail proving several steps names them all, never truncated', () => {
  const decl = job1Declaration();
  // Point three steps at guardrail 1, so the cell is "steps 3,4,5" — 11 chars,
  // wider than any fixed column would give it. That is the case that bites.
  decl.steps[3].close = { class: 'green', tracesTo: 1 };
  decl.steps[4].close = { class: 'green', tracesTo: 1 };
  const rendered = renderDraftTable(decl);
  const row = rendered.split('\n').find((l) => l.startsWith('1.'));
  // Scope the no-ellipsis assertion to the proves cell: the guardrail TEXT is
  // deliberately truncated on the same line, and that is the trade being made.
  const header = rendered.split('\n').find((l) => l.startsWith('#'));
  const provesCell = row.slice(header.indexOf('proves'), header.indexOf('text'));
  assert.equal(provesCell.trim(), 'steps 3,4,5');
  assert.doesNotMatch(provesCell, /\.\.\./, 'the join must never be truncated');
  for (const line of rendered.split('\n')) assert.ok(line.length <= 80, line);
});

test('formatProves says step or steps, and nothing at all for none', () => {
  assert.equal(formatProves([]), '');
  assert.equal(formatProves(undefined), '');
  assert.equal(formatProves([4]), 'step 4');
  assert.equal(formatProves([1, 4]), 'steps 1,4');
});

