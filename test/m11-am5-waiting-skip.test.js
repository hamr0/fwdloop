// M11 am5 ledger item 8 (src/panel/data.js jobWaitingLine): a run that has already ended is skipped by the `endRow` rule before a run context is built
// for it (`atAsk` needs no end row). Read fresh each call, no cache. The proof is the same answer in every case: waiting found at any age of run, an ended run's
// kept ask.json never counts, a run that ends stops counting on the very next read.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  appendFileSync, mkdirSync, renameSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { readFlow, writeRunJobCopy } from '../src/flow.js';
import { getRunDetail } from '../src/panel/data.js';
import { killChildrenAfter } from './m4e-world.mjs';
import { greenWorld } from './m9-trigger-world.mjs';

killChildrenAfter();
const CAT = loadCatalogue().primitives;

const endRowOf = (runId, outcome = 'complete') => `${JSON.stringify({ runId, at: '2026-10-13T10:00:00.000Z', outcome, spentUsd: 0.01, spendComplete: true, capUsd: 0.25, wallMs: 1, signatureHash: 'x' })}\n`;

async function fixture() {
  const g = await greenWorld();
  const read = readFlow({ root: g.w.root, name: 'job2', catalogue: CAT });
  const step = read.declaration.steps[0];
  const facts = { trigger: { kind: 'daily', hour: 9, minute: 0 }, armed: true, nextSlotMs: Date.now() + 3_600_000, lastOutcome: null, fires: [], hasGreenRun: true };
  /** a run that holds an ask.json; `open` = unexpired, paused at `step`; `ended` = also an end row */
  const run = (n, { ended = false, open = true } = {}) => {
    const runId = `run-${n}`;
    const runDir = path.join(g.flowDir, 'runs', runId);
    mkdirSync(runDir, { recursive: true });
    assert.equal(writeRunJobCopy(g.flowDir, runDir, read.signature.flow).ok, true);
    writeFileSync(path.join(runDir, 'ask.json'), JSON.stringify({ askId: `a${n}`, step: step.emits, deadline: new Date(Date.now() + (open ? 3_600_000 : -3_600_000)).toISOString() }));
    writeFileSync(path.join(runDir, 'audit.jsonl'), `${JSON.stringify({ step: step.emits, verdict: 'paused', at: '2026-10-13T09:00:00.000Z' })}\n`);
    if (ended) appendFileSync(path.join(g.flowDir, 'history.jsonl'), endRowOf(runId));
    return runId;
  };
  const next = (runId = 'seed-pass') => getRunDetail({ root: g.w.root, flow: 'job2', runId, catalogue: CAT, triggerRead: () => facts, now: () => Date.now() }).summary.scheduled.next;
  return { ...g, run, next, line: step.fromLine };
}

test('the waiting line is found under many ended runs that kept their ask.json, and is the same words as before', async () => {
  const f = await fixture();
  for (let n = 10; n < 40; n++) f.run(n, { ended: true });
  assert.doesNotMatch(f.next(), /Waiting for your answer/, 'ended runs holding an ask.json are not waiting');
  f.run(5);   // the OLDEST run is the one waiting
  assert.equal(f.next(), `Waiting for your answer at line ${f.line}; the next run waits too.`);
});

test('a waiting run that ends stops counting on the very next read (end row appended; no timestamp is compared)', async () => {
  const f = await fixture();
  const id = f.run(7);
  assert.match(f.next(), /Waiting for your answer/);
  appendFileSync(path.join(f.flowDir, 'history.jsonl'), endRowOf(id));
  assert.doesNotMatch(f.next(), /Waiting for your answer/);
});

test('a stopped run that holds an ask.json is not waiting; once a continue has taken it over (no end row) it is, as before', async () => {
  const f = await fixture();
  const id = f.run(8);
  const runDir = path.join(f.flowDir, 'runs', id);
  writeFileSync(path.join(runDir, 'halt.json'), '{}');
  appendFileSync(path.join(f.flowDir, 'history.jsonl'), endRowOf(id, 'stopped'));
  assert.doesNotMatch(f.next(), /Waiting for your answer/, 'stopped with halt.json: ended');
  renameSync(path.join(runDir, 'halt.json'), path.join(runDir, 'halt.1.consumed.json'));
  assert.match(f.next(), /Waiting for your answer/, 'continuing: the halt row is not its end');
});
