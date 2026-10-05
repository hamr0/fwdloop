// M4d piece 3 (docs/wiki/the-module-ladder.md, "M4d", scope items 4-5; negatives (v)-(viii), money half of (xiii)).
// $0, no network. Every test builds its own config home under a tracked mkdtemp dir; the real
// ~/.config/fwdloop is never touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  writeFileSync, mkdirSync, chmodSync, existsSync, readFileSync, statSync, appendFileSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { keysFilePath, loadKeysEnv } from '../src/keysfile.js';
import { draftToDir } from '../src/authoring.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { appendSpendRow, readSpendRows } from '../src/provider.js';
import {
  spendSummary, readRuns, monthlyRefusalText, claimHold, settleHold, ConfigError,
} from '../src/monthly.js';
import { createResumer } from '../src/panel/resume.js';
import { install } from './fixtures/m4d-fake-openai.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_STEP = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const BLOCK_STEP = path.join(HERE, 'fixtures', 'm4d-block-model-step.mjs');
const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
const SENTENCE = 'Nothing spent. Raise the monthly limit in Settings, or wait for next month.';
const catalogue = loadCatalogue().primitives;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4d3-${p}-`));
const FILE_KEY = 'file-only-key-m4d-p3-0123456789';

// Commit 0 (piece 2's one untested fix): the drafter must hand makeProvider the MERGED env.
test('draft: a key that lives ONLY in the keys file reaches makeProvider (drafter.js threads env)', async () => {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), `DEEPSEEK_API_KEY=${FILE_KEY}\n`, { mode: 0o600 });
  chmodSync(keysFilePath(home), 0o600);
  const loaded = loadKeysEnv({ env: {}, home });
  assert.equal(loaded.ok, true);
  const saved = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY; // the key is NOT in the shell: only the merged env has it
  const restore = install({ inputTokens: 100, outputTokens: 50 });
  try {
    const work = tmp('draft');
    const proseFile = path.join(work, 'prose.txt');
    writeFileSync(proseFile, job2Fixture().prose);
    const r = await draftToDir({
      proseFile, dir: path.join(work, 'd'), root: path.join(work, 'flows'), name: 'x', env: loaded.env,
    });
    assert.equal(r.ok, true, JSON.stringify(r.reds));
  } finally {
    restore();
    if (saved !== undefined) process.env.DEEPSEEK_API_KEY = saved;
  }
});

// ---------------------------------------------------------------------------
// Piece 3 helpers. Every spawned child gets a from-scratch env (no real key, no real ~/.config/fwdloop).
// ---------------------------------------------------------------------------
const newHome = (limit, rawConfig) => {
  const home = path.join(tmp('cfg'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (rawConfig !== undefined) writeFileSync(path.join(home, 'config.json'), rawConfig);
  else if (limit !== undefined) writeFileSync(path.join(home, 'config.json'), JSON.stringify({ monthlyLimitUsd: limit }));
  return home;
};
const envFor = (home, extra = {}) => ({
  PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, FWDLOOP_TEST_MODEL_STEP: FAKE_STEP, ...extra,
});
const cli = (args, env) => spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 30_000 });
function job2Root() {
  const root = tmp('root');
  const base = readFileSync(path.join(HERE, 'fixtures', 'job2-with-sources.signed.txt'), 'utf8');
  const r = writeFlow({
    root, name: 'job2', proseText: base, declaration: JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'job2.m1.declaration.json'), 'utf8')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
  const src = tmp('src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  return { root, srcArgs: ['--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`] };
}
const runArgs = (j, id) => ['run', 'job2', '--root', j.root, ...j.srcArgs, '--run-id', id];
const holdRows = (home) => readRuns(home).filter((r) => r.kind === 'hold');
const runDirOf = (j, id) => path.join(j.root, 'job2', 'runs', id);
const noSpendRows = (dir) => !existsSync(path.join(dir, 'spend.jsonl')) || readSpendRows(path.join(dir, 'spend.jsonl')).length === 0;

