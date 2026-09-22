// Provider factory — ONE writer for provider+rates+key selection (drafter.mjs
// and, in future, runner.mjs should stop hand-rolling this). Vanilla + node
// stdlib + bare-agent's own OpenAI provider class; no new dependencies.
//
// Money honesty (PRD §5, CLAUDE.md): unknown cost is NEVER rendered as 0.
// makeProvider throws rather than silently defaulting a missing rate, an
// unknown slot, or a missing API key.

import { OpenAI } from 'bare-agent/providers';
import { RATES_BY_SUFFIX, lookupRate } from './spend.mjs';

/**
 * F28 (2026-09-15, captured live): DeepSeek sometimes emits a tool-call whose
 * `function.arguments` is not valid JSON (observed: a trailing `}` — body
 * ending `..."matches": ["c2", "c3"]}}`). bare-agent 0.42.0 parses it at
 * `provider-openai.js`'s `generate()` with a bare `JSON.parse(tc.function.arguments)`
 * — AFTER the HTTP round already succeeded and `data.usage` came back — so the
 * `SyntaxError` escapes `generate()` entirely. `Loop` never calls `onLlmResult`
 * for that round, `runModelStepOnPrimitives` lands in its transport-catch
 * branch, writes a `costUsd: null` spend row, and reds `provider-red: ...`.
 * That null row then locks the global cap (F5's rule is correct — an unpriced
 * row must block further spend) even though the cost was KNOWN: `data.usage`
 * was sitting right there when the parse blew up.
 *
 * The right class for this is bare-agent's OWN "no usable tool call" path
 * (retry once, then red) with the round METERED — a model failure, not a
 * transport one. bare-agent's `generate()` has no seam for that (the parse
 * throws unconditionally), so this wraps it here, fwdloop-side, until the
 * upstream ask lands (filed separately — never patch node_modules).
 *
 * Wrapping strategy:
 *  - `_request` is overridden only to stash the resolved `data` on the
 *    instance (`_lastData`) before returning it — same signature, so every
 *    other behaviour (timeouts, deadlines, insecure-http warning, JSON
 *    parsing of the HTTP body itself) is untouched.
 *  - `generate` calls `super.generate(...)`; if it throws a `SyntaxError`
 *    AND the last response actually carried a tool call (the parse failure
 *    is exactly `tc.function.arguments` being bad JSON, never anything
 *    else), synthesize a result shaped exactly like a normal `generate()`
 *    return (see `provider-openai.js`'s `generate()`: `text`, `toolCalls`,
 *    `model`, `stopReason`, `usage`) with `toolCalls: []` (the call could
 *    not be parsed, so there is nothing to execute) and an extra
 *    `malformedToolCall` field carrying what broke. Any other error
 *    (network, HTTP 4xx/5xx, a SyntaxError with no tool call in the
 *    response) rethrows unchanged.
 *  - `usage` is normalized via the INHERITED `_normalizeUsage` (never
 *    reimplemented) so the cache-token accounting (BA-24) stays exactly the
 *    library's own math.
 *  - `stopReason: 'tool_use'` — OpenAI's `finish_reason: 'tool_calls'` maps
 *    to the neutral `'tool_use'` unconditionally in bare-agent's own
 *    `provider-stop-reason.js` OPENAI table (no `ctx.hasToolCalls` branch
 *    for OpenAI; that promotion path is Gemini/Ollama-only), so this is the
 *    honest, standing raw-value report, not an invention.
 *  - `Loop` (`node_modules/bare-agent/src/loop.js` ~line 823) doesn't
 *    special-case unknown fields on the `generate()` return, and its final
 *    `loop.run()` return object is a fixed field set — `malformedToolCall`
 *    does NOT survive into `loop.run()`'s result. So it is ALSO stashed on
 *    the instance (`this.lastMalformedToolCall`, reset at the top of every
 *    `generate()` call) — the one channel `runModelStepOnPrimitives` (same
 *    provider reference) can read after `loop.run()` returns, to tell a
 *    genuinely-malformed round apart from a model that just returned text.
 */
export class MalformedToolCallTolerantOpenAI extends OpenAI {
  async _request(path, body, timeoutMs, deadlineMs) {
    const data = await super._request(path, body, timeoutMs, deadlineMs);
    this._lastData = data;
    return data;
  }

  async generate(messages, tools = [], options = {}) {
    this.lastMalformedToolCall = null;
    try {
      return await super.generate(messages, tools, options);
    } catch (err) {
      if (!(err instanceof SyntaxError)) throw err;
      const msg = this._lastData?.choices?.[0]?.message;
      const toolCalls = msg?.tool_calls;
      if (!Array.isArray(toolCalls) || toolCalls.length === 0) throw err;
      const tc = toolCalls[0];
      const rawArguments = typeof tc?.function?.arguments === 'string'
        ? tc.function.arguments.slice(0, 500)
        : '';
      const malformedToolCall = { name: tc?.function?.name ?? null, rawArguments, error: err.message };
      this.lastMalformedToolCall = malformedToolCall;
      return {
        text: msg.content || '',
        toolCalls: [],
        model: this._lastData.model || this.model,
        stopReason: 'tool_use',
        usage: this._normalizeUsage(this._lastData.usage),
        malformedToolCall,
      };
    }
  }
}

