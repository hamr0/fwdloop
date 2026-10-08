// M4e amendment 15 (docs/wiki/the-module-ladder.md, "Amendment 15 — SIGNED"): a guardrail's size for each section is read by code,
// summed against the word limit, and counted at run time. $0, fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as D from '../src/declaration.js';
import { closeWordsAndSections, closeSoftgreen } from '../src/closers.js';

// ---- piece 1: the guardrail reader ---------------------------------------------------------------------------------------------------
const perSection = (g) => (typeof D.guardrailWordsPerSection === 'function' ? D.guardrailWordsPerSection(g) : 'READER-MISSING');

for (const [g, want] of [
  ['~3 sections, about 250 words each, under 600 words', 250],
  ['3 sections, 250 words each', 250],
  ['3 sections, ~250 words each', 250],
  ['3 sections, 250 words per section', 250],
  ['3 sections, all under 600 words', null],
  ['', null],
]) {
  test(`reader: per-section size of "${g}" is ${want}`, () => assert.equal(perSection(g), want));
}

test('reader: the per-section number is never mistaken for the total limit', () => {
  assert.equal(D.guardrailWordLimit('about 250 words each, under 600 words'), 600);
  assert.equal(D.guardrailWordLimit('~3 sections, about 250 words each, under 600 words'), 600);
  assert.equal(D.guardrailWordLimit('3 sections, 250 words per section, under 600 words'), 600);
  assert.equal(D.guardrailWordLimit('250 words each'), null, 'only a per-section size: no total limit');
});
test('reader: the existing total and count readers are unchanged', () => {
  assert.equal(D.guardrailWordLimit('3 sections, all under 600 words'), 600);
  assert.equal(D.guardrailWordLimit('no numbers'), null);
  assert.equal(D.guardrailSectionCount('~3 sections, about 250 words each, under 600 words'), 3);
  assert.equal(D.guardrailSectionCount('3 sections, 250 words per section'), 3);
});

// ---- piece 3: the per-section count at run time --------------------------------------------------------------------------------------
const words = (n, w = 'w') => Array.from({ length: n }, () => w).join(' ');
const SECTIONS = ['summary', 'professional skills', 'soft skills'];
const doc = (a, b, c, pre = '') => `${pre}${pre ? '\n' : ''}## Summary\n${words(a)}\n## Professional Skills\n${words(b)}\n## Soft Skills\n${words(c)}\n`;
const run = (text, wps = 180) => closeWordsAndSections(text, { maxWords: 5000, sections: SECTIONS, wordsPerSection: wps });

for (const n of [144, 180, 216]) {
  test(`run time: a section of ${n} words passes (180 asked, 144..216)`, () => {
    assert.equal(run(doc(180, n, 180)).verdict, 'green', JSON.stringify(run(doc(180, n, 180))));
  });
}
for (const n of [143, 217]) {
  test(`run time: a section of ${n} words is red, naming section + count + range`, () => {
    const r = run(doc(180, 180, n));
    assert.equal(r.verdict, 'red');
    assert.ok(r.reds.includes(`soft skills: ${n} words, about 180 asked (144-216)`), JSON.stringify(r.reds));
  });
}
test('run time: text before the first heading belongs to no section', () => {
  assert.equal(run(doc(180, 180, 180, words(500, 'preamble'))).verdict, 'green');
});
test('run time: a section ends at the next LISTED heading; an unlisted heading stays inside it', () => {
  const t = `## Summary\n${words(100)}\n## Not Listed\n${words(80)}\n## Professional Skills\n${words(180)}\n## Soft Skills\n${words(180)}\n`;
  assert.equal(run(t).verdict, 'green', JSON.stringify(run(t))); // 100 + 80 + 3 heading words = 183 in Summary
});
test('run time: a missing heading still reds as today, and no wordsPerSection means no per-section check', () => {
  const noSoft = `## Summary\n${words(180)}\n## Professional Skills\n${words(180)}\n`;
  assert.ok(run(noSoft).reds.some((r) => /no line is exactly the heading "soft skills"/.test(r)));
  assert.equal(closeWordsAndSections(doc(10, 500, 10), { maxWords: 1000, sections: SECTIONS }).verdict, 'green');
});
test('run time: closeSoftgreen passes wordsPerSection through', () => {
  const r = closeSoftgreen({ text: doc(180, 180, 340) }, { maxWords: 1000, sections: SECTIONS, wordsPerSection: 180 });
  assert.equal(r.verdict, 'red');
  assert.ok(r.reds.some((x) => /soft skills: 340 words, about 180 asked \(144-216\)/.test(x)), JSON.stringify(r.reds));
});
