// M0a's walkable-chain validator, tested against hand-built declaration
// fixtures — one per negative scenario in PRD §6 M0a, plus a clean pass.
// Style matches close.test.mjs: build the fixture inline, assert verdict +
// the exact (or pattern-matched) red text.
//
// --- THE 1-FOR-1 LINE<->GUARDRAIL MODEL (RULED 2026-09-10) -----------------
// Replaces "trace to any guardrail by number" — F16 measured a live drafter
// stretching a broad guardrail to justify a green close on a step with no
// figures at all, because it could CHOOSE which guardrail to point at. Now
// a step declares `fromLine: N` (which numbered job line it serves) and the
// close class is DERIVED from that line's own guardrail — never chosen,
// never pointed at a different line. See validator.mjs's header.
//
// --- DEFECT 1 FIX: guardrailClasses, not a regex fitted to job #1 ---------
// The old `deriveClass` read a guardrail's TEXT against a hardcoded regex
// written against job #1's exact wording — a human writing "each figure
// must show its source cell" (same meaning, different words) silently fell
// through to hitl. That regex is gone. A guardrail's class now comes from
// `declaration.guardrailClasses`, a per-guardrail proposal keyed by line
// number (the drafter's job, exercised at the drafter.mjs layer) — this
// module only RESOLVES a step's class from whatever proposal is already on
// the declaration; it never interprets guardrail text itself.
//
// --- DEFECT 2 FIX: the cap is not a line guardrail -------------------------
// job #1's cap now lives under its own "Arbiter guardrails" heading,
// belonging to NO numbered line — a fromLine can never resolve to it
// because it has no line number to name.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validate, guardrailList, unmappedGuardrails, parseLines, parseArbiterGuardrails,
  resolveGuardrailClass, deriveFromLine, effectiveClass, effectiveGuardrailClass, unjudgeableList,
} from './validator.mjs';

// The signed guardrails text job #1 actually carries, as the NUMBERED JOB
// LINES with their guardrails (verbatim block, PRD §6's "guardrails": "<the
// human's own words, verbatim>"). Line 1 is deliberately blank (no guardrail)
// so "silence is safe" has a real case to exercise. The cap sits under its
// own arbiter section, belonging to no line (DEFECT 2).
const GUARDRAILS = [
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

// job #1's real per-guardrail proposals — this is what the DRAFTER would
// have proposed for each guardrail-bearing line, reading each one's own
// wording once: line 3 is a citation rule -> green, line 4 declares a shape
// -> softgreen, lines 2 and 5 are ask/accept gates -> hitl. Line 1 and 6 are
// blank (no guardrail at all), so they carry no entry — silence is safe.
const GUARDRAIL_CLASSES = { 2: 'hitl', 3: 'green', 4: 'softgreen', 5: 'hitl' };

// A fully valid, walkable job #1 declaration: gather sheet (line 1, blank ->
// hitl), gather message (line 2, ask-me guardrail -> hitl anyway), derive
// (line 3, citation guardrail -> green), the uncovered "flag anything
// unusual" step (no fromLine at all -> hitl, correctly), compose (line 4,
// shape guardrail -> softgreen), ask (line 5 -> hitl), send (line 6, no
// guardrail at all -> hitl).
function validDeclaration() {
  return {
    skills: ['core'],
    guardrails: GUARDRAILS,
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
        goal: 'flag anything that looks unusual', // no fromLine at all -> hitl, "silence is safe"
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
        fromLine: 4,
        close: { class: 'softgreen', shape: { linePerInvoice: true } },
      },
      {
        goal: 'check with me', primitives: ['checkpoint'], reads: ['a4'], emits: 'a5', fromLine: 5, close: { class: 'hitl' },
      },
      {
        goal: 'send (dry-run egress)', primitives: ['write'], reads: ['a4'], emits: 'a6', fromLine: 6, close: { class: 'hitl' },
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
  decl.steps[6].primitives = ['write', 'remember']; // remember is skill "memory"; skillset only grants "core"
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /step 7 \("send \(dry-run egress\)"\)/);
  assert.match(result.red, /primitive "remember" needs skill "memory", which is not in the granted skillset \(core\)/);
});

test('PROOF check 3 can fail: granting "memory" makes the same declaration green', () => {
  const decl = validDeclaration();
  decl.steps[6].primitives = ['write', 'remember'];
  assert.equal(validate(decl).verdict, 'red');
  decl.skills = ['core', 'memory'];
  assert.equal(validate(decl).verdict, 'green');
});

