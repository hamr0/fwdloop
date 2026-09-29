// M6a pieces 4-6 — $0 tests for src/authoring.js (`fwdloop draft` / `fwdloop sign`) and the CLI verbs.
// Fake provider only: no key, no network, no paid round.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, writeFileSync, readdirSync, rmSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import {
  draftToDir, signDraft, specHash, sweepForSecrets, scrub, SPEC_HASH_FILE, SIGN_LINE,
} from '../src/authoring.js';
import { readSpendRows, ceilingCostUsd } from '../src/provider.js';
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
    targetText: readFileSync(path.join(dir, 'target.json'), 'utf8'),
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
  const { r, dir, provider } = await makeDraft({ replies: [toolReply(bad)], extra: { budgetUsd: ceilingCostUsd(MODEL) + 0.0002 } });
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'budget');
  assert.equal(provider.calls.length, 1, 'stopped before a second round');
  const row = readSpendRows(path.join(dir, 'spend.jsonl'))[0];
  assert.equal(row.stop, 'budget');
  assert.ok(row.costUsd > 0);
  assert.equal(row.budgetUsd, ceilingCostUsd(MODEL) + 0.0002);
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
  // the goal is the machine's now (F50); a model-authored free-text field that reaches the file is emits
  echo.steps[0].emits = echo.steps[0].emits + KEY;
  for (const st of echo.steps) st.reads = st.reads.map((x) => (x === 'resume-text' ? x + KEY : x));
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

// ---------------------------------------------------------------------------
// sign — the human step, $0. Every refusal writes NO flow.
// ---------------------------------------------------------------------------
import { readFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow } from '../src/runner.js';

const CAT = loadCatalogue().primitives;
const flowDirOf = (root) => path.join(root, 'job2');
const noFlow = (root) => assert.ok(!existsSync(flowDirOf(root)), 'no flow dir was written');

/** Re-hash after a hand edit and rewrite spec.hash (a person who controls the hash — the deepest refusal is then the validator). */
function rehash(dir) {
  const rd = (f) => readFileSync(path.join(dir, f), 'utf8');
  const h = specHash({
    proseText: rd('prose.txt'), declarationText: rd('declaration.json'), inputFactsText: rd('input-facts.json'), readoutText: rd('readout.txt'), targetText: rd('target.json'),
  }).hash;
  writeFileSync(path.join(dir, SPEC_HASH_FILE), `${h}\n`);
  return h;
}

test('sign: the right hash writes the flow, signed by the human named at sign; readFlow verifies it', async () => {
  const { r, root, dir } = await makeDraft();
  const s = signDraft({ dir, approve: r.hash, signedBy: 'alice' });
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  assert.equal(s.signature.signedBy, 'alice');
  const read = readFlow({ root, name: 'job2', catalogue: CAT });
  assert.equal(read.ok, true, JSON.stringify(read.reds));
  assert.equal(read.signature.signedBy, 'alice');
  assert.equal(readFileSync(path.join(flowDirOf(root), 'prose.txt'), 'utf8'), readFileSync(path.join(dir, 'prose.txt'), 'utf8'));
});

test('sign: no hash and a wrong hash are refused, no flow', async () => {
  const { r, root, dir } = await makeDraft();
  for (const approve of [undefined, '', 'deadbeef', `${r.hash.slice(0, -1)}${r.hash.endsWith('0') ? '1' : '0'}`]) {
    const s = signDraft({ dir, approve, signedBy: 'alice' });
    assert.equal(s.ok, false);
    assert.match(s.reds[0], /--approve/);
    noFlow(root);
  }
});

