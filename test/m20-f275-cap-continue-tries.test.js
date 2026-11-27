// M20 F275 / signed M4d am30 ("In one step, try numbers never restart"): a cap-halt that cuts a step mid-way, then Continue.
// The continue leg's tries for that step are numbered AFTER the first leg's; only the number moves, the step's try limit is unchanged.
// $0: a fake modelStep through the real runFlow / continueRun, a mkdtemp root removed by the tracker.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readAudit } from '../src/books.js';
import { runFlow, continueRun, makeParkingAskStep } from '../src/runner.js';
import { sendViaPrimitive } from '../src/send.js';
import { valuesHash, writeRunValues } from '../src/runvalues.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const STEP = 'resume-summary';

test('F275: after a cap-halt mid-step, Continue numbers the step\'s tries after the first leg\'s; the try limit is unchanged', async () => {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-f275-'));
  const w = { root: path.join(base, 'flows'), dest: path.join(base, 'dest'), src: path.join(base, 'src') };
  for (const d of [w.root, w.dest, w.src]) mkdirSync(d, { recursive: true });
  writeFileSync(path.join(w.src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(w.src, 'jd.md'), 'JD text.');
  const prose = fixture('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${w.dest}`).replace('cap $0.25', 'cap $0.0105');
  const made = writeFlow({
    root: w.root, name: 'job2', proseText: prose, declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  assert.equal(made.ok, true, made.ok ? '' : made.reds.join('\n'));
  const flowDir = path.join(w.root, 'job2');
  const runDir = path.join(flowDir, 'runs', 'run-1');
  const sources = [{ id: 'resume', path: path.join(w.src, 'resume.docx') }, { id: 'jd', path: path.join(w.src, 'jd.md') }];

  // the summary step never passes its checks (no sections): every try is red; only its try costs money, so the cap bites on its 2nd try
  const summaryCalls = [];
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0, artifact: { text: 'jd text', done: true } };
    summaryCalls.push(1);
    return { ok: true, costUsd: 0.001, artifact: { text: 'no sections here', done: true } };
  };
  const args = { root: w.root, name: 'job2', runId: 'run-1', catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01 };

  const r1 = await runFlow({ ...args, askStep: makeParkingAskStep(), sources });
  assert.equal(r1.outcome, 'cap-halt', r1.red);
  const nums = () => readAudit(runDir).filter((r) => r.step === STEP && Number.isInteger(r.attempt) && r.verdict !== 'cap-halt').map((r) => r.attempt);
  const leg1 = nums();
  assert.deepEqual(leg1, [1], 'the first leg ran one try of the summary step, then the cap cut it');

  const values = { capUsd: 0.25, destination: w.dest, askWaits: { 4: '30m' } };
  const sig = JSON.parse(readFileSync(path.join(flowDir, 'signature.json'), 'utf8')).flow;
  const hash = valuesHash({ flow: 'job2', flowSignatureHash: sig, runId: 'run-1', version: 1, values });
  const signed = writeRunValues(runDir, { flow: 'job2', flowSignatureHash: sig, runId: 'run-1', version: 1, values, hash, signedBy: 'hamr', at: '2026-10-06T00:00:00Z' });
  assert.equal(signed.ok, true, signed.ok ? '' : signed.red);

  await continueRun(args);
  const leg2 = nums().slice(leg1.length);
  assert.ok(leg2.length > 0, 'the continue leg ran tries');
  assert.deepEqual(leg2, leg2.map((_, i) => Math.max(...leg1) + 1 + i), `leg 2 tries are numbered after leg 1's (got ${JSON.stringify(nums())})`);
  assert.equal(new Set(nums()).size, nums().length, 'no try number is used twice in the step');
  assert.equal(leg2.length, 3, 'the try limit is unchanged: the continue leg gets the same 3 tries it gets today');
});
