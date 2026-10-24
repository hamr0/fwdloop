// M2 piece 1 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED"): `runFlow` — one fold over a signed flow's `declaration.steps`,
// no job-specific code path. Reads the flow through M1's `readFlow`
// (refusing by file name on any red), freezes the run's inputs, then folds:
// a fresh executor per step (goal in, gap back — no close/cap/strike ever
// reachable from it), the ralph loop with strikes, close by declared class,
// money honesty, the provider-red ladder, two append-only books.
//
// borrowed-from: fwdloop poc/m0/runner.mjs@29caa83 (`freezeInputs`,
// `checkFreshRunDir`, `checkSendDestination` with its write-time symlink
// re-check) and fwdloop poc/m2/executor.mjs@29caa83 /
// poc/m2/gapback.mjs@29caa83 (`buildExecutor`'s "no field but goal/
// primitives/reads/gap" shape, `normaliseGap`, the strike-governed ralph
// loop) and fwdloop poc/m0/askWithRedo@29caa83 (the ask-with-redo: consume-once,
// a reason-less rerun refused and re-asked, a redo redoes the step that
// emitted the artifact under review). Rewritten against M1's real
// `readFlow`/`arbiter` shape (the POCs above ran on hand-rolled declarations
// and a single hard-coded ask/send slot) — src/ never imports from poc/.
//
// ---------------------------------------------------------------------------
// A reading call this piece makes where the signed scope was silent
// (flagged here, not invented quietly): a `hitl`-class step is only ever
// asked of a human when its `fromLine` is one of the arbiter's SIGNED ask
// lines. M1's own class derivation makes a step `hitl` by silent default too
// (no guardrail proposed for its line, or none at all) — job #1's own
// fixture has two such steps (lines 1 and 2, both carrying real primitives,
// neither an ask slot). A step in that position has no shape/citation to
// mechanically judge (that is exactly why the schema left it `hitl`) and is
// not bound to the interactive ask either, so `closeByClass` returning
// `{ verdict: 'hitl' }` for it is read here as "no judgment to render — the
// happened check already ran, let it through" (one attempt, no ralph loop,
// no strike accounting), not as a second, undeclared human checkpoint. Only
// the step actually bound to an `arbiter.asks[]` line pauses for a real
// human. This is an interpretation, not a rule the signed text states in so
// many words — worth hamr's ruling if it reads differently.
// ---------------------------------------------------------------------------

import {
  accessSync, closeSync, constants as fsConstants, copyFileSync, existsSync, mkdirSync, openSync, readFileSync,
  realpathSync, renameSync, statSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import {
  basename, dirname, extname, isAbsolute, join, resolve, sep,
} from 'node:path';
import { parseCsv } from './csv.js';
import { resetRunStore } from './run-store.js';
import { fileURLToPath } from 'node:url';

import {
  readPlan, readRunPlan, runOwnsPlan, resolveRunDir, readFileInside, readdirInside, resolveInside, FLOW_FILES, PANEL_STARTS_DIR, writeRunJobCopy,
} from './flow.js';
import {
  writeAskArchive, readAcceptedHashesByEmits, serializeArtifact, normalizeDecision, answerTiming, effectiveExpiresAt, withReopen, setAsideAnswer,
} from './ask.js';
import {
  findUnwiredVerbStep, unwiredRed, findUnbuildableCheckStep, unbuildableRed,
} from './canrun.js'; // M4e am7 item 7: the ONE decider (F46 refusal lives there)
import { configHome, configDoorHome } from './config.js';
import { closeByClass, isCellsPath } from './closers.js';
import { readRunSource } from './cited-source.js';
import { citedLineOf, writeCitedLine } from './cited-record.js';
import { sheetRolesOf, tableShaOfFrozen, readRunSheets } from './sheetrun.js';
import { writeSheetLine } from './sheet-record.js';
import {
  appendAudit, appendHistory, readAudit, readHistory, endRow, HALT_OUTCOMES,
} from './books.js';
import { learnAtRunEnd, NOT_A_RUN_END, hintsForRun } from './learnstore.js';
import { redactSecrets } from './redact.js';
import { appendRow } from './jsonl-append.js';
import { applyRunValues, pickRunValues } from './runvalues.js';
import { stepThinkingMode, stepHintsWanted } from './thinking.js';
import { appendChecks, nextRound } from './diary.js';
import {
  doneRecord, happenedRecord, outputRecord, closeRecords,
} from './try-checks.js';
import { readJobThinking, writeRunThinking, writeRunModel, takeLearningsRecord, writeStepLearningsRecord } from './flowmodel.js';
import { fetchPageText, isWebUrl } from './pagefetch.js';
import {
  readResumeLock, recordPid, writeLockHolder, procStartOf, LOCK_NO_HOLDER,
} from './liveness.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

/** The strike governor — a run-owned constant, never raised by a caller,
 *  never carried in the arbiter block or the declaration (M2 scope item 5,
 *  signed 2026-09-24 "2A"). */
export const STRIKE_LIMIT = 2;
/** The hard attempt fallback per step (bareloop's rule: "the count is a
 *  fallback, never the governor" — it never raises the strike bound, it only
 *  bounds the case the strike governor doesn't catch). */
export const MAX_ATTEMPTS = 4;
/** Debrief round 2: `state.spent` (accumulated by repeated `spent.value +=`
 *  during the run) and `sumAuditUsd`'s re-summed total are two independent
 *  float summations of the same rows in a different order — IEEE 754
 *  addition is not associative, so they can differ by a single ULP (e.g.
 *  0.006874 vs 0.006874000000000001) with no real discrepancy. The books
 *  (audit.jsonl) stay the source of truth; this tolerance only absorbs
 *  summation-order noise, not a real gap. A billionth of a dollar is ~6
 *  orders of magnitude below the cheapest real round (audit rows here run
 *  a few hundredths of a cent and up), so nothing a real tamper produces can hide inside it. */
export const SPEND_TOLERANCE_USD = 1e-9;

// ---------------------------------------------------------------------------
// M4e amendment 4 item 4 (Stop) and the halt record Resume continues from.
//
// `stop.request` is written by the panel's Stop door (`requestStop`, its one writer) and read ONLY at the seam at the top of
// `foldFromStep`'s loop, i.e. after the previous step closed (its artifact written, its audit rows booked): every kind of
// step (model, a non-ask hitl pass-through, the signed send, an accepted ask) therefore reads it the same way. The reader
// consumes it (unlink) and the run ends `stopped`. Amendment 13: when the turn leads to an ask (or the run already waits at one) the run
// stops AT the ask (`stopAtAsk`, the one place; `stopParkedRun` for a waiting run), because a park is not an end; a stop that
// arrives after the last step closed finds nothing left to stop and the run completes.
//
// `halt.json` is the one record a `cap-halt` or `stopped` run leaves for Resume (`continueRun`): where to re-enter (`stepIndex`,
// the first step whose artifact is not written), what was frozen/signed, and the hitl evidence not yet shown to an ask. Money and
// the spend-complete floor are NOT in it: the books (audit.jsonl) are the source of truth and `continueRun` re-sums them.
// Write-once (`wx`); `continueRun` consumes it by rename to `halt.<n>.consumed.json`, so "resumable" = halt.json exists.
// ---------------------------------------------------------------------------

export const STOP_FILE = 'stop.request';
export const HALT_FILE = 'halt.json';

/** The panel's one write of a stop request. `'exists'` = already asked, nothing more to do. @param {string} runDir */
export function requestStop(runDir) {
  try {
    writeFileSync(join(runDir, STOP_FILE), `${JSON.stringify({ at: new Date().toISOString() })}\n`, { mode: 0o600, flag: 'wx' });
    return 'written';
  } catch (err) {
    if (err.code === 'EEXIST') return 'exists';
    throw err;
  }
}

/**
 * The ONE reader of the stop request: `{at}` (when it was asked) or `null` when none is pending. Amendment 16 C11 / amendment 17 2A: a
 * time that is not a real date (a non-date string, a number, a missing or empty time, a torn file) is treated as made "now" (`now`,
 * when given), one rule for all, so the stop completes with every record and the ask is never lost. Without `now` (a pending check)
 * such a request reads `{at:null}`.
 * @param {string} runDir @param {() => string} [now]
 */
export function readStopRequest(runDir, now) {
  const r = readFileInside(runDir, STOP_FILE);
  if (!r.ok) return null;
  let at = null;
  try {
    const t = JSON.parse(r.text)?.at;
    if (typeof t === 'string' && !Number.isNaN(Date.parse(t))) at = t;
  } catch { /* a torn file: no time */ }
  return { at: at ?? (typeof now === 'function' ? now() : null) };
}

/** Is a stop pending for this run? (read-only) @param {string} runDir */
export function stopPending(runDir) {
  return readStopRequest(runDir) !== null;
}

/**
 * M4e amendment 7 item 8: the ONE writer of a Stop's audit rows, and the one place a request is cleared — a Stop is never cleared
 * silently. A pending request leaves "stop asked (you) at <time>" and then its outcome: `stop` given = honoured (`verdict:'stopped'`,
 * `stop.where` its words, `stop.book` the cut try's own row fields so the call in flight is booked); otherwise `not honoured: the run
 * ended (<outcome>) first`. No pending request and no `stop` = no rows. The notes cost 0; a booked call's cost rides the `stopped` row.
 *
 * @param {object} o
 * @param {string} o.runDir
 * @param {() => string} o.now
 * @param {string} o.outcome how the run ended (the words of the not-honoured row)
 * Every row names the step it is about (the audit groups by it): the stop's own `step` (the step its words name; null = none, e.g.
 * "stopped before step 1"), else its book's step; with no stop, the step the run ended on (the last row that names one).
 * @param {{where:string, step?:string|null, book?:Record<string, any>}|null} [o.stop]
 */
function settleStop({
  runDir, now, outcome, stop = null,
}) {
  const req = readStopRequest(runDir, now);
  if (!req && !stop) return;
  const lastStep = () => readAudit(runDir).map((r) => r.step).filter((s) => typeof s === 'string' && s.length > 0).pop() ?? null;
  const step = stop ? (stop.step ?? stop.book?.step ?? null) : lastStep();
  const note = {
    step, attempt: null, class: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, tokens: null, tools: null, refused: [],
  };
  appendAudit(runDir, {
    ...note, verdict: 'stop-asked', gap: `stop asked (you) at ${req?.at ?? 'an unrecorded time'}`, at: req?.at ?? now(),
  });
  appendAudit(runDir, stop
    ? {
      ...note, ...stop.book, step, verdict: 'stopped', gap: stop.where, at: now(),
    }
    : {
      ...note, verdict: 'stop-not-honoured', gap: `not honoured: the run ended (${outcome}) first`, at: now(),
    });
  clearStop(runDir);
}

function clearStop(runDir) {
  try { unlinkSync(join(runDir, STOP_FILE)); } catch { /* none pending */ }
}

/** The one reader of halt.json: `{ok:true, halt}`, `{ok:false, missing:true}` (not resumable), or `{ok:false, red}`. @param {string} runDir */
export function readHaltRecord(runDir) {
  const r = readFileInside(runDir, HALT_FILE);
  if (!r.ok) return r.missing ? { ok: false, missing: true } : { ok: false, red: `halt.json — ${r.red}` };
  try { return { ok: true, halt: JSON.parse(r.text) }; } catch (err) { return { ok: false, red: `halt.json is not valid JSON — ${err.message}` }; }
}

// ---------------------------------------------------------------------------
// Money - the per-attempt hold is injected data: the caller works it out from the
// picked model's own Settings prices (`ceilingCostUsd(rates)`, src/provider.js) and passes
// it as `ceilingUsd`. No model name or price lives here (M4d amendment 5 item 4).
// ---------------------------------------------------------------------------

/**
 * The hold one model round must fit under the cap. A caller with a model passes the number from Settings prices;
 * a caller with no model prices (a test double) holds nothing.
 * @param {number|undefined} ceilingUsd
 */
const holdOf = (ceilingUsd) => (Number.isFinite(ceilingUsd) && /** @type {number} */ (ceilingUsd) >= 0 ? /** @type {number} */ (ceilingUsd) : 0);

// ---------------------------------------------------------------------------
// The executor — "goal in, gap back", constructed WITHOUT its close and
// WITHOUT the cap (M2 scope item 3, the load-bearing invariant).
// ---------------------------------------------------------------------------

const EXECUTOR_FIELDS = Object.freeze(['goal', 'primitives', 'reads', 'gap', 'hints']);

/** @param {{goal:string, primitives?:string[], reads?:Record<string,any>, gap?:string|null, hints?:string|null}} opts  `hints` (M8 am7): the earlier runs' block, text only, for a retry / redo / rerun try */
export function buildExecutorContext(opts) {
  for (const key of Object.keys(opts ?? {})) {
    if (!EXECUTOR_FIELDS.includes(key)) {
      throw new Error(`executor: unknown field "${key}" — only ${EXECUTOR_FIELDS.join(', ')} may cross a step boundary`);
    }
  }
  const {
    goal, primitives = [], reads = {}, gap = null, hints = null,
  } = opts ?? {};
  return Object.freeze({
    goal,
    primitives: Object.freeze([...primitives]),
    reads: Object.freeze({ ...reads }),
    gap: gap ?? null,
    hints: hints ?? null,
  });
}

/** The identifiers a leaky executor must never carry (M2 scope item 3's own
 *  construction test, negative vi). Walks any depth, any key, any array
 *  entry; also catches a bare function value anywhere in the tree. */
const FORBIDDEN_CONTEXT_KEYS = Object.freeze([
  'close', 'shape', 'cap', 'strike', 'maxWords', 'sections', 'linesPerInvoice', 'mustCarry',
]);

/**
 * @param {unknown} value
 * @param {string} [path]
 * @returns {string|null} a description of the first violation found, or null when clean.
 */
export function findForbiddenInContext(value, path = 'executorContext') {
  if (typeof value === 'function') return `${path} is a function`;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const found = findForbiddenInContext(value[i], `${path}[${i}]`);
      if (found) return found;
    }
    return null;
  }
  if (value && typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (FORBIDDEN_CONTEXT_KEYS.includes(key)) return `${path}.${key} is a forbidden identifier`;
      const found = findForbiddenInContext(value[key], `${path}.${key}`);
      if (found) return found;
    }
    return null;
  }
  return null;
}

/** Also checks the executor's serialised (JSON round-tripped) form for the
 *  declared shape's own heading strings — a leak that survived key-name
 *  scanning (e.g. a heading baked into `goal` text) still needs to be
 *  physically absent, per M2 scope item 3. */
