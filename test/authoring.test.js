// M6a pieces 4-6 — $0 tests for src/authoring.js (`fwdloop draft` / `fwdloop sign`) and the CLI verbs.
// Fake provider only: no key, no network, no paid round.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import {
  draftToDir, signDraft, specHash, sweepForSecrets, scrub, SPEC_HASH_FILE, SIGN_LINE,
} from '../src/authoring.js';
import { readSpendRows } from '../src/provider.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-auth-${p}-`));
const readJson = (f) => JSON.parse(readFileSync(f, 'utf8'));

/** Draft job #2 into a fresh dir with a fake provider; returns everything a test needs. */
async function makeDraft({ replies = [toolReply(validArgs())], extra = {}, prose } = {}) {
  const fx = job2Fixture();
  const work = tmp('w');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, prose ?? fx.prose);
  const provider = fakeProvider(replies);
  const dir = path.join(work, 'draft');
  const root = path.join(work, 'flows');
  const r = await draftToDir({
    proseFile, dir, root, name: 'job2', provider, rates: RATES, modelId: MODEL, env: {}, ...extra,
  });
  return {
    r, dir, root, work, proseFile, provider, fx,
  };
}

test('draft: green draft writes prose(verbatim)/declaration/facts/readout/log/spend/spec.hash and books a priced row', async () => {
  const { r, dir, proseFile } = await makeDraft();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.wrote, true);
  for (const f of ['prose.txt', 'declaration.json', 'input-facts.json', 'readout.txt', 'log.json', 'spend.jsonl', SPEC_HASH_FILE, 'target.json']) {
    assert.ok(existsSync(path.join(dir, f)), `${f} written`);
  }
  assert.equal(readFileSync(path.join(dir, 'prose.txt'), 'utf8'), readFileSync(proseFile, 'utf8'), 'prose is verbatim');
  const rowsBooked = readSpendRows(path.join(dir, 'spend.jsonl'));
  assert.equal(rowsBooked.length, 1);
  assert.ok(rowsBooked[0].costUsd > 0, 'priced');
  assert.equal(rowsBooked[0].kind, 'draft');
  const ro = readFileSync(path.join(dir, 'readout.txt'), 'utf8');
  assert.match(ro, /NOT SIGNED/);
  assert.match(ro, /grants: read/);
  assert.match(ro, /pure stop/);
  assert.match(ro, /line 5 -> file:poc\/m0\/out/);
  assert.match(ro, /cost \$0\./);
  const h = specHash({
    proseText: readFileSync(path.join(dir, 'prose.txt'), 'utf8'),
    declarationText: readFileSync(path.join(dir, 'declaration.json'), 'utf8'),
    inputFactsText: readFileSync(path.join(dir, 'input-facts.json'), 'utf8'),
    readoutText: ro,
  });
  assert.equal(h.hash, r.hash);
  assert.equal(readFileSync(path.join(dir, SPEC_HASH_FILE), 'utf8').trim(), r.hash);
  assert.equal(SIGN_LINE('D', 'H'), 'DRAFTED — NOT SIGNED. To sign: fwdloop sign D --approve H');
});

test('draft: a red draft still writes its dir (reds, cost, booked) but no spec.hash', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const { r, dir } = await makeDraft({ replies: [toolReply(bad)] });
  assert.equal(r.ok, false);
  assert.equal(r.wrote, true);
  assert.equal(r.stop, 'validator');
  assert.ok(!existsSync(path.join(dir, SPEC_HASH_FILE)), 'no spec.hash on a red draft');
  assert.ok(!existsSync(path.join(dir, 'declaration.json')));
  assert.ok(existsSync(path.join(dir, 'declaration.rejected.json')));
  const log = readJson(path.join(dir, 'log.json'));
  assert.ok(log.reds.some((x) => x.includes('"stash"')));
  const rows = readSpendRows(path.join(dir, 'spend.jsonl'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].rounds, 3);
  assert.ok(rows[0].costUsd > 0);
});

