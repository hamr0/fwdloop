// $5.00 hard cap across every LLM round M0 runs today, plus a $0.25 cap per
// run's Loop (bare-agent's Loop has no built-in cost cap — that's bareguard's
// job via `wireGate`, and bareguard isn't installed for this POC — so this
// file enforces both caps in plain application code; <60 lines, vanilla
// stdlib only, per the dependency hierarchy).
//
// Money honesty (PRD §5): unknown cost is NEVER rendered as 0. A row with a
// null costUsd counts as "at the cap" for the purposes of the global guard —
// it blocks further spend rather than being silently treated as free.

import { appendFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const GLOBAL_CAP_USD = 5.00;
export const RUN_CAP_USD = 0.25;

/** Sum of costUsd across every row in spend.jsonl. `unknown: true` if any row's cost is null. */
export function readSpendTotal(path) {
  if (!existsSync(path)) return { totalUsd: 0, unknown: false, rows: 0 };
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  let totalUsd = 0;
  let unknown = false;
  for (const line of lines) {
    const row = JSON.parse(line);
    if (row.costUsd === null || row.costUsd === undefined) unknown = true;
    else totalUsd += row.costUsd;
  }
  return { totalUsd, unknown, rows: lines.length };
}

/** Throws if the global spend is already at/over cap (unknown cost also blocks — never rendered as 0). */
export function assertUnderGlobalCap(path, capUsd = GLOBAL_CAP_USD) {
  const { totalUsd, unknown } = readSpendTotal(path);
  if (unknown) throw new Error(`spend tally has an unpriced round — cost unknown is never rendered as $0; refusing further spend (${path})`);
  if (totalUsd >= capUsd) throw new Error(`global spend cap reached: $${totalUsd.toFixed(6)} >= $${capUsd.toFixed(2)} (${path})`);
  return totalUsd;
}

export function appendSpendRow(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, `${JSON.stringify(row)}\n`);
}

/** List-rate ceilings (USD/1K tokens), hand-entered from synthetic.new's pricing page — same as poc/probe-synthetic.mjs. */
export const RATES_BY_SUFFIX = {
  'zai-org/GLM-5.2': { in: 0.0006, out: 0.0022 },
  'moonshotai/Kimi-K3': { in: 0.0006, out: 0.0025 },
};
