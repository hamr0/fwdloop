// M4e amendment 6 item 1 + negatives (a) (b) (docs/wiki/the-module-ladder.md, "M4e", "Amendment 6"): a plan, first draft or
// change, cannot fight its step's job line. $0, fake provider. The replay of hamr's real "put skills before work history"
// note is paid and not here; this proves the same plan shape (the sections reordered) is red at draft and at change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { checkShapeFitsJobLine } from '../src/declaration.js';

// M10 am16: the drafter writes no check, so a plan can no longer carry a section order or a word limit that fights its job line. The same rules still judge a shape by direct
// call (a signed plan edited by hand is held to them at sign), and a changed plan still draws a fresh draft: these tests call the rule on the job2 line 3 and its guardrail.
const SKILLS_FIRST = ['professional skills', 'summary of work history blurb', 'soft skills'];
const LINE3 = 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,';
const lines = [{ n: 3, text: LINE3, guardrail: '3 sections, all under 600 words' }];
const redsOf = (shape) => { const r = []; checkShapeFitsJobLine({ fromLine: 3, goal: LINE3, close: { class: 'softgreen', shape } }, 2, lines, r); return r; };
const GOOD = ['summary of work history blurb', 'professional skills', 'soft skills'];

test('(a) a shape that reorders a section against its job line is red naming the step and both orders', () => {
  const red = redsOf({ sections: SKILLS_FIRST, maxWords: 600 }).find((x) => /the job line says/.test(x));
  assert.ok(red);
  assert.match(red, /steps\[2\]/);
  assert.match(red, /the job line says summary of work history blurb, then professional skills, then soft skills; the check says professional skills, then summary of work history blurb, then soft skills — change the job line on the card to change the order/);
});

for (const [what, shape, re] of [
  ['a renamed section not in the job line', { sections: ['summary of work history blurb', 'professional skills', 'hobbies'] }, /names "hobbies", which is not in the job line's words/],
  ['a tighter word limit than the line\'s guardrail', { sections: GOOD, maxWords: 300 }, /check says 300 words; the guardrail has no 300/],
  ['a looser word limit than the line\'s guardrail', { sections: GOOD, maxWords: 900 }, /check says 900 words; the guardrail has no 900/],
  ['one section on a "3 sections" guardrail', { sections: ['soft skills'] }, /the guardrail says 3 sections; the check has 1/],
  ['four sections on a "3 sections" guardrail', { sections: [...GOOD, 'professional'] }, /the guardrail says 3 sections; the check has 4/],
  ['a section named by the whole job line', { sections: [LINE3] }, /at most 8 words/],
  ['a section name that contains another', { sections: ['soft skills', 'professional skills and soft skills', 'summary of work history blurb'] }, /contains "soft skills" — one section name may not contain another/],
  ['a section name over 8 words', { sections: ['one two three four five six seven eight nine', 'professional skills', 'soft skills'] }, /"one two three four five six seven eight nine" \(9 words\)/],
]) {
  test(`(a) a shape with ${what} is red and names both`, () => {
    assert.ok(redsOf(shape).some((x) => re.test(x)), JSON.stringify(redsOf(shape)));
  });
}

test('(b) a shape that keeps the sections in the line\'s order and a word limit the guardrail names is green', () => {
  assert.deepEqual(redsOf({ sections: GOOD, maxWords: 600 }), []);
  assert.deepEqual(redsOf({ sections: ['summary of work history', 'professional skills', 'soft skills'] }), []);
});

test('(a7) a short line whose section name is most of it (>= 60% of its words) is red; a 2-of-6-word section is not', () => {
  const step = (sections) => ({ fromLine: 1, goal: 'write the summary of work history', close: { shape: { sections } } });
  const lines = [{ n: 1, text: 'write the summary of work history', guardrail: '1 section' }];
  const red = []; checkShapeFitsJobLine(step(['summary of work history']), 0, lines, red);
  assert.ok(red.some((x) => /the job line or most of it/.test(x)), JSON.stringify(red));
  const ok = []; checkShapeFitsJobLine(step(['work history']), 0, lines, ok);
  assert.deepEqual(ok, []);
});

test('(a7) the guardrail count reads digits and words one..ten', () => {
  const run = (g, n) => { const r = []; checkShapeFitsJobLine({ fromLine: 1, goal: 'a b c d e f g h i j k l', close: { shape: { sections: Array.from({ length: n }, (_, i) => `s${i}`).map((x, i) => ['a b', 'c d', 'e f', 'g h'][i] ?? x) } } }, 0, [{ n: 1, guardrail: g }], r); return r; };
  assert.deepEqual(run('two sections', 2), []);
  assert.match(run('three sections', 2)[0], /says 3 sections; the check has 2/);
  assert.match(run('4 sections, under 600 words', 2)[0], /says 4 sections; the check has 2/);
  assert.deepEqual(run('no count here', 2), []);
});
