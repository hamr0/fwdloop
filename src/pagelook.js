// M10 item 3 ("the source's own words"): the page-word look for ONE page input. One AI call names the page's own words for each job rule
// (bareloop's prompt, src/pagemap.js); code keeps only words the saved page proves (bareloop's rules, src/pagerules.js) plus one rule of ours:
// a label that reads no value is dropped. The AI never grades; every drop is written once, from the one table (src/pagedropwords.js).
//
// Throws away: nothing silently. A word, fact or rule that a rule removes comes back in `dropped` with its reason code and as a Not-checked line.
// Third outcomes: an unreadable answer twice (stop, MAP_UNREADABLE), a cut-off answer (unreadable), a failed call (stop, its reason).
// The model call itself is the caller's (`callModel`): the drafter meters every round through it.

import { mapPrompt, parseMapAnswer, MAP_UNREADABLE } from './pagemap.js';
import { applyPageRules } from './pagerules.js';
import { dryReadMoney } from './pagedry.js';
import { dropRows, dropLine } from './pagedropwords.js';
import { lineRules, squash } from './pagebits.js';
import { placePhrases } from './pageplace.js';
import { ruleWords } from './pageask.js';

/** Our rule (signed item 3): a kept money / number / time label must have a value of its kind written right AFTER it on some page line. */
const READ = {
  money: /^\s*[$€£]?\s*\d[\d,]*(?:\.\d+)?/,
  number: /^\s*\d[\d,]*(?:\.\d+)?/,
  time: /^\s*\d{1,2}:\d{2}[\s\u202f\u00a0]?[AaPp][Mm]/, // h:mm AM/PM, as bareloop's own time reader (src/pagerules.js READ)
};

/** @param {string[]} lines squashed page lines @param {string} label @param {'money'|'number'|'time'} shape @returns {boolean} */
function readsValue(lines, label, shape) {
  const p = squash(label).trim();
  if (p === '') return false;
  for (const ln of lines) for (let i = ln.indexOf(p); i !== -1; i = ln.indexOf(p, i + p.length)) if (READ[shape].test(ln.slice(i + p.length))) return true;
  return false;
}

/** @param {unknown} v @returns {unknown} the list with a repeated entry once (first kept); anything else as it came */
const once = (v) => (Array.isArray(v) ? [...new Set(v)] : v);

/**
 * A unit, currency or label listed twice in one list is one entry: removed before the rules run, so no rule can compare a word with itself.
 * @param {any} mapping @returns {any}
 */
export function dedupeMap(mapping) {
  if (!mapping || !Array.isArray(mapping.facts)) return mapping;
  return { ...mapping, facts: mapping.facts.map((f) => (f && typeof f === 'object' ? { ...f, ...(f.words === undefined ? {} : { words: once(f.words) }), ...(f.unit === undefined ? {} : { unit: once(f.unit) }), ...(f.currency === undefined ? {} : { currency: once(f.currency) }) } : f)) };
}

/**
 * The rules over one saved page: bareloop's (found-on-page, N2, R1, U1/R1L, S1, ...), then ours (no-value).
 * @param {string} text the frozen page text @param {import('./pagerules.js').PageMap} mapping @param {{n: number, text?: string, rule?: string, rules?: string[]}[]} jobLines
 * @returns {{facts: import('./pagerules.js').KeptFact[], dropped: import('./pagerules.js').Dropped[]}}
 */
export function applyPageWords(text, mapping, jobLines) {
  const r = applyPageRules(text, dedupeMap(mapping), jobLines);
  const lines = text.split('\n').map(squash);
  const dropped = [...r.dropped];
  /** @type {any[]} */
  const facts = [];
  // the kept facts say 'phrase' for a place too; the AI's own map says which were places
  const placeNames = new Set((Array.isArray(mapping?.facts) ? mapping.facts : []).filter((m) => m?.shape === 'place').map((m) => String(m.name)));
  for (const f of r.facts) {
    const shape = f.shape;
    if (shape === 'phrase' && f.words.length > 0 && placeNames.has(f.name)) {
      // M10 am7 item 2 (R2, R2a, R2b): a PLACE word grows to its role word; the phrases are all to be in a result's quote (R2c, src/citedcheck.js factsOfLook)
      facts.push({ ...f, phrases: placePhrases(text, f.words).phrases });
      continue;
    }
    if (!(shape === 'money' || shape === 'number' || shape === 'time') || f.words.length === 0) { facts.push(f); continue; }
    const at = { line: f.line, ...(f.forRule === undefined ? {} : { rule: f.forRule }), fact: f.name };
    const keep = [];
    for (const w of f.words) {
      if (readsValue(lines, w, shape)) keep.push(w);
      else dropped.push({ ...at, word: w, reason: 'no-value' });
    }
    if (keep.length === 0) { dropped.push({ ...at, reason: 'no-label' }); continue; }
    facts.push({ ...f, words: keep });
  }
  return { facts, dropped };
}

/** @param {import('./pagerules.js').Dropped[]} dropped @param {{n: number}[]} jobLines @returns {string[]} one plain line per fact that lost something, in the person's own words */
export const notCheckedLines = (dropped, jobLines) => dropRows(dropped).map((row) => dropLine(row, jobLines, lineRules));

