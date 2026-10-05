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
  appendFileSync, mkdirSync,
} from 'node:fs';
import { dirname, basename } from 'node:path';
import { readFileInside } from './flow.js';
import { readConfig, configDoorHome } from './config.js';
import { OpenAI } from 'bare-agent/providers';

/**
 * F28 (2026-09-15) / BA-27 (bare-agent >=0.47.0): DeepSeek sometimes emits a
 * tool-call whose `function.arguments` is not valid JSON. Before 0.47,
 * bare-agent's own `generate()` threw a bare `SyntaxError` AFTER the HTTP
 * round already succeeded — losing the billed round and hanging metering.
 * As of 0.47, `OpenAI.generate()` (bare-agent/src/provider-openai.js, via
 * `provider-toolcalls.js`'s `parseToolCalls`) no longer throws: it resolves
 * normally with `toolCalls: []` and a `malformedToolCall: { name, error }`
 * field already on the result. As of 0.48 the constructor option
 * `exposeMalformedArgs: true` (set in `makeProvider`) adds `rawArguments`
 * (capped upstream at 500 chars, `rawTruncated: true` when clipped). `Loop.run()` does not forward unknown
 * `generate()` fields into its own return, so this wrapper ALSO stashes the
 * marker on the instance (`this.lastMalformedToolCall`, reset at the top of
 * every `generate()` call) — the one channel `runModelStepOnPrimitives`
 * (same provider reference) can read after `loop.run()` returns. We require
 * bare-agent >=0.48 (package.json `^0.49.0`) and never patch around its
 * private response internals.
 */
