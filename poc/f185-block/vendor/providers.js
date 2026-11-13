// borrowed-from: bareloop src/providers.js@v0.56.0 (3383cce)
// Provider factory (PRD item 28, shape (1)): ONE seam mapping a job spec's
// `provider` name to the bare-agent constructor it drives, the env var
// carrying its key, and the per-tier model table — including any
// provider-specific request-key gating. Before this module existed, both
// runners constructed `AnthropicProvider` BY NAME (the old `buildProviders` in
// `src/cli.js` and `scripts/run-u.mjs`'s top-level wiring, both since replaced
// by `buildRunnerProviders` below) and any second
// provider would have meant scattering `if (provider === …)` across both.
//
// hamr's ruling (PRD 30.7, 2026-09-09): `deepseek-chat` is THE secondary
// provider — "settle on one secondary/replacement for claude … don't
// pickpocket random models". This table is not a menu of half-tested
// models; it is exactly the two provider identities the PROVIDERS menu
// (`src/job.js`) admits.
//
// What this module is NOT: it never RESOLVES a judge identity itself (that
// stays arbiter territory, `resolveJudge`/`resolveJobJudge` in
// src/judged.js — the spec's signed `judge` override, else the job's own
// worker provider and model, PRD item 32) — it only CONSTRUCTS the judge
// provider object from an identity the caller already resolved
// (`buildRunnerProviders`, below); it never prices a round (F113: rates
// passthrough is dead), and never decides a budget.

import { listModels } from './modellist.js';
import { SHAPE_IDS } from './providershapes.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { AnthropicProvider, OpenAIProvider, GeminiProvider } = require('bare-agent/providers');

/**
 * Which admitted providers have paid for their own end-to-end probe, and which
 * have not. Read by the runner to print a loud marker; never read to REFUSE —
 * hamr admitted gemini to the menu, and a table that quietly withheld it would
 * be a second, invisible ruling. An unprobed provider runs, and says so.
 * @type {Readonly<Record<string, {probed: boolean, evidence: string}>>}
 */
export const PROBE_STATUS = Object.freeze({
  'anthropic-api': Object.freeze({ probed: true, evidence: 'the original surface — ~167 archived runs' }),
  'openai-api': Object.freeze({ probed: true, evidence: 'run mtu12vks, green through scripts/run-u.mjs, $1.64/$4 (F157)' }),
  'gemini-api': Object.freeze({ probed: false, evidence: 'ZERO runs — admitted to the menu, owes its own paid probe (PRD item 31.3)' }),
});

/**
 * @typedef {object} ProviderTableEntry
 * @property {new (options: any) => any} ctor the bare-agent provider class
 * @property {string} endpointKey the CONSTRUCTOR OPTION NAME this provider reads its endpoint from — NOT assumed to be `baseUrl` (see below)
 */

// ── WHY `endpointKey` IS A FIELD AND NOT THE LITERAL `baseUrl` ──────────────
//
// hamr's framing for this item was "api + api shape + endpoint" (PRD 31.3), and
// the endpoint half is the one that does NOT generalize. Read from bare-agent's
// own constructors, not assumed:
//
//   AnthropicProvider  `baseUrl`  (provider-anthropic.js:49)
//   OpenAIProvider     `baseUrl`  (provider-openai.js:76)
//   GeminiProvider     `baseUrl`  (provider-gemini.js:47)
//   OllamaProvider     `url`      (provider-ollama.js:32)  <- and NO apiKey at all
//
// Every one of these constructors defaults its endpoint when the option is
// absent and none of them validate unknown option names. So passing `baseUrl`
// to Ollama would not throw: it would be IGNORED, the provider would default to
// `http://localhost:11434`, and the run would quietly talk to the wrong machine.
// That is the F149 class exactly — DeepSeek silently ignoring
// `max_completion_tokens` and returning 665 tokens for a 64-token cap — where a
// silently-dropped option produces a plausible-looking run against a
// configuration nobody chose.
//
// Ollama is NOT admitted today (hamr, 2026-09-09: "drop ollama for now"), so
// this field currently reads `baseUrl` for all three entries and its value is
// never exercised against a second spelling. It is here anyway, because the
// alternative is a hardcoded `baseUrl` that is correct for exactly as long as
// the menu holds only http-shaped API providers, and the FIRST thing that
// changes when Ollama is admitted is the one line nobody would think to look at.

