// M10 amendment 16 at the drafter: (1) one suggestion call, forced tool, metered; (3) one ask per guardrail in item 4's words, only "I can't check this" asks count toward am1's 3;
// (4) the plan carries only the checks picked, the drafter's own shape is gone, a Not checked guardrail is hitl with its reason. Fake provider, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, cardToProse } from '../src/panel/authorcard.js';
import { draft } from '../src/drafter.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

// M13 am8: the typed job ends at its Ask; code adds `write it out` as line 7 (the send in `plan` below)
const JOB = [
  'Write 3 lines about my garden from the notes', 'Ask: check it with me', 'List 3 jobs for this week from the notes', '~ exactly 3 bullets',
  'Ask: check it with me', 'Write a short closing note to my neighbour', '~ under 80 words', 'Ask: check it with me',
].join('\n');

function prose(t, job = JOB) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-am16-'));
  const out = path.join(home, 'out');
  mkdirSync(out);
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, '# Notes\n- a\n');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return cardToProse(cardFields({ flowName: 'garden', job, inputs: `notes: ${notes}`, destination: out, capUsd: '5', askWait: '1h', provider: 'x', model: 'y' }));
}
const suggestReply = (checks) => ({ text: '', toolCalls: [{ id: 's1', name: 'suggest_checks', arguments: { checks } }], usage: { inputTokens: 900, outputTokens: 100 }, stopReason: 'tool_calls', model: MODEL });
// the garden job's plan, as a drafter would send it (line numbers: 1 notes, 2 ask, 3 list, 4 ask, 5 note, 6 ask, 7 send)
const plan = (over = {}) => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 'garden', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['garden'], emits: 'ok1', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['ok1'], emits: 'jobs', fromLine: 3, close: { class: 'softgreen', shape: { sections: ['Jobs'], maxWords: 7 } } },
    { primitives: [], reads: ['jobs'], emits: 'ok2', fromLine: 4, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['ok2'], emits: 'note', fromLine: 5, close: { class: 'softgreen', shape: { maxWords: 80 } } },
    { primitives: [], reads: ['note'], emits: 'ok3', fromLine: 6, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['note', 'ok3'], emits: 'sent', fromLine: 7, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 3: 'softgreen', 5: 'softgreen' }, unjudgeable: {}, refused: [], ...over,
});
const ONE = { line: 3, guardrail: 1, rule: 'listItems', value: 3 };
const TWO = { line: 5, guardrail: 1, rule: 'maxWords', value: 80 };

