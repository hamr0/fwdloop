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
  existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync,
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

// ---------------------------------------------------------------------------
// F45 finding 1: an M2-era ask.json (no askId/expiresAt) must never show as
// "open" — inbox has no way to answer it, so it's reported "legacy", not a
// fabricated NaN countdown. A malformed ask.json must not crash inbox either.
// ---------------------------------------------------------------------------

test('cli: inbox shows a legacy (M2-era) ask.json as "legacy", never "open"/NaN', async () => {
  const root = tmpRoot('inbox-legacy');
  writeJob2Flow(root);
  // An M2-era ask.json: question/evidence/askedAt/attempt, no askId/expiresAt.
  const legacyRunDir = path.join(root, 'job2', 'runs', 'legacy-run-1');
  mkdirSync(legacyRunDir, { recursive: true });
  writeFileSync(path.join(legacyRunDir, 'ask.json'), JSON.stringify({
    question: 'check it with me,', evidence: { text: 'a draft' }, askedAt: '2026-09-24T13:23:36.913Z', attempt: 1,
  }, null, 2));

  const result = runCli(['inbox', '--root', root], fakeModelEnv());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /run=legacy-run-1 \[legacy \(not answerable\)\]/);
  assert.doesNotMatch(result.stdout, /\[open\]/);
  assert.doesNotMatch(result.stdout, /NaN/);
});

test('cli: inbox names an unparseable ask.json as unreadable, never crashes', async () => {
  const root = tmpRoot('inbox-unreadable');
  writeJob2Flow(root);
  const badRunDir = path.join(root, 'job2', 'runs', 'bad-run-1');
  mkdirSync(badRunDir, { recursive: true });
  writeFileSync(path.join(badRunDir, 'ask.json'), '{ not valid json');

  const result = runCli(['inbox', '--root', root], fakeModelEnv());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /run=bad-run-1 \[unreadable\]/);
});

// ---------------------------------------------------------------------------
// Debrief fix: a present-but-unparseable ask.json "expiresAt" (Date.parse ->
// NaN) must never show as [open] with a "NaNs left" countdown — `inbox`
// shows it [unreadable], naming the run.
// ---------------------------------------------------------------------------

test('cli: inbox shows an ask.json with a garbage (unparseable) expiresAt as [unreadable], never [open], never a NaN countdown', async () => {
  const root = tmpRoot('inbox-bad-expiry');
  writeJob2Flow(root);
  const badRunDir = path.join(root, 'job2', 'runs', 'bad-expiry-run-1');
  mkdirSync(badRunDir, { recursive: true });
  writeFileSync(path.join(badRunDir, 'ask.json'), JSON.stringify({
    askId: 'ask-1', question: 'check it with me,', evidence: { text: 'a draft' }, askedAt: '2026-09-24T13:23:36.913Z', expiresAt: 'not-a-real-date',
  }, null, 2));

  const result = runCli(['inbox', '--root', root], fakeModelEnv());
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /run=bad-expiry-run-1 \[unreadable\]/);
  assert.doesNotMatch(result.stdout, /\[open\]/);
  assert.doesNotMatch(result.stdout, /NaN/);
});

// ---------------------------------------------------------------------------
// F45 finding 2: `fwdloop show <askId>` is how a human sees what they'd be
// accepting — the evidence carried on a parked ask.json.
// ---------------------------------------------------------------------------

test('cli: show prints the parked ask\'s question, expiry, and the artifact text under review', async () => {
  const root = tmpRoot('show');
  writeJob2Flow(root);
  const srcDir = tmpRoot('show-src');
  const { resume, jd } = writeSources(srcDir);

  const runResult = runCli([
    'run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1',
  ], fakeModelEnv());
  assert.equal(runResult.status, 0, runResult.stderr || runResult.stdout);
  const askId = extractAskId(runResult.stdout);

  const showResult = runCli(['show', askId, '--root', root], fakeModelEnv());
  assert.equal(showResult.status, 0, showResult.stderr || showResult.stdout);
  assert.match(showResult.stdout, /question: check it with me,/);
  assert.match(showResult.stdout, /expiresAt: \S+/);
  assert.match(showResult.stdout, /summary of work history blurb/, 'the artifact under review must be printed');
  assert.match(showResult.stdout, /resume text/, 'an unjudged pre-ask artifact must be printed, labelled by step');
});

// ---------------------------------------------------------------------------
// Path-escape fix: `--run-id` (and `resume`'s runId positional) go through
// `resolveRunDir` before any run dir is touched. `../../../../tmp/pwned`
// must never escape the flow's own `runs/` directory.
// ---------------------------------------------------------------------------

test('cli: run refuses a path-escaping --run-id, at $0, before writing anything under the escape target', async () => {
  const root = tmpRoot('run-id-escape');
  writeJob2Flow(root);
  const srcDir = tmpRoot('run-id-escape-src');
  const { resume, jd } = writeSources(srcDir);
  const escapeTarget = path.join(tmpdir(), 'fwdloop-pwned-marker');

  const result = runCli([
    'run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', '../../../../tmp/pwned',
  ], fakeModelEnv());

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runId/);
  assert.equal(existsSync(escapeTarget), false, 'the escaping runId must never have created anything outside runs/');
  assert.equal(existsSync(path.join(root, 'job2', 'runs', 'pwned')), false);
});

