// M4e amendments 24, 25, 26 — drafter questions (try 3 only) and Checked / Not checked. $0: a fake provider, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  draft, QUESTIONS_PROMPT, NOTCHECKED_PROMPT, normalizeQuestions, linesNamedByReds, buildRoundSchema,
} from '../src/drafter.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const NUMBERISH = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|pair|dozen|single|once|twice|max|maximum|at most|up to|limit)\b/i;

/** A fake provider that also records the tool schema each call was offered. */
function recProvider(replies) {
  const p = fakeProvider(replies);
  const inner = p.generate.bind(p);
  p.schemas = [];
  p.generate = async (messages, tools, options) => {
    p.schemas.push(JSON.parse(JSON.stringify(tools[0].parameters)));
    return inner(messages, tools, options);
  };
  return p;
}
/** Fails the validator; its red names steps[2] = job line 3. */
const bad = (extra = {}) => { const a = validArgs(); a.steps[2].primitives = ['stash']; return { ...a, ...extra }; };
const run = (provider, extra = {}) => draft({
  proseText: job2Fixture().prose, provider, rates: RATES, modelId: MODEL, ...extra,
});

test('A1: tries 1 and 2 never carry a questions property; try 3 does; notChecked is offered on every try', async () => {
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply(validArgs())]);
  await run(p);
  assert.equal(p.calls.length, 3);
  for (const i of [0, 1]) {
    assert.equal(p.schemas[i].properties.questions, undefined, `try ${i + 1} has no way to ask`);
    assert.ok(p.schemas[i].properties.notChecked, `try ${i + 1} offers notChecked`);
  }
  assert.ok(p.schemas[2].properties.questions && p.schemas[2].properties.notChecked);
  assert.ok(!p.schemas[2].required.includes('questions') && !p.schemas[2].required.includes('notChecked'));
  for (const c of p.calls.slice(0, 2)) assert.ok(!c.messages.some((m) => String(m.content).includes(QUESTIONS_PROMPT)), 'no asking line before try 3');
  assert.ok(p.calls[2].messages.at(-1).content.endsWith(QUESTIONS_PROMPT));
});

test('A2: a draft that passes try 1 or try 2 never opens questions', async () => {
  const p1 = recProvider([toolReply(validArgs())]);
  const r1 = await run(p1);
  assert.equal(p1.calls.length, 1);
  assert.deepEqual(r1.questions, []);
  const p2 = recProvider([toolReply(bad()), toolReply(validArgs())]);
  const r2 = await run(p2);
  assert.equal(p2.calls.length, 2);
  assert.equal(p2.schemas[1].properties.questions, undefined);
  assert.deepEqual(r2.questions, []);
});

test('A3: a question sent when it was not offered is a stray-key red, not a silent pass', async () => {
  const p = recProvider([toolReply({ ...validArgs(), questions: [{ line: 3, question: 'how long?' }] }), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.revisions, 1, 'try 1 was refused for the stray key');
  assert.match(p.calls[1].messages.at(-1).content, /questions/);
  assert.deepEqual(r.questions, []);
});

test('A4: try 3 keeps a question on a line try 2 failed on; drops a missing line, a line not failed on, a third; every drop is logged with its reason', async () => {
  const qs = [
    { line: 3, question: 'What does "all under 600 words" cover?' },
    { line: 9, question: 'a line that does not exist' },
    { line: 1, question: 'a line try 2 did not fail on' },
    { question: 'no line' },
    { line: 3, question: 'second kept' },
    { line: 3, question: 'a third question' },
  ];
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply({ ...validArgs(), questions: qs })]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.questions, [{ line: 3, question: 'What does "all under 600 words" cover?' }, { line: 3, question: 'second kept' }]);
  assert.deepEqual(r.droppedQuestions.map((d) => d.reason), [
    "line 9 is not a line try 2's checks failed on", "line 1 is not a line try 2's checks failed on", 'no line', 'third question']);
  const logged = r.log.at(-1).droppedQuestions;
  assert.equal(logged.length, 4, 'the draft log carries every drop');
  assert.ok(logged.every((d) => typeof d.reason === 'string' && d.reason !== ''));
  assert.equal(r.declaration.questions, undefined, 'questions are stripped before validateDeclaration');
});

test('A5: no number appears in the prompt, the added line or the questions schema', async () => {
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply(validArgs())]);
  await run(p);
  assert.doesNotMatch(QUESTIONS_PROMPT, NUMBERISH);
  assert.doesNotMatch(NOTCHECKED_PROMPT, NUMBERISH);
  assert.doesNotMatch(JSON.stringify(p.schemas[2].properties.questions), NUMBERISH);
  assert.doesNotMatch(JSON.stringify(p.schemas[2].properties.notChecked), NUMBERISH);
  const base = p.calls[0].messages[0].content;
  assert.ok(p.calls[2].messages[0].content.startsWith(base), 'the system prompt is the same on every try');
});

test('A6: notChecked is stripped before validation, comes from the round that produced the plan, and blanks are dropped', async () => {
  const p = recProvider([toolReply(bad({ notChecked: ['from try one'] })), toolReply(validArgs()) ]);
  const r1 = await run(p);
  assert.equal(r1.ok, true, JSON.stringify(r1.reds));
  assert.deepEqual(r1.notChecked, [], 'try 2 sent none: the plan\'s notChecked is try 2\'s, not try 1\'s');
  assert.equal(r1.declaration.notChecked, undefined);
  const p2 = recProvider([toolReply({ ...validArgs(), notChecked: ['tone', '  ', 7, ' wording '] })]);
  const r2 = await run(p2);
  assert.deepEqual(r2.notChecked, ['tone', 'wording']);
  assert.ok(p2.calls[0].messages[0].content.includes(NOTCHECKED_PROMPT));
});

test('A7: offerQuestions:false (the redraft after an answer) never offers questions, even on try 3', async () => {
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply({ ...validArgs(), questions: [{ line: 3, question: 'x' }] })]);
  const r = await run(p, { offerQuestions: false });
  assert.equal(p.schemas[2].properties.questions, undefined);
  assert.ok(!p.calls[2].messages.at(-1).content.includes(QUESTIONS_PROMPT));
  assert.equal(r.ok, false, 'the stray questions key reds');
  assert.deepEqual(r.questions, []);
});

test('A8: normalizeQuestions and linesNamedByReds', () => {
  assert.equal(normalizeQuestions([{ line: 1, question: 'x' }], []).kept.length, 0, 'no failed line means nothing may be asked');
  assert.equal(normalizeQuestions([{ line: 1, question: '  ' }], [1]).dropped[0].reason, 'blank question');
  const decl = { steps: [{ fromLine: 1 }, { fromLine: 3 }] };
  assert.deepEqual(linesNamedByReds(['declaration: ask at line 4 has no step', 'declaration: steps[1].primitives bad'], decl, [1, 2, 3, 4]), [3, 4]);
  assert.ok(buildRoundSchema([{ verb: 'read' }], { questions: true }).properties.questions);
});
