// M4e amendment 25 POC — paid-batch runner. NOT the product.
//
//   export DEEPSEEK_API_KEY="$(pass amr/deepseek_api | head -n1 | tr -d '\r\n')"
//   setsid nohup node poc/am24-questions/run.mjs --tag am25-1 > poc/am24-questions/am25-1.log 2>&1 &
//
// Drafts each of the 20 jobs (jobs.mjs) through the real three tries (questions open only on try 3) and writes results-<tag>.json. $0 gates, all before any ledger write:
// empty/missing/odd key refuses, an existing tag refuses, and the ledger (spend.jsonl here) is checked against the
// stop line. Spend stop: before each job, ledger total (an unpriced row counts at its ceiling) + one round's
// ceiling must stay <= SPEND_STOP_USD ($0.40), which leaves room in the amendment's $0.50 cap for the exit walk.
// Nothing written contains the key (literal scrub on write).

import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKeyPreflight, appendSpendRow, ceilingCostUsd } from '../../src/provider.js';
import { ledgerTotalUsd, scrub, secretsFromEnv } from '../m6a/batch.mjs';
import { draftWithQuestions } from './draft.mjs';
import { JOBS } from './jobs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SPEND_STOP_USD = 0.40;
export const PER_JOB_BUDGET_USD = 0.10;
export const CALL_DEADLINE_MS = 600_000;
const DEFAULT_MODEL = 'deepseek-flash';
// The signed bar (amendment 25, POC first), read as numbers; printed with the counts so a human can re-read it.
export const BAR = { clearQuiet: 9, clearOf: 10, validMin: 18, total: 20 };

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Pass/fail against the signed bar. `records` must hold every job; a short run is never a pass. */
export function evaluate(records, jobs = JOBS) {
  const vague = records.filter((r) => r.kind === 'vague');
  const clear = records.filter((r) => r.kind === 'clear');
  // A vague job that failed tries 1 and 2 must have asked at least one question (kept questions all name a line try 2 failed on).
  const failedBoth = vague.filter((r) => r.passedTry1 === false && r.passedTry2 === false);
  const failedBothAsked = failedBoth.filter((r) => r.questions.length >= 1).length;
  const clearQuiet = clear.filter((r) => r.questions.length === 0).length;
  const valid = records.filter((r) => r.declarationValid).length;
  const broken = records.filter((r) => r.stop !== null).length;
  const complete = records.length === jobs.length;
  const checks = {
    complete,
    vagueFailedBothAsked: { got: failedBothAsked, of: failedBoth.length, ok: failedBothAsked === failedBoth.length },
    clearQuiet: { got: clearQuiet, of: clear.length, need: BAR.clearQuiet, ok: clearQuiet >= BAR.clearQuiet },
    neverBreaks: { broken, ok: broken === 0 },
    declarationValid: { got: valid, of: records.length, need: BAR.validMin, ok: valid >= BAR.validMin },
  };
  // Reported, deciding nothing.
  const report = {
    vaguePassedTry1: vague.filter((r) => r.passedTry1 === true).length,
    vaguePassedTry2: vague.filter((r) => r.passedTry1 === false && r.passedTry2 === true).length,
    vagueFailedBoth: failedBoth.length,
    vacuous: failedBoth.length === 0,
  };
  return { ...checks, report, pass: complete && checks.vagueFailedBothAsked.ok && checks.clearQuiet.ok && checks.neverBreaks.ok && checks.declarationValid.ok };
}

