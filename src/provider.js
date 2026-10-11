// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED", scope items 7/8): provider slots, the usable-model decision, the spend
// ceiling, the key preflight, and `makeProvider`. Models and prices live in Settings
// only (M4d amendment 5): no table, no default model. Money honesty (project rule,
// CLAUDE.md): unknown cost is NEVER rendered as 0 — a row with no booked cost reads
// "at least" (`spendRowCost`); `assertUnderGlobalCap`/`appendSpendRow` never coerce a
// null cost to a number.
//
// borrowed-from: fwdloop poc/m0/provider.mjs@76a3607 (`PROVIDER_SLOTS`,
// `makeProvider`, `MalformedToolCallTolerantOpenAI` —
// F28's tolerant wrapper for a DeepSeek tool-call whose `arguments` is bad
// JSON) and fwdloop poc/m0/spend.mjs@76a3607 (`ceilingCostUsd`,
// `classifyModelId`, `appendSpendRow`,
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
import { OpenAI, Anthropic, Gemini } from 'bare-agent/providers';
import { SHAPES } from './providershapes.js';

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
 *  var elsewhere. A slot holds only what is not a model or a price: its key env name, its API shape and its
 *  address. Models and prices live in Settings > Providers and nowhere in code (M4d amendment 5). */
export const PROVIDER_SLOTS = Object.freeze({
  synthetic: Object.freeze({
    baseUrl: 'https://api.synthetic.new/openai/v1',
    envVar: 'SYNTHETIC_API_KEY',
    shape: 'openai-api',
    legacyMaxTokens: false,
  }),
  deepseek: Object.freeze({
    baseUrl: 'https://api.deepseek.com',
    envVar: 'DEEPSEEK_API_KEY',
    shape: 'openai-api',
    // F11: DeepSeek ignores `max_completion_tokens`; only the legacy
    // `max_tokens` key bounds output.
    legacyMaxTokens: true,
  }),
});

/**
 * The ONE provider slot a draft or a run uses until the Chat model menu exists (M4d amendment 5, interim rule): its
 * ticked, priced model is picked by `resolveUsableModel`. A slot name is not a model or a price.
 */
export const MODEL_SLOT = 'deepseek';

/**
 * THE one lookup of a slot's API shape and address (M4d amendment 1), and the model NAME typed in its Name box
 * (`model`, null when none was typed: there is no code default, M4d amendment 5). Test, Balance and the Settings
 * page read the slot through this; which model a call USES is decided by `resolveUsableModel`, not by the name.
 * A value saved on the Settings page (`config.providers[slot]`) wins per field, else the code default above. A blank saved Base URL means the default FOR THE EFFECTIVE SHAPE: the slot's own code
 * address while the shape is the slot's code shape, else that shape's vendor address ('' = bare-agent's own).
 * Unknown slot throws. `config` is already-read config (see `readPriceConfig`); no I/O here.
 * @param {string} slotName
 * @param {{ config?: Record<string, any> }} [opts]
 * @returns {{ slot: string, envVar: string, legacyMaxTokens: boolean,
 *   model: string|null, shape: string, baseUrl: string,
 *   defaults: { shape: string, baseUrl: string } }}
 */
