// PROBE: are output tokens under-counted when the model answers via a TOOL CALL
// instead of plain text? A live drafter run reported outputTokens:106 against a
// 1,415-char tool-call JSON payload (~350 tokens by a crude chars/4 estimate).
// If the meter silently doesn't count what the model writes INSIDE a tool call,
// every cost fwdloop has recorded so far is understated and the $5 M0 cap
// (spend.mjs) is not real — same shape as F11 (a limit honoured in appearance,
// not in fact).
//
// METHOD (no tokenizer needed, none is available and none is added): send the
// SAME deterministic payload through two channels and compare each arm's
// REPORTED outputTokens against the ACTUAL characters that arm produced.
//   Arm TEXT — plain-text echo, no tools offered at all.
//   Arm TOOL — one tool whose parameter takes the same payload, called once.
// The verdict is the ratio of chars-per-reported-output-token across arms:
//   close together  -> (a) the count is honest, JSON just packs well.
//   TOOL far higher  -> (b) tool-call content is not being counted.
// A non-compliant, errored, or unpriced arm is a CASUALTY — evidence for
// NEITHER side (F11/bake-off discipline). Unknown cost is never rendered as 0
// (PRD §5): a missing outputTokens count yields ratio:null, classified a
// casualty, never a "0 chars per token" or an "infinite efficiency" reading.
//
// Reached ONLY through provider.mjs's makeProvider (never a hand-rolled
// client) and spend.mjs's appendSpendRow/assertUnderGlobalCap, exactly like
// scout.mjs and drafter.mjs — this probe's rows land in the same ledger as
// any other spend, not off to the side.

import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Loop } from 'bare-agent';
import { makeProvider } from './provider.mjs';
import { assertUnderGlobalCap, appendSpendRow, RUN_CAP_USD } from './spend.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, 'out');
const SPEND_PATH = join(OUT_DIR, 'spend.jsonl');

/** The payload: integers 1..100, canonical JSON array. Chosen deliberately:
 *   - it is an ECHO task (the model is handed the exact array and asked to repeat
 *     it), not a generation task, which removes "did the model get the answer
 *     right" as a confound and leaves only "did it reproduce the bytes";
 *   - bare integers need no string-escaping, so a re-serialized JSON.stringify
 *     of a parsed tool-call argument tracks the model's own compact emission
 *     closely (see the caveat in runArm below) — this is WHY integers, not
 *     words or punctuation-heavy strings, were picked;
 *   - it is trivially and mechanically verifiable: array equality, not judgment. */
export const PAYLOAD = Array.from({ length: 100 }, (_, i) => i + 1);

/** Canonical compact JSON text for the payload — identical across both arms. */
export function payloadText() {
  return JSON.stringify(PAYLOAD);
}

/** Fixed in code, not spec-authorable: a facts echo is small; this is far below
 *  the drafter's 16000 on purpose. Cheap by design (PRD §5's "the probe must
 *  be cheap"): ~100 short integers, one round per arm. */
export const TOKENPROBE_MAX_TOKENS = 1000;

/** One round per arm — the probe measures a single echo, it does not get to
 *  revise. Enforced in makeEmitPayloadTool below, not merely documented. */
export const TOKENPROBE_ROUND_BOUND = 1;

/** The ONLY judgment knob in this file — everything else is measured. Set at
 *  1.5x: the TOOL arm must look at least 50% more "expensive per character"
 *  before this calls it under-counting, a wide enough margin that ordinary
 *  "JSON packs differently than English prose" tokenizer variance should not
 *  trip a false (b). Chosen, not derived — a real result should land nowhere
 *  near this boundary either way if it wants to convince anyone. */
export const RATIO_GAP_THRESHOLD = 1.5;

const TOOL_SCHEMA = {
  type: 'object',
  properties: {
    numbers: {
      type: 'array',
      items: { type: 'integer' },
      description: 'the exact array of integers you were given, in the same order — nothing added, removed, or reordered',
    },
  },
  required: ['numbers'],
};

/**
 * The TOOL arm's one tool. A fresh instance per round — `execute` throws past
 * TOKENPROBE_ROUND_BOUND calls, mirroring scout.mjs's makeReportFactsTool.
 * Exported standalone so the round bound is unit-testable without a model.
 */