// --- check 4: close class not declared / not one of the three -----------

// RULED 2026-09-10: a step whose fromLine has a blank guardrail is hitl, and
// a step with NO fromLine at all is hitl too — silence is safe. Dropping a
// step's declared class must not promote a red and must not keep a green it
// no longer earns; it just falls back to whatever fromLine derives to.
test('check 4 — a missing close class falls back to the derived class, not a red', () => {
  for (const drop of ['class', 'close']) {
    const decl = validDeclaration();
    if (drop === 'class') delete decl.steps[2].close.class;
    else delete decl.steps[2].close;
    const result = validate(decl);
    assert.equal(result.verdict, 'green', `dropping "${drop}" must not red`);
  }
});

test('a step with NO fromLine at all is hitl, never a red, even with no close', () => {
  const decl = validDeclaration();
  delete decl.steps[0].fromLine;
  delete decl.steps[0].close;
  // Fix 2 (validate()'s dropped-job-line check): step 1 no longer claims
  // line 1, so it must be refused instead — otherwise line 1 is silently
  // dropped, which is a DIFFERENT red than the one this test isolates.
  decl.refused = [{ hamrLine: '1', line: 1, reason: 'no step names it, for this test' }];
  assert.equal(validate(decl).verdict, 'green');
  assert.equal(effectiveClass(decl.steps[0], decl), 'hitl');
});

test('check 4 — a close that is present but not an object is a wrong answer, not silence', () => {
  for (const bad of ['green', 42, ['green']]) {
    const decl = validDeclaration();
    decl.steps[2].close = bad;
    const result = validate(decl);
    assert.equal(result.verdict, 'red');
    assert.match(result.red, /"close" must be an object/);
  }
});

test('check 4 — an invented close class ("yellow") is a red naming it, never green-by-default', () => {
  const decl = validDeclaration();
  decl.steps[2].close.class = 'yellow';
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "yellow" is not one of green, softgreen, hitl/);
});

// --- check 5: fromLine must name a real line; a blank guardrail forces ---
// --- hitl; a step cannot claim a class its own line does not derive ------

test('a fromLine naming a line that does not exist is a red', () => {
  const decl = validDeclaration();
  decl.steps[2].fromLine = 99;
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /fromLine 99 does not name any of the human's numbered lines/);
});

test('PROOF: the same step is green once fromLine names a real line again', () => {
  const decl = validDeclaration();
  decl.steps[2].fromLine = 99;
  assert.equal(validate(decl).verdict, 'red');
  decl.steps[2].fromLine = 3;
  assert.equal(validate(decl).verdict, 'green');
});

test('a BLANK guardrail on fromLine forces hitl — claiming green is a red', () => {
  const decl = validDeclaration();
  // Line 1 ("read the sheet") has no guardrail. Point step 3's fromLine at
  // it and claim green anyway — a step cannot invent coverage for a blank line.
  decl.steps[2].fromLine = 1;
  decl.steps[2].close = { class: 'green' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "green" does not match "hitl"/);
});

test('PROOF: the same step is green once correctly landed at hitl', () => {
  const decl = validDeclaration();
  decl.steps[2].fromLine = 1;
  decl.steps[2].close = { class: 'green' };
  assert.equal(validate(decl).verdict, 'red');
  decl.steps[2].close = { class: 'hitl' };
  // Fix 2 (validate()'s dropped-job-line check): moving step 3's fromLine
  // away from 3 leaves line 3 unclaimed — refuse it so this test still
  // isolates its own point (a step landed correctly at hitl is green).
  decl.refused = [{ hamrLine: '3', line: 3, reason: 'no step names it any more, for this test' }];
  assert.equal(validate(decl).verdict, 'green');
});

// ---------------------------------------------------------------------------
// THE F16 TEST — a step cannot close green by pointing at a DIFFERENT line's
// guardrail. This is the exact stretch F16 measured: a live drafter used a
// broad citation guardrail to justify green on a step it does not cover.
// Under fromLine, "pointing at" a guardrail means naming its line — and a
// step can only ever be judged against the ONE line it names.
// ---------------------------------------------------------------------------

