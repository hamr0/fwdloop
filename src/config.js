// borrowed-from: bareloop src/config.js@0e55685 (and the secret-shape inventory of src/validate.js@07215d6)
// M4d scope items 2-4 — the ONE reader/writer of `~/.config/fwdloop/config.json`.
//
// Shape (unknown top-level fields are kept, never dropped):
//   { "monthlyLimitUsd": <number > 0>,            // absent = no limit (piece 3 reads it)
//     "prices": { "<slot>": { "inPerM": n, "cachedInPerM": n, "outPerM": n } },    // USD per 1M tokens, each optional; a saved "cachedInPerM" is tolerated, never read (M4d amendment 2)
//     "providers": { "<KEY_NAME>": { "shape": "<shape id>", "baseUrl": "http(s)://…", "legacyMaxTokens": true|false } },   // each optional; a row is a key name from the keys file (M4d amendment 6). An older file's "model" is tolerated and read by nothing.
//     "models": { "<KEY_NAME>": [ { "model": "<id>", "use": true|false, "inPerM": n, "outPerM": n } ] },         // M4d amendment 3 C: a price per model
//     "learningHints": true|false }                  // M8 am1: absent = false; the drafter is handed earlier runs' notes only when true (src/learnstore.js learningHintsOn). No control on the Settings page.
// A models line's price is a PAIR or nothing (`modelsProblem` is the one rule): 0 / 0 typed is a chosen price, a
// ticked line needs both, a half pair is refused. A slot with no list is migrated on READ (`effectiveModels` in
// src/provider.js); the file is only rewritten when the person saves.
// A price is a finite number above 0; 0, a negative, NaN, Infinity or text is a ConfigError
// naming the slot and field — on write AND on read, so a hand-edited 0 can never price a call at $0.
// Key VALUES never live here (keys file / shell only): a secret-shaped string is refused on write.
//
// A missing file = `{}` (nothing set). An unreadable or unparseable file THROWS `ConfigError` —
// never `{}`: a broken config must not silently mean "no limit" or "the table's price".
// Written atomically (tmp + rename), mode 0600.
import {
  mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { SHAPE_IDS } from './providershapes.js';

/** A plain-words config failure (bad value, secret-shaped string, unreadable file). */
export class ConfigError extends Error {}

/**
 * `~/.config/fwdloop`, or an injected override — the ONE definition of fwdloop's config home
 * (the keys file lives beside config.json; `src/keysfile.js` calls this, never its own copy).
 * @param {string} [home] test seam; production never passes it
 * @returns {string}
 */
export function configHome(home) {
  return home ?? join(homedir(), '.config', 'fwdloop');
}

/**
 * @param {string} [home]
 * @returns {string} `<home>/config.json`
 */
export function configPath(home) {
  return join(configHome(home), 'config.json');
}

/**
 * The home a model-call price lookup reads, resolved at the door. Under a test process
 * (`NODE_ENV=test` or `node --test`) only an explicit `FWDLOOP_CONFIG_HOME` is read; with none, NO
 * config is read at all — a test never touches the real `~/.config/fwdloop`. Outside tests: the real home.
 * @returns {{ skip: boolean, home: string|undefined }}
 */
export function configDoorHome() {
  const underTest = process.env.NODE_ENV === 'test' || process.env.NODE_TEST_CONTEXT !== undefined;
  if (!underTest) return { skip: false, home: undefined };
  const home = process.env.FWDLOOP_CONFIG_HOME || undefined;
  return { skip: home === undefined, home };
}

/** Fields a config file may hold; `cachedInPerM` stays so an older file still loads, but nothing prices from it. */
export const PRICE_FIELDS = Object.freeze(['inPerM', 'cachedInPerM', 'outPerM']);
const SLOT_RE = /^[A-Za-z0-9_-]{1,64}$/;

// The secret-shape inventory (bareloop src/validate.js SECRET_PATTERNS): known token shapes only,
// left-bounded so hyphenated words never match.
const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/,
  /(?<![A-Za-z0-9_-])ghp_[A-Za-z0-9]{20,}/,
  /(?<![A-Za-z0-9_-])github_pat_[A-Za-z0-9_]{20,}/,
  /(?<![A-Za-z0-9_-])AKIA[0-9A-Z]{16}/,
  /(?<![A-Za-z0-9_-])xox[bap]-[A-Za-z0-9-]{10,}/,
  /(?<![A-Za-z0-9_-])AIza[0-9A-Za-z_-]{35}/,
];
const isSecretShaped = (str) => SECRET_PATTERNS.some((re) => re.test(str));