test('spend rows carry `at`, set by the one writer; a caller cannot set it', () => {
  const p = path.join(tmp('at'), 'spend.jsonl');
  appendSpendRow(p, { model: 'deepseek-flash', costUsd: 0.01, at: '1999-01-01T00:00:00.000Z' });
  const [row] = readSpendRows(p);
  assert.notEqual(row.at, '1999-01-01T00:00:00.000Z');
  assert.ok(Math.abs(Date.parse(row.at) - Date.now()) < 5000);
});

// (v) run
test('(v) run over the limit refuses with the amount and the signed sentence: exit nonzero, $0, no spend row, no run dir', () => {
  const home = newHome(0.10);
  const j = job2Root();
  const r = cli(runArgs(j, 'r1'), envFor(home));
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes('Max $0.10 left this month (monthly limit $0.10); this needs $0.25.'), r.stderr);
  assert.ok(r.stderr.includes(SENTENCE), r.stderr);
  assert.ok(!existsSync(runDirOf(j, 'r1')), 'a refused run leaves no run dir');
  assert.deepEqual(readdirSync(j.root).sort(), ['job2'], 'nothing else under the root');
  const rows = readRuns(home);
  assert.deepEqual(rows.map((x) => x.kind), ['hold', 'refused']);
  assert.equal(statSync(path.join(home, 'runs.jsonl')).mode & 0o777, 0o600);
});

// (v) resume + the hold is cap minus already spent
test('(v) resume over the limit refuses at $0 and leaves the answer unconsumed; a resume that fits holds cap minus already spent and settles', () => {
  const j = job2Root();
  const free = newHome();
  const parked = cli(runArgs(j, 'r1'), envFor(free));
  assert.equal(parked.status, 0, parked.stderr);
  const askId = /askId=(\S+)/.exec(parked.stdout)[1];
  assert.equal(cli(['answer', askId, 'accept', '--root', j.root], envFor(free)).status, 0);
  const spent = JSON.parse(readFileSync(path.join(runDirOf(j, 'r1'), 'state.json'), 'utf8')).spent;
  assert.ok(spent > 0);
  const before = readdirSync(runDirOf(j, 'r1')).sort();

  const tight = newHome(0.10);
  const r = cli(['resume', 'r1', '--flow', 'job2', '--root', j.root], envFor(tight));
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes(`this needs $${(0.25 - spent).toFixed(2)}.`), r.stderr);
  assert.ok(r.stderr.includes(SENTENCE));
  assert.deepEqual(readdirSync(runDirOf(j, 'r1')).sort(), before, 'a refused resume touches nothing in the run dir');

  const roomy = newHome(5);
  const ok = cli(['resume', 'r1', '--flow', 'job2', '--root', j.root], envFor(roomy));
  assert.equal(ok.status, 0, ok.stderr);
  const [hold] = holdRows(roomy);
  assert.equal(hold.what, 'resume');
  assert.ok(Math.abs(hold.holdUsd - (0.25 - spent)) < 1e-9, `hold ${hold.holdUsd}`);
  assert.equal(hold.spentAtHold, spent);
  assert.deepEqual(readRuns(roomy).map((x) => x.kind), ['hold', 'settled'], 'the finished resume settled its own hold');
});

// (v) draft
test('(v) draft over the limit refuses with the amount and the sentence: nonzero, $0, no draft dir', () => {
  const home = newHome(0.01);
  const work = tmp('draft');
  const prose = path.join(work, 'prose.txt');
  writeFileSync(prose, job2Fixture().prose);
  const out = path.join(work, 'd');
  const r = cli(['draft', prose, '--out', out, '--root', path.join(work, 'flows'), '--name', 'x'], envFor(home, { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT }));
  assert.notEqual(r.status, 0);
  assert.ok(r.stderr.includes('Max $0.01 left this month (monthly limit $0.01); this needs $0.03.'), r.stderr);
  assert.ok(r.stderr.includes(SENTENCE));
  assert.ok(!existsSync(out), 'no draft dir');
  const roomy = newHome(5);
  const ok = cli(['draft', prose, '--out', out, '--root', path.join(work, 'flows'), '--name', 'x'], envFor(roomy, { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT }));
  assert.equal(ok.status, 0, ok.stderr);
  assert.deepEqual(readRuns(roomy).map((x) => `${x.kind}`), ['hold', 'settled']);
  assert.equal(holdRows(roomy)[0].what, 'draft');
});

