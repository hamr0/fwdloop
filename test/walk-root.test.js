// M4c-fix exit walk: the walk root hamr clicks through carries the three amendment-1 expired runs, built at $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadCatalogue } from '../src/catalogue.js';
import { listRuns, getRunAsks } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'panel-fixtures', 'walk-root.mjs');
const CAT = loadCatalogue().primitives;
const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-walkroot-'));
const root = path.join(base, 'walk');
after(() => rmSync(base, { recursive: true, force: true }));

test('walk-root: run-expired, run-expired-late read [!] expired with the Reopen offer; run-ended-expired reads [!], never [✗]', () => {
  const r = spawnSync(process.execPath, [SCRIPT, root, '4811'], { encoding: 'utf8', timeout: 100_000 });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /panel --root .* --port 4811/);
  const runs = listRuns({ root, catalogue: CAT });
  const row = (id) => runs.find((x) => x.runId === id);
  for (const id of ['run-expired', 'run-expired-late', 'run-ended-expired']) {
    assert.equal(row(id)?.glyph, '[!]', id);
    assert.match(row(id).label, /expired/, id);
  }
  assert.equal(row('run-done').glyph, '[✓]', 'existing runs kept');
  for (const id of ['run-expired', 'run-expired-late']) {
    const ask = getRunAsks({ root, flow: 'job2', runId: id, catalogue: CAT }).asks[0];
    assert.equal(ask.open, false, id);
    assert.ok(Math.abs(ask.reopen.waitMs - 1_800_000) < 1000, `${id}: Reopen for the signed wait`);
  }
  const ended = getRunAsks({ root, flow: 'job2', runId: 'run-ended-expired', catalogue: CAT }).asks[0];
  assert.equal(ended.reopen, null, 'an ended run cannot be reopened');
});
