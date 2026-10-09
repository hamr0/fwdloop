// M4e amendment 15 (docs/wiki/the-module-ladder.md, "Amendment 15 — SIGNED"): a guardrail's size for each section is read by code,
// summed against the word limit, and counted at run time. $0, fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as D from '../src/declaration.js';
const firstNum = (g) => D.guardrailWordNumbers(g)[0] ?? null; // these inputs hold one whole-output number
import { closeSoftgreen } from '../src/closers.js';

// ---- piece 1: the guardrail reader ---------------------------------------------------------------------------------------------------
const perSection = (g) => (typeof D.guardrailWordsPerSection === 'function' ? D.guardrailWordsPerSection(g) : 'READER-MISSING');

for (const [g, want] of [
  ['~3 sections, about 250 words each, under 600 words', 250],
  ['3 sections, 250 words each', 250],
  ['3 sections, ~250 words each', 250],
  ['3 sections, 250 words per section', 250],
  ['3 sections, all under 600 words', null],
  ['', null],
  ['250ish each', 250],
  ['~250ish each', 250],
  ['about 250ish words each', 250],
  ['250ish words each', 250],
  ['250ish words per section', 250],
]) {
  test(`reader: per-section size of "${g}" is ${want}`, () => assert.equal(perSection(g), want));
}

test('reader: the per-section number is never mistaken for the total limit', () => {
  assert.equal(firstNum('about 250 words each, under 600 words'), 600);
  assert.equal(firstNum('~3 sections, about 250 words each, under 600 words'), 600);
  assert.equal(firstNum('3 sections, 250 words per section, under 600 words'), 600);
  assert.equal(firstNum('250 words each'), null, 'only a per-section size: no total limit');
});
test('reader: the "ish" per-section size is never the total limit', () => {
  assert.equal(firstNum('~3 sections, 250ish each, under 600 words'), 600);
  assert.equal(firstNum('250ish words each'), null);
});
test('sum check: "~3 sections, 250ish each, under 600 words" reds (750 > 600) at $0', () => {
  const reds = D.checkGuardrailSums([{ n: 3, guardrail: '~3 sections, 250ish each, under 600 words' }]);
  assert.deepEqual(reds, ["line 3's guardrail asks about 250 words for each of 3 sections (750) but under 600 words in total. Change the guardrail."]);
});
test('reader: the existing total and count readers are unchanged', () => {
  assert.equal(firstNum('3 sections, all under 600 words'), 600);
  assert.equal(firstNum('no numbers'), null);
  assert.equal(D.guardrailSectionCount('~3 sections, about 250 words each, under 600 words'), 3);
  assert.equal(D.guardrailSectionCount('3 sections, 250 words per section'), 3);
});

// ---- piece 3: the per-section count at run time --------------------------------------------------------------------------------------
const words = (n, w = 'w') => Array.from({ length: n }, () => w).join(' ');
const SECTIONS = ['summary', 'professional skills', 'soft skills'];
const doc = (a, b, c, pre = '') => `${pre}${pre ? '\n' : ''}## Summary\n${words(a)}\n## Professional Skills\n${words(b)}\n## Soft Skills\n${words(c)}\n`;
const run = (text, wps = 180) => closeSoftgreen({ text }, { maxWords: 5000, sections: SECTIONS, wordsPerSection: wps });