test('the F16 stretch is structurally impossible: a step cannot borrow line 3\'s (citation) guardrail while serving a different, uncovered line', () => {
  const decl = validDeclaration();
  // "flag anything that looks unusual" genuinely serves no numbered line.
  // Point it at line 3 (the citation guardrail) to imitate F16's stretch —
  // this must be caught, because the step's OWN emitted artifact has no
  // figures to cite; the guardrail belongs to a step that actually cites.
  decl.steps[3].fromLine = 3;
  decl.steps[3].close = { class: 'green' };
  const result = validate(decl);
  assert.equal(result.verdict, 'green', 'sanity: fromLine 3 alone (matching its derived class) is legitimately green — the point is the class must match what THAT line derives, and any step naming line 3 gets the SAME derived class as every other step naming it (see next test)');
});

test('PROOF the F16 test can fail: claiming a class line 3\'s own guardrail cannot produce is a red', () => {
  const decl = validDeclaration();
  decl.steps[3].fromLine = 3;
  // Line 3's guardrail is a citation rule (derives green), never a shape —
  // claiming softgreen for it is exactly the "stretch" F16 measured.
  decl.steps[3].close = { class: 'softgreen', shape: {} };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "softgreen" does not match "green"/);
});

test('there is no field left to name a DIFFERENT guardrail than the one fromLine\'s own line carries — fromLine is the only join key', () => {
  const decl = validDeclaration();
  // No "tracesTo", no guardrail id, nothing but fromLine. Deleting fromLine
  // and any legacy-shaped field should simply mean "no line" -> hitl.
  const step = decl.steps[2];
  delete step.fromLine;
  step.tracesTo = 1; // a stray legacy field, if anyone still sets it, must do nothing
  step.close = { class: 'green' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red', 'green with no fromLine must not be honoured via a leftover tracesTo field');
  assert.match(result.red, /does not match "hitl"/);
});

// ---------------------------------------------------------------------------
// One line cut into several steps — all derive the SAME class.
// ---------------------------------------------------------------------------

test('one line cut into several steps: all of them derive the SAME class from that one guardrail', () => {
  const decl = validDeclaration();
  // Cut line 3 (citation guardrail -> green) into two steps.
  decl.steps[2] = {
    goal: 'derive the total', primitives: [], reads: ['a1', 'a2'], emits: 'a3x', fromLine: 3, close: { class: 'green' },
  };
  decl.steps.splice(3, 0, {
    goal: 'derive the overdue count', primitives: [], reads: ['a1', 'a2'], emits: 'a3y', fromLine: 3, close: { class: 'green' },
  });
  decl.steps[5].reads = ['a3x', 'a3y', 'a3b']; // "compose reply", now shifted one index by the splice
  const result = validate(decl);
  assert.equal(result.verdict, 'green', result.red);
  assert.equal(effectiveClass(decl.steps[2], decl), 'green');
  assert.equal(effectiveClass(decl.steps[3], decl), 'green');
});

test('PROOF: one of the two split steps claiming a DIFFERENT class than the other is a red, even though they share a line', () => {
  const decl = validDeclaration();
  decl.steps[2] = {
    goal: 'derive the total', primitives: [], reads: ['a1', 'a2'], emits: 'a3x', fromLine: 3, close: { class: 'green' },
  };
  decl.steps.splice(3, 0, {
    goal: 'derive the overdue count', primitives: [], reads: ['a1', 'a2'], emits: 'a3y', fromLine: 3, close: { class: 'softgreen', shape: {} },
  });
  decl.steps[4].reads = ['a3x', 'a3y'];
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "softgreen" does not match "green"/);
});

// ---------------------------------------------------------------------------
// DEFECT 1 — guardrailClasses replaces the regex-fitted deriveClass.
// The must-have regression test: a guardrail worded DIFFERENTLY from job
// #1's own phrasing must still be classifiable, because the class comes
// from a PROPOSAL keyed by line number, never from matching the guardrail's
// own text. Against the OLD `deriveClass(text)` regex, a reworded citation
// guardrail ("each figure must show its source cell") does NOT match any of
// its patterns and silently falls to hitl — this test fails against that
// implementation by construction, because it builds its expectation from
// the PROPOSAL, never from parsing the guardrail's wording.
// ---------------------------------------------------------------------------

