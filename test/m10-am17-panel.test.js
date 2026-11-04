// M10 am17 through the panel's real HTTP door and the real `fwdloop draft` child (fake provider, $0): after the ask is answered, a Revise that changes only the cap asks nothing
// and the plan keeps the same check; a second Revise still keeps the pick (the record is carried from plan to plan).
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

test('a Revise that changes only the cap asks nothing and keeps the pick; a second Revise still keeps it', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  assert.equal((await settled(w, id)).phase, 'questions-open');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'agree' })).status, 202);
  const g = await settled(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  const picked = { class: 'softgreen', shape: { picked: [{ rule: 'listItems', value: 3 }] } };
  assert.deepEqual(pickedOn3(w, id, 'draft-1'), picked);
  let card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  for (const n of [2, 3]) {
    card = { ...card, capUsd: card.capUsd + 1 };
    const r = await w.post(`/api/author/${id}/revise`, card);
    assert.equal(r.status, 202, JSON.stringify(r.json()));
    const s = await settled(w, id);
    assert.equal(s.phase, 'green', `revise ${n}: ${JSON.stringify(s.questions ?? s.reds ?? s)}`);
    assert.deepEqual(pickedOn3(w, id, `draft-${n}`), picked, `revise ${n} keeps the same check`);
    assert.ok(s.checked[2].sentences.includes('You picked: exactly 3 list items. (kept from last draft)'), JSON.stringify(s.checked[2]));
  }
});
