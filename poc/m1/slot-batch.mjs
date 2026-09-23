// M1 — the counting script (item 3 of the brief). Runs N drafter rounds on
// one grammar ("slot" = the M1 ask-slot grammar via drafter.mjs's ADDITIVE
// `slotGrammar`/`askLines` option, "legacy" = today's unfenced menu) and
// records, per draft, whether validator.mjs's walkable-chain check and
// poc/m1/slots.mjs's checkAskSlots both land green — this is the mechanical
// count that answers F10's question: does the slot grammar actually kill the
// ask-count wobble, measured, not asserted.
//
// $0 and zero network under `node --test`: every test injects a fake
// provider straight into `runDrafter` (the same seam drafter.test.mjs's own
// fakeProvider uses), never a real makeProvider/OpenAI call. The live path
// (no injected `providerForDraft`) is opt-in only via the CLI block at the
// bottom, which the orchestrator runs, never this file's own tests.

import {
  readFileSync, writeFileSync, existsSync, mkdirSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runDrafter, draftJob2 } from '../m0/drafter.mjs';
import { validate } from '../m0/validator.mjs';
import { checkShapes } from '../../src/declaration.js';
import { lookFixtures, groundFacts, scoutJob2 } from '../m0/scout.mjs';
import { makeProvider, resolveModelRate, PROVIDER_SLOTS } from '../m0/provider.mjs';
import {
  classifyModelId, assertUnderGlobalCap, appendSpendRow, ceilingCostUsd,
} from '../m0/spend.mjs';

// Re-exported so callers/tests of this script have one place to import the ceiling from — this
// script no longer keeps its own local copy (that helper was deleted in favour of the one
// writer in poc/m0/spend.mjs).
export { ceilingCostUsd };
import { parseAskSlots, checkAskSlots } from './slots.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const OUT_DIR = join(__dirname, 'out');
const PROSE_PATH = join(REPO_ROOT, 'poc', 'm0', 'prose.txt');
const CSV_PATH = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
const TEXT_PATH = join(REPO_ROOT, 'fixtures', 'message.txt');

// --job job1|job2|twoask — which prose (and which paid round: job #1/twoask
// run through runDrafter, job #2 through its own draftJob2) this batch runs
// against. `job1` is the default so every existing caller/test is untouched.
export const JOBS = Object.freeze(['job1', 'job2', 'twoask']);
const JOB2_PROSE_PATH = join(REPO_ROOT, 'poc', 'm0', 'job2.prose.txt');
const TWOASK_PROSE_PATH = join(__dirname, 'fixtures', 'twoask.prose.txt');

/** The prose file path for a given `--job` value. Throws naming the bad value — never a silent
 *  fallback to job #1's file. */
export function prosePathForJob(job) {
  if (job === 'job1') return PROSE_PATH;
  if (job === 'job2') return JOB2_PROSE_PATH;
  if (job === 'twoask') return TWOASK_PROSE_PATH;
  throw new Error(`slot-batch: --job must be one of ${JOBS.join('|')}, got "${job}"`);
}

// M1's own $5.00 cap, signed 2026-09-21 — separate from M0's own $5.00
// GLOBAL_CAP_USD (poc/m0/spend.mjs): a different signature, a different
// ledger file (poc/m1/out/spend.jsonl, never poc/m0/out/spend.jsonl), even
// though the two numbers happen to match today. `assertUnderGlobalCap`/
// `appendSpendRow` themselves are reused UNCHANGED from spend.mjs (one
// writer for the mechanism); only the path and the cap number are M1's own.
export const M1_CAP_USD = 5.00;

/** The live CLI's default M1 spend ledger path — a small pure function so this is testable
 *  without running the CLI (never poc/m0/out/spend.jsonl; M1's ledger is its own file). */
export function defaultM1SpendPath(outDir = OUT_DIR) {
  return join(outDir, 'spend.jsonl');
}

export const DEFAULT_DEADLINE_MS = 240_000;

/**
 * The real fixture facts, built the exact same way drafter.test.mjs's own
 * `REAL_FACTS`/poc/m1/drafter-slot.test.mjs's `realFacts()` build them:
 * `lookFixtures` (mechanical, $0) then `groundFacts` (mechanical grounding
 * of a reported column list — here, the mechanical header itself, since
 * this script runs no scout model round of its own; the drafter round is
 * the only paid step this script ever spends on).
 */
export function realFacts() {
  const { csvArtifact, textArtifact } = lookFixtures(CSV_PATH, TEXT_PATH);
  return groundFacts({ csvColumns: csvArtifact.header }, { csvArtifact, textArtifact });
}

/**
 * The bar-file path discipline (borrowed-from poc/m0/batch.mjs's own naming, never imported).
 * `job` defaults to 'job1' so every existing 3-arg call keeps TODAY's exact naming
 * (`slot-batch-<grammar>-<tag>`, no job segment) — consumed job #1 evidence still resolves
 * under `--rescore` with no `--job` given. job2/twoask get their own segment
 * (`slot-batch-<grammar>-<job>-<tag>`) so a tag can never collide across jobs.
 */
export function outFilePaths(grammar, tag, outDir = OUT_DIR, job = 'job1') {
  const suffix = job === 'job1' ? `${grammar}-${tag}` : `${grammar}-${job}-${tag}`;
  return {
    jsonlPath: join(outDir, `slot-batch-${suffix}.jsonl`),
    declDir: join(outDir, `slot-batch-${suffix}`),
  };
}

