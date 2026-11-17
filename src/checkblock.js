// borrowed-from: bareloop src/checkblock.js@v0.57.0 (c18df406)
// first ported from: bareloop src/checkblock.js@v0.56.0 (3383cce) + f148028e (M16 am2: an agreed answer's follower row takes its parent's check after the parts are numbered, 4 lines in build())
// Ported, not copied whole (M16 am3 (1)): the imports point at fwd's files (src/blockpick.js is bareloop's checkpick.js under another name), and the three patterns built from text
// (the whole-word test in `inText`, the number test in `inJob` and `matchCount`) are written by hand, because src/ builds no pattern from text (test/signed-text.test.js).
// THE CHECK BLOCK of a rubric job (hamr 2026-11-12: "goal again is simplfication and one flow one place ai suggestes ! code adds $ and code decides what worked/doable").
// ONE store: `rows`. Nothing else holds a check. Rows are `~` (the person's own rule), `!` (the agent's suggestion: a look fact, or an AI edit) and `$` (code's defaults).
// The AI's whole part is a list of proposed ROW EDITS; code judges each edit alone, matches every row against the saved page, builds every check through the bareguard-backed
// shapes, and says why a row it cannot build is Not checked. The block never removes a row: only the person (`applyAnswer`) or code (`match`) changes one.
//   fromJob -> addLook -> reconcile( match -> build -> ask ), then, while a question is open or a reply waits: apply it and reconcile the WHOLE list again.
// Pure: no I/O, no clock, no model. Rubric jobs only (repo jobs never run through it).
import { countExact, countPhrase } from './pagebits.js';
import { checkFactWords, keptSetOf } from './factwords.js';
import { isCountable, keepOrDrop, countCheck, obviousCheck, partOfPick, plainWords, sameRuleWords } from './blockpick.js';
import { dropRows, dropSentence } from './pagedropwords.js';
import { phraseInNoResult } from './pagedry.js';
import { boundInWords, rubricStepShapeReds, defaultCitedText, defaultNoteText, readLimit, holdsManyBounds, NEGATING_RE, WHY_OTHER_CURRENCY } from './rubricstep.js';
import { validReading } from './pagerules.js';
import { weekOnly, weekTokens, WEEK_ONLY_WORDS, MAX_BANG } from './checklist.js';
import { fitPlacePhrase } from './placerule.js';
import { ruleWords } from './pageask.js';
import { SIGNED_ROW_FIELDS } from './declaredclose.js';
import { factSentence, countSentence, factsOfLook } from './citedcheck.js';

/**
 * A row. `kind`: rule, fact, phrase, count, cited, numbers, floor. `by`: you (`~`), agent (`!`), default (`$`). A `~` row may carry `links` (the look's facts tied to it),
 * `pick`, `aiReading`, `left`. `state` is built or not-checked; a not-checked row always has a plain `reason`.
 * @typedef {Record<string, any>} Row
 */

/** the card's fixed words, one spelling (the renderer reads them; a test reads them too) */
export const CARD_T = Object.freeze({ count: 'result count', cited: 'every claim is backed by a quote copied from', theInput: 'the input', numbers: 'every number in the text is in a checked quote of line', withWords: 'with the words' });

/** the four row edits an AI reply may hold */
export const EDIT_OPS = Object.freeze(['add', 'reading', 'pick', 'not-checkable']);

const norm = (/** @type {unknown} */ t) => String(t ?? '').toLowerCase().replace(/\s+/g, ' ').trim();
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const proved = (/** @type {unknown} */ text, /** @type {unknown} */ w) => typeof text === 'string' && typeof w === 'string' && w.trim() !== '' && (countExact(text, w) > 0 || countPhrase(text, w) > 0);
const cleanName = (/** @type {unknown} */ n) => String(n ?? '').replace(/[^A-Za-z _-]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 64);
/** does `text` hold `w` as whole words (case and spacing aside)? One reader for "its words appear in the job" */
/** is this char a letter or a digit (any script)? @param {string|null|undefined} c */
const wordChar = (c) => c != null && c !== '' && /^[\p{L}\p{N}]/u.test(c);
/**
 * Is `w` in `text` as a whole word (a letter or a digit does not touch it on either side), case as given? Two normalised texts, compared by hand.
 * @param {unknown} text @param {unknown} w @returns {boolean}
 */
const inText = (text, w) => {
  const a = norm(w); const hay = norm(text);
  if (a === '') return false;
  for (let i = hay.indexOf(a); i !== -1; i = hay.indexOf(a, i + 1)) {
    const before = i === 0 ? null : /(.)$/su.exec(hay.slice(Math.max(0, i - 2), i))?.[1] ?? null;
    if (!wordChar(before) && !wordChar(hay.slice(i + a.length, i + a.length + 2))) return true;
  }
  return false;
};
/** is the whole number `n` in `text`, with no digit or point touching it on either side? @param {string} text @param {number|string} n @returns {boolean} */
const numberIn = (text, n) => {
  const s = String(n);
  if (s === '') return false;
  for (let i = text.indexOf(s); i !== -1; i = text.indexOf(s, i + 1)) {
    if (!/[\d.]/.test(text[i - 1] ?? '') && !/[\d.]/.test(text[i + s.length] ?? '')) return true;
  }
  return false;
};
const wordSet = (/** @type {unknown} */ t) => new Set(norm(t).match(/[\p{L}\p{N}]+/gu) ?? []);

/** the plain reasons code gives, in one place (the card, the Job tab and the Audit read them from the row) */
export const REASON = Object.freeze({
  left: 'You chose to leave it Not checked, so you judge it at Accept.',
  nothingOnPage: 'Your own words are on the line; the machine has no check for them, so you judge it at Accept.',
  cantCheck: "I can't check this on the page; waiting for your answer",
  noRule: 'No rule can check this, so you judge it at Accept.',
  waitingPick: 'waiting for your answer on the proposed check',
  waitingReading: 'waiting for your answer on the reading',
  onePerLine: 'this line finds facts, so it has no text to quote',
  manyInputs: 'the job has more than one input and code cannot pick which one the claims quote',
  oneSidedTime: 'a time limit the AI proposes must be a range, so you judge it at Accept.',
  countNeedsFact: 'a result count needs a fact to count; this line has none',
  // borrowed-from: bareloop src/checkblock.js@v0.58.0
  countNeedsSuggested: 'a result count needs a fact to count; add the suggested fact on this line to count its results',
  lookNoWords: "the page does not hold the words of the look's fact for this rule",
  afterLast: 'no more tries: Start over (rows are never changed by the AI after the last try)',
  noPick: 'No check was picked for it, so you judge it at Accept.',
  negated: 'it says what is not needed, so there is nothing to check',
  dropped: 'You dropped it.',
  suggested: 'Suggested: not in your job, so it is not checked unless you add it.',
});

/** the card lines: rows in, lines out. ONE pure function of the rows; nothing else may feed it. @param {Row[]} rows */
export function renderCard(rows) {
  return rows.filter((r) => r.kind !== 'floor' && r.state !== 'suggested' && r.state !== 'dropped' && !r.hidden).map((r) => {
    let body;
    if (r.kind === 'rule') body = `"${r.text}"${r.pick && !sameRuleWords(r.text, plainWords(r.pick)) ? ` -> ${plainWords(r.pick)}` : ''}`;
    else if (r.kind === 'count') body = `${CARD_T.count} ${r.min ?? ''}-${r.max ?? ''}`;
    else if (r.kind === 'cited') body = `${CARD_T.cited} "${r.source ?? CARD_T.theInput}"`;
    else if (r.kind === 'note') body = defaultNoteText(r.line);
    else if (r.kind === 'numbers') body = `${CARD_T.numbers} ${(r.after ?? []).join(', ')}`;
    else body = `${r.kind} "${r.name ?? r.words?.[0] ?? ''}"${(r.grown ?? r.words)?.length ? ` ${CARD_T.withWords} ${(r.grown ?? r.words).map((/** @type {string} */ w) => `"${w}"`).join(', ')}` : ''}`;
    return { key: r.key, line: r.line, by: r.by, state: r.state, reason: r.reason ?? null, text: `${r.by === 'you' ? '~' : r.by === 'agent' ? '!' : '$'} ${body}` };
  });
}

