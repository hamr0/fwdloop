// The small pieces of bareloop's facts.js, factwords.js, labelscan.js and rubricstep.js that the copied page rules need. Each piece is a copy;
// the rest of those files (bareguard-facing fact checks, label scans, the rubric step) is not wanted here and is not copied.

// borrowed-from: bareloop src/facts.js@b7d3306 (FACT_OPS, MAX_CURRENCIES, MAX_UNITS, MAX_UNIT_CHARS, asList, boundOk)
export const FACT_OPS = Object.freeze(['lt', 'lte', 'gt', 'gte', 'between']);
export const MAX_CURRENCIES = 3;
export const MAX_UNITS = 10;
export const MAX_UNIT_CHARS = 100;
export const asList = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? [v] : []));
export const boundOk = (/** @type {string} */ shape, /** @type {unknown} */ v) => (shape === 'number' || shape === 'money' ? typeof v === 'number' && Number.isFinite(v) : typeof v === 'string' && v !== '');

// borrowed-from: bareloop src/factwords.js@18ab77c (squash, loose, countExact, countPhrase - rewritten without a built pattern, same count, see test/m10-pagebits.test.js)
const WS = /[\s   ]+/g;
/** a letter or a digit (any script); the character right at the start of the string tested */
const WORD_CHAR = /^[\p{L}\p{N}]/u;

/** @param {string} t @returns {string} the source with every run of white space made one space */
export const squash = (t) => String(t ?? '').replace(WS, ' ');
/** @param {string} t @returns {string} lower case, markdown marks dropped, white space squashed - how a phrase or unit is compared */
const loose = (t) => squash(t).replace(/[*_`]/g, '').trim().toLowerCase();

/**
 * How many times exact words occur in a source, white space blind. Zero for empty words.
 * @param {string} source the raw source text @param {string} words
 * @returns {number}
 */
export function countExact(source, words) {
  const w = squash(words).trim();
  if (w === '') return 0;
  const hay = squash(source);
  let n = 0;
  for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + w.length)) n += 1;
  return n;
}

/**
 * How many times a phrase or unit occurs as WHOLE words, case and spacing aside ("SFO" is not found inside "sfocus").
 * @param {string} source @param {string} words @returns {number}
 */
export function countPhrase(source, words) {
  const w = loose(words);
  if (w === '') return 0;
  const hay = loose(source);
  // The original is one dynamic RegExp, `(^|[^\p{L}\p{N}])<w>(?=$|[^\p{L}\p{N}])` over every match; this repo bans built patterns in src/, so the same count is
  // taken by hand: a hit has a non-letter-non-digit (or the start) before it and after it, and a hit may not reuse the character the last hit's end left behind.
  let n = 0;
  let consumedTo = 0;
  for (let i = hay.indexOf(w); i !== -1; i = hay.indexOf(w, i + 1)) {
    const prev = i === 0 ? null : /(.)$/su.exec(hay.slice(Math.max(0, i - 2), i))?.[1] ?? null;
    if (prev !== null && (WORD_CHAR.test(prev) || i - prev.length < consumedTo)) continue;
    if (WORD_CHAR.test(hay.slice(i + w.length, i + w.length + 2))) continue;
    n += 1;
    consumedTo = i + w.length;
    i += w.length - 1;
  }
  return n;
}

// borrowed-from: bareloop src/labelscan.js@dda9c8f (normLabel)
/** @param {string} t @returns {string} white space made one space, quote marks at the edges dropped, trimmed - how a label is compared */
export function normLabel(t) {
  return String(t ?? '').replace(WS, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

// borrowed-from: bareloop src/rubricstep.js@2f93962 (lineRules, boundSpellings, boundInWords, wordsSaidOn)
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** the ~ rules of one job line, one string each (`rules` when the line has the array, else the joined `rule` split on "; ") @param {any} l @returns {string[]} */
export function lineRules(l) {
  if (isRec(l) && Array.isArray(l.rules)) return l.rules.filter((/** @type {unknown} */ r) => typeof r === 'string' && r);
  return isRec(l) && typeof l.rule === 'string' && l.rule ? l.rule.split('; ').filter(Boolean) : [];
}

/** @param {unknown} b @returns {string[]} the spellings a rule bound can have in the person's own words */
const boundSpellings = (b) => {
  const s = String(b);
  return [s, s.replace(/^0+(?=\d)/, ''), s.replace(/\.0+$/, '')];
};

/**
 * Is this rule bound in the words the person wrote? The ONE test for "a number the AI made" (`rubric-fact-unmarked`, the L3 settle, and
 * the early ask of PRD v1.107 Part 5b all read it; never a second spelling).
 * @param {unknown} b @param {string} said @returns {boolean}
 */
export const boundInWords = (b, said) => boundSpellings(b).some((sp) => said.includes(sp));

/** @param {any} jl one job line @returns {string} the words the person wrote on it: the line and its `~` rules */
export const wordsSaidOn = (jl) => `${jl.text ?? ''} ${lineRules(jl).join(' ')}`;