/**
 * Redact every literal occurrence of each string in `secrets` (length >= 8)
 * out of `text`, replacing it with the fixed literal `[redacted-key]` via
 * `String.prototype.split`/`join` — never a `RegExp` built from input (a
 * secret can contain regex metacharacters; a literal split/join has no such
 * hazard). Non-string `text` is returned unchanged (never coerced, never
 * thrown on). A secret shorter than 8 characters is skipped entirely, so an
 * unset/empty/short env var can never blank out ordinary text.
 *
 * `secrets` defaults to `[]` — every existing caller of `runOneDraft`/
 * `runSlotBatch` (every test, and this file's own CLI block before this
 * fix) is byte-identical, since an empty list redacts nothing.
 *
 * What this does NOT catch, by design: a MASKED or TRUNCATED echo of the
 * key (e.g. a provider printing only its first 4 + last 4 characters, or a
 * proxy hashing it). That is not a literal occurrence of the secret string
 * this process holds, so it is not "the secret" under this mechanism and is
 * left alone — a broader heuristic (fuzzy/partial matching) is exactly the
 * kind of RegExp-from-input hazard this function is built to avoid.
 */
export function redactSecrets(text, secrets = []) {
  if (typeof text !== 'string') return text;
  let result = text;
  for (const secret of secrets) {
    if (typeof secret === 'string' && secret.length >= 8) {
      result = result.split(secret).join('[redacted-key]');
    }
  }
  return result;
}

/**
 * Builds the `secrets` list `redactSecrets` scrubs for, from ONE raw env
 * value — the ONE place this list is ever built (the CLI block below is the
 * ONE caller; nothing else constructs this list).
 *
 * Live edge: bare-agent's own provider TRIMS the key before it ever goes on
 * the wire (`node_modules/bare-agent/src/provider-openai.js:74`,
 * `this.apiKey = options.apiKey?.trim()`), so a provider echo of the live
 * key is the TRIMMED form. If the env var itself carries a trailing
 * newline/space (an un-`tr -d`'d `pass` entry — the exact live shape
 * `checkKeyPreflight` already refuses to draft against), building `secrets`
 * from the raw value alone means the literal string `redactSecrets` looks
 * for is never the one the provider can actually echo back — the trimmed
 * echo sails straight past it.
 *
 * Returns `[]` for a non-string value or one that is empty/whitespace-only
 * after trimming (never redacts against nothing — `redactSecrets`'s own
 * length >= 8 gate is the second, independent guard against that). Returns
 * `[trimmed]` when the value has no surrounding whitespace to strip, or
 * `[trimmed, raw]` (trimmed FIRST) when trimming changed the value — so
 * EITHER the wire form or a literal echo of the untrimmed env value is
 * caught, without ever inventing a third form.
 */
export function secretsFromEnv(envValue) {
  if (typeof envValue !== 'string') return [];
  const trimmed = envValue.trim();
  if (trimmed === '') return [];
  return trimmed === envValue ? [trimmed] : [trimmed, envValue];
}

/**
 * Reads `draft-<i>.json` and returns either a real declaration object, or
 * `null` for "no declaration" — treating a legacy bare `null` file (every
 * draft saved before this fix) and this fix's own wrapper object
 * (`{ declaration: null, outcome, ... }`, from `buildNoDeclarationArtifact`)
 * identically, so `--rescore` never has to know which era wrote the file.
 * A wrapper object is told apart from a real declaration by the OWN marker
 * (`declaration === null` on the parsed object) — never by shape-guessing
 * (a real declaration has no `declaration` key of its own to collide with).
 */
export function readDraftDeclaration(declPath) {
  const raw = JSON.parse(readFileSync(declPath, 'utf8'));
  if (raw === null) return null;
  if (raw && typeof raw === 'object' && !Array.isArray(raw)
    && Object.prototype.hasOwnProperty.call(raw, 'declaration') && raw.declaration === null) {
    return null;
  }
  return raw;
}

/**
 * Refuse to start if this grammar+tag already has ≥1 recorded line — never
 * overwrite live evidence (same discipline as poc/m0/batch.mjs's
 * `writeBarFile`). A zero-byte or missing file is fine to start against.
 */
export function assertFreshTag(jsonlPath) {
  if (!existsSync(jsonlPath)) return;
  const lines = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim());
  if (lines.length > 0) {
    throw new Error(`slot-batch: ${jsonlPath} already has ${lines.length} result(s) — use a new --tag, never overwrite live evidence`);
  }
}

/**
 * A promise that resolves `{ __timedOut: true }` after `ms`, races against
 * `runDrafter` below — plus a `cancel()` to clear the underlying timer once
 * the race is decided. `Promise.race` never cancels its LOSING side on its
 * own: when `runDrafter` wins (the common case), this timer would otherwise
 * sit armed for the full deadline (240s default) and keep the process alive
 * that whole time even though the draft already finished — measured live:
 * exactly this left `node --test` unable to exit for ~240s per draft that
 * won the race. `cancel()` must be called in a `finally` by every caller.
 */
