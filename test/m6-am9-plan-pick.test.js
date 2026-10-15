// M6 am9 piece 5: Reuse workflow on a GREEN run with the job unchanged runs THAT run's plan, no drafting. Same bytes as the workflow's plan (a trigger line
// aside) = a plain run; a different kept plan = a new run holding a verified copy of it (`job/` + `plan.json {planOf}`). A kept plan that does not verify
// refuses by name; a run with no kept plan (made before M6) is the workflow's plan, as its Job tab already says.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { planForReuse, readPlan, writeFlow } from '../src/flow.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const CAT = loadCatalogue().primitives;
const F3 = ['prose.txt', 'declaration.json', 'signature.json'];

async function planWorld2() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  const flowDir = path.join(w.root, 'job2');
  const prose = readFileSync(path.join(flowDir, 'prose.txt'), 'utf8');
  const decl = JSON.parse(readFileSync(path.join(flowDir, 'declaration.json'), 'utf8'));
  /** a run that KEPT another plan: the same job signed with another cap */
  w.keepPlanB = (runId = 'seed-b') => {
    const scratch = path.join(w.work, 'scratch');
    const b = writeFlow({ root: scratch, name: 'job2', proseText: prose.replace(/cap \$[0-9.]+/, 'cap $0.31'), declaration: decl, signedBy: 'h', signedAt: '2026-10-11T10:00:00Z', catalogue: CAT });
    assert.equal(b.ok, true, JSON.stringify(b.reds));
    const runDir = path.join(flowDir, 'runs', runId);
    mkdirSync(path.join(runDir, 'job'), { recursive: true });
    for (const f of F3) writeFileSync(path.join(runDir, 'job', f), readFileSync(path.join(b.dir, f), 'utf8'));
    writeFileSync(path.join(runDir, 'plan.json'), '{"own":true}\n');
    w.seedPassed('job2', runId, { signatureHash: b.signature.flow });
    return { runDir, hash: b.signature.flow };
  };
  w.flowFiles = () => Object.fromEntries(F3.map((f) => [f, readFileSync(path.join(flowDir, f), 'utf8')]));
  w.runBody = (planOf, over = {}) => ({ flow: 'job2', inputs: w.inputs(), runId: '', planOf, ...over });
  return w;
}
const newRuns = (w, before) => readdirSync(path.join(w.root, 'job2', 'runs')).filter((r) => !before.includes(r));

test('planForReuse: byte-equal plan (a trigger line aside) is the same; a different kept plan is returned, verified; a tampered one is refused; none kept = same', async () => {
  const w = await planWorld2();
  const flowDir = path.join(w.root, 'job2');
  const b = w.keepPlanB();
  const diff = planForReuse({ root: w.root, name: 'job2', runDir: b.runDir, catalogue: CAT });
  assert.equal(diff.ok, true);
  assert.equal(diff.same, false);
  assert.equal(diff.read.signature.flow, b.hash);
  const none = path.join(flowDir, 'runs', 'seed-pass');
  mkdirSync(none, { recursive: true });
  assert.deepEqual(planForReuse({ root: w.root, name: 'job2', runDir: none, catalogue: CAT }), { ok: true, same: true });
  // a run that kept a copy of the workflow's own plan is the same plan
  mkdirSync(path.join(flowDir, 'runs', 'seed-copy', 'job'), { recursive: true });
  for (const f of F3) writeFileSync(path.join(flowDir, 'runs', 'seed-copy', 'job', f), readFileSync(path.join(flowDir, f), 'utf8'));
  assert.equal(planForReuse({ root: w.root, name: 'job2', runDir: path.join(flowDir, 'runs', 'seed-copy'), catalogue: CAT }).same, true);
  // tampered
  writeFileSync(path.join(b.runDir, 'job', 'prose.txt'), 'tampered');
  const bad = planForReuse({ root: w.root, name: 'job2', runDir: b.runDir, catalogue: CAT });
  assert.equal(bad.ok, false);
  assert.match(bad.red, /does not match/);
});

