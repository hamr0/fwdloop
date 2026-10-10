// M6 amendment 3 (SIGNED 2026-10-10, "u2 signed"): grey while starting. While a run of a job is starting, "Edit this job" is refused with
// "a run is starting" (the flows list), and so is a sign that replaces the job. "Starting" is the panel's own decision: a start folder in
// phase `starting` for this flow (authorstart), or a run whose controls report `starting` (runControls). $0: no model is ever called.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { isFwdloopAlive, procStartOf } from '../src/liveness.js';
import { getRunControls } from '../src/panel/data.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();

const CAT = loadCatalogue().primitives;
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'fwdloop');
const SAY = 'a run is starting';
const phaseOf = (w, id, phases) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return phases.includes(j?.phase) ? j : null; });
const flowEntry = async (w) => (await w.get('/api/author/flows')).json().flows.find((f) => f.flow === 'job2');
async function signedWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  return w;
}
const editCard = (w, entry, over = {}) => ({ ...w.card(), ...entry.edit.card, flowName: 'job2', editOf: { flow: 'job2', flowHash: entry.edit.flowHash }, ...over });
async function liveFwdloop(w) {
  const c = spawn(process.execPath, [BIN, 'panel', '--root', path.join(w.work, 'livepanel'), '--port', '0'], { stdio: 'ignore' });
  await until(() => { const s = procStartOf(c.pid); return s !== null && isFwdloopAlive(c.pid) === true; });
  return c;
}
/** A start the panel would read as `starting`: its folder names this flow and run, its child is a live fwdloop, the run folder has no pid row yet. */
function startingStart(w, child) {
  const dir = path.join(w.root, '.starts', 's-0000000001-aaaa');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, 'start.json'), JSON.stringify({ kind: 'run', flow: 'job2', runId: 'run-1', startedAt: new Date().toISOString() }));
  writeFileSync(path.join(dir, 'pid.json'), JSON.stringify({ pid: child.pid, procStart: procStartOf(child.pid), startedAt: Date.now() }));
  mkdirSync(path.join(w.root, 'job2', 'runs', 'run-1'), { recursive: true });
}

test('(1) a start in phase `starting`: the flows list says "a run is starting" and offers no card; a sign with replaces gets 409 run-live with the same words', async () => {
  const w = await signedWorld();
  const entry = await flowEntry(w);
  assert.equal(entry.edit.ok, true, 'no start yet: edit is offered');
  const d = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.30' }));
  const id = d.json().draftId;
  const g = await phaseOf(w, id, ['green']);
  const child = await liveFwdloop(w);
  try {
    startingStart(w, child);
    assert.deepEqual((await flowEntry(w)).edit, { ok: false, say: SAY });
    const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
    assert.equal(s.status, 409, s.text);
    assert.equal(s.json().refused, 'run-live');
    assert.equal(s.json().say, SAY);
  } finally { child.kill('SIGKILL'); }
  // the child is gone: the start folder no longer reads as starting (the empty run folder this test made is removed too)
  rmdirSync(path.join(w.root, 'job2', 'runs', 'run-1'));
  await until(async () => ((await flowEntry(w)).edit.ok === true ? true : null));
});

test('(2) a dead start (its child gone) plus an empty run folder with no pid row: Edit unlocks, and a replacing sign is not refused as run-live', async () => {
  const w = await signedWorld();
  const entry = await flowEntry(w);
  const d = await w.post('/api/author/draft', editCard(w, entry, { capUsd: '0.30' }));
  const id = d.json().draftId;
  const g = await phaseOf(w, id, ['green']);
  const child = await liveFwdloop(w);
  startingStart(w, child);
  child.kill('SIGKILL');
  await until(() => isFwdloopAlive(child.pid) !== true);
  assert.equal(getRunControls({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }).starting, true, 'the orphan run folder still reads starting to runControls (untouched)');
  const e = (await flowEntry(w)).edit;
  assert.equal(e.ok, true, JSON.stringify(e));
  const s = await w.post(`/api/author/${id}/sign`, { hash: g.hash });
  assert.notEqual(s.json().refused, 'run-live', s.text);
});
