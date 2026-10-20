// borrowed-from: bareloop src/factwords.js@2f93962 (keptSetOf, checkFactWords: the page-word path, where the label must be one the page-word map KEPT; bareloop's
// code-made label list (src/labelscan.js) is the other path and is not copied - a source with no look is refused as unread instead)
// M10 amendment 7 item 1 (docs/wiki/the-module-ladder.md): the facts a cited step checks are WRITTEN by the drafter and CHECKED by code at $0, before
// anything is signed. Code refuses, naming the job line, when: a label is not one the page-read kept (label-off-list); a word is not on the page
// (word-missing); a label shows up fewer times than the result count (label-rare, phrase-rare); a page rule dropped that word (word-dropped). Tighter than
// bareloop (signed): a number rule that is not in the person's own words on that line (their `~` rule, or a reading they agreed to, which is a `~` line
// too) is refused (number-unsigned). And, from item 2 (R2c), a place the page-read grew to phrases must have every phrase in the part (place-missing).
//
// Pure: no I/O, no model. Compared white-space blind. Third outcome, named: a source with no page-read (md text, a page the look never read) is a red
// `unread` - a check whose words were never proved against the source is never signed. What this throws away: nothing; every red is a sentence.

import { asList, countExact, countPhrase, normLabel, boundInWords, wordsSaidOn } from './pagebits.js';
import { dropSentence } from './pagedropwords.js';
import { factsOfLook } from './citedcheck.js';

/** @typedef {{code: string, detail: string}} WordRed */

/**
 * What the page-word map KEPT and DROPPED for one input: the sets the proof reads.
 * @param {{facts?: any[], dropped?: any[]}|null|undefined} look @param {string} source
 * @returns {{labels: Set<string>, words: Set<string>, dropped: Map<string, any>}|null} null = the page was not read by the map
 */
export function keptSetOf(look, source) {
  if (!look || !Array.isArray(look.dropped)) return null;
  const facts = (Array.isArray(look.facts) ? look.facts : []).filter((f) => f && f.source === source && Array.isArray(f.words));
  const set = (/** @type {string[]} */ a) => new Set(a.map((w) => normLabel(String(w))));
  /** @type {Map<string, any>} */
  const dropped = new Map();
  for (const d of look.dropped) if (d.source === source && typeof d.word === 'string' && !dropped.has(normLabel(d.word))) dropped.set(normLabel(d.word), d);
  return {
    labels: set(facts.filter((f) => f.shape !== 'phrase').flatMap((f) => f.words)),
    words: set(facts.flatMap((f) => [...f.words, ...(f.phrases ?? []), ...(f.unit ?? []), ...(f.currency ?? [])])),
    dropped,
  };
}

/**
 * The reds for ONE fact part against its frozen source text and what the page-word map kept.
 * @param {{part: any, text: string, line: number, kept: NonNullable<ReturnType<typeof keptSetOf>>}} o
 * @returns {WordRed[]}
 */
export function factWordReds({
  part, text, line, kept,
}) {
  /** @type {WordRed[]} */
  const reds = [];
  const src = part.source;
  const red = (/** @type {string} */ code, /** @type {string} */ msg) => reds.push({ code, detail: `line ${line}: ${msg}` });
  for (const f of Array.isArray(part.facts) ? part.facts : []) {
    const who = `fact "${f.name}"`;
    // a word the page rules DROPPED (and no other fact kept) can never come back through the drafter
    const dropRed = (/** @type {string} */ what, /** @type {unknown} */ w) => {
      const n = normLabel(String(w));
      const d = kept.dropped.get(n);
      if (!d || kept.words.has(n)) return false;
      red('word-dropped', `${who}: the ${what} ${JSON.stringify(n)} cannot be used. ${dropSentence(d)}`);
      return true;
    };
    if (f.anchor !== undefined && f.shape !== 'phrase') {
      const label = normLabel(String(f.anchor));
      if (dropRed('label', f.anchor)) { /* said above */ } else if (!kept.labels.has(label)) {
        const some = [...kept.labels].slice(0, 12).map((l) => JSON.stringify(l)).join(', ');
        red('label-off-list', `${who}: the label ${JSON.stringify(label)} is not one of the labels the page words for "${src}" kept. A label is picked from those, never typed${some ? `: ${some}` : ' (there are none - leave the label out)'}.`);
      } else if (countExact(text, label) < 1) {
        red('word-missing', `${who}: the label ${JSON.stringify(label)} is not in the input "${src}".`);
      } else if (Number.isInteger(part.count?.min) && countExact(text, label) < part.count.min) {
        const n = part.count.min;
        const seen = countExact(text, label);
        red('label-rare', `${who}: the label ${JSON.stringify(label)} is in the input "${src}" only ${seen} time${seen === 1 ? '' : 's'}, but this line asks for ${n} results, so a label that sits in each result must be there at least ${n} times. Pick a label that is counted ${n} or more times.`);
      }
    }
    if (f.until !== undefined) dropRed('closing label', f.until);
    if (f.until !== undefined && countExact(text, f.until) < 1) red('word-missing', `${who}: ${JSON.stringify(f.until)} is not in the input "${src}". Copy the closing words from the input, or leave them out.`);
    if (f.shape === 'phrase' && typeof f.phrase === 'string') {
      const seen = countPhrase(text, f.phrase);
      if (seen < 1) red('word-missing', `${who}: ${JSON.stringify(f.phrase)} is not in the input "${src}". Copy the words the input really uses, or remove the check.`);
      else if (Number.isInteger(part.count?.min) && seen < part.count.min) {
        const n = part.count.min;
        red('phrase-rare', `${who}: the words ${JSON.stringify(f.phrase)} are in the input "${src}" only ${seen} time${seen === 1 ? '' : 's'}, but this line asks for ${n} results - each result's own quote must say them. Pick words every result says, or drop this check.`);
      }
    }
    for (const u of asList(f.unit)) dropRed('unit', u);
    for (const c of asList(f.currency)) dropRed('currency', c);
    for (const u of asList(f.unit)) if (countPhrase(text, u) < 1) red('word-missing', `${who}: the unit ${JSON.stringify(u)} is not in the input "${src}". Copy the words the input really uses.`);
    for (const c of asList(f.currency)) if (countExact(text, c) < 1) red('word-missing', `${who}: the currency ${JSON.stringify(c)} is not in the input "${src}". Copy the sign the input really uses.`);
  }
  return reds;
}

