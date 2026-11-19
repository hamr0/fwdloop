// borrowed-from: bareloop src/pagedry.js@c550dc8 (c61d227 + dryReadPhrases; numberAtEnd shared from pagerules.js, bareloop @95f14b4) (adapted: the REAL checker here is fwdloop's run-time `checkCited`, src/citedcheck.js, fed the fact exactly as it would be signed, `factsOfLook`).
// "CAN IT READ" (F241). After the page rules, a $0 dry read asks of each kept money fact whether the run-time checker can read a price on the page's own
// result lines. For every result line it checks an HONEST claim (quote = that line, value = the line's amount) with `checkCited`, the one reader the run
// itself uses - no copy of its logic here. A fact that reads no result line is dropped as `reads-no-result` and shows under Not checked.
// Throws away: nothing silently (the drop is returned). Third outcomes: a checker that stops (a fault) counts as "did not read" for that line.
// No limits, no counts, no pass bar: only "can it read". No I/O, no clock, no model. The caller is src/pagelook.js `lookAtPage`.

import { checkCited, factsOfLook } from './citedcheck.js';
import { linesOf, numberAtEnd } from './pagerules.js';
import { asList } from './pagebits.js';
import { redactSecrets } from './redact.js';

/** @typedef {import('./pagerules.js').KeptFact} KeptFact @typedef {import('./pagerules.js').Dropped} Dropped */

/** a number as the page writes it, thousands commas allowed: \d[\d,]*(?:\.\d+)?  (written out as literals - this repo bans dynamic patterns in src/) */
const AFTER_LABEL = /^\s*(?:[$€£]\s*)?(\d[\d,]*(?:\.\d+)?)/;
/** the name every dry-read claim is made under (the checker only needs one name; the fact's own is not read) */
const CLAIM = 'price';
const SOURCE = 'page';

/**
 * The result lines of a kept money fact: with a label, every page line where a kept label is followed by a number (one sign between allowed);
 * with no label (U1 moved it to a unit, e.g. "€533 total"), every line where a number is followed by a kept unit.
 * @param {string} text @param {KeptFact} k @returns {{quote: string, value: string}[]}
 */
export function moneyResultLines(text, k) {
  const raw = text.split('\n');
  const squashed = linesOf(text);
  /** @type {{quote: string, value: string}[]} */
  const out = [];
  squashed.forEach((ln, i) => {
    /** @type {string|undefined} */
    let amount;
    if (k.words.length) {
      for (const w of k.words) {
        for (let at = ln.indexOf(w); at !== -1 && amount === undefined; at = ln.indexOf(w, at + w.length)) amount = AFTER_LABEL.exec(ln.slice(at + w.length))?.[1];
        if (amount !== undefined) break;
      }
    } else {
      for (const u of k.unit ?? []) {
        for (let at = ln.indexOf(u); at !== -1 && amount === undefined; at = ln.indexOf(u, at + u.length)) amount = numberAtEnd(ln.slice(0, at));
        if (amount !== undefined) break;
      }
    }
    if (amount !== undefined) out.push({ quote: raw[i].trim(), value: amount.replace(/,/g, '') });
  });
  return out;
}

/**
 * The fact as the drafter would sign it (same function: `factsOfLook`), under the one claim name, with no number rule: only "can it read".
 * @param {KeptFact} k @returns {Record<string, any>}
 */
const signedOf = (k) => factsOfLook({ name: CLAIM, shape: k.shape, words: k.words, ...(k.unit ? { unit: k.unit } : {}), ...(k.currency ? { currency: k.currency } : {}) })[0];

/**
 * Dry-read every kept money fact; drop (as `reads-no-result`) the ones whose forms read no result line. Other facts pass through untouched.
 * @param {string} text the frozen page text @param {KeptFact[]} facts what the page rules kept
 * @returns {Promise<{facts: KeptFact[], dropped: Dropped[], reads: Record<string, number>, results: Record<string, number>}>}
 *   `reads` / `results` = result lines the checker read / lines found, per fact name (for tests and reports; no verdict derives from the numbers)
 */
