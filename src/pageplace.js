// borrowed-from: bareloop (its scratch folder) idea-a-v2/rules.mjs@ef815eb (bareloop HEAD when copied; that file is untracked there, sha256 1057f690ee79fe3c58d51624255477894d76f4a7222683c5cdd1d8531ef1b64f)
// Copy of its growOnce, growLeft and the R2 / R2a / R2b block for a place word; R2c (every kept phrase is a fact of its own, all must be in the quote) is
// `factsOfLook` in src/citedcheck.js. M10 amendment 7 item 2 (docs/wiki/the-module-ladder.md): a place word grows LEFT to take in its role word
// ("Leaves Amsterdam Airport Schiphol", "arrives at Heathrow Airport"), so a result that leaves Heathrow and arrives at Amsterdam does not say them.
// Proof: FINDINGS F72 (R2 caught the flipped route 114/114, honest 57/57; the same phrases without growth let it pass 114/114).
//
// Pure: no I/O, no model. Throws away: a place word the longest phrase contains (R2a), a place word that shares fewer than 90% of the longest phrase's
// page lines (R2b); both come back in `trace` with the reason, never silently. Third outcome: growth that stops (line start, under 90%, tree markup) is
// said in `notes` and the word stays as it was.

import { squash } from './pagebits.js';

/** a word with tree markup in it is not a role word: growth stops there */
const MARKUP = /["[\]=]/;
/** R2 / R2b: at least this share */
const SHARE = 0.9;
/** R2: up to this many words to the left */
const MAX_GROW = 2;

/** @param {string} text @returns {string[]} the page's lines, white space squashed */
const linesOf = (text) => text.split('\n').map(squash);

/** @param {string[]} lines @param {string} phrase @returns {{li: number, at: number}[]} every occurrence, non-overlapping per line */
function occ(lines, phrase) {
  /** @type {{li: number, at: number}[]} */
  const out = [];
  const p = squash(phrase).trim();
  if (!p) return out;
  lines.forEach((ln, li) => { for (let i = ln.indexOf(p); i !== -1; i = ln.indexOf(p, i + p.length)) out.push({ li, at: i }); });
  return out;
}
/** @param {string[]} lines @param {string} phrase @returns {Set<number>} the page lines the phrase is in */
const lineSet = (lines, phrase) => new Set(occ(lines, phrase).map((o) => o.li));

/**
 * R2, one step: the phrase with the word before it, when that word is the same in at least 90% of its occurrences and holds no markup. Otherwise null.
 * @param {string[]} lines @param {string} phrase @param {string[]} notes @param {string} tag @returns {string|null}
 */
function growOnce(lines, phrase, notes, tag) {
  const os = occ(lines, phrase);
  if (os.length === 0) return null;
  /** @type {Map<string|null, number>} */
  const votes = new Map();
  for (const o of os) {
    const before = lines[o.li].slice(0, o.at);
    /** @type {string|null} */
    let w = null;
    if (before.length > 0 && !/\s$/.test(before)) w = before.slice(before.lastIndexOf(' ') + 1); // the phrase starts mid-token: the fragment is the "word"
    else { const t = before.trimEnd(); if (t) w = t.slice(t.lastIndexOf(' ') + 1); }
    votes.set(w, (votes.get(w) ?? 0) + 1);
  }
  const [word, n] = [...votes].sort((a, b) => b[1] - a[1])[0];
  if (word === null) { notes.push(`${tag}: growth stops, the word before it is the start of a line`); return null; }
  if (n / os.length < SHARE) { notes.push(`${tag}: growth stops, ${JSON.stringify(word)} comes before it ${n} of ${os.length} times, under 90%`); return null; }
  if (MARKUP.test(word)) { notes.push(`${tag}: growth stops at markup in ${JSON.stringify(word)}`); return null; }
  return `${word} ${phrase}`;
}

/**
 * R2: a phrase extended left by up to 2 words.
 * @param {string[]} lines @param {string} phrase @param {string[]} notes @param {string} tag @returns {{grown: string, steps: string[]}}
 */
export function growLeft(lines, phrase, notes, tag) {
  let p = phrase;
  /** @type {string[]} */
  const steps = [];
  for (let i = 0; i < MAX_GROW; i += 1) { const g = growOnce(lines, p, notes, tag); if (!g) break; p = g; steps.push(p); }
  return { grown: p, steps };
}

/**
 * The phrases a place fact is signed with: each kept place word grown (R2), a phrase another kept phrase contains dropped (R2a), a phrase that shares
 * under 90% of the longest phrase's page lines dropped (R2b). `grow: false` skips R2 only (the control of F72: the same phrases, no growth).
 * @param {string} text the saved page @param {string[]} words the kept words of ONE place fact, each already on the page
 * @param {{grow?: boolean}} [o]
 * @returns {{phrases: string[], notes: string[], trace: string[]}} `phrases` are all to be in a result's quote (R2c)
 */
export function placePhrases(text, words, { grow = true } = {}) {
  const lines = linesOf(text);
  /** @type {string[]} */
  const notes = [];
  /** @type {string[]} */
  const trace = [];
  let kept = [...new Set(words.map((w) => (grow ? growLeft(lines, w, notes, `R2 "${w}"`).grown : w)))];
  kept = kept.filter((a) => {
    const c = kept.find((b) => b !== a && b.includes(a));
    if (c) { trace.push(`R2a drop ${JSON.stringify(a)} in ${JSON.stringify(c)}`); return false; }
    return true;
  });
  if (kept.length > 1) {
    const longest = [...kept].sort((a, b) => b.length - a.length)[0];
    const L = lineSet(lines, longest);
    kept = kept.filter((a) => {
      if (a === longest) return true;
      const A = lineSet(lines, a);
      const share = [...L].filter((x) => A.has(x)).length / L.size;
      if (share >= SHARE) return true;
      trace.push(`R2b drop ${JSON.stringify(a)} ${(share * 100).toFixed(0)}%`);
      return false;
    });
  }
  return { phrases: kept, notes, trace };
}
