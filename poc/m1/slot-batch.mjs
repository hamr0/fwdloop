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
import { runDrafter, DRAFTER_MAX_TOKENS } from '../m0/drafter.mjs';
import { validate } from '../m0/validator.mjs';
import { lookFixtures, groundFacts } from '../m0/scout.mjs';
import { makeProvider, resolveModelRate, PROVIDER_SLOTS } from '../m0/provider.mjs';
import {
  classifyModelId, assertUnderGlobalCap, appendSpendRow,
} from '../m0/spend.mjs';
import { OUT_DIR as M0_OUT_DIR } from '../m0/runner.mjs';
import { parseAskSlots, checkAskSlots } from './slots.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..');
export const OUT_DIR = join(__dirname, 'out');
const PROSE_PATH = join(REPO_ROOT, 'poc', 'm0', 'prose.txt');
const CSV_PATH = join(REPO_ROOT, 'fixtures', 'ar-aging.csv');
const TEXT_PATH = join(REPO_ROOT, 'fixtures', 'message.txt');

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

/** The bar-file path discipline (borrowed-from poc/m0/batch.mjs's own naming, never imported). */
export function outFilePaths(grammar, tag, outDir = OUT_DIR) {
  return {
    jsonlPath: join(outDir, `slot-batch-${grammar}-${tag}.jsonl`),
    declDir: join(outDir, `slot-batch-${grammar}-${tag}`),
  };
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
 * The ceiling cost of ONE draft round that never returned in time (money
 * honesty, PRD §5 + CLAUDE.md: unknown cost is never rendered as 0). Bounds
 * both sides of the round:
 *   - output: `DRAFTER_MAX_TOKENS` (16000) — the drafter's own hard cap
 *     (drafter.mjs), so no round can ever emit more than this regardless of
 *     how long it hangs.
 *   - input: `inputTokenCeiling` — this script's prompt (the primitive
 *     catalogue + job #1's ~6 numbered lines + the scout's facts block) is a
 *     few thousand tokens in practice; 20,000 is a documented, generous
 *     ceiling on it, never a measured number passed off as exact.
 * `rates` is `{in, out}` USD/1K tokens, exactly the shape provider.mjs's
 * `resolveModelRate` returns — the one writer for rate lookups, never a
 * second table here.
 */
export function ceilingCostUsd(rates, { inputTokenCeiling = 20_000, outputTokenCeiling = DRAFTER_MAX_TOKENS } = {}) {
  return (inputTokenCeiling / 1000) * rates.in + (outputTokenCeiling / 1000) * rates.out;
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
 * Run ONE draft under the 240s hard deadline. Returns a fully-formed record
 * per the brief's shape:
 *   { i, grammar, toolCalled, stopReason, validator, slot, stepCount,
 *     hitlSteps, checkpointGrants, zeroPrimitiveSteps, costUsd, costUnknown,
 *     wallMs, modelRequested, modelReturned, modelMatch }
 * `providerForDraft(i)` -> `{ provider, rates, modelId }` — injected by
 * tests (fake, $0), or the live default at the bottom of this file.
 */
export async function runOneDraft({
  i, grammar, askLines, facts, proseText, providerForDraft, deadlineMs = DEFAULT_DEADLINE_MS,
}) {
  const { provider, rates, modelId } = providerForDraft(i);
  const startedAt = Date.now();
  const slotGrammar = grammar === 'slot';

  let outcome;
  const { promise: timeoutPromise, cancel: cancelTimeout } = timeoutAfter(deadlineMs);
  try {
    outcome = await Promise.race([
      runDrafter(modelId, {
        prose: true, provider, rates, facts, slotGrammar, askLines,
      }),
      timeoutPromise,
    ]);
  } catch (err) {
    // The provider itself threw (transport error) — no metered rounds ever reached this
    // script (runDeclarationRound's own `meterings` array is scoped inside it and lost on
    // throw), so the cost is genuinely UNKNOWN, never 0 — same rule runner.mjs's rule 2 applies.
    const wallMs = Date.now() - startedAt;
    return {
      i, grammar, toolCalled: false, stopReason: 'provider-red', validator: null, slot: null,
      stepCount: 0, hitlSteps: 0, checkpointGrants: 0, zeroPrimitiveSteps: 0,
      costUsd: null, costUnknown: true, wallMs, modelRequested: modelId, modelReturned: null,
      modelMatch: classifyModelId(modelId, null), declaration: null, providerRedMessage: err.message,
    };
  } finally {
    cancelTimeout();
  }
  const wallMs = Date.now() - startedAt;

  if (outcome.__timedOut) {
    const costUsd = ceilingCostUsd(rates);
    return {
      i, grammar, toolCalled: false, stopReason: 'timeout', validator: null, slot: null,
      stepCount: 0, hitlSteps: 0, checkpointGrants: 0, zeroPrimitiveSteps: 0,
      costUsd, costUnknown: false, wallMs, modelRequested: modelId, modelReturned: null,
      modelMatch: classifyModelId(modelId, null), declaration: null,
    };
  }

  const report = outcome;
  const declaration = report.declaration;
  const validatorResult = report.toolCalled && declaration ? validate(declaration) : null;
  const slotResult = report.toolCalled && declaration ? checkAskSlots(declaration, askLines) : null;

  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const stepCount = steps.length;
  const hitlSteps = steps.filter((st) => st?.close?.class === 'hitl').length;
  const checkpointGrants = steps.filter((st) => Array.isArray(st?.primitives) && st.primitives.includes('checkpoint')).length;
  const zeroPrimitiveSteps = steps.filter((st) => Array.isArray(st?.primitives) && st.primitives.length === 0).length;

  return {
    i,
    grammar,
    toolCalled: report.toolCalled,
    stopReason: deriveStopReason(report),
    validator: validatorResult,
    slot: slotResult,
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
  };
}

/** One progress line per draft — never a key, never a raw provider error beyond its own message text. */
export function renderProgressLine(record, total) {
  const costLabel = record.costUsd === null ? 'unknown' : record.costUsd.toFixed(6);
  const v = record.validator?.verdict ?? '-';
  const s = record.slot?.verdict ?? '-';
  return `draft ${record.i}/${total}  grammar=${record.grammar}  toolCalled=${record.toolCalled}  `
    + `validator=${v}  slot=${s}  stopReason=${record.stopReason}  $${costLabel}  ${(record.wallMs / 1000).toFixed(1)}s`;
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
  return `SUMMARY grammar=${grammar} n=${n} slotGreen=${slotGreen} validatorGreen=${validatorGreen} `
    + `noToolCall=${noToolCall} timeouts=${timeouts} costUsd=${costUsd}`;
}

/**
 * The whole batch. `providerForDraft` is REQUIRED — this function never
 * builds a live provider itself; the CLI block below is the one live call
 * site, so a test (or any other caller) is structurally unable to reach the
 * network by omitting it.
 */
export async function runSlotBatch({
  grammar, n = 20, tag, outDir = OUT_DIR, providerForDraft,
  facts = realFacts(), proseText = readFileSync(PROSE_PATH, 'utf8'),
  deadlineMs = DEFAULT_DEADLINE_MS, writeLine = (s) => { process.stdout.write(`${s}\n`); },
  // Optional: when given (the live CLI path only — never a test), every
  // draft is ALSO checked against and recorded into m0's own global $5 cap
  // ledger (poc/m0/spend.mjs's assertUnderGlobalCap/appendSpendRow) — the
  // SAME ledger poc/m0's other live tools spend against, so this script's
  // spend is never invisible to that cap. Omitted, this script keeps its
  // own per-tag jsonl ledger only (every test path).
  spendPath,
}) {
  if (!['slot', 'legacy'].includes(grammar)) {
    throw new Error(`slot-batch: --grammar must be "slot" or "legacy", got "${grammar}"`);
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

  const { jsonlPath, declDir } = outFilePaths(grammar, tag, outDir);
  assertFreshTag(jsonlPath);
  mkdirSync(outDir, { recursive: true });
  mkdirSync(declDir, { recursive: true });

  const { lines: askLines } = parseAskSlots(proseText);

  const records = [];
  let consecutiveProviderReds = 0;
  let stoppedEarly = false;

  for (let i = 1; i <= n; i += 1) {
    if (spendPath) {
      // eslint-disable-next-line no-await-in-loop
      assertUnderGlobalCap(spendPath); // throws (caught by the CLI wrapper) if already at/over m0's $5 cap
    }
    // eslint-disable-next-line no-await-in-loop
    const record = await runOneDraft({
      i, grammar, askLines, facts, proseText, providerForDraft, deadlineMs,
    });
    if (spendPath) {
      appendSpendRow(spendPath, {
        runId: `m1-slot-batch-${grammar}-${tag}-${i}`, step: 'draft-m1', model: record.modelRequested,
        modelReturned: record.modelReturned, costUsd: record.costUsd, wallMs: record.wallMs,
      });
    }
    const { declaration, ...jsonlRecord } = record;
    writeFileSync(jsonlPath, `${JSON.stringify(jsonlRecord)}\n`, { flag: 'a' });
    writeFileSync(join(declDir, `draft-${i}.json`), JSON.stringify(declaration ?? null, null, 2));
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
  const grammar = arg('grammar');
  const n = Number(arg('n') ?? 20);
  const tag = arg('tag');
  const slot = arg('slot') ?? 'deepseek';
  const model = arg('model') ?? PROVIDER_SLOTS[slot]?.defaultModel;

  if (!['slot', 'legacy'].includes(grammar) || !tag || !PROVIDER_SLOTS[slot]) {
    console.error('usage: node poc/m1/slot-batch.mjs --grammar slot|legacy --n 20 --tag <tag> '
      + '[--slot deepseek|synthetic] [--model <model-id>]');
    process.exit(1);
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
      grammar, n, tag, slot, providerForDraft, spendPath: join(M0_OUT_DIR, 'spend.jsonl'),
    });
    process.exit(completed ? 0 : 1);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
