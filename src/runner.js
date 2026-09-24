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
  accessSync, constants as fsConstants, copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync,
  statSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
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
      if (typeof result.costUsd === 'number') spent.value += result.costUsd;
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
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'provider-red', gap, usd: result.costUsd ?? null, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
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
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'red', gap: red, usd: result?.costUsd ?? null, spendComplete: (result?.costUsd ?? null) !== null, wallMs, model: result?.model, modelMatch: result?.modelMatch, strike,
      }), red);
      if (n === MAX_ATTEMPTS) return { ok: false, outcome: 'attempt-fallback', red: `attempt-fallback: step "${step.goal}" — ${red}` };
      if (strikes >= STRIKE_LIMIT) return { ok: false, outcome: 'struck-out', red: `struck-out: step "${step.goal}" — ${red}` };
      gap = red;
      // eslint-disable-next-line no-continue
      continue;
    }

    if (result.costUsd === null || result.costUsd === undefined) {
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'pricing-red', gap, usd: null, spendComplete: false, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
      }), result.artifact ?? null);
      return { ok: false, outcome: 'pricing-red', red: `pricing-red: step "${step.goal}" attempt ${attempt} returned no cost (never "?? 0")` };
    }
    spent.value += result.costUsd;

    // The model's own word, taken at face value — before the happened check,
    // before any close, no exception (M2 amendment 1 item 1). A halt, not a
    // strike, not a retry: `recordAudit`'s modelOutput arg keeps the RAW
    // `result.artifact` (done/blocker included) for log.json; everything
    // downstream of a `done: true` gets the STRIPPED artifact.
    const doneCheck = checkDoneBlocker(step, result.artifact);
    if (doneCheck.verdict === 'not-done') {
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'not-done', gap: doneCheck.red, usd: result.costUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
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
        step, attempt, verdict: 'red', gap: happened.red, usd: result.costUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: true,
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
        step, attempt, verdict: closed.verdict, gap: null, usd: result.costUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
      }), result.artifact);
      return {
        ok: true, artifact, attempts: attempt, hitl: closed.verdict === 'hitl',
      };
    }

    if (closed.verdict !== 'red') {
      // A closer that renders no judgment ('unparseable'/'crash') is a
      // CASUALTY, never a red and never a strike (bareloop F17).
      recordAudit(makeAuditRow({
        step, attempt, verdict: 'close-casualty', gap: closed.red, usd: result.costUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike: false,
      }), result.artifact);
      return { ok: false, outcome: 'close-casualty', red: `close-casualty: step "${step.goal}" — ${closed.red} (${closed.verdict})` };
    }

    const normalised = normaliseGap(closed.red);
    const strike = seenGaps.has(normalised);
    seenGaps.add(normalised);
    if (strike) strikes += 1;
    recordAudit(makeAuditRow({
      step, attempt, verdict: 'red', gap: closed.red, usd: result.costUsd, spendComplete: true, wallMs, model: result.model, modelMatch: result.modelMatch, strike,
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
 * @param {(opts:{question:string, evidence:unknown, runDir:string}) => Promise<{decision:'accept'|'reject'|'rerun'|'timeout', reason?:string}>} opts.askStep
 * @param {(target:string, filename:string, content:unknown) => Promise<{ok:boolean, red?:string, bytes?:number}>} opts.sendStep
 * @param {Record<string, any>} [opts.primitives] - injected primitive implementations, keyed by catalogue verb.
 * @param {() => string} [opts.clock] - returns the current ISO timestamp; defaults to the wall clock.
 * @param {string} opts.businessDate - the run's explicit "as of today", never the wall clock.
 * @param {number} [opts.ceilingUsd] - per-attempt ceiling override; defaults to `resolveCeilingUsd(null)`.
 */
export async function runFlow({
  root, name, runId, sources, catalogue, modelStep, askStep, sendStep, primitives, clock, businessDate, ceilingUsd,
}) {
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();
  const flowDir = join(root, name);
  const startedAt = Date.now();

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
      flowDir, runDir, runId, capUsd, startedAt, now, outcome: 'preflight-red', red: fresh.red, spent: { value: 0 },
    });
  }
  mkdirSync(runDir, { recursive: true });

  const frozen = freezeInputs(runDir, sources ?? []);
  if (!frozen.ok) {
    return haltRun({
      flowDir, runDir, runId, capUsd, startedAt, now, outcome: 'preflight-red', red: frozen.red, spent: { value: 0 },
    });
  }

  const artifacts = {};
  const auditRows = [];
  // Item 3: what the model actually wrote, every attempt, red runs included
  // — kept SEPARATELY from auditRows (which stay the signed book's own
  // shape) and folded into log.json only, on every exit path.
  /** @type {any[]} */
  const attemptsLog = [];
  const recordAudit = (row, modelOutput, unjudgedCount) => {
    // M2 amendment 1 item 2: "audit row for the ask gains unjudgedCount" —
    // only the ask's own rows pass a third argument; every other row is
    // unaffected (the key is simply absent, never a stray 0/null).
    const fullRow = unjudgedCount === undefined ? row : { ...row, unjudgedCount };
    auditRows.push(fullRow);
    appendAudit(runDir, fullRow);
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
  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];

    // --- the signed send slot: never through modelStep, only after an
    // accept THIS run, re-checked at write time. ---
    if (sendLines.has(step.fromLine)) {
      if (!acceptedThisRun) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts,
          outcome: 'red', red: `send: step "${step.goal}" reached with no accept this run`,
        });
      }
      const sendSlot = sendLines.get(step.fromLine);
      if (!sendSlot) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts, outcome: 'red', red: `send: no arbiter slot bound to line ${step.fromLine}`,
        });
      }
      const target = `${sendSlot.target.kind}:${sendSlot.target.path}`;
      const contentArtifactId = (step.reads ?? []).find((id) => readArtifact(runDir, id) !== undefined);
      const content = readArtifact(runDir, contentArtifactId);
      const filename = `${runId}-${step.emits}.json`;
      // eslint-disable-next-line no-await-in-loop
      const sendResult = await sendStep(target, filename, content);
      const sendRow = makeAuditRow({
        step, attempt: 1, verdict: sendResult.ok ? 'green' : 'red', gap: sendResult.ok ? null : sendResult.red, usd: 0, spendComplete: true, wallMs: 0, strike: false,
      });
      recordAudit(sendRow);
      if (!sendResult.ok) {
        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts, outcome: 'red', red: `send: ${sendResult.red}`,
        });
      }
      writeArtifact(runDir, step.emits, content);
      artifacts[step.emits] = content;
      // eslint-disable-next-line no-continue
      continue;
    }

    // --- the signed ask slot: interactive, consume-once, reason-gated redo. ---
    if (askLines.has(step.fromLine)) {
      const askSlot = askLines.get(step.fromLine);
      const priorId = (step.reads ?? [])[0];
      const priorStepIndex = steps.findIndex((s) => s.emits === priorId);
      let priorArtifact = readArtifact(runDir, priorId);
      let redone = 0;

      // M2 amendment 1 item 2: every hitl artifact carried since the
      // previous ask goes to THIS ask as evidence, alongside the ask step's
      // own artifact — then the list resets (a fresh accumulator for the
      // NEXT ask), so a later ask never re-shows what an earlier one covered.
      const evidenceUnjudged = unjudgedSinceLastAsk;
      const unjudgedCount = evidenceUnjudged.length;
      unjudgedSinceLastAsk = [];

      for (;;) {
        const evidence = { artifact: priorArtifact, unjudged: evidenceUnjudged };
        // eslint-disable-next-line no-await-in-loop
        const answer = await askStep({ question: askSlot?.question ?? step.goal, evidence, runDir });

        if (answer.decision === 'timeout') {
          // A pause spends nothing (M2 scope item 6) — a halt, never a red
          // with a fabricated cost, and never re-asked (the run is over).
          recordAudit(makeAuditRow({
            step, attempt: redone + 1, verdict: 'ask-timeout', gap: null, usd: 0, spendComplete: true, wallMs: 0, strike: false,
          }), undefined, unjudgedCount);
          return haltRun({
            flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts,
            outcome: 'ask-timeout', red: `ask-timeout: step "${step.goal}" expired waiting for a human answer`,
          });
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
          writeArtifact(runDir, step.emits, priorArtifact);
          artifacts[step.emits] = priorArtifact;
          acceptedThisRun = true;
          break;
        }

        if (isRedo) {
          redone += 1;
          recordAudit(makeAuditRow({
            step, attempt: redone, verdict: 'red', gap: reason, usd: 0, spendComplete: true, wallMs: 0, strike: false,
          }), undefined, unjudgedCount);
          if (redone > redoCap) {
            return haltRun({
              flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts,
              outcome: 'redo-halt', red: `redo cap ${redoCap} reached at step "${step.goal}" after ${redone} rejections`,
            });
          }
          const priorStep = steps[priorStepIndex];
          const priorReads = readArtifactsMap(runDir, priorStep.reads);
          // eslint-disable-next-line no-await-in-loop
          const redoResult = await runStepRalph({
            step: priorStep, primitivesMap: primitives, readsMap: priorReads, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit, initialGap: reason, attemptOffset: redone,
          });
          if (!redoResult.ok) {
            return haltRun({
              flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts, outcome: redoResult.outcome, red: redoResult.red,
            });
          }
          priorArtifact = redoResult.artifact;
          // A redo deliberately REPLACES the prior step's own artifact —
          // the one case `writeArtifact` allows to overwrite on purpose.
          writeArtifact(runDir, priorId, priorArtifact, { overwrite: true });
          artifacts[priorId] = priorArtifact;
          // eslint-disable-next-line no-continue
          continue;
        }

        return haltRun({
          flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts,
          outcome: 'red', red: `ask: step "${step.goal}" got an unrecognised decision "${answer.decision}"`,
        });
      }
      // eslint-disable-next-line no-continue
      continue;
    }

    // --- an ordinary step: green / softgreen / a non-ask hitl pass-through. ---
    const readsMap = readArtifactsMap(runDir, step.reads);
    // eslint-disable-next-line no-await-in-loop
    const stepResult = await runStepRalph({
      step, primitivesMap: primitives, readsMap, businessDate, modelStep, spent, capUsd, ceilingUsd: effectiveCeilingUsd, recordAudit,
    });
    if (!stepResult.ok) {
      return haltRun({
        flowDir, runDir, runId, capUsd, startedAt, now, spent, attempts: attemptsLog, artifacts, outcome: stepResult.outcome, red: stepResult.red,
      });
    }
    writeArtifact(runDir, step.emits, stepResult.artifact);
    artifacts[step.emits] = stepResult.artifact;
    // M2 amendment 1 item 2: a hitl-class step not bound to a signed ask
    // line (the routing above already guarantees that — this branch is only
    // reached when neither askLines nor sendLines claimed the step) passes
    // through silently here; carry it as evidence for the NEXT signed ask.
    if (stepResult.hitl) {
      unjudgedSinceLastAsk.push({ step: step.goal ?? null, emits: step.emits, artifact: stepResult.artifact });
    }
  }

  const wallMs = Date.now() - startedAt;
  appendHistory(flowDir, {
    runId, at: now(), outcome: 'complete', spentUsd: spent.value, spendComplete: true, capUsd, wallMs, signatureHash: signature.flow,
  });
  recordLateAnswerIfAny(runDir);
  writeLog(runDir, {
    runId, outcome: 'complete', attempts: attemptsLog, artifacts,
  });
  return {
    outcome: 'complete', runDir, artifacts, spentUsd: spent.value, auditRows,
  };
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
 * @param {string} opts.outcome
 * @param {string} [opts.red]
 * @param {{ value: number }} opts.spent
 * @param {any[]} [opts.attempts]
 * @param {Record<string, any>} [opts.artifacts]
 */
function haltRun({
  flowDir, runDir, runId, capUsd, startedAt, now, outcome, red, spent, attempts = [], artifacts = {},
}) {
  const wallMs = Date.now() - startedAt;
  const spendComplete = outcome !== 'provider-red' && outcome !== 'pricing-red' && outcome !== 'cap-halt';
  mkdirSync(flowDir, { recursive: true });
  appendHistory(flowDir, {
    runId, at: now(), outcome, spentUsd: spent.value, spendComplete, capUsd: capUsd ?? null, wallMs, signatureHash: null,
  });
  if (existsSync(runDir)) {
    recordLateAnswerIfAny(runDir);
    writeLog(runDir, {
      runId, outcome, red, attempts, artifacts,
    });
  }
  return { outcome, red, spentUsd: spent.value };
}
