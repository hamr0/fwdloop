// M2 POC — "a step that sees only the gap can heal" (docs/wiki/the-module-
// ladder.md M2 POC paragraph, SIGNED by hamr 2026-09-24). Reuses job #2's
// real compose step (poc/m0/job2.mjs's compose line + `JOB2_SHAPE`,
// poc/m0/shape.mjs's `closeWordsAndSections`) but wraps it in the M2
// gap-back loop instead of job #2's own `askWithRedo` — this file is the
// loop + the live batch, never job #2's own fold.
//
// The signed plant: attempt 1's GOAL (never the close) asks for a fourth
// section ("and a fourth section: certifications") the real shape does not
// want; every attempt after it sees the SAME goal plus ONLY the gap text
// (the closer's own `red` string) — "goal in, gap back" per M2 scope item 3.
// Strikes per item 5: STRIKE_LIMIT = 2, a run-owned constant, never raised
// by a caller (`strikeLimit` is a parameter only so tests can prove the
// mechanism at small numbers — the live batch below always passes the
// constant, never a caller-supplied override).

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildExecutor } from './executor.mjs';
import { bindJob2Stages, JOB2_SHAPE } from '../m0/job2.mjs';
import { closeWordsAndSections } from '../m0/shape.mjs';
import { readDocxText } from '../m0/docx.mjs';
import { runModelStepOnPrimitives } from '../m0/runner.mjs';
import { PROVIDER_SLOTS, resolveModelRate } from '../m0/provider.mjs';
import { checkKeyPreflight } from '../m1/slot-batch.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const OUT_DIR = join(__dirname, 'out');
const JOB2_PROSE_PATH = join(REPO_ROOT, 'poc', 'm0', 'job2.prose.txt');

// M2 scope item 5, SIGNED: the runner owns this constant — not in the
// arbiter block, not in the declaration, so nothing can raise it. Exported
// only so tests can assert the live batch actually uses it (never a second,
// drifting copy of "2").
export const STRIKE_LIMIT = 2;
export const MAX_ATTEMPTS = 4;