/**
 * The three client classes bare-agent exports, chosen by shape id. NO key name, model id or per-model gating lives here: a row's
 * key is its own env name (src/providerrows.js), a job carries its own model, and the old max_tokens spelling is the ROW's tick
 * (`legacyMaxTokens`, `makeProvider`).
 * @type {Readonly<Record<string, ProviderTableEntry>>}
 */
const PROVIDER_TABLE = Object.freeze({
  'anthropic-api': Object.freeze({ ctor: AnthropicProvider, endpointKey: 'baseUrl' }),
  'openai-api': Object.freeze({ ctor: OpenAIProvider, endpointKey: 'baseUrl' }),
  'gemini-api': Object.freeze({ ctor: GeminiProvider, endpointKey: 'baseUrl' }),
});

/**
 * Look up a provider's table entry. Throws a NAMED error on an unrecognized
 * provider — never a silent default (the `resolveRates`-style-substring-
 * match lesson: a forward hazard even at zero observed rounds, MEMORY.md).
 * `src/job.js`'s `PROVIDERS` menu is the one place a spec's `provider`
 * field is validated; this is the runtime construction seam it feeds.
 * @param {string} providerName
 * @returns {ProviderTableEntry}
 */
export function resolveProvider(providerName) {
  const entry = PROVIDER_TABLE[/** @type {keyof typeof PROVIDER_TABLE} */ (providerName)];
  if (!entry) {
    throw new Error(
      `src/providers.js: unknown provider "${providerName}" — no silent default. `
      + `Known providers: ${Object.keys(PROVIDER_TABLE).join(', ')}`,
    );
  }
  return entry;
}

/**
 * Report whether a resolved API key VALUE (not its presence — every call
 * site already presence-checks separately) carries a shape an HTTP header
 * value cannot: F181 (`docs/wiki/FINDINGS.md`) — a two-line secret-store
 * entry put the key plus a trailing metadata line into `OPENAI_API_KEY`
 * (`"<key>\nmeta"`), the presence-only check at every door passed, and Node
 * crashed `TypeError [ERR_INVALID_CHAR]` inside its own header-encode at the
 * FIRST paid call — after the run had already announced itself as spending,
 * inside the paid span. curl tolerated the same value (HTTP 200 twice), so a
 * curl probe is a blind instrument for this defect class.
 *
 * NEVER TRIMS OR REPAIRS — this reports a reason, it does not fix the value
 * (hamr's retry-never-repair rule, in spirit: refuse loud, don't guess at
 * what the operator's secret store meant). Every call site that gets a
 * non-null reason back refuses at $0, in the SAME place and the SAME way it
 * already refuses a missing key — this function only adds a second shape of
 * refusal to a door that already had one.
 *
 * The checked shape is deliberately wider than what Node's own header
 * encoder rejects (Node tolerates a bare tab in a header value): CR, LF, TAB,
 * every other C0/DEL control character, and leading/trailing whitespace all
 * refuse, because every one of them is evidence the resolved value is not a
 * clean single-line secret — the same class of "reads as one plausible thing,
 * is actually stale/wrong/multi-line" this finding named.
 * @param {string} value the resolved key value — never logged, never echoed by any caller
 * @returns {string|null} a plain-English reason class, or `null` when the value is clean
 */
export function apiKeyProblem(value) {
  if (/[\r\n]/.test(value)) return 'contains a line break';
  if (/\t/.test(value)) return 'contains a tab character';
  // eslint-disable-next-line no-control-regex -- deliberately scanning C0/DEL controls
  if (/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/.test(value)) return 'contains a control character';
  if (value !== value.trim()) return 'has leading or trailing whitespace';
  return null;
}

