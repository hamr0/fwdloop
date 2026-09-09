// M0a's walkable-chain validator, tested against hand-built declaration
// fixtures — one per negative scenario in PRD §6 M0a, plus a clean pass.
// Style matches close.test.mjs: build the fixture inline, assert verdict +
// the exact (or pattern-matched) red text.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate } from './validator.mjs';

// The signed guardrails text job #1 actually carries (verbatim block, PRD
// §6's "guardrails": "<the human's own words, verbatim>"), plus one extra
// bullet ("one line per invoice") so the softgreen step in the fixture below
// has a real guardrail to trace to.
const GUARDRAILS = [
  '- every number must point to the cell it came from or the formula that made it',
  '- one line per invoice in the reply',
  '- if more than one customer matches, ask me, do not pick',
  '- nothing goes out before I accept',
  '- cap $0.25 per run',
].join('\n');

// A fully valid, walkable job #1 declaration: gather sheet, gather message,
// derive (green, traces to the citation guardrail), compose (softgreen,
// traces to the one-line-per-invoice guardrail), the uncovered "flag
// anything unusual" line correctly landed at hitl (no guardrail covers it),
// ask (hitl), send (hitl, dry-run egress).
function validDeclaration() {
  return {
    skills: ['core'],
    guardrails: GUARDRAILS,
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
        goal: 'flag anything that looks unusual', // the uncovered-line plant (PRD's own example), correctly hitl
        primitives: [],
        reads: ['a1'],
        emits: 'a3b',
        close: { class: 'hitl' },
      },
      {
        goal: 'compose reply',
        primitives: [],
        reads: ['a3', 'a3b'],
        emits: 'a4',
        close: {
          class: 'softgreen', shape: { linePerInvoice: true }, tracesTo: 'one line per invoice in the reply',
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

test('a fully valid, walkable job #1 declaration passes clean', () => {
  const result = validate(validDeclaration());
  assert.equal(result.verdict, 'green');
  assert.equal(result.red, null);
});

// --- check 1: a step reading an artifact no earlier step declared -------

test('check 1 — a step reading an artifact no earlier step declared is a red naming the step and the artifact', () => {
  const decl = validDeclaration();
  decl.steps[2].reads = ['a1', 'a2', 'ghost']; // "ghost" was never declared by any step
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 3 \("match customer, derive totals"\)/);
  assert.match(result.red, /reads artifact "ghost" that no earlier step declared/);
});

test('PROOF check 1 can fail: the same declaration is green once the ghost read is removed', () => {
  const decl = validDeclaration();
  decl.steps[2].reads = ['a1', 'a2', 'ghost'];
  assert.equal(validate(decl).verdict, 'red');
  decl.steps[2].reads = ['a1', 'a2'];
  assert.equal(validate(decl).verdict, 'green');
});

// --- check 2: a primitive not in the catalogue, never invented ----------

test('check 2 — a primitive not in the catalogue is a red naming the invented verb', () => {
  const decl = validDeclaration();
  decl.steps[0].primitives = ['telepathy'];
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 1 \("read the sheet"\)/);
  assert.match(result.red, /unknown primitive verb "telepathy" — not in the catalogue/);
});

// --- check 3: a primitive outside the flow's signed skillset ------------

test('check 3 — a primitive that exists but is outside the signed skillset is a red', () => {
  const decl = validDeclaration();
  decl.steps[6].primitives = ['write', 'sendMail']; // sendMail is skill "mail-egress"; skillset only grants "core"
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 7 \("send \(dry-run egress\)"\)/);
  assert.match(result.red, /primitive "sendMail" needs skill "mail-egress", which is not in the granted skillset \(core\)/);
});

test('PROOF check 3 can fail: granting "mail-egress" makes the same declaration green', () => {
  const decl = validDeclaration();
  decl.steps[6].primitives = ['write', 'sendMail'];
  assert.equal(validate(decl).verdict, 'red');
  decl.skills = ['core', 'mail-egress'];
  assert.equal(validate(decl).verdict, 'green');
});

// --- check 4: close class not declared / not one of the three -----------

test('check 4 — an undeclared close class is a red naming it as absent', () => {
  const decl = validDeclaration();
  delete decl.steps[2].close.class;
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "\(absent\)" is not one of green, softgreen, hitl/);
});

test('check 4 — an invented close class ("yellow") is a red naming it, never green-by-default', () => {
  const decl = validDeclaration();
  decl.steps[2].close.class = 'yellow';
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "yellow" is not one of green, softgreen, hitl/);
});

// --- check 5: the uncovered-line plant — tracesTo must point at a real ---
// --- guardrail, or the step must be hitl ---------------------------------

test('check 5 — the uncovered-line plant: a green close on the line no guardrail covers is a red', () => {
  const decl = validDeclaration();
  // The "flag anything that looks unusual" step is correctly hitl in the base
  // fixture (no guardrail covers it). Flip it to green with the SAME
  // tracesTo phrase — the drafter claiming coverage that doesn't exist.
  decl.steps[3].close = { class: 'green', tracesTo: 'flag anything that looks unusual' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 4 \("flag anything that looks unusual"\)/);
  assert.match(result.red, /close\.class "green" traces to "flag anything that looks unusual", which is not in the signed guardrails — an uncovered line must fall to hitl/);
});

test('check 5 — a softgreen shape the drafter invented for an uncovered line is also a red', () => {
  const decl = validDeclaration();
  decl.steps[3].close = { class: 'softgreen', shape: { flagged: true }, tracesTo: 'flag anything that looks unusual' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "softgreen" traces to "flag anything that looks unusual"/);
});

test('PROOF check 5 can fail: the same step is green once it is correctly landed at hitl', () => {
  const decl = validDeclaration();
  decl.steps[3].close = { class: 'green', tracesTo: 'flag anything that looks unusual' };
  assert.equal(validate(decl).verdict, 'red');
  decl.steps[3].close = { class: 'hitl' };
  assert.equal(validate(decl).verdict, 'green');
});

test('a green close tracing to a fragment of a guardrail is a red, not a pass', () => {
  // The fit-to-pass fence: `tracesTo` must equal a whole guardrail line the
  // human wrote. A substring of one — or a single letter — must never satisfy it.
  for (const fragment of ['every number', 'cell', 'a', 'one line per']) {
    const decl = validDeclaration();
    const derive = decl.steps.find((st) => st.close.class === 'green');
    derive.close.tracesTo = fragment;
    const result = validate(decl);
    assert.equal(result.verdict, 'red', `fragment "${fragment}" should not trace`);
    assert.match(result.red, /an uncovered line must fall to hitl/);
  }
});

test('a whole guardrail line traces whether or not the drafter copied the bullet marker', () => {
  for (const traced of [
    'one line per invoice in the reply',
    '- one line per invoice in the reply',
    '  one line per invoice in the reply  ',
  ]) {
    const decl = validDeclaration();
    const compose = decl.steps.find((st) => st.close.class === 'softgreen');
    compose.close.tracesTo = traced;
    assert.equal(validate(decl).verdict, 'green', `"${traced}" should trace`);
  }
});