export function makeEmitPayloadTool() {
  let callCount = 0;
  let capturedArgs = null;
  const tool = {
    name: 'emit_payload',
    description: 'Emit the exact integer array you were given, unchanged, as the "numbers" parameter.',
    parameters: TOOL_SCHEMA,
    execute: async (args) => {
      callCount += 1;
      if (callCount > TOKENPROBE_ROUND_BOUND) {
        throw new Error(`tokenprobe round bound exceeded (${TOKENPROBE_ROUND_BOUND}) — one echo per arm, no revision`);
      }
      capturedArgs = args;
      return { ok: true };
    },
  };
  return { tool, getCapturedArgs: () => capturedArgs, getCallCount: () => callCount };
}

/**
 * Extract a JSON array from free text: finds the first `[...]` substring (so a
 * model that wraps the answer in markdown fences or a leading sentence still
 * parses) and JSON.parse's it. Returns null on any failure — never throws,
 * because a parse failure IS a compliance verdict (non-compliant / casualty),
 * not a crash.
 */
export function extractJsonArray(text) {
  if (typeof text !== 'string') return null;
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return null;
  try {
    const parsed = JSON.parse(match[0]);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * True only if `reported` is EXACTLY the payload — same length, same values,
 * same order, same type (=== , so "5" !== 5). A non-compliant echo is a
 * CASUALTY (see classifyArm), never evidence for either explanation — the
 * whole point of borrowing F11's discipline here.
 */
export function isCompliant(reported) {
  if (!Array.isArray(reported) || reported.length !== PAYLOAD.length) return false;
  return reported.every((v, i) => v === PAYLOAD[i]);
}

/**
 * Pure arithmetic: characters produced per REPORTED output token. Returns
 * null — never 0, never a NaN from a divide-by-zero — when outputTokens is
 * missing or non-positive, or charCount is not a sane non-negative number.
 * A null ratio is a CASUALTY condition (unknown cost is never rendered as 0,
 * PRD §5's rule applied to this measurement too).
 */
export function charsPerOutputToken(charCount, outputTokens) {
  if (!Number.isFinite(charCount) || charCount < 0) return null;
  if (!Number.isFinite(outputTokens) || outputTokens <= 0) return null;
  return charCount / outputTokens;
}

/**
 * Classify one arm's measurement as EVIDENCE or a CASUALTY. A casualty (an
 * error, a non-compliant echo, or no priceable output-token count) carries no
 * evidentiary weight for (a) OR (b) — it is void, not a data point either way.
 */
export function classifyArm(measurement) {
  if (measurement?.error) return { status: 'casualty', reason: `errored: ${measurement.error}` };
  if (!measurement?.compliant) return { status: 'casualty', reason: 'non-compliant echo — reproduced payload does not match exactly' };
  if (measurement.ratio === null || measurement.ratio === undefined) {
    return { status: 'casualty', reason: 'no reported output-token count — cost is unknown, never treated as 0' };
  }
  return { status: 'evidence' };
}

/**
 * THE VERDICT. Only meaningful when both arms classify as evidence; either
 * side being a casualty short-circuits to 'inconclusive-casualty' — a failed
 * arm is never read as support for (a) or (b).
 */
export function verdict(textMeasurement, toolMeasurement) {
  const textClass = classifyArm(textMeasurement);
  const toolClass = classifyArm(toolMeasurement);
  if (textClass.status === 'casualty' || toolClass.status === 'casualty') {
    return {
      verdict: 'inconclusive-casualty',
      detail: [
        textClass.status === 'casualty' ? `TEXT arm: ${textClass.reason}` : null,
        toolClass.status === 'casualty' ? `TOOL arm: ${toolClass.reason}` : null,
      ].filter(Boolean).join('; '),
    };
  }
  const gap = toolMeasurement.ratio / textMeasurement.ratio;
  if (gap >= RATIO_GAP_THRESHOLD) {
    return {
      verdict: 'b',
      detail: `TOOL arm's chars/reported-output-token ratio is ${gap.toFixed(2)}x the TEXT arm's (>= ${RATIO_GAP_THRESHOLD}x threshold) — tool-call output tokens appear UNDER-COUNTED`,
    };
  }
  return {
    verdict: 'a',
    detail: `ratios are within ${gap.toFixed(2)}x of each other (< ${RATIO_GAP_THRESHOLD}x threshold) — the count looks honest, JSON just packs efficiently`,
  };
}

/**
 * Run ONE arm ('text' or 'tool'). `provider`/`rates` are injectable (tests
 * pass a fake — no network); when omitted, the REAL provider is built through
 * provider.mjs's makeProvider, exactly like scout.mjs/drafter.mjs (F11:
 * legacyMaxTokens is never a call-site decision).
 */
export async function runArm(kind, modelId, {
  slot = 'deepseek', runLabel = 'tokenprobe', provider: injectedProvider, rates: injectedRates,
} = {}) {
  if (kind !== 'text' && kind !== 'tool') {
    throw new Error(`unknown arm kind "${kind}" — expected "text" or "tool"`);
  }

  let provider = injectedProvider;
  let rates = injectedRates;
  let resolvedModelId = modelId;
  const live = injectedProvider == null;
  if (live) {
    assertUnderGlobalCap(SPEND_PATH);
    const built = makeProvider(slot, { model: modelId });
    provider = built.provider;
    rates = built.rates;
    resolvedModelId = built.modelId;
  }

  // Collect EVERY round's metering event, not just the last. bare-agent's Loop always needs a
  // further generate() call to close out cleanly after a tool call (feeding the tool result back
  // for the model's finishing turn — same mechanics scout.mjs/drafter.mjs already run on), and
  // that finishing round is a SEPARATE LLM call with its own (usually small, unrelated) usage.
  // `result.usage` from loop.run() is documented in bare-agent's own source as "last-round only,
  // back-compat" — using it here would silently measure the WRONG round for the TOOL arm (the
  // finishing acknowledgment, not the round that actually emitted the tool-call JSON). The round
  // that produced this arm's measured content is always the FIRST metering event.
  const meterings = [];
  const loop = new Loop({ provider, rates, onLlmResult: async (event) => { meterings.push(event); } });

  const shared = `Here is a JSON array of integers:\n${payloadText()}\n\n`;
  let tools = [];
  let messages;
  let getCapturedArgs = () => null;

  if (kind === 'text') {
    messages = [
      {
        role: 'system',
        content: 'You repeat back exactly what you are given, as plain text. No markdown, no code '
          + 'fences, no commentary — output ONLY the array, nothing else.',
      },
      { role: 'user', content: `${shared}Repeat this array back to me exactly, character for character.` },
    ];
  } else {
    const made = makeEmitPayloadTool();
    tools = [made.tool];
    getCapturedArgs = made.getCapturedArgs;
    messages = [
      { role: 'system', content: 'You answer ONLY by calling emit_payload, once, with the exact array you are given.' },
      { role: 'user', content: `${shared}Call emit_payload now with this exact array as "numbers".` },
    ];
  }

  const startedAt = Date.now();
  let error = null;
  let result = null;
  try {
    result = await loop.run(messages, tools, { maxTokens: TOKENPROBE_MAX_TOKENS });
  } catch (err) {
    error = err.message;
  }
  const wallMs = Date.now() - startedAt;
  const metering = meterings[0] ?? null; // the round that actually produced this arm's content

  let reported = null;
  let charCount = null;
  if (!error) {
    if (kind === 'text') {
      reported = extractJsonArray(result?.text);
      charCount = typeof result?.text === 'string' ? result.text.length : null;
    } else {
      const args = getCapturedArgs();
      reported = Array.isArray(args?.numbers) ? args.numbers : null;
      // CAVEAT: bare-agent's OpenAI provider JSON.parse()s tool-call arguments before this code
      // ever sees them (provider-openai.js: `arguments: JSON.parse(tc.function.arguments)`) — the
      // raw wire string the model actually emitted is gone by the time we get here. Re-serializing
      // with JSON.stringify is the closest available approximation of "characters produced", not
      // the true wire count. For THIS payload (bare integers, nothing to escape) a compact
      // JSON.stringify should track the model's own compact emission closely — this is exactly why
      // the payload is integers, not strings. If arms disagree sharply, re-check this caveat before
      // trusting the verdict.
      charCount = args !== null ? JSON.stringify(args).length : null;
    }
  }

  const compliant = reported !== null && isCompliant(reported);
  const outputTokens = metering?.usage?.outputTokens ?? null;
  const ratio = charCount != null && outputTokens != null
    ? charsPerOutputToken(charCount, outputTokens)
    : null;

  const measurement = {
    kind,
    error,
    compliant,
    charCount,
    usage: metering?.usage ?? null,
    outputTokens,
    ratio,
    costUsd: metering?.costUsd ?? null,
    rateSource: metering?.rateSource ?? null,
    model: metering?.model ?? null,
    wallMs,
  };

  if (live) {
    // The LEDGER gets the CUMULATIVE cost across every round this arm actually ran (result.metrics
    // — includes the finishing round's spend too, PRD §5: nothing spent is ever dropped from the
    // ledger), even though the MEASUREMENT above deliberately isolates round 0's usage. A run that
    // priced nothing at all (metrics.costUsd === null) still gets a row with costUsd: null, which
    // assertUnderGlobalCap treats as "at the cap" — unknown cost is never rendered as 0.
    const cumulativeCostUsd = result?.metrics?.costUsd ?? metering?.costUsd ?? null;
    appendSpendRow(SPEND_PATH, {
      runId: runLabel,
      step: `tokenprobe-${kind}`,
      model: resolvedModelId,
      modelReturned: metering?.model ?? null,
      tokens: result?.metrics?.tokens ?? metering?.usage ?? null,
      costUsd: cumulativeCostUsd,
      rateSource: metering?.rateSource ?? null,
      wallMs,
    });
    if (cumulativeCostUsd != null && cumulativeCostUsd > RUN_CAP_USD) {
      console.error(`WARNING: tokenprobe ${kind} arm cost $${cumulativeCostUsd} exceeds the per-run $${RUN_CAP_USD} cap`);
    }
  }

  return measurement;
}

/** Run both arms against one slot/model and compute the verdict. */
export async function runProbe(modelId, {
  slot = 'deepseek', runLabel = 'tokenprobe', textProvider, textRates, toolProvider, toolRates,
} = {}) {
  const text = await runArm('text', modelId, {
    slot, runLabel, provider: textProvider, rates: textRates,
  });
  const tool = await runArm('tool', modelId, {
    slot, runLabel, provider: toolProvider, rates: toolRates,
  });
  return { slot, modelId, text, tool, verdict: verdict(text, tool) };
}

function fmtNum(n, digits = 2) {
  return n === null || n === undefined ? 'n/a' : Number(n).toFixed(digits);
}

/** Side-by-side table + verdict line for one slot's probe result. */
export function formatReport(probeResult) {
  const { slot, modelId, text, tool, verdict: v } = probeResult;
  const rows = [
    ['arm', 'compliant', 'chars', 'inputTok', 'outputTok', 'cacheReadTok', 'chars/outTok', 'costUsd'],
    [
      'TEXT', String(text.compliant), fmtNum(text.charCount, 0), fmtNum(text.usage?.inputTokens, 0),
      fmtNum(text.outputTokens, 0), fmtNum(text.usage?.cacheReadTokens, 0), fmtNum(text.ratio), fmtNum(text.costUsd, 6),
    ],
    [
      'TOOL', String(tool.compliant), fmtNum(tool.charCount, 0), fmtNum(tool.usage?.inputTokens, 0),
      fmtNum(tool.outputTokens, 0), fmtNum(tool.usage?.cacheReadTokens, 0), fmtNum(tool.ratio), fmtNum(tool.costUsd, 6),
    ],
  ];
  const widths = rows[0].map((_, col) => Math.max(...rows.map((r) => String(r[col]).length)));
  const lines = rows.map((r) => r.map((cell, i) => String(cell).padEnd(widths[i])).join('  '));
  return [
    `tokenprobe — slot=${slot} model=${modelId}`,
    ...lines,
    `VERDICT: ${v.verdict} — ${v.detail}`,
  ].join('\n');
}

// CLI entry point — live, opt-in ONLY (TOKENPROBE_LIVE=1). Never runs under
// `npm test`: node --test never executes this block (import.meta.url check),
// and no test file imports it to trigger it.
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.env.TOKENPROBE_LIVE !== '1') {
    console.error('A live tokenprobe round costs real money — set TOKENPROBE_LIVE=1 to run it. Refusing.');
    process.exit(1);
  }
  const args = process.argv.slice(2);
  const slots = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--slot') { slots.push(args[i + 1]); i += 1; }
  }
  if (slots.length === 0) slots.push('deepseek');

  for (const slot of slots) {
    // eslint-disable-next-line no-await-in-loop
    const result = await runProbe(undefined, { slot, runLabel: 'tokenprobe-live' });
    console.log(formatReport(result));
    console.log('');
  }
}