test('sign: prose edited after the draft -> hash mismatch, refused, no flow', async () => {
  const { r, root, dir } = await makeDraft();
  const pf = path.join(dir, 'prose.txt');
  writeFileSync(pf, readFileSync(pf, 'utf8').replace('cap $0.25', 'cap $9.99'));
  const s = signDraft({ dir, approve: r.hash, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds[0], /does not match the draft as it is now/);
  noFlow(root);
});

test('sign: a hash freshly computed over edited files is refused unless the draft itself wrote spec.hash', async () => {
  const { r, root, dir } = await makeDraft();
  const pf = path.join(dir, 'prose.txt');
  writeFileSync(pf, readFileSync(pf, 'utf8').replace('cap $0.25', 'cap $9.99'));
  const rd = (f) => readFileSync(path.join(dir, f), 'utf8');
  const fresh = specHash({
    proseText: rd('prose.txt'), declarationText: rd('declaration.json'), inputFactsText: rd('input-facts.json'), readoutText: rd('readout.txt'), targetText: rd('target.json'),
  }).hash;
  assert.notEqual(fresh, r.hash);
  const s = signDraft({ dir, approve: fresh, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds[0], /spec\.hash was not written by the draft/);
  noFlow(root);
});

test('sign: a hand-edited declaration granting an unwired verb is refused, no flow — even with a matching hash', async () => {
  const { r, root, dir } = await makeDraft();
  const df = path.join(dir, 'declaration.json');
  const d = readJson(df);
  d.steps[2].primitives = ['stash'];
  writeFileSync(df, `${JSON.stringify(d, null, 2)}\n`);
  // (1) edit alone: the hash catches it
  assert.match(signDraft({ dir, approve: r.hash, signedBy: 'alice' }).reds[0], /does not match/);
  // (2) someone who re-hashes: the validator (wired set) still refuses, by name
  const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /"stash" is in the catalogue but not wired/);
  noFlow(root);
});

test('sign: a missing input source and an invalid send target are refused, no flow', async () => {
  let d = await makeDraft();
  rmSync(d.fx.jd);
  let s = signDraft({ dir: d.dir, approve: d.r.hash, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /input source "jd" is missing/);
  noFlow(d.root);

  const fx = job2Fixture();
  d = await makeDraft({ prose: fx.prose.replace('file:poc/m0/out', 'file:poc/m0/no-such-dir-xyz') });
  assert.equal(d.r.ok, true, JSON.stringify(d.r.reds));
  s = signDraft({ dir: d.dir, approve: d.r.hash, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /destination: send target/);
  noFlow(d.root);
});

test('sign: a red draft dir (no spec.hash / no declaration.json) can never be signed', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const { r, root, dir } = await makeDraft({ replies: [toolReply(bad)] });
  assert.equal(r.ok, false);
  const s = signDraft({ dir, approve: 'a'.repeat(64), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds[0], /not a green draft/);
  noFlow(root);
});

test('sign: an existing flow is never overwritten', async () => {
  const { r, dir } = await makeDraft();
  assert.equal(signDraft({ dir, approve: r.hash, signedBy: 'alice' }).ok, true);
  const again = signDraft({ dir, approve: r.hash, signedBy: 'bob' });
  assert.equal(again.ok, false);
  assert.match(again.reds[0], /already exists/);
});

test('cli sign: wrong hash exits non-zero with no flow; right hash signs as --signed-by', () => {
  const s = cliSetup();
  cli(['draft', s.proseFile, '--out', s.dir, '--root', s.root, '--name', 'job2'], fakeEnv());
  const hash = readFileSync(path.join(s.dir, SPEC_HASH_FILE), 'utf8').trim();
  let r = cli(['sign', s.dir, '--approve', 'f'.repeat(64)]);
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(flowDirOf(s.root)));
  r = cli(['sign', s.dir]);
  assert.notEqual(r.status, 0);
  r = cli(['sign', s.dir, '--approve', hash, '--signed-by', 'carol']);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(readJson(path.join(flowDirOf(s.root), 'signature.json')).signedBy, 'carol');
});

test('e2e: draft (fake provider) -> sign -> readFlow ok -> runner preflight accepts and reaches the first step', async () => {
  const { r, root, dir, fx } = await makeDraft();
  assert.equal(signDraft({ dir, approve: r.hash, signedBy: 'alice' }).ok, true);
  const read = readFlow({ root, name: 'job2', catalogue: CAT });
  assert.equal(read.ok, true);
  const goals = [];
  const modelStep = async (ctx) => { goals.push(ctx.goal); return { ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } }; };
  const res = await runFlow({
    root,
    name: 'job2',
    runId: 'run-1',
    sources: [{ id: 'resume', path: fx.resume }, { id: 'jd', path: fx.jd }],
    catalogue: CAT,
    modelStep,
    askStep: async () => ({ decision: 'reject', reason: 'stop here' }),
    sendStep: async () => ({ ok: true, bytes: 1 }),
    primitives: {},
    businessDate: '2026-09-29',
  });
  assert.ok(!['refused', 'preflight-red'].includes(res.outcome), `${res.outcome} ${res.red}`);
  assert.ok(goals.length >= 1, 'the first fake step ran');
});

// ---------------------------------------------------------------------------
// M6a amendment 1 (F50): the goal is the signed line, verbatim, set by the machine.
// ---------------------------------------------------------------------------
const LINE3 = 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,';

test('goal: the drafter overwrites a goal the fake model sends — the written declaration carries the signed line, "200ish each" included', async () => {
  const args = validArgs();
  for (const st of args.steps) st.goal = 'a paraphrase in the model\'s own words';
  const { r, dir } = await makeDraft({ replies: [toolReply(args)] });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const d = readJson(path.join(dir, 'declaration.json'));
  const byLine = Object.fromEntries(d.steps.map((s) => [s.fromLine, s.goal]));
  assert.equal(byLine[3], LINE3);
  assert.match(byLine[3], /200ish each/);
  assert.equal(byLine[1], 'Read my resume,');
  assert.equal(byLine[4], 'check it with me,', 'the ask mark is stripped, the question stays');
});

test('goal: the forced schema no longer offers `goal` to the model', async () => {
  const { buildDeclarationSchema } = await import('../src/drafter.js');
  const { wiredMenu } = await import('../src/primitives.js');
  const item = buildDeclarationSchema(wiredMenu(['core'])).properties.steps.items;
  assert.equal(item.properties.goal, undefined);
  assert.ok(!item.required.includes('goal'));
});

test('goal: sign refuses a hand-edited goal that is not its signed line, no flow — even with a matching hash', async () => {
  const { r, root, dir } = await makeDraft();
  const df = path.join(dir, 'declaration.json');
  const d = readJson(df);
  d.steps.find((s) => s.fromLine === 3).goal = 'write me a summary resume';
  writeFileSync(df, `${JSON.stringify(d, null, 2)}\n`);
  assert.match(signDraft({ dir, approve: r.hash, signedBy: 'alice' }).reds[0], /does not match/);
  const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /steps\[\d+\]\.goal is not its signed line 3 verbatim/);
  noFlow(root);
});

