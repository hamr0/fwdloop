// Tests for M3 piece 2 (docs/wiki/the-module-ladder.md, "M3 — scope, exit,
// negative — SIGNED", scope item 9): `bin/fwdloop`, spawned as a real child
// process (never imported/called in-process — a CLI's own argv/exit-code/
// stdio contract can only be proven by actually running it). Every scenario
// drives the CLI's test-only fake-model escape hatch
// (`NODE_ENV=test` + `FWDLOOP_TEST_MODEL_STEP=<module path>`, see
// `bin/fwdloop`'s `resolveModelStep`) — the spawned child's own `env` is
// built from scratch (never `...process.env`), so a real `DEEPSEEK_API_KEY`
// sitting in this shell can never leak into a test and no test can ever
// reach a paid provider even by accident.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_MODEL_STEP = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-cli-${prefix}-`));
}

/** Minimal env for a spawned CLI child — built from scratch, never a spread
 *  of this process's own `process.env`, so a real provider key sitting in
 *  the dev shell can never leak into (or rescue) a test. */
function fakeModelEnv(extra = {}) {
  return {
    PATH: process.env.PATH ?? '',
    ...extra,
    NODE_ENV: 'test',
    FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP,
  };
}

/** For the "no key" scenario: deliberately NO NODE_ENV/FWDLOOP_TEST_MODEL_STEP
 *  and no DEEPSEEK_API_KEY — proves the CLI's live path really refuses. */
function noKeyEnv() {
  return { PATH: process.env.PATH ?? '' };
}

function runCli(args, env) {
  const result = spawnSync(process.execPath, [BIN, ...args], {
    env, encoding: 'utf8', timeout: 15_000,
  });
  return result;
}

function writeSources(srcDir) {
  const resume = path.join(srcDir, 'resume.docx');
  const jd = path.join(srcDir, 'jd.md');
  writeFileSync(resume, 'Resume text goes here.');
  writeFileSync(jd, 'JD text goes here.');
  return { resume, jd };
}

function writeJob2Flow(root, { name = 'job2', askMark = 'ask:' } = {}) {
  const base = fixture('job2-with-sources.signed.txt');
  assert.ok(base.includes('4. ask: check it with me,'), 'fixture line 4 must still read "ask: check it with me,"');
  const proseText = base.replace('4. ask: check it with me,', `4. ${askMark} check it with me,`);
  const result = writeFlow({
    root,
    name,
    proseText,
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: 'hamr',
    signedAt: '2026-09-25T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

function extractAskId(stdout) {
  const m = /askId=(\S+)/.exec(stdout);
  assert.ok(m, `expected an askId in CLI output, got: ${stdout}`);
  return m[1];
}

// ---------------------------------------------------------------------------
// run parks and exits 0, printing the exact `fwdloop answer` command.
// ---------------------------------------------------------------------------

test('cli: run parks and exits 0, printing the askId and the exact answer command', async () => {
  const root = tmpRoot('run-parks');
  writeJob2Flow(root);
  const srcDir = tmpRoot('run-parks-src');
  const { resume, jd } = writeSources(srcDir);

  const result = runCli([
    'run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1',
  ], fakeModelEnv());

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /parked: askId=\S+ expiresAt=\S+ spentUsd=\d/);
  assert.match(result.stdout, /fwdloop answer \S+ accept\|reject "<reason>"\|rerun "<reason>" --root/);
  assert.ok(existsSync(path.join(root, 'job2', 'runs', 'run-1', 'ask.json')));
});

// ---------------------------------------------------------------------------
// inbox lists it; answer accept; resume completes.
// ---------------------------------------------------------------------------

test('cli: inbox lists the open ask, answer accept succeeds, resume completes the run', async () => {
  const root = tmpRoot('inbox-answer-resume');
  writeJob2Flow(root);
  const srcDir = tmpRoot('inbox-answer-resume-src');
  const { resume, jd } = writeSources(srcDir);

  const runResult = runCli([
    'run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1',
  ], fakeModelEnv());
  assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);
  const askId = extractAskId(runResult.stdout);

  const inboxResult = runCli(['inbox', '--root', root], fakeModelEnv());
  assert.equal(inboxResult.status, 0, inboxResult.stderr);
  assert.match(inboxResult.stdout, new RegExp(`${askId}\\s+flow=job2 run=run-1 \\[open\\]`));
  assert.match(inboxResult.stdout, /check it with me/);

  const answerResult = runCli(['answer', askId, 'accept', '--root', root], fakeModelEnv());
  assert.equal(answerResult.status, 0, answerResult.stderr || answerResult.stdout);
  assert.match(answerResult.stdout, new RegExp(`answered: askId=${askId} decision=accept`));

  const resumeResult = runCli(['resume', 'run-1', '--flow', 'job2', '--root', root], fakeModelEnv());
  assert.equal(resumeResult.status, 0, resumeResult.stderr || resumeResult.stdout);
  assert.match(resumeResult.stdout, /complete: spentUsd=\d/);

  const history = readFileSync(path.join(root, 'job2', 'history.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(history[history.length - 1].outcome, 'complete');
});

// ---------------------------------------------------------------------------
// inbox shows an expired ask as expired, never as open.
// ---------------------------------------------------------------------------

test('cli: inbox shows an expired ask as "expired", never "open"', async () => {
  const root = tmpRoot('inbox-expired');
  writeJob2Flow(root, { askMark: 'ask 1s:' });
  const srcDir = tmpRoot('inbox-expired-src');
  const { resume, jd } = writeSources(srcDir);

  const runResult = runCli([
    'run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1',
  ], fakeModelEnv());
  assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);

  // A short real wait past the signed 1s ttl — no clock injection hook
  // exists at the CLI boundary, so this is a real (short, bounded) wait,
  // never a polling loop.
  await new Promise((r) => { setTimeout(r, 1300); });

  const inboxResult = runCli(['inbox', '--root', root], fakeModelEnv());
  assert.equal(inboxResult.status, 0, inboxResult.stderr);
  assert.match(inboxResult.stdout, /\[expired\]/);
  assert.doesNotMatch(inboxResult.stdout, /\[open\]/);
});

// ---------------------------------------------------------------------------
// answer to an unknown askId exits nonzero, naming it.
// ---------------------------------------------------------------------------

test('cli: answer to an unknown askId exits nonzero, naming it', async () => {
  const root = tmpRoot('answer-unknown');
  writeJob2Flow(root);

  const result = runCli(['answer', 'not-a-real-ask-id', 'accept', '--root', root], fakeModelEnv());
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /no open ask found for askId "not-a-real-ask-id"/);
});

// ---------------------------------------------------------------------------
// An unset API key refuses at $0, before any book write.
// ---------------------------------------------------------------------------

test('cli: an unset DEEPSEEK_API_KEY refuses "run" at $0, before any run dir or book row is written', async () => {
  const root = tmpRoot('no-key');
  writeJob2Flow(root);
  const srcDir = tmpRoot('no-key-src');
  const { resume, jd } = writeSources(srcDir);

  const result = runCli([
    'run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-no-key',
  ], noKeyEnv());

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /DEEPSEEK_API_KEY is not set/);
  assert.equal(existsSync(path.join(root, 'job2', 'runs', 'run-no-key')), false, 'no run dir must be created on a key refusal');
  assert.equal(existsSync(path.join(root, 'job2', 'history.jsonl')), false, 'no history row must be written on a key refusal');
});
