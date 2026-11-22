// borrowed-from: bareloop src/config.js@v0.61.0 (fc56e1f3)
// rewritten-from: fwdloop src/config.js@f9449e8 (validators `modelsProblem`, `providerFieldProblem`, `cleanBaseUrl`)
// PANEL-BUILD.md P4a item 2 / P8 — the ONE reader/writer of `~/.config/bareloop/config.json`.
//
// Every panel/CLI setting lives in this one file (R5): the monthly $ limit and the Providers
// rows' API shape / Base URL / old-max_tokens tick (`keys`) and each row's model lines (`models`).
// Key VALUES never live here — they live in the keys file (`src/keysfile.js`) and the
// shell env. The write path refuses a document that carries a secret-shaped string
// (the ONE inventory: `sweepSecretLiterals`, src/validate.js).
//
// Shape (unknown fields are kept, never dropped):
//   { "monthlyLimitUsd": <number > 0>,          // absent = no limit, no check
//     "learningHints": true|false,               // absent = true (ON by default; only false turns it off): the planner is handed cross-run learnings (src/learn.js); the tally is kept either way
//     "keys":   { "<ENV NAME>": { "shape": "<shape id>", "baseUrl": "http(s)://…", "legacyMaxTokens": true|false } },
//     "models": { "<ENV NAME>": [ { "model": "<id>", "use": true|false, "inPerM": n, "outPerM": n } ] },
//     "mcpPaths": [ "<absolute path of an extra MCP config file>" ] }   // judged by `mcpPathProblem`; read by src/mcpsources.js
// An older file's `keys.<ENV>.{name,priceInPerM,priceOutPerM}` is tolerated and read as ONE model
// line (`effectiveModels`, src/providerrows.js); the first write of that row's `models` list removes them.
// `modelsProblem` is the ONE rule for a row's model lines: a price is a PAIR or neither, a ticked
// line needs both. Nothing here sniffs a host or a model id.
//
// A missing file = defaults. An UNREADABLE or INVALID file is reported (`problem`), never
// papered over — the monthly check REFUSES on it rather than silently running with
// no limit. Written atomically (tmp + rename), mode 600.
import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync, chmodSync,
} from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { sweepSecretLiterals } from './validate.js';
import { SHAPE_IDS } from './providershapes.js';

/** A plain-words config failure (bad value, secret-shaped string, unreadable file). */
export class ConfigError extends Error {}

/**
 * @param {string} [home] test seam; production never passes it
 * @returns {string} `<home>/config.json`
 */
export function configPath(home) {
  return join(home ?? join(homedir(), '.config', 'bareloop'), 'config.json');
}

/**
 * @typedef {object} ConfigRead
 * @property {Record<string, any>} config the parsed document ({} when missing/unreadable)
 * @property {boolean} exists
 * @property {string|null} problem plain words when the file is there but unreadable
 */

/**
 * @param {{ home?: string }} [opts]
 * @returns {ConfigRead}
 */
export function readConfig(opts = {}) {
  const file = configPath(opts.home);
  if (!existsSync(file)) return { config: {}, exists: false, problem: null };
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, 'utf8'));
  } catch (/** @type {any} */ e) {
    return { config: {}, exists: true, problem: `${file} is not readable JSON (${e?.code ?? 'parse error'}) — fix or remove it` };
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { config: {}, exists: true, problem: `${file} must hold a JSON object — fix or remove it` };
  }
  const bad = docProblem(parsed);
  if (bad) return { config: {}, exists: true, problem: `${file}: ${bad} — fix or remove it` };
  return { config: parsed, exists: true, problem: null };
}

const ENV_NAME_RE = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;

/** The fields of a key row this module validates (others are kept untouched). */
const KEY_FIELDS = Object.freeze(['shape', 'baseUrl', 'legacyMaxTokens']);

/**
 * One key-row field's value problem in plain words, or null when fine.
 * @param {string} field `model` | `shape` | `baseUrl` | `legacyMaxTokens`
 * @param {unknown} v
 * @returns {string|null}
 */
export function providerFieldProblem(field, v) {
  if (field === 'model') {
    if (typeof v !== 'string' || v.length === 0 || v.length > 200 || /\s/.test(v)) return 'must be a model id: 1 to 200 characters, no spaces';
  } else if (field === 'shape') {
    if (typeof v !== 'string' || !SHAPE_IDS.includes(v)) return `must be one of ${SHAPE_IDS.join(', ')}`;
  } else if (field === 'legacyMaxTokens') {
    if (typeof v !== 'boolean') return 'must be true or false';
  } else if (field === 'baseUrl') {
    if (typeof v !== 'string' || !(v === '' || /^https?:\/\/\S+$/.test(v))) return 'must be empty or an http(s) address';
  } else return 'is not a provider field';
  return null;
}