/**
 * The facts a place fit builds (hamr 2026-11-11, plain split names): one value keeps the fact's own name; a version AND a date become TWO facts, "<name> version" and "<name> date", each with its
 * own place rule. The words version, date and "and" leave the base name first, so "release version" is not named "release version version".
 * @param {string} name @param {{kind: string, value: string, rule: any}[]} strips @param {(n: string, extra: any) => any} mk
 */
function placeFacts(name, strips, mk) {
  if (strips.length === 1) return [mk(name, { shape: 'phrase', phrase: strips[0].value, place: strips[0].rule })];
  const base = String(name).replace(/\b(?:version|date|and)\b/gi, ' ').replace(/\s+/g, ' ').trim();
  const nm = (/** @type {string} */ sfx) => (base === '' ? sfx : `${base.slice(0, 64 - sfx.length - 1).trimEnd()} ${sfx}`);
  return strips.map((s) => mk(nm(s.kind), { shape: 'phrase', phrase: s.value, place: s.rule }));
}

export class CheckBlock {
  /** @param {{texts: Record<string, string>, labels: string[], maxTries?: number, countScope?: (ruleText: string) => boolean, asks?: boolean, split?: boolean, cited?: boolean}} o the frozen input texts, their labels, how many AI replies (tries) may still change a row, whether code scopes a counting `~` rule in (a pick is asked), and whether a person can be asked at all (`asks`: false = a rule code cannot settle is Not checked, a reading code proposes is built as the AI's proposal) */
  constructor({ texts, labels, maxTries = 3, countScope = () => true, asks = true, split = false, cited = true }) {
    // M16 am1: `cited: false` = no `$` cited default row on this job's lines (fwd's own quote checks stay as they are); the `$` floor stays
    this.cited = cited;
    /** the product path sets it: `!` rows split into job-derived and suggested, a suggestion code cannot build is hidden (hamr 2026-11-13). Off, every `!` row is built as before (the older callers and their tests) */
    this.split = split;
    this.countScope = countScope;
    this.asks = asks;
    this.texts = texts;
    this.labels = labels;
    this.maxTries = maxTries;
    /** @type {Row[]} the ONE store */
    this.rows = [];
    /** @type {{n: number, text: string}[]} */
    this.lines = [];
    /** @type {any[]} the look's facts as given (a `reading` edit names one) */
    this.lookFacts = [];
    /** @type {{facts: any[], dropped: any[]}|null} the look as the draft gate reads it (null = no look report: the gate proves a label against the list code made) */
    this.look = null;
    /** @type {any[]} replies waiting to be applied by `drive` */
    this.queue = [];
    /** @type {any[]} the open questions, set by `ask` */
    this.open = [];
    /** @type {string[]} the keys of questions a person did not answer */
    this.unanswered = [];
    this.tries = 0;
    /** @type {any[]} every reply's record: each edit, kept or refused with its own reason */
    this.deltaLog = [];
    /** @type {any} */
    this.closeCache = null;
    /** @type {Map<number, 'yes'|'no'|'failed'>} the note question's answer per facts-only line (src/noteask.js; code decides what it means) */
    this.notes = new Map();
  }

  textOf(/** @type {string|undefined} */ source) { return this.texts[source ?? this.labels[0] ?? ''] ?? Object.values(this.texts)[0] ?? ''; }
  /** @param {number} line @param {string} [kind] */
  rowsOn(line, kind) { return this.rows.filter((r) => r.line === line && (kind === undefined || r.kind === kind)); }
  ruleRows(/** @type {number} */ line) { return this.rows.filter((r) => r.kind === 'rule' && r.line === line); }
  /** does a `~` rule's own row say it is Not checked? Then its row is the ONE place the rule is said (its reason: the look's sentence, or the person's Drop) @param {number} line @param {number} rule */
  saysRule(line, rule) { return this.rows.some((r) => r.kind === 'rule' && r.line === line && r.rule === rule && r.state === 'not-checked' && typeof r.reason === 'string' && r.reason !== ''); }
  /** every word the person wrote on a line: the line and its `~` rules */
  said(/** @type {number} */ line) { return [this.lines.find((l) => l.n === line)?.text ?? '', ...this.ruleRows(line).map((r) => r.text)].join(' '); }
  /** @param {Row} r @returns {Row} the row as stored (a repeated key gets `#2`) */
  addRow(r) {
    const key = this.rows.some((x) => x.key === r.key) ? `${r.key}#${this.rows.filter((x) => x.key.startsWith(r.key)).length + 1}` : r.key;
    const row = { state: 'not-checked', reason: 'not yet matched', words: [], ...r, key };
    this.rows.push(row);
    return row;
  }

  // 1. the person's rules, and the `$` floor of each line
  /** @param {{n: number, text: string, rules?: string[]}[]} jobLines */
  fromJob(jobLines) {
    for (const l of jobLines) {
      this.lines.push({ n: l.n, text: l.text });
      (l.rules ?? []).forEach((t, i) => this.addRow({ key: `L${l.n}.~${i + 1}`, line: l.n, kind: 'rule', by: 'you', from: 'rule', origin: 'job', text: t, rule: i + 1 }));
      this.addRow({ key: `L${l.n}.$floor`, line: l.n, kind: 'floor', by: 'default', from: 'default', state: 'built', reason: null, text: "the file exists and its text is not empty (code's own floor)" });
    }
  }

  // 2. the look: a fact tied to a `~` rule is a LINK on that row, never a drop; any other fact is a `!` row
  /**
   * @param {any[]} facts the look's kept facts @param {any[]} [dropped] the look's drops (`look.dropped`): a whole fact a page rule left out. Its plain sentence (src/pagedropwords.js)
   * becomes the `why` of the `~` rule it was tied to, or a Not checked `!` row of its own, so every drop shows under Not checked.
   */
  addLook(facts, dropped = undefined) {
    if (Array.isArray(dropped)) this.look = { facts: this.lookFacts, dropped };
    dropped ??= [];
    for (const d of dropRows(dropped.filter((/** @type {any} */ x) => x && x.reason !== 'person-left')).filter((x) => x.full)) {
      const why = d.sentences.join(' ');
      const rr = d.rule === undefined ? undefined : this.ruleRows(d.line).find((r) => r.rule === d.rule);
      if (rr) rr.lookWhy = why;
      else this.addRow({ key: `L${d.line}.fact.${norm(d.fact)}`, line: d.line, kind: 'fact', by: 'agent', from: 'look', name: d.fact, shape: 'phrase', words: [], lookWhy: why });
    }
    for (const f of facts) {
      this.lookFacts.push(f);
      // a fact the look tied to a COUNTING `~` rule stays a fact of its own: the pick path owns that rule (R10, hamr 2026-11-09), so the rule uses no link
      const tied = Number.isInteger(f.forRule) ? this.ruleRows(f.line).find((r) => r.rule === f.forRule) : undefined;
      const row = tied && !isCountable(tied.text) ? tied : undefined;
      const carried = { name: f.name, shape: f.shape, words: [...(f.words ?? [])], unit: f.unit, currency: f.currency, decimal: f.decimal, lang: f.lang, source: f.source };
      if (row) { (row.links ??= []).push({ ...carried, reading: f.reading }); continue; }
      this.addRow({ key: `L${f.line}.fact.${norm(f.name)}`, line: f.line, kind: 'fact', by: 'agent', from: 'look', ...carried });
    }
  }

