// borrowed-from: bareloop src/pagemap.js@0a34846 (DROP_IT, isDropIt, isAgree, readingQuestion, readingOfQuestion, askableFromLook, ruleBounds, tooManyAsksText)
// borrowed-from: bareloop src/facts.js@0a34846 (ruleWords, sayBound, moneyAs)
// M10 piece 3 (docs/wiki/the-module-ladder.md "M10", item 4, am1, am2, am5): the early asks CODE forces before any paid drafting, from the page look's own
// result. The model never decides whether to ask: this file reads a kept fact's own keys (line, forRule, name, shape, unit, currency, reading) and the job
// lines, and nothing else (test/m10-pageask.test.js greps for it). The question words are bareloop's, verbatim (am5 item 1); the answer words are
// agree / yes (code's reading), your own words, and, for a can't-check ask only, "drop it" (am2 item 2).
// Every rule is one of three kinds:
//   PAGE: a kept page word carries it: no ask.
//   READING: a kept fact carries it with a `reading` (a limit the page cannot hold in words, e.g. "not a red-eye"). Asked only when a bound of the
//     reading is NOT in the words the person wrote; a bound they wrote themselves is theirs and nothing is asked.
//   CAN'T CHECK: no kept fact carries it.
// Throws away: a fact's name, words and source (only its reading and the rule it serves are used).
import { redactSecrets } from './redact.js';
import { lineRules, boundInWords, wordsSaidOn } from './pagebits.js';
import { validReading } from './pagerules.js';

/** the most asks before drafting; more than this is a job to rewrite, not a questionnaire (am1) */
export const MAX_LOOK_ASKS = 3;
/** the answer that drops a `~` rule the page cannot check: the person types it (any case, a closing full stop allowed) */
export const DROP_IT = 'drop it';
/** @param {unknown} text @returns {boolean} */
export const isDropIt = (text) => String(text ?? '').trim().replace(/\.$/, '').toLowerCase() === DROP_IT;
/** the answers that accept the code's reading of a rule; anything else the person types is their own reading */
const AGREE_WORDS = ['agree', 'yes'];
/** @param {unknown} text @returns {boolean} */
export const isAgree = (text) => AGREE_WORDS.includes(String(text ?? '').trim().replace(/[.!]$/, '').toLowerCase());

/** @typedef {{line: number, rule: number, source: 'look', question: string, ask: 'reading'|'cant-check', ruleText: string, reading?: string}} LookAsk
 *   `reading` = the plain words an `agree` writes as a `~` rule (a reading ask only) */

/** @param {unknown} n @param {string} shape @param {any} f @returns {string} one bound, as the person would say it */
function sayBound(n, shape, f) {
  if (shape === 'money') return moneyAs(f, /** @type {string|number} */ (n), false);
  return String(n);
}
const asList = (/** @type {unknown} */ v) => (Array.isArray(v) ? v.map(String) : (typeof v === 'string' ? [v] : []));
/**
 * One amount of a money fact in the fact's OWN forms, never a hardcoded sign: `symbolFirst` puts the currency sign before the amount when the fact has one.
 * @param {any} f @param {string|number} n @param {boolean} symbolFirst @returns {string}
 */
function moneyAs(f, n, symbolFirst) {
  const cur = asList(f.currency)[0];
  const uni = asList(f.unit)[0];
  if (symbolFirst) return cur !== undefined ? `${cur}${n}` : `${n} ${uni}`;
  return uni !== undefined ? `${n} ${uni}` : `${cur}${n}`;
}
/** @param {any} f a fact with a rule @returns {string} the rule in words, e.g. "under 450 US dollars" */
export function ruleWords(f) {
  const r = f.rule;
  return r.op === 'between' ? `between ${sayBound(r.lo, f.shape, f)} and ${sayBound(r.hi, f.shape, f)}`
    : `${{ lt: 'under', lte: 'at most', gt: 'over', gte: 'at least' }[/** @type {'lt'|'lte'|'gt'|'gte'} */ (r.op)]} ${sayBound(r.value, f.shape, f)}`;
}

