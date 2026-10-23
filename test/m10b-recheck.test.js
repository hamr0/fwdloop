// M10b exit: scripts/m10b-recheck.mjs, the separate checker, on a copy of a real run (test/fixtures/m10b-recheck: m10b-aging-2 run-1). $0: no model, no network.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { cpSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'm10b-recheck.mjs');
const FIX = path.join(HERE, 'fixtures', 'm10b-recheck', 'flow');
const DIRS = [];
after(() => { for (const d of DIRS) rmSync(d, { recursive: true, force: true }); });

function copy() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m10b-recheck-'));
  DIRS.push(root);
  cpSync(FIX, path.join(root, 'job'), { recursive: true });
  return root;
}
const run = (root) => spawnSync(process.execPath, [SCRIPT, root, 'job', 'run-1'], { encoding: 'utf8', timeout: 60000 });

test('the recorded claims pass the signed checks on the saved sheet: ok, exit 0', () => {
  const r = run(copy());
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /^ok days-since-due$/m);
  assert.match(r.stdout, /^ok bucket-per-row$/m);
  assert.match(r.stdout, /^ok$/m);
});

test('one changed claim is RED naming the check, NOT OK, exit 1', () => {
  const root = copy();
  const f = path.join(root, 'job', 'runs', 'run-1', 'sheet-checks.json');
  const d = JSON.parse(readFileSync(f, 'utf8'));
  d.lines[0].claims.daysPastDue.days['2'] = 125;
  writeFileSync(f, JSON.stringify(d));
  const r = run(root);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^RED days-since-due /m);
  assert.match(r.stdout, /^ok bucket-per-row$/m);
  assert.match(r.stdout, /^NOT OK$/m);
});

test('the saved sheet changed by one cell: mismatch on the table, NOT OK, exit 1', () => {
  const root = copy();
  const f = path.join(root, 'job', 'runs', 'run-1', 'inputs', 'aging.csv');
  writeFileSync(f, readFileSync(f, 'utf8').replace('4200', '4201'));
  const r = run(root);
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /^mismatch table aging/m);
  assert.match(r.stdout, /^NOT OK$/m);
});
