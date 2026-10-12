// M7 piece 2: one fresh store per run, outside every readScope. Each test can fail:
// the red line for it is recorded in the commit that added it.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { runStoreDir, withRunStore } from '../src/run-store.js';
import { resolvePrimitives, GateRefusal } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';

function twoRuns() {
  const runs = path.join(mkdtempSync(path.join(tmpdir(), 'fwdloop-m7b-')), 'flow', 'runs');
  const run1 = path.join(runs, 'run-1');
  const run2 = path.join(runs, 'run-2');
  mkdirSync(run1, { recursive: true });
  mkdirSync(run2, { recursive: true });
  return { run1, run2 };
}

test('M7: run-2 cannot see what run-1 stashed (each run has its own store)', async () => {
  const { run1, run2 } = twoRuns();
  assert.notEqual(runStoreDir(run1), runStoreDir(run2));
  await withRunStore(run1, (lc) => lc.stash('note', 'run one wrote this'));
  assert.equal((await withRunStore(run1, (lc) => lc.peek('note')))?.bytes, 18, 'the same run still sees its own stash');
  assert.equal(await withRunStore(run2, (lc) => lc.peek('note')), null, 'run-2 must not see it');
});

test('M7: the store is outside the run dir, so outside every readScope', async () => {
  const { run1 } = twoRuns();
  const dir = runStoreDir(run1);
  assert.ok(!dir.startsWith(run1 + path.sep) && dir !== run1, `${dir} is inside ${run1}`);
});

test('M7: a granted read cannot open the store file, by absolute or relative path', async () => {
  const { run1 } = twoRuns();
  await withRunStore(run1, (lc) => lc.stash('note', 'x'));
  const dbFile = path.join(runStoreDir(run1), 'index.db');
  assert.ok(existsSync(dbFile), 'the store file exists, so a refusal is the gate and not a missing file');
  const cat = loadCatalogue();
  const { tools } = resolvePrimitives(cat.primitives, ['read', 'grep'], { runDir: run1 });
  for (const tool of [tools.read, tools.grep]) {
    for (const p of [dbFile, path.join('..', '.stores', 'run-1', 'index.db')]) {
      await assert.rejects(() => tool.execute({ path: p, pattern: 'x' }), (e) => e instanceof GateRefusal, `${tool.name} ${p}`);
    }
  }
});
