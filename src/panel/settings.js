// borrowed-from: bareloop src/panel/settingsroutes.js@2b101d5 — ADAPTED for fwdloop.
// M4d piece 4 (docs/wiki/the-module-ladder.md, "M4d", scope items 2-3): the Settings routes under
// `/api/settings/`, dispatched by `src/panel/server.js` AFTER the same gates as every other route
// (Host, and for a POST: Origin + the 8 KiB body cap). This file only decides what a settings
// request means.
//
// What it never does (negatives (i) (ii) (ix) (xiv)):
//   - no route WRITES the keys file, and no response carries a key value: a key is read from the merged
//     env only to put in an `Authorization` header, then forgotten;
//   - Test and the model list are one GET (`<baseUrl>/models`), never a
//     completion, and write no spend row;
//   - no route reads or writes a flow or its cap. The only files touched are config.json (via
//     `updateConfig`) and the keys file (read through `keysForDoor`), both under the one config home.
// Every refusal is a plain sentence in `say`; nothing here puts an HTTP code, an id or a path on the page.
import {
  effectiveModels, resolveSlot, checkKeyPreflight,
} from '../provider.js';
import {
  readConfig, updateConfig, ConfigError, providerFieldProblem, cleanBaseUrl, modelsProblem,
} from '../config.js';
import { SHAPES } from '../providershapes.js';
import { keysForDoor, isKeyName } from '../keysfile.js';
import { spendSummary } from '../monthly.js';
import { openInOs } from '../opener.js';
import { dirname } from 'node:path';
import { homedir } from 'node:os';

const TIMEOUT_MS = 4000;

const BROKEN_CONFIG = 'Your settings file (config.json) cannot be read. Fix or remove it, then look again.';

