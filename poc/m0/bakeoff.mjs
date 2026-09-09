// M0 MODEL BAKE-OFF (continuation, 2026-09-08). PRD §11 P10: "the model is
// chosen last, by the suite." This file does NOT reimplement the job — it
// drives the SAME `runDeclaration` fold from runner.mjs (same prompts, same
// close, same schemas) across every candidate model, N times each, and
// tallies the result from `poc/m0/out/spend.jsonl` + each run's
// `result.json`. It never edits runner.mjs's step logic or close.mjs's
// grammar; only orchestrates repeated calls and records what happened.
//
// The job under test is the CLEAN run (plant d) only, per the brief: the
// ask/send steps are mechanical (no LLM call) and not what's measured, but
// they're left wired in (cheaper to run them than to fork runDeclaration) —
// the final "ok to send?" ask is pre-answered by writing accept BEFORE the
// run starts, so the run never blocks on a human.
//
// Usage:
//   SYNTHETIC_API_KEY="$(pass show amr/synthetic_api | head -1)" \
//     node poc/m0/bakeoff.mjs [--n 3] [--models hf:zai-org/GLM-5.2,...]

import {
  readFileSync, writeFileSync, mkdirSync, existsSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDeclaration } from './runner.mjs';
import { readSpend } from './spend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');
const ABORT_THRESHOLD_USD = 2.00;

export const CANDIDATES = [
  'hf:zai-org/GLM-5.2',
  'hf:zai-org/GLM-5.3-Flash',
  'hf:zai-org/GLM-4.7-Flash',
  'hf:moonshotai/Kimi-K3',
  'hf:Qwen/Qwen3.8-27B',
  'hf:openai/gpt-oss-120b',
  'hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4',
  'syn:large:text',
  'syn:small:text',
];

function suffixOf(modelId) { return modelId.replace(/^hf:/, ''); }
function slug(modelId) { return suffixOf(modelId).replace(/[/:]/g, '_'); }

function countLines(path) {
  if (!existsSync(path)) return 0;
  return readFileSync(path, 'utf8').split('\n').filter((l) => l.trim()).length;
}

function tailRows(path, fromCount) {
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  return lines.slice(fromCount).map((l) => JSON.parse(l));
}

/** Pre-answer the final "ok to send?" ask with accept, before the run starts. */
function preAcceptAsk(runId) {
  const outDir = join(OUT_DIR, runId);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, 'answer.json'), JSON.stringify({
    decision: 'accept', text: 'bake-off: auto-accepted, not measured', answeredAt: new Date().toISOString(),
  }, null, 2));
}

/** One run: pre-accept, call runDeclaration, diff spend.jsonl for this run's rows. */
async function runOne(modelId, runIndex) {
  const runId = `bakeoff-${slug(modelId)}-run${runIndex}`;
  preAcceptAsk(runId);
  const before = countLines(SPEND_PATH);
  const startedAt = Date.now();
  let outcome;
  let red = null;
  let threw = null;
  try {
    outcome = await runDeclaration({ modelId, plant: 'd', runId, askTimeoutMs: 15_000 });
  } catch (err) {
    threw = err;
    outcome = { outcome: 'stop-and-report', red: err.message };
  }
  const wallMs = Date.now() - startedAt;
  const spendRows = tailRows(SPEND_PATH, before);
  return {
    runId, modelId, wallMs, outcome: outcome.outcome, red: outcome.red ?? red, threw: threw?.message ?? null, spendRows,
  };
}

/** Per-run summary derived from the raw spend rows + the run's own outcome. */
function summarizeRun(run) {
  const byStep = {};
  for (const row of run.spendRows) {
    (byStep[row.step] ??= []).push(row);
  }
  const rounds = {};
  for (const step of ['derive1', 'derive2', 'compose']) {
    const rows = byStep[step] ?? [];
    if (rows.length === 0) { rounds[step] = null; continue; }
    const last = rows[rows.length - 1];
    const providerErrors = rows.filter((r) => r.error).length;
    rounds[step] = {
      attempts: rows.length,
      toolCalledFirstTry: rows.length === 1 && !last.error,
      providerErrors,
      stopReason: last.stopReason ?? null,
      tokensIn: last.tokens?.inputTokens ?? null,
      tokensOut: last.tokens?.outputTokens ?? null,
      costUsd: rows.reduce((s, r) => s + (r.costUsd ?? 0), 0),
      wallMs: rows.reduce((s, r) => s + (r.wallMs ?? 0), 0),
      error: last.error ?? null,
    };
  }
  const totalCostUsd = run.spendRows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
  const totalWallMs = run.spendRows.reduce((s, r) => s + (r.wallMs ?? 0), 0);
  const completedGreen = run.outcome === 'complete' || run.outcome === 'paused-ask-answered';
  return {
    runId: run.runId,
    completedGreen,
    outcome: run.outcome,
    red: run.red,
    totalCostUsd,
    totalWallMs,
    rounds,
  };
}

export async function bakeOff({ models = CANDIDATES, n = 3 } = {}) {
  mkdirSync(OUT_DIR, { recursive: true });
  const results = [];
  for (const modelId of models) {
    for (let i = 1; i <= n; i += 1) {
      // eslint-disable-next-line no-await-in-loop
      const run = await runOne(modelId, i);
      const summary = summarizeRun(run);
      results.push({ modelId, ...summary });
      // eslint-disable-next-line no-await-in-loop
      const spend = readSpend(SPEND_PATH);
      console.log(`[bakeoff] ${modelId} run${i}: ${summary.outcome} $${summary.totalCostUsd.toFixed(6)} ${summary.totalWallMs}ms — running total $${spend.total.toFixed(6)} (unknown=${spend.unknown})`);
      if (spend.unknown) {
        console.error(`ABORT: spend ledger has an unpriced (null) row — refusing further spend. See ${SPEND_PATH}`);
        return { results, aborted: 'unpriced-row' };
      }
      if (spend.total > ABORT_THRESHOLD_USD) {
        console.error(`ABORT: running total $${spend.total.toFixed(6)} passed the $${ABORT_THRESHOLD_USD} bake-off abort threshold`);
        return { results, aborted: 'threshold' };
      }
    }
  }
  return { results, aborted: null };
}

// CLI entry point.
if (import.meta.url === `file://${process.argv[1]}`) {
  const nIdx = process.argv.indexOf('--n');
  const n = nIdx !== -1 ? Number(process.argv[nIdx + 1]) : 3;
  const modelsIdx = process.argv.indexOf('--models');
  const models = modelsIdx !== -1 ? process.argv[modelsIdx + 1].split(',') : CANDIDATES;

  const { results, aborted } = await bakeOff({ models, n });
  const outPath = join(OUT_DIR, 'bakeoff-results.json');
  writeFileSync(outPath, JSON.stringify({ results, aborted }, null, 2));
  console.log(`\nwrote ${outPath}`);
  if (aborted) process.exit(2);
}