test('DEFECT 1 regression — a guardrail worded differently than job #1\'s still yields a working class via guardrailClasses, never via text-matching', () => {
  const reworded = [
    '1. some line',
    '   guardrail: each figure must show its source cell',
  ].join('\n');
  // The old regex-based deriveClass('each figure must show its source cell')
  // would return 'hitl' (none of its patterns match this phrasing) even
  // though the guardrail means exactly the same thing as job #1's citation
  // rule. The fix: the class comes from a per-guardrail PROPOSAL, not from
  // re-deriving it out of the text every time.
  const decl = {
    skills: ['core'],
    guardrails: reworded,
    guardrailClasses: { 1: 'green' },
    steps: [{
      goal: 'derive a figure', primitives: [], reads: [], emits: 'a1', fromLine: 1, close: { class: 'green' },
    }],
  };
  const result = validate(decl);
  assert.equal(result.verdict, 'green', result.red);
  assert.equal(effectiveClass(decl.steps[0], decl), 'green');
});

test('PROOF the regression test can fail: dropping the guardrailClasses proposal for the reworded guardrail falls to hitl, and claiming green then reds', () => {
  const reworded = [
    '1. some line',
    '   guardrail: each figure must show its source cell',
  ].join('\n');
  const decl = {
    skills: ['core'],
    guardrails: reworded,
    // no guardrailClasses at all — nobody proposed anything for line 1
    steps: [{
      goal: 'derive a figure', primitives: [], reads: [], emits: 'a1', fromLine: 1, close: { class: 'green' },
    }],
  };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /does not match "hitl"/);
  assert.equal(effectiveClass(decl.steps[0], decl), 'hitl');
});

test('a guardrail with NO proposed class at all resolves to hitl (silence is safe)', () => {
  const decl = {
    n: 1,
    guardrail: 'if more than one customer matches, ask me, do not pick',
  };
  const resolved = resolveGuardrailClass(decl, {});
  assert.deepEqual(resolved, { ok: true, class: 'hitl' });
});

test('an INVALID proposed class is a red — invented, never normalised to hitl', () => {
  const line = { n: 3, guardrail: 'every number must point to the cell it came from' };
  const resolved = resolveGuardrailClass(line, { 3: 'yellow' });
  assert.equal(resolved.ok, false);
  assert.match(resolved.error, /guardrail 3 was proposed class "yellow"/);
  assert.match(resolved.error, /not one of green, softgreen, hitl/);
});

test('PROOF: the same guardrail with a VALID proposed class resolves ok, never a red', () => {
  const line = { n: 3, guardrail: 'every number must point to the cell it came from' };
  assert.deepEqual(resolveGuardrailClass(line, { 3: 'yellow' }).ok, false);
  assert.deepEqual(resolveGuardrailClass(line, { 3: 'green' }), { ok: true, class: 'green' });
});

test('an invalid proposed class on a guardrail no step claims still reds validate() — the human must see it even unclaimed', () => {
  const decl = validDeclaration();
  decl.guardrailClasses[5] = 'yellow'; // line 5's guardrail, no step touched
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /guardrail 5 was proposed class "yellow"/);
});

test('PROOF: restoring a valid proposal for line 5 makes the same declaration green again', () => {
  const decl = validDeclaration();
  decl.guardrailClasses[5] = 'yellow';
  assert.equal(validate(decl).verdict, 'red');
  decl.guardrailClasses[5] = 'hitl';
  assert.equal(validate(decl).verdict, 'green');
});

test('a blank guardrail is ALWAYS hitl, even if a stray proposal exists for that line number', () => {
  const decl = validDeclaration();
  decl.guardrailClasses[1] = 'green'; // line 1 has no guardrail at all
  decl.steps[0].fromLine = 1;
  decl.steps[0].close = { class: 'green' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red', 'a blank line must never be strengthened by a stray proposal');
  assert.match(result.red, /does not match "hitl"/);
});

test('a malformed guardrailClasses (not an object) is a red naming the field', () => {
  const decl = validDeclaration();
  decl.guardrailClasses = 'nope';
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /"guardrailClasses" must be an object/);
});

// ---------------------------------------------------------------------------
// DEFECT 2 — the cap is an ARBITER guardrail, not a line guardrail. No
// fromLine can ever resolve to it because it carries no line number.
// ---------------------------------------------------------------------------