export async function dryReadMoney(text, facts) {
  /** @type {KeptFact[]} */
  const kept = [];
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Record<string, number>} */
  const reads = {};
  /** @type {Record<string, number>} */
  const results = {};
  for (const k of facts) {
    if (k.shape !== 'money') { kept.push(k); continue; }
    const part = { source: SOURCE, facts: [signedOf(k)] };
    const lines = moneyResultLines(text, k);
    let n = 0;
    for (const r of lines) {
      const g = await checkCited({ part, text, results: [{ quote: r.quote, values: { [CLAIM]: r.value } }] });
      if (g.verdict === 'green') n += 1;
    }
    reads[k.name] = n;
    results[k.name] = lines.length;
    if (n > 0) { kept.push(k); continue; }
    dropped.push({ line: k.line, ...(k.forRule === undefined ? {} : { rule: k.forRule }), fact: k.name, reason: 'reads-no-result' });
  }
  return { facts: kept, dropped, reads, results };
}

// borrowed-from: bareloop src/pagedry.js@v0.57.0 (c18df406) (resultQuotes, phraseInNoResult: 637e76ad)
/**
 * The page's RESULT LINES: the lines the given money facts read (`moneyResultLines`), each quote once. Empty when no money fact reads a line (the result lines are then unknown).
 * The one owner of "what is a result row" for phrase facts, shared by the dry read below and by the check list's `!` rows (`phraseInNoResult`).
 * @param {string} text @param {KeptFact[]} facts @returns {string[]}
 */
export function resultQuotes(text, facts) {
  /** @type {Set<string>} */
  const quotes = new Set();
  for (const k of facts) if (k.shape === 'money') for (const r of moneyResultLines(text, k)) quotes.add(r.quote);
  return [...quotes];
}

/**
 * Is this phrase in the page but in NONE of its result lines (the `phrase-no-result` case)? Sync, for a `!` row the check list is about to build.
 * True only when result lines exist and no line holds the words (case and spacing aside, a plain substring: it never refuses a phrase the run's presence check could pass).
 * With no result line known nothing is guessed (false).
 * @param {string} text @param {KeptFact[]} moneyFacts the line's money facts @param {string} words @returns {boolean}
 */
export function phraseInNoResult(text, moneyFacts, words) {
  const rows = resultQuotes(text, moneyFacts);
  const w = words.replace(/\s+/g, ' ').trim().toLowerCase();
  return rows.length > 0 && w !== '' && !rows.some((q) => q.replace(/\s+/g, ' ').toLowerCase().includes(w));
}

/**
 * The same "can it read" for PHRASE facts (bareloop c550dc8; our failure: m10-walk-flights-3, "Rome" was on the page only in "Track prices from Madrid to
 * Rome" switches, in none of the 18 result lines, so no result could ever say it). A kept phrase fact is read against the page's RESULT LINES = the lines
 * the job's kept money facts read (`moneyResultLines`), each checked as an honest claim by the run's own `checkCited` (quote = that line; a phrase has no
 * value to write). A phrase that reads no result line is dropped whole as `phrase-no-result` and shows under Not checked. With no kept money fact the
 * result lines are unknown, so phrase facts pass through untouched (nothing is guessed about what a result is).
 * Throws away: nothing silently (the drop is returned). Third outcomes: a checker that stops counts as "did not read" for that line.
 * @param {string} text the frozen page text @param {KeptFact[]} facts what the money dry read kept
 * @returns {Promise<{facts: KeptFact[], dropped: Dropped[], reads: Record<string, number>}>} `reads` = result lines that said the phrase, per fact name
 */
export async function dryReadPhrases(text, facts) {
  const quotes = resultQuotes(text, facts);
  /** @type {KeptFact[]} */
  const kept = [];
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Record<string, number>} */
  const reads = {};
  for (const k of facts) {
    if (k.shape !== 'phrase' || quotes.length === 0 || !k.words.length) { kept.push(k); continue; }
    const part = { source: SOURCE, facts: factsOfLook({ name: CLAIM, shape: 'phrase', words: [k.words[0]] }) };
    let n = 0;
    for (const quote of quotes) {
      const g = await checkCited({ part, text, results: [{ quote, values: {} }] });
      if (g.verdict === 'green') n += 1;
    }
    reads[k.name] = n;
    if (n > 0) { kept.push(k); continue; }
    dropped.push({ line: k.line, ...(k.forRule === undefined ? {} : { rule: k.forRule }), fact: k.name, other: k.words[0], reason: 'phrase-no-result' });
  }
  return { facts: kept, dropped, reads };
}

