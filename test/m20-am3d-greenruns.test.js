// M20 am3d: greenRuns asks signedHashOf; a signature.json with no usable `.flow` counts no green run (it used to compare nothing with nothing).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { greenRuns } from '../src/panel/authortrigger.js';

function flowWith(signature) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am3d-'));
  writeFileSync(path.join(dir, 'prose.txt'), 'job\n');
  writeFileSync(path.join(dir, 'declaration.json'), '{}\n');
  writeFileSync(path.join(dir, 'signature.json'), signature);
  mkdirSync(path.join(dir, 'runs', 'old'), { recursive: true });
  // an old run: complete, no job copy, no signatureHash
  appendFileSync(path.join(dir, 'history.jsonl'), `${JSON.stringify({ runId: 'old', at: '2026-10-06T10:00:00.000Z', outcome: 'complete', spentUsd: 0, spendComplete: true, capUsd: 1, wallMs: 1 })}\n`);
  return dir;
}

test('am3d: a signature.json with no usable .flow counts no green run, even for an old run with no job copy and no signatureHash', () => {
  for (const sig of ['{}', '{"flow":""}', '{"flow":7}']) {
    const dir = flowWith(sig);
    try { assert.deepEqual([...greenRuns(dir)], [], sig); } finally { rmSync(dir, { recursive: true, force: true }); }
  }
});

test('am3d: with a usable .flow, an old run whose history row carries that hash still counts (legacy run)', () => {
  const dir = flowWith('{"flow":"abc"}');
  try {
    appendFileSync(path.join(dir, 'history.jsonl'), `${JSON.stringify({ runId: 'old2', at: '2026-10-06T11:00:00.000Z', outcome: 'complete', spentUsd: 0, spendComplete: true, capUsd: 1, wallMs: 1, signatureHash: 'abc' })}\n`);
    mkdirSync(path.join(dir, 'runs', 'old2'), { recursive: true });
    assert.deepEqual([...greenRuns(dir)].map((r) => r.runId), ['old2']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
