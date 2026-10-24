// borrowed-from: bareloop src/pagerules.js@1a0712b (numberAtEnd: @95f14b4)
// Copy of bareloop's file; the number patterns (AFTER, AFTER_CUR; BEFORE is numberAtEnd) are written as literals, not built from NUM (this repo bans dynamic patterns in src/); only the import lines point at fwdloop's src/pagebits.js (the pieces of facts.js, factwords.js, labelscan.js, rubricstep.js the rules need).
// IDEA A CORE (docs/product/ITEM33-BUILD.md "Addendum 2026-10-18 — Idea A core: build spec", section 4.2): the plain code rules that
// keep or drop each page word the AI's map named. The AI never grades: it names words, code keeps only what the saved page proves.
// Pure - no I/O, no clock, no model. The rule bodies are PORTED from the frozen POC (scratch idea-a-v2/rules.mjs and
// rules-v3-candidate.mjs; sha256 recorded in commit 0bcc5fe), with the OUT branches (R2, R2a, R2b, R2c, R3, R3U, V4, pageClaims) deleted.

import { lineRules } from './pagebits.js';
import { MAX_CURRENCIES, MAX_UNITS, MAX_UNIT_CHARS, FACT_OPS, boundOk } from './pagebits.js';
import { countExact, countPhrase, squash, normLabel } from './pagebits.js';

/**
 * @typedef {{op: string, value?: string|number, lo?: string|number, hi?: string|number}} Reading what a `~` rule means as a limit (PRD v1.107 Part 5b): the same shape as a signed fact rule
 * @typedef {{name: string, from?: string, shape: string, words?: string[], currency?: string[], unit?: string[], reading?: Reading}} MapFact the AI's map, one fact
 * @typedef {{facts: MapFact[]}} PageMap
 * @typedef {{line: number, name: string, shape: string, from: string, words: string[], unit?: string[], currency?: string[], forRule?: number, reading?: Reading}} KeptFact
 *   `words` = what the page proves: the labels of a money/number/time fact, or the alternative phrases of a phrase fact (a place is a phrase)
 * @typedef {{line: number, rule?: number, fact: string, word?: string, reason: string, other?: string}} Dropped  `other` = what the drop is compared to: the first label (R1), the primary form (R1L), the fact it would have repeated (S1)
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
const AFTER = /^\s*(?:[$€£]\s*)?(\d[\d,]*(?:\.\d+)?)/;
const AFTER_CUR = /^\s*(\d[\d,]*(?:\.\d+)?)/;
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
/** the shapes that read a value after a label */
const VALUE_SHAPES = ['money', 'time', 'number'];

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
  const list = all.filter((f) => {
    const hit = String(f.name ?? '').toLowerCase().split(/[^a-z]+/).find((w) => ORDINALS.includes(w));
    if (hit === undefined) return true;
    drop(f, undefined, 's1-name');
    return false;
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
        // the forms: units first (the U1-moved words, then the AI's listed units), then currency signs. SORT, never drop for the box (money
        // build v2): the box is position only - a sign (before the number) is a currency, any other form (a word after it) is a unit - so every
        // form the AI listed in either box is pooled and moved to the box its own shape belongs to
        const listedCurrencies = (Array.isArray(f.currency) ? f.currency : []).map(String);
        // a currency SIGN listed in BOTH unit and currency is said once: the unit copy goes (fwd F71 drafts)
        const listedUnits = (Array.isArray(f.unit) ? f.unit : []).map(String).filter((u) => {
          if (!(CURRENCY_SYMBOLS.includes(u) && listedCurrencies.includes(u))) return true;
          drop(f, u, 'sign-twice');
          return false;
        });
        // a WORD listed in both boxes is one form, said once (a record of the double listing is kept, as R1L always said it)
        for (const w of new Set(listedCurrencies.filter((c) => !CURRENCY_SYMBOLS.includes(c) && listedUnits.includes(c)))) drop(f, w, 'r1l', w);
        const pool = [...moved, ...listedUnits, ...listedCurrencies];
        const units = [...new Set(pool.filter((w) => !CURRENCY_SYMBOLS.includes(w)))].filter((u) => {
          if (countPhrase(text, u) >= 1) return true;
          drop(f, u, 'not-on-page');
          return false;
        });
        const curs = [...new Set(pool.filter((w) => CURRENCY_SYMBOLS.includes(w)))].filter((c) => {
          if (countExact(text, c) >= 1) return true;
          drop(f, c, 'not-on-page');
          return false;
        });
        /** @type {{kind: 'unit'|'currency', w: string}[]} */
        const forms = [...units.map((u) => /** @type {const} */ ({ kind: 'unit', w: u })), ...curs.map((c) => /** @type {const} */ ({ kind: 'currency', w: c }))];
        if (forms.length) {
          // R1L: every form reads the same set of numbers as the primary (the first form); one that reads more or fewer is dropped
          const read = (/** @type {{kind: string, w: string}} */ x) => (x.kind === 'unit' ? unitSet(lines, x.w) : curSet(lines, x.w));
          const ps = read(forms[0]);
          const keep = [forms[0]];
          // the same word listed as both a unit and a currency is ONE form: it is never compared with itself, only said (the unit, listed first, stays)
          for (const x of forms.slice(1)) { if (x.w !== forms[0].w && sameSet(read(x), ps)) keep.push(x); else drop(f, x.w, 'r1l', forms[0].w); }
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
