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

import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

function appendLine(filePath, row) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendFileSync(filePath, `${JSON.stringify(row)}\n`);
}

/**
 * Raw read-back of one JSONL book, one writer's own sibling reader (M4a
 * piece 2, docs/wiki/the-module-ladder.md M4a scope item 2: "one reader per
 * book"). Never throws on a missing file (`[]`) or a malformed line (that
 * one line is skipped, never crashes the whole read) — the panel and any
 * other reader need an honest best-effort array, not a hard failure over one
 * bad byte someone else wrote.
 * @param {string} filePath
 * @returns {any[]}
 */
function readLines(filePath) {
  if (!existsSync(filePath)) return [];
  const rows = [];
  for (const line of readFileSync(filePath, 'utf8').split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* malformed line: skip, never crash the read */ }
  }
  return rows;
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
 * Refuse (throw) a row whose `at` is not a valid ISO timestamp string
 * (Amendment M4a-2, docs/wiki/the-module-ladder.md "M4a" section: "every
 * new row carries a valid `at`"). Never coerced/defaulted here — the caller
 * (the runner's own injected clock) must supply it, so a test's fixed clock
 * governs `at` exactly like it governs every other timestamp this module
 * writes.
 */
function checkAtField(row, label) {
  const value = row.at;
  if (typeof value !== 'string' || Number.isNaN(Date.parse(value))) {
    throw new Error(`${label}: "at" must be a valid ISO timestamp string, got ${JSON.stringify(value)}`);
  }
}

/**
 * Refuse (throw) a row whose `tokens` is `undefined` (never silently
 * omitted — say `null` on purpose), or whose `tokens` is `null` while
 * `model` is not `null` (Amendment M4a-2: "a model-call audit row written
 * without tokens is refused at write time"), or whose non-null `tokens` is
 * not an object of three non-negative integers
 * (`inputTokens`/`outputTokens`/`cacheReadTokens`). A row with no model
 * call (`model: null`) may carry `tokens: null` — that is the one honest
 * "nothing to sum" case, never a zeroed object standing in for a call that
 * never happened.
 */
function checkTokensField(row, label) {
  const value = row.tokens;
  if (value === undefined) {
    throw new Error(`${label}: "tokens" must not be undefined — pass null (no model call) or a {inputTokens,outputTokens,cacheReadTokens} object`);
  }
  if (value === null) {
    if (row.model !== null && row.model !== undefined) {
      throw new Error(`${label}: "tokens" is null but "model" is "${row.model}" — a model-call row must carry its tokens`);
    }
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: "tokens" must be null or an object, got ${JSON.stringify(value)}`);
  }
  for (const key of ['inputTokens', 'outputTokens', 'cacheReadTokens']) {
    const v = value[key];
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 0) {
      throw new Error(`${label}: "tokens.${key}" must be a non-negative integer, got ${JSON.stringify(v)}`);
    }
  }
}

/**
 * One row per attempt (also used for one row per ask and one row per send —
 * M2 scope item 9). `row` shape: `{ step, attempt, class, verdict, gap, usd,
 * spendComplete, wallMs, model, modelMatch, strike, at, tokens }` (`at`/
 * `tokens` added by Amendment M4a-2 — every row appended from here on must
 * carry both; a pre-M4a-2 row already on disk simply lacks them, read back
 * as-is by `readAudit`). Append-only, one writer.
 *
 * @param {string} runDir
 * @param {Record<string, any>} row
 */
export function appendAudit(runDir, row) {
  checkCostField(row, 'usd', 'appendAudit');
  checkAtField(row, 'appendAudit');
  checkTokensField(row, 'appendAudit');
  appendLine(join(runDir, 'audit.jsonl'), row);
}

/**
 * Amendment M4a-2's own reader helper: the honest reading of one audit
 * row's `tokens`, whether or not it was written before M4a-2 landed. A row
 * that never had a `tokens` key at all (any row appended before this
 * amendment) reads as "not recorded", never as `null` standing in for a
 * genuine zero-token model call and never an invented number. A row that
 * does carry the key (including a post-M4a-2 `tokens: null` no-model-call
 * row) reads back exactly what was written.
 *
 * @param {Record<string, any>} row
 * @returns {{tokens: {inputTokens:number, outputTokens:number, cacheReadTokens:number} | null, why?: string}}
 */
export function auditRowTokens(row) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'tokens')) {
    return { tokens: null, why: 'not recorded (before M4a-2)' };
  }
  return { tokens: row.tokens };
}

/**
 * Amendment M4a-2's own reader helper for `at`, the same honest-read shape
 * as `auditRowTokens`: a row written before M4a-2 (any row appended before
 * this amendment, or a raw/legacy line on disk) never had an `at` key at
 * all, and reads as "not recorded", never as `undefined` silently rendered
 * blank. A row that does carry the key reads back exactly what was written.
 *
 * @param {Record<string, any>} row
 * @returns {{at: string|null, why?: string}}
 */
export function auditRowAt(row) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'at')) {
    return { at: null, why: 'not recorded (before M4a-2)' };
  }
  return { at: row.at };
}

/**
 * Read back every row `appendAudit` has written for one run, in file order
 * (append order — never re-sorted). `[]` when the file doesn't exist yet
 * (a run that hasn't made an attempt), never a thrown error.
 * @param {string} runDir
 * @returns {any[]}
 */
export function readAudit(runDir) {
  return readLines(join(runDir, 'audit.jsonl'));
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

/**
 * Read back every row `appendHistory` has written for one flow, in file
 * order. `[]` when the file doesn't exist yet (a flow with no completed/
 * halted run), never a thrown error.
 * @param {string} flowDir
 * @returns {any[]}
 */
export function readHistory(flowDir) {
  return readLines(join(flowDir, 'history.jsonl'));
}