  // 3. can code check it on the saved page? Never the AI. `row.can` = {ok, how, ...} or {ok:false, why} or {ok:false, ask, ...}
  match() {
    // live draft 3 (hamr 2026-11-13: "anything not in your original job that code can check goes to Suggested"): a `!` fact whose page words are longer than what the job says ("Boston Logan International
    // Airport" for the job's "Boston") says the JOB's word; the row is then job-derived (inJob below, the one owner) and its phrase check uses that word
    if (this.split) for (const r of this.rows) if (this.isBang(r) && (r.kind === 'fact' || r.kind === 'phrase')) this.takeJobWord(r);
    for (const r of this.rows) {
      r.can = null;
      if (r.kind === 'floor') continue;
      if (r.left) r.can = { ok: false, why: REASON.left };
      else if (r.lookWhy && r.kind === 'fact' && !r.words.length) r.can = { ok: false, why: r.lookWhy };
      else if (r.kind === 'rule') this.matchRule(r);
      else if (r.kind === 'fact' || r.kind === 'phrase') this.matchBang(r);
      else if (r.kind === 'count') this.matchCount(r);
    }
    // N-1 (hamr 2026-11-13): code splits the `!` rows. Words (or the count number) in the job line or its ~ rules = JOB-DERIVED (built, Drop). Not in the job = SUGGESTED: held out of the close, offered
    // only when code has already proved it can build it (build() trials it), and switched on by the person's Add. The person's Drop removes a row for good. Never the AI.
    for (const r of this.split ? this.rows : []) {
      r.derived = undefined; r.held = false;
      if (!this.isBang(r)) continue;
      r.derived = this.inJob(r);
      // a Drop is undone through Suggested (live draft 3): the row was proved buildable, so it is offered again with Add; only a row code can still build is offered
      if (r.can?.ok && r.choice !== 'add' && (!r.derived || r.choice === 'drop')) r.held = true;
    }
  }

  /** a `!` row: the agent's fact, phrase or count (a look fact tied to a rule is a link on that rule's row, never a row of its own) */
  isBang(/** @type {Row} */ r) { return r.by === 'agent' && (r.kind === 'fact' || r.kind === 'phrase' || r.kind === 'count'); }

