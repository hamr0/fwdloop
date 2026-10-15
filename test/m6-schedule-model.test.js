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
