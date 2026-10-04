// M4c-fix amendment 3 (docs/wiki/the-module-ladder.md): four self-review findings.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');

// (a) fwdloop inbox cleans terminal codes out of the question, both row shapes.
test('amend3 (a): inbox prints no ESC byte from a model-written question (open and legacy rows)', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-a3a-'));
  try {
    const evil = 'pick one \x1b[2J\x1b]0;pwned\x07 now';
    const runDir = (name) => {
      const d = path.join(root, 'flowa', 'runs', name);
      mkdirSync(d, { recursive: true });
      return d;
    };
    writeFileSync(path.join(runDir('run-1'), 'ask.json'), JSON.stringify({
      askId: 'ask-1', question: evil, expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
    }));
    writeFileSync(path.join(runDir('run-2'), 'ask.json'), JSON.stringify({ question: evil }));
    const r = spawnSync(process.execPath, [BIN, 'inbox', '--root', root], {
      env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 15_000,
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /run=run-1 \[open\]/);
    assert.match(r.stdout, /run=run-2 \[legacy/);
    assert.ok(!r.stdout.includes('\x1b'), 'no ESC byte reaches the terminal');
    assert.ok(!r.stdout.includes('\x07'), 'no BEL byte either');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
