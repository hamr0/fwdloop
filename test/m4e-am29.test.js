// M4e amendment 29 (builds on 28): code only checks a maxWords is one of the guardrail's whole-output numbers. M10 am16 replaced "the AI picks": the drafter writes no check,
// so these rules now judge a shape by direct call (a signed plan edited by hand is still held to them) and the $0 sum gate still runs before any call. $0, fake provider.
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
  assert.ok(fx.proseG.includes(G_OLD));
  writeFileSync(proseFile, fx.proseG.replace(G_OLD, `guardrail: ${guardrail}`));
  const args = validArgs();
  mutate?.(args);
  const p = fakeProvider([toolReply(args)]);
  const dir = path.join(work, 'draft');
  const r = await draftToDir({ proseFile, dir, root: path.join(work, 'flows'), name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {}, noQuestions: true });
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

const reds = (guardrail, shape) => { const out = []; D.checkShapeFitsJobLine({ fromLine: 3, goal: 'x y', close: { class: 'softgreen', shape } }, 2, [{ n: 3, guardrail }], out); return out; };

test('smallest no longer wins: a maxWords of 600 on "under 600 words, each heading at most 3 words" has no red', () => {
  assert.deepEqual(reds(G, { maxWords: 600 }), []);
});
test('a maxWords that is not in the guardrail (700) is red with the signed wording', () => {
  assert.ok(reds(G, { maxWords: 700 }).some((x) => x.includes("line 3's check says 700 words; the guardrail has no 700.")));
});
test('a maxWords of 3 is in the guardrail (no "has no 3" red)', () => {
  assert.ok(!reds(G, { maxWords: 3 }).some((x) => x.includes('the guardrail has no 3')));
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
test('after a sections check the sum uses the maxWords: 400 < 180 x 3 is red, 600 is not', () => {
  const g = '3 sections, about 180 words each, under 600 words; under 400 words';
  assert.ok(reds(g, { maxWords: 400, sections: ['a', 'b', 'c'], wordsPerSection: 180 }).some((x) => x.includes("line 3's guardrail asks about 180 words for each of 3 sections (540) but the check says 400 words in total.")));
  assert.ok(!reds('3 sections, about 180 words each, under 600 words', { maxWords: 600, sections: ['a', 'b', 'c'], wordsPerSection: 180 }).some((x) => x.includes('in total')));
});
test('a drafted job whose guardrail has a per-section size is green with a picked check (M10 am16)', async () => {
  const fx = job2Fixture();
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am29b-'));
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.proseG.replace(G_OLD, 'guardrail: ~3 sections, about 180 words each, under 600 words'));
  const p = fakeProvider([toolReply(validArgs())]);
  const dir = path.join(work, 'draft');
  const r = await draftToDir({ proseFile, dir, root: path.join(work, 'flows'), name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {}, noQuestions: true, checkPicks: [{ line: 3, rule: 1, check: { rule: 'maxWords', value: 600 }, added: 'at most 600 words' }] });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(readDecl(dir).steps[2].close.shape, { picked: [{ rule: 'maxWords', value: 600 }] });
});

test('the AI schema never carries wordsPerSection (nor any shape)', async () => {
  const { buildDeclarationSchema } = await import('../src/drafter.js');
  const close = buildDeclarationSchema([{ verb: 'read' }]).properties.steps.items.properties.close;
  assert.equal(close.properties.shape, undefined);
  assert.equal(JSON.stringify(close).includes('wordsPerSection'), false);
});
