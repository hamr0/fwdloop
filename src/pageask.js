// borrowed-from: bareloop src/pagemap.js@0a34846 (DROP_IT, isDropIt, isAgree, readingQuestion, readingOfQuestion, tooManyAsksText)
// borrowed-from: bareloop src/facts.js@0a34846 (ruleWords, sayBound, moneyAs)
// borrowed-from: bareloop src/pagemap.js@v0.49.0 (d51a367) (stripAgreeLead, F240; adapted: literal regex, src/ bans new RegExp)
// The words of the asks and of the answers to them. M17 am4 (A1): the asks themselves come from the list (src/blockasks.js); the page-look ask path that sat here is gone.
import { redactSecrets } from './redact.js';
import { HOW_TO_ANSWER } from './checkpick.js';
import { columnTail } from './sheetfind.js';

/** the most asks before drafting; more than this is a job to rewrite, not a questionnaire (am1) */
export const MAX_LOOK_ASKS = 3;
/** the answer that drops a `~` rule the page cannot check: the person types it (any case, a closing full stop allowed) */
export const DROP_IT = 'drop it';
/** @param {unknown} text @returns {boolean} */
export const isDropIt = (text) => String(text ?? '').trim().replace(/\.$/, '').toLowerCase() === DROP_IT;
/** the answers that accept the code's reading of a rule; anything else the person types is their own reading */
export const AGREE_WORDS = ['agree', 'yes'];
/** @param {unknown} text @returns {boolean} */
export const isAgree = (text) => AGREE_WORDS.includes(String(text ?? '').trim().replace(/[.!]$/, '').toLowerCase());

/**
 * F240: an answer that opens with an agree word IMMEDIATELY followed by a comma or a colon (spaces allowed only after it) and more text
 * ("yes, check it as ...", "agree: the outbound flight") is the person's own reading with a courtesy word in front: the word and the
 * comma/colon go, the rest stays word for word. No hyphen or dash of any kind and no bare space counts, so "yes-no questions only",
 * "agree-ment on price", "yes - departs", "yes departs" and "yesterday, ..." are kept whole. A bare "yes"/"agree" (isAgree), a bare "yes,"
 * and a text that only contains the word later are returned untouched.
 * @param {string} text @returns {string}
 */