/** the words of a reading ask: the ONE spelling, and {@link readingOfQuestion} reads it back (the Result tab's "(you confirmed)") */
const READING_HEAD = ' I read it as: ';
const READING_TAIL = '. Agree? Answer "agree"';
/** @param {number} n @param {string} rule @param {string} reading @returns {string} */
const readingQuestion = (n, rule, reading) => `Your line ${n} says "${rule}".${READING_HEAD}${reading}${READING_TAIL}, or type your own reading (your answer is added as a new ~ rule on line ${n}).`;
/** @param {unknown} q a recorded question @returns {string|null} the reading a reading ask proposed, or null when it was another kind of question */
export function readingOfQuestion(q) {
  const s = String(q ?? '');
  const a = s.indexOf(READING_HEAD);
  const b = s.indexOf(READING_TAIL);
  return a >= 0 && b > a ? s.slice(a + READING_HEAD.length, b) : null;
}

/**
 * The early asks CODE forces before any paid drafting, from the look's own result. One ask per rule text on a line; readings first, then can't-check
 * asks, each in line order. The caller applies the cap and the answer gate.
 * @param {{facts?: {line: number, forRule?: number, name?: string, shape?: string, unit?: string[], currency?: string[], reading?: import('./pagerules.js').Reading}[]}|null|undefined} look
 * @param {{n: number, text?: string, rule?: string, rules?: string[]}[]|null|undefined} jobLines
 * @returns {LookAsk[]}
 */
export function askableFromLook(look, jobLines) {
  const facts = Array.isArray(look?.facts) ? look.facts : [];
  /** @type {LookAsk[]} */
  const readings = [];
  /** @type {LookAsk[]} */
  const cants = [];
  /** @type {Set<string>} */
  const seen = new Set();
  for (const l of Array.isArray(jobLines) ? jobLines : []) {
    lineRules(l).forEach((rule, k) => {
      const n = k + 1;
      const key = `${l.n}\u0000${rule.trim().toLowerCase()}`;
      const tied = facts.filter((f) => f.line === l.n && f.forRule === n);
      if (tied.length > 0) {
        const said = wordsSaidOn(l);
        const f = tied.find((x) => x.reading && validReading(x.shape, x.reading) && ruleBounds(x.reading).some((b) => !boundInWords(b, said)));
        if (f === undefined || seen.has(key)) return;
        seen.add(key);
        const reading = `${f.name} ${ruleWords({ shape: f.shape, unit: f.unit, currency: f.currency, rule: f.reading })}`;
        readings.push({
          line: l.n, rule: n, source: 'look', ask: 'reading', ruleText: rule, reading,
          question: readingQuestion(l.n, rule, reading),
        });
        return;
      }
      if (seen.has(key)) return;
      seen.add(key);
      cants.push({
        line: l.n, rule: n, source: 'look', ask: 'cant-check', ruleText: rule,
        question: `Your line ${l.n} says "${rule}". I can't check this on the page. Drop it? Answer "${DROP_IT}", or type how to check it (your answer is added as a new ~ rule on line ${l.n}).`,
      });
    });
  }
  return [...readings, ...cants];
}

/** @param {import('./pagerules.js').Reading} r @returns {unknown[]} the bounds a reading holds */
const ruleBounds = (r) => (r.op === 'between' ? [r.lo, r.hi] : [r.value]);

/**
 * More asks than the cap means the job needs a rewrite, not a questionnaire. The code-owned stop words list EVERY ask and its reading as the
 * suggestion (no extra paid call). A secret in a rule is masked.
 * @param {{line: number, ruleText: string, reading?: string}[]} asks @returns {string}
 */
export function tooManyAsksText(asks) {
  const list = asks.map((a) => `line ${a.line} "${a.ruleText}" → ${a.reading ?? "I can't check this on the page"}`).join('; ');
  return redactSecrets(`Your job has ${asks.length} rules I can't check or had to guess. Please rewrite it so each one says what to look for. My readings: ${list}.`);
}
