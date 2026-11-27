// M20 am3 item 6: signed-values versions have one reader. The Audit's list (getDraftBlock) reads through listRunValues, so a version the
// run's parser refuses shows as that refusal, never as a signed row. $0, mkdtemp fixtures.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { getDraftBlock } from '../src/panel/data.js';
import { listRunValues, valuesFileName, valuesHash, writeRunValues } from '../src/runvalues.js';

test('item 6: a version the parser refuses shows as its refusal, not as a signed row; the good one still shows signed', () => {
  const dir = mkdtempSync('m20-am3-item6-');
  try {
    const values = { capUsd: 1, destination: null, askWaits: {} };
    const hash = valuesHash({ flow: 'f', flowSignatureHash: 'sig', runId: null, version: 0, values });
    const w = writeRunValues(dir, { flow: 'f', flowSignatureHash: 'sig', runId: 'run-1', version: 0, values, hash, signedBy: 'you', at: '2026-11-27T00:00:00.000Z' });
    assert.equal(w.ok, true);
    // version 1: a torn file the parser refuses
    writeFileSync(path.join(dir, valuesFileName(1)), '{"version": 1, "flow"');
    const listed = listRunValues(dir);
    assert.equal(listed[0].ok, true);
    assert.equal(listed[1].ok, false);
    const red = listed[1].red;
    assert.match(red, /^signed values: signed-values-r1\.json is not valid JSON/);

    let rows;
    assert.doesNotThrow(() => { rows = getDraftBlock(dir, dir).rows; }, 'the Audit list reads a refused version without reading its record');
    assert.ok(rows.some((r) => r.action === red), `the refused version shows as its refusal; rows: ${JSON.stringify(rows.map((r) => r.action))}`);
    assert.equal(rows.filter((r) => r.action === 'Sign & resume (you)').length, 0, 'the refused version never reads Sign & resume');
    assert.equal(rows.filter((r) => r.action === 'Sign & run (you)').length, 1, 'the good version still shows signed');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
