// M4e amendment 28 POC — paid-batch runner. NOT the product.
//
//   export DEEPSEEK_API_KEY=$(pass amr/deepseek_api | head -n1 | tr -d '\r\n')
//   setsid nohup node poc/am28-word-limit/run.mjs --tag am28-1 > poc/am28-word-limit/am28-1.log 2>&1 &
//
// One real drafter round per job (draft.mjs, am28 wording). Per job: the maxWords and wordsPerSection the model wrote on the
// guardrail's step vs the known right answer. BAR: all 10 right. $0 gates before any ledger write: empty/odd key, existing tag.
// Spend stop: before each job, ledger total (an unpriced row counts at its ceiling) + one round's ceiling must stay <= $0.25.
// Results are write-once (wx); nothing written contains the key.

import { existsSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkKeyPreflight, appendSpendRow, ceilingCostUsd } from '../../src/provider.js';
import { ledgerTotalUsd, scrub, secretsFromEnv } from '../m6a/batch.mjs';
import { draftOnce } from './draft.mjs';
import { JOBS } from './jobs.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SPEND_STOP_USD = 0.25;
export const PER_JOB_BUDGET_USD = 0.10;
export const CALL_DEADLINE_MS = 300_000;
const DEFAULT_MODEL = 'deepseek-flash';
export const BAR_TEXT = 'BAR: the model picks the right maxWords (and wordsPerSection where the guardrail gives one, omits it where not) on all 10 jobs.';

function withDeadline(promise, ms) {
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ __timedOut: true }), ms); });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** What the model wrote for the guardrail's line: the first step with fromLine = that line, its close.shape numbers. */
export function extractWrote(steps, line) {
  const st = Array.isArray(steps) ? steps.find((s) => s && s.fromLine === line) : undefined;
  const shape = st?.close?.shape;
  const has = (k) => shape && typeof shape === 'object' && Object.hasOwn(shape, k);
  return { stepFound: !!st, maxWords: has('maxWords') ? shape.maxWords : null, wordsPerSection: has('wordsPerSection') ? shape.wordsPerSection : null };
}

/** The am28 mechanism, reported only: does the number appear word for word in the guardrail (digits, commas allowed)? */
export function appearsInGuardrail(n, guardrail) {
  if (!Number.isInteger(n)) return false;
  const nums = [...String(guardrail).matchAll(/\d[\d,]*/g)].map((m) => Number(m[0].replace(/,/g, '')));
  return nums.includes(n);
}

/** Strict equality, no tolerance: a number is right or wrong. null = must be absent. */
export function scoreJob(job, wrote) {
  const maxOk = wrote.maxWords === job.expect.maxWords;
  const perOk = wrote.wordsPerSection === job.expect.wordsPerSection;
  return { maxOk, perOk, pass: wrote.stepFound && maxOk && perOk };
}

export function evaluate(records, jobs = JOBS) {
  const complete = records.length === jobs.length;
  const right = records.filter((r) => r.pass).length;
  const broken = records.filter((r) => r.stop !== null).length;
  return { complete, right, of: jobs.length, broken, pass: complete && right === jobs.length };
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

  writeLine(BAR_TEXT);
  const records = [];
  let stoppedBy = null;
  for (const job of jobs) {
    const total = ledgerTotalUsd(spendPath);
    if (total + roundCeiling > stopUsd) {
      stoppedBy = `spend: ledger $${total.toFixed(4)} + one round's ceiling $${roundCeiling.toFixed(4)} would pass $${stopUsd.toFixed(2)}`;
      break;
    }
    const started = Date.now();
    let r;
    try {
      // eslint-disable-next-line no-await-in-loop
      r = await withDeadline(draftOnce({ proseText: job.prose, model, budgetUsd, env, ...(injected ?? {}) }), deadlineMs);
    } catch (err) {
      r = { stop: 'crash', stopReason: err.message, steps: null, costUsd: null, rounds: null, calls: null, tokens: null };
    }
    const timedOut = !!r.__timedOut;
    if (timedOut) r = { stop: 'deadline', stopReason: 'call deadline', steps: null, costUsd: null, rounds: null, calls: null, tokens: null };
    const wallMs = Date.now() - started;
    // Booked even when red/crashed; an unknown cost is null (the ledger reprices it at the ceiling), never 0.
    appendSpendRow(spendPath, {
      runId: `am28-${tag}-${job.id}`, step: 'draft-am28', model, modelReturned: r.modelReturned ?? null,
      costUsd: r.costUsd, rounds: r.rounds, calls: r.calls, spendComplete: r.spendComplete, wallMs,
    });
    const wrote = extractWrote(r.steps, job.guardrailLine);
    const score = r.stop === null ? scoreJob(job, wrote) : { maxOk: false, perOk: false, pass: false };
    const rec = {
      id: job.id, guardrail: job.guardrail, trap: job.trap, expected: job.expect, wrote,
      maxInGuardrail: appearsInGuardrail(wrote.maxWords, job.guardrail),
      perInGuardrail: wrote.wordsPerSection === null ? null : appearsInGuardrail(wrote.wordsPerSection, job.guardrail),
      ...score, stop: r.stop, stopReason: r.stopReason ?? null, rounds: r.rounds, tokens: r.tokens, costUsd: r.costUsd,
      modelReturned: r.modelReturned ?? null, wallMs,
    };
    records.push(rec);
    writeLine(`${job.id} [${job.guardrail}]: ${r.stop ? `STOP ${r.stop} ${r.stopReason ?? ''}` : score.pass ? 'RIGHT' : 'WRONG'} `
      + `maxWords wrote=${wrote.maxWords} want=${job.expect.maxWords}; wordsPerSection wrote=${wrote.wordsPerSection} want=${job.expect.wordsPerSection} `
      + `cost=${r.costUsd === null ? 'UNKNOWN' : `$${r.costUsd.toFixed(5)}`}`);
    if (timedOut) { stoppedBy = 'deadline: a call hung; stopping, its cost booked at the ceiling'; break; }
  }

  const unknown = records.some((x) => x.costUsd === null);
  const cost = records.reduce((s, x) => s + (x.costUsd ?? roundCeiling), 0);
  const verdict = evaluate(records, jobs);
  const summary = {
    tag, ran: records.length, of: jobs.length, stoppedBy, verdict,
    costUsd: unknown ? `at least ${cost.toFixed(5)} (some job unpriced)` : Number(cost.toFixed(5)),
    ledgerTotalUsd: Number(ledgerTotalUsd(spendPath).toFixed(5)),
  };
  writeFileSync(resultsPath, scrub(`${JSON.stringify({ summary, records }, null, 2)}\n`, secrets), { flag: 'wx' });
  writeLine(`SUMMARY ${JSON.stringify(summary)}`);
  writeLine(`right: ${verdict.right}/${verdict.of} (need all); calls that broke: ${verdict.broken}`);
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
