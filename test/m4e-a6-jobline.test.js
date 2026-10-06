// M4e amendment 6 item 1 + negatives (a) (b) (docs/wiki/the-module-ladder.md, "M4e", "Amendment 6"): a plan, first draft or
// change, cannot fight its step's job line. $0, fake provider. The replay of hamr's real "put skills before work history"
// note is paid and not here; this proves the same plan shape (the sections reordered) is red at draft and at change.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

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
  const note = path.join(work, 'note.txt');
  writeFileSync(note, 'put skills before work history');
  return { work, root, proseFile, dir, note, first: r };
}
const change = (w, args) => {
  const provider = fakeProvider([toolReply(args)]);
  return { provider, run: () => draftToDir({ proseFile: w.proseFile, dir: path.join(w.work, 'draft-1'), root: w.root, name: 'job2', provider, rates: RATES, modelId: MODEL, env: {}, reviseFrom: w.dir, noteFile: w.note }) };
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

test('(b) a note that changes only what a step carries (a mustCarry word, the sections kept in the line\'s order) is a green plan', async () => {
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
