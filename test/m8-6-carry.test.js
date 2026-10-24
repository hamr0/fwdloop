// M8 item 6 (the Audit box): the record of what the drafter was handed reaches the RUN, write-once. A new job's sign puts it beside the flow; the FIRST run from that flow takes it
// (rename: it moves once); a red run's redraft signed as a run (asRunOf) lands it in the new run's folder; a run that reused its plan has none. $0, scratch dirs (mkdtemp).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { existsSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { draftToDir, signDraft } from '../src/authoring.js';
import { runFlow } from '../src/runner.js';
import { readLearningsRecord, LEARNINGS_FILE } from '../src/flowmodel.js';
import { writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { sandboxSend } from './send-sandbox.js';
import { loadCatalogue } from '../src/catalogue.js';
import { cardsOf } from './m8-learn-fixtures.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const CATALOGUE = loadCatalogue().primitives;
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8-6c-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });
const BAD = '## summary of work history blurb\nworked places.';

/** a config home with learningHints ON and one ledger row for job2, so the draft is handed a block */
function homeWithHint() {
  const h = tmp('cfg');
  writeFileSync(path.join(h, 'config.json'), JSON.stringify({ learningHints: true }));
  const built = cardsOf('ms2c0ls7');
  const row = countLedger(emptyLedger(), { runid: 'r0', cards: built.cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: new Date() }).rows[0];
  writeLedger({ ...emptyLedger(), rows: [{ ...row, lastSeen: new Date().toISOString() }] }, h);
  process.env.FWDLOOP_CONFIG_HOME = h;
  return h;
}
async function draftInto(root, work, tag, tweak = (t) => t) {
  const fx = job2Fixture();
  const proseFile = path.join(work, `${tag}.prose.txt`);
  writeFileSync(proseFile, tweak(fx.prose));
  const dir = path.join(work, tag);
  const r = await draftToDir({ proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {} });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  return { dir, hash: r.hash, fx };
}
const failingStep = async () => ({ ok: true, costUsd: 0.001, artifact: { text: BAD, done: true } }); // every step red: a run that ends without an ask

test('a new job: the sign puts the record beside the flow, the FIRST run takes it, the second run has none', async () => {
  homeWithHint();
  const work = tmp('work'); const root = path.join(work, 'flows');
  const d = await draftInto(root, work, 'd1');
  const handed = JSON.parse(readFileSync(path.join(d.dir, LEARNINGS_FILE), 'utf8'));
  const s = signDraft({ dir: d.dir, approve: d.hash, signedBy: 'alice' });
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  assert.deepEqual(JSON.parse(readFileSync(path.join(s.flowDir, LEARNINGS_FILE), 'utf8')), handed, 'copied byte for byte beside the flow');
  const base = { root, name: 'job2', catalogue: CATALOGUE, modelStep: failingStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', sources: d.fx.sources };
  const r1 = await runFlow({ ...base, runId: 'run-1' });
  assert.equal(r1.outcome, 'struck-out', JSON.stringify(r1));
  assert.deepEqual(readLearningsRecord(path.join(s.flowDir, 'runs', 'run-1')), handed, 'run-1 has the record');
  assert.equal(existsSync(path.join(s.flowDir, LEARNINGS_FILE)), false, 'it moved: the flow folder no longer holds it');
  const r2 = await runFlow({ ...base, runId: 'run-2' });
  assert.equal(readLearningsRecord(path.join(s.flowDir, 'runs', 'run-2')), null, 'run-2 reused the plan: no record, so no box');
});

test('a red run\'s redraft signed as a run: the record lands in the NEW run\'s folder, write-once', async () => {
  homeWithHint();
  const work = tmp('work2'); const root = path.join(work, 'flows');
  const d1 = await draftInto(root, work, 'd1');
  assert.equal(signDraft({ dir: d1.dir, approve: d1.hash, signedBy: 'alice' }).ok, true);
  const d2 = await draftInto(root, work, 'd2', (t) => t.replace(/cap \$[0-9.]+/, 'cap $0.77'));
  const s = signDraft({ dir: d2.dir, approve: d2.hash, signedBy: 'alice', asRunOf: { flow: 'job2' } });
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  assert.deepEqual(readLearningsRecord(s.runDir), JSON.parse(readFileSync(path.join(d2.dir, LEARNINGS_FILE), 'utf8')));
});

test('a draft handed nothing writes no record, so the run has none', async () => {
  const h = tmp('cfg-off'); process.env.FWDLOOP_CONFIG_HOME = h; // learningHints absent = OFF
  const work = tmp('work3'); const root = path.join(work, 'flows');
  const d = await draftInto(root, work, 'd1');
  const s = signDraft({ dir: d.dir, approve: d.hash, signedBy: 'alice' });
  assert.equal(s.ok, true);
  assert.equal(existsSync(path.join(s.flowDir, LEARNINGS_FILE)), false);
});
