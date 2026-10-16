// M6 am9 piece 2: a red run's redraft of an UNCHANGED job is signed as the plan of a NEW run (`run-N`) of the SAME workflow. The workflow's files
// are never written; a changed job is refused at sign time; the plan is stored with the run and verifies there.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { draftToDir, signDraft } from '../src/authoring.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readFlow, readPlan } from '../src/flow.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';
import { givePlanB, planWorld } from './m6-am9-helpers.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));

const CAT = loadCatalogue().primitives;
async function draftInto(root, work, tag, tweak = (t) => t) {
  const fx = job2Fixture();
  const proseFile = path.join(work, `${tag}.prose.txt`);
  writeFileSync(proseFile, tweak(fx.prose));
  const dir = path.join(work, tag);
  const r = await draftToDir({
    proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  return { dir, hash: r.hash };
}
async function world() {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am9s-'));
  const root = path.join(work, 'flows');
  const v1 = await draftInto(root, work, 'd1');
  const s1 = signDraft({ dir: v1.dir, approve: v1.hash, signedBy: 'alice' });
  assert.equal(s1.ok, true, JSON.stringify(s1.reds));
  const snap = () => Object.fromEntries(['prose.txt', 'declaration.json', 'signature.json', 'setup.jsonl', 'signed/prose.txt', 'signed/declaration.json'].map((f) => [f, readFileSync(path.join(s1.flowDir, f), 'utf8')]));
  return { work, root, flowDir: s1.flowDir, flowHash: s1.signature.flow, snap };
}
const sameJobRedraft = (t) => t.replace(/cap \$[0-9.]+/, 'cap $0.77'); // a RUN field only: the job is unchanged

test('am9 sign as a run: the plan lands in a NEW run-N of the same workflow; the workflow\'s files are byte-identical after', async () => {
  const w = await world();
  const before = w.snap();
  const listBefore = readdirSync(w.flowDir).sort();
  const v2 = await draftInto(w.root, w.work, 'd2', sameJobRedraft);
  const s = signDraft({ dir: v2.dir, approve: v2.hash, signedBy: 'alice', asRunOf: { flow: 'job2' } });
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  assert.equal(s.runId, 'run-1');
  assert.deepEqual(w.snap(), before, 'the workflow\'s signed files, signed copy and setup record are untouched');
  assert.deepEqual(readdirSync(w.flowDir).sort(), listBefore, 'no new workflow folder entry; the run lives under runs/');
  assert.equal(existsSync(path.join(w.root, 'job2-2')), false, 'a red run\'s redraft with the job unchanged makes NO new workflow');
  const kept = readPlan({ root: w.root, name: 'job2', catalogue: CAT, runDir: s.runDir });
  assert.equal(kept.ok, true, JSON.stringify(kept));
  assert.equal(kept.signature.flow, s.signature.flow);
  assert.notEqual(kept.signature.flow, w.flowHash);
  assert.match(readFileSync(path.join(s.runDir, 'job', 'prose.txt'), 'utf8'), /cap \$0\.77/);
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: CAT }).signature.flow, w.flowHash);
  assert.equal(s.setup.ok, true);
});

test('am9 sign as a run: a CHANGED job is refused at sign time, nothing written', async () => {
  const w = await world();
  const before = w.snap();
  const v2 = await draftInto(w.root, w.work, 'd2', (t) => t.replace('under 600 words, 200ish each', 'under 500 words, 150ish each'));
  const s = signDraft({ dir: v2.dir, approve: v2.hash, signedBy: 'alice', asRunOf: { flow: 'job2' } });
  assert.equal(s.ok, false);
  assert.match(s.reds.join('\n'), /not the job of "job2"/);
  assert.deepEqual(w.snap(), before);
  assert.equal(existsSync(path.join(w.flowDir, 'runs', 'run-1')), false, 'no run folder was claimed');
});

test('am9 sign as a run: a workflow that does not exist is refused; the next sign claims run-2', async () => {
  const w = await world();
  const v2 = await draftInto(w.root, w.work, 'd2', sameJobRedraft);
  const bad = signDraft({ dir: v2.dir, approve: v2.hash, signedBy: 'alice', asRunOf: { flow: 'nope' } });
  assert.equal(bad.ok, false);
  const ok1 = signDraft({ dir: v2.dir, approve: v2.hash, signedBy: 'alice', asRunOf: { flow: 'job2' } });
  assert.equal(ok1.runId, 'run-1');
  const v3 = await draftInto(w.root, w.work, 'd3', (t) => t.replace(/cap \$[0-9.]+/, 'cap $0.66'));
  const ok2 = signDraft({ dir: v3.dir, approve: v3.hash, signedBy: 'alice', asRunOf: { flow: 'job2' } });
  assert.equal(ok2.runId, 'run-2');
});

test('am9 the CLI: `fwdloop run <flow> --run-id run-N` executes the plan the run keeps (its state carries that plan\'s hash), with job/ and plan.json already in the folder', () => {
  const w = planWorld('cli');
  w.sign(w.root, 'job2');
  const b = givePlanB(w, 'run-1');
  const r = spawnSync(process.execPath, [path.join(HERE, '..', 'bin', 'fwdloop'), 'run', 'job2', '--root', w.root, '--run-id', 'run-1', ...w.sources.flatMap((s) => ['--source', `${s.id}=${s.path}`])], {
    encoding: 'utf8', timeout: 30000, env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs') },
  });
  assert.doesNotMatch(`${r.stdout}${r.stderr}`, /already exists|already has its copy/, `${r.stdout}${r.stderr}`);
  const state = JSON.parse(readFileSync(path.join(b.runDir, 'state.json'), 'utf8'));
  assert.equal(state.signatureHash, b.flow);
});
