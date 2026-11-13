// borrowed-from: bareloop src/pagerules.js@v0.56.0 (3383cce)
// IDEA A CORE (docs/product/ITEM33-BUILD.md "Addendum 2026-10-18 — Idea A core: build spec", section 4.2): the plain code rules that
// keep or drop each page word the AI's map named. The AI never grades: it names words, code keeps only what the saved page proves.
// Pure - no I/O, no clock, no model. The rule bodies are PORTED from the frozen POC (.claude/scratch/idea-a-v2/rules.mjs and
// rules-v3-candidate.mjs; sha256 recorded in commit 0bcc5fe), with the OUT branches (R2, R2a, R2b, R2c, R3, R3U, V4, pageClaims) deleted.

import { lineRules } from './rubricstep.js';
import { MAX_CURRENCIES, MAX_UNITS, MAX_UNIT_CHARS, FACT_OPS, boundOk } from './facts.js';
import { countExact, countPhrase, squash } from './factwords.js';
import { normLabel } from './labelscan.js';

/**
 * @typedef {{op: string, value?: string|number, lo?: string|number, hi?: string|number}} Reading what a `~` rule means as a limit (PRD v1.107 Part 5b): the same shape as a signed fact rule
 * @typedef {{name: string, from?: string, shape: string, words?: string[], currency?: string[], unit?: string[], reading?: Reading, lang?: string, decimal?: string}} MapFact the AI's map, one fact
 * @typedef {{facts: MapFact[]}} PageMap
 * @typedef {{line: number, name: string, shape: string, from: string, words: string[], unit?: string[], currency?: string[], forRule?: number, reading?: Reading, lang?: string, decimal?: string}} KeptFact
 *   `words` = what the page proves: the labels of a money/number/time fact, or the alternative phrases of a phrase fact (a place is a phrase)
 * @typedef {{line: number, rule?: number, fact: string, word?: string, reason: string, other?: string}} Dropped  `other` = what the drop is compared to: the first label (R1), the primary form (R1L), the box a sign listed twice was kept in (sign-twice: unit or currency), the fact it would have repeated (S1), the phrase it looked for (phrase-no-result)
 */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Which job line, and which `~` rule under it, a map fact carries out. The map writes `from` as "line N", "line N rule M", "rule M" or
 * "job line"; anything else is the first job line.
 * @param {unknown} from @param {{n: number, text?: string, rule?: string, rules?: string[]}[]} jobLines
 * @returns {{line: number, rule?: number}}
 */
export function tieOf(from, jobLines) {
  const s = String(from ?? '');
  const lineM = /line\s*(\d+)/i.exec(s);
  const ruleM = /rule\s*(\d+)/i.exec(s);
  const first = jobLines[0]?.n ?? 1;
  let line = lineM && jobLines.some((l) => l.n === Number(lineM[1])) ? Number(lineM[1]) : null;
  const rule = ruleM ? Number(ruleM[1]) : undefined;
  if (line === null && rule !== undefined) line = jobLines.find((l) => lineRules(l).length >= rule)?.n ?? null;
  const out = { line: line ?? first };
  if (rule !== undefined && lineRules(jobLines.find((l) => l.n === out.line)).length >= rule) return { ...out, rule };
  return out;
}

/**
 * Is this a legal `reading` for a fact of this shape? Only a time or money fact carries one, with the op set and the bound types of a signed
 * fact rule (src/facts.js): no other key, no missing bound. A malformed one makes the whole map answer malformed (no repair).
 * @param {unknown} shape @param {unknown} r @returns {boolean}
 */
export function validReading(shape, r) {
  if (shape !== 'time' && shape !== 'money') return false;
  if (!isRec(r) || !FACT_OPS.includes(r.op)) return false;
  const keys = Object.keys(r).sort().join();
  return r.op === 'between' ? keys === 'hi,lo,op' && boundOk(shape, r.lo) && boundOk(shape, r.hi) : keys === 'op,value' && boundOk(shape, r.value);
}

/** @param {string} text @returns {string[]} the page's lines, white space squashed (the unit every per-line rule counts in) */
export const linesOf = (text) => text.split('\n').map(squash);

