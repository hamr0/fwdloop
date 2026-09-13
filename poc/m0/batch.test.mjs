// M0b stability batch (Amendment C) — $0 tests. Every spawn is a fake
// EventEmitter (never a real child process) and every TTY read is an
// injected function (never real stdin) — zero live model calls, zero real
// subprocesses, ever, under `node --test`.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  writeFileSync, mkdirSync, mkdtempSync, existsSync, readFileSync, readdirSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OUT_DIR } from './runner.mjs';
import {
  EXPECTED_BY_PLANT, classifyVerdict, sumRunCost, batchFilePath, writeBarFile, appendRunRecord,
  shouldStopBatch, renderAskBlock, promptAndAnswer, parseRunnerStdout, runOneBatchRun, runBatch,
} from './batch.mjs';

// Pollution guard (hamr's review, 2026-09-13): every test below must pass its own outDir (a
// mkdtempSync temp dir) to runOneBatchRun/runBatch/batchFilePath — none of them may touch the
// REAL poc/m0/out/. Snapshotted here, at module load, before any test runs; compared against the
// same listing at the very end of this file (the last test), so any test that forgets outDir and
// leaves a batch-*/m0b-*-test* entry in the real OUT_DIR turns that final test red.
const REAL_OUT_DIR_SNAPSHOT_BEFORE = new Set(readdirSync(OUT_DIR));

const __dirname = dirname(fileURLToPath(import.meta.url));

// ---------------------------------------------------------------------------
// classifyVerdict — pure, keyed on typed fields + the close's own red shape.
// ---------------------------------------------------------------------------

test('classifyVerdict: plant a passes on the exact expected outcome/phase/red shape', () => {
  const verdict = classifyVerdict('a', { outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700' }, null, false);
  assert.equal(verdict, 'pass');
});

test('PROOF: plant a with the right outcome/phase but WRONG red text is a miss', () => {
  const verdict = classifyVerdict('a', { outcome: 'red', phase: 'derive', red: 'something else entirely' }, null, false);
  assert.equal(verdict, 'miss');
});

test('classifyVerdict: plant b passes on its exact expected shape', () => {
  const verdict = classifyVerdict('b', { outcome: 'red', phase: 'derive', red: 'c1 4300 ≠ cell E2 = 4200' }, null, false);
  assert.equal(verdict, 'pass');
});

test('PROOF: plant b with the right phase but a DIFFERENT cell mismatch is a miss', () => {
  const verdict = classifyVerdict('b', { outcome: 'red', phase: 'derive', red: 'c2 999 ≠ cell E3 = 1500' }, null, false);
  assert.equal(verdict, 'miss');
});

test('classifyVerdict: plant e passes on its exact expected shape (either declared field)', () => {
  assert.equal(classifyVerdict('e', { outcome: 'red', phase: 'compose', red: 'compose: declared field "total_owed" (5700, c3) does not appear cited in the reply' }, null, false), 'pass');
  assert.equal(classifyVerdict('e', { outcome: 'red', phase: 'compose', red: 'compose: declared field "earliest_due" (2026-05-20, c4) does not appear cited in the reply' }, null, false), 'pass');
});

test('PROOF: plant e reporting "count_overdue" (not in the pattern) is a miss', () => {
  const verdict = classifyVerdict('e', { outcome: 'red', phase: 'compose', red: 'compose: declared field "count_overdue" (1, c8) does not appear cited in the reply' }, null, false);
  assert.equal(verdict, 'miss');
});

test('classifyVerdict: plant c passes on paused-ask-answered / messageMatch-ambiguous, WITH this batch\'s human accept', () => {
  const verdict = classifyVerdict('c', { outcome: 'paused-ask-answered', phase: 'messageMatch-ambiguous', red: null }, 'human-tty', false);
  assert.equal(verdict, 'pass');
});

test('PROOF: plant c reaching derive instead (a silent pick) is a miss', () => {
  const verdict = classifyVerdict('c', { outcome: 'red', phase: 'derive', red: 'anything' }, 'human-tty', false);
  assert.equal(verdict, 'miss');
});

test('classifyVerdict: plant d passes on complete + a real non-empty sent file, WITH this batch\'s human accept', () => {
  assert.equal(classifyVerdict('d', { outcome: 'complete', phase: null, red: null }, 'human-tty', true), 'pass');
});

test('PROOF: plant d complete but the sent file is missing/empty is a miss, never a pass', () => {
  assert.equal(classifyVerdict('d', { outcome: 'complete', phase: null, red: null }, 'human-tty', false), 'miss');
});

// hamr's review (2026-09-13): a pass on c/d must come from THIS batch's own human accept.
test('FIX 1: plant d complete with answeredBy null (not this batch\'s accept) is a miss, never a pass', () => {
  const verdict = classifyVerdict('d', { outcome: 'complete', phase: null, red: null }, null, true);
  assert.equal(verdict, 'miss');
});

test('PROOF FIX 1 can fail: the SAME shape with answeredBy "human-tty" is a pass', () => {
  const verdict = classifyVerdict('d', { outcome: 'complete', phase: null, red: null }, 'human-tty', true);
  assert.equal(verdict, 'pass');
});

test('FIX 1: plant c paused-ask-answered with answeredBy null is a miss, never a pass', () => {
  const verdict = classifyVerdict('c', { outcome: 'paused-ask-answered', phase: 'messageMatch-ambiguous', red: null }, null, false);
  assert.equal(verdict, 'miss');
});

test('classifyVerdict: plant d — a red BEFORE the ask is a FALSE RED, not a miss', () => {
  for (const phase of ['preflight', 'sheetRead', 'messageMatch', 'derive', 'compose']) {
    assert.equal(classifyVerdict('d', { outcome: 'red', phase, red: 'anything' }, null, false), 'false-red');
  }
});

test('PROOF: plant d — a red AT or AFTER the ask (e.g. "send") is a miss, never a false-red', () => {
  assert.equal(classifyVerdict('d', { outcome: 'red', phase: 'send', red: 'anything' }, 'human-tty', false), 'miss');
});

test('classifyVerdict: answeredBy "human-rejected" always wins, for every plant, never folded into pass or miss', () => {
  for (const plant of ['a', 'b', 'c', 'd', 'e']) {
    assert.equal(classifyVerdict(plant, { outcome: 'red', phase: 'ask', red: 'run stopped at the customer-ambiguity ask' }, 'human-rejected', false), 'human-rejected');
  }
});

// ---------------------------------------------------------------------------
// sumRunCost
// ---------------------------------------------------------------------------

test('sumRunCost: zero ledger rows for this runId is $0, not null (no model round ran)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-spend-'));
  const spendPath = join(dir, 'spend.jsonl');
  assert.deepEqual(sumRunCost(spendPath, 'no-such-run'), { costUsd: 0, rows: 0 });
});

