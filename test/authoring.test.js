// M6a pieces 4-6 — $0 tests for src/authoring.js (`fwdloop draft` / `fwdloop sign`) and the CLI verbs.
// Fake provider only: no key, no network, no paid round.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync, chmodSync, symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import {
  draftToDir, signDraft, specHash, LEAK_MARKER_FILE, sweepForSecrets, scrub, SPEC_HASH_FILE, SIGN_LINE,
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
  const r = cli(['draft', s.proseFile, '--out', s.dir, '--root', s.root, '--name', 'job2'], { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, NODE_TEST_CONTEXT: 'child-v8' });
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

test('sign: a send target inside the flow root is refused at sign by name, no flow (M4e amendment 1)', async () => {
  const flowsRoot = tmp('flows-root');
  const d = await makeDraft({ prose: job2Fixture().prose.replace('file:poc/m0/out', `file:${flowsRoot}`), extra: { root: flowsRoot } });
  assert.equal(d.r.ok, true, JSON.stringify(d.r.reds));
  const s = signDraft({ dir: d.dir, approve: d.r.hash, signedBy: 'alice' });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /is a flow folder/);
  assert.ok(!existsSync(path.join(flowsRoot, 'job2')), 'no flow dir was written');
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

// A real pseudo-TTY via python3's stdlib pty (no `script`/`expect` on this box; skipped, not faked, if absent).
const PTY_PY = `
import os, pty, sys, time
args, typed = sys.argv[1:-1], sys.argv[-1]
pid, fd = pty.fork()
if pid == 0:
    os.execvp(args[0], args)
time.sleep(0.5)
os.write(fd, (typed + "\\n").encode())
out = b""
while True:
    try:
        b = os.read(fd, 4096)
    except OSError:
        break
    if not b:
        break
    out += b
_, st = os.waitpid(pid, 0)
sys.stdout.write(out.decode(errors="replace"))
sys.exit(os.waitstatus_to_exitcode(st))
`;
const HAS_PTY = spawnSync('python3', ['-c', 'import pty']).status === 0;
// In CI a missing pty must fail loudly, never skip green; locally it skips with a visible reason.
const IN_CI = !['', '0', 'false'].includes((process.env.CI ?? '').trim().toLowerCase());
const PTY_SKIP = HAS_PTY || IN_CI ? false : 'python3 with the pty module not found (set CI=1 to make this a failure)';
// Registered only in CI, so a normal local run does not carry a permanent "1 skipped" that could hide a real skip.
if (IN_CI) {
  test('cli sign (real pty): python3 pty is available when CI is set', () => {
    assert.ok(HAS_PTY, 'CI is set but `python3 -c "import pty"` failed: the real-pty sign tests cannot run — install python3 in CI');
  });
}
const ptyCli = (args, typed) => spawnSync('python3', ['-c', PTY_PY, process.execPath, BIN, ...args, typed], { encoding: 'utf8', env: { PATH: process.env.PATH ?? '' } });

function draftedForSign() {
  const s = cliSetup();
  cli(['draft', s.proseFile, '--out', s.dir, '--root', s.root, '--name', 'job2'], fakeEnv());
  return { s, hash: readFileSync(path.join(s.dir, SPEC_HASH_FILE), 'utf8').trim() };
}

test('cli sign: piped stdin (no TTY) is refused by name, no flow, even with the right hash', () => {
  const { s, hash } = draftedForSign();
  const r = spawnSync(process.execPath, [BIN, 'sign', s.dir, '--approve', hash], { encoding: 'utf8', input: 'job2\n', env: { PATH: process.env.PATH ?? '' } });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /sign needs an interactive terminal — run it yourself/);
  assert.ok(!existsSync(flowDirOf(s.root)), 'no flow written');
});

test('cli sign (real pty): wrong typed name is refused, no flow', { skip: PTY_SKIP }, () => {
  const { s, hash } = draftedForSign();
  const r = ptyCli(['sign', s.dir, '--approve', hash], 'nope');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /typed name does not match/);
  assert.ok(!existsSync(flowDirOf(s.root)), 'no flow written');
});