export function resolveSlot(slotName, { config = {} } = {}) {
  if (!Object.hasOwn(PROVIDER_SLOTS, slotName)) {
    throw new Error(`unknown provider slot "${slotName}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
  }
  const def = PROVIDER_SLOTS[slotName];
  const saved = (config.providers && Object.hasOwn(config.providers, slotName)) ? config.providers[slotName] : {};
  const shape = saved.shape ?? def.shape;
  const defaultBaseUrl = shape === def.shape ? def.baseUrl : (SHAPES.find((x) => x.id === shape)?.defaultUrl ?? '');
  const savedUrl = typeof saved.baseUrl === 'string' ? saved.baseUrl.replace(/\/+$/, '') : '';
  return {
    slot: slotName,
    envVar: def.envVar,
    legacyMaxTokens: def.legacyMaxTokens === true && shape === 'openai-api',
    model: saved.model ?? null,
    shape,
    baseUrl: savedUrl !== '' ? savedUrl : defaultBaseUrl,
    defaults: { shape: def.shape, baseUrl: defaultBaseUrl },
  };
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
 * A slot's model lines as Settings and pricing see them (M4d amendment 3 items 7-10; hamr's ruling: a ticked
 * model's prices come only from what the person typed, never from the code table). A saved list
 * (`config.models[slot]`) is returned as stored. With no list, ONE line is built from the slot's current
 * model (`resolveSlot`) and the old `config.prices[slot]`: both in and out typed -> ticked with them; only one
 * typed -> UNTICKED with that number pre-filled (the other box empty); none -> unticked, no price. `unpriced`
 * is true for the two unticked cases. Nothing is written here — the file changes only when the person saves.
 * @param {string} slot
 * @param {Record<string, any>} [config]
 * @returns {{ lines: Array<{ model: string, use: boolean, inPerM?: number, outPerM?: number, thinkingOff?: 'cant'|'disabled' }>, migrated: boolean, unpriced: boolean }}
 */
export function effectiveModels(slot, config = {}) {
  if (config.models && Object.hasOwn(config.models, slot)) {
    return { lines: config.models[slot], migrated: false, unpriced: false };
  }
  if (!Object.hasOwn(PROVIDER_SLOTS, slot)) return { lines: [], migrated: false, unpriced: false };
  const { model } = resolveSlot(slot, { config });
  // No code default (M4d amendment 5): a slot nobody typed a name into has nothing to tick.
  if (model === null) return { lines: [], migrated: false, unpriced: false };
  const old = (config.prices && Object.hasOwn(config.prices, slot)) ? config.prices[slot] : {};
  if (old.inPerM !== undefined && old.outPerM !== undefined) {
    return { lines: [{ model, use: true, inPerM: old.inPerM, outPerM: old.outPerM }], migrated: true, unpriced: false };
  }
  /** @type {{ model: string, use: boolean, inPerM?: number, outPerM?: number }} */
  const line = { model, use: false };
  if (old.inPerM !== undefined) line.inPerM = old.inPerM;
  if (old.outPerM !== undefined) line.outPerM = old.outPerM;
  return { lines: [line], migrated: true, unpriced: true };
}

/**
 * THE one decision of "usable model" (M4d amendment 5): a model is usable only if it is ticked in Settings with both
 * prices. Every model call - the drafter, a run, resume / continue, the command line, the panel - asks this and nothing
 * else; no model name, price or switch lives in code. Returns the model, its slot, its prices (USD per 1M, and per 1K
 * for the Loop; 0 / 0 is a chosen price) and its thinking-off option, or a plain refusal in `say`.
 *
 * `model` (named) must be a ticked, priced line: else "Tick <model> in Settings > Providers with both prices first."
 * No `model`: the interim rule until the Chat model menu - the slot must have EXACTLY ONE ticked, priced line; none or
 * more than one is refused with a plain sentence. Pure: `config` is already-read config, no I/O.
 *
 * @param {string} slotName
 * @param {{ config?: Record<string, any>, model?: string }} [opts]
 * @returns {{
 *   ok: true, slot: string, model: string, thinkingOff: 'cant'|'disabled',
 *   rates: { in: number, out: number, cacheReadMult: number },
 *   prices: { perM: { inPerM: number, cachedInPerM: number, outPerM: number }, source: { in: 'model', cachedIn: 'input', out: 'model' } },
 * } | { ok: false, say: string }}
 */
export function resolveUsableModel(slotName, { config = {}, model } = {}) {
  const lines = effectiveModels(slotName, config).lines;
  const priced = (l) => l.use === true && typeof l.inPerM === 'number' && Number.isFinite(l.inPerM) && typeof l.outPerM === 'number' && Number.isFinite(l.outPerM);
  let line;
  if (model !== undefined) {
    line = lines.find((l) => l.model === model && priced(l));
    if (!line) return { ok: false, say: `Tick ${model} in Settings > Providers with both prices first.` };
  } else {
    const ticked = lines.filter(priced);
    if (ticked.length === 0) return { ok: false, say: 'Tick a model in Settings > Providers with both prices first.' };
    if (ticked.length > 1) return { ok: false, say: `More than one model is ticked for ${slotName} in Settings > Providers. Leave one ticked, or name the model.` };
    [line] = ticked;
  }
  const inPerM = /** @type {number} */ (line.inPerM);
  const outPerM = /** @type {number} */ (line.outPerM);
  const inPer1K = inPerM / 1000;
  const outPer1K = outPerM / 1000;
  return {
    ok: true,
    slot: slotName,
    model: line.model,
    thinkingOff: line.thinkingOff === 'disabled' ? 'disabled' : 'cant',
    // cached input is priced AS input (M4d amendment 2): `cacheReadMult` is always 1
    rates: { in: inPer1K, out: outPer1K, cacheReadMult: 1 },
    prices: {
      perM: { inPerM, cachedInPerM: inPerM, outPerM },
      source: { in: 'model', cachedIn: 'input', out: 'model' },
    },
  };
}

/**
 * The `price` object a spend row records: the per-1M numbers the call was booked at and where each
 * came from. From a `resolveUsableModel` result's `prices`; or from INJECTED rates (tests) with source "injected".
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
 * The money hold (USD) of one round: the picked model's OWN Settings prices (`rates`, per 1K tokens, from
 * `resolveUsableModel`) times the two token bounds above. Not a table, not a fallback.
 * @param {{ in: number, out: number }} rates
 */
export function ceilingCostUsd(rates) {
  return (CEILING_INPUT_TOKENS / 1000) * rates.in + (CEILING_OUTPUT_TOKENS / 1000) * rates.out;
}

/**
 * Compare the model asked for against the model actually served.
 * `match` identical; `prefix` identical once a routing prefix is stripped;
 * `substituted` a concrete request served by a DIFFERENT concrete model
 * (the one that matters — the signed hash records the request, not what
 * ran); `unreported` the provider told us nothing.
 */
export function classifyModelId(requested, returned) {
  if (!requested) return 'unreported';
  if (returned === null || returned === undefined || returned === '') return 'unreported';
  if (requested === returned) return 'match';
  if (String(requested).replace(/^[a-z]+:/, '') === returned) return 'prefix';
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
  // M4d piece 3: the writer stamps `at` (after the spread: a caller can never set it) so month spend can be read
  // off each run's own books. Rows written before M4d carry none.
  appendFileSync(path, `${JSON.stringify({ ...row, at: new Date().toISOString(), modelMatch })}\n`);
}

// F48 round 3: both readers below take a full path (`<runDir>/spend.jsonl`,
// as every call site already builds it) but go through `readFileInside`
// (`src/flow.js`) using `dirname(path)` as the containment boundary and
// `basename(path)` as the checked relative name — no call site changes, and
// a symlinked `spend.jsonl` (or a symlinked run-dir ancestor) reads as
// "missing", never as some outside file's content folded into a cap check
// or shown on the panel.
// A row with no booked cost is repriced at ITS OWN booked price's ceiling when it recorded one
// (M4d: forward only — today's Settings price never re-prices an old row). A row that recorded no price at all (an
// old row; the code table that once priced it is gone, M4d amendment 5) has no ceiling to add: 0 here, and the row
// stays `complete: false`, so every total that holds it reads "at least", never as a clean figure.
function rowCeilingUsd(row) {
  const p = row.price;
  if (p && typeof p === 'object' && Number.isFinite(p.inPerM) && p.inPerM > 0 && Number.isFinite(p.outPerM) && p.outPerM > 0) {
    return (CEILING_INPUT_TOKENS / 1e6) * p.inPerM + (CEILING_OUTPUT_TOKENS / 1e6) * p.outPerM;
  }
  return 0;
}

/**
 * The one rule for what a spend row costs: `usd` and whether it is `complete`. An incomplete row (a call
 * died unmetered, or a round was left unpriced) counts its priced floor PLUS one ceiling per unmetered call
 * (unknown cost is never 0). Same shape as poc/m6a/batch.mjs rowCostUsd.
 * @param {any} row
 * @returns {{usd: number, complete: boolean}}
 */
export function spendRowCost(row) {
  if (row.spendComplete === false) {
    const unmetered = Number.isInteger(row.calls) && Number.isInteger(row.rounds) ? Math.max(1, row.calls - row.rounds) : 1;
    return { usd: (row.costUsd ?? 0) + unmetered * rowCeilingUsd(row), complete: false };
  }
  if (row.costUsd === null || row.costUsd === undefined) return { usd: rowCeilingUsd(row), complete: false };
  return { usd: row.costUsd, complete: true };
}

function readSpendTotal(path) {
  const result = readFileInside(dirname(path), basename(path));
  if (!result.ok) return 0;
  const lines = result.text.split('\n').filter((l) => l.trim());
  let total = 0;
  for (const line of lines) total += spendRowCost(JSON.parse(line)).usd;
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
  const slotDef = Object.hasOwn(PROVIDER_SLOTS, slotName) ? PROVIDER_SLOTS[slotName] : null;
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
 * The drafter's THINKING knob (M4d amendment 3, A1; amendment 5 item 3). A mode is an operator param, never model output.
 * 'on' sends nothing; 'off' sends what the model's own Settings line says: `thinkingOff: 'disabled'` sends
 * `{ thinking: { type: 'disabled' } }`, 'cant' (the default) sends nothing. No model is named in code.
 */
export const DRAFT_THINKING_MODES = Object.freeze(['on', 'off']);

/**
 * The ONE owner of the options a DRAFTING call carries for thinking. Any mode but 'on' | 'off' throws. The API shape
 * still gates it: `thinking: disabled` is the OpenAI-compatible body field, so other shapes send nothing.
 * @param {{shape: string, thinkingOff?: 'cant'|'disabled'}} target
 * @param {unknown} [mode] default 'off'
 * @returns {Record<string, any>}
 */
export function draftCallOptions({ shape, thinkingOff }, mode = 'off') {
  if (!DRAFT_THINKING_MODES.includes(/** @type {any} */ (mode))) {
    throw new Error(`draftThinking must be one of ${DRAFT_THINKING_MODES.join(' | ')}, got ${JSON.stringify(mode)}`);
  }
  if (mode === 'on' || shape !== 'openai-api' || thinkingOff !== 'disabled') return {};
  return { thinking: { type: 'disabled' } };
}

/** True when 'off' does something for this line, i.e. the setting can change it (the Settings box says so). @param {{shape: string, thinkingOff?: 'cant'|'disabled'}} target */
export const canChangeDraftThinking = (target) => Object.keys(draftCallOptions(target, 'off')).length > 0;

/** A model that is not usable (`resolveUsableModel`): its message is the plain sentence, shown as it is (no "key:" or "config:" prefix). */
export class ModelRefusal extends Error {}

/**
 * Build a provider for the given slot. Throws (never defaults) on an
 * unknown slot, a missing/bad env key, or a model that is not usable (`resolveUsableModel`: ticked in Settings with
 * both prices - the message is its plain sentence). Returns `{ provider, rates, modelId, slot, prices, thinkingOff }`.
 *
 * `timeoutMs`/`deadlineMs` bound a silent socket (BA-18 idle) and a
 * zombie-stream total wall clock (BA-19), respectively — see
 * `LIVE_PROVIDER_OPTIONS` in src/model-step.js, the one writer of the live
 * values this project uses.
 *
 * @param {string} slotName
 * @param {{ model?: string, timeoutMs?: number, deadlineMs?: number, thinking?: object|null, draftThinking?: 'on'|'off', env?: Record<string,string|undefined>, configHome?: string }} [options]
 *   `configHome` (a test) is where `config.json` prices are read; default: the door's home (`readPriceConfig`).
 *   `env` (M4d: the merged shell+keys-file env; default process.env) is where the key is read.
 *   `thinking` (bare-agent >=0.49) is sent verbatim as body.thinking; unset/null leaves the body unchanged.
 *   `draftThinking` (drafting only) wins over `thinking` and is turned into it by `draftCallOptions`.
 * @returns {{ provider: any, rates: {in:number, out:number, cacheReadMult?:number}, modelId: string, slot: string, prices: { perM: any, source: any }, thinkingOff: 'cant'|'disabled' }}
 */
export function makeProvider(slotName, options = {}) {
  const {
    model, timeoutMs, deadlineMs, thinking: thinkingOpt, draftThinking, env = process.env, configHome,
  } = options;
  if (!Object.hasOwn(PROVIDER_SLOTS, slotName)) {
    throw new Error(`unknown provider slot "${slotName}" — known slots: ${Object.keys(PROVIDER_SLOTS).join(', ')}`);
  }

  const keyCheck = checkKeyPreflight(slotName, env);
  if (!keyCheck.ok) throw new Error(keyCheck.message);

  // A broken config throws by name here; it never falls back to a default, so a run's model, address or
  // charge cannot change silently.
  const config = readPriceConfig(configHome);
  const slot = resolveSlot(slotName, { config });
  const apiKey = env[slot.envVar];
  // The ONE decision of which model may be used, and at what price (M4d amendment 5).
  const usable = resolveUsableModel(slotName, { config, model });
  if (!usable.ok) throw new ModelRefusal(usable.say);
  const modelId = usable.model;
  const { rates, prices, thinkingOff } = usable;

  // Drafting only: `draftThinking` ('on'|'off') is turned into the wire field by the ONE owner, draftCallOptions.
  const thinking = draftThinking === undefined ? thinkingOpt : draftCallOptions({ shape: slot.shape, thinkingOff }, draftThinking).thinking;
  const common = {
    apiKey,
    model: modelId,
    ...(slot.baseUrl !== '' ? { baseUrl: slot.baseUrl } : {}),
    ...(timeoutMs !== undefined ? { timeoutMs } : {}),
    ...(deadlineMs !== undefined ? { deadlineMs } : {}),
    ...(thinking != null ? { thinking } : {}),
  };
  const provider = slot.shape === 'anthropic-api' ? new Anthropic(common)
    : slot.shape === 'gemini-api' ? new Gemini(common)
      : new MalformedToolCallTolerantOpenAI({
        ...common,
        legacyMaxTokens: slot.legacyMaxTokens,
        // bare-agent >=0.48: opt in to the raw broken tool-call arguments on
        // `malformedToolCall` (capped upstream at 500 chars). Not exposeErrorBody.
        exposeMalformedArgs: true,
      });

  return {
    provider, rates, modelId, slot: slotName, prices, thinkingOff,
  };
}
