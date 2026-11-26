// borrowed-from: bareloop src/checkpick.js@v0.57.0 (c18df406)
// fwd changed (M20 am8 item 2): guardrailItemCount keeps fwd's lookbehind (a number right after $ € £ . , is not an item count), and these readers are the one copy fwd's src/declaration.js re-exports.
// first ported from: bareloop src/checkpick.js@v0.56.0 (3383cce) (isCountable, keepOrDrop, countCheck, partOfPick, sameRuleWords and what they call; HOW_TO_ANSWER and CANT_CHECK_WORDS are fwd's own, src/checkpick.js, the same words)
// This file is bareloop's checkpick.js. fwd already has a src/checkpick.js (the M10 am16 pick path, whose keepOrDrop and countCheck differ from these); the check block calls THESE,
// so they live here under another name and the am16 module is left as it is.
// The pick vocabulary and its keep-or-drop: a suggested check is kept only if its rule is on bareguard's list and offered here, it carries only that rule's own fields, and every
// number is one the person's rule names.
import { rubricVocabulary } from 'bareguard';
import { plainWords, OFFERED } from './checkwords.js';

export { plainWords };

const VOCAB = /** @type {Record<string, {description: string, fields: Record<string, {type: string, required?: boolean}>}>} */ (rubricVocabulary.rules);

/** fields code sets, or that never decide: never offered, never kept */
const IGNORED = new Set(['id', 'field', 'text', 'strict']);

const NUM_FIELDS = ['value', 'size', 'wordsPerSection'];

const WORD_FIELDS = ['names', 'phrases'];

// ---- the guardrail readers: THE one copy (M20 am8 item 2; src/declaration.js re-exports them) ------------------------------------------------------------------------------
const readNumber = (/** @type {string} */ t) => Number(t.replace(/,/g, ''));

/** every whole-output word number in a guardrail ("under 600 words" -> [600]); a "<n> words each" / "per section" size is never listed here @param {unknown} g @returns {number[]} */
export function guardrailWordNumbers(g) {
  if (typeof g !== 'string') return [];
  return [...g.matchAll(/(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)\s*words?\b(?!\s*(?:each|per\s+section)\b)/gi)].map((m) => readNumber(m[1]));
}

/** every standalone number in a guardrail's own text (digits not joined to letters) @param {unknown} g @returns {number[]} */
export function guardrailStandaloneNumbers(g) {
  if (typeof g !== 'string') return [];
  return [...g.matchAll(/(?<![A-Za-z0-9_.,])(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)(?![A-Za-z0-9_])/g)].map((m) => Number(m[1].replace(/,/g, '')));
}

/** the "<n> words each" / "<n> words per section" size, or null @param {unknown} g @returns {number|null} */
export function guardrailWordsPerSection(g) {
  const m = typeof g === 'string' ? /(?<![\d,])(\d{1,3}(?:,\d{3})+|\d+)(?:\s*words?|ish(?:\s+words?)?)\s+(?:each|per\s+section)\b/i.exec(g) : null;
  return m ? readNumber(m[1]) : null;
}

const NUMBER_WORDS = /** @type {Record<string, number>} */ ({ one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 });

/** the first "<N> sections" in a guardrail (digits, or one..ten), or null @param {unknown} g @returns {number|null} */
export function guardrailSectionCount(g) {
  const m = typeof g === 'string' ? /\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?sections?\b/i.exec(g) : null;
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
}

/** the first "<N> bullets / list items / items / lines / points" in a guardrail (digits, or one..ten; not a price like "$5 per item" or a decimal), or null @param {unknown} g @returns {number|null} */
export function guardrailItemCount(g) {
  const m = typeof g === 'string' ? /(?<![$€£\d.,])\b(\d+|one|two|three|four|five|six|seven|eight|nine|ten)\s+(?:\w+\s+)?(?:bullets?|bullet\s+points?|list\s+items?|items?|lines?|points?)\b/i.exec(g) : null;
  if (!m) return null;
  return /^\d+$/.test(m[1]) ? Number(m[1]) : NUMBER_WORDS[m[1].toLowerCase()];
}

/** a list-bound word the guardrail uses: the count it names, or the one it stands for ("more than 3" = at least 4, "fewer than 3" = at most 2) */
const MORE_THAN = /(?<!\b(?:no|not)\s)\bmore\s+than\s+(\d+)\b/i;

const FEWER_THAN = /(?<!\b(?:no|not)\s)\b(?:(?:fewer|less)\s+than|under|below)\s+(\d+)\b/i;

