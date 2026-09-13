// Provider factory — ONE writer for provider+rates+key selection (drafter.mjs
// and, in future, runner.mjs should stop hand-rolling this). Vanilla + node
// stdlib + bare-agent's own OpenAI provider class; no new dependencies.
//
// Money honesty (PRD §5, CLAUDE.md): unknown cost is NEVER rendered as 0.
// makeProvider throws rather than silently defaulting a missing rate, an
// unknown slot, or a missing API key.

import { OpenAI } from 'bare-agent/providers';
import { RATES_BY_SUFFIX } from './spend.mjs';

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
 * Resolve a modelId to its hand-entered rate row. ONE writer for this lookup
 * (makeProvider below, and provider.test.mjs's coverage check, both call this
 * — never duplicate the suffix-strip + table-lookup elsewhere). Throws rather
 * than returning undefined so a caller can never carry forward a 0 rate.
 * `ratesTable` is injectable (defaults to the real RATES_BY_SUFFIX) so a test
 * can run this exact logic against a table that deliberately lacks an entry.
 */
export function resolveModelRate(modelId, ratesTable = RATES_BY_SUFFIX) {
  const suffix = modelId.replace(/^hf:/, '');
  // Object.hasOwn (not `ratesTable[suffix]` truthiness, not `in`): a suffix like "constructor" or
  // "toString" would otherwise resolve to an inherited Object.prototype member, skip the "no rate
  // -> throw" guard below, and let the run proceed with `rates.in`/`rates.out` undefined.
  if (!Object.hasOwn(ratesTable, suffix)) throw new Error(`no hand-entered rate for model suffix "${suffix}"`);
  const rates = ratesTable[suffix];
  return { suffix, rates };
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
 */
export function makeProvider(slotName, { model, timeoutMs } = {}) {
  const slot = PROVIDER_SLOTS[slotName];
  if (!slot) {
    throw new Error(`unknown provider slot "${slotName}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
  }

  const apiKey = process.env[slot.envVar];
  if (!apiKey) throw new Error(`${slot.envVar} is not set`);

  const modelId = model ?? slot.defaultModel;
  const { suffix, rates } = resolveModelRate(modelId);

  const provider = new OpenAI({
    apiKey,
    model: modelId,
    baseUrl: slot.baseUrl,
    legacyMaxTokens: slot.legacyMaxTokens === true,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
  });

  return {
    provider, rates, modelId, suffix, slot: slotName,
  };
}
