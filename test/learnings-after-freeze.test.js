// A run refused at its inputs (preflight-red at freezeInputs) must not consume the flow's learnings record; a run that passes the freeze takes it.
// Written red-first (fix-ledger: src/runner.js takeLearningsRecord ran before freezeInputs). $0, scratch dirs, injected fetchPage.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { runFlow } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { LEARNINGS_FILE } from '../src/flowmodel.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sandboxSend } from './send-sandbox.js';
import makeFake from './fixtures/cli-fake-model-step.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fx = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-learn-freeze-'));
  const cat = loadCatalogue().primitives;
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fx('job2-with-sources.signed.txt')), declaration: JSON.parse(fx('job2.m1.declaration.json')),
    signedBy: 'hamr', signedAt: '2026-09-24T12:00:00Z', catalogue: cat,
  });
  assert.equal(w.ok, true);
  const flowDir = path.join(root, 'job2');
  writeFileSync(path.join(flowDir, LEARNINGS_FILE), `${JSON.stringify({ phase: 'draft', text: 'a note', ids: ['x'], chars: 6 })}\n`);
  return { root, cat, flowDir };
}

test('a run refused at its inputs leaves the flow learnings record where it was', async () => {
  const { root, cat, flowDir } = setup();
  const result = await runFlow({
    root, name: 'job2', runId: 'run-1', sources: [{ id: 'resume', path: 'https://example.invalid/page' }], catalogue: cat,
    modelStep: async () => { throw new Error('modelStep must never be called'); },
    askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
    fetchPage: async () => ({ ok: false, error: 'the page would not load' }),
  });
  assert.equal(result.outcome, 'preflight-red');
  assert.ok(existsSync(path.join(flowDir, LEARNINGS_FILE)), 'the record is still in the flow folder');
  assert.equal(existsSync(path.join(flowDir, 'runs', 'run-1', LEARNINGS_FILE)), false, 'and not in the refused run');
});

test('a run that passes its inputs takes the record into the run folder', async () => {
  const { root, cat, flowDir } = setup();
  const src = mkdtempSync(path.join(tmpdir(), 'fwdloop-learn-freeze-src-'));
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  await runFlow({
    root, name: 'job2', runId: 'run-1',
    sources: [{ id: 'resume', path: 'https://example.invalid/page' }, { id: 'jd', path: path.join(src, 'jd.md') }], catalogue: cat,
    modelStep: makeFake(), askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
    fetchPage: async () => ({ ok: true, text: 'Resume text goes here.', url: 'https://example.invalid/page' }),
  });
  assert.equal(existsSync(path.join(flowDir, LEARNINGS_FILE)), false, 'the record left the flow folder');
  assert.ok(existsSync(path.join(flowDir, 'runs', 'run-1', LEARNINGS_FILE)), 'and sits with the run');
});