// (vi) the race
test('(vi) two real runs started together whose caps fit alone but not together: exactly one starts (x5)', async () => {
  for (let i = 0; i < 5; i += 1) {
    const home = newHome(0.30);
    const j = job2Root();
    const release = path.join(tmp('rel'), 'go');
    const env = envFor(home, { FWDLOOP_TEST_MODEL_STEP: BLOCK_STEP, M4D_RELEASE_FILE: release });
    const procs = ['a', 'b'].map((id) => {
      const c = spawn(process.execPath, [BIN, ...runArgs(j, id)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
      const o = { code: null, err: '' };
      c.stderr.on('data', (d) => { o.err += d; });
      o.done = new Promise((res) => { c.on('exit', (code) => { o.code = code; res(); }); });
      return o;
    });
    // the refused one exits at once; the other stays alive (blocked) until released
    const deadline = Date.now() + 20_000;
    while (!procs.some((p) => p.code !== null) && Date.now() < deadline) await sleep(20); // eslint-disable-line no-await-in-loop
    writeFileSync(release, '');
    await Promise.all(procs.map((p) => p.done)); // eslint-disable-line no-await-in-loop
    const codes = procs.map((p) => p.code).sort();
    assert.deepEqual(codes, [0, 1], `round ${i}: ${procs.map((p) => p.err).join('|')}`);
    assert.ok(procs.find((p) => p.code === 1).err.includes(SENTENCE));
    assert.ok(procs.find((p) => p.code === 1).err.includes('held by a run in progress'));
  }
});

// (vii) a dead process's hold is freed
test('(vii) a killed run\'s hold is settled ("process gone") by the next check and no longer counts', async () => {
  const home = newHome(0.30);
  const j = job2Root();
  const release = path.join(tmp('rel'), 'go');
  const a = spawn(process.execPath, [BIN, ...runArgs(j, 'a')], { env: envFor(home, { FWDLOOP_TEST_MODEL_STEP: BLOCK_STEP, M4D_RELEASE_FILE: release }), stdio: 'ignore' });
  const aGone = new Promise((res) => { a.on('exit', res); });
  const deadline = Date.now() + 20_000;
  while (holdRows(home).length === 0 && Date.now() < deadline) await sleep(20);
  assert.equal(holdRows(home).length, 1);
  // while A lives its hold blocks a second run (control)
  const blocked = cli(runArgs(j, 'b'), envFor(home));
  assert.notEqual(blocked.status, 0);
  a.kill('SIGKILL');
  await aGone;
  const next = cli(runArgs(j, 'c'), envFor(home));
  assert.equal(next.status, 0, next.stderr);
  const aHold = holdRows(home)[0];
  const note = readRuns(home).find((x) => x.kind === 'settled' && x.holdId === aHold.holdId);
  assert.equal(note.why, 'process gone');
});

// (viii) broken config
test('(viii) an unparseable config.json refuses run, resume and draft by name; nothing runs', () => {
  const j = job2Root();
  const free = newHome();
  const parked = cli(runArgs(j, 'r1'), envFor(free));
  const askId = /askId=(\S+)/.exec(parked.stdout)[1];
  cli(['answer', askId, 'accept', '--root', j.root], envFor(free));
  const before = readdirSync(runDirOf(j, 'r1')).sort();
  const bad = newHome(undefined, '{not json');
  const run = cli(runArgs(j, 'r2'), envFor(bad));
  const resume = cli(['resume', 'r1', '--flow', 'job2', '--root', j.root], envFor(bad));
  const work = tmp('draft');
  const prose = path.join(work, 'prose.txt');
  writeFileSync(prose, job2Fixture().prose);
  const draft = cli(['draft', prose, '--out', path.join(work, 'd'), '--root', path.join(work, 'f'), '--name', 'x'], envFor(bad, { FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT }));
  for (const r of [run, resume, draft]) {
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /config\.json is not readable JSON/);
    assert.match(r.stderr, /Nothing spent/);
  }
  assert.ok(!existsSync(runDirOf(j, 'r2')));
  assert.deepEqual(readdirSync(runDirOf(j, 'r1')).sort(), before);
  assert.ok(!existsSync(path.join(work, 'd')));
  assert.equal(readRuns(bad).length, 0, 'no hold row on a broken config');
});

test('no limit set (no config, or a config without one): the run goes, a $0 hold row is written and settled when the process ends', () => {
  for (const home of [newHome(), newHome(undefined, JSON.stringify({ prices: {} }))]) {
    const j = job2Root();
    const r = cli(runArgs(j, 'r1'), envFor(home));
    assert.equal(r.status, 0, r.stderr);
    const rows = readRuns(home);
    assert.deepEqual(rows.map((x) => x.kind), ['hold', 'settled'], 'no live $ hold left behind');
    assert.equal(rows[0].holdUsd, 0);
    assert.equal(rows[0].runDir, runDirOf(j, 'r1'));
    assert.equal(rows[1].holdId, rows[0].holdId);
  }
});

test('no limit set: the run is still recorded, its spend counts in the month, and a limit set LATER subtracts it', () => {
  const home = newHome();
  const dir = tmp('nolimit-run');
  const c1 = claimHold({ what: 'run', flow: 'f', runId: 'r', runDir: dir, holdUsd: 0.25, home });
  assert.equal(c1.ok, true);
  assert.equal(typeof c1.holdId, 'string');
  assert.equal(c1.room.limitUsd, null);
  appendSpendRow(path.join(dir, 'spend.jsonl'), { provider: 'deepseek', model: 'deepseek-flash', costUsd: 0.0185 });
  settleHold({ holdId: c1.holdId, why: 'ended or parked', home });
  assert.ok(Math.abs(spendSummary({ home }).month.usd - 0.0185) < 1e-9, 'the Money tab sees the no-limit run');
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 0.10 }));
  const c2 = claimHold({ what: 'run', flow: 'f', runId: 'r2', runDir: tmp('next-run'), holdUsd: 0.25, home });
  assert.equal(c2.ok, false);
  assert.equal(c2.room.leftUsd, 0.08, 'the 0.0185 already spent comes off the $0.10 (floored to cents)');
});

