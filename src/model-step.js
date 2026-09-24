// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED"): the live `modelStep(executorContext, grantedTools, stepMeta)`
// piece 1's `runFlow` expects. One attempt = up to 3 rounds (a round is one
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
  },
  required: ['fields'],
});

const SOFTGREEN_SCHEMA = Object.freeze({
  type: 'object',
  properties: {
    text: { type: 'string' },
    lines: { type: 'array', items: { type: 'string' } },
  },
  required: ['text'],
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
  },
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

function addCost(cumulative, metered) {
  const rounds = cumulative.rounds + metered.rounds;
  if (cumulative.costUsd === null || metered.costUsd === null) return { costUsd: null, rounds };
  return { costUsd: cumulative.costUsd + metered.costUsd, rounds };
}

/**
 * @param {object} opts
 * @param {string} [opts.slot] - a `src/provider.js` PROVIDER_SLOTS name; required when `provider` isn't injected.
 * @param {string} [opts.model] - overrides the slot's default model.
 * @param {string} opts.spendPath - the run's spend.jsonl (never a second ledger).
 * @param {any} [opts.provider] - an injected provider (tests only; production always builds live via `slot`).
 * @param {{in:number,out:number}} [opts.rates]
 * @param {string} [opts.modelId]
 * @returns {(executorContext:object, grantedTools:Record<string,any>, stepMeta?:{class?:string}) => Promise<any>}
 */
export function makeLiveModelStep({
  slot, model, spendPath, provider: injectedProvider, rates: injectedRates, modelId: injectedModelId,
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
        ({ provider, rates, modelId } = makeProvider(slot, { model, ...LIVE_PROVIDER_OPTIONS }));
      } catch (err) {
        return {
          ok: false, red: `key: ${err.message}`, costUsd: null, model: model ?? null,
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

    const primitiveTools = Object.values(grantedTools ?? {}).filter(Boolean);

    let cumulative = { costUsd: 0, rounds: 0 };
    let noToolCallStreak = 0;

    for (let round = 1; round <= 3; round += 1) {
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
        cumulative = addCost(cumulative, partial);
        appendSpendRow(spendPath, {
          model: modelId,
          modelReturned: partial.model,
          tokens: partial.tokens,
          costUsd: partial.costUsd,
          rounds: partial.rounds,
          wallMs,
          error: err.message,
        });
        if (isTransportFailure(err)) {
          return {
            ok: false,
            transport: true,
            costUsd: cumulative.costUsd,
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
          model: modelId,
          modelMatch: classifyModelId(modelId, partial.model),
        };
      }

      const wallMs = Date.now() - startedAt;
      const metered = sumMeterings(roundMeterings);
      cumulative = addCost(cumulative, metered);
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
          model: modelId,
          modelMatch,
        };
      }

      if (capturedArtifact === undefined) {
        noToolCallStreak += 1;
        if (noToolCallStreak >= 2) {
          const malformed = provider?.lastMalformedToolCall ?? null;
          if (malformed) {
            return {
              ok: false,
              red: `the tool call's arguments were not valid JSON twice in a row (${malformed.error}); raw: ${malformed.rawArguments}`,
              costUsd: cumulative.costUsd,
              model: modelId,
              modelMatch,
            };
          }
          return {
            ok: false,
            red: `a FINISHED round (stopReason=${result.stopReason}) returned text instead of the tool twice in a row. Text: ${JSON.stringify(result.text)}`,
            costUsd: cumulative.costUsd,
            model: modelId,
            modelMatch,
          };
        }
        // eslint-disable-next-line no-continue
        continue; // retry once, same attempt
      }

      if (cumulative.costUsd === null) {
        return {
          ok: false, red: 'pricing-red: an unpriced round leaves this attempt\'s cost unknown', costUsd: null, model: modelId, modelMatch,
        };
      }

      return {
        ok: true, artifact: capturedArtifact, costUsd: cumulative.costUsd, model: modelId, modelMatch,
      };
    }

    return {
      ok: false, red: 'exhausted rounds without a clean result', costUsd: cumulative.costUsd, model: modelId,
    };
  };
}
