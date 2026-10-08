// M4e amendment 6 item 1 + negatives (a) (b) (docs/wiki/the-module-ladder.md, "M4e", "Amendment 6"): a plan, first draft or
// change, cannot fight its step's job line. $0, fake provider. The replay of hamr's real "put skills before work history"
// note is paid and not here; this proves the same plan shape (the sections reordered) is red at draft and at change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { checkShapeFitsJobLine } from '../src/declaration.js';
import { draftToDir, SPEC_HASH_FILE } from '../src/authoring.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-a6-${p}-`));
const SKILLS_FIRST = ['professional skills', 'summary of work history blurb', 'soft skills'];

async function firstDraft() {
  const fx = job2Fixture();
  const work = tmp('w');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const root = path.join(work, 'flows');
  const dir = path.join(work, 'draft');
  const r = await draftToDir({
    proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  return { work, root, proseFile, dir, first: r };
}
const change = (w, args) => {
  const provider = fakeProvider([toolReply(args)]);
  return { provider, run: () => draftToDir({ proseFile: w.proseFile, dir: path.join(w.work, 'draft-1'), root: w.root, name: 'job2', provider, rates: RATES, modelId: MODEL, env: {} }) };
};

test('(a) a change that reorders a section against its job line is red naming the step and both orders; the last green plan stays', async () => {
  const w = await firstDraft();
  const bad = validArgs();
  bad.steps[2].close.shape.sections = SKILLS_FIRST;
  const { run } = change(w, bad);
  const r = await run();
  assert.equal(r.ok, false);
  const red = r.reds.find((x) => /the job line says/.test(x));
  assert.ok(red, JSON.stringify(r.reds));
  assert.match(red, /steps\[2\]/);
  assert.match(red, /the job line says summary of work history blurb, then professional skills, then soft skills; the check says professional skills, then summary of work history blurb, then soft skills — change the job line on the card to change the order/);
  assert.equal(existsSync(path.join(w.work, 'draft-1', SPEC_HASH_FILE)), false, 'no spec.hash: unsignable');
  assert.equal(readFileSync(path.join(w.dir, SPEC_HASH_FILE), 'utf8').trim(), w.first.hash, 'the last green plan is untouched');
});

test('(a) the same at a FIRST draft: red, nothing to sign', async () => {
  const fx = job2Fixture();
  const work = tmp('f');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const bad = validArgs();
  bad.steps[2].close.shape.sections = SKILLS_FIRST;
  const r = await draftToDir({
    proseFile, dir: path.join(work, 'd'), root: path.join(work, 'flows'), name: 'job2', provider: fakeProvider([toolReply(bad)]), rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => /the job line says .* the check says /.test(x)), JSON.stringify(r.reds));
  assert.equal(existsSync(path.join(work, 'd', SPEC_HASH_FILE)), false);
});

for (const [what, mutate, re] of [
  ['a renamed section not in the job line', (a) => { a.steps[2].close.shape.sections = ['summary of work history blurb', 'professional skills', 'hobbies']; }, /names "hobbies", which is not in the job line's words/],
  ['a tighter word limit than the line\'s guardrail', (a) => { a.steps[2].close.shape.maxWords = 300; }, /guardrail says 600 words; the check says 300/],
  ['a looser word limit than the line\'s guardrail', (a) => { a.steps[2].close.shape.maxWords = 900; }, /guardrail says 600 words; the check says 900/],
]) {
  test(`(a) a change with ${what} is red and names both`, async () => {
    const w = await firstDraft();
    const bad = validArgs();
    mutate(bad);
    const r = await change(w, bad).run();
    assert.equal(r.ok, false);
    assert.ok(r.reds.some((x) => re.test(x)), JSON.stringify(r.reds));
    assert.equal(existsSync(path.join(w.work, 'draft-1', SPEC_HASH_FILE)), false);
  });
}

test('(b) a revise that changes only what a step carries (a mustCarry word, the sections kept in the line\'s order) is a green plan', async () => {
  const w = await firstDraft();
  const ok = validArgs();
  ok.steps[2].close.shape.mustCarry = ['JD'];
  const r = await change(w, ok).run();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.notEqual(r.hash, w.first.hash);
});

test('(b) a plan whose tool or read changes (not its check) is green', async () => {
  const w = await firstDraft();
  const ok = validArgs();
  ok.steps[2].reads = [...ok.steps[2].reads].reverse();
  const r = await change(w, ok).run();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
});

// M4e amendment 7 item 1 / negative (a): a check cannot be emptied. Each case is red at a first draft and names the cause.
const FIRST_DRAFT = async (bad) => {
  const fx = job2Fixture();
  const work = tmp('a7');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const r = await draftToDir({
    proseFile, dir: path.join(work, 'd'), root: path.join(work, 'flows'), name: 'job2', provider: fakeProvider([toolReply(bad)]), rates: RATES, modelId: MODEL, env: {},
  });
  return { r, work };
};
for (const [what, mutate, re] of [
  ['one section on a "3 sections" guardrail', (a) => { a.steps[2].close.shape.sections = ['soft skills']; }, /the guardrail says 3 sections; the check has 1/],
  ['four sections on a "3 sections" guardrail', (a) => { a.steps[2].close.shape.sections = ['summary of work history blurb', 'professional skills', 'soft skills', 'professional']; }, /the guardrail says 3 sections; the check has 4/],
  ['a section named by the whole job line', (a) => { a.steps[2].close.shape.sections = [a.steps[2].goal]; }, /at most 8 words/],
  ['a section name that contains another', (a) => { a.steps[2].close.shape.sections = ['soft skills', 'professional skills and soft skills', 'summary of work history blurb']; }, /contains "soft skills" — one section name may not contain another/],
]) {
  test(`(a7) a first draft with ${what} is red, nothing to sign`, async () => {
    const bad = validArgs();
    mutate(bad);
    const { r, work } = await FIRST_DRAFT(bad);
    assert.equal(r.ok, false);
    assert.ok(r.reds.some((x) => re.test(x)), JSON.stringify(r.reds));
    assert.equal(existsSync(path.join(work, 'd', SPEC_HASH_FILE)), false);
  });
}

test('(a7) the real replay shape: a change that swaps the three sections for ONE equal to the whole line is red and the last green plan stays', async () => {
  const w = await firstDraft();
  const bad = validArgs();
  bad.steps[2].close.shape.sections = [bad.steps[2].goal];
  const r = await change(w, bad).run();
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => /the guardrail says 3 sections; the check has 1/.test(x)), JSON.stringify(r.reds));
  assert.ok(r.reds.some((x) => /the job line or most of it|at most 8 words/.test(x)), JSON.stringify(r.reds));
  assert.equal(readFileSync(path.join(w.dir, SPEC_HASH_FILE), 'utf8').trim(), w.first.hash);
});

test('(a7) a section name over 8 words is red naming it', async () => {
  const bad = validArgs();
  const long = 'one two three four five six seven eight nine';
  bad.steps[2].close.shape.sections = [long, 'professional skills', 'soft skills'];
  const { r } = await FIRST_DRAFT(bad);
  assert.equal(r.ok, false);
  assert.ok(r.reds.some((x) => x.includes(`"${long}" (9 words)`)), JSON.stringify(r.reds));
});

test('(a7) a short line whose section name is most of it (>= 60% of its words) is red; a 2-of-6-word section is not', () => {
  const step = (sections) => ({ fromLine: 1, goal: 'write the summary of work history', close: { shape: { sections } } });
  const lines = [{ n: 1, text: 'write the summary of work history', guardrail: '1 section' }];
  const red = []; checkShapeFitsJobLine(step(['summary of work history']), 0, lines, red);
  assert.ok(red.some((x) => /the job line or most of it/.test(x)), JSON.stringify(red));
  const ok = []; checkShapeFitsJobLine(step(['work history']), 0, lines, ok);
  assert.deepEqual(ok, []);
});

test('(a7) the guardrail count reads digits and words one..ten', () => {
  const run = (g, n) => { const r = []; checkShapeFitsJobLine({ fromLine: 1, goal: 'a b c d e f g h i j k l', close: { shape: { sections: Array.from({ length: n }, (_, i) => `s${i}`).map((x, i) => ['a b', 'c d', 'e f', 'g h'][i] ?? x) } } }, 0, [{ n: 1, guardrail: g }], r); return r; };
  assert.deepEqual(run('two sections', 2), []);
  assert.match(run('three sections', 2)[0], /says 3 sections; the check has 2/);
  assert.match(run('4 sections, under 600 words', 2)[0], /says 4 sections; the check has 2/);
  assert.deepEqual(run('no count here', 2), []);
});
