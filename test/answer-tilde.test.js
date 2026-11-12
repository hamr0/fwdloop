// Fix ledger line 29 (hamr ruling 2A, 2026-11-07): an answer that already starts with `~` ("~ keep it short") was written as `~ ~ keep it short`.
// The panel's answer gate now drops the person's leading `~` quietly; a tilde-only answer is a blank answer. Real panel door, real draft child, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import { isFwdloopAlive } from '../src/liveness.js';
import path from 'node:path';
import { parseJobBox } from '../src/panel/authorcard.js';
import {
  JOB, killChildrenAfter, until, world, tmp,
} from './m4e-world.mjs';

killChildrenAfter();
const QJOB = JOB.replace('Read my resume,', 'Read my resume QMARK,');
const Q12 = JSON.stringify([{ line: 1, question: 'Which resume do you mean?' }, { line: 2, question: 'Which part of the JD matters most?' }]);
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
async function askingWorld() {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_OFFERED_LOG: path.join(tmp('offered'), 'offered.log'), FWDLOOP_TEST_DRAFT_REDSTEP: '0,1', FWDLOOP_TEST_DRAFT_QUESTIONS: Q12 } });
  const id = (await w.post('/api/author/draft', w.card({ job: QJOB }))).json().draftId;
  await until(async () => { const j = await state(w, id); return j?.phase === 'questions-open' ? j : null; });
  await until(() => {
    try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
  });
  return { w, id };
}

test('a tilde-only answer is a blank answer: refused, no answer file, the question stays open', async () => {
  const { w, id } = await askingWorld();
  for (const answer of ['~', ' ~ ', '~~', '~ ~ ~']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer, choice: 'rule' });
    assert.equal(r.status, 400, JSON.stringify(answer));
    assert.equal(r.json().refused, 'blank-answer');
  }
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false);
  assert.equal((await state(w, id)).openK, 1);
});

test('an answer that starts with ~ is written as ONE `~ ` rule line in the card, never `~ ~`', async () => {
  const { w, id } = await askingWorld();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: '~ keep it short', choice: 'rule' })).status, 200);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 2, answer: ' ~~keep it short', choice: 'rule' })).status, 202);
  await until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.equal(card.job.split('\n').filter((l) => l === '~ keep it short').length, 2);
  assert.doesNotMatch(card.job, /~\s*~/);
  const steps = parseJobBox(card.job).steps;
  assert.deepEqual([steps[0].guardrails, steps[1].guardrails], [['keep it short'], ['keep it short']]);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8')).answer, 'keep it short');
});
