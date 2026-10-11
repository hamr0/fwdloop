// borrowed-from: bareloop src/panel/settingsroutes.js@2b101d5 — ADAPTED for fwdloop.
// M4d piece 4 (docs/wiki/the-module-ladder.md, "M4d", scope items 2-3): the Settings routes under
// `/api/settings/`, dispatched by `src/panel/server.js` AFTER the same gates as every other route
// (Host, and for a POST: Origin + the 8 KiB body cap). This file only decides what a settings
// request means.
//
// What it never does (negatives (i) (ii) (ix) (xiv)):
//   - no route WRITES the keys file, and no response carries a key value: a key is read from the merged
//     env only to put in an `Authorization` header, then forgotten;
//   - Test and Balance are one GET each (`<baseUrl>/models`, DeepSeek's `/user/balance`), never a
//     completion, and write no spend row;
//   - no route reads or writes a flow or its cap. The only files touched are config.json (via
//     `updateConfig`) and the keys file (read through `keysForDoor`), both under the one config home.
// Every refusal is a plain sentence in `say`; nothing here puts an HTTP code, an id or a path on the page.
import {
  PROVIDER_SLOTS, effectiveModels, resolveSlot, checkKeyPreflight, canChangeDraftThinking,
} from '../provider.js';
import {
  readConfig, updateConfig, ConfigError, providerFieldProblem, cleanBaseUrl, draftThinkingMode, modelsProblem,
} from '../config.js';
import { SHAPES } from '../providershapes.js';
import { keysForDoor } from '../keysfile.js';
import { spendSummary } from '../monthly.js';

const DEEPSEEK_BALANCE_URL = 'https://api.deepseek.com/user/balance';
const TIMEOUT_MS = 4000;

const BROKEN_CONFIG = 'Your settings file (config.json) cannot be read. Fix or remove it, then look again.';

const isNumberAbove0 = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * @param {{ home?: string, skip?: boolean, env?: Record<string,string|undefined>, fetch?: typeof fetch, now?: () => number }} cfg
 *   `home` the config home (undefined = the real `~/.config/fwdloop`); `skip` true under a test process
 *   with no `FWDLOOP_CONFIG_HOME` (Settings then touches nothing); `env` the shell side (tests only);
 *   `fetch` and `now` are test seams.
 */