/** the direction of a list-items rule's wording: 'max', 'min' or null (exact / not said) @param {string} t @returns {'max'|'min'|null} */
function listDirection(t) {
  if (/\b(at\s+most|up\s+to|no\s+more\s+than|not\s+more\s+than|max(?:imum)?(?:\s+of)?)\b/i.test(t) || FEWER_THAN.test(t)) return 'max';
  if (/\b(at\s+least|min(?:imum)?(?:\s+of)?|no\s+fewer\s+than|not\s+fewer\s+than)\b/i.test(t) || MORE_THAN.test(t)) return 'min';
  return null;
}

/** the numbers a rule may carry: the standalone numbers of the guardrail, plus N+1 for "more than N" (min) and N-1 for "fewer than N" (max) @param {string} rule @param {string} g @returns {number[]} */
function listBoundNumbers(rule, g) {
  const named = guardrailStandaloneNumbers(g);
  if (rule === 'minListItems') { const m = MORE_THAN.exec(g); if (m) named.push(Number(m[1]) + 1); }
  if (rule === 'maxListItems') { const m = FEWER_THAN.exec(g); if (m) named.push(Number(m[1]) - 1); }
  return named;
}

/** @param {unknown} g @returns {boolean} the rule is a COUNT bareguard checks (words, list items or lines, sections): code reads it, whatever the page look said about it */
export const isCountable = (g) => guardrailWordNumbers(g).length > 0 || guardrailItemCount(g) !== null || guardrailSectionCount(g) !== null;

// ---- code's keep-or-drop (am16 (2)) ------------------------------------------------------------------------------------------------------
const norm = (/** @type {unknown} */ t) => String(t).toLowerCase().replace(/\s+/g, ' ').trim();

/** a ~ rule's words compared case, spacing and trailing punctuation blind: the one spelling "is this the same rule?" is asked by */
export const sameRuleWords = (/** @type {unknown} */ a, /** @type {unknown} */ b) => norm(a).replace(/[.,;:!?\s]+$/, '') === norm(b).replace(/[.,;:!?\s]+$/, '');

const tokens = (/** @type {unknown} */ t) => new Set(norm(t).match(/[\p{L}\p{N}]+/gu) ?? []);

/**
 * Keep a suggestion only if its rule is on bareguard's list, it carries only that rule's own fields, every number in it is a number the guardrail names and every word in it
 * is a word of the guardrail. Anything else is dropped, with the reason. `none` is a drop with the reason `none`.
 * @param {string} guardrail @param {any} sug the model's entry for this guardrail
 * @returns {{kept: true, check: Record<string, any>}|{kept: false, why: string}}
 */
export function keepOrDrop(guardrail, sug) {
  if (sug == null || typeof sug !== 'object') return { kept: false, why: 'unreadable suggestion' };
  const { rule } = sug;
  if (rule === 'none' || rule === undefined || rule === null) return { kept: false, why: 'none' };
  if (typeof rule !== 'string' || !Object.hasOwn(VOCAB, rule)) return { kept: false, why: `rule "${rule}" is not on bareguard's list` };
  if (!OFFERED.includes(rule)) return { kept: false, why: `rule "${rule}" is on bareguard's list but is not offered here` };
  const own = Object.keys(VOCAB[rule].fields).filter((k) => !IGNORED.has(k));
  for (const k of own) if (VOCAB[rule].fields[k].required && sug[k] == null) return { kept: false, why: `${rule} needs ${k}` };
  const allowed = new Set([...own, 'rule', 'line', 'guardrail']);
  for (const k of Object.keys(sug)) if (sug[k] != null && !allowed.has(k)) return { kept: false, why: `${rule} does not take ${k}` };
  /** @type {Record<string, any>} */
  const check = { rule };
  for (const k of own) {
    const v = sug[k];
    if (v == null) continue;
    if (NUM_FIELDS.includes(k)) {
      const floor = rule === 'maxListItems' ? 0 : 1; // maxListItems 0 = no bullets (bareguard 0.35); every other count starts at 1
      if (!Number.isInteger(v) || v < floor) return { kept: false, why: `${k} ${JSON.stringify(v)} is not a whole number >= ${floor}` };
      const named = rule === 'maxWords' || rule === 'minWords' ? guardrailWordNumbers(guardrail)
        : k === 'wordsPerSection' ? [guardrailWordsPerSection(guardrail)].filter((x) => x !== null)
          : listBoundNumbers(rule, guardrail);
      if (!named.includes(v)) return { kept: false, why: `${k} ${v} is not a number the guardrail names (${named.join(', ') || 'it names none'})` };
      check[k] = v;
    } else if (WORD_FIELDS.includes(k)) {
      if (!Array.isArray(v) || v.length === 0 || v.some((s) => typeof s !== 'string' || s.trim() === '')) return { kept: false, why: `${k} is not a list of words` };
      const gTok = tokens(guardrail);
      const gNorm = norm(guardrail);
      for (const s of v) {
        if (!gNorm.includes(norm(s))) return { kept: false, why: `${k} "${s}" is not in the guardrail's words` };
        for (const t of tokens(s)) if (!gTok.has(t)) return { kept: false, why: `${k} word "${t}" is not a word of the guardrail` };
      }
      check[k] = v;
    }
  }
  if (rule === 'sections' || rule === 'sectionOrder' || rule === 'sectionWords') {
    const want = guardrailSectionCount(guardrail);
    if (want !== null && check.names.length !== want) return { kept: false, why: `the guardrail says ${want} sections; the check has ${check.names.length}` };
  }
  return { kept: true, check };
}