/** Paths (never values) of every string or key in a tree that carries a secret shape. @param {any} node @param {string} at @param {string[]} out */
function secretPaths(node, at, out) {
  if (typeof node === 'string') {
    if (isSecretShaped(node)) out.push(at || '(root)');
  } else if (Array.isArray(node)) {
    node.forEach((v, i) => secretPaths(v, `${at}.${i}`, out));
  } else if (node !== null && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      const p = at ? `${at}.${k}` : k;
      if (isSecretShaped(k)) out.push(p);
      secretPaths(v, p, out);
    }
  }
}

export const PROVIDER_FIELDS = Object.freeze(['model', 'shape', 'baseUrl', 'legacyMaxTokens']);

/** One provider field's value problem in plain words, or null when fine. Shared by validateDoc and the route. */
export function providerFieldProblem(field, v) {
  if (field === 'model') {
    if (typeof v !== 'string' || v.length === 0 || v.length > 200 || /\s/.test(v)) return 'must be a model id: 1 to 200 characters, no spaces';
  } else if (field === 'shape') {
    if (!SHAPE_IDS.includes(v)) return `must be one of ${SHAPE_IDS.join(', ')}`;
  } else if (field === 'legacyMaxTokens') {
    if (typeof v !== 'boolean') return 'must be true or false';
  } else if (field === 'baseUrl') {
    if (typeof v !== 'string' || !(v === '' || /^https?:\/\/\S+$/.test(v))) return 'must be empty (the default) or an http(s) address';
  } else return 'is not a provider field';
  return null;
}

/** A Base URL as stored: trailing slashes dropped. */
export const cleanBaseUrl = (v) => v.replace(/\/+$/, '');

const isPrice = (v) => typeof v === 'number' && Number.isFinite(v) && v > 0;

/**
 * THE one rule for a slot's model lines (M4d amendment 3 items 7-8), used by config validation and the Settings
 * route. A price is a PAIR (`inPerM` and `outPerM`, each a finite number >= 0 — 0 / 0 typed is a chosen price,
 * recorded so it is never unknown) or neither (null / absent). A ticked line (`use`) needs both. Plain words, or null.
 * @param {any} list
 * @returns {string|null}
 */
export function modelsProblem(list) {
  if (!Array.isArray(list)) return 'The model list must be a list of lines.';
  const seen = new Set();
  for (const line of list) {
    if (line === null || typeof line !== 'object' || Array.isArray(line)) return 'Each model line must be an object.';
    const bad = providerFieldProblem('model', line.model);
    if (bad) return `The model name ${bad}.`;
    if (seen.has(line.model)) return `The model "${line.model}" is listed twice.`;
    seen.add(line.model);
    if (typeof line.use !== 'boolean') return 'Use must be on or off.';
    const has = (f) => line[f] !== undefined && line[f] !== null;
    const isNum = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (has('inPerM') !== has('outPerM')) return 'Fill both price boxes or clear both.';
    if (has('inPerM') && !(isNum(line.inPerM) && isNum(line.outPerM))) return 'A price must be a number, 0 or more.';
    if (line.use && !has('inPerM')) return 'Fill both prices to tick this model.';
    // `thinkingOff` is an older file's field (M4d amendment 5): tolerated so the file loads, read by nothing, dropped on the next save of the list (amendment 7).
    for (const k of Object.keys(line)) if (!['model', 'use', 'inPerM', 'outPerM', 'thinkingOff'].includes(k)) return `A model line has no "${k}" field.`;
  }
  return null;
}