/** Provider slots. Frozen — add a new slot here, never inline a baseUrl/env var elsewhere.
 *  F12 (2026-09-09): `deepseek` is the BASELINE slot, `synthetic` the second provider. */
export const PROVIDER_SLOTS = Object.freeze({
  synthetic: Object.freeze({
    baseUrl: 'https://api.synthetic.new/openai/v1',
    envVar: 'SYNTHETIC_API_KEY',
    defaultModel: 'hf:Qwen/Qwen3.8-27B',
    legacyMaxTokens: false,
  }),
  deepseek: Object.freeze({
    baseUrl: 'https://api.deepseek.com',
    envVar: 'DEEPSEEK_API_KEY',
    // F22 (2026-09-11): DeepSeek retired the `deepseek-v4-flash` name. It's still ACCEPTED but
    // now routed to DeepSeek-V4.1-Flash, so requesting it stamps every row 'substituted'. Ask
    // for the live name so request = served and the stamp reads 'match'.
    defaultModel: 'deepseek-flash',
    // F11: DeepSeek silently IGNORES `max_completion_tokens` (bare-agent 0.42.0's default key)
    // — asked for 64 output tokens, got 783, stopReason 'end_turn'. It honours only the legacy
    // `max_tokens`. Without this the output cap is theatre and a runaway step is unbounded.
    legacyMaxTokens: true,
  }),
});

/**
 * Resolve a modelId to its hand-entered rate row. The actual suffix-strip +
 * Object.hasOwn table lookup lives in spend.mjs's `lookupRate` (ONE writer,
 * shared with `ceilingCostUsd` there — never a second table walked two
 * different ways; spend.mjs never imports this file, so no circular
 * import). This function's own job is just the "throw rather than return
 * undefined" contract callers here rely on, so a caller can never carry
 * forward a 0 rate. `ratesTable` is injectable (defaults to the real
 * RATES_BY_SUFFIX) so a test can run this exact logic against a table that
 * deliberately lacks an entry.
 */
export function resolveModelRate(modelId, ratesTable = RATES_BY_SUFFIX) {
  const resolved = lookupRate(modelId, ratesTable);
  if (!resolved) throw new Error(`no hand-entered rate for model suffix "${String(modelId).replace(/^hf:/, '')}"`);
  return resolved;
}

/**
 * Build a provider for the given slot. Throws (never defaults) on: an unknown
 * slot, a missing env key, or a model with no hand-entered rate.
 * Returns { provider, rates, modelId, suffix, slot }.
 *
 * `timeoutMs` (M0b Part 2.2, 2026-09-13): bounds a silent/never-answering
 * socket (BA-18) — without it, a raw socket-level failure can hang far
 * longer than the provider's documented default appears to actually enforce
 * for a given baseUrl (observed live: "read ETIMEDOUT" after 3045006ms).
 * Optional and undefined by default (bare-agent's own default applies) so
 * every EXISTING caller of makeProvider is unaffected; the runner passes
 * 300_000 for its own rounds — this is the ONE writer for provider
 * construction, so that value is passed in here rather than a second
 * `new OpenAI(...)` call constructing its own provider inline.
 *
 * `deadlineMs` (F27, 2026-09-14): bare-agent's BA-19 TOTAL wall-clock ceiling
 * (`applyRequestDeadline` in provider-http.js) — distinct from `timeoutMs`'s
 * BA-18 IDLE bound, which resets on any socket byte and so never trips on a
 * "zombie stream" (200 + headers + one byte, then silence — DeepSeek,
 * observed live, ~900s per hang before the CloudFront edge itself closed
 * it). On trip: `TimeoutError`, `code: 'EDEADLINE'`, `retryable: false`.
 * Optional and undefined by default, same conditional-spread pattern as
 * `timeoutMs`, so every existing caller is unaffected.
 */
export function makeProvider(slotName, { model, timeoutMs, deadlineMs } = {}) {
  const slot = PROVIDER_SLOTS[slotName];
  if (!slot) {
    throw new Error(`unknown provider slot "${slotName}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
  }

  const apiKey = process.env[slot.envVar];
  if (!apiKey) throw new Error(`${slot.envVar} is not set`);

  const modelId = model ?? slot.defaultModel;
  const { suffix, rates } = resolveModelRate(modelId);

  // F28: every slot goes through the malformed-tool-call-tolerant wrapper — it is a pure superset
  // of OpenAI's own behaviour (transparent on a clean parse, see provider.test.mjs), so there is no
  // reason to special-case `deepseek` here even though that is the only slot the bug was caught on.
  const provider = new MalformedToolCallTolerantOpenAI({
    apiKey,
    model: modelId,
    baseUrl: slot.baseUrl,
    legacyMaxTokens: slot.legacyMaxTokens === true,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(deadlineMs !== undefined ? { deadlineMs } : {}),
  });

  return {
    provider, rates, modelId, suffix, slot: slotName,
  };
}
