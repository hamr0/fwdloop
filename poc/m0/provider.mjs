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
    defaultModel: 'deepseek-v4-flash',
    // F11: DeepSeek silently IGNORES `max_completion_tokens` (bare-agent 0.42.0's default key)
    // — asked for 64 output tokens, got 783, stopReason 'end_turn'. It honours only the legacy
    // `max_tokens`. Without this the output cap is theatre and a runaway step is unbounded.
    legacyMaxTokens: true,
  }),
});

/**
 * Build a provider for the given slot. Throws (never defaults) on: an unknown
 * slot, a missing env key, or a model with no hand-entered rate.
 * Returns { provider, rates, modelId, suffix, slot }.
 */
export function makeProvider(slotName, { model } = {}) {
  const slot = PROVIDER_SLOTS[slotName];
  if (!slot) {
    throw new Error(`unknown provider slot "${slotName}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
  }

  const apiKey = process.env[slot.envVar];
  if (!apiKey) throw new Error(`${slot.envVar} is not set`);

  const modelId = model ?? slot.defaultModel;
  const suffix = modelId.replace(/^hf:/, '');
  const rates = RATES_BY_SUFFIX[suffix];
  if (!rates) throw new Error(`no hand-entered rate for model suffix "${suffix}"`);

  const provider = new OpenAI({
    apiKey, model: modelId, baseUrl: slot.baseUrl, legacyMaxTokens: slot.legacyMaxTokens === true,
  });

  return {
    provider, rates, modelId, suffix, slot: slotName,
  };
}
