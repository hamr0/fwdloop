// M10 am20 through the panel's real HTTP door and the real `fwdloop draft` child (fake provider, $0): after the ask is answered and both revises are used, Start over
// (a fresh draft that names the draft it started over from) carries the picks: an unchanged job asks nothing and keeps the same check; one changed guardrail asks that one only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ exactly 3 bullets');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settle = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
const settled = async (w, id) => { const g = await settle(w, id, ['questions-open', 'green', 'red', 'stopped']); await childGone(w, id); return g; };
const pickedOn3 = (w, id, plan) => JSON.parse(readFileSync(path.join(w.dir(id), plan, 'declaration.json'), 'utf8')).steps.find((x) => x.fromLine === 3).close;

async function twoRevisesDone(w) {
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  assert.equal((await settled(w, id)).phase, 'questions-open');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
  assert.equal((await settled(w, id)).phase, 'green');
  let card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  for (const n of [2, 3]) {
    card = { ...card, capUsd: card.capUsd + 1 };
    assert.equal((await w.post(`/api/author/${id}/revise`, card)).status, 202);
    assert.equal((await settled(w, id)).phase, 'green', `revise ${n}`);
  }
  return { id, card };
}

test('Start over on an unchanged job after both revises asks nothing and keeps the same check', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST } });
  const { id, card } = await twoRevisesDone(w);
  const r = await w.post('/api/author/draft', { ...card, startedOverFrom: id });
  assert.equal(r.status, 202, JSON.stringify(r.json()));
  const id2 = r.json().draftId;
  const s = await settled(w, id2);
  assert.equal(s.phase, 'green', JSON.stringify(s.questions ?? s.reds ?? s));
  assert.deepEqual(pickedOn3(w, id2, 'draft'), { class: 'softgreen', shape: { picked: [{ rule: 'listItems', value: 3 }] } });
  assert.ok(s.checked[2].sentences.includes('You picked: exactly 3 list items. (kept from last draft) [you picked]'), JSON.stringify(s.checked[2]));
});

test('Start over with one changed guardrail asks that one only', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST } });
  const { id, card } = await twoRevisesDone(w);
  const r = await w.post('/api/author/draft', { ...card, job: card.job.replace('~ exactly 3 bullets', '~ exactly 4 bullets'), startedOverFrom: id });
  assert.equal(r.status, 202, JSON.stringify(r.json()));
  const s = await settled(w, r.json().draftId);
  assert.equal(s.phase, 'questions-open', JSON.stringify(s.reds ?? s));
  assert.equal(s.questions.length, 1, JSON.stringify(s.questions));
});