/**
 * Construct ONE provider instance for `providerName`/`model`, applying `exposeErrorBody: true` (F153 — every constructed
 * provider, unconditionally). `baseUrl` (PRD item 28, ruling (d), 2026-09-09: admitted in v1) is forwarded only when given.
 * `legacyMaxTokens` is the Settings ROW's "old max_tokens" tick: a server that ignores `max_completion_tokens` (F149) does not
 * bind the output cap until it is on. It is forwarded only for `openai-api` and only when `true` — nothing here sniffs a host
 * or a model id to decide it.
 * @param {string} providerName
 * @param {{apiKey?: string, model?: string, baseUrl?: string, legacyMaxTokens?: boolean}} [options]
 */
export function makeProvider(providerName, { apiKey, model, baseUrl, legacyMaxTokens } = {}) {
  const entry = resolveProvider(providerName);
  return new entry.ctor({
    exposeErrorBody: true,
    apiKey,
    model,
    // the endpoint goes in under THIS PROVIDER'S OWN OPTION NAME, never a
    // hardcoded `baseUrl` (PRD item 31.3). The spec field stays `baseUrl` for
    // everyone — one name for the person writing the job — and the translation
    // to the constructor's spelling happens here, once. A provider whose option
    // is spelled differently would otherwise IGNORE the endpoint silently and
    // run against its own default; see the note above the table.
    ...(baseUrl !== undefined ? { [entry.endpointKey]: baseUrl } : {}),
    ...(providerName === 'openai-api' && legacyMaxTokens === true ? { legacyMaxTokens: true } : {}),
  });
}

/**
 * Build the `{provider, providerFor, judgeProvider}` triple both authoring runners need (`src/authorrun.js` and
 * `src/panel/authorsession.js` call it) — ONE seam instead of two copies of the same construction. `model` is the
 * already-RESOLVED worker model id (the caller picked the Settings line).
 *
 * THE JUDGE IS NOT PINNED (PRD item 32.2): it is constructed through this same factory from a `judgeProviderName`/`judgeModel`
 * pair the CALLER resolved. `judgeApiKey` stays a SEPARATE argument: the judge may be a different provider from the worker,
 * and each key is read by the caller from its own row.
 * @param {object} args
 * @param {string} args.providerName the worker's API shape id
 * @param {string|undefined} args.apiKey the WORKER's key, read from its row's env name
 * @param {string} args.model the already-resolved worker model id
 * @param {string|undefined} [args.baseUrl] the worker row's Base URL
 * @param {boolean} [args.legacyMaxTokens] the worker row's old max_tokens tick
 * @param {string|undefined} args.judgeApiKey the judge's own key
 * @param {string} args.judgeModel the resolved judge model id
 * @param {string} [args.judgeProviderName] the resolved judge shape; defaults to `providerName`
 * @param {string|undefined} [args.judgeBaseUrl] the judge row's endpoint
 * @param {boolean} [args.judgeLegacyMaxTokens] the judge row's old max_tokens tick (defaults to the worker's when the judge shares its provider)
 */
export function buildRunnerProviders({
  providerName, apiKey, model, baseUrl, legacyMaxTokens = false, judgeApiKey, judgeModel,
  judgeProviderName = providerName, judgeBaseUrl = undefined, judgeLegacyMaxTokens = undefined,
}) {
  const provider = makeProvider(providerName, { apiKey, model, baseUrl, legacyMaxTokens });
  // a plan step's `model` is the one schema token `sonnet` (STEP_MODELS, src/plan.js): it means THE JOB'S worker model
  const providerFor = (/** @type {string} */ _tier) => provider;
  // the judge goes through the SAME table as the worker. Reusing the worker instance when the identity matches exactly is not an
  // optimisation for its own sake: a second instance against the same endpoint/model is a second prompt-cache prefix, and cache
  // writes are ~41% of the bill.
  const judgeLegacy = judgeLegacyMaxTokens ?? (judgeProviderName === providerName ? legacyMaxTokens : false);
  const judgeProvider = (judgeProviderName === providerName && judgeModel === model && judgeApiKey === apiKey
    && judgeBaseUrl === baseUrl && judgeLegacy === legacyMaxTokens)
    ? provider
    : makeProvider(judgeProviderName, { apiKey: judgeApiKey, model: judgeModel, baseUrl: judgeBaseUrl, legacyMaxTokens: judgeLegacy });
  return { provider, providerFor, judgeProvider };
}