export async function runBatch({
  tag, jobs = JOBS, outDir = __dirname, spendPath = join(outDir, 'spend.jsonl'), stopUsd = SPEND_STOP_USD,
  budgetUsd = PER_JOB_BUDGET_USD, deadlineMs = CALL_DEADLINE_MS, env = process.env, injected, model = DEFAULT_MODEL,
  writeLine = (s) => process.stdout.write(`${s}\n`),
}) {
  // ---- $0 gates, before any ledger write -------------------------------------------
  if (!tag || /[^A-Za-z0-9._-]/.test(tag)) throw new Error('run: --tag is required (letters, digits, . _ - only)');
  if (!injected) {
    const key = checkKeyPreflight('deepseek', env);
    if (!key.ok) throw new Error(key.message);
  }
  const resultsPath = join(outDir, `results-${tag}.json`);
  if (existsSync(resultsPath)) throw new Error(`run: tag "${tag}" already has results — use a new --tag, never overwrite evidence`);
  const secrets = secretsFromEnv(env.DEEPSEEK_API_KEY);
  const roundCeiling = ceilingCostUsd(injected?.modelId ?? model);

  const records = [];
  let stoppedBy = null;
  for (let i = 0; i < jobs.length; i += 1) {
    const job = jobs[i];
    const total = ledgerTotalUsd(spendPath);
    if (total + roundCeiling > stopUsd) {
      stoppedBy = `spend: ledger $${total.toFixed(4)} + one round's ceiling $${roundCeiling.toFixed(4)} would pass $${stopUsd.toFixed(2)}`;
      break;
    }
    const started = Date.now();
    let r;
    try {
      // eslint-disable-next-line no-await-in-loop
      r = await withDeadline(draftWithQuestions({ proseText: job.prose, model, budgetUsd, env, ...(injected ?? {}) }), deadlineMs);
    } catch (err) {
      r = { stop: 'crash', passedTry1: null, passedTry2: null, reds: [`crash: ${err.message}`], questions: [], droppedQuestions: [], notChecked: null, declarationValid: false, costUsd: null, rounds: null, tokens: null };
    }
    const timedOut = !!r.__timedOut;
    if (timedOut) r = { stop: 'deadline', reds: ['wall-halt: call deadline'], questions: [], droppedQuestions: [], notChecked: null, declarationValid: false, costUsd: null, rounds: null, tokens: null };
    const wallMs = Date.now() - started;
    // Booked even when red/crashed; an unknown cost is null (the ledger reprices it at the ceiling), never 0.
    appendSpendRow(spendPath, {
      runId: `am25-${tag}-${job.id}`, step: 'draft-am25', model, modelReturned: r.modelReturned ?? null,
      costUsd: r.costUsd, rounds: r.rounds, calls: r.calls, spendComplete: r.spendComplete, wallMs,
    });
    const rec = {
      id: job.id, kind: job.kind, why: job.why, questions: r.questions, droppedQuestions: r.droppedQuestions,
      droppedCount: r.droppedQuestions.length, passedTry1: r.passedTry1 ?? null, passedTry2: r.passedTry2 ?? null,
      failedLines: r.failedLines ?? [], tryReds: r.tryReds ?? null, triesRun: r.triesRun ?? null, notChecked: r.notChecked, declarationValid: r.declarationValid,
      stop: r.stop, stopReason: r.stopReason ?? null, rounds: r.rounds, structureRetries: r.structureRetries ?? null, tokens: r.tokens, costUsd: r.costUsd,
      modelReturned: r.modelReturned ?? null, wallMs, reds: r.reds,
    };
    records.push(rec);
    writeLine(`${job.id} (${job.kind}): ${r.stop ? `STOP ${r.stop}` : r.declarationValid ? 'valid' : 'RED'} q=${rec.questions.length} dropped=${rec.droppedCount} `
      + `notChecked=${rec.notChecked === null ? '-' : rec.notChecked.length} try1=${rec.passedTry1} try2=${rec.passedTry2} failedLines=[${rec.failedLines}] cost=${r.costUsd === null ? 'UNKNOWN' : `$${r.costUsd.toFixed(5)}`}`);
    for (const q of rec.questions) writeLine(`    ${job.kind} ${job.id} asked (line ${q.line}): ${q.question}`);
    if (timedOut) { stoppedBy = 'deadline: a call hung; stopping, its cost booked at the ceiling'; break; }
  }

  const unknown = records.some((x) => x.costUsd === null);
  const cost = records.reduce((s, x) => s + (x.costUsd ?? roundCeiling), 0);
  const verdict = evaluate(records, jobs);
  const summary = {
    tag, ran: records.length, of: jobs.length, stoppedBy, verdict,
    costUsd: unknown ? `at least ${cost.toFixed(5)} (some job unpriced)` : Number(cost.toFixed(5)),
    perDraftUsd: records.length && !unknown ? Number((cost / records.length).toFixed(6)) : null,
    ledgerTotalUsd: Number(ledgerTotalUsd(spendPath).toFixed(5)),
  };
  writeFileSync(resultsPath, scrub(`${JSON.stringify({ summary, records }, null, 2)}\n`, secrets), { flag: 'wx' });
  writeLine(`SUMMARY ${JSON.stringify(summary)}`);
  writeLine(`vague jobs that failed tries 1 and 2 and asked a failed-line question: ${verdict.vagueFailedBothAsked.got}/${verdict.vagueFailedBothAsked.of} (need all)${verdict.report.vacuous ? ' VACUOUS: no vague job failed both tries' : ''}`);
  writeLine(`reported only: vague passed try 1 = ${verdict.report.vaguePassedTry1}, passed try 2 = ${verdict.report.vaguePassedTry2}, failed both = ${verdict.report.vagueFailedBoth}`);
  writeLine(`clear asked nothing: ${verdict.clearQuiet.got}/${verdict.clearQuiet.of} (need ${verdict.clearQuiet.need})`);
  writeLine(`calls that broke (stop != null): ${verdict.neverBreaks.broken} (need 0)`);
  writeLine(`declaration valid: ${verdict.declarationValid.got}/${verdict.declarationValid.of} (need ${verdict.declarationValid.need})`);
  writeLine(verdict.pass ? 'BAR: PASS' : `BAR: FAIL${verdict.complete ? '' : ' (incomplete run)'}`);
  return { records, summary };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const i = process.argv.indexOf('--tag');
  const tag = i !== -1 ? process.argv[i + 1] : undefined;
  runBatch({ tag }).then(
    ({ summary }) => process.exit(summary.verdict.pass ? 0 : 3),
    (err) => { process.stderr.write(`REFUSED: ${scrub(err.message, secretsFromEnv(process.env.DEEPSEEK_API_KEY))}\n`); process.exit(1); },
  );
}
