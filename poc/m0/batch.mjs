// M0b stability batch (Amendment C) — 20 sequential runs of one plant on one
// provider, EVERY accept a real human accept (hamr's ruling, 2026-09-13).
// $0 to build/test: the child process is a real `node poc/m0/runner.mjs`
// invocation (money only spends if it is actually run live), and every test
// here injects a fake spawn + a fake TTY line reader — zero live model calls,
// zero real child processes, ever, under `node --test`.
//
// Background: pass 3's live run used a throwaway shell helper that waited
// for ask.json, printed the question, read y/N, and wrote answer.json. This
// is that, built properly: sequential runs, a declared stability bar written
// before any run, one spend-cap circuit breaker, and a verdict per run keyed
// on typed fields (outcome/phase) plus the CLOSE's own red text shape —
// never free-text matching against today's fixture wording.
//
// Never touches runner.mjs or close.mjs — imports their exported functions
// (checkSendDestination, OUT_DIR) rather than reimplementing their logic.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { spawn as nodeSpawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline';
import { OUT_DIR, checkSendDestination } from './runner.mjs';
import { parseArbiterSlots } from './validator.mjs';
import { ceilingCostUsd } from './spend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
const RUNNER_PATH = join(__dirname, 'runner.mjs');
export const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');

// The signed grammar's ask.json/runner.mjs's default ask timeout, and the
// batch's default poll interval while watching for a run's ask.json.
const DEFAULT_ASK_TIMEOUT_MS = 600_000;
const DEFAULT_POLL_MS = 500;

// A run "before the ask" for plant d's false-red distinction — every stage
// that can red BEFORE the signed accept ask is ever reached.
const STAGES_BEFORE_ASK = Object.freeze(['preflight', 'sheetRead', 'messageMatch', 'derive', 'compose']);

/**
 * Each plant's expected verdict shape, keyed on TYPED fields (outcome,
 * phase) plus the close's own red text — never free text matched against
 * today's fixture wording. `redPattern` is a source string (not a RegExp
 * literal) so it can also be written into the bar file as plain JSON.
 */
export const EXPECTED_BY_PLANT = Object.freeze({
  a: { outcome: 'red', phase: 'derive', redPattern: '^total_owed \\S+ ≠ sum\\(' },
  b: { outcome: 'red', phase: 'derive', redPattern: '≠ cell E2 = 4200$' },
  e: { outcome: 'red', phase: 'compose', redPattern: '^compose: declared field "(total_owed|earliest_due)"' },
  c: { outcome: 'paused-ask-answered', phase: 'messageMatch-ambiguous' },
  d: { outcome: 'complete' },
});

/**
 * Classify one run's verdict. `answeredBy === 'human-rejected'` always wins
 * (its own count, never folded into pass or miss, per the brief) —
 * everything else is compared against EXPECTED_BY_PLANT on typed fields.
 */
export function classifyVerdict(plant, actual, answeredBy, sentFileOk) {
  if (answeredBy === 'human-rejected') return 'human-rejected';

  if (plant === 'd') {
    if (actual.outcome === 'complete') {
      // A pass on d must come from THIS batch's own human accept (hamr's review, 2026-09-13) —
      // a "complete" outcome with no human-tty answer this run (e.g. a stale/mismatched record)
      // is never silently counted as a real accept.
      return (sentFileOk && answeredBy === 'human-tty') ? 'pass' : 'miss';
    }
    if (actual.outcome === 'red' && STAGES_BEFORE_ASK.includes(actual.phase)) return 'false-red';
    return 'miss';
  }

  const expected = EXPECTED_BY_PLANT[plant];
  if (!expected) return 'miss';

  if (plant === 'c') {
    // Same rule as d: paused-ask-answered must have come from THIS batch's own human accept.
    return (actual.outcome === expected.outcome && actual.phase === expected.phase && answeredBy === 'human-tty') ? 'pass' : 'miss';
  }

  // a, b, e — outcome + phase + the close's own red text shape.
  if (
    actual.outcome === expected.outcome
    && actual.phase === expected.phase
    && typeof actual.red === 'string'
    && new RegExp(expected.redPattern).test(actual.red)
  ) {
    return 'pass';
  }
  return 'miss';
}