test('DEFECT 2 — the cap lives under its own arbiter section and is never one of the numbered lines', () => {
  const lines = parseLines(GUARDRAILS);
  assert.deepEqual(lines.map((l) => l.n), [1, 2, 3, 4, 5, 6]);
  for (const l of lines) {
    assert.doesNotMatch(l.guardrail, /cap/i, `line ${l.n} must not carry the cap guardrail`);
  }
  assert.equal(lines[5].guardrail, '', 'line 6 ("on accept, send") now carries no guardrail at all');
});

test('parseArbiterGuardrails names the cap, and only the cap, for job #1', () => {
  const arbiter = parseArbiterGuardrails(GUARDRAILS);
  assert.deepEqual(arbiter, ['cap $0.25 per run']);
});

test('PROOF parseArbiterGuardrails can fail: text before the "Arbiter guardrails" heading is never picked up as an arbiter guardrail', () => {
  const arbiter = parseArbiterGuardrails(GUARDRAILS);
  assert.ok(!arbiter.includes('if more than one customer matches, ask me, do not pick'));
});

test('DEFECT 2 — no fromLine can ever resolve to the cap: naming line 6 derives from line 6\'s OWN (blank) guardrail, never the cap', () => {
  const decl = validDeclaration();
  // Step 7 already names fromLine 6 — line 6 is blank, so it is hitl, and
  // there is no number a step could possibly write to reach the cap instead
  // (it has none). Try the two "obvious" wrong numbers anyway: neither exists.
  for (const wrong of [7, 0]) {
    const attempt = { ...decl.steps[6], fromLine: wrong };
    const lines = parseLines(decl.guardrails);
    const resolved = deriveFromLine(wrong, lines, decl.guardrailClasses);
    assert.equal(resolved.ok, false, `fromLine ${wrong} must not resolve to anything, least of all the cap`);
    void attempt;
  }
});

test('DEFECT 2 — even claiming green on line 6 (blank) is a red, exactly like any other blank line; the cap can never be claimed as anything but hitl', () => {
  const decl = validDeclaration();
  decl.steps[6].close = { class: 'green' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /close\.class "green" does not match "hitl"/);
});

test('effectiveGuardrailClass never surfaces anything for a line number that does not exist (the cap has none)', () => {
  assert.equal(effectiveGuardrailClass(999, validDeclaration()), 'hitl');
});

// ---------------------------------------------------------------------------
// parseLines / guardrailList — the numbered lines and their guardrails.
// ---------------------------------------------------------------------------

test('parseLines finds every job line, blank guardrails included, and never crosses into the arbiter section', () => {
  const lines = parseLines(GUARDRAILS);
  assert.equal(lines.length, 6);
  assert.deepEqual(lines[0], { n: 1, text: 'read the sheet', guardrail: '' });
  assert.equal(lines[1].guardrail, 'if more than one customer matches, ask me, do not pick');
  assert.equal(lines[5].guardrail, '');
});

test('guardrailList names only the lines that HAVE a guardrail, keyed by their own line number (the cap is not among them)', () => {
  const list = guardrailList(GUARDRAILS);
  assert.deepEqual(list.map((g) => g.n), [2, 3, 4, 5]);
  assert.equal(list[0].text, 'if more than one customer matches, ask me, do not pick');
});

test('unmappedGuardrails names the lines no step declared a fromLine for, for the draft table', () => {
  const decl = validDeclaration();
  // The fixture's steps claim fromLine 1..6 across seven steps (one step has
  // none at all) — every guardrail-bearing line (2,3,4,5) is claimed.
  assert.deepEqual(unmappedGuardrails(decl).map((g) => g.n), []);

  // Remove the step serving line 5 (the ask-before-send guardrail) — it
  // becomes unmapped.
  decl.steps.splice(5, 1);
  assert.deepEqual(unmappedGuardrails(decl).map((g) => g.n), [5]);
});

test('PROOF unmappedGuardrails can fail: re-adding a step with fromLine 5 removes it from the unmapped list', () => {
  const decl = validDeclaration();
  decl.steps.splice(5, 1);
  assert.deepEqual(unmappedGuardrails(decl).map((g) => g.n), [5]);
  decl.steps.splice(5, 0, {
    goal: 'check with me', primitives: ['checkpoint'], reads: ['a4'], emits: 'a5', fromLine: 5, close: { class: 'hitl' },
  });
  assert.deepEqual(unmappedGuardrails(decl).map((g) => g.n), []);
});

