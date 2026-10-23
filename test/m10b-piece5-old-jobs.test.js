// M10b piece 5 (hamr's ruling: old jobs stay for reference, new jobs use new code): a signed CSV job whose green step still carries the old cell-cite close
// is refused at $0 when it is asked to run, naming the line; it still reads (display) as before. Fake steps, nothing paid.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { parseSignedText } from '../src/signed-text.js';
import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow, readFlow } from '../src/flow.js';
import { runFlow } from '../src/runner.js';
import { canFlowRun } from '../src/canrun.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const prose = readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.signed.txt'), 'utf8');
const cat = loadCatalogue();
const SENTENCE = "Line 2's check cannot cite cells any more";

function oldSignedJob() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-p5old-'));
  const d = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm4d-am8.aging.declaration.json'), 'utf8'));
  d.steps[1].reads = ['aging']; d.steps[2].reads = ['bucket_assignment']; // the old cite close: green, no close.sheet
  const csv = path.join(root, 'aging.csv');
  writeFileSync(csv, readFileSync(path.join(HERE, '..', 'fixtures', 'ar-aging.csv')));
  const text = sandboxSend(prose.replace('file:/home/hamr/fwdloop-out', 'file:poc/m0/out').replace(/source aging = file:.*/, `source aging = file:${csv}`));
  const w = writeFlow({ root, name: 'aging', proseText: text, declaration: d, signedBy: 'hamr', signedAt: '2026-10-11T00:00:00Z', catalogue: cat.primitives });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  return { root, csv };
}

test('an old signed job with a cell-cite close is refused at $0 when run, naming the line; no step ran, nothing was spent', async () => {
  const { root, csv } = oldSignedJob();
  let calls = 0;
  const r = await runFlow({
    root, name: 'aging', runId: 'run-1', sources: [{ id: 'aging', path: csv }], catalogue: cat.primitives,
    modelStep: async () => { calls += 1; return { ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } }; },
    askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-10-11',
  });
  assert.equal(r.outcome, 'preflight-red', JSON.stringify([r.outcome, r.red]));
  assert.ok(r.red.includes(SENTENCE) && r.red.includes('Draft it again to run it'), r.red);
  assert.equal(calls, 0);
  const spend = path.join(root, 'aging', 'runs', 'run-1', 'spend.jsonl');
  assert.ok(!existsSync(spend) || readFileSync(spend, 'utf8').trim() === '', 'no ledger spend');
});

test('the panel run door (canFlowRun) says the same; the old job still reads for display', () => {
  const { root } = oldSignedJob();
  const read = readFlow({ root, name: 'aging', catalogue: cat.primitives });
  assert.equal(read.ok, true, JSON.stringify(read.reds));
  const can = canFlowRun(read);
  assert.equal(can.ok, false);
  assert.ok(can.red.includes(SENTENCE), can.red);
  assert.equal(parseSignedText(prose).ok, true);
});
