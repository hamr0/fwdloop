// M4e piece 2a, item 7 (scope 13; negatives (xvi) (xviii)): drafting spend is booked PER CALL in the draft dir and
// counted by Money / the monthly check from there, once. $0: the real CLI child with the test draft provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { spendSummary, readRuns, claimHold } from '../src/monthly.js';
import { readSpendRows, spendRowCost, ceilingCostUsd } from '../src/provider.js';
import { signDraft } from '../src/authoring.js';
import { DRAFT_SPEND_FILE } from '../src/draftspend.js';
import { job2Fixture, MODEL, RATES } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
const FAKE_STEP = path.join(HERE, 'fixtures', 'm4e-fake-model-step.mjs');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-ds-${p}-`));

const newHome = (limit) => {
  const home = path.join(tmp('cfg'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (limit !== undefined) writeFileSync(path.join(home, 'config.json'), JSON.stringify({ monthlyLimitUsd: limit }));
  return home;
};
const envFor = (home, extra = {}) => ({
  PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, FWDLOOP_TEST_MODEL_STEP: FAKE_STEP, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, ...extra,
});
const draftArgs = (prose, out, root, name) => ['draft', prose, '--out', out, '--root', root, '--name', name];
function proseFile() {
  const work = tmp('w');
  const f = path.join(work, 'prose.txt');
  writeFileSync(f, job2Fixture().prose);
  return { work, f };
}
/** The cost of ONE round at the fake provider's usage (1000 in / 200 out at RATES, per 1k tokens). */
const ROUND_USD = (1000 / 1000) * RATES.in + (200 / 1000) * RATES.out;
const ceiling = () => ceilingCostUsd(MODEL, undefined, { prices: { rates: RATES } });

test('(xvi/xviii) a draft killed between rounds keeps the round it paid for, plus one ceiling for the call in flight; Money and the monthly check count it', async () => {
  const home = newHome(5);
  const { work, f } = proseFile();
  const out = path.join(work, 'd');
  const child = spawn(process.execPath, [BIN, ...draftArgs(f, out, path.join(work, 'flows'), 'x')], { env: envFor(home, { FWDLOOP_TEST_DRAFT_MODE: 'hang' }), stdio: 'ignore' });
  const gone = new Promise((r) => { child.on('exit', r); });
  const live = path.join(out, DRAFT_SPEND_FILE);
  const read = () => { try { return JSON.parse(readFileSync(live, 'utf8')); } catch { return null; } };
  let rec;
  try {
    const t0 = Date.now();
    while (!(read()?.inFlight === true && read()?.rounds === 1) && Date.now() - t0 < 20_000) await sleep(20); // eslint-disable-line no-await-in-loop
    rec = read();
    assert.equal(rec?.inFlight, true, 'round 2 is in flight');
  } finally {
    child.kill('SIGKILL'); // no exit hook runs: the monthly hold stays open, spend.jsonl is never written
  }
  await gone;
  assert.equal(existsSync(path.join(out, 'spend.jsonl')), false, 'killed before the final row');
  const want = ROUND_USD + ceiling();
  assert.ok(Math.abs(spendRowCost(rec).usd - want) < 1e-9);
  const sum = spendSummary({ home });
  assert.ok(Math.abs(sum.total.usd - want) < 1e-9, `total ${sum.total.usd} vs ${want}`);
  assert.equal(sum.total.atLeast, true, 'an in-flight call is an "at least", never a bare number');
  assert.ok(Math.abs(sum.month.usd - want) < 1e-9, 'it counts in this month too');
  // the monthly check sees it: a limit just under what is already spent leaves $0 room for a new hold
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ monthlyLimitUsd: want + 0.001 }));
  const claim = claimHold({ what: 'draft', flow: 'y', runId: null, runDir: path.join(work, 'd2'), holdUsd: 0.05, home });
  assert.equal(claim.ok, false);
  assert.ok(claim.room.leftUsd < 0.01, `left ${claim.room.leftUsd}`);
});

test('(xviii) a finished draft is counted ONCE: the final spend.jsonl row supersedes draft-spend.json, never added to it', () => {
  const home = newHome(5);
  const { work, f } = proseFile();
  const out = path.join(work, 'd');
  const r = spawnSync(process.execPath, [BIN, ...draftArgs(f, out, path.join(work, 'flows'), 'x')], { env: envFor(home), encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  const rows = readSpendRows(path.join(out, 'spend.jsonl'));
  assert.equal(rows.length, 1);
  assert.ok(existsSync(path.join(out, DRAFT_SPEND_FILE)), 'the per-call record is still on disk');
  const live = JSON.parse(readFileSync(path.join(out, DRAFT_SPEND_FILE), 'utf8'));
  assert.equal(live.inFlight, false);
  assert.equal(live.spendComplete, true);
  const sum = spendSummary({ home });
  assert.ok(Math.abs(sum.total.usd - rows[0].costUsd) < 1e-12, `total ${sum.total.usd} vs the one row ${rows[0].costUsd}`);
  assert.equal(sum.total.atLeast, false);
});

test('(xviii) a draft that is signed and run is counted once: the run\'s books never carry the draft\'s spend', () => {
  const home = newHome(5);
  const { work, f } = proseFile();
  const root = path.join(work, 'flows');
  mkdirSync(root);
  const out = path.join(root, '.drafts', 'd1', 'draft');
  const d = spawnSync(process.execPath, [BIN, ...draftArgs(f, out, root, 'job2')], { env: envFor(home), encoding: 'utf8', timeout: 30_000 });
  assert.equal(d.status, 0, d.stderr);
  const draftUsd = readSpendRows(path.join(out, 'spend.jsonl'))[0].costUsd;
  const hash = readFileSync(path.join(out, 'spec.hash'), 'utf8').trim();
  const signed = signDraft({ dir: out, approve: hash, signedBy: 'test' });
  assert.equal(signed.ok, true, JSON.stringify(signed.reds));
  const before = spendSummary({ home }).total.usd;
  assert.ok(Math.abs(before - draftUsd) < 1e-12);
  const fx = job2Fixture();
  const run = spawnSync(process.execPath, [BIN, 'run', 'job2', '--root', root, '--source', `resume=${fx.resume}`, '--source', `jd=${fx.jd}`, '--run-id', 'r1'], {
    env: envFor(home, { FWDLOOP_TEST_DRAFT_PROVIDER: '' }), encoding: 'utf8', timeout: 60_000,
  });
  assert.equal(run.status, 0, run.stderr + run.stdout);
  const runSpend = path.join(root, 'job2', 'runs', 'r1', 'spend.jsonl');
  const runRows = existsSync(runSpend) ? readSpendRows(runSpend) : [];
  assert.ok(runRows.every((r) => r.kind !== 'draft'), 'no draft row in the run\'s books');
  const runUsd = runRows.reduce((n, r) => n + spendRowCost(r).usd, 0);
  assert.ok(runUsd > 0, 'the run booked its own spend');
  const holds = readRuns(home).filter((r) => r.kind === 'hold').map((r) => r.what).sort();
  assert.deepEqual(holds, ['draft', 'run']);
  const sum = spendSummary({ home });
  assert.ok(Math.abs(sum.total.usd - (draftUsd + runUsd)) < 1e-12, `total ${sum.total.usd} = draft ${draftUsd} + run ${runUsd}`);
});

test('drafter: onBook is told before and after each call, and a booking that fails BEFORE a call stops it — no provider call is made', async () => {
  const { draft } = await import('../src/drafter.js');
  const { fakeProvider, toolReply, validArgs } = await import('./drafter-fixture.mjs');
  const fx = job2Fixture();
  const seen = [];
  const p = fakeProvider([toolReply(validArgs())]);
  const ok = await draft({
    proseText: fx.prose, provider: p, rates: RATES, modelId: MODEL, onBook: (b) => seen.push([b.inFlight, b.calls, b.metered.rounds]),
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(seen, [[true, 1, 0], [false, 1, 1]]);
  const p2 = fakeProvider([toolReply(validArgs())]);
  await assert.rejects(draft({
    proseText: fx.prose, provider: p2, rates: RATES, modelId: MODEL, onBook: () => { throw new Error('disk full'); },
  }), /disk full/);
  assert.equal(p2.calls.length, 0, 'the call was never made');
});
