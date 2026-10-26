// A jobs-folder error with no --root names the default folder, never the word "undefined". $0: a child process on a scratch config home.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'bin', 'fwdloop');

test('cli inbox with no --root and a default jobs folder that is a file: the error names the folder, not "undefined"', () => {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-jobs-folder-err-'));
  const cfg = path.join(home, 'cfg');
  mkdirSync(cfg, { recursive: true });
  const folder = path.join(cfg, 'flows');
  writeFileSync(folder, 'not a folder');
  const r = spawnSync(process.execPath, [BIN, 'inbox'], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: cfg, HOME: home } });
  assert.notEqual(r.status, 0, r.stdout);
  assert.ok(!r.stderr.includes('undefined'), r.stderr);
  assert.ok(r.stderr.includes('the jobs folder'), r.stderr);
  assert.ok(r.stderr.includes(folder), r.stderr);
});
