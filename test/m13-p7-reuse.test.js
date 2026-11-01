// M13 piece 7, item 9b.2 (Must fail: "Reuse workflow" with an unchanged plan offers a paid redraft). A run that failed PREFLIGHT never ran its plan (no step, $0): reusing its
// unchanged plan is Run now (kind `run`), not Start drafting. A run that failed after a step ran stays red and drafts (M6 am9).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();
async function signedWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  w.seedPassed('job2', 'seed-red', { outcome: 'red' });
  w.seedPassed('job2', 'seed-pre', { outcome: 'preflight-red' });
  return w;
}
const entryOf = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
async function reuseBody(w, over = {}) {
  const e = await entryOf(w);
  return { flow: 'job2', fromRun: 'seed-pass', job: e.edit.card.job, destination: e.values.destination, capUsd: String(e.values.capUsd), askWaits: e.values.askWaits, inputs: w.inputs(), ...over };
}
const check = (w, body) => w.post('/api/author/reuse-check', body);

test('Must fail: Reuse on a run that failed preflight, job unchanged, answers run (Run now), never draft', async () => {
  const w = await signedWorld();
  const r = await check(w, await reuseBody(w, { fromRun: 'seed-pre' }));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json().kind, 'run', r.text);
});

test('a run that failed after a step ran (red) still drafts; a changed job on a preflight-red run drafts a new workflow', async () => {
  const w = await signedWorld();
  const red = await check(w, await reuseBody(w, { fromRun: 'seed-red' }));
  assert.deepEqual([red.json().kind, red.json().runOf], ['draft', true]);
  const e = await entryOf(w);
  const changed = await check(w, await reuseBody(w, { fromRun: 'seed-pre', job: `${e.edit.card.job}\nand one more step` }));
  assert.equal(changed.json().kind, 'draft');
  assert.equal(changed.json().suggestedName, 'job2-2');
});
