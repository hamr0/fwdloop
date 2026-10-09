// M4e amendment 24 item 5 — "Your answers" survive a revise. $0: the real panel door against the fake-provider child, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isFwdloopAlive } from '../src/liveness.js';
import { JOB, killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const QJOB = JOB.replace('Read my resume,', 'Read my resume QMARK,');
const Q12 = JSON.stringify([{ line: 1, question: 'Which resume do you mean?' }, { line: 2, question: 'Which part of the JD matters most?' }]);
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settleOn = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
const A1 = 'ANSMARK use the resume in my inputs, not an old one';
const A2 = 'Count every word except the headings';

/** Ask, answer both, get the redraft green; returns the world, the id and the redraft's card job. */
async function answeredWorld() {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_REDSTEP: '0,1', FWDLOOP_TEST_DRAFT_QUESTIONS: Q12 } });
  const id = (await w.post('/api/author/draft', w.card({ job: QJOB }))).json().draftId;
  await settleOn(w, id, ['questions-open']);
  await childGone(w, id);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: A1 })).status, 200);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 2, answer: A2 })).status, 202);
  const g = await settleOn(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  const job = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8')).job;
  return { w, id, job };
}
/** Revise with the given job; returns the state once the revise is green. */
async function reviseGreen(w, id, job) {
  const r = await w.post(`/api/author/${id}/revise`, w.card({ job }));
  assert.equal(r.status, 202, r.text);
  const g = await settleOn(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  return g;
}

test('K1: answer, redraft, revise (answers kept in the card), green: Your answers still shows both, and sign-prepare sends them', async () => {
  const { w, id, job } = await answeredWorld();
  const g = await reviseGreen(w, id, job);
  assert.equal(g.revises.at(-1).kind, 'revise', 'the newest plan is a revise, not a redraft');
  assert.deepEqual(g.answers.map((a) => [a.line, a.answer]), [[1, A1], [2, A2]]);
  assert.match(g.answers[1].lineText, /^and read the JD/);
  const sp = (await w.post(`/api/author/${id}/sign-prepare`, {})).json();
  assert.equal(sp.ok, true);
  assert.deepEqual(sp.answers.map((a) => a.answer), [A1, A2]);
});

test('K2: a revise that changed one answer\'s text hides that answer only', async () => {
  const { w, id, job } = await answeredWorld();
  assert.ok(job.includes(A1));
  const g = await reviseGreen(w, id, job.replace(A1, 'ANSMARK a different instruction of my own'));
  assert.deepEqual(g.answers.map((a) => a.answer), [A2]);
});

test('K3: no redraft ever means no answers', async () => {
  const w = await world({});
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await settleOn(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  assert.deepEqual(g.answers, []);
  const g2 = await reviseGreen(w, id, w.card().job);
  assert.deepEqual(g2.answers, []);
  assert.equal(existsSync(path.join(w.dir(id), 'redraft-1.json')), false);
});
