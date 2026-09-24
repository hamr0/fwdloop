// M2 piece 1 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED", scope item 9): the two append-only books. `runs/<run-id>/audit.jsonl`
// gets one row per attempt (plus one per ask and one per send); `flows/<name>/
// history.jsonl` gets one row per run. Each has exactly one writer — this
// module — so nothing else in src/ ever calls `appendFileSync` on either
// path a second time.
//
// borrowed-from: fwdloop poc/m0/redo.mjs@29caa83 (the `appendAudit` shape:
// `mkdirSync` the parent then `appendFileSync`, one JSON line) — generalised
// to the two typed rows M2 signs, never the `redo.mjs`-specific fields.
//
// Money honesty (M2 scope item 7, project rule "unknown cost is never
// rendered as 0"): a row's cost field must never be `undefined` (that would
// mean a caller silently did `cost ?? 0` upstream and this module can't tell
// the difference from a real zero any more) and a `null` cost — "unknown" —
// is only ever allowed alongside `spendComplete: false`. Both books apply
// this same rule to their own cost field (`usd` for audit, `spentUsd` for
// history); both throw (never silently coerce) on a violation, so a bad
// caller fails loudly at the one place that would otherwise hide it.

import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

function appendLine(filePath, row) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

/**
 * Refuse (throw) a row whose cost field is `undefined` (never `?? 0` — the
 * caller must say `null` on purpose for "unknown"), or whose cost field is
 * `null` while `spendComplete` is not `false` (a `null` cost is only ever
 * allowed alongside an explicit `spendComplete: false`). A numeric cost is
 * allowed regardless of `spendComplete`.
 */
function checkCostField(row, field, label) {
  const value = row[field];
  if (value === undefined) {
    throw new Error(`${label}: "${field}" must not be undefined — never "?? 0"`);
  }
  if (value === null) {
    if (row.spendComplete !== false) {
      throw new Error(`${label}: "${field}" is null but spendComplete is not false — a null ${field} is only allowed with spendComplete:false`);
    }
    return;
  }
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new Error(`${label}: "${field}" must be a number or null, got ${JSON.stringify(value)}`);
  }
}

/**
 * One row per attempt (also used for one row per ask and one row per send —
 * M2 scope item 9). `row` shape: `{ step, attempt, class, verdict, gap, usd,
 * spendComplete, wallMs, model, modelMatch, strike }`. Append-only, one
 * writer.
 *
 * @param {string} runDir
 * @param {Record<string, any>} row
 */
export function appendAudit(runDir, row) {
  checkCostField(row, 'usd', 'appendAudit');
  appendLine(join(runDir, 'audit.jsonl'), row);
}

/**
 * One row per run. `row` shape: `{ runId, at, outcome, spentUsd,
 * spendComplete, capUsd, wallMs, signatureHash }`. Append-only, one writer.
 *
 * @param {string} flowDir
 * @param {Record<string, any>} row
 */
export function appendHistory(flowDir, row) {
  checkCostField(row, 'spentUsd', 'appendHistory');
  appendLine(join(flowDir, 'history.jsonl'), row);
}