// borrowed-from: bareloop src/pagedry.js@v0.60.0 (timeCandidateLines, CLOCK: the loose time finder asSeenOf reads; asSeenOf, AS_SEEN_MAX_LINES, AS_SEEN_MAX_CHARS: F337; hamr 2026-11-19. Not taken: dryReadTimes)
/** a clock time as the page writes it: H:MM or HH:MM, then an optional AM/PM (any case, a space between allowed) */
const CLOCK = /\d{1,2}:\d{2}(?:\s?[AaPp][Mm])?/;

/**
 * The candidate lines of a kept time fact: a LOOSE finder (it only collects). Every page line where a kept label word has a clock time anywhere
 * after it; the value is that line's first time after the label. Whether the run's checker can read it is not decided here.
 * @param {string} text @param {KeptFact} k @returns {{quote: string, value: string}[]}
 */
export function timeCandidateLines(text, k) {
  const raw = text.split('\n');
  const squashed = linesOf(text);
  /** @type {{quote: string, value: string}[]} */
  const out = [];
  squashed.forEach((ln, i) => {
    for (const w of k.words) {
      for (let at = ln.indexOf(w); at !== -1; at = ln.indexOf(w, at + w.length)) {
        const m = CLOCK.exec(ln.slice(at + w.length));
        if (m) { out.push({ quote: raw[i].trim(), value: m[0] }); return; }
      }
    }
  });
  return out;
}

/** the longest "as seen" example kept: more lines or characters than this is not a result's few label lines, so nothing is stored */
export const AS_SEEN_MAX_LINES = 12;
export const AS_SEEN_MAX_CHARS = 3000;

/**
 * AS SEEN (F337): the planner's example of one result's shape. When a signed fact's label sits on a different line than the result's first line
 * (Google Flights: the price line, then `Departure time:` on the next), the worker must copy those lines whole; the planner is the one who can
 * tell it, so the signed record keeps the exact input lines from the drafting copy. Result and label lines are found by the SAME finders the dry
 * reads use (`moneyResultLines`, `timeCandidateLines`), one line at a time, so there is no second reader of "what holds this label". The first
 * result is the first line holding the first labelled fact (money or time); its block runs to the next such line. Every other labelled fact must
 * have its label on the first line or inside the block, else nothing is stored (never a half-example). Lines are the input's own bytes (secret-masked).
 * @param {string} text the drafting copy of the input @param {any[]} facts the signed facts of one part @param {string} input the input's label
 * @returns {{input: string, lines: string[], labels: string[]} | null} null when every label is on the first line, or nothing fits
 */
export function asSeenOf(text, facts, input) {
  const lab = (Array.isArray(facts) ? facts : []).filter((f) => f && typeof f.anchor === 'string' && f.anchor !== '' && (f.shape === 'money' || f.shape === 'time'));
  if (lab.length === 0) return null;
  const raw = text.split('\n');
  /** @type {(line: string, f: any) => boolean} */
  const holds = (line, f) => {
    /** @type {KeptFact} */
    const k = { line: 0, name: String(f.name ?? ''), shape: f.shape, from: '', words: [f.anchor], ...(f.shape === 'money' ? { unit: asList(f.unit), currency: asList(f.currency), ...(f.decimal === undefined ? {} : { decimal: f.decimal }) } : {}) };
    return (f.shape === 'money' ? moneyResultLines(line, k) : timeCandidateLines(line, k)).length > 0;
  };
  const starts = [];
  for (let i = 0; i < raw.length && starts.length < 2; i++) if (holds(raw[i], lab[0])) starts.push(i);
  if (starts.length === 0) return null;
  const s = starts[0];
  const end = starts[1] ?? raw.length;
  /** @type {string[]} */
  const labels = [];
  let last = s;
  for (const f of lab.slice(1)) {
    if (holds(raw[s], f)) continue;
    let at = -1;
    for (let i = s + 1; i < end; i++) if (holds(raw[i], f)) { at = i; break; }
    if (at < 0) return null;
    labels.push(f.anchor);
    last = Math.max(last, at);
  }
  if (labels.length === 0) return null;
  const lines = raw.slice(s, last + 1);
  if (lines.length > AS_SEEN_MAX_LINES || lines.join('\n').length > AS_SEEN_MAX_CHARS) return null;
  return { input, lines: lines.map((l) => redactSecrets(l)), labels };
}
