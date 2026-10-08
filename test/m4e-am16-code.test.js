// M4e amendment 16, group 4 "Code" (SIGNED 2026-10-08): C3, C4, C5. $0: fake keys, scratch config homes (all removed at exit).
// Never reads the real keys file: every key here is a fake value in a scratch home.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import * as authoring from '../src/authoring.js';
import { loadKeysEnv, keysForDoor, KEY_NAMES } from '../src/keysfile.js';
import { spawnDetached } from '../src/panel/spawn.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const scratch = (tag) => mkdtempSync(path.join(tmpdir(), `fwdloop-am16c-${tag}-`));

// ---- C3: one function checks the draft's API key ---------------------------------------------------------------------------------
const BAD_KEYS = [
  ['unset', {}],
  ['empty', { DEEPSEEK_API_KEY: '' }],
  ['newline', { DEEPSEEK_API_KEY: 'sk-fake-one\nsk-fake-two' }],
  ['space', { DEEPSEEK_API_KEY: 'sk-fake key' }],
];

test('C3: authoring exports the ONE draft-key check; a clean key passes, a bad one returns the sentence (never the value)', () => {
  assert.equal(typeof authoring.draftKeyRefusal, 'function', 'draftKeyRefusal is exported by src/authoring.js');
  assert.equal(authoring.draftKeyRefusal('deepseek', { DEEPSEEK_API_KEY: 'sk-fake-clean-value' }), null);
  for (const [what, env] of BAD_KEYS) {
    const said = authoring.draftKeyRefusal('deepseek', env);
    assert.match(String(said), /^key: DEEPSEEK_API_KEY /, what);
    assert.ok(!String(said).includes('sk-fake'), `${what}: the value is never in the sentence`);
  }
});

test('C3: the CLI and draftToDir refuse the same way, at $0, with no dir (both call the one check)', async () => {
  const work = scratch('c3');
  assert.equal(typeof authoring.draftKeyRefusal, 'function', 'the one check exists');
  try {
    const prose = path.join(work, 'prose.txt');
    writeFileSync(prose, 'Write a one-line note.\n');
    for (const [what, env] of BAD_KEYS) {
      const out = path.join(work, `draft-${what}`);
      const viaAuthoring = await authoring.draftToDir({
        proseFile: prose, dir: out, root: path.join(work, 'flows'), name: 'job', env,
      });
      assert.equal(viaAuthoring.wrote, false, what);
      assert.equal(viaAuthoring.costUsd, 0, what);
      const said = authoring.draftKeyRefusal('deepseek', env);
      assert.deepEqual(viaAuthoring.reds, [said], `${what}: draftToDir's refusal is the one function's sentence`);
      const cli = spawnSync(process.execPath, [BIN, 'draft', prose, '--out', path.join(work, `cli-${what}`), '--root', path.join(work, 'flows'), '--name', 'job'], {
        encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_TEST_CONTEXT: 'child-v8', ...env },
      });
      assert.notEqual(cli.status, 0, what);
      assert.equal(cli.stderr, `fwdloop: draft refused at $0 — ${said}\n`, `${what}: the CLI says the same sentence`);
      assert.equal(existsSync(path.join(work, `cli-${what}`)), false, `${what}: nothing written`);
      assert.equal(existsSync(out), false, `${what}: nothing written`);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
});

// ---- C4: the keys file passes only KEY_NAMES to a child ----------------------------------------------------------------------------
function fakeHome(lines) {
  const home = scratch('c4');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, '.env'), `${lines.join('\n')}\n`, { mode: 0o600 });
  chmodSync(path.join(home, '.env'), 0o600);
  return home;
}

test('C4: loadKeysEnv fills only KEY_NAMES from the file; other names are still listed but never reach the env', () => {
  const home = fakeHome(['NODE_OPTIONS=--require=/tmp/x', 'LD_PRELOAD=/tmp/y', `${KEY_NAMES[0]}=sk-fake-known-key`]);
  try {
    const r = loadKeysEnv({ env: { PATH: '/bin' }, home });
    assert.equal(r.ok, true);
    assert.equal(r.env[KEY_NAMES[0]], 'sk-fake-known-key', 'the known key gets through');
    assert.equal(r.env.NODE_OPTIONS, undefined, 'NODE_OPTIONS from the file never reaches the env');
    assert.equal(r.env.LD_PRELOAD, undefined);
    assert.ok(r.names.includes('NODE_OPTIONS'), 'Settings still lists the name');
    assert.ok(!JSON.stringify({ ...r, env: undefined }).includes('--require'), 'no value outside env');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('C4: a spawned child (the panel spawn helper, fed by the keys door) sees the known key and no NODE_OPTIONS', async () => {
  const home = fakeHome(['NODE_OPTIONS=--require=/tmp/x', `${KEY_NAMES[0]}=sk-fake-known-key`]);
  const work = scratch('c4-child');
  try {
    const bin = path.join(work, 'probe.mjs');
    const outFile = path.join(work, 'seen.json');
    writeFileSync(bin, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ opts: process.env.NODE_OPTIONS ?? null, key: process.env[${JSON.stringify(KEY_NAMES[0])}] ?? null }));\n`);
    const door = keysForDoor({ env: { PATH: process.env.PATH }, keysHome: home });
    assert.equal(door.ok, true);
    const child = spawnDetached({ bin, argv: [], env: door.env, logPath: path.join(work, 'child.log') });
    for (let i = 0; i < 100 && !existsSync(outFile); i += 1) await new Promise((r) => { setTimeout(r, 50); }); // the child is unref'd: poll, don't wait on its exit
    assert.ok(existsSync(outFile), 'the child ran to the end (a NODE_OPTIONS --require of a missing file kills it first)');
    assert.deepEqual(JSON.parse(readFileSync(outFile, 'utf8')), { opts: null, key: 'sk-fake-known-key' });
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); }
});

// ---- C5: the unreachable `if (!read.ok)` is gone -----------------------------------------------------------------------------------
test('C5: runAgain has no `if (!read.ok)` after canFlowRun, which has already refused every unreadable flow', () => {
  const text = readFileSync(path.join(HERE, '..', 'src', 'panel', 'authorflows.js'), 'utf8');
  const hits = text.split('\n').map((l, i) => [i, l]).filter(([, l]) => /^\s*if \(!read\.ok\) return no\(/.test(l));
  assert.deepEqual(hits.map(([i]) => i + 1), [], 'the unreachable one-line branch is removed');
});
