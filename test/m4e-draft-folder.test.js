// M4e piece 2a, item 3 (docs/wiki/the-module-ladder.md, "M4e", scope 5 + 12): the panel's draft folders live at
// `<root>/.drafts/<id>/`. `draftToDir` allows exactly that and nothing else under the flows root, and a dot-name is
// never a flow anywhere (listing, readFlow). $0, fake provider, scratch dirs only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readdirSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { draftToDir, PANEL_DRAFTS_DIR } from '../src/authoring.js';
import { listFlowNames, readFlow, checkFlowName } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { listRuns } from '../src/panel/data.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-df-${p}-`));

async function setup() {
  const fx = job2Fixture();
  const work = tmp('w');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const root = path.join(work, 'flows');
  mkdirSync(root);
  const go = (dir, p = fakeProvider([toolReply(validArgs())])) => draftToDir({
    proseFile, dir, root, name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {},
  });
  return { work, root, go };
}

test('(3) draftToDir accepts exactly <root>/.drafts/<id>/... and writes the draft there', async () => {
  const { root, go } = await setup();
  const r = await go(path.join(root, PANEL_DRAFTS_DIR, 'd1', 'draft'));
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.ok(existsSync(path.join(root, '.drafts', 'd1', 'draft', 'spec.hash')));
});

test('(3) everything else under the flows root is still refused: .drafts itself, a sibling, a .drafts look-alike, and a .drafts symlink pointing at a flow folder', async () => {
  const { root, go } = await setup();
  mkdirSync(path.join(root, 'someflow'));
  symlinkSync(path.join(root, 'someflow'), path.join(root, 'looks-like-drafts')); // not named .drafts: refused as any root child
  const p = fakeProvider([toolReply(validArgs())]);
  for (const dir of [
    path.join(root, '.drafts'), path.join(root, '.drafts2', 'x'), path.join(root, 'x', '.drafts', 'y'), path.join(root, 'looks-like-drafts', 'y'),
  ]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await go(dir, p);
    assert.equal(r.wrote, false, dir);
    assert.match(r.reds[0], /is inside the flows root/, dir);
  }
  // `.drafts` made a symlink into a flow folder resolves INSIDE the root, to a flow folder: refused (checked by realpath)
  symlinkSync(path.join(root, 'someflow'), path.join(root, '.drafts'));
  const viaLink = await go(path.join(root, '.drafts', 'y', 'draft'), p);
  assert.equal(viaLink.wrote, false);
  assert.match(viaLink.reds[0], /is inside the flows root/);
  assert.equal(p.calls.length, 0, 'every refusal was at $0');
  assert.deepEqual(readdirSync(path.join(root, 'someflow')), [], 'nothing was written into the flow folder');
});

test('(3) a dot-name is never a flow: checkFlowName refuses .drafts, and a populated .drafts is in no flow list, no readFlow, no panel run list', async () => {
  const { root, go } = await setup();
  await go(path.join(root, '.drafts', 'd1', 'draft'));
  assert.equal(checkFlowName('.drafts').ok, false);
  assert.deepEqual(listFlowNames(root), []);
  const read = readFlow({ root, name: '.drafts', catalogue: loadCatalogue().primitives });
  assert.equal(read.ok, false);
  assert.deepEqual(listRuns({ root, catalogue: loadCatalogue().primitives, resumeAttempt: () => null }), []);
});
