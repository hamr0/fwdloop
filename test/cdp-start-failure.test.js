// Fix ledger (2026-10-12): a Chromium that is installed but slow to start used to resolve null, and every browser test then reported
// "skipped, no chromium installed" (reads as a pass). Now: not installed = null (skip); installed but not started in time = a loud throw.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';

const CDP = new URL('../scripts/panel-fixtures/cdp.mjs', import.meta.url).href;
const run = (bin, extraEnv = {}) => spawnSync(process.execPath, ['--input-type=module', '-e', `
  import { launchChrome } from ${JSON.stringify(CDP)};
  try { const c = await launchChrome(); console.log(JSON.stringify({ result: c === null ? 'null' : 'handle' })); process.exit(0); }
  catch (e) { console.log(JSON.stringify({ threw: e.message })); process.exit(0); }
`], { env: { ...process.env, FWDLOOP_CDP_BIN: bin, FWDLOOP_CDP_START_MS: '600', ...extraEnv }, encoding: 'utf8', timeout: 20_000 });

test('launchChrome: an installed chromium that never starts throws a loud error, even under CI', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-cdpfail-'));
  const fake = path.join(dir, 'fake-chromium');
  writeFileSync(fake, '#!/bin/sh\nexec sleep 30\n');
  chmodSync(fake, 0o755);
  for (const ci of [{}, { CI: 'true' }]) {
    const out = JSON.parse(run(fake, ci).stdout.trim().split('\n').pop());
    assert.match(out.threw ?? '', /installed .* but did not start within .* FAILURE, not a skip/, `got ${JSON.stringify(out)}`);
  }
});

test('launchChrome: no chromium installed still resolves null (the caller skips)', () => {
  const out = JSON.parse(run('/nonexistent/chromium').stdout.trim().split('\n').pop());
  assert.deepEqual(out, { result: 'null' });
});
