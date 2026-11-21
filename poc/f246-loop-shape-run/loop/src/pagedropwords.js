// borrowed-from: bareloop src/pagedropwords.js@v0.61.0 (fc56e1f3)
// IDEA A CORE (docs/product/ITEM33-BUILD.md "Addendum 2026-10-18 — Idea A core: build spec", sections 4.6 and 7): NO SILENT DROP. The ONE place
// that writes the sentence for a word, fact or rule that a page rule dropped. The plan card, the Job tab, the confirm card and the drafter's
// block all read these words; no other file writes a drop reason (a test greps for it). Plain words, written by CODE from the drop's reason
// code, never a raw code and never model-written. `<label>` is the page's own word.

import { FACT_LANGS } from './facts.js';

/** @typedef {import('./pagerules.js').Dropped} Dropped */

/** the two ways a sign listed twice can be used once; the sentence below and the read-note probes (SENTENCE_RE) both read this one list */
const SIGN_TWICE_AS = ['currency', 'unit'];

/** reason code -> the plain sentence (`d.word` = the page's word, `d.fact` = the fact's name, `d.other` = what it was compared to) */
const WORDS = /** @type {Record<string, (d: Dropped) => string>} */ ({
  'not-on-page': (d) => `"${d.word}" is not written on the page.`,
  'no-value': (d) => `The page never shows a number right after or right before "${d.word}".`,
  'reads-no-amount': (d) => `The page never shows an amount next to "${d.word}", so it was not used to write the price.`,
  'n2': (d) => `"${d.word}" is written more than once inside one line of the page, so one result cannot show it once.`,
  'r1': (d) => `"${d.word}" does not show the same values as "${d.other}", so it was not used as a second way to read it.`,
  'sign-twice': (d) => `"${d.word}" was listed twice, as a unit and as a currency; it is used once, as the ${SIGN_TWICE_AS.find((kind) => kind === d.other) ?? 'currency'}.`,
  'r1l': (d) => d.word === d.other
    ? `"${d.word}" was listed twice, as a unit and as a currency; it is used once, as the first way to write the price.`
    : `"${d.word}" does not show the same amounts as "${d.other}", so it was not used as a second way to write the price.`,
  's1-name': () => 'One result is one record; ask for N results instead.',
  's1': (d) => `"${d.fact}" would read the same value as "${d.other}". The page gives no second label for it.`,
  'no-label': (d) => `No word on this page reads "${d.fact}" safely.`,
  'limit-currency': (d) => `Only the first 3 currencies are used; "${d.word}" was left out.`,
  'limit-unit': (d) => `Only the first 10 units are used; "${d.word}" was left out.`,
  'unit-too-long': (d) => `"${d.word}" is longer than 100 characters, so it was not used.`,
  'reads-no-result': () => "the price rule could not read a price in the page's results, so it is not checked.",
  'reads-no-time': (d) => `the page never shows a time right after "${d.other}", so it is not checked.`,
  'lang-not-on-page': (d) => `the page shows no month name in ${FACT_LANGS[/** @type {keyof typeof FACT_LANGS} */ (d.other ?? '')] ?? d.other}, so the date is not checked.`,
  'decimal-not-on-page': () => 'the page shows no amount written with a comma before the decimals, so it is not checked.',
  'phrase-no-result': (d) => `"${d.other}" is on the page but in none of its results, so it is not checked.`,
  'person-left': () => 'You chose to leave it Not checked.',
  'bad-shape': (d) => `The AI named a kind of value for "${d.fact}" that a check cannot read.`,
  // S1 (copied from fwdloop src/pagedropwords.js@v0.35.0): the Not-checked reasons for a job word that is not a column of the sheet. `fact` = the job's word.
  'no-column': (d) => `there is no column '${d.fact}'`,
  'no-fit': (d) => `no column fits '${d.fact}'`,
  'column-tie': (d) => `two columns fit '${d.fact}' equally`,
  // the sheet look named a word that is none of the person's own; it is not used
  'word-not-yours': (d) => `the sheet look named '${d.fact}', which is not a word in your job, so it was not used.`,
});

/** @param {Dropped} d @returns {string} the plain sentence for one drop */
export function dropSentence(d) {
  const f = WORDS[d.reason];
  return f ? f(d) : `"${d.word ?? d.fact}" was left out.`;
}

/**
 * One row per fact that lost something: the sentences (one per dropped word, then the fact's own), and whether the whole fact went.
 * @param {Dropped[]|undefined|null} dropped
 * @returns {{line: number, rule?: number, fact: string, full: boolean, sentences: string[]}[]}
 */
