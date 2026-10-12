// M4d amendment 15, every line, through the real panel and the fake draft provider ($0): a red revise, and a draft with a question open.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { world, killChildrenAfter, until } from './m4e-world.mjs';

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
