// M6 am5 item 2 / am6 item 2: the MODEL is a run field. A different model is a Sign & run (two clicks, no drafting), written into that run's
// signed values; the flow's model.json is never changed; a run's values from before this (no model) still verify with the same hash.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

import { pickRunValues, valuesHash, writeRunValues } from '../src/runvalues.js';
import { readFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { killChildrenAfter, tickedConfig, world, HERE } from './m4e-world.mjs';

killChildrenAfter();
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');

test('hash stability: a values record with no model hashes exactly as before (so every existing run still verifies)', () => {
  const h = valuesHash({
    flow: 'f', flowSignatureHash: 's', runId: null, version: 0, values: { capUsd: 0.5, destination: '/o', askWaits: { 3: '1h' } },
  });
  assert.equal(h, 'fd6dedd05db526c7ca7f01593cdb5e92f62671799bb114571645a19f7dbbe578');
  const withModel = valuesHash({
    flow: 'f', flowSignatureHash: 's', runId: null, version: 0, values: { capUsd: 0.5, destination: '/o', askWaits: { 3: '1h' }, model: { slot: 'K_KEY', model: 'm' } },
  });
  assert.notEqual(withModel, h, 'a model is part of what the click signed');
});

test('a values record with a model is accepted and read back; a malformed model is refused', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-rm-'));
  const values = { capUsd: 0.5, destination: null, askWaits: {}, model: { slot: 'K_KEY', model: 'm' } };
  const rec = { flow: 'f', flowSignatureHash: 's', runId: 'run-1', version: 0, values, signedBy: 't', at: '2026-10-15T00:00:00.000Z' };
  const w = writeRunValues(dir, { ...rec, hash: valuesHash({ ...rec, runId: null }) });
  assert.equal(w.ok, true, JSON.stringify(w));
  const p = pickRunValues(dir);
  assert.equal(p.ok, true, JSON.stringify(p));
  assert.deepEqual(p.record.values.model, { slot: 'K_KEY', model: 'm' });
  const bad = mkdtempSync(path.join(tmpdir(), 'fwdloop-rm-'));
  const v2 = { ...values, model: { slot: 'K_KEY', model: '' } };
  writeFileSync(path.join(bad, 'signed-values.json'), JSON.stringify({ ...rec, values: v2, hash: valuesHash({ ...rec, runId: null, values: v2 }) }));
  assert.equal(pickRunValues(bad).ok, false);
});

async function modelWorld() {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify(tickedConfig({
    monthlyLimitUsd: 5,
    models: { DEEPSEEK_API_KEY: [{ model: 'fake-ticked', use: true, inPerM: 0.75, outPerM: 1.625 }, { model: 'fake-second', use: true, inPerM: 0.5, outPerM: 1 }] },
  })));
  return w;
}
const runBody = (w, over = {}) => ({ flow: 'job2', inputs: w.inputs(), ...over });

test('a different model on a run is Sign & run (needs the hash); the same model as the flow records is a plain Run', async () => {
  const w = await modelWorld();
  const same = await w.post('/api/author/run-prepare', runBody(w, { provider: 'DEEPSEEK_API_KEY', model: 'fake-ticked' }));
  assert.equal(same.json().needsSign, false, same.text);
  const other = await w.post('/api/author/run-prepare', runBody(w, { provider: 'DEEPSEEK_API_KEY', model: 'fake-second' }));
  assert.equal(other.status, 200, other.text);
  assert.equal(other.json().needsSign, true);
  const no = await w.post('/api/author/run', runBody(w, { provider: 'DEEPSEEK_API_KEY', model: 'fake-second' }));
  assert.equal(no.status, 409, 'one click signs nothing');
  assert.deepEqual(w.starts(), []);
});

test('must fail: the signed run model lands in that run\'s values; the flow\'s model.json is unchanged', async () => {
  const w = await modelWorld();
  const flowModel = readFileSync(path.join(w.root, 'job2', 'model.json'), 'utf8');
  const p = await w.post('/api/author/run-prepare', runBody(w, { provider: 'DEEPSEEK_API_KEY', model: 'fake-second' }));
  const r = await w.post('/api/author/run', runBody(w, { provider: 'DEEPSEEK_API_KEY', model: 'fake-second', hash: p.json().hash, runId: 'm-run' }));
  assert.equal(r.status, 202, r.text);
  const rec = JSON.parse(readFileSync(path.join(w.root, 'job2', 'runs', 'm-run', 'signed-values.json'), 'utf8'));
  assert.deepEqual(rec.values.model, { slot: 'DEEPSEEK_API_KEY', model: 'fake-second' });
  assert.equal(readFileSync(path.join(w.root, 'job2', 'model.json'), 'utf8'), flowModel);
});

test('a model that is not ticked is refused at the prepare click, naming it, at $0', async () => {
  const w = await modelWorld();
  const p = await w.post('/api/author/run-prepare', runBody(w, { provider: 'DEEPSEEK_API_KEY', model: 'ghost' }));
  assert.equal(p.status, 400, p.text);
  assert.match(p.text, /ghost/);
});

test('the CLI run uses the run\'s signed model, not the flow\'s: a run model that is no longer ticked is refused by name', async () => {
  const w = await modelWorld();
  const flowDir = path.join(w.root, 'job2');
  const read = readFlow({ root: w.root, name: 'job2', catalogue: loadCatalogue().primitives });
  const runDir = path.join(flowDir, 'runs', 'ghost-run');
  mkdirSync(runDir, { recursive: true });
  const values = { capUsd: 0.25, destination: w.outDir, askWaits: { 4: '30m' }, model: { slot: 'DEEPSEEK_API_KEY', model: 'ghost-model' } };
  const rec = { flow: 'job2', flowSignatureHash: read.signature.flow, runId: null, version: 0, values, signedBy: 't', at: '2026-10-15T00:00:00.000Z' };
  const wr = writeRunValues(runDir, { ...rec, runId: 'ghost-run', hash: valuesHash(rec) });
  assert.equal(wr.ok, true, JSON.stringify(wr));
  const r = spawnSync(process.execPath, [BIN, 'run', 'job2', '--root', w.root, '--run-id', 'ghost-run', ...w.inputs().flatMap((i) => ['--source', `${i.role}=${i.path}`])], {
    encoding: 'utf8', timeout: 30000, env: { ...w.env, FWDLOOP_TEST_MODEL_STEP: '', DEEPSEEK_API_KEY: 'sk-test-0123456789' },   // the live model path, not the test double
  });
  assert.notEqual(r.status, 0, `${r.stdout}${r.stderr}`);
  assert.match(`${r.stdout}${r.stderr}`, /ghost-model/);
});
