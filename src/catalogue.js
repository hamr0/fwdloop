// ported-from: poc/m0/catalogue.mjs@c4f272e (CATALOGUE/FENCE data,
// menu()/primitiveFor()/resolveEntry() shape) — rewritten, never imported.
// src must not import from poc (CLAUDE.md: "borrow, never import";
// complete separation between poc/ and src/).
//
// M1 piece 4 (docs/wiki/the-module-ladder.md, "M1 — scope, exit,
// negative — SIGNED", scope item 5): "Catalogue as data. The primitive
// catalogue is a data file the validator reads, not code the drafter can
// reach." `src/catalogue.json` is that file; this module parses it against
// a closed schema (never throws), exposes `menu`/`primitiveFor` with the
// same absence-not-refusal semantics as the poc, and ports `resolveEntry`
// so a catalogue entry naming a symbol that doesn't exist is still caught
// (F23) rather than trusted blind.
//
// `plumbing` carries poc's three FENCE entries plus `checkpoint`. Reason:
// M1's slot grammar (F31; amendment 3, 2026-09-21) means a pause exists only
// where a human marked a numbered job line `ask:` (or `ask <int><s|m|h>:`);
// the runner inserts the checkpoint
// mechanically once that slot resolves, and the drafter never selects it —
// exactly poc's own definition of plumbing ("the runner wires these... the
// drafter never selects them, so they are deliberately absent from
// CATALOGUE, menu(), and primitiveFor()"). Absence, not refusal: `checkpoint`
// is not offered on any menu(), and primitiveFor() returns null for it, same
// as any other unknown verb — src/declaration.js's own ask-slot check (rule
// b) is what turns a step that DOES grant it into a red.
//
// `addressCells`/`readDocx` are fwdloop's own citation-contract primitives
// (F13 ruled 2026-09-09, "it is ours" — not a baresuite primitive). Their
// backing modules (poc/m0/csv.mjs, poc/m0/docx.mjs) move into src/ at M2;
// until then `package: "fwdloop"` names the gap explicitly rather than
// pointing at poc/, and `resolveEntry` reports it as an honest declared
// unresolved, not a pretend green.
//
// No `new RegExp` anywhere in this file (M1 signed scope item 6; the same
// grep that covers src/signed-text.js and src/declaration.js covers this
// file too).

import { readFileSync } from 'node:fs';

/** @typedef {import('./types.js').CatalogueEntry} CatalogueEntry */
/** @typedef {import('./types.js').PlumbingEntry} PlumbingEntry */
/** @typedef {import('./types.js').ParseCatalogueResult} ParseCatalogueResult */

/** Every top-level and entry-level field this schema defines — kept in sync
 *  with the checks below so a mutation suite can assert it tested every one
 *  of them (same trick as ARBITER_FIELDS/DECLARATION_FIELDS). */
export const CATALOGUE_FIELDS = Object.freeze([
  // top level
  'version',
  'primitives',
  'plumbing',
  // primitive entry fields
  'verb',
  'component',
  'package',
  'symbol',
  'method',
  'tool',
  'class',
  'skill',
  'desc',
  // plumbing entry fields
  'name',
]);

const VALID_CLASSES = Object.freeze(['read', 'write', 'store']);

const TOP_LEVEL_ALLOWED = Object.freeze(['version', 'primitives', 'plumbing']);
const PRIMITIVE_ALLOWED = Object.freeze([
  'verb', 'component', 'package', 'symbol', 'method', 'tool', 'class', 'skill', 'desc',
]);
const PRIMITIVE_REQUIRED = Object.freeze([
  'verb', 'component', 'package', 'symbol', 'class', 'skill', 'desc',
]);
const PLUMBING_ALLOWED = Object.freeze(['name', 'package', 'symbol']);
const PLUMBING_REQUIRED = Object.freeze(['name', 'package', 'symbol']);

/** @returns {value is Record<string, any>} */
function isPlainObject(value) {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.length > 0;
}

function checkOwnKeys(obj, allowed, path, reds) {
  for (const key of Object.keys(obj)) {
    if (!allowed.includes(key)) {
      reds.push(`catalogue: unknown key "${key}" at ${path}.${key}`);
    }
  }
}

