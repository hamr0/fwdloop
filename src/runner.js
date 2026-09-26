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
// a reason-less rerun refused and re-asked, a rejection redoes the step that
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
  dirname, extname, join, resolve, sep,
} from 'node:path';
import { fileURLToPath } from 'node:url';

import { readFlow } from './flow.js';
import { closeByClass } from './closers.js';
import { appendAudit, appendHistory } from './books.js';

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

/** The send target's directory must resolve (lexically AND after
 *  realpath — a symlink inside the repo pointing outside it must not pass)
 *  inside the repo, and be writable. Re-checked at write time, not just at
 *  preflight (time-of-check vs time-of-use, M0's own fix).
 *  @param {string} target
 *  @returns {{ok:true, dir:string} | {ok:false, red:string}} */
export function checkSendDestination(target) {
  const match = /^file:(.+)$/.exec(target ?? '');
  if (!match) return { ok: false, red: `destination: send target "${target}" is not a "file:<path>" target` };
  const dir = join(REPO_ROOT, match[1]);
  const resolvedDir = resolve(dir);
  const resolvedRoot = resolve(REPO_ROOT);
  if (resolvedDir !== resolvedRoot && !resolvedDir.startsWith(resolvedRoot + sep)) {
    return { ok: false, red: `destination: send target "${target}" resolves outside the repo (${dir})` };
  }
  try {
    const realDir = realpathSync(dir);
    const realRoot = realpathSync(REPO_ROOT);
    if (realDir !== realRoot && !realDir.startsWith(realRoot + sep)) {
      return {
        ok: false,
        red: `destination: send target "${target}" is a symlink that resolves outside the repo (${realDir})`,
      };
    }
  } catch {
    // dir doesn't exist yet — handled by the accessSync red below.
  }
  try {
    accessSync(dir, fsConstants.W_OK);
  } catch (err) {
    return { ok: false, red: `destination: send target directory "${dir}" is not writable (${err.code})` };
  }
  return { ok: true, dir };
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
  writeFileSync(target, JSON.stringify(artifact, null, 2));
}

/** Reads one artifact back off disk; `undefined` when it was never written
 *  (mirrors the in-memory map's own "absent" shape for a not-yet-produced
 *  read). */
export function readArtifact(runDir, id) {
  const target = artifactPath(runDir, id);
  if (!existsSync(target)) return undefined;
  return JSON.parse(readFileSync(target, 'utf8'));
}

function readArtifactsMap(runDir, ids) {
  return Object.fromEntries((ids ?? []).map((id) => [id, readArtifact(runDir, id)]));
}

// ---------------------------------------------------------------------------
// Item 4 (small): an `answer.json` still on disk, unconsumed, at run end —
// a late human answer that arrived after the run already moved on. One
// audit row, never applied, so the human can see their late answer changed
// nothing.
// ---------------------------------------------------------------------------