/**
 * How many times a label occurs inside ONE page line, at most (plain indexOf on squashed lines, non-overlapping): the N2 measure.
 * @param {string[]} lines @param {string} phrase @returns {number}
 */
function maxPerLine(lines, phrase) {
  const p = squash(phrase).trim();
  if (!p) return 0;
  let max = 0;
  for (const ln of lines) {
    let n = 0;
    for (let i = ln.indexOf(p); i !== -1; i = ln.indexOf(p, i + p.length)) n += 1;
    if (n > max) max = n;
  }
  return max;
}

/** the value each shape reads right after a label: a money or number is digits (a sign may come first), a time is h:mm and AM/PM */
const READ = {
  money: /^\s*[$€£]?\s*(\d[\d,]*(?:\.\d+)?)/,
  time: /^\s*(\d{1,2}:\d{2}[\s\u202f\u00a0]?[AaPp][Mm])/,
  number: /^\s*(\d[\d,]*(?:\.\d+)?)/,
  // R1 same-value only: the date words right after a label, up to the 4-digit year (a day, a month name, a year; or ISO)
  date: /^\s*(\d{4}-\d{2}-\d{2}|\S+(?:\s\S+){0,3}\s\d{4})(?!\d)/,
};

/**
 * R1 reader: the set of values of a fact's shape written right after each occurrence of a label on the page.
 * @param {string[]} lines @param {string} label @param {'money'|'time'|'number'} shape @returns {Set<string>}
 */
function valueSet(lines, label, shape) {
  /** @type {Set<string>} */
  const s = new Set();
  const p = squash(label).trim();
  if (!p) return s;
  for (const ln of lines) {
    for (let i = ln.indexOf(p); i !== -1; i = ln.indexOf(p, i + p.length)) {
      const m = READ[shape].exec(ln.slice(i + p.length));
      if (m) s.add(m[1]);
    }
  }
  return s;
}
/** @param {Set<string>} a @param {Set<string>} b @returns {boolean} */
const sameSet = (a, b) => a.size === b.size && [...a].every((x) => b.has(x));

/** a number as the page writes it: digits, thousands commas, optional decimals (a currency sign next to it is not part of it) */
const NUM = '\\d[\\d,]*(?:\\.\\d+)?';
/**
 * The number written at the very end of `s` (only whitespace after it): the leftmost match of NUM followed by `\s*$`. Shared with src/pagedry.js (one copy). Scans back from the end, so a
 * long run of digits and commas costs O(n) where a backtracking regex is quadratic.
 * @param {string} s @returns {string|undefined}
 */
export function numberAtEnd(s) {
  let e = s.length;
  while (e > 0 && /\s/.test(s[e - 1])) e--;
  /** the first digit of the digit/comma run ending at `end`, or -1 if the run holds none; a start never follows a digit, so it is the run's first digit */
  const firstDigit = (/** @type {number} */ end) => {
    let l = end;
    while (l > 0 && /[\d,]/.test(s[l - 1])) l--;
    while (l < end && s[l] === ',') l++;
    return l < end ? l : -1;
  };
  let d = e;
  while (d > 0 && /\d/.test(s[d - 1])) d--;
  if (d < e && s[d - 1] === '.') {
    const p = firstDigit(d - 1);
    if (p !== -1) return s.slice(p, e);
  }
  const p = firstDigit(e);
  return p === -1 ? undefined : s.slice(p, e);
}
/** a number as a page writes it where the decimal mark is a comma: groups of three joined by "." or a space (or none), then an optional comma and decimals */
export const NUM_COMMA = '\\d{1,3}(?:[. ]\\d{3})+(?:,\\d+)?|\\d+(?:,\\d+)?';
/**
 * {@link numberAtEnd} for a comma-decimal page: the number written at the very end of `s` (only whitespace after it), as the page writes it
 * ("1.057,65", "1 089", "48,49"). Only the last 24 characters are read (no price is longer), so a long run of digits cannot cost more than that.
 * @param {string} s @returns {string|undefined}
 */
