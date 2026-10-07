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
  dirname, extname, isAbsolute, join, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  readFlow, resolveRunDir, readFileInside, readdirInside, resolveInside, FLOW_FILES, PANEL_STARTS_DIR,
} from './flow.js';
import {
  writeAskArchive, readAcceptedHashesByEmits, serializeArtifact, normalizeDecision, answerTiming, effectiveExpiresAt, withReopen, setAsideAnswer,
} from './ask.js';
import { findUnwiredVerbStep, unwiredRed } from './canrun.js'; // M4e am7 item 7: the ONE decider (F46 refusal lives there)
import { configHome, configDoorHome } from './config.js';
import { closeByClass } from './closers.js';
import {
  appendAudit, appendHistory, readAudit, readHistory, endRow, HALT_OUTCOMES,
} from './books.js';
import { applyRunValues, pickRunValues } from './runvalues.js';
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
 *  $0.0006+), so nothing a real tamper produces can hide inside it. */
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

/** The ONE reader of the stop request: `{at}` (when it was asked; null if unreadable) or `null` when none is pending. @param {string} runDir */
export function readStopRequest(runDir) {
  const r = readFileInside(runDir, STOP_FILE);
  if (!r.ok) return null;
  try { const at = JSON.parse(r.text)?.at; return { at: typeof at === 'string' ? at : null }; } catch { return { at: null }; }
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
  const req = readStopRequest(runDir);
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
// Money — piece 2 wires live provider rates; this piece takes a per-attempt
// ceiling as injected data, defaulting to a frozen table's highest entry for
// an unknown model id (never a silent $0/unbounded assumption).
// ---------------------------------------------------------------------------

const CEILING_TABLE_USD = Object.freeze({
  'deepseek-flash': 0.02,
  'synthetic-default': 0.05,
});

/** @param {string|null|undefined} modelId */
export function resolveCeilingUsd(modelId) {
  if (typeof modelId === 'string' && Object.prototype.hasOwnProperty.call(CEILING_TABLE_USD, modelId)) {
    return CEILING_TABLE_USD[modelId];
  }
  return Math.max(...Object.values(CEILING_TABLE_USD));
}

// ---------------------------------------------------------------------------
// The executor — "goal in, gap back", constructed WITHOUT its close and
// WITHOUT the cap (M2 scope item 3, the load-bearing invariant).
// ---------------------------------------------------------------------------

const EXECUTOR_FIELDS = Object.freeze(['goal', 'primitives', 'reads', 'gap']);

/** @param {{goal:string, primitives?:string[], reads?:Record<string,any>, gap?:string|null}} opts */
export function buildExecutorContext(opts) {
  for (const key of Object.keys(opts ?? {})) {
    if (!EXECUTOR_FIELDS.includes(key)) {
      throw new Error(`executor: unknown field "${key}" — only ${EXECUTOR_FIELDS.join(', ')} may cross a step boundary`);
    }
  }
  const {
    goal, primitives = [], reads = {}, gap = null,
  } = opts ?? {};
  return Object.freeze({
    goal,
    primitives: Object.freeze([...primitives]),
    reads: Object.freeze({ ...reads }),
    gap: gap ?? null,
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

/** Copy each named source into `<runDir>/inputs/`, hash the FROZEN copy
 *  (never the original again after this), write `inputs.json`. An
 *  unreadable source refuses by name. */
export function freezeInputs(runDir, sources) {
  const inputsDir = join(runDir, 'inputs');
  mkdirSync(inputsDir, { recursive: true });
  const manifest = [];
  for (const { id, path: sourcePath } of sources ?? []) {
    if (!existsSync(sourcePath)) {
      return { ok: false, red: `freeze: input "${id}" is unreadable at ${sourcePath}` };
    }
    const frozenPath = join(inputsDir, `${id}${extname(sourcePath)}`);
    copyFileSync(sourcePath, frozenPath);
    const sha256 = hashFile(frozenPath);
    const { size: bytes } = statSync(frozenPath);
    manifest.push({
      id, source: sourcePath, frozen: frozenPath, sha256, bytes,
    });
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
function readArtifactsMapChecked(runDir, ids) {
  const map = {};
  for (const id of ids ?? []) {
    const result = readArtifactResult(runDir, id);
    if (!result.ok && !result.missing) {
      return { ok: false, red: `artifact "${id}" — ${result.red}` };
    }
    map[id] = result.ok ? result.value : undefined;
  }
  return { ok: true, map };
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
 * @param {() => string} [opts.now] - M4a-2: stamps each audit row's `at`;
 *   defaults to the real wall clock.
 * @param {(() => boolean)|null} [opts.readStop] - amendment 7 item 8: the run's stop reader, asked before every try and (via modelStep's seam) every model call
 * @param {number} [opts.stepNo] - this step's 1-based number, for the words of a stop row
 * @param {string|null} [opts.prevStepId] - the id of step stepNo-1 (null for step 1): the step a "stopped after step N-1" row is filed under
 * @param {number} [opts.triesDone] - tries a Stop already closed on this step (they count against its limit)
 * @returns {Promise<{ok:true, artifact:any, attempts:number, hitl?:boolean} | {ok:false, outcome:string, red:string, stop?:{where:string, book:Record<string, any>, step?:string|null}}>}
 */
async function runStepRalph({
  step, primitivesMap, readsMap, businessDate, modelStep, spent, capUsd, ceilingUsd, recordAudit, initialGap = null, attemptOffset = 0,
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
    const executorContext = buildExecutorContext({
      goal: step.goal, primitives: step.primitives ?? [], reads: readsMap, gap,
    });

    // `stepMeta` is a SEPARATE argument from `executorContext` — never a
    // field on it. It carries the step's declared close CLASS only (never
    // its shape), so a live `modelStep` can build its `emit_artifact` tool
    // schema without the executor context ever needing to carry one (M2
    // scope item 3's own invariant: the schema is class-only, and the
    // construction test below proves the context itself stays clean).
    const stepMeta = Object.freeze({ class: step.close?.class ?? null });

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
      return stopped(stopWords(ranCalls ? attempt : attempt - 1, turns ?? 0), makeAuditRow({
        step, attempt: ranCalls ? attempt : null, verdict: 'stopped', gap: null, usd, spendComplete: usd !== null, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
      }));
    }

    if (result && result.ok === false && result.transport === true) {
      if (typeof result.costUsd === 'number') spent.value += result.costUsd;
      // Both faults' known costs, summed — the first fault's floor was
      // already added to `spent.value` above (never double-added here); a
      // null second cost never zeroes out a known first floor.
      const usd = sumKnownUsd(attemptFloorUsd, result.costUsd);
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'provider-red', gap, usd, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
      }), result.red ?? 'transport fault twice');
      return { ok: false, outcome: 'provider-red', red: `provider-red: step "${step.goal}" attempt ${attempt}: ${result.red ?? 'transport fault twice'}` };
    }

    if (!result || result.ok !== true) {
      // A non-transport model failure — never thrown, never coerced into a
      // fabricated artifact. Treated as this attempt's red (it is the
      // step's own failure to produce, not a system halt), strike-eligible
      // like any other close red.
      const red = result?.red ?? 'model step failed with no artifact';
      const normalised = normaliseGap(red);
      const strike = seenGaps.has(normalised);
      seenGaps.add(normalised);
      if (strike) strikes += 1;
      const usd = sumKnownUsd(attemptFloorUsd, result?.costUsd);
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'red', gap: red, usd, spendComplete: usd !== null, wallMs, model: result?.model, modelMatch: result?.modelMatch, strike, at: now(), tokens: result?.tokens ?? null, tools: result?.tools ?? null, ungranted: result?.ungranted, refused: result?.refused,
      }), red);
      if (n === maxN) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: step "${step.goal}" — ${red}` };
      if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: step "${step.goal}" — ${red}` };
      gap = red;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (result.costUsd === null || result.costUsd === undefined) {
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'pricing-red', gap, usd: attemptFloorUsd, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
      }), result.artifact ?? null);
      return { ok: false, outcome: 'pricing-red', red: `pricing-red: step "${step.goal}" attempt ${attempt} returned no cost (never "?? 0")` };
    }
    spent.value += result.costUsd;
    const attemptUsd = sumKnownUsd(attemptFloorUsd, result.costUsd);

    // The model's own word, taken at face value — before the happened check,
    // before any close, no exception (M2 amendment 1 item 1). A halt, not a
    // strike, not a retry: `recordAudit`'s modelOutput arg keeps the RAW
    // `result.artifact` (done/blocker included) for log.json; everything
    // downstream of a `done: true` gets the STRIPPED artifact.
    const doneCheck = checkDoneBlocker(step, result.artifact);
    if (doneCheck.verdict === 'not-done') {
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'not-done', gap: doneCheck.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
      }), result.artifact ?? null);
      return { ok: false, outcome: 'not-done', red: doneCheck.red };
    }
    const artifact = stripDoneBlocker(result.artifact);

    const happened = checkArtifactHappened(step, artifact);
    if (happened.verdict === 'red') {
      // Item 5: "or wrote no artifact" strikes unconditionally, every time
      // (never gated by novelty — an empty artifact is always the same
      // failure) — matches poc/m2/gapback.mjs's own rule exactly.
      strikes += 1;
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'red', gap: happened.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: true, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
      }), result.artifact ?? null);
      if (n === maxN) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: ${happened.red}` };
      if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: ${happened.red}` };
      gap = happened.red ?? null;
      // eslint-disable-next-line no-continue
      continue;
    }

    const closed = closeByClass(step, artifact, { reads: readsMap, businessDate });

    if (closed.verdict === 'green' || closed.verdict === 'hitl') {
      recordAudit(makeAuditRow({
        step, attempt, verdict: closed.verdict, gap: null, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
      }), result.artifact);
      return {
        ok: true, artifact, attempts: attempt, hitl: closed.verdict === 'hitl',
      };
    }

    if (closed.verdict !== 'red') {
      // A closer that renders no judgment ('unparseable'/'crash') is a
      // CASUALTY, never a red and never a strike (bareloop F17).
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'close-casualty', gap: closed.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
      }), result.artifact);
      return { ok: false, outcome: 'close-casualty', red: `close-casualty: step "${step.goal}" — ${closed.red} (${closed.verdict})` };
    }

    const normalised = normaliseGap(closed.red);
    const strike = seenGaps.has(normalised);
    seenGaps.add(normalised);
    if (strike) strikes += 1;
    recordAudit(makeAuditRow({
      step, attempt, verdict: 'red', gap: closed.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike, at: now(), tokens: result.tokens ?? null, tools: result.tools ?? null, ungranted: result.ungranted, refused: result.refused,
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
 * @param {number} [opts.ceilingUsd] - per-attempt ceiling override; defaults to `resolveCeilingUsd(null)`.
 * @param {string|null} [opts.initialGap] - M3 scope item 7 (rerun as a fresh
 *   run): a human's rerun reason, carried as the FIRST ordinary step's
 *   starting gap. Never used by a plain `runFlow` call outside `resumeRun`'s
 *   own rerun path.
 * @param {() => number} [opts.nowMs] - F45 finding 3: returns the current
 *   epoch ms; defaults to the wall clock. Mirrors `clock` (ISO) so a test
 *   can advance wall time across a park/resume boundary without a real wait.
 */
export async function runFlow({
  root, name, runId, sources, catalogue, modelStep, askStep, sendStep, primitives, primitiveReds, clock, businessDate, ceilingUsd, initialGap,
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

  const read = readFlow({ root, name, catalogue });
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
  const effectiveCeilingUsd = ceilingUsd ?? resolveCeilingUsd(null);
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
  mkdirSync(runDir, { recursive: true });

  const frozen = freezeInputs(runDir, sources ?? []);
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
        if (stopped) return { type: 'stopped', result: stopped };
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
      const priorReadsResult = readArtifactsMapChecked(runDir, priorStep.reads);
      if (!priorReadsResult.ok) {
        return { type: 'halted', outcome: 'red', red: `redo: step "${priorStep.goal}" ${priorReadsResult.red}` };
      }
      // eslint-disable-next-line no-await-in-loop
      const redoResult = await runStepRalph({
        step: priorStep, primitivesMap: primitives, readsMap: priorReadsResult.map, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit, initialGap: reason, attemptOffset: redone, now,
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
    const readsMapResult = readArtifactsMapChecked(runDir, step.reads);
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
      step, primitivesMap: primitives, readsMap, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit, initialGap: i === i0 ? firstStepGap : null, now,
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
  appendHistory(flowDir, {
    runId, at: now(), outcome: 'complete', spentUsd: spent.value, spendComplete: spendComplete.value, capUsd, wallMs, signatureHash,
  });
  recordLateAnswerIfAny(runDir, now);
  writeLog(runDir, {
    runId, outcome: 'complete', attempts: attemptsLog, artifacts,
  });
  settleStop({ runDir, now, outcome: 'complete' });
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
 * @param {() => number} [opts.nowMs] - F45 finding 3; see `runFlow`'s own.
 */
export async function resumeRun({
  root, name, runId, catalogue, modelStep, sendStep, primitives, primitiveReds, clock, businessDate, ceilingUsd,
  // F45 finding 3 (see `runFlow`'s own `nowMs`): additive, defaults to the
  // real `Date.now` for every existing caller.
  nowMs,
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
  const preflightRead = readFlow({ root, name, catalogue });
  if (preflightRead.ok) {
    const unwiredVerb = findUnwiredVerbStep(preflightRead.declaration);
    if (unwiredVerb) {
      return {
        outcome: 'refused',
        red: unwiredRed(unwiredVerb),
      };
    }
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

    const read = readFlow({ root, name, catalogue });
    if (!read.ok) {
      return { outcome: 'refused', red: `resume: flow re-read failed for run "${runId}": ${read.reds.join('; ')}` };
    }
    const { declaration, signature } = read;
    // M4e amendment 5 item 3 / amendment 4 item 6: the run's own signed values (its highest version) lie over the flow's.
    const applied = applyRunValues(read.arbiter, name, signature.flow, pickRunValues(runDir));
    if (!applied.ok) return { outcome: 'refused', red: `resume: run "${runId}" — ${applied.red}` };
    const { arbiter } = applied;

    if (signature.flow !== state.signatureHash) {
      return { outcome: 'refused', red: `resume: signature mismatch for run "${runId}" — the flow changed while parked` };
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

    // M4e amendment 13: a Stop asked before this answer was saved was asked of a run that was waiting (it landed after the park,
    // before the Stop door could act). The run is stopped AT the ask and the answer to it is not used. A Stop asked after the
    // answer was saved belongs to the apply that follows: the fold's own seam reads it.
    const stopReq = readStopRequest(runDir);
    if (stopReq && !(Date.parse(answer.answeredAt) < Date.parse(stopReq.at ?? ''))) {
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
      appendHistory(flowDir, {
        runId, at: now(), outcome: 'rerun', spentUsd: spent.value, spendComplete: spendComplete.value, capUsd: arbiter.capUsd ?? null, wallMs: getNowMs() - runStartedAt, signatureHash: state.signatureHash,
      });
      recordLateAnswerIfAny(runDir, now);
      writeLog(runDir, { runId, outcome: 'rerun', attempts: [], artifacts: priorArtifactsForLog });

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
    const effectiveCeilingUsd = ceilingUsd ?? resolveCeilingUsd(null);

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
  const refused = (red) => ({ outcome: 'refused', red: `continue: ${red}` });

  const runIdCheck = resolveRunDir(flowDir, runId);
  if (!runIdCheck.ok) return { outcome: 'refused', red: runIdCheck.red };
  const runDir = runIdCheck.runDir;

  const preflightRead = readFlow({ root, name, catalogue });
  if (preflightRead.ok) {
    const unwiredVerb = findUnwiredVerbStep(preflightRead.declaration);
    if (unwiredVerb) return refused(unwiredRed(unwiredVerb));
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

    const read = readFlow({ root, name, catalogue });
    if (!read.ok) return refused(`flow re-read failed for run "${runId}": ${read.reds.join('; ')}`);
    const { declaration, signature } = read;
    if (signature.flow !== halt.signatureHash) return refused(`signature mismatch for run "${runId}" — the flow changed while it was halted`);
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
      effectiveCeilingUsd: ceilingUsd ?? resolveCeilingUsd(null),
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
    try { renameSync(join(runDir, 'ask.json'), join(runDir, `ask.${parkedAskId}.stopped.json`)); } catch {
      return { outcome: 'stopped', red, spentUsd: spent.value }; // another stopper won the rename: it writes the rows
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
    const read = readFlow({ root, name, catalogue });
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
  priorSpendComplete = true, resumeAt = null, stop = null,
}) {
  // F45 finding 3: `startedAt` here is always the RUN's start (every caller
  // now passes `runStartedAt` under this key — see call sites), so `wallMs`
  // times the whole run, pauses included, never just the halting process.
  const wallMs = nowMs() - startedAt;
  const spendComplete = priorSpendComplete
    && outcome !== 'provider-red' && outcome !== 'pricing-red' && outcome !== 'cap-halt';
  mkdirSync(flowDir, { recursive: true });
  appendHistory(flowDir, {
    runId, at: now(), outcome, spentUsd: spent.value, spendComplete, capUsd: capUsd ?? null, wallMs, signatureHash,
  });
  if (existsSync(runDir)) {
    recordLateAnswerIfAny(runDir, now);
    writeLog(runDir, {
      runId, outcome, red, attempts, artifacts,
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
  return { outcome, red, spentUsd: spent.value };
}