/**
 * Sum a runId's ledger rows in spend.jsonl. Zero rows -> $0 (no model round
 * ran). A null/undefined-costUsd row is repriced at its ceiling via
 * spend.mjs's `ceilingCostUsd` (the one writer for that — hamr's ruling,
 * 2026-09-21: no session starts at $0 or unknown pricing, a null row is
 * never a standing state), so this never returns `costUsd: null` for a
 * ledger row any more; it is added to the same running total like any
 * other row.
 */
export function sumRunCost(spendPath, runId) {
  if (!existsSync(spendPath)) return { costUsd: 0, rows: 0 };
  const lines = readFileSync(spendPath, 'utf8').split('\n').filter((l) => l.trim());
  let total = 0;
  let rows = 0;
  for (const line of lines) {
    const row = JSON.parse(line);
    if (row.runId !== runId) continue;
    rows += 1;
    if (row.costUsd === null || row.costUsd === undefined) {
      total += ceilingCostUsd(row.model);
      continue;
    }
    total += row.costUsd;
  }
  return { costUsd: total, rows };
}

/** The bar file's path — one per slot+plant+tag, written before run 1, never after. */
export function batchFilePath(slot, plant, tag, outDir = OUT_DIR) {
  return join(outDir, `batch-${slot}-${plant}-${tag}.json`);
}

/** Write the declared bar, before any run. Fails loudly rather than silently if a run has already appended to this file (never overwrite live evidence). */
export function writeBarFile(path, { slot, plant, tag, runs }) {
  if (existsSync(path)) {
    const existing = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(existing.results) && existing.results.length > 0) {
      throw new Error(`batch: ${path} already has results recorded — use a new --tag, never overwrite live evidence`);
    }
  }
  mkdirSync(dirname(path), { recursive: true });
  const bar = {
    bar: '19/20',
    expected: EXPECTED_BY_PLANT[plant],
    slot,
    plant,
    tag,
    runs,
    startedAt: new Date().toISOString(),
    results: [],
  };
  writeFileSync(path, JSON.stringify(bar, null, 2));
  return bar;
}

/** Append one run's record to the bar file (read-modify-write; batches run sequentially, never concurrently, so no lock is needed). */
export function appendRunRecord(path, record) {
  const bar = JSON.parse(readFileSync(path, 'utf8'));
  bar.results.push(record);
  writeFileSync(path, JSON.stringify(bar, null, 2));
  return bar;
}

/**
 * The stop-the-batch circuit breaker: never keep burning past a run whose
 * cost is genuinely unknown, or whose red names the global spend cap
 * outright.
 *
 * `record.costUsd === null` no longer fires off an unpriced LEDGER row —
 * sumRunCost above reprices those at their ceiling now, so `record.costUsd`
 * is never null for that reason any more. It still fires for the one
 * remaining source of a null cost on this record: `runOneBatchRun`'s own
 * `actual.outcome === 'crashed'` branch, a child that died before ANY spend
 * row (priced or not) could land — genuinely unknown, not bounded by a
 * ceiling, since no round is known to have even started.
 */
export function shouldStopBatch(record) {
  if (record.costUsd === null) return true;
  // Covers BOTH refusal texts spend.mjs's assertUnderGlobalCap can produce — the global-cap-
  // reached red and the unpriced-round red ("spend tally has an unpriced round ..."). A named
  // "cap:" red is the mechanism that now carries the cap-reached signal (a null row in the
  // ledger no longer implies it on its own — see sumRunCost above), so without this the batch
  // would burn through 20 quick, uninformative misses instead of stopping.
  if (typeof record.red === 'string' && record.red.startsWith('cap:')) return true;
  return false;
}

/**
 * One progress line per run, printed via `writeLine` (hamr's review,
 * 2026-09-13): child stdout/stderr are captured, not inherited, so without
 * this a/b/e's 20 runs print NOTHING for the whole batch. Format:
 *   run i/N  <verdict>  <outcome>/<phase>  $<cost|unknown>  <wall>s
 * plus the red text for any non-pass verdict.
 */
