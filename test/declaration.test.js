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
import { validateDeclaration, DECLARATION_FIELDS } from '../src/declaration.js';

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