export function findForbiddenHeadingText(context, headingStrings) {
  if (!Array.isArray(headingStrings) || headingStrings.length === 0) return null;
  let serialised;
  try {
    serialised = JSON.stringify(context).toLowerCase();
  } catch {
    return null;
  }
  for (const heading of headingStrings) {
    if (typeof heading === 'string' && heading.length > 0 && serialised.includes(heading.toLowerCase())) {
      return `executorContext contains the shape heading text "${heading}"`;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// normaliseGap — borrowed verbatim in spirit from poc/m2/gapback.mjs: every
// digit run collapses to one '#' so "689 words, limit 600" and "661 words,
// limit 600" are the SAME gap shape for strike purposes; a different check's
// gap normalises differently.
// ---------------------------------------------------------------------------

export function normaliseGap(red) {
  if (typeof red !== 'string') return '';
  return red.toLowerCase().replace(/\d+/g, '#').replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// The mechanical "happened" check — every step's artifact, before its close,
// no exception (M2 scope item 10). This piece's artifacts are typed JS
// objects (not raw bytes), so "0-byte" reads as "the shape that class's
// artifact contract defines carries nothing" — empty text, no fields, or
// (for the generic hitl case with no declared contract) no own keys at all.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// M2 amendment 1 item 1 (docs/wiki/the-module-ladder.md, "M2 amendment 1 —
// SIGNED"): the model's own typed word, taken at face value, BEFORE the
// happened check or the close ever run. `done: false` — or a missing/non-
// boolean `done` (a schema the provider ignored is not a pass) — is a HALT,
// never a strike, never a retry. `done`/`blocker` are stripped from the
// artifact before it reaches the happened check, the closer, or disk — a
// self-report is not something a closer judges; it is kept verbatim only in
// log.json's modelOutput (the raw `result.artifact`, untouched by this).
// ---------------------------------------------------------------------------

/**
 * @param {any} step
 * @param {unknown} artifact
 * @returns {{verdict:'not-done', red:string} | {verdict:'done'}}
 */
function checkDoneBlocker(step, artifact) {
  const label = step?.emits ?? 'step';
  const obj = /** @type {Record<string, unknown>} */ (artifact);
  if (!artifact || typeof artifact !== 'object' || typeof obj.done !== 'boolean') {
    return { verdict: 'not-done', red: `step "${label}" artifact has no boolean "done"` };
  }
  if (obj.done === false) {
    const blocker = typeof obj.blocker === 'string' && obj.blocker.length > 0 ? obj.blocker : 'no blocker given';
    return { verdict: 'not-done', red: `step "${label}" reports done: false — ${blocker}` };
  }
  return { verdict: 'done' };
}

/** @param {unknown} artifact */
function stripDoneBlocker(artifact) {
  if (!artifact || typeof artifact !== 'object') return artifact;
  const obj = /** @type {Record<string, unknown>} */ (artifact);
  const { done, blocker, ...rest } = obj;
  return rest;
}

function checkArtifactHappened(step, artifact) {
  const label = step?.goal ? `"${step.goal}"` : (step?.emits ?? 'step');
  if (artifact === null || artifact === undefined) {
    return { verdict: 'red', red: `happened: ${label} produced nothing` };
  }
  if (typeof artifact === 'string') {
    return artifact.length === 0
      ? { verdict: 'red', red: `happened: ${label} produced an empty string` }
      : { verdict: 'green' };
  }
  if (typeof artifact === 'object') {
    if (Object.prototype.hasOwnProperty.call(artifact, 'text')) {
      return typeof artifact.text === 'string' && artifact.text.length > 0
        ? { verdict: 'green' }
        : { verdict: 'red', red: `happened: ${label} produced empty text` };
    }
    if (Object.prototype.hasOwnProperty.call(artifact, 'fields')) {
      return artifact.fields && typeof artifact.fields === 'object' && Object.keys(artifact.fields).length > 0
        ? { verdict: 'green' }
        : { verdict: 'red', red: `happened: ${label} produced no fields` };
    }
    return Object.keys(artifact).length > 0
      ? { verdict: 'green' }
      : { verdict: 'red', red: `happened: ${label} produced an empty object` };
  }
  return { verdict: 'green' };
}

// ---------------------------------------------------------------------------
// Preflight — borrowed from poc/m0/runner.mjs, adapted to M1's real
// `readFlow`/`arbiter` shape.
// ---------------------------------------------------------------------------

function hashFile(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

/** A run dir that already holds `ask.json`/`answer.json` from an earlier run
 *  is a stale-answer hazard — refuse, never silently proceed or delete. */
export function checkFreshRunDir(runDir) {
  for (const file of ['ask.json', 'answer.json']) {
    if (existsSync(join(runDir, file))) {
      return { ok: false, red: `preflight: run dir ${runDir} already holds ${file} from an earlier run — use a new runId` };
    }
  }
  return { ok: true };
}

/** M10 item 1: fetch a web page and freeze its text as `<dir>/<id>.txt`; the sha256 is of the FROZEN bytes, like a file input. The ONE writer of a
 *  page's frozen copy: drafting calls it with its draft folder, a run start (via `freezeInputs`) with the run's `inputs/`, so the two are
 *  separate files and a run is only ever checked against its own. The fetch is tried once; a refusal names the input and says why in plain words.
 *  @param {string} dir @param {string} id @param {string} url
 *  @param {{fetchPage?: (url: string) => Promise<{ok: true, text: string, url: string}|{ok: false, error: string}>}} [o]
 *  @returns {Promise<{ok: true, text: string, entry: {id: string, source: string, frozen: string, sha256: string, bytes: number}}|{ok: false, red: string}>} `text` = the frozen text itself, for the caller that reads it (drafting) */
export async function freezePage(dir, id, url, { fetchPage = fetchPageText } = {}) {
  const got = await fetchPage(url);
  if (!got.ok) return { ok: false, red: `freeze: input "${id}": ${got.error}` };
  mkdirSync(dir, { recursive: true });
  const frozen = join(dir, `${id}.txt`);
  writeFileSync(frozen, got.text, 'utf8');
  return { ok: true, text: got.text, entry: { id, source: url, frozen, sha256: hashFile(frozen), bytes: statSync(frozen).size } };
}

/** Copy each named source into `<runDir>/inputs/`, hash the FROZEN copy
 *  (never the original again after this), write `inputs.json`. An
 *  unreadable source refuses by name. A source that is a web address
 *  (M10 item 1) is fetched and frozen by `freezePage`, in the same manifest.
 *  @param {string} runDir @param {Array<{id: string, path: string}>} sources
 *  M10b amendment 1: a CSV input named in `tableRoles` (the sheets a step's `close.sheet` reads) also gets its `tableSha` (bareguard's fingerprint of the table made
 *  from the FROZEN copy) in its manifest entry - the ONE place it is written, once, with the run's inputs; every sheet check of the run uses this recorded value.
 *  A sheet bareguard cannot read as a table refuses the run here, naming the input.
 *  @param {{fetchPage?: (url: string) => Promise<{ok: true, text: string, url: string}|{ok: false, error: string}>, tableRoles?: string[]}} [o] */
export async function freezeInputs(runDir, sources, { fetchPage, tableRoles = [] } = {}) {
  const inputsDir = join(runDir, 'inputs');
  mkdirSync(inputsDir, { recursive: true });
  const manifest = [];
  for (const { id, path: sourcePath } of sources ?? []) {
    if (isWebUrl(sourcePath)) {
      const page = await freezePage(inputsDir, id, sourcePath, { fetchPage });
      if (!page.ok) return page;
      manifest.push(page.entry);
      continue;
    }
    if (!existsSync(sourcePath)) {
      return { ok: false, red: `freeze: input "${id}" is unreadable at ${sourcePath}` };
    }
    const frozenPath = join(inputsDir, `${id}${extname(sourcePath)}`);
    copyFileSync(sourcePath, frozenPath);
    const sha256 = hashFile(frozenPath);
    const { size: bytes } = statSync(frozenPath);
    /** @type {Record<string, any>} */
    const entry = {
      id, source: sourcePath, frozen: frozenPath, sha256, bytes,
    };
    if (tableRoles.includes(id)) {
      const tsha = isCellsPath(frozenPath) ? tableShaOfFrozen(runDir, basename(frozenPath)) : null;
      if (tsha === null) return { ok: false, red: `freeze: input "${id}" cannot be read as a table (a row with more or fewer cells than the header, or a repeated column name); fix the sheet` };
      entry.tableSha = tsha;
    }
    manifest.push(entry);
  }
  writeFileSync(join(runDir, 'inputs.json'), JSON.stringify(manifest, null, 2));
  return { ok: true, manifest };
}

/** realpath of a path that may not exist (falls back to the lexical resolve). */
function realOrResolved(p) {
  try { return realpathSync(p); } catch { return resolve(p); }
}

const isInside = (child, base) => child === base || child.startsWith(base + sep);

/** The send target's folder (M4e amendment 1, "Destination is any folder").
 *  An absolute `file:/abs/path` is that folder, anywhere on the machine. A
 *  relative path keeps its M0/M2 meaning: joined onto the install folder and
 *  fenced inside it (lexically AND after realpath — a symlink inside the repo
 *  pointing outside must not pass). Either way, with `realpathSync` (symlinks
 *  followed), the folder must exist, be a folder, be writable, and must NOT be
 *  the run's own folder (its records and `inputs/`), the panel/CLI flow root, any flow
 *  folder under it (one holding a FLOW_FILES file) or `<root>/.drafts` or `<root>/.starts`, or the fwdloop config folder (holds the keys).
 *  Called at sign time and re-called at write time (time-of-check vs
 *  time-of-use, M0's own fix) — the one rule for both.
 *  @param {string} target
 *  @param {{root?: string, runDir?: string}} [ctx] `root` = the flow root, `runDir` = this run's folder
 *  @returns {{ok:true, dir:string} | {ok:false, red:string}} */
export function checkSendDestination(target, ctx = {}) {
  const match = /^file:(.+)$/.exec(target ?? '');
  if (!match) return { ok: false, red: `destination: send target "${target}" is not a "file:<path>" target` };
  const absolute = isAbsolute(match[1]);
  const dir = absolute ? match[1] : join(REPO_ROOT, match[1]);
  if (!absolute) {
    const resolvedDir = resolve(dir);
    const resolvedRoot = resolve(REPO_ROOT);
    if (!isInside(resolvedDir, resolvedRoot)) {
      return { ok: false, red: `destination: send target "${target}" resolves outside the repo (${dir})` };
    }
    try {
      const realDir = realpathSync(dir);
      const realRoot = realpathSync(REPO_ROOT);
      if (!isInside(realDir, realRoot)) {
        return {
          ok: false,
          red: `destination: send target "${target}" is a symlink that resolves outside the repo (${realDir})`,
        };
      }
    } catch {
      // dir doesn't exist — handled by the not-a-folder red below.
    }
  }
  let realDir;
  try {
    realDir = realpathSync(dir);
    if (!statSync(realDir).isDirectory()) throw new Error('not a directory');
  } catch {
    return { ok: false, red: `destination: send target "${target}" is not an existing folder (${dir})` };
  }
  const refused = [];
  if (ctx.runDir) refused.push([realOrResolved(ctx.runDir), "the run's own folder (its records and inputs)"]);
  refused.push([realOrResolved(configHome(configDoorHome().home)), 'the fwdloop config folder']);
  if (ctx.root) {
    const realRoot = realOrResolved(ctx.root);
    if (realDir === realRoot) {
      return { ok: false, red: `destination: send target "${target}" is the flow root (${realDir}) — refused` };
    }
    if (isInside(realDir, realRoot)) {
      const child = realDir.slice(realRoot.length + 1).split(sep)[0];
      const childDir = join(realRoot, child);
      // a flow folder = holds any of the flow's own files (the same FLOW_FILES `src/flow.js` writes)
      if (FLOW_FILES.some((f) => existsSync(join(childDir, f)))) refused.push([childDir, 'a flow folder']);
      else if (child === '.drafts') refused.push([childDir, 'the panel drafts folder']);
      else if (child === PANEL_STARTS_DIR) refused.push([childDir, 'the panel starts folder']);
    }
  }
  for (const [base, what] of refused) {
    if (isInside(realDir, base)) {
      return { ok: false, red: `destination: send target "${target}" is ${what} (${realDir}) — refused` };
    }
  }
  try {
    accessSync(dir, fsConstants.W_OK);
  } catch (err) {
    return { ok: false, red: `destination: send target directory "${dir}" is not writable (${err.code})` };
  }
  return { ok: true, dir: absolute ? realDir : dir };
}

// ---------------------------------------------------------------------------
// Artifacts on disk (M2 scope item 2): every emitted artifact is written to
// `runs/<runId>/artifacts/<emits>.json` the moment its step closes
// (green/hitl pass-through/accepted) — ONE writer function, and later steps'
// `reads` are loaded back from these files, never from the in-memory
// `artifacts` object alone.
// ---------------------------------------------------------------------------

function artifactPath(runDir, id) {
  return join(runDir, 'artifacts', `${id}.json`);
}

/** The one writer for a run's artifact files. Refuses (throws) to overwrite
 *  an existing artifact id within a run UNLESS the caller explicitly asks
 *  for it (`overwrite: true` — the ask-redo path's own deliberate
 *  replacement of a step it is re-running; every other call site accepts
 *  the default and gets the safety refusal). */
export function writeArtifact(runDir, id, artifact, { overwrite = false } = {}) {
  const dir = join(runDir, 'artifacts');
  mkdirSync(dir, { recursive: true });
  const target = artifactPath(runDir, id);
  if (existsSync(target) && !overwrite) {
    throw new Error(`writeArtifact: artifact "${id}" already exists in this run (${target}) — refused`);
  }
  writeFileSync(target, serializeArtifact(artifact));
}

/**
 * F48 round 4 (redesign, docs/logs/FINDINGS.md): the ONE tri-state reader
 * every artifact-reading call site routes through. Round 3's `readArtifact`
 * collapsed THREE outcomes into one `undefined` — "never written" and
 * "read refused" (symlink escape / outside the run dir / unparseable JSON)
 * were indistinguishable to every caller. That single value with two
 * meanings is exactly what let a swapped/deleted accepted artifact reach
 * the send slot as `undefined`, get `?? null`-ed by `src/send.js`, and ship
 * a 4-byte `null` to the signed destination as a recorded "green" send —
 * the refusal `readFileInside` already computes was thrown away one layer
 * up. Every caller below now sees the real shape and decides, explicitly,
 * whether "missing" is fine (a genuinely not-yet-written read) or whether
 * ANY refusal — missing or red — must halt the run.
 * @returns {{ok:true, value:any} | {ok:false, missing:true} | {ok:false, missing:false, red:string}}
 */
export function readArtifactResult(runDir, id) {
  const result = readFileInside(runDir, `artifacts/${id}.json`);
  if (!result.ok) return result;
  let value;
  try {
    value = JSON.parse(result.text);
  } catch (err) {
    return { ok: false, missing: false, red: `artifact "${id}" is not valid JSON — ${err.message}` };
  }
  return { ok: true, value };
}

/** Back-compat convenience collapse of `readArtifactResult`: `undefined` for
 *  BOTH "never written" and "read refused" — the exact collapse the F48
 *  round 4 redesign says a caller must never reach for on its own. Safe to
 *  use ONLY where an explicit tri-state check has already refused any `red`
 *  for this same id earlier in the same call (documented at each remaining
 *  call site) — never add a NEW call site with this function instead of
 *  `readArtifactResult`.
 */
export function readArtifact(runDir, id) {
  const result = readArtifactResult(runDir, id);
  return result.ok ? result.value : undefined;
}

/** `readArtifactResult` for a whole `reads` array. A genuinely-missing read
 *  (never written) still renders as `undefined` in the map, unchanged from
 *  before — but a REFUSED read (red) is never silently folded in as
 *  `undefined` alongside it; the caller gets `{ok:false, red}` instead and
 *  must halt rather than feed tampered/unreadable content (or a `undefined`
 *  indistinguishable from "not written yet") into a step.
 *  @returns {{ok:true, map:Record<string,any>} | {ok:false, red:string}}
 */
export function readArtifactsMapChecked(runDir, ids, { docxRoles = /** @type {string[]} */ ([]) } = {}) {
  const map = {};
  for (const id of ids ?? []) {
    const result = readArtifactResult(runDir, id);
    if (!result.ok && !result.missing) {
      return { ok: false, red: `artifact "${id}" — ${result.red}` };
    }
    if (!result.ok && result.missing) {
      // M4d amendment 8: an id no step wrote may name a frozen CSV input; a step reads it as cells, so a green check can cite it.
      const input = readInputCells(runDir, id);
      if (!input.ok && !input.missing) return { ok: false, red: `input "${id}" — ${input.red}` };
      if (input.ok) { map[id] = input.value; continue; }
      // M10 am7 item 3: an id that names a saved web page (or a text file) is read as its text, from the RUN'S OWN frozen copy, sha-checked, through the one safe
      // read gateway (`readFileInside`, in `readRunSource`). By role, text only: a copy that is missing or changed refuses the step; an id that is no text input
      // of this run is left as it was (undefined).
      const page = readRunSource(runDir, id, { docx: docxRoles.includes(id) });
      if (page.ok) { map[id] = { kind: 'text', text: page.text }; continue; }
      if (page.code === 'unreadable') return { ok: false, red: page.red };
    }
    map[id] = result.ok ? result.value : undefined;
  }
  return { ok: true, map };
}

/** M10 piece 5 (item 2): the role a green step quotes from - the one input whose .docx text its check (and so the step itself) may be handed. @param {any} step @returns {string[]} */
const citedRolesOf = (step) => (step?.close?.class === 'green' && typeof step.close.cited?.source === 'string' ? [step.close.cited.source] : []);

/** A frozen CSV input as `{kind:'cells', header, rows}` (the shape `addressCells` gives), checked against the sha256 recorded at freeze.
 *  Same three outcomes as `readArtifactResult`: not an input of this run (`missing`), refused (`red`), or the cells. */
function readInputCells(runDir, id) {
  const manifest = readFileInside(runDir, 'inputs.json');
  if (!manifest.ok) return manifest.missing ? { ok: false, missing: true } : { ok: false, missing: false, red: manifest.red };
  let entries;
  try { entries = JSON.parse(manifest.text); } catch (err) { return { ok: false, missing: false, red: `inputs.json is not valid JSON — ${err.message}` }; }
  const entry = Array.isArray(entries) ? entries.find((e) => e?.id === id) : undefined;
  if (!entry || !isCellsPath(entry.frozen)) return { ok: false, missing: true };
  const file = readFileInside(runDir, `inputs/${basename(entry.frozen)}`);
  if (!file.ok) return file.missing ? { ok: false, missing: false, red: 'the frozen copy is missing' } : { ok: false, missing: false, red: file.red };
  if (createHash('sha256').update(file.text).digest('hex') !== entry.sha256) return { ok: false, missing: false, red: 'the frozen copy changed since it was frozen' };
  return { ok: true, value: { kind: 'cells', ...parseCsv(file.text) } };
}

// ---------------------------------------------------------------------------
// Item 4 (small): an `answer.json` still on disk, unconsumed, at run end —
// a late human answer that arrived after the run already moved on. One
// audit row, never applied, so the human can see their late answer changed
// nothing.
// ---------------------------------------------------------------------------

function recordLateAnswerIfAny(runDir, now = () => new Date().toISOString()) {
  const file = join(runDir, 'answer.json');
  if (!existsSync(file)) return;
  appendAudit(runDir, {
    step: null,
    attempt: null,
    class: null,
    verdict: 'answer-after-run',
    gap: null,
    usd: 0,
    spendComplete: true,
    wallMs: 0,
    model: null,
    modelMatch: null,
    strike: false,
    at: now(),
    tokens: null,
    tools: null,
    refused: [],
    kind: 'answer-after-run',
    file,
  });
}

// ---------------------------------------------------------------------------
// M8 items 2 and 4 (item 4 replaced by am4): the run-end tally of cross-run learnings ($0, code only, no model call). ONE call per run
// exit, from the three callers of `foldFromStep` (runFlow, resumeRun, continueRun), the expired-ask exit and the rerun exit. A record,
// never a verdict: it can never change a run's outcome, result, spend or books. It runs whether `learningHints` is on or off.
//   - M8 am4: every run's notes COUNT when the run ends, FIXED and NEVER FIXED alike, whatever the ending and whether or not its asks
//     were accepted. No hold, no release (bareloop's ruling for both repos, 2026-10-24).
//   - A run waiting at an ask has not ended ('paused', or a Stop whose set-aside failed): no note yet. A Stop or a cap-halt HAS ended
//     the leg, as in bareloop: its notes are made then, and a later resume folds the whole run again (the ledger counts a run once per row).
//   - Noise runs (provider red, a crashed check) make no note: buildCards reads them off the escalation events eventsOfRun builds.
// Under a test process with no FWDLOOP_CONFIG_HOME nothing is written (`configDoorHome`), as for every config read.
// borrowed-from: bareloop src/userrun.js@v0.46.0:2035 (the call site, in its own try/catch)
// ---------------------------------------------------------------------------

/** where a failed run-end tally is recorded (one appended row, in the run's own folder): the run itself is unaffected */
export const LEARN_ERROR_FILE = 'learn-error.jsonl';

/**
 * @param {{flowName: string, runId: string, runDir: string, outcome: string, specHash: string|null, now: () => string}} o
 */
function recordRunNotes({
  flowName, runId, runDir, outcome, specHash, now,
}) {
  if (NOT_A_RUN_END.has(outcome)) return;
  const door = configDoorHome();
  if (door.skip) return;
  try {
    const r = learnAtRunEnd({
      home: door.home, workflow: flowName, runId, runDir, specHash, now: new Date(now()),
    });
    if (r.problem) throw new Error(r.problem);
  } catch (/** @type {any} */ e) {
    try {
      appendRow(join(runDir, LEARN_ERROR_FILE), { at: now(), error: redactSecrets(String(e?.message ?? e)).split('\n')[0] });
    } catch { /* the record of the failure is itself best-effort */ }
  }
}

/**
 * M8 am7 item 1: the step's side of "one block". `hintsForRun` (src/learnstore.js) is the ONE function that makes the block the drafter is handed; a step's try
 * calls that same function, with the run's own workflow name, first input source and clock, and a null specHash exactly as the drafter does (so no second filter by job version), and takes its answer whole (no second render, no filter).
 * Returns null when `learningHints` is off, when there is no ledger or nothing readable, or in a test process with no config home. A ledger problem THROWS (the caller
 * hands nothing and records why in learn-error.jsonl, never a failed step).
 * @param {{flowName: string, source: string|null, now: () => string}} o
 * @returns {() => {text: string, ids: string[]}|null}
 */
function stepHintsReader({ flowName, source, now }) {
  return () => {
    const door = configDoorHome();
    if (door.skip) return null;
    return hintsForRun({ home: door.home, spec: { job: flowName, inputs: source ? [{ value: source }] : [] }, specHash: null, now: new Date(now()) });
  };
}

// ---------------------------------------------------------------------------
// The ralph loop with strikes (M2 scope item 5) for ONE step.
// ---------------------------------------------------------------------------

/**
 * Sums only the KNOWN (typeof === 'number') values, e.g. a transport fault's
 * priced floor plus this attempt's own cost. Never `?? 0` — a value that is
 * null/undefined is dropped from the sum rather than zeroing it out, so a
 * lone known partial survives as itself and "no known cost at all" stays
 * `null` (never coerced to 0).
 * @param {...(number|null|undefined)} values
 * @returns {number|null}
 */
function sumKnownUsd(...values) {
  const known = values.filter((v) => typeof v === 'number');
  if (known.length === 0) return null;
  return known.reduce((a, b) => a + b, 0);
}

// Amendment M4a-2 — SIGNED by hamr 2026-09-27 ("sign mfa2", = M4a-2):
// `at` (this attempt's own finish time, off the run's injected clock — never
// the bare wall clock, exactly like every other timestamp this module
// writes) and `tokens` (threaded straight from `modelStep`'s own result,
// which sums it at the SAME place it sums `costUsd` across a step's rounds
// — never re-derived here or anywhere else by position from spend.jsonl).
// `tokens` defaults to `null`: every call site with no model call (cap-halt,
// paused, ask-timeout, refused, accept, redo-rejected) leaves it at that
// default; every call site with a `modelStep` result passes its own
// `result.tokens` through unchanged.
// M4a-3 (docs/wiki/the-module-ladder.md, "M4a" section, "Amendment M4a-3 —
// SIGNED by hamr 2026-09-27"): `tools` (a {toolName: count} tally, threaded
// straight from `modelStep`'s own result — never re-derived here) and
// `ungranted` (an array of tool names the model called that this step never
// granted; omitted entirely when empty, per `src/books.js`'s own contract).
// Both default the same way `tokens` does: every call site with no model
// call leaves `tools` at its `null` default; every call site with a
// `modelStep` result passes `result.tools`/`result.ungranted` through
// unchanged.
function makeAuditRow({
  step, attempt, verdict, gap, usd, spendComplete, wallMs, model = null, modelMatch = null, strike, at, tokens = null, tools = null, ungranted = /** @type {string[]|undefined} */ (undefined), refused = /** @type {Array<{verb:string,path:string,rule:string}>} */ ([]),
  thinking = /** @type {{asked:string, status:string|null}|undefined} */ (undefined),
  hints = /** @type {number|undefined} */ (undefined),
}) {
  const row = {
    step: step?.emits ?? step?.goal ?? null,
    attempt,
    class: step?.close?.class ?? null,
    verdict,
    gap: gap ?? null,
    usd,
    spendComplete,
    wallMs,
    model: model ?? null,
    modelMatch: modelMatch ?? null,
    strike: !!strike,
    at,
    tokens,
    tools,
    refused,
  };
  if (ungranted !== undefined && ungranted.length > 0) row.ungranted = ungranted;
  // M4d am25 item 4: the thinking this model call asked for and what bareagent reported back; the ONE writer of the field. A row with no model call has none.
  if (thinking !== undefined) row.thinking = thinking;
  // M8 am7 item 4: how many hints from earlier runs this try was handed; the key is absent when none were (the exact text is in learnings-try-*.json, src/flowmodel.js).
  if (hints !== undefined) row.hints = hints;
  return row;
}

/**
 * Run one step to green (or hitl pass-through), looping under strikes and
 * the attempt fallback. Returns `{ ok:true, artifact, attempts }` on success
 * or `{ ok:false, outcome, red }` on any halt. Appends one audit row per
 * attempt via `deps.recordAudit`. Never throws for a model/close failure —
 * only a programmer error (a malformed step, an unreachable branch) escapes.
 *
 * @param {object} opts
 * @param {any} opts.step
 * @param {Record<string, any>} [opts.primitivesMap]
 * @param {Record<string, any>} opts.readsMap
 * @param {string} opts.businessDate
 * @param {(executorContext:object, grantedTools:Record<string,any>, stepMeta?:{class:string|null}, seam?:{stopRequested?:() => boolean}) => Promise<any>} opts.modelStep
 * @param {{ value: number }} opts.spent
 * @param {number} opts.capUsd
 * @param {number} opts.ceilingUsd
 * @param {(row: any, modelOutput?: any) => void} opts.recordAudit
 * @param {string|null} [opts.initialGap]
 * @param {number} [opts.attemptOffset]
 * @param {(() => {text: string, ids: string[]}|null)|null} [opts.learnHints] - M8 am7: `stepHintsReader`'s closure (the drafter's one block function); asked only on a retry, redo or rerun try
 * @param {boolean} [opts.thinkingBox] - M4d am25: the job's "Thinking on" box as this run's copy keeps it (default off)
 * @param {() => string} [opts.now] - M4a-2: stamps each audit row's `at`;
 *   defaults to the real wall clock.
 * @param {(() => boolean)|null} [opts.readStop] - amendment 7 item 8: the run's stop reader, asked before every try and (via modelStep's seam) every model call
 * @param {number} [opts.stepNo] - this step's 1-based number, for the words of a stop row
 * @param {string|null} [opts.prevStepId] - the id of step stepNo-1 (null for step 1): the step a "stopped after step N-1" row is filed under
 * @param {number} [opts.triesDone] - tries a Stop already closed on this step (they count against its limit)
 * @param {string|null} [opts.runDir] - M4d am29 item 2: the run's folder, where each try saves its checks
 * @returns {Promise<{ok:true, artifact:any, attempts:number, hitl?:boolean} | {ok:false, outcome:string, red:string, stop?:{where:string, book:Record<string, any>, step?:string|null}}>}
 */
export async function runStepRalph({
  step, primitivesMap, readsMap, businessDate, modelStep, spent, capUsd, ceilingUsd, recordAudit, initialGap = null, attemptOffset = 0,
  // M4d am25: the job's "Thinking on" box as the run's own copy keeps it; read once by the caller (`readJobThinking`), decided per try below by `stepThinkingMode`.
  thinkingBox = false,
  learnHints = null,
  // M4a-2: the run's own injected clock (never the bare wall clock) —
  // stamps every audit row's `at` with this attempt's finish time. Defaults
  // to the real wall clock so a caller that doesn't inject one (there are
  // none left in production; a defensive default only) still writes a valid
  // ISO string.
  now = () => new Date().toISOString(),
  // M4e amendment 7 item 8: the Stop seam before every model call. `readStop` is the run's one stop reader (the fold's closure over
  // `readStopRequest`); `stepNo` is this step's 1-based number for the words of the stop row; `triesDone` is the tries a Stop already
  // cut this step short of (their numbering is in `attemptOffset`; a try the Stop cut mid-way is replaced by the new one, never counted
  // against the limit, so Resume always gets at least one new try).
  readStop = null, stepNo = 0, triesDone = 0,
  // M4d am29 item 2: the run's folder, where each try saves its checks (`checks.jsonl`, src/diary.js)
  runDir = null,
  // the id of step stepNo-1 (null for step 1): a Stop before this step's first call words itself "after step N-1" and is filed under that step
  prevStepId = null,
}) {
  /** @type {string|null} */
  let gap = initialGap ?? null;
  let strikes = 0;
  const seenGaps = new Set();
  const maxN = MAX_ATTEMPTS - triesDone;
  let lastTurns = null;
  const stopWords = (tryNo, turns) => (turns > 0
    ? `stopped after turn ${turns} of try ${tryNo} of step ${stepNo}`
    : (tryNo > 0 ? `stopped after try ${tryNo} of step ${stepNo}` : (stepNo > 1 ? `stopped after step ${stepNo - 1}` : 'stopped before step 1')));
  /** The ralph's return for a Stop: the cut try's own row fields (`book`) ride the one `stopped` row `settleStop` writes.
   *  @param {string} where @param {Record<string, any>} [book] @returns {{ok:false, outcome:string, red:string, stop:{where:string, book:Record<string, any>, step:string|null}}} */
  const stopped = (where, book = {}) => ({
    ok: false,
    outcome: 'stopped',
    red: `stopped by you — ${where}`,
    // one value: the words name the step the row is filed under — "after step N-1" (before this step's first call) is N-1's, the rest this step's
    stop: { where, book, step: where === stopWords(0, 0) ? prevStepId : (step?.emits ?? step?.goal ?? null) },
  });

  for (let n = 1; n <= maxN; n += 1) {
    const attempt = attemptOffset + n;
    // Between tries: the previous try closed red, no new model call has started — a pending Stop ends the run here.
    if (n > 1 && readStop && readStop()) return stopped(stopWords(attempt - 1, lastTurns ?? 0));
    // This attempt's known floor from a FIRST transport fault that then
    // retried — every audit row this attempt still writes must carry this
    // floor summed with its own cost (F41 books gap: the fault's cost was
    // only ever in `spent.value`'s total, never on the attempt's own row).
    let attemptFloorUsd = null;
    if (spent.value + ceilingUsd > capUsd) {
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'cap-halt', gap, usd: null, spendComplete: false, wallMs: 0, strike: false, at: now(),
      }));
      return {
        ok: false,
        outcome: 'cap-halt',
        red: `cap-halt: step "${step.goal}" attempt ${attempt} cannot be funded under cap $${capUsd} (spent so far $${spent.value})`,
      };
    }

    const grantedTools = Object.fromEntries((step.primitives ?? []).map((verb) => [verb, primitivesMap?.[verb]]));
    // M8 am7: the earlier runs' block for THIS try only - a retry, a redo or a rerun (`stepHintsWanted`; the Chat box never decides it). It is the drafter's one block
    // function asked again now, recorded write-once BEFORE the call (so the Audit shows what was sent), and any failure hands nothing and is written to learn-error.jsonl.
    /** @type {{text: string, ids: string[]}|null} */
    let handed = null;
    if (learnHints !== null && stepHintsWanted({ attempt, rerunReason: n === 1 ? initialGap : null })) {
      try {
        handed = learnHints();
        if (handed !== null && runDir !== null) writeStepLearningsRecord(runDir, { step: step?.emits ?? step?.goal ?? '', try: attempt, text: handed.text, ids: handed.ids });
      } catch (/** @type {any} */ e) {
        handed = null;
        if (runDir !== null) {
          try { appendRow(join(runDir, LEARN_ERROR_FILE), { at: now(), error: redactSecrets(String(e?.message ?? e)).split('\n')[0] }); } catch { /* best-effort record of a failed record */ }
        }
      }
    }
    // every row this try writes from here on carries how many hints it was handed (none handed = no field)
    const rowOf = (/** @type {any} */ a) => makeAuditRow(handed !== null ? { ...a, hints: handed.ids.length } : a);
    const executorContext = buildExecutorContext({
      goal: step.goal, primitives: step.primitives ?? [], reads: readsMap, gap, hints: handed === null ? null : handed.text,
    });

    // `stepMeta` is a SEPARATE argument from `executorContext` — never a
    // field on it. It carries the step's declared close CLASS only (never
    // its shape), so a live `modelStep` can build its `emit_artifact` tool
    // schema without the executor context ever needing to carry one (M2
    // scope item 3's own invariant: the schema is class-only, and the
    // construction test below proves the context itself stays clean).
    // M4d am25: `thinkingMode` is the ONE decision of what this try asks of thinking (`stepThinkingMode`); the model step only passes it on.
    // M10 am7 item 3: `cited` is the fact part of a green step that quotes a saved page - the form of its ANSWER ({results: [{quote, values}]}) and the facts it must hold,
    // told to the step in plain words by the model step. It is not the check: the quotes are checked by `closeCited` against the run's own copy.
    const stepMeta = Object.freeze({ class: step.close?.class ?? null, cited: step.close?.class === 'green' && step.close.cited ? step.close.cited : null, sheet: step.close?.class === 'green' && Array.isArray(step.close.sheet) ? step.close.sheet : null, attempt, step: step?.emits ?? step?.goal ?? null, thinkingMode: stepThinkingMode({ boxOn: thinkingBox, attempt }) });

    const stopSeam = readStop ? Object.freeze({ stopRequested: readStop }) : undefined;

    const startedAt = Date.now();
    // eslint-disable-next-line no-await-in-loop
    let result = await modelStep(executorContext, grantedTools, stepMeta, stopSeam);
    if (result && result.ok === false && result.transport === true) {
      // A known partial cost from the FIRST transport fault must survive as
      // the floor even though this attempt goes on to retry — never
      // dropped on the retry path (the brief's own gap, closed here).
      if (typeof result.costUsd === 'number') {
        spent.value += result.costUsd;
        attemptFloorUsd = result.costUsd;
      }
      // Exactly one immediate retry on the SAME attempt for a transport
      // fault; an HTTP status is not transport, a wall-clock timeout is
      // never retried (M2 scope item 8) — both are the caller's own
      // `modelStep`'s job to distinguish; this loop only ever retries the
      // `transport: true` shape, exactly once.
      const first = result;
      // eslint-disable-next-line no-await-in-loop
      result = await modelStep(executorContext, grantedTools, stepMeta, stopSeam);
      // The first call's gate refusals and tool tally belong to this attempt's
      // audit row too (the retry's collector starts empty). Only refused /
      // tools / ungranted are merged — cost is never touched here.
      if (result && typeof result === 'object') {
        const refused = [...(first.refused ?? []), ...(result.refused ?? [])];
        const tools = first.tools || result.tools ? { ...(first.tools ?? {}) } : null;
        if (tools) for (const [k, v] of Object.entries(result.tools ?? {})) tools[k] = (tools[k] ?? 0) + v;
        const ungranted = [...new Set([...(first.ungranted ?? []), ...(result.ungranted ?? [])])].sort();
        result = { ...result, refused, tools, ...(ungranted.length > 0 ? { ungranted } : {}) };
      }
    }
    const wallMs = Date.now() - startedAt;

    // A Stop landed during this try: the call in flight finished and is booked here (its cost into the run's spend and onto the one
    // `stopped` row), no new call started. Unknown cost stays unknown (usd null, spend incomplete), never 0.
    const turns = typeof result?.turns === 'number' ? result.turns : null;
    lastTurns = turns;
    if (result && result.ok === false && result.stopped === true) {
      if (typeof result.costUsd === 'number') spent.value += result.costUsd;
      const usd = sumKnownUsd(attemptFloorUsd, result.costUsd);
      const ranCalls = (turns ?? 0) > 0 || attemptFloorUsd !== null;
      return stopped(stopWords(ranCalls ? attempt : attempt - 1, turns ?? 0), rowOf({
        step, attempt: ranCalls ? attempt : null, verdict: 'stopped', gap: null, usd, spendComplete: usd !== null, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
      }));
    }

    if (result && result.ok === false && result.transport === true) {
      if (typeof result.costUsd === 'number') spent.value += result.costUsd;
      // Both faults' known costs, summed — the first fault's floor was
      // already added to `spent.value` above (never double-added here); a
      // null second cost never zeroes out a known first floor.
      const usd = sumKnownUsd(attemptFloorUsd, result.costUsd);
      recordAudit(rowOf({
        step, attempt, verdict: 'provider-red', gap, usd, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
      }), result.red ?? 'transport fault twice');
      return { ok: false, outcome: 'provider-red', red: `provider-red: step "${step.goal}" attempt ${attempt}: ${result.red ?? 'transport fault twice'}` };
    }

    if (!result || result.ok !== true) {
      // A non-transport model failure — never thrown, never coerced into a
      // fabricated artifact. Treated as this attempt's red (it is the
      // step's own failure to produce, not a system halt), strike-eligible
      // like any other close red.
      const red = result?.red ?? 'model step failed with no artifact';
      // The try may have cost money (a length stop: "truncated: N tokens, no tool call"). Its row carries that cost below, so the run's spend
      // - the cap check, the history total - takes it here, the same one add as the stop and transport branches (books must balance).
      if (typeof result?.costUsd === 'number') spent.value += result.costUsd;
      const normalised = normaliseGap(red);
      const strike = seenGaps.has(normalised);
      seenGaps.add(normalised);
      if (strike) strikes += 1;
      const usd = sumKnownUsd(attemptFloorUsd, result?.costUsd);
      recordAudit(rowOf({
        step, attempt, verdict: 'red', gap: red, usd, spendComplete: usd !== null, wallMs, model: result?.model, modelMatch: result?.modelMatch, strike, at: now(), tokens: result?.tokens ?? null, tools: result?.tools ?? null, ungranted: result?.ungranted, refused: result?.refused, thinking: result?.thinking,
      }), red);
      if (n === maxN) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: step "${step.goal}" — ${red}` };
      if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: step "${step.goal}" — ${red}` };
      gap = red;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (result.costUsd === null || result.costUsd === undefined) {
      recordAudit(rowOf({
        step, attempt, verdict: 'pricing-red', gap, usd: attemptFloorUsd, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
      }), result.artifact ?? null);
      return { ok: false, outcome: 'pricing-red', red: `pricing-red: step "${step.goal}" attempt ${attempt} returned no cost (never "?? 0")` };
    }
    spent.value += result.costUsd;
    const attemptUsd = sumKnownUsd(attemptFloorUsd, result.costUsd);

    // M4d am29 item 2: this try's checks, in the order they run; `saveTry` writes them (and the output they judged) once, just before the try's audit row
    const tryChecks = /** @type {any[]} */ ([]);
    let judged = null;
    const saveTry = () => {
      if (runDir === null) return;
      appendChecks(runDir, {
        step: step?.emits ?? step?.goal ?? null, try: attempt, at: now(), lastRound: nextRound(runDir, step?.emits ?? step?.goal ?? null) - 1, checks: [...tryChecks].sort((a, b) => a.n - b.n), output: judged,
      });
    };

    // The model's own word, taken at face value — before the happened check,
    // before any close, no exception (M2 amendment 1 item 1). A halt, not a
    // strike, not a retry: `recordAudit`'s modelOutput arg keeps the RAW
    // `result.artifact` (done/blocker included) for log.json; everything
    // downstream of a `done: true` gets the STRIPPED artifact.
    const doneCheck = checkDoneBlocker(step, result.artifact);
    tryChecks.push(doneRecord(doneCheck, result.artifact));
    if (doneCheck.verdict === 'not-done') {
      saveTry();
      recordAudit(rowOf({
        step, attempt, verdict: 'not-done', gap: doneCheck.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
      }), result.artifact ?? null);
      return { ok: false, outcome: 'not-done', red: doneCheck.red };
    }
    const artifact = stripDoneBlocker(result.artifact);

    const happened = checkArtifactHappened(step, artifact);
    tryChecks.push(happenedRecord(happened, artifact));
    judged = outputRecord(step, artifact);
    if (happened.verdict === 'red') {
      saveTry();
      // Item 5: "or wrote no artifact" strikes unconditionally, every time
      // (never gated by novelty — an empty artifact is always the same
      // failure) — matches poc/m2/gapback.mjs's own rule exactly.
      strikes += 1;
      recordAudit(rowOf({
        step, attempt, verdict: 'red', gap: happened.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: true, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
      }), result.artifact ?? null);
      if (n === maxN) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: ${happened.red}` };
      if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: ${happened.red}` };
      gap = happened.red ?? null;
      // eslint-disable-next-line no-continue
      continue;
    }

    // M10 piece 4: a step that cites quotes reads the run's OWN frozen copy of its source (never the drafting copy); the record of what the check said is
    // written by the one writer, `writeCitedLine`, whatever the verdict - the Result tab says why a line did not pass.
    const citedPart = step?.close?.class === 'green' ? step?.close?.cited : undefined;
    const source = citedPart && runDir !== null ? readRunSource(runDir, citedPart.source, { docx: true }) : undefined;
    // M10b piece 2: a step with `close.sheet` is checked by bareguard on the run's own frozen copy and the `tableSha` recorded at its start; the record of what it
    // said is written by the one writer, `writeSheetLine`, whatever the verdict.
    const sheetPart = step?.close?.class === 'green' && Array.isArray(step?.close?.sheet) ? step.close.sheet : undefined;
    const sheet = sheetPart && runDir !== null ? readRunSheets(runDir, sheetPart) : undefined;
    const closed = await closeByClass(step, artifact, { reads: readsMap, businessDate, source, sheet });
    if (sheetPart && runDir !== null && closed.sheetRecord) writeSheetLine(runDir, { n: step.fromLine, try: attempt, checks: sheetPart, closed });
    if (citedPart && runDir !== null && closed.cited) {
      writeCitedLine(runDir, citedLineOf({
        n: step.fromLine, part: closed.cited.part, results: closed.cited.results, check: closed.cited.check,
      }));
    }
    tryChecks.push(...closeRecords(step, artifact, closed));
    saveTry();

    if (closed.verdict === 'green' || closed.verdict === 'hitl') {
      recordAudit(rowOf({
        step, attempt, verdict: closed.verdict, gap: null, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
      }), result.artifact);
      return {
        ok: true, artifact, attempts: attempt, hitl: closed.verdict === 'hitl',
      };
    }

    if (closed.verdict !== 'red') {
      // A closer that renders no judgment ('unparseable'/'crash') is a
      // CASUALTY, never a red and never a strike (bareloop F17).
      recordAudit(rowOf({
        step, attempt, verdict: 'close-casualty', gap: closed.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
      }), result.artifact);
      return { ok: false, outcome: 'close-casualty', red: `close-casualty: step "${step.goal}" — ${closed.red} (${closed.verdict})` };
    }

    const normalised = normaliseGap(closed.red);
    const strike = seenGaps.has(normalised);
    seenGaps.add(normalised);
    if (strike) strikes += 1;
    recordAudit(rowOf({
      step, attempt, verdict: 'red', gap: closed.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused, thinking: result.thinking,
    }), result.artifact);

    if (n === maxN) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: step "${step.goal}" — ${closed.red}` };
    if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: step "${step.goal}" — ${closed.red}` };
    gap = closed.red ?? null;
  }
  // Unreachable — the loop above always returns by n === MAX_ATTEMPTS.
  return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: step "${step.goal}" — exhausted attempts` };
}

// ---------------------------------------------------------------------------
// runFlow — the entry point.
// ---------------------------------------------------------------------------

/**
 * @param {object} opts
 * @param {string} opts.root - the flows root directory (M1's `readFlow` root).
 * @param {string} opts.name - the flow name.
 * @param {string} opts.runId
 * @param {Array<{id:string, path:string}>} opts.sources - the real files to freeze for this run.
 * @param {unknown} opts.catalogue - passed straight through to `readFlow`.
 * @param {(executorContext:object, grantedTools:Record<string,any>, stepMeta?:{class:string|null}) => Promise<{ok:boolean, artifact?:unknown, costUsd:number|null, red?:string, transport?:boolean, model?:string, modelMatch?:boolean}>} opts.modelStep
 * @param {(opts:{question:string, evidence:unknown, runDir:string}) => Promise<{decision:'accept'|'redo'|'rerun'|'timeout'|'park', reason?:string, artifactSha256?:string}>} opts.askStep
 * @param {(target:string, filename:string, content:unknown, acceptedSha256?:string|null) => Promise<{ok:boolean, red?:string, bytes?:number}>} opts.sendStep
 * @param {Record<string, any>} [opts.primitives] - injected primitive implementations, keyed by catalogue verb.
 * @param {string[]} [opts.primitiveReds] - `resolvePrimitives`'s own `reds` (e.g. bareguard refusing a symlinked file scope); any entry refuses the run at $0 like an unwired verb, before the run dir exists.
 * @param {() => string} [opts.clock] - returns the current ISO timestamp; defaults to the wall clock.
 * @param {string} opts.businessDate - the run's explicit "as of today", never the wall clock.
 * @param {number} [opts.ceilingUsd] - per-attempt ceiling override; the model's hold from Settings prices (`ceilingCostUsd`); absent = no hold.
 * @param {{slot: string, model: string}} [opts.runModel] - M4d am33: the model this run started on; recorded once in the run folder (run-model.json) and kept by every resume/continue.
 * @param {string|null} [opts.initialGap] - M3 scope item 7 (rerun as a fresh
 *   run): a human's rerun reason, carried as the FIRST ordinary step's
 *   starting gap. Never used by a plain `runFlow` call outside `resumeRun`'s
 *   own rerun path.
 * @param {(url: string) => Promise<{ok: true, text: string, url: string}|{ok: false, error: string}>} [opts.fetchPage] - M10: the web-page fetch (default barebrowse via src/pagefetch.js); a test injects one.
 * @param {() => number} [opts.nowMs] - F45 finding 3: returns the current
 *   epoch ms; defaults to the wall clock. Mirrors `clock` (ISO) so a test
 *   can advance wall time across a park/resume boundary without a real wait.
 */
export async function runFlow({
  root, name, runId, sources, catalogue, modelStep, askStep, sendStep, primitives, primitiveReds, clock, businessDate, ceilingUsd, initialGap, fetchPage,
  // M4d am33: the model this run STARTED on ({ slot, model }); recorded once beside the run, kept by every resume/continue. Absent = nothing recorded.
  runModel,
  // F45 finding 3's test needs to advance wall time across a park/resume
  // boundary without a real wait, exactly like `clock` already does for ISO
  // timestamps — `nowMs` is the same idea for epoch-ms wall-clock reads.
  // Minimal and additive: every existing caller (no `nowMs`) gets the real
  // `Date.now`, unchanged.
  nowMs,
}) {
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();
  const getNowMs = typeof nowMs === 'function' ? nowMs : Date.now;
  const flowDir = join(root, name);
  const startedAt = getNowMs();

  // Defense in depth alongside `bin/fwdloop`'s own `resolveRunDir` check on
  // `--run-id`: a caller-supplied runId that would escape `flowDir/runs/`
  // (`..`, a `/`/`\` segment, ...) is refused by name, at $0, before any
  // directory for this run is even looked at, let alone created.
  const runIdCheck = resolveRunDir(flowDir, runId);
  if (!runIdCheck.ok) {
    mkdirSync(flowDir, { recursive: true });
    appendHistory(flowDir, {
      runId, at: now(), outcome: 'refused', spentUsd: 0, spendComplete: true, capUsd: null, wallMs: Date.now() - startedAt, signatureHash: null,
    });
    return { outcome: 'refused', red: runIdCheck.red };
  }

  const read = readPlan({ root, name, catalogue, runDir: runIdCheck.runDir });
  if (!read.ok) {
    // Negative iv: a flow whose files don't hash to the signature (or is
    // otherwise unreadable) is refused by name, at $0. No run dir exists to
    // hold an audit.jsonl, so the ONLY book row is one history row: a
    // refusal spent nothing, and `usd: 0`/`spendComplete: true` is honestly
    // true here (never the "unknown coerced to 0" case money honesty
    // otherwise forbids) — stated explicitly per the brief's own note.
    mkdirSync(flowDir, { recursive: true });
    appendHistory(flowDir, {
      runId, at: now(), outcome: 'refused', spentUsd: 0, spendComplete: true, capUsd: null, wallMs: Date.now() - startedAt, signatureHash: null,
    });
    return { outcome: 'refused', red: read.reds[0], reds: read.reds };
  }

  const { declaration, signature } = read;
  const runDir = runIdCheck.runDir;
  // M4e amendment 5 item 3: the values THIS run was signed with (cap, send folder, ask waits) lie over the flow's own — one decision (`pickRunValues`).
  const applied = applyRunValues(read.arbiter, name, signature.flow, pickRunValues(runDir));
  if (!applied.ok) {
    return haltRun({
      flowDir, runDir, runId, capUsd: null, startedAt, now, nowMs: getNowMs, signatureHash: signature.flow, outcome: 'preflight-red', red: applied.red, spent: { value: 0 },
    });
  }
  const { arbiter } = applied;
  const capUsd = arbiter.capUsd;
  const redoCap = arbiter.redoCap ?? 3;
  const effectiveCeilingUsd = holdOf(ceilingUsd);
  const askLines = new Map((arbiter.asks ?? []).map((a) => [a.line, a]));
  const sendLines = new Map((arbiter.sends ?? []).map((s) => [s.line, s]));

  const unwiredVerb = findUnwiredVerbStep(declaration);
  if (unwiredVerb) {
    return haltRun({
      flowDir,
      runDir,
      runId,
      capUsd,
      startedAt,
      now,
      nowMs: getNowMs,
      signatureHash: signature.flow,
      outcome: 'preflight-red',
      red: unwiredRed(unwiredVerb),
      spent: { value: 0 },
    });
  }

  // M4e amendment 19 4: every softgreen check is built before the first model call; one that cannot be built is refused at $0, by step name
  const unbuildable = findUnbuildableCheckStep(declaration);
  if (unbuildable) {
    return haltRun({
      flowDir, runDir, runId, capUsd, startedAt, now, nowMs: getNowMs, signatureHash: signature.flow, outcome: 'preflight-red', red: unbuildableRed(unbuildable), detail: unbuildable.why, spent: { value: 0 },
    });
  }

  if (primitiveReds?.length) {
    return haltRun({
      flowDir, runDir, runId, capUsd, startedAt, now, nowMs: getNowMs, signatureHash: signature.flow, outcome: 'preflight-red', red: primitiveReds[0], spent: { value: 0 },
    });
  }

  const fresh = checkFreshRunDir(runDir);
  if (!fresh.ok) {
    return haltRun({
      flowDir, runDir, runId, capUsd, startedAt, now, nowMs: getNowMs, signatureHash: signature.flow, outcome: 'preflight-red', red: fresh.red, spent: { value: 0 },
    });
  }
  resetRunStore(runDir); // M7: a fresh run never inherits a store left by an earlier run of the same id
  mkdirSync(runDir, { recursive: true });

  // M6: the run keeps a write-once copy of the job it runs, from before its first step (its Job tab shows this, not the flow's later versions)
  const jobCopy = runOwnsPlan(runDir) ? { ok: /** @type {true} */ (true) } : writeRunJobCopy(flowDir, runDir, signature.flow); // am9: a run that keeps its own plan already holds its verified copy
  if (!jobCopy.ok) {
    return haltRun({
      flowDir, runDir, runId, capUsd, startedAt, now, nowMs: getNowMs, signatureHash: signature.flow, outcome: 'preflight-red', red: jobCopy.red, spent: { value: 0 },
    });
  }

  // M4d am25: the run keeps the job's "Thinking on" box as it is now (read by `readJobThinking` on every try and every resume)
  writeRunThinking(flowDir, runDir);
  if (runModel) writeRunModel(runDir, runModel); // M4d am33: the one record of the model this run started on
  // M8 item 6: the first run from a freshly signed flow takes the learnings its draft was handed (the Audit box); a run that kept its own plan already has its record; a failure never stops the run
  if (!runOwnsPlan(runDir)) {
    try { takeLearningsRecord(flowDir, runDir); } catch (/** @type {any} */ e) {
      try { appendRow(join(runDir, LEARN_ERROR_FILE), { at: now(), error: redactSecrets(`learnings record: ${e?.message ?? e}`).split('\n')[0] }); } catch { /* best-effort */ }
    }
  }

  const frozen = await freezeInputs(runDir, sources ?? [], { fetchPage, tableRoles: sheetRolesOf(declaration.steps) });
  if (!frozen.ok) {
    return haltRun({
      flowDir, runDir, runId, capUsd, startedAt, now, nowMs: getNowMs, signatureHash: signature.flow, outcome: 'preflight-red', red: frozen.red, spent: { value: 0 },
    });
  }
  // M4c: every guard above has passed — this process records itself (pid row) before its first step.
  recordPid(runDir, 'run', now());

  const artifacts = {};
  const auditRows = [];
  // Item 3: what the model actually wrote, every attempt, red runs included
  // — kept SEPARATELY from auditRows (which stay the signed book's own
  // shape) and folded into log.json only, on every exit path.
  /** @type {any[]} */
  const attemptsLog = [];
  // Orchestrator review fix (4): a floor stays a floor — once ANY row this
  // run carries `spendComplete: false` (a cost that never resolved to a
  // known number, e.g. a retried transport fault that still failed), the
  // run's OWN aggregate never flips back to true, park or no park. Threaded
  // into every book row `foldFromStep`/`runAskSlot` writes and persisted in
  // `state.json` so a resumed run inherits the floor instead of quietly
  // reporting complete.
  const spendComplete = { value: true };
  const recordAudit = (row, modelOutput, unjudgedCount) => {
    // M2 amendment 1 item 2: "audit row for the ask gains unjudgedCount" —
    // only the ask's own rows pass a third argument; every other row is
    // unaffected (the key is simply absent, never a stray 0/null).
    const fullRow = unjudgedCount === undefined ? row : { ...row, unjudgedCount };
    auditRows.push(fullRow);
    appendAudit(runDir, fullRow);
    if (row.spendComplete === false) spendComplete.value = false;
    if (modelOutput !== undefined) {
      attemptsLog.push({
        step: row.step, attempt: row.attempt, class: row.class, verdict: row.verdict, gap: row.gap, ...(row.refused ? { refused: row.refused } : {}), modelOutput,
      });
    }
  };
  const spent = { value: 0 };
  let acceptedThisRun = false;
  // M2 amendment 1 item 2: every hitl-class step NOT bound to a signed ask
  // line is carried as evidence into the NEXT signed ask, in order, then
  // reset — never silently passed through unseen.
  /** @type {Array<{step:string|null, emits:string, artifact:unknown}>} */
  let unjudgedSinceLastAsk = [];

  const steps = declaration.steps;
  // M2 fix: the send's content is identified by IDENTITY (the artifact
  // emitted by a signed ask step), never by position in `reads` — every id
  // in a send step's `reads` names an earlier step, so picking `reads[0]`
  // silently ships whatever was read first instead of what was accepted.
  // Derived the same way the fold below knows a step is an ask — bound to
  // an `arbiter.asks[]` line.
  const askStepEmits = new Set(steps.filter((s) => askLines.has(s.fromLine)).map((s) => s.emits));
  // Tracks which specific ask emits were accepted THIS run (acceptedThisRun
  // above stays run-wide, for the "reached with no accept this run" gate).
  // M4b piece 3: Map emits -> the sha256 the human's accept recorded for that
  // ask's artifact (`null` = none recorded in THIS process; send refuses).
  const acceptedAskEmitsThisRun = new Map();

  const result = await foldFromStep({
    i0: 0,
    steps,
    askLines,
    sendLines,
    askStepEmits,
    runDir,
    flowDir,
    runId,
    flowRoot: root,
    flowName: name,
    signatureHash: signature.flow,
    inputsManifest: frozen.manifest,
    capUsd,
    redoCap,
    effectiveCeilingUsd,
    primitives,
    businessDate,
    modelStep,
    askStep,
    sendStep,
    now,
    startedAt,
    nowMs: getNowMs,
    // F45 finding 3: `runStartedAt` is the run's TRUE wall-clock start — for
    // a fresh `runFlow` call it's this same `startedAt` (there is no earlier
    // process). It is what park persists into state.json and every resume
    // restores, so a run's final `wallMs` times the whole run, not just the
    // last process (a pause counts as elapsed wall time — see the comment
    // at its use in `foldFromStep`).
    runStartedAt: startedAt,
    spent,
    spendComplete,
    artifacts,
    acceptedThisRun,
    acceptedAskEmitsThisRun,
    unjudgedSinceLastAsk,
    recordAudit,
    attemptsLog,
    firstStepGap: initialGap ?? null,
  });
  recordRunNotes({
    flowName: name, runId, runDir, outcome: result.outcome, specHash: signature.flow, now,
  });

  if (result.outcome === 'complete') return { ...result, auditRows };
  return result;
}

// ---------------------------------------------------------------------------
// M3 piece 1 (docs/wiki/the-module-ladder.md, "M3 — scope, exit, negative —
// SIGNED", scope items 1-2, 4-6, 8): park-and-exit at a signed ask, and
// resuming into the SAME fold from a separate process later. ONE fold —
// `foldFromStep` below is the loop `runFlow` always ran (M2), now starting
// at an arbitrary step index with restored accumulators so `resumeRun` can
// re-enter it exactly where a parked run left off, instead of a second
// runner.
//
// borrowed-from: fwdloop poc/m3/park.mjs@afb85d7 (the park/answer/resume
// protocol proved at F44 — ask.json+state.json's fields, the exclusive
// `resume.lock`, consuming `answer.json` by rename BEFORE acting). Rewritten
// against the real `runFlow` fold (the POC ran fake, hand-rolled steps
// against a single hard-coded ask, never `runStepRalph`/`runAskSlot`) — src/
// never imports from poc/.
// ---------------------------------------------------------------------------

/** An ask step that never waits — it immediately tells the fold to park.
 *  The counterpart to `makeFileAskStep`'s in-process poll (M2 scope item 6);
 *  a caller wanting park-and-exit behaviour from a FRESH `runFlow` call
 *  passes this (or an equivalent) as `askStep`.
 *  @returns {(opts?: any) => Promise<{decision: 'park'}>} */
export function makeParkingAskStep() {
  return async function parkingAskStep() {
    return /** @type {{decision: 'park'}} */ ({ decision: 'park' });
  };
}

/** `resumeRun`'s own askStep: yields the human's already-consumed decision
 *  exactly once (for the ask it was built for), then — if that decision was
 *  a redo and the ask loops back around to ask again — parks under a NEW
 *  askId, exactly like a fresh ask would. This is what turns "redo, then
 *  ask again" into "redo, then re-park" for a resumed run, with no second
 *  code path. */
function makeOneShotThenParkAskStep({ decision, reason, artifactSha256 }) {
  let used = false;
  return async function resumeAskStep() {
    if (!used) {
      used = true;
      return { decision, reason, artifactSha256 };
    }
    return { decision: 'park' };
  };
}

/**
 * M4d am30: the highest try number a step has used in this run, read from the books (audit.jsonl, the source of truth). A Redo's re-run is
 * numbered after it, so a number is used once per step. Only the NUMBER moves: the limit counts the re-run's own tries (`n` in `runStepRalph`).
 * @param {string} runDir @param {string|null} stepId
 */
function lastTryNumber(runDir, stepId) {
  let last = 0;
  for (const r of readAudit(runDir)) {
    if (r.step === stepId && Number.isInteger(r.attempt) && r.verdict !== 'cap-halt' && r.verdict !== 'stop-asked' && r.verdict !== 'stop-not-honoured' && r.attempt > last) last = r.attempt;
  }
  return last;
}

/**
 * One signed ask slot's own loop (M2's ask branch, unchanged in spirit,
 * extracted so `resumeRun` can re-enter the SAME logic mid-ask instead of
 * duplicating it). Returns exactly one of:
 *   - `{ type: 'paused', result }` — `askStep` chose to park; ask.json +
 *     state.json are written and `result` is `runFlow`/`resumeRun`'s own
 *     return value.
 *   - `{ type: 'halted', outcome, red }` — the caller wraps this in
 *     `haltRun` (it knows the right `signatureHash`/`artifacts` to attach).
 *   - `{ type: 'accepted', artifact }` — the human accepted; the caller
 *     writes the ask step's own artifact and continues the fold.
 *
 * @param {object} opts
 * @returns {Promise<any>}
 */
async function runAskSlot({
  step, stepIndex, askSlot, priorId, priorStep, priorStepNo, priorPrevStepId = null, priorArtifact, redoCap, effectiveCeilingUsd, capUsd,
  primitives, businessDate, modelStep, askStep, spent, spendComplete, recordAudit,
  evidenceUnjudged, unjudgedCount, redone: initialRedone,
  runDir, flowDir, runId, flowRoot, flowName, signatureHash, inputsManifest, attemptsLog, artifacts, now, startedAt,
  // F45 finding 3: the run's TRUE wall-clock start, persisted into
  // state.json on every park/re-park so a later resume can restore it
  // instead of substituting its own process's start.
  runStartedAt,
}) {
  let redone = initialRedone;
  let currentPrior = priorArtifact;

  for (;;) {
    const evidence = { artifact: currentPrior, unjudged: evidenceUnjudged };
    // eslint-disable-next-line no-await-in-loop
    const rawAnswer = await askStep({
      question: askSlot?.question ?? step.goal, evidence, runDir, ttlMs: askSlot?.ttlMs, stepIndex,
    });
    // M4b amendment 3: a decision from any askStep is translated once, here.
    const answer = { ...rawAnswer, decision: normalizeDecision(rawAnswer.decision) };

    if (answer.decision === 'park' && stopPending(runDir)) {
      // M4e amendment 13: a Stop pending as the turn leads to an ask stops AT the ask — nothing is written for it, no wait begins.
      return {
        type: 'halted',
        outcome: 'stopped',
        red: `stopped by you at the ask of step ${stepIndex + 1} ("${step.goal}")`,
        stop: { where: `stopped at the ask of step ${stepIndex + 1}`, step: step.emits ?? step.goal ?? null },
        redone,
      };
    }

    if (answer.decision === 'park') {
      // M3 scope item 1 (fixes F43): the wait is ALWAYS the signed ttlMs —
      // no code default ever overrides it, on the first park or any re-park.
      const askId = randomUUID();
      const askedAt = now();
      const expiresAt = new Date(Date.parse(askedAt) + askSlot.ttlMs).toISOString();
      // F45 finding 2: a parked ask.json must carry the SAME evidence a
      // human sees in-process (`makeFileAskStep`'s `{ artifact, unjudged }`)
      // — the draft under review and the unjudged evidence, never just the
      // question. `evidence` above is already recomputed at the top of every
      // loop iteration (including a re-park after a redo, where
      // `currentPrior` is the just-redrafted artifact), so this write always
      // carries the CURRENT evidence, not a stale first-park copy.
      writeFileSync(join(runDir, 'ask.json'), JSON.stringify({
        askId, question: askSlot?.question ?? step.goal, askedAt, expiresAt, evidence,
      }, null, 2));
      // Amendment M4a-1 — SIGNED by hamr 2026-09-27 ("sign m4a1"): a
      // PERMANENT copy of this same park, `asks/<askId>.json`, written right
      // after `ask.json` (never before) — `ask.json`/`state.json` below are
      // what governs resume, unchanged; the archive is a second, append-only
      // record of the SAME content. Crash between the two writes leaves
      // `ask.json` present and no archive entry for this one askId — the run
      // is still correctly parked and resumable; `listArchivedAsks` only
      // ever reports what's actually on disk, never invents an entry. A
      // fresh `askId` per park means a red here (an already-archived askId)
      // is a genuine invariant violation, not a race to recover from — it
      // halts the run rather than silently dropping the archive duty.
      const archived = writeAskArchive({
        runDir, askId, question: askSlot?.question ?? step.goal, askedAt, expiresAt, evidence, emits: step.emits,
      });
      if (!archived.ok) {
        throw new Error(archived.red);
      }
      // M3 scope item 2: the minimum the fold needs to resume identically —
      // WHERE (stepIndex), WHAT was frozen/signed (signatureHash,
      // inputsManifest, to be re-verified before anything runs), WHAT this
      // ask is (askId/expiresAt), and the two accumulators a mid-ask resume
      // cannot recompute from disk alone: `redone` (the redo cap is spent
      // across pauses, not per process) and the evidence bundle this
      // specific ask already showed the human (`evidenceUnjudged`/
      // `unjudgedCount` — recomputing them from `unjudgedSinceLastAsk` on
      // resume would double-count anything a later, still-unparked ask
      // hasn't reset yet). `spent` carries the run's money across pauses too
      // (the cap binds over the whole run, never per process).
      const state = {
        runId,
        flow: { root: flowRoot, name: flowName },
        signatureHash,
        inputsManifest,
        stepIndex,
        askId,
        expiresAt,
        spent: spent.value,
        // Orchestrator review fix (4): the floor persists across a pause —
        // once any pre-park row left `spendComplete: false`, a resume must
        // inherit that, never quietly start "complete" again.
        spendComplete: spendComplete.value,
        redone,
        evidenceUnjudged,
        unjudgedCount,
        // F45 finding 3: persisted every park/re-park (unchanged value, just
        // carried forward) so `resumeRun` restores the run's true start
        // instead of timing only the process that happens to resume it.
        startedAt: runStartedAt,
      };
      writeFileSync(join(runDir, 'state.json'), JSON.stringify(state, null, 2));
      recordAudit(makeAuditRow({
        step, attempt: redone + 1, verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, strike: false, at: now(),
      }), undefined, unjudgedCount);
      // Orchestrator review fix (3): M2 item 9 says history is ONE row per
      // run; M3's signed scope item 2 only asks for an AUDIT row "paused"
      // (already recorded above). A "paused" HISTORY row was the earlier
      // draft's own error — removed here. The run's one history row lands
      // at its final outcome (complete / a halt / ask-expired), written by
      // `foldFromStep`/`resumeRun`, never here.
      writeLog(runDir, { runId, outcome: 'paused', attempts: attemptsLog, artifacts });
      // M4e amendment 13: a park is not an end. A Stop that landed while the ask was being written stops the run at the ask
      // (the ask is set aside; one winner against the Stop door, by rename).
      if (stopPending(runDir)) {
        const stopped = stopAtAsk({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, signatureHash, spent, spendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
          stepIndex, stepEmits: step.emits ?? step.goal ?? null, flowRoot, flowName, inputsManifest, unjudged: evidenceUnjudged, redone, parkedAskId: askId,
        });
        if (stopped && stopped.outcome !== 'stop-failed') return { type: 'stopped', result: stopped };
      }
      return {
        type: 'paused',
        result: {
          outcome: 'paused', runDir, askId, expiresAt, spentUsd: spent.value,
        },
      };
    }

    if (answer.decision === 'timeout') {
      // A pause spends nothing (M2 scope item 6) — a halt, never a red
      // with a fabricated cost, and never re-asked (the run is over).
      recordAudit(makeAuditRow({
        step, attempt: redone + 1, verdict: 'ask-timeout', gap: null, usd: 0, spendComplete: true, wallMs: 0, strike: false, at: now(),
      }), undefined, unjudgedCount);
      return {
        type: 'halted',
        outcome: 'ask-timeout',
        red: `ask-timeout: step "${step.goal}" expired waiting for a human answer`,
      };
    }

    const isRedo = answer.decision === 'redo' || answer.decision === 'rerun';
    const reason = typeof answer.reason === 'string' ? answer.reason.trim() : '';

    if (isRedo && reason.length === 0) {
      recordAudit(makeAuditRow({
        step, attempt: redone + 1, verdict: 'refused', gap: 'a redo/rerun needs a reason', usd: 0, spendComplete: true, wallMs: 0, strike: false, at: now(),
      }), undefined, unjudgedCount);
      // Refused, re-asked for the SAME attempt — never re-runs the step.
      // eslint-disable-next-line no-continue
      continue;
    }

    if (answer.decision === 'accept') {
      recordAudit(makeAuditRow({
        step, attempt: redone + 1, verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 0, strike: false, at: now(),
      }), undefined, unjudgedCount);
      return {
        type: 'accepted',
        artifact: currentPrior,
        acceptedSha256: typeof answer.artifactSha256 === 'string' ? answer.artifactSha256 : null,
      };
    }

    if (isRedo) {
      redone += 1;
      recordAudit(makeAuditRow({
        step, attempt: redone, verdict: 'red', gap: reason, usd: 0, spendComplete: true, wallMs: 0, strike: false, at: now(),
      }), undefined, unjudgedCount);
      if (redone > redoCap) {
        return {
          type: 'halted',
          outcome: 'redo-halt',
          red: `redo cap ${redoCap} reached at step "${step.goal}" after ${redone} redos`,
        };
      }
      // F48 round 4: every id in `priorStep.reads` names a STILL EARLIER step
      // that already ran and wrote its artifact — a `red` here (symlink
      // swap / unparseable JSON) is tampering, never "not written yet", and
      // must halt the redo rather than silently feed forged/garbage content
      // into the model step that is about to re-run.
      const priorReadsResult = readArtifactsMapChecked(runDir, priorStep.reads, { docxRoles: citedRolesOf(priorStep) });
      if (!priorReadsResult.ok) {
        return { type: 'halted', outcome: 'red', red: `redo: step "${priorStep.goal}" ${priorReadsResult.red}` };
      }
      // eslint-disable-next-line no-await-in-loop
      const redoResult = await runStepRalph({
        step: priorStep, primitivesMap: primitives, readsMap: priorReadsResult.map, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit, initialGap: reason, attemptOffset: lastTryNumber(runDir, priorStep.emits ?? priorStep.goal ?? null), thinkingBox: readJobThinking(flowDir, runDir), learnHints: stepHintsReader({ flowName, source: inputsManifest?.[0]?.source ?? null, now }), now, runDir,
        readStop: () => stopPending(runDir), stepNo: priorStepNo, prevStepId: priorPrevStepId,
      });
      if (!redoResult.ok) {
        return {
          type: 'halted', outcome: redoResult.outcome, red: redoResult.red, ...(redoResult.stop ? { stop: redoResult.stop } : {}),
        };
      }
      currentPrior = redoResult.artifact;
      // A redo deliberately REPLACES the prior step's own artifact — the one
      // case `writeArtifact` allows to overwrite on purpose.
      writeArtifact(runDir, priorId, currentPrior, { overwrite: true });
      artifacts[priorId] = currentPrior;
      // eslint-disable-next-line no-continue
      continue;
    }

    return {
      type: 'halted',
      outcome: 'red',
      red: `ask: step "${step.goal}" got an unrecognised decision "${answer.decision}"`,
    };
  }
}

/**
 * The fold itself (M2 scope item 1's "one fold", now start-anywhere): walks
 * `steps` from `i0`, handling the signed send slot, the signed ask slot (via
 * `runAskSlot`), and ordinary steps exactly as `runFlow` always did. Used by
 * `runFlow` (i0 = 0, fresh accumulators) and by `resumeRun` (i0 = the step
 * AFTER the ask it just resolved, accumulators restored from `state.json`
 * plus disk).
 * @returns {Promise<any>}
 */
async function foldFromStep({
  i0, steps, askLines, sendLines, askStepEmits, runDir, flowDir, runId, flowRoot, flowName, signatureHash,
  inputsManifest, capUsd, redoCap, effectiveCeilingUsd, primitives, businessDate, modelStep, askStep, sendStep,
  // F45 finding 3: `startedAt` times only THIS process (used for the pre-fold
  // halts in `runFlow` and as this call's own fallback below); `runStartedAt`
  // is the run's true wall-clock start, persisted at park and restored on
  // every resume — every halt/complete a fold reaches must time itself
  // against `runStartedAt`, never the current process's own start, or a
  // resumed run's wallMs collapses to "how long did this resume take" (F45's
  // observed 19ms). Defaults to `startedAt` for a fresh run, where they are
  // the same instant.
  now, startedAt, runStartedAt = startedAt, nowMs = Date.now, spent, spendComplete, artifacts, acceptedThisRun, acceptedAskEmitsThisRun, unjudgedSinceLastAsk,
  recordAudit, attemptsLog,
  // M3 scope item 7: a fresh rerun's own reason, carried as step `i0`'s
  // starting gap (never any later step's). `/** @type */` here (rather than
  // a JSDoc `@param opts.firstStepGap`, which would need a preceding typed
  // `@param {object} opts` this function's block comment never declared)
  // is what keeps every OTHER destructured field's inferred type intact.
  firstStepGap = /** @type {string|null} */ (null),
  // Amendment 7 item 8: a run Resumed after a Stop that cut step `i0` mid-way re-enters it as a NEW try — `numbered` tries already
  // wear numbers (the new one is numbered after them), `done` of them closed and count against the step's limit.
  resumeTries = { numbered: 0, done: 0 },
  // Amendment 13: the redo count a stop-at-ask carried in its halt record, restored for the ask step it re-enters (`i0`).
  resumeRedone = 0,
}) {
  let runAcceptedThisRun = acceptedThisRun;
  let runUnjudged = unjudgedSinceLastAsk;

  for (let i = i0; i < steps.length; i += 1) {
    const step = steps[i];

    // M4e amendment 4 item 4: the Stop seam. Step i-1 has closed (artifact written, rows booked); a pending request ends the run here.
    // Amendment 7 item 8 adds the same seam before every model call (turns and tries, inside `runStepRalph`/`modelStep`).
    if (stopPending(runDir)) {
      // Amendment 13: when the turn that just closed leads to an ask, the run stops AT the ask, in the ask's words.
      if (askLines.has(step.fromLine)) {
        return stopAtAsk({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, spendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
          stepIndex: i, stepEmits: step.emits ?? step.goal ?? null, flowRoot, flowName, inputsManifest, unjudged: runUnjudged, redone: i === i0 ? resumeRedone : 0,
        });
      }
      return haltRun({
        flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
        outcome: 'stopped', red: `stopped by you before step ${i + 1} ("${step.goal}")`,
        stop: { where: i === 0 ? 'stopped before step 1' : `stopped after step ${i}`, step: i === 0 ? null : (steps[i - 1].emits ?? steps[i - 1].goal ?? null) },
        resumeAt: { stepIndex: i, flowRoot, flowName, inputsManifest, unjudged: runUnjudged },
      });
    }

    // --- the signed send slot: never through modelStep, only after an
    // accept THIS run, re-checked at write time. ---
    if (sendLines.has(step.fromLine)) {
      if (!runAcceptedThisRun) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
          outcome: 'red', red: `send: step "${step.goal}" reached with no accept this run`,
        });
      }
      const sendSlot = sendLines.get(step.fromLine);
      if (!sendSlot) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts, outcome: 'red', red: `send: no arbiter slot bound to line ${step.fromLine}`,
        });
      }
      const target = `${sendSlot.target.kind}:${sendSlot.target.path}`;
      // The send's content is identified by IDENTITY (the artifact emitted
      // by the ONE earlier signed ask step this send reads) — never by
      // position in `reads`. `readFlow`/`validateDeclaration` already
      // refuse, at signing time, any declaration whose send step doesn't
      // read the emits of exactly one earlier signed ask (M3 item 8); every
      // path into this fold goes through `readFlow` first, so `askIdsInReads`
      // is always exactly 1 here.
      const [askArtifactId] = (step.reads ?? []).filter((id) => askStepEmits.has(id));
      if (!acceptedAskEmitsThisRun.has(askArtifactId)) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
          outcome: 'red', red: `send: step "${step.goal}" reads ask artifact "${askArtifactId}" that was not accepted this run`,
        });
      }
      // F48 round 4 (redesign): ONLY an `ok:true` read ships — a missing OR
      // refused (symlink swap / outside the run dir / unparseable JSON)
      // accepted artifact halts the run BY NAME, before `sendStep` is ever
      // called, so nothing reaches the signed destination. This is the exact
      // gap the round 3 fix left open: `readArtifact` returning `undefined`
      // for both shapes let a swapped/deleted artifact reach `sendStep` as
      // `undefined`, get `?? null`-ed by src/send.js, and ship as a
      // recorded-green `null` — a silent "success" for content that was
      // never verified.
      const contentResult = readArtifactResult(runDir, askArtifactId);
      if (!contentResult.ok) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
          outcome: 'red',
          red: contentResult.missing
            ? `send: accepted artifact "${askArtifactId}" is missing for step "${step.goal}" — refusing to send`
            : `send: accepted artifact "${askArtifactId}" for step "${step.goal}" — ${contentResult.red}`,
        });
      }
      const content = contentResult.value;
      const filename = `${flowName}-${runId}-${step.emits}.json`;
      // eslint-disable-next-line no-await-in-loop
      const sendResult = await sendStep(target, filename, content, acceptedAskEmitsThisRun.get(askArtifactId), { root: flowRoot, runDir });
      const sendRow = makeAuditRow({
        step, attempt: 1, verdict: sendResult.ok ? 'green' : 'red', gap: sendResult.ok ? null : sendResult.red, usd: 0, spendComplete: true, wallMs: 0, strike: false, at: now(),
      });
      recordAudit(sendRow);
      if (!sendResult.ok) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts, outcome: 'red', red: `send: ${sendResult.red}`,
        });
      }
      writeArtifact(runDir, step.emits, content);
      artifacts[step.emits] = content;
      // eslint-disable-next-line no-continue
      continue;
    }

    // --- the signed ask slot: interactive, consume-once, reason-gated redo,
    // OR park-and-exit (M3 scope item 2). ---
    if (askLines.has(step.fromLine)) {
      const askSlot = askLines.get(step.fromLine);
      const priorId = (step.reads ?? [])[0];
      const priorStepIndex = steps.findIndex((s) => s.emits === priorId);
      // F48 round 4: `priorId` names a STILL EARLIER step in this same fold
      // pass, already run and already written to disk — a `red` here is
      // tampering (or an outside symlink), never "not written yet", and
      // must halt before the human is ever shown evidence built from it.
      const priorArtifactResult = readArtifactResult(runDir, priorId);
      if (!priorArtifactResult.ok) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
          outcome: 'red',
          red: priorArtifactResult.missing
            ? `ask: prior artifact "${priorId}" is missing for step "${step.goal}" — refusing`
            : `ask: prior artifact "${priorId}" for step "${step.goal}" — ${priorArtifactResult.red}`,
        });
      }
      const priorArtifact = priorArtifactResult.value;

      // M2 amendment 1 item 2: every hitl artifact carried since the
      // previous ask goes to THIS ask as evidence, alongside the ask step's
      // own artifact — then the list resets (a fresh accumulator for the
      // NEXT ask), so a later ask never re-shows what an earlier one covered.
      const evidenceUnjudged = runUnjudged;
      const unjudgedCount = evidenceUnjudged.length;
      runUnjudged = [];

      // eslint-disable-next-line no-await-in-loop
      const askResult = await runAskSlot({
        step,
        stepIndex: i,
        askSlot,
        priorId,
        priorStep: steps[priorStepIndex],
        priorStepNo: priorStepIndex + 1,
        priorPrevStepId: priorStepIndex > 0 ? (steps[priorStepIndex - 1].emits ?? null) : null,
        priorArtifact,
        redoCap,
        effectiveCeilingUsd,
        capUsd,
        primitives,
        businessDate,
        modelStep,
        askStep,
        spent,
        spendComplete,
        recordAudit,
        evidenceUnjudged,
        unjudgedCount,
        redone: i === i0 ? resumeRedone : 0,
        runDir,
        flowDir,
        runId,
        flowRoot,
        flowName,
        signatureHash,
        inputsManifest,
        attemptsLog,
        artifacts,
        now,
        startedAt,
        runStartedAt,
      });

      if (askResult.type === 'paused' || askResult.type === 'stopped') return askResult.result;
      if (askResult.type === 'halted') {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value && askResult.stop?.book?.spendComplete !== false, attempts: attemptsLog, artifacts, outcome: askResult.outcome, red: askResult.red,
          ...(askResult.stop ? { stop: askResult.stop } : {}),
          resumeAt: {
            stepIndex: i, flowRoot, flowName, inputsManifest, unjudged: evidenceUnjudged, redone: askResult.redone,
          },
        });
      }

      writeArtifact(runDir, step.emits, askResult.artifact);
      artifacts[step.emits] = askResult.artifact;
      runAcceptedThisRun = true;
      acceptedAskEmitsThisRun.set(step.emits, askResult.acceptedSha256 ?? null);
      // eslint-disable-next-line no-continue
      continue;
    }

    // --- an ordinary step: green / softgreen / a non-ask hitl pass-through. ---
    // F48 round 4: every id in `step.reads` names an earlier step in THIS
    // same fold pass, already run and already written — a `red` read here
    // halts rather than silently feeding tampered/unreadable content in.
    const readsMapResult = readArtifactsMapChecked(runDir, step.reads, { docxRoles: citedRolesOf(step) });
    if (!readsMapResult.ok) {
      return haltRun({
        flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts,
        outcome: 'red', red: `step "${step.goal}" ${readsMapResult.red}`,
      });
    }
    const readsMap = readsMapResult.map;
    // M3 scope item 7: a fresh rerun's own first step (and only that one —
    // `i === i0` is this fold's own starting point, never any later step)
    // starts with the human's rerun reason as its gap, exactly like a
    // redo's `initialGap` above.
    // eslint-disable-next-line no-await-in-loop
    const stepResult = await runStepRalph({
      step, primitivesMap: primitives, readsMap, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit, initialGap: i === i0 ? firstStepGap : null, thinkingBox: readJobThinking(flowDir, runDir), learnHints: stepHintsReader({ flowName, source: inputsManifest?.[0]?.source ?? null, now }), now, runDir,
      readStop: () => stopPending(runDir), stepNo: i + 1, prevStepId: i > 0 ? (steps[i - 1].emits ?? steps[i - 1].goal ?? null) : null, attemptOffset: i === i0 ? resumeTries.numbered : 0, triesDone: i === i0 ? resumeTries.done : 0,
    });
    if (!stepResult.ok) {
      return haltRun({
        flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value && stepResult.stop?.book?.spendComplete !== false, attempts: attemptsLog, artifacts, outcome: stepResult.outcome, red: stepResult.red,
        ...(stepResult.stop ? { stop: stepResult.stop } : {}),
        resumeAt: { stepIndex: i, flowRoot, flowName, inputsManifest, unjudged: runUnjudged },
      });
    }
    writeArtifact(runDir, step.emits, stepResult.artifact);
    artifacts[step.emits] = stepResult.artifact;
    // M2 amendment 1 item 2: a hitl-class step not bound to a signed ask
    // line (the routing above already guarantees that — this branch is only
    // reached when neither askLines nor sendLines claimed the step) passes
    // through silently here; carry it as evidence for the NEXT signed ask.
    if (stepResult.hitl) {
      runUnjudged.push({ step: step.goal ?? null, emits: step.emits, artifact: stepResult.artifact });
    }
  }

  // F45 finding 3: the run's history row times the whole run, from its
  // FIRST process's start (`runStartedAt`, never this process's own
  // `startedAt`) to right now. A pause counts as elapsed wall time — the
  // run really was sitting there waiting on a human, so it belongs in
  // "how long did this run take", not carved out of it.
  const wallMs = nowMs() - runStartedAt;
  try {
    recordLateAnswerIfAny(runDir, now);
    writeLog(runDir, {
      runId, outcome: 'complete', attempts: attemptsLog, artifacts,
    });
    settleStop({ runDir, now, outcome: 'complete' });
  } finally {
    // Amendment 16 C6/C7: the history end row is written last, and always.
    appendHistory(flowDir, {
      runId, at: now(), outcome: 'complete', spentUsd: spent.value, spendComplete: spendComplete.value, capUsd, wallMs, signatureHash,
    });
  }
  return {
    outcome: 'complete', runDir, artifacts, spentUsd: spent.value,
  };
}

/**
 * Debrief fix: sums a run's own `audit.jsonl` — the books are the source of
 * truth for money already spent, so `state.spent` (a value carried in a
 * separately-writable state.json) is cross-checked against it before a
 * resume trusts it under the cap. Every row's `usd` here is expected to be
 * a finite number (the audit rows a park can precede — attempts, the pause
 * itself — never carry `usd: null`; only a `cap-halt` row does, and a
 * cap-halt ends the run without parking, so it can never appear in a
 * resumable run's audit.jsonl). A row this function cannot price refuses
 * rather than guessing (never `?? 0`, never skipped).
 * @param {string} runDir
 * @param {{skipVerdicts?: string[]}} [opts]
 * @returns {{ ok: true, total: number, complete: boolean } | { ok: false, red: string }}
 */
function sumAuditUsd(runDir, { skipVerdicts = /** @type {string[]} */ ([]) } = {}) {
  // F48 round 3: goes through `readFileInside` (`src/flow.js`) rather than a
  // raw `readFileSync` — a symlinked `audit.jsonl` (or a symlinked ancestor
  // directory) reads as "missing" (total 0), never as some outside file's
  // content summed into a cap check.
  const result = readFileInside(runDir, 'audit.jsonl');
  if (!result.ok) return { ok: true, total: 0, complete: true };
  const lines = result.text.split('\n').filter((line) => line.trim().length > 0);
  let total = 0;
  let complete = true;
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch (err) {
      return { ok: false, red: `audit.jsonl line is not valid JSON — ${err.message}` };
    }
    // a row of a verdict the caller names cost nothing and carries `usd: null` on purpose (a cap-halt: the round was never bought)
    if (skipVerdicts.includes(row.verdict)) continue;
    if (row.spendComplete === false) complete = false;
    if (typeof row.usd !== 'number' || !Number.isFinite(row.usd)) {
      return { ok: false, red: `audit.jsonl carries a row whose "usd" is not a finite number (got ${JSON.stringify(row.usd)}) — refusing to sum past an unpriced round` };
    }
    total += row.usd;
  }
  return { ok: true, total, complete };
}

/** Unlink `resume.lock` only when its recorded holder is still THIS process (`readResumeLock`'s holder pid + start
 *  time against our own). A lock a later taker made in its place is never touched. */
function releaseResumeLock(runDir, lockPath) {
  const lock = readResumeLock(runDir);
  if (lock.pid === process.pid && lock.procStart === procStartOf('self')) {
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

/**
 * M4c amendment 2 (d): create `resume.lock` with `wx` and write the holder into it.
 * An existing lock is read: holder alive (or cannot be told) -> refuse by name
 * ("locked by another resumer", the panel's one retried refusal); no readable
 * holder -> refuse by name with the lock path; holder gone -> unlink and retake
 * with `wx` once (a racing second taker loses cleanly on EEXIST).
 * @returns {Promise<{ok:true, lockFd:number}|{ok:false, red:string}>}
 */
async function takeResumeLock(runDir, runId, lockPath) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const lockFd = openSync(lockPath, 'wx');
      try { writeLockHolder(lockFd); } catch (err) {
        // This call's own `wx` just created the file and no holder is in it yet, so it is ours to remove
        // (`releaseResumeLock` would skip it: it unlinks only a lock whose holder names this process).
        try { unlinkSync(lockPath); } catch { /* already gone */ }
        try { closeSync(lockFd); } catch { /* ignore */ }
        return { ok: false, red: `resume: could not record the lock holder in ${lockPath} — ${err.message}` };
      }
      return { ok: true, lockFd };
    } catch (err) {
      if (err.code !== 'EEXIST') return { ok: false, red: `resume: could not create lock ${lockPath} — ${err.message}` };
    }
    let lock = readResumeLock(runDir);
    if (lock.state === 'empty') {
      // A taker between its `wx` create and its holder write looks empty for an instant.
      // eslint-disable-next-line no-await-in-loop
      await new Promise((r) => { setTimeout(r, 150); });
      lock = readResumeLock(runDir);
    }
    if (lock.state === 'live' || lock.state === 'unknown') {
      return { ok: false, red: `resume: run "${runId}" is locked by another resumer (pid ${lock.pid}, ${lockPath})` };
    }
    if (lock.state === 'empty') {
      return { ok: false, red: `resume: run "${runId}" has a resume lock ${LOCK_NO_HOLDER} (${lockPath}) — it predates the holder record, so it cannot be told apart from a live resume; remove that file by hand if no resume is running` };
    }
    if (lock.state === 'dead') {
      // Re-read right before the unlink: a racing taker may have cleared this lock and retaken it
      // already, and must not lose its fresh lock. Same holder (pid and start time) as judged dead.
      // The window left is one syscall wide, and the answer's rename-to-consume (F44) still lets only
      // one resume act on the answer.
      const again = readResumeLock(runDir);
      if (again.state === 'dead' && again.pid === lock.pid && again.procStart === lock.procStart) {
        try { unlinkSync(lockPath); } catch { /* another taker already cleared it: retry wx */ }
      }
    }
  }
  return { ok: false, red: `resume: run "${runId}" is locked by another resumer (${lockPath})` };
}

/** Two roots are the same flow location when their real paths agree: a run parked through a symlinked `--root`
 *  recorded the typed link path, and a resume (or a CLI that realpaths its root) names the real one. A path that
 *  cannot be resolved is compared as typed. */
function sameRoot(recorded, requested) {
  if (typeof recorded !== 'string' || typeof requested !== 'string') return false;
  const real = (p) => { try { return realpathSync(p); } catch { return p; } };
  return recorded === requested || real(recorded) === real(requested);
}

/**
 * M3 scope items 4-6: re-enter a parked run's SAME fold from a separate
 * process. Takes an exclusive `resume.lock` that records its holder's
 * `{pid, procStart}` (M4c amendment 2: refuses by name if the holder is alive
 * or the lock has no readable holder; a lock whose holder is gone is cleared
 * and retaken, losing cleanly on a race), re-reads the flow, refuses by name at $0 on any signature/input/
 * missing-artifact mismatch, consumes `answer.json` by atomic rename BEFORE
 * acting (F44), then either cancels an expired ask ($0, nothing sent) or
 * resolves it and folds on to `complete`/the next pause/a halt.
 *
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.name
 * @param {string} opts.runId
 * @param {unknown} opts.catalogue
 * @param {(executorContext:object, grantedTools:Record<string,any>, stepMeta?:{class:string|null}) => Promise<any>} opts.modelStep
 * @param {(target:string, filename:string, content:unknown) => Promise<{ok:boolean, red?:string, bytes?:number}>} opts.sendStep
 * @param {Record<string, any>} [opts.primitives]
 * @param {string[]} [opts.primitiveReds] - see `runFlow`'s own.
 * @param {() => string} [opts.clock]
 * @param {string} opts.businessDate
 * @param {number} [opts.ceilingUsd]
 * @param {{slot: string, model: string}} [opts.runModel] - M4d am33: the model this run started on; recorded once in the run folder (run-model.json) and kept by every resume/continue.
 * @param {() => number} [opts.nowMs] - F45 finding 3; see `runFlow`'s own.
 * @param {(newRunDir:string) => void} [opts.onRerunStart] - amendment 16 C2: called with the new run's folder just before a `rerun` starts it.
 */
export async function resumeRun({
  root, name, runId, catalogue, modelStep, sendStep, primitives, primitiveReds, clock, businessDate, ceilingUsd,
  runModel, // M4d am33: the model the resumed run keeps; a rerun (a new run) records it too
  // F45 finding 3 (see `runFlow`'s own `nowMs`): additive, defaults to the
  // real `Date.now` for every existing caller.
  nowMs,
  // Amendment 16 C2: called with the new run's folder just before a `rerun` starts it, so the caller can name it in the money records.
  onRerunStart,
}) {
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();
  const getNowMs = typeof nowMs === 'function' ? nowMs : Date.now;
  const flowDir = join(root, name);
  const startedAt = getNowMs();

  // Defense in depth alongside `bin/fwdloop`'s own `resolveRunDir` check on
  // the resume verb's runId positional — refused by name, at $0, before the
  // resume lock file (or anything else) is even looked at.
  const runIdCheck = resolveRunDir(flowDir, runId);
  if (!runIdCheck.ok) {
    return { outcome: 'refused', red: runIdCheck.red };
  }
  const runDir = runIdCheck.runDir;

  // F46: same refusal `runFlow` carries, moved here so a resume can't spend
  // against a step whose granted verb has no wired implementation either —
  // checked before the resume lock (or anything else under `runDir`) is
  // touched. A separate, lightweight `readFlow` from the definitive one
  // below (inside the lock): if this pre-read itself fails, that failure is
  // reported properly by the definitive read further down, under the lock,
  // exactly as before this check existed.
  const preflightRead = readRunPlan({ root, name, catalogue, runDir });
  if (preflightRead.ok) {
    const unwiredVerb = findUnwiredVerbStep(preflightRead.declaration);
    if (unwiredVerb) {
      return {
        outcome: 'refused',
        red: unwiredRed(unwiredVerb),
      };
    }
    const unbuildable = findUnbuildableCheckStep(preflightRead.declaration);
    if (unbuildable) return { outcome: 'refused', red: unbuildableRed(unbuildable), detail: unbuildable.why };
  }

  if (primitiveReds?.length) return { outcome: 'refused', red: primitiveReds[0] };

  const lockPath = join(runDir, 'resume.lock');

  const took = await takeResumeLock(runDir, runId, lockPath);
  if (!took.ok) return { outcome: 'refused', red: took.red };
  const { lockFd } = took;

  try {
    const statePath = join(runDir, 'state.json');
    // F48 round 3 follow-up: goes through `readFileInside` (`src/flow.js`)
    // rather than a raw `readFileSync` — a symlinked state.json (or a
    // symlinked run dir ancestor) is refused by name here, never read
    // through to an outside file's content (the same class `answer.json`
    // and `audit.jsonl` above already close).
    const stateResult = readFileInside(runDir, 'state.json');
    if (!stateResult.ok) {
      if (stateResult.missing) {
        return { outcome: 'refused', red: `resume: no parked state for run "${runId}" (${statePath})` };
      }
      return { outcome: 'refused', red: `resume: state.json for run "${runId}" — ${stateResult.red}` };
    }
    let state;
    try {
      state = JSON.parse(stateResult.text);
    } catch (err) {
      return { outcome: 'refused', red: `resume: state.json for run "${runId}" is not valid JSON — ${err.message}` };
    }

    // F45 finding 3: the run's TRUE wall-clock start, restored from the
    // parked state rather than this process's own `startedAt` — otherwise
    // every resume's history/audit `wallMs` times just that resume (F45's
    // observed 19ms), not the run. Falls back to this process's own start
    // for a run parked BEFORE this fix (no `state.startedAt` on disk) —
    // not a money field, so a best-known fallback rather than a refusal.
    const runStartedAt = typeof state.startedAt === 'number' ? state.startedAt : startedAt;

    // Orchestrator review fix (6): the CALLER's `root`/`name` are the source
    // of truth — never `state.flow.root`/`state.flow.name` silently. A
    // parked run whose recorded flow location disagrees with what THIS call
    // was asked to resume is refused by name, never re-read from wherever
    // the state file happens to point.
    if (!sameRoot(state.flow?.root, root) || state.flow?.name !== name) {
      return {
        outcome: 'refused',
        red: `resume: run "${runId}" was parked against flow "${state.flow?.root}/${state.flow?.name}", `
          + `not the requested "${root}/${name}" — refusing rather than reading a different flow than asked`,
      };
    }

    const read = readRunPlan({ root, name, catalogue, runDir });
    if (!read.ok) {
      return { outcome: 'refused', red: `resume: flow re-read failed for run "${runId}": ${read.reds.join('; ')}` };
    }
    const { declaration, signature } = read;
    // M4e amendment 5 item 3 / amendment 4 item 6: the run's own signed values (its highest version) lie over the flow's.
    const applied = applyRunValues(read.arbiter, name, signature.flow, pickRunValues(runDir));
    if (!applied.ok) return { outcome: 'refused', red: `resume: run "${runId}" — ${applied.red}` };
    const { arbiter } = applied;

    if (signature.flow !== state.signatureHash) {
      return { outcome: 'refused', red: `resume: signature mismatch for run "${runId}" — its saved copy of the job is not the job it was parked under` };
    }

    for (const entry of state.inputsManifest ?? []) {
      if (!existsSync(entry.frozen)) {
        return { outcome: 'refused', red: `resume: frozen input "${entry.id}" missing for run "${runId}" (${entry.frozen})` };
      }
      const sha256 = createHash('sha256').update(readFileSync(entry.frozen)).digest('hex');
      if (sha256 !== entry.sha256) {
        return { outcome: 'refused', red: `resume: frozen input "${entry.id}" changed while parked for run "${runId}"` };
      }
    }

    // F48 round 4 (redesign): the "was this step already done" gate — the
    // one place a resume decides whether an earlier step's artifact is
    // trustworthy BEFORE the answer is consumed or anything downstream reads
    // it again (site 6/7/8 below all read the SAME ids, for i < stepIndex,
    // and rely on this gate having already refused any red for them). A
    // `red` (symlink swap / unparseable JSON) is refused BY NAME, exactly
    // like `missing` — never silently treated as "not done yet" and redone,
    // which could spend money or re-ask a human for a step that already
    // completed.
    const { steps } = declaration;
    for (let i = 0; i < state.stepIndex; i += 1) {
      const artifactResult = readArtifactResult(runDir, steps[i].emits);
      if (!artifactResult.ok) {
        return {
          outcome: 'refused',
          red: artifactResult.missing
            ? `resume: artifact "${steps[i].emits}" missing for run "${runId}" — cannot resume`
            : `resume: artifact "${steps[i].emits}" for run "${runId}" — ${artifactResult.red} — `
              + 'refusing rather than treating a refused read as "not done" and re-running it',
        };
      }
    }

    // Orchestrator review fix (1): unknown cost is never rendered as 0 — a
    // missing/non-number/non-finite `state.spent` refuses the resume by
    // name (naming the run AND the field), $0 further spend, rather than
    // silently treating an unreadable ledger as "nothing spent yet". Checked
    // BEFORE the answer is consumed — a refusal here must be replayable.
    if (typeof state.spent !== 'number' || !Number.isFinite(state.spent)) {
      return {
        outcome: 'refused',
        red: `resume: run "${runId}" state.json field "spent" is not a finite number (got ${JSON.stringify(state.spent)}) — `
          + 'unknown cost is never rendered as 0; refusing further spend',
      };
    }
    // Debrief fix: a negative spend is an impossible cost, never a number
    // the cap can trust — refused the same way as a non-finite one.
    if (state.spent < 0) {
      return {
        outcome: 'refused',
        red: `resume: run "${runId}" state.json field "spent" is negative (${state.spent}) — `
          + 'an impossible cost is never trusted by the cap; refusing further spend',
      };
    }
    // Debrief fix: the run's own audit.jsonl is the books' source of truth
    // for money already spent — if state.spent claims LESS than what the
    // audit already recorded, state.spent is wrong (or tampered) and must
    // never be trusted to gate further spend under the cap.
    const auditSum = sumAuditUsd(runDir);
    if (!auditSum.ok) {
      return { outcome: 'refused', red: `resume: run "${runId}" ${auditSum.red}` };
    }
    if (auditSum.total - state.spent > SPEND_TOLERANCE_USD) {
      return {
        outcome: 'refused',
        red: `resume: run "${runId}" state.json field "spent" ($${state.spent}) is less than its own audit.jsonl sum ($${auditSum.total}) — `
          + "the books are the source of truth for money already spent; refusing rather than trusting state.json's lower figure",
      };
    }
    const spent = { value: state.spent };
    // Orchestrator review fix (4): a floor persisted across the pause
    // (`state.spendComplete`) is restored here, never quietly reset to
    // `true` — an absent/non-boolean value defaults to `false` (unknown
    // never renders as "complete"), never `true`.
    const spendComplete = { value: state.spendComplete === true };

    // A present-but-unparseable `state.expiresAt` (Date.parse -> NaN) must
    // never read as "not expired" — `NaN > x`/`x > NaN` are both false, so
    // the real expiry compare below would silently treat garbage as open
    // forever. Refused here, naming the run, BEFORE the answer is consumed
    // (same "checked before consuming" rule as the spent check above — a
    // refusal here must be replayable).
    if (Number.isNaN(Date.parse(state.expiresAt))) {
      return {
        outcome: 'refused',
        red: `resume: run "${runId}" state.json field "expiresAt" ("${state.expiresAt}") is not a parseable date — `
          + 'refusing rather than treating it as not-expired',
      };
    }

    const answerPath = join(runDir, 'answer.json');
    // F48 round 3: `answer.json` goes through `resolveInside` too — a
    // symlinked answer file (or a symlinked run dir ancestor) is refused by
    // name here, the same as "no answer yet", never read through to an
    // outside file's content.
    const answerResolved = resolveInside(runDir, 'answer.json');
    if (!answerResolved.ok) {
      if (answerResolved.missing) {
        return { outcome: 'refused', red: `resume: no answer yet for run "${runId}"` };
      }
      return { outcome: 'refused', red: `resume: answer.json for run "${runId}" — ${answerResolved.red}` };
    }
    let answer;
    try {
      answer = JSON.parse(readFileSync(answerPath, 'utf8'));
    } catch (err) {
      return { outcome: 'refused', red: `resume: answer.json for run "${runId}" is not valid JSON — ${err.message}` };
    }
    // Valid JSON that is not an object (`null`, a number, a string, an array) has no askId to read: refused by name.
    if (answer === null || typeof answer !== 'object' || Array.isArray(answer)) {
      return { outcome: 'refused', red: `resume: answer.json for run "${runId}" is not a JSON object (it holds ${answer === null ? 'null' : Array.isArray(answer) ? 'an array' : `a ${typeof answer}`})` };
    }
    // M4b amendment 3: a consumed/saved answer that says `reject` (an older
    // version's file) is read as `redo`; the file on disk is never rewritten.
    answer = { ...answer, decision: normalizeDecision(answer.decision) };
    if (answer.askId !== state.askId) {
      return { outcome: 'refused', red: `resume: answer askId "${answer.askId}" does not match open askId "${state.askId}" for run "${runId}"` };
    }

    // M4c amendment 3: an answer's saved time, never the restart's clock, says whether it was on time. A missing or
    // unreadable one is refused by name here, before the consume, so the answer stays replayable.
    const timing = answerTiming(answer.answeredAt, effectiveExpiresAt(runDir, state.askId, state.expiresAt));
    if (timing === 'unreadable') {
      return { outcome: 'refused', red: `resume: answer.json for run "${runId}" has a missing or unreadable answeredAt ("${answer.answeredAt}") — refusing rather than treating it as on time` };
    }

    // M4e amendment 13: a Stop asked STRICTLY before this answer was saved was asked of a run that was waiting (it landed after the
    // park, before the Stop door could act). The run is stopped AT the ask and the answer to it is not used. A Stop asked at the same
    // instant as the answer, or after it, belongs to the apply that follows: the fold's own seam reads it and stops before the next
    // step. On a tie the ANSWER WINS (hamr's ruling, 2026-10-07: a fast CI gave both the same millisecond). A Stop with no readable
    // time is read as made "now" by `readStopRequest` (amendment 17 2A, one rule), which is after the answer: the answer wins.
    const stopReq = readStopRequest(runDir, now);
    const stopFirst = stopReq !== null && Date.parse(/** @type {string} */ (stopReq.at)) < Date.parse(answer.answeredAt);
    if (stopReq && stopFirst) {
      const prev = readLog(runDir);
      return stopAtAsk({
        flowDir, runDir, runId, capUsd: arbiter.capUsd ?? null, startedAt: runStartedAt, now, nowMs: getNowMs, signatureHash: state.signatureHash, spent, spendComplete: spendComplete.value,
        attempts: Array.isArray(prev?.attempts) ? prev.attempts : [], artifacts: prev?.artifacts && typeof prev.artifacts === 'object' ? prev.artifacts : {},
        stepIndex: state.stepIndex, stepEmits: steps[state.stepIndex]?.emits ?? null, flowRoot: root, flowName: name, inputsManifest: state.inputsManifest,
        unjudged: state.evidenceUnjudged ?? [], redone: typeof state.redone === 'number' ? state.redone : 0, parkedAskId: state.askId,
      });
    }

    // M4b amendment 2: hashes recorded by earlier-process accepts, read back
    // from the archive + consumed markers. Refused BEFORE the consume below so
    // the answer stays replayable.
    const recordedHashes = readAcceptedHashesByEmits(runDir);
    if (!recordedHashes.ok) return { outcome: 'refused', red: recordedHashes.red };

    // Consume-once, BEFORE acting on the decision (F44) — the rename is
    // itself a one-winner gate, on top of the lock above.
    const consumedPath = join(runDir, `answer.${answer.askId}.consumed.json`);
    renameSync(answerPath, consumedPath);
    // M4c: the answer is ours and every guard has passed — record this resume process before its first step.
    recordPid(runDir, 'resume', now());

    // M4c amendment 3: expiry is when the answer was SAVED against the deadline (`timing`, above),
    // not this process's clock at restart.
    if (timing === 'late') {
      // Negative (i): an answer arriving after expiry cancels the run —
      // adds NOTHING further, but the run's own already-spent total is
      // real money and must be reported, never coerced to 0 (orchestrator
      // review fix 2: "a pause spends nothing" means the pause adds
      // nothing, not that the run's total resets).
      appendAudit(runDir, {
        step: null, attempt: null, class: null, verdict: 'ask-expired', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false, at: now(), tokens: null, tools: null, refused: [],
      });
      appendHistory(flowDir, {
        runId, at: now(), outcome: 'ask-expired', spentUsd: spent.value, spendComplete: spendComplete.value, capUsd: arbiter.capUsd ?? null, wallMs: getNowMs() - runStartedAt, signatureHash: state.signatureHash,
      });
      recordRunNotes({
        flowName: name, runId, runDir, outcome: 'ask-expired', specHash: state.signatureHash, now,
      });
      return { outcome: 'ask-expired', runDir, spentUsd: spent.value };
    }

    if (answer.decision === 'rerun') {
      // M3 scope item 7 (hamr "2A"): `rerun` ends THIS run (one history row,
      // `rerun`, its real spend, $0 added) and starts a brand-new run on the
      // same signed flow — never a redo of the step before the ask.
      const reason = typeof answer.reason === 'string' ? answer.reason.trim() : '';
      if (reason.length === 0) {
        // `answerAsk` already refuses a blank reason at write time — this
        // re-check exists because `resumeRun` never trusts a file it did
        // not itself just validate, same as every other field read above.
        return { outcome: 'refused', red: `resume: rerun answer for run "${runId}" carries a blank reason` };
      }

      // Safe to collapse missing/red to `readArtifact`'s `undefined` here:
      // the "was this step already done" gate above already refused the
      // whole resume (before the answer was even consumed) if any
      // `steps[i].emits` for i < state.stepIndex was red — this loop only
      // ever runs once every one of those same ids has already read `ok`.
      const priorArtifactsForLog = {};
      for (let i = 0; i < state.stepIndex; i += 1) {
        priorArtifactsForLog[steps[i].emits] = readArtifact(runDir, steps[i].emits);
      }
      try {
        recordLateAnswerIfAny(runDir, now);
        writeLog(runDir, { runId, outcome: 'rerun', attempts: [], artifacts: priorArtifactsForLog });
      } finally {
        // Amendment 16 C6/C7: the history end row is written last, and always.
        appendHistory(flowDir, {
          runId, at: now(), outcome: 'rerun', spentUsd: spent.value, spendComplete: spendComplete.value, capUsd: arbiter.capUsd ?? null, wallMs: getNowMs() - runStartedAt, signatureHash: state.signatureHash,
        });
      }
      // M8 am4: a rerun ends THIS run, so its notes count now (the new run, started below, makes its own).
      recordRunNotes({
        flowName: name, runId, runDir, outcome: 'rerun', specHash: state.signatureHash, now,
      });

      // Deterministic derived id (M3 scope item 7) — refused by name, never
      // silently renumbered, if it already exists.
      const newRunId = `${runId}-rerun-1`;
      const newRunDir = join(flowDir, 'runs', newRunId);
      if (existsSync(newRunDir)) {
        return {
          outcome: 'refused',
          red: `resume: rerun target run "${newRunId}" already exists for run "${runId}" — refused`,
        };
      }

      // Fresh inputs, re-frozen from the ORIGINAL source paths — carried in
      // `inputsManifest[].source` since `freezeInputs` first wrote it (M3
      // scope item 7's own note: "persist those in state.json at park if
      // they aren't already" — they already are, via this field).
      const rerunSources = (state.inputsManifest ?? []).map((entry) => ({ id: entry.id, path: entry.source }));

      if (typeof onRerunStart === 'function') onRerunStart(newRunDir);
      const newRun = await runFlow({
        root,
        name,
        runId: newRunId,
        sources: rerunSources,
        catalogue,
        modelStep,
        // A fresh run never waits in-process — any signed ask it reaches
        // parks immediately, exactly like any other `runFlow` call this
        // piece drives.
        askStep: makeParkingAskStep(),
        sendStep,
        primitives,
        clock,
        businessDate,
        ceilingUsd,
        runModel,
        // Item 7: the reason becomes the new run's FIRST step's starting gap.
        initialGap: reason,
      });

      return {
        outcome: 'rerun', runDir, runId, newRunId, spentUsd: spent.value, newRun,
      };
    }

    if (answer.decision !== 'accept' && answer.decision !== 'redo') {
      return { outcome: 'refused', red: `resume: unrecognised decision "${answer.decision}" for run "${runId}"` };
    }

    // Reconstruct the fold's accumulators from disk + state.json — never
    // re-running a step that already went green (M3 scope item 4). Every
    // `readArtifact` call below reads an id already proven `ok` by the "was
    // this step already done" gate above (i < state.stepIndex, same ids) —
    // safe to collapse missing/red to `undefined` here for that reason only.
    const artifacts = {};
    for (let i = 0; i < state.stepIndex; i += 1) {
      artifacts[steps[i].emits] = readArtifact(runDir, steps[i].emits);
    }
    const askLines = new Map((arbiter.asks ?? []).map((a) => [a.line, a]));
    const sendLines = new Map((arbiter.sends ?? []).map((s) => [s.line, s]));
    const askStepEmits = new Set(steps.filter((s) => askLines.has(s.fromLine)).map((s) => s.emits));
    // M4b piece 3: Map emits -> the sha256 the human's accept recorded for that
  // ask's artifact (`null` = none recorded in THIS process; send refuses).
  const acceptedAskEmitsThisRun = new Map();
    for (const emits of askStepEmits) {
      const idx = steps.findIndex((s) => s.emits === emits);
      if (idx !== -1 && idx < state.stepIndex && readArtifact(runDir, emits) !== undefined) {
        acceptedAskEmitsThisRun.set(emits, recordedHashes.byEmits.get(emits) ?? null);
      }
    }

    const attemptsLog = [];
    const auditRows = [];
    const recordAudit = (row, modelOutput, unjudgedCount) => {
      const fullRow = unjudgedCount === undefined ? row : { ...row, unjudgedCount };
      auditRows.push(fullRow);
      appendAudit(runDir, fullRow);
      if (row.spendComplete === false) spendComplete.value = false;
      if (modelOutput !== undefined) {
        attemptsLog.push({
          step: row.step, attempt: row.attempt, class: row.class, verdict: row.verdict, gap: row.gap, ...(row.refused ? { refused: row.refused } : {}), modelOutput,
        });
      }
    };

    const capUsd = arbiter.capUsd;
    const redoCap = arbiter.redoCap ?? 3;
    const effectiveCeilingUsd = holdOf(ceilingUsd);

    const step = steps[state.stepIndex];
    const askSlot = askLines.get(step.fromLine);
    const priorId = (step.reads ?? [])[0];
    const priorStepIndex = steps.findIndex((s) => s.emits === priorId);
    // `priorId` names a step strictly earlier than the parked ask
    // (state.stepIndex), so i < state.stepIndex — already proven `ok` by the
    // "was this step already done" gate above; safe to collapse here.
    const priorArtifact = readArtifact(runDir, priorId);

    const oneShotAskStep = makeOneShotThenParkAskStep({ decision: answer.decision, reason: answer.reason, artifactSha256: answer.artifactSha256 });

    const askResult = await runAskSlot({
      step,
      stepIndex: state.stepIndex,
      askSlot,
      priorId,
      priorStep: steps[priorStepIndex],
      priorStepNo: priorStepIndex + 1,
      priorPrevStepId: priorStepIndex > 0 ? (steps[priorStepIndex - 1].emits ?? null) : null,
      priorArtifact,
      redoCap,
      effectiveCeilingUsd,
      capUsd,
      primitives,
      businessDate,
      modelStep,
      askStep: oneShotAskStep,
      spent,
      spendComplete,
      recordAudit,
      evidenceUnjudged: state.evidenceUnjudged ?? [],
      unjudgedCount: state.unjudgedCount ?? 0,
      redone: typeof state.redone === 'number' ? state.redone : 0,
      runDir,
      flowDir,
      runId,
      flowRoot: root,
      flowName: name,
      signatureHash: state.signatureHash,
      inputsManifest: state.inputsManifest,
      attemptsLog,
      artifacts,
      now,
      startedAt,
      runStartedAt,
    });

    if (askResult.type === 'paused' || askResult.type === 'stopped') return askResult.result;
    if (askResult.type === 'halted') {
      return haltRun({
        flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs: getNowMs, signatureHash: state.signatureHash, spent, priorSpendComplete: spendComplete.value && askResult.stop?.book?.spendComplete !== false, attempts: attemptsLog, artifacts, outcome: askResult.outcome, red: askResult.red,
          ...(askResult.stop ? { stop: askResult.stop } : {}),
        resumeAt: {
          stepIndex: state.stepIndex, flowRoot: root, flowName: name, inputsManifest: state.inputsManifest, unjudged: state.evidenceUnjudged ?? [], redone: askResult.redone,
        },
      });
    }

    // accepted — write the ask step's own artifact, then fold on to
    // whatever comes next (another signed ask parks again; the ordinary
    // send/step path completes exactly as `runFlow` would have, in-process).
    writeArtifact(runDir, step.emits, askResult.artifact);
    artifacts[step.emits] = askResult.artifact;
    acceptedAskEmitsThisRun.set(step.emits, askResult.acceptedSha256 ?? null);

    const result = await foldFromStep({
      i0: state.stepIndex + 1,
      steps,
      askLines,
      sendLines,
      askStepEmits,
      runDir,
      flowDir,
      runId,
      flowRoot: root,
      flowName: name,
      signatureHash: state.signatureHash,
      inputsManifest: state.inputsManifest,
      capUsd,
      redoCap,
      effectiveCeilingUsd,
      primitives,
      businessDate,
      modelStep,
      // A resumed run never waits in-process — any FURTHER signed ask it
      // reaches parks immediately too, under its own signed ttl.
      askStep: makeParkingAskStep(),
      sendStep,
      now,
      startedAt,
      runStartedAt,
      nowMs: getNowMs,
      spent,
      spendComplete,
      artifacts,
      acceptedThisRun: true,
      acceptedAskEmitsThisRun,
      unjudgedSinceLastAsk: [],
      recordAudit,
      attemptsLog,
    });
    recordRunNotes({
      flowName: name, runId, runDir, outcome: result.outcome, specHash: state.signatureHash, now,
    });

    if (result.outcome === 'complete') return { ...result, auditRows };
    return result;
  } finally {
    releaseResumeLock(runDir, lockPath);
    try { closeSync(lockFd); } catch { /* already closed */ }
  }
}

/**
 * What a run has spent so far, from its own books (audit.jsonl is the source of truth): the sum of every priced row (a cap-halt
 * row cost nothing and carries no number), and whether any row left the total a floor. Used by `continueRun` and the CLI's hold.
 * @param {string} runDir
 * @returns {{ ok: true, total: number, complete: boolean } | { ok: false, red: string }}
 */
export function auditSpend(runDir) {
  return sumAuditUsd(runDir, { skipVerdicts: ['cap-halt'] });
}

/**
 * M4e amendment 4 items 4 and 6 (Resume of a stopped or cap-halted run): the SAME run id continues, never a new run. Takes the
 * same exclusive `resume.lock` as an answer-resume (one resume at a time per run), reads `halt.json` (the runner's own record of
 * where it stopped), re-verifies the flow's signature, the frozen inputs and every finished step's artifact, lays the run's
 * highest signed values version over the flow's (`pickRunValues`: the human's new cap lives there, write-once, never in the flow's
 * own files), refuses by name at $0 when that cap is not above what is already spent, consumes `halt.json` by rename (the
 * mutex, like an answer), then re-enters the ONE fold at the first step with no artifact. Done steps are not re-run, spend so
 * far (re-summed from the books) counts against the new cap, the plan is never redrawn.
 *
 * @param {object} opts same shape as `resumeRun`'s
 * @param {string} opts.root
 * @param {string} opts.name
 * @param {string} opts.runId
 * @param {unknown} opts.catalogue
 * @param {(executorContext:object, grantedTools:Record<string,any>, stepMeta?:{class:string|null}) => Promise<any>} opts.modelStep
 * @param {(target:string, filename:string, content:unknown) => Promise<{ok:boolean, red?:string, bytes?:number}>} opts.sendStep
 * @param {Record<string, any>} [opts.primitives]
 * @param {string[]} [opts.primitiveReds]
 * @param {() => string} [opts.clock]
 * @param {string} opts.businessDate
 * @param {number} [opts.ceilingUsd]
 * @param {() => number} [opts.nowMs]
 */
export async function continueRun({
  root, name, runId, catalogue, modelStep, sendStep, primitives, primitiveReds, clock, businessDate, ceilingUsd, nowMs,
}) {
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();
  const getNowMs = typeof nowMs === 'function' ? nowMs : Date.now;
  const flowDir = join(root, name);
  const startedAt = getNowMs();
  const refused = (red, detail) => ({ outcome: 'refused', red: `continue: ${red}`, ...(detail ? { detail } : {}) });

  const runIdCheck = resolveRunDir(flowDir, runId);
  if (!runIdCheck.ok) return { outcome: 'refused', red: runIdCheck.red };
  const runDir = runIdCheck.runDir;

  const preflightRead = readRunPlan({ root, name, catalogue, runDir });
  if (preflightRead.ok) {
    const unwiredVerb = findUnwiredVerbStep(preflightRead.declaration);
    if (unwiredVerb) return refused(unwiredRed(unwiredVerb));
    const unbuildable = findUnbuildableCheckStep(preflightRead.declaration);
    if (unbuildable) return refused(unbuildableRed(unbuildable), unbuildable.why);
  }
  if (primitiveReds?.length) return refused(primitiveReds[0]);

  const lockPath = join(runDir, 'resume.lock');
  const took = await takeResumeLock(runDir, runId, lockPath);
  if (!took.ok) return { outcome: 'refused', red: took.red };
  const { lockFd } = took;

  try {
    const haltRead = readHaltRecord(runDir);
    if (!haltRead.ok) {
      return refused(haltRead.missing
        ? `run "${runId}" was not stopped or cap-halted by this version (no halt record) — there is nothing to continue; start a new run`
        : `run "${runId}" ${haltRead.red}`);
    }
    const { halt } = haltRead;
    if (!sameRoot(halt.flow?.root, root) || halt.flow?.name !== name) {
      return refused(`run "${runId}" was halted against flow "${halt.flow?.root}/${halt.flow?.name}", not the requested "${root}/${name}" — refusing rather than reading a different flow than asked`);
    }
    if (!Number.isInteger(halt.stepIndex) || halt.stepIndex < 0) return refused(`run "${runId}" halt.json field "stepIndex" is not a step number`);

    const read = readRunPlan({ root, name, catalogue, runDir });
    if (!read.ok) return refused(`flow re-read failed for run "${runId}": ${read.reds.join('; ')}`);
    const { declaration, signature } = read;
    if (signature.flow !== halt.signatureHash) return refused(`signature mismatch for run "${runId}" — its saved copy of the job is not the job it was halted under`);
    // the human's signed values for this run (its highest version): the new cap is read from here, nowhere else
    const applied = applyRunValues(read.arbiter, name, signature.flow, pickRunValues(runDir));
    if (!applied.ok) return refused(`run "${runId}" — ${applied.red}`);
    const { arbiter } = applied;

    for (const entry of halt.inputsManifest ?? []) {
      if (!existsSync(entry.frozen)) return refused(`frozen input "${entry.id}" missing for run "${runId}" (${entry.frozen})`);
      if (createHash('sha256').update(readFileSync(entry.frozen)).digest('hex') !== entry.sha256) {
        return refused(`frozen input "${entry.id}" changed while halted for run "${runId}"`);
      }
    }

    const { steps } = declaration;
    if (halt.stepIndex > steps.length) return refused(`run "${runId}" halt.json names step ${halt.stepIndex}, past this flow's ${steps.length} steps`);
    /** @type {Record<string, any>} */
    const artifacts = {};
    for (let i = 0; i < halt.stepIndex; i += 1) {
      const a = readArtifactResult(runDir, steps[i].emits);
      if (!a.ok) {
        return refused(a.missing
          ? `artifact "${steps[i].emits}" missing for run "${runId}" — cannot continue`
          : `artifact "${steps[i].emits}" for run "${runId}" — ${a.red} — refusing rather than treating a refused read as "not done" and re-running it`);
      }
      artifacts[steps[i].emits] = a.value;
    }

    const audit = auditSpend(runDir);
    if (!audit.ok) return refused(`run "${runId}" ${audit.red}`);
    const capUsd = arbiter.capUsd;
    if (!(capUsd - audit.total > SPEND_TOLERANCE_USD)) {
      return refused(`the cap $${capUsd} is not above what run "${runId}" has already spent ($${audit.total}) — raise it first; $0 spent now`);
    }
    const recordedHashes = readAcceptedHashesByEmits(runDir);
    if (!recordedHashes.ok) return { outcome: 'refused', red: recordedHashes.red };

    // Consume-once BEFORE acting (the answer's own rule, F44): the rename is a one-winner gate on top of the lock.
    const taken = readdirInside(runDir, '.').filter((n) => /^halt\.\d+\.consumed\.json$/.test(n)).length;
    renameSync(join(runDir, HALT_FILE), join(runDir, `halt.${taken + 1}.consumed.json`));
    settleStop({ runDir, now, outcome: halt.outcome ?? 'halted' }); // a request left over from before the halt is not this continue's
    recordPid(runDir, 'continue', now());

    const spent = { value: audit.total };
    const spendComplete = { value: audit.complete };
    const askLines = new Map((arbiter.asks ?? []).map((a) => [a.line, a]));
    const sendLines = new Map((arbiter.sends ?? []).map((s) => [s.line, s]));
    const askStepEmits = new Set(steps.filter((s) => askLines.has(s.fromLine)).map((s) => s.emits));
    const acceptedAskEmitsThisRun = new Map();
    for (const emits of askStepEmits) {
      const idx = steps.findIndex((s) => s.emits === emits);
      // a step before the halt point has its artifact (the gate above refused any that was missing or red)
      if (idx !== -1 && idx < halt.stepIndex) {
        acceptedAskEmitsThisRun.set(emits, recordedHashes.byEmits.get(emits) ?? null);
      }
    }
    const attemptsLog = [];
    const auditRows = [];
    const recordAudit = (row, modelOutput, unjudgedCount) => {
      const fullRow = unjudgedCount === undefined ? row : { ...row, unjudgedCount };
      auditRows.push(fullRow);
      appendAudit(runDir, fullRow);
      if (row.spendComplete === false) spendComplete.value = false;
      if (modelOutput !== undefined) {
        attemptsLog.push({
          step: row.step, attempt: row.attempt, class: row.class, verdict: row.verdict, gap: row.gap, ...(row.refused ? { refused: row.refused } : {}), modelOutput,
        });
      }
    };
    const runStartedAt = typeof halt.startedAt === 'number' ? halt.startedAt : startedAt;

    // Amendment 7 item 8: a Stop that cut the step short leaves its tries in the books; Resume re-enters it as a NEW try, numbered after them.
    // A try the Stop cut mid-way (its `stopped` row) wears a number but is replaced, not counted against the step's limit. Read from the
    // books (the source of truth), never a second record. A cap-halt re-entry keeps its own, earlier behaviour.
    const resumeTries = { numbered: 0, done: 0 };
    if (halt.outcome === 'stopped' && steps[halt.stepIndex]) {
      const tries = readAudit(runDir).filter((r) => r.step === steps[halt.stepIndex].emits && Number.isInteger(r.attempt) && r.verdict !== 'cap-halt');
      resumeTries.numbered = tries.length;
      resumeTries.done = Math.min(tries.filter((r) => r.verdict !== 'stopped').length, MAX_ATTEMPTS - 1);
    }

    const result = await foldFromStep({
      i0: halt.stepIndex,
      resumeTries,
      steps,
      askLines,
      sendLines,
      askStepEmits,
      runDir,
      flowDir,
      runId,
      flowRoot: root,
      flowName: name,
      signatureHash: halt.signatureHash,
      inputsManifest: halt.inputsManifest,
      capUsd,
      redoCap: arbiter.redoCap ?? 3,
      effectiveCeilingUsd: holdOf(ceilingUsd),
      primitives,
      businessDate,
      modelStep,
      // a continued run never waits in-process: a signed ask it reaches parks, under the wait in force
      askStep: makeParkingAskStep(),
      sendStep,
      now,
      startedAt,
      runStartedAt,
      nowMs: getNowMs,
      spent,
      spendComplete,
      artifacts,
      acceptedThisRun: acceptedAskEmitsThisRun.size > 0,
      acceptedAskEmitsThisRun,
      unjudgedSinceLastAsk: Array.isArray(halt.unjudged) ? halt.unjudged : [],
      resumeRedone: Number.isInteger(halt.redone) && halt.redone > 0 ? halt.redone : 0,
      recordAudit,
      attemptsLog,
    });
    recordRunNotes({
      flowName: name, runId, runDir, outcome: result.outcome, specHash: halt.signatureHash, now,
    });
    if (result.outcome === 'complete') return { ...result, auditRows };
    return result;
  } finally {
    releaseResumeLock(runDir, lockPath);
    try { closeSync(lockFd); } catch { /* already closed */ }
  }
}

