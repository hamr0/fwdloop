// M4d piece 3 (docs/wiki/the-module-ladder.md, "M4d", scope items 4-5; negatives (v)-(viii), money half of (xiii)).
// $0, no network. Every test builds its own config home under a tracked mkdtemp dir; the real
// ~/.config/fwdloop is never touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  writeFileSync, mkdirSync, chmodSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { keysFilePath, loadKeysEnv } from '../src/keysfile.js';
import { draftToDir } from '../src/authoring.js';
import { install } from './fixtures/m4d-fake-openai.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4d3-${p}-`));
const FILE_KEY = 'file-only-key-m4d-p3-0123456789';

// Commit 0 (piece 2's one untested fix): the drafter must hand makeProvider the MERGED env.
test('draft: a key that lives ONLY in the keys file reaches makeProvider (drafter.js threads env)', async () => {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), `DEEPSEEK_API_KEY=${FILE_KEY}\n`, { mode: 0o600 });
  chmodSync(keysFilePath(home), 0o600);
  const loaded = loadKeysEnv({ env: {}, home });
  assert.equal(loaded.ok, true);
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY; // the key is NOT in the shell: only the merged env has it
  const restore = install({ inputTokens: 100, outputTokens: 50 });
  try {
    const work = tmp('draft');
    const proseFile = path.join(work, 'prose.txt');
    writeFileSync(proseFile, job2Fixture().prose);
    const r = await draftToDir({
      proseFile, dir: path.join(work, 'd'), root: path.join(work, 'flows'), name: 'x', env: loaded.env,
    });
    assert.equal(r.ok, true, JSON.stringify(r.reds));
  } finally {
    restore();
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});
