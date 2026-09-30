// Tests for M4b amendment 3 (docs/wiki/the-module-ladder.md, "M4b amendment 3
// — the word is "redo" everywhere ... — SIGNED by hamr 2026-09-30"),
// negatives (xii)-(xvii). $0: the CLI is the real `bin/fwdloop` with its
// test-only fake model step; the library/panel-data tests use no provider.
// The panel-POST half of (xii) lives in test/panel-resume.test.js (its
// happy-path test), which drives the real panel server + real resume child.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, readdirSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow, appendAudit, appendHistory } from '../src/index.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk, normalizeDecision } from '../src/ask.js';
import {
  computeGlyph, getRunDetail, listRuns, listStops, getRunAsks,
} from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_MODEL_STEP = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const tmpRoot = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-redo-${p}-`));
const sha = (f) => createHash('sha256').update(readFileSync(f)).digest('hex');
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));
const jsonl = (f) => readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));

function writeJob2Flow(root, name = 'job2') {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: 'hamr',
    signedAt: '2026-09-25T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

function writeSources(srcDir) {
  const resume = path.join(srcDir, 'resume.docx');
  const jd = path.join(srcDir, 'jd.md');
  writeFileSync(resume, 'Resume text goes here.');
  writeFileSync(jd, 'JD text goes here.');
  return { resume, jd };
}

const cliEnv = () => ({
  PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP,
});
const cli = (args) => spawnSync(process.execPath, [BIN, ...args], { env: cliEnv(), encoding: 'utf8', timeout: 20_000 });

/** Park a job2 run through the CLI; returns { root, runDir, askId }. */
function cliParked(prefix) {
  const root = tmpRoot(prefix);
  writeJob2Flow(root);
  const { resume, jd } = writeSources(tmpRoot(`${prefix}-src`));
  const r = cli(['run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1']);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  const askId = /askId=(\S+)/.exec(r.stdout)[1];
  return { root, runDir: path.join(root, 'job2', 'runs', 'run-1'), askId };
}

/** After the answer: resume, and prove the step before the ask was redone with
 *  the reason as the human's gap and the run re-parked under a NEW ask. */
function assertRedone({ root, runDir, askId }, reason) {
  const consumed = path.join(runDir, `answer.${askId}.consumed.json`);
  const before = readJson(path.join(runDir, 'answer.json'));
  assert.equal(before.decision, 'redo', 'the saved answer says redo');
  const res = cli(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  assert.equal(res.status, 0, res.stderr || res.stdout);
  assert.match(res.stdout, /parked: askId=/, 're-parked at a new ask');
  assert.notEqual(/askId=(\S+)/.exec(res.stdout)[1], askId);
  assert.equal(readJson(consumed).decision, 'redo', 'the consumed answer on disk says redo');
  const rows = jsonl(path.join(runDir, 'audit.jsonl'));
  assert.ok(rows.some((r) => r.class === 'hitl' && r.verdict === 'red' && r.gap === reason), 'the human redo is audited with its reason');
  const summaryTries = rows.filter((r) => r.step === 'resume-summary' && r.class !== 'hitl' && r.verdict === 'green');
  assert.equal(summaryTries.length, 2, 'the step before the ask ran again');
}

// (xii) CLI half
test('(xii) CLI: `answer redo "<reason>"` redoes the step before the ask; the consumed answer says redo', () => {
  const run = cliParked('xii');
  const a = cli(['answer', run.askId, 'redo', 'tighten the skills section', '--root', run.root]);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.match(a.stdout, /decision=redo/);
  assertRedone(run, 'tighten the skills section');
});

// (xiii)
test('(xiii) CLI: the old word `reject` does the same thing and is recorded as redo', () => {
  const run = cliParked('xiii');
  const a = cli(['answer', run.askId, 'reject', 'tighten the skills section', '--root', run.root]);
  assert.equal(a.status, 0, a.stderr || a.stdout);
  assert.match(a.stdout, /decision=redo/);
  assertRedone(run, 'tighten the skills section');
});

// (xv)
test('(xv) a blank reason on redo is refused by name; the refusal says redo, never reject (library, CLI, and the old word)', () => {
  const run = cliParked('xv');
  for (const word of ['redo', 'reject']) {
    const lib = answerAsk({ runDir: run.runDir, askId: run.askId, decision: word, reason: '   ' });
    assert.equal(lib.ok, false);
    assert.match(lib.red, /needs a non-blank reason to redo/);
    assert.doesNotMatch(lib.red, /reject/i);
    const c = cli(['answer', run.askId, word, '--root', run.root]);
    assert.notEqual(c.status, 0);
    assert.match(c.stderr, /needs a non-blank reason to redo/);
    assert.doesNotMatch(c.stderr, /reject/i);
  }
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), false, 'nothing written');
  const bad = answerAsk({ runDir: run.runDir, askId: run.askId, decision: 'banana', reason: 'x' });
  assert.match(bad.red, /unrecognised decision "banana"/);
  const help = cli(['answer', run.askId, '--root', run.root]);
  assert.match(help.stderr, /accept\|redo\|rerun/);
});

test('normalizeDecision: reject -> redo; accept/redo/rerun pass; anything else is returned unchanged', () => {
  assert.equal(normalizeDecision('reject'), 'redo');
  for (const d of ['accept', 'redo', 'rerun', 'banana', undefined]) assert.equal(normalizeDecision(d), d);
});
