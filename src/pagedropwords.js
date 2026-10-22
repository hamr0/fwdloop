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
  'reads-no-result': () => "the price rule could not read a price in the page's results, so it is not checked.",
  // borrowed-from: bareloop src/pagedropwords.js@c550dc8 (the phrase dry read's sentence)
  'phrase-no-result': (d) => `"${d.other}" is on the page but in none of its results, so it is not checked.`,
  'person-left': () => 'You chose to leave it Not checked.',
  // M10 piece 5 (item 7, am8 item 1): the signed Not-checked reasons for a job word that is not a column. `fact` = the job's word.
  'no-column': (d) => `there is no column '${d.fact}'`,
  'no-fit': (d) => `no column fits '${d.fact}'`,
  'column-tie': (d) => `two columns fit '${d.fact}' equally`,
  // M10 piece 5 (live walk 2026-10-21): the sheet look named a word that is none of the person's own; it is not used (words not signed)
  'word-not-yours': (d) => `the sheet look named '${d.fact}', which is not a word in your job, so it was not used.`,
  'column-declined': () => "you didn't take the offered column",
  // M10 piece 5 (am8 item 3): a job word that is not a .docx heading is Not checked, nothing is asked (the analogue of a missing column; words not signed)
  'no-heading': (d) => `there is no heading '${d.fact}'`,
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

// HOW THE PAGE WAS READ (M10 am11). // borrowed-from: bareloop src/pagedropwords.js@2d22c0f (isReadNote, splitReadNotes) and @e818c3f (the s1 note with a signed other fact)
// A drop of ONE WORD whose fact is still checked is a NOTE about the form code did not use, not something left unchecked; a drop of a whole fact
// stays under Not checked. Classified from the line's own words, so it holds for a signed record already on disk. bareloop builds a RegExp from the
// WORDS table; src/ has no `new RegExp(` (test/signed-text.test.js), so the same sentence shapes are matched as literal pieces here: each template is
// the WORDS sentence written once with placeholders, cut at the placeholders; a placeholder reads up to the next `"` (at least one character).
const WORD_REASONS = ['not-on-page', 'no-value', 'n2', 'r1', 'sign-twice', 'r1l', 'limit-currency', 'limit-unit', 'unit-too-long'];
const MARK = '\u0001';
/** @param {string} reason @param {boolean} [same] r1l has two sentences: a word listed twice (word = other) and a second way to write the price @returns {{lits: string[], gaps: string[]}} */
function templateOf(reason, same = false) {
  const s = WORDS[reason](/** @type {any} */ ({ word: `${MARK}w${MARK}`, other: same ? `${MARK}w${MARK}` : `${MARK}o${MARK}`, fact: `${MARK}f${MARK}`, reason, line: 0 }));
  const parts = s.split(MARK); // lit, name, lit, name, ... : the odd pieces are the placeholders' names
  return { lits: parts.filter((_, i) => i % 2 === 0), gaps: parts.filter((_, i) => i % 2 === 1) };
}
const WORD_TEMPLATES = [...WORD_REASONS.flatMap((r) => (r === 'r1l' ? [templateOf(r, true), templateOf(r, false)] : [templateOf(r)]))];
const S1_TEMPLATE = templateOf('s1');

/**
 * Read ONE sentence of `template` at `at` in `text`. Returns where it ended and what each placeholder read, or null.
 * @param {string} text @param {number} at @param {{lits: string[], gaps: string[]}} template @returns {{end: number, got: Record<string, string>}|null}
 */
function readSentence(text, at, template) {
  /** @type {Record<string, string>} */
  const got = {};
  let pos = at;
  for (let i = 0; i < template.lits.length; i += 1) {
    if (!text.startsWith(template.lits[i], pos)) return null;
    pos += template.lits[i].length;
    if (i < template.gaps.length) {
      const stop = text.indexOf('"', pos);
      if (stop <= pos) return null;
      got[template.gaps[i]] = text.slice(pos, stop);
      pos = stop;
    }
  }
  return { end: pos, got };
}

/**
 * `text` as a run of sentences, each one a word note (or an s1 note whose OTHER fact is signed): true when every sentence is one, and there is at least one.
 * @param {string} text @param {Set<string>} signed @returns {boolean}
 */
function allReadNotes(text, signed) {
  let pos = 0;
  let found = 0;
  while (pos < text.length) {
    let next = null;
    for (const t of WORD_TEMPLATES) { next = readSentence(text, pos, t); if (next) break; }
    if (!next) {
      const s1 = readSentence(text, pos, S1_TEMPLATE);
      if (s1 && signed.has(s1.got.o)) next = s1; // borrowed-from: bareloop e818c3f - an S1 copy of a SIGNED fact is a note; the other fact unsigned stays Not checked
    }
    if (!next) return false;
    found += 1;
    pos = next.end;
    if (pos < text.length) { if (text[pos] !== ' ') return false; pos += 1; }
  }
  return found > 0;
}

/**
 * @param {string} text one Not-checked line @param {string[]|null|undefined} [signed] the names of the facts the plan signs (none given: an s1 sentence stays Not checked)
 * @returns {boolean} true when the line only says which written forms of a still-checked fact were not used
 */
export function isReadNote(text, signed) {
  const s = String(text);
  if (!s.startsWith('line ')) return false;
  let i = 5;
  while (i < s.length && s[i] >= '0' && s[i] <= '9') i += 1;
  if (i === 5 || !s.startsWith(': "', i)) return false;
  const close = s.indexOf('"', i + 3); // the rule or fact name carries no quote
  if (close < 0 || !s.startsWith(' \u2014 ', close + 1)) return false;
  return allReadNotes(s.slice(close + 4), new Set(Array.isArray(signed) ? signed : []));
}

/** @param {string[]|null|undefined} items @param {string[]|null|undefined} [signed] names of the signed facts (see isReadNote)
 * @returns {{notChecked: string[], readNotes: string[]}} the lines split: what is left unchecked, and how the page was read */
export function splitReadNotes(items, signed) {
  const all = Array.isArray(items) ? items : [];
  return { notChecked: all.filter((t) => !isReadNote(t, signed)), readNotes: all.filter((t) => isReadNote(t, signed)) };
}

/** The names of the facts a signed declaration checks (every cited fact of every step). Pure. @param {any} declaration @returns {string[]} */
export function signedFactNames(declaration) {
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  return steps.flatMap((/** @type {any} */ st) => (Array.isArray(st?.close?.cited?.facts) ? st.close.cited.facts : [])
    .map((/** @type {any} */ f) => f?.name).filter((/** @type {any} */ n) => typeof n === 'string'));
}