test('sumRunCost: sums every row for the runId, ignoring other runs\' rows', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-spend-'));
  const spendPath = join(dir, 'spend.jsonl');
  writeFileSync(spendPath, [
    JSON.stringify({ runId: 'run-a', costUsd: 0.001 }),
    JSON.stringify({ runId: 'run-b', costUsd: 5.0 }),
    JSON.stringify({ runId: 'run-a', costUsd: 0.002 }),
  ].join('\n'));
  assert.deepEqual(sumRunCost(spendPath, 'run-a'), { costUsd: 0.003, rows: 2 });
});

test('PROOF: any null row for this runId makes the sum null, never a partial passed off as complete', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-spend-'));
  const spendPath = join(dir, 'spend.jsonl');
  writeFileSync(spendPath, [
    JSON.stringify({ runId: 'run-a', costUsd: 0.001 }),
    JSON.stringify({ runId: 'run-a', costUsd: null }),
  ].join('\n'));
  const result = sumRunCost(spendPath, 'run-a');
  assert.equal(result.costUsd, null);
});

// ---------------------------------------------------------------------------
// shouldStopBatch — the circuit breaker
// ---------------------------------------------------------------------------

test('shouldStopBatch: an unpriced (null) run stops the batch', () => {
  assert.equal(shouldStopBatch({ costUsd: null, red: 'truncated: 16000 tokens, no tool call' }), true);
});

test('shouldStopBatch: a red naming the global spend cap stops the batch', () => {
  assert.equal(shouldStopBatch({ costUsd: 0.01, red: 'cap: global spend cap reached: $5.000000 >= $5.00' }), true);
});

