// M10 am32 Part A (docs/wiki/the-module-ladder.md, last block): the panel answer door refuses an answer with no typed `choice`; old answer files are still read.
// $0: the real panel door and the real `fwdloop draft` child (fake provider), no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { readQuestions } from '../src/authoring.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { ruleOfAnswer } from '../src/pageask.js';
import {
  killChildrenAfter, until, world, JOB, tmp,
} from './m4e-world.mjs';

killChildrenAfter();
const SAY = 'This page is out of date. Reload it and answer again. Nothing was saved.';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settleOn = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
/** a draft with one drafter question open (QMARK makes the fake drafter ask) */
async function drafterWorld() {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_OFFERED_LOG: path.join(tmp('am32-off'), 'offered.log') } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB.replace('Read my resume,', 'Read my resume QMARK,') }))).json().draftId;
  const s = await settleOn(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(s.phase, 'questions-open', JSON.stringify(s));
  return { w, id };
}
const folder = (w, id) => ({ top: readdirSync(w.dir(id)).sort(), draft: readdirSync(path.join(w.dir(id), 'draft')).sort() });

test('no choice: 400 bad-choice with the signed words; no answer file, no redraft file, no child, folder unchanged', async () => {
  const { w, id } = await drafterWorld();
  const before = folder(w, id);
  for (const body of [{ k: 1, answer: 'the 2024 one' }, { k: 1 }, { k: 1, answer: 'agree' }]) {
    const r = await w.post(`/api/author/${id}/answer`, body);
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json().refused, 'bad-choice');
    assert.equal(r.json().say, SAY);
  }
  assert.deepEqual(folder(w, id), before);
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false);
  assert.equal(existsSync(path.join(w.dir(id), 'redraft-1.json')), false);
  assert.equal(existsSync(path.join(w.dir(id), 'pid.json')) && (() => { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) === true; })(), false, 'no child started');
});

test('choice rule on a drafter question still works and is recorded', async () => {
  const { w, id } = await drafterWorld();
  const ok = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'the 2024 one', choice: 'rule' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8')).choice, 'rule');
});

test('an old answer file with no choice is still read by readQuestions and ruleOfAnswer (words path)', async () => {
  const { w, id } = await drafterWorld();
  const planDir = path.join(w.dir(id), 'draft');
  const ok = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'the 2024 one', choice: 'rule' });
  assert.equal(ok.status, 200, ok.text);
  const f = path.join(planDir, 'answer-1.json');
  const a = JSON.parse(readFileSync(f, 'utf8'));
  delete a.choice;
  writeFileSync(f, JSON.stringify(a));
  const q = readQuestions(planDir).questions[0];
  assert.equal(q.answer, 'the 2024 one');
  assert.equal(q.choice, undefined);
  assert.deepEqual(ruleOfAnswer({ source: 'look', ask: 'reading', proposal: 'p' }, 'Agree.'), { rule: 'p', left: false });
  assert.deepEqual(ruleOfAnswer(q, 'the 2024 one', q.choice), { rule: 'the 2024 one', left: false });
});
