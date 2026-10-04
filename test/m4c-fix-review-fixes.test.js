// M4c-fix branch-review fixes (2026-10-04): the resume lock a failed holder write leaves behind.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CHILD = path.join(HERE, 'fixtures', 'resume-efbig-child.mjs');

test('takeResumeLock: a holder write that fails (real EFBIG) leaves no resume.lock behind', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-efbig-'));
  try {
    mkdirSync(path.join(root, 'f', 'runs', 'run-1'), { recursive: true });
    const r = spawnSync('sh', ['-c', `ulimit -f 0 && exec "${process.execPath}" "${CHILD}" "${root}"`], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const out = JSON.parse(r.stdout);
    assert.equal(out.result.outcome, 'refused');
    assert.match(out.result.red, /could not record the lock holder/);
    assert.equal(out.lockLeft, false, 'the empty lock this call just created must be removed');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