class MalformedToolCallTolerantOpenAI extends OpenAI {
  async generate(messages, tools = [], options = {}) {
    this.lastMalformedToolCall = null;
    const result = await super.generate(messages, tools, options);
    if (result.malformedToolCall) this.lastMalformedToolCall = result.malformedToolCall;
    return result;
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
 * poc/m0/spend.mjs@76a3607 for sourcing notes per row. This table is the DEFAULT
 * price: a price set in Settings (`~/.config/fwdloop/config.json` `prices`, per
 * provider slot) wins over a row here, per field, through `resolvePrices` below —
 * the one lookup every model call is booked and cap-checked by (M4d, signed
 * 2026-10-05; that REPLACES the 2026-09-21 "edit a row here, never a runtime
 * flag" ruling). `cacheIn` (optional) is the cache-READ price per 1K; a row
 * without it books cache reads at bare-agent's default 0.1x of `in`.
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
  // DeepSeek-V4.1-Flash, peak. Source: https://api-docs.deepseek.com/quick_start/pricing/ (fetched
  // 2026-10-05: cache hit $0.006, cache miss $0.30, output $1.20 per 1M). `cacheIn` = the hit price
  // (hamr ruling "A", 2026-10-05, poc/m4d/RESULTS.md (b): bare-agent's 0.1x default booked hits 5x real).
  'deepseek-flash': { in: 0.0003, cacheIn: 0.000006, out: 0.0012, source: 'published' },
  'deepseek-v4-pro': { in: 0.00132, out: 0.00396, source: 'published' },
};

/**
 * Strip an `hf:` routing prefix and look up `suffix` with `Object.hasOwn` —
 * never plain truthiness/`in`, which would let a suffix like `"constructor"`
 * resolve to an inherited `Object.prototype` member.
 * @param {string|null|undefined} modelId
 * @param {Record<string, any>} [ratesTable]
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

const perM = (per1K) => Number((per1K * 1000).toPrecision(12));

/**
 * THE one price lookup (M4d scope item 6): every model call — run, resume, model step, drafter —
 * is booked and cap-checked from this. Per field: a Settings price (`config.prices[slot]`, USD per
 * 1M -> per 1K) wins, else the code table's row, else the table's HIGHEST entry for that field
 * (an unknown model; unknown cost is never 0). A cache-read price is known only from Settings or a
 * row's `cacheIn`; otherwise it is left out (`cacheReadMult` omitted -> bare-agent's 0.1x of `in`).
 *
 * @param {string} modelId
 * @param {{ slot?: string, config?: Record<string, any>, ratesTable?: Record<string, any> }} [opts]
 * @returns {{
 *   rates: { in: number, out: number, cacheReadMult?: number },
 *   perM: { inPerM: number, cachedInPerM: number, outPerM: number },
 *   source: { in: 'settings'|'table'|'ceiling', cachedIn: 'settings'|'table'|'default-multiplier', out: 'settings'|'table'|'ceiling' },
 *   suffix: string|null,
 * }}
 */
export function resolvePrices(modelId, { slot, config = {}, ratesTable = RATES_BY_SUFFIX } = {}) {
  const resolved = lookupRate(modelId, ratesTable);
  const row = resolved ? resolved.rates : null;
  const set = (slot !== undefined && config.prices && Object.hasOwn(config.prices, slot)) ? config.prices[slot] : {};
  const ceilingOf = (field) => Math.max(...Object.values(ratesTable).map((r) => r[field]));
  const field = (settingsKey, rowField) => {
    if (set[settingsKey] !== undefined) return { v: set[settingsKey] / 1000, src: 'settings' };
    if (row) return { v: row[rowField], src: 'table' };
    return { v: ceilingOf(rowField), src: 'ceiling' };
  };
  const inF = field('inPerM', 'in');
  const outF = field('outPerM', 'out');
  let cachedIn = null;
  let cachedSrc = 'default-multiplier';
  if (set.cachedInPerM !== undefined) { cachedIn = set.cachedInPerM / 1000; cachedSrc = 'settings'; }
  else if (row && row.cacheIn !== undefined) { cachedIn = row.cacheIn; cachedSrc = 'table'; }
  /** @type {{ in: number, out: number, cacheReadMult?: number }} */
  const rates = { in: inF.v, out: outF.v };
  if (cachedIn !== null) rates.cacheReadMult = cachedIn / inF.v;
  return {
    rates,
    perM: { inPerM: perM(inF.v), cachedInPerM: perM(cachedIn ?? inF.v * 0.1), outPerM: perM(outF.v) },
    source: { in: /** @type {any} */ (inF.src), cachedIn: /** @type {any} */ (cachedSrc), out: /** @type {any} */ (outF.src) },
    suffix: resolved ? resolved.suffix : null,
  };
}

/**
 * The `price` object a spend row records: the per-1M numbers the call was booked at and where each
 * came from. From a `resolvePrices` result; or from INJECTED rates (tests) with source "injected".
 * @param {{ perM: any, source: any }|null|undefined} prices
 * @param {{ in: number, out: number, cacheReadMult?: number }|null|undefined} [injectedRates]
 */
export function priceRecord(prices, injectedRates) {
  if (prices) return { ...prices.perM, source: prices.source };
  if (!injectedRates) return null;
  return {
    inPerM: perM(injectedRates.in),
    cachedInPerM: perM(injectedRates.in * (injectedRates.cacheReadMult ?? 0.1)),
    outPerM: perM(injectedRates.out),
    source: 'injected',
  };
}

/**
 * The config a model call is priced against, read at the door: `{}` when no config applies
 * (a test process with no `FWDLOOP_CONFIG_HOME`), else the validated `config.json`. A broken
 * config THROWS (ConfigError) — a run's charge never changes silently.
 * @param {string} [home] explicit config home (a test); default: the door's home
 */
export function readPriceConfig(home) {
  if (home !== undefined) return readConfig({ home });
  const door = configDoorHome();
  return door.skip ? {} : readConfig({ home: door.home });
}

/**
 * The ceiling cost (USD) of one round of `modelId` — never 0, never null.
 * A known model prices at its own rate; an unknown/missing model prices at
 * the HIGHEST in/out rate anywhere in `ratesTable`. `opts.prices` (a
 * `resolvePrices` result, e.g. from `makeProvider`) makes the cap check use the
 * SAME price the round is booked at.
 */
export function ceilingCostUsd(modelId, ratesTable = RATES_BY_SUFFIX, opts = {}) {
  const { rates } = opts.prices ?? resolvePrices(modelId, { ratesTable });
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

// F48 round 3: both readers below take a full path (`<runDir>/spend.jsonl`,
// as every call site already builds it) but go through `readFileInside`
// (`src/flow.js`) using `dirname(path)` as the containment boundary and
// `basename(path)` as the checked relative name — no call site changes, and
// a symlinked `spend.jsonl` (or a symlinked run-dir ancestor) reads as
// "missing", never as some outside file's content folded into a cap check
// or shown on the panel.
// A row with no booked cost is repriced at ITS OWN booked price's ceiling when it recorded one
// (M4d: forward only — today's Settings price never re-prices an old row), else at the code table's.
function rowCeilingUsd(row) {
  const p = row.price;
  if (p && typeof p === 'object' && Number.isFinite(p.inPerM) && p.inPerM > 0 && Number.isFinite(p.outPerM) && p.outPerM > 0) {
    return (CEILING_INPUT_TOKENS / 1e6) * p.inPerM + (CEILING_OUTPUT_TOKENS / 1e6) * p.outPerM;
  }
  return ceilingCostUsd(row.model);
}

function readSpendTotal(path) {
  const result = readFileInside(dirname(path), basename(path));
  if (!result.ok) return 0;
  const lines = result.text.split('\n').filter((l) => l.trim());
  let total = 0;
  for (const line of lines) {
    const row = JSON.parse(line);
    // An incomplete row (a call died unmetered) counts its priced floor PLUS one
    // ceiling per unmetered call — never only the floor (unknown cost is never
    // 0). Same shape as poc/m6a/batch.mjs rowCostUsd.
    if (row.spendComplete === false) {
      const unmetered = Number.isInteger(row.calls) && Number.isInteger(row.rounds) ? Math.max(1, row.calls - row.rounds) : 1;
      total += (row.costUsd ?? 0) + unmetered * rowCeilingUsd(row);
    } else {
      total += row.costUsd === null || row.costUsd === undefined ? rowCeilingUsd(row) : row.costUsd;
    }
  }
  return total;
}

/**
 * `appendSpendRow`'s own sibling reader (M4a piece 2, docs/wiki/the-module-
 * ladder.md M4a scope item 2: "one reader per book") — every row as written,
 * raw, in file order. `[]` when the file doesn't exist yet, and a malformed
 * line is skipped rather than thrown on (an honest best-effort read, same
 * posture as `src/books.js`'s readers — a caller that needs to know the row
 * count decides how to treat a gap, this function never crashes over it).
 * @param {string} path
 * @returns {any[]}
 */
export function readSpendRows(path) {
  const result = readFileInside(dirname(path), basename(path));
  if (!result.ok) return [];
  const rows = [];
  for (const line of result.text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    try { rows.push(JSON.parse(trimmed)); } catch { /* malformed line: skip, never crash the read */ }
  }
  return rows;
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
 * @param {{ model?: string, timeoutMs?: number, deadlineMs?: number, thinking?: object|null, env?: Record<string,string|undefined>, configHome?: string }} [options]
 *   `configHome` (a test) is where `config.json` prices are read; default: the door's home (`readPriceConfig`).
 *   `env` (M4d: the merged shell+keys-file env; default process.env) is where the key is read.
 *   `thinking` (bare-agent >=0.49) is sent verbatim as body.thinking; unset/null leaves the body unchanged.
 * @returns {{ provider: any, rates: {in:number, out:number, cacheReadMult?:number}, modelId: string, suffix: string, slot: string, prices: ReturnType<typeof resolvePrices> }}
 */
export function makeProvider(slotName, options = {}) {
  const {
    model, timeoutMs, deadlineMs, thinking, env = process.env, configHome,
  } = options;
  const slot = PROVIDER_SLOTS[slotName];
  if (!slot) {
    throw new Error(`unknown provider slot "${slotName}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
  }

  const keyCheck = checkKeyPreflight(slotName, env);
  if (!keyCheck.ok) throw new Error(keyCheck.message);

  const apiKey = env[slot.envVar];
  const modelId = model ?? slot.defaultModel;
  const { suffix } = resolveModelRate(modelId);
  // The ONE price lookup (a Settings price wins over the table). A broken config throws by name here;
  // it never falls back to the table, so a run's charge cannot change silently.
  const prices = resolvePrices(modelId, { slot: slotName, config: readPriceConfig(configHome) });
  const { rates } = prices;

  const provider = new MalformedToolCallTolerantOpenAI({
    apiKey,
    model: modelId,
    baseUrl: slot.baseUrl,
    legacyMaxTokens: slot.legacyMaxTokens === true,
    // bare-agent >=0.48: opt in to the raw broken tool-call arguments on
    // `malformedToolCall` (capped upstream at 500 chars). Not exposeErrorBody.
    exposeMalformedArgs: true,
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(deadlineMs !== undefined ? { deadlineMs } : {}),
    ...(thinking != null ? { thinking } : {}),
  });

  return {
    provider, rates, modelId, suffix, slot: slotName, prices,
  };
}