// borrowed-from: bareloop src/inputlook.js@6b5dc74 (lookFactOf, rewritten to a plain function; the `example` field is not used here)
/**
 * A kept fact as the look carries it: the page words under the name the later pieces read (a phrase holds `phrase`, any other `labels`/`label`).
 * @param {import('./pagerules.js').KeptFact} k @param {string} source @returns {any}
 */
export function lookFactOf(k, source) {
  /** @type {any} */
  const out = { line: k.line, name: k.name, shape: k.shape, source, words: [...k.words] };
  if (k.shape === 'phrase') out.phrase = k.words[0];
  if (Array.isArray(/** @type {any} */ (k).phrases)) out.phrases = [.../** @type {any} */ (k).phrases];
  else { out.labels = [...k.words]; if (k.words.length) out.label = k.words[0]; }
  if (k.unit) out.unit = [...k.unit];
  if (k.currency) out.currency = [...k.currency];
  if (k.forRule !== undefined) out.forRule = k.forRule;
  if (k.reading) out.reading = { ...k.reading };
  return out;
}

/**
 * Look at ONE page input: the map call (once; once more if the answer is unreadable), then the rules.
 * `callModel(content, attempt)` (attempt 1 or 2) makes and meters ONE model round and returns `{text}`, `{text, cutOff: true}` (the round hit its output cap) or `{error}`.
 * @param {{label: string, text: string, jobLines: {n: number, text: string, rule?: string, rules?: string[]}[], callModel: (content: string, attempt: number) => Promise<{text?: string, cutOff?: boolean, error?: string}>}} o
 * @returns {Promise<{ok: true, look: {facts: any[], dropped: any[]}, notChecked: string[], mapping: any, attempts: number}|{ok: false, reason: string, attempts: number}>}
 */
export async function lookAtPage({
  label, text, jobLines, callModel,
}) {
  const content = mapPrompt({ jobLines, label, text });
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const r = await callModel(content, attempts);
    if (r.error !== undefined) return { ok: false, reason: `the call about the page failed: ${r.error}`, attempts };
    const parsed = r.cutOff === true ? { ok: false } : parseMapAnswer(r.text);
    if (parsed.ok) {
      const { mapping } = /** @type {any} */ (parsed);
      const words = applyPageWords(text, mapping, jobLines);
      // F241 "can it read": a money fact whose forms read no result line, by the run's own checker (src/pagedry.js), is Not checked, never signed
      const read = await dryReadMoney(text, words.facts);
      const kept = { facts: read.facts, dropped: [...words.dropped, ...read.dropped] };
      const dropped = kept.dropped.map((d) => ({ ...d, source: label }));
      return {
        ok: true, look: { facts: kept.facts.map((f) => lookFactOf(f, label)), dropped }, notChecked: notCheckedLines(kept.dropped, jobLines), mapping, attempts,
      };
    }
    if (attempts >= 2) return { ok: false, reason: MAP_UNREADABLE, attempts };
  }
}

/**
 * What the drafter is told about a page it cannot read for itself: the words code checked against the saved page (kept), and every drop, so it never
 * claims a check the page cannot give (bareloop's withDropNotes, told to the drafter as plain lines).
 * @param {{label: string, address: string, chars: number, look: {facts: any[]}, notChecked: string[]}} o @returns {string[]}
 */
export function pageInfoLines({
  label, address, chars, look, notChecked,
}) {
  const q = (/** @type {string} */ w) => `"${w}"`;
  const say = (/** @type {any} */ f) => {
    const head = `${f.name}${f.forRule === undefined ? '' : ` (rule ${f.forRule})`}`;
    // M10 am7 item 2: a place is told as the phrases it must be checked with (R2c: every one is a fact of its own)
    if (Array.isArray(f.phrases)) return `${head}: place phrases (every one must be its own phrase fact) ${f.phrases.map(q).join(', ')}`;
    const forms = [...(f.unit ?? []).map((/** @type {string} */ u) => `unit ${q(u)}`), ...(f.currency ?? []).map((/** @type {string} */ c) => `currency ${q(c)}`)];
    const read = f.reading ? `, limit read from your words: ${ruleWords({ shape: f.shape, unit: f.unit, currency: f.currency, rule: f.reading })}` : '';
    return `${head}: ${f.shape === 'phrase' ? 'phrase ' : f.words.length ? 'labels ' : ''}${f.words.map(q).join(', ') || '(read by its unit)'}${forms.length ? `, ${forms.join(', ')}` : ''}${read}`;
  };
  return [
    `- ${label}: a web page (${address}), saved at drafting, ${chars} characters. Code checked the page's own words for the job's rules and kept only words the saved page proves.`,
    ...(look.facts.length ? [`  Kept, line ${[...new Set(look.facts.map((/** @type {any} */ f) => f.line))].join(', ')}: ${look.facts.map(say).join('; ')}`] : ['  Kept: nothing.']),
    ...(notChecked.length
      ? ['  Code could not make these a check, so they are Not checked; never claim them as checked:', ...notChecked.map((l) => `  - ${l}`)]
      : []),
  ];
}
