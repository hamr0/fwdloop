// M6 piece A: `signDraft` (the one sign path: CLI and panel) replaces an existing signed job ONLY when it is handed the signature hash the
// draft was opened from, and that is still the job's. A brand-new draft whose name is taken is refused as before.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { draftToDir, signDraft } from '../src/authoring.js';
import { readFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readSetup } from '../src/setup.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const CAT = loadCatalogue().primitives;

/** Draft job2 (optionally with a changed prose) into `<work>/<tag>` against the shared flows root. */
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
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m6s-'));
  const root = path.join(work, 'flows');
  const v1 = await draftInto(root, work, 'd1');
  const s1 = signDraft({ dir: v1.dir, approve: v1.hash, signedBy: 'alice' });
  assert.equal(s1.ok, true, JSON.stringify(s1.reds));
  return { work, root, flowHash: s1.signature.flow, flowDir: s1.flowDir };
}

test('sign with replaces: the edited draft replaces the job; the setup record is the new one only', async () => {
  const w = await world();
  const v2 = await draftInto(w.root, w.work, 'd2', (t) => t.replace('under 600 words, 200ish each', 'under 500 words, 150ish each'));
  const s = signDraft({ dir: v2.dir, approve: v2.hash, signedBy: 'alice', replaces: { flowHash: w.flowHash } });
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  const read = readFlow({ root: w.root, name: 'job2', catalogue: CAT });
  assert.equal(read.ok, true);
  assert.match(readFileSync(path.join(w.flowDir, 'prose.txt'), 'utf8'), /under 500 words/);
  assert.notEqual(read.signature.flow, w.flowHash);
  assert.equal(s.setup.ok, true, 'the new setup record is written (the old one was moved out of the way)');
  const rows = readSetup(w.flowDir).rows;
  assert.equal(rows.filter((r) => r.kind === 'sign').length, 1, 'one sign row: the new job\'s');
  assert.equal(rows.find((r) => r.kind === 'sign').flowHash, read.signature.flow);
  assert.deepEqual(readdirSync(w.flowDir).sort(), ['declaration.json', 'prose.txt', 'runs', 'setup.jsonl', 'signature.json', 'signed']);
});

test('sign with a stale replaces hash is refused by name and the job stays as signed', async () => {
  const w = await world();
  const before = readFileSync(path.join(w.flowDir, 'signature.json'), 'utf8');
  const v2 = await draftInto(w.root, w.work, 'd2', (t) => t.replace('under 600 words, 200ish each', 'under 500 words, 150ish each'));
  const s = signDraft({ dir: v2.dir, approve: v2.hash, signedBy: 'alice', replaces: { flowHash: 'f'.repeat(64) } });
  assert.equal(s.ok, false);
  assert.match(s.reds.join('\n'), /"job2" was signed again since you opened it/);
  assert.equal(readFileSync(path.join(w.flowDir, 'signature.json'), 'utf8'), before);
  assert.equal(readFlow({ root: w.root, name: 'job2', catalogue: CAT }).ok, true);
});

test('a new draft with a taken name and no replaces is still refused', async () => {
  const w = await world();
  const v2 = await draftInto(w.root, w.work, 'd2', (t) => t.replace('under 600 words, 200ish each', 'under 500 words, 150ish each'));
  const s = signDraft({ dir: v2.dir, approve: v2.hash, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds.join('\n'), /already exists/);
  assert.equal(existsSync(path.join(w.flowDir, 'signed', 'prose.txt')), true);
  assert.doesNotMatch(readFileSync(path.join(w.flowDir, 'prose.txt'), 'utf8'), /under 500 words/);
});
