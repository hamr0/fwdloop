// borrowed-from: bareloop src/facts.js@0a34846 (FACT_SHAPES, MAX_FACTS, factDecides, factClaims, countSentence, plainFactItem; factSentence without the AI-proposal tail)
// borrowed-from: bareloop src/rubricstep.js@0a34846 (buildStepSpec fact branch, flattenStep fact branch, gradeStep core, plainStepGap fact branch)
// M10 piece 4 (docs/wiki/the-module-ladder.md "M10", item 2, "green grows"): a value points to its source - a quote on the run's own saved page, or a
// quote in a doc. The check is bareguard's `cited` + `decides`, built by code from a fact part: the quote is word for word in the frozen text, every
// value is in the quote (compared by kind), every value passes its number rule (under / over / between), and the results are as many as the part says
// (a harness-set count with a min and a max). No model grades. The claim TEXT bareguard's number scan reads is written here from the values, never by
// the step.
//
// A fact part is `{source: <input role>, facts: [{name, shape, unit?, currency?, phrase?, anchor?, until?, rule?}], count?: {min?, max?}}`. Since M10 am7 item 1
// the DRAFTER writes it (`close.cited`) and src/citedwords.js proves it at $0; `factsOfLook` is what the page look says a part must hold for a place (R2c).
//
// Throws away: a kept fact's alternative labels beyond the first (bareguard signs ONE anchor per fact); a place word R2a / R2b dropped (src/pageplace.js
// says why in its `trace`; the phrases left are ALL signed, R2c). The evidence offsets are bareguard's and are carried out for the Result tab's proof fold; no verdict is derived from them.
// Third outcomes, each named, never green: `stopped` (the rubric could not be built, or bareguard stopped), a source that is not the frozen text.

import { createHash } from 'node:crypto';
import { createRubric, checkStep } from 'bareguard';
import { plainWords } from './checkwords.js';
import { asList, FACT_OPS, boundOk, MAX_CURRENCIES, MAX_UNITS, MAX_UNIT_CHARS } from './pagebits.js';
import { ruleWords, moneyAs } from './pageask.js';
import { placeRuleProblem } from './placerule.js';

/** the shapes a fact may have (bareguard's value kinds, plus `phrase` = a presence decide) */
export const FACT_SHAPES = Object.freeze(['money', 'number', 'date', 'time', 'phrase', 'text']);
/** bareguard signs at most this many decides on one `cited` check */
export const MAX_FACTS = 10;
/** the step's own checkpoint id in the rubric */
const CHECKPOINT = 'cited';
export const CITED_ID = 'facts';

/** every field a fact part may carry, and every field a fact may carry */
// borrowed-from: bareloop src/facts.js@v0.60.0 (`asSeen`, F337: optional, written only by code at signing; absent on every older job)
const PART_FIELDS = Object.freeze(['source', 'facts', 'count', 'asSeen']);
// borrowed-from: bareloop src/facts.js@v0.56.0 (3383cce) (M16 am3 (3): the fields lang, decimal, place, aiProposal; FACT_LANGS, FACT_DECIMALS, moneyForms, factPartOf, factShapeReds, writtenSpans below; factDecides, factClaims, factSentence taken up to it)
const FACT_FIELDS = Object.freeze(['name', 'shape', 'unit', 'currency', 'phrase', 'anchor', 'until', 'rule', 'aiProposal', 'lang', 'decimal', 'place']);
const NAME_RE = /^[A-Za-z][A-Za-z _-]{0,63}$/;

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @param {string} t @returns {string} the sha256 of the text, hex */
export const sha256Text = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

/**
 * A money unit list with an entry listed twice, equal after the whitespace normalization bareguard's quote matcher applies (bareguard 0.26.0: its
 * rubric refuses such a list), keeps the first of them. The one place a unit list is built into a signed fact.
 * @param {string[]} units @returns {string[]}
 */