export function numberAtEndComma(s) {
  const t = s.trimEnd();
  const tail = t.slice(-24);
  const m = new RegExp(`(?<![\\d,.])(?:${NUM_COMMA})$`).exec(tail);
  // a match that starts the tail while the text goes on to the left of it may be the end of a longer run: not a number of its own
  if (!m || (m.index === 0 && t.length > tail.length && /[\d,.]/.test(t[t.length - tail.length - 1]))) return undefined;
  return m[0];
}
const AFTER = new RegExp(`^\\s*(?:[$€£]\\s*)?(${NUM})`);
const AFTER_CUR = new RegExp(`^\\s*(${NUM})`);
const stripCommas = (/** @type {string} */ s) => s.replace(/,/g, '');

/** @param {string[]} lines @param {string} w @returns {[string, number][]} every occurrence of w as [its line, where it starts] */
function occs(lines, w) {
  /** @type {[string, number][]} */
  const out = [];
  for (const l of lines) for (let i = l.indexOf(w); i !== -1; i = l.indexOf(w, i + w.length)) out.push([l, i]);
  return out;
}

/**
 * U1: how many times a label has a number right BEFORE it (whitespace only between) and right AFTER it (whitespace and one currency sign
 * between). A marker the page writes after the number ("490 total") has B > 0 and A = 0.
 * @param {string[]} lines @param {string} label @returns {{B: number, A: number}}
 */
function beforeAfter(lines, label) {
  let B = 0;
  let A = 0;
  for (const [l, i] of occs(lines, label)) {
    if (numberAtEnd(l.slice(0, i)) !== undefined) B += 1;
    if (AFTER.test(l.slice(i + label.length))) A += 1;
  }
  return { B, A };
}
/** R1L: the numbers a UNIT form reads - the one right before each occurrence @param {string[]} lines @param {string} u @returns {Set<string>} */
const unitSet = (lines, u) => new Set(occs(lines, u).map(([l, i]) => numberAtEnd(l.slice(0, i))).filter((v) => typeof v === 'string').map((v) => stripCommas(/** @type {string} */ (v))));
/** R1L: the numbers a CURRENCY form reads - the one right after each occurrence @param {string[]} lines @param {string} c @returns {Set<string>} */
const curSet = (lines, c) => new Set(occs(lines, c).map(([l, i]) => AFTER_CUR.exec(l.slice(i + c.length))?.[1]).filter((v) => typeof v === 'string').map((v) => stripCommas(/** @type {string} */ (v))));

/** S1: a fact name that counts results ("the second flight") cannot be checked per result - one result is one record, ask for N results instead */
const ORDINALS = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'latest', 'earliest', 'newest', 'oldest', 'last', 'next', 'previous', 'final', 'nth'];

/** the symbols a currency may be (src/facts.js); a code like "EUR" is a word read after the number, so it is a unit */
const CURRENCY_SYMBOLS = ['$', '€', '£'];

/**
 * The page FORMS of a currency sign in `lines`: `glued` = right after a number ("29,99€"), `spaced` = after a number and one space ("29,99 €"),
 * `before` = in front of a number it does not itself follow ("€399", "€ 399").
 * @param {string[]} lines @param {string} sign @returns {{glued: boolean, spaced: boolean, before: boolean}}
 */
function signForms(lines, sign) {
  let glued = false; let spaced = false; let before = false;
  for (const [l, i] of occs(lines, sign)) {
    const head = l.slice(0, i);
    if (/\d$/.test(head)) glued = true;
    else if (/\d $/.test(head)) spaced = true;
    else if (/^ ?\d/.test(l.slice(i + sign.length))) before = true;
  }
  return { glued, spaced, before };
}
/** the char codes of the digits and of the "." and "," a number is written with */
const isDigitCode = (/** @type {number} */ c) => c >= 48 && c <= 57;
const isMarkCode = (/** @type {number} */ c) => c === 46 || c === 44;
/**
 * The number that ends a string: its last run of digits, "." and ",", from the run's first digit (undefined when the run holds no digit). One
 * backward scan, the linear form of /\d[\d.,]*$/ (that one re-scans a long digit run from every digit).
 * @param {string} s @returns {string | undefined}
 */
