// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED"): the live `modelStep(executorContext, grantedTools, stepMeta)`
// piece 1's `runFlow` expects. One attempt = up to 2 rounds (a round is one
// fresh `bare-agent` `Loop` run; a round retries only on "no usable tool
// call" or a malformed tool-call, never on a transport fault or a
// wall-clock deadline). Every round is metered via `appendSpendRow`
// (`src/provider.js`, one writer for the ledger line); the attempt's
// returned `costUsd` is the SUM across every round this attempt ran ("meter
// the whole unit of work" — CLAUDE.md/AGENT_RULES — never the last round's
// number passed off as the attempt's total).
//
// borrowed-from: fwdloop poc/m0/runner.mjs@76a3607
// (`runModelStepOnPrimitives`'s round/retry rules: rule 1 transport retry,
// rule 3 no-tool-call retry once then red, rule 4 max_tokens never
// retried, rule 5 never throw for a model failure; `LIVE_PROVIDER_OPTIONS`
// timeoutMs 300s / deadlineMs 240s). Piece 1's own ralph loop (M2 scope
// item 8) owns the ONE retry on a `transport:true` result — this module
// therefore does NOT retry a transport fault itself; it returns
// `{ ok:false, transport:true, costUsd, spendComplete:false }` on the
// FIRST one and lets `runFlow` call this function again fresh for the
// retry, exactly once, per its own ladder.
//
// The tool schema `emit_artifact` is built from `stepMeta.class` ONLY
// (green/softgreen/anything else) — never from the step's `shape` — the
// executor context (M2 scope item 3) carries neither.

import { Loop } from 'bare-agent';
import { GateRefusal } from './primitives.js';

import {
  makeProvider, sumMeterings, appendSpendRow, classifyModelId,
} from './provider.js';

// F27: DeepSeek's `chat/completions` can send HTTP 200 + headers + one byte
// then nothing — a "zombie stream" that `timeoutMs`'s idle bound never
// trips on. `deadlineMs` is bare-agent's TOTAL wall-clock ceiling
// (`code: 'EDEADLINE'`, `retryable: false`) — deliberately shorter than
// `timeoutMs` so a hung request reds well inside the idle bound. Frozen +
// exported so a test can assert on the live call's actual config.
export const LIVE_PROVIDER_OPTIONS = Object.freeze({ timeoutMs: 300_000, deadlineMs: 240_000 });

const TRANSPORT_CODES = Object.freeze([
  'ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'EPIPE', 'ENETUNREACH', 'EAI_AGAIN',
]);

/**
 * True for a transport-layer fault (a request that never reached or never
 * heard back from the provider) — never true for an application-level
 * failure (an HTTP status the provider server actually sent, a wall-clock
 * deadline). `EDEADLINE` (bare-agent's BA-19 total wall-clock ceiling) is
 * explicitly excluded: M2 scope item 8 says a wall-clock timeout is NEVER
 * retried, so it must never be classified as the retryable `transport`
 * shape however similar its symptom looks.
 *
 * @param {any} err
 */
export function isTransportFailure(err) {
  if (!err) return false;
  if (err.code === 'EDEADLINE') return false;
  if (typeof err.code === 'string' && TRANSPORT_CODES.includes(err.code)) return true;
  const msg = String(err.message ?? '');
  if (TRANSPORT_CODES.some((code) => msg.includes(code))) return true;
  if (/fetch failed/i.test(msg)) return true;
  if (/\bTLS\b/i.test(msg) || /\bSSL\b/i.test(msg)) return true;
  return false;
}

// M2 amendment 1 item 1 (docs/wiki/the-module-ladder.md, "M2 amendment 1 —
// SIGNED"): every class's `emit_artifact` schema carries the step's own
// typed self-report — `done` (required) and `blocker` — so `src/runner.js`
// can take the model's own word at face value, mechanically, before any
// close runs. Shared across all three schemas so their wording can never
// drift apart.
const DONE_PROPS = Object.freeze({
  done: {
    type: 'boolean',
    description: "true only if this step's goal was actually accomplished with real data; false if anything blocked it",
  },
  blocker: {
    type: ['string', 'null'],
    description: 'when done is false, one sentence naming what blocked you (a file you could not read, a tool that refused, data that was missing); null when done is true',
  },
});

