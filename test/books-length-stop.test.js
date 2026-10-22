// Books must balance: a try that ends with no artifact (a length stop: "truncated: N tokens, no tool call") still cost what the provider charged, so
// the run's history total equals the sum of its audit rows, and the cap check sees that spend. $0: a fake modelStep.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readHistory, readAudit } from '../src/books.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);
const CAT = cat.primitives;

function mk(tag) {
  const base = mkdtempSync(path.join(tmpdir(), `fwdloop-books-len-${tag}-`));
  const w = {
    base, root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src'),
  };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`);
  const r = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  w.flowDir = path.join(w.root, 'job2');
  w.runDir = path.join(w.flowDir, 'runs', 'run-1');
  w.sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];
  return w;
}


const emitsOf = (ctx) => (ctx.goal.includes('resume .docx') ? 'resume-text' : ctx.goal.includes('job description markdown') ? 'jd-text' : 'resume-summary');
const TRUNC = 'truncated: 20498 tokens, no tool call';
/** Steps 1-2 green at $0.001; step 3 ALWAYS ends with no artifact (a length stop) that cost `lengthUsd`. */
const lengthStop = (lengthUsd) => {
  let n = 0;   // a different word each try: the same red twice is a strike, and this test is about money, not strikes
  return async (ctx) => {
  const emits = emitsOf(ctx);
  if (emits === 'resume-summary') { n += 1; return { ok: false, red: `${TRUNC} ${'abcd'[n - 1]}`, costUsd: lengthUsd, turns: 8 }; }
  return { ok: true, costUsd: 0.001, turns: 1, artifact: { text: emits, done: true } };
  };
};
const args = (w, modelStep) => ({
  root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: makeParkingAskStep(), sources: w.sources,
});
const auditSum = (runDir) => readAudit(runDir).reduce((a, r) => a + (typeof r.usd === 'number' ? r.usd : 0), 0);

test('books: a run whose tries all end in a length stop (no artifact) still books their cost: history total = audit sum', async () => {
  const w = mk('sum');
  const r = await runFlow(args(w, lengthStop(0.04)));
  assert.equal(r.outcome, 'attempt-fallback', r.red);
  const rows = readAudit(w.runDir).filter((x) => String(x.gap).startsWith(TRUNC));
  assert.equal(rows.length, 4, 'four length-stop tries on the audit');
  const hist = readHistory(w.flowDir).at(-1);
  assert.ok(Math.abs(hist.spentUsd - auditSum(w.runDir)) < 1e-9, `history ${hist.spentUsd} vs audit ${auditSum(w.runDir)}`);
  assert.ok(Math.abs(r.spentUsd - auditSum(w.runDir)) < 1e-9, `result ${r.spentUsd} vs audit ${auditSum(w.runDir)}`);
});

test('books: the cap check sees the length-stop spend, so costly no-artifact tries halt the run at the cap, not after four free-looking tries', async () => {
  const w = mk('cap');
  const r = await runFlow(args(w, lengthStop(0.11)));   // cap $0.25, hold $0.01 a try
  assert.equal(r.outcome, 'cap-halt', r.red);
  assert.equal(readAudit(w.runDir).filter((x) => x.verdict === 'red' && String(x.gap).startsWith(TRUNC)).length, 3, 'three tries ran, the fourth could not be funded');
  const hist = readHistory(w.flowDir).at(-1);
  assert.ok(Math.abs(hist.spentUsd - auditSum(w.runDir)) < 1e-9, `history ${hist.spentUsd} vs audit ${auditSum(w.runDir)}`);
});
