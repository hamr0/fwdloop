// M4c-fix amendment 3 (docs/wiki/the-module-ladder.md): four self-review findings.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, writeFileSync, rmSync, existsSync, readdirSync, readFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { reopenAsk } from '../src/ask.js';

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

// (b) a failed set-aside refuses the reopen and writes nothing.
test('amend3 (b): reopen with a late answer that cannot be set aside is refused and writes nothing', () => {
  const runDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-a3b-'));
  try {
    const askId = 'ask-b';
    const askedAt = '2026-10-04T08:00:00.000Z';
    const expiresAt = '2026-10-04T08:30:00.000Z';
    writeFileSync(path.join(runDir, 'ask.json'), JSON.stringify({ askId, askedAt, expiresAt, question: 'q' }));
    writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ askId, decision: 'accept', answeredAt: '2026-10-04T09:00:00.000Z' }));
    // every record name setAsideAnswer would use is taken: it cannot move the answer aside
    for (let n = 1; n < 1000; n += 1) writeFileSync(path.join(runDir, `answer.${askId}.late.${n}.json`), '{}');
    const before = readdirSync(runDir).sort();
    const r = reopenAsk({ runDir, askId, by: 'human', clock: () => '2026-10-04T10:00:00.000Z' });
    assert.deepEqual(r, { ok: false, red: 'Could not clear the late answer; nothing was reopened.' });
    assert.deepEqual(readdirSync(runDir).sort(), before, 'no reopen record, nothing else written');
    assert.equal(existsSync(path.join(runDir, 'audit.jsonl')), false, 'no audit row');
    assert.ok(readFileSync(path.join(runDir, 'answer.json'), 'utf8').includes('accept'), 'the answer was left where it was');
  } finally {
    rmSync(runDir, { recursive: true, force: true });
  }
});

test('amend3 (b): the page shows that refusal as the plain sentence', () => {
  const page = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
  const start = page.indexOf('function refusalText(');
  const fn = page.slice(start, page.indexOf('\n  }', start) + 4);
  const refusalText = new Function(`${fn} return refusalText;`)();
  const red = 'Could not clear the late answer; nothing was reopened.';
  assert.equal(refusalText({ status: 409, body: { ok: false, refused: 'library', red } }, 'redo'), red);
});