/**
 * M4e amendment 13 (SIGNED 2026-10-07): a Stop at an ask. The ONE place a run is stopped at its ask, whether the turn led to it
 * (`parkedAskId` null: nothing was written for the ask) or the ask was already parked (`parkedAskId` set: the open ask and its
 * state are set aside as `ask.<id>.stopped.json` / `state.<id>.stopped.json` so no wait can expire and no answer can reach them;
 * the rename of `ask.json` is the one-winner gate, like an answer's). A saved answer to that ask is set aside, never used. The
 * rows are `settleStop`'s ("stop asked (you) at <time>", then "stopped at the ask of step N"); `halt.json` points at the ask
 * step, with the redo count carried, so Resume asks again, fresh, with no model call.
 * @param {Record<string, any>} o
 * @returns {any}
 */
function stopAtAsk(o) {
  const {
    flowDir, runDir, runId, capUsd, startedAt, now, nowMs, signatureHash, spent, spendComplete = true, attempts = [], artifacts = {},
    stepIndex, stepEmits, flowRoot, flowName, inputsManifest, unjudged, redone, parkedAskId = null,
  } = o;
  const red = `stopped by you at the ask of step ${stepIndex + 1}`;
  if (parkedAskId !== null) {
    try { renameSync(join(runDir, 'ask.json'), join(runDir, `ask.${parkedAskId}.stopped.json`)); } catch (err) {
      // Amendment 16 C8: only "file not found" means another stopper won the rename (it writes the rows). Any other error is a failed
      // stop: said plainly with the error named, nothing written, the run left as it was.
      if (err?.code === 'ENOENT') return { outcome: 'stopped', red, spentUsd: spent.value };
      return { outcome: 'stop-failed', red: `the stop failed: could not set the ask aside (${err?.code ?? 'error'}: ${err?.message ?? err})`, spentUsd: spent.value };
    }
    try { renameSync(join(runDir, 'state.json'), join(runDir, `state.${parkedAskId}.stopped.json`)); } catch { /* no state: nothing to set aside */ }
    if (existsSync(join(runDir, 'answer.json'))) setAsideAnswer(runDir, parkedAskId, 'late');
  }
  return haltRun({
    flowDir, runDir, runId, capUsd, startedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete, attempts, artifacts,
    outcome: 'stopped', red,
    stop: { where: `stopped at the ask of step ${stepIndex + 1}`, step: stepEmits },
    resumeAt: {
      stepIndex, flowRoot, flowName, inputsManifest, unjudged, redone,
    },
  });
}

