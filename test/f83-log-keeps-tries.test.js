// F83 bug 1: a run that is red then green on a step, parks at an ask, is accepted and completes keeps EVERY try in log.json
// (the resume leg used to start a fresh attemptsLog and its end write replaced the file), so the run-end FIXED note has a "What changed".
// $0: fake modelStep, no provider; mkdtemp roots.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { eventsOfRun } from '../src/learnstore.js';
import { writeFileSync } from 'node:fs';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const cat = loadCatalogue();
assert.equal(cat.ok, true);

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.';

test('F83: a resumed run keeps the first leg\'s tries in log.json, and its FIXED note carries a "What changed" diff', async (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-f83-log-'));
  const src = mkdtempSync(path.join(tmpdir(), 'fwdloop-f83-src-'));
  t.after(() => { rmSync(root, { recursive: true, force: true }); rmSync(src, { recursive: true, force: true }); });
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: cat.primitives,
  });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  let summaryCalls = 0;
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) { summaryCalls += 1; return { ok: true, costUsd: 0.001, artifact: { text: summaryCalls === 1 ? BAD : GOOD, done: true } }; }
    throw new Error(`unexpected goal: ${ctx.goal}`);
  };
  const args = { root, name: 'job2', runId: 'run-1', catalogue: cat.primitives, modelStep, sendStep: async () => ({ ok: true, bytes: 2 }), primitives: {}, businessDate: '2026-06-01' };
  const parked = await runFlow({ ...args, askStep: makeParkingAskStep(), sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }] });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.equal(summaryCalls, 2, 'the summary step was red once, then green, before the ask');
  assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' }).ok, true);
  const resumed = await resumeRun(args);
  assert.equal(resumed.outcome, 'complete', resumed.red);

  const log = JSON.parse(readFileSync(path.join(parked.runDir, 'log.json'), 'utf8'));
  const tries = log.attempts.filter((a) => a.step === 'resume-summary');
  assert.deepEqual(tries.map((a) => a.attempt), [1, 2], 'both tries of the first leg survive the resume leg\'s end write');
  assert.ok(tries.every((a) => a.modelOutput !== undefined), 'each try keeps its modelOutput');

  const rec = eventsOfRun(parked.runDir, 'job2');
  const diffs = [];
  let step = null;
  for (const e of rec.events) { if (e.type === 'step-start') step = e.step; if (e.type === 'attempt-diff' && step === 'resume-summary') diffs.push(e.files[0].diff); }
  assert.equal(diffs.length, 2);
  assert.ok(diffs.every((d) => d !== ''), `the summary step's two diffs are non-empty: ${JSON.stringify(diffs.map((d) => d.length))}`);
});
