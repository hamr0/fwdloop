// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED", scope items 7/8): provider slots, hand-entered rates, the spend
// ceiling, the key preflight, and `makeProvider`. Money honesty (project
// rule, CLAUDE.md): unknown cost is NEVER rendered as 0 — an unknown model
// prices at the rate table's HIGHEST entry and the row is stamped
// `substituted`; `assertUnderGlobalCap`/`appendSpendRow` never coerce a null
// cost to a number.
//
// borrowed-from: fwdloop poc/m0/provider.mjs@76a3607 (`PROVIDER_SLOTS`,
// `makeProvider`, `resolveModelRate`, `MalformedToolCallTolerantOpenAI` —
// F28's tolerant wrapper for a DeepSeek tool-call whose `arguments` is bad
// JSON) and fwdloop poc/m0/spend.mjs@76a3607 (`RATES_BY_SUFFIX`,
// `lookupRate`, `ceilingCostUsd`, `classifyModelId`, `appendSpendRow`,
// `assertUnderGlobalCap`) and fwdloop poc/m1/slot-batch.mjs@76a3607
// (`checkKeyPreflight`: refuse an unset/empty/whitespace/newline key at $0,
// before any ledger write — F26/2026-09-21's live defect). Rewritten
// against src/'s ESM style; src never imports from poc/.

import {
  appendFileSync, existsSync, mkdirSync, readFileSync,
} from 'node:fs';
import { dirname } from 'node:path';
import { OpenAI } from 'bare-agent/providers';

/**
 * F28 (2026-09-15): DeepSeek sometimes emits a tool-call whose
 * `function.arguments` is not valid JSON. bare-agent's own `generate()`
 * parses it unconditionally and throws a bare `SyntaxError` AFTER the HTTP
 * round already succeeded (`data.usage` is known) — the right class for
 * this is "no usable tool call" (metered, retried once, then red), never a
 * transport fault. This wrapper stashes the last HTTP response and, on a
 * `SyntaxError` whose response DID carry a tool call, returns a normal
 * `generate()`-shaped result with `toolCalls: []` and a `malformedToolCall`
 * extra field instead of throwing. Any other error rethrows unchanged.
 */
class MalformedToolCallTolerantOpenAI extends OpenAI {
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

/** Provider slots. Frozen — add a new slot here, never inline a baseUrl/env
 *  var elsewhere. `deepseek` is the baseline (F12); `synthetic` is second. */
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
    // F22: 'deepseek-v4-flash' is retired, routed to DeepSeek-V4.1-Flash —
    // request the live name so request === served.
    defaultModel: 'deepseek-flash',
    // F11: DeepSeek ignores `max_completion_tokens`; only the legacy
    // `max_tokens` key bounds output.
    legacyMaxTokens: true,
  }),
});

/**
 * List-rate ceilings (USD/1K tokens), hand-entered — see
 * poc/m0/spend.mjs@76a3607 for sourcing notes per row. A rate changes by
 * editing a row here, never a second table or a runtime flag (hamr's
 * ruling, 2026-09-21).
 */
export const RATES_BY_SUFFIX = {
  'zai-org/GLM-5.2': { in: 0.0006, out: 0.0022, source: 'published' },
  'moonshotai/Kimi-K3': { in: 0.0006, out: 0.0025, source: 'published' },
  'zai-org/GLM-5.3-Flash': { in: 0.00015, out: 0.0005, source: 'published' },
  'zai-org/GLM-4.7-Flash': { in: 0.00006, out: 0.0004, source: 'published' },
  'Qwen/Qwen3.8-27B': { in: 0.00015, out: 0.002, source: 'published' },
  'openai/gpt-oss-120b': { in: 0.00003, out: 0.00017, source: 'published' },
  'nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4': { in: 0.000085, out: 0.0004, source: 'published' },
  'syn:large:text': { in: 0.0006, out: 0.0025, source: 'ceiling' },
  'syn:small:text': { in: 0.0006, out: 0.0025, source: 'ceiling' },
  'deepseek-v4-flash': { in: 0.00044, out: 0.00132, source: 'published' }, // F22: retired name, historical rows only
  'deepseek-flash': { in: 0.0003, out: 0.0012, source: 'published' }, // DeepSeek-V4.1-Flash, cache-miss peak
  'deepseek-v4-pro': { in: 0.00132, out: 0.00396, source: 'published' },
};

/**
 * Strip an `hf:` routing prefix and look up `suffix` with `Object.hasOwn` —
 * never plain truthiness/`in`, which would let a suffix like `"constructor"`
 * resolve to an inherited `Object.prototype` member.
 */
export function lookupRate(modelId, ratesTable = RATES_BY_SUFFIX) {
  if (!modelId) return null;
  const suffix = String(modelId).replace(/^hf:/, '');
  if (!Object.hasOwn(ratesTable, suffix)) return null;
  return { suffix, rates: ratesTable[suffix] };
}

/** Resolve a modelId to its hand-entered rate row, or throw — a caller here
 *  must never carry forward a 0 rate. */
export function resolveModelRate(modelId, ratesTable = RATES_BY_SUFFIX) {
  const resolved = lookupRate(modelId, ratesTable);
  if (!resolved) throw new Error(`no hand-entered rate for model suffix "${String(modelId).replace(/^hf:/, '')}"`);
  return resolved;
}

// The two hard bounds a round is priced against when its real cost is
// unavailable: no round in this tree ever emits more output than
// `CEILING_OUTPUT_TOKENS`, and no prompt this project sends exceeds
// `CEILING_INPUT_TOKENS` (a documented, generous bound — never a measured
// number passed off as exact).
export const CEILING_INPUT_TOKENS = 32000;
export const CEILING_OUTPUT_TOKENS = 16000;