// ---------------------------------------------------------------------------
// normaliseGap — lowercase, every digit run collapsed to one '#', whitespace
// collapsed. "612 words, limit 600" and "613 words, limit 600" normalise
// identically (both are the SAME shape of gap, a word-count miss); a
// different section gap normalises differently. Never throws on a
// non-string (a defensive read, not a contract this file relies on).
// ---------------------------------------------------------------------------
export function normaliseGap(red) {
  if (typeof red !== 'string') return '';
  return red.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// THE LOOP — ralph with strikes. See M2 scope item 5 (ladder ~385-392) and
// the POC paragraph (~423-431) for the rules this encodes.
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.goal - fixed for the whole step (the signed plant lives IN this string,
 *   never varied per attempt — "goal in, gap back")
 * @param {{resumeText:string, jdText:string}} opts.reads
 * @param {(text:string) => {verdict:string, red?:string}} opts.close
 * @param {(executorContext:object) => Promise<{ok:boolean, text?:string, costUsd:number|null, red?:string}>} opts.modelStep
 * @param {number} [opts.strikeLimit]
 * @param {number} [opts.maxAttempts]
 * @param {(row:object) => void} [opts.onAttempt]
 */
export async function runGapBackStep({
  goal, reads, close, modelStep, strikeLimit = STRIKE_LIMIT, maxAttempts = MAX_ATTEMPTS, onAttempt,
}) {
  const attempts = [];
  const seenGaps = new Set();
  let strikes = 0;
  let costUsd = 0;
  let gap = null;

  const record = (row) => {
    attempts.push(row);
    if (typeof onAttempt === 'function') onAttempt(row);
  };

  for (let n = 1; n <= maxAttempts; n += 1) {
    const executorContext = buildExecutor({ goal, reads, gap });
    // eslint-disable-next-line no-await-in-loop
    const result = await modelStep(executorContext);

    if (!result.ok) {
      record({
        n, gap, verdict: 'model-red', red: result.red ?? null, costUsd: result.costUsd ?? null, strike: false, text: null,
      });
      return {
        verdict: 'model-red', attempts, costUsd, healed: false,
      };
    }

    // Money honesty: a null cost is never coerced to 0 — it stops the run
    // outright, naming the run's total a floor (M2 scope item 7).
    if (result.costUsd === null || result.costUsd === undefined) {
      record({
        n, gap, verdict: 'pricing-red', red: result.red ?? null, costUsd: null, strike: false, text: result.text ?? null,
      });
      return {
        verdict: 'pricing-red', attempts, costUsd, spendComplete: false, healed: false,
      };
    }
    costUsd += result.costUsd;

    const { text } = result;
    // Item 10 (M2 scope): the mechanical happened check — a 0-byte/absent
    // artifact is a red naming the step, and per item 5 it also strikes
    // ("or wrote no artifact") — it never reaches `close` at all.
    if (typeof text !== 'string' || text.length === 0) {
      strikes += 1;
      const strike = true;
      record({
        n, gap, verdict: 'red', red: 'empty artifact', costUsd: result.costUsd, strike, text: text ?? null,
      });
      if (n === maxAttempts) {
        return {
          verdict: 'attempt-fallback', attempts, costUsd, healed: false,
        };
      }
      if (strikes >= strikeLimit) {
        return {
          verdict: 'struck-out', attempts, costUsd, healed: false,
        };
      }
      gap = 'empty artifact';
      // eslint-disable-next-line no-continue
      continue;
    }

    const closed = close(text);

    if (closed.verdict === 'green') {
      record({
        n, gap, verdict: 'green', red: null, costUsd: result.costUsd, strike: false, text,
      });
      return {
        verdict: 'green', attempts, costUsd, healed: n >= 2,
      };
    }

    if (closed.verdict !== 'red') {
      // A closer that renders no judgment (e.g. 'unparseable') is a
      // CASUALTY, never a red and never a strike (bareloop F17) — the run
      // stops naming exactly which non-verdict it hit.
      record({
        n, gap, verdict: 'close-casualty', red: closed.red ?? null, costUsd: result.costUsd, strike: false, text,
      });
      return {
        verdict: 'close-casualty', attempts, costUsd, healed: false, casualty: closed.verdict,
      };
    }

    const normalised = normaliseGap(closed.red);
    const strike = seenGaps.has(normalised);
    seenGaps.add(normalised);
    if (strike) strikes += 1;
    record({
      n, gap, verdict: 'red', red: closed.red, costUsd: result.costUsd, strike, text,
    });

    // The blind fallback is a HARD stop at maxAttempts, checked before the
    // strike governor — bareloop's rule ("the count is a fallback, never
    // the governor") means it never RAISES the bar the strike governor
    // sets, but at the shared boundary attempt it is the one that reports,
    // since it is unconditional ("hard-stop") where the governor is not.
    if (n === maxAttempts) {
      return {
        verdict: 'attempt-fallback', attempts, costUsd, healed: false,
      };
    }
    if (strikes >= strikeLimit) {
      return {
        verdict: 'struck-out', attempts, costUsd, healed: false,
      };
    }
    gap = closed.red;
  }
  // Unreachable: the loop above always returns by n === maxAttempts.
  return {
    verdict: 'attempt-fallback', attempts, costUsd, healed: false,
  };
}

// ---------------------------------------------------------------------------
// THE BATCH — n live runs on a real provider slot. Never executed by
// `node --test` (no test file imports this function with a real slot/live
// path — every test injects its own `modelStepFactory`, mirroring
// poc/m1/slot-batch.mjs's own `providerForDraft` injection seam).
// ---------------------------------------------------------------------------

function jsonlPath(outDir, tag) {
  return join(outDir, `gapback-${tag}.jsonl`);
}

function runDirPath(outDir, tag) {
  return join(outDir, `gapback-${tag}`);
}

function appendJsonl(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(row)}\n`, { flag: 'a' });
}

/**
 * The live, default `modelStep` factory: one `runModelStepOnPrimitives`
 * round per attempt (runner.mjs's own metering/retry/ledger machinery,
 * never duplicated here), fed the executor context's own fields.
 */
function makeLiveModelStepFactory({
  slot, model, spendPath,
}) {
  return (runId) => async function liveModelStep(executorContext) {
    const result = await runModelStepOnPrimitives({
      runId,
      stepLabel: 'm2-gapback',
      slot,
      model,
      spendPath,
      systemPrompt: executorContext.systemPrompt,
      userContent: executorContext.userContent,
      toolName: executorContext.toolName,
      toolDescription: executorContext.toolDescription,
      toolSchema: executorContext.toolSchema,
    });
    if (!result.ok) return { ok: false, red: result.red, costUsd: null };
    return { ok: true, text: result.args?.text, costUsd: result.metered?.costUsd ?? null };
  };
}

/**
 * @param {object} opts
 * @param {number} opts.n - number of runs
 * @param {string} opts.tag - names this batch's output files; refuses if they already exist
 * @param {string} opts.slot - 'deepseek' | 'synthetic'
 * @param {string} [opts.model]
 * @param {string} [opts.outDir]
 * @param {string} opts.resumePath - a real .docx path (no in-repo fixture — same discipline as
 *   poc/m0/job2.mjs's and poc/m1/slot-batch.mjs's own --resume/--jd)
 * @param {string} opts.jdPath - a real JD text/markdown path
 * @param {boolean} [opts.plantFourSections] - default true; the signed plant (item "POC first")
 * @param {(runId:string) => (executorContext:object) => Promise<object>} [opts.modelStepFactory] -
 *   injectable for tests; never called before the fresh-tag refusal below
 */
export async function runGapBackBatch({
  n, tag, slot, model, outDir = OUT_DIR, resumePath, jdPath, plantFourSections = true, modelStepFactory,
}) {
  const jsonl = jsonlPath(outDir, tag);
  // Refuse FIRST, before any file read, any provider, any spend — never
  // overwrite evidence (M2 scope item 9's own discipline, applied here).
  if (existsSync(jsonl)) {
    throw new Error(`gapback: ${jsonl} already exists — refusing to overwrite a consumed tag's evidence`);
  }

  const proseText = readFileSync(JOB2_PROSE_PATH, 'utf8');
  const bound = bindJob2Stages(proseText);
  if (!bound.ok) throw new Error(`gapback: ${bound.red}`);
  const baseGoal = bound.composeLine.text;
  const goal = plantFourSections ? `${baseGoal} and a fourth section: certifications.` : baseGoal;

  const resumeRead = readDocxText(resumePath);
  if (!resumeRead.ok) throw new Error(`gapback: resume: ${resumeRead.red}`);
  const jdText = readFileSync(jdPath, 'utf8');

  const spendPath = join(outDir, 'spend.jsonl');
  const runDir = runDirPath(outDir, tag);
  mkdirSync(runDir, { recursive: true });

  const buildModelStep = modelStepFactory ?? makeLiveModelStepFactory({ slot, model, spendPath });
  const close = (text) => closeWordsAndSections(text, { maxWords: JOB2_SHAPE.maxWords, sections: JOB2_SHAPE.sections });

  let greenAt1 = 0;
  let healed = 0;
  let greenByAttempt3 = 0;
  let struckOut = 0;
  let fallback = 0;
  let pricingRed = 0;
  let totalCostUsd = 0;
  let spendComplete = true;

  for (let i = 1; i <= n; i += 1) {
    const runId = `m2-gapback-${tag}-${i}`;
    const modelStep = buildModelStep(runId);
    // eslint-disable-next-line no-await-in-loop
    const stepResult = await runGapBackStep({
      goal,
      reads: { resumeText: resumeRead.text, jdText },
      close,
      modelStep,
      onAttempt: (row) => {
        console.log(`run ${i} attempt ${row.n} verdict=${row.verdict} gap="${row.gap ?? ''}" $${row.costUsd ?? 'null'}`);
      },
    });

    totalCostUsd += stepResult.costUsd;
    if (stepResult.spendComplete === false) spendComplete = false;
    if (stepResult.verdict === 'green') {
      if (stepResult.attempts.length === 1) greenAt1 += 1;
      if (stepResult.healed) healed += 1;
      if (stepResult.attempts.length <= 3) greenByAttempt3 += 1;
    } else if (stepResult.verdict === 'struck-out') {
      struckOut += 1;
    } else if (stepResult.verdict === 'attempt-fallback') {
      fallback += 1;
    } else if (stepResult.verdict === 'pricing-red') {
      pricingRed += 1;
    }

    writeFileSync(
      join(runDir, `run-${i}.json`),
      JSON.stringify({ runId, goal, ...stepResult }, null, 2),
    );
    appendJsonl(jsonl, {
      runId, i, verdict: stepResult.verdict, attempts: stepResult.attempts.length, healed: stepResult.healed ?? false, costUsd: stepResult.costUsd, spendComplete: stepResult.spendComplete !== false,
    });
  }

  console.log(
    `SUMMARY tag=${tag} n=${n} greenAt1=${greenAt1} healed=${healed} greenByAttempt3=${greenByAttempt3} `
    + `struckOut=${struckOut} fallback=${fallback} pricingRed=${pricingRed} costUsd=${totalCostUsd} spendComplete=${spendComplete}`,
  );

  return {
    n, greenAt1, healed, greenByAttempt3, struckOut, fallback, pricingRed, costUsd: totalCostUsd, spendComplete,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point — the one live call site, opt-in only (needs a real
// provider slot key). Never executed by `node --test`.
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const idx = process.argv.indexOf(`--${name}`);
    return idx !== -1 ? process.argv[idx + 1] : undefined;
  };

  const tag = arg('tag');
  const nRaw = arg('n') ?? '20';
  const n = Number(nRaw);
  const slot = arg('slot') ?? 'deepseek';
  const model = arg('model');
  const resumePath = arg('resume');
  const jdPath = arg('jd');
  const plantFourSections = !process.argv.includes('--no-plant');

  if (!tag) {
    console.error('usage: node poc/m2/gapback.mjs --n 20 --tag <tag> --slot deepseek|synthetic '
      + '[--model <id>] --resume <resume.docx> --jd <jd.md> [--no-plant]');
    process.exit(1);
  }
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`gapback: --n must be a positive integer, got "${nRaw}"`);
    process.exit(1);
  }
  if (!PROVIDER_SLOTS[slot]) {
    console.error(`gapback: unknown --slot "${slot}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
    process.exit(1);
  }
  if (!resumePath || !jdPath) {
    console.error('gapback: --resume <resume.docx> and --jd <jd.md> are required — there is no in-repo fixture.');
    process.exit(1);
  }

  // $0 key preflight, before any spend row — see poc/m1/slot-batch.mjs's
  // own checkKeyPreflight header for the live incident this closes.
  const keyCheck = checkKeyPreflight(slot);
  if (!keyCheck.ok) {
    console.error(keyCheck.message);
    process.exit(1);
  }

  // Fails fast on an unknown model rate before any run spends a cent.
  resolveModelRate(model ?? PROVIDER_SLOTS[slot].defaultModel);

  try {
    await runGapBackBatch({
      n, tag, slot, model, resumePath, jdPath, plantFourSections,
    });
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