for (const n of [144, 180, 216]) {
  test(`run time: a section of ${n} words passes (180 asked, 144..216)`, async () => {
    const r = await run(doc(180, n, 180));
    assert.equal(r.verdict, 'green', JSON.stringify(r));
  });
}
for (const n of [143, 217]) {
  test(`run time: a section of ${n} words is red, naming section + count + range`, async () => {
    const r = await run(doc(180, 180, n));
    assert.equal(r.verdict, 'red');
    assert.ok(r.reds.includes(`soft skills: ${n} words, about 180 asked (144-216)`), JSON.stringify(r.reds));
  });
}
test('run time: text before the first heading belongs to no section', async () => {
  assert.equal((await run(doc(180, 180, 180, words(500, 'preamble')))).verdict, 'green');
});
test('run time: a section ends at the next LISTED heading; an unlisted heading stays inside it', async () => {
  const t = `## Summary\n${words(100)}\n## Not Listed\n${words(80)}\n## Professional Skills\n${words(180)}\n## Soft Skills\n${words(180)}\n`;
  const r = await run(t);
  assert.equal(r.verdict, 'green', JSON.stringify(r)); // 100 + 80 + 3 heading words = 183 in Summary
});
test('run time: a missing heading still reds as today, and no wordsPerSection means no per-section check', async () => {
  const noSoft = `## Summary\n${words(180)}\n## Professional Skills\n${words(180)}\n`;
  assert.ok((await run(noSoft)).reds.some((r) => /no line is exactly the heading "soft skills"/.test(r)));
  assert.equal((await closeSoftgreen({ text: doc(10, 500, 10) }, { maxWords: 1000, sections: SECTIONS })).verdict, 'green');
});
test('run time: closeSoftgreen passes wordsPerSection through', async () => {
  const r = await closeSoftgreen({ text: doc(180, 180, 340) }, { maxWords: 1000, sections: SECTIONS, wordsPerSection: 180 });
  assert.equal(r.verdict, 'red');
  assert.ok(r.reds.some((x) => /soft skills: 340 words, about 180 asked \(144-216\)/.test(x)), JSON.stringify(r.reds));
});

// ---- items 1, 2, 4, 5 and negatives (a) (b) (c) (e) (f) through the real draft and sign doors ---------------------------------
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftToDir, signDraft, specHash, SPEC_HASH_FILE } from '../src/authoring.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const G_OLD = 'guardrail: 3 sections, all under 600 words';
async function draft(guardrail, mutate, { provider } = {}) {
  const fx = job2Fixture();
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am15-'));
  const proseFile = path.join(work, 'prose.txt');
  assert.ok(fx.prose.includes(G_OLD));
  writeFileSync(proseFile, fx.prose.replace(G_OLD, `guardrail: ${guardrail}`));
  const args = validArgs();
  mutate?.(args);
  const p = provider ?? fakeProvider([toolReply(args)]);
  const dir = path.join(work, 'draft');
  const r = await draftToDir({ proseFile, dir, root: path.join(work, 'flows'), name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {} });
  return { r, p, dir, work };
}
const readDecl = (dir) => JSON.parse(readFileSync(path.join(dir, 'declaration.json'), 'utf8'));
function rehash(dir) {
  const rd = (f) => readFileSync(path.join(dir, f), 'utf8');
  const h = specHash({ proseText: rd('prose.txt'), declarationText: rd('declaration.json'), inputFactsText: rd('input-facts.json'), readoutText: rd('readout.txt'), targetText: rd('target.json') }).hash;
  writeFileSync(path.join(dir, SPEC_HASH_FILE), `${h}\n`);
  return h;
}
const SUM_RED = "line 3's guardrail asks about 250 words for each of 3 sections (750) but under 600 words in total. Change the guardrail.";

test('(a) ~3 sections, about 250 words each, under 600 words: red at $0, no provider request made, naming 750 and 600', async () => {
  const { r, p, dir } = await draft('~3 sections, about 250 words each, under 600 words');
  assert.equal(r.ok, false);
  assert.equal(p.calls.length, 0, 'no model call');
  assert.ok(r.reds.includes(SUM_RED), JSON.stringify(r.reds));
  assert.equal(existsSync(path.join(dir, SPEC_HASH_FILE)), false);
  assert.equal(r.costUsd, 0);
});
test('(a) at sign: a draft whose guardrail was edited to fight itself (re-hashed) is refused with the same words, no flow', async () => {
  const { r, dir, work } = await draft('3 sections, all under 600 words');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const pf = path.join(dir, 'prose.txt');
  writeFileSync(pf, readFileSync(pf, 'utf8').replace(G_OLD, 'guardrail: ~3 sections, about 250 words each, under 600 words'));
  const d = readDecl(dir); d.steps[2].close.shape.wordsPerSection = 250; writeFileSync(path.join(dir, 'declaration.json'), JSON.stringify(d));
  const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.ok(s.reds.some((x) => x.includes(SUM_RED)), JSON.stringify(s.reds));
  assert.equal(existsSync(path.join(work, 'flows', 'job2')), false);
});