const runIdEscapes = ['../x', 'a/b', '..', '', '/abs/path'];

for (const badRunId of runIdEscapes) {
  test(`cli: run refuses --run-id ${JSON.stringify(badRunId)}`, async () => {
    const root = tmpRoot('run-id-bad');
    writeJob2Flow(root);
    const srcDir = tmpRoot('run-id-bad-src');
    const { resume, jd } = writeSources(srcDir);

    const args = ['run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`];
    if (badRunId !== '') args.push('--run-id', badRunId);
    else args.push('--run-id', '');

    const result = runCli(args, fakeModelEnv());
    assert.notEqual(result.status, 0, `expected --run-id ${JSON.stringify(badRunId)} to be refused`);
  });
}

test('cli: run accepts a valid --run-id and parks normally (control case)', async () => {
  const root = tmpRoot('run-id-good');
  writeJob2Flow(root);
  const srcDir = tmpRoot('run-id-good-src');
  const { resume, jd } = writeSources(srcDir);

  const result = runCli([
    'run', 'job2', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'a-Valid.run_1',
  ], fakeModelEnv());

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /parked: askId=\S+/);
  assert.equal(existsSync(path.join(root, 'job2', 'runs', 'a-Valid.run_1')), true);
});

test('cli: resume refuses a path-escaping runId positional', async () => {
  const root = tmpRoot('resume-id-escape');
  writeJob2Flow(root);

  const result = runCli(['resume', '../../../../tmp/pwned', '--flow', 'job2', '--root', root], fakeModelEnv());
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /runId/);
});

// ---------------------------------------------------------------------------
// F46 (docs/logs/FINDINGS.md): a step whose declaration grants a verb the
// runner has no wired implementation for must refuse the run at preflight,
// naming the step and the verb, before any model call or spend — never a
// warning the run continues past.
// ---------------------------------------------------------------------------

test('cli: run refuses at preflight when a step grants an unwired verb (litectx\'s "compress"), naming the step and the verb, at $0', async () => {
  const root = tmpRoot('unwired-verb');
  // job #2's real signed shape (F46): the draft step grants "compress",
  // catalogue-present but never wired by resolvePrimitives. Signed directly
  // via writeFlow (not the shared fixture file) so the signature actually
  // matches — editing declaration.json after signing would just trip the
  // (unrelated) signature-mismatch check instead of this one.
  const base = fixture('job2-with-sources.signed.txt');
  const declaration = fixtureJson('job2.m1.declaration.json');
  const draftStep = declaration.steps.find((s) => s.emits === 'resume-summary');
  assert.ok(draftStep, 'expected a "resume-summary" step');
  draftStep.primitives = ['compress'];
  const written = writeFlow({
    root,
    name: 'job2-unwired',
    proseText: base,
    declaration,
    signedBy: 'hamr',
    signedAt: '2026-09-25T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));

  const srcDir = tmpRoot('unwired-verb-src');
  const { resume, jd } = writeSources(srcDir);

  const result = runCli([
    'run', 'job2-unwired', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1',
  ], fakeModelEnv());

  assert.notEqual(result.status, 0, result.stdout);
  assert.match(result.stderr, /resume-summary/, 'the refusal must name the step');
  assert.match(result.stderr, /"compress"/, 'the refusal must name the verb');
  assert.match(result.stderr, /no wired implementation/);
  assert.equal(existsSync(path.join(root, 'job2-unwired', 'runs', 'run-1')), false, 'no run dir may exist — refused before any run dir was created');
  // The refusal now lives in `runFlow` itself (F46, moved from bin/fwdloop so
  // any caller gets it — see src/runner.js's `findUnwiredVerbStep`), which
  // records it the same way every other preflight refusal is recorded: one
  // history row, $0, `spendComplete: true` — never a silent CLI-only exit.
  const historyPath = path.join(root, 'job2-unwired', 'history.jsonl');
  assert.equal(existsSync(historyPath), true, 'a preflight refusal is still one history row, same as any other');
  const rows = readFileSync(historyPath, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].outcome, 'preflight-red');
  assert.equal(rows[0].spentUsd, 0);
  assert.equal(rows[0].spendComplete, true);
});

test('cli: run with only wired verbs still runs (control case for the F46 preflight refusal)', async () => {
  const root = tmpRoot('wired-verbs');
  writeJob2Flow(root, { name: 'job2-wired' });
  const srcDir = tmpRoot('wired-verbs-src');
  const { resume, jd } = writeSources(srcDir);

  const result = runCli([
    'run', 'job2-wired', '--root', root, '--source', `resume=${resume}`, '--source', `jd=${jd}`, '--run-id', 'run-1',
  ], fakeModelEnv());

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, /parked: askId=\S+/);
});