export function createSettings(cfg) {
  const doFetch = cfg.fetch ?? globalThis.fetch;
  const keys = () => keysForDoor({ env: cfg.env, keysHome: cfg.home });

  /** @param {number} status @param {any} body */
  const reply = (status, body) => ({ status, body });
  /** @param {string} refused @param {string} say @param {number} [status] */
  const refuse = (refused, say, status = 400) => reply(status, { ok: false, refused, say });

  /** The slot named by a request, or null. @param {unknown} slot */
  const slotOf = (slot) => (typeof slot === 'string' && Object.hasOwn(PROVIDER_SLOTS, slot) ? slot : null);

  /** Balance is offered only on an OpenAI-compatible slot whose host is api.deepseek.com (bareloop's rule). @param {{ shape: string, baseUrl: string }} eff */
  function canBalance(eff) {
    if (eff.shape !== 'openai-api') return false;
    try { return new URL(eff.baseUrl).host === 'api.deepseek.com'; } catch { return false; }
  }

  /** config.json, or `{problem}` in plain words when it is broken (never read as "nothing set"). */
  function config() {
    try { return { config: readConfig({ home: cfg.home }), problem: null }; } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return { config: {}, problem: BROKEN_CONFIG };
    }
  }

  function providers() {
    const k = keys();
    const c = config();
    const spend = spendSummary({ home: cfg.home, now: cfg.now });
    const rows = Object.entries(PROVIDER_SLOTS).map(([slot, def]) => {
      const eff = resolveSlot(slot, { config: c.config });
      const em = effectiveModels(slot, c.config);
      // The slot's current model always has a line to fill (unticked, no price) when the list lacks it.
      const models = em.lines.some((m) => m.model === eff.model) ? em.lines : [...em.lines, { model: eff.model, use: false }];
      let keyStatus = 'not set';
      if (!k.ok) keyStatus = 'refused';
      else if (k.names.includes(def.envVar)) keyStatus = 'set in file';
      else if (k.shellOnly.includes(def.envVar)) keyStatus = 'found in shell';
      return {
        slot,
        label: slot,
        envVar: def.envVar,
        keyStatus,
        model: eff.model,
        shape: eff.shape,
        baseUrl: eff.baseUrl,
        savedBaseUrl: /** @type {Record<string, any>} */ (c.config).providers?.[slot]?.baseUrl ?? '',
        defaults: eff.defaults,
        tokens: spend.byProvider[slot]?.total.tokens ?? 0,
        models,
        unpriced: em.unpriced,
        canBalance: canBalance(eff),
      };
    });
    // The drafting model today is the deepseek row's model.
    const dm = resolveSlot('deepseek', { config: c.config });
    return reply(200, {
      ok: true,
      draftThinking: { on: draftThinkingMode(c.config) === 'on', canChange: canChangeDraftThinking(dm), model: dm.model },
      keysFile: { path: k.path, exists: k.exists, refusal: k.refusal },
      configProblem: c.problem,
      shapes: SHAPES.map(({ id, label }) => ({ id, label })),
      rows,
    });
  }

  /** The key for a slot, for a header only; or `{why}` in plain words. @param {string} slot @returns {{ key?: string, why?: string }} */
  function keyFor(slot) {
    const k = keys();
    if (!k.ok) return { why: String(k.refusal) };
    const def = PROVIDER_SLOTS[slot];
    const value = k.env[def.envVar];
    if (value === undefined || value === '') return { why: 'No key set for this provider.' };
    if (!checkKeyPreflight(slot, k.env).ok) return { why: 'The key has a space or a line break in it. Fix it in your keys file, then reload keys.' };
    return { key: value };
  }

  /** The key goes only in a header, in the form each shape expects. @param {string} shape @param {string} key @returns {Record<string, string>} */
  function authHeaders(shape, key) {
    if (shape === 'anthropic-api') return { 'x-api-key': key, 'anthropic-version': '2023-06-01' };
    if (shape === 'gemini-api') return { 'x-goog-api-key': key };
    return { Authorization: `Bearer ${key}` };
  }

  /** One $0 GET with a 4 s deadline and the key only in the header. @param {string} url @param {string} key @returns {Promise<{ body?: any, why?: string }>} */
  async function getWithKey(url, key, shape = 'openai-api') {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(url, { method: 'GET', headers: authHeaders(shape, key), signal: ctl.signal, redirect: 'manual' });
      if (res.status >= 300 && res.status < 400) return { why: 'The provider answered with a redirect; the key was not sent on. Check the Base URL.' };
      if (res.status === 401 || res.status === 403) return { why: 'The provider refused the key.' };
      if (!res.ok) return { why: 'The provider answered with an error.' };
      let body = null;
      try { body = await res.json(); } catch { body = null; }
      return { body };
    } catch (/** @type {any} */ e) {
      if (e?.name === 'AbortError') return { why: 'The provider did not answer in 4 seconds.' };
      return { why: 'Could not reach the provider.' };
    } finally {
      clearTimeout(timer);
    }
  }

  async function test(body) {
    const slot = slotOf(body?.slot);
    if (!slot) return refuse('unknown-provider', 'That provider is not known.');
    const k = keyFor(slot);
    if (k.why) return reply(200, { ok: false, why: k.why });
    const started = Date.now();
    const c = config();
    if (c.problem) return reply(200, { ok: false, why: c.problem });
    const eff = resolveSlot(slot, { config: c.config });
    const base = eff.baseUrl !== '' ? eff.baseUrl : 'https://generativelanguage.googleapis.com/v1beta'; // bare-agent's own Gemini address
    const r = await getWithKey(`${base}/models`, String(k.key), eff.shape);
    if (r.why) return reply(200, { ok: false, why: r.why });
    return reply(200, { ok: true, ms: Date.now() - started });
  }

  async function balance(query) {
    const slot = slotOf(query.get('slot'));
    if (!slot) return refuse('unknown-provider', 'That provider is not known.');
    const c = config();
    if (c.problem) return reply(200, { ok: false, why: c.problem });
    if (!canBalance(resolveSlot(slot, { config: c.config }))) return reply(200, { ok: false, why: 'Not offered by this provider.' });
    const k = keyFor(slot);
    if (k.why) return reply(200, { ok: false, why: k.why });
    const r = await getWithKey(DEEPSEEK_BALANCE_URL, String(k.key));
    if (r.why) return reply(200, { ok: false, why: r.why });
    const infos = Array.isArray(r.body?.balance_infos) ? r.body.balance_infos : [];
    const balances = infos
      .filter((b) => b && typeof b.currency === 'string' && b.total_balance !== undefined)
      .map((b) => ({ currency: b.currency, total: String(b.total_balance) }));
    if (balances.length === 0) return reply(200, { ok: false, why: 'The provider did not report a balance.' });
    return reply(200, { ok: true, balances });
  }

  /**
   * Save one model line: {slot, model, use?, inPerM?, outPerM?} (a field left out keeps the line's value; a price
   * `null` clears it). The whole slot list is judged by `modelsProblem` (the one rule) BEFORE anything is written;
   * Idea borrowed from bareloop src/panel/settingsroutes.js@caf019b (both prices or neither, :165-179), not copied: the
   * rule here is `modelsProblem` (tick needs both, 0 / 0 allowed, exact sentence).
   * the first save for a slot writes the migrated list and drops the slot's old `prices.<slot>`.
   */
  function model(body) {
    const slot = slotOf(body?.slot);
    if (!slot) return refuse('unknown-provider', 'That provider is not known.');
    const c = config();
    if (c.problem) return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    if (Object.hasOwn(body, 'cachedInPerM')) {
      return refuse('bad-price', 'Cached input has no price of its own: it is priced as input. Nothing was saved.');
    }
    if (typeof body.model !== 'string') return refuse('bad-model', 'Pick a model line. Nothing was saved.');
    const list = effectiveModels(slot, c.config).lines.map((m) => ({ ...m }));
    let line = list.find((m) => m.model === body.model);
    if (!line) { line = { model: body.model, use: false }; list.push(line); }
    if (Object.hasOwn(body, 'use')) line.use = body.use;
    for (const f of /** @type {const} */ (['inPerM', 'outPerM'])) {
      if (!Object.hasOwn(body, f)) continue;
      if (body[f] === null) delete line[f];
      else line[f] = body[f];
    }
    const problem = modelsProblem(list);
    if (problem) return refuse('bad-model', problem);
    try {
      updateConfig({ models: { [slot]: list }, prices: { [slot]: null } }, { home: cfg.home });
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    }
    return reply(200, { ok: true, slot });
  }

  /** Save a provider slot's name (model id), shape and Base URL. Validate EVERY field first; write only if all pass. */
  function provider(body) {
    const slot = slotOf(body?.slot);
    if (!slot) return refuse('unknown-provider', 'That provider is not known.');
    const fields = { name: 'model', shape: 'shape', baseUrl: 'baseUrl' };
    const say = { name: 'The name must be a model id: 1 to 200 characters, no spaces.', shape: 'Pick an API shape from the list.', baseUrl: 'The Base URL must be empty (use the default) or start with http:// or https://.' };
    /** @type {Record<string, string|null>} */
    const patch = {};
    for (const [key, field] of Object.entries(fields)) {
      if (!Object.hasOwn(body, key)) continue;
      const v = body[key];
      const clearUrl = key === 'baseUrl' && v === '';
      if (!clearUrl && providerFieldProblem(field, v) !== null) return refuse('bad-provider', `${say[key]} Nothing was saved.`);
      patch[field] = clearUrl ? null : (key === 'baseUrl' ? cleanBaseUrl(v) : v);
    }
    if (Object.keys(patch).length === 0) return refuse('bad-provider', 'Nothing to save.');
    try {
      updateConfig({ providers: { [slot]: patch } }, { home: cfg.home });
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    }
    return reply(200, { ok: true, slot });
  }

  /** The "Thinking on (drafting)" tick-box: one boolean for all jobs, only for a drafting model the allow-list knows. */
  function thinking(body) {
    if (typeof body?.on !== 'boolean') return refuse('bad-thinking', 'Send on or off. Nothing was saved.');
    const c = config();
    if (c.problem) return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    if (!canChangeDraftThinking(resolveSlot('deepseek', { config: c.config }))) {
      return refuse('thinking-fixed', "Thinking can't change this for this model, so nothing was saved.");
    }
    try {
      updateConfig({ draftThinking: body.on }, { home: cfg.home });
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    }
    return reply(200, { ok: true, on: body.on });
  }

  function moneyGet() {
    const c = config();
    const summary = spendSummary({ home: cfg.home, now: cfg.now });
    const limit = c.problem === null && isNumberAbove0(c.config.monthlyLimitUsd) ? c.config.monthlyLimitUsd : null;
    return reply(200, { ok: true, ...summary, monthlyLimitUsd: limit, configProblem: c.problem });
  }

  function moneyPost(body) {
    if (body === null || typeof body !== 'object' || !Object.hasOwn(body, 'monthlyLimitUsd')) {
      return refuse('bad-limit', 'Send a number above 0, or leave it empty for no limit. Nothing was saved.');
    }
    const raw = body.monthlyLimitUsd;
    const clear = raw === null || raw === '';
    if (!clear && !isNumberAbove0(raw)) return refuse('bad-limit', 'The monthly limit must be a number above 0, or empty for no limit. Nothing was saved.');
    try {
      updateConfig({ monthlyLimitUsd: clear ? null : raw }, { home: cfg.home });
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    }
    return reply(200, { ok: true, monthlyLimitUsd: clear ? null : raw });
  }

  /**
   * @param {{ method: string, pathname: string, query: URLSearchParams, body: any }} r
   * @returns {Promise<{ status: number, body: any }>}
   */
  async function handle({ method, pathname, query, body }) {
    if (cfg.skip) return refuse('settings-unavailable', 'Settings is not available here.', 404);
    const known = { GET: ['/api/settings/providers', '/api/settings/balance', '/api/settings/money'], POST: ['/api/settings/test', '/api/settings/model', '/api/settings/provider', '/api/settings/money', '/api/settings/thinking'] };
    if (!(known[method] ?? []).includes(pathname)) return refuse('no-such-settings-route', 'Settings cannot do that. Keys are typed into your keys file by hand.', 404);
    if (method === 'GET') {
      if (pathname === '/api/settings/providers') return providers();
      if (pathname === '/api/settings/balance') return balance(query);
      return moneyGet();
    }
    if (pathname === '/api/settings/test') return test(body);
    if (pathname === '/api/settings/model') return model(body);
    if (pathname === '/api/settings/provider') return provider(body);
    if (pathname === '/api/settings/thinking') return thinking(body);
    return moneyPost(body);
  }

  return { handle };
}
