// M4d amendment 7b, piece 3: an old signed flow with no <flow>/model.json takes the model picked in Chat's "Run a signed flow" card.
// The pick is refused by name at $0 when nothing is ticked / nothing picked / unticked since; on a successful start it is written to
// <flow>/model.json (outside the signed files: FLOW_FILES, so the signature hash does not cover it). A flow WITH a record ignores a pick.
// $0: the test model step, a scratch world per test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { world, killChildrenAfter } from './m4e-world.mjs';
import { updateConfig } from '../src/config.js';
import { readModelRecord } from '../src/flowmodel.js';
import { FLOW_FILES } from '../src/flow.js';

killChildrenAfter();
const PICK = { provider: 'DEEPSEEK_API_KEY', model: 'fake-ticked' };

async function oldFlow(w) {
  const { flowDir, flow } = await w.signedFlow();
  rmSync(path.join(flowDir, 'model.json'));
  assert.equal(readModelRecord(flowDir), null);
  return { flowDir, flow };
}
const sigOf = (dir) => readFileSync(path.join(dir, 'signature.json'), 'utf8');

test('R1: model.json is not one of the signed files', () => {
  assert.equal(FLOW_FILES.includes('model.json'), false);
});

test('R2: no record and no pick is refused by name at $0, nothing started', async () => {
  const w = await world();
  const { flowDir, flow } = await oldFlow(w);
  const r = await w.post('/api/author/run', { flow, inputs: w.inputs() });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json().refusals.filter((x) => x.field === 'model').map((x) => x.say), ['Pick a model. Nothing was spent.']);
  assert.deepEqual(w.starts(), []);
  assert.equal(readModelRecord(flowDir), null);
});

test('R3: nothing ticked says what to do, nothing started', async () => {
  const w = await world();
  const { flowDir, flow } = await oldFlow(w);
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: false }] } }, { home: w.home });
  const r = await w.post('/api/author/run', { flow, inputs: w.inputs(), provider: '', model: '' });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json().refusals.filter((x) => x.field === 'model').map((x) => x.say), ['Tick a model in Settings > Providers. Nothing was spent.']);
  assert.deepEqual(w.starts(), []);
  assert.equal(readModelRecord(flowDir), null);
});

test('R4: a pick unticked since the menu was drawn is refused by name', async () => {
  const w = await world();
  const { flow } = await oldFlow(w);
  const r = await w.post('/api/author/run', { flow, inputs: w.inputs(), provider: PICK.provider, model: 'not-ticked' });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json().refusals.filter((x) => x.field === 'model').map((x) => x.say), ['Tick not-ticked in Settings > Providers with both prices first. Nothing was spent.']);
  assert.deepEqual(w.starts(), []);
});

test('R5: a ticked pick starts the run and then model.json holds it; the signature is untouched', async () => {
  const w = await world();
  const { flowDir, flow } = await oldFlow(w);
  const before = sigOf(flowDir);
  const r = await w.post('/api/author/run', { flow, inputs: w.inputs(), ...PICK });
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(readModelRecord(flowDir), { slot: PICK.provider, model: PICK.model });
  assert.equal(sigOf(flowDir), before);
});

test('R6: a start that is refused leaves no record', async () => {
  const w = await world();
  const { flowDir, flow } = await oldFlow(w);
  const r = await w.post('/api/author/run', { flow, inputs: w.inputs(), runId: 'bad id!', ...PICK });
  assert.notEqual(r.status, 202, r.text);
  assert.equal(existsSync(path.join(flowDir, 'model.json')), false);
});

test('R7: a flow WITH a record keeps its record: a pick in the body changes nothing and is not needed', async () => {
  const w = await world();
  const { flowDir, flow } = await w.signedFlow();
  const rec = readModelRecord(flowDir);
  assert.ok(rec);
  updateConfig({ models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: true, inPerM: 0.75, outPerM: 1.625 }, { model: 'other', use: true, inPerM: 1, outPerM: 1 }] } }, { home: w.home });
  const r = await w.post('/api/author/run', { flow, inputs: w.inputs(), provider: PICK.provider, model: 'other' });
  assert.equal(r.status, 202, r.text);
  assert.deepEqual(readModelRecord(flowDir), rec);
});

test('R8: the prepare door (first click of Sign & run) asks the same model question', async () => {
  const w = await world();
  const { flow } = await oldFlow(w);
  const r = await w.post('/api/author/run-prepare', { flow, inputs: w.inputs() });
  assert.equal(r.status, 400, r.text);
  assert.deepEqual(r.json().refusals.filter((x) => x.field === 'model').map((x) => x.say), ['Pick a model. Nothing was spent.']);
});

const PAGE = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src', 'panel', 'index.html'), 'utf8');

test('P1: the page gives a flow with no recorded model the same ticked-lines menu, sends the pick, and shows a refusal beside it', () => {
  assert.match(PAGE, /<select id="jf-run-pick"/);
  assert.match(PAGE, /id="jf-err-run-model"/);
  const body = PAGE.slice(PAGE.indexOf('function currentRun('), PAGE.indexOf('function runDiffers('));
  assert.match(body, /provider: runPickChoice\(\)\.provider/);
  assert.match(PAGE, /runPickEl\.hidden = !\(f && !f\.model\)/);
  assert.doesNotMatch(PAGE, /Run it from the command line with --model/);
});
