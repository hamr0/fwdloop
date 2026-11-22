// M19 S1 port check (F224 remap 3 and the `under` pin): fwd's src/shapebuild.js reads "per|each <label>" with literals where the tag (bareloop v0.61.0 src/shapebuild.js) built a RegExp.
// This table runs the TAG's expression (built here with `new RegExp`, allowed in test/) against fwd's code on the same words: they must agree on every row.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildShapeLine } from '../src/shapebuild.js';
import { wordsSaidOn } from '../src/pagebits.js';
import { underNumbers } from '../src/blockpick.js';

const NR = { max: 128, forbidden: ['.', ':', '[', ']'], reserved: [] };
const tagSays = (/** @type {string} */ said, /** @type {string} */ label) => new RegExp(`\\b(?:per|each)\\s+${label.replace(/-\d+$/, '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}s?\\b`, 'i').test(said);
const fwdSays = (/** @type {string} */ text, /** @type {string} */ label) => {
  const r = buildShapeLine({ line: { n: 1, text, rules: [] }, labels: [label], suggestion: { itemCountFrom: [label] }, nameRules: NR });
  return r.itemCount !== null;
};

const CASES = [
  ['One blurb per resume', 'resume-1'],
  ['One blurb PER Resume', 'resume-1'],
  ['one blurb per resumes', 'resume-2'],
  ['one blurb per resumess', 'resume-1'],
  ['one blurb each resume.', 'resume'],
  ['one blurb each resume, please', 'resume-3'],
  ['one blurb per (resume)', 'resume-1'],
  ['one blurb per  resume', 'resume-1'],
  ['one blurb per\nresume', 'resume-1'],
  ['one blurb for every resume', 'resume-1'],
  ['one blurb per resumed', 'resume-1'],
  ['one blurb per job-description', 'job-description'],
  ['one blurb per job-description-2', 'job-description-2'],
  ['one blurb per job description', 'job-description'],
  ['one blurb, each resume; and each cv', 'cv'],
  ['one blurb per c++ file', 'c++'],
  ['one blurb per c++', 'c++'],
  ['one blurb per r&d note', 'r&d'],
  ['one blurb per c++x', 'c++'],
  ['one blurb per c++s', 'c++'],
  ['one blurb per a.b file', 'a.b'],
  ['one blurb per axb file', 'a.b'],
  ['one blurb per [resume]', '[resume]'],
  ['one blurb per resume-1', 'resume-1'],
  ['each per resume', 'resume'],
  ['superperresume per resume', 'resume'],
  ['reperesume', 'resume'],
  ['per', 'resume'],
  ['one blurb per sheet', 's'],
  ['one blurb per ss', 's'],
  ['one blurb per Straße', 'straße'],
  ['PER RESUME', 'resume'],
];

test('"per|each <label>": fwd\'s literals agree with the tag\'s regex on every row', () => {
  for (const [text, label] of CASES) {
    const said = wordsSaidOn({ text, rules: [] });
    assert.equal(fwdSays(text, label), tagSays(said, label), `${JSON.stringify(text)} / ${label}`);
  }
  assert.ok(CASES.length >= 15);
});

test('the table has both outcomes (a table that cannot fail proves nothing)', () => {
  const outs = new Set(CASES.map(([t, l]) => tagSays(wordsSaidOn({ text: t, rules: [] }), l)));
  assert.deepEqual([...outs].sort(), [false, true]);
});

test('underNumbers reads the same words as the tag\'s FEWER_THAN source (global form)', () => {
  const tag = /(?<!\b(?:no|not)\s)\b(?:(?:fewer|less)\s+than|under|below)\s+(\d+)\b/i;
  const tagUnder = (/** @type {string} */ t) => [...t.matchAll(new RegExp(tag.source, 'gi'))].map((m) => Number(m[1]));
  for (const t of ['under 200 characters', 'Fewer than 5 and below 7', 'not under 3', 'no less than 4', 'UNDER 10; under 20', 'over 5', '']) {
    assert.deepEqual(underNumbers(t), tagUnder(t), t);
  }
});
