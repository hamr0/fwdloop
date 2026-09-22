// $5.00 hard cap across every LLM round M0 runs today, plus a $0.25 cap per
// run's Loop (bare-agent's Loop has no built-in cost cap — that's bareguard's
// job via `wireGate`, and bareguard isn't installed for this POC — so this
// file enforces both caps in plain application code; <60 lines, vanilla
// stdlib only, per the dependency hierarchy).
//
// Money honesty (PRD §5, and hamr's ruling 2026-09-21, verbatim in spirit):
// "we always have a default set price and a human can override it; we're on
// deepseek so that's the default; no session should start with $0 or
// unknown pricing." A row with a null/undefined costUsd is NOT a state this
// ledger carries forward any more — `readSpend` reprices it at its CEILING
// (`ceilingCostUsd` below) the moment it is read, so the hole this closes is
// structural: a null row can never again sit in the ledger and lock the cap
// just by existing. It IS counted fully against the cap, exactly like any
// other row — the lock is money, not a state flag.
//
// `estimated` is a state, not a refusal (bareloop money doctrine, PRD §5): a
// row priced at its CEILING (the most it could possibly have cost, because
// the response never arrived, OR because it was written before this fix and
// left costUsd null) carries/receives `estimated: true` and a real numeric
// `costUsd` — it counts fully against the cap like any other row, but does
// NOT set the `unknown` flag, because its cost is not unknown, it's bounded.
// The remaining third outcome — a ledger LINE that is not parseable JSON at
// all — is not "unknown pricing", it's a corrupt file, and stays a hard
// throw out of `JSON.parse` (see the comment on that line below); it is
// never folded into `unknown`, which this file no longer sets to true for
// any well-formed row.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GLOBAL_CAP_USD = 5.00;
export const RUN_CAP_USD = 0.25;

// The two hard bounds every round is priced against when its real cost is
// unavailable (a throw, a timeout, or an old ledger row stuck at null):
//   - CEILING_OUTPUT_TOKENS (16000): the per-round `maxTokens` every round
//     in this tree uses (drafter.mjs's DRAFTER_MAX_TOKENS et al) — no round
//     can ever emit more than this regardless of how long it hangs.
//   - CEILING_INPUT_TOKENS (32000): a documented, generous bound on the
//     largest prompt this project sends (primitive catalogue + job lines +
//     scout facts block, a few thousand tokens in practice) — never a
//     measured number passed off as exact.
export const CEILING_INPUT_TOKENS = 32000;
export const CEILING_OUTPUT_TOKENS = 16000;

/**
 * Strip a `hf:` routing prefix and look up `suffix` in `ratesTable` with
 * Object.hasOwn — never plain truthiness/`in`, which would let a suffix
 * like "constructor" resolve to an inherited Object.prototype member. ONE
 * writer for this lookup: provider.mjs's `resolveModelRate` calls this
 * directly instead of duplicating the same walk, so there is never a second
 * suffix table walked two different ways (and no circular import: this
 * file never imports provider.mjs).
 */
export function lookupRate(modelId, ratesTable = RATES_BY_SUFFIX) {
  if (!modelId) return null;
  const suffix = String(modelId).replace(/^hf:/, '');
  if (!Object.hasOwn(ratesTable, suffix)) return null;
  return { suffix, rates: ratesTable[suffix] };
}

/**
 * The ceiling cost (USD), never 0, never null, of one round of `modelId`:
 * a known model prices at its OWN in/out rate; an unknown or missing model
 * prices at the HIGHEST in rate and HIGHEST out rate anywhere in
 * `ratesTable` (this file's existing ceiling convention — see the comment
 * on RATES_BY_SUFFIX below). Bounded by CEILING_INPUT_TOKENS/
 * CEILING_OUTPUT_TOKENS above.
 */
export function ceilingCostUsd(modelId, ratesTable = RATES_BY_SUFFIX) {
  const resolved = lookupRate(modelId, ratesTable);
  const rates = resolved ? resolved.rates : {
    in: Math.max(...Object.values(ratesTable).map((r) => r.in)),
    out: Math.max(...Object.values(ratesTable).map((r) => r.out)),
  };
  return (CEILING_INPUT_TOKENS / 1000) * rates.in + (CEILING_OUTPUT_TOKENS / 1000) * rates.out;
}