/**
 * The ceiling cost (USD) of one round of `modelId` — never 0, never null.
 * A known model prices at its own rate; an unknown/missing model prices at
 * the HIGHEST in/out rate anywhere in `ratesTable`.
 */
export function ceilingCostUsd(modelId, ratesTable = RATES_BY_SUFFIX) {
  const resolved = lookupRate(modelId, ratesTable);
  const rates = resolved ? resolved.rates : {
    in: Math.max(...Object.values(ratesTable).map((r) => r.in)),
    out: Math.max(...Object.values(ratesTable).map((r) => r.out)),
  };
  return (CEILING_INPUT_TOKENS / 1000) * rates.in + (CEILING_OUTPUT_TOKENS / 1000) * rates.out;
}

/**
 * Compare the model asked for against the model actually served.
 * `match` identical; `prefix` identical once a routing prefix is stripped;
 * `alias` a declared `syn:` alias resolving to a concrete model (expected);
 * `substituted` a concrete request served by a DIFFERENT concrete model
 * (the one that matters — the signed hash records the request, not what
 * ran); `unreported` the provider told us nothing.
 */
export function classifyModelId(requested, returned) {
  if (!requested) return 'unreported';
  if (returned === null || returned === undefined || returned === '') return 'unreported';
  if (requested === returned) return 'match';
  if (String(requested).replace(/^[a-z]+:/, '') === returned) return 'prefix';
  if (/^syn:/.test(requested)) return 'alias';
  return 'substituted';
}

/**
 * Sum every round of one model attempt into one meter. Money honesty in the
 * strict direction: if ANY round has no priced cost, `costUsd` is `null` —
 * never 0, never a partial sum passed off as complete. `rounds` records how
 * many rounds folded in.
 */
export function sumMeterings(events) {
  const rounds = Array.isArray(events) ? events.filter(Boolean) : [];
  if (rounds.length === 0) {
    return {
      rounds: 0, tokens: null, costUsd: null, model: null, rateSource: null,
    };
  }
  const tokens = {
    inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0,
  };
  let costUsd = 0;
  let costKnown = true;
  for (const ev of rounds) {
    for (const key of Object.keys(tokens)) tokens[key] += ev?.usage?.[key] ?? 0;
    if (ev?.costUsd == null) costKnown = false;
    else costUsd += ev.costUsd;
  }
  const last = rounds[rounds.length - 1];
  return {
    rounds: rounds.length,
    tokens,
    costUsd: costKnown ? costUsd : null,
    model: last?.model ?? null,
    rateSource: last?.rateSource ?? null,
  };
}

/** Append one spend row, stamping `modelMatch` — the one writer for
 *  spend.jsonl. Warns (never throws) on a `substituted` model. */
export function appendSpendRow(path, row) {
  mkdirSync(dirname(path), { recursive: true });
  const modelMatch = classifyModelId(row.model, row.modelReturned);
  if (modelMatch === 'substituted') {
    process.emitWarning(
      `spend: asked for model "${row.model}" but the provider served "${row.modelReturned}" `
      + '— the signed hash records the request, not what ran',
    );
  }
  appendFileSync(path, `${JSON.stringify({ ...row, modelMatch })}\n`);
}

function readSpendTotal(path) {
  if (!existsSync(path)) return 0;
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim());
  let total = 0;
  for (const line of lines) {
    const row = JSON.parse(line);
    total += row.costUsd === null || row.costUsd === undefined ? ceilingCostUsd(row.model) : row.costUsd;
  }
  return total;
}

/** Throws once total spend (every null row repriced at its ceiling) is at
 *  or over `capUsd`. */
export function assertUnderGlobalCap(path, capUsd) {
  const total = readSpendTotal(path);
  if (total >= capUsd) throw new Error(`global spend cap reached: $${total.toFixed(6)} >= $${capUsd.toFixed(2)} (${path})`);
  return total;
}

/**
 * $0 preflight before any draft round and before any ledger write: the key
 * env var for `slotName` must be set, non-empty, and free of any
 * whitespace/control character (F26, 2026-09-21: a two-line `pass` entry
 * exported a key with a trailing newline — still truthy, so a bare
 * `if (!apiKey)` never caught it). Never throws — `{ ok:true }` or
 * `{ ok:false, message }`; `message` never includes the key's value.
 *
 * @param {string} slotName
 * @param {Record<string,string|undefined>} [env]
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
 * Build a provider for the given slot. Throws (never defaults) on an
 * unknown slot, a missing/bad env key, or a model with no hand-entered
 * rate. Returns `{ provider, rates, modelId, suffix, slot }`.
 *
 * `timeoutMs`/`deadlineMs` bound a silent socket (BA-18 idle) and a
 * zombie-stream total wall clock (BA-19), respectively — see
 * `LIVE_PROVIDER_OPTIONS` in src/model-step.js, the one writer of the live
 * values this project uses.
 *
 * @param {string} slotName
 * @param {{ model?: string, timeoutMs?: number, deadlineMs?: number }} [options]
 * @returns {{ provider: any, rates: {in:number, out:number}, modelId: string, suffix: string, slot: string }}
 */
export function makeProvider(slotName, options = {}) {
  const { model, timeoutMs, deadlineMs } = options;
  const slot = PROVIDER_SLOTS[slotName];
  if (!slot) {
    throw new Error(`unknown provider slot "${slotName}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
  }

  const keyCheck = checkKeyPreflight(slotName);
  if (!keyCheck.ok) throw new Error(keyCheck.message);

  const apiKey = process.env[slot.envVar];
  const modelId = model ?? slot.defaultModel;
  const { suffix, rates } = resolveModelRate(modelId);

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
