// Fix ledger (2026-10-16): runs.jsonl and the provider spend log append with the same fresh-line start as every other book: a torn last line
// must not swallow the next row.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { appendFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { claimHold, readRuns } from '../src/monthly.js';
import { appendSpendRow, readSpendRows } from '../src/provider.js';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-torn-${p}-`));

test('runs.jsonl: a hold appended after a torn last line is read back, and the file stays 0600', () => {
  const home = tmp('home');
  const cfgDir = home;
  const claim = (id) => claimHold({ what: 'run', flow: 'f', runId: id, runDir: tmp('run'), holdUsd: 0.1, home });
  claim('r1');
  const file = path.join(cfgDir, 'runs.jsonl');
  assert.equal(statSync(file).mode & 0o777, 0o600);
  appendFileSync(file, '{"kind":"hold","holdId":"torn","at":"2026-10');
  claim('r2');
  assert.deepEqual(readRuns(home).filter((r) => r.kind === 'hold').map((r) => r.runId), ['r1', 'r2'], 'the new hold survives the torn line before it');
});

test('spend.jsonl: a spend row appended after a torn last line is read back', () => {
  const dir = tmp('spend');
  const p = path.join(dir, 'spend.jsonl');
  appendSpendRow(p, { model: 'm', costUsd: 0.01, tag: 'a' });
  appendFileSync(p, '{"model":"m","costUs');
  appendSpendRow(p, { model: 'm', costUsd: 0.02, tag: 'c' });
  assert.deepEqual(readSpendRows(p).map((r) => r.tag), ['a', 'c']);
  assert.equal(readFileSync(p, 'utf8').split('\n').filter((l) => l.includes('"tag":"c"')).length, 1);
});
