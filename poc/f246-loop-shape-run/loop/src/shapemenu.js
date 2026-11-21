// borrowed-from: bareloop src/shapemenu.js@v0.61.0 (fc56e1f3)
// SHAPE JOBS (itemShape), docs/product/ITEM33-BUILD.md "Addendum 2026-11-18: shape jobs (itemShape)": THE ONE PLACE the kind menu is named. The offer (src/shapelook.js), the builder (src/shapebuild.js) and the tests read this table, never a copy of it.
// It is bareguard's own: `rubricVocabulary.rules.itemShape.fields.fields` (ruling #83; bareguard ^0.37.0) lists the kinds, the options each kind accepts, and the name rules (`reservedNames`, `nameForbiddenChars`, `nameMaxLength`).
// What stays bareloop's: which options are BOUNDS the person must have written (GROUNDED_BOUNDS and its kin below), and which kind is not offered.
// Not offered: the `object` kind (nested field specs, depth 2). The builder refuses it in plain words; a shape job with a nested object is not built yet.
import { rubricVocabulary } from 'bareguard';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** bareguard's field-spec descriptor of `itemShape` @type {any} */
const IS = /** @type {any} */ (rubricVocabulary).rules.itemShape.fields.fields;

/** kind -> the options (bounds and modifiers) the kind accepts, as bareguard lists them (`object` is not offered). `of` and `minEntries`/`maxEntries`/`unique` are the list's; `equals` is the boolean's. @type {Readonly<Record<string, readonly string[]>>} */
export const SHAPE_KINDS = Object.freeze(Object.fromEntries(Object.entries(IS.kinds).filter(([k]) => k !== 'object').map(([k, opts]) => [k, Object.freeze(Object.keys(/** @type {any} */ (opts)))])));

/** the options whose value must be one of a closed list, as bareguard lists them (`money.currency` is a SIGN: "$", "€", "£"; `decimal`, `date.lang`): `kind` -> option -> the allowed values @type {Readonly<Record<string, Readonly<Record<string, readonly string[]>>>>} */
export const SHAPE_OPTION_VALUES = Object.freeze(Object.fromEntries(Object.entries(IS.kinds).filter(([k]) => k !== 'object').map(([k, opts]) => [k, Object.freeze(Object.fromEntries(Object.entries(/** @type {any} */ (opts)).filter(([, d]) => isRec(d) && Array.isArray(d.enum)).map(([o, d]) => [o, Object.freeze(d.enum.map(String))])))])));

/** the kinds a list entry (`of`) may be: every scalar kind (never `list`, never `object`) */
export const ENTRY_KINDS = Object.freeze(Object.keys(SHAPE_KINDS).filter((k) => k !== 'list'));

/** the options that are BOUNDS: each must appear in the person's own words (the same law as `groundedLiterals`, src/sheetbuild.js). The other options only say how a value is read (currency, unit, of, fromText ...). `equals` has its own rule (R5). */
export const GROUNDED_BOUNDS = Object.freeze(['minChars', 'maxChars', 'minWords', 'maxWords', 'min', 'max', 'gt', 'lt', 'values', 'minEntries', 'maxEntries']);

/** the upper bounds: "under 60 words" may sign 59, and "under 450" 449.99, so the number the person wrote, one more and its ceiling are the candidates */
export const UPPER_BOUNDS = Object.freeze(['max', 'maxChars', 'maxWords', 'maxEntries']);

/** the bounds that count characters, words or entries: whole numbers, 0 or more */
export const COUNT_BOUNDS = Object.freeze(['minChars', 'maxChars', 'minWords', 'maxWords', 'minEntries', 'maxEntries']);

/** a field name is at most this long (bareguard's `nameMaxLength`) */
export const NAME_MAX_CHARS = Number(IS.nameMaxLength);
/** a field name holds none of these (they separate the path in a red item: bareguard's `nameForbiddenChars`) */
export const NAME_FORBIDDEN = Object.freeze(IS.nameForbiddenChars.map(String));

/**
 * Does the bareguard this package runs carry `itemShape`? Read from the vocabulary at call time (true from bareguard 0.37); the shape look and everything after it is OFF where it is false.
 * @returns {boolean}
 */
export function shapeAvailable() {
  return isRec(/** @type {any} */ (rubricVocabulary)?.rules?.itemShape);
}

/**
 * The name rules of a signed field, all bareguard's own: the characters, the length and its reserved reason words (a field named `wrong-value` would read as a gap).
 * @returns {{max: number, forbidden: string[], reserved: string[]}}
 */
export function shapeNameRules() {
  return { max: NAME_MAX_CHARS, forbidden: [...NAME_FORBIDDEN], reserved: IS.reservedNames.map(String) };
}

/**
 * Is `name` a legal signed field name? Null when it is, else the plain reason.
 * @param {unknown} name @param {{max: number, forbidden: string[], reserved: string[]|null}} [rules]
 * @returns {string|null}
 */
export function nameWhy(name, rules = shapeNameRules()) {
  if (typeof name !== 'string' || name.trim() === '') return 'a field name is needed';
  if (name.length > rules.max) return `a field name is at most ${rules.max} characters`;
  const bad = rules.forbidden.find((c) => name.includes(c));
  if (bad !== undefined) return `a field name cannot hold "${bad}"`;
  if (rules.reserved !== null && rules.reserved.includes(name)) return `"${name}" is a word the checker uses for its own gaps, so it cannot name a field`;
  return null;
}