test('no limit set and runs.jsonl cannot be written: the claim refuses by name (ConfigError), never runs uncounted', () => {
  const home = newHome();
  mkdirSync(path.join(home, 'runs.jsonl')); // a directory where the record file must be: append fails
  assert.throws(
    () => claimHold({ what: 'run', flow: 'f', runId: 'r', runDir: tmp('x'), holdUsd: 0.25, home }),
    (e) => e instanceof ConfigError && /cannot write this hold to .*runs\.jsonl/.test(e.message),
  );
});

test('a run that parks settles its own hold', () => {
  const home = newHome(5);
  const j = job2Root();
  assert.equal(cli(runArgs(j, 'r1'), envFor(home)).status, 0);
  const rows = readRuns(home);
  assert.deepEqual(rows.map((x) => x.kind), ['hold', 'settled']);
  assert.equal(rows[0].what, 'run');
  assert.equal(rows[0].holdUsd, 0.25);
  assert.equal(rows[0].runDir, path.join(runDirOf(j, 'r1')).replace(/^/, ''), 'the realpath of the run dir');
});

// ---------------------------------------------------------------------------
// spendSummary: month boundary, unknown cost, minutes, providers
// ---------------------------------------------------------------------------
function summaryHome(rows) {
  const home = newHome();
  const dir = tmp('rundir');
  writeFileSync(path.join(dir, 'spend.jsonl'), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
  appendFileSync(path.join(home, 'runs.jsonl'), `${JSON.stringify({ kind: 'hold', holdId: 'h1', what: 'run', flow: 'f', runId: 'r', runDir: dir, pid: 1, holdUsd: 1, spentAtHold: 0, at: new Date().toISOString() })}\n`);
  return home;
}
const NOW = new Date(2026, 9, 15, 12, 0, 0).getTime(); // 15 Oct 2026, local
const iso = (y, m, d, h = 12) => new Date(y, m, d, h).toISOString();

test('month boundary: last month counts in "to date" only; undated rows are to-date only and counted', () => {
  const home = summaryHome([
    { provider: 'deepseek', costUsd: 1, tokens: { inputTokens: 10 }, wallMs: 60000, at: iso(2026, 8, 30, 23) }, // Sept 30
    { provider: 'deepseek', costUsd: 2, tokens: { inputTokens: 20 }, wallMs: 120000, at: iso(2026, 9, 1, 0) }, // Oct 1
    { provider: 'deepseek', costUsd: 4, tokens: { inputTokens: 40 }, wallMs: 60000 }, // pre-M4d: no `at`
  ]);
  const s = spendSummary({ home, now: () => NOW });
  assert.equal(s.month.usd, 2);
  assert.equal(s.total.usd, 7);
  assert.equal(s.month.atLeast, false, 'an undated row never makes the month "at least"');
  assert.equal(s.total.atLeast, false);
  assert.equal(s.undatedRows, 1);
  assert.equal(s.month.tokens, 20);
  assert.equal(s.total.tokens, 70);
  assert.equal(s.month.modelMinutes, 2);
  assert.equal(s.total.modelMinutes, 4);
  assert.equal(s.preM4dRunsNotCounted, true);
  assert.equal(s.byProvider.deepseek.month.usd, 2);
  assert.equal(s.byProvider.deepseek.total.usd, 7);
});

test('unknown cost reads "at least", never 0; a draft row without wallMs makes minutes "at least"; none = null', () => {
  const home = summaryHome([
    { provider: 'deepseek', costUsd: null, spendComplete: false, calls: 1, rounds: 0, price: { inPerM: 1, cachedInPerM: 0.1, outPerM: 4 }, at: iso(2026, 9, 2) },
    { provider: 'deepseek', costUsd: 0.5, wallMs: 30000, at: iso(2026, 9, 3) },
    { costUsd: 0.25, at: iso(2026, 9, 3) }, // no provider recorded, no wallMs
  ]);
  const s = spendSummary({ home, now: () => NOW });
  assert.equal(s.month.atLeast, true);
  assert.ok(s.month.usd > 0.75, `unknown row counted at its ceiling, not 0: ${s.month.usd}`);
  assert.equal(s.byProvider.deepseek.month.atLeast, true);
  assert.equal(s.month.modelMinutesAtLeast, true);
  assert.equal(s.byProvider['not recorded'].month.usd, 0.25);
  assert.equal(s.byProvider['not recorded'].month.modelMinutes, null);
  assert.equal(s.byProvider['not recorded'].month.modelMinutesAtLeast, true);
  assert.equal(spendSummary({ home: newHome(), now: () => NOW }).month.usd, 0, 'an empty record is a clean 0 with nothing unknown');
});

test('refusal text: amount line + held part + the signed sentence', () => {
  const t = monthlyRefusalText({ limitUsd: 5, leftUsd: 1.5, heldUsd: 2.25, heldRuns: 1, needUsd: 3, atLeast: false });
  assert.equal(t, `Max $1.50 left this month (monthly limit $5.00, $2.25 held by a run in progress); this needs $3.00.\n${SENTENCE}`);
});

// panel: a resume child's monthly refusal reaches the attempt's reason through the existing path
test('panel resume: the child\'s monthly refusal is the attempt\'s reason, verbatim and plain', async () => {
  const j = job2Root();
  const free = newHome();
  const parked = cli(runArgs(j, 'r1'), envFor(free));
  const askId = /askId=(\S+)/.exec(parked.stdout)[1];
  assert.equal(cli(['answer', askId, 'accept', '--root', j.root], envFor(free)).status, 0);
  const tight = newHome(0.10);
  const resumer = createResumer({
    root: j.root, loadEnv: () => ({ ok: true, env: envFor(tight), refusal: null }), logDir: path.join(tmp('logs'), 'l'), maxTries: 1, windowMs: 20000, slotMs: 20000,
  });
  resumer.start({
    flow: 'job2', runId: 'r1', runDir: runDirOf(j, 'r1'), askId,
  });
  const deadline = Date.now() + 25_000;
  while (resumer.get('job2', 'r1').state === 'in-flight' && Date.now() < deadline) await sleep(50);
  const rec = resumer.get('job2', 'r1');
  assert.equal(rec.state, 'stuck');
  assert.ok(rec.refusal.includes(SENTENCE), rec.refusal);
  assert.match(rec.refusal, /Max \$0\.10 left this month \(monthly limit \$0\.10\); this needs \$0\.\d\d\./);
  process.stdout.write(`PAGE REASON TEXT: ${JSON.stringify(rec.refusal)}\n`);
});
