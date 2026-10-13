// M4d amendment 15 (docs/wiki/the-module-ladder.md), piece A: the Chat list is progress only. ONE function (draftStepList) writes it; the plain
// words come from src/plain-checks.js. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draftStepList, triesOf } from '../src/draft-steps.js';
import { plainPlanCheck, PLAN_CHECK_RULES } from '../src/plain-checks.js';

const okLog = (extra = {}) => ({
  ok: true, stop: null, reds: [], rounds: 1, calls: 1, costUsd: 0.0013, spendComplete: true, modelId: 'deepseek-flash', structureRetries: 0, revisions: 0,
  thinking: { asked: 'off', status: 'applied', say: null },
  inputs: [{ role: 'aging', detail: '11 columns' }],
  log: [{ round: 1, kind: 'first', outcome: 'valid' }],
  ...extra,
});
const decl = (classes = ['green', 'hitl']) => ({ steps: classes.map((c, i) => ({ fromLine: i + 1, close: { class: c } })) });
const lines = (l) => l.map((s) => `${s.status === 'failed' ? '✗' : s.note ? '' : '✓'} ${s.label}`.trim());
const SECTION_RED = 'declaration: steps[2].close.shape.sections names "How I match" which is not in the job line\'s words';

test('1: one line per step, facts joined with " · " (the signed examples)', () => {
  const l = draftStepList({ log: okLog({ rounds: 3, log: [{ round: 1, kind: 'first', outcome: 'valid' }] }), declaration: decl(['green', 'softgreen', 'hitl']) });
  assert.deepEqual(lines(l), ['✓ thinking off', '✓ inputs · aging: 11 columns', '✓ drafted · deepseek-flash · 3 rounds · $0.0013', '✓ plan checks', '✓ rubrics · line 2']);
});

test('1b: a plan that passed after refused tries says so: "fixed by the AI after N tries" (N = the try that passed, minus one)', () => {
  const reds = [SECTION_RED];
  const l = draftStepList({
    log: okLog({ rounds: 3, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds }, { round: 2, kind: 'revision', outcome: 'validator: 1 red(s)', reds }, { round: 3, kind: 'revision', outcome: 'valid' }] }),
    declaration: decl(),
  });
  assert.ok(lines(l).includes('✓ plan checks · fixed by the AI after 2 tries'), lines(l).join('\n'));
});

test('2: no details, no folds, no try lines, no grey, no note, no raw checker text anywhere in the Chat list', () => {
  const reds = [SECTION_RED];
  const l = draftStepList({
    log: okLog({ rounds: 3, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds }, { round: 2, kind: 'revision', outcome: 'validator: 1 red(s)', reds }, { round: 3, kind: 'revision', outcome: 'valid' }] }),
    declaration: decl(),
  });
  for (const s of l) {
    assert.deepEqual(s.details, [], s.id);
    assert.equal(s.reds, undefined);
    assert.equal(s.grey, undefined);
    assert.ok(!s.id.startsWith('try') && s.id !== 'tries-note', s.id);
    assert.doesNotMatch(s.label, /declaration:|steps\[/);
  }
});

test('hamr\'s draft shape (validator, validator, broken reply, free retry ok): fixed after 2 tries; the free retry is not a number', () => {
  const l = draftStepList({
    log: okLog({
      rounds: 4, log: [
        { round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] },
        { round: 2, kind: 'revision', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] },
        { round: 3, kind: 'revision', outcome: "structure: the tool call's arguments were not valid JSON (position 846)" },
        { round: 4, kind: 'structure-retry', outcome: 'valid' },
      ],
    }),
    declaration: decl(),
  });
  assert.ok(lines(l).includes('✓ plan checks · fixed by the AI after 2 tries'), lines(l).join('\n'));
  assert.deepEqual(triesOf(okLog({ log: [
    { round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds: [SECTION_RED] },
    { round: 2, kind: 'revision', outcome: "structure: the tool call's arguments were not valid JSON (position 846)" },
    { round: 3, kind: 'structure-retry', outcome: 'valid' },
  ] }).log).map((t) => [t.label, t.passed]), [['try 1', false], ['try 2', false], ['try 2 again', true]]);
});

test('3: a red draft: ONE plain reason on the ✗ line, ONE Fix line under it, nothing else red; no raw text', () => {
  const reds = [SECTION_RED, 'declaration: line 3 is neither served by any step'];
  const l = draftStepList({
    log: okLog({ ok: false, stop: 'validator', reds, rounds: 2, log: [{ round: 1, kind: 'first', outcome: 'validator: 2 red(s)', reds }, { round: 2, kind: 'revision', outcome: 'validator: 2 red(s)', reds }] }),
    declaration: decl(),
  });
  const checks = l.find((s) => s.id === 'checks');
  assert.equal(checks.status, 'failed');
  assert.equal(checks.label, "plan checks · A section name in the plan's check is not in your job line");
  const fix = l[l.indexOf(checks) + 1];
  assert.deepEqual([fix.id, fix.note, fix.label], ['checks-fix', true, 'Fix: Change the job line to use the section words you want.']);
  assert.equal(l.filter((s) => s.status === 'failed').length, 1, 'red only on the plan checks line');
  assert.equal(l.filter((s) => s.id === 'checks-fix').length, 1);
});

test('3b: a red whose rule used to have no fix wording still gets ONE Fix line (every red, not two rules)', () => {
  const reds = ['declaration: line 3 is neither served by any step'];
  const l = draftStepList({ log: okLog({ ok: false, stop: 'validator', reds, rounds: 1, log: [{ round: 1, kind: 'first', outcome: 'validator: 1 red(s)', reds }] }), declaration: decl() });
  assert.equal(l.find((s) => s.id === 'checks').label, 'plan checks · A line of your job is not covered by any step');
  assert.equal(l.filter((s) => s.id === 'checks-fix').length, 1);
  assert.equal(l.find((s) => s.id === 'checks-fix').label, 'Fix: Make every line of your job say one thing to do, then Draft again.');
});

test('plain-checks: every rule (and the unknown red) has a one-sentence fix; reason is the sentence without it', () => {
  const a = plainPlanCheck(SECTION_RED);
  assert.deepEqual([a.reason, a.fix], ["A section name in the plan's check is not in your job line", 'Change the job line to use the section words you want.']);
  assert.equal(a.say, `${a.reason}. ${a.fix}`);
  const b = plainPlanCheck('declaration: line 3 is neither served by any step');
  assert.deepEqual([b.reason, b.fix], ['A line of your job is not covered by any step', 'Make every line of your job say one thing to do, then Draft again.']);
  assert.equal(plainPlanCheck('zzz').say, 'One of the checks on the plan failed.');
  assert.equal(plainPlanCheck('zzz').fix, 'Draft again.');
  assert.equal(PLAN_CHECK_RULES.length, 21);
  for (const r of PLAN_CHECK_RULES) {
    assert.match(r.fix, /^[A-Z][^.]*(\.|; [^.]*\.)$/, r.fix);
    assert.ok(r.fix.length < 90, r.fix);
  }
});
