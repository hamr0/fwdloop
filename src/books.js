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

import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { readFileInside, readdirInside } from './flow.js';
import { appendRow } from './jsonl-append.js';
import { TRIGGER_RECORD_FILE } from './trigger-line.js';

function appendLine(filePath, row) {
  mkdirSync(dirname(filePath), { recursive: true });
  appendRow(filePath, row);
}

/**
 * M4c piece 1: the ONE writer of a run dir's `pids.jsonl` — append-only, never
 * rewritten, not a book the arbiter reads. One row per process that works on
 * the run (`src/liveness.js` `recordPid` builds the row).
 * @param {string} runDir
 * @param {{pid: number, startedAt: string, procStart: string|null, leg: 'run'|'resume'|'continue'}} row
 */
export function appendPidRow(runDir, row) {
  appendLine(join(runDir, 'pids.jsonl'), row);
}

/**
 * The one reader of `pids.jsonl` (same tolerant `readLines` every book uses).
 * @param {string} runDir
 * @returns {any[]}
 */
export function readPidRows(runDir) {
  return readLines(runDir, 'pids.jsonl');
}

/**
 * Raw read-back of one JSONL book, one writer's own sibling reader (M4a
 * piece 2, docs/wiki/the-module-ladder.md M4a scope item 2: "one reader per
 * book"). Never throws on a missing file (`[]`) or a malformed line (that
 * one line is skipped, never crashes the whole read) — the panel and any
 * other reader need an honest best-effort array, not a hard failure over one
 * bad byte someone else wrote.
 *
 * F48 round 3: goes through `readFileInside` (`src/flow.js`) — a book file
 * that is itself a symlink, or that sits behind a symlinked ancestor
 * directory, resolving outside `baseDir` reads as `[]`, same as a missing
 * file, never as the outside target's content.
 * @param {string} baseDir - the run dir (audit.jsonl) or flow dir (history.jsonl)
 * @param {string} relPath - the book's own file name, relative to baseDir
 * @returns {any[]}
 */
export function readLines(baseDir, relPath) {
  const result = readFileInside(baseDir, relPath);
  if (!result.ok) return [];
  const rows = [];
  for (const line of result.text.split('\n')) {
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
 * Refuse (throw) a row whose `tools` is `undefined` (never silently omitted
 * — say `null` on purpose), or whose `tools` is `null` while `model` is not
 * `null` (Amendment M4a-3, docs/wiki/the-module-ladder.md "M4a" section: a
 * model-call row must carry its tool tally — mirrors `checkTokensField`'s
 * discipline exactly), or whose non-null `tools` is not a plain object of
 * non-negative integer counts. A row with no model call (`model: null`) may
 * carry `tools: null` — the one honest "no model call, so no tool call
 * either" case; a model-call row that made zero tool calls carries `tools:
 * {}`, never `null`.
 */
function checkToolsField(row, label) {
  const value = row.tools;
  if (value === undefined) {
    throw new Error(`${label}: "tools" must not be undefined — pass null (no model call) or a {toolName: count} object`);
  }
  if (value === null) {
    if (row.model !== null && row.model !== undefined) {
      throw new Error(`${label}: "tools" is null but "model" is "${row.model}" — a model-call row must carry its tool tally`);
    }
    return;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label}: "tools" must be null or an object, got ${JSON.stringify(value)}`);
  }
  for (const [name, count] of Object.entries(value)) {
    if (typeof count !== 'number' || !Number.isInteger(count) || count < 0) {
      throw new Error(`${label}: "tools.${name}" must be a non-negative integer, got ${JSON.stringify(count)}`);
    }
  }
}

/**
 * Refuse (throw) a row whose `ungranted` key is present but is not an array
 * of strings (Amendment M4a-3: "ungranted absent or an array of strings").
 * `ungranted` itself is optional — a row with nothing ungranted simply omits
 * the key, never carries an empty array as noise (the caller's own choice;
 * this check only refuses a WRONG shape, never requires the key).
 */