/**
 * The check a counting rule's own words already ARE ("exactly 3 list items" -> listItems 3), or null. No obvious asks (hamr 2026-11-14): such a rule is settled as written, never proposed back to the person.
 * @param {string} text @returns {Record<string, any>|null}
 */
export function obviousCheck(text) {
  const c = countCheck(text);
  return c !== null && c !== undefined && sameRuleWords(text, plainWords(/** @type {any} */ (c))) ? c : null;
}

/**
 * The check CODE proposes for a count rule when the call yields none (R10, ours; fwd has no such fallback): a bullets / list-items / points count -> listItems N (exact; "at most / up to / no more than / fewer than / under / below" -> maxListItems, "at least / minimum / no fewer than / more than" -> minListItems, F315), a lines count ->
 * maxLines N, ONE word number -> minWords N when the rule says "at least / minimum / more than", else maxWords N. A section count names no sections, so none is built; a rule naming two different counts ("3 bullets under 80 words") is not built either; a rule with
 * several word numbers or a range ("between 100 and 200 words") is not guessed. The result passes `keepOrDrop`, so every number is one the rule names.
 * @param {string} text @returns {Record<string, any>|null}
 */
export function countCheck(text) {
  const items = guardrailItemCount(text);
  const words = guardrailWordNumbers(text);
  /** @type {Record<string, any>|null} */
  let built = null;
  if (items !== null && (words.length > 0 || guardrailSectionCount(text) !== null)) return null; // two different counts in one rule: first-match readers would guess, so nothing is built
  if (items !== null && /\blines?\b/i.test(text) && !/\b(bullets?|items?|points?)\b/i.test(text)) built = { rule: 'maxLines', value: items };
  else if (items !== null) {
    const dir = listDirection(text);
    if (dir === 'min') built = { rule: 'minListItems', value: MORE_THAN.test(text) ? items + 1 : items };
    else if (dir === 'max') built = { rule: 'maxListItems', value: FEWER_THAN.test(text) ? items - 1 : items };
    else built = { rule: 'listItems', value: items };
  }
  else if (words.length === 1 && !/\bbetween\b|\d\s*(?:-|–|to)\s*\d/i.test(text)) built = { rule: /\b(at least|min(?:imum)?|more than|over|no fewer than)\b/i.test(text) ? 'minWords' : 'maxWords', value: words[0] };
  if (built === null) return null;
  const res = keepOrDrop(text, built);
  return res.kept ? res.check : null;
}

/** a part of a rubric-step stage, from a pick: the check's own fields, the rule's words, and the `~` rule numbers it carries out @param {Record<string, any>} check @param {string} text @param {number[]} rules */
export function partOfPick(check, text, rules) {
  const { rule, ...fields } = check;
  return { text, class: 'countable', check: rule, ...fields, rules };
}


// borrowed-from: bareloop src/checkpick.js@v0.61.0 (fc56e1f3)
/** the numbers a text says as "under / fewer than / less than / below N" (the one reader of that wording: a list-items rule and a shape field's bound both use it) @param {string} text @returns {number[]} */
export function underNumbers(text) {
  return [...String(text).matchAll(/(?<!\b(?:no|not)\s)\b(?:(?:fewer|less)\s+than|under|below)\s+(\d+)\b/gi)].map((m) => Number(m[1]));
}
/** the numbers a text says as "at most / up to / no more than / not more than N" @param {string} text @returns {number[]} */
export function atMostNumbers(text) {
  return [...String(text).matchAll(/\b(?:at\s+most|up\s+to|no\s+more\s+than|not\s+more\s+than)\s+(\d+)\b/gi)].map((m) => Number(m[1]));
}
