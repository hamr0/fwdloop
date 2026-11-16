// M13 am11 rules 1 and 2 through the real panel (real draft child, test provider, $0): the question with the signed words and Agree / Drop it / the box; Agree or typed words add the last line and the
// redraft keeps the send (`--action known`); Drop it leaves no write (`--action none`); the plan card's action row and its Drop (a redraft with `--action none`).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { isFwdloopAlive } from '../src/liveness.js';
import { JOB, killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const NO_ACTION = { FWDLOOP_TEST_DRAFT_ACTION: 'none', FWDLOOP_TEST_DRAFT_ACTION_LINE: 'write it out' };
const JOB4 = JOB.replace(/\nwrite it out$/, ''); // the job without its last (action) line
assert.notEqual(JOB4, JOB);
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const idle = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
async function asked() {
  const w = await world({ extraEnv: NO_ACTION });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB4 }))).json().draftId;
  const s = await until(async () => { const j = await state(w, id); return j?.phase === 'questions-open' ? j : null; });
  await idle(w, id);
  return { w, id, s };
}
const settled = (w, id) => until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });

test('no action: the question has the signed words and Agree / Drop it / the box; nothing is in the job or the prose yet', async () => {
  const { s } = await asked();
  assert.equal(s.questions.length, 1);
  const q = s.questions[0];
  assert.equal(q.question, 'Your job has no last step that writes it out. I suggest: "write it out". ');
  assert.deepEqual([q.source, q.ask, q.proposes, q.drops], ['look', 'action', true, true]);
});

test('Agree adds the suggested line as the last line; the redraft keeps the send on it and does not ask the AI again', async () => {
  const { w, id } = await asked();
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' });
  assert.equal(r.status, 202, JSON.stringify(r.json()));
  const s = await settled(w, id);
  assert.equal(s.phase, 'green', JSON.stringify(s.reds ?? s.say));
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.equal(card.job, `${JOB4}\nwrite it out`);
  const prose = readFileSync(path.join(w.dir(id), 'prose-1.txt'), 'utf8');
  assert.match(prose, /\n5\. write it out\n/);
  assert.match(prose, /send at line 5 to /);
  assert.deepEqual(s.action, { line: 5, by: 'you' });
});

test('your own words add your line as the last line', async () => {
  const { w, id } = await asked();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'rule', answer: 'write it out' })).status, 202);
  await settled(w, id);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8')).job, `${JOB4}\nwrite it out`);
});

test('Drop it leaves the job with no write: no line is added, the prose has no send', async () => {
  const { w, id } = await asked();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'drop' })).status, 202);
  await settled(w, id);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8')).job, JOB4);
  assert.doesNotMatch(readFileSync(path.join(w.dir(id), 'draft-1', 'prose.txt'), 'utf8'), /send at line/, 'the plan\'s prose (as the draft kept it) has no send');
});

test('the AI names the last line: the plan card has the action row, and Drop redrafts it as an ordinary line (no send)', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const g = await settled(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g.say));
  assert.deepEqual(g.action, { line: 5, by: 'agent' });
  await idle(w, id);
  const r = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'action' });
  assert.equal(r.status, 202, JSON.stringify(r.json()));
  await settled(w, id);
  assert.equal(existsSync(path.join(w.dir(id), 'draft-1', 'prose.txt')), true);
  assert.doesNotMatch(readFileSync(path.join(w.dir(id), 'draft-1', 'prose.txt'), 'utf8'), /send at line/, 'the redraft (--action none) took the send out');
});