function numberBefore(s) {
  let j = s.length;
  while (j > 0 && (isDigitCode(s.charCodeAt(j - 1)) || isMarkCode(s.charCodeAt(j - 1)))) j--;
  while (j < s.length && isMarkCode(s.charCodeAt(j))) j++;
  return j < s.length ? s.slice(j) : undefined;
}
/** a number without the "." and "," marks that end it; the linear form of .replace(/[.,]+$/, '') (that one is quadratic on a long run of marks before a digit) @param {string | undefined} n */
function trimMarks(n) {
  if (n === undefined) return undefined;
  let e = n.length;
  while (e > 0 && isMarkCode(n.charCodeAt(e - 1))) e--;
  return n.slice(0, e);
}
/**
 * How the page writes the decimals of the amounts a money fact's signs touch (a sign right after a number, spaced or glued, or right before one).
 * A CLEAR comma amount ends in a comma and exactly two digits ("1.058,47", "17,00"), a CLEAR dot amount in a dot and exactly two ("29.99"); a comma or
 * dot and exactly three digits ("1,299", "1.299") is ambiguous and counts as neither. Only one kind seen = that mark; both or neither = undefined.
 * @param {string[]} lines @param {string[]} signs @returns {',' | '.' | undefined}
 */
function pageDecimal(lines, signs) {
  let comma = false; let dot = false;
  for (const sgn of signs) {
    for (const [l, i] of occs(lines, sgn)) {
      const before = numberBefore(l.slice(0, i).replace(/ $/, ''));
      const after = trimMarks(/^ ?(\d[\d.,]*)/.exec(l.slice(i + sgn.length))?.[1]);
      for (const n of [before, after]) {
        if (n === undefined) continue;
        if (/,\d{2}$/.test(n)) comma = true;
        else if (/\.\d{2}$/.test(n)) dot = true;
      }
    }
  }
  return comma === dot ? undefined : comma ? ',' : '.';
}
/** the shapes that read a value after a label */
const VALUE_SHAPES = ['money', 'time', 'number', 'date'];

/** the full month names of each language a date may be signed in (bareguard 0.27 reads these and short forms; one full name on the page proves the language is the page's) */
const MONTHS_FULL = /** @type {Record<string, string[]>} */ ({
  en: ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'],
  de: ['januar', 'februar', 'märz', 'april', 'mai', 'juni', 'juli', 'august', 'september', 'oktober', 'november', 'dezember'],
  fr: ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'],
  es: ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'],
  it: ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'],
  pt: ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'],
  nl: ['januari', 'februari', 'maart', 'april', 'mei', 'juni', 'juli', 'augustus', 'september', 'oktober', 'november', 'december'],
});
/**
 * Does the text hold a comma-decimal amount: a number that stands alone (no digit, comma or point before or after it), its whole part one run of
 * digits or groups of three joined by "." or a space, then a comma and one or two decimals. "133,330 chars" (a thousands-grouped count) is not one.
 * The linear form of /(?<![\d,.])\d{1,3}(?:[. ]\d{3})*,\d{1,2}(?![\d,]|\.\d)|(?<![\d,.])\d+,\d{1,2}(?![\d,]|\.\d)/ (that one re-scans a long
 * run of groups from every group). A start is a digit with no digit, comma or point before it; its digit run is the whole part, or the first group
 * when the run is up to three digits and groups of three follow, and only the end of that chain can carry the comma.
 * @param {string} s @returns {boolean}
 */
