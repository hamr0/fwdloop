// M4e amendment 16, group 4 "Code" (SIGNED 2026-10-08): C3, C4, C5. $0: fake keys, scratch config homes (all removed at exit).
// Never reads the real keys file: every key here is a fake value in a scratch home.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  chmodSync, mkdirSync, readFileSync, rmSync, writeFileSync, existsSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import * as authoring from '../src/authoring.js';
import * as monthly from '../src/monthly.js';
import { loadKeysEnv, keysForDoor, KEY_NAMES } from '../src/keysfile.js';
import { spawnDetached } from '../src/panel/spawn.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const scratch = (tag) => mkdtempSync(path.join(tmpdir(), `fwdloop-am16c-${tag}-`));

// ---- C3: one function checks the draft's API key ---------------------------------------------------------------------------------
const BAD_KEYS = [
  ['unset', {}],
  ['empty', { DEEPSEEK_API_KEY: '' }],
  ['newline', { DEEPSEEK_API_KEY: 'sk-fake-one\nsk-fake-two' }],
  ['space', { DEEPSEEK_API_KEY: 'sk-fake key' }],
];

test('C3: authoring exports the ONE draft-key check; a clean key passes, a bad one returns the sentence (never the value)', () => {
  assert.equal(typeof authoring.draftKeyRefusal, 'function', 'draftKeyRefusal is exported by src/authoring.js');
  assert.equal(authoring.draftKeyRefusal('deepseek', { DEEPSEEK_API_KEY: 'sk-fake-clean-value' }), null);
  for (const [what, env] of BAD_KEYS) {
    const said = authoring.draftKeyRefusal('deepseek', env);
    assert.match(String(said), /^key: DEEPSEEK_API_KEY /, what);
    assert.ok(!String(said).includes('sk-fake'), `${what}: the value is never in the sentence`);
  }
});

test('C3: the CLI and draftToDir refuse the same way, at $0, with no dir (both call the one check)', async () => {
  const work = scratch('c3');
  assert.equal(typeof authoring.draftKeyRefusal, 'function', 'the one check exists');
  try {
    const prose = path.join(work, 'prose.txt');
    writeFileSync(prose, 'Write a one-line note.\n');
    for (const [what, env] of BAD_KEYS) {
      const out = path.join(work, `draft-${what}`);
      const viaAuthoring = await authoring.draftToDir({
        proseFile: prose, dir: out, root: path.join(work, 'flows'), name: 'job', env,
      });
      assert.equal(viaAuthoring.wrote, false, what);
      assert.equal(viaAuthoring.costUsd, 0, what);
      const said = authoring.draftKeyRefusal('deepseek', env);
      assert.deepEqual(viaAuthoring.reds, [said], `${what}: draftToDir's refusal is the one function's sentence`);
      const cli = spawnSync(process.execPath, [BIN, 'draft', prose, '--out', path.join(work, `cli-${what}`), '--root', path.join(work, 'flows'), '--name', 'job'], {
        encoding: 'utf8', env: { PATH: process.env.PATH ?? '', NODE_TEST_CONTEXT: 'child-v8', ...env },
      });
      assert.notEqual(cli.status, 0, what);
      assert.equal(cli.stderr, `fwdloop: draft refused at $0 — ${said}\n`, `${what}: the CLI says the same sentence`);
      assert.equal(existsSync(path.join(work, `cli-${what}`)), false, `${what}: nothing written`);
      assert.equal(existsSync(out), false, `${what}: nothing written`);
    }
  } finally { rmSync(work, { recursive: true, force: true }); }
});

// ---- C4: the keys file passes only KEY_NAMES to a child ----------------------------------------------------------------------------
function fakeHome(lines) {
  const home = scratch('c4');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, '.env'), `${lines.join('\n')}\n`, { mode: 0o600 });
  chmodSync(path.join(home, '.env'), 0o600);
  return home;
}

