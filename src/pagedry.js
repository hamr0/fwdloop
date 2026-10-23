// borrowed-from: bareloop src/pagedry.js@c550dc8 (c61d227 + dryReadPhrases; numberAtEnd shared from pagerules.js, bareloop @95f14b4) (adapted: the REAL checker here is fwdloop's run-time `checkCited`, src/citedcheck.js, fed the fact exactly as it would be signed, `factsOfLook`).
// "CAN IT READ" (F241). After the page rules, a $0 dry read asks of each kept money fact whether the run-time checker can read a price on the page's own
// result lines. For every result line it checks an HONEST claim (quote = that line, value = the line's amount) with `checkCited`, the one reader the run
// itself uses - no copy of its logic here. A fact that reads no result line is dropped as `reads-no-result` and shows under Not checked.
// Throws away: nothing silently (the drop is returned). Third outcomes: a checker that stops (a fault) counts as "did not read" for that line.
// No limits, no counts, no pass bar: only "can it read". No I/O, no clock, no model. The caller is src/pagelook.js `lookAtPage`.

import { checkCited, factsOfLook } from './citedcheck.js';
import { linesOf, numberAtEnd } from './pagerules.js';

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
  /** @type {Set<string>} */
  const quotes = new Set();
  for (const k of facts) if (k.shape === 'money') for (const r of moneyResultLines(text, k)) quotes.add(r.quote);
  /** @type {KeptFact[]} */
  const kept = [];
  /** @type {Dropped[]} */
  const dropped = [];
  /** @type {Record<string, number>} */
  const reads = {};
  for (const k of facts) {
    if (k.shape !== 'phrase' || quotes.size === 0 || !k.words.length) { kept.push(k); continue; }
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