function checkPrimitiveEntry(entry, path, reds) {
  if (!isPlainObject(entry)) {
    reds.push(`catalogue: ${path} must be an object`);
    return;
  }
  checkOwnKeys(entry, PRIMITIVE_ALLOWED, path, reds);
  for (const field of PRIMITIVE_REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) {
      reds.push(`catalogue: ${path}.${field} is required`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'verb') && !isNonEmptyString(entry.verb)) {
    reds.push(`catalogue: ${path}.verb must be a non-empty string`);
  }
  for (const field of ['component', 'package', 'symbol', 'skill', 'desc']) {
    if (Object.prototype.hasOwnProperty.call(entry, field) && !isNonEmptyString(entry[field])) {
      reds.push(`catalogue: ${path}.${field} must be a non-empty string`);
    }
  }
  if (Object.prototype.hasOwnProperty.call(entry, 'class')) {
    if (!isNonEmptyString(entry.class) || !VALID_CLASSES.includes(entry.class)) {
      reds.push(`catalogue: ${path}.class must be one of ${VALID_CLASSES.join('|')}`);
    }
  }
  const hasMethod = Object.prototype.hasOwnProperty.call(entry, 'method');
  const hasTool = Object.prototype.hasOwnProperty.call(entry, 'tool');
  if (hasMethod && !isNonEmptyString(entry.method)) {
    reds.push(`catalogue: ${path}.method must be a non-empty string`);
  }
  if (hasTool && !isNonEmptyString(entry.tool)) {
    reds.push(`catalogue: ${path}.tool must be a non-empty string`);
  }
  if (hasMethod && hasTool) {
    reds.push(`catalogue: ${path} carries both "method" and "tool" — an entry may name only one`);
  }
}

function checkPlumbingEntry(entry, path, reds) {
  if (!isPlainObject(entry)) {
    reds.push(`catalogue: ${path} must be an object`);
    return;
  }
  checkOwnKeys(entry, PLUMBING_ALLOWED, path, reds);
  for (const field of PLUMBING_REQUIRED) {
    if (!Object.prototype.hasOwnProperty.call(entry, field)) {
      reds.push(`catalogue: ${path}.${field} is required`);
    } else if (!isNonEmptyString(entry[field])) {
      reds.push(`catalogue: ${path}.${field} must be a non-empty string`);
    }
  }
}

/**
 * Parse the catalogue file's text against the closed schema. Never throws —
 * invalid JSON, a missing/retyped field, an unknown key, a duplicate verb,
 * or a plumbing/primitive name clash all come back as `{ ok: false, reds }`.
 *
 * @param {unknown} text
 * @returns {ParseCatalogueResult}
 */
export function parseCatalogue(text) {
  if (typeof text !== 'string') {
    return deepFreeze({ ok: false, reds: ['catalogue: input must be a string'] });
  }

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    return deepFreeze({ ok: false, reds: [`catalogue: invalid JSON — ${err.message}`] });
  }

  const reds = [];

  if (!isPlainObject(parsed)) {
    return deepFreeze({ ok: false, reds: ['catalogue: must be an object'] });
  }

  checkOwnKeys(parsed, TOP_LEVEL_ALLOWED, 'catalogue', reds);

  if (!Object.prototype.hasOwnProperty.call(parsed, 'version')) {
    reds.push('catalogue: "version" is required');
  } else if (parsed.version !== 1) {
    reds.push(`catalogue: "version" must be exactly 1, got ${JSON.stringify(parsed.version)}`);
  }

  const primitives = Array.isArray(parsed.primitives) ? parsed.primitives : null;
  if (primitives === null) {
    reds.push('catalogue: "primitives" must be an array');
  } else {
    primitives.forEach((entry, i) => checkPrimitiveEntry(entry, `catalogue.primitives[${i}]`, reds));
  }

  const plumbing = Array.isArray(parsed.plumbing) ? parsed.plumbing : null;
  if (plumbing === null) {
    reds.push('catalogue: "plumbing" must be an array');
  } else {
    plumbing.forEach((entry, i) => checkPlumbingEntry(entry, `catalogue.plumbing[${i}]`, reds));
  }

  // duplicate verb
  if (primitives !== null) {
    const seenAt = new Map();
    primitives.forEach((entry, i) => {
      if (!isPlainObject(entry) || !isNonEmptyString(entry.verb)) return;
      if (seenAt.has(entry.verb)) {
        reds.push(`catalogue: verb "${entry.verb}" is duplicated at primitives[${seenAt.get(entry.verb)}] and primitives[${i}]`);
      } else {
        seenAt.set(entry.verb, i);
      }
    });

    // plumbing name that is also a primitive verb
    if (plumbing !== null) {
      const verbs = new Set(seenAt.keys());
      plumbing.forEach((entry) => {
        if (isPlainObject(entry) && isNonEmptyString(entry.name) && verbs.has(entry.name)) {
          reds.push(`catalogue: plumbing name "${entry.name}" clashes with a primitive verb of the same name`);
        }
      });
    }
  }

  if (reds.length > 0) return deepFreeze({ ok: false, reds });

  return deepFreeze({
    ok: true,
    primitives: (primitives ?? []).map((e) => ({ ...e })),
    plumbing: (plumbing ?? []).map((e) => ({ ...e })),
  });
}

