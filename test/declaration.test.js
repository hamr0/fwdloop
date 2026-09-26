// Tests for src/declaration.js — M1 piece 3 (docs/wiki/the-module-ladder.md,
// "M1 — scope, exit, negative — SIGNED"). Written red-first against an empty
// src/declaration.js ("Cannot find module"), then against a stub that threw
// on any input, then filled in field by field.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseSignedText } from '../src/signed-text.js';
import {
  validateDeclaration, DECLARATION_FIELDS, SHAPE_KEYS, checkShapes,
} from '../src/declaration.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const CATALOGUE = [
  { verb: 'read', skill: 'core', class: 'read' },
  { verb: 'write', skill: 'core', class: 'write' },
  { verb: 'addressCells', skill: 'core', class: 'read' },
  { verb: 'readDocx', skill: 'core', class: 'read' },
  { verb: 'compress', skill: 'core', class: 'derive' },
];

function clone(v) {
  return JSON.parse(JSON.stringify(v));
}

// ---------------------------------------------------------------------------
// Both real jobs, same call, same catalogue, no per-job field
// ---------------------------------------------------------------------------

describe('both jobs validate green through the SAME call with the SAME catalogue', () => {
  test('job #1 (AR aging)', () => {
    const signed = parseSignedText(fixture('job1.m1.signed.txt'));
    assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
    const declaration = fixtureJson('job1.m1.declaration.json');
    const result = validateDeclaration(declaration, { arbiter: signed.arbiter, lines: signed.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
    assert.deepEqual(Object.keys(result.classes).sort(), [
      'aging_cells', 'approved_reply', 'customer_match', 'invoice_facts', 'reply_draft', 'sent_reply',
    ].sort());
  });

  test('job #2 (resume vs JD)', () => {
    const signed = parseSignedText(fixture('job2-with-sources.signed.txt'));
    assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
    const declaration = fixtureJson('job2.m1.declaration.json');
    const result = validateDeclaration(declaration, { arbiter: signed.arbiter, lines: signed.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
    assert.deepEqual(Object.keys(result.classes).sort(), [
      'jd-text', 'resume-summary', 'resume-summary-approved', 'resume-summary-output', 'resume-text',
    ].sort());
  });
});

// ---------------------------------------------------------------------------
// THE MUTATION SUITE — every DECLARATION_FIELDS entry, every corruption
// ---------------------------------------------------------------------------

const BASE_SIGNED_TEXT = [
  '1. Read the data.',
  '   guardrail: check it before moving on',
  '2. ask: Ask if unsure.',
  '   guardrail: ask if unsure',
  '3. Send the result.',
  '',
  'Arbiter guardrails (belong to no line; human-signed, tighten-only):',
  'guardrail: cap $0.25 per run',
  'guardrail: send at line 3 to file:out/result.txt',
  'guardrail: source data = file:/tmp/data.csv-file',
].join('\n');

const SIGNED = parseSignedText(BASE_SIGNED_TEXT);

function baseDeclaration() {
  return {
    guardrailClasses: { 1: 'green', 2: 'hitl' },
    unjudgeable: {},
    refused: [],
    inputFacts: { data: ['Amount', 'Date'] },
    steps: [
      {
        goal: 'Read the data',
        primitives: ['read'],
        reads: [],
        emits: 'data_read',
        fromLine: 1,
        close: { class: 'green' },
        picks: { data: ['Amount'] },
      },
      {
        goal: 'Ask if unsure',
        primitives: [],
        reads: ['data_read'],
        emits: 'asked',
        fromLine: 2,
        close: { class: 'hitl' },
      },
      {
        goal: 'Send the result',
        primitives: ['write'],
        reads: ['asked'],
        emits: 'sent',
        fromLine: 3,
        close: { class: 'hitl' },
      },
    ],
  };
}

function run(declaration) {
  return validateDeclaration(declaration, { arbiter: SIGNED.arbiter, lines: SIGNED.lines, catalogue: CATALOGUE });
}

test('PROOF — signed-text base parses green', () => {
  assert.equal(SIGNED.ok, true, SIGNED.ok ? '' : SIGNED.reds.join('\n'));
});

test('PROOF — the unmutated base declaration validates green', () => {
  const result = run(baseDeclaration());
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  assert.deepEqual(result.classes, { data_read: 'green', asked: 'hitl', sent: 'hitl' });
});

const covered = new Set();

function assertRed(result, needle, label) {
  assert.equal(result.ok, false, `expected a red for ${label}, got green`);
  assert.ok(
    result.reds.some((r) => r.includes(needle)),
    `expected a red containing ${JSON.stringify(needle)} for ${label}, got:\n${result.reds.join('\n')}`,
  );
}

/** field -> { level: 'top'|'step'|'close', required, needle, retype(), invalid() } */
const FIELD_META = {
  steps: {
    level: 'top', required: true, needle: '"steps"', retype: () => ({}), invalid: () => [],
  },
  guardrailClasses: {
    level: 'top', required: true, needle: '"guardrailClasses"', invalidNeedle: 'guardrailClasses', retype: () => [], invalid: () => ({ 1: 'blue' }),
  },
  unjudgeable: {
    level: 'top', required: true, needle: '"unjudgeable"', invalidNeedle: 'unjudgeable', retype: () => [], invalid: () => ({ 3: 'no guardrail on line 3' }),
  },
  refused: {
    level: 'top', required: true, needle: '"refused"', invalidNeedle: 'refused', retype: () => ({}), invalid: () => [{ line: 99, reason: 'nope' }],
  },
  inputFacts: {
    level: 'top', required: true, needle: '"inputFacts"', invalidNeedle: 'inputFacts', retype: () => [], invalid: () => ({ data: [123] }),
  },
  goal: {
    level: 'step', required: true, needle: 'goal', retype: () => 42, invalid: () => '',
  },
  primitives: {
    level: 'step', required: true, needle: 'primitives', retype: () => 'read', invalid: () => ['not-a-real-verb'],
  },
  reads: {
    level: 'step', required: true, needle: 'reads', retype: () => 'data_read', invalid: () => ['nonexistent-artifact'],
  },
  emits: {
    level: 'step', required: true, needle: 'emits', retype: () => 42, invalid: () => 'asked',
  },
  fromLine: {
    level: 'step', required: true, needle: 'fromLine', retype: () => 'one', invalid: () => 99,
  },
  close: {
    level: 'step', required: false, needle: 'close', retype: () => 'green', invalid: () => ({ class: 'nonsense' }),
  },
  picks: {
    level: 'step', required: false, needle: 'picks', retype: () => [], invalid: () => ({ data: ['NotARealColumn'] }),
  },
  class: {
    level: 'close', required: false, needle: 'class', retype: () => 42, invalid: () => 'nonsense',
  },
  shape: {
    level: 'close', required: false, needle: 'shape', retype: () => 42, invalid: () => ({ cap: 1 }),
  },
};

describe('mutation suite', () => {
  for (const [field, meta] of Object.entries(FIELD_META)) {
    covered.add(field);

    // --- removed (where required) ---
    if (meta.required) {
      test(`mutation: ${field} — removed`, () => {
        const decl = baseDeclaration();
        if (meta.level === 'top') delete decl[field];
        else if (meta.level === 'step') delete decl.steps[0][field];
        else if (meta.level === 'close') delete decl.steps[0].close[field];
        assertRed(run(decl), meta.needle, `${field}/removed`);
      });
    }

    // --- retyped ---
    test(`mutation: ${field} — retyped`, () => {
      const decl = baseDeclaration();
      if (meta.level === 'top') decl[field] = meta.retype();
      else if (meta.level === 'step') decl.steps[0][field] = meta.retype();
      else if (meta.level === 'close') decl.steps[0].close[field] = meta.retype();
      assertRed(run(decl), meta.needle, `${field}/retyped`);
    });

    // --- value swapped to an invalid value ---
    test(`mutation: ${field} — invalid value`, () => {
      const decl = baseDeclaration();
      if (meta.level === 'top') decl[field] = meta.invalid();
      else if (meta.level === 'step') decl.steps[0][field] = meta.invalid();
      else if (meta.level === 'close') decl.steps[0].close[field] = meta.invalid();
      assertRed(run(decl), meta.invalidNeedle ?? meta.needle, `${field}/invalid`);
    });

    // --- unknown key added beside it ---
    test(`mutation: ${field} — unknown key added beside it`, () => {
      const decl = baseDeclaration();
      const bogus = `__bogus_beside_${field}__`;
      if (meta.level === 'top') decl[bogus] = true;
      else if (meta.level === 'step') decl.steps[0][bogus] = true;
      else if (meta.level === 'close') decl.steps[0].close[bogus] = true;
      assertRed(run(decl), bogus, `${field}/beside`);
    });

    // --- moved to another depth ---
    test(`mutation: ${field} — moved to another depth`, () => {
      const decl = baseDeclaration();
      if (field === 'steps') {
        // special case: steps can't be "indexed into" once removed from the
        // top, since it IS the array of steps — move its content under an
        // unrelated top-level wrapper key instead.
        const v = decl.steps;
        delete decl.steps;
        decl.wrappedSteps = v;
        const result = run(decl);
        assertRed(result, '"steps"', `${field}/moved`);
        return;
      }
      if (meta.level === 'top') {
        const v = decl[field];
        delete decl[field];
        decl.steps[0][field] = v;
        assertRed(run(decl), field, `${field}/moved`);
      } else if (meta.level === 'step') {
        const v = decl.steps[0][field];
        delete decl.steps[0][field];
        decl[field] = v;
        assertRed(run(decl), field, `${field}/moved`);
      } else if (meta.level === 'close') {
        const v = decl.steps[0].close[field];
        delete decl.steps[0].close[field];
        decl.steps[0][field] = v;
        assertRed(run(decl), field, `${field}/moved`);
      }
    });
  }

  test('the suite mutates every field the schema defines (DECLARATION_FIELDS)', () => {
    assert.deepEqual([...covered].sort(), [...DECLARATION_FIELDS].sort());
  });
});

// ---------------------------------------------------------------------------
// Declared gap: which fields are OPTIONAL (removing them is NOT a red).
// `guardrailClasses`/`unjudgeable`/`refused`/`inputFacts` are REQUIRED (the
// harness always writes them); `picks` (step) and `close`/`shape` (step/
// close) stay optional — named here so the gap is declared, not hidden.
// ---------------------------------------------------------------------------

const OPTIONAL_FIELDS = Object.freeze([
  { field: 'close', level: 'step' },
  { field: 'picks', level: 'step' },
  { field: 'class', level: 'close' },
  { field: 'shape', level: 'close' },
]);

describe('optional fields — removing them is NOT a red', () => {
  for (const { field, level } of OPTIONAL_FIELDS) {
    test(`removing "${field}" (optional, level: ${level}) still validates green`, () => {
      const decl = baseDeclaration();
      if (level === 'step') delete decl.steps[0][field];
      else if (level === 'close') delete decl.steps[0].close[field];
      const result = run(decl);
      assert.equal(result.ok, true, result.ok ? '' : `expected green with "${field}" removed, got:\n${result.reds.join('\n')}`);
    });
  }

  test('OPTIONAL_FIELDS plus the mutation suite\'s required fields account for every DECLARATION_FIELDS entry', () => {
    const requiredFields = Object.entries(FIELD_META).filter(([, m]) => m.required).map(([f]) => f);
    const optionalFields = OPTIONAL_FIELDS.map((o) => o.field);
    assert.deepEqual(
      [...requiredFields, ...optionalFields].sort(),
      [...DECLARATION_FIELDS].sort(),
    );
  });
});

// ---------------------------------------------------------------------------
// Arbiter-key refusal: 7 keys x 4 positions, each its own test
// ---------------------------------------------------------------------------

const ARBITER_KEYS = ['cap', 'ask', 'ttl', 'send', 'source', 'trigger', 'skills'];
const POSITIONS = ['top', 'step', 'close', 'shape'];

describe('arbiter keys are refused, distinguishably, at every position', () => {
  for (const key of ARBITER_KEYS) {
    for (const position of POSITIONS) {
      test(`arbiter key "${key}" refused at position "${position}"`, () => {
        const decl = baseDeclaration();
        let expectedPath;
        if (position === 'top') {
          decl[key] = 'x';
          expectedPath = `declaration.${key}`;
        } else if (position === 'step') {
          decl.steps[0][key] = 'x';
          expectedPath = `declaration.steps[0].${key}`;
        } else if (position === 'close') {
          decl.steps[0].close[key] = 'x';
          expectedPath = `declaration.steps[0].close.${key}`;
        } else if (position === 'shape') {
          decl.steps[0].close.shape = decl.steps[0].close.shape || {};
          decl.steps[0].close.shape[key] = 'x';
          expectedPath = `declaration.steps[0].close.shape.${key}`;
        }
        const result = run(decl);
        assert.equal(result.ok, false, `expected a red for arbiter key "${key}" at ${position}`);
        assert.ok(
          result.reds.some((r) => r.includes(`arbiter field "${key}"`) && r.includes(expectedPath)),
          `expected a red naming arbiter field "${key}" at ${expectedPath}, got:\n${result.reds.join('\n')}`,
        );
      });
    }
  }
});

// ---------------------------------------------------------------------------
// close.shape signed vocabulary (v1, hamr-signed 2026-09-23): exactly
// maxWords, sections, linesPerInvoice, mustCarry — SHAPE_KEYS.
// ---------------------------------------------------------------------------

describe('close.shape signed vocabulary (v1)', () => {
  test('SHAPE_KEYS is exactly the four signed keys', () => {
    assert.deepEqual([...SHAPE_KEYS].sort(), ['linesPerInvoice', 'maxWords', 'mustCarry', 'sections'].sort());
  });

  test('an unknown key inside close.shape reds by name', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { maxWord: 500 }; // typo of maxWords
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('unknown shape key "maxWord"') && r.includes('declaration.steps[0].close.shape.maxWord')),
      `expected a red naming unknown shape key "maxWord", got:\n${result.reds.join('\n')}`,
    );
  });

  // mutation suite's "unknown key added beside it" (field: shape) adds a bogus
  // key BESIDE close.shape itself; this covers a bogus key INSIDE it.
  test('mutation: shape — unknown key added inside close.shape (not beside it)', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { sections: ['Summary'], __bogus_inside_shape__: true };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('__bogus_inside_shape__') && r.includes('declaration.steps[0].close.shape.__bogus_inside_shape__')),
      `expected a red naming the bogus shape key, got:\n${result.reds.join('\n')}`,
    );
  });

  test('a shape with all four valid keys, correctly typed, validates green', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = {
      maxWords: 500,
      sections: ['Summary', 'Skills'],
      linesPerInvoice: 1,
      mustCarry: ['invoice_number'],
    };
    const result = run(decl);
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  });

  test('maxWords must be a positive integer', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { maxWords: -1 };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('shape key "maxWords"') && r.includes('must be')),
      `expected a red for maxWords type violation, got:\n${result.reds.join('\n')}`,
    );
  });

  test('linesPerInvoice must be a positive integer', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { linesPerInvoice: 0 };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('shape key "linesPerInvoice"') && r.includes('must be')),
      `expected a red for linesPerInvoice type violation, got:\n${result.reds.join('\n')}`,
    );
  });

  test('sections must be an array of non-empty strings', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { sections: ['ok', ''] };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('shape key "sections"') && r.includes('must be')),
      `expected a red for sections type violation, got:\n${result.reds.join('\n')}`,
    );
  });

  test('mustCarry must be an array of non-empty strings', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { mustCarry: [123] };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('shape key "mustCarry"') && r.includes('must be')),
      `expected a red for mustCarry type violation, got:\n${result.reds.join('\n')}`,
    );
  });

  test('sections: [] reds — an empty array is not a declared shape', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { sections: [] };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('shape key "sections"') && r.includes('must be a non-empty array of non-empty strings')),
      `expected a red for empty sections, got:\n${result.reds.join('\n')}`,
    );
  });

  test('mustCarry: [] reds — an empty array is not a declared shape', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { mustCarry: [] };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('shape key "mustCarry"') && r.includes('must be a non-empty array of non-empty strings')),
      `expected a red for empty mustCarry, got:\n${result.reds.join('\n')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Negative scenarios (i) and (ii)
// ---------------------------------------------------------------------------

describe('negative scenarios', () => {
  test('(i) a declaration missing a required ask slot is a red naming the slot line', () => {
    const decl = baseDeclaration();
    decl.steps.splice(1, 1); // drop the step bound to the signed ask line (2)
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /ask at line 2/.test(r) && /no step bound/.test(r)));
  });

  test('(ii) an extra unsigned ask (pause) is a red naming the extra step', () => {
    const decl = baseDeclaration();
    decl.steps.push({
      goal: 'An extra, unsigned pause.',
      primitives: [],
      reads: [],
      emits: 'extra_pause',
      fromLine: null,
      close: { class: 'hitl' },
    });
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('steps[3]') && /pause/.test(r) && /unsigned line/.test(r)));
  });

  // M1 amendment 3 item 4: "A marked line is only the stop: exactly one step
  // binds to it, human-checked, granting no primitive. Work drafted onto it
  // is a red naming the line."
  test('(iii) a step bound to the signed ask line granting a primitive is a red naming the line, step index, and the primitive', () => {
    const decl = baseDeclaration();
    decl.steps[1].primitives = ['read']; // the step bound to the signed ask line (2)
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => r.includes('ask at line 2') && r.includes('steps[1]') && r.includes('read')),
      `expected a red naming line 2, steps[1], and "read", got:\n${result.reds.join('\n')}`,
    );
  });
});

// ---------------------------------------------------------------------------
// THE SEND LOCK (ported from poc/m0/validator.mjs's M0b block) — one test
// per rule, each able to fail on its own.
// ---------------------------------------------------------------------------

describe('the send lock', () => {
  test('(a) a signed ask line that names no real numbered line is a red', () => {
    const badArbiter = { ...SIGNED.arbiter, asks: [{ line: 99, ttlMs: 1000 }] };
    const result = validateDeclaration(baseDeclaration(), { arbiter: badArbiter, lines: SIGNED.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /signed ask at line 99 does not name a real numbered line/.test(r)));
  });

  test('(a) a signed send line that names no real numbered line is a red', () => {
    const badArbiter = { ...SIGNED.arbiter, sends: [{ line: 99, target: { kind: 'file', path: 'out' } }] };
    const result = validateDeclaration(baseDeclaration(), { arbiter: badArbiter, lines: SIGNED.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /signed send at line 99 does not name a real numbered line/.test(r)));
  });

  test('(b) a signed ask line that is also refused is a red', () => {
    const decl = baseDeclaration();
    decl.refused.push({ line: 2, reason: 'trying to dodge the ask' });
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /line 2 is the signed ask slot and cannot be refused/.test(r)));
  });

  test('(b) a signed send line that is also refused is a red', () => {
    const decl = baseDeclaration();
    decl.refused.push({ line: 3, reason: 'trying to dodge the send' });
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /line 3 is the signed send slot and cannot be refused/.test(r)));
  });

  test('(c) zero steps bound to the signed send line is a red naming the slot', () => {
    const decl = baseDeclaration();
    decl.steps.splice(2, 1); // drop the step bound to the signed send line (3)
    decl.refused.push({ line: 3, reason: 'dropped' }); // avoid tripping check 6/rule b for this test
    const result = run(decl);
    assert.equal(result.ok, false);
    // rule (b) also reds here (refusing the send slot) — assert rule (c) fired too, independently:
    assert.ok(result.reds.some((r) => /send at line 3 has no step bound to it/.test(r)));
  });

  test('(c) two or more steps bound to the signed send line is a red naming the steps', () => {
    const decl = baseDeclaration();
    decl.steps.push({
      goal: 'A second, extra send step.',
      primitives: ['write'],
      reads: ['asked'],
      emits: 'sent2',
      fromLine: 3,
      close: { class: 'hitl' },
    });
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /send at line 3 has 2 steps bound to it \(steps\[2, 3\]\)/.test(r)));
  });

  test('(d) a send step not granted a catalogue primitive of class "write" is a red', () => {
    const decl = baseDeclaration();
    decl.steps[2].primitives = ['read']; // 'read' is class 'read' in CATALOGUE, not 'write'
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /send at line 3 \(steps\[2\]\) is not granted a catalogue primitive of class "write"/.test(r)));
  });

  test('(e) a send step that reads no earlier ask step\'s emits is a red', () => {
    const decl = baseDeclaration();
    decl.steps[2].reads = []; // no longer reads the ask step's emits
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /send at line 3 \(steps\[2\]\) does not read the emits of any earlier signed ask step \(asks at lines 2\)/.test(r)));
  });

  test('(e) a send step with no signed ask at an earlier line at all is a red', () => {
    const badArbiter = { ...SIGNED.arbiter, asks: [] };
    const decl = baseDeclaration();
    // with no ask signed, checkAskSlots' own "pause" rule would also fire on
    // step[1] (zero primitives, hitl, no signed ask line at all) — refuse it
    // so this test isolates rule (e) alone.
    decl.steps.splice(1, 1);
    decl.refused.push({ line: 2, reason: 'no ask signed in this variant' });
    const result = validateDeclaration(decl, { arbiter: badArbiter, lines: SIGNED.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /send at line 3 \(steps\[1\]\) has no signed ask at an earlier line to read from/.test(r)));
  });
});

// ---------------------------------------------------------------------------
// M2 fix — item 3: the send-lock's "reads an earlier ask" rule tightens from
// "at least one" to "exactly one". Two signed asks, both earlier than the
// send: reading both is a red naming both ids; reading exactly one is still
// green (the base suite above already covers the single-ask case).
// ---------------------------------------------------------------------------

const TWO_EARLIER_ASKS_TEXT = [
  '1. Read the data.',
  '2. ask: Ask if unsure.',
  '3. ask: Ask again.',
  '4. Send the result.',
  '',
  'Arbiter guardrails (belong to no line; human-signed, tighten-only):',
  'guardrail: cap $0.25 per run',
  'guardrail: send at line 4 to file:out/result.txt',
  'guardrail: source data = file:/tmp/data.csv-file',
].join('\n');

const TWO_EARLIER_ASKS_SIGNED = parseSignedText(TWO_EARLIER_ASKS_TEXT);

function twoEarlierAsksDeclaration(sendReads) {
  return {
    guardrailClasses: {},
    unjudgeable: {},
    refused: [],
    inputFacts: { data: ['Amount', 'Date'] },
    steps: [
      {
        goal: 'Read the data', primitives: ['read'], reads: [], emits: 'data_read', fromLine: 1, close: { class: 'hitl' },
      },
      {
        goal: 'Ask if unsure', primitives: [], reads: ['data_read'], emits: 'asked1', fromLine: 2, close: { class: 'hitl' },
      },
      {
        goal: 'Ask again', primitives: [], reads: ['asked1'], emits: 'asked2', fromLine: 3, close: { class: 'hitl' },
      },
      {
        goal: 'Send the result', primitives: ['write'], reads: sendReads, emits: 'sent', fromLine: 4, close: { class: 'hitl' },
      },
    ],
  };
}

describe('M2 fix item 3: a send reading TWO earlier asks\' emits is a red; exactly one is still green', () => {
  test('PROOF — the two-earlier-asks base text parses green', () => {
    assert.equal(TWO_EARLIER_ASKS_SIGNED.ok, true, TWO_EARLIER_ASKS_SIGNED.ok ? '' : TWO_EARLIER_ASKS_SIGNED.reds.join('\n'));
  });

  test('reading both earlier asks\' emits is a red naming both ids', () => {
    const decl = twoEarlierAsksDeclaration(['asked1', 'asked2']);
    const result = validateDeclaration(decl, { arbiter: TWO_EARLIER_ASKS_SIGNED.arbiter, lines: TWO_EARLIER_ASKS_SIGNED.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, false);
    assert.ok(
      result.reds.some((r) => /send at line 4 \(steps\[3\]\) reads the emits of more than one earlier signed ask step \(asked1, asked2\) — exactly 1 required/.test(r)),
      result.reds.join('\n'),
    );
  });

  test('reading exactly one earlier ask\'s emits is still green', () => {
    const decl = twoEarlierAsksDeclaration(['asked2']);
    const result = validateDeclaration(decl, { arbiter: TWO_EARLIER_ASKS_SIGNED.arbiter, lines: TWO_EARLIER_ASKS_SIGNED.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  });
});

// ---------------------------------------------------------------------------
// M3 scope item 8 (F42's "Also seen" note): the send lock's "reads an
// earlier ask" rule must judge "earlier" by STEP ORDER (what the runner
// actually folds over — `acceptedAskEmitsThisRun` fills in as
// `declaration.steps` executes), never by prose LINE NUMBER.
//
// `parseSignedText` itself already requires every send to have SOME ask at
// a smaller prose line number (signed-text.js's own arbiter check, "send at
// line N has no ask at an earlier line") — so a send with NO earlier-line
// ask at all can never be signed in the first place. The gap this test
// targets is narrower and only shows up with TWO signed asks: one at a
// smaller line (satisfying that prose-level check) and a SECOND one at a
// LARGER line than the send, whose STEP nonetheless sits earlier than the
// send in `declaration.steps` (nothing requires a step's array position to
// match its `fromLine`'s numeric order) and whose emit is what the send
// actually reads. The runner runs this fine — `acceptedAskEmitsThisRun` is
// filled in step-order, not line-order. The OLD line-based rule wrongly reds
// it (it only ever looks at the ask whose LINE is smaller, never the one
// actually read).
// ---------------------------------------------------------------------------

const TWO_ASKS_STEP_ORDER_TEXT = [
  '1. Read the data.',
  '2. ask: Ask A.',
  '3. Send the result.',
  '4. ask: Ask B.',
  '',
  'Arbiter guardrails (belong to no line; human-signed, tighten-only):',
  'guardrail: cap $0.25 per run',
  'guardrail: send at line 3 to file:out/result.txt',
  'guardrail: source data = file:/tmp/data.csv-file',
].join('\n');

const TWO_ASKS_STEP_ORDER_SIGNED = parseSignedText(TWO_ASKS_STEP_ORDER_TEXT);

function twoAsksStepOrderDeclaration() {
  return {
    guardrailClasses: {},
    unjudgeable: {},
    refused: [],
    inputFacts: {},
    steps: [
      {
        goal: 'Read the data', primitives: ['read'], reads: [], emits: 'data_read', fromLine: 1, close: { class: 'hitl' },
      },
      {
        goal: 'Ask A', primitives: [], reads: ['data_read'], emits: 'askedA', fromLine: 2, close: { class: 'hitl' },
      },
      // Ask B is bound to prose line 4 — numerically AFTER the send's line
      // 3 — but its STEP sits earlier in `declaration.steps` than the send
      // below, and the send reads ITS emit (not Ask A's). Legal: nothing
      // requires array position to track `fromLine` order, and the prose-
      // level check above is satisfied by Ask A alone (line 2 < line 3).
      {
        goal: 'Ask B', primitives: [], reads: ['data_read'], emits: 'askedB', fromLine: 4, close: { class: 'hitl' },
      },
      {
        goal: 'Send the result', primitives: ['write'], reads: ['askedB'], emits: 'sent', fromLine: 3, close: { class: 'hitl' },
      },
    ],
  };
}

describe('M3 item 8: the send lock judges "earlier ask" by step order, never by prose line number', () => {
  test('PROOF the two-asks base text parses green (the prose-level "some earlier ask" check is satisfied by Ask A alone)', () => {
    assert.equal(TWO_ASKS_STEP_ORDER_SIGNED.ok, true, TWO_ASKS_STEP_ORDER_SIGNED.ok ? '' : TWO_ASKS_STEP_ORDER_SIGNED.reds.join('\n'));
  });

  test('a send reading the emit of an ask whose LINE is numerically later but whose STEP is array-earlier validates green', () => {
    const decl = twoAsksStepOrderDeclaration();
    const result = validateDeclaration(decl, {
      arbiter: TWO_ASKS_STEP_ORDER_SIGNED.arbiter, lines: TWO_ASKS_STEP_ORDER_SIGNED.lines, catalogue: CATALOGUE,
    });
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  });
});

// ---------------------------------------------------------------------------
// M2 amendment 1 item 2 (docs/wiki/the-module-ladder.md, "M2 amendment 1 —
// SIGNED"): nothing hitl-class may sit after the LAST signed ask, unseen.
// The send step bound to a signed send line is the one exempt step.
// ---------------------------------------------------------------------------

describe('M2 amendment 1 item 2: nothing hitl after the last signed ask', () => {
  test('both real fixtures still validate green: job #1\'s send (line 6, after ask line 5) and job #2\'s send (line 5, after ask line 4) are the exempt step', () => {
    const signed1 = parseSignedText(fixture('job1.m1.signed.txt'));
    assert.equal(signed1.ok, true, signed1.ok ? '' : signed1.reds.join('\n'));
    const result1 = validateDeclaration(fixtureJson('job1.m1.declaration.json'), { arbiter: signed1.arbiter, lines: signed1.lines, catalogue: CATALOGUE });
    assert.equal(result1.ok, true, result1.ok ? '' : result1.reds.join('\n'));

    const signed2 = parseSignedText(fixture('job2-with-sources.signed.txt'));
    assert.equal(signed2.ok, true, signed2.ok ? '' : signed2.reds.join('\n'));
    const result2 = validateDeclaration(fixtureJson('job2.m1.declaration.json'), { arbiter: signed2.arbiter, lines: signed2.lines, catalogue: CATALOGUE });
    assert.equal(result2.ok, true, result2.ok ? '' : result2.reds.join('\n'));
  });

  test('mutation: appending a hitl step after job #1\'s send is a red naming it', () => {
    const signed = parseSignedText(fixture('job1.m1.signed.txt'));
    assert.equal(signed.ok, true, signed.ok ? '' : signed.reds.join('\n'));
    const declaration = fixtureJson('job1.m1.declaration.json');
    declaration.steps.push({
      goal: 'An extra step the drafter should never have appended after the send.',
      primitives: [],
      reads: ['sent_reply'],
      emits: 'leaked_afterthought',
      fromLine: null,
      close: { class: 'hitl' },
    });
    const result = validateDeclaration(declaration, { arbiter: signed.arbiter, lines: signed.lines, catalogue: CATALOGUE });
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /step "leaked_afterthought".*is hitl after the last signed ask — nothing may leave unseen/.test(r)), result.reds.join('\n'));
  });

  test('mutation: appending a hitl step after the minimal fixture\'s send is a red naming it (baseDeclaration/SIGNED)', () => {
    const decl = baseDeclaration();
    decl.steps.push({
      goal: 'A hitl step smuggled in after the send.',
      primitives: [],
      reads: ['sent'],
      emits: 'unseen',
      fromLine: null,
      close: { class: 'hitl' },
    });
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /step "unseen" \(line null\) is hitl after the last signed ask — nothing may leave unseen/.test(r)), result.reds.join('\n'));
  });

  test('no signed ask at all: nothing to anchor on, so this check never fires', () => {
    const badArbiter = { ...SIGNED.arbiter, asks: [] };
    const decl = baseDeclaration();
    // With no ask signed, drop the ask step itself (it would otherwise trip
    // the UNRELATED "pause at an unsigned line" rule) so this isolates the
    // "no anchor" case cleanly.
    decl.steps.splice(1, 1);
    decl.refused.push({ line: 2, reason: 'no ask signed in this variant' });
    const result = validateDeclaration(decl, { arbiter: badArbiter, lines: SIGNED.lines, catalogue: CATALOGUE });
    // Still reds (rule (e) of the send lock: no earlier ask to read from) —
    // but never for THIS check's wording, proving it is inert with no anchor.
    assert.equal(result.ok, false);
    assert.ok(!result.reds.some((r) => r.includes('is hitl after the last signed ask')), result.reds.join('\n'));
  });
});

// ---------------------------------------------------------------------------
// Listing rule
// ---------------------------------------------------------------------------

describe('the listing rule (picks / inputFacts)', () => {
  test('an invented pick name is a red naming the step, role and name', () => {
    const decl = baseDeclaration();
    decl.steps[0].picks = { data: ['NotARealColumn'] };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('steps[0]') && r.includes('data') && r.includes('NotARealColumn')));
  });

  test('a pick role missing from inputFacts is a red naming the role', () => {
    const decl = baseDeclaration();
    decl.steps[0].picks = { unknown_role: ['x'] };
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('unknown_role') && r.includes('inputFacts')));
  });

  test('an inputFacts role that is not a signed source is a red naming the role', () => {
    const decl = baseDeclaration();
    decl.inputFacts.unsigned_role = ['x'];
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('unsigned_role') && /signed source role/.test(r)));
  });

  test('"columns" is an unknown key now, not accepted', () => {
    const decl = baseDeclaration();
    decl.steps[0].columns = ['Amount'];
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('unknown key "columns"')));
  });

  test('"realColumns" is an unknown key now, not accepted', () => {
    const decl = baseDeclaration();
    decl.realColumns = ['Amount'];
    const result = run(decl);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => r.includes('unknown key "realColumns"')));
  });
});

// ---------------------------------------------------------------------------
// No job-specific branching in src/declaration.js
// ---------------------------------------------------------------------------

test('src/declaration.js never mentions job1, job2, realColumns or csv literally', () => {
  const source = readFileSync(path.join(HERE, '..', 'src', 'declaration.js'), 'utf8');
  for (const banned of ['job1', 'job2', 'realColumns', 'csv']) {
    assert.ok(!source.includes(banned), `src/declaration.js contains the literal string "${banned}"`);
  }
});

test('never throws on garbage input', () => {
  for (const bad of [undefined, null, 42, 'x', [], true, {}]) {
    assert.doesNotThrow(() => validateDeclaration(bad, { arbiter: SIGNED.arbiter, lines: SIGNED.lines, catalogue: CATALOGUE }));
  }
  assert.doesNotThrow(() => validateDeclaration(baseDeclaration(), {}));
  assert.doesNotThrow(() => validateDeclaration(baseDeclaration(), { arbiter: null, lines: null, catalogue: null }));
});

test('no `new RegExp(` in src/declaration.js', () => {
  const source = readFileSync(path.join(HERE, '..', 'src', 'declaration.js'), 'utf8');
  assert.ok(!source.includes('new RegExp('));
});

// ---------------------------------------------------------------------------
// checkShapes — a small pure walker for poc/m1/slot-batch.mjs's `shape`
// column: walks declaration.steps and runs the SAME shape-key check
// validateDeclaration already runs, without re-running the whole validator.
// ---------------------------------------------------------------------------

describe('checkShapes', () => {
  test('a declaration with no steps array reds "no steps array"', () => {
    const result = checkShapes({});
    assert.equal(result.verdict, 'red');
    assert.deepEqual(result.reds, ['no steps array']);
    assert.equal(result.shapedSteps, 0);
  });

  test('a declaration that is not an object at all also reds "no steps array"', () => {
    for (const bad of [undefined, null, 42, 'x', [], true]) {
      const result = checkShapes(bad);
      assert.equal(result.verdict, 'red');
      assert.deepEqual(result.reds, ['no steps array']);
      assert.equal(result.shapedSteps, 0);
    }
  });

  test('no step carries a shape -> green, shapedSteps 0', () => {
    const result = checkShapes({ steps: [{ goal: 'x', close: {} }, { goal: 'y' }] });
    assert.equal(result.verdict, 'green');
    assert.deepEqual(result.reds, []);
    assert.equal(result.shapedSteps, 0);
  });

  test('a step whose shape has an unknown key (e.g. oneLinePerInvoice) reds naming it, shapedSteps 1', () => {
    const result = checkShapes({
      steps: [
        { goal: 'x', close: { shape: { oneLinePerInvoice: true } } },
        { goal: 'y' },
      ],
    });
    assert.equal(result.verdict, 'red');
    assert.equal(result.shapedSteps, 1);
    assert.ok(
      result.reds.some((r) => r.includes('unknown shape key "oneLinePerInvoice"')),
      `expected a red naming "oneLinePerInvoice", got:\n${result.reds.join('\n')}`,
    );
  });

  test('a step whose shape uses only signed keys, correctly typed -> green, shapedSteps 1', () => {
    const result = checkShapes({
      steps: [
        { goal: 'x', close: { shape: { maxWords: 100 } } },
      ],
    });
    assert.equal(result.verdict, 'green');
    assert.deepEqual(result.reds, []);
    assert.equal(result.shapedSteps, 1);
  });

  test('does not change validateDeclaration\'s own behaviour — same declaration validates the same way before and after', () => {
    const decl = baseDeclaration();
    decl.steps[0].close.shape = { sections: ['Summary'] };
    const before = validateDeclaration(decl, { arbiter: SIGNED.arbiter, lines: SIGNED.lines, catalogue: CATALOGUE });
    checkShapes(decl);
    const after = validateDeclaration(decl, { arbiter: SIGNED.arbiter, lines: SIGNED.lines, catalogue: CATALOGUE });
    assert.deepEqual(before, after);
  });

  test('a step whose close.shape is an array reds "must be an object", shapedSteps 1', () => {
    const result = checkShapes({ steps: [{ goal: 'x', close: { shape: ['sections'] } }] });
    assert.equal(result.verdict, 'red');
    assert.equal(result.shapedSteps, 1);
    assert.ok(
      result.reds.some((r) => r.includes('must be an object')),
      `expected a red containing "must be an object", got:\n${result.reds.join('\n')}`,
    );
  });

  test('a step whose close.shape is a string reds "must be an object", shapedSteps 1', () => {
    const result = checkShapes({ steps: [{ goal: 'x', close: { shape: 'x' } }] });
    assert.equal(result.verdict, 'red');
    assert.equal(result.shapedSteps, 1);
    assert.ok(
      result.reds.some((r) => r.includes('must be an object')),
      `expected a red containing "must be an object", got:\n${result.reds.join('\n')}`,
    );
  });

  test('a step whose close.shape is null reds "must be an object", shapedSteps 1', () => {
    const result = checkShapes({ steps: [{ goal: 'x', close: { shape: null } }] });
    assert.equal(result.verdict, 'red');
    assert.equal(result.shapedSteps, 1);
    assert.ok(
      result.reds.some((r) => r.includes('must be an object')),
      `expected a red containing "must be an object", got:\n${result.reds.join('\n')}`,
    );
  });
});
