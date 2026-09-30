// M6a POC — $0 tests for batch.mjs: key preflight, cap, fresh tag, ledger, key scrub.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, readdirSync, writeFileSync, mkdirSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../../scripts/tmp-track.mjs';
import { runBatch, scrub, ledgerTotalUsd, assertRoomForDraft } from './batch.mjs';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './fixture.mjs';

const KEY = 'sk-test-0123456789abcdef';
const quiet = () => {};
const outDir = () => mkdtempSync(path.join(tmpdir(), 'fwdloop-m6a-out-'));
const inj = (replies) => ({ provider: fakeProvider(replies), rates: RATES, modelId: MODEL });

function allFilesText(dir) {
  let text = '';
  for (const nm of readdirSync(dir, { recursive: true })) {
    const p = path.join(dir, nm);
    try { text += readFileSync(p, 'utf8'); } catch { /* directory */ }
  }
  return text;
}

test('happy path: n drafts, each booked in the ledger, summary counts valid', async () => {
  const dir = outDir();
  const { prose } = job2Fixture();
  const bad = validArgs();
  bad.steps[2].primitives = ['stash'];
  const provider = fakeProvider([toolReply(validArgs())]);
  const { records, summary } = await runBatch({
    n: 1, tag: 't1', proseText: prose, outDir: dir, injected: { provider, rates: RATES, modelId: MODEL }, writeLine: quiet, env: {},
  });
  assert.equal(records.length, 1);
  assert.equal(summary.valid, 1);
  const rows = readFileSync(path.join(dir, 'spend.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].step, 'draft-m6a');
  assert.ok(rows[0].costUsd > 0);
  assert.equal(existsSync(path.join(dir, 't1.summary.json')), true);
  const red = await runBatch({
    n: 1, tag: 't2', proseText: prose, outDir: dir, injected: { provider: fakeProvider([toolReply(bad)]), rates: RATES, modelId: MODEL }, writeLine: quiet, env: {},
  });
  assert.equal(red.summary.valid, 0);
  assert.equal(readFileSync(path.join(dir, 'spend.jsonl'), 'utf8').trim().split('\n').length, 2, 'a red draft is booked too');
});

test('(e) the cap refuses at $0: ledger + next draft budget over the cap -> no results, no provider call', async () => {
  const dir = outDir();
  const { prose } = job2Fixture();
  writeFileSync(path.join(dir, 'spend.jsonl'), `${JSON.stringify({ runId: 'x', model: MODEL, costUsd: 0.95 })}\n`);
  const provider = fakeProvider([toolReply(validArgs())]);
  await assert.rejects(
    runBatch({ n: 3, tag: 'capped', proseText: prose, outDir: dir, injected: { provider, rates: RATES, modelId: MODEL }, writeLine: quiet, env: {} }),
    /cap: ledger \$0\.9500 \+ next draft budget \$0\.10 could cross the \$1\.00 M6a cap/,
  );
  assert.equal(provider.calls.length, 0);
  assert.equal(existsSync(path.join(dir, 'capped.jsonl')), false);
});

test('(e2) an unpriced ledger row counts at its ceiling, never 0', () => {
  const dir = outDir();
  const p = path.join(dir, 'spend.jsonl');
  writeFileSync(p, `${JSON.stringify({ runId: 'x', model: MODEL, costUsd: null })}\n`);
  assert.ok(ledgerTotalUsd(p) > 0.02, 'deepseek-flash ceiling is ~$0.0288');
});

test('(e2b) an incomplete draft row counts its floor plus the unmetered ceiling, and the cap check refuses on it', () => {
  const dir = outDir();
  const p = path.join(dir, 'spend.jsonl');
  // round 1 priced $0.90, round 2 timed out unmetered: costUsd is only the floor
  writeFileSync(p, `${JSON.stringify({ kind: 'draft', model: MODEL, costUsd: 0.9, rounds: 1, calls: 2, spendComplete: false })}\n`);
  assert.ok(ledgerTotalUsd(p) >= 0.9 + 0.028, 'floor + one deepseek-flash ceiling');
  assert.throws(() => assertRoomForDraft(p, 1.0, 0.08), /cap: ledger/);
  // a complete row with the same floor would have been allowed
  writeFileSync(p, `${JSON.stringify({ kind: 'draft', model: MODEL, costUsd: 0.9, rounds: 2, calls: 2, spendComplete: true })}\n`);
  assert.doesNotThrow(() => assertRoomForDraft(p, 1.0, 0.08));
});

test('(e3) the cap trips MID-batch: later drafts do not start, the reason is recorded', async () => {
  const dir = outDir();
  const { prose } = job2Fixture();
  // room for exactly one draft: 0.8998 + 0.10 fits; after one $0.00054 draft the ledger is 0.90034 and +0.10 does not
  writeFileSync(path.join(dir, 'spend.jsonl'), `${JSON.stringify({ runId: 'x', model: MODEL, costUsd: 0.8998 })}\n`);
  const { records, summary } = await runBatch({
    n: 5, tag: 'mid', proseText: prose, outDir: dir, injected: inj([toolReply(validArgs())]), writeLine: quiet, env: {},
  });
  assert.equal(records.length, 1, 'draft 1 fit; the ledger then sat at ~$0.9003');
  assert.match(summary.stoppedBy, /^cap:/);
});

test('(f) key preflight refuses unset / empty / whitespace / newline keys at $0 — nothing written', async () => {
  const { prose } = job2Fixture();
  for (const [label, key] of [['unset', undefined], ['empty', ''], ['spaces', '   '], ['newline', 'sk-abcdefghijk\nsecondline']]) {
    const dir = outDir();
    const env = key === undefined ? {} : { DEEPSEEK_API_KEY: key };
    await assert.rejects(runBatch({ n: 1, tag: `k-${label}`, proseText: prose, outDir: dir, env, writeLine: quiet }), /key: DEEPSEEK_API_KEY/, label);
    assert.deepEqual(readdirSync(dir), [], `${label}: no ledger, no results`);
  }
});

test('a used tag refuses; a fresh tag proceeds', async () => {
  const dir = outDir();
  const { prose } = job2Fixture();
  const args = (tag) => ({ n: 1, tag, proseText: prose, outDir: dir, injected: inj([toolReply(validArgs())]), writeLine: quiet, env: {} });
  await runBatch(args('same'));
  await assert.rejects(runBatch(args('same')), /already has results/);
  await runBatch(args('other'));
});

test('(g) no key value in any written file — even when the model echoes it into a goal and a red', async () => {
  const dir = outDir();
  const { prose } = job2Fixture();
  const echo = validArgs();
  echo.steps[0].goal = `read it (key ${KEY})`;
  echo.steps[2].primitives = [`stash-${KEY}`]; // a red whose text echoes the key
  const { summary } = await runBatch({
    n: 1, tag: 'g', proseText: prose, outDir: dir, injected: inj([toolReply(echo)]), writeLine: quiet, env: { DEEPSEEK_API_KEY: KEY },
  });
  assert.equal(summary.keyLeaks, 0);
  const text = allFilesText(dir);
  assert.equal(text.includes(KEY), false, 'the key literal appears nowhere under out/');
  assert.ok(text.includes('[redacted-key]'), 'the echo was there and was scrubbed (the test can fail)');
});

test('scrub: literal, skips short secrets', () => {
  assert.equal(scrub(`a ${KEY} b`, [KEY]), 'a [redacted-key] b');
  assert.equal(scrub('abc abc', ['abc']), 'abc abc');
});
