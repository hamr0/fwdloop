// M4d amendment 33, the run's own record: a run records the model it STARTED on once (run-model.json, write-once) and every continue path
// (resume, continue, an answer-after-ask resume) keeps it. hamr 2026-10-22: "a resume keeps its model, a workflow reuse can change model".
// A resume naming another model is refused by name at $0; a run with no record (before this) keeps today's pick (its signed model, else model.json).
// $0: real bin/fwdloop children; a run that parks uses the test model step, a resume reads the live model gate (FWDLOOP_TEST_MODEL_STEP='').
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { readRunModel, writeRunModel } from '../src/flowmodel.js';
import {
  HERE, killChildrenAfter, tickedConfig, until, world,
} from './m4e-world.mjs';

killChildrenAfter();
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const SLOT = 'DEEPSEEK_API_KEY';

const config = (w, ticked) => writeFileSync(path.join(w.home, 'config.json'), JSON.stringify(tickedConfig({
  monthlyLimitUsd: 5,
  models: { [SLOT]: [{ model: 'fake-ticked', use: ticked.includes('fake-ticked'), inPerM: 0.75, outPerM: 1.625 }, { model: 'fake-second', use: ticked.includes('fake-second'), inPerM: 0.5, outPerM: 1 }] },
})));
const cli = (w, args, { live = false } = {}) => spawnSync(process.execPath, [BIN, ...args], {
  env: { ...w.env, HOME: w.work, ...(live ? { FWDLOOP_TEST_MODEL_STEP: '', DEEPSEEK_API_KEY: 'sk-test-0123456789' } : {}) }, encoding: 'utf8', timeout: 60_000,
});
const runArgs = (w, id, extra = []) => ['run', 'job2', '--root', w.root, '--run-id', id, ...w.inputs().flatMap((i) => ['--source', `${i.role}=${i.path}`]), ...extra];
const resumeArgs = (w, id, extra = []) => ['resume', id, '--flow', 'job2', '--root', w.root, ...extra];
const recordOf = (w, id) => path.join(w.root, 'job2', 'runs', id, 'run-model.json');
async function parkedRun(w, id, extra = []) {
  const r = cli(w, runArgs(w, id, extra));
  await until(() => existsSync(path.join(w.root, 'job2', 'runs', id, 'ask.json')));
  return r;
}

test('the record is write-once and reads back only a name and a model id', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am33rec-'));
  try {
    assert.equal(readRunModel(dir), null, 'no record');
    writeRunModel(dir, { slot: SLOT, model: 'm1' });
    assert.deepEqual(readRunModel(dir), { slot: SLOT, model: 'm1' });
    assert.throws(() => writeRunModel(dir, { slot: SLOT, model: 'm2' }), /EEXIST/);
    assert.deepEqual(readRunModel(dir), { slot: SLOT, model: 'm1' }, 'never overwritten');
    writeFileSync(path.join(dir, 'run-model.json'), '{"slot":"not a key name","model":"x"}');
    assert.equal(readRunModel(dir), null, 'unusable record reads as none');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a run started with --model records that model once; a run without it records the job default; the next run can pick another', async () => {
  const w = await world();
  await w.signedFlow();
  config(w, ['fake-ticked', 'fake-second']);
  await parkedRun(w, 'r-b', ['--model', 'fake-second']);
  assert.deepEqual(JSON.parse(readFileSync(recordOf(w, 'r-b'), 'utf8')), { slot: SLOT, model: 'fake-second' });
  await parkedRun(w, 'r-a');
  assert.deepEqual(JSON.parse(readFileSync(recordOf(w, 'r-a'), 'utf8')), { slot: SLOT, model: 'fake-ticked' }, 'default pick = the job record');
  assert.match(readFileSync(path.join(w.root, 'job2', 'model.json'), 'utf8'), /fake-ticked/, 'model.json is untouched');
});

