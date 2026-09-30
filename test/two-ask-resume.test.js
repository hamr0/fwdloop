// M4b piece 3 follow-up: an ask accepted in an EARLIER process must keep its
// recorded accept hash. Each answer of a two-ask flow is resumed in its own
// `resumeRun` call (the panel starts a new process per answer), and the send
// at the end ships ask 1's artifact. The hash was recorded at ask 1's accept
// (`answerAsk` is its only writer); the runner must read it back from disk,
// never recompute it from the current artifact file. $0 — fake modelStep.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, rmSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SEND_DIR = path.join(HERE, '..', 'poc', 'm0', 'out');
const sha256OfBytes = (buf) => createHash('sha256').update(buf).digest('hex');
const shippedFiles = (runId) => (existsSync(SEND_DIR) ? readdirSync(SEND_DIR).filter((f) => f.startsWith(`${runId}-`)) : []);
const cleanShipped = (runId) => { for (const f of shippedFiles(runId)) rmSync(path.join(SEND_DIR, f), { force: true }); };

// job #2's prose with a SECOND ask inserted at line 5; the send (line 6) ships
// the artifact accepted at ASK 1 (`resume-summary-approved`).
const TWO_ASK_PROSE = fixture('job2-with-sources.signed.txt')
  .replace('5. and once I accept, write it out.', '5. ask: one more look before it goes,\n6. and once I accept, write it out.')
  .replace('send at line 5', 'send at line 6');
assert.ok(TWO_ASK_PROSE.includes('5. ask: one more look'), 'fixture anchor moved');

const declaration = JSON.parse(fixture('job2.m1.declaration.json'));
const send = declaration.steps.pop();
send.fromLine = 6;
send.reads = ['resume-summary-approved'];
declaration.steps.push({
  goal: 'Show the summary again and pause until the human accepts it a second time; nothing is written out before that.',
  primitives: [],
  reads: ['resume-summary-approved'],
  emits: 'resume-summary-final',
  fromLine: 5,
  close: { class: 'hitl' },
}, send);

const SUMMARY = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const modelStep = async (ctx) => {
  if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
  if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
  if (ctx.goal.includes('Draft the summary resume')) return { ok: true, costUsd: 0.001, artifact: { text: SUMMARY, done: true } };
  throw new Error(`unexpected goal: ${ctx.goal}`);
};

const tmpRoot = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-${p}-`));
function baseArgs(root, runId) {
  return {
    root, name: 'job2', runId, catalogue: CATALOGUE, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01',
  };
}

/** Park at ask 1, accept it, resume (process 2) to park at ask 2, accept it,
 *  leaving the LAST resume (process 3, the one that sends) to the caller. */
async function twoAskUntilLastResume(runId) {
  const root = tmpRoot(runId);
  const w = writeFlow({
    root, name: 'job2', proseText: TWO_ASK_PROSE, declaration, signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const srcDir = tmpRoot(`${runId}-src`);
  writeFileSync(path.join(srcDir, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(srcDir, 'jd.md'), 'JD text goes here.');
  const parked1 = await runFlow({
    ...baseArgs(root, runId),
    askStep: makeParkingAskStep(),
    sources: [{ id: 'resume', path: path.join(srcDir, 'resume.docx') }, { id: 'jd', path: path.join(srcDir, 'jd.md') }],
  });
  assert.equal(parked1.outcome, 'paused', parked1.red);
  const { runDir } = parked1;
  assert.equal(answerAsk({ runDir, askId: parked1.askId, decision: 'accept' }).ok, true);
  const recordedAtAsk1 = JSON.parse(readFileSync(path.join(runDir, 'answer.json'), 'utf8')).artifactSha256;
  const parked2 = await resumeRun(baseArgs(root, runId));
  assert.equal(parked2.outcome, 'paused', parked2.red);
  assert.notEqual(parked2.askId, parked1.askId);
  assert.equal(answerAsk({ runDir, askId: parked2.askId, decision: 'accept' }).ok, true);
  return {
    root, runDir, recordedAtAsk1, approvedFile: path.join(runDir, 'artifacts', 'resume-summary-approved.json'),
  };
}

test('M4b p3 follow-up: ask 1 accepted in an earlier process still ships after later resumes — bytes match the hash recorded at ask 1', async () => {
  const runId = 'twoask-earlier-accept';
  cleanShipped(runId);
  try {
    const a = await twoAskUntilLastResume(runId);
    assert.match(a.recordedAtAsk1, /^[0-9a-f]{64}$/);
    const done = await resumeRun(baseArgs(a.root, runId));
    assert.equal(done.outcome, 'complete', done.red);
    const files = shippedFiles(runId);
    assert.equal(files.length, 1, `shipped: ${files}`);
    assert.equal(sha256OfBytes(readFileSync(path.join(SEND_DIR, files[0]))), a.recordedAtAsk1);
  } finally { cleanShipped(runId); }
});

test('M4b p3 follow-up: ask 1\'s artifact edited by one byte after its accept is still refused at send (earlier-process accept)', async () => {
  const runId = 'twoask-earlier-tamper';
  cleanShipped(runId);
  try {
    const a = await twoAskUntilLastResume(runId);
    const before = readFileSync(a.approvedFile, 'utf8');
    assert.ok(before.includes('worked places'));
    writeFileSync(a.approvedFile, before.replace('worked places', 'worked placeS'));
    const res = await resumeRun(baseArgs(a.root, runId));
    assert.equal(res.outcome, 'red');
    assert.match(res.red, /the artifact changed after it was accepted/);
    assert.deepEqual(shippedFiles(runId), [], 'nothing may reach the destination');
  } finally { cleanShipped(runId); }
});
