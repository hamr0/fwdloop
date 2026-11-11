// F159 POC (M10 am22 keep-both). NOT the product. $0: no model, no network, no src edit.
// Question: can the EXISTING graders (closeCited + closeSoftgreen, via closeByClass) grade ONE artifact of a
// green-cited fact step against both its cited check and a picked `at most 80 words`, unchanged?
// Shape under test (a harness combiner, in this file only): green iff closeByClass(cited step, artifact) is green
// AND closeByClass(softgreen step, {text: artifact.text}) is green. Config B adds a nonEmpty floor pick (bareloop's hole).
// Inspired by: borrowed-from: bareloop .claude/scratch/r10/keepboth/POC-RESULTS.md (shape of the 6 samples; no code copied)
import { closeByClass } from '../../src/closers.js';
import { sha256Text } from '../../src/citedcheck.js';

const page = 'Release notes\n## [1.2.0] - 2026-10-01\nChanged: the exporter now streams rows.\nFixed: a crash on empty input.\n';
const source = { ok: true, text: page, sha256: sha256Text(page) };
const part = { source: 'notes', facts: [{ name: 'heading', shape: 'phrase', phrase: '## [1.2.0] - 2026-10-01' }], count: { min: 1, max: 1 } };
const citedStep = { close: { class: 'green', cited: part } };
const pick = { rule: 'maxWords', value: 80 };
const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
const good = [{ quote: '## [1.2.0] - 2026-10-01', values: {} }];

const samples = [
  ['a good', { results: good, text: words(42) }, 'green'],
  ['b 93 words', { results: good, text: words(93) }, 'red'],
  ['c made-up quote', { results: [{ quote: '## [9.9.9] - 2030-01-01', values: {} }], text: words(42) }, 'red'],
  ['d no quote', { results: [], text: words(42) }, 'red'],
  ['e1 no text field', { results: good }, 'red'],
  ['e2 empty text', { results: good, text: '' }, 'red'],
  ['f maxWords only, no text', { results: good }, 'red'],
];

async function combined(artifact, picked) {
  const fact = await closeByClass(citedStep, artifact, { reads: {}, businessDate: '', source });
  const text = await closeByClass({ close: { class: 'softgreen', shape: { picked } } }, { text: artifact?.text }, { reads: {}, businessDate: '' });
  const ok = fact.verdict === 'green' && text.verdict === 'green';
  return { verdict: ok ? 'green' : 'red', fact: fact.verdict, text: text.verdict, why: [fact.red, text.red].filter(Boolean).join(' | ').replace(/\n/g, ' / ') };
}
// whole artifact straight into closeSoftgreen (no projection): shows the one-key rule
const raw = await closeByClass({ close: { class: 'softgreen', shape: { picked: [pick] } } }, samples[0][1], { reads: {}, businessDate: '' });
console.log(`raw {results,text} into closeSoftgreen: ${raw.verdict} (${raw.red})`);

for (const [cfg, picked] of [['A (pick only)', [pick]], ['B (pick + nonEmpty floor)', [pick, { rule: 'nonEmpty' }]]]) {
  console.log(`\n== config ${cfg} ==`);
  let right = 0;
  for (const [name, art, want] of samples) {
    const r = await combined(art, picked);
    const okk = r.verdict === want; if (okk) right++;
    console.log(`${okk ? 'OK ' : 'BAD'} ${name}: want ${want} got ${r.verdict} [fact ${r.fact}, text ${r.text}] ${r.why}`);
  }
  console.log(`${right}/${samples.length} right -> ${right === samples.length ? 'PASS' : 'FAIL'}`);
}
