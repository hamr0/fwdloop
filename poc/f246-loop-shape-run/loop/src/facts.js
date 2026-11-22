// borrowed-from: bareloop src/facts.js@v0.61.0 (fc56e1f3)
// PART 1b (docs/product/ITEM33-BUILD.md, "Addendum 2026-10-13 — Part 1b: required facts"): the FACT step.
//
// A job line the person phrased as "find / list / look up" leaves behind a step file that holds ONLY filled facts:
//
//     { "results": [ { "quote": "<words copied from the input>", "values": { "<fact name>": "<value as the quote writes it>" } } ] }
//
// What each result must hold is the signed list of REQUIRED FACTS on the line's `fact` part (name, shape, rule, source
// input). The check is bareguard's `cited` + `decides`, built here by code from the signed part: the quote is really in the
// frozen input, every value really is in the quote (compared exactly by shape), every value meets its rule. No model is in
// the check. The claim TEXT that bareguard's number scan reads is written by code from the values, never by the worker.

import { rubricVocabulary } from 'bareguard';
import { placeRuleProblem } from './placerule.js';

/** the shapes a fact may have (bareguard's value kinds, plus `phrase` = a presence decide) */
export const FACT_SHAPES = Object.freeze(['money', 'number', 'date', 'time', 'phrase', 'text']);
/** the comparison ops a rule may use (bareguard's) */
export const FACT_OPS = Object.freeze(['lt', 'lte', 'gt', 'gte', 'between']);
/** bareguard signs at most this many decides on one `cited` check */
export const MAX_FACTS = 10;
/** every field a fact may carry */
const FACT_FIELDS = Object.freeze(['name', 'shape', 'unit', 'currency', 'phrase', 'anchor', 'until', 'rule', 'aiProposal', 'lang', 'decimal', 'place']);
/** the languages whose month names bareguard 0.27 reads on a `date` fact (its `lang`), each with the name a person reads; absent `lang` = ISO YYYY-MM-DD only */
export const FACT_LANGS = Object.freeze({ en: 'English', de: 'German', fr: 'French', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch' });
/** the decimal marks a number or money fact may sign (bareguard 0.27 `decimal`); absent = "." */
export const FACT_DECIMALS = Object.freeze(['.', ',']);
/** every field a part of class `fact` may carry (the shared ones are checked by rubricStepShapeReds) */
export const FACT_PART_FIELDS = Object.freeze(['source', 'facts', 'count', 'asSeen']);
/** a fact's name appears in the claim text bareguard scans for numbers, so it carries letters only (no digit can red the claim) */
const NAME_RE = /^[A-Za-z][A-Za-z _-]{0,63}$/;

/** the limits bareguard 0.24 puts on a money fact's lists (ruling #65), enforced here first so the red is ours and plain */
export const MAX_CURRENCIES = 3;
export const MAX_UNITS = 10;
export const MAX_UNIT_CHARS = 100;
const CURRENCY_SIGNS = ['$', '€', '£'];

/**
 * A money fact's `unit` / `currency` is ONE string (every spec signed before lists) or a non-empty list of them; a string is read exactly as a
 * one-element list. Nothing is rewritten, so an old spec's bytes and hash stay as they were.
 * @param {unknown} v @returns {string[]}
 */
export const asList = (v) => (Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? [v] : []));

/** @param {any} f a money fact @returns {string[]} every form the page writes the amount in: the units first (as R1L reads them), then the currency signs */
export const moneyForms = (f) => [...asList(f.unit), ...asList(f.currency)];

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** @param {unknown} v @returns {v is string} */
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** the `fact` part of a step's parameters, or null (a step has at most one) @param {any} params @returns {any|null} */
export function factPartOf(params) {
  const parts = Array.isArray(params?.parts) ? params.parts : [];
  return parts.find((/** @type {any} */ p) => isRec(p) && p.class === 'fact') ?? null;
}

/** @param {any} v @returns {boolean} a rule bound has the type its shape needs: a number for number/money, a string for date/time */
export const boundOk = (/** @type {string} */ shape, /** @type {unknown} */ v) => (shape === 'number' || shape === 'money' ? typeof v === 'number' && Number.isFinite(v) : typeof v === 'string' && v !== '');

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
  if (Object.hasOwn(part, 'asSeen')) {
    const a = part.asSeen;
    const strs = (/** @type {unknown} */ v) => Array.isArray(v) && v.length > 0 && v.every((x) => typeof x === 'string');
    if (!(isRec(a) && nonEmpty(a.input) && strs(a.lines) && strs(a.labels) && Object.keys(a).every((k) => ['input', 'lines', 'labels'].includes(k)))) {
      red('invalid-value', `${w}.asSeen`, 'the as-seen example: {input, lines: [..], labels: [..]}');
    }
  }
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
 * The claims bareguard reads for a fact step, built from the step file's `results`. The claim TEXT is written here, by code,
 * from the values the worker gave (the worker writes no claim text): `name: value; name: value`. A phrase fact contributes its
 * own signed words. A result that is not an object, or has no string quote, still becomes a claim — an empty one — so
 * bareguard reds it by name rather than the result vanishing.
 *
 * A fact that signs a page form (`lang` or `decimal`) carries a CANONICAL value ("2026-10-26", "1057.65": bareguard's typed binding, `values.d<j>`),
 * but bareguard's number scan compares the claim TEXT with the quote's own digits, so the text must spell the value the way the quote does
 * ("26 October 2026", "1.057,65"). That spelling is `asWritten[result][fact index]`: the value span bareguard itself reported for that quote
 * ({@link writtenSpans}); a fact with no span there reads the value the worker gave.
 * @param {any} part @param {unknown} results @param {(Record<number, string>|undefined)[]} [asWritten]
 * @returns {{claim: string, quote: string, values?: Record<string, string>}[]}
 */
export function factClaims(part, results, asWritten = []) {
  const list = Array.isArray(results) ? results : [];
  return list.map((/** @type {any} */ r, /** @type {number} */ i) => {
    const given = isRec(r) && isRec(r.values) ? r.values : null;
    /** @type {Record<string, string>} */
    const values = {};
    /** @type {string[]} */
    const said = [];
    part.facts.forEach((/** @type {any} */ f, /** @type {number} */ j) => {
      if (f.shape === 'phrase') { said.push(`${f.name}: ${f.phrase}`); return; }
      const v = given && Object.hasOwn(given, f.name) ? given[f.name] : undefined;
      // a JSON number is the value as written ("389"): converted, never repaired; anything else is left for bareguard to red
      const s = typeof v === 'number' && Number.isFinite(v) ? String(v) : v;
      if (typeof s === 'string') { values[`d${j}`] = s; said.push(`${f.name}: ${asWritten[i]?.[j] ?? s}`); } else if (s !== undefined) { /** @type {any} */ (values)[`d${j}`] = s; }
    });
    return { claim: said.join('; '), quote: isRec(r) && typeof r.quote === 'string' ? r.quote : '', values };
  });
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

/** @param {unknown} n @param {string} shape @param {any} f @returns {string} one bound, as the person would say it */
function sayBound(n, shape, f) {
  if (shape === 'money') return moneyAs(f, /** @type {string|number} */ (n), false);
  return String(n);
}

/**
 * One amount of a money fact in the fact's OWN signed forms, never a hardcoded sign: `symbolFirst` puts the currency sign before the amount
 * ("$144") when the fact has one, else the unit after it ("144 US dollars"); not `symbolFirst` (a rule's bound) prefers the unit.
 * @param {any} f a money fact @param {string|number} n @param {boolean} symbolFirst @returns {string}
 */
export function moneyAs(f, n, symbolFirst) {
  const cur = asList(f.currency)[0];
  const uni = asList(f.unit)[0];
  if (symbolFirst) return cur !== undefined ? `${cur}${n}` : `${n} ${uni}`;
  return uni !== undefined ? `${n} ${uni}` : `${cur}${n}`;
}

/** @param {any} f a fact with a rule @returns {string} the rule in words, e.g. "at most 450 US dollars" */
export function ruleWords(f) {
  const r = f.rule;
  return r.op === 'between' ? `between ${sayBound(r.lo, f.shape, f)} and ${sayBound(r.hi, f.shape, f)}`
    : `${{ lt: 'under', lte: 'at most', gt: 'over', gte: 'at least' }[/** @type {'lt'|'lte'|'gt'|'gte'} */ (r.op)]} ${sayBound(r.value, f.shape, f)}`;
}

/**
 * One fact as a plain row, written by code from the signed fields:
 * `fact · price — money, at most 450 US dollars, after "Price", quoted from "Flights"`.
 * @param {any} f @param {string} source
 * @returns {string}
 */
export function factSentence(f, source) {
  // PLACE RULES: a check that reads WHERE the newest value sits, not what it is; the phrase shown is the signed drafting example (the value a run read is in its Audit)
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

/**
 * One fact as the WORKER is told it (item 7): what to write for it and where in the quote it sits, in plain words, from the signed
 * fields. A phrase fact has no value to write — the quote has to say it.
 * @param {any} f @returns {string}
 */
export function factBrief(f) {
  if (f.shape === 'phrase') return `${f.name} — no value to write; the quote you copy must say "${f.phrase}"`;
  /** @type {string[]} */
  const bits = [f.shape === 'money' ? `an amount in ${moneyForms(f).join(' or ')}` : `a ${f.shape}`];
  if (f.shape === 'text') bits[0] = 'words';
  // a fact that signs a page form is read in that form, but the value the worker writes is canonical (bareguard's typed binding): say so
  if (f.lang !== undefined) bits.push(`write the date as YYYY-MM-DD (the quote writes it with ${FACT_LANGS[/** @type {keyof typeof FACT_LANGS} */ (f.lang)] ?? f.lang} month names)`);
  if (f.decimal === ',') bits.push('write the amount with a point before the decimals and no thousands marks, e.g. 1057.65 (the quote writes a comma before the decimals)');
  if (f.anchor !== undefined) bits.push(f.until !== undefined ? `the words right after "${f.anchor}" up to "${f.until}"` : `right after "${f.anchor}"`);
  if (f.rule) bits.push(`must be ${ruleWords(f)}`);
  return `${f.name} — ${bits.join(', ')}`;
}

/** the "N results" row of a fact part, or null @param {any} part @returns {string|null} */
export function countSentence(part) {
  const c = isRec(part.count) ? part.count : null;
  if (!c) return null;
  const n = (/** @type {number} */ v) => `${v} result${v === 1 ? '' : 's'}`;
  if (c.min !== undefined && c.max !== undefined) return c.min === c.max ? `fact · results — exactly ${n(c.min)}, each quoted from "${part.source}"` : `fact · results — ${c.min} to ${c.max} results, each quoted from "${part.source}"`;
  return c.min !== undefined ? `fact · results — at least ${n(c.min)}, each quoted from "${part.source}"` : `fact · results — at most ${n(c.max)}, each quoted from "${part.source}"`;
}

/**
 * Every plan-card row a fact part carries: its facts, then its count.
 * @param {any} part @returns {string[]}
 */
export function factRows(part) {
  const rows = (Array.isArray(part.facts) ? part.facts : []).map((/** @type {any} */ f) => factSentence(f, part.source));
  const c = countSentence(part);
  return [...rows, ...(c ? [c] : [])];
}

/**
 * One bareguard `cited` item (`#<result>:d<j>:<reason>[:<detail>]`, or `#<result>:<reason>`) as a sentence the worker can act
 * on. The names and numbers are bareguard's measurements and the person's signed facts, never inferred here.
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
    case 'claim-value-malformed': return say('the value is not written as a value of this kind');
    case 'claim-value-absent': return say('the value is not in the quote as a whole word');
    case 'claim-value-unknown': return say('this value is not one of the signed facts');
    case 'claim-value-mismatch': return say(`the value is not what the quote holds (${detail.replace('!=', ' is not ')})`);
    default: return `${who}: ${m[3]}${detail ? ` ${detail}` : ''}`;
  }
}

// ── which shape takes which fields (live fix B2) ─────────────────────────────────────────────────────────────────────────────
//
// The drafter put `until` on a money fact and `anchor`/`until`/`rule` on a phrase (smv6k6l8dxkzs). What a shape takes is bareguard's
// to say, so the table the drafter is shown is READ OFF `rubricVocabulary` (the `cited` rule's decide shapes and their stated
// conditions), never hand-typed. If bareguard's wording of a condition changes so that it cannot be read, this throws at load time
// and the test that pins it fails: a stale guide is never shown quietly.

/**
 * The fields each fact shape takes, in the fact part's own names (`rule` = bareguard's op/value/lo/hi; `unit`/`currency`; `phrase`
 * = the presence decide's phrases), read off bareguard's rubric vocabulary.
 * @returns {Record<string, string[]>} shape -> the fields it takes besides name and shape
 */
export function factShapeFields() {
  const decides = /** @type {any} */ (rubricVocabulary).rules?.cited?.fields?.decides?.shapes;
  const value = decides?.value;
  const presence = decides?.presence;
  const kinds = /** @type {string[]} */ (value?.fields?.valueKind?.enum);
  /** @type {string[]} */
  const conditions = value?.conditions ?? [];
  const find = (/** @type {RegExp} */ re) => {
    for (const c of conditions) { const m = re.exec(c); if (m) return m; }
    throw new Error(`bareguard's rubric vocabulary no longer states the condition ${re} — update src/facts.js factShapeFields`);
  };
  if (!Array.isArray(kinds) || !presence?.fields?.phrases) throw new Error('bareguard\'s rubric vocabulary has no cited decide shapes — update src/facts.js factShapeFields');
  const bindOnlyKind = find(/^valueKind (\w+) is bind-only: it refuses op, value, lo, hi, currency and unit/)[1];
  const untilKind = find(/^until is allowed only on a (\w+) decide that also signs an anchor/)[1];
  const moneyKind = find(/^(\w+) needs (?:exactly|at least) one of currency or unit/)[1];
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const k of kinds) {
    /** @type {string[]} */
    const f = [];
    if (k !== bindOnlyKind) f.push('rule');
    if (value.fields.anchor) f.push('anchor');
    if (k === untilKind) f.push('until');
    if (k === moneyKind) f.push('unit or currency');
    out[k] = f;
  }
  out.phrase = ['phrase'];
  return out;
}

/**
 * The lines the drafter is shown about which shape takes which fields, generated from {@link factShapeFields} (shapes with the same
 * fields are listed together). One owner: the composer brief and the confirm note both print this.
 * @returns {string}
 */
export function factShapeGuide() {
  const by = factShapeFields();
  /** @type {Map<string, string[]>} */
  const groups = new Map();
  for (const shape of FACT_SHAPES) {
    const key = (by[shape] ?? []).join(' | ');
    groups.set(key, [...(groups.get(key) ?? []), shape]);
  }
  const all = [...new Set(Object.values(by).flat())];
  const lines = [];
  for (const [key, shapes] of groups) {
    const takes = key === '' ? [] : key.split(' | ');
    const never = all.filter((f) => !takes.includes(f));
    lines.push(`${shapes.join(' / ')}: takes ${takes.length ? takes.join(', ') : 'no extra field'}${never.length ? `; never ${never.join(', ')}` : ''}`);
  }
  return lines.map((l) => ` - ${l}`).join('\n');
}