function unitsOnce(units) {
  const seen = new Set();
  return units.filter((u) => {
    const key = String(u).split('**').join('').split('__').join('').replace(/\s+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/**
 * A kept look fact as signed facts. The label that comes first becomes the anchor and the limit the look read (`reading`) becomes the number rule. A PLACE
 * fact (the look gave it `phrases`, src/pageplace.js: R2, R2a, R2b) becomes one phrase fact per phrase, because every one of them must be in the quote
 * (R2c); the old choice, the first kept word, is gone (in 2 of 3 saved F71 drafts that word was on no result line, FINDINGS F72). A plain phrase fact
 * ("Nonstop") keeps its first word.
 * @param {any} k a fact from `lookFactOf` (src/pagelook.js) @returns {Record<string, any>[]}
 */
export function factsOfLook(k) {
  if (k.shape === 'phrase' || k.shape === 'place') {
    const phrases = Array.isArray(k.phrases) ? k.phrases : [k.phrase ?? k.words?.[0] ?? ''];
    return phrases.map((/** @type {unknown} */ p, /** @type {number} */ i) => ({ name: phrases.length > 1 ? `${k.name} ${String.fromCharCode(97 + i)}` : String(k.name), shape: 'phrase', phrase: String(p) }));
  }
  /** @type {Record<string, any>} */
  const f = { name: String(k.name), shape: k.shape };
  const anchor = k.labels?.[0] ?? k.label ?? k.words?.[0];
  if (anchor !== undefined) f.anchor = String(anchor);
  if (f.shape === 'money') {
    if (k.unit !== undefined) f.unit = unitsOnce(k.unit);
    if (k.currency !== undefined) f.currency = [...k.currency];
  }
  if (isRec(k.reading)) f.rule = { ...k.reading };
  return [f];
}

/**
 * What a fact part may carry, as reds the caller can show before anything is signed or run. Whether bareguard can SIGN the rubric it builds is asked of
 * bareguard itself (`buildCitedSpec` + createRubric); this covers the fields the part owns.
 * @param {any} part @returns {string[]}
 */
export function factPartReds(part) {
  /** @type {string[]} */
  const reds = [];
  if (!isRec(part) || typeof part.source !== 'string' || part.source.trim() === '') return ['a fact part needs the role of the input its quotes come from'];
  if (!Array.isArray(part.facts) || part.facts.length === 0 || part.facts.length > MAX_FACTS) return [`a fact part needs 1 to ${MAX_FACTS} facts${Array.isArray(part.facts) && part.facts.length > MAX_FACTS ? ` (it has ${part.facts.length}; a place counts one fact for each phrase it needs, so a line with many places or many rules is too much for one check)` : ''}`];
  if (Object.hasOwn(part, 'asSeen') && !asSeenOk(part.asSeen)) reds.push('a fact part\'s asSeen is {input, lines: [..], labels: [..]}');
  for (const k of Object.keys(part)) if (!PART_FIELDS.includes(k)) reds.push(`a fact part has no field "${k}" - its fields are ${PART_FIELDS.join(', ')}`);
  const seen = new Set();
  part.facts.forEach((/** @type {any} */ f, /** @type {number} */ j) => {
    const w = `fact ${j + 1}`;
    if (!isRec(f) || typeof f.name !== 'string' || f.name.trim() === '') { reds.push(`${w}: needs a name`); return; }
    for (const k of Object.keys(f)) if (!FACT_FIELDS.includes(k)) reds.push(`${w} "${f.name}": "${k}" is not a field of a fact - its fields are ${FACT_FIELDS.join(', ')}`);
    // the name is in the claim text bareguard scans for numbers: letters only, so no digit can red the claim
    if (!NAME_RE.test(f.name)) reds.push(`${w} "${f.name}": a fact's name is letters, spaces, "_" or "-" only (no digits), at most 64 characters`);
    if (seen.has(f.name)) reds.push(`${w}: the name "${f.name}" is used twice`);
    seen.add(f.name);
    if (!FACT_SHAPES.includes(f.shape)) { reds.push(`${w} "${f.name}": the shape is not one of ${FACT_SHAPES.join(', ')}`); return; }
    if (f.shape === 'phrase' && (typeof f.phrase !== 'string' || f.phrase === '')) reds.push(`${w} "${f.name}": a phrase fact needs its words`);
    if (f.shape === 'money' && asList(f.unit).length + asList(f.currency).length === 0) reds.push(`${w} "${f.name}": money needs a unit or a currency`);
    if (f.shape !== 'money' && (f.unit !== undefined || f.currency !== undefined)) reds.push(`${w} "${f.name}": only money has a unit or a currency`);
    if (f.shape === 'phrase') for (const k of ['anchor', 'until', 'rule']) if (f[k] !== undefined) reds.push(`${w} "${f.name}": a phrase is fixed words the quote must contain; it has no ${k}`);
    if (f.shape !== 'phrase' && f.phrase !== undefined) reds.push(`${w} "${f.name}": only a phrase fact carries phrase`);
    // the four fields of bareloop v0.56.0 (M16 am3 (3)); each is checked only when present, so a fact without them is judged exactly as before
    if (f.lang !== undefined && (f.shape !== 'date' || typeof f.lang !== 'string' || !Object.hasOwn(FACT_LANGS, f.lang))) reds.push(`${w} "${f.name}": lang is for a date fact, one of ${Object.keys(FACT_LANGS).join(', ')}`);
    if (f.decimal !== undefined && ((f.shape !== 'number' && f.shape !== 'money') || !FACT_DECIMALS.includes(f.decimal))) reds.push(`${w} "${f.name}": decimal is for a number or money fact, "." or ","`);
    if (f.place !== undefined) { const bad = f.shape === 'phrase' ? placeRuleProblem(f.place) : 'only a phrase fact carries a place rule'; if (bad !== null) reds.push(`${w} "${f.name}": ${bad}`); }
    if (f.aiProposal !== undefined && typeof f.aiProposal !== 'boolean') reds.push(`${w} "${f.name}": aiProposal is true or false`);
    if (f.until !== undefined && (f.anchor === undefined || f.shape !== 'text')) reds.push(`${w} "${f.name}": until closes a text fact that has an anchor, and nothing else`);
    if (asList(f.currency).length > MAX_CURRENCIES) reds.push(`${w} "${f.name}": at most ${MAX_CURRENCIES} currencies`);
    if (asList(f.unit).length > MAX_UNITS || asList(f.unit).some((u) => u.length > MAX_UNIT_CHARS)) reds.push(`${w} "${f.name}": at most ${MAX_UNITS} units of ${MAX_UNIT_CHARS} characters`);
    if (f.rule !== undefined) {
      const r = f.rule;
      const ok = f.shape !== 'phrase' && f.shape !== 'text' && isRec(r) && FACT_OPS.includes(r.op)
        && (r.op === 'between' ? boundOk(f.shape, r.lo) && boundOk(f.shape, r.hi) : boundOk(f.shape, r.value));
      if (!ok) reds.push(`${w} "${f.name}": the rule is not under / over / between with a bound of the fact's kind`);
    }
  });
  const c = part.count;
  if (c !== undefined) {
    const ok = isRec(c) && Object.keys(c).every((k) => k === 'min' || k === 'max') && (c.min !== undefined || c.max !== undefined)
      && ['min', 'max'].every((k) => c[k] === undefined || (Number.isInteger(c[k]) && c[k] >= 1)) && (c.min === undefined || c.max === undefined || c.min <= c.max);
    if (!ok) reds.push('the result count is {min, max}: whole numbers, 1 or more, min no more than max');
  }
  return reds;
}

/**
 * bareguard's `decides` list for a fact part: one decide per fact, in the fact order (so `d<j>` is the fact's own index).
 * @param {any} part @returns {Record<string, any>[]}
 */
export function factDecides(part) {
  return part.facts.map((/** @type {any} */ f) => {
    if (f.shape === 'phrase') return { phrases: [f.phrase] };
    /** @type {Record<string, any>} */
    const d = { valueKind: f.shape };
    if (f.shape === 'money') { if (f.unit !== undefined) d.unit = f.unit; if (f.currency !== undefined) d.currency = f.currency; }
    if (f.anchor !== undefined) d.anchor = f.anchor;
    if (f.lang !== undefined) d.lang = f.lang;
    if (f.decimal !== undefined) d.decimal = f.decimal;
    if (f.until !== undefined) d.until = f.until;
    if (f.rule) {
      d.op = f.rule.op;
      if (f.rule.op === 'between') { d.lo = f.rule.lo; d.hi = f.rule.hi; } else d.value = f.rule.value;
    }
    return d;
  });
}

/**
 * The claims bareguard reads, built from the step's `results`. The claim TEXT is written here from the values the step gave (`name: value; name: value`),
 * a phrase fact contributes its own signed words. A result that is not an object, or has no string quote, still becomes a claim (an empty one) so
 * bareguard reds it by name rather than the result vanishing.
 * `asWritten` (bareloop v0.56.0): per result, per fact index, the value as the page writes it, for the claim's words of a date or amount a page form signs.
 * @param {any} part @param {unknown} results @param {(Record<number, string>|undefined)[]} [asWritten] @returns {{claim: string, quote: string, values?: Record<string, string>}[]}
 */
export function factClaims(part, results, asWritten = []) {
  const list = Array.isArray(results) ? results : [];
  return list.map((/** @type {any} */ r, /** @type {number} */ i) => {
    const given = isRec(r) && isRec(r.values) ? r.values : null;
    /** @type {Record<string, any>} */
    const values = {};
    /** @type {string[]} */
    const said = [];
    part.facts.forEach((/** @type {any} */ f, /** @type {number} */ j) => {
      if (f.shape === 'phrase') { said.push(`${f.name}: ${f.phrase}`); return; }
      const v = given && Object.hasOwn(given, f.name) ? given[f.name] : undefined;
      // a JSON number is the value as written ("389"): converted, never repaired; anything else is left for bareguard to red
      const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
      if (typeof s === 'string') { values[`d${j}`] = s; said.push(`${f.name}: ${asWritten[i]?.[j] ?? s}`); } else if (s !== undefined) values[`d${j}`] = s;
    });
    return { claim: said.join('; '), quote: isRec(r) && typeof r.quote === 'string' ? r.quote : '', values };
  });
}

/**
 * The rubric spec for one fact part: ONE `cited` check (the quote is in the frozen input, every value is in the quote and meets its rule), then the count
 * as a min and a max on the harness-set count of results.
 * @param {any} part @param {string} sha256 the frozen text's sha256 @returns {Record<string, any>}
 */
export function buildCitedSpec(part, sha256) {
  /** @type {Record<string, any>[]} */
  const checks = [{ id: CITED_ID, rule: 'cited', claims: 'claims', source: part.source, decides: factDecides(part) }];
  if (part.count?.min !== undefined) checks.push({ id: 'count-min', rule: 'min', field: 'count', value: part.count.min });
  if (part.count?.max !== undefined) checks.push({ id: 'count-max', rule: 'max', field: 'count', value: part.count.max });
  return { schema: 1, goal: `facts from ${part.source}`, inputs: [{ name: part.source, sha256 }], checkpoints: { [CHECKPOINT]: { gating: true, checks } } };
}

/**
 * One fact as a plain row, written by code from the signed fields: `fact · price — money in US dollars, under 150 US dollars, after "From", quoted from "flights"`.
 * @param {any} f @param {string} source @returns {string}
 */
export function factSentence(f, source) {
  // PLACE RULES (v0.56.0): a check that reads WHERE the newest value sits, not what it is; the phrase shown is the signed drafting example
  if (f.shape === 'phrase' && isRec(f.place)) return `${f.place.kind === 'headingDateAfter' ? 'date' : 'version'} in the newest "${f.place.prefix}" heading (last read ${f.phrase})`;
  /** @type {string[]} */
  const bits = [];
  if (f.shape === 'phrase') bits.push('phrase', `must say "${f.phrase}"`);
  else {
    bits.push(f.shape === 'money' ? `money in ${moneyForms(f).join(' or ')}` : f.shape);
    if (f.lang !== undefined) bits.push(`month names in ${FACT_LANGS[/** @type {keyof typeof FACT_LANGS} */ (f.lang)] ?? f.lang}`);
    if (f.decimal === ',') bits.push('decimal comma');
    if (f.rule) bits.push(ruleWords(f));
    else if (f.anchor === undefined) bits.push('as the quote writes it');
    if (f.anchor !== undefined) bits.push(f.until !== undefined ? `the words after "${f.anchor}" up to "${f.until}"` : `after "${f.anchor}"`);
  }
  bits.push(`quoted from "${source}"`);
  return `fact · ${f.name} — ${bits.join(', ')}${f.aiProposal ? ' — AI\'s proposal — check it' : ''}`;
}

/** the languages whose month names bareguard 0.27 reads on a `date` fact (its `lang`), each with the name a person reads; absent `lang` = ISO YYYY-MM-DD only */
export const FACT_LANGS = Object.freeze({ en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch' });

/** the decimal marks a number or money fact may sign (bareguard 0.27 `decimal`); absent = "." */
export const FACT_DECIMALS = Object.freeze(['.', ',']);

/** @param {unknown} a @returns {boolean} the shape of `asSeen`: {input, lines: [string..], labels: [string..]}, nothing else */
const asSeenOk = (/** @type {any} */ a) => {
  const strs = (/** @type {unknown} */ v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
  return isRec(a) && typeof a.input === 'string' && a.input.trim() !== '' && strs(a.lines) && strs(a.labels) && Object.keys(a).every((k) => ['input', 'lines', 'labels'].includes(k));
};

/** every field a part of class `fact` may carry (the shared ones are checked by rubricStepShapeReds) */
export const FACT_PART_FIELDS = PART_FIELDS;

const CURRENCY_SIGNS = ['$', '€', '£'];

/** @param {any} f a money fact @returns {string[]} every form the page writes the amount in: the units first (as R1L reads them), then the currency signs */
export const moneyForms = (f) => [...asList(f.unit), ...asList(f.currency)];

/** @param {unknown} v @returns {v is string} */
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** the `fact` part of a step's parameters, or null (a step has at most one) @param {any} params @returns {any|null} */
export function factPartOf(params) {
  const parts = Array.isArray(params?.parts) ? params.parts : [];
  return parts.find((/** @type {any} */ p) => isRec(p) && p.class === 'fact') ?? null;
}

/**
 * The SHAPE of a `fact` part (what it may carry), pushed as reds in the same form `rubricStepShapeReds` uses. Whether the
 * bareguard rubric it builds is signable is asked of bareguard itself (`checkRubricParts` builds it once at drafting).
 * @param {any} part @param {string} w the path prefix @param {(code: string, path: string, detail: string) => void} red
 */
export function factShapeReds(part, w, red) {
  for (const k of Object.keys(part)) {
    if (!['text', 'class', 'covers', 'rules', 'source', 'facts', 'count', 'asSeen'].includes(k)) {
      red('invalid-value', `${w}.${k}`, `"${k}" is not a field of a fact part — fields: text, class, covers, rules, ${FACT_PART_FIELDS.join(', ')}`);
    }
  }
  if (!(nonEmpty(part.source) && part.source.length <= 128)) red('invalid-value', `${w}.source`, 'the label of the input the quotes come from');
  // F337: the planner's "as seen" example, only ever written by code at signing (src/pagedry.js asSeenOf); optional, absent on every older spec
  if (Object.hasOwn(part, 'asSeen') && !asSeenOk(part.asSeen)) red('invalid-value', `${w}.asSeen`, 'the as-seen example: {input, lines: [..], labels: [..]}');
  if (!Array.isArray(part.facts) || part.facts.length === 0 || part.facts.length > MAX_FACTS) {
    red('invalid-value', `${w}.facts`, `a list of 1 to ${MAX_FACTS} facts {name, shape, ...}`);
  } else {
    /** @type {Set<string>} */
    const seen = new Set();
    part.facts.forEach((/** @type {any} */ f, /** @type {number} */ j) => {
      const fw = `${w}.facts[${j}]`;
      if (!isRec(f)) { red('invalid-value', fw, '{name, shape, ...}'); return; }
      for (const k of Object.keys(f)) {
        if (FACT_FIELDS.includes(k)) continue;
        // L4 (smv710w8c3wdh, 3 of 3 tries): "covers" / "rules" are fields of the PART, written once, never of a fact inside it
        red('invalid-value', `${fw}.${k}`, k === 'covers' || k === 'rules'
          ? `"${k}" is a field of the PART, not of a fact - write the numbers once on the fact part ("${k}": [..]) and take it off every fact. Fact fields: ${FACT_FIELDS.join(', ')}`
          : `"${k}" is not a field of a fact — fields: ${FACT_FIELDS.join(', ')}`);
      }
      if (!(typeof f.name === 'string' && NAME_RE.test(f.name))) red('invalid-value', `${fw}.name`, 'the fact\'s name: letters, spaces, "_" or "-" only (no digits), at most 64 characters');
      else if (seen.has(f.name)) red('invalid-value', `${fw}.name`, `the name "${f.name}" is used twice on this line`);
      else seen.add(f.name);
      if (!FACT_SHAPES.includes(f.shape)) { red('invalid-value', `${fw}.shape`, `one of ${FACT_SHAPES.join(' | ')}`); return; }
      if (Object.hasOwn(f, 'aiProposal') && typeof f.aiProposal !== 'boolean') red('invalid-value', `${fw}.aiProposal`, 'true when the AI turned the person\'s words into this number');
      const has = (/** @type {string} */ k) => Object.hasOwn(f, k);
      if (f.shape === 'money') {
        if (!has('unit') && !has('currency')) red('invalid-value', `${fw}.unit`, 'money names at least one of unit (words the input writes after the amount, e.g. "US dollars") or currency ("$", "€" or "£"); each may be one value or a list');
      } else if (has('unit') || has('currency')) red('invalid-value', `${fw}.${has('unit') ? 'unit' : 'currency'}`, 'only money has a unit or a currency');
      if (has('unit')) {
        const us = f.unit;
        if (Array.isArray(us) ? us.length === 0 || us.some((/** @type {unknown} */ u) => !nonEmpty(u)) : !nonEmpty(us)) red('invalid-value', `${fw}.unit`, 'a non-empty string copied from the input, or a non-empty list of them');
        else {
          const list = asList(us);
          if (list.length > MAX_UNITS) red('invalid-value', `${fw}.unit`, `at most ${MAX_UNITS} units (${list.length} given)`);
          else if (list.some((u) => u.length > MAX_UNIT_CHARS)) red('invalid-value', `${fw}.unit`, `a unit is at most ${MAX_UNIT_CHARS} characters`);
        }
      }
      if (has('currency')) {
        const cs = f.currency;
        if (Array.isArray(cs) ? cs.length === 0 || cs.some((/** @type {unknown} */ c) => !CURRENCY_SIGNS.includes(/** @type {string} */ (c))) : !CURRENCY_SIGNS.includes(cs)) red('invalid-value', `${fw}.currency`, 'one of $ | € | £, or a list of them');
        else {
          const list = asList(cs);
          if (list.length > MAX_CURRENCIES) red('invalid-value', `${fw}.currency`, `at most ${MAX_CURRENCIES} currencies (${list.length} given)`);
          else if (new Set(list).size !== list.length) red('invalid-value', `${fw}.currency`, 'the currencies are not repeated');
        }
      }
      if (has('lang')) {
        if (f.shape !== 'date') red('invalid-value', `${fw}.lang`, 'only a date fact carries lang (the language the page writes its month names in); leave it out for a date written 2026-10-26');
        else if (typeof f.lang !== 'string' || !Object.hasOwn(FACT_LANGS, f.lang)) red('invalid-value', `${fw}.lang`, `one of ${Object.keys(FACT_LANGS).join(' | ')}`);
      }
      if (has('decimal')) {
        if (f.shape !== 'number' && f.shape !== 'money') red('invalid-value', `${fw}.decimal`, 'only a number or money fact carries decimal (the mark the page writes before the decimals)');
        else if (!FACT_DECIMALS.includes(f.decimal)) red('invalid-value', `${fw}.decimal`, 'one of "." | ","');
      }
      if (f.shape === 'phrase') {
        if (!nonEmpty(f.phrase)) red('invalid-value', `${fw}.phrase`, 'the fixed words the quote must contain, copied from the input');
        for (const k of ['anchor', 'until', 'rule']) if (has(k)) red('invalid-value', `${fw}.${k}`, 'a phrase is fixed words the quote must contain; it has no anchor, until or rule');
      } else if (has('phrase')) red('invalid-value', `${fw}.phrase`, 'only a phrase fact carries phrase');
      if (has('place')) {
        const bad = f.shape === 'phrase' ? placeRuleProblem(f.place) : 'only a phrase fact carries a place rule';
        if (bad !== null) red('invalid-value', `${fw}.place`, bad);
      }
      if (has('anchor') && !nonEmpty(f.anchor)) red('invalid-value', `${fw}.anchor`, 'a label copied VERBATIM from the input');
      if (has('until') && !nonEmpty(f.until)) red('invalid-value', `${fw}.until`, 'a label copied VERBATIM from the input');
      if (has('until') && !has('anchor') && f.shape !== 'phrase') red('invalid-value', `${fw}.until`, 'until needs an anchor');
      if (has('until') && f.shape !== 'text' && f.shape !== 'phrase') red('invalid-value', `${fw}.until`, 'until closes a text fact only');
      if (has('rule') && f.shape !== 'phrase') {
        const r = f.rule;
        if (f.shape === 'text') red('invalid-value', `${fw}.rule`, 'a text fact is bind only: it has no rule');
        else if (!isRec(r) || !FACT_OPS.includes(r.op)) red('invalid-value', `${fw}.rule`, `{op: ${FACT_OPS.join(' | ')}, value} or {op: "between", lo, hi}`);
        else if (r.op === 'between' ? !(boundOk(f.shape, r.lo) && boundOk(f.shape, r.hi) && !Object.hasOwn(r, 'value')) : !(boundOk(f.shape, r.value) && !Object.hasOwn(r, 'lo') && !Object.hasOwn(r, 'hi'))) {
          red('invalid-value', `${fw}.rule`, r.op === 'between' ? 'between needs lo and hi (numbers for number/money, strings for date/time) and no value' : 'a comparison needs value (a number for number/money, a string for date/time)');
        }
      }
    });
  }
  if (Object.hasOwn(part, 'count')) {
    const c = part.count;
    const ok = isRec(c) && Object.keys(c).every((k) => k === 'min' || k === 'max') && (Object.hasOwn(c, 'min') || Object.hasOwn(c, 'max'))
      && ['min', 'max'].every((k) => !Object.hasOwn(c, k) || (Number.isInteger(c[k]) && c[k] >= 1))
      && (!Object.hasOwn(c, 'min') || !Object.hasOwn(c, 'max') || c.min <= c.max);
    if (!ok) red('invalid-value', `${w}.count`, '{min?, max?} — how many results the person asked for (integers, 1 or more, min no more than max)');
  }
}

/**
 * Where bareguard read each page-form fact's value inside each quote, as the quote spells it: from `checkStep`'s `full.evidence` (one entry per
 * claim: `text` = the normalized quote the decides ran on, `spans` = where each decide read its anchor, value and unit/currency). Only a fact that
 * signs `lang` or `decimal` is looked up; the span is the decide's `value` span (the one equal to the claim's own value when bareguard flags it).
 * @param {any} part @param {any[]|undefined} evidence @returns {(Record<number, string>|undefined)[]} per claim index
 */
export function writtenSpans(part, evidence) {
  /** @type {(Record<number, string>|undefined)[]} */
  const out = [];
  for (const e of Array.isArray(evidence) ? evidence : []) {
    if (!isRec(e) || !Number.isInteger(e.claim) || typeof e.text !== 'string' || !Array.isArray(e.spans)) continue;
    /** @type {Record<number, string>} */
    const row = {};
    part.facts.forEach((/** @type {any} */ f, /** @type {number} */ j) => {
      if (f.lang === undefined && f.decimal === undefined) return;
      const mine = e.spans.filter((/** @type {any} */ sp) => isRec(sp) && sp.decide === j && sp.role === 'value' && Number.isInteger(sp.start) && Number.isInteger(sp.end));
      const sp = mine.find((/** @type {any} */ x) => x.matched === true) ?? mine[0];
      if (sp) row[j] = e.text.slice(sp.start, sp.end);
    });
    if (Object.keys(row).length) out[e.claim] = row;
  }
  return out;
}


/** @param {any} part @returns {string|null} the "N results" row of a fact part */
export function countSentence(part) {
  const c = isRec(part.count) ? part.count : null;
  if (!c) return null;
  const n = (/** @type {number} */ v) => `${v} result${v === 1 ? '' : 's'}`;
  if (c.min !== undefined && c.max !== undefined) return c.min === c.max ? `fact · results — exactly ${n(c.min)}, each quoted from "${part.source}"` : `fact · results — ${c.min} to ${c.max} results, each quoted from "${part.source}"`;
  return c.min !== undefined ? `fact · results — at least ${n(c.min)}, each quoted from "${part.source}"` : `fact · results — at most ${n(c.max)}, each quoted from "${part.source}"`;
}

/**
 * One fact as the STEP is told it: what to write for it and where in the quote it sits, in plain words, from the signed fields. A phrase fact has no value to
 * write - the quote has to say it. (bareloop's factBrief.)
 * @param {any} f @returns {string}
 */
export function factBrief(f) {
  if (f.shape === 'phrase') return `${f.name} - no value to write; the quote you copy must say "${f.phrase}"`;
  /** @type {string[]} */
  const bits = [f.shape === 'money' ? `an amount in ${[...asList(f.unit), ...asList(f.currency)].join(' or ')}` : f.shape === 'text' ? 'words' : `a ${f.shape}`];
  if (f.anchor !== undefined) bits.push(f.until !== undefined ? `the words right after "${f.anchor}" up to "${f.until}"` : `right after "${f.anchor}"`);
  if (f.rule) bits.push(`must be ${ruleWords(f)}`);
  return `${f.name} - ${bits.join(', ')}`;
}

/**
 * How a step that quotes a saved page is told to answer: the form of its answer and the facts each result must hold (typed fields in, plain words out).
 * The step is never told a verdict or a way around the check; it is told what to copy and what to write.
 * @param {any} part @returns {{answer: string, eachResultHolds: string[], howMany: string|null}}
 */
export function citedBrief(part) {
  const c = isRec(part.count) ? part.count : null;
  const n = (/** @type {number} */ v) => `${v} result${v === 1 ? '' : 's'}`;
  const howMany = c === null ? null : c.min !== undefined && c.max !== undefined ? (c.min === c.max ? `Give exactly ${n(c.min)}.` : `Give ${c.min} to ${c.max} results.`) : c.min !== undefined ? `Give at least ${n(c.min)}.` : `Give at most ${n(c.max)}.`;
  const money = Array.isArray(part.facts) && part.facts.some((/** @type {any} */ f) => f.shape === 'money');
  return {
    answer: `Answer with "results": one entry per thing you found, each {"quote": <the words of that one result, copied word for word from the input "${part.source}">, "values": {<fact name>: <the value, written exactly as the quote writes it>}}. A quote that is not in the input word for word is refused.${money ? ` A money value is only the digits of the amount ("30", not "30 US dollars" and not "$30").` : ''}`,
    eachResultHolds: part.facts.map(factBrief),
    howMany,
  };
}

/**
 * M10 am28: what a page-quoting step is told about the picks (am22) on its line, one plain line per pick, the values and what counts, never a verdict and never
 * another guardrail. A list item is what bareguard's listItems counts: its own line starting with "1." or "- " followed by a space and its text.
 * @param {any[]} picked @returns {string[]}
 */
export function toldPicks(picked) {
  return picked.map((c) => {
    if (c.rule === 'listItems') return `Your "text" must have exactly ${c.value} list items; a list item is its own line starting with "1." or "- " followed by a space and its text.`;
    if (c.rule === 'nonEmpty') return 'Your "text" must not be empty.';
    return `Your "text" must have ${plainWords(c)}.`;
  });
}

/**
 * Every plan-card row a fact part carries: its facts, then its count (bareloop's factRows).
 * @param {any} part @returns {string[]}
 */
export function factRows(part) {
  const rows = (Array.isArray(part.facts) ? part.facts : []).map((/** @type {any} */ f) => factSentence(f, part.source));
  const c = countSentence(part);
  return [...rows, ...(c ? [c] : [])];
}

/**
 * One bareguard `cited` item (`#<result>:d<j>:<reason>[:<detail>]`, or `#<result>:<reason>`) as a sentence. The names and numbers are bareguard's
 * measurements and the signed facts, never inferred here.
 * @param {string} item @param {any} part @returns {string}
 */
export function plainFactItem(item, part) {
  const m = /^#(\d+):(?:d(\d+):)?([a-z-]+)(?::([\s\S]*))?$/.exec(item);
  if (!m) return item;
  const at = `result ${Number(m[1]) + 1}`;
  const f = m[2] !== undefined && Array.isArray(part.facts) ? part.facts[Number(m[2])] : null;
  const who = f ? `${at}, fact "${f.name}"` : at;
  const detail = m[4] ?? '';
  const say = (/** @type {string} */ s) => `${who}: ${s}`;
  switch (m[3]) {
    case 'quote-not-found': return `${at}: the quote is not found word for word in "${part.source}"`;
    case 'empty-quote': return `${at}: the quote is empty — copy the words from "${part.source}" that hold the facts`;
    case 'quote-too-long': return `${at}: the quote is too long — copy only that one result's own words, not more`;
    case 'numbers': return `${at}: the number ${detail} is not in the quote the way the value writes it — write each value as the quote writes it (for example "9:27 AM", not "09:27")`;
    case 'value-over': case 'value-under': return say(`the value in the quote is ${m[3] === 'value-over' ? 'above' : 'below'} what the rule allows${f && f.rule ? ` (${ruleWords(f)})` : ''}`);
    case 'value-none': return say(`the quote holds no ${f ? f.shape : 'value'}${f && f.anchor !== undefined ? ` after "${f.anchor}"` : ''}`);
    case 'value-many': return say(`the quote holds more than one ${f ? f.shape : 'value'} — quote only the words that hold this one`);
    case 'value-malformed': return say(`a ${f ? f.shape : 'value'} in the quote is not written in a form the check can read`);
    case 'anchor-missing': return say(`the label "${f ? f.anchor : ''}" is not in the quote`);
    case 'anchor-ambiguous': return say(`the label "${f ? f.anchor : ''}" is in the quote more than once`);
    case 'until-missing': return say(`"${f ? f.until : ''}" does not follow the label "${f ? f.anchor : ''}" in the quote`);
    case 'phrase-missing': return say(`the quote does not say "${detail}"`);
    case 'claim-value-missing': return say('no value was given in "values"');
    case 'claim-value-malformed': return say(`the value is not written as a value of this kind${f && f.shape === 'money' ? ' - write only the digits of the amount (for example 30), no unit or sign' : ''}`);
    case 'claim-value-absent': return say('the value is not in the quote as a whole word');
    case 'claim-value-unknown': return say('this value is not one of the signed facts');
    case 'claim-value-mismatch': return say(`the value is not what the quote holds (${detail.replace('!=', ' is not ')})`);
    default: return `${who}: ${m[3]}${detail ? ` ${detail}` : ''}`;
  }
}

/** @param {any} g a bareguard gap @param {any} part @returns {string[]} one sentence per thing wrong */
function plainGap(g, part) {
  if (g.check === 'cited') {
    if (g.kind === 'missing' || g.kind === 'no-claims') return [`the step has no results — add one result per thing you found: {"quote": ..., "values": {...}}`];
    if (g.kind === 'unsupported') return (g.items ?? []).map((/** @type {string} */ it) => plainFactItem(it, part));
    if (g.kind === 'too-many') return [`the results hold too many different quotes to check (${g.measured} against a limit of ${g.limit})`];
    return [`the results cannot be checked (${g.kind})`];
  }
  if (g.check === 'min' || g.check === 'max') {
    return [g.check === 'min' ? `${g.measured ?? 0} result(s) are listed, at least ${g.limit} are required` : `${g.measured} results are listed, at most ${g.limit} are allowed`];
  }
  return [`${g.check ?? 'check'}: ${g.kind ?? 'failed'}`];
}

/**
 * Check one step's results against a fact part and the frozen text they must be quoted from.
 * `text` is the run's OWN frozen copy of the source (the caller reads it from the run's folder; this function never reads a file). Its sha256 is taken
 * here and signed into the rubric, so bareguard compares the text it is handed with the text the rubric was built for.
 * @param {{part: any, text: string, results: unknown}} o
 * @returns {Promise<{verdict: 'green'|'red'|'stopped', gapLines: string[], fault: string|null, sha256: string, claims: any[], evidence: any[]}>}
 */
export async function checkCited({ part, text, results }) {
  const sha256 = sha256Text(text);
  const none = { claims: /** @type {any[]} */ ([]), evidence: /** @type {any[]} */ ([]), sha256 };
  const reds = factPartReds(part);
  if (reds.length) return { verdict: 'stopped', gapLines: [], fault: `the facts to check are not valid: ${reds[0]}`, ...none };
  let rubric;
  try { rubric = createRubric(buildCitedSpec(part, sha256)); } catch (e) {
    return { verdict: 'stopped', gapLines: [], fault: `the check could not be built: ${/** @type {Error} */ (e).message}`, ...none };
  }
  let claims = factClaims(part, results);
  // `count` is set HERE from the list itself: the step never writes a number the check trusts
  let r = await checkStep(rubric, CHECKPOINT, { count: claims.length, claims }, { inputs: { [part.source]: text } });
  // borrowed-from: bareloop src/rubricstep.js@v0.61.0
  if (Array.isArray(part.facts) && part.facts.some((/** @type {any} */ f) => isRec(f) && (f.lang !== undefined || f.decimal !== undefined))) {
    const written = writtenSpans(part, r.full.evidence);
    if (written.some(Boolean)) {
      claims = factClaims(part, results, written);
      r = await checkStep(rubric, CHECKPOINT, { count: claims.length, claims }, { inputs: { [part.source]: text } });
    }
  }
  if (r.verdict === 'stopped') return { verdict: 'stopped', gapLines: [], fault: r.fault ? `${r.fault.kind}: ${r.fault.detail}` : 'the check stopped', ...none, claims };
  const evidence = Array.isArray(r.full?.evidence) ? r.full.evidence : [];
  if (r.verdict === 'green') return { verdict: 'green', gapLines: [], fault: null, sha256, claims, evidence };
  return { verdict: 'red', gapLines: r.full.gaps.flatMap((/** @type {any} */ g) => plainGap(g, part)), fault: null, sha256, claims, evidence };
}
