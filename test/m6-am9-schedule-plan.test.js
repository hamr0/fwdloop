// M6 am9 piece 6: "A schedule set from a run uses that run's plan." The plan is bound by the second click's hash, written once in the schedule's own file
// (the `plan` field of `schedule.json`), re-verified at every fire; the fire starts the run on a verified copy of that plan. The workflow's declaration is never changed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { killChildrenAfter, until } from './m4e-world.mjs';
import { DAILY, greenWorld } from './m9-trigger-world.mjs';
import { readOutcomes } from '../src/panel/authortrigger.js';

killChildrenAfter();
const CAT = loadCatalogue().primitives;
const F3 = ['prose.txt', 'declaration.json', 'signature.json'];
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();

async function fireWorld() {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  const prose = readFileSync(path.join(g.flowDir, 'prose.txt'), 'utf8');
  const decl = JSON.parse(readFileSync(path.join(g.flowDir, 'declaration.json'), 'utf8'));
  const keepPlanB = (runId = 'seed-b') => {
    const scratch = path.join(g.w.work, 'scratch');
    const b = writeFlow({ root: scratch, name: 'job2', proseText: prose.replace(/cap \$[0-9.]+/, 'cap $0.31'), declaration: decl, signedBy: 'h', signedAt: '2026-10-11T10:00:00Z', catalogue: CAT });
    assert.equal(b.ok, true, JSON.stringify(b.reds));
    const runDir = path.join(g.flowDir, 'runs', runId);
    mkdirSync(path.join(runDir, 'job'), { recursive: true });
    for (const f of F3) writeFileSync(path.join(runDir, 'job', f), readFileSync(path.join(b.dir, f), 'utf8'));
    writeFileSync(path.join(runDir, 'plan.json'), '{"own":true}\n');
    g.w.seedPassed('job2', runId, { signatureHash: b.signature.flow });
    return { runDir, hash: b.signature.flow };
  };
  return { ...g, clock, keepPlanB };
}
const schedule = async (w, extra = {}) => {
  const p = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, ...extra });
  if (p.status !== 200) return p;
  return w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, hash: p.json().hash, ...extra });
};
const savedPlan = (f) => JSON.parse(readFileSync(path.join(f.flowDir, 'schedule.json'), 'utf8')).plan;   // M9 am20: the plan is a field of the schedule's own file

test('must fail: a schedule set from a run that kept another plan fires a run on THAT plan (verified copy, plan.json planOf); the workflow\'s declaration is untouched', async () => {
  const f = await fireWorld();
  const b = f.keepPlanB();
  const declBefore = readFileSync(path.join(f.flowDir, 'declaration.json'), 'utf8');
  const r = await schedule(f.w, { planOf: 'seed-b' });
  assert.equal(r.status, 200, r.text);
  assert.equal(savedPlan(f).run, 'seed-b');
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  const row = readOutcomes(f.flowDir).at(-1);
  assert.equal(row.outcome, 'started', JSON.stringify(row));
  const runDir = path.join(f.flowDir, 'runs', row.runId);
  assert.deepEqual(JSON.parse(readFileSync(path.join(runDir, 'plan.json'), 'utf8')), { planOf: 'seed-b' });
  const state = await until(() => { try { return JSON.parse(readFileSync(path.join(runDir, 'state.json'), 'utf8')); } catch { return null; } });
  assert.equal(state.signatureHash, b.hash, 'the fired run executed the plan of the run the schedule was set from');
  assert.equal(readFileSync(path.join(f.flowDir, 'declaration.json'), 'utf8'), declBefore);
});

test('the plan is bound to the second click: a hash made for a schedule with a plan does not sign one without it', async () => {
  const f = await fireWorld();
  f.keepPlanB();
  const p = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, planOf: 'seed-b' });
  assert.equal(p.status, 200, p.text);
  const bad = await f.w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, hash: p.json().hash });
  assert.equal(bad.status, 409, bad.text);
});

test('must fail: if the kept plan is changed after the schedule was signed, the fire is refused and starts nothing', async () => {
  const f = await fireWorld();
  const b = f.keepPlanB();
  assert.equal((await schedule(f.w, { planOf: 'seed-b' })).status, 200);
  writeFileSync(path.join(b.runDir, 'job', 'prose.txt'), 'tampered');
  const startsBefore = f.w.starts().length;
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  const row = readOutcomes(f.flowDir).at(-1);
  assert.equal(row.outcome, 'refused', JSON.stringify(row));
  assert.match(row.why, /seed-b/);
  assert.equal(f.w.starts().length, startsBefore);
});

test('a plan that does not verify is refused at the first click; a plan that is the workflow\'s own saves no plan and fires a plain run', async () => {
  const f = await fireWorld();
  const b = f.keepPlanB();
  writeFileSync(path.join(b.runDir, 'job', 'prose.txt'), 'tampered');
  const bad = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, planOf: 'seed-b' });
  assert.equal(bad.status, 409, bad.text);
  assert.equal(bad.json().refused, 'plan');
  const g = await fireWorld();
  assert.equal((await schedule(g.w, { planOf: 'seed-pass' })).status, 200);
  assert.equal(savedPlan(g), null);
  g.clock.t = at(13, 9, 0, 30); g.w.h.tick();
  const row = readOutcomes(g.flowDir).at(-1);
  assert.equal(row.outcome, 'started', JSON.stringify(row));
  assert.equal(existsSync(path.join(g.flowDir, 'runs', row.runId, 'plan.json')), false);
  assert.ok(readdirSync(path.join(g.flowDir, 'runs')).length > 0);
});