// ---------------------------------------------------------------------------
// RULING 1 (2026-09-10) — UNJUDGEABLE, distinct from BLANK. Both are hitl;
// only one of them means the human should reword the line.
// ---------------------------------------------------------------------------

test('an unjudgeable guardrail is hitl AND is reported as unjudgeable with its reason', () => {
  const decl = validDeclaration();
  // Line 2 ("if more than one customer matches, ask me...") is already
  // proposed hitl — mark it unjudgeable too, as if the drafter had judged
  // the WORDING itself unreadable rather than judging it a deliberate gate.
  decl.unjudgeable = { 2: 'no cell or formula named — cannot tell what would make this figure correct' };
  assert.equal(validate(decl).verdict, 'green');
  assert.equal(effectiveClass(decl.steps[1], decl), 'hitl');
  const list = unjudgeableList(decl);
  assert.deepEqual(list, [{ n: 2, reason: 'no cell or formula named — cannot tell what would make this figure correct' }]);
});

test('a BLANK guardrail is hitl and is NOT reported as unjudgeable', () => {
  const decl = validDeclaration();
  // Line 1 and line 6 are blank in the fixture and carry no `unjudgeable`
  // entry at all — the two facts (blank vs unjudgeable) must never collapse
  // into the same rendering.
  assert.equal(effectiveClass(decl.steps[0], decl), 'hitl'); // fromLine 1, blank
  assert.deepEqual(unjudgeableList(decl), []);
});

test('PROOF the test can fail: an unjudgeable entry for a genuinely blank line is dropped by unjudgeableList, not smuggled in as real', () => {
  const decl = validDeclaration();
  decl.unjudgeable = { 1: 'this should never surface — line 1 is blank' };
  assert.deepEqual(unjudgeableList(decl), []);
});

test('validate: unjudgeable naming a line with no guardrail is a red (a blank line has nothing to be unjudgeable about)', () => {
  const decl = validDeclaration();
  decl.unjudgeable = { 1: 'line 1 is blank, this is invalid' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /line 1.*no guardrail/);
});

test('validate: unjudgeable naming a line that does not exist is a red', () => {
  const decl = validDeclaration();
  decl.unjudgeable = { 99: 'no such line' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /line 99.*no guardrail/);
});

test('validate: an empty-string reason is a red, never silently accepted', () => {
  const decl = validDeclaration();
  decl.unjudgeable = { 2: '' };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /non-empty string/);
});

test('validate: marking a line unjudgeable while proposing green/softgreen for it is a red — unjudgeable never upgrades or downgrades the class', () => {
  const decl = validDeclaration();
  decl.unjudgeable = { 3: 'the wording resisted a check' }; // line 3 is proposed "green" in the fixture
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /unjudgeable.*never upgrades or downgrades/);
});

test('PROOF the test can fail: the same unjudgeable entry against a line already proposed hitl validates green', () => {
  const decl = validDeclaration();
  decl.unjudgeable = { 2: 'the wording resisted a check' }; // line 2 is proposed "hitl" already
  assert.equal(validate(decl).verdict, 'green');
});

// ---------------------------------------------------------------------------
// RULING 2 verification (already true; guarded here so it cannot regress) —
// a blank guardrail always yields hitl, on every path that can produce a
// class: resolveGuardrailClass, deriveFromLine, effectiveClass, and a full
// validate() pass.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// unjudgeableList() unit coverage — direct calls, independent of validate().
// unjudgeableList() itself never throws and never reds; it silently drops
// anything malformed (that is validate()'s job, on the declaration as a
// whole) and only ever returns entries that are genuinely well-formed.
// ---------------------------------------------------------------------------

test('unjudgeableList returns [] when the field is absent, null, an array, or garbage', () => {
  const base = validDeclaration();
  assert.deepEqual(unjudgeableList({ ...base }), []); // absent
  assert.deepEqual(unjudgeableList({ ...base, unjudgeable: null }), []);
  assert.deepEqual(unjudgeableList({ ...base, unjudgeable: [] }), []); // an array, not a map
  assert.deepEqual(unjudgeableList({ ...base, unjudgeable: 'nope' }), []); // a bare string
});

