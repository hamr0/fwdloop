// M4e amendment 18 (docs/wiki/the-module-ladder.md): the soft checks run on bareguard; shapes it cannot build are
// red at draft/revise/sign by name; a build that fails at run time is a crash, never green.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import * as C from '../src/closers.js';
import * as D from '../src/declaration.js';
import { draftToDir, signDraft, specHash, SPEC_HASH_FILE } from '../src/authoring.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

const works = [];
test.after(() => { for (const w of works) rmSync(w, { recursive: true, force: true }); });

// ---- front door: a booby-trapped answer object can no longer crash the check ---------------------------------------------------
test('front door: a throwing Proxy answer is unparseable or red, never an exception', async () => {
  const bad = new Proxy({ text: 'x' }, { ownKeys() { throw new Error('boom'); }, getOwnPropertyDescriptor() { throw new Error('boom'); } });
  let r;
  try { r = await C.closeSoftgreen(bad, { maxWords: 10 }); } catch (e) { assert.fail(`closeSoftgreen threw: ${e.message}`); }
  assert.ok(r.verdict === 'unparseable' || r.verdict === 'red', JSON.stringify(r));
  assert.notEqual(r.verdict, 'green');
});
test('front door: a Proxy whose text getter throws is not green and does not throw', async () => {
  const bad = new Proxy({}, { get() { throw new Error('boom'); }, ownKeys() { throw new Error('boom'); } });
  let r;
  try { r = await C.closeSoftgreen(bad, {}); } catch (e) { assert.fail(`closeSoftgreen threw: ${e.message}`); }
  assert.ok(r.verdict === 'unparseable' || r.verdict === 'red', JSON.stringify(r));
});

// ---- run time: a shape bareguard cannot build is a crash, never green ---------------------------------------------------------------
for (const [label, shape] of [
  ['maxWords 0', { maxWords: 0 }],
  ['wordsPerSection 2.5', { sections: ['A'], wordsPerSection: 2.5 }],
  ['empty sections', { maxWords: 10, sections: [] }],
  ['empty mustCarry', { linesPerInvoice: 2, mustCarry: [] }],
  ['section name ending ":"', { sections: ['Skills:'] }],
]) {
  test(`run time: ${label} cannot build, so the step is crash, never green`, async () => {
    const r = await C.closeSoftgreen({ text: 'x' }, shape);
    assert.equal(r.verdict, 'crash', JSON.stringify(r));
    assert.match(r.red, /softgreen close crashed/);
  });
}

