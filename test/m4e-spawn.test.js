// M4e piece 2a, item 4: ONE detached spawn for every CLI child the panel starts. $0, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, readdirSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { spawnDetached } from '../src/panel/spawn.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PANEL = path.join(HERE, '..', 'src', 'panel');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

test('spawnDetached: array argv (no shell), own process group, exact env, log 0600, unref\'d', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m4e-sp-'));
  const bin = path.join(dir, 'probe.mjs');
  writeFileSync(bin, 'console.log(JSON.stringify({ argv: process.argv.slice(2), canary: process.env.CANARY ?? null, leaked: process.env.PARENT_ONLY ?? null }));\n');
  const logPath = path.join(dir, 'child.log');
  process.env.PARENT_ONLY = 'parent-env-must-not-reach-the-child';
  const child = spawnDetached({
    bin, argv: ['a b', ';echo pwned', '$(x)'], env: { PATH: process.env.PATH, CANARY: 'exact-env' }, logPath,
  });
  delete process.env.PARENT_ONLY;
  const pgid = Number(readFileSync(`/proc/${child.pid}/stat`, 'utf8').split(') ')[1].split(' ')[2]);
  assert.equal(pgid, child.pid, 'the child leads its own process group (detached)');
  for (let i = 0; i < 100 && readFileSync(logPath, 'utf8') === ''; i += 1) await sleep(30); // eslint-disable-line no-await-in-loop
  const out = JSON.parse(readFileSync(logPath, 'utf8'));
  assert.deepEqual(out, { argv: ['a b', ';echo pwned', '$(x)'], canary: 'exact-env', leaked: null });
  assert.equal(statSync(logPath).mode & 0o777, 0o600);
});

test('the panel has ONE spawn site: no src/panel file but spawn.js touches node:child_process', () => {
  const offenders = readdirSync(PANEL).filter((f) => f.endsWith('.js') && f !== 'spawn.js')
    .filter((f) => /child_process/.test(readFileSync(path.join(PANEL, f), 'utf8')));
  assert.deepEqual(offenders, []);
});