/** A Base URL as stored: trailing slashes dropped. @param {string} v @returns {string} */
export const cleanBaseUrl = (v) => v.replace(/(?<!\/)\/+$/, '');

/**
 * THE one rule for a row's model lines, used by config validation and the Settings routes. A price
 * is a PAIR (`inPerM` and `outPerM`, each a finite number >= 0 — 0 / 0 typed is a chosen price) or
 * neither (null / absent). A ticked line (`use`) needs both. Plain words, or null.
 * @param {unknown} list
 * @returns {string|null}
 */
export function modelsProblem(list) {
  if (!Array.isArray(list)) return 'The model list must be a list of lines.';
  const seen = new Set();
  for (const line of list) {
    if (line === null || typeof line !== 'object' || Array.isArray(line)) return 'Each model line must be an object.';
    const l = /** @type {Record<string, any>} */ (line);
    const bad = providerFieldProblem('model', l.model);
    if (bad) return `The model name ${bad}.`;
    if (seen.has(l.model)) return `The model "${l.model}" is listed twice.`;
    seen.add(l.model);
    if (typeof l.use !== 'boolean') return 'Use must be on or off.';
    const has = (/** @type {string} */ f) => l[f] !== undefined && l[f] !== null;
    const isNum = (/** @type {unknown} */ v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
    if (has('inPerM') !== has('outPerM')) return 'Fill both price boxes or clear both.';
    if (has('inPerM') && !(isNum(l.inPerM) && isNum(l.outPerM))) return 'A price must be a number, 0 or more.';
    if (l.use && !has('inPerM')) return 'Fill both prices to tick this model.';
    for (const k of Object.keys(l)) if (!['model', 'use', 'inPerM', 'outPerM'].includes(k)) return `A model line has no "${k}" field.`;
  }
  return null;
}

/**
 * The rule for `mcpPaths` (extra MCP config files the person added): a list of absolute, NUL-free paths, no duplicates. Plain words, or null.
 * (The Settings > MCP tab, R3, is the writer; `~` is expanded there, so what is stored is always absolute. One line, at most 500 characters: fwd's rule.)
 * @param {unknown} list
 * @returns {string|null}
 */
export function mcpPathProblem(list) {
  if (!Array.isArray(list)) return 'The MCP paths must be a list of file paths.';
  const seen = new Set();
  for (const p of list) {
    if (typeof p !== 'string' || p.trim() === '' || p.length > 500 || /[\0\r\n]/.test(p)) return 'Each MCP path must be one line of at most 500 characters.';
    if (!p.startsWith('/')) return `The MCP path "${p}" must be a full path (it starts with /).`;
    if (seen.has(p)) return `The MCP path "${p}" is listed twice.`;
    seen.add(p);
  }
  return null;
}

/**
 * The first problem in a document's known fields, in plain words, or null.
 * @param {Record<string, any>} doc
 * @returns {string|null}
 */
function docProblem(doc) {
  // monthlyLimitUsd is NOT judged here: `monthlyLimitOf` (src/monthly.js) owns its read-time sentence
  if (doc.learningHints !== undefined && typeof doc.learningHints !== 'boolean') return 'learningHints must be true or false';
  if (doc.mcpPaths !== undefined) {
    const bad = mcpPathProblem(doc.mcpPaths);
    if (bad) return `mcpPaths: ${bad}`;
  }
  if (doc.keys !== undefined) {
    if (doc.keys === null || typeof doc.keys !== 'object' || Array.isArray(doc.keys)) return 'keys must be an object of key variable names';
    for (const [env, row] of Object.entries(doc.keys)) {
      if (!ENV_NAME_RE.test(env)) return `"${env}" is not a key variable name`;
      if (row === null || typeof row !== 'object' || Array.isArray(row)) return `keys.${env} must be an object`;
      for (const f of KEY_FIELDS) {
        if (!Object.hasOwn(row, f)) continue;
        const bad = providerFieldProblem(f, /** @type {Record<string, any>} */ (row)[f]);
        if (bad) return `keys.${env}.${f} ${bad}`;
      }
    }
  }
  if (doc.models !== undefined) {
    if (doc.models === null || typeof doc.models !== 'object' || Array.isArray(doc.models)) return 'models must be an object of key variable names';
    for (const [env, list] of Object.entries(doc.models)) {
      if (!ENV_NAME_RE.test(env)) return `models: "${env}" is not a key variable name`;
      const bad = modelsProblem(list);
      if (bad) return `models.${env}: ${bad}`;
    }
  }
  return null;
}

/**
 * Apply a patch and write. `null` deletes a field. Top-level fields shallow-merge;
 * `keys` merges per key variable name, then per field; `models.<ENV>` is REPLACED WHOLE (`null`
 * clears it). Validated before anything is written; nothing is written on a refusal.
 *
 * Patch fields understood: `monthlyLimitUsd` (finite > 0), `learningHints` (true | false), `keys.<ENV>.{shape,baseUrl,legacyMaxTokens}`,
 * `models.<ENV>` (a list judged by {@link modelsProblem}). The first write of a row's `models` list
 * removes that row's older `name` / `priceInPerM` / `priceOutPerM` in the SAME write (never two
 * sources); the retired top-level `anthropicBalanceNote` and `carryNote` (the carry memo is always on, 2026-11-01) are dropped on any write. Any other field is
 * kept, but the whole document is swept for secret-shaped strings first.
 * @param {Record<string, any>} patch
 * @param {{ home?: string }} [opts]
 * @returns {Record<string, any>} the document as written
 */
export function updateConfig(patch, opts = {}) {
  const cur = readConfig(opts);
  if (cur.problem) throw new ConfigError(cur.problem);
  /** @type {Record<string, any>} */
  const next = { ...cur.config };
  for (const [k, v] of Object.entries(patch)) {
    if (k === 'keys' || k === 'models') continue;
    if (v === null) { delete next[k]; continue; }
    if (k === 'monthlyLimitUsd' && !(typeof v === 'number' && Number.isFinite(v) && v > 0)) {
      throw new ConfigError('monthlyLimitUsd must be a number above 0 (remove the limit to have none)');
    }
    if (k === 'learningHints' && typeof v !== 'boolean') throw new ConfigError('learningHints must be true or false');
    next[k] = v;
  }
  delete next.anthropicBalanceNote;
  delete next.carryNote;
  if (patch.keys !== undefined) {
    if (patch.keys === null || typeof patch.keys !== 'object' || Array.isArray(patch.keys)) {
      throw new ConfigError('keys must be an object of key variable names');
    }
    /** @type {Record<string, any>} */
    const keys = { ...(next.keys && typeof next.keys === 'object' ? next.keys : {}) };
    for (const [envName, fields] of Object.entries(patch.keys)) {
      if (!ENV_NAME_RE.test(envName)) throw new ConfigError(`"${envName}" is not a key variable name`);
      if (fields === null) { delete keys[envName]; continue; }
      if (typeof fields !== 'object' || Array.isArray(fields)) throw new ConfigError(`keys.${envName} must be an object`);
      const merged = { ...(keys[envName] && typeof keys[envName] === 'object' ? keys[envName] : {}) };
      for (const [fk, fv] of Object.entries(/** @type {Record<string, any>} */ (fields))) {
        if (fv === null) { delete merged[fk]; continue; }
        merged[fk] = fk === 'baseUrl' && typeof fv === 'string' ? cleanBaseUrl(fv) : fv;
      }
      keys[envName] = merged;
    }
    next.keys = keys;
  }
  if (patch.models !== undefined) {
    if (patch.models === null || typeof patch.models !== 'object' || Array.isArray(patch.models)) {
      throw new ConfigError('models must be an object of key variable names');
    }
    /** @type {Record<string, any>} */
    const models = { ...(next.models && typeof next.models === 'object' ? next.models : {}) };
    for (const [envName, list] of Object.entries(patch.models)) {
      if (!ENV_NAME_RE.test(envName)) throw new ConfigError(`"${envName}" is not a key variable name`);
      if (list === null) { delete models[envName]; continue; }
      models[envName] = list;
      const row = next.keys?.[envName];
      if (row && typeof row === 'object') {
        // one source: the older single-model fields leave with the first saved list
        const { name: _n, priceInPerM: _i, priceOutPerM: _o, ...rest } = row;
        next.keys = { ...next.keys, [envName]: rest };
      }
    }
    next.models = models;
  }
  const problem = docProblem(next);
  if (problem) throw new ConfigError(problem);
  /** @type {string[]} */
  const secretPaths = [];
  sweepSecretLiterals(next, (_code, path) => { secretPaths.push(path); });
  if (secretPaths.length) {
    throw new ConfigError(`config.json never holds a key value — a secret-shaped string at ${secretPaths.join(', ')} was refused (keys live in ~/.config/bareloop/.env)`);
  }
  const file = configPath(opts.home);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
  chmodSync(tmp, 0o600);
  renameSync(tmp, file);
  return next;
}