test('C4: loadKeysEnv fills only KEY_NAMES from the file; other names are still listed but never reach the env', () => {
  const home = fakeHome(['NODE_OPTIONS=--require=/tmp/x', 'LD_PRELOAD=/tmp/y', `${KEY_NAMES[0]}=sk-fake-known-key`]);
  try {
    const r = loadKeysEnv({ env: { PATH: '/bin' }, home });
    assert.equal(r.ok, true);
    assert.equal(r.env[KEY_NAMES[0]], 'sk-fake-known-key', 'the known key gets through');
    assert.equal(r.env.NODE_OPTIONS, undefined, 'NODE_OPTIONS from the file never reaches the env');
    assert.equal(r.env.LD_PRELOAD, undefined);
    assert.ok(r.names.includes('NODE_OPTIONS'), 'Settings still lists the name');
    assert.ok(!JSON.stringify({ ...r, env: undefined }).includes('--require'), 'no value outside env');
  } finally { rmSync(home, { recursive: true, force: true }); }
});

test('C4: a spawned child (the panel spawn helper, fed by the keys door) sees the known key and no NODE_OPTIONS', async () => {
  const home = fakeHome(['NODE_OPTIONS=--require=/tmp/x', `${KEY_NAMES[0]}=sk-fake-known-key`]);
  const work = scratch('c4-child');
  try {
    const bin = path.join(work, 'probe.mjs');
    const outFile = path.join(work, 'seen.json');
    writeFileSync(bin, `import { writeFileSync } from 'node:fs'; writeFileSync(${JSON.stringify(outFile)}, JSON.stringify({ opts: process.env.NODE_OPTIONS ?? null, key: process.env[${JSON.stringify(KEY_NAMES[0])}] ?? null }));\n`);
    const door = keysForDoor({ env: { PATH: process.env.PATH }, keysHome: home });
    assert.equal(door.ok, true);
    const child = spawnDetached({ bin, argv: [], env: door.env, logPath: path.join(work, 'child.log') });
    for (let i = 0; i < 100 && !existsSync(outFile); i += 1) await new Promise((r) => { setTimeout(r, 50); }); // the child is unref'd: poll, don't wait on its exit
    assert.ok(existsSync(outFile), 'the child ran to the end (a NODE_OPTIONS --require of a missing file kills it first)');
    assert.deepEqual(JSON.parse(readFileSync(outFile, 'utf8')), { opts: null, key: 'sk-fake-known-key' });
  } finally { rmSync(home, { recursive: true, force: true }); rmSync(work, { recursive: true, force: true }); }
});

