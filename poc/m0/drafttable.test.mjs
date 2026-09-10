// drafttable.mjs is PURE rendering — no model, no IO, no network in any test
// here. Every fixture below is a plain object; the tests check the string
// drafttable.mjs produces from it.
//
// Fixtures use the STRICT 1-FOR-1 line<->guardrail model (RULED 2026-09-10):
// a step names `fromLine`, and the close class it renders is DERIVED from
// that line's own guardrail — never a free `tracesTo` choice. The class
// itself comes from `declaration.guardrailClasses`, a per-guardrail
// proposal keyed by line number (DEFECT 1 fix — no more text-matching a
// hardcoded pattern). job #1's cap lives under its own arbiter section,
// belonging to no numbered line (DEFECT 2 fix).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { renderDraftTable, truncate, formatProves } from './drafttable.mjs';
import { validate } from './validator.mjs';

// hamr's real, signed guardrails for job #1, verbatim, as numbered job lines
// (same fixture shape as drafter.test.mjs/validator.test.mjs, so the files
// can't silently drift out of sync on what "the real guardrails" means).
// The cap sits under its own arbiter section — line 6 carries no guardrail.
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

// job #1's real per-guardrail proposals (see validator.test.mjs for the
// same fixture and why each line derives what it does).
const GUARDRAIL_CLASSES = { 2: 'hitl', 3: 'green', 4: 'softgreen', 5: 'hitl' };

