// M6 amendment 1: no editing while a run waits. While a run of a job is running or waiting at its ask, "Edit this job" is refused with
// "finish or stop run-N first" (the flows list), and so is a sign that replaces the job (a stale page cannot get round it).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { readFlow } from '../src/flow.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();

const CAT = loadCatalogue().primitives;
function snapshot(dir, rel = '') {
  const out = {};
  for (const n of readdirSync(path.join(dir, rel)).sort()) {
    const r = path.join(rel, n);
    if (statSync(path.join(dir, r)).isDirectory()) Object.assign(out, snapshot(dir, r));
    else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}
const phaseOf = (w, id, phases) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return phases.includes(j?.phase) ? j : null; });
const flowEntry = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
async function signedWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  return { w, flowDir: path.join(w.root, 'job2') };
}
const editCard = (w, entry, over = {}) => ({ ...w.card(), ...entry.edit.card, flowName: 'job2', editOf: { flow: 'job2', flowHash: entry.edit.flowHash }, ...over });
async function parkRun(w) {
  const run = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: '' });
  assert.equal(run.status, 202, run.text);
  await until(async () => { const v = (await w.get(`/api/author/start/${run.json().startId}`)).json(); return v.state === 'parked' ? v : null; });
  return run.json();
}

test('(1) a run parked at its ask: the flows list says "finish or stop run-N first" and offers no card', async () => {
  const { w } = await signedWorld();
  const before = await flowEntry(w);
  assert.equal(before.edit.ok, true, 'no live run: edit is offered');
  await parkRun(w);
  const entry = await flowEntry(w);
  assert.deepEqual(entry.edit, { ok: false, say: 'finish or stop run-1 first' });
});

test('(3) sign with replaces while a run waits is refused with the same sentence and changes nothing', async () => {
  const { w, flowDir } = await signedWorld();
  const entry = await flowEntry(w);
  const d = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.30' }));
  const id = d.json().draftId;
  const g = await phaseOf(w, id, ['green']);
  await parkRun(w);
  const hashBefore = readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow;
  const snap = snapshot(flowDir);
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.equal(s.status, 409, s.text);
  assert.equal(s.json().refused, 'run-live');
  assert.equal(s.json().say, 'finish or stop run-1 first');
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow, hashBefore);
  assert.deepEqual(snapshot(flowDir), snap, 'nothing written');
});