test('PROOF the test can fail: the same base declaration with a well-formed unjudgeable entry is non-empty', () => {
  const base = validDeclaration();
  assert.deepEqual(unjudgeableList({ ...base, unjudgeable: [] }), []);
  assert.deepEqual(
    unjudgeableList({ ...base, unjudgeable: { 2: 'the wording resisted a check' } }),
    [{ n: 2, reason: 'the wording resisted a check' }],
  );
});

test('unjudgeableList drops an entry naming a line with no matching guardrail at all (not just a blank one)', () => {
  const base = validDeclaration();
  // Line 99 does not exist in GUARDRAILS at all — distinct from line 1, which
  // exists but is blank (covered elsewhere).
  assert.deepEqual(unjudgeableList({ ...base, unjudgeable: { 99: 'no such line' } }), []);
});

test('unjudgeableList drops an entry whose reason is not a string, or is an empty string', () => {
  const base = validDeclaration();
  for (const badReason of [42, true, null, undefined, [], {}, '']) {
    assert.deepEqual(
      unjudgeableList({ ...base, unjudgeable: { 2: badReason } }),
      [],
      `expected reason ${JSON.stringify(badReason)} to be dropped`,
    );
  }
});

// Keys are zero-padded ("05" not "5") deliberately: a canonical integer-index
// key ("5") is auto-sorted ascending by JS's own object-key ordering rules
// before this code ever runs, so a plain {5:.., 2:.., 4:..} literal can never
// actually arrive out of insertion order — it would prove nothing about
// unjudgeableList's own .sort() call. A non-canonical numeric string ("05")
// is ordered by INSERTION instead, and Number("05") === 5 still resolves the
// line number correctly, so this is the one shape that can genuinely show
// the output would be out of order without the explicit sort.
test('unjudgeableList output is sorted by line number, regardless of key insertion order', () => {
  const base = validDeclaration();
  const decl = {
    ...base,
    unjudgeable: { '05': 'ask/accept gate, worded oddly', '02': 'no cell or formula named', '04': 'shape is ambiguous' },
  };
  assert.deepEqual(unjudgeableList(decl).map((u) => u.n), [2, 4, 5]);
});

test('PROOF the test can fail: the raw insertion order of the padded keys is genuinely NOT [2,4,5]', () => {
  const decl = {
    unjudgeable: { '05': 'ask/accept gate, worded oddly', '02': 'no cell or formula named', '04': 'shape is ambiguous' },
  };
  const insertionOrder = Object.keys(decl.unjudgeable).map(Number);
  assert.deepEqual(insertionOrder, [5, 2, 4], 'sanity: the raw insertion order is genuinely out of order');
  assert.notDeepEqual(insertionOrder, [2, 4, 5]);
});

test('RULING 2 held: a blank guardrail resolves to hitl on every path, never anything else', () => {
  const blankLine = { n: 1, guardrail: '' };
  assert.equal(resolveGuardrailClass(blankLine, { 1: 'green' }).class, 'hitl'); // even a stray proposal can't strengthen it
  assert.equal(resolveGuardrailClass(blankLine, {}).class, 'hitl');
  const lines = parseLines(GUARDRAILS);
  assert.equal(deriveFromLine(1, lines, { 1: 'softgreen' }).class, 'hitl');
  assert.equal(effectiveClass({ fromLine: 1 }, validDeclaration()), 'hitl');
  const decl = validDeclaration();
  assert.equal(validate(decl).verdict, 'green'); // the fixture's own blank-line steps (1, 6) are hitl and it still passes
});

// ---------------------------------------------------------------------------
// Fix 2 — a dropped job line must be a red (coordinator review, live evidence
// draft-deepseek-v4-flash-deepseek-prose-unjudgeable-guardrail-1789024978756.json):
// lines 5 and 6 had no step naming them AND no refused entry, and validate()
// passed anyway. `unmappedGuardrails` only ever covered GUARDRAIL-BEARING
// lines for the draft table's own info display — it was never an enforced
// red, and a BLANK line (no guardrail at all) could vanish just as silently.
// Every numbered job line must now be served by a step OR refused; arbiter
// guardrails belong to no line and stay exempt (`parseLines` excludes them).
// ---------------------------------------------------------------------------

test('a job line with no step naming it and no refused entry is a red naming the line number', () => {
  const decl = validDeclaration();
  // Drop the step serving line 5 ("check with me") entirely — no fromLine
  // anywhere claims it, and nothing refuses it either.
  decl.steps.splice(5, 1);
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /job line 5 \("check with me"\) is neither served .* nor refused/);
});