/**
 * M4e amendment 13: the Stop on a run that already waits at its ask (the panel's Stop door; also the fallback for a request that
 * landed right after the park). Writes the request if none is pending (`requestStop`, its one writer), takes the same exclusive
 * `resume.lock` as a resume, checks the run really is parked on its open, unanswered ask, and stops it at the ask (`stopAtAsk`).
 * Refused by name, writing nothing, for a run that is not waiting at an ask. $0: no model call, no spend.
 * @param {object} opts
 * @param {string} opts.root
 * @param {string} opts.name
 * @param {string} opts.runId
 * @param {unknown} opts.catalogue
 * @param {() => string} [opts.clock]
 * @param {() => number} [opts.nowMs]
 */
export async function stopParkedRun({
  root, name, runId, catalogue, clock, nowMs,
}) {
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();
  const flowDir = join(root, name);
  const refused = (red) => ({ outcome: 'refused', red: `stop: ${red}` });
  const runIdCheck = resolveRunDir(flowDir, runId);
  if (!runIdCheck.ok) return { outcome: 'refused', red: runIdCheck.red };
  const runDir = runIdCheck.runDir;

  const lockPath = join(runDir, 'resume.lock');
  const took = await takeResumeLock(runDir, runId, lockPath);
  if (!took.ok) return { outcome: 'refused', red: took.red };
  const { lockFd } = took;
  try {
    const ask = readAsk(runDir);
    const state = readRunState(runDir);
    if (!ask || typeof ask.askId !== 'string' || !state || state.askId !== ask.askId) return refused(`run "${runId}" is not waiting at an ask`);
    if (existsSync(join(runDir, `answer.${ask.askId}.consumed.json`))) return refused(`run "${runId}" already took its answer`);
    if (endRow(readHistory(flowDir), runDir, runId) !== null) return refused(`run "${runId}" has ended`);
    if (!Number.isInteger(state.stepIndex) || state.stepIndex < 0) return refused(`run "${runId}" state.json field "stepIndex" is not a step number`);
    const audit = auditSpend(runDir);
    if (!audit.ok) return refused(`run "${runId}" ${audit.red}`);
    requestStop(runDir); // 'exists' when the door (or a race) wrote it already
    const read = readRunPlan({ root, name, catalogue, runDir });
    let capUsd = null;
    if (read.ok) {
      const applied = applyRunValues(read.arbiter, name, read.signature.flow, pickRunValues(runDir));
      if (applied.ok) capUsd = applied.arbiter.capUsd ?? null;
    }
    const prev = readLog(runDir);
    const stepEmits = readAudit(runDir).filter((r) => r.verdict === 'paused').map((r) => r.step).pop() ?? null;
    return stopAtAsk({
      flowDir, runDir, runId, capUsd, startedAt: typeof state.startedAt === 'number' ? state.startedAt : Date.now(), now, nowMs: typeof nowMs === 'function' ? nowMs : Date.now,
      signatureHash: state.signatureHash ?? null, spent: { value: audit.total }, spendComplete: audit.complete,
      attempts: Array.isArray(prev?.attempts) ? prev.attempts : [], artifacts: prev?.artifacts && typeof prev.artifacts === 'object' ? prev.artifacts : {},
      stepIndex: state.stepIndex, stepEmits, flowRoot: root, flowName: name, inputsManifest: state.inputsManifest, unjudged: state.evidenceUnjudged ?? [],
      redone: typeof state.redone === 'number' ? state.redone : 0, parkedAskId: ask.askId,
    });
  } finally {
    releaseResumeLock(runDir, lockPath);
    try { closeSync(lockFd); } catch { /* already closed */ }
  }
}

