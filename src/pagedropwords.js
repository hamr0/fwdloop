// borrowed-from: bareloop src/pagedropwords.js@b56f177
// IDEA A CORE (docs/product/ITEM33-BUILD.md "Addendum 2026-10-18 — Idea A core: build spec", sections 4.6 and 7): NO SILENT DROP. The ONE place
// that writes the sentence for a word, fact or rule that a page rule dropped. The plan card, the Job tab, the confirm card and the drafter's
// block all read these words; no other file writes a drop reason (a test greps for it). Plain words, written by CODE from the drop's reason
// code, never a raw code and never model-written. `<label>` is the page's own word.

/** @typedef {import('./pagerules.js').Dropped} Dropped */

/** reason code -> the plain sentence (`d.word` = the page's word, `d.fact` = the fact's name, `d.other` = what it was compared to) */
const WORDS = /** @type {Record<string, (d: Dropped) => string>} */ ({
  'not-on-page': (d) => `"${d.word}" is not written on the page.`,
  'no-value': (d) => `The page never shows a number right after or right before "${d.word}".`,
  'n2': (d) => `"${d.word}" is written more than once inside one line of the page, so one result cannot show it once.`,
  'r1': (d) => `"${d.word}" does not show the same values as "${d.other}", so it was not used as a second way to read it.`,
  'sign-twice': (d) => `"${d.word}" was listed twice, as a unit and as a currency; it is used once, as the currency.`,
  'r1l': (d) => d.word === d.other
    ? `"${d.word}" was listed twice, as a unit and as a currency; it is used once, as the first way to write the price.`
    : `"${d.word}" does not show the same amounts as "${d.other}", so it was not used as a second way to write the price.`,
  's1-name': () => 'One result is one record; ask for N results instead.',
  's1': (d) => `"${d.fact}" would read the same value as "${d.other}". The page gives no second label for it.`,
  'no-label': (d) => `No word on this page reads "${d.fact}" safely.`,
  'limit-currency': (d) => `Only the first 3 currencies are used; "${d.word}" was left out.`,
  'limit-unit': (d) => `Only the first 10 units are used; "${d.word}" was left out.`,
  'unit-too-long': (d) => `"${d.word}" is longer than 100 characters, so it was not used.`,
  'currency-not-symbol': (d) => `"${d.word}" is not a currency sign ($, € or £); a word the page writes after the amount is read as a unit.`,
  'person-left': () => 'You chose to leave it Not checked.',
  // M10 piece 5 (item 7): a job word that is not a column of the sheet and has no column to offer in its place. `fact` = the job's word, `other` = what the finder saw.
  'no-column': (d) => `There is no column "${d.fact}" in the sheet. Only a column with numbers can be offered in its place.`,
  'no-fit': (d) => `There is no column "${d.fact}" in the sheet, and no other column has numbers in at least 90% of its ${d.other} rows.`,
  'column-tie': (d) => `There is no column "${d.fact}" in the sheet, and two columns fit equally (${d.other}), so none is offered.`,
  'bad-shape': (d) => `The AI named a kind of value for "${d.fact}" that a check cannot read.`,
});

/**
 * M10 am2 item 3: the plan card row for a `~` rule the person chose to leave Not checked ("drop it"), word for word:
 * `not checked · "<rule>" — You chose to leave it Not checked.` (the rule as the person wrote it; the sentence is the one table's).
 * @param {string} rule @returns {string}
 */
export const leftRuleLine = (rule) => `not checked · "${rule}" — ${WORDS['person-left'](/** @type {Dropped} */ ({}))}`;

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
