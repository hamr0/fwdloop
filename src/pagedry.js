// borrowed-from: bareloop src/pagedry.js@c61d227 (adapted: the REAL checker here is fwdloop's run-time `checkCited`, src/citedcheck.js, fed the fact exactly as it would be signed, `factsOfLook`).
// "CAN IT READ" (F241). After the page rules, a $0 dry read asks of each kept money fact whether the run-time checker can read a price on the page's own
// result lines. For every result line it checks an HONEST claim (quote = that line, value = the line's amount) with `checkCited`, the one reader the run
// itself uses - no copy of its logic here. A fact that reads no result line is dropped as `reads-no-result` and shows under Not checked.
// Throws away: nothing silently (the drop is returned). Third outcomes: a checker that stops (a fault) counts as "did not read" for that line.
// No limits, no counts, no pass bar: only "can it read". No I/O, no clock, no model. The caller is src/pagelook.js `lookAtPage`.

import { checkCited, factsOfLook } from './citedcheck.js';
import { linesOf } from './pagerules.js';

/** @typedef {import('./pagerules.js').KeptFact} KeptFact @typedef {import('./pagerules.js').Dropped} Dropped */

/** a number as the page writes it, thousands commas allowed */
const NUM = '\\d[\\d,]*(?:\\.\\d+)?';
const AFTER_LABEL = new RegExp(`^\\s*(?:[$€£]\\s*)?(${NUM})`);
const BEFORE_UNIT = new RegExp(`(${NUM})\\s*$`);
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
        for (let at = ln.indexOf(u); at !== -1 && amount === undefined; at = ln.indexOf(u, at + u.length)) amount = BEFORE_UNIT.exec(ln.slice(0, at))?.[1];
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
