// $5.00 hard cap across every LLM round M0 runs today, plus a $0.25 cap per
// run's Loop (bare-agent's Loop has no built-in cost cap — that's bareguard's
// job via `wireGate`, and bareguard isn't installed for this POC — so this
// file enforces both caps in plain application code; <60 lines, vanilla
// stdlib only, per the dependency hierarchy).
//
// Money honesty (PRD §5): unknown cost is NEVER rendered as 0. A row with a
// null costUsd counts as "at the cap" for the purposes of the global guard —
// it blocks further spend rather than being silently treated as free.
//
// `estimated` is a state, not a refusal (bareloop money doctrine, PRD §5): a
// row priced at its CEILING (the most it could possibly have cost, because
// the response never arrived) carries `estimated: true` and a real numeric
// `costUsd` — it counts fully against the cap like any other row, but does
// NOT set the `unknown` flag, because its cost is not unknown, it's bounded.
// A row with `costUsd: null` (no ceiling could be computed) still blocks —
// that rule is not relaxed by this change.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GLOBAL_CAP_USD = 5.00;
export const RUN_CAP_USD = 0.25;

/**
 * Sum of costUsd across every row in spend.jsonl.
 * - `unknown: true` if any row's cost is null/undefined (no ceiling, genuinely unpriceable).
 * - `estimatedPortion`: sum of costUsd for rows carrying `estimated: true` (priced at a
 *   ceiling, not a real metered cost) — informational, already included in `total`.
 */
export function readSpend(path) {
  if (!existsSync(path)) return { total: 0, estimatedPortion: 0, unknown: false, rows: 0 };
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  let total = 0;
  let estimatedPortion = 0;
  let unknown = false;
  for (const line of lines) {
    const row = JSON.parse(line);
    if (row.costUsd === null || row.costUsd === undefined) {
      unknown = true;
      continue;
    }
    total += row.costUsd;
    if (row.estimated === true) estimatedPortion += row.costUsd;
  }
  return { total, estimatedPortion, unknown, rows: lines.length };
}

/** Throws if the global spend is already at/over cap (unknown cost also blocks — never rendered as 0). */
export function assertUnderGlobalCap(path, capUsd = GLOBAL_CAP_USD) {
  const { total, unknown } = readSpend(path);
  if (unknown) throw new Error(`spend tally has an unpriced round — cost unknown is never rendered as $0; refusing further spend (${path})`);
  if (total >= capUsd) throw new Error(`global spend cap reached: $${total.toFixed(6)} >= $${capUsd.toFixed(2)} (${path})`);
  return total;
}

/**
 * Compare the model we ASKED for against the model the provider says it SERVED.
 * F14: they are not always the same, and nothing was watching.
 *
 * - `match`      — identical.
 * - `prefix`     — identical once a routing prefix is stripped (`hf:openai/x` -> `openai/x`).
 *                  Cosmetic; the provider's own router prepends it.
 * - `alias`      — the request was a DECLARED alias (`syn:large:text`) that names no concrete
 *                  model, so resolving it to one is the alias doing its job. Recorded, not a red.
 * - `substituted`— we named a concrete model and got a DIFFERENT concrete model. This is the
 *                  one that matters: the signed hash records what we REQUESTED, so a silent
 *                  swap changes what actually ran without changing the hash.
 * - `unreported` — the provider told us nothing. Never treated as a match.
 */
export function classifyModelId(requested, returned) {
  if (!requested) return 'unreported';
  if (returned === null || returned === undefined || returned === '') return 'unreported';
  if (requested === returned) return 'match';
  if (String(requested).replace(/^[a-z]+:/, '') === returned) return 'prefix';
  if (/^syn:/.test(requested)) return 'alias';
  return 'substituted';
}

/**
 * Sum EVERY round of a Loop into one spend row (F15). bare-agent fires
 * `onLlmResult` once per round, and a tool-calling run has at least two: the
 * round that emits the tool call, then a short finishing round. A call site
 * that assigns `metering = event` keeps only the LAST one, so the ledger
 * recorded the finishing round's tokens and silently dropped the round that did
 * the work. That understates spend, which PRD §5 forbids.
 *
 * Money honesty is preserved in the strict direction: if ANY round has no
 * priced cost, the total is `null` — unknown, never 0, never a partial sum
 * passed off as complete. `rounds` records how many rounds were folded in, so
 * a row can never again look like a one-round run when it was not.
 */