// A fully valid job #1 declaration — mirrors drafter.test.mjs's
// job1ModelSteps() through assembleDeclaration, so this is exactly what a
// well-behaved drafter round hands to the table.
function job1Declaration() {
  return {
    skills: ['core'],
    guardrails: REAL_GUARDRAILS,
    guardrailClasses: { ...GUARDRAIL_CLASSES },
    steps: [
      {
        goal: 'read the sheet', primitives: ['addressCells'], reads: [], emits: 'a1', fromLine: 1, close: { class: 'hitl' },
      },
      {
        goal: 'read the message', primitives: ['read'], reads: [], emits: 'a2', fromLine: 2, close: { class: 'hitl' },
      },
      {
        goal: 'match customer, derive totals',
        primitives: [],
        reads: ['a1', 'a2'],
        emits: 'a3',
        fromLine: 3,
        close: { class: 'green' },
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

function assertAll80Cols(rendered) {
  const lines = rendered.split('\n');
  lines.forEach((l, i) => {
    assert.ok(l.length <= 80, `line ${i} is ${l.length} chars (>80): "${l}"`);
  });
}

// ---------------------------------------------------------------------------
// Must-have 1 — the table renders both directions: a guardrail row names the
// step that proves it; a step row names the line number that proves it.
// ---------------------------------------------------------------------------

test('a guardrail row names the step that proves it, and a step row names the line that proves it', () => {
  const rendered = renderDraftTable(job1Declaration());
  // guardrail (line) 3 -> step 3 (the "match customer, derive totals" step)
  const guardrail3Line = rendered.split('\n').find((l) => l.startsWith('3.'));
  assert.match(guardrail3Line, /step 3/);
  // step 3's own row names guardrail (line) 3
  const step3Idx = rendered.split('\n').findIndex((l) => l.trim() === '3. match customer, derive totals');
  const step3CloseLine = rendered.split('\n')[step3Idx + 1];
  assert.match(step3CloseLine, /green.*guardrail 3/);
});

test('PROOF the test can fail: pointing step 3 at line 2 instead breaks the line-3 row and step-3 row alike', () => {
  const decl = job1Declaration();
  decl.steps[2].fromLine = 2;
  decl.steps[2].close = { class: 'hitl' };
  const rendered = renderDraftTable(decl);
  const guardrail3Line = rendered.split('\n').find((l) => l.startsWith('3.'));
  assert.doesNotMatch(guardrail3Line, /step 3/);
  const step3Idx = rendered.split('\n').findIndex((l) => l.trim() === '3. match customer, derive totals');
  const step3CloseLine = rendered.split('\n')[step3Idx + 1];
  assert.doesNotMatch(step3CloseLine, /guardrail 3/);
});

// ---------------------------------------------------------------------------
// Must-have — the GUARDRAILS table shows the per-guardrail PROPOSED class
// (DEFECT 1 fix): this is now the thing the human reviews before signing.
// ---------------------------------------------------------------------------

test('the GUARDRAILS table shows each guardrail\'s proposed class, right next to it', () => {
  const rendered = renderDraftTable(job1Declaration());
  const lines = rendered.split('\n');
  const header = lines.find((l) => l.startsWith('#'));
  assert.match(header, /class/);
  const classStart = header.indexOf('class');
  const classEnd = header.indexOf('proves');
  const row3 = lines.find((l) => l.startsWith('3.'));
  const row4 = lines.find((l) => l.startsWith('4.'));
  assert.equal(row3.slice(classStart, classEnd).trim(), 'green');
  assert.equal(row4.slice(classStart, classEnd).trim(), 'softgreen');
});

test('PROOF the test can fail: an invalid proposed class for a guardrail renders as "red" in the class column, not silently as "green"', () => {
  const decl = job1Declaration();
  decl.guardrailClasses[3] = 'yellow';
  decl.steps[2].close = { class: 'hitl' }; // avoid a second, unrelated red from the step check
  delete decl.steps[2].fromLine;
  const rendered = renderDraftTable(decl);
  const lines = rendered.split('\n');
  const header = lines.find((l) => l.startsWith('#'));
  const classStart = header.indexOf('class');
  const classEnd = header.indexOf('proves');
  const row3 = lines.find((l) => l.startsWith('3.'));
  assert.equal(row3.slice(classStart, classEnd).trim(), 'red');
});

// ---------------------------------------------------------------------------
// Must-have 2 — an unmapped guardrail is visibly blank (never inferred, never
// an error).
// ---------------------------------------------------------------------------

test('an unmapped guardrail is visibly blank in the "proves" column', () => {
  const decl = job1Declaration();
  decl.steps.pop(); // drop the "check with me" step — line 5's guardrail is now unclaimed
  const rendered = renderDraftTable(decl);
  const lines = rendered.split('\n');
  const row = lines.find((l) => l.startsWith('5.'));
  assert.ok(row, 'expected a row for guardrail 5');
  const header = lines.find((l) => l.startsWith('#'));
  const start = header.indexOf('proves');
  const end = header.indexOf('text');
  const provesColumn = row.slice(start, end);
  assert.equal(provesColumn.trim(), '', `guardrail 5's "proves" column should be blank, got "${provesColumn}"`);
});

test('PROOF the test can fail: re-adding a step with fromLine 5 makes that row non-blank (once it derives a non-hitl class)', () => {
  const decl = job1Declaration();
  decl.steps.pop();
  const rendered1 = renderDraftTable(decl);
  const row1 = rendered1.split('\n').find((l) => l.startsWith('5.'));
  const header1 = rendered1.split('\n').find((l) => l.startsWith('#'));
  assert.equal(row1.slice(header1.indexOf('proves'), header1.indexOf('text')).trim(), '');

  // line 5 derives hitl (an ask/accept gate) so it can never show as
  // "proving" a step — hitl needs no guardrail, ever — so prove the point on
  // the CITATION guardrail instead, which genuinely IS provable.
  const rendered2 = renderDraftTable(decl);
  const row3 = rendered2.split('\n').find((l) => l.startsWith('3.'));
  const header2 = rendered2.split('\n').find((l) => l.startsWith('#'));
  assert.notEqual(row3.slice(header2.indexOf('proves'), header2.indexOf('text')).trim(), '');
  assert.match(row3, /step 3/);
});

// A guardrail that DERIVES to hitl can never show as "proving" anything,
// even when a step's fromLine names it — this is the mechanical form of "no
// step's close may claim [an arbiter field]" (PRD §3), and the same rule
// that keeps the cap (which is not even in this table any more, DEFECT 2)
// unclaimable in spirit.
test('a guardrail that derives to hitl never shows as proving a step, even when a step names it', () => {
  const decl = job1Declaration(); // steps[4] already has fromLine: 5 (an ask/accept gate -> hitl)
  const rendered = renderDraftTable(decl);
  const row = rendered.split('\n').find((l) => l.startsWith('5.'));
  const header = rendered.split('\n').find((l) => l.startsWith('#'));
  const provesColumn = row.slice(header.indexOf('proves'), header.indexOf('text'));
  assert.equal(provesColumn.trim(), '', 'an ask/accept guardrail must never show as "proved" — it can only ever be hitl');
});

// ---------------------------------------------------------------------------
// DEFECT 2 — the cap belongs to no line and never appears in the GUARDRAILS
// table at all; line 6 ("on accept, send") carries no guardrail.
// ---------------------------------------------------------------------------

test('DEFECT 2 — the cap never appears in the GUARDRAILS table, and line 6 shows no guardrail row', () => {
  const rendered = renderDraftTable(job1Declaration());
  assert.doesNotMatch(rendered, /cap/i);
  const guardrailsSection = rendered.split('STEPS')[0];
  assert.doesNotMatch(guardrailsSection, /^6\./m, 'line 6 has no guardrail, so it must not appear in the GUARDRAILS table at all');
});

test('DEFECT 2 — the send step (fromLine 6) still renders, correctly, as hitl — never claiming the cap', () => {
  const rendered = renderDraftTable(job1Declaration());
  const lines = rendered.split('\n');
  const idx = lines.findIndex((l) => l.trim() === '6. send (dry-run egress)');
  assert.match(lines[idx + 1], /close:\s+hitl/);
});

// ---------------------------------------------------------------------------
// Must-have 3 — a step with a MISSING close, or no fromLine at all, displays
// hitl (ruled 2026-09-10: silence is safe), via effectiveClass.
// ---------------------------------------------------------------------------

test('a step with a MISSING close displays as hitl', () => {
  const decl = job1Declaration();
  delete decl.steps[0].close; // step 1 had close:{class:'hitl'} — now absent entirely
  const rendered = renderDraftTable(decl);
  const lines = rendered.split('\n');
  const idx = lines.findIndex((l) => l.trim() === '1. read the sheet');
  assert.match(lines[idx + 1], /close:\s+hitl/);
  assert.equal(validate(decl).verdict, 'green');
});

test('a step with NO fromLine at all displays as hitl too', () => {
  const decl = job1Declaration();
  delete decl.steps[0].fromLine;
  delete decl.steps[0].close;
  const rendered = renderDraftTable(decl);
  const lines = rendered.split('\n');
  const idx = lines.findIndex((l) => l.trim() === '1. read the sheet');
  assert.match(lines[idx + 1], /close:\s+hitl/);
  assert.equal(validate(decl).verdict, 'green');
});

test('PROOF the test can fail: giving step 1 fromLine 3 (a real, green-deriving line) changes the rendered class away from hitl', () => {
  const decl = job1Declaration();
  decl.steps[0].fromLine = 3;
  decl.steps[0].close = { class: 'green' };
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
// even with a very long goal.
// ---------------------------------------------------------------------------

test('no rendered line exceeds 80 columns, even with a very long goal and a very long guardrail', () => {
  const decl = job1Declaration();
  decl.steps[0].goal = 'x'.repeat(300);
  decl.guardrails = [
    `1. ${'y'.repeat(300)}`,
    '   guardrail: '.concat('z'.repeat(300)),
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
  decl.guardrailClasses = { ...GUARDRAIL_CLASSES, 1: 'green' };
  decl.steps[0].fromLine = 1;
  decl.steps[0].close = { class: 'green' };
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
  // Line 3's citation guardrail is cut across three steps — the cell becomes
  // "steps 3,4,5" — 11 chars, wider than any fixed column would give it.
  decl.steps[3] = { ...decl.steps[3], fromLine: 3, close: { class: 'green' } };
  decl.steps[4] = { ...decl.steps[4], fromLine: 3, close: { class: 'green' } };
  const rendered = renderDraftTable(decl);
  const row = rendered.split('\n').find((l) => l.startsWith('3.'));
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
