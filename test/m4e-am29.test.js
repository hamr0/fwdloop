// M4e amendment 29 (docs/wiki/the-module-ladder.md, "Amendment 29"; builds on 28): the AI picks the whole-output word limit (maxWords);
// code only checks the pick is one of the guardrail's whole-output numbers. wordsPerSection stays code-read (am15 item 1). $0, fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import * as D from '../src/declaration.js';
import { draftToDir, SPEC_HASH_FILE } from '../src/authoring.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const G_OLD = 'guardrail: 3 sections, all under 600 words';
async function draft(guardrail, mutate) {
  const fx = job2Fixture();
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am29-'));
  const proseFile = path.join(work, 'prose.txt');
  assert.ok(fx.prose.includes(G_OLD));
  writeFileSync(proseFile, fx.prose.replace(G_OLD, `guardrail: ${guardrail}`));
  const args = validArgs();
  mutate?.(args);
  const p = fakeProvider([toolReply(args)]);
  const dir = path.join(work, 'draft');
  const r = await draftToDir({ proseFile, dir, root: path.join(work, 'flows'), name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {} });
  return { r, p, dir };
}
const readDecl = (dir) => JSON.parse(readFileSync(path.join(dir, 'declaration.json'), 'utf8'));
const G = '3 sections, under 600 words, each heading at most 3 words';

test('reader: guardrailWordNumbers lists every whole-output "N words", never an "N words each" / "per section"', () => {
  assert.deepEqual(D.guardrailWordNumbers(G), [600, 3]);
  assert.deepEqual(D.guardrailWordNumbers('under 600 words; under 300 words'), [600, 300]);
  assert.deepEqual(D.guardrailWordNumbers('about 250 words each, under 1,000 words'), [1000]);
  assert.deepEqual(D.guardrailWordNumbers('250 words per section'), []);
  assert.deepEqual(D.guardrailWordNumbers('no number'), []);
  assert.deepEqual(D.guardrailWordNumbers(undefined), []);
});

test('smallest no longer wins: the AI picks 600 on "under 600 words, each heading at most 3 words" and the plan is green', async () => {
  const { r, dir } = await draft(G, (a) => { a.steps[2].close.shape.maxWords = 600; });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(readDecl(dir).steps[2].close.shape.maxWords, 600);
});
test('an AI maxWords that is not in the guardrail (700) is red with the signed wording', async () => {
  const { r, dir } = await draft(G, (a) => { a.steps[2].close.shape.maxWords = 700; });
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes("line 3's check says 700 words; the guardrail has no 700.")), JSON.stringify(r.reds));
  assert.equal(existsSync(path.join(dir, SPEC_HASH_FILE)), false);
});
test('an AI maxWords of 3 is in the guardrail, so it is green (the human sees it in Checked at sign)', async () => {
  const { r, dir } = await draft(G, (a) => { a.steps[2].close.shape.maxWords = 3; });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(readDecl(dir).steps[2].close.shape.maxWords, 3);
});

test('a guardrail with no word number and an AI maxWords of 450 is red with the signed wording; a check with no maxWords stays green', async () => {
  const a = await draft('3 sections', (x) => { x.steps[2].close.shape.maxWords = 450; });
  assert.equal(a.r.ok, false);
  assert.ok(a.r.reds.some((x) => x.includes("line 3's check says 450 words; the guardrail has no 450.")), JSON.stringify(a.r.reds));
  const b = await draft(G, (x) => { delete x.steps[2].close.shape.maxWords; });
  assert.equal(b.r.ok, true, JSON.stringify(b.r.reds));
  const c = await draft('3 sections', (x) => { delete x.steps[2].close.shape.maxWords; });
  assert.equal(c.r.ok, true, JSON.stringify(c.r.reds));
});
test('checkShapeFitsJobLine: a step with a maxWords and no guardrail line at all is red too', () => {
  const reds = [];
  D.checkShapeFitsJobLine({ goal: 'g', fromLine: 3, close: { shape: { maxWords: 300 } } }, 0, [{ n: 3 }], reds);
  assert.ok(reds.some((x) => x.includes("line 3's check says 300 words; the guardrail has no 300.")), JSON.stringify(reds));
  const none = [];
  D.checkShapeFitsJobLine({ goal: 'g', close: { shape: { maxWords: 300 } } }, 0, [], none);
  assert.equal(none.length, 1, JSON.stringify(none));
  const ok = [];
  D.checkShapeFitsJobLine({ goal: 'g', fromLine: 3, close: { shape: {} } }, 0, [{ n: 3 }], ok);
  assert.deepEqual(ok, []);
});

test('am15 (a) stays red at $0 before any model call, naming 750 and 600', async () => {
  const { r, p } = await draft('~3 sections, about 250 words each, under 600 words');
  assert.equal(r.ok, false);
  assert.equal(p.calls.length, 0);
  assert.ok(r.reds.includes("line 3's guardrail asks about 250 words for each of 3 sections (750) but under 600 words in total. Change the guardrail."), JSON.stringify(r.reds));
});
test('$0 sum check compares against the LARGEST candidate: 540 fits 600, so no red before the draft', () => {
  assert.deepEqual(D.checkGuardrailSums([{ n: 3, guardrail: '3 sections, 180 words each, under 600 words; under 400 words' }]), []);
});
test('am15 (b): "3 sections, about 180 words each, under 600 words" is green with wordsPerSection 180', async () => {
  const { r, dir } = await draft('~3 sections, about 180 words each, under 600 words');
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(readDecl(dir).steps[2].close.shape.wordsPerSection, 180);
});

test('after the draft the sum uses the AI pick: maxWords 400 < 180 x 3 is red (model was called), maxWords 600 is green', async () => {
  const g = '3 sections, about 180 words each, under 600 words; under 400 words';
  const bad = await draft(g, (a) => { a.steps[2].close.shape.maxWords = 400; });
  assert.equal(bad.r.ok, false);
  assert.ok(bad.p.calls.length >= 1, 'passed the $0 gate, so the model was called');
  assert.ok(bad.r.reds.some((x) => x.includes("line 3's guardrail asks about 180 words for each of 3 sections (540) but the check says 400 words in total.")), JSON.stringify(bad.r.reds));
  const ok = await draft(g, (a) => { a.steps[2].close.shape.maxWords = 600; });
  assert.equal(ok.r.ok, true, JSON.stringify(ok.r.reds));
});

test('the AI schema never carries wordsPerSection', async () => {
  const { buildDeclarationSchema } = await import('../src/drafter.js');
  const shape = buildDeclarationSchema([{ verb: 'read' }]).properties.steps.items.properties.close.properties.shape;
  assert.equal(Object.keys(shape.properties).includes('wordsPerSection'), false);
});