/**
 * $0 reachability check: ONE GET of the provider's models list (`src/modellist.js`, the one owner of
 * that call), server-side, with the key in a header — NEVER a completion request, so it never spends
 * a token (PANEL-BUILD.md P3 build item 7: "the person must get feedback BEFORE drafting if the
 * chosen model can't work"). Used by the panel's model-readiness route (`src/panel/authorroutes.js`);
 * Settings > Providers' Test and Refresh call `listModels` directly. A blank `baseUrl` makes no call.
 *
 * NEVER returns the key, never logs it — the key only ever appears in a request header sent
 * straight to the provider's own host.
 * @param {object} o
 * @param {string} o.providerName an API shape id
 * @param {string} o.apiKey
 * @param {string} [o.model] when given, the response is also checked for this model id
 * @param {string} [o.baseUrl]
 * @param {typeof fetch} [o.fetchImpl] TEST SEAM — defaults to the real global `fetch`
 * @param {number} [o.timeoutMs] defaults to 4000 — a flaky endpoint must never hang the caller
 * @returns {Promise<{reachable: boolean, modelListed: boolean|null, status: string, note: string|null}>}
 */
export async function checkProviderReachable({
  providerName, apiKey, model, baseUrl, fetchImpl = fetch, timeoutMs = 4000,
}) {
  if (!SHAPE_IDS.includes(providerName)) {
    return {
      reachable: false, modelListed: null, status: 'unsupported-provider',
      note: `no models-list check known for "${providerName}"`,
    };
  }
  const r = await listModels({ shape: providerName, baseUrl: baseUrl ?? '', key: apiKey, fetchImpl, timeoutMs });
  if (r.ok) return { reachable: true, modelListed: model ? r.models.includes(model) : null, status: 'ok', note: null };
  const note = r.status.startsWith('HTTP ') ? `models list returned ${r.status}` : (r.detail ?? r.why);
  return { reachable: false, modelListed: null, status: r.status, note };
}

/**
 * The launch-time warning lines for an ADMITTED-PENDING-PROBE provider, or
 * `null` when the provider has paid for its own end-to-end probe (and for an
 * off-table name — an unknown provider is `resolveProvider`'s named throw to
 * report, never this function's warning to soften).
 *
 * This lives here, next to `PROBE_STATUS`, rather than inline in the runner,
 * for one reason: inline it was UNTESTABLE. `scripts/run-u.mjs` reaches this
 * point only with a real job row (a machine-local patient path) and a real
 * signed spec, so nothing in the suite could reach the branch, and a warning
 * nothing executes drifts exactly the way the green-only prose did (item 31.2).
 *
 * It never REFUSES, and it never returns a shape a caller can mistake for a
 * refusal: hamr admitted `gemini-api` to the menu, and a probe table that
 * quietly withheld it would be a second ruling nobody made.
 * @param {string} providerName
 * @returns {string[]|null} lines to print, in order, or null when there is nothing to say
 */
export function probeWarningLines(providerName) {
  const probe = PROBE_STATUS[/** @type {keyof typeof PROBE_STATUS} */ (providerName)];
  if (!probe || probe.probed !== false) return null;
  return [
    `⚠  UNPROVEN PROVIDER — "${providerName}" is on the menu but has never been probed end to end.`,
    `   ${probe.evidence}`,
    '   It will run. Nothing has shown that it CAN run this job to a close-rendered verdict.',
  ];
}