/** log.json's one writer, called from every exit path (complete + every
 *  halt) — M2 scope item 9 / the M0 ruling: what the model wrote, every
 *  attempt, red runs included, never just the final artifacts. */
function writeLog(runDir, payload) {
  writeFileSync(join(runDir, 'log.json'), JSON.stringify(payload, null, 2));
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
 * when the run has never parked, or the file is present but not valid JSON.
 * @param {string} runDir
 * @returns {any|null}
 */
export function readRunState(runDir) {
  const result = readFileInside(runDir, 'state.json');
  if (!result.ok) return null;
  try { return JSON.parse(result.text); } catch { return null; }
}

/**
 * `ask.json`'s own sibling reader (same rule as {@link readLog}) — the
 * parking ask protocol's own writer lives in {@link runAskSlot} above.
 * `null` when there is no open ask for this run, or the file is present but
 * not valid JSON.
 * @param {string} runDir
 * @returns {any|null}
 */
export function readAsk(runDir) {
  const result = readFileInside(runDir, 'ask.json');
  if (!result.ok) return null;
  // The deadline every reader sees is the effective one (`withReopen`: a reopened ask's new deadline).
  try { return withReopen(runDir, JSON.parse(result.text)); } catch { return null; }
}

/**
 * @param {object} opts
 * @param {string} opts.flowDir
 * @param {string} opts.runDir
 * @param {string} opts.runId
 * @param {number|null} opts.capUsd
 * @param {number} opts.startedAt
 * @param {() => string} opts.now
 * @param {() => number} [opts.nowMs] - F45 finding 3; defaults to `Date.now`.
 * @param {string} opts.outcome
 * @param {string} [opts.red]
 * @param {string|null} [opts.detail] - amendment 23: bareguard's raw reason, recorded beside `red` (never the sentence).
 * @param {{ value: number }} opts.spent
 * @param {any[]} [opts.attempts]
 * @param {Record<string, any>} [opts.artifacts]
 * @param {string|null} [opts.signatureHash] - the flow's `signature.json` `flow`
 *   hash, when this halt happened AFTER `readFlow` succeeded (item 9: every
 *   history row carries it, halts included). A halt before the signature was
 *   read/verified (the pre-`readFlow`-success refused path, and any halt
 *   before `signature` comes into scope) keeps the default `null`.
 * @param {boolean} [opts.priorSpendComplete] - orchestrator review fix (4):
 *   a floor carried in from BEFORE this halt (e.g. a pre-park row, or an
 *   earlier attempt this run, that already left `spendComplete: false`).
 *   ANDed with this halt's own outcome-based verdict — once false, always
 *   false. Defaults to `true` (every pre-existing call site is unaffected).
 * @param {{stepIndex: number, flowRoot: string, flowName: string, inputsManifest: any, unjudged?: any[], redone?: number}|null} [opts.resumeAt] - M4e
 *   amendment 4 item 4: where a `cap-halt`/`stopped` run is re-entered; `haltRun` writes `halt.json` from it (and only for those outcomes).
 * @param {{where:string, step?:string|null, book?:Record<string, any>}|null} [opts.stop] - amendment 7 item 8: this halt honours a Stop (its words, and the
 *   cut try's row fields so the call in flight is booked); a request still pending on any other halt is recorded `not honoured`.
 */
function haltRun({
  flowDir, runDir, runId, capUsd, startedAt, now, nowMs = Date.now, outcome, red, spent, attempts = [], artifacts = {}, signatureHash = null,
  priorSpendComplete = true, resumeAt = null, stop = null, detail = null,
}) {
  // F45 finding 3: `startedAt` here is always the RUN's start (every caller
  // now passes `runStartedAt` under this key — see call sites), so `wallMs`
  // times the whole run, pauses included, never just the halting process.
  const wallMs = nowMs() - startedAt;
  const spendComplete = priorSpendComplete
    && outcome !== 'provider-red' && outcome !== 'pricing-red' && outcome !== 'cap-halt';
  mkdirSync(flowDir, { recursive: true });
  try {
    if (existsSync(runDir)) {
      recordLateAnswerIfAny(runDir, now);
      writeLog(runDir, {
        runId, outcome, red, ...(detail ? { detail } : {}), attempts, artifacts,
      });
      // M4e amendment 4 item 4: a cap-halted or stopped run leaves the one record Resume continues from (its only writer).
      if (resumeAt && HALT_OUTCOMES.includes(outcome)) {
        writeFileSync(join(runDir, HALT_FILE), `${JSON.stringify({
          runId, outcome, at: now(), flow: { root: resumeAt.flowRoot, name: resumeAt.flowName }, signatureHash, inputsManifest: resumeAt.inputsManifest,
          stepIndex: resumeAt.stepIndex, startedAt, unjudged: resumeAt.unjudged ?? [],
          ...(Number.isInteger(resumeAt.redone) ? { redone: resumeAt.redone } : {}),
        }, null, 2)}\n`, { flag: 'wx' });
      }
      settleStop({ runDir, now, outcome, stop }); // amendment 7 item 8: every Stop leaves its rows
    }
  } finally {
    // The history end row is the LAST write and is always written (amendment 16 C7): a reader that sees it finds the run settled, and a
    // failed log, halt.json or settle row above never costs the row its real signature hash or the run's spend.
    // The one exception is the earlier rule (test/m4e-halt-write-order.test.js): a `stopped` row with no halt.json would read "stopped" with
    // no Resume offered, so a Stop whose halt record failed leaves no end row. C7 names the cap-halt, which always gets its row.
    const stoppedWithoutHaltRecord = outcome === 'stopped' && resumeAt && !readHaltRecord(runDir).ok;
    if (!stoppedWithoutHaltRecord) {
      appendHistory(flowDir, {
        runId, at: now(), outcome, spentUsd: spent.value, spendComplete, capUsd: capUsd ?? null, wallMs, signatureHash, ...(detail ? { detail } : {}), // amendment 23: bareguard's raw reason, never the sentence
      });
    }
  }
  return { outcome, red, ...(detail ? { detail } : {}), spentUsd: spent.value };
}
