// M4e amendment 16 group 1 (docs/wiki/the-module-ladder.md, "Amendment 16 — SIGNED"): C13, C14, C12. $0, fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import * as D from '../src/declaration.js';
const firstNum = (g) => D.guardrailWordNumbers(g)[0] ?? null; // these inputs hold one whole-output number
import { draftToDir, signDraft, specHash, SPEC_HASH_FILE } from '../src/authoring.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

const G_OLD = 'guardrail: 3 sections, all under 600 words';
const works = [];
async function draft(guardrail, mutate) {
  const fx = job2Fixture();
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am16c-'));
  works.push(work);
  const proseFile = path.join(work, 'prose.txt');
  assert.ok(fx.prose.includes(G_OLD));
  writeFileSync(proseFile, fx.prose.replace(G_OLD, `guardrail: ${guardrail}`));
  const args = validArgs();
  mutate?.(args);
  const p = fakeProvider([toolReply(args), toolReply(args), toolReply(args)]);
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
const editDecl = (dir, f) => { const d = readDecl(dir); f(d); writeFileSync(path.join(dir, 'declaration.json'), JSON.stringify(d)); };
test.after(() => { for (const w of works) rmSync(w, { recursive: true, force: true }); });

// ---- C14: thousands separators ------------------------------------------------------------------------------------------------
for (const [g, limit, per] of [
  ['3 sections, all under 1,000 words', 1000, null],
  ['3 sections, 1,000 words', 1000, null],
  ['about 1,000 words each', null, 1000],
  ['1,000 words per section', null, 1000],
  ['2,500ish each', null, 2500],
  ['under 12,345,678 words', 12345678, null],
  ['3 sections, all under 600 words', 600, null],
  ['under 1,00 words', null, null],
  ['under 1,0000 words', null, null],
  ['1,00 words each', null, null],
  ['1,0000 words each', null, null],
  ['1,0000 words', null, null],
]) {
  test(`C14 reader: "${g}" reads limit ${limit}, each ${per}`, () => {
    assert.equal(firstNum(g), limit);
    assert.equal(D.guardrailWordsPerSection(g), per);
  });
}
test('C14: the sum check uses the comma number (3 sections x 400 words each > under 1,000 words)', () => {
  const reds = D.checkGuardrailSums([{ n: 3, guardrail: '3 sections, 400 words each, under 1,000 words' }]);
  assert.deepEqual(reds, ["line 3's guardrail asks about 400 words for each of 3 sections (1200) but under 1000 words in total. Change the guardrail."]);
});

// ---- C13 ----------------------------------------------------------------------------------------------------------------------
test('C13 draft: a size for each section with no number of sections is red at $0, naming the line', async () => {
  const { r, p, dir } = await draft('about 250 words each, under 1000 words');
  assert.equal(r.ok, false);
  assert.equal(p.calls.length, 0, 'no model call');
  assert.ok(r.reds.some((x) => /line 3's guardrail gives 250 words for each section but not how many sections/.test(x)), JSON.stringify(r.reds));
  assert.equal(existsSync(path.join(dir, SPEC_HASH_FILE)), false);
});
test('C13 sign: a draft whose guardrail was edited to size-without-count (re-hashed) is refused', async () => {
  const { r, dir, work } = await draft('~3 sections, about 180 words each, under 600 words');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const pf = path.join(dir, 'prose.txt');
  writeFileSync(pf, readFileSync(pf, 'utf8').replace('guardrail: ~3 sections, about 180 words each, under 600 words', 'guardrail: about 180 words each, under 600 words'));
  const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.ok(s.reds.some((x) => /line 3's guardrail gives 180 words for each section but not how many sections/.test(x)), JSON.stringify(s.reds));
  assert.equal(existsSync(path.join(work, 'flows', 'job2')), false);
});
test('C13 sign: a check with wordsPerSection and no section names is red by step and key', async () => {
  const { r, dir } = await draft('~3 sections, about 180 words each, under 600 words');
  assert.equal(r.ok, true);
  editDecl(dir, (d) => { delete d.steps[2].close.shape.sections; });
  const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.ok(s.reds.some((x) => /steps\[2\]\.close\.shape has wordsPerSection but no sections/.test(x)), JSON.stringify(s.reds));
});
test('C13 draft/revise: the validator refuses wordsPerSection with no sections', () => {
  const reds = [];
  D.checkShapeFitsJobLine({ fromLine: 3, goal: 'x y', close: { shape: { maxWords: 600, wordsPerSection: 180 } } }, 1, [{ n: 3, guardrail: '3 sections, 180 words each, under 600 words' }], reds);
  assert.ok(reds.some((x) => /steps\[1\]\.close\.shape has wordsPerSection but no sections/.test(x)), JSON.stringify(reds));
});

// ---- C12 ----------------------------------------------------------------------------------------------------------------------
for (const [have, miss, val] of [['linesPerInvoice', 'mustCarry', 3], ['mustCarry', 'linesPerInvoice', ['total']]]) {
  test(`C12 draft/revise: a check with ${have} and no ${miss} is red by step and key`, () => {
    const reds = [];
    D.checkShapeFitsJobLine({ fromLine: 3, goal: 'x y', close: { shape: { [have]: val } } }, 2, [{ n: 3, guardrail: '' }], reds);
    assert.ok(reds.some((x) => x.includes(`steps[2].close.shape has ${have} but no ${miss}`)), JSON.stringify(reds));
  });
  test(`C12 sign: a signed-draft edited to carry only ${have} (re-hashed) is refused`, async () => {
    const { r, dir, work } = await draft('3 sections, all under 600 words');
    assert.equal(r.ok, true, JSON.stringify(r.reds));
    editDecl(dir, (d) => { d.steps[2].close.shape[have] = val; });
    const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
    assert.equal(s.ok, false);
    assert.ok(s.reds.some((x) => x.includes(`steps[2].close.shape has ${have} but no ${miss}`)), JSON.stringify(s.reds));
    assert.equal(existsSync(path.join(work, 'flows', 'job2')), false);
  });
}
test('C12: the pair together is still fine', () => {
  const reds = [];
  D.checkShapeFitsJobLine({ fromLine: 3, goal: 'x y', close: { shape: { linesPerInvoice: 3, mustCarry: ['total'] } } }, 0, [{ n: 3, guardrail: '' }], reds);
  assert.deepEqual(reds, []);
});