function checkUngrantedField(row, label) {
  if (!Object.prototype.hasOwnProperty.call(row, 'ungranted')) return;
  const value = row.ungranted;
  if (!Array.isArray(value) || !value.every((v) => typeof v === 'string')) {
    throw new Error(`${label}: "ungranted" must be an array of strings when present, got ${JSON.stringify(value)}`);
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
  checkToolsField(row, 'appendAudit');
  checkUngrantedField(row, 'appendAudit');
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
 * Amendment M4a-3's own reader helper, the same honest-read shape as
 * `auditRowTokens`/`auditRowAt`: a row written before M4a-3 never had a
 * `tools` key at all, and reads as "not recorded", never as an invented
 * empty tally. A row that does carry the key reads back exactly what was
 * written — `tools` (object or `null`) and `ungranted` (defaulted to `[]`
 * when the writer left it out, never `undefined`).
 *
 * @param {Record<string, any>} row
 * @returns {{tools: Record<string, number> | null, ungranted: string[], why?: string}}
 */
export function auditRowTools(row) {
  if (!row || !Object.prototype.hasOwnProperty.call(row, 'tools')) {
    return { tools: null, ungranted: [], why: 'not recorded (before M4a-3)' };
  }
  return { tools: row.tools, ungranted: row.ungranted ?? [] };
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
 * `{ strict: true }` is the one named mode for the money sum: `{ok:true, rows}` or `{ok:false, red}` on a torn line.
 * @param {string} runDir
 * @param {{strict?: boolean}} [opts]
 * @returns {any}
 */
export function readAudit(runDir, { strict = false } = {}) {
  if (!strict) return readLines(runDir, 'audit.jsonl');
  // strict mode (M20 am3 item 11): the money sum must balance, so a torn line is a red, never skipped; a missing or refused file is no rows
  const result = readFileInside(runDir, 'audit.jsonl');
  if (!result.ok) return { ok: true, rows: [] };
  const rows = [];
  for (const line of result.text.split('\n')) {
    if (line.trim().length === 0) continue;
    try { rows.push(JSON.parse(line)); } catch (err) { return { ok: false, red: `audit.jsonl line is not valid JSON — ${err.message}` }; }
  }
  return { ok: true, rows };
}

/**
 * The one reader of a run's `trigger.json` (why it started): an object, or `null` (a hand run, a missing, refused or unreadable file, a non-object).
 * @param {string} runDir
 * @returns {Record<string, any>|null}
 */
export function readTriggerRecord(runDir) {
  const f = readFileInside(runDir, TRIGGER_RECORD_FILE);
  if (!f.ok) return null;
  try { const j = JSON.parse(f.text); return j && typeof j === 'object' ? j : null; } catch { return null; }
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
  // M9 (am2 item 1): a run a trigger started says so in its history row, read from the record the start wrote into the run's own folder
  const trigger = typeof row.runId === 'string' && row.trigger === undefined ? readTriggerRecord(join(flowDir, 'runs', row.runId)) : null;
  appendLine(join(flowDir, 'history.jsonl'), trigger === null ? row : { ...row, trigger });
}

/**
 * Read back every row `appendHistory` has written for one flow, in file
 * order. `[]` when the file doesn't exist yet (a flow with no completed/
 * halted run), never a thrown error.
 * @param {string} flowDir
 * @returns {any[]}
 */
export function readHistory(flowDir) {
  return readLines(flowDir, 'history.jsonl');
}

export const HALT_FILE = 'halt.json';

/**
 * M20 am1 item 1: the ONE table of endings. Every history outcome and every audit verdict fwd writes is a key; the flags say what it
 * means, and every reader asks a helper below (never its own list of words):
 *   good        the run or try passed                         resumable   `halt.json` is left, the run can be continued
 *   notFailed   not a failure of the job (complete, a stop, a cap halt, a rerun, an expired ask, a skipped ticket)
 *   noise       the instrument failed, not the work (learnings set the run aside)
 *   blocked     a verdict that stopped a step, the Run tab's "blocked" line
 *   open        the Audit's `·` mark: waiting / a human note, not yet resolved either way
 *   waiting     a step whose last row is this is parked        stopNote    a Stop's own note row, never a try
 *   humanNo     the human's own no (the ask fold's `✗`)         redTry      a try that said the output was wrong
 *   tryVerdict  a step's try with a verdict on its output       spendFloor  a halt whose spend can be a floor
 *   draftRow    a verdict a drafting row of the Audit can carry (anything else reads not-done)
 *   notRunEnd   not an end of a run (a pause, a failed stop, a skipped ticket): learnings wait
 *   word        the Runs list's bold word for it (`null` = none: a run the human ended with rerun)
 *   wordUnresumed  its word when the run cannot be continued (M20 am1 item 9: a cap-halt with no usable halt.json reads "capped")
 * Outcome (history.jsonl) and verdict (audit.jsonl) are not split: one word means one thing on either book.
 * Not here, by design: the scheduler's own words (busy, monthly-exhausted, refused fire), the closers' verdicts (done, crash,
 * unparseable), and the Run tab's ending sentences (src/summary-words.js stays their one owner).
 */
export const ENDINGS = Object.freeze({
  complete: { good: true, notFailed: true, word: 'passed' },
  skipped: { notFailed: true, notRunEnd: true, word: 'skipped' },
  stopped: { resumable: true, notFailed: true, open: true, humanNo: true, word: 'stopped' },
  'cap-halt': { resumable: true, notFailed: true, blocked: true, spendFloor: true, word: 'stopped', wordUnresumed: 'capped' },
  rerun: { notFailed: true, word: null },
  'ask-expired': { notFailed: true, blocked: true, open: true, word: 'expired' },
  'ask-timeout': { blocked: true, open: true, word: 'failed' },
  refused: { blocked: true, open: true, waiting: true, word: 'failed' },
  red: { blocked: true, humanNo: true, redTry: true, tryVerdict: true, draftRow: true, word: 'failed' },
  'not-done': { blocked: true, redTry: true, tryVerdict: true, word: 'failed' },
  'provider-red': { blocked: true, noise: true, spendFloor: true, word: 'failed' },
  'pricing-red': { blocked: true, spendFloor: true, word: 'failed' },
  'close-casualty': { blocked: true, noise: true, word: 'failed' },
  'preflight-red': { word: 'failed' },
  'struck-out': { word: 'failed' },
  'attempt-fallback': { word: 'failed' },
  'redo-halt': { word: 'failed' },
  'stop-failed': { notRunEnd: true, word: 'failed' },
  green: { good: true, tryVerdict: true, draftRow: true },
  hitl: { good: true, tryVerdict: true },
  softgreen: { tryVerdict: true }, // fwd writes no such verdict today; the learnings read audits shaped like bareloop's, so it stays a try
  paused: { open: true, waiting: true, notRunEnd: true },
  'ask-reopened': { open: true },
  'lock-removed': { open: true },
  'stop-asked': { open: true, stopNote: true },
  'stop-not-honoured': { open: true, stopNote: true },
  'stale-answer-ignored': {},
  'answer-after-run': {},
});

/** @param {unknown} word @param {string} flag */
const endingHas = (word, flag) => typeof word === 'string' && Object.hasOwn(ENDINGS, word) && /** @type {any} */ (ENDINGS)[word][flag] === true;
export const isGoodEnding = (/** @type {unknown} */ w) => endingHas(w, 'good');
/** a history outcome that is a failure of the job; a word the table does not know counts as one */
export const isFailedEnding = (/** @type {unknown} */ w) => !endingHas(w, 'notFailed');
export const isNoiseEnding = (/** @type {unknown} */ w) => endingHas(w, 'noise');
export const isBlockedEnding = (/** @type {unknown} */ w) => endingHas(w, 'blocked');
export const isOpenEnding = (/** @type {unknown} */ w) => endingHas(w, 'open');
export const isWaitingEnding = (/** @type {unknown} */ w) => endingHas(w, 'waiting');
export const isStopNote = (/** @type {unknown} */ w) => endingHas(w, 'stopNote');
export const isHumanNo = (/** @type {unknown} */ w) => endingHas(w, 'humanNo');
export const isRedTry = (/** @type {unknown} */ w) => endingHas(w, 'redTry');
export const isTryVerdict = (/** @type {unknown} */ w) => endingHas(w, 'tryVerdict');
export const isSpendFloorEnding = (/** @type {unknown} */ w) => endingHas(w, 'spendFloor');
export const isDraftRowVerdict = (/** @type {unknown} */ w) => endingHas(w, 'draftRow');
export const isNotRunEnd = (/** @type {unknown} */ w) => endingHas(w, 'notRunEnd');
/** The outcomes a run can be continued from (M4e amendment 4 item 4): the runner leaves `halt.json` for them. */
export const isResumableEnding = (/** @type {unknown} */ w) => endingHas(w, 'resumable');
/** the Runs list's bold word for an ending (`null` for none); `resumable` false asks the word of a run that cannot be continued @param {string} w @param {boolean} [resumable] @returns {string|null} */
export function endingWord(w, resumable = true) {
  if (!Object.hasOwn(ENDINGS, w)) return null;
  const e = /** @type {any} */ (ENDINGS)[w];
  return resumable === false && typeof e.wordUnresumed === 'string' ? e.wordUnresumed : e.word ?? null;
}

/**
 * The ONE rule for "how did this run end": the LAST history row of the run (a run that was stopped or cap-halted and
 * continued has one row per leg; history stays append-only). `null` when the run has no row yet, and also while a
 * continue is in flight: the last row is a halt row, `halt.json` is gone (the continue consumed it by rename to
 * `halt.<n>.consumed.json`) — an older halt row is then not the run's end. A run halted before halt records existed has
 * no consumed file, so its halt row stays final.
 * @param {any[]} historyRows `readHistory`'s rows @param {string} runDir @param {string} runId
 * @returns {any|null}
 */
export function endRow(historyRows, runDir, runId) {
  let last = null;
  for (const r of historyRows) if (r && r.runId === runId) last = r;
  if (last === null || !isResumableEnding(last.outcome)) return last;
  const names = readdirInside(runDir, '.');
  const continuing = !names.includes('halt.json') && haltConsumedCount(runDir) > 0;
  return continuing ? null : last;
}

/** The one place `halt.<n>.consumed.json` is named: how many a run holds, and the name the next continue renames halt.json to. @param {string} runDir */
export function haltConsumedCount(runDir) {
  return readdirInside(runDir, '.').filter((n) => /^halt\.\d+\.consumed\.json$/.test(n)).length;
}
/** @param {string} runDir */
export function nextHaltConsumedName(runDir) {
  return `halt.${haltConsumedCount(runDir) + 1}.consumed.json`;
}

/** The one reader of halt.json (the run is waiting = the file EXISTS, parse or not: see {@link haltFileExists}): `{ok:true, halt}`, `{ok:false, missing:true}` (not resumable), or `{ok:false, red}`. @param {string} runDir */
export function readHaltRecord(runDir) {
  const r = readFileInside(runDir, HALT_FILE);
  if (!r.ok) return r.missing ? { ok: false, missing: true } : { ok: false, red: `halt.json — ${r.red}` };
  try { return { ok: true, halt: JSON.parse(r.text) }; } catch (err) { return { ok: false, red: `halt.json is not valid JSON — ${err.message}` }; }
}

/**
 * `writeLog`'s own sibling reader (M4a piece 2, docs/wiki/the-module-
 * ladder.md M4a scope item 2: "one reader per book") — `null` when the run
 * hasn't reached an exit path yet (still running, or parked before any
 * halt/complete), or the file is present but not valid JSON (a torn write),
 * never a thrown error.
 * @param {string} runDir
 * @returns {any|null}
 */
export function readLog(runDir) {
  const result = readFileInside(runDir, 'log.json');
  if (!result.ok) return null;
  try { return JSON.parse(result.text); } catch { return null; }
}

/**
 * `state.json`'s own sibling reader (same rule as {@link readLog}) — `null`
 * when the run has never parked, or the file is present but not valid JSON. `{ strict: true }` (Resume) returns
 * `{ok:true, state}`, `{ok:false, missing:true}` or `{ok:false, red}` instead.
 * @param {string} runDir
 * @param {{strict?: boolean}} [opts]
 * @returns {any}
 */
export function readRunState(runDir, { strict = false } = {}) {
  const result = readFileInside(runDir, 'state.json');
  if (strict) {
    // strict mode (M20 am3 item 11, Resume): missing, refused and torn stay three different words
    if (!result.ok) return result.missing ? { ok: false, missing: true } : { ok: false, red: result.red };
    try { return { ok: true, state: JSON.parse(result.text) }; } catch (err) { return { ok: false, red: `is not valid JSON — ${err.message}` }; }
  }
  if (!result.ok) return null;
  try { return JSON.parse(result.text); } catch { return null; }
}

/**
 * "Is this run waiting to be resumed?" as the panel's start watcher has always read it: a `halt.json` that EXISTS means
 * waiting, even when it does not parse (unlike {@link readHaltRecord}, where a torn file is a red). One name for that rule.
 * @param {string} runDir
 */
export function haltFileExists(runDir) {
  return readFileInside(runDir, HALT_FILE).ok;
}