// FIX 3 (hamr's review, 2026-09-13): once the ledger holds one null row, every later child
// refuses at preflight with the UNPRICED-round text, not the global-cap text — both start "cap:".
test('FIX 3: shouldStopBatch also stops on the unpriced-round refusal text ("cap: spend tally has an unpriced round...")', () => {
  assert.equal(shouldStopBatch({ costUsd: 0.01, red: 'cap: spend tally has an unpriced round — cost unknown is never rendered as $0; refusing further spend (poc/m0/out/spend.jsonl)' }), true);
});

test('PROOF FIX 3 can fail: a red that merely MENTIONS "cap" without starting with "cap:" never stops the batch', () => {
  assert.equal(shouldStopBatch({ costUsd: 0.01, red: 'compose: declared field "total_owed" (5700, c3) does not appear cited — over the per-run cap threshold' }), false);
});

test('PROOF shouldStopBatch can fail: a normal priced red never stops the batch', () => {
  assert.equal(shouldStopBatch({ costUsd: 0.001, red: 'total_owed 5850 ≠ sum(E2,E3) = 5700' }), false);
});

// ---------------------------------------------------------------------------
// writeBarFile / appendRunRecord — the bar is written before any run
// ---------------------------------------------------------------------------

test('writeBarFile writes the declared 19/20 bar and expected shape BEFORE any results exist', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-bar-'));
  const path = join(dir, 'batch-deepseek-a-test.json');
  const bar = writeBarFile(path, {
    slot: 'deepseek', plant: 'a', tag: 'test', runs: 20,
  });
  assert.equal(bar.bar, '19/20');
  assert.deepEqual(bar.expected, EXPECTED_BY_PLANT.a);
  assert.deepEqual(bar.results, []);
  const onDisk = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(onDisk.bar, '19/20');
});

test('PROOF writeBarFile can fail: it refuses to overwrite a bar file that already has results', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-bar-'));
  const path = join(dir, 'batch-deepseek-a-test.json');
  writeBarFile(path, {
    slot: 'deepseek', plant: 'a', tag: 'test', runs: 20,
  });
  appendRunRecord(path, { i: 1, runId: 'x', verdict: 'pass' });
  assert.throws(
    () => writeBarFile(path, {
      slot: 'deepseek', plant: 'a', tag: 'test', runs: 20,
    }),
    /already has results recorded — use a new --tag/,
  );
});

test('appendRunRecord appends to the results array, one run at a time', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-bar-'));
  const path = join(dir, 'batch-deepseek-a-test.json');
  writeBarFile(path, {
    slot: 'deepseek', plant: 'a', tag: 'test', runs: 20,
  });
  appendRunRecord(path, { i: 1, runId: 'r1', verdict: 'pass' });
  appendRunRecord(path, { i: 2, runId: 'r2', verdict: 'miss' });
  const bar = JSON.parse(readFileSync(path, 'utf8'));
  assert.equal(bar.results.length, 2);
  assert.equal(bar.results[1].runId, 'r2');
});

// ---------------------------------------------------------------------------
// renderAskBlock / promptAndAnswer
// ---------------------------------------------------------------------------

test('renderAskBlock shows the question and the full reply text for the final accept ask', () => {
  const block = renderAskBlock({
    i: 3, total: 20, runId: 'test-run', question: 'Reply drafted — ok to send?', evidence: { text: 'Northwind owes 5700[c3]...' },
  });
  assert.match(block, /run 3\/20, test-run/);
  assert.match(block, /Reply drafted — ok to send\?/);
  assert.match(block, /Northwind owes 5700\[c3\]/);
});

test('renderAskBlock shows the ambiguous matches for the customer-ambiguity ask', () => {
  const block = renderAskBlock({
    i: 1, total: 20, runId: 'test-run', question: 'More than one customer matches: Northwind Trading, Northwind Supplies. Which one?', evidence: { citations: [], groundTruthMatches: ['Northwind Trading', 'Northwind Supplies'] },
  });
  assert.match(block, /Northwind Trading, Northwind Supplies/);
});

