// M4d amendment 30 (signed 2026-10-19): try numbers keep counting after a Redo; each try's checks and output are matched by that number, never guessed.
// Must fail when (signed): a step shows the same try number twice; a try shows another try's checks or output; a try that saved no checks borrows a later try's.
// $0: the am29 world (real model step, fake provider).
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { buildWorld, CAT } from './m4d-am29-world.mjs';
import { getRunAudit, getRunDetail } from '../src/panel/data.js';
import { readAudit } from '../src/books.js';
import { readChecks, readCalls } from '../src/diary.js';
import { deriveFold } from '../src/audit-fold.js';

const audit = (w) => getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
const STEP = 'resume-summary';
const tryRows = (w) => readAudit(w.runDir).filter((r) => r.step === STEP && Number.isInteger(r.attempt));

test('A1: try numbers never restart after a Redo - the redone step shows 1, 2, 3 in the books, the diaries and the Audit fold', async () => {
  const w = await buildWorld({ redo: true });
  assert.equal(w.result.outcome, 'complete', w.result.red);
  assert.deepEqual(tryRows(w).map((r) => r.attempt), [1, 2, 3], 'audit.jsonl: each number once');
  assert.deepEqual(readChecks(w.runDir).filter((c) => c.step === STEP).map((c) => c.try), [1, 2, 3], 'checks.jsonl');
  assert.deepEqual([...new Set(readCalls(w.runDir).filter((c) => c.step === STEP).map((c) => c.try))], [1, 2, 3], 'calls.jsonl');
  const f = audit(w).groups.find((g) => g.step === STEP).fold;
  assert.deepEqual(f.tries.map((t) => t.n), [1, 2, 3], 'the Audit fold');
  assert.deepEqual(f.rows.filter((r) => r.action === 'model call').map((r) => r.try).filter((x, i, a) => a.indexOf(x) === i), [1, 2, 3]);
});

test('A2: each try shows its OWN checks and output (matched by number, not by order)', async () => {
  const w = await buildWorld({ redo: true });
  const f = audit(w).groups.find((g) => g.step === STEP).fold;
  const saved = readChecks(w.runDir).filter((c) => c.step === STEP);
  for (const t of f.tries) {
    const rec = saved.find((c) => c.try === t.n);
    assert.deepEqual(t.checks, rec.checks, `try ${t.n} checks`);
    assert.deepEqual(t.output, rec.output, `try ${t.n} output`);
  }
  assert.ok(f.tries[0].checks.some((c) => !c.ok), 'try 1 failed a check');
  assert.ok(f.tries[2].checks.every((c) => c.ok), 'the redone try passed all its checks');
  const d = getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT });
  assert.match(d.runLines.checks, /resume-summary try 1\)$/, 'the summary names the same try number');
});

test('A3: the Redo allows the same number of tries as before; only the number shown moved', async () => {
  const w = await buildWorld({ redo: true, redoFails: true });
  const nums = tryRows(w).map((r) => r.attempt);
  // run one: try 1 red, try 2 green. The Redo's re-run strikes out after three tries (the same three it had when it restarted at 2).
  assert.equal(nums.length, 2 + 3, 'redone step: exactly 3 tries, as before am30');
  assert.deepEqual(nums, [1, 2, 3, 4, 5]);
});

// the fold alone, with hand-made books: the old runs on disk (numbers repeated by the pre-am30 Redo) and an unsaved try
const row = (attempt, verdict) => ({ step: STEP, attempt, verdict, gap: verdict === 'red' ? 'gap' : null });
const chk = (t, tag) => ({ step: STEP, try: t, at: 't', lastRound: 1, checks: [{ n: 1, ok: tag === 'bad' ? false : true, label: tag }], output: { file: `${tag}.json` } });
const diaries = (checks) => ({ present: true, calls: [], tools: [], checks });
const foldOf = (rows, checks) => deriveFold({ rows, tryMarks: rows.map(() => '✓'), closeClass: null }, diaries(checks));

test('A4: a try that saved no checks shows none - it never borrows a later try\'s (unique numbers)', () => {
  const f = foldOf([row(1, 'provider-red'), row(2, 'green')], [chk(2, 'second')]);
  assert.deepEqual(f.tries.map((t) => [t.n, t.checks.length, t.output?.file ?? null]), [[1, 0, null], [2, 1, 'second.json']]);
});

test('A5: an old run (number repeated, one try unsaved) shows no checks for the repeated number rather than another try\'s', () => {
  // pre-am30: try 2, a provider-red that saved nothing, then (after a Redo) a second try 2 that saved
  const f = foldOf([row(1, 'red'), row(2, 'provider-red'), row(2, 'green')], [chk(1, 'one'), chk(2, 'late')]);
  assert.deepEqual(f.tries.map((t) => [t.n, t.output?.file ?? null]), [[1, 'one.json'], [2, null], [2, null]], 'the unsaved try must not wear the later try\'s output');
});

test('A6: an old run whose repeated number saved every time still pairs them in order', () => {
  const f = foldOf([row(1, 'red'), row(2, 'green'), row(2, 'green')], [chk(1, 'one'), chk(2, 'a'), chk(2, 'b')]);
  assert.deepEqual(f.tries.map((t) => t.output?.file ?? null), ['one.json', 'a.json', 'b.json']);
});