/**
 * Tighter than bareloop (signed, am7 item 1): every number in a fact's rule must be in the person's own words on this job line (the line and its `~` rules;
 * an agreed reading is a `~` line too). A bound the AI made up is refused.
 * @param {{part: any, jobLine: {n: number, text?: string, rule?: string, rules?: string[]}}} o @returns {WordRed[]}
 */
export function numberRuleReds({ part, jobLine }) {
  /** @type {WordRed[]} */
  const reds = [];
  const said = wordsSaidOn(jobLine);
  for (const f of Array.isArray(part.facts) ? part.facts : []) {
    if (!f.rule || typeof f.rule !== 'object') continue;
    const bounds = f.rule.op === 'between' ? [f.rule.lo, f.rule.hi] : [f.rule.value];
    for (const b of bounds) {
      if (!boundInWords(b, said)) {
        reds.push({
          code: 'number-unsigned',
          detail: `line ${jobLine.n}: fact "${f.name}" has the number ${b} in its rule, but ${b} is not in your words on line ${jobLine.n}. A number rule must come from a ~ rule you wrote or a reading you agreed to. Change the ~ rule on line ${jobLine.n} to say it, or leave this rule out.`,
        });
      }
    }
  }
  return reds;
}

/**
 * R2c (am7 item 2): a place the page-read grew to phrases must have EVERY phrase as a phrase fact of the part, or a flipped route passes.
 * @param {{part: any, line: number, look: {facts?: any[]}|null|undefined}} o @returns {WordRed[]}
 */
export function placeReds({ part, line, look }) {
  /** @type {WordRed[]} */
  const reds = [];
  const have = new Set((Array.isArray(part.facts) ? part.facts : []).filter((/** @type {any} */ f) => f.shape === 'phrase').map((/** @type {any} */ f) => String(f.phrase)));
  for (const k of Array.isArray(look?.facts) ? look.facts : []) {
    if (k.line !== line || k.source !== part.source || !Array.isArray(k.phrases)) continue;
    for (const f of factsOfLook(k)) {
      if (!have.has(f.phrase)) {
        reds.push({
          code: 'place-missing',
          detail: `line ${line}: the place ${JSON.stringify(k.name)} must be checked with the words ${JSON.stringify(f.phrase)} (the page writes the place with its role: a result that leaves the other way does not say them). Add a phrase fact with exactly those words${k.phrases.length > 1 ? `, and one for each of: ${k.phrases.map((/** @type {string} */ p) => JSON.stringify(p)).join(', ')}` : ''}.`,
        });
      }
    }
  }
  return reds;
}

/**
 * Every word red for one cited part, in the order a person fixes them.
 * @param {{part: any, text: string|undefined, line: number, jobLine: any, look: {facts?: any[], dropped?: any[]}|null|undefined}} o @returns {WordRed[]}
 */
export function citedWordReds({
  part, text, line, jobLine, look,
}) {
  const kept = keptSetOf(look, part.source);
  if (typeof text !== 'string' || kept === null) {
    return [{ code: 'unread', detail: `line ${line}: the input "${part.source}" was not read here to prove the words against it, so a check on it cannot be drafted. A check on quotes works on a saved web page.` }];
  }
  return [...factWordReds({ part, text, line, kept }), ...numberRuleReds({ part, jobLine }), ...placeReds({ part, line, look })];
}
