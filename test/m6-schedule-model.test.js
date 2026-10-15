// M6 am5 item 3: "Schedule run" on a good run uses that run's MODEL (a run field). The trigger fire starts its run with the scheduled model, signed in
// that run's own values, and NOT with model.json; the flow's model.json and its signature are untouched, and no new workflow is made.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { killChildrenAfter, tickedConfig } from './m4e-world.mjs';
import { DAILY, greenWorld } from './m9-trigger-world.mjs';
import { readOutcomes } from '../src/panel/authortrigger.js';

killChildrenAfter();
const at = (day, hh = 0, mm = 0, ss = 0) => new Date(2026, 9, day, hh, mm, ss).getTime();
async function fireWorld() {
  const clock = { t: at(13, 8) };
  const g = await greenWorld({ authorOpts: { now: () => clock.t }, scheduler: { intervalMs: 0 } });
  writeFileSync(path.join(g.w.home, 'config.json'), JSON.stringify(tickedConfig({
    monthlyLimitUsd: 5,
    models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: true, inPerM: 0.75, outPerM: 1.625 }, { model: 'fake-second', use: true, inPerM: 0.5, outPerM: 1 }] },
  })));
  return { ...g, clock };
}
const SECOND = { provider: 'DEEPSEEK_API_KEY', model: 'fake-second' };
const schedule = async (w, extra = {}) => {
  const p = await w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, ...extra });
  if (p.status !== 200) return p;
  return w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, hash: p.json().hash, ...extra });
};

test('must fail: a scheduled model fires the run with THAT model (in the run\'s signed values), not model.json; model.json is unchanged', async () => {
  const f = await fireWorld();
  const flowModel = readFileSync(path.join(f.flowDir, 'model.json'), 'utf8');
  const r = await schedule(f.w, SECOND);
  assert.equal(r.status, 200, r.text);
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  const rows = readOutcomes(f.flowDir);
  assert.equal(rows.at(-1).outcome, 'started', JSON.stringify(rows));
  const vals = JSON.parse(readFileSync(path.join(f.flowDir, 'runs', rows.at(-1).runId, 'signed-values.json'), 'utf8'));
  assert.deepEqual(vals.values.model, { slot: 'DEEPSEEK_API_KEY', model: 'fake-second' });
  assert.equal(readFileSync(path.join(f.flowDir, 'model.json'), 'utf8'), flowModel);
});

test('the model is bound to the second click: a hash from a schedule with another model signs nothing', async () => {
  const f = await fireWorld();
  const p = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, ...SECOND });
  const bad = await f.w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, hash: p.json().hash });
  assert.equal(bad.status, 409, bad.text);
});

test('a scheduled model that is not ticked is refused at the first click, naming it; a schedule with no model fires on model.json as before', async () => {
  const f = await fireWorld();
  const bad = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, provider: 'DEEPSEEK_API_KEY', model: 'ghost' });
  assert.equal(bad.status, 400, bad.text);
  assert.match(bad.text, /ghost/);
  assert.equal((await schedule(f.w)).status, 200);
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  const row = readOutcomes(f.flowDir).at(-1);
  assert.equal(row.outcome, 'started');
  const names = JSON.stringify(require_ls(path.join(f.flowDir, 'runs', row.runId)));
  assert.doesNotMatch(names, /signed-values/);
});
import { readdirSync } from 'node:fs';
function require_ls(d) { return readdirSync(d); }

// ---- am5 item 3, the rest: destination and inputs ----
import { mkdirSync, existsSync } from 'node:fs';
import { snapshotDir } from './m6-snap.mjs';

const folder = (f, n) => { const d = path.join(f.w.work, n); mkdirSync(d, { recursive: true }); return d; };
const inputsAs = (w, resume, jd) => [{ role: 'resume', path: resume }, { role: 'jd', path: jd }];
const startVals = (f) => {
  const row = readOutcomes(f.flowDir).at(-1);
  assert.equal(row.outcome, 'started', JSON.stringify(row));
  return { row, vals: JSON.parse(readFileSync(path.join(f.flowDir, 'runs', row.runId, 'signed-values.json'), 'utf8')) };
};
const startFile = (f, row) => JSON.parse(readFileSync(path.join(f.w.root, '.starts', f.w.starts().at(-1), 'start.json'), 'utf8'));

