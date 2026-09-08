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

export function appendSpendRow(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
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
};