  /**
   * The job's own word for a `!` row: when none of its page words is in the job line or its `~` rules but a proper name the job holds (capital or digit first, 3+ characters) is a whole-word part of one
   * page word and the page holds it, the row's words become that job word. The page's long name is kept as `pageWords`; the row's other fields are untouched.
   */
  takeJobWord(/** @type {Row} */ r) {
    if (this.inJob(r)) return;
    const said = this.said(r.line);
    const names = said.match(/[\p{Lu}\p{N}][\p{L}\p{N}'’-]*(?: [\p{Lu}\p{N}][\p{L}\p{N}'’-]*)*/gu) ?? [];
    for (const w of (r.words ?? []).filter((/** @type {unknown} */ x) => typeof x === 'string')) {
      const hit = names.filter((n) => n.length >= 3 && inText(w, n) && proved(this.textOf(r.source), n)).sort((a, b) => b.length - a.length)[0];
      if (hit) { r.pageWords = r.words; r.words = [hit]; return; }
    }
  }

  /** are the row's words (or its count number, or the name it asks for a fact by) in the job line or its `~` rules? Normalised, case-insensitive */
  inJob(/** @type {Row} */ r) {
    const said = this.said(r.line);
    if (r.kind === 'count') return [r.min, r.max].filter((x) => Number.isInteger(x)).some((n) => numberIn(said, n));
    // a fact the person asked for BY NAME ("the release heading") is in the job too: the look's page words rarely echo the job's own words
    // borrowed-from: bareloop src/checkblock.js@v0.58.0
    // A phrase or place is job-derived only when its own words are in the person's text: a name the AI gave it is no proof (hamr 2026-11-15, live run mwi76vh8: "friendly" for "Select flight")
    return (r.words ?? []).some((/** @type {string} */ w) => inText(said, w)) || (r.kind === 'fact' && r.shape !== 'phrase' && r.shape !== 'place' && typeof r.name === 'string' && inText(said, r.name));
  }

  /** a `!` count row is built unless a `~` rule on its line already names the number */
  matchCount(/** @type {Row} */ r) {
    const nums = [r.min, r.max].filter((x) => Number.isInteger(x)).map(String);
    const said = this.ruleRows(r.line).find((x) => nums.some((n) => numberIn(x.text, n)));
    r.can = said ? { ok: false, why: `a ~ rule already says it: line ${r.line} rule ${said.rule} names the number` } : { ok: true, how: 'count' };
  }

  matchRule(/** @type {Row} */ r) {
    if (isCountable(r.text)) { this.matchCountRule(r); return; }
    // F-a (hamr 2026-11-13): a rule that carries a negation ("nonstop is not mandatory") says what is NOT needed; its words can never give a phrase bound ("must say"). The one negation reader is NEGATING_RE.
    const negated = NEGATING_RE.test(r.text);
    const isPhrase = (/** @type {any} */ l) => l.shape === 'phrase' || l.shape === 'place';
    if (negated && (r.links ?? []).length && (r.links ?? []).every(isPhrase)) { r.can = { ok: false, why: REASON.negated }; return; }
    const links = (r.links ?? []).filter((/** @type {any} */ l) => !(negated && isPhrase(l)) && l.words.some((/** @type {string} */ w) => proved(this.textOf(l.source), w)));
    const said = this.said(r.line);
    let ownWhy = null;
    let otherCurrency = false;
    for (const l of links) {
      let reading = l.reading;
      let ownWords = false;
      if (l.shape === 'money' || l.shape === 'time') {
        // the person's words win (hamr 2026-11-13): code's reading of the `~` words beats the look's and the AI's; theirs is used only when code cannot read the words
        const rd = this.wordsReading(l, r.text);
        // fwdloop run walk-m16-flights run-1: "under $150" on a euro fact fell back to the look's reading and checked 150 euros; a bound in another currency than the page fact is never replaced by the look's or the AI's reading
        const lim = !rd && l.shape === 'money' ? readLimit('money', r.text, l) : null;
        if (lim && 'why' in lim && lim.why === WHY_OTHER_CURRENCY) { otherCurrency = true; continue; }
        if (rd) { reading = rd; ownWords = true; }
        else if (reading === undefined) {
          const own = readLimit(l.shape, r.text, l);
          ownWhy = 'why' in own ? own.why : 'a bound in the rule is not written in your own words';
        }
      }
      reading ??= r.aiReading?.reading;
      if (l.shape === 'money' || l.shape === 'time' || l.shape === 'number' || l.shape === 'date') {
        if (reading === undefined || !validReading(l.shape, reading)) continue; // code does not guess a limit; the AI may still propose one
        const bounds = reading.op === 'between' ? [reading.lo, reading.hi] : [reading.value];
        const unsaid = bounds.some((b) => !boundInWords(b, said));
        if (unsaid && !r.agreed && this.asks) { r.can = { ok: false, ask: 'reading', link: l, reading, proposal: `${l.name} ${ruleWords({ shape: l.shape, unit: l.unit, currency: l.currency, rule: reading })}`, why: REASON.waitingReading }; return; }
        if (unsaid && l.shape === 'time' && reading.op !== 'between') { r.can = { ok: false, why: REASON.oneSidedTime }; return; }
        r.can = { ok: true, how: 'fact', link: l, reading, aiProposal: unsaid && !ownWords && !r.agreed, ...(ownWords ? { readBy: 'your words' } : {}) };
        return;
      }
      // one owner of the week-only decision (hamr 2026-11-11): a version or a date in a linked phrase is fixed words only when the person's own `~` rule names that token; else a place rule fits it or it stays Not checked
      const week = l.shape === 'phrase' ? l.words.filter((/** @type {string} */ w) => proved(this.textOf(l.source), w) && weekOnly(w)) : [];
      if (week.length && !weekTokens(week.join(' ')).some((k) => norm(r.text).includes(norm(k)))) {
        const fits = week.map((/** @type {string} */ w) => fitPlacePhrase(w, this.textOf(l.source)));
        if (fits.some((x) => x === null)) { r.can = { ok: false, why: WEEK_ONLY_WORDS }; return; }
        r.can = { ok: true, how: 'fact', link: l, reading: undefined, strips: fits[0] ?? [] };
        return;
      }
      r.can = { ok: true, how: 'fact', link: l, reading: undefined };
      return;
    }
    if (otherCurrency) { r.can = { ok: false, why: `the amount in your rule is in another currency than the page's prices, so it is not checked.` }; return; }
    if (r.links?.length && !links.length) { r.can = { ok: false, why: REASON.lookNoWords }; return; }
    if (r.origin === 'typed' || r.cantAsked) { r.can = { ok: false, why: r.aiReason ?? r.lookWhy ?? REASON.nothingOnPage }; return; }
    if (r.links?.length) { r.can = { ok: false, why: r.aiReason ?? `the look tied a fact to this rule but gave no limit, and ${ownWhy ? `in your words ${ownWhy}` : 'your own words give none code can read'}, so you judge it at Accept.` }; return; }
    r.can = this.asks ? { ok: false, ask: 'cant-check', why: r.lookWhy ?? REASON.cantCheck } : { ok: false, why: r.lookWhy ?? REASON.noRule };
  }

  /** a `~` rule that counts words, bullets, lines or sections: a settled pick builds it; else code proposes the check and asks */
  matchCountRule(/** @type {Row} */ r) {
    if (!r.pick && (r.cantAsked || !this.countScope(r.text))) { r.can = { ok: false, why: r.aiReason ?? REASON.noRule }; return; }
    if (r.pick) { r.can = { ok: true, how: 'pick' }; return; }
    // no obvious asks (hamr 2026-11-14): a rule whose words ARE the check ("exactly 3 list items") is settled as it stands, so a replaced rule never re-asks on a re-draft or a Reuse
    const obvious = obviousCheck(r.text);
    if (obvious) {
      const res = keepOrDrop(r.text, /** @type {any} */ ({ ...obvious }));
      if (res.kept) { r.pick = res.check; r.from = 'pick'; r.can = { ok: true, how: 'pick' }; return; }
    }
    const proposal = r.pickProposal ?? countCheck(r.text);
    if (!this.asks) r.can = { ok: false, why: REASON.noRule };
    else if (proposal) r.can = { ok: false, ask: 'check', proposal, why: REASON.waitingPick };
    else r.can = r.origin === 'typed' ? { ok: false, why: REASON.noRule } : { ok: false, ask: 'cant-check', why: REASON.cantCheck };
  }

  /** a `!` fact or phrase row: its words must be on the page; a version or a date is true only today, so only a place rule's fit may carry it */
  matchBang(/** @type {Row} */ r) {
    const text = this.textOf(r.source);
    const w = (r.words ?? []).filter((/** @type {unknown} */ x) => typeof x === 'string' && x.trim());
    const provedWords = w.filter((/** @type {string} */ x) => proved(text, x));
    if (provedWords.length === 0) { r.can = { ok: false, why: `the words ${w.map((/** @type {string} */ x) => `"${x}"`).join(', ') || '(none)'} are not in the input` }; return; }
    // F-a: a `!` row whose words are in a rule that says what is NOT needed is refused alone, naming the rule
    const no = this.ruleRows(r.line).find((x) => NEGATING_RE.test(x.text) && provedWords.some((/** @type {string} */ p) => inText(x.text, p)));
    if (no) { r.can = { ok: false, why: `your rule ${no.rule} says it is not needed` }; return; }
    if (provedWords.some(weekOnly)) {
      if (r.shape !== 'phrase' && r.kind !== 'phrase') { r.can = { ok: false, why: WEEK_ONLY_WORDS }; return; }
      // every week-only word must fit a place rule (else Not checked, as before); the fact is built from the first one, like a `!` row's first proved word
      const fits = provedWords.filter(weekOnly).map((/** @type {string} */ x) => fitPlacePhrase(x, text));
      if (fits.some((x) => x === null)) { r.can = { ok: false, why: WEEK_ONLY_WORDS }; return; }
      r.can = { ok: true, how: 'place', strips: fits[0] ?? [] };
      return;
    }
    // fwdloop run walk-m16-flights run-1: "Rome" was on the page (search box, toggles) but in no result row, so no run could pass it. When the line's look reads result rows (a money fact), a phrase in none of them is refused with the look's own sentence (one owner: pagedry.js + pagedropwords.js)
    // (a look fact already went through the same dry read in pagemap.js, so only the AI's own adds are read here)
    if (r.from === 'agent' && (r.shape ?? 'phrase') === 'phrase') {
      const money = this.lookFacts.filter((/** @type {any} */ f) => f.line === r.line && f.shape === 'money' && (!r.source || !f.source || f.source === r.source));
      if (phraseInNoResult(text, money, provedWords[0])) { r.can = { ok: false, why: dropSentence({ line: r.line, fact: r.name ?? provedWords[0], other: provedWords[0], reason: 'phrase-no-result' }) }; return; }
    }
    r.can = { ok: true, how: 'bang', word: provedWords[0] };
  }

  // 4. code makes every check from the rows; a row it cannot build keeps its place with its plain reason. Returns the close's stages, parts and the row map.
  build() {
    /** @type {any[]} */ const stages = [];
    /** @type {any[]} */ const parts = [];
    /** @type {{part: number, line: number, rows: string[], origin: string}[]} */ const map = [];
    /** @type {Set<number>} */ const factLines = new Set();
    for (const l of this.lines) {
      /** @type {any[]} */ const lineParts = [];
      /** @type {string[][]} */ const lineRows = [];
      this.buildLine(l, lineParts, lineRows, factLines);
      if (lineParts.length) stages.push({ name: `line-${l.n}`, kind: 'rubric-step', fromLine: [l.n], params: { step: l.n, parts: lineParts } });
      lineParts.forEach((p, i) => {
        for (const k of lineRows[i] ?? []) { const row = this.rows.find((x) => x.key === k); if (row) row.part = { line: l.n, part: i }; }
        map.push({ part: parts.length, line: l.n, rows: lineRows[i] ?? [], origin: 'code' });
        parts.push(p);
      });
    }
    // a suggestion code has not built stays off the card (Audit only, F-b); a held one is trialled: shown under Suggested only when code has proved it builds (hamr 2026-11-13)
    for (const r of this.rows.filter((x) => x.held)) this.trialOffer(r);
    if (this.split) for (const r of this.rows) r.hidden = this.isBang(r) && r.state === 'not-checked' && !r.lookWhy;
    this.closeCache = { stages, parts, map };
    return this.closeCache;
  }

  /** build the line as if this held row were on: when it builds, `offer` is the row as the card would draw it; else the row is hidden with code's reason. The rows' own state is restored */
  trialOffer(/** @type {Row} */ r) {
    const l = this.lines.find((x) => x.n === r.line);
    if (!l) return;
    const mine = this.rowsOn(r.line);
    const snap = mine.map((x) => ({ x, state: x.state, reason: x.reason, part: x.part, factNames: x.factNames }));
    r.held = false;
    /** @type {any[]} */ const parts = [];
    /** @type {string[][]} */ const rows = [];
    this.buildLine(l, parts, rows, new Set());
    const ok = r.state === 'built';
    const reason = r.reason;
    const i = rows.findIndex((k) => k.includes(r.key));
    const part = i >= 0 ? parts[i] : null;
    const names = r.factNames ?? [];
    const text = !ok || !part ? null : r.kind === 'count' ? countSentence(part) : (part.facts ?? []).filter((/** @type {any} */ f) => names.includes(f.name)).map((/** @type {any} */ f) => factSentence(f, part.source)).join('; ');
    for (const a of snap) { a.x.state = a.state; a.x.reason = a.reason; a.x.part = a.part; a.x.factNames = a.factNames; }
    r.held = true;
    if (ok && text) r.offer = { text };
    else { r.offer = null; r.held = false; r.state = 'not-checked'; r.reason = String(reason ?? 'not checked'); }
  }

  /** one line's parts: a pick part per count rule, ONE fact part carrying every fact row of the line (and its result count), then the `$` defaults */
  buildLine(/** @type {{n: number, text: string}} */ l, /** @type {any[]} */ lineParts, /** @type {string[][]} */ lineRows, /** @type {Set<number>} */ factLines) {
    /** @type {any[]} */ const facts = [];
    /** @type {{r: Row, src: string}[]} */ const factRows = [];
    /** @type {Row|null} */ let countRow = null;
    /** @type {number[]} */ const rulesCarried = [];
    /** the person's picks of this line: they follow the line's fact part on the card, as they always did (the facts, then the picks, then the defaults) @type {{p: any, key: string}[]} */
    const pickParts = [];
    for (const r of this.rowsOn(l.n)) {
      if (r.kind === 'floor') continue;
      r.part = null;
      r.grown = undefined;
      if (!r.can?.ok) { r.state = 'not-checked'; r.reason = r.can?.why ?? 'not checked'; continue; }
      if (r.held) { r.state = 'suggested'; r.reason = r.choice === 'drop' ? REASON.dropped : REASON.suggested; continue; }
      if (r.can.how === 'pick') {
        const p = partOfPick(r.pick, r.text, [r.rule]);
        const reds = rubricStepShapeReds({ step: l.n, parts: [p] }, 'trial');
        if (reds.length) { r.state = 'not-checked'; r.reason = `the pick is not a legal check: ${reds[0].detail}`; continue; }
        pickParts.push({ p, key: r.key }); r.state = 'built'; r.reason = null;
        continue;
      }
      if (r.can.how === 'count') { countRow = r; continue; }
      const built = this.factsOf(r, facts);
      if ('why' in built) { r.state = 'not-checked'; r.reason = `code could not build a legal check from it: ${built.why}`; continue; }
      facts.push(...built.fresh);
      r.factNames = built.names;
      factRows.push({ r, src: built.src });
      if (r.kind === 'rule') rulesCarried.push(r.rule);
      r.state = 'built'; r.reason = null;
    }
    if (facts.length) {
      const part = {
        text: facts.map((f) => f.name).join('; '), class: 'fact', source: factRows[0]?.src, facts,
        ...(rulesCarried.length ? { rules: rulesCarried } : {}),
        ...(countRow ? { count: { ...(Number.isInteger(countRow.min) ? { min: countRow.min } : {}), ...(Number.isInteger(countRow.max) ? { max: countRow.max } : {}) } } : {}),
      };
      const reds = rubricStepShapeReds({ step: l.n, parts: [part] }, 'trial');
      if (reds.length) for (const x of [...factRows.map((f) => f.r), ...(countRow ? [countRow] : [])]) { x.state = 'not-checked'; x.reason = `code could not build the line's fact part: ${reds[0]?.detail}`; x.part = null; }
      else {
        // M17 am4 (B3): the ONE writer of a place's grown phrases (fwd's signed R2c, M10 am7 item 2): the part holds EVERY phrase as a fact of its own, and the row holds the same words (`grown`),
        // so the card (renderCard), the plan and the Job tab say what the plan checks. A place the look did not grow keeps the one word.
        const src = factRows[0]?.src;
        const grownOf = (/** @type {any} */ f) => {
          const k = f && f.shape === 'phrase' ? /** @type {any[]} */ (this.lookFacts).find((x) => x.line === l.n && Array.isArray(x.phrases) && String(x.name) === f.name && (x.source === undefined || x.source === src)) : undefined;
          return k ? factsOfLook(k) : null;
        };
        for (const { r } of factRows) {
          const words = (r.factNames ?? []).flatMap((/** @type {string} */ n) => (grownOf(facts.find((f) => f.name === n)) ?? []).map((x) => String(x.phrase)));
          r.grown = words.length ? words : undefined;
        }
        lineParts.push({ ...part, facts: facts.flatMap((f) => grownOf(f) ?? [f]) }); lineRows.push([...factRows.map((f) => f.r.key), ...(countRow ? [countRow.key] : [])]); factLines.add(l.n); if (countRow) { countRow.state = 'built'; countRow.reason = null; } }
    // borrowed-from: bareloop src/checkblock.js@v0.58.0
    } else if (countRow) { countRow.state = 'not-checked'; countRow.reason = this.rowsOn(l.n).some((x) => x.held && (x.kind === 'fact' || x.kind === 'phrase')) ? REASON.countNeedsSuggested : REASON.countNeedsFact; }
    for (const { p, key } of pickParts) { lineParts.push(p); lineRows.push([key]); }
    this.buildDefaults(l, lineParts, lineRows, factLines);
  }

  /**
   * The fact(s) a fact-like row builds, checked alone through the bareguard shapes and against the facts already on the line.
   * @param {Row} r @param {any[]} onLine the facts already built on this line @returns {{fresh: any[], src: string, names: string[]} | {why: string}}
   */
  factsOf(r, onLine) {
    const base = r.kind === 'rule' ? r.can.link : r;
    const src = base.source ?? this.labels[0] ?? '';
    const mk = (/** @type {string} */ name, /** @type {any} */ extra) => ({ name: cleanName(name), ...extra });
    const kindFields = (/** @type {any} */ f, /** @type {string} */ anchor, /** @type {any} */ extra) => mk(f.name, {
      shape: f.shape, anchor, ...(f.unit ? { unit: f.unit } : {}), ...(f.currency ? { currency: f.currency } : {}),
      ...(f.decimal && (f.shape === 'money' || f.shape === 'number') ? { decimal: f.decimal } : {}), ...(f.lang && f.shape === 'date' ? { lang: f.lang } : {}), ...extra,
    });
    /** @type {any[]} */ let fs;
    if (r.kind === 'rule') {
      const w = base.words.find((/** @type {string} */ x) => proved(this.textOf(src), x)) ?? base.words[0];
      fs = r.can.strips ? placeFacts(base.name, r.can.strips, mk)
        : base.shape === 'phrase' ? [mk(base.name, { shape: 'phrase', phrase: w })]
        : [kindFields(base, w, { ...(r.can.reading ? { rule: r.can.reading } : {}), ...(r.can.aiProposal ? { aiProposal: true } : {}) })];
    } else if (r.can.how === 'place') fs = placeFacts(r.name ?? 'phrase', r.can.strips, mk);
    else if (r.shape === 'phrase' || r.kind === 'phrase') fs = [mk(r.name ?? `phrase ${r.words[0]}`, { shape: 'phrase', phrase: r.can.word })];
    else fs = [kindFields(r, r.can.word, {})];
    const fresh = [];
    const names = fs.map((f) => f.name);
    for (const f of fs) {
      const reds = rubricStepShapeReds({ step: r.line, parts: [{ text: 'trial', class: 'fact', source: src, facts: [f] }] }, 'trial');
      if (reds.length) return { why: String(reds[0]?.detail) };
      // the draft gate's own word checks (src/factwords.js), run here on this fact alone so a word it would refuse (a label the look dropped or never kept, a unit or sign not on the page, words
      // found fewer times than the line's result count) makes THIS row Not checked in the gate's plain words, never a red on code's whole plan
      const cnt = this.rowsOn(r.line, 'count').find((x) => x.can?.ok);
      const wordReds = checkFactWords({ part: { source: src, facts: [f], ...(cnt ? { count: { ...(Number.isInteger(cnt.min) ? { min: cnt.min } : {}), ...(Number.isInteger(cnt.max) ? { max: cnt.max } : {}) } } : {}) }, text: this.textOf(src), line: r.line, kept: keptSetOf(this.look, src) });
      if (wordReds.length) return { why: String(wordReds[0].detail) };
      const same = [...onLine, ...fresh].find((x) => x.name.toLowerCase() === f.name.toLowerCase());
      if (same && JSON.stringify(same) === JSON.stringify(f)) continue; // the very same fact already carries another rule: one fact, both rules
      if (same) return { why: `the name "${f.name}" is used twice on this line` };
      fresh.push(f);
    }
    return { fresh, src, names };
  }

  /** the `$` defaults of a line, decided from what the line ended with: a text line quotes its input (one input only) and ties its numbers to the fact lines before it */
  buildDefaults(/** @type {{n: number}} */ l, /** @type {any[]} */ lineParts, /** @type {string[][]} */ lineRows, /** @type {Set<number>} */ factLines) {
    // M16 am1: with `cited: false` the cited row is never added and the numbers default below still runs
    const cited = !this.cited ? null : this.rowsOn(l.n, 'cited')[0] ?? this.addRow({ key: `L${l.n}.$cited`, line: l.n, kind: 'cited', by: 'default', from: 'default', source: this.labels[0] });
    const numbers = this.rowsOn(l.n, 'numbers')[0] ?? null;
    if (cited) cited.part = null;
    if (factLines.has(l.n)) { if (cited) { cited.state = 'not-checked'; cited.reason = REASON.onePerLine; } this.buildNote(l, lineParts, lineRows); return; }
    const only = this.labels.length === 1 ? this.labels[0] : null;
    if (cited && only) { lineParts.push({ text: defaultCitedText(only), class: 'countable', check: 'cited', source: only }); lineRows.push([cited.key]); cited.state = 'built'; cited.reason = null; }
    else if (cited) { cited.state = 'not-checked'; cited.reason = REASON.manyInputs; }
    const earlier = [...factLines].filter((n) => n < l.n);
    if (!earlier.length) return;
    const nr = numbers ?? this.addRow({ key: `L${l.n}.$numbers`, line: l.n, kind: 'numbers', by: 'default', from: 'default', after: earlier });
    lineParts.push({ text: 'every number in the text is in a checked quote', class: 'countable', check: 'numbersFromFacts', from: earlier });
    lineRows.push([nr.key]); nr.state = 'built'; nr.reason = null; nr.part = null;
  }

  // borrowed-from: bareloop src/checkblock.js@v0.57.0 (c18df406) (buildNote, factOnlyLines, setNotes)
  /**
   * The `$` note row of a facts-only line: the one note question said yes -> a countable nonEmpty text part sits beside the facts (the existing keep-both shape), so the brief
   * is FACTS AND TEXT and text-present is floored; no -> nothing; the call failed -> a Not checked row in plain words. One owner of the row and its part.
   */
  buildNote(/** @type {{n: number}} */ l, /** @type {any[]} */ lineParts, /** @type {string[][]} */ lineRows) {
    const ans = this.notes.get(l.n);
    if (ans !== 'yes' && ans !== 'failed') return;
    const row = this.rowsOn(l.n, 'note')[0] ?? this.addRow({ key: `L${l.n}.$note`, line: l.n, kind: 'note', by: 'default', from: 'default' });
    if (ans === 'failed') { row.state = 'not-checked'; row.reason = `could not ask whether line ${l.n} also wants a note`; row.part = null; return; }
    lineParts.push({ text: defaultNoteText(l.n), class: 'countable', check: 'nonEmpty' });
    lineRows.push([row.key]); row.state = 'built'; row.reason = null;
  }

  /** the job lines that ended up facts-only (a fact part and no text beside it): the lines the note question is about. Reconciles first. @returns {number[]} */
  factOnlyLines() {
    const c = this.reconcile();
    return c.stages.filter((/** @type {any} */ st) => st.params.parts.some((/** @type {any} */ p) => p.class === 'fact') && !st.params.parts.some((/** @type {any} */ p) => p.class === 'countable')).map((/** @type {any} */ st) => st.params.step);
  }

  /** the note question's answers, `{line, answer: 'yes'|'no'|'failed'}`; the whole list is reconciled again @param {{line: number, answer: 'yes'|'no'|'failed'}[]} answers */
  setNotes(answers) { for (const a of answers) this.notes.set(a.line, a.answer); this.reconcile(); }

  // 5. the code-forced questions for rows code cannot settle (a person answers; the CHOICE decides, never the words). Cap 3 is the caller's (MAX_QUESTIONS).
  ask() {
    this.open = [];
    for (const r of this.rows) {
      if (!r.can?.ask) continue;
      this.open.push({ key: `${r.key}:${r.can.ask}`, rowKey: r.key, line: r.line, ruleText: r.text, ask: r.can.ask, proposal: r.can.proposal ?? null, offers: { agree: r.can.proposal != null, drop: true } });
    }
    return this.open;
  }
  hasOpenQuestions() { return this.open.length > 0; }
  hasPendingDelta() { return this.queue.length > 0; }

  // 6. the person's answer: a row edit from the typed CHOICE (agree | drop | rule). ONE rule in, ONE rule out (hamr 2026-11-14, superseding the 2026-11-12 ruling that an agreed answer is a new `~` line):
  // the answer REPLACES the asked rule, same line and same rule number; this list is the one owner (the job text is rebuilt from it, `jobLinesView`).
  /** @param {string} qKey @param {string} choice @param {string} [text] @returns {{ok: true} | {ok: false, why: string}} */
  applyAnswer(qKey, choice, text) {
    const q = this.open.find((x) => x.key === qKey);
    const r = q ? this.rows.find((x) => x.key === q.rowKey) : undefined;
    if (!q || !r) return { ok: false, why: 'out of date' };
    if (choice === 'agree') {
      if (!q.offers.agree) return { ok: false, why: 'that choice is not offered for this question' };
      let said = String(q.proposal);
      if (q.ask === 'check') {
        const res = keepOrDrop(r.text, /** @type {any} */ ({ ...q.proposal }));
        if (!res.kept) return { ok: false, why: String(res.why) };
        r.pick = res.check; r.from = 'pick';
        said = plainWords(/** @type {any} */ (res.check));
      } else r.agreed = true;
      r.text = said;
      return { ok: true };
    }
    if (choice === 'drop') { r.left = true; return { ok: true }; }
    if (choice === 'rule') {
      const said = String(text ?? '').replace(/\s+/g, ' ').trim();
      if (!said) return { ok: false, why: 'an answer is needed' };
      // the person's own words are the rule now (typed); a counting rule is judged again as written (settled when its words are the proposal), any other stays the person's to judge
      r.text = said; r.origin = 'typed'; r.cantAsked = !isCountable(said);
      return { ok: true };
    }
    return { ok: false, why: 'not one of the choices' };
  }

  /**
   * The job lines as the list now holds them: every line's `~` rules are the rule rows' own words, in rule order (a replaced rule keeps its place and number). ONE owner of the job text after an answer.
   * @template {{n: number, text: string}} L @param {L[]} jobLines @returns {(L & {rule: string, rules: string[]})[]}
   */
  jobLinesView(jobLines) {
    return jobLines.map((l) => {
      const rules = this.ruleRows(l.n).sort((a, b) => a.rule - b.rule).map((r) => String(r.text));
      return { ...l, rule: rules.join('; '), rules };
    });
  }

  /**
   * Revise keeps the picks of the last draft (am17/am18, `src/pickrecord.js` `matchRecord`): a kept pick settles its rule (its words are the final rule's words) and a kept left rule is left.
   * @param {{picks?: {line: number, rule: number, check: any, own?: boolean}[], left?: {line: number, rule: number}[]}} kept
   */
  carry({ picks = [], left = [] }) {
    const rowOf = (/** @type {number} */ line, /** @type {number} */ rule) => this.ruleRows(line).find((x) => x.rule === rule);
    for (const p of picks) {
      const r = rowOf(p.line, p.rule);
      if (!r) continue;
      if (p.check) { r.pick = p.check; r.from = 'pick'; r.keptFromLast = true; } else { r.cantAsked = !isCountable(r.text); r.keptFromLast = true; }
    }
    for (const l of left) { const r = rowOf(l.line, l.rule); if (r) { r.left = true; r.keptFromLast = true; } }
  }

  // 7. the AI's reply: a list of proposed ROW edits, each judged ALONE; a bad edit is refused on its own and costs the rest nothing
  /** @param {{label?: string, pre?: boolean, edits?: any[]}} delta `pre` = a reply that is not a drafter try (the suggest call): it does not count against the tries */
  applyDelta(delta) {
    const pre = delta.pre === true;
    const rec = { label: delta.label, pre, edits: /** @type {any[]} */ ([]) };
    if (!pre) this.tries += 1;
    const over = !pre && this.tries > this.maxTries;
    const kept = { adds: 0 }; // the cap counts the checks KEPT from this ONE reply, in order (MAX_BANG): every extra is refused alone
    for (const e of delta.edits ?? []) {
      const out = { ...e, accepted: false };
      try { Object.assign(out, over ? { refusedBecause: REASON.afterLast } : this.applyEdit(e, kept)); }
      catch (x) { out.refusedBecause = `the edit could not be read: ${String(/** @type {any} */ (x)?.message ?? x).slice(0, 80)}`; }
      rec.edits.push(out);
    }
    this.deltaLog.push(rec);
    return rec;
  }

  applyEdit(/** @type {any} */ e, /** @type {{adds: number}} */ kept) {
    if (!isRec(e) || !EDIT_OPS.includes(e.op)) return { refusedBecause: `"${e?.op}" is not a row edit (the AI never sends a check or a part)` };
    if (!Number.isInteger(e.line) || !this.lines.some((l) => l.n === e.line)) return { refusedBecause: 'names a job line that does not exist' };
    if (e.op === 'add') {
      if (kept.adds >= MAX_BANG) return { refusedBecause: `more than ${MAX_BANG} checks proposed` };
      const res = this.editAdd(e);
      if (res.accepted) kept.adds += 1;
      return res;
    }
    if (e.op === 'reading') return this.editReading(e);
    if (e.op === 'pick') return this.editPick(e);
    return this.editNot(e);
  }

  editAdd(/** @type {any} */ e) {
    if (e.kind === 'count') return this.addCount(e);
    if (e.kind !== 'fact' && e.kind !== 'phrase') return { refusedBecause: 'an add is a fact, a phrase or a count' };
    // an input the job does not have is refused alone (it would otherwise reach the draft gate as a red on code's own plan and stop the whole draft)
    if (e.source !== undefined && e.source !== null && !this.labels.includes(e.source)) return { refusedBecause: `"${String(e.source).slice(0, 60)}" is not one of the inputs` };
    // a job with more than one input never guesses which one an add quotes (code fills a missing source only when there is exactly one)
    if ((e.source === undefined || e.source === null) && this.labels.length > 1) return { refusedBecause: `names no input; the job has ${this.labels.length}: ${this.labels.map((/** @type {string} */ l) => `"${l}"`).join(', ')}` };
    const words = (Array.isArray(e.words) ? e.words : []).filter((/** @type {unknown} */ w) => typeof w === 'string' && w.trim());
    if (!words.length) return { refusedBecause: 'no words given' };
    if (!words.some((/** @type {string} */ w) => proved(this.textOf(e.source), w))) return { refusedBecause: `the words ${words.map((/** @type {string} */ w) => `"${w}"`).join(', ')} are not in the input` };
    const name = cleanName(e.name ?? words[0]);
    if (!name) return { refusedBecause: 'no usable name' };
    const dup = this.onTheList(e.line, name, words);
    if (dup) return { refusedBecause: dup };
    const row = this.addRow({ key: `L${e.line}.${e.kind === 'phrase' ? 'phrase' : 'fact'}.${norm(e.kind === 'phrase' ? words[0] : name)}`, line: e.line, kind: e.kind, by: 'agent', from: 'agent', name, shape: e.shape ?? 'phrase', words, unit: e.unit, currency: e.currency, decimal: e.decimal, lang: e.lang, source: e.source });
    return { accepted: true, landedKey: row.key };
  }

  /** @returns {string|null} the plain reason an add repeats what the list already holds (a look fact tied to a `~` rule, a `~` rule's own words, another `!` row), else null */
  onTheList(/** @type {number} */ line, /** @type {string} */ name, /** @type {string[]} */ words) {
    for (const rr of this.ruleRows(line)) {
      for (const l of rr.links ?? []) {
        const lw = (l.words ?? []).map(norm);
        if (norm(l.name) === norm(name) || words.some((w) => lw.includes(norm(w)))) return `already on the list: the look's fact "${l.name}" is tied to your rule ${rr.rule} on line ${line}`;
      }
    }
    const wset = wordSet(words[0]);
    for (const rr of this.ruleRows(line)) {
      const rs = wordSet(rr.text);
      if (wset.size && [...wset].every((w) => rs.has(w))) return `already on the list: a ~ rule says it (line ${line} rule ${rr.rule})`;
    }
    if (this.rows.some((r) => (r.kind === 'fact' || r.kind === 'phrase') && r.line === line && (norm(r.name) === norm(name) || norm(r.words?.[0]) === norm(words[0])))) return 'already on the list';
    return null;
  }

  addCount(/** @type {any} */ e) {
    const ok = (/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1;
    if (![e.min, e.max].some(Number.isInteger) || [e.min, e.max].some((x) => x !== undefined && !ok(x)) || (Number.isInteger(e.min) && Number.isInteger(e.max) && e.min > e.max)) return { refusedBecause: 'no legal number given' };
    if (this.rowsOn(e.line, 'count').length) return { refusedBecause: 'already on the list: this line has a result count' };
    const row = this.addRow({ key: `L${e.line}.count.${e.min ?? ''}-${e.max ?? ''}`, line: e.line, kind: 'count', by: 'agent', from: 'agent', min: e.min, max: e.max });
    return { accepted: true, landedKey: row.key };
  }

  /** the `~` rule rows of a line an edit names by number */
  targetsOf(/** @type {any} */ e) {
    return (Array.isArray(e.rules) ? e.rules : []).map((/** @type {number} */ n) => this.ruleRows(e.line).find((r) => r.rule === n)).filter((/** @type {Row|undefined} */ r) => r !== undefined);
  }

  /** the one owner of "what do the person's own words say": code's reading of a `~` rule for a money/time fact, or undefined when it cannot read it */
  wordsReading(/** @type {any} */ l, /** @type {string} */ text) {
    if (l.shape !== 'money' && l.shape !== 'time') return undefined;
    const own = readLimit(l.shape, text, l);
    const rd = 'reading' in own ? own.reading : undefined;
    return rd && validReading(l.shape, rd) && (rd.op === 'between' ? [rd.lo, rd.hi] : [rd.value]).every((b) => boundInWords(b, text)) ? rd : undefined;
  }

  editReading(/** @type {any} */ e) {
    const targets = this.targetsOf(e);
    if (!targets.length) return { refusedBecause: 'names no ~ rule of this line' };
    const fact = this.lookFacts.find((f) => f.line === e.line && norm(f.name) === norm(e.fact));
    if (!fact) return { refusedBecause: `no look fact named "${String(e.fact ?? '').slice(0, 60)}" on line ${e.line}` };
    if (!validReading(fact.shape, e.reading)) return { refusedBecause: 'not a legal reading for that fact shape' };
    const many = targets.find((/** @type {Row} */ r) => holdsManyBounds(fact.shape, r.text));
    if (many) return { refusedBecause: `your rule ${many.rule} holds more than one amount or range, so one reading would be a wrong check` };
    const read = targets.map((/** @type {Row} */ r) => ({ r, rd: this.wordsReading(fact, r.text) })).find((x) => x.rd && JSON.stringify(x.rd) !== JSON.stringify(e.reading));
    if (read) return { refusedBecause: `code reads your words in rule ${read.r.rule} itself, so that reading is not used` };
    const open = targets.filter((/** @type {Row} */ r) => !r.links?.some((/** @type {any} */ l) => l.reading) && !r.aiReading);
    if (!open.length) return { refusedBecause: 'already on the list: the look or an earlier reading already reads that rule' };
    for (const r of open) {
      r.aiReading = { fact: fact.name, reading: e.reading };
      if (!r.links?.length) (r.links ??= []).push({ name: fact.name, shape: fact.shape, words: [...(fact.words ?? [])], unit: fact.unit, currency: fact.currency, decimal: fact.decimal, lang: fact.lang, source: fact.source });
    }
    return { accepted: true, landedKey: open[0].key };
  }

  editPick(/** @type {any} */ e) {
    const r = this.targetsOf(e)[0];
    if (!r) return { refusedBecause: 'names no ~ rule of this line' };
    if (!isCountable(r.text)) return { refusedBecause: 'not a count rule' };
    const res = keepOrDrop(r.text, /** @type {any} */ ({ ...e.check }));
    if (!res.kept) return { refusedBecause: String(res.why) };
    r.pickProposal = res.check;
    return { accepted: true, landedKey: r.key };
  }

  editNot(/** @type {any} */ e) {
    const r = this.ruleRows(e.line).find((x) => x.rule === e.rule);
    if (!r) return { refusedBecause: 'names no ~ rule of this line' };
    if (r.can?.ok) return { refusedBecause: 'code can check it: code decides what is doable' };
    const reason = String(e.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 200);
    if (!reason) return { refusedBecause: 'no reason given' };
    r.aiReason = reason;
    return { accepted: true, landedKey: r.key };
  }

  // 8. whole-list reconcile, every time
  reconcile() { this.match(); const c = this.build(); this.ask(); return c; }

  /** the loop: while a question is open or a reply waits, apply it and reconcile the WHOLE list again. `answer(q)` gives {choice, text} or null (a person who did not answer) */
  drive({ answer }) {
    this.unanswered = [];
    this.reconcile();
    for (let guard = 0; (this.hasOpenQuestions() || this.hasPendingDelta()) && guard < 200; guard += 1) {
      const q = this.open.find((x) => !this.unanswered.includes(x.key));
      if (q) {
        const a = answer(q);
        const res = a ? this.applyAnswer(q.key, a.choice, a.text) : { ok: false };
        if (!res.ok) { this.unanswered.push(q.key); continue; }
        this.reconcile();
        continue;
      }
      const d = this.queue.shift();
      if (!d) break;
      this.applyDelta(d);
      this.reconcile();
    }
    return this;
  }

  card() { return renderCard(this.rows); }

  /**
   * The rows as the close shape the card readers (`checksOfClose`, `refusedOf`, `cardOfClose`) already read: the block's stages, the picks code records and the signed list. The confirm card
   * and the signed card read the rows through the SAME readers, so a row shown at confirm is the row signed. Reconciles first (the whole list, every time).
   */
  closeView() {
    const c = this.reconcile();
    return { stages: c.stages, picks: this.picksOf(c), list: this.signedRows() };
  }

  /** the picks code records: a countable part carrying the `~` rule numbers it settles @param {{parts: any[], map: {part: number, line: number}[]}} c the build @returns {{line: number, part: any}[]} */
  picksOf(c) {
    return c.map.flatMap((m) => { const part = c.parts[m.part]; return part && part.class === 'countable' && Array.isArray(part.rules) ? [{ line: m.line, part }] : []; });
  }

  /** the standing ruling "a run needs one check": one row that is not the floor is built */
  hasBuiltCheck() { return this.rows.some((r) => r.state === 'built' && r.kind !== 'floor'); }

  /**
   * The signed list (`closeDecl.list`): the signed fields of every row, never its words. A suggestion not added is signed `dropped` ("suggested, not added"), a suggestion code could not build
   * `dropped` with code's reason (it is on the Audit, never on the card), and a built row carries the names of the facts it made (`facts`), so every reader can tag each fact by its row's kind.
   */
  signedRows() {
    return this.rows.map((r) => {
      const gone = r.state === 'suggested' || r.hidden === true;
      const row = { ...r, ...(gone ? { state: 'dropped' } : {}), ...(r.state === 'built' && r.factNames?.length ? { facts: r.factNames } : {}) };
      return Object.fromEntries(SIGNED_ROW_FIELDS.filter((f) => row[f] !== undefined && row[f] !== null).map((f) => [f, row[f]]));
    });
  }

  /** the suggestions code has proved it can build, as the card offers them (Add): `{key, line, text}` */
  suggestedView() {
    return this.rows.filter((r) => r.state === 'suggested' && r.offer?.text).map((r) => ({ key: r.key, line: r.line, text: String(r.offer.text), ...(r.choice === 'drop' ? { dropped: true } : {}) }));
  }

  /** the suggestions code could not build, in one plain sentence each: the Audit's draft lines (never the card) */
  unbuiltSuggestions() {
    return this.rows.filter((r) => r.hidden === true).map((r) => ({
      line: r.line, text: `A suggested check was not built (${r.kind} ${(r.words ?? []).length ? (r.words ?? []).map((/** @type {string} */ w) => `"${w}"`).join(', ') : `"${r.name ?? ''}"`}): ${String(r.reason ?? 'not checked').replace(/^code could not build a legal check from it: /, '').replace(/\s*Nothing was signed\.\s*$/, '')}`,
    }));
  }

  /**
   * The person's Drop or Add on a `!` row (hamr 2026-11-13: instant, $0, no AI; the choice decides). The whole list is reconciled again, so an Add is judged by code like every other row.
   * @param {string} key @param {'drop'|'add'} choice @returns {{ok: true} | {ok: false, why: string}}
   */
  rowChoice(key, choice) {
    const r = this.rows.find((x) => x.key === key);
    if (!r) return { ok: false, why: 'there is no such check on the list' };
    if (r.by === 'you') return { ok: false, why: 'that check comes from a rule you wrote; edit the job to change it' };
    if (r.by !== 'agent' || !this.isBang(r)) return { ok: false, why: 'that check is code\'s own and stays' };
    if (choice !== 'drop' && choice !== 'add') return { ok: false, why: 'not one of the choices' };
    if (choice === 'drop' && r.state !== 'built') return { ok: false, why: 'only a check that is on the card can be dropped' };
    if (choice === 'add' && r.state !== 'suggested') return { ok: false, why: 'only a suggested check can be added' };
    const before = r.choice;
    r.choice = choice;
    this.reconcile();
    if (choice === 'add' && r.state !== 'built') { const why = String(r.reason ?? 'not checked'); r.choice = before; this.reconcile(); return { ok: false, why }; }
    return { ok: true };
  }

  /** the person's Drop/Add choices, tied to the line's words (not its number) and the row's own name, so a Revise keeps them @returns {{lineWords: string, occurrence: number, tail: string, choice: string}[]} */
  choicesRecord() {
    const seen = new Map();
    const key = new Map(this.lines.map((l) => { const w = norm(l.text); const o = seen.get(w) ?? 0; seen.set(w, o + 1); return [l.n, { lineWords: w, occurrence: o }]; }));
    return this.rows.filter((r) => r.choice === 'drop' || r.choice === 'add').map((r) => ({ ...(key.get(r.line) ?? { lineWords: '', occurrence: 0 }), tail: r.key.replace(/^L\d+\./, ''), choice: String(r.choice) }));
  }

  /** a Revise keeps the last draft's Drop/Add choices on the rows that are still there (same line words, same row); code still judges every one @param {{lineWords: string, occurrence: number, tail: string, choice: string}[]} rec */
  carryChoices(rec) {
    const seen = new Map();
    const lines = this.lines.map((l) => { const w = norm(l.text); const o = seen.get(w) ?? 0; seen.set(w, o + 1); return { n: l.n, w, o }; });
    for (const c of Array.isArray(rec) ? rec : []) {
      if (!c || (c.choice !== 'drop' && c.choice !== 'add')) continue;
      const line = lines.find((l) => l.w === c.lineWords && l.o === c.occurrence);
      const r = line ? this.rows.find((x) => x.line === line.n && this.isBang(x) && x.key.replace(/^L\d+\./, '') === c.tail) : undefined;
      if (r) { r.choice = c.choice; r.keptFromLast = true; }
    }
  }

  /**
   * per line, the shape of `retentionOfList` (counts only): `aiParts` = the rows the agent proposed (and the default cited), `kept` = those built, `dropped` = the rest, `picks` = a `~` row built from a pick
   * @returns {{line: number, aiParts: number, kept: number, dropped: number, picks: boolean}[]}
   */
  retention() {
    return this.lines.map((l) => {
      const mine = this.rowsOn(l.n).filter((r) => r.kind !== 'floor');
      const ai = mine.filter((r) => r.by === 'agent' || (r.by === 'default' && r.kind === 'cited'));
      const kept = ai.filter((r) => r.state === 'built').length;
      return { line: l.n, aiParts: ai.length, kept, dropped: ai.length - kept, picks: mine.some((r) => r.from === 'pick' && r.state === 'built') };
    });
  }
}
