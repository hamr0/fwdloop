// M9 live-walk bug: a triggered run showed "[?] crash" for ~1.6 s before it showed "running". In that gap the run folder exists
// (trigger.json written by the starter) with no pid row and no books; `computeGlyph` fell to its last `[?]` branch. A run whose
// start folder is in phase `starting` (starter.startingFor, the ONE rule) reads `[▶]` starting; a refused start does not. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { isFwdloopAlive, procStartOf } from '../src/liveness.js';
import { listRuns, getRunDetail } from '../src/panel/data.js';
import { createStarter } from '../src/panel/authorstart.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();

const CAT = loadCatalogue().primitives;
const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'fwdloop');

async function liveFwdloop(w) {
  const c = spawn(process.execPath, [BIN, 'panel', '--root', path.join(w.work, 'livepanel'), '--port', '0'], { stdio: 'ignore' });
  await until(() => { const s = procStartOf(c.pid); return s !== null && isFwdloopAlive(c.pid) === true; });
  return c;
}
/** a start folder for job2/run-1 of `kind`, its child `child`, and the run folder holding only what the starter writes before the spawn */
function seedStart(w, child, kind = 'trigger') {
  const dir = path.join(w.root, '.starts', 's-0000000001-aaaa');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(dir, 'start.json'), JSON.stringify({ kind, flow: 'job2', runId: 'run-1', startedAt: new Date().toISOString() }));
  writeFileSync(path.join(dir, 'pid.json'), JSON.stringify({ pid: child.pid, procStart: procStartOf(child.pid), startedAt: Date.now() }));
  const run = path.join(w.root, 'job2', 'runs', 'run-1');
  mkdirSync(run, { recursive: true });
  writeFileSync(path.join(run, 'trigger.json'), JSON.stringify({ at: new Date().toISOString() }));
}
const rowOf = (w, startingRun) => listRuns({ root: w.root, catalogue: CAT, startingRun }).find((r) => r.flow === 'job2' && r.runId === 'run-1');

for (const kind of ['trigger', 'run', 'sign']) {
  test(`(1) a ${kind} start in phase starting, run folder with no pid row: [▶] starting, never [?] (list and detail)`, async () => {
    const w = await world({ limit: 5 });
    await w.signedFlow();
    const child = await liveFwdloop(w);
    try {
      seedStart(w, child, kind);
      const starter = createStarter({ root: w.root, bin: BIN });
      const startingRun = (f, r) => starter.startingFor(f, [], r) !== null;
      const row = rowOf(w, startingRun);
      assert.equal(row.glyph, '[▶]', JSON.stringify(row));
      assert.equal(row.label, 'starting');
      const d = getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT, startingRun });
      assert.equal(d.glyph, '[▶]', JSON.stringify(d.glyph));
    } finally { child.kill('SIGKILL'); }
  });
}

test('(2) the start is refused (child dead, no pid row): not [▶]', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  const child = await liveFwdloop(w);
  seedStart(w, child);
  child.kill('SIGKILL');
  await until(() => isFwdloopAlive(child.pid) !== true);
  const starter = createStarter({ root: w.root, bin: BIN });
  const row = rowOf(w, (f, r) => starter.startingFor(f, [], r) !== null);
  assert.notEqual(row.glyph, '[▶]', JSON.stringify(row));
  assert.equal(row.glyph, '[?]');
});

test('(3) no startingRun given (or it says no): the unchanged read stays [?] for a folder with no pid row and no books', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  mkdirSync(path.join(w.root, 'job2', 'runs', 'run-1'), { recursive: true });
  assert.equal(rowOf(w, undefined).glyph, '[?]');
  assert.equal(rowOf(w, () => false).glyph, '[?]');
});