test('promptAndAnswer: "y" writes answer.json with decision accept and answeredBy human-tty', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-prompt-'));
  const askPath = join(dir, 'ask.json');
  const answerPath = join(dir, 'answer.json');
  writeFileSync(askPath, JSON.stringify({ question: 'ok to send?', evidence: { text: 'draft' } }));
  const rung = [];
  const written = [];
  const result = await promptAndAnswer({
    i: 1, total: 20, runId: 'test-run', askPath, answerPath, readLineFn: async () => 'y', writeLine: (s) => written.push(s), ringBell: () => rung.push(true),
  });
  assert.equal(result.accepted, true);
  assert.equal(rung.length, 1, 'the terminal bell must ring exactly once per ask');
  assert.ok(existsSync(answerPath));
  const answer = JSON.parse(readFileSync(answerPath, 'utf8'));
  assert.equal(answer.decision, 'accept');
  assert.equal(answer.answeredBy, 'human-tty');
  assert.ok(written.some((l) => l.includes('ok to send?')));
});

test('PROOF promptAndAnswer can fail: anything but "y" writes NO answer.json and reports not accepted', async () => {
  for (const line of ['n', 'N', '', 'yes', 'maybe']) {
    const dir = mkdtempSync(join(tmpdir(), 'm0-batch-prompt-'));
    const askPath = join(dir, 'ask.json');
    const answerPath = join(dir, 'answer.json');
    writeFileSync(askPath, JSON.stringify({ question: 'ok to send?', evidence: { text: 'draft' } }));
    // eslint-disable-next-line no-await-in-loop
    const result = await promptAndAnswer({
      i: 1, total: 20, runId: 'test-run', askPath, answerPath, readLineFn: async () => line, writeLine: () => {}, ringBell: () => {},
    });
    assert.equal(result.accepted, false, `expected "${line}" to never accept`);
    assert.equal(existsSync(answerPath), false, `expected "${line}" to write no answer.json`);
  }
});

// ---------------------------------------------------------------------------
// parseRunnerStdout
// ---------------------------------------------------------------------------

test('parseRunnerStdout parses the LAST pretty-printed JSON block after the RUN_ID line', () => {
  const stdout = 'RUN_ID=m0b-deepseek-a-test-1\n'
    + JSON.stringify({
      runId: 'm0b-deepseek-a-test-1', outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700',
    }, null, 2);
  const result = parseRunnerStdout(stdout);
  assert.equal(result.outcome, 'red');
  assert.equal(result.phase, 'derive');
});

test('PROOF parseRunnerStdout can fail: a crash with no JSON on stdout is reported as "crashed", never silently red with no message', () => {
  const result = parseRunnerStdout('RUN_ID=m0b-deepseek-a-test-1\n');
  assert.equal(result.outcome, 'crashed');
  assert.match(result.red, /no parseable result on stdout/);
});

// ---------------------------------------------------------------------------
// runOneBatchRun / runBatch — full mechanics, fake spawn + fake TTY reader.
// ---------------------------------------------------------------------------

/** A fake child process: an EventEmitter with .stdout/.stderr (also EventEmitters) and .kill(). */
function fakeChild() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.killed = false;
  child.kill = () => { child.killed = true; };
  return child;
}

function tempDeclarationPath() {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-decl-'));
  const path = join(dir, 'draft.json');
  writeFileSync(path, JSON.stringify({ declaration: { guardrails: '' } }));
  return path;
}