/** @param {any} models */
function validateModels(models) {
  if (models === undefined) return;
  if (models === null || typeof models !== 'object' || Array.isArray(models)) throw new ConfigError('models must be an object of provider slots');
  for (const [slot, list] of Object.entries(models)) {
    if (!SLOT_RE.test(slot)) throw new ConfigError(`models: "${slot}" is not a provider slot name`);
    const problem = modelsProblem(list);
    if (problem) throw new ConfigError(`models.${slot}: ${problem}`);
  }
}

/** @param {any} providers */
function validateProviders(providers) {
  if (providers === undefined) return;
  if (providers === null || typeof providers !== 'object' || Array.isArray(providers)) {
    throw new ConfigError('providers must be an object of provider slots');
  }
  for (const [slot, row] of Object.entries(providers)) {
    if (!SLOT_RE.test(slot)) throw new ConfigError(`providers: "${slot}" is not a provider slot name`);
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new ConfigError(`providers.${slot} must be an object`);
    for (const [field, v] of Object.entries(row)) {
      if (!PROVIDER_FIELDS.includes(field)) throw new ConfigError(`providers.${slot}.${field} is not a provider field (${PROVIDER_FIELDS.join(', ')})`);
      const problem = providerFieldProblem(field, v);
      if (problem) throw new ConfigError(`providers.${slot}.${field} ${problem}`);
    }
  }
}

/**
 * Validate a whole document's known fields; throws ConfigError naming the field.
 * @param {Record<string, any>} doc
 */
function validateDoc(doc) {
  if (doc.monthlyLimitUsd !== undefined && !isPrice(doc.monthlyLimitUsd)) {
    throw new ConfigError('monthlyLimitUsd must be a number above 0 (remove the limit to have none)');
  }
  if (doc.learningHints !== undefined && typeof doc.learningHints !== 'boolean') {
    throw new ConfigError('learningHints must be true or false');
  }
  validateProviders(doc.providers);
  validateModels(doc.models);
  if (doc.prices === undefined) return;
  if (doc.prices === null || typeof doc.prices !== 'object' || Array.isArray(doc.prices)) {
    throw new ConfigError('prices must be an object of provider slots');
  }
  for (const [slot, row] of Object.entries(doc.prices)) {
    if (!SLOT_RE.test(slot)) throw new ConfigError(`prices: "${slot}" is not a provider slot name`);
    if (row === null || typeof row !== 'object' || Array.isArray(row)) throw new ConfigError(`prices.${slot} must be an object`);
    for (const [field, v] of Object.entries(row)) {
      if (!PRICE_FIELDS.includes(field)) throw new ConfigError(`prices.${slot}.${field} is not a price field (${PRICE_FIELDS.join(', ')})`);
      if (!isPrice(v)) throw new ConfigError(`prices.${slot}.${field} must be a number above 0 (USD per 1M tokens)`);
    }
  }
}

/**
 * The parsed, validated document. `{}` when the file is missing. THROWS ConfigError when the file is
 * there but unreadable, not a JSON object, or holds an invalid known field — never `{}` for those.
 * @param {{ home?: string }} [opts]
 * @returns {Record<string, any>}
 */
export function readConfig(opts = {}) {
  const file = configPath(opts.home);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch (/** @type {any} */ e) {
    if (e?.code === 'ENOENT') return {};
    throw new ConfigError(`${file} could not be read (${e?.code ?? 'error'}) — fix or remove it`);
  }
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new ConfigError(`${file} is not readable JSON — fix or remove it`);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ConfigError(`${file} must hold a JSON object — fix or remove it`);
  }
  try {
    validateDoc(parsed);
  } catch (/** @type {any} */ e) {
    throw new ConfigError(`${file}: ${e.message}`);
  }
  return parsed;
}