test('must fail: a green run\'s reuse runs a DIFFERENT plan than that run\'s (the new run holds run seed-b\'s plan, verified, and executes it)', async () => {
  const w = await planWorld2();
  const b = w.keepPlanB();
  const flowBefore = w.flowFiles();
  const before = readdirSync(path.join(w.root, 'job2', 'runs'));
  const draftsBefore = readdirSync(path.join(w.root, '.drafts')).length;
  const r = await w.post('/api/author/run', w.runBody('seed-b'));
  assert.equal(r.status, 202, r.text);
  const [id] = newRuns(w, before);
  const runDir = path.join(w.root, 'job2', 'runs', id);
  assert.deepEqual(JSON.parse(readFileSync(path.join(runDir, 'plan.json'), 'utf8')), { planOf: 'seed-b' });
  for (const f of F3) assert.equal(readFileSync(path.join(runDir, 'job', f), 'utf8'), readFileSync(path.join(b.runDir, 'job', f), 'utf8'), f);
  assert.equal(readPlan({ root: w.root, name: 'job2', catalogue: CAT, runDir }).signature.flow, b.hash);
  const state = await until(() => { try { return JSON.parse(readFileSync(path.join(runDir, 'state.json'), 'utf8')); } catch { return null; } });
  assert.equal(state.signatureHash, b.hash, 'it executed seed-b\'s plan');
  assert.deepEqual(w.flowFiles(), flowBefore, 'the workflow is untouched');
  assert.equal(readdirSync(path.join(w.root, '.drafts')).length, draftsBefore, 'no drafting');
});

test('a green run whose plan IS the workflow\'s starts a plain run (no plan.json, no job copy made by the door)', async () => {
  const w = await planWorld2();
  w.seedPassed('job2');
  const before = readdirSync(path.join(w.root, 'job2', 'runs'));
  const r = await w.post('/api/author/run', w.runBody('seed-pass'));
  assert.equal(r.status, 202, r.text);
  const [id] = newRuns(w, before);
  assert.equal(existsSync(path.join(w.root, 'job2', 'runs', id, 'plan.json')), false);
});

test('Sign & run with a kept plan: the signed values are bound to THAT plan\'s signature, and the run starts', async () => {
  const w = await planWorld2();
  const b = w.keepPlanB();
  const body = w.runBody('seed-b', { capUsd: '0.20' });
  const p = await w.post('/api/author/run-prepare', body);
  assert.equal(p.status, 200, p.text);
  assert.equal(p.json().needsSign, true);
  const before = readdirSync(path.join(w.root, 'job2', 'runs'));
  const r = await w.post('/api/author/run', { ...body, hash: p.json().hash });
  assert.equal(r.status, 202, r.text);
  const [id] = newRuns(w, before);
  const rec = JSON.parse(readFileSync(path.join(w.root, 'job2', 'runs', id, 'signed-values.json'), 'utf8'));
  assert.equal(rec.flowSignatureHash, b.hash);
  const state = await until(() => { try { return JSON.parse(readFileSync(path.join(w.root, 'job2', 'runs', id, 'state.json'), 'utf8')); } catch { return null; } });
  assert.equal(state.signatureHash, b.hash);
});

test('a kept plan that no longer verifies refuses by name, starts nothing and creates no run folder', async () => {
  const w = await planWorld2();
  const b = w.keepPlanB();
  writeFileSync(path.join(b.runDir, 'job', 'prose.txt'), 'tampered');
  const before = readdirSync(path.join(w.root, 'job2', 'runs'));
  const r = await w.post('/api/author/run', w.runBody('seed-b'));
  assert.equal(r.status, 409, r.text);
  assert.equal(r.json().refused, 'plan');
  assert.match(r.json().say, /seed-b/);
  assert.deepEqual(readdirSync(path.join(w.root, 'job2', 'runs')), before);
  assert.deepEqual(w.starts(), []);
});