let memo;

/**
 * Read `./catalogue.json` next to this module and parse it. One reader;
 * memoised at module level (the file never changes at runtime).
 *
 * @returns {ParseCatalogueResult}
 */
export function loadCatalogue() {
  if (memo) return memo;
  let text;
  try {
    text = readFileSync(new URL('./catalogue.json', import.meta.url), 'utf8');
  } catch (err) {
    memo = deepFreeze({ ok: false, reds: [`catalogue: could not read catalogue.json — ${err.message}`] });
    return memo;
  }
  memo = parseCatalogue(text);
  return memo;
}

/**
 * The drafter/scout's menu: `primitives` filtered by class and/or skill.
 * Absence, not refusal — a filtered-out verb is not present in the
 * returned array at all. `classes`/`skills` are allow-lists; omit either
 * to leave that axis unfiltered.
 *
 * @param {CatalogueEntry[]} primitives
 * @param {{ classes?: string[], skills?: string[] }} [options]
 * @returns {CatalogueEntry[]}
 */
export function menu(primitives, { classes, skills } = {}) {
  if (!Array.isArray(primitives)) return [];
  return primitives.filter(
    (entry) => (!classes || classes.includes(entry.class)) && (!skills || skills.includes(entry.skill)),
  );
}

/**
 * Look up one catalogue entry by verb. Returns `null` on an unknown verb —
 * never throws (src style: `validateDeclaration` already turns an unknown
 * verb into a red; this module never needs to).
 *
 * @param {CatalogueEntry[]} primitives
 * @param {string} verb
 * @returns {CatalogueEntry | null}
 */
export function primitiveFor(primitives, verb) {
  if (!Array.isArray(primitives)) return null;
  return primitives.find((entry) => entry.verb === verb) ?? null;
}

/**
 * Prove one entry's `package`+`symbol` (plus `method`/`tool` where present)
 * actually resolves against the real installed package. Never throws;
 * returns `{ resolved: true }` or `{ resolved: false, reason }`.
 *
 * `package === "fwdloop"` is fwdloop's own citation-contract entries
 * (`addressCells`, `readDocx`) whose backing modules move into src/ at M2 —
 * this is a declared gap, not a resolvable import, so it comes back
 * unresolved with that reason rather than a pretend `true`.
 *
 * @param {{ verb?: string, name?: string, package: string, symbol: string, method?: string, tool?: string }} entry
 * @returns {Promise<{ resolved: true } | { resolved: false, reason: string }>}
 */
export async function resolveEntry(entry) {
  if (!isPlainObject(entry) || !isNonEmptyString(entry.package) || !isNonEmptyString(entry.symbol)) {
    return { resolved: false, reason: 'entry is missing a package or symbol to resolve' };
  }

  if (entry.package === 'fwdloop') {
    return { resolved: false, reason: 'own module lands in src at M2' };
  }

  let mod;
  try {
    mod = await import(entry.package);
  } catch (err) {
    return { resolved: false, reason: `could not import "${entry.package}" — ${err.message}` };
  }

  const label = entry.verb ?? entry.name ?? '(unnamed)';

  if (entry.method) {
    const Cls = mod[entry.symbol];
    if (typeof Cls !== 'function') {
      return { resolved: false, reason: `${entry.package}#${entry.symbol} is not an exported class (verb/name "${label}")` };
    }
    if (typeof Cls.prototype?.[entry.method] !== 'function') {
      return { resolved: false, reason: `${entry.package}#${entry.symbol} has no method "${entry.method}" (verb/name "${label}")` };
    }
    return { resolved: true };
  }

  if (entry.tool) {
    const factory = mod[entry.symbol];
    if (typeof factory !== 'function') {
      return { resolved: false, reason: `${entry.package}#${entry.symbol} is not an exported factory (verb/name "${label}")` };
    }
    let tools;
    try {
      ({ tools } = factory());
    } catch (err) {
      return { resolved: false, reason: `${entry.package}#${entry.symbol}() threw — ${err.message} (verb/name "${label}")` };
    }
    if (!Array.isArray(tools) || !tools.some((t) => t.name === entry.tool)) {
      return { resolved: false, reason: `${entry.package}#${entry.symbol}() does not produce a tool named "${entry.tool}" (verb/name "${label}")` };
    }
    return { resolved: true };
  }

  if (typeof mod[entry.symbol] !== 'function') {
    return { resolved: false, reason: `${entry.package} has no exported function "${entry.symbol}" (verb/name "${label}")` };
  }
  return { resolved: true };
}

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze(value[key]);
  }
  return value;
}
