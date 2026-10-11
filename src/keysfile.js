// borrowed-from: bareloop src/keysfile.js@a42ca5f
// M4d scope item 1 — the keys file loader (`~/.config/fwdloop/.env`).
//
// Key VALUES live only in this file (mode 0600, outside any repo) and in the shell
// environment — never in config.json, the spine, runs.jsonl, a log, a page or an audit
// row. This is the ONE reader of that file. Plain `NAME=value` lines (an optional
// `export ` prefix, `#` full-line comments, one pair of matching quotes around the
// value); no dependency.
//
// Every name with a value is a Settings row (M4d amendment 6): fwdloop knows no key name of its own. A name reaches the env
// (and so a child) only once its row is set up in Settings (`configured`): a `NODE_OPTIONS` line is listed, never passed on.
//
// Precedence: the SHELL wins. An exported `FOO=…` beats the file; the file only fills
// names the shell leaves unset (or empty). The merged env is a NEW object —
// `process.env` is never mutated.
//
// Adjusted from bareloop (ruling 1A, hamr 2026-10-05): a file with any group/other bit is
// REFUSED, not warned about. A refusal carries no env at all: nothing that needs a key runs.
//
// Values leave this module in exactly one place: the `env` of an ok `loadKeysEnv`.
// Everything else it returns (`names`, `path`, `exists`, `refusal`) is value-free by
// construction, and a parse problem never quotes the offending line.
import {
  openSync, fstatSync, readFileSync, closeSync, writeFileSync, mkdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { configHome, configDoorHome, readConfig } from './config.js';

const NAME_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

const DEFAULT_SHOWN = '~/.config/fwdloop/.env';

/**
 * `~/.config/fwdloop`, or an injected override. The CLI/panel door honors the test-only
 * `FWDLOOP_CONFIG_HOME` through `keysForDoor` (two gates, like the other test seams).
 * @param {string} [home] test seam; production never passes it
 * @returns {string}
 */
export function keysHome(home) {
  return configHome(home); // one definition of the config home (src/config.js)
}

/**
 * @param {string} [home]
 * @returns {string} `<home>/.env`
 */
export function keysFilePath(home) {
  return join(keysHome(home), '.env');
}

/** The path as a sentence shows it: `~/...` for the default home, the real path for an injected one. */
const shownPath = (home) => (home === undefined ? DEFAULT_SHOWN : keysFilePath(home));

/** The one wording of the 1A refusal (ruling 1A, hamr 2026-10-05). @param {string} [home] */
export function chmodSentence(home) {
  return `Your keys file can be read by other users. Run: chmod 600 ${shownPath(home)}`;
}

/**
 * Parse the file's text. Lines that are not `NAME=value` are skipped silently
 * (never echoed — a malformed line may hold a secret).
 * @param {string} text
 * @returns {Record<string,string>}
 */
export function parseKeysText(text) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) continue;
    const body = line.startsWith('export ') ? line.slice(7).trimStart() : line;
    const eq = body.indexOf('=');
    if (eq <= 0) continue;
    const name = body.slice(0, eq).trim();
    if (!NAME_RE.test(name)) continue;
    let value = body.slice(eq + 1).trim();
    if (value.length >= 2 && (value[0] === '"' || value[0] === "'") && value.endsWith(value[0])) {
      value = value.slice(1, -1);
    }
    out[name] = value;
  }
  return out;
}

/**
 * Create the file when — and only when — it does not exist: mode 0600 (`wx`), dir 0700,
 * the known key names as commented lines and nothing else.
 * @param {string} [home]
 * @returns {boolean} true if it was created
 */
function createKeysFile(home) {
  mkdirSync(keysHome(home), { recursive: true, mode: 0o700 });
  const body = '# fwdloop keys — type NAME=value by hand; this file is never shown or written by fwdloop.\n'
    + '# One line per provider key, e.g. MY_PROVIDER_API_KEY=... ; each key becomes a row in Settings > Providers.\n';
  try {
    writeFileSync(keysFilePath(home), body, { mode: 0o600, flag: 'wx' });
  } catch (/** @type {any} */ e) {
    if (e?.code === 'EEXIST') return false; // lost a race: the file is there, untouched
    throw e;
  }
  return true;
}

/**
 * @typedef {object} KeysLoad
 * @property {boolean} ok false = refused: nothing that needs a key may run
 * @property {string} path the keys file's path as shown to people
 * @property {boolean} exists the file is there (true after a create)
 * @property {string[]} names the NAMES the file defines with a value (sorted; never values)
 * @property {string[]} shellOnly the configured key names that only the shell sets (file empty/absent)
 * @property {string[]} keyNames the NAMES of the keys that are set up in Settings and hold a value in `env` (the scrub list's names; never values)
 * @property {string|null} refusal a plain sentence when `ok` is false, else null
 * @property {Record<string,string|undefined>} env shell env with the file filling the names the
 *   shell does not set; on a refusal just a copy of the shell env (no file value). THE ONLY
 *   place file values leave this module.
 */