function hasCommaDecimal(s) {
  const n = s.length;
  const digitsAt = (/** @type {number} */ q) => { let e = q; while (e < n && isDigitCode(s.charCodeAt(e))) e++; return e; };
  const decimals = (/** @type {number} */ q) => {
    if (s[q] !== ',') return false;
    let e = q + 1;
    while (e < q + 4 && isDigitCode(s.charCodeAt(e))) e++;
    if (e - q - 1 < 1 || e - q - 1 > 2) return false;
    return s[e] !== ',' && !(s[e] === '.' && isDigitCode(s.charCodeAt(e + 1)));
  };
  /** where the chain of ([. ]\d{3}) groups that starts at a position ends; each position is walked once @type {Map<number, number>} */
  const chainEnd = new Map();
  const endOf = (/** @type {number} */ from) => {
    /** @type {number[]} */
    const path = [];
    let q = from; let end;
    for (;;) {
      const seen = chainEnd.get(q);
      if (seen !== undefined) { end = seen; break; }
      path.push(q);
      if ((s[q] === '.' || s[q] === ' ') && isDigitCode(s.charCodeAt(q + 1)) && isDigitCode(s.charCodeAt(q + 2)) && isDigitCode(s.charCodeAt(q + 3))) q += 4;
      else { end = q; break; }
    }
    for (const x of path) chainEnd.set(x, end);
    return end;
  };
  for (let p = 0; p < n;) {
    if (!isDigitCode(s.charCodeAt(p))) { p++; continue; }
    const d = digitsAt(p);
    const prev = p === 0 ? 0 : s.charCodeAt(p - 1);
    if (p === 0 || !(isDigitCode(prev) || isMarkCode(prev))) {
      if (decimals(d)) return true;
      if (d - p <= 3 && decimals(endOf(d))) return true;
    }
    p = d;
  }
  return false;
}

/**
 * Apply the rules to the AI's map over one saved page. Returns the kept facts and, for everything a rule removed, one `dropped` entry.
 * The order of the rules is the POC's (apply-v3.mjs): found-on-page, then the rules that read the page. A place is read as a phrase.
 * @param {string} text the frozen page text @param {PageMap} mapping @param {{n: number, text?: string, rule?: string, rules?: string[]}[]} jobLines
 * @returns {{facts: KeptFact[], dropped: Dropped[]}}
 */