// ---- C5: the unreachable `if (!read.ok)` is gone -----------------------------------------------------------------------------------
test('C5: runAgain has no `if (!read.ok)` after canFlowRun, which has already refused every unreadable flow', () => {
  const text = readFileSync(path.join(HERE, '..', 'src', 'panel', 'authorflows.js'), 'utf8');
  const hits = text.split('\n').map((l, i) => [i, l]).filter(([, l]) => /^\s*if \(!read\.ok\) return no\(/.test(l));
  assert.deepEqual(hits.map(([i]) => i + 1), [], 'the unreachable one-line branch is removed');
});

// ---- I1: settled runs roll up; no month total changes ------------------------------------------------------------------------------
const NOW = Date.parse('2026-10-08T12:00:00Z');
const dayIso = (daysAgo) => new Date(NOW - daysAgo * 86400000).toISOString();

/** A scratch config home with `n` settled runs: mixed providers, months, an undated row, a bad date, an unpriced row and a draft-live dir. */
function rollWorld(n) {
  const base = scratch('i1');
  const home = path.join(base, 'cfg');
  mkdirSync(home, { mode: 0o700 });
  const lines = [];
  const dirs = [];
  for (let i = 0; i < n; i += 1) {
    const dir = path.join(base, 'runs', `run-${i + 1}`);
    mkdirSync(dir, { recursive: true });
    const at = dayIso(i % 45);
    const prov = i % 3 === 0 ? 'synthetic' : 'deepseek';
    const rows = [
      { kind: 'step', provider: prov, costUsd: 0.001 * (i + 1), spendComplete: true, tokens: { inputTokens: 900 + i, outputTokens: 50 }, wallMs: 1000 + i, at },
      { kind: 'step', provider: prov, costUsd: null, model: 'deepseek-flash', spendComplete: true, tokens: null, at },
    ];
    if (i === 1) rows.push({ kind: 'step', provider: 'deepseek', costUsd: 0.02, spendComplete: true });           // undated
    if (i === 2) rows.push({ kind: 'step', provider: 'deepseek', costUsd: 0.03, spendComplete: true, at: 'not a date' }); // unknown date
    if (i === 4) rows.push({ kind: 'step', costUsd: 0.04, spendComplete: false, calls: 3, rounds: 1, model: 'deepseek-flash', at });
    writeFileSync(path.join(dir, 'spend.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
    dirs.push(dir);
    lines.push({ kind: 'hold', holdId: `h${i}`, what: 'run', flow: 'job', runId: `run-${i + 1}`, runDir: dir, pid: 1, procStart: null, holdUsd: 0.25, spentAtHold: 0, at });
    lines.push({ kind: 'settled', holdId: `h${i}`, at, why: 'ended or parked' });
  }
  const live = path.join(base, 'drafts', 'd1');                       // a draft dir with only its live record
  mkdirSync(live, { recursive: true });
  writeFileSync(path.join(live, 'draft-spend.json'), JSON.stringify({ kind: 'draft-live', provider: 'deepseek', model: 'deepseek-flash', costUsd: 0.005, rounds: 1, calls: 1, spendComplete: true, at: dayIso(1) }));
  lines.push({ kind: 'hold', holdId: 'hd', what: 'draft', flow: 'job', runId: null, runDir: live, pid: 1, procStart: null, holdUsd: 0.25, spentAtHold: 0, at: dayIso(1) });
  lines.push({ kind: 'settled', holdId: 'hd', at: dayIso(1), why: 'ended or parked' });
  const write = () => writeFileSync(path.join(home, 'runs.jsonl'), `${lines.map((l) => JSON.stringify(l)).join('\n')}\n`);
  write();
  return {
    base, home, dirs, live, lines, write,
  };
}
const summary = (home) => monthly.spendSummary({ home, now: () => NOW });

test('I1: rollSettled folds settled dirs; every figure of spendSummary is identical, and the dirs are no longer read', () => {
  assert.equal(typeof monthly.rollSettled, 'function', 'rollSettled is exported');
  const w = rollWorld(450);                                           // > 2 rolled rows (200 dirs each)
  try {
    const before = summary(w.home);
    assert.ok(before.undatedRows >= 1 && before.month.usd > 0 && Object.keys(before.byProvider).length >= 3, 'the world is not trivial');
    monthly.rollSettled({ home: w.home, now: () => NOW });
    const rolledRows = monthly.readRuns(w.home).filter((r) => r.kind === 'rolled');
    assert.equal(rolledRows.length, 3, '451 dirs in chunks of 200');
    for (const d of [...w.dirs, w.live]) rmSync(path.join(d, d === w.live ? 'draft-spend.json' : 'spend.jsonl'));
    assert.deepEqual(summary(w.home), before, 'the rolled record gives the very same summary with every dir file gone');
    const rowCount = monthly.readRuns(w.home).length;
    monthly.rollSettled({ home: w.home, now: () => NOW });
    assert.equal(monthly.readRuns(w.home).length, rowCount, 'a second roll with nothing new appends nothing');
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});

test('I1: a dir named again after the snapshot (a resume) is read live, and its new spend counts; an open hold is never rolled', () => {
  const w = rollWorld(5);
  try {
    monthly.rollSettled({ home: w.home, now: () => NOW });
    const before = summary(w.home);
    // a resume: a new hold names run-1's dir, and the dir gets another row
    const newRow = { kind: 'step', provider: 'deepseek', costUsd: 0.5, spendComplete: true, at: dayIso(0) };
    writeFileSync(path.join(w.dirs[0], 'spend.jsonl'), `${readFileSync(path.join(w.dirs[0], 'spend.jsonl'), 'utf8')}${JSON.stringify(newRow)}\n`);
    writeFileSync(path.join(w.home, 'runs.jsonl'), `${readFileSync(path.join(w.home, 'runs.jsonl'), 'utf8')}${JSON.stringify({
      kind: 'hold', holdId: 'resume1', what: 'resume', flow: 'job', runId: 'run-1', runDir: w.dirs[0], pid: process.pid, procStart: null, holdUsd: 0.25, spentAtHold: 0, at: dayIso(0),
    })}\n`);
    assert.ok(Math.abs(summary(w.home).month.usd - (before.month.usd + 0.5)) < 1e-9, 'the new spend of the named-again dir is counted');
    // that hold is open, so a roll must not fold run-1's dir again
    monthly.rollSettled({ home: w.home, now: () => NOW });
    const last = monthly.readRuns(w.home).filter((r) => r.kind === 'rolled').pop();
    assert.ok(!Object.hasOwn(last?.dirs ?? {}, w.dirs[0]) || last.seen < monthly.readRuns(w.home).findIndex((r) => r.holdId === 'resume1'), 'an open hold is not folded');
    // a snapshot read BEFORE the naming row (a racing roll) never hides it: seen is lower than the naming row's index
    const rows = monthly.readRuns(w.home);
    const stale = { kind: 'rolled', at: dayIso(0), seen: 2, dirs: { [w.dirs[0]]: [{ u: 0.001, c: true, t: 0, w: null, p: 'deepseek', a: dayIso(0) }] } };
    writeFileSync(path.join(w.home, 'runs.jsonl'), `${rows.concat([stale]).map((r) => JSON.stringify(r)).join('\n')}\n`);
    assert.ok(Math.abs(summary(w.home).month.usd - (before.month.usd + 0.5)) < 1e-9, 'a stale snapshot is ignored');
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});

test('I1: settleHold rolls the run it just settled; a torn or foreign rolled row never changes a figure', () => {
  const w = rollWorld(3);
  try {
    const before = summary(w.home);
    const claim = monthly.claimHold({
      what: 'run', flow: 'job', runId: 'run-9', runDir: path.join(w.base, 'runs', 'run-9'), holdUsd: 0.25, home: w.home, now: () => NOW,
    });
    mkdirSync(path.join(w.base, 'runs', 'run-9'), { recursive: true });
    writeFileSync(path.join(w.base, 'runs', 'run-9', 'spend.jsonl'), `${JSON.stringify({ kind: 'step', provider: 'deepseek', costUsd: 0.07, spendComplete: true, at: dayIso(0) })}\n`);
    monthly.settleHold({ holdId: claim.holdId, why: 'ended or parked', home: w.home, now: () => NOW });
    const rolled = monthly.readRuns(w.home).filter((r) => r.kind === 'rolled');
    assert.ok(rolled.some((r) => Object.keys(r.dirs).some((d) => d.endsWith('run-9'))), 'the settled run is rolled');
    assert.ok(Math.abs(summary(w.home).month.usd - (before.month.usd + 0.07)) < 1e-9);
    writeFileSync(path.join(w.home, 'runs.jsonl'), `${readFileSync(path.join(w.home, 'runs.jsonl'), 'utf8')}{"kind":"rolled","seen":\n${JSON.stringify({ kind: 'rolled', seen: 'x', dirs: 5 })}\n`);
    assert.ok(Math.abs(summary(w.home).month.usd - (before.month.usd + 0.07)) < 1e-9, 'junk rolled rows are ignored');
  } finally { rmSync(w.base, { recursive: true, force: true }); }
});