export function renderProgressLine(record, total) {
  const costLabel = record.costUsd === null ? 'unknown' : record.costUsd.toFixed(6);
  const wallLabel = (record.wallMs / 1000).toFixed(1);
  const base = `run ${record.i}/${total}  ${record.verdict}  ${record.outcome}/${record.phase ?? '-'}  $${costLabel}  ${wallLabel}s`;
  return record.verdict === 'pass' ? base : `${base}  ${record.red ?? ''}`;
}

/**
 * Render the block a human sees when a run's ask.json appears. `evidence`
 * is ask.json's own `evidence` field — either `{ text }` (the final accept
 * ask) or `{ citations, groundTruthMatches }` (the customer-ambiguity ask).
 */
export function renderAskBlock({
  i, total, runId, question, evidence,
}) {
  const lines = [
    '',
    `=== ASK (run ${i}/${total}, ${runId}) ===`,
    question,
  ];
  if (typeof evidence?.text === 'string') {
    lines.push('--- reply ---', evidence.text);
  } else if (Array.isArray(evidence?.groundTruthMatches)) {
    lines.push(`--- ambiguous matches --- ${evidence.groundTruthMatches.join(', ')}`);
  }
  lines.push('accept? [y/N] ');
  return lines.join('\n');
}

/**
 * Handle ONE ask: print the block (bell + renderAskBlock via `writeLine`),
 * read one line via the injected `readLineFn` (a TTY reader in production,
 * a fake in tests — never a global console/stdin spy), and either write
 * answer.json (accept) or return `{ accepted: false }` (anything else —
 * never auto-accept, never default to yes). Never touches the child.
 */
export async function promptAndAnswer({
  i, total, runId, askPath, answerPath, readLineFn, writeLine = (s) => { process.stdout.write(`${s}\n`); }, ringBell = () => { process.stdout.write('\x07'); },
}) {
  const ask = JSON.parse(readFileSync(askPath, 'utf8'));
  ringBell();
  writeLine(renderAskBlock({
    i, total, runId, question: ask.question, evidence: ask.evidence,
  }));
  const line = await readLineFn();
  const accepted = typeof line === 'string' && line.trim().toLowerCase() === 'y';
  if (accepted) {
    writeFileSync(answerPath, JSON.stringify({
      decision: 'accept', answeredBy: 'human-tty', answeredAt: new Date().toISOString(),
    }, null, 2));
  }
  return { accepted };
}

/**
 * Parse the LAST JSON object runner.mjs's CLI prints to stdout
 * (`console.log(JSON.stringify({runId, outcome, phase, red}, null, 2))`,
 * pretty-printed, preceded by a plain "RUN_ID=..." line). A crash before
 * that point (StopAndReportError, an uncaught exception) prints nothing
 * parseable — reported as its own outcome, never silently treated as red
 * with no message.
 */
export function parseRunnerStdout(stdout) {
  const openIdx = stdout.lastIndexOf('{');
  const closeIdx = stdout.lastIndexOf('}');
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
    return { outcome: 'crashed', phase: null, red: `no parseable result on stdout: ${stdout.slice(-500)}` };
  }
  try {
    return JSON.parse(stdout.slice(openIdx, closeIdx + 1));
  } catch (err) {
    return { outcome: 'crashed', phase: null, red: `unparseable result JSON: ${err.message}` };
  }
}

/**
 * Run ONE child (`node poc/m0/runner.mjs --declaration ... --run-id ...`),
 * watching its run dir for ask.json while it runs. `spawnFn` (default
 * `node:child_process`'s `spawn`) and `readLineFn` are injected so a test
 * runs this at $0 with a fake child and a fake TTY reader.
 */