test('cli sign (real pty): right name + right hash signs; right name + wrong hash still refused', { skip: PTY_SKIP }, () => {
  const { s, hash } = draftedForSign();
  let r = ptyCli(['sign', s.dir, '--approve', 'f'.repeat(64)], 'job2');
  assert.notEqual(r.status, 0);
  assert.ok(!existsSync(flowDirOf(s.root)), 'existing $0 checks still run under a TTY');
  r = ptyCli(['sign', s.dir, '--approve', hash, '--signed-by', 'carol'], 'job2');
  assert.equal(r.status, 0, r.stdout);
  assert.equal(readJson(path.join(flowDirOf(s.root), 'signature.json')).signedBy, 'carol');
});

test('cli sign: a missing draft dir is refused by name (checked before the TTY gate)', () => {
  const r = cli(['sign']);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /a draft dir is required/);
});

test('cli sign (real pty): a missing --approve is refused by name, no flow', { skip: PTY_SKIP }, () => {
  const { s } = draftedForSign();
  const r = ptyCli(['sign', s.dir], 'job2');
  assert.notEqual(r.status, 0);
  assert.match(r.stdout, /--approve <hash> is required/);
  assert.ok(!existsSync(flowDirOf(s.root)), 'no flow written');
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
    askStep: async () => ({ decision: 'redo', reason: 'stop here' }),
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
    askStep: async () => ({ decision: 'redo', reason: 'stop here' }),
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

test('sweep leak: draft returns red, leaves NO spec.hash, writes the marker; sign refuses it, even with the hash', async () => {
  const fx = job2Fixture();
  const work = tmp('leak');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const dir = path.join(work, 'draft');
  // target.json is not scrubbed; a key in the flows root path reaches disk and only the sweep sees it.
  const root = path.join(work, `flows-${KEY}`);
  const r = await draftToDir({
    proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: { DEEPSEEK_API_KEY: KEY },
  });
  assert.equal(r.ok, false);
  assert.ok(r.leaks > 0);
  assert.ok(!existsSync(path.join(dir, SPEC_HASH_FILE)), 'no spec.hash after a leak');
  assert.ok(existsSync(path.join(dir, LEAK_MARKER_FILE)));
  const h = specHash({
    proseText: readFileSync(path.join(dir, 'prose.txt'), 'utf8'),
    declarationText: readFileSync(path.join(dir, 'declaration.json'), 'utf8'),
    inputFactsText: readFileSync(path.join(dir, 'input-facts.json'), 'utf8'),
    readoutText: readFileSync(path.join(dir, 'readout.txt'), 'utf8'),
    targetText: readFileSync(path.join(dir, 'target.json'), 'utf8'),
  }).hash;
  writeFileSync(path.join(dir, SPEC_HASH_FILE), `${h}\n`); // a person forging spec.hash
  const s = signDraft({ dir, approve: h, signedBy: 'alice', env: {} });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /key-leak marker/);
  assert.ok(!existsSync(path.join(root, 'job2')));
});

test('sign re-sweeps: a key planted in the draft dir after draft is refused when the key is in sign\'s env', async () => {
  const { r, root, dir } = await makeDraft();
  const log = path.join(dir, 'log.json'); // outside the spec hash, so the hash still matches
  writeFileSync(log, `${readFileSync(log, 'utf8')}\n${KEY}\n`);
  const s = signDraft({ dir, approve: r.hash, signedBy: 'alice', env: { DEEPSEEK_API_KEY: KEY } });
  assert.equal(s.ok, false);
  assert.match(s.reds.join(' '), /contains a key value/);
  noFlow(root);
});

/** A provider that runs `hook()` inside its (paid) round, then answers with a valid declaration. */
function hookedProvider(hook) {
  const inner = fakeProvider([toolReply(validArgs())]);
  return {
    ...inner,
    get lastMalformedToolCall() { return inner.lastMalformedToolCall; },
    async generate(...a) { hook(); return inner.generate(...a); },
  };
}

function draftSetup(tag) {
  const fx = job2Fixture();
  const work = tmp(tag);
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  return { work, proseFile, dir: path.join(work, 'draft'), root: path.join(work, 'flows') };
}

test('draft: an existing dir (a directory too) is refused at $0 — no provider call, contents untouched', async () => {
  const s = draftSetup('claim');
  mkdirSync(s.dir);
  writeFileSync(path.join(s.dir, 'keep.txt'), 'mine');
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await draftToDir({ ...s, name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {} });
  assert.equal(r.wrote, false);
  assert.equal(r.costUsd, 0);
  assert.match(r.reds[0], /already exists/);
  assert.equal(p.calls.length, 0);
  assert.equal(readFileSync(path.join(s.dir, 'keep.txt'), 'utf8'), 'mine');
});

test('draft: the dir is claimed BEFORE the paid round — a racing second draft to the same dir refuses at $0', async () => {
  const s = draftSetup('race');
  const p2 = fakeProvider([toolReply(validArgs())]);
  let racer;
  const p1 = hookedProvider(() => {
    assert.ok(existsSync(s.dir), 'dir already claimed while the paid round runs');
    racer = draftToDir({ ...s, name: 'job2', provider: p2, rates: RATES, modelId: MODEL, env: {} });
  });
  const r1 = await draftToDir({ ...s, name: 'job2', provider: p1, rates: RATES, modelId: MODEL, env: {} });
  const r2 = await racer;
  assert.equal(r1.ok, true, JSON.stringify(r1.reds));
  assert.equal(r2.wrote, false);
  assert.match(r2.reds[0], /already exists/);
  assert.equal(p2.calls.length, 0);
});

test('draft: a $0 pre-flight refusal after the claim leaves no dir behind', async () => {
  const s = draftSetup('pre');
  const r = await draftToDir({
    ...s, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {}, budgetUsd: 0.005,
  });
  assert.equal(r.wrote, false);
  assert.match(r.reds[0], /minimum budget/);
  assert.ok(!existsSync(s.dir), 'claimed dir removed on a $0 refusal');
});

test('draft: a write failure after the paid round still returns the cost, non-ok, with a clear red', async () => {
  const s = draftSetup('wfail');
  const p = hookedProvider(() => chmodSync(s.dir, 0o500)); // read-only dir: every write fails
  let r;
  try {
    r = await draftToDir({ ...s, name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {} });
  } finally {
    chmodSync(s.dir, 0o700);
  }
  assert.equal(r.ok, false);
  assert.ok(r.costUsd > 0, 'the paid cost is reported');
  assert.match(r.reds[0], /write failed after the paid round/);
  assert.ok(!existsSync(path.join(s.dir, SPEC_HASH_FILE)));
});

// ---------------------------------------------------------------------------
// A failed provider call leaves the draft's cost incomplete (runner convention: spendComplete:false, priced floor).
// ---------------------------------------------------------------------------
test('draft: validator-red then a thrown provider call books spendComplete:false and never prints a plain total', async () => {
  const s = cliSetup();
  const r = cli(['draft', s.proseFile, '--out', s.dir, '--root', s.root, '--name', 'job2'], fakeEnv({ FWDLOOP_TEST_DRAFT_MODE: 'timeout' }));
  assert.notEqual(r.status, 0);
  const rows = readSpendRows(path.join(s.dir, 'spend.jsonl'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].spendComplete, false);
  assert.equal(rows[0].stop, 'provider-red');
  assert.equal(rows[0].rounds, 1, 'rounds = metered rounds');
  assert.equal(rows[0].calls, 2, 'calls = provider calls made');
  assert.ok(rows[0].costUsd > 0, 'the priced floor is kept');
  const lg = readJson(path.join(s.dir, 'log.json'));
  assert.equal(lg.spendComplete, false);
  assert.match(r.stdout, /cost: at least \$0\.\d{4} \(incomplete/);
  assert.ok(!/cost: \$/.test(r.stdout), r.stdout);
});

test('draft: a thrown call after a priced round returns spendComplete:false (drafter level); a green draft is complete', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const p = fakeProvider([toolReply(bad)]);
  const gen = p.generate.bind(p);
  p.generate = async (...a) => { if (p.calls.length >= 1) throw Object.assign(new Error('x'), { code: 'ETIMEDOUT' }); return gen(...a); };
  const fx = job2Fixture();
  const { draft } = await import('../src/drafter.js');
  const r = await draft({ proseText: fx.prose, provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.stop, 'provider-red');
  assert.equal(r.spendComplete, false);
  assert.equal(r.calls, 2);
  assert.equal(r.rounds, 1);
  const g = await makeDraft();
  assert.equal(g.r.spendComplete, true);
  assert.equal(readSpendRows(path.join(g.dir, 'spend.jsonl'))[0].spendComplete, true);
  assert.match(readFileSync(path.join(g.dir, 'readout.txt'), 'utf8'), /cost \$0\./);
});

import { PassThrough } from 'node:stream';
import { confirmTypedName, isInteractive } from '../src/sign-confirm.js';

test('confirmTypedName: exact trimmed match ok; mismatch, empty and EOF refuse', async () => {
  const ask = async (text) => {
    const input = new PassThrough();
    const output = new PassThrough();
    const p = confirmTypedName({ name: 'job2', input, output });
    if (text === null) input.end(); else input.write(`${text}\n`);
    return p;
  };
  assert.equal((await ask('  job2  ')).ok, true);
  assert.equal((await ask('Job2')).ok, false);
  assert.equal((await ask('')).ok, false);
  assert.match((await ask(null)).red, /does not match/);
  assert.equal(isInteractive({ isTTY: true }, { isTTY: false }), false);
  assert.equal(isInteractive({ isTTY: true }, { isTTY: true }), true);
});

// M4c-fix item 10: an unsigned draft folder inside the flows root would list as a flow.
test('item 10: draft --out inside the flows root (also through a symlink) is refused by name at $0; the readout names the flows root', async () => {
  const fx = job2Fixture();
  const work = tmp('i10');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const root = path.join(work, 'flows');
  mkdirSync(root);
  symlinkSync(root, path.join(work, 'flows-link'));
  const p = fakeProvider([toolReply(validArgs())]);
  for (const dir of [path.join(root, 'inside'), path.join(work, 'flows-link', 'via-link'), path.join(root, 'a', 'b', 'deep'), root]) {
    const r = await draftToDir({
      proseFile, dir, root, name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {},
    });
    assert.equal(r.wrote, false, dir);
    assert.match(r.reds[0], /is inside the flows root/, dir);
  }
  assert.equal(p.calls.length, 0, 'refused at $0, before any provider round');
  assert.deepEqual(readdirSync(root), [], 'nothing was created under the flows root');
  // a sibling folder is fine, and its readout names the flows root
  const ok = await draftToDir({
    proseFile, dir: path.join(work, 'flows-sibling'), root, name: 'job2', provider: p, rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(ok.ok, true, JSON.stringify(ok.reds));
  assert.match(readFileSync(path.join(work, 'flows-sibling', 'readout.txt'), 'utf8'), new RegExp(`Flows root: ${root}`));
});

// M4c-fix item 11: a provider error that echoes the key reaches the red message the CLI prints.
test('item 11: a drafter red whose provider error echoes the key is scrubbed before it is returned', async () => {
  const fx = job2Fixture();
  const work = tmp('i11');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const provider = { lastMalformedToolCall: null, async generate() { throw new Error(`401 invalid Authorization: Bearer ${KEY}`); } };
  const r = await draftToDir({
    proseFile, dir: path.join(work, 'd'), root: path.join(work, 'flows'), name: 'job2', provider, rates: RATES, modelId: MODEL, env: { DEEPSEEK_API_KEY: KEY },
  });
  assert.equal(r.ok, false);
  assert.match(r.reds.join(' '), /provider-red/);
  assert.ok(!r.reds.join(' ').includes(KEY), 'the key never leaves in a red');
  assert.match(r.reds.join(' '), /\[redacted-key\]/);
});