test('(1) one forced suggestion call, metered, before any drafting round; the asks are item 4\'s words, a proposal in plain words', async (t) => {
  const p = fakeProvider([suggestReply([ONE, TWO])]);
  const r = await draft({ proseText: prose(t), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.stop, 'look-asks');
  assert.equal(p.calls.length, 1);
  assert.deepEqual(p.calls[0].tools, ['suggest_checks']);
  assert.deepEqual(p.calls[0].options.toolChoice, { name: 'suggest_checks' });
  assert.equal(p.calls[0].options.thinkingMode, 'off');
  assert.equal(r.calls, 1);
  assert.ok(r.costUsd > 0, 'the call was priced');
  assert.equal(r.log[0].kind, 'check-suggest');
  assert.deepEqual(r.questions.map((q) => [q.line, q.ask, q.ruleNo, q.proposal]), [[3, 'check', 1, 'exactly 3 list items'], [5, 'check', 1, 'at most 80 words']]);
  assert.match(r.questions[0].question, /^Line 3, guardrail "exactly 3 bullets": I propose exactly 3 list items\./);
  assert.deepEqual(r.questions[0].check, { rule: 'listItems', value: 3 });
});

test('(2)(3) a suggestion code drops (a number the guardrail never names) is "I can\'t check this", a missing entry too; the drafter is never called', async (t) => {
  const p = fakeProvider([suggestReply([{ line: 3, guardrail: 1, rule: 'maxWords', value: 80 }])]);
  const r = await draft({ proseText: prose(t), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.stop, 'look-asks');
  assert.deepEqual(r.questions.map((q) => q.ask), ['no-check', 'no-check']);
  assert.match(r.questions[0].question, /^Line 3, guardrail "exactly 3 bullets": I can't check this\. Your own words, or Not checked\?/);
  assert.equal(p.calls.some((c) => c.tools[0] === 'emit_declaration'), false);
});

test('(5) proposals are not counted toward am1\'s 3; the 4th "I can\'t check this" stops drafting at $0 with the rewrite list', async (t) => {
  const job4 = ['Write the first part', '~ tone is warm; reads kindly; no jargon; sounds human', 'Ask: check it', 'Write it out'].join('\n');
  const p = fakeProvider([suggestReply([])]);
  const r = await draft({ proseText: prose(t, job4), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.stop, 'look-asks-too-many');
  assert.deepEqual(r.questions, []);
  assert.match(r.reds[0], /^Your job has 4 rules I can't check or had to guess\. Please rewrite it/);
  assert.match(r.reds[0], /Spent so far: \$/);
  // four proposals asked, not stopped
  const job4b = ['Write the first part', '~ under 10 words; under 20 words; under 30 words; under 40 words', 'Ask: check it', 'Write it out'].join('\n');
  const q = await draft({
    proseText: prose(t, job4b), rates: RATES, modelId: MODEL,
    provider: fakeProvider([suggestReply([10, 20, 30, 40].map((v, i) => ({ line: 1, guardrail: i + 1, rule: 'maxWords', value: v })))]),
  });
  assert.equal(q.stop, 'look-asks');
  assert.equal(q.questions.length, 4);
});

test('(4) the plan carries only the picked checks: the drafter\'s own shape is gone, the line is softgreen with exactly the pick; an unpicked line is hitl + Not checked with its reason', async (t) => {
  const p = fakeProvider([toolReply(plan())]);
  const r = await draft({
    proseText: prose(t), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false,
    checkPicks: [{ line: 3, rule: 1, check: { rule: 'listItems', value: 3 }, added: 'exactly 3 list items' }],
  });
  assert.equal(r.ok, true, r.reds.join('\n'));
  const by = (n) => r.declaration.steps.find((s) => s.fromLine === n).close;
  assert.deepEqual(by(3), { class: 'softgreen', shape: { picked: [{ rule: 'listItems', value: 3 }] } });
  assert.deepEqual(by(5), { class: 'hitl' }, 'line 5 has no pick: no check, whatever the drafter sent');
  assert.equal(r.declaration.guardrailClasses['5'], 'hitl');
  assert.match(r.declaration.unjudgeable['5'], /No check was picked for it/);
  assert.ok(r.notChecked.includes('not checked · "under 80 words" — No check was picked for it, so you judge it at the Ask.'), r.notChecked.join('|'));
  assert.equal(p.calls.length, 1, 'the redraft makes no suggestion call');
});

test('(4) a rule the person left, and their own words, are Not checked with their reasons; the `~` line an agree wrote is covered by the pick', async (t) => {
  const job = JOB.replace('~ exactly 3 bullets', '~ exactly 3 bullets\n~ exactly 3 list items').replace('~ under 80 words', '~ under 80 words\n~ keep it short and kind');
  const p = fakeProvider([toolReply(plan())]);
  const r = await draft({
    proseText: prose(t, job), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false,
    leftRules: [],
    checkPicks: [
      { line: 3, rule: 1, check: { rule: 'listItems', value: 3 }, added: 'exactly 3 list items' },
      { line: 5, rule: 1, check: null, added: 'keep it short and kind', own: true },
    ],
  });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.deepEqual(r.declaration.steps.find((s) => s.fromLine === 3).close.shape.picked, [{ rule: 'listItems', value: 3 }]);
  assert.ok(!r.notChecked.some((x) => x.includes('exactly 3 list items')), 'the agree line is covered');
  assert.ok(r.notChecked.some((x) => x.includes('"under 80 words"') && x.includes('Your own words are on the line')), r.notChecked.join('|'));
  assert.ok(r.notChecked.some((x) => x.includes('"keep it short and kind"') && x.includes('Your own words are on the line')));
  const left = await draft({ proseText: prose(t), provider: fakeProvider([toolReply(plan())]), rates: RATES, modelId: MODEL, offerQuestions: false, leftRules: [{ line: 5, rule: 1 }] });
  assert.ok(left.notChecked.includes('not checked · "under 80 words" — You chose to leave it Not checked.'));
});

test('(4) a drafter that sends a shape for a line code did not settle has it dropped too; the schema offers none', async (t) => {
  const sent = plan({ guardrailClasses: {} });
  sent.steps[2].close = { class: 'hitl', shape: { maxWords: 7 } };
  sent.steps[4].close = { class: 'hitl', shape: { maxWords: 80 } };
  const p = fakeProvider([toolReply(sent)]);
  const r = await draft({ proseText: prose(t, JOB.replace('~ exactly 3 bullets\n', '').replace('~ under 80 words\n', '')), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.ok, true, r.reds.join('\n'));
  assert.ok(r.declaration.steps.every((s) => s.close.shape === undefined));
  assert.equal(p.calls[0].schemas[0].properties.steps.items.properties.close.properties.shape, undefined);
});