/**
 * Sum of costUsd across every row in spend.jsonl.
 * - A row with a null/undefined costUsd is REPRICED here, at read time, at
 *   `ceilingCostUsd(row.model)` — added to both `total` and
 *   `estimatedPortion`, and counted in `repricedRows`. `unknown` is false
 *   for such a row: its cost is bounded, not unknown (hamr's ruling,
 *   2026-09-21 — see the header comment above).
 * - `estimatedPortion`: sum of costUsd for rows carrying `estimated: true`
 *   PLUS every row repriced here — informational, already included in
 *   `total`.
 * - `repricedRows`: how many rows this read had to reprice from null —
 *   never edits the ledger file itself, only what this read returns.
 * - `unknown` stays in the return shape for callers that still check it,
 *   but is now always `false`: the one remaining third outcome (an
 *   unparseable ledger LINE — a corrupt file, not an unpriced round) is not
 *   folded into it; `JSON.parse` below still throws on that line, same as
 *   before this change, and the caller sees a hard crash, never a silent
 *   `unknown: true`.
 */
export function readSpend(path) {
  if (!existsSync(path)) {
    return {
      total: 0, estimatedPortion: 0, unknown: false, rows: 0, repricedRows: 0,
    };
  }
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  let total = 0;
  let estimatedPortion = 0;
  let repricedRows = 0;
  for (const line of lines) {
    const row = JSON.parse(line); // corrupt JSON: a hard throw, the remaining third outcome — never caught here
    if (row.costUsd === null || row.costUsd === undefined) {
      const ceiling = ceilingCostUsd(row.model);
      total += ceiling;
      estimatedPortion += ceiling;
      repricedRows += 1;
      continue;
    }
    total += row.costUsd;
    if (row.estimated === true) estimatedPortion += row.costUsd;
  }
  return {
    total, estimatedPortion, unknown: false, rows: lines.length, repricedRows,
  };
}

/**
 * Throws only once total spend (every null row repriced at its ceiling) is
 * at/over cap. hamr's ruling, 2026-09-21: a null row no longer blocks by
 * existing — it is priced and counted like any other row, and the lock the
 * cap enforces stays money, never a state.
 */
export function assertUnderGlobalCap(path, capUsd = GLOBAL_CAP_USD) {
  const { total } = readSpend(path);
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
 *
 * This hand-entered table IS the human override hamr's 2026-09-21 ruling refers to ("a human
 * can override it") — a rate changes by editing a row here, by hand, never by adding a second
 * table or a runtime flag.
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
  // F22 (2026-09-11): 'deepseek-v4-flash' is RETIRED — DeepSeek's own pricing page says the
  // legacy name is still accepted but every request it names is now served by DeepSeek-V4.1-
  // Flash. Kept here, numbers untouched, only because the 57 historical ledger rows that
  // already recorded this name were priced against these numbers and must stay priced as they
  // were; nothing new should request this name (provider.mjs's default is 'deepseek-flash').
  'deepseek-v4-flash': { in: 0.00044, out: 0.00132, source: 'published' }, // DeepSeek official pricing (https://api-docs.deepseek.com/quick_start/pricing, read 2026-09-09): cache-MISS, PEAK $0.44/$1.32 per 1M tokens — peak (the higher of peak/off-peak) used as the ceiling; cache-hit input is cheaper ($0.007-$0.014/1M) and not used, per the cache-miss ceiling rule
  'deepseek-flash': { in: 0.0003, out: 0.0012, source: 'published' }, // F22: DeepSeek official pricing (https://api-docs.deepseek.com/quick_start/pricing, read 2026-09-11): this is DeepSeek-V4.1-Flash, cache-MISS, PEAK $0.30/$1.20 per 1M tokens — peak (the higher of peak/off-peak) used as the ceiling, same rule as every other row in this table
  'deepseek-v4-pro': { in: 0.00132, out: 0.00396, source: 'published' }, // DeepSeek official pricing (https://api-docs.deepseek.com/quick_start/pricing, read 2026-09-09): cache-MISS, PEAK $1.32/$3.96 per 1M tokens — see deepseek-v4-flash note above
};