test('(b) ~3 sections, about 180 words each, under 600 words: green, the machine sets wordsPerSection 180, the readout shows it', async () => {
  const { r, dir } = await draft('~3 sections, about 180 words each, under 600 words');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(readDecl(dir).steps[2].close.shape.wordsPerSection, 180);
  assert.match(readFileSync(path.join(dir, 'readout.txt'), 'utf8'), /\n {5}sections: summary of work history blurb · professional skills · soft skills · about 180 words each · under 600 words\n/);
  assert.equal(signDraft({ dir, approve: r.hash, signedBy: 'alice' }).ok, true);
});
test('(b) the drafter schema never offers wordsPerSection to the model', async () => {
  const { buildDeclarationSchema } = await import('../src/drafter.js');
  const shape = buildDeclarationSchema([{ verb: 'read' }]).properties.steps.items.properties.close.properties.shape;
  assert.equal(Object.keys(shape.properties).includes('wordsPerSection'), false);
});

test('(c) "250ish each" only in the job line, guardrail without a per-section size: no wordsPerSection, green as today', async () => {
  const { r, dir } = await draft('3 sections, all under 600 words');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal('wordsPerSection' in readDecl(dir).steps[2].close.shape, false);
  assert.doesNotMatch(readFileSync(path.join(dir, 'readout.txt'), 'utf8'), /words each/);
});

test('(e) a model that writes wordsPerSection itself is overwritten with the guardrail\'s number (or dropped when there is none)', async () => {
  const a = await draft('~3 sections, about 180 words each, under 600 words', (x) => { x.steps[2].close.shape.wordsPerSection = 500; });
  assert.equal(a.r.ok, true, JSON.stringify(a.r.reds));
  assert.equal(readDecl(a.dir).steps[2].close.shape.wordsPerSection, 180);
  const b = await draft('3 sections, all under 600 words', (x) => { x.steps[2].close.shape.wordsPerSection = 500; });
  assert.equal(b.r.ok, true, JSON.stringify(b.r.reds));
  assert.equal('wordsPerSection' in readDecl(b.dir).steps[2].close.shape, false);
});
test('(e) a declaration whose wordsPerSection differs from the guardrail (hand-edited, re-hashed) is red at sign', async () => {
  const { r, dir } = await draft('~3 sections, about 180 words each, under 600 words');
  assert.equal(r.ok, true);
  const d = readDecl(dir); d.steps[2].close.shape.wordsPerSection = 500; writeFileSync(path.join(dir, 'declaration.json'), JSON.stringify(d));
  const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.ok(s.reds.some((x) => /wordsPerSection 500; the guardrail says 180 words each/.test(x)), JSON.stringify(s.reds));
});

const WRITE_RED = "step 3's check reads its reply, so it can't write files. The send step writes the result out.";
test('(f) a plan granting write to a softgreen step is red at draft', async () => {
  const { r, dir } = await draft('3 sections, all under 600 words', (x) => { x.steps[2].primitives = ['read', 'write']; });
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes(WRITE_RED)), JSON.stringify(r.reds));
  assert.equal(existsSync(path.join(dir, SPEC_HASH_FILE)), false);
});
test('(f) the same at revise (a second draft over the same card) and at sign (hand-edited, re-hashed)', async () => {
  const first = await draft('3 sections, all under 600 words');
  assert.equal(first.r.ok, true);
  const bad = validArgs(); bad.steps[2].primitives = ['write'];
  const revised = await draftToDir({ proseFile: path.join(first.work, 'prose.txt'), dir: path.join(first.work, 'draft-1'), root: path.join(first.work, 'flows'), name: 'job2', provider: fakeProvider([toolReply(bad)]), rates: RATES, modelId: MODEL, env: {} });
  assert.equal(revised.ok, false);
  assert.ok(revised.reds.some((x) => x.includes(WRITE_RED)), JSON.stringify(revised.reds));
  const d = readDecl(first.dir); d.steps[2].primitives = ['read', 'write']; writeFileSync(path.join(first.dir, 'declaration.json'), JSON.stringify(d));
  const s = signDraft({ dir: first.dir, approve: rehash(first.dir), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.ok(s.reds.some((x) => x.includes(WRITE_RED)), JSON.stringify(s.reds));
});
