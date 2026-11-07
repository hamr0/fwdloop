// M4d amendment 38: the plain reason when the job puts work on its send line (F149).
import test from 'node:test';
import assert from 'node:assert/strict';
import { plainPlanCheck, pickPlanRed, pageRules } from '../src/plain-checks.js';
import { reviseStepList } from '../src/draft-steps.js';

const UNJUDGEABLE = 'declaration: unjudgeable names line 8, which has no guardrail to be unjudgeable about';
const TRIGGER = 'declaration: send at line 8 (steps[7]) is not granted a catalogue primitive of class "write"';
const EMITS = 'declaration: send at line 8 (steps[7]) does not read the emits of any earlier signed ask step (asks at lines 6)';
const REASON = 'Your last line sends to your Destination, but your job puts other work on it';
const FIX = 'Make your last line the one that sends, or move that work above it, then Draft again.';

const explain = (reds) => plainPlanCheck(pickPlanRed(reds));

test('walk-9 reds: unjudgeable first, then the two send reds -> the am38 sentences', () => {
  const p = explain([UNJUDGEABLE, TRIGGER, EMITS]);
  assert.equal(p.reason, REASON);
  assert.equal(p.fix, FIX);
});

test('the trigger red alone -> the am38 sentences', () => {
  const p = explain([TRIGGER]);
  assert.equal(p.reason, REASON);
  assert.equal(p.fix, FIX);
});

test('only the other send red -> the old send sentence, unchanged', () => {
  const p = explain([EMITS]);
  assert.equal(p.reason, 'The send step is not set up to follow your accept and write only to your destination');
  assert.equal(p.fix, 'Check the Destination on the card, then Draft again.');
});

test('a plain non-send red list -> the first red, same words', () => {
  const reds = ['declaration: line 3 is neither served by any step', UNJUDGEABLE];
  assert.equal(pickPlanRed(reds), reds[0]);
  assert.equal(explain(reds).reason, 'A line of your job is not covered by any step');
  assert.equal(pickPlanRed([]), undefined);
});

test('the step lists use the pick (Chat list and revise line)', () => {
  const reds = [UNJUDGEABLE, TRIGGER, EMITS];
  const log = { ok: false, reds, rounds: 1, modelId: 'm', log: [{ outcome: 'valid' }] };
  const rev = reviseStepList({ log, name: 'r' });
  assert.match(rev[0].label, new RegExp(REASON));
  assert.equal(rev[1].label, `Fix: ${FIX}`);
});

test('the page gets the pick from the same rule data: a first flag, ahead of the generic send rule', () => {
  const rules = pageRules();
  const iFirst = rules.findIndex((r) => r.first === true);
  const iSend = rules.findIndex((r) => r.re === 'send at line \\d+|signed send at line|send slot');
  assert.ok(iFirst >= 0 && iFirst < iSend);
  assert.equal(rules.filter((r) => r.first === true).length, 1);
  // the page's own scan (index.html plainPlanCheck): first matching rule over a red
  const pageSay = (t) => rules.find((r) => new RegExp(r.re).test(t)).say;
  assert.match(pageSay(TRIGGER), /^Your last line sends to your Destination, but your job puts other work on it\./);
  assert.match(pageSay(EMITS), /^The send step is not set up/);
  const pagePick = (reds) => reds.find((t) => rules.some((r) => r.first === true && new RegExp(r.re).test(t))) ?? reds[0];
  assert.equal(pagePick([UNJUDGEABLE, TRIGGER, EMITS]), TRIGGER);
});