// ---- refuse at sign: every shape the builder throws on is red in the one shared validator ----------------------------------------
function validatorReds(shape) {
  const reds = [];
  // wordsPerSection is the guardrail's own number (amendment 15), so the line states the same one.
  // maxWords is the AI's pick from the guardrail's whole-output number (amendments 28 + 29), so the line states it too.
  const per = Number.isInteger(shape.wordsPerSection) && Array.isArray(shape.sections) ? `${shape.sections.length} sections, ${shape.wordsPerSection} words each` : '';
  const guardrail = [per, Number.isInteger(shape.maxWords) && shape.maxWords > 0 ? `under ${shape.maxWords} words` : ''].filter(Boolean).join(', ');
  const LINES = [{ n: 3, guardrail }];
  const step = { fromLine: 3, goal: 'write the summary and the skills and the a and the soft skills', close: { shape } };
  const sh = D.checkShapes({ steps: [step] });
  reds.push(...sh.reds);
  D.checkShapeFitsJobLine(step, 0, LINES, reds);
  return reds;
}
const BAD = [
  ['maxWords 0', { maxWords: 0 }, /maxWords/],
  ['maxWords 2.5', { maxWords: 2.5 }, /maxWords/],
  ['wordsPerSection 0', { sections: ['summary'], wordsPerSection: 0 }, /wordsPerSection/],
  ['wordsPerSection 2.5', { sections: ['summary'], wordsPerSection: 2.5 }, /wordsPerSection/],
  ['linesPerInvoice 0', { linesPerInvoice: 0, mustCarry: ['total'] }, /linesPerInvoice/],
  ['empty sections', { sections: [] }, /sections/],
  ['empty mustCarry', { linesPerInvoice: 2, mustCarry: [] }, /mustCarry/],
  ['empty-string section', { sections: [''] }, /sections/],
  ['blank section', { sections: ['   '] }, /sections.*blank|blank.*sections/],
  ['blank mustCarry phrase', { linesPerInvoice: 2, mustCarry: ['total', '  '] }, /mustCarry.*blank|blank.*mustCarry/],
  ['section name ending ":"', { sections: ['summary', 'skills:'] }, /"skills:".*":"/],
  ['section name ending ":" after trim', { sections: ['skills :  '] }, /":"/],
  ['section name past 1000 characters', { sections: ['s'.repeat(1001)] }, /sections.*1000|1000.*sections/],
  ['mustCarry phrase past 1000 characters', { linesPerInvoice: 2, mustCarry: ['m'.repeat(1001)] }, /mustCarry.*1000|1000.*mustCarry/],
  ['mustCarry holds a number', { linesPerInvoice: 2, mustCarry: [5] }, /mustCarry/],
  ['wordsPerSection with no sections', { maxWords: 100, wordsPerSection: 20 }, /wordsPerSection/],
  ['linesPerInvoice with no mustCarry', { linesPerInvoice: 2 }, /linesPerInvoice|mustCarry/],
];
for (const [label, shape, named] of BAD) {
  test(`refuse at sign: ${label} is red by name`, () => {
    const reds = validatorReds(shape);
    assert.ok(reds.length > 0, `no red for ${JSON.stringify(shape)}`);
    assert.ok(reds.some((x) => named.test(x)), JSON.stringify(reds));
  });
  test(`one decider: ${label} - if the run-time builder throws, the validator is red`, () => {
    assert.equal(typeof C.buildSoftgreenRubric, 'function', 'closers.js exports the one builder');
    let throws = false;
    try { C.buildSoftgreenRubric(shape); } catch { throws = true; }
    if (throws) assert.ok(validatorReds(shape).length > 0, JSON.stringify(shape));
  });
}
test('refuse at sign: a good shape is not red, and builds', () => {
  const shape = { maxWords: 600, sections: ['summary', 'skills'], wordsPerSection: 100, linesPerInvoice: 2, mustCarry: ['total'] };
  assert.deepEqual(validatorReds(shape), []);
  assert.doesNotThrow(() => C.buildSoftgreenRubric(shape));
});
test('refuse at sign: a shape the validator passes always builds (no gap between sign and run)', () => {
  const shapes = [{}, { maxWords: 1 }, { sections: ['a'] }, { sections: ['a'], wordsPerSection: 1 }, { linesPerInvoice: 1, mustCarry: ['x'] }, { sections: ['soft skills'], maxWords: 9 }];
  for (const s of shapes) {
    assert.deepEqual(validatorReds(s), [], JSON.stringify(s));
    assert.doesNotThrow(() => C.buildSoftgreenRubric(s), JSON.stringify(s));
  }
});

// ---- sign, end to end: an edited (re-hashed) draft carrying a ":" section name is refused ----------------------------------------
test('refuse at sign: signDraft refuses a draft edited to name a section "Skills:"', async () => {
  const fx = job2Fixture();
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am18-'));
  works.push(work);
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const args = validArgs();
  const dir = path.join(work, 'draft');
  const r = await draftToDir({ proseFile, dir, root: path.join(work, 'flows'), name: 'job2', provider: fakeProvider([toolReply(args), toolReply(args), toolReply(args)]), rates: RATES, modelId: MODEL, env: {} });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const dp = path.join(dir, 'declaration.json');
  const d = JSON.parse(readFileSync(dp, 'utf8'));
  const i = d.steps.findIndex((s) => Array.isArray(s.close?.shape?.sections));
  assert.ok(i >= 0, 'fixture has a step with sections');
  d.steps[i].close.shape.sections[0] += ':';
  writeFileSync(dp, JSON.stringify(d));
  const rd = (f) => readFileSync(path.join(dir, f), 'utf8');
  const h = specHash({ proseText: rd('prose.txt'), declarationText: rd('declaration.json'), inputFactsText: rd('input-facts.json'), readoutText: rd('readout.txt'), targetText: rd('target.json') }).hash;
  writeFileSync(path.join(dir, SPEC_HASH_FILE), `${h}\n`);
  const s = signDraft({ dir, approve: h, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.ok(s.reds.some((x) => /":"/.test(x)), JSON.stringify(s.reds));
  assert.equal(existsSync(path.join(work, 'flows', 'job2')), false);
});
