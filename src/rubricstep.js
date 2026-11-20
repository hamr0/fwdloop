// borrowed-from: bareloop src/rubricstep.js@v0.56.0 (3383cce) (rubricStepShapeReds, readLimit, holdsManyBounds, defaultCitedText, NEGATING_RE, boundInWords and what they call; the five patterns built from text are literals here, src/ builds none, test/signed-text.test.js; fwd's own boundInWords and lineRules, src/pagebits.js, are an older copy: boundInWords reads time and date bounds only in this one)
// The part of the rubric step the check block calls: the shape reds of a step's parts, the limit reader (code reads ONE amount or ONE range from the person's rule words)
// and the default cited text. The rest of the rubric step (building, grading and reading a step file) is not wanted here.
import { lineRules } from './pagebits.js';
import { factShapeReds } from './citedcheck.js';
import { shapeShapeReds } from './shaperows.js';

// borrowed-from: bareloop src/rubricstep.js@v0.60.0 (the one spelling of the keys of a repo job's stage row, of a job-level guard row and of the write-fence row; fwd has no repo job, so only the block's repo rows read them)
export const stageKeyOf = (/** @type {string} */ name) => `S.${name}`;
export const guardKeyOf = (/** @type {string} */ name) => `J.$guard.${name}`;
export const FENCE_KEY = 'J.$fence';

// ── the `rubric-step` stage: its parameters, and the rubric they build ───────────────────────────────────────────────
//
// A stage serves exactly ONE job line N and reads exactly one file, output/steps/N.json. Its parameters are
//
//     step   N
//     parts  [ { text, class, ... } ]   — the person's constraints on that line, each SORTED by the drafter
//
// A part's class is one of `countable` (a limit a machine counts, or a quote a claim must show), `judged` (needs the
// judge — stored, never run in this build), `guard` (a rule about web sources — needs a web input, none exist yet) or
// `none` (the drafter could not sort it). Only `countable` parts become checks; the others are REDS at drafting
// (src/authoring.js `checkRubricParts`) so no signed stage ever carries one.

/** the closed set of classes a part is sorted into; `none` = "I could not sort this one" (a red, in plain words, never a guess) */
export const PART_CLASSES = Object.freeze(['countable', 'fact', 'shape', 'judged', 'guard', 'none']);

/**
 * The counted/quoted checks a `countable` part may name, with the fields each needs — read off bareguard's own rule table
 * (`rubricVocabulary`): the names are bareguard's, so a check this build cannot run is inexpressible, not rejected late.
 * (`max`/`min` need a numeric field the step file does not have, so they are not offered.)
 * @type {Readonly<Record<string, readonly string[]>>}
 */
export const COUNT_CHECKS = Object.freeze({
  maxWords: Object.freeze(['value']),
  minWords: Object.freeze(['value']),
  maxLines: Object.freeze(['value']),
  sections: Object.freeze(['names']),
  sectionWords: Object.freeze(['names', 'wordsPerSection']),
  // R10 (bareguard 0.31, fwdloop v0.29.0 OFFERED): the five text checks a person's pick may carry; the drafter never writes them
  nonEmpty: Object.freeze([]),
  listItems: Object.freeze(['value']),
  maxListItems: Object.freeze(['value']), // bareguard 0.35 (F315): an at-most / at-least bound on the list items, beside the exact listItems
  minListItems: Object.freeze(['value']),
  sectionOrder: Object.freeze(['names']),
  mustCarry: Object.freeze(['phrases']),
  blockLines: Object.freeze(['size', 'phrases']),
  cited: Object.freeze(['source']),
  // a COUNT of the claims listed under an input: the code counts the list (flattenStep), bareguard's own min/max compares it
  minClaims: Object.freeze(['value', 'source']),
  maxClaims: Object.freeze(['value', 'source']),
  // PART 1b: put on every prose step by CODE (`withFactBindings`) when an earlier line is a fact step — every number in the text
  // must be in a checked quote of those lines. The model never writes it; bareguard's `numbersInQuote` reads it (gradeStep).
  numbersFromFacts: Object.freeze(['from']),
});

