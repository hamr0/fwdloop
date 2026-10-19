// canStart and claimRunId are ONE decider for an unnamed run: a stray non-directory runs/run-2 beside the directory runs/run-1 makes nextRunId say run-2,
// claimRunId skips to run-3 and starts; canStart used to refuse (400 "There is already a run"), so a hand Run was refused and a queued file waited forever.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createStarter } from '../src/panel/authorstart.js';

const rootWith = (setup) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-canstart-'));
  mkdirSync(path.join(root, 'job2', 'runs', 'run-1'), { recursive: true });
  setup(path.join(root, 'job2', 'runs'));
  return root;
};
const LOADED = { env: {}, keyNames: [] };

test('a stray file runs/run-2 beside the dir run-1: canStart lets an unnamed run start (claimRunId would take run-3)', () => {
  const root = rootWith((runs) => writeFileSync(path.join(runs, 'run-2'), 'x'));
  try {
    const s = createStarter({ root });
    assert.equal(s.canStart({ flow: 'job2', runId: '' }, LOADED), null);
    assert.deepEqual(readdirSync(path.join(root, 'job2', 'runs')).sort(), ['run-1', 'run-2'], 'canStart only looks: nothing claimed');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('a clean runs/: canStart still lets an unnamed run start, and a typed id that exists is still refused', () => {
  const root = rootWith(() => {});
  try {
    const s = createStarter({ root });
    assert.equal(s.canStart({ flow: 'job2', runId: '' }, LOADED), null);
    const r = s.canStart({ flow: 'job2', runId: 'run-1' }, LOADED);
    assert.equal(r?.status, 400);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
