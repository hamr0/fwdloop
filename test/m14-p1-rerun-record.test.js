// M14 am1 item 1 (docs/wiki/the-module-ladder.md, "M14 amendment 1"): a rerun keeps its reason in its OWN run.json - the decision, the human's words and the step
// the old run's ask followed - written by the one writer (`writeRunStart`); no new file. $0, fake modelStep.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { readdirSync } from 'node:fs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-25T12:00:00Z';
const BUSINESS_DATE = '2026-06-01';

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-${prefix}-`));
}

function writeTempFile(dir, name, text) {
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
}

function writeSources(srcDir) {
  const resume = writeTempFile(srcDir, 'resume.docx', 'Resume text goes here.');
  const jd = writeTempFile(srcDir, 'jd.md', 'JD text goes here.');
  return [{ id: 'resume', path: resume }, { id: 'jd', path: jd }];
}

function writeJob2Flow(root, { name = 'job2' } = {}) {
  const result = writeFlow({
    root,
    name,
    proseText: sandboxSend(fixture('job2-with-sources.signed.txt')),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

/** Fake modelStep for job #2's three model-backed steps. Records every call
 *  (goal + gap) in order, so a test can prove which gap a specific attempt
 *  actually saw — the mechanism under test (M3 scope item 7: "the reason
 *  carried as the first step's starting gap"). */
function makeJob2ModelStep() {
  const calls = { 'resume-text': 0, 'jd-text': 0, 'resume-summary': 0 };
  const callLog = [];
  const fn = async (ctx) => {
    callLog.push({ goal: ctx.goal, gap: ctx.gap });
    if (ctx.goal.includes('resume .docx')) {
      calls['resume-text'] += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    }
    if (ctx.goal.includes('job description markdown')) {
      calls['jd-text'] += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    }
    if (ctx.goal.includes('Draft the summary resume')) {
      calls['resume-summary'] += 1;
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected job2 goal: ${ctx.goal}`);
  };
  return { fn, calls, callLog };
}

const NOOP_SEND = async (target, filename, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });

function baseRunArgs({
  root, name = 'job2', runId = 'run-1', modelStep, askStep, clock,
}) {
  return {
    root,
    name,
    runId,
    catalogue: CATALOGUE,
    modelStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
    ...(askStep ? { askStep } : {}),
    ...(clock ? { clock } : {}),
  };
}


const parkJob2 = async () => {
  const root = tmpRoot('m14-p1');
  writeJob2Flow(root);
  const { fn } = makeJob2ModelStep();
  const parked = await runFlow({ ...baseRunArgs({ root, modelStep: fn, askStep: makeParkingAskStep() }), sources: writeSources(tmpRoot('m14-p1-src')) });
  assert.equal(parked.outcome, 'paused', parked.red);
  return { root, parked };
};
const names = (dir, rel = '') => readdirSync(path.join(dir, rel), { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? names(dir, path.join(rel, e.name)) : [path.join(rel, e.name)])).sort();
const runJson = (dir) => JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8'));

test('a rerun keeps decision, words and the step name its old ask followed in its own run.json; a fresh run has no rerun key', async () => {
  const { root, parked } = await parkJob2();
  assert.equal('rerun' in runJson(parked.runDir), false, 'a fresh run has no rerun section');
  const ask = JSON.parse(readFileSync(path.join(parked.runDir, 'asks', `${parked.askId}.json`), 'utf8'));
  assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'rerun', reason: 'wrong answer' }).ok, true);
  const resumed = await resumeRun(baseRunArgs({ root, modelStep: makeJob2ModelStep().fn }));
  assert.equal(resumed.outcome, 'rerun', resumed.red);
  const rec = runJson(path.join(root, 'job2', 'runs', 'run-1-rerun-1'));
  assert.deepEqual(rec.rerun, { decision: 'rerun', words: 'wrong answer', afterStep: 'resume-summary' });
  assert.ok(ask.emits && ask.emits !== 'resume-summary', 'the ask is its own step, after the named one');
  assert.ok(Array.isArray(rec.inputs) && typeof rec.thinking === 'boolean', 'the other sections are untouched');
});

test('the rerun section survives the rerun\'s own park and resume, byte for byte, and adds no new file', async () => {
  const { root, parked } = await parkJob2();
  assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'rerun', reason: 'wrong answer' }).ok, true);
  const resumed = await resumeRun(baseRunArgs({ root, modelStep: makeJob2ModelStep().fn }));
  const newDir = path.join(root, 'job2', 'runs', 'run-1-rerun-1');
  assert.equal(resumed.newRun.outcome, 'paused', resumed.newRun.red);
  const before = readFileSync(path.join(newDir, 'run.json'), 'utf8');
  const filesBefore = names(newDir).filter((n) => !/^asks[\\/]/.test(n));
  assert.equal(answerAsk({ runDir: newDir, askId: resumed.newRun.askId, decision: 'accept' }).ok, true);
  const again = await resumeRun(baseRunArgs({ root, runId: 'run-1-rerun-1', modelStep: makeJob2ModelStep().fn }));
  assert.equal(again.outcome, 'complete', again.red);
  assert.equal(readFileSync(path.join(newDir, 'run.json'), 'utf8'), before);
  assert.equal(JSON.parse(before).rerun.words, 'wrong answer');
  const added = names(newDir).filter((n) => !filesBefore.includes(n) && !/^asks[\\/]/.test(n));
  assert.ok(!added.some((n) => /rerun|reason|memo/i.test(n)), `no new rerun file: ${added.join(', ')}`);
});