export function applyPageRules(text, mapping, jobLines) {
  /** @type {Dropped[]} */
  const dropped = [];
  const all = Array.isArray(mapping?.facts) ? mapping.facts.filter(isRec) : [];
  /** @type {Map<MapFact, {line: number, rule?: number}>} */
  const ties = new Map(all.map((f) => [f, tieOf(f.from, jobLines)]));
  const drop = (/** @type {MapFact} */ f, /** @type {string|undefined} */ word, /** @type {string} */ reason, /** @type {string|undefined} */ other = undefined) => {
    const t = /** @type {{line: number, rule?: number}} */ (ties.get(f));
    dropped.push({ line: t.line, ...(t.rule === undefined ? {} : { rule: t.rule }), fact: String(f.name ?? ''), ...(word === undefined ? {} : { word }), reason, ...(other === undefined ? {} : { other }) });
  };

  // ---- S1, name part: a fact whose name counts results is refused before anything else reads it ----
  const named = all.filter((f) => {
    // "last" directly followed by a word ending in "ed" ("last updated", "last modified") names WHEN a thing changed, not which result: it is not a counting name
    const hit = String(f.name ?? '').toLowerCase().split(/[^a-z]+/).find((w, i, ws) => ORDINALS.includes(w) && !(w === 'last' && /ed$/.test(ws[i + 1] ?? '')));
    if (hit === undefined) return true;
    drop(f, undefined, 's1-name');
    return false;
  });

  // ---- a signed `lang` / `decimal` must really be on the page, else the whole fact is Not checked: a date in a language the page does not
  // write, or a decimal comma on a page with no comma-decimal amount, could only ever read nothing (or the wrong thing). A field on a shape that
  // does not take it (lang off a date, decimal off a number or money) is not carried; the rest of the fact stands. ----
  const list = named.filter((f) => {
    if (f.shape === 'date' && f.lang !== undefined) {
      const months = Object.hasOwn(MONTHS_FULL, String(f.lang)) ? MONTHS_FULL[String(f.lang)] : [];
      if (!months.some((m) => countPhrase(text, m) >= 1)) { drop(f, undefined, 'lang-not-on-page', String(f.lang)); return false; }
    }
    if ((f.shape === 'number' || f.shape === 'money') && f.decimal === ',' && !hasCommaDecimal(squash(text))) { drop(f, undefined, 'decimal-not-on-page', ','); return false; }
    return true;
  });

  // ---- found-on-page, then U1 and R1L for the facts that read an amount ----
  const lines = linesOf(text);
  /** @type {{f: MapFact, kept: string[], cur: string[], uni: string[], first?: string|null, anchorless?: boolean}[]} */
  const pending = [];
  for (const f of list) {
    const words = (Array.isArray(f.words) ? f.words : []).map((w) => String(w)).filter((w) => w.trim() !== '');
    if (f.shape === 'place' || f.shape === 'phrase') {
      const kept = [];
      for (const w of words) {
        const n = f.shape === 'phrase' ? countPhrase(text, w) : countExact(text, w);
        if (n >= 1) kept.push(w); else drop(f, w, 'not-on-page');
      }
      pending.push({ f, kept, cur: [], uni: [] });
    } else if (VALUE_SHAPES.includes(String(f.shape))) {
      const amount = f.shape === 'money' || f.shape === 'number';
      /** labels the page holds (and, for an amount, that have a number right after them) */
      const labels = [];
      /** the AI's labels as U1 leaves them, a word the page does not hold included: the first of these is R1's reference */
      const asListed = [];
      /** U1: labels the page writes after the number */
      const moved = [];
      for (const w0 of words) {
        const w = normLabel(w0);
        if (!w) continue;
        if (countExact(text, w) < 1) { asListed.push(w0); drop(f, w0, 'not-on-page'); continue; }
        if (amount) {
          const { B, A } = beforeAfter(lines, w);
          if (A === 0 && B > 0) { moved.push(w); continue; }
          if (A === 0 && B === 0) { drop(f, w, 'no-value'); continue; }
        }
        asListed.push(w0);
        labels.push(w);
      }
      /** @type {string[]} */ let uni = [];
      /** @type {string[]} */ let cur = [];
      if (f.shape === 'money') {
        // the forms: units first (the U1-moved words, then the AI's listed units), then currency signs. SORT, never drop for the box: the box is
        // position only. A WORD is a unit. A currency SIGN is filed by how the PAGE writes it next to the number (bareguard 0.27, ruling #68): glued
        // to the number, after it or before it, is a currency; spaced after it is a unit; both boxes when the page writes both. The box the AI
        // listed it in does not matter, and a sign listed in both boxes whose page form needs only one is said once ('sign-twice').
        const listedCurrencies = (Array.isArray(f.currency) ? f.currency : []).map(String);
        // bareguard 0.26: two units equal after whitespace normalization are one form, so trim + collapse here and the twins collapse in the pool
        const listedUnits = (Array.isArray(f.unit) ? f.unit : []).map((u) => String(u).replace(/\s+/g, ' ').trim());
        const plainUnits = listedUnits.filter((u) => !CURRENCY_SYMBOLS.includes(u));
        const plainCurrencies = listedCurrencies.filter((c) => !CURRENCY_SYMBOLS.includes(c));
        // the lines that hold this fact's label are where its sign sits next to ITS number; with no label (U1 moved it, or none) the whole page
        const scope = labels.length ? lines.filter((l) => labels.some((w) => l.includes(w))) : lines;
        /** @type {string[]} */ const signCur = [];
        /** @type {string[]} */ const signUni = [];
        for (const sgn of new Set([...listedCurrencies, ...listedUnits].filter((x) => CURRENCY_SYMBOLS.includes(x)))) {
          let fm = signForms(scope, sgn);
          if (!fm.glued && !fm.spaced && !fm.before) fm = signForms(lines, sgn);
          const asCur = fm.glued || fm.before;
          const asUni = fm.spaced;
          if (asCur || !asUni) signCur.push(sgn); // a sign with no number next to it stays a currency: the not-on-page / reads-no-result rules speak
          if (asUni) signUni.push(sgn);
          if (listedCurrencies.includes(sgn) && listedUnits.includes(sgn) && !(asCur && asUni)) drop(f, sgn, 'sign-twice', asUni ? 'unit' : 'currency');
        }
        // a WORD listed in both boxes is one form, said once (a record of the double listing is kept, as R1L always said it)
        for (const w of new Set(plainCurrencies.filter((c) => plainUnits.includes(c)))) drop(f, w, 'r1l', w);
        const units = [...new Set([...moved, ...plainUnits, ...plainCurrencies, ...signUni])].filter((u) => {
          if (CURRENCY_SYMBOLS.includes(u) ? countExact(text, u) >= 1 : countPhrase(text, u) >= 1) return true;
          drop(f, u, 'not-on-page');
          return false;
        });
        const curs = [...new Set(signCur)].filter((c) => {
          if (countExact(text, c) >= 1) return true;
          drop(f, c, 'not-on-page');
          return false;
        });
        /** @type {{kind: 'unit'|'currency', w: string}[]} */
        const forms = [...units.map((u) => /** @type {const} */ ({ kind: 'unit', w: u })), ...curs.map((c) => /** @type {const} */ ({ kind: 'currency', w: c }))];
        // A page read where the form is written (see R1L): a sign after its number reads the number before it, before its number the one after
        const read = (/** @type {{kind: string, w: string}} */ x) => {
          if (!CURRENCY_SYMBOLS.includes(x.w)) return x.kind === 'unit' ? unitSet(lines, x.w) : curSet(lines, x.w);
          const fm = signForms(lines, x.w);
          return x.kind === 'unit' || fm.glued || !fm.before ? unitSet(lines, x.w) : curSet(lines, x.w);
        };
        // a form that reads NO amount anywhere on the page ("ohne MwSt." alone on its own line) is dropped BEFORE R1L, so R1L never takes it as the
        // reference and then drops the form that does read. When no form reads anything, nothing is dropped here and the later rules speak.
        if (forms.some((x) => read(x).size > 0)) {
          for (let i = forms.length - 1; i >= 0; i -= 1) {
            if (read(forms[i]).size > 0) continue;
            drop(f, forms[i].w, 'reads-no-amount');
            forms.splice(i, 1);
          }
        }
        if (forms.length) {
          // R1L: every form reads the same set of numbers as the primary (the first form that reads); one that reads more or fewer is dropped.
          const ps = read(forms[0]);
          const keep = [forms[0]];
          // one SIGN filed in both boxes by its page forms is ONE symbol read in two forms (bareguard 0.27 counts the same amount as one price): it is
          // never compared with itself
          for (const x of forms.slice(1)) {
            if (CURRENCY_SYMBOLS.includes(x.w) && x.w === forms[0].w) keep.push(x);
            else if (x.w !== forms[0].w && sameSet(read(x), ps)) keep.push(x);
            else drop(f, x.w, 'r1l', forms[0].w);
          }
          uni = keep.filter((x) => x.kind === 'unit').map((x) => x.w);
          cur = keep.filter((x) => x.kind === 'currency').map((x) => x.w);
        }
        // the guard's list limits (src/facts.js), applied here so a longer list is cut by code and SAID, never refused later: the first forms stay
        uni = uni.filter((u, i) => {
          if (u.length > MAX_UNIT_CHARS) { drop(f, u, 'unit-too-long'); return false; }
          if (i >= MAX_UNITS) { drop(f, u, 'limit-unit'); return false; }
          return true;
        });
        cur = cur.filter((c, i) => {
          if (i < MAX_CURRENCIES) return true;
          drop(f, c, 'limit-currency');
          return false;
        });
      }
      pending.push({ f, kept: labels, cur, uni, first: asListed.length ? normLabel(asListed[0]) : null, anchorless: amount && asListed.length === 0 });
    } else drop(f, undefined, 'bad-shape');
  }

  // ---- R1, same-value: the labels after the AI's FIRST listed one are kept only if they read the same set of values as it does ----
  for (const p of pending) {
    if (!VALUE_SHAPES.includes(String(p.f.shape))) continue;
    const shape = /** @type {'money'|'time'|'number'} */ (p.f.shape);
    const ref = p.first ? valueSet(lines, p.first, shape) : new Set();
    p.kept = p.kept.filter((w) => {
      if (w === p.first) return true;
      if (sameSet(valueSet(lines, w, shape), ref)) return true;
      drop(p.f, w, 'r1', p.first ?? undefined);
      return false;
    });
  }

  // ---- N2, per line: a label written 2+ times inside one page line cannot say which value is meant, so it is unusable. (R2 grow-left is OUT.) ----
  for (const p of pending) {
    if (!VALUE_SHAPES.includes(String(p.f.shape))) continue;
    p.kept = p.kept.filter((w) => {
      if (maxPerLine(lines, w) <= 1) return true;
      drop(p.f, w, 'n2');
      return false;
    });
  }

  // ---- the kept facts, in the POC's order: places, phrases, then values ----
  /** @type {KeptFact[]} */
  const signed = [];
  const make = (/** @type {{f: MapFact, kept: string[], cur: string[], uni: string[]}} */ p) => {
    const t = /** @type {{line: number, rule?: number}} */ (ties.get(p.f));
    /** @type {KeptFact} */
    const out = { line: t.line, name: String(p.f.name), shape: p.f.shape === 'place' ? 'phrase' : String(p.f.shape), from: String(p.f.from ?? ''), words: [...p.kept] };
    if (p.f.shape === 'money') {
      if (p.uni.length) out.unit = [...p.uni];
      if (p.cur.length) out.currency = [...p.cur];
    }
    if (p.f.shape === 'date' && p.f.lang !== undefined) out.lang = String(p.f.lang);
    if ((p.f.shape === 'number' || p.f.shape === 'money') && p.f.decimal !== undefined) out.decimal = String(p.f.decimal);
    // CODE picks the decimal mark of a money fact from how the page writes the amounts its signs touch, over the AI's word when the page is clear
    // (a "1.058,47 €" page read with "." would read wrong); both kinds or neither, the AI's word stands. A clear dot page keeps what was signed
    // ("." is the reader's default, so no field is added).
    if (p.f.shape === 'money') {
      const mark = pageDecimal(lines, [...(out.currency ?? []), ...(out.unit ?? [])]);
      if (mark === ',') out.decimal = ',';
    }
    if (t.rule !== undefined) out.forRule = t.rule;
    if (validReading(out.shape, p.f.reading)) out.reading = /** @type {Reading} */ ({ ...p.f.reading });
    return out;
  };
  for (const kind of ['place', 'phrase', 'value']) {
    for (const p of pending) {
      const isValue = VALUE_SHAPES.includes(String(p.f.shape));
      if (kind === 'value' ? !isValue : p.f.shape !== kind) continue;
      // a fact left with no label is dropped, unless U1 moved every label to a unit/currency form of a money fact (it then reads that form
      // alone); a money fact also needs a currency or a unit the page holds
      const forms = p.cur.length + p.uni.length;
      const ok = p.f.shape === 'money' ? forms > 0 && (p.kept.length > 0 || p.anchorless === true) : p.kept.length > 0;
      if (!ok) { drop(p.f, undefined, 'no-label'); continue; }
      signed.push(make(p));
    }
  }
  // ---- S1, shape and label part: two facts of one result may not share a shape AND a label (they would read the same value and can never differ).
  // The first one stays; a fact with no label is keyed by its first unit or currency, so two different amounts are never confused. ----
  /** @type {Map<string, string>} */
  const seen = new Map();
  const kept = signed.filter((k) => {
    const key = `${k.shape}\u0000${k.words[0] ?? k.unit?.[0] ?? k.currency?.[0] ?? ''}`;
    const first = seen.get(key);
    if (first === undefined) { seen.set(key, k.name); return true; }
    const f = /** @type {MapFact} */ (all.find((x) => String(x.name) === k.name));
    drop(f, undefined, 's1', first);
    return false;
  });
  const order = list.map((f) => String(f.name));
  return { facts: kept.sort((a, b) => order.findIndex((n) => a.name.startsWith(n)) - order.findIndex((n) => b.name.startsWith(n))), dropped };
}