function timeoutAfter(ms) {
  let timer;
  const promise = new Promise((resolve) => {
    timer = setTimeout(() => resolve({ __timedOut: true }), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

/**
 * $0 preflight, before any draft round and before any ledger write: the key
 * env var for `slotName` (poc/m0/provider.mjs's PROVIDER_SLOTS is the ONE
 * writer for the var name per slot — never a second table here) must be
 * set, non-empty, and free of any whitespace/control character.
 *
 * Live failure (2026-09-21): a two-line `pass` entry exported
 * DEEPSEEK_API_KEY with a trailing newline. A newline-terminated string is
 * still truthy, so makeProvider's own `if (!apiKey) throw` never caught it
 * — the defect only surfaced 6ms into the real fetch call, deep inside
 * runOneDraft's try/catch, AFTER assertUnderGlobalCap had already passed for
 * that iteration, and got recorded as a genuinely-unknown-cost provider red
 * (see the classifier below) that then locked m0's global cap for every run
 * after it. Checking this BEFORE the loop starts turns that into a $0,
 * zero-row red instead.
 *
 * `env` is injectable (defaults to `process.env`) so a test never needs to
 * mutate the real process environment. Never throws itself — returns
 * `{ ok: true }` or `{ ok: false, message }` so the CLI block controls the
 * exit path (print + exit 1, write no row to any file). `message` never
 * includes the key's value or its length beyond "contains whitespace".
 */
export function checkKeyPreflight(slotName, env = process.env) {
  const slotDef = PROVIDER_SLOTS[slotName];
  if (!slotDef) return { ok: false, message: `key: unknown provider slot "${slotName}"` };
  const varName = slotDef.envVar;
  const value = env[varName];
  if (value === undefined || value === '') {
    return { ok: false, message: `key: ${varName} is not set — export it before running` };
  }
  if (/[\r\n]/.test(value)) {
    return { ok: false, message: `key: ${varName} contains a newline — export only the first line of the pass entry` };
  }
  // eslint-disable-next-line no-control-regex -- deliberately matching whitespace/control chars, never logged
  if (/[\s\x00-\x1F\x7F]/.test(value)) {
    return { ok: false, message: `key: ${varName} contains whitespace/control characters — export only the first line of the pass entry` };
  }
  return { ok: true };
}

/**
 * Coarse stopReason, derived from what `runDrafter`'s report actually
 * exposes (it does not surface the provider's raw stopReason string — this
 * script never edits drafter.mjs a second time to add one, per the M1
 * brief's "one additive option only"). Named plainly so a reader never
 * mistakes it for the provider's own field.
 */
function deriveStopReason(report) {
  if (report.absent) return 'absent-facts';
  if (report.refusedSlotGrammar) return 'refused-no-slots';
  if (report.toolCalled) return 'tool-called';
  if (report.textInstead != null) return 'no-tool-call';
  return 'unknown';
}

/**
 * The "a red run keeps what the model wrote" artifact for a draft that
 * produced NO declaration — F33/F34 (draft 1 of job #2, draft 10 of
 * two-ask, draft 8 of job #2): before this, `draft-<i>.json` was the
 * literal `null` for every one of these outcomes, throwing away the one
 * thing that would tell a right check from a broken one afterwards.
 *
 * Only the THREE outcomes this batch actually distinguishes get an object
 * here: `no-tool-call` / `unknown` (the model answered in text, or
 * finished with neither a tool call nor text — `deriveStopReason`'s own
 * two non-refusal, non-tool-called buckets), `provider-red` (the provider
 * threw), and `timeout` (the deadline race lost). `absent-facts` and
 * `refused-no-slots` are UNCHANGED by this fix and still persist as the
 * bare `null` — those are $0 refusals this script makes itself, before any
 * provider round, never observed live losing an artifact (the two live
 * gaps this fix closes are both mid-round outcomes), and out of this
 * task's stated three-outcome scope.
 *
 * Deliberately thrown away, not persisted (declared here per the "every
 * summary declares what it drops" rule):
 *   - `modelReturned`/`suffixMatch`/`rateSource`/`costUsd`/`rateSource` off
 *     the drafter report — already the ONE writer's job (`runOneDraft`'s
 *     own return record, and its jsonl row) to carry the run's costing;
 *     duplicating them into the per-draft file would be a second writer
 *     for the same fact.
 *   - a literal `stopReason` key: `outcome` (below) IS this script's own
 *     name for exactly the same derived classification `deriveStopReason`
 *     produces and the jsonl row's own `stopReason` field already carries
 *     — a second key holding the identical value would be a faked-looking
 *     duplicate, not a distinct fact, so it is omitted rather than written
 *     twice under two names.
 *
 * Never a secret, defensively, not just by argument: our own code never
 * puts the Authorization header into a thrown message or model text (traced
 * against poc/m0/provider.mjs's `MalformedToolCallTolerantOpenAI` and
 * bare-agent's own `provider-openai.js` `OpenAIProvider._request` — the
 * header is written on OUTBOUND requests only). But TWO of the three shapes
 * a caught error can take carry the PROVIDER'S OWN response text
 * (`parsed.error?.message` on a >=400 response, or the first 200 bytes of a
 * non-JSON body) — external text this process does not control, and real
 * providers do sometimes echo a presented key back in a 401 body. `report.
 * textInstead` is model output, same standing: also not ours to trust.
 * `providerRedMessage` (passed in already redacted by the caller — see
 * `runOneDraft`'s catch block, the one place it is computed) and `report.
 * textInstead` (redacted here, the one place it is read into persisted
 * state) both go through `redactSecrets` before they can reach disk.
 */
function buildNoDeclarationArtifact({
  outcome, report, wallMs, providerRedMessage, secrets = [],
}) {
  if (outcome === 'provider-red') {
    return { declaration: null, outcome, providerRedMessage, wallMs };
  }
  if (outcome === 'timeout') {
    return { declaration: null, outcome, wallMs };
  }
  // 'no-tool-call' / 'unknown' — the report-based branch.
  return {
    declaration: null,
    outcome,
    ...(report.textInstead != null ? { textInstead: redactSecrets(report.textInstead, secrets) } : {}),
    ...(report.usage != null ? { usage: report.usage } : {}),
    ...(report.rounds != null ? { rounds: report.rounds } : {}),
    wallMs,
  };
}

/**
 * Run ONE draft under the 240s hard deadline. Returns a fully-formed record
 * per the brief's shape:
 *   { i, grammar, toolCalled, stopReason, validator, slot, stepCount,
 *     hitlSteps, checkpointGrants, zeroPrimitiveSteps, costUsd, costUnknown,
 *     wallMs, modelRequested, modelReturned, modelMatch }
 * `providerForDraft(i)` -> `{ provider, rates, modelId }` — injected by
 * tests (fake, $0), or the live default at the bottom of this file.
 */
export async function runOneDraft({
  i, grammar, job = 'job1', askLines, facts, proseText, providerForDraft, deadlineMs = DEFAULT_DEADLINE_MS,
  // The live key value(s) to scrub out of anything persisted below (see
  // `redactSecrets`'s own header). Defaults to `[]` — every existing
  // caller/test is byte-identical, since redacting against no secrets is a
  // no-op. The CLI block at the bottom of this file is the one live caller
  // that ever passes a non-empty list, built from the SAME env var
  // `checkKeyPreflight` already reads (never a second table).
  secrets = [],
}) {
  const { provider, rates, modelId } = providerForDraft(i);
  const startedAt = Date.now();
  const slotGrammar = grammar === 'slot';

  let outcome;
  const { promise: timeoutPromise, cancel: cancelTimeout } = timeoutAfter(deadlineMs);
  try {
    // job #2 runs through its own paid round (draftJob2 — different facts shape, different
    // ABSENT check) — job #1 and twoask both run through runDrafter's job #1-shaped path,
    // over WHATEVER prose text this draft was given (job #1's own file for job1, the fixture
    // carrying the extra signed ask line for twoask).
    const draftPromise = job === 'job2'
      ? draftJob2(modelId, {
        proseText, facts, provider, rates, slotGrammar, askLines,
      })
      : runDrafter(modelId, {
        prose: true, provider, rates, facts, slotGrammar, askLines, proseText,
      });
    outcome = await Promise.race([draftPromise, timeoutPromise]);
  } catch (err) {
    // The provider itself threw — before the request ever left the machine
    // (a header-value validation throw, a DNS failure, a refused
    // connection) or after it reached the provider (ECONNRESET
    // mid-response). hamr's ruling, 2026-09-21: no session starts at $0 or
    // unknown pricing — EVERY thrown error is priced at the CEILING here,
    // never 0 (a3cf07f's isClientSideThrow $0 branch is deleted: a
    // "client-side" throw priced at a literal $0 is its own kind of
    // "unknown cost rendered as 0", since nothing actually measured or
    // bounded that round at 0) and never null (a null costUsd row is the
    // exact state this whole fix closes — see poc/m0/spend.mjs's header).
    const wallMs = Date.now() - startedAt;
    const costUsd = ceilingCostUsd(modelId);
    // ONE writer for this value — redacted here, once, before it reaches EITHER destination
    // (the top-level field below, which lands in the jsonl row; and the artifact).
    const providerRedMessage = redactSecrets(err.message, secrets);
    return {
      i, grammar, job, toolCalled: false, stopReason: 'provider-red', validator: null, slot: null, shape: null,
      stepCount: 0, hitlSteps: 0, checkpointGrants: 0, zeroPrimitiveSteps: 0,
      costUsd, costUnknown: false, estimated: true,
      wallMs, modelRequested: modelId, modelReturned: null,
      modelMatch: classifyModelId(modelId, null), declaration: null, providerRedMessage,
      noDeclarationArtifact: buildNoDeclarationArtifact({
        outcome: 'provider-red', report: null, wallMs, providerRedMessage,
      }),
    };
  } finally {
    cancelTimeout();
  }
  const wallMs = Date.now() - startedAt;

  if (outcome.__timedOut) {
    const costUsd = ceilingCostUsd(modelId);
    return {
      i, grammar, job, toolCalled: false, stopReason: 'timeout', validator: null, slot: null, shape: null,
      stepCount: 0, hitlSteps: 0, checkpointGrants: 0, zeroPrimitiveSteps: 0,
      costUsd, costUnknown: false, estimated: true, wallMs, modelRequested: modelId, modelReturned: null,
      modelMatch: classifyModelId(modelId, null), declaration: null,
      noDeclarationArtifact: buildNoDeclarationArtifact({ outcome: 'timeout', report: null, wallMs }),
    };
  }

  const report = outcome;
  const declaration = report.declaration;
  const validatorResult = report.toolCalled && declaration ? validate(declaration) : null;
  const slotResult = report.toolCalled && declaration ? checkAskSlots(declaration, askLines) : null;
  const shapeResult = report.toolCalled && declaration ? checkShapes(declaration) : null;

  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const stepCount = steps.length;
  const hitlSteps = steps.filter((st) => st?.close?.class === 'hitl').length;
  const checkpointGrants = steps.filter((st) => Array.isArray(st?.primitives) && st.primitives.includes('checkpoint')).length;
  const zeroPrimitiveSteps = steps.filter((st) => Array.isArray(st?.primitives) && st.primitives.length === 0).length;

  const stopReason = deriveStopReason(report);
  // Only the two non-refusal, non-tool-called buckets get the richer artifact (see
  // buildNoDeclarationArtifact's own header for why 'absent-facts'/'refused-no-slots' are excluded).
  const noDeclarationArtifact = !report.toolCalled && !declaration
    && (stopReason === 'no-tool-call' || stopReason === 'unknown')
    ? buildNoDeclarationArtifact({
      outcome: stopReason, report, wallMs, secrets,
    })
    : undefined;

  return {
    i,
    grammar,
    job,
    toolCalled: report.toolCalled,
    stopReason,
    validator: validatorResult,
    slot: slotResult,
    shape: shapeResult,
    stepCount,
    hitlSteps,
    checkpointGrants,
    zeroPrimitiveSteps,
    costUsd: report.costUsd,
    costUnknown: report.costUsd === null,
    wallMs,
    modelRequested: report.modelRequested,
    modelReturned: report.modelReturned,
    modelMatch: classifyModelId(report.modelRequested, report.modelReturned),
    declaration,
    ...(noDeclarationArtifact !== undefined ? { noDeclarationArtifact } : {}),
  };
}

/** One progress line per draft — never a key, never a raw provider error beyond its own message text. */
export function renderProgressLine(record, total) {
  const costLabel = record.costUsd === null ? 'unknown' : record.costUsd.toFixed(6);
  const v = record.validator?.verdict ?? '-';
  const s = record.slot?.verdict ?? '-';
  const shapeLabel = record.shape ? `${record.shape.verdict}/${record.shape.shapedSteps}` : '-';
  return `draft ${record.i}/${total}  grammar=${record.grammar}  toolCalled=${record.toolCalled}  `
    + `validator=${v}  slot=${s}  shape=${shapeLabel}  stopReason=${record.stopReason}  $${costLabel}  ${(record.wallMs / 1000).toFixed(1)}s`;
}

/** The final SUMMARY line, exact format the brief names. */
export function renderSummaryLine(records, grammar, n) {
  const slotGreen = records.filter((r) => r.slot?.verdict === 'green').length;
  const validatorGreen = records.filter((r) => r.validator?.verdict === 'green').length;
  const noToolCall = records.filter((r) => r.stopReason === 'no-tool-call').length;
  const timeouts = records.filter((r) => r.stopReason === 'timeout').length;
  const pricedCosts = records.map((r) => r.costUsd).filter((c) => c !== null);
  const costUsd = pricedCosts.length === records.length
    ? pricedCosts.reduce((s, c) => s + c, 0).toFixed(6)
    : 'unknown';
  const shapeGreen = records.filter((r) => r.shape?.verdict === 'green').length;
  const shapedDrafts = records.filter((r) => r.shape && r.shape.shapedSteps > 0).length;
  return `SUMMARY grammar=${grammar} n=${n} slotGreen=${slotGreen} validatorGreen=${validatorGreen} `
    + `noToolCall=${noToolCall} timeouts=${timeouts} costUsd=${costUsd} shapeGreen=${shapeGreen} shapedDrafts=${shapedDrafts}`;
}

// ---------------------------------------------------------------------------
// $0 rescore — re-run TODAY's validate()/checkAskSlots over YESTERDAY's
// saved drafts. A live batch spends real money on the provider round; the
// scoring that follows (validate/checkAskSlots) is pure $0 code, and that
// code keeps changing (e.g. the 2026-09-21 fix to slots.mjs check (c)).
// Re-running the whole paid batch just to re-score old output would burn
// money to re-prove something already on disk. `--rescore` never builds a
// provider, never reads a key, never writes a spend row — it only re-reads
// poc/m1/out/slot-batch-<grammar>-<tag>/draft-<i>.json (written by every
// live/test run of runSlotBatch, win or lose) and re-scores them with
// whatever validate()/checkAskSlots are TODAY.
// ---------------------------------------------------------------------------

/**
 * Never overwrites the original per-tag .jsonl (consumed results are never
 * overwritten, same discipline as `assertFreshTag`) — every rescore lands
 * in its own dated file, so re-running `--rescore` twice in one day on the
 * same grammar+tag just overwrites that day's rescore file, never the
 * original evidence.
 */
export function rescoreFilePath(
  grammar, tag, outDir = OUT_DIR, dateStr = new Date().toISOString().slice(0, 10), job = 'job1',
) {
  const suffix = job === 'job1' ? `${grammar}-${tag}` : `${grammar}-${job}-${tag}`;
  return join(outDir, `slot-batch-${suffix}.rescore-${dateStr}.jsonl`);
}

/**
 * Reads `poc/m1/out/slot-batch-<grammar>-<tag>/draft-<i>.json` for every `i`
 * recorded in that grammar+tag's original .jsonl (so "how many drafts" is
 * read from what the live run actually wrote, never re-guessed as `n`), and
 * re-scores each one against the CURRENT `validate()`/`checkAskSlots` code.
 * A draft file holding the literal `null` (the run never produced a
 * declaration — no tool call, a timeout, a provider red) rescoures to
 * `{ validator: null, slot: null }`, same shape `runOneDraft` itself uses.
 *
 * Never touches the original .jsonl; writes only the new dated rescore
 * file. No provider is built, no key is read, no spend row is written —
 * this function imports nothing from provider.mjs or spend.mjs's writers.
 */
export function rescoreSlotBatch({
  grammar, tag, job = 'job1', outDir = OUT_DIR, proseText,
  writeLine = (s) => { process.stdout.write(`${s}\n`); }, dateStr,
}) {
  if (!['slot', 'legacy'].includes(grammar)) {
    throw new Error(`slot-batch --rescore: grammar must be "slot" or "legacy", got "${grammar}"`);
  }
  if (!JOBS.includes(job)) {
    throw new Error(`slot-batch --rescore: --job must be one of ${JOBS.join('|')}, got "${job}"`);
  }
  if (!tag) {
    throw new Error('slot-batch --rescore: --tag is required');
  }
  const { jsonlPath, declDir } = outFilePaths(grammar, tag, outDir, job);
  if (!existsSync(jsonlPath)) {
    throw new Error(`slot-batch --rescore: ${jsonlPath} not found — nothing recorded for grammar=${grammar} tag=${tag}`);
  }
  // The prose this tag actually ran against — `runSlotBatch` saves it once, at
  // `<declDir>/prose.txt`, before the first draft (see its own header). A tag
  // recorded before that fix existed has no such file; falling back to
  // WHATEVER prose file is on disk TODAY is the best available answer for
  // it, but it is a DIFFERENT fact from "the prose this tag actually ran
  // against" (the file may have moved on since), so the caller is told which
  // one this rescore used. An explicit `proseText` (every test above this
  // one) always wins — it is the caller's own, deliberate override, never
  // guessed from either disk source.
  let resolvedProseText = proseText;
  if (resolvedProseText === undefined) {
    const savedProsePath = join(declDir, 'prose.txt');
    if (existsSync(savedProsePath)) {
      resolvedProseText = readFileSync(savedProsePath, 'utf8');
      writeLine('prose=saved');
    } else {
      resolvedProseText = readFileSync(prosePathForJob(job), 'utf8');
      writeLine('prose=current-file (tag predates saved prose)');
    }
  }
  const original = readFileSync(jsonlPath, 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l));
  const { lines: askLines } = parseAskSlots(resolvedProseText);

  const rescored = [];
  for (const rec of original) {
    const declPath = join(declDir, `draft-${rec.i}.json`);
    const declaration = existsSync(declPath) ? readDraftDeclaration(declPath) : null;
    const validator = declaration ? validate(declaration) : null;
    const slot = declaration ? checkAskSlots(declaration, askLines) : null;
    const shape = declaration ? checkShapes(declaration) : null;
    const out = {
      i: rec.i, validator, slot, shape,
    };
    rescored.push(out);
    const vLabel = validator?.verdict ?? '-';
    const sLabel = slot?.verdict ?? '-';
    const shLabel = shape ? `${shape.verdict}/${shape.shapedSteps}` : '-';
    let line = `rescore draft ${rec.i}  validator=${vLabel}  slot=${sLabel}  shape=${shLabel}`;
    if (validator?.verdict === 'red') line += `  validatorRed="${validator.red}"`;
    if (slot?.verdict === 'red') line += `  slotRed="${slot.red}"`;
    if (shape?.verdict === 'red') line += `  shapeRed="${shape.reds.join('; ')}"`;
    writeLine(line);
  }

  const slotGreen = rescored.filter((r) => r.slot?.verdict === 'green').length;
  const validatorGreen = rescored.filter((r) => r.validator?.verdict === 'green').length;
  const bothGreen = rescored.filter((r) => r.slot?.verdict === 'green' && r.validator?.verdict === 'green').length;
  const shapeGreen = rescored.filter((r) => r.shape?.verdict === 'green').length;
  const summaryLine = `RESCORE grammar=${grammar} tag=${tag} n=${rescored.length} slotGreen=${slotGreen} `
    + `validatorGreen=${validatorGreen} bothGreen=${bothGreen} shapeGreen=${shapeGreen}`;
  writeLine(summaryLine);

  const outPath = rescoreFilePath(grammar, tag, outDir, dateStr, job);
  writeFileSync(outPath, rescored.map((r) => JSON.stringify(r)).join('\n') + (rescored.length ? '\n' : ''));

  return {
    records: rescored, summaryLine, outPath,
  };
}

/**
 * The whole batch. `providerForDraft` is REQUIRED — this function never
 * builds a live provider itself; the CLI block below is the one live call
 * site, so a test (or any other caller) is structurally unable to reach the
 * network by omitting it.
 */
export async function runSlotBatch({
  grammar, n = 20, tag, job = 'job1', outDir = OUT_DIR, providerForDraft,
  facts, proseText,
  deadlineMs = DEFAULT_DEADLINE_MS, writeLine = (s) => { process.stdout.write(`${s}\n`); },
  // Optional: when given (the live CLI path only — never a test), every
  // draft is ALSO checked against and recorded into M1's own $5 cap ledger
  // (poc/m1/out/spend.jsonl, M1_CAP_USD above — poc/m0/spend.mjs's
  // assertUnderGlobalCap/appendSpendRow mechanism, reused unchanged, but
  // never M0's own poc/m0/out/spend.jsonl file or cap). Omitted, this script
  // keeps its own per-tag jsonl ledger only (every test path).
  spendPath,
  // Threaded straight to `runOneDraft` (see its own header) — defaults to `[]` so every
  // existing caller/test is unaffected. The CLI block builds this from the SAME env var
  // `checkKeyPreflight` already reads.
  secrets = [],
}) {
  if (!['slot', 'legacy'].includes(grammar)) {
    throw new Error(`slot-batch: --grammar must be "slot" or "legacy", got "${grammar}"`);
  }
  if (!JOBS.includes(job)) {
    throw new Error(`slot-batch: --job must be one of ${JOBS.join('|')}, got "${job}"`);
  }
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`slot-batch: --n must be a positive integer, got "${n}"`);
  }
  if (!tag) {
    throw new Error('slot-batch: --tag is required');
  }
  if (typeof providerForDraft !== 'function') {
    throw new Error('slot-batch: providerForDraft is required (this function never builds a live provider itself)');
  }

  // Resolved AFTER every $0 validation above, so an unknown --job (or any
  // other bad argument) refuses before touching disk at all — never even a
  // read of the wrong prose file, let alone a ledger write.
  const resolvedProseText = proseText !== undefined ? proseText : readFileSync(prosePathForJob(job), 'utf8');
  const resolvedFacts = facts !== undefined ? facts : (job === 'job2' ? null : realFacts());

  const { jsonlPath, declDir } = outFilePaths(grammar, tag, outDir, job);
  assertFreshTag(jsonlPath);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(declDir, { recursive: true });

  // The prose text THIS tag actually ran against, saved once, before the
  // first draft — so a later `--rescore` (or a human reading the evidence
  // months on) re-scores against what the run actually used, never whatever
  // the prose FILE happens to say today (see rescoreSlotBatch's own header).
  // Same "never overwrite live evidence" discipline as `assertFreshTag`:
  // `assertFreshTag` above already refuses a second run against this exact
  // grammar+tag, so this file existing at all here would mean a caller built
  // its OWN `declDir` outside that discipline — refused rather than silently
  // overwritten either way.
  const prosePath = join(declDir, 'prose.txt');
  if (existsSync(prosePath)) {
    throw new Error(`slot-batch: ${prosePath} already exists — refusing to overwrite the prose text a tag ran against`);
  }
  writeFileSync(prosePath, resolvedProseText);

  // Ask lines always come from parseAskSlots on the CHOSEN prose — never hard-coded per job.
  const { lines: askLines } = parseAskSlots(resolvedProseText);

  const records = [];
  let consecutiveProviderReds = 0;
  let stoppedEarly = false;

  for (let i = 1; i <= n; i += 1) {
    if (spendPath) {
      // eslint-disable-next-line no-await-in-loop
      assertUnderGlobalCap(spendPath, M1_CAP_USD); // throws (caught by the CLI wrapper) if already at/over M1's $5 cap
    }
    // eslint-disable-next-line no-await-in-loop
    const record = await runOneDraft({
      i, grammar, job, askLines, facts: resolvedFacts, proseText: resolvedProseText, providerForDraft, deadlineMs, secrets,
    });
    if (spendPath) {
      appendSpendRow(spendPath, {
        runId: `m1-slot-batch-${grammar}-${job}-${tag}-${i}`, step: 'draft-m1', model: record.modelRequested,
        modelReturned: record.modelReturned, costUsd: record.costUsd, wallMs: record.wallMs,
        ...(record.estimated ? { estimated: true } : {}),
      });
    }
    const { declaration, noDeclarationArtifact, ...jsonlRecord } = record;
    // hasTextInstead — jsonl-only signal (item added by the F33/F34 fix): a reader of the jsonl
    // alone can tell whether draft-<i>.json holds text worth going to read, without opening it.
    const hasTextInstead = typeof noDeclarationArtifact?.textInstead === 'string';
    writeFileSync(jsonlPath, `${JSON.stringify({ ...jsonlRecord, hasTextInstead })}\n`, { flag: 'a' });
    writeFileSync(join(declDir, `draft-${i}.json`), JSON.stringify(declaration ?? noDeclarationArtifact ?? null, null, 2));
    records.push(record);
    writeLine(renderProgressLine(record, n));

    if (record.stopReason === 'provider-red') {
      consecutiveProviderReds += 1;
      if (consecutiveProviderReds >= 2) {
        writeLine(`STOPPED at draft ${i}/${n}: 2 consecutive provider reds — a repeat at the same place `
          + 'is a shape, not weather, never burned through as noise');
        stoppedEarly = true;
        break;
      }
    } else {
      consecutiveProviderReds = 0;
    }
  }

  const summaryLine = renderSummaryLine(records, grammar, n);
  writeLine(summaryLine);

  return {
    records, summaryLine, completed: !stoppedEarly && records.length === n, jsonlPath, declDir,
  };
}

// ---------------------------------------------------------------------------
// CLI entry point — the one live call site. Opt-in by nature (needs a real
// provider slot's env key) but not gated behind an extra flag the way
// drafter.mjs's DRAFTER_LIVE is: this script's whole purpose is to spend the
// batch, and node --test never executes this block (no test file imports it,
// same discipline as poc/m0/batch.mjs's own CLI block).
// ---------------------------------------------------------------------------

if (import.meta.url === `file://${process.argv[1]}`) {
  const arg = (name) => {
    const idx = process.argv.indexOf(`--${name}`);
    return idx !== -1 ? process.argv[idx + 1] : undefined;
  };

  // --rescore <grammar> --tag <tag> [--job job1|job2|twoask] — $0, no provider, no key, no spend row.
  // Checked FIRST, before any of the live-batch flags below are even read,
  // so `--rescore` can never accidentally fall through into the paid path.
  const rescoreGrammar = arg('rescore');
  if (rescoreGrammar !== undefined) {
    const rescoreTag = arg('tag');
    const rescoreJob = arg('job') ?? 'job1';
    if (!['slot', 'legacy'].includes(rescoreGrammar) || !rescoreTag || !JOBS.includes(rescoreJob)) {
      console.error('usage: node poc/m1/slot-batch.mjs --rescore slot|legacy --tag <tag> [--job job1|job2|twoask]');
      process.exit(1);
    }
    try {
      rescoreSlotBatch({ grammar: rescoreGrammar, tag: rescoreTag, job: rescoreJob });
      process.exit(0);
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  const grammar = arg('grammar');
  const n = Number(arg('n') ?? 20);
  const tag = arg('tag');
  const job = arg('job') ?? 'job1';
  const slot = arg('slot') ?? 'deepseek';
  const model = arg('model') ?? PROVIDER_SLOTS[slot]?.defaultModel;
  const resumePath = arg('resume');
  const jdPath = arg('jd');

  // Unknown --job (like every other bad argument here) is refused at $0, before any ledger
  // write — same place checkKeyPreflight refuses below, never after.
  if (!['slot', 'legacy'].includes(grammar) || !tag || !PROVIDER_SLOTS[slot] || !JOBS.includes(job)) {
    console.error('usage: node poc/m1/slot-batch.mjs --grammar slot|legacy --n 20 --tag <tag> '
      + '[--job job1|job2|twoask] [--slot deepseek|synthetic] [--model <model-id>] '
      + '[--resume <resume.docx> --jd <jd.md>]  (required for --job job2 — scoutJob2 runs over '
      + 'the real files you point it at; there is no in-repo fixture)');
    process.exit(1);
  }

  // $0 key preflight — before any draft, before any ledger write (see checkKeyPreflight's own
  // header for the live incident this closes: a newline-terminated key passed makeProvider's
  // truthiness check and only blew up mid-round, locking the cap).
  const keyCheck = checkKeyPreflight(slot);
  if (!keyCheck.ok) {
    console.error(keyCheck.message);
    process.exit(1);
  }

  // The ONE place the live secrets list is built — the SAME env var checkKeyPreflight just
  // validated above (PROVIDER_SLOTS[slot].envVar), never a second table, via `secretsFromEnv`
  // (never the raw env value spread into a list directly — see its own header for why: the
  // wire key is TRIMMED by bare-agent, so an untrimmed-only list misses a trimmed echo).
  // Threaded into runSlotBatch -> runOneDraft so a provider error or model text-instead output
  // that echoes the live key back never reaches disk unredacted.
  const secrets = secretsFromEnv(process.env[PROVIDER_SLOTS[slot].envVar]);

  // job #2 needs its own scout facts (scoutJob2, imported — never reimplemented) BEFORE any
  // draft, over resume/JD files the caller points it at: no in-repo fixture exists for these
  // (poc/m0/job2.mjs's own live CLI has the same --resume/--jd requirement, for the same
  // reason — hamr's real resume is never checked into this tree).
  let job2Facts;
  if (job === 'job2') {
    if (!resumePath || !jdPath) {
      console.error('slot-batch --job job2 requires --resume <resume.docx> and --jd <jd.md> — refusing '
        + 'rather than inventing a fixture.');
      process.exit(1);
    }
    const scoutReport = scoutJob2({ resumePath, jdPath });
    if (!scoutReport.ok) {
      console.error(scoutReport.red);
      process.exit(1);
    }
    job2Facts = scoutReport.facts;
  }

  // Resolve the rate ONCE, up front — makeProvider re-resolves the same rate per draft (cheap,
  // deterministic), but the ceiling calculator needs it too, so this also fails fast (an unknown
  // rate red) before any draft spends a cent, same discipline as assertUnderGlobalCap elsewhere.
  resolveModelRate(model);

  const providerForDraft = () => {
    const built = makeProvider(slot, { model, timeoutMs: 300_000, deadlineMs: 240_000 });
    return { provider: built.provider, rates: built.rates, modelId: built.modelId ?? model };
  };

  try {
    const { completed } = await runSlotBatch({
      grammar, n, tag, job, providerForDraft,
      ...(job2Facts !== undefined ? { facts: job2Facts } : {}),
      spendPath: defaultM1SpendPath(),
      secrets,
    });
    process.exit(completed ? 0 : 1);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