export function dropRows(dropped) {
  /** @type {Map<string, {line: number, rule?: number, fact: string, full: boolean, sentences: string[]}>} */
  const rows = new Map();
  for (const d of Array.isArray(dropped) ? dropped : []) {
    const key = `${d.line}\u0000${d.rule ?? ''}\u0000${d.fact}`;
    let row = rows.get(key);
    if (!row) { row = { line: d.line, ...(d.rule === undefined ? {} : { rule: d.rule }), fact: d.fact, full: false, sentences: [] }; rows.set(key, row); }
    if (d.word === undefined) row.full = true;
    const sentence = dropSentence(d);
    if (!row.sentences.includes(sentence)) row.sentences.push(sentence);
  }
  // a fact's own sentence ("No word ... reads it safely") reads last, after the words that were lost
  return [...rows.values()].map((r) => ({ ...r, sentences: [...r.sentences.filter((s) => !/^No word on this page reads /.test(s)), ...r.sentences.filter((s) => /^No word on this page reads /.test(s))] }));
}

/**
 * A row as one Not-checked line, in the person's own words: `line N: "<the ~ rule as written, or the fact's name>" — <sentences>`.
 * @param {{line: number, rule?: number, fact: string, sentences: string[]}} row @param {any[]|null|undefined} jobLines @param {(l: any) => string[]} rulesOf
 * @returns {string}
 */
export function dropLine(row, jobLines, rulesOf) {
  const jl = (jobLines ?? []).find((/** @type {any} */ l) => l && l.n === row.line);
  const rule = row.rule === undefined || !jl ? undefined : rulesOf(jl)[row.rule - 1];
  return `line ${row.line}: "${rule ?? row.fact}" — ${row.sentences.join(' ')}`;
}

// HOW THE PAGE WAS READ (run mvij7kuk, flight-c1): a drop of ONE WORD whose fact is still checked is a NOTE about the form code did not use, not
// something left unchecked. The sentences for those reasons are WORD-level; every other sentence (a whole fact left out) keeps the line under
// Not checked. Classified from the line's own words, so it holds for a signed spec already on disk.
const WORD_REASONS = ['not-on-page', 'no-value', 'reads-no-amount', 'n2', 'r1', 'sign-twice', 'r1l', 'limit-currency', 'limit-unit', 'unit-too-long'];
/** @param {string} s */
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SENTENCE_RE = (() => {
  const [W, O] = ['\u0001w\u0001', '\u0001o\u0001'];
  /** @type {string[]} */
  const alts = [];
  for (const reason of WORD_REASONS) {
    const probes = reason === 'r1l' ? [{ word: W, other: W }, { word: W, other: O }] : reason === 'sign-twice' ? SIGN_TWICE_AS.map((other) => ({ word: W, other })) : [{ word: W, other: O }];
    for (const p of probes) alts.push(esc(WORDS[reason](/** @type {any} */ ({ ...p, reason, line: 0, fact: 'f' }))).split(esc(W)).join('[^"]+').split(esc(O)).join('[^"]+'));
  }
  return new RegExp(`^(?:(?:${alts.join('|')})(?: |$))+$`);
})();

/** the s1 sentence as a pattern whose one capture is the OTHER fact's name (the sentence is built from the one WORDS table) */
const S1_RE = (() => {
  const [F, O] = ['\u0001f\u0001', '\u0001o\u0001'];
  return new RegExp(esc(WORDS['s1'](/** @type {any} */ ({ fact: F, other: O, reason: 's1', line: 0 }))).split(esc(F)).join('[^"]+').split(esc(O)).join('([^"]+)'), 'g');
})();

/**
 * An `s1` drop (a second fact that would read the same value as one already kept) is a NOTE when that OTHER fact is still signed: the guardrail
 * is checked by it. With the other fact not signed, or no signed list given, the sentence stays Not checked. Every sentence of a row must qualify.
 * @param {string} text one Not-checked line @param {string[]|null|undefined} [signed] the names of the facts the plan signs
 * @returns {boolean} true when the line only says which written forms of a still-checked fact were not used
 */
export function isReadNote(text, signed) {
  const m = /^line \d+: "[^"]*" \u2014 (.+)$/s.exec(String(text));
  if (m === null) return false;
  const names = new Set(Array.isArray(signed) ? signed : []);
  let found = 0;
  const rest = m[1].replace(S1_RE, (all, other) => { if (!names.has(other)) return all; found += 1; return ''; }).replace(/\s+/g, ' ').trim();
  return rest === '' ? found > 0 : SENTENCE_RE.test(rest);
}

/** @param {string[]|null|undefined} items @param {string[]|null|undefined} [signed] names of the signed facts (see isReadNote)
 * @returns {{notChecked: string[], readNotes: string[]}} the lines split: what is left unchecked, and how the page was read */
export function splitReadNotes(items, signed) {
  const all = Array.isArray(items) ? items : [];
  return { notChecked: all.filter((t) => !isReadNote(t, signed)), readNotes: all.filter((t) => isReadNote(t, signed)) };
}
