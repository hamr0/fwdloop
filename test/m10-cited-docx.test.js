// M10 piece 5 (item 2, "a quote in a doc"): a cited check reads the RUN's own frozen copy of a .docx, sha-checked against inputs.json - never the drafting copy
// and never the raw bytes as text. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { freezeInputs } from '../src/runner.js';
import { readRunSource } from '../src/cited-source.js';
import { checkCited } from '../src/citedcheck.js';
import { makeDocx, para } from './fixtures/docx-make.mjs';

const tmp = (p) => mkdtempSync(join(tmpdir(), `fwdloop-m10-docx-${p}-`));
const doc = (...paras) => makeDocx(paras.join(''));

test('a .docx input is served as its paragraph text, from the run\'s own frozen copy', async () => {
  const run = tmp('run');
  const src = tmp('src');
  try {
    const f = join(src, 'terms.docx');
    writeFileSync(f, doc(para('Heading1', 'Fees'), para(null, 'The fee is 45 dollars per month.')));
    const r = await freezeInputs(run, [{ id: 'terms', path: f }]);
    assert.equal(r.ok, true);
    // the source changes after the run froze its copy: the run still reads its own
    writeFileSync(f, doc(para(null, 'The fee is 99 dollars per month.')));
    const got = readRunSource(run, 'terms');
    assert.equal(got.ok, true, got.red);
    assert.equal(got.text, 'Fees\nThe fee is 45 dollars per month.');
    assert.equal(got.sha256, r.manifest[0].sha256, 'the sha of the frozen bytes');
    assert.equal(got.frozen, 'terms.docx');
  } finally { rmSync(run, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); }
});

test('a frozen .docx edited after it was frozen is refused by name, never read', async () => {
  const run = tmp('run');
  const src = tmp('src');
  try {
    const f = join(src, 'terms.docx');
    writeFileSync(f, doc(para(null, 'The fee is 45 dollars.')));
    const r = await freezeInputs(run, [{ id: 'terms', path: f }]);
    writeFileSync(r.manifest[0].frozen, doc(para(null, 'The fee is 4 dollars.')));
    const got = readRunSource(run, 'terms');
    assert.equal(got.ok, false);
    assert.equal(got.code, 'unreadable');
    assert.match(got.red, /input "terms": the frozen copy changed since it was frozen/);
  } finally { rmSync(run, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); }
});

test('a frozen file that is no zip is refused as unreadable, not served as text', async () => {
  const run = tmp('run');
  const src = tmp('src');
  try {
    const f = join(src, 'bad.docx');
    writeFileSync(f, 'not a zip');
    const r = await freezeInputs(run, [{ id: 'bad', path: f }]);
    assert.equal(r.ok, true);
    const got = readRunSource(run, 'bad');
    assert.equal(got.ok, false);
    assert.equal(got.code, 'unreadable');
    assert.match(got.red, /input "bad": .*End Of Central Directory/);
  } finally { rmSync(run, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); }
});

test('a quote in a doc: word for word in the frozen text is green, a quote that is not there is red', async () => {
  const run = tmp('run');
  const src = tmp('src');
  try {
    const f = join(src, 'terms.docx');
    writeFileSync(f, doc(para(null, 'The fee is 45 dollars per month.')));
    await freezeInputs(run, [{ id: 'terms', path: f }]);
    const got = readRunSource(run, 'terms');
    const part = { source: 'terms', facts: [{ name: 'fee', shape: 'number', anchor: 'The fee is' }], count: { min: 1, max: 1 } };
    const ok = await checkCited({ part, text: got.text, results: [{ quote: 'The fee is 45 dollars per month.', values: { fee: '45' } }] });
    assert.equal(ok.verdict, 'green', ok.gapLines.join('|'));
    const bad = await checkCited({ part, text: got.text, results: [{ quote: 'The fee is 4 dollars per month.', values: { fee: '4' } }] });
    assert.equal(bad.verdict, 'red');
  } finally { rmSync(run, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); }
});
