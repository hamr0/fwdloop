// M4c-fix exit walk: the walk root hamr clicks through carries the three amendment-1 expired runs, built at $0.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { rmSync, readFileSync } from 'node:fs';
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

// hamr's phone Audit walk (sheet line 11): the practice root must carry a row WITH a gap, a refused list, a tool tally and a
// very long step name, so a tap on a phone-width row has something to show. The row is written by the real runner (a real
// shape closer failing a real draft), not by hand.
test('walk-root: run-gap has a real audit row with a gap text, a refused list, tools and a very long step name', () => {
  const rows = readFileSync(path.join(root, 'long-name-gap', 'runs', 'run-gap', 'audit.jsonl'), 'utf8')
    .trim().split('\n').map((l) => JSON.parse(l));
  const red = rows.find((r) => r.verdict === 'red');
  assert.ok(red, 'a red attempt row');
  assert.ok(red.step.length > 80, `a long step name (${red.step.length} chars)`);
  assert.match(red.gap, /professional skills/, "the shape closer's own gap text");
  assert.equal(red.refused.length, 1, 'a refused list entry');
  assert.deepEqual(red.tools, { read: 2, grep: 1 });
  assert.equal(rows.find((r) => r.step === red.step && r.attempt === 2)?.verdict, 'green', 'the retry healed it');
  assert.equal(listRuns({ root, catalogue: CAT }).find((x) => x.runId === 'run-gap')?.glyph, '[✓]');
});
