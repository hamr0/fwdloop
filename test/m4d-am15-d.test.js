// M4d amendment 15, every line, through the real panel and the fake draft provider ($0): a red revise, and a draft with a question open.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { world, killChildrenAfter, until } from './m4e-world.mjs';
import { isFwdloopAlive } from '../src/liveness.js';

killChildrenAfter();
const settle = (w, id, phases) => until(async () => { const v = (await w.get(`/api/author/${id}`)).json(); return phases.includes(v?.phase) ? v : null; });

test('a red revise: the revise line is one plain reason and a Fix line, no details, no raw text', async () => {
  const w = await world();
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await settle(w, id, ['green']);
  assert.equal(g.phase, 'green');
  const card = w.card();
  const r = await w.post(`/api/author/${id}/revise`, { ...card, job: `${card.job}\nREDMARK` });
  assert.equal(r.status, 202, r.text);
  const v = await settle(w, id, ['red', 'stopped']);
  const rv = v.revises[0];
  assert.equal(rv.phase, 'red');
  assert.deepEqual(rv.lines.map((l) => [l.id, l.status]), [['plan', 'failed'], ['plan-fix', 'done']]);
  assert.match(rv.lines[0].label, /^revise 1 · A step uses a tool that is not available for this job$/);
  assert.match(rv.lines[1].label, /^Fix: /);
  assert.doesNotMatch(JSON.stringify(rv.lines), /declaration:/);
});

test('an open question: the plan-checks line is "plan checks · a question for you", not red, and has no Fix', async () => {
  const w = await world();
  const card = w.card();
  const id = (await w.post('/api/author/draft', { ...card, job: `${card.job}\nQMARK` })).json().draftId;
  const v = await settle(w, id, ['questions-open', 'green', 'red', 'stopped']);
  assert.equal(v.phase, 'questions-open', JSON.stringify(v).slice(0, 300));
  const checks = v.stepList.find((s) => s.id === 'checks');
  assert.deepEqual([checks.status, checks.label], ['waiting', 'plan checks · a question for you']);
  assert.ok(!v.stepList.some((s) => s.id === 'checks-fix' || s.status === 'failed'));
});

test('after the question is answered the first plan\'s line stays "a question for you" (it ended by asking, not red); the redraft has its own line', async () => {
  const w = await world();
  const card = w.card();
  const id = (await w.post('/api/author/draft', { ...card, job: `${card.job}\nQMARK` })).json().draftId;
  const v = await settle(w, id, ['questions-open']);
  const pid = JSON.parse(readFileSync(`${w.dir(id)}/pid.json`, 'utf8'));
  await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true); // the draft child must be gone before an answer is taken
  for (let k = 1; k <= v.total; k += 1) {
    // eslint-disable-next-line no-await-in-loop
    const a = await w.post(`/api/author/${id}/answer`, { k, answer: 'three headings' });
    assert.ok([200, 202].includes(a.status), a.text);
    // eslint-disable-next-line no-await-in-loop
    if (k < v.total) await until(async () => (await w.get(`/api/author/${id}`)).json().openK === k + 1);
  }
  const after = await until(async () => { const x = (await w.get(`/api/author/${id}`)).json(); return x.revises?.[0] && ['green', 'red'].includes(x.revises[0].phase) ? x : null; });
  assert.ok(!after.stepList.some((s) => s.status === 'failed' || s.id === 'checks-fix'), JSON.stringify(after.stepList.map((s) => s.label)));
  assert.match(after.revises[0].name, /^drafted again with your answers$/);
});