test('draft: $0 refusals write nothing and spend nothing (bad key, missing input, unreadable prose, existing dir)', async () => {
  // bad/unset key, live path (no injected provider)
  const fx = job2Fixture();
  const work = tmp('r');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const base = { proseFile, dir: path.join(work, 'd'), root: path.join(work, 'flows'), name: 'job2' };
  for (const env of [{}, { DEEPSEEK_API_KEY: '   ' }, { DEEPSEEK_API_KEY: 'abc\ndef' }]) {
    const r = await draftToDir({ ...base, env });
    assert.equal(r.wrote, false);
    assert.match(r.reds[0], /^key:/);
    assert.ok(!existsSync(base.dir));
  }
  // missing input file
  const p = fakeProvider([toolReply(validArgs())]);
  const gone = path.join(work, 'gone.txt');
  writeFileSync(gone, fx.prose.replace(fx.jd, path.join(work, 'nope.md')));
  let r = await draftToDir({ ...base, proseFile: gone, provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.wrote, false);
  assert.match(r.reds.join(' '), /input "jd"/);
  // unreadable prose
  r = await draftToDir({ ...base, proseFile: path.join(work, 'nope.txt'), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.wrote, false);
  assert.match(r.reds[0], /^prose: cannot read/);
  // existing dir is never overwritten
  writeFileSync(path.join(work, 'exists'), 'x');
  r = await draftToDir({ ...base, dir: path.join(work, 'exists'), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.wrote, false);
  assert.equal(p.calls.length, 0, 'no provider round on any $0 refusal');
});

test('draft: budget exceeded stops, is priced, and is booked', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash']; // never valid -> keeps asking for another round
  const { r, dir, provider } = await makeDraft({ replies: [toolReply(bad)], extra: { budgetUsd: 0.0006 } });
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'budget');
  assert.equal(provider.calls.length, 1, 'stopped before a second round');
  const row = readSpendRows(path.join(dir, 'spend.jsonl'))[0];
  assert.equal(row.stop, 'budget');
  assert.ok(row.costUsd > 0);
  assert.equal(row.budgetUsd, 0.0006);
});

test('draft: an unpriced round is booked null, never 0', async () => {
  const { r, dir } = await makeDraft({ replies: [{ ...toolReply(validArgs()), usage: undefined }] });
  assert.equal(r.costUsd, null);
  const row = readSpendRows(path.join(dir, 'spend.jsonl'))[0];
  assert.equal(row.costUsd, null);
  assert.match(readFileSync(path.join(dir, 'readout.txt'), 'utf8'), /UNKNOWN/);
});

const KEY = 'sk-test-SECRETSECRET-0123456789';

test('draft: a key value the model echoes is scrubbed; the sweep finds none in the dir', async () => {
  const echo = validArgs();
  echo.steps[0].goal = `read the resume with ${KEY}`;
  const { r, dir } = await makeDraft({ replies: [toolReply(echo)], extra: { env: { DEEPSEEK_API_KEY: KEY } } });
  assert.equal(r.leaks, 0);
  assert.equal(sweepForSecrets(dir, [KEY]), 0);
  for (const f of readdirSync(dir)) assert.ok(!readFileSync(path.join(dir, f), 'utf8').includes(KEY), `${f} has no key`);
  assert.match(readFileSync(path.join(dir, 'declaration.json'), 'utf8'), /\[redacted-key\]/);
});

test('draft: the sweep can fail — a planted key in a file is counted', () => {
  const d = tmp('sweep');
  writeFileSync(path.join(d, 'a.txt'), `clean`);
  writeFileSync(path.join(d, 'b.txt'), `leak ${KEY} here`);
  assert.equal(sweepForSecrets(d, [KEY]), 1);
  assert.equal(scrub(`x ${KEY} y`, [KEY]), 'x [redacted-key] y');
});

test('draft: prose that contains the key is refused at $0', async () => {
  const fx = job2Fixture();
  const { r } = await makeDraft({ prose: `${fx.prose}\n# ${KEY}\n`, extra: { env: { DEEPSEEK_API_KEY: KEY } } });
  assert.equal(r.wrote, false);
  assert.match(r.reds[0], /contains an API key value/);
});

// ---------------------------------------------------------------------------
// The CLI verbs, spawned for real (argv / stdout / exit code are the contract).
// ---------------------------------------------------------------------------
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
const cli = (args, env = {}) => spawnSync(process.execPath, [BIN, ...args], {
  encoding: 'utf8', env: { PATH: process.env.PATH ?? '', ...env },
});
const fakeEnv = (extra = {}) => ({ NODE_ENV: 'test', FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, ...extra });

function cliSetup() {
  const fx = job2Fixture();
  const work = tmp('cli');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  return { work, proseFile, dir: path.join(work, 'draft'), root: path.join(work, 'flows') };
}

test('cli draft: prints exactly the DRAFTED — NOT SIGNED line and exits 0', () => {
  const s = cliSetup();
  const r = cli(['draft', s.proseFile, '--out', s.dir, '--root', s.root, '--name', 'job2'], fakeEnv());
  assert.equal(r.status, 0, r.stderr);
  const hash = readFileSync(path.join(s.dir, SPEC_HASH_FILE), 'utf8').trim();
  assert.ok(r.stdout.split('\n').includes(`DRAFTED — NOT SIGNED. To sign: fwdloop sign ${s.dir} --approve ${hash}`), r.stdout);
  assert.ok(!existsSync(path.join(s.root, 'job2')), 'draft never writes a flow');
});

test('cli draft: a red draft writes its dir, prints no sign line, exits non-zero', () => {
  const s = cliSetup();
  const r = cli(['draft', s.proseFile, '--out', s.dir, '--root', s.root, '--name', 'job2'], fakeEnv({ FWDLOOP_TEST_DRAFT_MODE: 'bad' }));
  assert.notEqual(r.status, 0);
  assert.ok(!r.stdout.includes('DRAFTED'), r.stdout);
  assert.ok(existsSync(path.join(s.dir, 'log.json')));
  assert.ok(!existsSync(path.join(s.dir, SPEC_HASH_FILE)));
});

test('cli draft: an unset key refuses at $0 (no dir) with the live path, and the test hatch needs NODE_ENV=test', () => {
  const s = cliSetup();
  const r = cli(['draft', s.proseFile, '--out', s.dir, '--root', s.root, '--name', 'job2'], { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /key: DEEPSEEK_API_KEY is not set/);
  assert.ok(!existsSync(s.dir));
});
