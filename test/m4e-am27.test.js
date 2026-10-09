// M4e amendment 27 — "Your answers" shows only on the plan drafted from the answers; after a Revise the answers are plain `~` lines in the card. $0: fake-provider child.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isFwdloopAlive } from '../src/liveness.js';
import { JOB, killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const QJOB = JOB.replace('Read my resume,', 'Read my resume QMARK,');
const Q12 = JSON.stringify([{ line: 1, question: 'Which resume do you mean?' }, { line: 2, question: 'Which part of the JD matters most?' }]);
const A2 = 'Count every word except the headings';
const A1 = 'ANSMARK use the resume in my inputs, not an old one';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settleOn = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});

test('am27: answers show on the answer-redraft plan; after a Revise the box is gone and the answer is a ~ line in the newest card', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_REDSTEP: '0,1', FWDLOOP_TEST_DRAFT_QUESTIONS: Q12 } });
  const id = (await w.post('/api/author/draft', w.card({ job: QJOB }))).json().draftId;
  await settleOn(w, id, ['questions-open']);
  await childGone(w, id);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: A1 })).status, 200);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 2, answer: A2 })).status, 202);
  const a = await settleOn(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(a.phase, 'green', JSON.stringify(a));
  assert.equal(a.revises.at(-1).kind, 'answers');
  assert.deepEqual(a.answers.map((x) => [x.line, x.answer]), [[1, A1], [2, A2]]); // (a)
  const job = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8')).job;
  assert.ok(job.includes(A1) && job.includes(A2));
  assert.equal((await w.post(`/api/author/${id}/revise`, w.card({ job }))).status, 202);
  const b = await settleOn(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
  assert.equal(b.phase, 'green', JSON.stringify(b));
  assert.equal(b.revises.at(-1).kind, 'revise');
  assert.deepEqual(b.answers, []); // (b) no separate box
  const newest = JSON.parse(readFileSync(path.join(w.dir(id), `card-${b.revises.at(-1).n}.json`), 'utf8')).job;
  assert.ok(newest.split('\n').some((l) => l.trim().startsWith('~') && l.includes(A1)) && newest.split('\n').some((l) => l.trim().startsWith('~') && l.includes(A2)), 'the answers are ~ guardrails in the newest card');
});