export async function runOneBatchRun({
  i, total, runId, declarationPath, slot, plant, tag, askTimeoutMs = DEFAULT_ASK_TIMEOUT_MS,
  pollMs = DEFAULT_POLL_MS, spawnFn = nodeSpawn, readLineFn, writeLine, spendPath = SPEND_PATH,
  outDir = OUT_DIR,
}) {
  const runDir = join(outDir, runId);
  const askPath = join(runDir, 'ask.json');
  const answerPath = join(runDir, 'answer.json');

  const startedAt = Date.now();
  const child = spawnFn('node', [
    RUNNER_PATH, '--declaration', declarationPath, '--slot', slot, '--plant', plant,
    '--run-id', runId, '--ask-timeout-ms', String(askTimeoutMs),
  ], { cwd: REPO_ROOT });

  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk) => { stderr += chunk.toString(); });

  let answeredBy = null;
  let askHandled = false;

  const exitPromise = new Promise((resolve) => {
    child.on('exit', (code) => resolve(code));
  });

  // Poll for ask.json until the child exits or the ask is handled and the
  // child later exits. Never re-triggers once an ask has been answered or
  // rejected THIS run — the file persists on disk after that point.
  // eslint-disable-next-line no-constant-condition
  while (true) {
    if (!askHandled && existsSync(askPath)) {
      askHandled = true;
      // eslint-disable-next-line no-await-in-loop
      const { accepted } = await promptAndAnswer({
        i, total, runId, askPath, answerPath, readLineFn, writeLine,
      });
      if (accepted) {
        answeredBy = 'human-tty';
      } else {
        answeredBy = 'human-rejected';
        child.kill();
      }
    }
    // eslint-disable-next-line no-await-in-loop
    const settled = await Promise.race([
      exitPromise.then((code) => ({ exited: true, code })),
      new Promise((resolve) => { setTimeout(() => resolve({ exited: false }), pollMs); }),
    ]);
    if (settled.exited) break;
  }
  const exitCode = await exitPromise;
  const wallMs = Date.now() - startedAt;

  const actual = answeredBy === 'human-rejected'
    ? { outcome: 'red', phase: null, red: 'human-rejected' }
    : parseRunnerStdout(stdout);

  // A crashed child's cost is UNKNOWN, never $0 (hamr's review, 2026-09-13): sumRunCost's
  // zero-rows-means-$0 rule is correct for a clean preflight refusal (no model round ever ran)
  // but wrong here — a child that died mid-round, before its spend row landed, leaves zero rows
  // for a reason that has nothing to do with cost being genuinely zero.
  const { costUsd: summedCostUsd } = sumRunCost(spendPath, runId);
  const costUsd = actual.outcome === 'crashed' ? null : summedCostUsd;

  let sentFileOk = false;
  if (plant === 'd' && actual.outcome === 'complete') {
    try {
      const declaration = JSON.parse(readFileSync(declarationPath, 'utf8'));
      const decl = declaration.declaration ?? declaration;
      const { slots } = parseArbiterSlots(decl.guardrails);
      const destination = checkSendDestination(slots?.send?.target);
      if (destination.ok) {
        const sentPath = join(destination.dir, `${runId}-sent.txt`);
        sentFileOk = existsSync(sentPath) && readFileSync(sentPath).byteLength > 0;
      }
    } catch { /* sentFileOk stays false — a miss, correctly */ }
  }

  const verdict = classifyVerdict(plant, actual, answeredBy, sentFileOk);

  // Name the specific miss reason when a c/d run reached its expected outcome but not through
  // THIS batch's own human accept — otherwise the red field would read null/misleading in the
  // summary's misses list.
  const wouldHavePassedOnAcceptAlone = verdict === 'miss'
    && answeredBy !== 'human-rejected'
    && answeredBy !== 'human-tty'
    && ((plant === 'd' && actual.outcome === 'complete' && sentFileOk)
      || (plant === 'c' && actual.outcome === EXPECTED_BY_PLANT.c.outcome && actual.phase === EXPECTED_BY_PLANT.c.phase));
  const red = wouldHavePassedOnAcceptAlone ? 'accepted without this batch\'s human accept' : (actual.red ?? null);

  return {
    i,
    runId,
    outcome: actual.outcome,
    phase: actual.phase ?? null,
    red,
    costUsd,
    wallMs,
    answeredBy,
    verdict,
    exitCode,
    stderrTail: answeredBy === 'human-rejected' ? null : stderr.slice(-2000),
  };
}