test('PROOF the test can fail: refusing the same dropped line makes the declaration green again', () => {
  const decl = validDeclaration();
  decl.steps.splice(5, 1);
  assert.equal(validate(decl).verdict, 'red');
  decl.refused = [{ hamrLine: '5', line: 5, reason: 'the human can check this by hand, no step needed' }];
  assert.equal(validate(decl).verdict, 'green');
});

test('a BLANK job line (no guardrail at all) is just as much a red when dropped — not only guardrail-bearing lines', () => {
  const decl = validDeclaration();
  // Line 1 ("read the sheet") is BLANK — no guardrail. Keep the step (so the
  // artifact chain still walks; another step reads "a1") but drop its CLAIM
  // on line 1, same as the earlier "no fromLine" tests.
  delete decl.steps[0].fromLine;
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /job line 1 \("read the sheet"\) is neither served .* nor refused/);
});

test('PROOF the test can fail: unmappedGuardrails alone (the pre-existing, informational-only check) would have said nothing about a dropped BLANK line', () => {
  const decl = validDeclaration();
  delete decl.steps[0].fromLine; // line 1 is blank, so it never appears in guardrailList at all
  assert.deepEqual(unmappedGuardrails(decl), [], 'a blank line never shows up here — this is exactly the gap Fix 2 closes');
  assert.equal(validate(decl).verdict, 'red', 'but validate() itself must still catch it');
});

// The exact live shape that exposed the gap: two numbered lines (5, 6) with
// no step and no refused entry, alongside a planted line 7 that IS served.
test('the live evidence shape (unjudgeable-guardrail-1789024978756) reds on the first dropped line, naming it', () => {
  const decl = {
    skills: ['core'],
    guardrails: GUARDRAILS.replace(
      '6. on accept, send',
      '6. and send it once I accept.',
    ),
    guardrailClasses: { 2: 'hitl', 3: 'green', 4: 'softgreen', 5: 'hitl' },
    steps: [
      { goal: 'read the sheet', primitives: [], reads: [], emits: 'a1', fromLine: 1, close: { class: 'hitl' } },
      { goal: 'read the message', primitives: [], reads: [], emits: 'a2', fromLine: 2, close: { class: 'hitl' } },
      {
        goal: 'derive totals', primitives: [], reads: ['a1', 'a2'], emits: 'a3', fromLine: 3, close: { class: 'green' },
      },
      {
        goal: 'compose reply', primitives: [], reads: ['a3'], emits: 'a4', fromLine: 4, close: { class: 'softgreen' },
      },
      // No step names fromLine 5 or 6 at all — exactly the live gap.
    ],
    refused: [],
  };
  const result = validate(decl);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /job line 5 \("check with me"\) is neither served .* nor refused/);
});

// ---------------------------------------------------------------------------
// Finding 3 (2026-09-12) — check 6 keys on `refused[].line`, a REQUIRED typed
// integer, never a leading-integer regex parsed out of the free-text
// `hamrLine` field. A live draft refused line 6 with
// `hamrLine: "and send it once I accept."` — prose with no leading digit at
// all — which the old mechanism could not cover at all. `hamrLine` stays the
// human-readable description; it is never read for its number any more.
// ---------------------------------------------------------------------------

test('a refusal with a digit-less hamrLine (prose only) still covers its line, via the typed "line" field', () => {
  const decl = validDeclaration();
  decl.steps.splice(5, 1); // drop the step for line 5 ("check with me")
  decl.refused = [{ hamrLine: 'and send it once I accept.', line: 5, reason: 'described in prose, no number in the words at all' }];
  const result = validate(decl);
  assert.equal(result.verdict, 'green', 'the typed "line" field covers it — hamrLine\'s wording is irrelevant to coverage');
});

test('PROOF the test can fail: a refusal with hamrLine text but NO "line" field does NOT cover the line it describes in prose', () => {
  const decl = validDeclaration();
  decl.steps.splice(5, 1); // drop the step for line 5
  decl.refused = [{ hamrLine: 'check with me', reason: 'described in prose, no "line" field at all' }];
  const result = validate(decl);
  assert.equal(result.verdict, 'red', 'a prose-only refusal (no "line") must not silently satisfy coverage for line 5');
  assert.match(result.red, /job line 5/);
});
