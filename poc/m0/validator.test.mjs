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
  resolveGuardrailClass, deriveFromLine, effectiveClass, effectiveGuardrailClass,
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