/**
 * The key VALUES of the named keys in an env: the scrub list. The names come from a load's `keyNames`.
 * @param {Record<string,string|undefined>} env @param {readonly string[]|undefined} names
 * @returns {string[]}
 */
export function keyValues(env, names) {
  /** @type {string[]} */
  const out = [];
  for (const n of names ?? []) { const v = env[n]; if (typeof v === 'string' && v !== '') out.push(v); }
  return out;
}

/**
 * Load the keys file over an env. A missing file is created (0600) and is not a refusal. `configured` = the key names that have a row
 * set up in Settings (`config.providers`): only those file values reach `env`.
 * @param {{ env?: Record<string,string|undefined>, home?: string, configured?: string[] }} [opts]
 * @returns {KeysLoad}
 */
export function loadKeysEnv(opts = {}) {
  const base = opts.env ?? process.env;
  const file = keysFilePath(opts.home);
  const path = shownPath(opts.home);
  const configured = opts.configured ?? [];
  const knownShell = (parsed) => configured.filter((n) => base[n] && !parsed[n]);
  /** @param {string} refusal @param {boolean} exists @returns {KeysLoad} */
  const refused = (refusal, exists) => ({
    ok: false, path, exists, names: [], shellOnly: [], keyNames: [], refusal, env: { ...base },
  });
  let fd;
  let created = false;
  try {
    try {
      fd = openSync(file, 'r');
    } catch (/** @type {any} */ e) {
      if (e?.code !== 'ENOENT') throw e;
      created = createKeysFile(opts.home);
      fd = openSync(file, 'r');
    }
    const st = fstatSync(fd);
    if (!st.isFile()) return refused(`Your keys file ${path} is not a regular file.`, true);
    if ((st.mode & 0o077) !== 0) return refused(chmodSentence(opts.home), true);
    const parsed = parseKeysText(readFileSync(fd, 'utf8'));
    /** @type {Record<string,string|undefined>} */
    const env = { ...base };
    // C4 (amendment 16), M4d amendment 6: only a name whose row is set up in Settings reaches the env (and so a child). Any other name in the
    // file is listed in `names` for Settings but its value stays here — a `NODE_OPTIONS` line must never reach a run, resume or draft child.
    for (const name of configured) {
      if (!env[name] && Object.hasOwn(parsed, name)) env[name] = parsed[name];
    }
    return {
      ok: true, path, exists: true, names: Object.entries(parsed).filter(([, v]) => v !== '').map(([n]) => n).sort(), shellOnly: knownShell(parsed), keyNames: [...new Set(configured)].filter((n) => env[n]).sort(), refusal: null, env,
    };
  } catch (/** @type {any} */ e) {
    return refused(`Your keys file ${path} could not be read (${e?.code ?? 'error'}).`, created || e?.code !== 'ENOENT');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

/**
 * The key names that have a row set up in Settings (a `config.providers` entry). A broken config reads as none here: the file is
 * still listed, and whoever reads the config refuses it by name.
 * @param {string|undefined} home
 * @returns {string[]}
 */
function configuredNames(home) {
  try { return Object.keys(readConfig({ home }).providers ?? {}); } catch { return []; }
}

/**
 * The door helper the CLI and the panel call. Loads the file only when the caller is on the
 * REAL environment, or names a home explicitly (a test), or a test process (`configDoorHome`) with
 * `FWDLOOP_CONFIG_HOME` set — so a test that injects `env` alone, or runs under NODE_ENV=test
 * without a home, never reads (or creates) the real `~/.config/fwdloop/.env`.
 * @param {{ env?: Record<string,string|undefined>, keysHome?: string }} [deps]
 * @returns {KeysLoad & { skipped: boolean }}
 */
export function keysForDoor(deps = {}) {
  const shell = process.env;
  const door = configDoorHome(); // the one "under test" rule (NODE_ENV=test or node --test) and its home
  const home = deps.keysHome ?? door.home;
  const testNoHome = door.skip && home === undefined;
  if ((deps.env !== undefined && home === undefined) || testNoHome) {
    return {
      ok: true, skipped: true, path: shownPath(undefined), exists: false, names: [], shellOnly: [], keyNames: [], refusal: null, env: { ...(deps.env ?? shell) },
    };
  }
  return { ...loadKeysEnv({ env: deps.env, home, configured: configuredNames(home) }), skipped: false };
}