/**
 * Apply a patch and write. `null` deletes a field. Top-level fields shallow-merge; `prices` merges
 * per slot, then per field; `models.<slot>` is replaced whole (`prices.<slot> = null` clears the slot, `prices.<slot>.<field> = null`
 * clears the field). Everything is validated before anything is written; a refusal leaves the file
 * untouched.
 * @param {Record<string, any>} patch
 * @param {{ home?: string }} [opts]
 * @returns {Record<string, any>} the document as written
 */
export function updateConfig(patch, opts = {}) {
  const cur = readConfig(opts);
  /** @type {Record<string, any>} */
  const next = { ...cur };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'prices' || k === 'providers' || k === 'models') continue;
    if (v === null) delete next[k];
    else next[k] = v;
  }
  if (patch.prices !== undefined) {
    const p = patch.prices;
    if (p === null) {
      delete next.prices;
    } else {
      if (typeof p !== 'object' || Array.isArray(p)) throw new ConfigError('prices must be an object of provider slots');
      /** @type {Record<string, any>} */
      const prices = { ...(next.prices ?? {}) };
      for (const [slot, row] of Object.entries(p)) {
        if (row === null) { delete prices[slot]; continue; }
        if (typeof row !== 'object' || Array.isArray(row)) throw new ConfigError(`prices.${slot} must be an object`);
        const merged = { ...(prices[slot] ?? {}) };
        for (const [field, v] of Object.entries(row)) {
          if (v === null) delete merged[field];
          else merged[field] = v;
        }
        if (Object.keys(merged).length === 0) delete prices[slot];
        else prices[slot] = merged;
      }
      if (Object.keys(prices).length === 0) delete next.prices;
      else next.prices = prices;
    }
  }
  if (patch.providers !== undefined) {
    const p = patch.providers;
    if (p === null) {
      delete next.providers;
    } else {
      if (typeof p !== 'object' || Array.isArray(p)) throw new ConfigError('providers must be an object of provider slots');
      /** @type {Record<string, any>} */
      const providers = { ...(next.providers ?? {}) };
      for (const [slot, row] of Object.entries(p)) {
        if (row === null) { delete providers[slot]; continue; }
        if (typeof row !== 'object' || Array.isArray(row)) throw new ConfigError(`providers.${slot} must be an object`);
        const merged = { ...(providers[slot] ?? {}) };
        for (const [field, v] of Object.entries(row)) {
          if (v === null) delete merged[field];
          else merged[field] = field === 'baseUrl' && typeof v === 'string' ? cleanBaseUrl(v) : v;
        }
        if (Object.keys(merged).length === 0) delete providers[slot];
        else providers[slot] = merged;
      }
      if (Object.keys(providers).length === 0) delete next.providers;
      else next.providers = providers;
    }
  }
  if (patch.models !== undefined) {
    const p = patch.models;
    if (p === null) {
      delete next.models;
    } else {
      if (typeof p !== 'object' || Array.isArray(p)) throw new ConfigError('models must be an object of provider slots');
      // a slot's list is replaced whole (`null` clears the slot); other slots are kept
      const models = { ...(next.models ?? {}) };
      for (const [slot, list] of Object.entries(p)) {
        if (list === null) delete models[slot];
        else models[slot] = list;
      }
      if (Object.keys(models).length === 0) delete next.models;
      else next.models = models;
    }
  }
  validateDoc(next);
  /** @type {string[]} */
  const leaks = [];
  secretPaths(next, '', leaks);
  if (leaks.length) {
    throw new ConfigError(`config.json never holds a key value — a secret-shaped string at ${leaks.join(', ')} was refused (keys live in the keys file)`);
  }
  const file = configPath(opts.home);
  mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return next;
}