test('a resume keeps the run\'s model: no --model uses it, the same --model is accepted, another is refused by name at $0', async () => {
  const w = await world();
  await w.signedFlow();
  config(w, ['fake-ticked', 'fake-second']);
  await parkedRun(w, 'r-b', ['--model', 'fake-second']);
  // default model un-ticked: only the run's own model (fake-second) is usable, so reaching past the model gate proves the record was read
  config(w, ['fake-second']);
  const keeps = cli(w, resumeArgs(w, 'r-b'), { live: true });
  assert.doesNotMatch(keeps.stderr, /Tick fake-ticked/, `resume used the job default instead of the run's model: ${keeps.stderr}`);
  assert.doesNotMatch(keeps.stderr, /This run started on/, keeps.stderr);
  const same = cli(w, resumeArgs(w, 'r-b', ['--model', 'fake-second']), { live: true });
  assert.doesNotMatch(same.stderr, /This run started on|Tick /, same.stderr);
  config(w, ['fake-ticked', 'fake-second']);
  const other = cli(w, resumeArgs(w, 'r-b', ['--model', 'fake-ticked']), { live: true });
  assert.notEqual(other.status, 0);
  assert.match(other.stderr, /This run started on fake-second; a resume keeps it\./);
  assert.match(other.stderr, /Nothing spent|\$0|nothing/i);
  const cont = cli(w, ['continue', 'r-b', '--flow', 'job2', '--root', w.root, '--model', 'fake-ticked'], { live: true });
  assert.match(cont.stderr, /This run started on fake-second; a resume keeps it\./, 'continue keeps the model too');
});

test('an old run with no record keeps today\'s pick: the job default, and a --model is still a free pick', async () => {
  const w = await world();
  await w.signedFlow();
  config(w, ['fake-ticked', 'fake-second']);
  await parkedRun(w, 'r-old');
  rmSync(recordOf(w, 'r-old'));
  config(w, ['fake-second']);   // the job default is un-ticked: with no record the default is read and refused by name, never a crash
  const old = cli(w, resumeArgs(w, 'r-old'), { live: true });
  assert.match(old.stderr, /Tick fake-ticked/, old.stderr);
  const free = cli(w, resumeArgs(w, 'r-old', ['--model', 'fake-second']), { live: true });
  assert.doesNotMatch(free.stderr, /This run started on|Tick |TypeError|at .*\.js:\d+/, free.stderr);
});

test('a run signed with its own model (signed-values.json) and no record keeps that model on resume; another --model keeps the signed refusal', async () => {
  const w = await world();
  await w.signedFlow();
  config(w, ['fake-ticked', 'fake-second']);
  await parkedRun(w, 'r-sv');
  rmSync(recordOf(w, 'r-sv'));
  const dir = path.join(w.root, 'job2', 'runs', 'r-sv');
  const sig = JSON.parse(readFileSync(path.join(w.root, 'job2', 'signature.json'), 'utf8')).flow;
  const { valuesHash, writeRunValues } = await import('../src/runvalues.js');
  w.seedPassed('job2');
  const own = (await w.get('/api/author/flows')).json().flows[0].values;   // the flow's own cap, destination and ask waits, plus the run's own model
  const values = { ...own, model: { slot: SLOT, model: 'fake-second' } };
  const hash = valuesHash({ flow: 'job2', flowSignatureHash: sig, runId: null, version: 0, values });
  assert.equal(writeRunValues(dir, { flow: 'job2', flowSignatureHash: sig, runId: 'r-sv', version: 0, values, hash, signedBy: 'test', at: new Date().toISOString() }).ok, true);
  config(w, ['fake-second']);
  const keeps = cli(w, resumeArgs(w, 'r-sv'), { live: true });
  assert.doesNotMatch(keeps.stderr, /Tick fake-ticked/, `signed-values model must win over model.json: ${keeps.stderr}`);
  const other = cli(w, resumeArgs(w, 'r-sv', ['--model', 'fake-ticked']), { live: true });
  assert.match(other.stderr, /signed with its model|started on fake-second/, other.stderr);
});