function recordLateAnswerIfAny(runDir) {
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

function makeAuditRow({
  step, attempt, verdict, gap, usd, spendComplete, wallMs, model = null, modelMatch = null, strike,
}) {
  return {
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
  };
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
 * @param {(executorContext:object, grantedTools:Record<string,any>, stepMeta?:{class:string|null}) => Promise<any>} opts.modelStep
 * @param {{ value: number }} opts.spent
 * @param {number} opts.capUsd
 * @param {number} opts.ceilingUsd
 * @param {(row: any, modelOutput?: any) => void} opts.recordAudit
 * @param {string|null} [opts.initialGap]
 * @param {number} [opts.attemptOffset]
 * @returns {Promise<{ok:true, artifact:any, attempts:number, hitl?:boolean} | {ok:false, outcome:string, red:string}>}
 */
async function runStepRalph({
  step, primitivesMap, readsMap, businessDate, modelStep, spent, capUsd, ceilingUsd, recordAudit, initialGap = null, attemptOffset = 0,
}) {
  /** @type {string|null} */
  let gap = initialGap ?? null;
  let strikes = 0;
  const seenGaps = new Set();

  for (let n = 1; n <= MAX_ATTEMPTS; n += 1) {
    const attempt = attemptOffset + n;
    // This attempt's known floor from a FIRST transport fault that then
    // retried — every audit row this attempt still writes must carry this
    // floor summed with its own cost (F41 books gap: the fault's cost was
    // only ever in `spent.value`'s total, never on the attempt's own row).
    let attemptFloorUsd = null;
    if (spent.value + ceilingUsd > capUsd) {
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'cap-halt', gap, usd: null, spendComplete: false, wallMs: 0, strike: false,
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

    const startedAt = Date.now();
    // eslint-disable-next-line no-await-in-loop
    let result = await modelStep(executorContext, grantedTools, stepMeta);
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
      // eslint-disable-next-line no-await-in-loop
      result = await modelStep(executorContext, grantedTools, stepMeta);
    }
    const wallMs = Date.now() - startedAt;

    if (result && result.ok === false && result.transport === true) {
      if (typeof result.costUsd === 'number') spent.value += result.costUsd;
      // Both faults' known costs, summed — the first fault's floor was
      // already added to `spent.value` above (never double-added here); a
      // null second cost never zeroes out a known first floor.
      const usd = sumKnownUsd(attemptFloorUsd, result.costUsd);
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'provider-red', gap, usd, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
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
        step, attempt, verdict: 'red', gap: red, usd, spendComplete: usd !== null, wallMs, model: result?.model, modelMatch: result?.modelMatch, strike,
      }), red);
      if (n === MAX_ATTEMPTS) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: step "${step.goal}" — ${red}` };
      if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: step "${step.goal}" — ${red}` };
      gap = red;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (result.costUsd === null || result.costUsd === undefined) {
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'pricing-red', gap, usd: attemptFloorUsd, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
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
        step, attempt, verdict: 'not-done', gap: doneCheck.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
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
        step, attempt, verdict: 'red', gap: happened.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: true,
      }), result.artifact ?? null);
      if (n === MAX_ATTEMPTS) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: ${happened.red}` };
      if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: ${happened.red}` };
      gap = happened.red ?? null;
      // eslint-disable-next-line no-continue
      continue;
    }

    const closed = closeByClass(step, artifact, { reads: readsMap, businessDate });

    if (closed.verdict === 'green' || closed.verdict === 'hitl') {
      recordAudit(makeAuditRow({
        step, attempt, verdict: closed.verdict, gap: null, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
      }), result.artifact);
      return {
        ok: true, artifact, attempts: attempt, hitl: closed.verdict === 'hitl',
      };
    }

    if (closed.verdict !== 'red') {
      // A closer that renders no judgment ('unparseable'/'crash') is a
      // CASUALTY, never a red and never a strike (bareloop F17).
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'close-casualty', gap: closed.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
      }), result.artifact);
      return { ok: false, outcome: 'close-casualty', red: `close-casualty: step "${step.goal}" — ${closed.red} (${closed.verdict})` };
    }

    const normalised = normaliseGap(closed.red);
    const strike = seenGaps.has(normalised);
    seenGaps.add(normalised);
    if (strike) strikes += 1;
    recordAudit(makeAuditRow({
      step, attempt, verdict: 'red', gap: closed.red, usd: attemptUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike,
    }), result.artifact);

    if (n === MAX_ATTEMPTS) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: step "${step.goal}" — ${closed.red}` };
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
 * @param {(opts:{question:string, evidence:unknown, runDir:string}) => Promise<{decision:'accept'|'reject'|'rerun'|'timeout'|'park', reason?:string}>} opts.askStep
 * @param {(target:string, filename:string, content:unknown) => Promise<{ok:boolean, red?:string, bytes?:number}>} opts.sendStep
 * @param {Record<string, any>} [opts.primitives] - injected primitive implementations, keyed by catalogue verb.
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
  root, name, runId, sources, catalogue, modelStep, askStep, sendStep, primitives, clock, businessDate, ceilingUsd, initialGap,
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

  const { arbiter, declaration, signature } = read;
  const capUsd = arbiter.capUsd;
  const redoCap = arbiter.redoCap ?? 3;
  const effectiveCeilingUsd = ceilingUsd ?? resolveCeilingUsd(null);
  const askLines = new Map((arbiter.asks ?? []).map((a) => [a.line, a]));
  const sendLines = new Map((arbiter.sends ?? []).map((s) => [s.line, s]));

  const runDir = join(flowDir, 'runs', runId);

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
        step: row.step, attempt: row.attempt, class: row.class, verdict: row.verdict, gap: row.gap, modelOutput,
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
  const acceptedAskEmitsThisRun = new Set();

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
 *  a reject and the ask loops back around to ask again — parks under a NEW
 *  askId, exactly like a fresh ask would. This is what turns "redo, then
 *  ask again" into "redo, then re-park" for a resumed run, with no second
 *  code path. */
function makeOneShotThenParkAskStep({ decision, reason }) {
  let used = false;
  return async function resumeAskStep() {
    if (!used) {
      used = true;
      return { decision, reason };
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
  step, stepIndex, askSlot, priorId, priorStep, priorArtifact, redoCap, effectiveCeilingUsd, capUsd,
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
    const answer = await askStep({
      question: askSlot?.question ?? step.goal, evidence, runDir, ttlMs: askSlot?.ttlMs, stepIndex,
    });

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
      // loop iteration (including a re-park after a reject, where
      // `currentPrior` is the just-redrafted artifact), so this write always
      // carries the CURRENT evidence, not a stale first-park copy.
      writeFileSync(join(runDir, 'ask.json'), JSON.stringify({
        askId, question: askSlot?.question ?? step.goal, askedAt, expiresAt, evidence,
      }, null, 2));
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
        step, attempt: redone + 1, verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, strike: false,
      }), undefined, unjudgedCount);
      // Orchestrator review fix (3): M2 item 9 says history is ONE row per
      // run; M3's signed scope item 2 only asks for an AUDIT row "paused"
      // (already recorded above). A "paused" HISTORY row was the earlier
      // draft's own error — removed here. The run's one history row lands
      // at its final outcome (complete / a halt / ask-expired), written by
      // `foldFromStep`/`resumeRun`, never here.
      writeLog(runDir, { runId, outcome: 'paused', attempts: attemptsLog, artifacts });
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
        step, attempt: redone + 1, verdict: 'ask-timeout', gap: null, usd: 0, spendComplete: true, wallMs: 0, strike: false,
      }), undefined, unjudgedCount);
      return {
        type: 'halted',
        outcome: 'ask-timeout',
        red: `ask-timeout: step "${step.goal}" expired waiting for a human answer`,
      };
    }

    const isRedo = answer.decision === 'reject' || answer.decision === 'rerun';
    const reason = typeof answer.reason === 'string' ? answer.reason.trim() : '';

    if (isRedo && reason.length === 0) {
      recordAudit(makeAuditRow({
        step, attempt: redone + 1, verdict: 'refused', gap: 'a rejection/rerun needs a reason', usd: 0, spendComplete: true, wallMs: 0, strike: false,
      }), undefined, unjudgedCount);
      // Refused, re-asked for the SAME attempt — never re-runs the step.
      // eslint-disable-next-line no-continue
      continue;
    }

    if (answer.decision === 'accept') {
      recordAudit(makeAuditRow({
        step, attempt: redone + 1, verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 0, strike: false,
      }), undefined, unjudgedCount);
      return { type: 'accepted', artifact: currentPrior };
    }

    if (isRedo) {
      redone += 1;
      recordAudit(makeAuditRow({
        step, attempt: redone, verdict: 'red', gap: reason, usd: 0, spendComplete: true, wallMs: 0, strike: false,
      }), undefined, unjudgedCount);
      if (redone > redoCap) {
        return {
          type: 'halted',
          outcome: 'redo-halt',
          red: `redo cap ${redoCap} reached at step "${step.goal}" after ${redone} rejections`,
        };
      }
      const priorReads = readArtifactsMap(runDir, priorStep.reads);
      // eslint-disable-next-line no-await-in-loop
      const redoResult = await runStepRalph({
        step: priorStep, primitivesMap: primitives, readsMap: priorReads, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit, initialGap: reason, attemptOffset: redone,
      });
      if (!redoResult.ok) {
        return { type: 'halted', outcome: redoResult.outcome, red: redoResult.red };
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
}) {
  let runAcceptedThisRun = acceptedThisRun;
  let runUnjudged = unjudgedSinceLastAsk;

  for (let i = i0; i < steps.length; i += 1) {
    const step = steps[i];

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
      const content = readArtifact(runDir, askArtifactId);
      const filename = `${runId}-${step.emits}.json`;
      // eslint-disable-next-line no-await-in-loop
      const sendResult = await sendStep(target, filename, content);
      const sendRow = makeAuditRow({
        step, attempt: 1, verdict: sendResult.ok ? 'green' : 'red', gap: sendResult.ok ? null : sendResult.red, usd: 0, spendComplete: true, wallMs: 0, strike: false,
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
      const priorArtifact = readArtifact(runDir, priorId);

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
        redone: 0,
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

      if (askResult.type === 'paused') return askResult.result;
      if (askResult.type === 'halted') {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts, outcome: askResult.outcome, red: askResult.red,
        });
      }

      writeArtifact(runDir, step.emits, askResult.artifact);
      artifacts[step.emits] = askResult.artifact;
      runAcceptedThisRun = true;
      acceptedAskEmitsThisRun.add(step.emits);
      // eslint-disable-next-line no-continue
      continue;
    }

    // --- an ordinary step: green / softgreen / a non-ask hitl pass-through. ---
    const readsMap = readArtifactsMap(runDir, step.reads);
    // M3 scope item 7: a fresh rerun's own first step (and only that one —
    // `i === i0` is this fold's own starting point, never any later step)
    // starts with the human's rerun reason as its gap, exactly like a
    // redo's `initialGap` above.
    // eslint-disable-next-line no-await-in-loop
    const stepResult = await runStepRalph({
      step, primitivesMap: primitives, readsMap, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit, initialGap: i === i0 ? firstStepGap : null,
    });
    if (!stepResult.ok) {
      return haltRun({
        flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts, outcome: stepResult.outcome, red: stepResult.red,
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
  recordLateAnswerIfAny(runDir);
  writeLog(runDir, {
    runId, outcome: 'complete', attempts: attemptsLog, artifacts,
  });
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
 * @returns {{ ok: true, total: number } | { ok: false, red: string }}
 */
function sumAuditUsd(runDir) {
  const auditPath = join(runDir, 'audit.jsonl');
  if (!existsSync(auditPath)) return { ok: true, total: 0 };
  const lines = readFileSync(auditPath, 'utf8').split('\n').filter((line) => line.trim().length > 0);
  let total = 0;
  for (const line of lines) {
    let row;
    try {
      row = JSON.parse(line);
    } catch (err) {
      return { ok: false, red: `audit.jsonl line is not valid JSON — ${err.message}` };
    }
    if (typeof row.usd !== 'number' || !Number.isFinite(row.usd)) {
      return { ok: false, red: `audit.jsonl carries a row whose "usd" is not a finite number (got ${JSON.stringify(row.usd)}) — refusing to sum past an unpriced round` };
    }
    total += row.usd;
  }
  return { ok: true, total };
}

/**
 * M3 scope items 4-6: re-enter a parked run's SAME fold from a separate
 * process. Takes an exclusive `resume.lock` (refuses by name if already
 * held; a lock left behind by a killed resumer is a red naming it, never
 * stolen), re-reads the flow, refuses by name at $0 on any signature/input/
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
 * @param {() => string} [opts.clock]
 * @param {string} opts.businessDate
 * @param {number} [opts.ceilingUsd]
 * @param {() => number} [opts.nowMs] - F45 finding 3; see `runFlow`'s own.
 */
export async function resumeRun({
  root, name, runId, catalogue, modelStep, sendStep, primitives, clock, businessDate, ceilingUsd,
  // F45 finding 3 (see `runFlow`'s own `nowMs`): additive, defaults to the
  // real `Date.now` for every existing caller.
  nowMs,
}) {
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();
  const getNowMs = typeof nowMs === 'function' ? nowMs : Date.now;
  const flowDir = join(root, name);
  const runDir = join(flowDir, 'runs', runId);
  const startedAt = getNowMs();
  const lockPath = join(runDir, 'resume.lock');

  let lockFd;
  try {
    lockFd = openSync(lockPath, 'wx');
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { outcome: 'refused', red: `resume: run "${runId}" is locked by another resumer (${lockPath})` };
    }
    return { outcome: 'refused', red: `resume: could not create lock ${lockPath} — ${err.message}` };
  }

  try {
    const statePath = join(runDir, 'state.json');
    if (!existsSync(statePath)) {
      return { outcome: 'refused', red: `resume: no parked state for run "${runId}" (${statePath})` };
    }
    let state;
    try {
      state = JSON.parse(readFileSync(statePath, 'utf8'));
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
    if (state.flow?.root !== root || state.flow?.name !== name) {
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
    const { declaration, arbiter, signature } = read;

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

    const { steps } = declaration;
    for (let i = 0; i < state.stepIndex; i += 1) {
      if (readArtifact(runDir, steps[i].emits) === undefined) {
        return { outcome: 'refused', red: `resume: artifact "${steps[i].emits}" missing for run "${runId}" — cannot resume` };
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
    if (!existsSync(answerPath)) {
      return { outcome: 'refused', red: `resume: no answer yet for run "${runId}"` };
    }
    let answer;
    try {
      answer = JSON.parse(readFileSync(answerPath, 'utf8'));
    } catch (err) {
      return { outcome: 'refused', red: `resume: answer.json for run "${runId}" is not valid JSON — ${err.message}` };
    }
    if (answer.askId !== state.askId) {
      return { outcome: 'refused', red: `resume: answer askId "${answer.askId}" does not match open askId "${state.askId}" for run "${runId}"` };
    }

    // Consume-once, BEFORE acting on the decision (F44) — the rename is
    // itself a one-winner gate, on top of the lock above.
    const consumedPath = join(runDir, `answer.${answer.askId}.consumed.json`);
    renameSync(answerPath, consumedPath);

    // The run's own injected clock governs expiry, exactly like every other
    // "now" in this module (never the bare wall clock) — the same fixed
    // clock a test controls for `runFlow` also controls what "expired" means
    // for `resumeRun`, with no real wait required to prove it.
    if (Date.parse(now()) > Date.parse(state.expiresAt)) {
      // Negative (i): an answer arriving after expiry cancels the run —
      // adds NOTHING further, but the run's own already-spent total is
      // real money and must be reported, never coerced to 0 (orchestrator
      // review fix 2: "a pause spends nothing" means the pause adds
      // nothing, not that the run's total resets).
      appendAudit(runDir, {
        step: null, attempt: null, class: null, verdict: 'ask-expired', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
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

      const priorArtifactsForLog = {};
      for (let i = 0; i < state.stepIndex; i += 1) {
        priorArtifactsForLog[steps[i].emits] = readArtifact(runDir, steps[i].emits);
      }
      appendHistory(flowDir, {
        runId, at: now(), outcome: 'rerun', spentUsd: spent.value, spendComplete: spendComplete.value, capUsd: arbiter.capUsd ?? null, wallMs: getNowMs() - runStartedAt, signatureHash: state.signatureHash,
      });
      recordLateAnswerIfAny(runDir);
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

    if (answer.decision !== 'accept' && answer.decision !== 'reject') {
      return { outcome: 'refused', red: `resume: unrecognised decision "${answer.decision}" for run "${runId}"` };
    }

    // Reconstruct the fold's accumulators from disk + state.json — never
    // re-running a step that already went green (M3 scope item 4).
    const artifacts = {};
    for (let i = 0; i < state.stepIndex; i += 1) {
      artifacts[steps[i].emits] = readArtifact(runDir, steps[i].emits);
    }
    const askLines = new Map((arbiter.asks ?? []).map((a) => [a.line, a]));
    const sendLines = new Map((arbiter.sends ?? []).map((s) => [s.line, s]));
    const askStepEmits = new Set(steps.filter((s) => askLines.has(s.fromLine)).map((s) => s.emits));
    const acceptedAskEmitsThisRun = new Set();
    for (const emits of askStepEmits) {
      const idx = steps.findIndex((s) => s.emits === emits);
      if (idx !== -1 && idx < state.stepIndex && readArtifact(runDir, emits) !== undefined) {
        acceptedAskEmitsThisRun.add(emits);
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
          step: row.step, attempt: row.attempt, class: row.class, verdict: row.verdict, gap: row.gap, modelOutput,
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
    const priorArtifact = readArtifact(runDir, priorId);

    const oneShotAskStep = makeOneShotThenParkAskStep({ decision: answer.decision, reason: answer.reason });

    const askResult = await runAskSlot({
      step,
      stepIndex: state.stepIndex,
      askSlot,
      priorId,
      priorStep: steps[priorStepIndex],
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

    if (askResult.type === 'paused') return askResult.result;
    if (askResult.type === 'halted') {
      return haltRun({
        flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs: getNowMs, signatureHash: state.signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts, outcome: askResult.outcome, red: askResult.red,
      });
    }

    // accepted — write the ask step's own artifact, then fold on to
    // whatever comes next (another signed ask parks again; the ordinary
    // send/step path completes exactly as `runFlow` would have, in-process).
    writeArtifact(runDir, step.emits, askResult.artifact);
    artifacts[step.emits] = askResult.artifact;
    acceptedAskEmitsThisRun.add(step.emits);

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
    try { closeSync(lockFd); } catch { /* already closed */ }
    try { unlinkSync(lockPath); } catch { /* already gone */ }
  }
}

/** log.json's one writer, called from every exit path (complete + every
 *  halt) — M2 scope item 9 / the M0 ruling: what the model wrote, every
 *  attempt, red runs included, never just the final artifacts. */
function writeLog(runDir, payload) {
  writeFileSync(join(runDir, 'log.json'), JSON.stringify(payload, null, 2));
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
 */
function haltRun({
  flowDir, runDir, runId, capUsd, startedAt, now, nowMs = Date.now, outcome, red, spent, attempts = [], artifacts = {}, signatureHash = null,
  priorSpendComplete = true,
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
    recordLateAnswerIfAny(runDir);
    writeLog(runDir, {
      runId, outcome, red, attempts, artifacts,
    });
  }
  return { outcome, red, spentUsd: spent.value };
}