const GREEN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    fields: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        properties: { value: {}, cite: { type: 'string' } },
        required: ['value', 'cite'],
      },
    },
    ...DONE_PROPS,
  },
  required: ['fields', 'done'],
});

const SOFTGREEN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    text: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' } },
    ...DONE_PROPS,
  },
  required: ['text', 'done'],
});

// hitl/read-style steps: the documented common shapes are {text} or
// {cells}, but a step with no declared guardrail (M1's own silent-default
// hitl, e.g. job #1's read steps) may legitimately emit any typed object —
// `additionalProperties: true` accepts that without ever consulting the
// step's shape (there is none to consult here; only its class).
const HITL_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    text: { type: 'string' },
    cells: { type: 'object' },
    ...DONE_PROPS,
  },
  required: ['done'],
  additionalProperties: true,
});

/**
 * Build the `emit_artifact` tool schema from a step's declared close CLASS
 * only. `stepClass` is `'green' | 'softgreen' | 'hitl' | null | undefined`.
 */
export function buildEmitArtifactSchema(stepClass) {
  if (stepClass === 'green') return GREEN_SCHEMA;
  if (stepClass === 'softgreen') return SOFTGREEN_SCHEMA;
  return HITL_SCHEMA;
}

// M4a-2 (docs/wiki/the-module-ladder.md, "M4a" section, "Amendment M4a-2 —
// SIGNED by hamr 2026-09-27"): the attempt's `tokens` for the audit row are
// summed here, at the SAME place `costUsd` already sums across rounds —
// never re-derived later by position from spend.jsonl (`src/books.js`'s own
// audit row is a different book with a different granularity: one row per
// ATTEMPT, not per round). Only the three fields the audit row's contract
// names (`inputTokens`, `outputTokens`, `cacheReadTokens`) are carried
// forward; `sumMeterings`' own `cacheCreationTokens` stays in spend.jsonl
// only. A round with no metering at all (`metered.tokens === null`, e.g. a
// synchronous throw before any `onLlmResult` fired) contributes zero, never
// turns the running total null — once ANY round in this attempt actually
// ran, the attempt's tokens are a known (possibly partial) count, not
// "unknown".
function addMeter(cumulative, metered) {
  const rounds = cumulative.rounds + metered.rounds;
  const costUsd = (cumulative.costUsd === null || metered.costUsd === null)
    ? null
    : cumulative.costUsd + metered.costUsd;
  const tokens = {
    inputTokens: cumulative.tokens.inputTokens + (metered.tokens?.inputTokens ?? 0),
    outputTokens: cumulative.tokens.outputTokens + (metered.tokens?.outputTokens ?? 0),
    cacheReadTokens: cumulative.tokens.cacheReadTokens + (metered.tokens?.cacheReadTokens ?? 0),
  };
  // M4a-3: this function only ever touches cost/rounds/tokens — `tools`/
  // `ungranted` (added by `addToolCounts`, a separate accumulator with a
  // separate source of truth, bare-agent's `metrics.byTool`) must survive a
  // round that never got that far, e.g. a round whose provider call threw
  // before `loop.run` returned anything to count tool calls FROM. Dropping
  // them here (returning a bare {costUsd,rounds,tokens}) would silently
  // erase every earlier round's real tool tally the moment a later round
  // faulted — caught live: `toolFields` threw on `cumulative.ungranted`
  // being undefined the very first time a transport fault hit round 1.
  return {
    costUsd, rounds, tokens, tools: cumulative.tools, ungranted: cumulative.ungranted, refused: cumulative.refused,
  };
}