const isNumberAbove0 = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * @param {{ home?: string, skip?: boolean, env?: Record<string,string|undefined>, fetch?: typeof fetch, now?: () => number, openFolderSpawn?: Function, platform?: string }} cfg
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

  /** The row names: every key in the file with a value, plus a set-up key only the shell holds (M4d amendment 6 item 1). */
  const rowNames = (k) => [...new Set([...k.names, ...k.shellOnly])].sort();

  /** The plain-words refusal for a slot that is not a key name at all, or null (the one rule is `isKeyName`). @param {unknown} slot */
  const notKeyName = (slot) => (typeof slot === 'string' && slot !== '' && !isKeyName(slot)
    ? refuse('not-a-key-name', `${slot} is not a key name. A key name ends in _KEY, like MY_API_KEY. Nothing was saved.`) : null);

  /** The row named by a request, or null: only a key that is in the keys file (or the shell) is a row. @param {any} slot */
  const slotOf = (slot) => (rowNames(keys()).includes(slot) ? slot : null);

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
    const rows = rowNames(k).map((slot) => {
      const eff = resolveSlot(slot, { config: c.config });
      const own = spend.byModel[slot] ?? {};
      const models = effectiveModels(slot, c.config).map(({ model, use, inPerM, outPerM }) => ({
        model, use, ...(inPerM === undefined ? {} : { inPerM }), ...(outPerM === undefined ? {} : { outPerM }),
        // this model's own tokens from the spend rows that name it; absent = no row names it (never 0)
        ...(Object.hasOwn(own, model) ? { tokens: own[model] } : {}),
      }));
      let keyStatus = 'not set';
      if (!k.ok) keyStatus = 'refused';
      else if (k.names.includes(slot)) keyStatus = 'set in file';
      else if (k.shellOnly.includes(slot)) keyStatus = 'found in shell';
      return {
        slot,
        label: slot,
        envVar: slot,
        keyStatus,
        shape: eff.shape,
        baseUrl: eff.baseUrl,
        legacyMaxTokens: eff.legacyMaxTokens,
        tokens: spend.byProvider[slot]?.total.tokens ?? 0,
        models,
      };
    });
    return reply(200, {
      ok: true,
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
    const value = k.env[slot];
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
  async function getWithKey(url, key, shape) {
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

  /** The model ids a provider's list answer holds, per API shape (`data[].id` for two shapes; the third shape: `models[].name`, minus its `models/` prefix). @param {string} shape @param {any} body @returns {string[]} */
  function idsOf(shape, body) {
    const list = shape === 'gemini-api' ? body?.models : body?.data;
    const key = shape === 'gemini-api' ? 'name' : 'id';
    const ids = (Array.isArray(list) ? list : []).map((m) => (typeof m?.[key] === 'string' ? m[key].replace(/^models\//, '') : '')).filter((id) => id !== '');
    return [...new Set(ids)].sort();
  }

  /**
   * The ONE model-list call (M4d amendment 6 item 3): one free GET of `<Base URL>/models` with the key in the header only. Test and the page's list
   * both read it. `{ ok:true, models, ms }` or `{ ok:false, why }` in plain words. Writes nothing.
   * @param {unknown} rawSlot
   */
  async function listModels(rawSlot) {
    const slot = slotOf(rawSlot);
    if (!slot) return { unknown: true };
    const started = Date.now();
    const c = config();
    if (c.problem) return { ok: false, why: c.problem };
    const eff = resolveSlot(slot, { config: c.config });
    // the address comes first: a key reaches the env only once its row is set up, so a row with no address has nothing to send yet
    if (eff.baseUrl === '') return { ok: false, why: `Type a Base URL for ${slot} in Settings.` };
    const k = keyFor(slot);
    if (k.why) return { ok: false, why: k.why };
    const r = await getWithKey(`${eff.baseUrl}/models`, String(k.key), eff.shape);
    if (r.why) return { ok: false, why: r.why };
    return { ok: true, models: idsOf(eff.shape, r.body), ms: Date.now() - started };
  }

  /**
   * borrowed-from: bareloop src/panel/settingsroutes.js@07c298f (the open-keys-folder route), adapted to fwdloop's reply shape.
   * Opens the FOLDER of the server's own keys file path (never a file, never an editor, never a path from the request) in the OS file
   * manager: argv array, no shell, detached. Another OS, a failed spawn, or a test process with no injected opener: `opened:false` and
   * the folder path, which the page shows as text. `openFolderSpawn` / `platform` are test seams.
   * @param {any} body
   */
  function openKeysFolder(body) {
    if (body !== null && typeof body === 'object' && Object.keys(body).length > 0) {
      return Promise.resolve(refuse('no-path-allowed', 'The keys folder is opened from the panel\'s own settings; a path cannot be sent. Nothing was opened.'));
    }
    const shown = keys().path;
    const dir = dirname(shown.startsWith('~') ? homedir() + shown.slice(1) : shown);
    const cannot = () => reply(200, { ok: true, opened: false, path: dir });
    return openInOs(dir, { platform: cfg.platform, spawnFn: cfg.openFolderSpawn, underTest: process.env.NODE_ENV === 'test' })
      .then((opened) => (opened ? reply(200, { ok: true, opened: true, path: dir }) : cannot()));
  }

  async function test(body) {
    const bad = notKeyName(body?.slot);
    if (bad) return bad;
    const r = await listModels(body?.slot);
    if (r.unknown) return refuse('unknown-provider', 'That provider is not known.');
    return reply(200, r.ok ? { ok: true, ms: r.ms } : r);
  }

  async function models(body) {
    const bad = notKeyName(body?.slot);
    if (bad) return bad;
    const r = await listModels(body?.slot);
    if (r.unknown) return refuse('unknown-provider', 'That provider is not known.');
    if (!r.ok) return reply(200, r);
    const ids = r.models ?? [];
    return reply(200, ids.length === 0 ? { ok: false, why: 'The provider did not list any models.' } : { ok: true, models: ids });
  }

  /**
   * Save one model line: {slot, model, use?, inPerM?, outPerM?} (a field left out keeps the line's value; a price
   * `null` clears it). The whole slot list is judged by `modelsProblem` (the one rule) BEFORE anything is written;
   * Idea borrowed from bareloop src/panel/settingsroutes.js@caf019b (both prices or neither, :165-179), not copied: the
   * rule here is `modelsProblem` (tick needs both, 0 / 0 allowed, exact sentence).
   */
  function model(body) {
    const bad = notKeyName(body?.slot);
    if (bad) return bad;
    const slot = slotOf(body?.slot);
    if (!slot) return refuse('unknown-provider', 'That provider is not known.');
    const c = config();
    if (c.problem) return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    if (Object.hasOwn(body, 'cachedInPerM')) {
      return refuse('bad-price', 'Cached input has no price of its own: it is priced as input. Nothing was saved.');
    }
    if (typeof body.model !== 'string') return refuse('bad-model', 'Pick a model line. Nothing was saved.');
    // the saved list as it is, minus an older file's `thinkingOff` (read by nothing; dropped here, amendment 7)
    const list = effectiveModels(slot, c.config).map((m) => { const { thinkingOff, ...rest } = /** @type {Record<string, any>} */ (m); return { ...rest }; });
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
      updateConfig({ models: { [slot]: list } }, { home: cfg.home });
    } catch (e) {
      if (!(e instanceof ConfigError)) throw e;
      return refuse('config-broken', `${BROKEN_CONFIG} Nothing was saved.`);
    }
    return reply(200, { ok: true, slot });
  }

  /** Save a row's shape, Base URL and legacyMaxTokens tick. Validate EVERY field first; write only if all pass. */
  function provider(body) {
    const bad = notKeyName(body?.slot);
    if (bad) return bad;
    const slot = slotOf(body?.slot);
    if (!slot) return refuse('unknown-provider', 'That provider is not known.');
    const say = { shape: 'Pick an API shape from the list.', baseUrl: 'The Base URL must start with http:// or https://.', legacyMaxTokens: 'The legacy max_tokens tick must be on or off.' };
    /** @type {Record<string, string|boolean|null>} */
    const patch = {};
    for (const key of Object.keys(say)) {
      if (!Object.hasOwn(body, key)) continue;
      const v = body[key];
      const clearUrl = key === 'baseUrl' && v === '';
      if (!clearUrl && providerFieldProblem(key, v) !== null) return refuse('bad-provider', `${say[key]} Nothing was saved.`);
      patch[key] = clearUrl ? null : (key === 'baseUrl' ? cleanBaseUrl(v) : v);
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
    const known = { GET: ['/api/settings/providers', '/api/settings/money'], POST: ['/api/settings/open-keys-folder', '/api/settings/test', '/api/settings/models', '/api/settings/model', '/api/settings/provider', '/api/settings/money'] };
    if (!(known[method] ?? []).includes(pathname)) return refuse('no-such-settings-route', 'Settings cannot do that. Keys are typed into your keys file by hand.', 404);
    if (method === 'GET') {
      if (pathname === '/api/settings/providers') return providers();
      return moneyGet();
    }
    if (pathname === '/api/settings/open-keys-folder') return openKeysFolder(body);
    if (pathname === '/api/settings/test') return test(body);
    if (pathname === '/api/settings/models') return models(body);
    if (pathname === '/api/settings/model') return model(body);
    if (pathname === '/api/settings/provider') return provider(body);
    return moneyPost(body);
  }

  return { handle };
}