export function sumMeterings(events) {
  const rounds = Array.isArray(events) ? events.filter(Boolean) : [];
  if (rounds.length === 0) {
    return {
      rounds: 0, tokens: null, costUsd: null, model: null, rateSource: null,
    };
  }
  const tokens = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
  };
  let costUsd = 0;
  let costKnown = true;
  for (const ev of rounds) {
    for (const key of Object.keys(tokens)) tokens[key] += ev?.usage?.[key] ?? 0;
    if (ev?.costUsd == null) costKnown = false;
    else costUsd += ev.costUsd;
  }
  const last = rounds[rounds.length - 1];
  return {
    rounds: rounds.length,
    tokens,
    costUsd: costKnown ? costUsd : null,
    model: last?.model ?? null,
    rateSource: last?.rateSource ?? null,
  };
}

export function appendSpendRow(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  const modelMatch = classifyModelId(row.model, row.modelReturned);
  if (modelMatch === 'substituted') {
    process.emitWarning(
      `spend: asked for model "${row.model}" but the provider served "${row.modelReturned}" `
      + '— the signed hash records the request, not what ran',
    );
  }
  appendFileSync(path, `${JSON.stringify({ ...row, modelMatch })}\n`);
}

/**
 * List-rate ceilings (USD/1K tokens). GLM-5.2 and Kimi-K3 hand-entered from synthetic.new's
 * pricing page (same as poc/probe-synthetic.mjs). The bake-off (docs/logs/2026-09-08-model-
 * bakeoff.md) added the rest: a real published list rate where one could be found (source
 * lab or a listed inference provider), converted to USD/1K; where none could be found (the
 * two generic `syn:` aliases), the HIGHEST rate already in this table is used as a ceiling —
 * never priced at 0. `source: 'published'` vs `'ceiling'` documents which is which; it is
 * informational (bare-agent's Loop stamps every row's rateSource 'caller' regardless, since
 * we always supply rates) and is the source of truth for the bake-off report's rate table.
 */
export const RATES_BY_SUFFIX = {
  'zai-org/GLM-5.2': { in: 0.0006, out: 0.0022, source: 'published' },
  'moonshotai/Kimi-K3': { in: 0.0006, out: 0.0025, source: 'published' },
  'zai-org/GLM-5.3-Flash': { in: 0.00015, out: 0.0005, source: 'published' }, // Zhipu list price, $0.15/$0.50 per 1M
  'zai-org/GLM-4.7-Flash': { in: 0.00006, out: 0.0004, source: 'published' }, // Zhipu list price, $0.06/$0.40 per 1M
  'Qwen/Qwen3.8-27B': { in: 0.00015, out: 0.002, source: 'published' }, // OpenRouter list price, $0.15/$2.00 per 1M
  'openai/gpt-oss-120b': { in: 0.00003, out: 0.00017, source: 'published' }, // OpenRouter list price, $0.03/$0.17 per 1M
  'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4': { in: 0.000085, out: 0.0004, source: 'published' }, // OpenRouter list price, $0.085/$0.40 per 1M (base variant; NVFP4 quant price not separately listed)
  'syn:large:text': { in: 0.0006, out: 0.0025, source: 'ceiling' }, // no published rate found for this synthetic.new alias — ceilinged at the highest rate in this table (Kimi-K3's)
  'syn:small:text': { in: 0.0006, out: 0.0025, source: 'ceiling' }, // same — no published rate found
  'deepseek-v4-flash': { in: 0.00044, out: 0.00132, source: 'published' }, // DeepSeek official pricing (https://api-docs.deepseek.com/quick_start/pricing, read 2026-09-09): cache-MISS, PEAK $0.44/$1.32 per 1M tokens — peak (the higher of peak/off-peak) used as the ceiling; cache-hit input is cheaper ($0.007-$0.014/1M) and not used, per the cache-miss ceiling rule
  'deepseek-v4-pro': { in: 0.00132, out: 0.00396, source: 'published' }, // DeepSeek official pricing (https://api-docs.deepseek.com/quick_start/pricing, read 2026-09-09): cache-MISS, PEAK $1.32/$3.96 per 1M tokens — see deepseek-v4-flash note above
};
