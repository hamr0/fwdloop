// M13 am11 P5: the sign-time rules that contradicted the action. (1) a send needs no earlier Ask; it reads the step right before it. (2) a hitl step after the last Ask is allowed
// when the job has an action (the run stops once if what goes out changed); the rule stays for a job with no action. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadCatalogue } from '../src/catalogue.js';
import { parseSignedText } from '../src/signed-text.js';
import { validateDeclaration } from '../src/declaration.js';

const CATALOGUE = loadCatalogue().primitives;
const prose = (sendLine) => `1. Write the note
2. ask: check it with me
3. Tidy the note
${sendLine === null ? '' : '4. Write it out\n'}
Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $1 per run
${sendLine === null ? '' : `guardrail: send at line ${sendLine} to file:/tmp/out\n`}`;
const step = (goal, fromLine, emits, reads, primitives) => ({ goal, primitives, reads, emits, fromLine, close: { class: 'hitl' } });
const decl = (withSend) => ({
  guardrailClasses: {}, unjudgeable: {}, refused: [], inputFacts: {},
  steps: [
    step('Write the note', 1, 'n1', [], ['read']), step('check it with me', 2, 'a1', ['n1'], []), step('Tidy the note', 3, 'n2', ['a1'], ['read']),
    ...(withSend ? [step('Write it out', 4, 'out', ['n2'], ['write'])] : []),
  ],
});
const run = (p, d) => { const s = parseSignedText(p); assert.equal(s.ok, true, s.ok ? '' : s.reds.join('; ')); return validateDeclaration(d, { arbiter: s.arbiter, lines: s.lines, catalogue: CATALOGUE }); };

test('am11: the action after a step that came after the last Ask is allowed (no hitl-after-last-ask red)', () => {
  const r = run(prose(4), decl(true));
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
});

test('am11: a job with no action keeps the hitl-after-last-ask red', () => {
  const r = run(prose(null), decl(false));
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => /is hitl after the last signed ask/.test(x)), r.reds.join('\n'));
});

test('am11: the action must read the step right before it', () => {
  const d = decl(true); d.steps[3].reads = ['a1'];
  const r = run(prose(4), d);
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => /must read the output of the step before it \("n2"\)/.test(x)), r.reds.join('\n'));
});
