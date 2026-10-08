// M4e: haltRun's history end row is the LAST write — its appearance means the run is fully settled (halt.json, log.json, stop rows
// all already on disk). A reader that sees `[■] stopped` from the history row must also find the halt record that makes Resume
// offerable. Deterministic seam, no timing: a later write is made to FAIL (log.json is a directory), and we look at what a reader
// is left with at the moment the run died. $0: a fake modelStep in-process.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory } from '../src/books.js';
import { runFlow, makeParkingAskStep, requestStop, HALT_FILE } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);

test('haltRun: when a write after the history row fails, no history end row is left without its halt record (the row is the last write)', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-haltorder-'));
  const root = path.join(base, 'flows'); const dest = path.join(base, 'dest'); const src = path.join(base, 'src');
  for (const d of [root, dest, src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${dest}`);
  const w = writeFlow({
    root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: cat.primitives,
  });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const flowDir = path.join(root, 'job2');
  const runDir = path.join(flowDir, 'runs', 'run-1');
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('job description markdown')) { // stop lands during step 2, and log.json is made unwritable
      requestStop(runDir);
      mkdirSync(path.join(runDir, 'log.json'), { recursive: true });
    }
    return { ok: true, costUsd: 0.001, artifact: { text: 't', done: true } };
  };
  await assert.rejects(runFlow({
    root, name: 'job2', runId: 'run-1', catalogue: cat.primitives, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  }), /EISDIR/);
  const ended = readHistory(flowDir).filter((r) => r.runId === 'run-1' && r.outcome === 'stopped');
  assert.ok(ended.length === 0 || existsSync(path.join(runDir, HALT_FILE)),
    `a history row says "stopped" but ${HALT_FILE} is not written yet — a reader sees stopped with no Resume`);
});