test('goal: the running step gets the signed line exactly, and its whole context never carries the guardrail, shape or cap', async () => {
  const { r, root, dir, fx } = await makeDraft();
  assert.equal(signDraft({ dir, approve: r.hash, signedBy: 'alice' }).ok, true);
  const ctxs = [];
  const modelStep = async (ctx) => { ctxs.push(JSON.stringify(ctx)); return { ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } }; };
  await runFlow({
    root,
    name: 'job2',
    runId: 'run-1',
    sources: [{ id: 'resume', path: fx.resume }, { id: 'jd', path: fx.jd }],
    catalogue: CAT,
    modelStep,
    askStep: async () => ({ decision: 'reject', reason: 'stop here' }),
    sendStep: async () => ({ ok: true, bytes: 1 }),
    primitives: {},
    businessDate: '2026-09-29',
  });
  assert.ok(ctxs.some((c) => JSON.parse(c).goal === LINE3), 'a step ran with line 3 verbatim');
  for (const c of ctxs) {
    for (const leak of ['3 sections, all under 600 words', 'nothing goes out before I accept', 'softgreen', 'maxWords', '0.25']) {
      assert.ok(!c.includes(leak), `context leaked "${leak}": ${c}`);
    }
  }
});

// ---------------------------------------------------------------------------
// M6a amendment 1: an ask's wait is signed by the human, never a code default.
// ---------------------------------------------------------------------------
test('ttl: a draft whose ask has no signed wait is refused at $0 by name — no provider call, no dir', async () => {
  const fx = job2Fixture();
  const { r, dir, provider } = await makeDraft({ prose: fx.prose.replace('4. ask 30m:', '4. ask:') });
  assert.equal(r.ok, false);
  assert.equal(r.wrote, false);
  assert.equal(provider.calls.length, 0);
  assert.equal(existsSync(dir), false);
  assert.match(r.reds.join(' '), /the ask on line 4 has no signed wait/);
});

test('ttl: sign refuses a draft whose prose ask has no signed wait, even with everything re-hashed; no flow', async () => {
  const { r, root, dir } = await makeDraft();
  const pf = path.join(dir, 'prose.txt');
  writeFileSync(pf, readFileSync(pf, 'utf8').replace('4. ask 30m:', '4. ask:'));
  const s = signDraft({ dir, approve: rehash(dir), signedBy: 'alice' });
  assert.notEqual(r.hash, undefined);
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /the ask on line 4 has no signed wait/);
  noFlow(root);
});

test('ttl: a signed "ask 30m:" is accepted and the readout shows the wait the human typed', async () => {
  const { r, dir } = await makeDraft();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.match(readFileSync(path.join(dir, 'readout.txt'), 'utf8'), /\(ttl 30m\)/);
});

test('ttl: a signed "ask 20s:" reads back as 20s, never rounded to 0 min', async () => {
  const fx = job2Fixture();
  const { r, dir } = await makeDraft({ prose: fx.prose.replace('4. ask 30m:', '4. ask 20s:') });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.match(readFileSync(path.join(dir, 'readout.txt'), 'utf8'), /\(ttl 20s\)/);
});

test('sign: editing target.json after draft changes the hash — refused, no flow', async () => {
  const { r, root, dir } = await makeDraft();
  const t = path.join(dir, 'target.json');
  writeFileSync(t, JSON.stringify({ root, name: 'other' }));
  const s = signDraft({ dir, approve: r.hash, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /does not match the draft as it is now/);
  noFlow(root);
  assert.ok(!existsSync(path.join(root, 'other')), 'nothing landed under the edited name');
});