test('must fail: a scheduled destination is used by the fired run (signed into its values), not the flow\'s; flow files untouched', async () => {
  const f = await fireWorld();
  const dest = folder(f, 'sched-out');
  const before = snapshotDir(f.flowDir, ['runs', 'triggers', 'triggers.jsonl']);
  const r = await schedule(f.w, { destination: dest });
  assert.equal(r.status, 200, r.text);
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  const { vals } = startVals(f);
  assert.equal(vals.values.destination, dest);
  const after = snapshotDir(f.flowDir, ['runs', 'triggers', 'triggers.jsonl']);
  for (const n of ['declaration.json', 'model.json']) assert.equal(after[n], before[n], n);
});


test('a mismatched hash signs nothing: destination or inputs changed between the two clicks', async () => {
  const f = await fireWorld();
  const d1 = folder(f, 'd1'); const d2 = folder(f, 'd2');
  const p = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, destination: d1 });
  const bad = await f.w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, destination: d2, hash: p.json().hash });
  assert.equal(bad.status, 409, bad.text);
  const p2 = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY });
  const bad2 = await f.w.post('/api/author/trigger', { flow: 'job2', trigger: DAILY, inputs: f.w.inputs(), destination: d1, hash: p2.json().hash });
  assert.equal(bad2.status, 409);
  assert.equal(existsSync(path.join(f.flowDir, 'triggers')), false, 'nothing armed');
});

test('a refused destination (the flows root) or wrong input roles are refused at the first click, $0', async () => {
  const f = await fireWorld();
  const a = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, destination: f.w.root });
  assert.equal(a.status, 400, a.text);
  const b = await f.w.post('/api/author/trigger-prepare', { flow: 'job2', trigger: DAILY, inputs: [{ role: 'nope', path: path.join(f.w.inDir, 'jd.md') }] });
  assert.equal(b.status, 400, b.text);
});

test('no new workflow: scheduling with a destination, inputs and a model leaves the job\'s declaration and model.json as they were', async () => {
  const f = await fireWorld();
  const decl = readFileSync(path.join(f.flowDir, 'declaration.json'), 'utf8');
  const r = await schedule(f.w, { ...SECOND, destination: folder(f, 'dd'), inputs: f.w.inputs() });
  assert.equal(r.status, 200, r.text);
  assert.equal(readFileSync(path.join(f.flowDir, 'declaration.json'), 'utf8'), decl);
  const { readdirSync } = await import('node:fs');
  assert.deepEqual(readdirSync(f.w.root).filter((n) => !n.startsWith('.')), ['job2']);
});

test('must fail: a clock fire takes its inputs from the schedule (two inputs stored), a different newest run notwithstanding', async () => {
  const f = await fireWorld();
  const mine = path.join(f.w.inDir, 'mine-jd.md'); writeFileSync(mine, '# mine\n');
  const r = await schedule(f.w, { inputs: inputsAs(f.w, path.join(f.w.inDir, 'resume.md'), mine) });
  assert.equal(r.status, 200, r.text);
  f.clock.t = at(13, 9, 0, 30); f.w.h.tick();
  const row = readOutcomes(f.flowDir).at(-1);
  assert.equal(row.outcome, 'started', JSON.stringify(row));
  const st = startFile(f, row);
  assert.equal(st.sources.find((s) => s.role === 'jd').path, mine);
});

test('a file trigger: the arriving file stays the input for its role; the other role comes from the schedule', async () => {
  const f = await fireWorld();
  const inbox = folder(f, 'inbox');
  const mine = path.join(f.w.inDir, 'mine-resume.md'); writeFileSync(mine, '# mine\n');
  const trig = { kind: 'new-file', role: 'jd', folder: inbox };
  const body = { flow: 'job2', trigger: trig, inputs: inputsAs(f.w, mine, path.join(f.w.inDir, 'jd.md')) };
  const p = await f.w.post('/api/author/trigger-prepare', body);
  assert.equal(p.status, 200, p.text);
  assert.equal((await f.w.post('/api/author/trigger', { ...body, hash: p.json().hash })).status, 200);
  writeFileSync(path.join(inbox, 'arrive.md'), '# arrives\n');
  const { STABLE_POLLS } = await import('../src/trigger-files.js');
  for (let i = 0; i < STABLE_POLLS + 3; i++) f.w.h.tick();
  const row = readOutcomes(f.flowDir).at(-1);
  assert.equal(row.outcome, 'started', JSON.stringify(readOutcomes(f.flowDir)));
  const st = startFile(f, row);
  assert.equal(st.sources.find((s) => s.role === 'resume').path, mine, 'the other role: the scheduled run\'s');
  assert.match(st.sources.find((s) => s.role === 'jd').path, /arrive\.md$/, 'its own role: the arriving file');
});
