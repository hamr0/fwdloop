// M10 item 3 (piece 2): the copied page rules (src/pagerules.js, src/pagedropwords.js, src/pagemap.js) on F71's saved map answers and saved
// page (public flights page, no PII). $0, no network. A rule here must be able to fail: each forced red is named in its commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { applyPageRules } from '../src/pagerules.js';
import { dropRows } from '../src/pagedropwords.js';
import { parseMapAnswer, mapPrompt } from '../src/pagemap.js';
import { PAGE, raw, JOB } from './fixtures/m10-map/load.mjs';

const sentences = (dropped) => dropRows(dropped).flatMap((r) => r.sentences);

test('F71 draft answers all parse; a non-JSON or wrong-shape answer is unreadable (no repair)', () => {
  for (const n of [1, 2, 3]) assert.equal(parseMapAnswer(raw(n)).ok, true, `draft ${n}`);
  assert.equal(parseMapAnswer('here is the map: {"facts":[]}').ok, false);
  assert.equal(parseMapAnswer(JSON.stringify({ facts: [{ name: 'x', shape: 'nope', words: [] }] })).ok, false);
});

test('the prompt carries the job line and each ~ rule', () => {
  const p = mapPrompt({ jobLines: JOB, label: 'flights', text: 'PAGE' });
  assert.match(p, /LINE 1: List 3 flights from Amsterdam to London\n~ rule 1: under \$150\n~ rule 2: not a red-eye\n~ rule 3: nonstop/);
  assert.match(p, /PAGE TEXT \(the input "flights"\):\nPAGE$/);
});

test('every kept word is written on the saved page (found-on-page)', () => {
  for (const n of [1, 2, 3]) {
    const { facts } = applyPageRules(PAGE, parseMapAnswer(raw(n)).mapping, JOB);
    for (const f of facts) for (const w of f.words) assert.ok(PAGE.replace(/\s+/g, ' ').includes(w), `draft ${n}: "${w}"`);
  }
});

test('a word the page does not write is dropped as not-on-page, with its sentence', () => {
  const mapping = { facts: [{ name: 'nonstop', from: 'line 1 rule 3', shape: 'phrase', words: ['Direct flight only', 'Nonstop'] }] };
  const r = applyPageRules(PAGE, mapping, JOB);
  assert.deepEqual(r.facts[0].words, ['Nonstop']);
  assert.deepEqual(r.dropped.map((d) => [d.word, d.reason]), [['Direct flight only', 'not-on-page']]);
  assert.deepEqual(sentences(r.dropped), ['"Direct flight only" is not written on the page.']);
});

test('F71 side finding: a unit or currency listed twice is never compared with itself ("same amounts as \'US dollars\'" for US dollars)', () => {
  let saw = 0;
  for (const n of [1, 2, 3]) {
    const { dropped } = applyPageRules(PAGE, parseMapAnswer(raw(n)).mapping, JOB);
    for (const s of sentences(dropped)) {
      const m = /^"(.+)" does not show the same (?:amounts|values) as "(.+)"/.exec(s);
      if (m) { saw += 1; assert.notEqual(m[1], m[2], `self-compare in draft ${n}: ${s}`); }
    }
  }
  assert.ok(saw >= 1, 'the fixture drafts hold at least one real compare, so the loop above can fail');
});

test('the same word listed as a unit and a currency is said once, in plain words, not compared', () => {
  const mapping = { facts: [{ name: 'price', from: 'line 1 rule 1', shape: 'money', words: ['From'], currency: ['$', 'US dollars'], unit: ['US dollars'] }] };
  const r = applyPageRules(PAGE, mapping, JOB);
  const all = sentences(r.dropped);
  assert.ok(all.every((s) => !/"US dollars" does not show the same amounts as "US dollars"/.test(s)), all.join(' | '));
  assert.deepEqual(r.facts[0].unit, ['US dollars']);
  assert.ok(all.some((s) => /"US dollars" was listed twice/.test(s)), all.join(' | '));
});
