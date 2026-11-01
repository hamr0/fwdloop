// M13 am1: `fwdloop update` starts npm without any `*_KEY` setting from the shell; the panel still gets its keys. A fake `npm` on PATH records its env NAMES
// (never values); a canary `*_KEY` name sits in the parent env.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync, chmodSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { runNpm, startCmd } from '../src/launcher.js';

const CANARY = 'FWDLOOP_M13_CANARY_KEY';

test('runNpm: the npm child has no *_KEY name from the parent env, and still has PATH and HOME', async (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p1-npm-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(path.join(dir, 'bin'));
  const out = path.join(dir, 'npm-env-names.txt');
  const fake = path.join(dir, 'bin', 'npm');
  writeFileSync(fake, `#!/bin/sh\nenv | cut -d= -f1 | sort > "${out}"\nexit 0\n`);
  chmodSync(fake, 0o755);
  const saved = { PATH: process.env.PATH, HOME: process.env.HOME };
  process.env.PATH = `${path.join(dir, 'bin')}:${saved.PATH}`;
  process.env.HOME ??= dir;
  process.env[CANARY] = 'canary-not-a-key';
  let rc;
  try { rc = await runNpm(['install', '-g', 'fwdloop@latest'], { deadlineMs: 20000 }); } finally {
    delete process.env[CANARY]; process.env.PATH = saved.PATH;
    if (saved.HOME === undefined) delete process.env.HOME;
  }
  assert.equal(rc, 0);
  const names = readFileSync(out, 'utf8').split('\n');
  assert.equal(names.includes(CANARY), false, 'a parent *_KEY name reached npm');
  assert.equal(names.includes('PATH'), true);
  assert.equal(names.includes('HOME'), true);
});

test('the panel spawn env still carries the *_KEY name (startCmd is unchanged)', async (t) => {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m13p1-panel-'));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  let seen = null;
  await startCmd({ out() {}, err() {} }, {
    home, root: path.join(home, 'root'), isTTY: false, deadlineMs: 300, timeoutMs: 100, silentWaitMs: 100, open: () => {}, sleep: async () => {},
    fetchImpl: async () => { throw new Error('offline'); }, env: { [CANARY]: 'canary-not-a-key', PATH: '/bin' },
    spawnFn: ({ env }) => { seen = env; return { once() {}, unref() {} }; },
  });
  assert.equal(seen?.[CANARY], 'canary-not-a-key');
});