/** every field a part may carry, whatever its class */
const PART_FIELDS = Object.freeze(['text', 'class', 'check', 'value', 'names', 'wordsPerSection', 'source', 'domains', 'phrases', 'size', 'covers', 'rules', 'from', 'record', 'facts', 'count', 'tested', 'sample', 'asSeen', 'fields', 'minItems', 'maxItems']);

/** @typedef {{code: string, path: string, detail: string}} ShapeRed */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** @param {unknown} v @returns {v is string} */
const nonEmpty = (v) => typeof v === 'string' && v.trim() !== '';

/** @param {unknown} v @returns {v is string[]} */
const nameList = (v) => Array.isArray(v) && v.length > 0 && v.every((x) => nonEmpty(x) && x.length <= 1000);

/**
 * The SHAPE of a `rubric-step` stage's parameters — what a part may carry — and nothing about which class is allowed in
 * this build (that is `checkRubricParts`, which also sees the whole job). Pure, never throws.
 * @param {unknown} p the stage's `params`
 * @param {string} at the path prefix for reds, e.g. `stages[1].params`
 * @returns {ShapeRed[]}
 */
export function rubricStepShapeReds(p, at) {
  /** @type {ShapeRed[]} */
  const reds = [];
  const red = (/** @type {string} */ code, /** @type {string} */ path, /** @type {string} */ detail) => reds.push({ code, path, detail });
  if (!isRec(p)) { red('invalid-value', at, 'an object {step, parts}'); return reds; }
  if (!(Number.isInteger(p.step) && p.step >= 1)) red('invalid-value', `${at}.step`, 'the number of the job line this stage serves (an integer, 1 or more)');
  if (!Array.isArray(p.parts)) { red('invalid-value', `${at}.parts`, 'an array of {text, class, ...} — one entry per constraint the person put on this line (may be empty)'); return reds; }
  p.parts.forEach((/** @type {any} */ part, /** @type {number} */ i) => {
    const w = `${at}.parts[${i}]`;
    if (!isRec(part)) { red('invalid-value', w, '{text, class, ...}'); return; }
    for (const k of Object.keys(part)) {
      if (!PART_FIELDS.includes(k)) red('invalid-value', `${w}.${k}`, `"${k}" is not a field of a part — fields: ${PART_FIELDS.join(', ')}`);
    }
    if (!nonEmpty(part.text)) red('missing-field', `${w}.text`, 'the part, in the person\'s own words (a non-empty string)');
    if (!PART_CLASSES.includes(part.class)) { red('invalid-value', `${w}.class`, `one of ${PART_CLASSES.join(' | ')}`); return; }
    if (Object.hasOwn(part, 'covers') && !(Array.isArray(part.covers) && part.covers.length > 0 && new Set(part.covers).size === part.covers.length
      && part.covers.every((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1))) {
      red('invalid-value', `${w}.covers`, 'the numbers of the confirmed checks this part carries out (distinct integers, 1 or more)');
    }
    if (Object.hasOwn(part, 'rules') && !(Array.isArray(part.rules) && part.rules.length > 0 && new Set(part.rules).size === part.rules.length
      && part.rules.every((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1))) {
      red('invalid-value', `${w}.rules`, 'the numbers of the line\'s ~ rules this part carries out (distinct integers, 1 or more)');
    }
    if (Object.hasOwn(part, 'asSeen') && part.class !== 'fact') red('invalid-value', `${w}.asSeen`, 'only a fact part carries the as-seen example');
    for (const k of ['fields', 'minItems', 'maxItems']) if (Object.hasOwn(part, k) && part.class !== 'shape') red('invalid-value', `${w}.${k}`, 'only a shape part carries the fields and the item count of a list of items');
    if (part.class === 'shape') { shapeShapeReds(part, w, (c, path, d) => red(c, path, d), p.parts.find((/** @type {any} */ x) => isRec(x) && x.class === 'fact') ?? null); return; }
    if (part.class === 'fact') { factShapeReds(part, w, (c, path, d) => red(c, path, d)); return; }
    if (part.class === 'guard') {
      if (!nameList(part.domains)) red('invalid-value', `${w}.domains`, 'a non-empty array of web domains the rule is about');
      return;
    }
    if (part.class !== 'countable') return;
    if (!Object.hasOwn(COUNT_CHECKS, part.check)) { red('invalid-value', `${w}.check`, `one of ${Object.keys(COUNT_CHECKS).join(' | ')}`); return; }
    for (const f of COUNT_CHECKS[part.check]) {
      const ok = f === 'value' || f === 'wordsPerSection' || f === 'size' ? Number.isInteger(part[f]) && part[f] >= 1
        : f === 'names' || f === 'phrases' ? nameList(part[f])
          : f === 'from' ? Array.isArray(part.from) && part.from.length > 0 && new Set(part.from).size === part.from.length && part.from.every((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1)
            : nonEmpty(part.source) && part.source.length <= 128;
      if (!ok) {
        red('invalid-value', `${w}.${f}`, f === 'names' ? 'a non-empty array of section names'
          : f === 'phrases' ? 'a non-empty array of words or phrases'
          : f === 'source' ? 'the label of the input a quote must come from'
            : f === 'from' ? 'the numbers of the earlier fact lines whose checked quotes the text\'s numbers come from (distinct integers, 1 or more)'
              : 'an integer, 1 or more');
      }
    }
  });
  // shape jobs: a line is a shape line, a sheet line or a facts line, never two of them, and a shape part holds its place beside the line's fact part (facts+shape: one `results` list) and its picks
  const shapeParts = p.parts.filter((/** @type {any} */ x) => isRec(x) && x.class === 'shape');
  if (shapeParts.length > 1) red('invalid-value', `${at}.parts`, 'one shape part per step: the fields of a list of items all go in one');
  if (p.parts.some((/** @type {any} */ x) => isRec(x) && x.class === 'sheet') && shapeParts.length > 0) red('invalid-value', `${at}.parts`, 'a sheet line holds sheet checks: a shape part is not allowed beside them');
  return reds;
}

/** @param {string} t @returns {string} a time token as compared: no spaces, lower case, no leading zero on the hour */
const timeKey = (t) => t.replace(/\s+/g, '').toLowerCase().replace(/^0(?=\d:)/, '');

/**
 * The person's words read by KIND, so a digit inside a time, a date or an amount belongs to that token only (F242).
 * @param {string} text @returns {{bare: Set<number>, amount: Set<number>, time: Set<string>, date: Set<string>}}
 */
const tokensSaid = (text) => {
  const out = { bare: new Set(), amount: new Set(), time: new Set(), date: new Set() };
  const re = /(\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)|(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[/.]\d{1,2}[/.]\d{2,4})|([$\u20ac\u00a3]\s?\d[\d,]*(?:\.\d+)?|\d[\d,]*(?:\.\d+)?\s?(?:US\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\b)|(\d[\d,]*(?:\.\d+)?)/gi;
  for (const m of text.matchAll(re)) {
    if (m[1]) out.time.add(timeKey(m[1]));
    else if (m[2]) out.date.add(m[2]);
    else if (m[3]) out.amount.add(Number(m[3].match(/\d[\d,]*(?:\.\d+)?/)?.[0].replace(/,/g, '')));
    else out.bare.add(Number(m[4].replace(/,/g, '')));
  }
  return out;
};

/**
 * Is this rule bound in the words the person wrote? The ONE test for "a number the AI made" (`rubric-fact-unmarked`, the L3 settle, and
 * the early ask of PRD v1.107 Part 5b all read it; never a second spelling). By kind: a number is said only as a bare number or an
 * amount's number; a time only as a time token (hour leading zero ignored); a date only as a date token. Never a piece of a token.
 * @param {unknown} b @param {string} said @returns {boolean}
 */
export const boundInWords = (b, said) => {
  const t = tokensSaid(said);
  if (typeof b === 'number') return t.bare.has(b) || t.amount.has(b);
  if (typeof b !== 'string') return false;
  return /^\s*\d{1,2}:\d{2}/.test(b) ? t.time.has(timeKey(b)) : t.date.has(b.trim());
};


const TIME_RANGE_RE = /\b(?:between|from)\s+(\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)\s+(?:and|to|-)\s+(\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)/i;
const TIME_RANGE_ALL_RE = /\b(?:between|from)\s+(\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)\s+(?:and|to|-)\s+(\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?)/gi;

export const NEGATING_RE = /\b(?:not|no|never|outside|except|before|after|without)\b/i;

// The limit reader (hamr ruling A, 2026-11-12): when the look tied a money or time fact to a `~` rule but gave no limit, CODE reads the limit
// from the person's own rule words. ONE amount or ONE range only; every other text is a plain reason (Not checked), never a wrong check.
// The direction words are the FACT_OPS words of src/facts.js (lt under, lte at most, gt over, gte at least) plus their plain synonyms.

const AMOUNT_ALL_RE = /(?:[$\u20ac\u00a3]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:US\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\b)/gi;

const MONEY_BETWEEN_RE = /\bbetween\s+(?:[$\u20ac\u00a3]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:US\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\b)\s+(?:and|to|-)\s+(?:[$\u20ac\u00a3]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:US\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\b)/i;

const MONEY_DIRECTION_RE = /\b(under|below|less than|fewer than|at most|up to|no more than|over|above|more than|at least|no less than|no fewer than)\s+(?:[$\u20ac\u00a3]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:US\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\b)/i;

const MONEY_OR_LESS_RE = /(?:[$\u20ac\u00a3]\s?(\d[\d,]*(?:\.\d+)?)|(\d[\d,]*(?:\.\d+)?)\s?(?:US\s)?(?:dollars?|euros?|pounds?|USD|EUR|GBP)\b)\s+or\s+(less|fewer|under|below|lower|more|over|above|higher)\b/i;

const DIRECTION_OP = /** @type {Record<string, 'lt'|'lte'|'gt'|'gte'>} */ ({ under: 'lt', below: 'lt', 'less than': 'lt', 'fewer than': 'lt', 'at most': 'lte', 'up to': 'lte', 'no more than': 'lte', over: 'gt', above: 'gt', 'more than': 'gt', 'at least': 'gte', 'no less than': 'gte', 'no fewer than': 'gte' });

const CURRENCY_STEM = /** @type {Record<string, string>} */ ({ $: 'dollar', '€': 'euro', '£': 'pound', usd: 'dollar', eur: 'euro', gbp: 'pound' });

const num = (/** @type {string|undefined} */ a, /** @type {string|undefined} */ b) => Number(String(a ?? b).replace(/,/g, ''));

const hhmm = (/** @type {string} */ t) => (/[AaPp][Mm]/.test(t) ? null : t.replace(/\s+/g, '').replace(/^(\d):/, '0$1:'));

/** does the amount token's currency (sign or word) fit the look fact's currency and unit lists? A fact with neither list fits anything. */
function currencyFits(/** @type {string} */ tok, /** @type {any} */ fact) {
  const cur = (Array.isArray(fact?.currency) ? fact.currency : fact?.currency ? [fact.currency] : []).map(String);
  const unit = (Array.isArray(fact?.unit) ? fact.unit : fact?.unit ? [fact.unit] : []).map((/** @type {unknown} */ u) => String(u).toLowerCase());
  if (!cur.length && !unit.length) return true;
  const sym = /^[$€£]/.test(tok) ? tok.charAt(0) : null;
  const last = String(tok.trim().split(/\s+/).at(-1)).toLowerCase();
  const stem = sym ? CURRENCY_STEM[sym] : (CURRENCY_STEM[last] ?? last.replace(/s$/, ''));
  return (sym !== null && cur.includes(sym)) || unit.some((/** @type {string} */ u) => u.includes(String(stem)));
}

/**
 * Does this rule text hold more than one amount (money) or more than one time range (time)? The ONE guard code's own limit read and an AI
 * reading edit both use: "under $450 or over $900" is two limits, and one reading of it would be a wrong check.
 * @param {string} shape @param {string} text @returns {boolean}
 */
export function holdsManyBounds(shape, text) {
  const t = String(text ?? '');
  if (shape === 'time') return [...t.matchAll(TIME_RANGE_ALL_RE)].length > 1 || (t.match(/\d{1,2}:\d{2}/g) ?? []).length > 2;
  if (shape === 'money') { const amts = [...t.matchAll(AMOUNT_ALL_RE)]; return amts.length > 1 && !(MONEY_BETWEEN_RE.test(t) && amts.length === 2); }
  return false;
}

// borrowed-from: bareloop src/rubricstep.js@v0.57.0 (c18df406) (WHY_OTHER_CURRENCY, fd943e49)
/** the plain reason a rule's amount is in a currency the page fact does not use; `readLimit` gives it and the check list reads it, one spelling */
export const WHY_OTHER_CURRENCY = 'the amount is in another currency than the page fact';

/**
 * The limit the person's own words give a fact of this shape: `{reading}` or `{why}` (a plain reason; the rule then stays Not checked).
 * @param {string} shape money or time @param {string} text the `~` rule's words @param {any} [fact] the look fact (its currency and unit lists must fit)
 * @returns {{reading: {op: 'lt'|'lte'|'gt'|'gte', value: number} | {op: 'between', lo: number|string, hi: number|string}} | {why: string}}
 */
export function readLimit(shape, text, fact = {}) {
  const t = String(text ?? '');
  if (shape === 'time') {
    if (NEGATING_RE.test(t)) return { why: 'a one-sided or negated time (before, after, not) is not a range code can read' };
    if (/\b\d{1,2}(?::\d{2})?\s?[ap]\.?m\b/i.test(t)) return { why: 'a 12-hour time (am or pm) is not read, write it like 06:00' };
    if (holdsManyBounds('time', t)) return { why: 'more than one time range in the rule' };
    const m = TIME_RANGE_RE.exec(t);
    if (!m) return { why: 'no range between two times in the rule' };
    const lo = hhmm(String(m[1])), hi = hhmm(String(m[2]));
    if (!lo || !hi) return { why: 'a 12-hour time (am or pm) is not read, write it like 06:00' };
    if (lo >= hi) return { why: 'a range whose end is not after its start is not read' };
    return { reading: { op: 'between', lo, hi } };
  }
  if (shape === 'money') {
    if (/\b(?:not|never|outside|except|without)\b/i.test(t)) return { why: 'a negated limit (not, except, without) is not read' };
    const amts = [...t.matchAll(AMOUNT_ALL_RE)];
    if (!amts.length) return { why: 'no amount with a currency sign or word in the rule' };
    for (const a of amts) if (!currencyFits(a[0], fact)) return { why: WHY_OTHER_CURRENCY };
    if (holdsManyBounds('money', t)) return { why: 'more than one amount in the rule' };
    const b = MONEY_BETWEEN_RE.exec(t);
    if (b) { const lo = num(b[1], b[2]), hi = num(b[3], b[4]); return lo < hi ? { reading: { op: 'between', lo, hi } } : { why: 'a range whose end is not above its start is not read' }; }
    const d = MONEY_DIRECTION_RE.exec(t);
    if (d) return { reading: { op: /** @type {'lt'|'lte'|'gt'|'gte'} */ (DIRECTION_OP[String(d[1]).toLowerCase()]), value: num(d[2], d[3]) } };
    const o = MONEY_OR_LESS_RE.exec(t);
    if (o) return { reading: { op: /^(less|fewer|under|below|lower)$/i.test(String(o[3])) ? 'lte' : 'gte', value: num(o[1], o[2]) } };
    return { why: 'the rule gives an amount but no direction (under, over, at most, at least, between)' };
  }
  return { why: 'code reads a limit only for money or time' };
}

/** the words of the default cited check code adds to a text line of a one-input job (the one list's `$` row); the card reads a part with exactly these words as `[default]` @param {string} label @returns {string} */
export const defaultCitedText = (label) => `every claim is backed by a quote copied from "${label}"`;

// borrowed-from: bareloop src/rubricstep.js@v0.57.0 (c18df406) (defaultNoteText)
/** the words of the default note check code adds to a facts line that also asks for written words (the one list's `$` row); the card reads a part with exactly these words as `[default]` @param {number} n the job line @returns {string} */
export const defaultNoteText = (n) => `line ${n} writes a note — the note must be there`;


// borrowed-from: bareloop src/rubricstep.js@v0.56.0 (3383cce) (listMatchesClose: the signing door's test of the list against the close; bareloop's stages shape, the block's own closeCache.stages; fwd's close is shaped differently, so wiring it to fwd's close is a later piece)
/**
 * The sign-time check of a close that carries the one check list: every BUILT row (the mechanical floor aside) points at a part that is really in the close, and every real check part
 * (countable or fact) has at least one built row pointing at it, so a check cannot be in the close with no row and a row cannot claim a check the close does not run. A close with no list is
 * not examined here. Pure.
 * @param {any} closeDecl @returns {{ok: true}|{ok: false, error: string}}
 */
export function listMatchesClose(closeDecl) {
  const list = isRec(closeDecl) && Array.isArray(closeDecl.list) ? closeDecl.list : null;
  if (list === null) return { ok: true };
  const stages = Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  const partsOn = (/** @type {number} */ n) => stages.filter((/** @type {any} */ st) => isRec(st) && st.kind === 'rubric-step' && isRec(st.params) && st.params.step === n && Array.isArray(st.params.parts)).flatMap((/** @type {any} */ st) => st.params.parts);
  const built = list.filter((/** @type {any} */ r) => isRec(r) && r.state === 'built' && r.kind !== 'floor');
  const bad = built.filter((/** @type {any} */ r) => !(isRec(r.part) && r.part.line === r.line && Number.isInteger(r.part.part) && isRec(partsOn(r.line)[r.part.part])));
  const lines = [...new Set(stages.filter((/** @type {any} */ st) => isRec(st) && st.kind === 'rubric-step' && isRec(st.params)).map((/** @type {any} */ st) => st.params.step))];
  const bare = lines.flatMap((/** @type {number} */ n) => partsOn(n).map((/** @type {any} */ p, /** @type {number} */ i) => ({ n, i, p })))
    .filter(({ p }) => isRec(p) && (p.class === 'countable' || p.class === 'fact'))
    // a part has its row when a built row points at it, or when the part lists (in its `rules`) the number of a built `~` row of its line (a row points at ONE part, a rule may be carried by several)
    .filter(({ n, i, p }) => !built.some((/** @type {any} */ r) => (isRec(r.part) && r.part.line === n && r.part.part === i)
      || (r.kind === 'rule' && r.line === n && Array.isArray(p.rules) && p.rules.includes(r.rule))));
  if (bad.length === 0 && bare.length === 0) return { ok: true };
  const parts = [];
  if (bad.length) parts.push(`a row points at a check the close does not run: ${bad.map((/** @type {any} */ r) => r.key).join('; ')}`);
  if (bare.length) parts.push(`a check in the close has no row: line ${bare.map(({ n, i }) => `${n} part ${i + 1}`).join('; ')}`);
  return { ok: false, error: `The list of checks does not match the signed close (${parts.join(' | ')}). Nothing was signed — draft again.` };
}
