// M6 am5/am6 piece 3: the SERVER decides what the one Reuse card's button is (Run / Sign & run / Start drafting), at $0, before any drafting money,
// and the draft door refuses a card whose job is unchanged. The page only shows the answer.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();

async function signedWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  return w;
}
const entryOf = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
/** the card as Reuse workflow fills it: every field of the signed job, in the run form's shape */
async function reuseBody(w, over = {}) {
  const e = await entryOf(w);
  return {
    flow: 'job2', fromRun: 'seed-pass', job: e.edit.card.job, destination: e.values.destination, capUsd: String(e.values.capUsd), askWaits: e.values.askWaits, inputs: w.inputs(), ...over,
  };
}
const check = (w, body) => w.post('/api/author/reuse-check', body);

test('reuse-check: nothing changed, or inputs only = run (one click); a red run decides nothing', async () => {
  const w = await signedWorld();
  const a = await check(w, await reuseBody(w));
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json().kind, 'run');
  const b = await check(w, await reuseBody(w, { inputs: [{ role: 'resume', path: path.join(w.inDir, 'jd.md') }, { role: 'jd', path: path.join(w.inDir, 'resume.md') }] }));
  assert.equal(b.json().kind, 'run', 'inputs alone are a Run');
  w.seedPassed('job2', 'seed-red', { outcome: 'red' });
  const c = await check(w, await reuseBody(w, { fromRun: 'seed-red' }));
  assert.equal(c.json().kind, 'run', 'a red run with only inputs changed is not forced to draft');
});

test('reuse-check: destination, cap or an ask wait changed = sign-run with a hash (no drafting)', async () => {
  const w = await signedWorld();
  const e = await entryOf(w);
  const line = Object.keys(e.values.askWaits)[0];
  for (const over of [{ capUsd: '0.30' }, { destination: w.inDir }, { askWaits: { ...e.values.askWaits, [line]: '2h' } }]) {
    const r = await check(w, await reuseBody(w, over));
    assert.equal(r.json().kind, 'sign-run', JSON.stringify(over) + r.text);
    assert.match(r.json().hash, /^[0-9a-f]{64}$/);
  }
});

test('reuse-check: ANY job field changed = draft, with the next free name; the label does not depend on the run fields', async () => {
  const w = await signedWorld();
  const e = await entryOf(w);
  const r = await check(w, await reuseBody(w, { job: `${e.edit.card.job}\nand one more step`, capUsd: '0.30' }));
  assert.equal(r.json().kind, 'draft', r.text);
  assert.equal(r.json().suggestedName, 'job2-2');
  const g = e.edit.card.job.replace('3 sections, all under 600 words', '2 sections');
  assert.notEqual(g, e.edit.card.job);
  assert.equal((await check(w, await reuseBody(w, { job: g }))).json().kind, 'draft', 'a guardrail');
  // undo flips back
  assert.equal((await check(w, await reuseBody(w, { job: e.edit.card.job }))).json().kind, 'run');
});

test('must fail: the draft door refuses a Reuse card whose job is unchanged, at $0, creating nothing', async () => {
  const w = await signedWorld();
  const e = await entryOf(w);
  const before = existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0;
  const d = await w.post('/api/author/draft', { ...w.card({ flowName: 'job2-2', capUsd: '0.30' }), job: e.edit.card.job, reuseOf: { flow: 'job2' } });
  assert.equal(d.status, 409, d.text);
  assert.equal(d.json().refused, 'job-unchanged');
  assert.equal(existsSync(path.join(w.root, '.drafts')) ? readdirSync(path.join(w.root, '.drafts')).length : 0, before, 'no draft folder, no child');
  assert.equal(existsSync(path.join(w.root, 'job2-2')), false);
});

test('the run door still refuses a job field in its body (a stale page cannot run a changed job under the old signature)', async () => {
  const w = await signedWorld();
  const r = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), job: 'something else' });
  assert.notEqual(r.status, 202);
  assert.equal(readdirSync(w.root).includes('.starts') ? readdirSync(path.join(w.root, '.starts')).length : 0, 0);
});
