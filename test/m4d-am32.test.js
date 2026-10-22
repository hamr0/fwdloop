// M4d amendment 32 (signed 2026-10-19): a draft frees its cap when its result is written, not when the process exits.
// Must fail when (signed): a draft reads done but its hold is still there; a Draft posted right after one finishes is refused.
// $0, no network: the fake draft provider; an exit-delay preload keeps draft A alive after its result is on disk.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  writeFileSync, mkdirSync, existsSync, readFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { readRuns } from '../src/monthly.js';
import { job2Fixture } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
const DELAY = path.join(HERE, 'fixtures', 'm4d-am32-exit-delay.mjs');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am32-${p}-`));
const EXIT_DELAY_MS = 5000;

const newHome = (limit) => {
  const home = path.join(tmp('cfg'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ monthlyLimitUsd: limit }));
  return home;
};
const envFor = (home, extra = {}) => ({
  PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, ...extra,
});
const draftArgs = (work, out) => ['draft', path.join(work, 'prose.txt'), '--out', out, '--root', path.join(work, 'flows'), '--name', 'x'];

/** Draft A starts, and its result lands; B is posted the instant A's result reads done, while A is still alive (exit delayed). */
async function bAfterADone(mode) {
  const home = newHome(0.30); // one draft's hold is $0.25: one fits, two do not
  const work = tmp('w');
  writeFileSync(path.join(work, 'prose.txt'), job2Fixture().prose);
  const outA = path.join(work, 'a');
  const a = spawn(process.execPath, [BIN, ...draftArgs(work, outA)], {
    // NODE_OPTIONS, not `node --import <file>`: the liveness check reads the first non-option argument as the script, and must still see bin/fwdloop
    env: envFor(home, { NODE_OPTIONS: `--import ${DELAY}`, M4D_EXIT_DELAY_MS: String(EXIT_DELAY_MS), ...(mode ? { FWDLOOP_TEST_DRAFT_MODE: mode } : {}) }), stdio: ['ignore', 'pipe', 'pipe'],
  });
  let aErr = '';
  a.stderr.on('data', (d) => { aErr += d; });
  const aExit = new Promise((res) => { a.on('exit', (code) => res(code)); });
  // "reads done" as the panel reads it: green = spec.hash; red = a log that says not ok
  const done = () => {
    if (existsSync(path.join(outA, 'spec.hash'))) return true;
    try { return JSON.parse(readFileSync(path.join(outA, 'log.json'), 'utf8')).ok === false; } catch { return false; }
  };
  const deadline = Date.now() + 20_000;
  while (!done() && Date.now() < deadline) await sleep(5); // eslint-disable-line no-await-in-loop
  assert.ok(done(), `draft A never finished: ${aErr}`);
  const aStillAlive = a.exitCode === null;
  const b = spawnSync(process.execPath, [BIN, ...draftArgs(work, path.join(work, 'b'))], { env: envFor(home), encoding: 'utf8', timeout: 30_000 });
  const aWasStillAlive = aStillAlive && a.exitCode === null;
  const aCode = await aExit;
  return { home, b, aCode, aWasStillAlive };
}

for (const [label, mode] of [['green', undefined], ['red', 'bad']]) {
  test(`A1 (${label}): a Draft posted the instant the previous draft reads done is accepted, while that draft's process is still alive`, async () => {
    const r = await bAfterADone(mode);
    assert.ok(r.aWasStillAlive, 'the test did not hold A open: nothing proven');
    assert.ok(!r.b.stderr.includes('held by a run in progress'), `B refused: ${r.b.stderr}`);
    assert.ok(!r.b.stderr.includes('this month'), `B refused: ${r.b.stderr}`);
    assert.equal(r.b.stdout.includes('draft dir:'), true, `B did not draft: ${r.b.stdout} ${r.b.stderr}`);
    assert.equal(r.aCode, mode ? 1 : 0);
  });
}

test('A2: settling twice is safe - the early settle and the exit backstop leave exactly one settled row for the hold', async () => {
  const r = await bAfterADone(undefined);
  const rows = readRuns(r.home);
  const holds = rows.filter((x) => x.kind === 'hold');
  assert.equal(holds.length, 2, 'A and B each took a hold');
  for (const h of holds) assert.equal(rows.filter((x) => x.kind === 'settled' && x.holdId === h.holdId).length, 1, `hold ${h.holdId} settled once`);
});