// M4a-3 (docs/wiki/the-module-ladder.md, "M4a" section, "Amendment M4a-3 —
// SIGNED by hamr 2026-09-27"): the attempt's `tools` tally, taken from
// bare-agent's OWN per-round `result.metrics.byTool` — the same counter
// bare-agent bumps for every tool call the model makes regardless of outcome
// (BA's own comment: "a denied or unknown call is still an invocation the
// operator wants to see"). Never re-derived from an `onToolCall` hook: that
// hook only fires for a call that matched a tool bare-agent actually offered
// the model (`toolMap.get(tc.name)` succeeded), so a genuinely UNGRANTED
// name — one the model hallucinated that was never in this attempt's `tools`
// array at all — never reaches it; `metrics.byTool` is the one place both
// shapes are counted. `emit_artifact` is the step's own mandatory output
// call, not a granted primitive, and is deliberately never tallied into
// `tools` or `ungranted` (flagged for hamr's ruling if this reads
// differently — the amendment's own example, `{ read: 3, write: 1 }`, never
// mentions it either).
//
// Today, an ungranted name is refused by bare-agent BEFORE `tool.execute`
// ever runs (loop.js: `toolMap.get` misses -> `[Loop] Unknown tool: <name>`
// is fed back to the model as the tool result, `continue`s the round) — the
// model never gets real data back, it only learns the name doesn't exist.
// This module records that honestly: the name lands in `ungranted`, never
// silently folded into `tools` as if it had been allowed and had really run.
function addToolCounts(cumulative, byTool, grantedNames) {
  const tools = { ...cumulative.tools };
  const ungranted = new Set(cumulative.ungranted);
  for (const [name, count] of Object.entries(byTool ?? {})) {
    if (name === 'emit_artifact') continue;
    if (grantedNames.has(name)) {
      tools[name] = (tools[name] ?? 0) + count;
    } else {
      ungranted.add(name);
    }
  }
  return { tools, ungranted: [...ungranted].sort() };
}

// M4a-3: the `tools`/`ungranted` fields every returned result shape carries,
// built from the running `cumulative` the same way `tokens`/`costUsd` are —
// `ungranted` is left OFF the result entirely once empty (the audit row
// contract allows "absent or an array of strings"; an empty array on every
// clean row would just be noise).
function toolFields(cumulative) {
  return {
    tools: cumulative.tools,
    // Gate refusals this attempt — always present (empty array when none) so
    // absence can never be confused with "none".
    refused: cumulative.refused,
    ...(cumulative.ungranted.length > 0 ? { ungranted: cumulative.ungranted } : {}),
  };
}

/**
 * @param {object} opts
 * @param {string} [opts.slot] - a `src/provider.js` PROVIDER_SLOTS name; required when `provider` isn't injected.
 * @param {string} [opts.model] - overrides the slot's default model.
 * @param {string} opts.spendPath - the run's spend.jsonl (never a second ledger).
 * @param {any} [opts.provider] - an injected provider (tests only; production always builds live via `slot`).
 * @param {{in:number,out:number}} [opts.rates]
 * @param {string} [opts.modelId]
 * @param {Record<string,string|undefined>} [opts.env] - the merged shell+keys-file env the key is read from (default process.env).
 * @returns {(executorContext:object, grantedTools:Record<string,any>, stepMeta?:{class?:string}) => Promise<any>}
 */
