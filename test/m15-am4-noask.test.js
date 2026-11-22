// M15 amendment 4 (docs/wiki/the-module-ladder.md): a job with no signed Ask writes every line, and the stop before the write shows that whole body and Accept binds its sha256.
// One test per Must-fail line. Real runFlow / resumeRun / answerAsk, fake modelStep, $0.
//   1. a no-Ask job's report leaves out a work line's section
//   2. the written body differs from the body Accept bound
//   3. any job with an Ask writes a different report than today
//   4. a no-Ask job writes an empty body when a line's output is missing or unreadable (the red names the step, never starts with `ask: `)
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, existsSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep, readAsk } from '../src/runner.js';
import { answerAsk, sha256Hex, serializeArtifact } from '../src/ask.js';
import { sendViaPrimitive } from '../src/send.js';
import { sendBodyOf, reportContextOf } from '../src/whole-job.js';
import { SEND_DIR } from './send-sandbox.js';

const CATALOGUE = loadCatalogue().primitives;
const shipped = () => (existsSync(SEND_DIR) ? readdirSync(SEND_DIR) : []);
const clean = () => { for (const f of shipped()) rmSync(path.join(SEND_DIR, f), { force: true }); };
const root = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m15am4-'));
const step = (goal, fromLine, emits, reads, primitives = []) => ({ goal, primitives, reads, emits, fromLine, close: { class: 'hitl' } });
const modelStep = async (ctx) => {
  if (ctx.goal === 'Write the note') return { ok: true, costUsd: 0.001, artifact: { text: 'NOTE ONE', done: true } };
  if (ctx.goal === 'Tidy the note') return { ok: true, costUsd: 0.001, artifact: { text: 'NOTE TIDY', done: true } };
  throw new Error(`unexpected goal: ${ctx.goal}`);
};
const args = (r, runId, extra = {}) => ({ root: r, name: 'j', runId, catalogue: CATALOGUE, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-20', sources: [], ...extra });
const sign = (r, prose, steps) => {
  const w = writeFlow({ root: r, name: 'j', proseText: prose, declaration: { guardrailClasses: {}, unjudgeable: {}, refused: [], inputFacts: {}, steps }, signedBy: 'hamr', signedAt: '2026-11-20T10:00:00Z', catalogue: CATALOGUE });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
};
const ARB = `\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $1 per run\nguardrail: send at line N to file:${SEND_DIR}\n`;
const NOASK = `1. Write the note\n2. Tidy the note\n3. Write it out\n${ARB.replace('line N', 'line 3')}`;
const NOASK_STEPS = [step('Write the note', 1, 'n1', [], ['read']), step('Tidy the note', 2, 'n2', ['n1'], ['read']), step('Write it out', 3, 'out', ['n2'], ['write'])];
const SAME = `1. Write the note\n2. ask 30m: look at the note\n3. Write it out\n${ARB.replace('line N', 'line 3')}`;
const SAME_STEPS = [step('Write the note', 1, 'n1', [], ['read']), step('look at the note', 2, 'a1', ['n1']), step('Write it out', 3, 'out', ['a1'], ['write'])];
const bodyOfFile = (f) => readFileSync(path.join(SEND_DIR, f), 'utf8').split('\n').slice(3).join('\n');

test('Must-fail 1: the stop shows every work line\'s section, and the file writes them', async () => {
  const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
  const p1 = await runFlow(args(r, 'am4-1', { askStep: makeParkingAskStep() }));
  assert.equal(p1.outcome, 'paused', p1.red);
  const shown = readAsk(p1.runDir).evidence.artifact;
  assert.match(shown.text, /## 1\. Write the note[\s\S]*NOTE ONE/);
  assert.match(shown.text, /## 2\. Tidy the note[\s\S]*NOTE TIDY/);
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const res = await resumeRun(args(r, 'am4-1'));
  assert.equal(res.outcome, 'complete', res.red);
  const file = readFileSync(path.join(SEND_DIR, shipped()[0]), 'utf8');
  assert.match(file, /## 1\. Write the note[\s\S]*NOTE ONE/);
  assert.match(file, /## 2\. Tidy the note[\s\S]*NOTE TIDY/);
  clean();
});

test('Must-fail 2: the written body is the body Accept bound (same sha256), byte for byte', async () => {
  const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
  const p1 = await runFlow(args(r, 'am4-2', { askStep: makeParkingAskStep() }));
  const shown = readAsk(p1.runDir).evidence.artifact;
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const res = await resumeRun(args(r, 'am4-2'));
  assert.equal(res.outcome, 'complete', res.red);
  const written = readFileSync(path.join(SEND_DIR, shipped()[0]), 'utf8');
  const body = written.slice(written.indexOf('\n\n') + 2, -1); // the file is the title and the Passed line, a blank line, the body, one newline (reportFileText)
  assert.equal(body, shown.text, 'the written body is the shown body');
  assert.equal(sha256Hex(serializeArtifact({ text: body })), sha256Hex(serializeArtifact(shown)), 'and its sha256 is the one Accept bound');
  clean();
});

test('Must-fail 2: a work line changed on disk after the Accept is refused by sha, nothing written', async () => {
  const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
  const p1 = await runFlow(args(r, 'am4-2b', { askStep: makeParkingAskStep() }));
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const f = path.join(p1.runDir, 'artifacts', 'n1.json'); // an EARLIER line, not the one before the write
  writeFileSync(f, readFileSync(f, 'utf8').replace('NOTE ONE', 'NOTE ONX'));
  const res = await resumeRun(args(r, 'am4-2b'));
  assert.equal(res.outcome, 'red');
  assert.match(res.red, /changed after it was accepted/);
  assert.deepEqual(shipped(), []);
});

test('Must-fail 3: a job with an Ask writes the report it wrote before (the accepted whole-job text, exactly)', async () => {
  const r = root(); clean(); sign(r, SAME, SAME_STEPS);
  const p1 = await runFlow(args(r, 'am4-3', { askStep: makeParkingAskStep() }));
  assert.equal(answerAsk({ runDir: p1.runDir, askId: p1.askId, decision: 'accept' }).ok, true);
  const res = await resumeRun(args(r, 'am4-3'));
  assert.equal(res.outcome, 'complete', res.red);
  assert.equal(bodyOfFile(shipped()[0]), '## 1. Write the note\n\n### The AI\'s answer (not checked — you judge it at Accept)\nNOTE ONE\n');
  clean();
});

test('Must-fail 3 (unit): a plan with an Ask but no whole-job Ask sends the step before the write only, as today', () => {
  const steps = [step('Write the note', 1, 'n1', [], ['read']), step('Tidy the note', 2, 'n2', ['n1'], ['read']), step('look', 3, 'a1', ['n2']), step('Write it out', 4, 'out', ['a1'], ['write'])];
  const lines = [{ n: 1, text: 'Write the note' }, { n: 2, text: 'Tidy the note' }];
  const context = reportContextOf({ runDir: root(), steps, jobLines: lines, checkList: undefined });
  const b = sendBodyOf({ content: { text: 'NOTE TIDY' }, wholeIdx: -1, steps, sendIndex: 3, askLines: new Map([[3, { line: 3 }]]), context });
  assert.equal(b.ok, true);
  assert.ok(!b.body.includes('## 1.'), 'the earlier line is not in a pre-am9 Ask job body');
});

test('Must-fail 4: a no-Ask line\'s saved output missing or unreadable stops the write with a red naming the step; never an empty body, never `ask: `', async () => {
  for (const [id, mangle] of [['am4-4a', (f) => rmSync(f)], ['am4-4b', (f) => writeFileSync(f, '{not json')]]) {
    const r = root(); clean(); sign(r, NOASK, NOASK_STEPS);
    // step 2 spoils step 1's saved output while the run is in flight (the resume gate refuses a missing earlier output before any fold, so this is the in-process path)
    const spoil = async (ctx) => {
      const out = await modelStep(ctx);
      if (ctx.goal === 'Tidy the note') mangle(readdirSync(r, { recursive: true }).map((x) => path.join(r, x)).find((x) => x.endsWith(`${id}${path.sep}artifacts${path.sep}n1.json`)));
      return out;
    };
    const res = await runFlow(args(r, id, { modelStep: spoil, askStep: makeParkingAskStep() }));
    assert.equal(res.outcome, 'red', res.red);
    assert.match(res.red, /Write the note/);
    assert.ok(!res.red.startsWith('ask: '), res.red);
    assert.deepEqual(shipped(), [], 'nothing written');
  }
});