test('runOneBatchRun: no ask reached (plant a) — spawns the child with the right argv, parses its stdout', async () => {
  const runId = 'm0b-deepseek-a-test-1';
  const spawnCalls = [];
  const spawnFn = (cmd, args, opts) => {
    spawnCalls.push({ cmd, args, opts });
    const child = fakeChild();
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(`RUN_ID=${runId}\n${JSON.stringify({
        runId, outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700',
      }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  const record = await runOneBatchRun({
    i: 1, total: 20, runId, declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: 'test',
    pollMs: 10, spawnFn, spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  assert.equal(record.verdict, 'pass');
  assert.equal(record.answeredBy, null);
  assert.equal(spawnCalls.length, 1);
  assert.equal(spawnCalls[0].cmd, 'node');
  assert.ok(spawnCalls[0].args[0].endsWith('runner.mjs'));
  assert.ok(spawnCalls[0].args.includes('--declaration'));
  assert.ok(spawnCalls[0].args.includes('--slot'));
  assert.ok(spawnCalls[0].args.includes('deepseek'));
  assert.ok(spawnCalls[0].args.includes('--plant'));
  assert.ok(spawnCalls[0].args.includes('--run-id'));
  assert.ok(spawnCalls[0].args.includes(runId));
  assert.ok(spawnCalls[0].args.includes('--ask-timeout-ms'));
});

// FIX 2 (hamr's review, 2026-09-13): a crashed child's cost is UNKNOWN, never $0. Without this,
// a child that died mid-round (before its spend row landed) would read zero ledger rows and be
// priced at $0 by sumRunCost's own "no rows ran = $0" rule — correct for a clean preflight
// refusal, wrong for a crash.
test('FIX 2: a crashed child (no parseable stdout, zero ledger rows) reports costUsd null, not $0', async () => {
  const runId = 'm0b-deepseek-a-crash-test';
  const spawnFn = () => {
    const child = fakeChild();
    setTimeout(() => {
      child.stderr.emit('data', Buffer.from('TypeError: something exploded\n'));
      child.emit('exit', 1); // no JSON ever printed on stdout
    }, 5);
    return child;
  };
  const record = await runOneBatchRun({
    i: 1, total: 20, runId, declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: 'test',
    pollMs: 10, spawnFn, spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  assert.equal(record.outcome, 'crashed');
  assert.equal(record.costUsd, null, 'a crashed run\'s cost must be unknown, never $0');
});

test('PROOF FIX 2 can fail: a clean preflight-style refusal (also zero ledger rows) still reports $0, not null', async () => {
  const runId = 'm0b-deepseek-a-refuse-test';
  const spawnFn = () => {
    const child = fakeChild();
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(`RUN_ID=${runId}\n${JSON.stringify({
        runId, outcome: 'red', phase: 'preflight', red: 'preflight: run dir already holds ask.json from an earlier run — use a new --run-id',
      }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  const record = await runOneBatchRun({
    i: 1, total: 20, runId, declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: 'test',
    pollMs: 10, spawnFn, spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  assert.equal(record.outcome, 'red');
  assert.equal(record.costUsd, 0, 'no model round ever ran — $0 is correct, not null');
});

test('FIX 2 (batch-level): a crashed run with an unpriced cost stops the whole batch', async () => {
  let spawnCount = 0;
  const spawnFn = () => {
    spawnCount += 1;
    const child = fakeChild();
    setTimeout(() => {
      child.emit('exit', 1); // crashes: no stdout at all
    }, 5);
    return child;
  };
  const { results } = await runBatch({
    declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: `crash-stop-${Date.now()}`, runs: 20, isTTY: false,
    spawnFn, spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  assert.equal(results.length, 1, 'the batch must stop after the crashed run, never reaching run 2');
  assert.equal(spawnCount, 1);
});

// FIX 4 (hamr's review, 2026-09-13): child stdout/stderr are captured, not inherited, so without
// a printed progress line hamr sees nothing for plants a/b/e's 20 runs.
test('FIX 4: one progress line is printed per run via writeLine, naming the verdict, outcome/phase, cost and wall time', async () => {
  const runId = 'm0b-deepseek-a-progress-test';
  const spawnFn = () => {
    const child = fakeChild();
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(`RUN_ID=${runId}\n${JSON.stringify({
        runId, outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700',
      }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  const written = [];
  await runBatch({
    declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: `progress-${Date.now()}`, runs: 1, isTTY: false,
    spawnFn, writeLine: (s) => written.push(s), spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  const progressLine = written.find((l) => l.startsWith('run 1/1'));
  assert.ok(progressLine, `expected a "run 1/1 ..." progress line among: ${JSON.stringify(written)}`);
  assert.match(progressLine, /\bpass\b/);
  assert.match(progressLine, /red\/derive/);
  assert.match(progressLine, /\$\d/);
  assert.match(progressLine, /\d+(\.\d+)?s/);
});

test('PROOF FIX 4 can fail: a non-pass run\'s progress line also carries its red text', async () => {
  const runId = 'm0b-deepseek-b-progress-test';
  const spawnFn = () => {
    const child = fakeChild();
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(`RUN_ID=${runId}\n${JSON.stringify({
        runId, outcome: 'red', phase: 'derive', red: 'this text will never match plant b\'s expected shape',
      }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  const written = [];
  await runBatch({
    declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'b', tag: `progress-miss-${Date.now()}`, runs: 1, isTTY: false,
    spawnFn, writeLine: (s) => written.push(s), spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  const progressLine = written.find((l) => l.startsWith('run 1/1'));
  assert.match(progressLine, /\bmiss\b/);
  assert.match(progressLine, /this text will never match plant b's expected shape/);
});

test('runOneBatchRun: an ask is reached, "y" accepts — answeredBy human-tty, verdict per outcome', async () => {
  const runId = 'm0b-deepseek-c-test-1';
  const testOutDir = mkdtempSync(join(tmpdir(), 'm0-batch-out-'));
  const spawnFn = (cmd, args) => {
    const child = fakeChild();
    const runDirIdx = args.indexOf('--run-id');
    const askedRunId = args[runDirIdx + 1];
    const runDir = join(testOutDir, askedRunId);
    mkdirSync(runDir, { recursive: true });
    const askPath = join(runDir, 'ask.json');
    const answerPath = join(runDir, 'answer.json');
    setTimeout(() => {
      writeFileSync(askPath, JSON.stringify({
        question: 'More than one customer matches: Northwind Trading, Northwind Supplies. Which one?',
        evidence: { citations: [], groundTruthMatches: ['Northwind Trading', 'Northwind Supplies'] },
      }));
    }, 5);
    const waitForAnswer = setInterval(() => {
      if (existsSync(answerPath)) {
        clearInterval(waitForAnswer);
        child.stdout.emit('data', Buffer.from(`RUN_ID=${askedRunId}\n${JSON.stringify({
          runId: askedRunId, outcome: 'paused-ask-answered', phase: 'messageMatch-ambiguous', red: null,
        }, null, 2)}`));
        child.emit('exit', 0);
      }
    }, 10);
    return child;
  };
  const record = await runOneBatchRun({
    i: 1, total: 20, runId, declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'c', tag: 'test',
    pollMs: 10, spawnFn, readLineFn: async () => 'y', spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: testOutDir,
  });
  assert.equal(record.answeredBy, 'human-tty');
  assert.equal(record.verdict, 'pass');
});

test('runOneBatchRun: an ask is reached, "n" kills the child and records human-rejected', async () => {
  const runId = 'm0b-deepseek-c-test-2';
  const testOutDir = mkdtempSync(join(tmpdir(), 'm0-batch-out-'));
  let killed = false;
  const spawnFn = (cmd, args) => {
    const child = fakeChild();
    const runDirIdx = args.indexOf('--run-id');
    const askedRunId = args[runDirIdx + 1];
    const runDir = join(testOutDir, askedRunId);
    mkdirSync(runDir, { recursive: true });
    setTimeout(() => {
      writeFileSync(join(runDir, 'ask.json'), JSON.stringify({ question: 'ok?', evidence: {} }));
    }, 5);
    child.kill = () => { killed = true; child.emit('exit', null); };
    return child;
  };
  const record = await runOneBatchRun({
    i: 1, total: 20, runId, declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'c', tag: 'test',
    pollMs: 10, spawnFn, readLineFn: async () => 'n', spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'),
    outDir: testOutDir,
  });
  assert.equal(killed, true, 'the child must be killed on rejection');
  assert.equal(record.answeredBy, 'human-rejected');
  assert.equal(record.verdict, 'human-rejected');
});

test('runBatch: refuses to start plant c/d without a TTY, never accepting by default', async () => {
  await assert.rejects(
    () => runBatch({
      declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'c', tag: 'test', runs: 1, isTTY: false,
    }),
    /needs a real human accept over a TTY/,
  );
  await assert.rejects(
    () => runBatch({
      declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'd', tag: 'test', runs: 1, isTTY: false,
    }),
    /needs a real human accept over a TTY/,
  );
});

test('PROOF the above can fail: plants a/b/e never require a TTY (no ask in their expected path)', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-batch-notty-'));
  const spawnFn = (cmd, args) => {
    const child = fakeChild();
    const runIdIdx = args.indexOf('--run-id');
    const runId = args[runIdIdx + 1];
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(`RUN_ID=${runId}\n${JSON.stringify({
        runId, outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700',
      }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  const { results, path } = await runBatch({
    declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: `notty-${Date.now()}`, runs: 1, isTTY: false,
    spawnFn, spendPath: join(dir, 'spend.jsonl'), outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].verdict, 'pass');
  assert.ok(existsSync(path));
});

test('runBatch: writes the bar file BEFORE run 1 — even a spawn that never calls back leaves the bar on disk', async () => {
  const tag = `bar-first-${Date.now()}`;
  const testOutDir = mkdtempSync(join(tmpdir(), 'm0-batch-out-'));
  const path = batchFilePath('deepseek', 'a', tag, testOutDir);
  const spawnFn = () => {
    // A child that never emits anything — runBatch's write of the bar file must have ALREADY
    // happened by the time spawnFn is even called.
    assert.ok(existsSync(path), 'the bar file must exist before the first spawn call');
    const child = fakeChild();
    setTimeout(() => {
      child.stdout.emit('data', Buffer.from(`RUN_ID=x\n${JSON.stringify({ runId: 'x', outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700' }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  assert.equal(existsSync(path), false, 'sanity: the bar file must not exist before runBatch is called at all');
  await runBatch({
    declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag, runs: 1, isTTY: false,
    spawnFn, spendPath: join(mkdtempSync(join(tmpdir(), 'm0-batch-spend-')), 'spend.jsonl'), outDir: testOutDir,
  });
});

test('runBatch: a spend-cap refusal stops the batch — never burning past run 1 of 20', async () => {
  const spendDir = mkdtempSync(join(tmpdir(), 'm0-batch-spend-'));
  const spendPath = join(spendDir, 'spend.jsonl');
  let spawnCount = 0;
  const spawnFn = (cmd, args) => {
    spawnCount += 1;
    const child = fakeChild();
    const runIdIdx = args.indexOf('--run-id');
    const runId = args[runIdIdx + 1];
    setTimeout(() => {
      // Every run's ledger row is unpriced (null) — simulating the cap already reached.
      writeFileSync(spendPath, `${JSON.stringify({ runId, costUsd: null })}\n`, { flag: 'a' });
      child.stdout.emit('data', Buffer.from(`RUN_ID=${runId}\n${JSON.stringify({
        runId, outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700',
      }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  const { results } = await runBatch({
    declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: `capstop-${Date.now()}`, runs: 20, isTTY: false,
    spawnFn, spendPath, outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  assert.equal(results.length, 1, 'the batch must stop after the FIRST unpriced run, never reaching run 2');
  assert.equal(spawnCount, 1);
});

test('PROOF the cap-stop test can fail: a normally-priced run 1 lets the batch continue to run 2', async () => {
  const spendDir = mkdtempSync(join(tmpdir(), 'm0-batch-spend-'));
  const spendPath = join(spendDir, 'spend.jsonl');
  let spawnCount = 0;
  const spawnFn = (cmd, args) => {
    spawnCount += 1;
    const child = fakeChild();
    const runIdIdx = args.indexOf('--run-id');
    const runId = args[runIdIdx + 1];
    setTimeout(() => {
      writeFileSync(spendPath, `${JSON.stringify({ runId, costUsd: 0.001 })}\n`, { flag: 'a' });
      child.stdout.emit('data', Buffer.from(`RUN_ID=${runId}\n${JSON.stringify({
        runId, outcome: 'red', phase: 'derive', red: 'total_owed 5850 ≠ sum(E2,E3) = 5700',
      }, null, 2)}`));
      child.emit('exit', 1);
    }, 5);
    return child;
  };
  const { results } = await runBatch({
    declarationPath: tempDeclarationPath(), slot: 'deepseek', plant: 'a', tag: `capstop-control-${Date.now()}`, runs: 2, isTTY: false,
    spawnFn, spendPath, outDir: mkdtempSync(join(tmpdir(), 'm0-batch-out-')),
  });
  assert.equal(results.length, 2);
  assert.equal(spawnCount, 2);
});

// Must be the LAST test in this file (node --test runs a file's tests in declaration order) —
// diffs the real poc/m0/out/ listing against the module-load snapshot above.
test('pollution guard: this whole test file leaves no new batch-* file or m0b-*-test* dir in the REAL poc/m0/out/', () => {
  const after = readdirSync(OUT_DIR);
  const newEntries = after.filter((name) => !REAL_OUT_DIR_SNAPSHOT_BEFORE.has(name));
  const pollutingEntries = newEntries.filter((name) => /^batch-/.test(name) || /^m0b-.*-test/.test(name));
  assert.deepEqual(pollutingEntries, [], `batch.test.mjs must never write into the real ${OUT_DIR}`);
});