export function makeLiveModelStep({
  slot, model, spendPath, provider: injectedProvider, rates: injectedRates, modelId: injectedModelId, env,
}) {
  const live = injectedProvider == null;

  return async function liveModelStep(executorContext, grantedTools, stepMeta = {}) {
    let provider = injectedProvider;
    let rates = injectedRates;
    let modelId = injectedModelId;
    if (live) {
      // makeProvider throws synchronously on a missing/bad key, an unknown
      // slot, or an unrated model — never let that escape as an unhandled
      // rejection out of the ralph loop; a step's own model failure is
      // always a red, never a crash (rule 5).
      try {
        if (!slot) throw new Error('makeLiveModelStep: "slot" is required when no provider is injected');
        ({ provider, rates, modelId } = makeProvider(slot, { model, env, ...LIVE_PROVIDER_OPTIONS }));
      } catch (err) {
        // No provider was ever built, so no round could possibly have run —
        // `model: null`, `tokens: null` and `tools: null` (M4a-3) here are the one honest
        // "no model call at all" case (never a zeroed object standing in for
        // a call that never happened). A row that names a model must carry its
        // tokens (appendAudit refuses it otherwise), so the model is not named.
        return {
          ok: false, red: `key: ${err.message}`, costUsd: null, model: null, tokens: null, tools: null,
        };
      }
    }

    const toolSchema = buildEmitArtifactSchema(stepMeta.class);
    const systemPrompt = 'You are executing one step of a signed, human-authored automation. '
      + 'Call emit_artifact exactly once with this step\'s result. Ground every value in the '
      + 'reads you were handed or the tools you were granted — never invent a figure.';
    const userContent = JSON.stringify({
      goal: executorContext.goal,
      reads: executorContext.reads,
      gap: executorContext.gap,
    });
    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent },
    ];

    // Per-attempt collector for bareguard gate refusals: each primitive is
    // wrapped so a typed GateRefusal is recorded, then rethrown unchanged so
    // the model still sees the refusal as its tool result.
    const refused = /** @type {Array<{verb:string, path:string, rule:string}>} */ ([]);
    const primitiveTools = Object.values(grantedTools ?? {}).filter(Boolean).map((tool) => ({
      ...tool,
      execute: async (...a) => {
        try { return await tool.execute(...a); } catch (err) {
          if (err instanceof GateRefusal) refused.push({ verb: err.verb, path: err.path, rule: err.rule });
          throw err;
        }
      },
    }));
    // M4a-3: "granted" is the step's own declared verb set — the keys of
    // `grantedTools` — not just the ones that resolved to a real primitive.
    // An unresolved granted verb never becomes a callable tool below (it's
    // filtered out of `primitiveTools` above), so the model could only ever
    // reach it by hallucinating the name, which still counts as `ungranted`
    // being wrong: it WAS granted, just broken. Treating it as granted here
    // (never `ungranted`) is the honest read of what the human actually
    // authorized this step to use.
    const grantedNames = new Set(Object.keys(grantedTools ?? {}));

    let cumulative = {
      costUsd: 0,
      rounds: 0,
      tokens: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0 },
      tools: /** @type {Record<string, number>} */ ({}),
      ungranted: /** @type {string[]} */ ([]),
      refused,
    };
    let noToolCallStreak = 0;

    for (let round = 1; round <= 2; round += 1) {
      let capturedArtifact;
      const emitTool = {
        name: 'emit_artifact',
        description: "Emit this step's one artifact.",
        parameters: toolSchema,
        execute: async (args) => { capturedArtifact = args; return { ok: true }; },
      };
      const tools = [...primitiveTools, emitTool];
      const roundMeterings = [];
      const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { roundMeterings.push(ev); } });

      const startedAt = Date.now();
      let result;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await loop.run(messages, tools, { maxTokens: 16000 });
      } catch (err) {
        const wallMs = Date.now() - startedAt;
        const partial = sumMeterings(roundMeterings);
        cumulative = addMeter(cumulative, partial);
        appendSpendRow(spendPath, {
          model: modelId,
          modelReturned: partial.model,
          tokens: partial.tokens,
          costUsd: partial.costUsd,
          rounds: partial.rounds,
          wallMs,
          error: err.message,
        });
        // The provider threw before `loop.run` ever returned a result, so no
        // tool call could possibly have happened THIS round (M4a-3) —
        // `cumulative.tools`/`ungranted` here are exactly whatever an
        // earlier round in this same attempt already accumulated, never
        // re-derived or invented for the round that just threw.
        if (isTransportFailure(err)) {
          return {
            ok: false,
            transport: true,
            costUsd: cumulative.costUsd,
            tokens: cumulative.tokens,
            ...toolFields(cumulative),
            spendComplete: false,
            red: `provider-red: ${err.message}`,
            model: modelId,
            modelMatch: classifyModelId(modelId, partial.model),
          };
        }
        if (err?.code === 'EDEADLINE') {
          return {
            ok: false,
            red: `wall-halt: ${err.message}`,
            costUsd: cumulative.costUsd,
            tokens: cumulative.tokens,
            ...toolFields(cumulative),
            model: modelId,
            modelMatch: classifyModelId(modelId, partial.model),
          };
        }
        // Any other application-level error: a genuine red, never thrown,
        // never retried by this module (piece 1's ralph loop governs a
        // whole new attempt if it wants one).
        return {
          ok: false,
          red: `provider-red: ${err.message}`,
          costUsd: cumulative.costUsd,
          tokens: cumulative.tokens,
          ...toolFields(cumulative),
          model: modelId,
          modelMatch: classifyModelId(modelId, partial.model),
        };
      }

      const wallMs = Date.now() - startedAt;
      const metered = sumMeterings(roundMeterings);
      cumulative = addMeter(cumulative, metered);
      cumulative = { ...cumulative, ...addToolCounts(cumulative, result.metrics?.byTool, grantedNames) };
      appendSpendRow(spendPath, {
        model: modelId,
        modelReturned: metered.model,
        tokens: metered.tokens,
        costUsd: metered.costUsd,
        rounds: metered.rounds,
        wallMs,
        stopReason: result.stopReason ?? null,
      });

      const modelMatch = classifyModelId(modelId, metered.model);

      if (result.stopReason === 'max_tokens') {
        // Rule 4: deterministic (the step needs a smaller output or a
        // bigger cap), never a transient fault a retry could fix.
        return {
          ok: false,
          red: `truncated: ${metered.tokens?.outputTokens ?? '?'} tokens, no tool call`,
          costUsd: cumulative.costUsd,
          tokens: cumulative.tokens,
          ...toolFields(cumulative),
          model: modelId,
          modelMatch,
        };
      }

      if (capturedArtifact === undefined) {
        noToolCallStreak += 1;
        if (noToolCallStreak >= 2) {
          const malformed = provider?.lastMalformedToolCall ?? null;
          if (malformed) {
            // bare-agent >=0.48 delivers `rawArguments` only when the provider
            // was built with `exposeMalformedArgs: true`; upstream caps it and
            // sets `rawTruncated` when clipped. Absent -> no "; raw:" suffix.
            const rawSuffix = malformed.rawArguments !== undefined
              ? `; raw: ${malformed.rawArguments}${malformed.rawTruncated === true ? ' (truncated)' : ''}`
              : '';
            return {
              ok: false,
              red: `the tool call's arguments were not valid JSON twice in a row (${malformed.error})${rawSuffix}`,
              costUsd: cumulative.costUsd,
              tokens: cumulative.tokens,
              ...toolFields(cumulative),
              model: modelId,
              modelMatch,
            };
          }
          return {
            ok: false,
            red: `a FINISHED round (stopReason=${result.stopReason}) returned text instead of the tool twice in a row. Text: ${JSON.stringify(result.text)}`,
            costUsd: cumulative.costUsd,
            tokens: cumulative.tokens,
            ...toolFields(cumulative),
            model: modelId,
            modelMatch,
          };
        }
        // eslint-disable-next-line no-continue
        continue; // retry once, same attempt
      }

      if (cumulative.costUsd === null) {
        return {
          ok: false, red: 'pricing-red: an unpriced round leaves this attempt\'s cost unknown', costUsd: null, model: modelId, modelMatch, tokens: cumulative.tokens, ...toolFields(cumulative),
        };
      }

      return {
        ok: true, artifact: capturedArtifact, costUsd: cumulative.costUsd, model: modelId, modelMatch, tokens: cumulative.tokens, ...toolFields(cumulative),
      };
    }

    return {
      ok: false, red: 'exhausted rounds without a clean result', costUsd: cumulative.costUsd, model: modelId, tokens: cumulative.tokens, ...toolFields(cumulative),
    };
  };
}