/**
 * The whole batch: TTY check (plants c/d only) -> write the bar file, before
 * any run -> sequential runs -> the spend-cap circuit breaker -> summary.
 */
export async function runBatch({
  declarationPath, slot, plant, tag, runs = 20, isTTY = process.stdin.isTTY === true,
  spawnFn, readLineFn, writeLine = (s) => { process.stdout.write(`${s}\n`); }, spendPath = SPEND_PATH,
  outDir = OUT_DIR,
}) {
  if ((plant === 'c' || plant === 'd') && !isTTY) {
    throw new Error(`batch: plant "${plant}" needs a real human accept over a TTY — refusing to start without one (stdin is not a TTY)`);
  }

  const path = batchFilePath(slot, plant, tag, outDir);
  writeBarFile(path, {
    slot, plant, tag, runs,
  });

  const results = [];
  for (let i = 1; i <= runs; i += 1) {
    const runId = `m0b-${slot}-${plant}-${tag}-${i}`;
    // eslint-disable-next-line no-await-in-loop
    const record = await runOneBatchRun({
      i, total: runs, runId, declarationPath, slot, plant, tag, spawnFn, readLineFn, writeLine, spendPath, outDir,
    });
    appendRunRecord(path, record);
    results.push(record);
    writeLine(renderProgressLine(record, runs));
    if (shouldStopBatch(record)) {
      writeLine(`STOPPED at run ${i}/${runs}: ${record.red ?? 'unpriced spend row'} — never burning past an unknown cost`);
      break;
    }
  }

  const passed = results.filter((r) => r.verdict === 'pass').length;
  const falseReds = results.filter((r) => r.verdict === 'false-red');
  const humanRejected = results.filter((r) => r.verdict === 'human-rejected');
  const misses = results.filter((r) => r.verdict === 'miss');
  const pricedCosts = results.map((r) => r.costUsd).filter((c) => c !== null);
  const totalUsd = pricedCosts.length === results.length ? pricedCosts.reduce((s, c) => s + c, 0) : null;
  const meanWallMs = results.length > 0 ? results.reduce((s, r) => s + r.wallMs, 0) / results.length : 0;

  const summary = {
    passed: `${passed}/${runs}`,
    bar: '19/20',
    falseReds: falseReds.length,
    humanRejected: humanRejected.length,
    misses: misses.map((r) => ({
      i: r.i, runId: r.runId, outcome: r.outcome, phase: r.phase, red: r.red,
    })),
    totalUsd,
    meanWallMs,
  };
  writeLine(JSON.stringify(summary, null, 2));

  const bar = JSON.parse(readFileSync(path, 'utf8'));
  bar.summary = summary;
  writeFileSync(path, JSON.stringify(bar, null, 2));

  return { results, summary, path };
}

// ---------------------------------------------------------------------------
// CLI entry point.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const idx = process.argv.indexOf(`--${name}`);
    return idx !== -1 ? process.argv[idx + 1] : undefined;
  };
  const declarationPath = arg('declaration');
  const slot = arg('slot');
  const plant = arg('plant');
  const tag = arg('tag');
  const runs = Number(arg('runs') ?? 20);

  if (!declarationPath || !['deepseek', 'synthetic'].includes(slot) || !['a', 'b', 'c', 'd', 'e'].includes(plant) || !tag) {
    console.error('usage: node poc/m0/batch.mjs --declaration <draft.json> --slot deepseek|synthetic '
      + '--plant a|b|c|d|e --runs 20 --tag <day-tag>');
    process.exit(1);
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const readLineFn = () => new Promise((resolve) => rl.question('', resolve));

  try {
    const { summary } = await runBatch({
      declarationPath, slot, plant, tag, runs, readLineFn,
    });
    rl.close();
    process.exit(summary.misses.length > 0 ? 1 : 0);
  } catch (err) {
    rl.close();
    console.error(err.message);
    process.exit(1);
  }
}