export const stripAgreeLead = (text) => {
  // a literal that spells out AGREE_WORDS (src/ bans dynamic RegExp, the ReDoS guard); the two must stay in step
  const m = String(text ?? '').match(/^(?:agree|yes)[,:]\s*(\S[\s\S]*)$/i);
  return m ? m[1].trim() : String(text ?? '');
};

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
export function moneyAs(f, n, symbolFirst) {
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
const READING_ASKED = '. Agree?';
/** the part of a reading ask that tells the CLI's typed words (M10 am29: the panel shows the question without it) */
const READING_ANSWER = ' Answer "agree"';
const READING_TAIL = `${READING_ASKED}${READING_ANSWER}`;
/** @param {number} n @returns {string} the rest of a reading ask after its answer words */
const readingRest = (n) => `, or type your own reading (your answer replaces that ~ rule on line ${n}).`;
/** @param {number} n @returns {string} the answer words a can't-check ask ends with (said once, here, and cut in the panel) */
const cantCheckTail = (n) => ` Answer "${DROP_IT}", or type how to check it (your answer replaces that ~ rule on line ${n}).`;
/** @param {number} n @param {string} rule @param {string} reading @returns {string} */
export const readingQuestion = (n, rule, reading) => `Your line ${n} says "${rule}".${READING_HEAD}${reading}${READING_TAIL}${readingRest(n)}`;
// borrowed-from: bareloop src/pagemap.js@v0.56.0 (3383cce) (cantCheckQuestion; readingQuestion above is exported for the block's asks)
/** @param {number} n @param {string} rule @returns {string} the can't-check ask in its one spelling */
export const cantCheckQuestion = (n, rule) => `Your line ${n} says "${rule}". I can't check this on the page. Drop it?${cantCheckTail(n)}`;
/** @param {unknown} q a recorded question @returns {string|null} the reading a reading ask proposed, or null when it was another kind of question */
export function readingOfQuestion(q) {
  const s = String(q ?? '');
  const a = s.indexOf(READING_HEAD);
  const b = s.indexOf(READING_TAIL);
  return a >= 0 && b > a ? s.slice(a + READING_HEAD.length, b) : null;
}

/**
 * M10 am29: a look question as the PANEL shows it: the code's own answer words (`Answer "agree"…` / `answer "drop it"…`) cut off the end, because the buttons and the box say it.
 * Only the known tails are cut, matched exactly as a suffix (never a pattern over the prose); a question that ends in none of them is returned whole. The stored question is never changed.
 * @param {{question: string, line: number, source?: string}} q @returns {string}
 */
export function panelQuestionText(q) {
  const text = String(q.question);
  if (q.source !== 'look') return text;
  const tails = [`${READING_ANSWER}${readingRest(q.line)}`, cantCheckTail(q.line), columnTail(q.line), columnTail(q.line, true), ` ${HOW_TO_ANSWER(q.line, true)}`, ` ${HOW_TO_ANSWER(q.line, false)}`];
  const hit = tails.find((t) => text.endsWith(t));
  return hit === undefined ? text : text.slice(0, text.length - hit.length);
}

/**
 * More asks than the cap means the job needs a rewrite, not a questionnaire. The code-owned stop words list EVERY ask and its reading as the
 * suggestion (no extra paid call). A secret in a rule is masked.
 * @param {{line: number, ruleText: string, reading?: string}[]} asks @returns {string}
 */
export function tooManyAsksText(asks) {
  const list = asks.map((a) => `line ${a.line} "${a.ruleText}" → ${a.reading ?? "I can't check this on the page"}`).join('; ');
  return redactSecrets(`Your job has ${asks.length} rules I can't check or had to guess. Please rewrite it so each one says what to look for. My readings: ${list}.`);
}

/**
 * What a typed answer to a look ask does, the ONE place that decides (the panel's answer route, the setup record and the Result tab all read it).
 * `agree` / `yes` to a reading ask takes the code's reading; `drop it` to a can't-check ask leaves the rule Not checked (no `~` line); anything else is the
 * person's own words, taken word for word with newlines folded to spaces. A question that is not a look ask is never changed: its answer is its rule.
 * M10 am16: a shape guardrail's ask (`ask: 'check'` proposes a check, `'no-check'` found none) takes the same words: `agree` takes the proposal (and the check it
 * carries, `check`), `drop it` leaves the rule Not checked (either kind), anything else is the person's own words (`own`: a `~` rule on the line, no check).
 * @param {{source?: string, ask?: string, proposal?: string|null, check?: Record<string, any>}} q @param {unknown} typed @param {'agree'|'drop'|'rule'} [choice] M10 am29: the button used; absent = today's words reading (CLI, old files)
 * @returns {{rule: string|null, left: boolean, check?: Record<string, any>, own?: boolean}} `rule` = the words written as a new `~` rule (null when the rule is left Not checked)
 */
export function ruleOfAnswer(q, typed, choice) {
  const typedText = String(typed ?? '').replace(/\s*\n\s*/g, ' ').trim();
  if (q.source !== 'look') return { rule: typedText, left: false };
  if (choice !== undefined) { // M10 am29: a typed choice decides, never the words; the box (`rule`) keeps its words whole
    const shapeC = q.ask === 'check' || q.ask === 'no-check';
    if (choice === 'agree' && typeof q.proposal === 'string' && (q.ask === 'reading' || q.ask === 'check')) return { rule: q.proposal, left: false, ...(q.ask === 'check' && q.check ? { check: q.check } : {}) };
    if (choice === 'drop') return { rule: null, left: true };
    return { rule: typedText, left: false, ...(shapeC ? { own: true } : {}) };
  }
  const text = stripAgreeLead(typedText); // F240: "yes, check it as ..." is the person's own words minus the leading "yes,"
  const shape = q.ask === 'check' || q.ask === 'no-check';
  if ((q.ask === 'reading' || q.ask === 'check') && typeof q.proposal === 'string' && isAgree(text)) return { rule: q.proposal, left: false, ...(q.ask === 'check' && q.check ? { check: q.check } : {}) };
  if ((q.ask === 'cant-check' || shape) && isDropIt(text)) return { rule: null, left: true };
  return { rule: text, left: false, ...(shape ? { own: true } : {}) };
}
