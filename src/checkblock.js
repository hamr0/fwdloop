// borrowed-from: bareloop src/checkblock.js@v0.57.0 (c18df406)
// borrowed-from: bareloop src/checkblock.js@v0.60.0 (M19 S3: caught up from the earlier port; sheet rows, repo rows, droppable, choiceEntries and lineWordKeys as the tag has them)
// borrowed-from: bareloop src/checkblock.js@v0.61.0 (fc56e1f3) (M19 S3: the shape rows, setShape and the shape Drops; where a hunk is not taken the line says `fwd keeps`)
// Where a signed fwd rule stays instead of the tag's line, the line says `fwd keeps` (hamr 2026-11-19: "checks move inside with the same flow we have, don't make unneccessary drift"): the `cant-check` question
// (M10 am16 (3)), the own-words answer to any question (M10 am16), no `$prose` row and no floor row on the card (the card draws neither today), no `corrected` flag, and fwd's own sheet Not-checked words.
// fwd never sets `repo` (it has no repo job), so the repo rows below are inert here and stay as the tag has them.
// first ported from: bareloop src/checkblock.js@v0.56.0 (3383cce) + f148028e (M16 am2: an agreed answer's follower row takes its parent's check after the parts are numbered, 4 lines in build())
// Ported, not copied whole (M16 am3 (1)): the imports point at fwd's files (src/blockpick.js is bareloop's checkpick.js under another name), and the three patterns built from text
// (the whole-word test in `inText`, the number test in `inJob` and `matchCount`) are written by hand, because src/ builds no pattern from text (test/signed-text.test.js).
// THE CHECK BLOCK of a job (hamr 2026-11-12: "goal again is simplfication and one flow one place ai suggestes ! code adds $ and code decides what worked/doable").
// ONE store: `rows`. Nothing else holds a check. Rows are `~` (the person's own rule), `!` (the agent's suggestion: a look fact, or an AI edit) and `$` (code's defaults).
// The AI's whole part is a list of proposed ROW EDITS; code judges each edit alone, matches every row against the saved page, builds every check through the bareguard-backed
// shapes, and says why a row it cannot build is Not checked. The block never removes a row: only the person (`applyAnswer`) or code (`match`) changes one.
//   fromJob -> addLook -> reconcile( match -> build -> ask ), then, while a question is open or a reply waits: apply it and reconcile the WHOLE list again.
// Pure: no I/O, no clock, no model. ONE block for every job (hamr 2026-11-15: "same flow as rubric, no exceptions; same CheckBlock, only the TYPE of checks varies"). A rubric job's rows are facts, phrases and
// counts built into rubric-step parts; a repo job (`repo` option) holds `~` rule rows the write fence keeps (or that the person answers about), `!` rows for the drafter's catalogue work stages, and the same `$` rows.
// The same rows store, the same asks, the same Drop/carry, the same signedRows and closeView serve both.
import { globToPrefix } from './globprefix.js';
import { countExact, countPhrase } from './pagebits.js';
import { checkFactWords, keptSetOf } from './factwords.js';
import { isCountable, keepOrDrop, countCheck, obviousCheck, partOfPick, plainWords, sameRuleWords } from './blockpick.js';
import { dropRows, dropSentence } from './pagedropwords.js';
import { phraseInNoResult, asSeenOf } from './pagedry.js';
import { boundInWords, rubricStepShapeReds, stageKeyOf, guardKeyOf, FENCE_KEY, defaultCitedText, defaultNoteText, readLimit, holdsManyBounds, NEGATING_RE, WHY_OTHER_CURRENCY } from './rubricstep.js';
import { validReading } from './pagerules.js';
import { weekOnly, weekTokens, WEEK_ONLY_WORDS, MAX_BANG } from './checklist.js';
import { fitPlacePhrase } from './placerule.js';
import { ruleWords } from './pageask.js';
import { SIGNED_ROW_FIELDS } from './declaredclose.js';
import { factSentence, countSentence, factsOfLook } from './citedcheck.js';
import { isDeepStrictEqual } from 'node:util';
import { sheetCheckSentence } from './sheetchecks.js';
import { sheetCheckName, sheetPlainText, coversWords } from './sheetblock.js';
import { sheetCheckBody, sheetRowKey } from './sheetrows.js';
import { shapeRowKey, shapeDefaultKey, shapeFieldText, buildShapePart } from './shaperows.js';
import { fieldSpec } from './shapebuild.js';

/**
 * A row. `kind`: rule, fact, phrase, count, cited, numbers, floor. `by`: you (`~`), agent (`!`), default (`$`). A `~` row may carry `links` (the look's facts tied to it),
 * `pick`, `aiReading`, `left`. `state` is built or not-checked; a not-checked row always has a plain `reason`.
 * @typedef {Record<string, any>} Row
 */

/** what `setSheet` is given: code's build of a job's sheet checks, per sheet line @typedef {Awaited<ReturnType<typeof import('./sheetbuild.js').buildSheetChecks>>} SheetBuilt */

/** the card's fixed words, one spelling (the renderer reads them; a test reads them too) */
export const CARD_T = Object.freeze({ count: 'result count', cited: 'every claim is backed by a quote copied from', theInput: 'the input', numbers: 'every number in the text is in a checked quote of line', withWords: 'with the words' });

/** the four row edits an AI reply may hold */
export const EDIT_OPS = Object.freeze(['add', 'reading', 'pick', 'not-checkable', 'fence']);

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
  // fwd keeps: the `cant-check` question's words (M10 am16 (3)); the tag (hamr 2026-11-15, option A) no longer asks it
  cantCheck: "I can't check this on the page; waiting for your answer",
  noRule: 'No rule can check this, so you judge it at Accept.',
  waitingPick: 'waiting for your answer on the proposed check',
  waitingReading: 'waiting for your answer on the reading',
  onePerLine: 'this line finds facts, so it has no text to quote',
  manyInputs: 'the job has more than one input and code cannot pick which one the claims quote',
  oneSidedTime: 'a time limit the AI proposes must be a range, so you judge it at Accept.',
  countNeedsFact: 'a result count needs a fact to count; this line has none',
  countNeedsSuggested: 'a result count needs a fact to count; add the suggested fact on this line to count its results',
  lookNoWords: "the page does not hold the words of the look's fact for this rule",
  afterLast: 'no more tries: Start over (rows are never changed by the AI after the last try)',
  noPick: 'No check was picked for it, so you judge it at Accept.',
  negated: 'it says what is not needed, so there is nothing to check',
  dropped: 'You dropped it.',
  suggested: 'Suggested: not in your job, so it is not checked unless you add it.',
  sheetLine: 'this line reads a sheet and its rules are checked by the sheet checks, so a row edit about it is not used',
  sheetFacts: 'this line reads a sheet, so it is checked by its sheet checks and not by page facts',
  columnRule: "this rule only names a column; the agent's checks on this line use it",
});

/** the card lines: rows in, lines out. ONE pure function of the rows; nothing else may feed it. @param {Row[]} rows */
export function renderCard(rows) {
  // fwd keeps: the card draws no floor row (and there is no prose row) today
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

/**
 * The Drop/Add choices of rows, tied to the line's words (not its number) and the row's own name, so a Revise keeps them. ONE owner for the block's own record and for a Drop made on a signed card.
 * @param {{n: number, text: string}[]} lines @param {{line: number, key: string, choice: string}[]} picks @returns {{lineWords: string, occurrence: number, tail: string, choice: string}[]}
 */
export function choiceEntries(lines, picks) {
  const seen = new Map();
  const key = new Map(lines.map((l) => { const w = norm(l.text); const o = seen.get(w) ?? 0; seen.set(w, o + 1); return [l.n, { lineWords: w, occurrence: o }]; }));
  return picks.map((p) => ({ ...(key.get(p.line) ?? { lineWords: '', occurrence: 0 }), tail: p.key.replace(/^L\d+\./, ''), choice: String(p.choice) }));
}

export class CheckBlock {
  /** @param {{texts: Record<string, string>, labels: string[], maxTries?: number, countScope?: (ruleText: string) => boolean, asks?: boolean, split?: boolean, cited?: boolean, repo?: {files: string[]|null, writeScope: string[]|null}|null}} o the frozen input texts, their labels, how many AI replies (tries) may still change a row, whether code scopes a counting `~` rule in (a pick is asked), and whether a person can be asked at all (`asks`: false = a rule code cannot settle is Not checked, a reading code proposes is built as the AI's proposal) */
  constructor({ texts, labels, maxTries = 3, countScope = () => true, asks = true, split = false, cited = true, repo = null }) {
    // M16 am1: `cited: false` = no `$` cited default row on this job's lines (fwd's own quote checks stay as they are); the `$` floor stays
    this.cited = cited;
    /** a repo job's check TYPE (the only thing that varies): `files` = the repo listing at the seed (null until it is read), `writeScope` = the signed write fence. Null = a rubric job @type {{files: string[]|null, writeScope: string[]|null}|null} */
    this.repo = repo;
    /** @type {any[]} a repo job's drafted stages as the drafter wrote them (guards included); the rows of the work stages are in `rows`, the close's stages are these minus the dropped ones */
    this.declared = [];
    /** the job lines a mandatory guard already covers (`guardLines`): a repo stage is never dropped when it is the last thing covering a line @type {Set<number>} */
    this.guardCover = new Set();
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
    /** @type {string[]} the NAMES of the mandatory guards the close carries (Addendum 2026-11-14 (c) piece 2): each is a job-level `$` row of the signed list, never a row of `rows` (no line, so no check of a line) */
    this.guards = [];
    /** @type {string[]|null} the write fence of the job: a job-level `$` row of the signed list (hamr 2026-11-15), never a row of `rows` */
    this.fence = null;
    /** S4: the job lines that read a sheet (a CSV input and a `~` rule): every rule of such a line is decided by the sheet checks alone, never by the page path (`src/sheetrows.js` `sheetLineNumbers`) @type {Set<number>} */
    this.sheetLines = new Set();
    /** S4: what code built from the AI's `sheetChecks` (src/sheetbuild.js `buildSheetChecks`), null until the row-edit turn has answered @type {SheetBuilt|null} */
    this.sheetBuilt = null;
    /** shape jobs (clause 4): what code built from the AI's `itemShape` (src/shapebuild.js `buildShapes`), null until the row-edit turn has answered. A line in `built` is a SHAPE line: a line is exactly one class, facts, sheet or shape @type {ReturnType<typeof import('./shapebuild.js').buildShapes>|null} */
    this.shapeBuilt = null;
    /** shape jobs: the Drops the person made, kept beside the rows (`agent` = `<line>:<field name>`, `rules` = `<line>:<rule number>`) @type {{agent: Set<string>, rules: Set<string>}} */
    this.shapeDrops = { agent: new Set(), rules: new Set() };
  }

  /** the mandatory guards of this job's class, by name: signedRows() adds one `$` guard row for each, once for the whole job @param {string[]} names @param {string[]|null} [fence] the signed write fence, when the job has one */
  setGuards(names, fence = null) { this.guards = [...new Set(names)]; this.fence = Array.isArray(fence) && fence.length ? [...fence] : null; }

  /** S4: the job lines that read a sheet. Their rules are decided by the sheet checks alone (no page path, no pick question, no row edit), from here on @param {number[]} nums */
  setSheetLines(nums) { this.sheetLines = new Set(nums); }
  /** @param {number} n */
  isSheetLine(n) { return this.sheetLines.has(n); }

  /**
   * S4: the checks code built from the AI's `sheetChecks` become rows of the one list: an `[agent]` row for each check that is no rule row's. A `[you]` row is the `~` rule's own row (its state comes from the sheet,
   * `matchSheetRule`). A Drop the person made on a check is kept for the same check (same typed fields) when the checks are built again; every row is reconciled.
   * fwd keeps: no `[default]` sheet row (the tag adds one per sheet line, bareloop S4); fwd's list has none (M16 am4 (2): "a `[default]` sheet check does not exist").
   * @param {SheetBuilt} built
   */
  setSheet(built) {
    const dropped = this.rows.filter((r) => r.kind === 'sheet' && r.by === 'agent' && r.choice === 'drop').map((r) => ({ line: r.line, body: sheetCheckBody(r.check) }));
    this.sheetBuilt = built;
    this.rows = this.rows.filter((r) => r.kind !== 'sheet');
    for (const n of this.sheetLines) {
      const b = built.built[n];
      if (!b) continue;
      for (const p of b.agentRows) {
        const row = this.addRow({ key: sheetRowKey(n, p.check.id), line: n, kind: 'sheet', by: 'agent', from: 'agent', check: p.check });
        if (dropped.some((d) => d.line === n && isDeepStrictEqual(d.body, sheetCheckBody(p.check)))) row.choice = 'drop';
      }
    }
    this.reconcile();
  }

  /** shape jobs, rules first: does job line `n` hold a rule that took its shape field (no truth check could take it)? Only such a line carries shape rows and a shape part @param {number} n */
  isShapeLine(n) { return !this.isSheetLine(n) && this.rows.some((r) => r.kind === 'rule' && r.line === n && r.can?.how === 'shape'); }

  /**
   * Shape jobs, rules first (hamr 2026-11-19): remember the shape code built from the shape look (src/shapebuild.js `buildShapes`). It decides nothing by itself: `matchRule` tries every rule's truth check (fact, cite, count, phrase, pick) FIRST,
   * and a rule that ends with none and no open ask may take its shape field (`takesShape`). A line where no rule did has no shape rows at all (`syncShapeRows`), so a page job's rows stay as they were. A Drop the person made
   * (an `[agent]` field, or a rule's own shape field) is kept for the same field when the shape is built again. Every row is reconciled.
   * @param {ReturnType<typeof import('./shapebuild.js').buildShapes>} built
   */
  setShape(built) {
    this.keepShapeDrops();
    this.shapeBuilt = built;
    this.reconcile();
  }

  /** the Drops the shape rows carry now, remembered beside the rows (a row can leave the list and come back) */
  keepShapeDrops() {
    for (const r of this.rows) {
      if (r.kind === 'shape' && r.by === 'agent' && r.choice === 'drop' && r.field?.name !== undefined) this.shapeDrops.agent.add(`${r.line}:${r.field.name}`);
    }
  }

  /**
   * Rules first: may this rule, which no truth check could take, take the shape field the shape look proposed for it? Its own `[you]` row then carries the field. Null when it may not (no shape, a sheet or repo job, no field for the rule).
   * @param {Row} r @returns {{name: string}|null}
   */
  takesShape(r) {
    // a rule code marks as negating says what is NOT needed: it stays with the person (NEGATING_RE, the old ruling), never a shape field ("no nonstop" must not become nonstop = false)
    if (this.repo !== null || r.kind !== 'rule' || this.isSheetLine(r.line) || NEGATING_RE.test(String(r.text))) return null;
    const rs = this.shapeBuilt?.built[r.line]?.rows.find((x) => x.rule === r.rule && x.text === r.text);
    return rs && rs.state === 'built' && typeof rs.name === 'string' ? { name: rs.name } : null;
  }

  /**
   * The rules that are still Not checked once every truth check, the person's answers and the pending asks are settled, and that may still take a shape field (not a sheet or repo job, not left or negating by the person's words):
   * the ONLY rules the shape look is asked about, and only when there is one. Call after `reconcile`.
   * @returns {{line: number, rule: number}[]}
   */
  shapeCandidates() {
    if (this.repo !== null) return [];
    return this.rows.filter((r) => r.kind === 'rule' && !r.left && (!r.can?.ok || r.truthRefused) && !r.can?.ask && !this.isSheetLine(r.line) && !NEGATING_RE.test(String(r.text))).map((r) => ({ line: r.line, rule: Number(r.rule) }));
  }

  /**
   * Shape rows live only on a line where a rule took its shape field: its `[agent]` extra fields (job-derived on, no-word Suggested) and its `$` count row are added there, and removed from any line where none did.
   * Called after the rules are matched.
   */
  syncShapeRows() {
    const built = this.shapeBuilt?.built ?? {};
    for (const [k, b] of Object.entries(built)) {
      const n = Number(k);
      const live = this.isShapeLine(n);
      const have = this.rows.filter((r) => r.kind === 'shape' && r.line === n);
      if (!live) { if (have.length) { this.keepShapeDrops(); this.rows = this.rows.filter((r) => !(r.kind === 'shape' && r.line === n)); } continue; }
      for (const f of b.fields.filter((x) => x.by === 'agent')) {
        if (have.some((r) => r.key === shapeRowKey(n, f.name))) continue;
        const row = this.addRow({ key: shapeRowKey(n, f.name), line: n, kind: 'shape', by: 'agent', from: 'agent', field: f, state: 'not-checked', reason: 'not yet matched' });
        if (this.shapeDrops.agent.has(`${n}:${f.name}`)) row.choice = 'drop';
      }
      if (b.itemCount && !have.some((r) => r.key === shapeDefaultKey(n))) this.addRow({ key: shapeDefaultKey(n), line: n, kind: 'shape', by: 'default', from: 'default', state: 'not-checked', reason: 'not yet matched' });
    }
    // a line the shape look built nothing for keeps no shape rows
    this.rows = this.rows.filter((r) => !(r.kind === 'shape' && built[r.line] === undefined));
  }

  /** the dropped shape fields the record keeps, tied to the line's words (not its number): an `[agent]` field by its name, a rule's own shape field by its rule number @returns {{lineWords: string, occurrence: number, name?: string, rule?: number}[]} */
  shapeDroppedRecord() {
    this.keepShapeDrops();
    const keys = this.lineWordKeys();
    const at = (/** @type {number} */ n) => keys.get(n) ?? { lineWords: '', occurrence: 0 };
    return [
      ...[...this.shapeDrops.agent].map((x) => { const i = x.indexOf(':'); return { n: Number(x.slice(0, i)), name: x.slice(i + 1) }; }).filter((d) => this.lines.some((l) => l.n === d.n)).map((d) => ({ ...at(d.n), name: d.name })),
      ...[...this.shapeDrops.rules].map((x) => { const [n, rule] = x.split(':').map(Number); return { ...at(n), rule }; }).filter((d) => d.lineWords !== ''),
    ];
  }

  /** a Revise keeps a Drop of the very same field (same line words, same name or rule number); a field this draft did not build is not dropped @param {{lineWords: string, occurrence: number, name?: string, rule?: number}[]} rec */
  carryShapeDropped(rec) {
    const keys = this.lineWordKeys();
    for (const d of Array.isArray(rec) ? rec : []) {
      if (!d || typeof d.lineWords !== 'string' || !Number.isInteger(d.occurrence)) continue;
      const n = [...keys].find(([, k]) => k.lineWords === d.lineWords && k.occurrence === d.occurrence)?.[0];
      if (n === undefined) continue;
      if (typeof d.name === 'string') {
        this.shapeDrops.agent.add(`${n}:${d.name}`);
        const row = this.rows.find((r) => r.kind === 'shape' && r.by === 'agent' && r.line === n && r.field?.name === d.name);
        if (row) { row.choice = 'drop'; row.keptFromLast = true; }
      } else if (Number.isInteger(d.rule)) this.shapeDrops.rules.add(`${n}:${d.rule}`);
    }
    this.reconcile();
  }

  /**
   * The dropped sheet checks the record keeps, as fwd's picks record has always written them (`{key, line, index, check, text}`, M17 am3): `index` is the check's place among its line's checks, `check` the check as built.
   * fwd keeps this record shape (the tag ties each entry to the line's words instead, `{lineWords, occurrence, check, text}`): the record is a file of the plan folder, and a draft saved before this carries the old shape.
   * @returns {{key: string, line: number, index: number, check: Record<string, any>, text: string}[]}
   */
  sheetDroppedRecord() {
    return this.rows.filter((r) => r.kind === 'sheet' && r.by === 'agent' && r.choice === 'drop').map((r) => ({
      key: r.key, line: r.line, index: Math.max(0, (this.sheetBuilt?.built[r.line]?.checks ?? []).findIndex((/** @type {any} */ c) => c.id === r.check.id)), check: r.check, text: String(r.offer?.text ?? ''),
    }));
  }

  /** a Revise keeps a Drop of the very same check: the record's entries, matched on the line and the check's own fields (never its id: code names every check); a check this draft did not build is not dropped @param {{line: number, check: Record<string, any>}[]} rec */
  carrySheetDropped(rec) {
    for (const d of Array.isArray(rec) ? rec : []) {
      if (!d || !Number.isInteger(d.line) || !isRec(d.check)) continue;
      const row = this.rows.find((r) => r.kind === 'sheet' && r.by === 'agent' && r.line === d.line && isDeepStrictEqual(sheetCheckBody(r.check), sheetCheckBody(d.check)));
      if (row) row.choice = 'drop';
    }
    this.reconcile();
  }

  /** each job line's words and its order among equal lines (the key a record ties a choice to) @returns {Map<number, {lineWords: string, occurrence: number}>} */
  lineWordKeys() {
    const seen = new Map();
    return new Map(this.lines.map((l) => { const w = norm(l.text); const o = seen.get(w) ?? 0; seen.set(w, o + 1); return [l.n, { lineWords: w, occurrence: o }]; }));
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
      if (this.repo === null) this.addRow({ key: `L${l.n}.$floor`, line: l.n, kind: 'floor', by: 'default', from: 'default', state: 'built', reason: null, text: "the file exists and its text is not empty (code's own floor)" });
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

  /**
   * S1 (the sheet look, src/sheetlook.js): a `~` rule whose word is no column of its CSV carries ONE column question. Agree writes `reading` (the rule's own words with the column in place of the word) as the rule's words,
   * through the same one-rule-in, one-rule-out answer as any reading (`applyAnswer`); no line is added. Code builds the question; nothing here reads a model field.
   * A tie (`columns`, `readings`: the rule's words for each tied column) has no single reading: the person picks a column (`applyAnswer` `column`) and the rule is that column's reading.
   * @param {{line: number, rule: number|null, question: string, reading?: string, columns?: string[], readings?: Record<string, string>}[]} asks
   */
  addSheetAsks(asks) {
    for (const a of asks) {
      const r = a.rule === null ? undefined : this.ruleRows(a.line).find((x) => x.rule === a.rule);
      if (r) r.sheetAsk = { ruleText: r.text, question: a.question, proposal: a.reading ?? null, ...(Array.isArray(a.columns) ? { columns: [...a.columns], readings: { ...a.readings } } : {}) };
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
      else if (r.kind === 'stage') r.can = r.refusal ? { ok: false, why: r.said } : { ok: true, how: 'stage' };
      else if (r.kind === 'rule') this.matchRule(r);
      else if (r.kind === 'fact' || r.kind === 'phrase') this.matchBang(r);
      else if (r.kind === 'count') this.matchCount(r);
      else if (r.kind === 'sheet') r.can = { ok: true, how: 'sheet' };
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
    // shape rows live only on a line where a rule took its shape field (rules first): added or removed now that the rules are matched; their own state is set below
    this.syncShapeRows();
    for (const r of this.rows) if (r.kind === 'shape') r.can = { ok: true, how: 'shape' };
    // S4: an `[agent]` sheet row the person dropped is held out of the close and offered again under Suggested (Add); it is code's own check, already built, so no trial is needed
    // shape jobs: an `[agent]` field the person dropped, or one with no word of the job (R2), is held out of the close and offered under Suggested (Add); it is code's own field, already built, so no trial is needed
    for (const r of this.rows) if (r.kind === 'shape' && r.by === 'agent') { r.held = r.choice === 'drop' || (r.field?.held === true && r.choice !== 'add'); r.offer = { text: shapeFieldText({ name: r.field.name, spec: fieldSpec(r.field), rule: null }, []) }; }
    for (const r of this.rows) if (r.kind === 'sheet' && r.by === 'agent') { r.held = r.choice === 'drop'; r.offer = { text: sheetPlainText(sheetCheckName(r.check), sheetCheckSentence(r.check), coversWords(this.coverTexts(r))) }; }
  }

  /** the person's own words of the rules an `[agent]` sheet row shows (its `covers`) @param {Row} r @returns {string[]} */
  coverTexts(r) {
    return (Array.isArray(r.check?.covers) ? r.check.covers : []).map((/** @type {number} */ n) => this.ruleRows(r.line).find((x) => x.rule === n)?.text).filter((/** @type {unknown} */ t) => typeof t === 'string');
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
    // a money, time, number or date fact the person asked for BY NAME ("the release heading") is in the job too: the look's page words rarely echo the job's own words. A phrase or place is job-derived
    // only when its own words are in the person's text: a name the AI gave it is no proof (hamr 2026-11-15, live run mwi76vh8: "friendly" for "Select flight")
    return (r.words ?? []).some((/** @type {string} */ w) => inText(said, w)) || (r.kind === 'fact' && r.shape !== 'phrase' && r.shape !== 'place' && typeof r.name === 'string' && inText(said, r.name));
  }

  /** a `!` count row is built unless a `~` rule on its line already names the number */
  matchCount(/** @type {Row} */ r) {
    const nums = [r.min, r.max].filter((x) => Number.isInteger(x)).map(String);
    const said = this.ruleRows(r.line).find((x) => nums.some((n) => numberIn(x.text, n)));
    r.can = said ? { ok: false, why: `a ~ rule already says it: line ${r.line} rule ${said.rule} names the number` } : { ok: true, how: 'count' };
  }

  /** RULES FIRST (hamr 2026-11-19): today's truth check for the rule; only a rule that ends with none and no open ask takes the shape field proposed for it (the strongest check wins, no ask) @param {Row} r */
  matchRule(r) {
    this.matchTruthRule(r);
    // a truth check code picked but REFUSED when it built the line (live mwnbs3np: 4 results, a title said once) is no check: the rule is still Not checked, so it may take its shape field (hamr: shape for what code could not check)
    if (r.can?.ask || (r.can?.ok && !r.truthRefused)) return;
    const sh = this.takesShape(r);
    if (sh === null) return;
    r.can = this.shapeDrops.rules.has(`${r.line}:${r.rule}`) ? { ok: false, why: REASON.dropped } : { ok: true, how: 'shape', name: sh.name };
  }

  matchTruthRule(/** @type {Row} */ r) {
    if (this.repo !== null) { this.matchRepoRule(r); return; }
    // S1: the sheet look's column question, while the rule still says the words it was asked about (an answered, dropped or retyped rule is not asked again)
    if (r.sheetAsk && this.asks && !r.agreed && !r.left && r.text === r.sheetAsk.ruleText) { r.can = { ok: false, ask: 'reading', proposal: r.sheetAsk.proposal, question: r.sheetAsk.question, ...(r.sheetAsk.columns ? { columns: r.sheetAsk.columns, readings: r.sheetAsk.readings } : {}), why: REASON.waitingReading }; return; }
    if (this.isSheetLine(r.line)) { this.matchSheetRule(r); return; }
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
    // fwd keeps: the tag (hamr 2026-11-15, option A) does not ask; fwd asks `cant-check` while someone can be asked (M10 am16 (3))
    r.can = this.asks ? { ok: false, ask: 'cant-check', why: r.lookWhy ?? REASON.cantCheck } : { ok: false, why: r.lookWhy ?? REASON.noRule };
  }

  /**
   * S4: a `~` rule of a sheet line. The sheet checks code built decide it, and nothing else does (ONE owner: a rule has never two rows): built = this rule's own `[you]` row carries the check; an `[agent]` row that shows it carries it
   * (and a Drop of that row leaves the rule Not checked); a table check only named it, a refusal, or nothing picked = Not checked with that plain reason. Before the AI's turn has answered, nothing is picked yet.
   * @param {Row} r
   */
  matchSheetRule(r) {
    const b = this.sheetBuilt?.built[r.line];
    const rs = b?.rows.find((x) => x.rule === r.rule && x.text === r.text);
    if (!rs) { r.can = { ok: false, why: r.lookWhy ?? REASON.noPick }; return; }
    if (rs.state === 'built') r.can = { ok: true, how: 'sheet', id: rs.id };
    else if (rs.state === 'agent-row') r.can = this.rows.some((x) => x.kind === 'sheet' && x.line === r.line && x.check?.id === rs.id && x.choice === 'drop') ? { ok: false, why: REASON.dropped } : { ok: true, how: 'sheet', id: rs.id };
    else if (rs.state === 'column') r.can = { ok: false, why: REASON.columnRule };
    else r.can = { ok: false, why: rs.reason === REASON.noPick ? (r.lookWhy ?? REASON.noPick) : String(rs.reason) };
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
    // fwd keeps: the tag (hamr 2026-11-15, option A) does not ask `cant-check`; fwd does, unless the person's own words already stand (M10 am16 (3))
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
    if (this.repo !== null) return this.buildRepo();
    /** @type {any[]} */ const stages = [];
    /** @type {any[]} */ const parts = [];
    /** @type {{part: number, line: number, rows: string[], origin: string}[]} */ const map = [];
    /** @type {Set<number>} */ const factLines = new Set();
    for (const l of this.lines) {
      /** @type {any[]} */ const lineParts = [];
      /** @type {string[][]} */ const lineRows = [];
      this.buildLine(l, lineParts, lineRows, factLines);
      if (lineParts.length) stages.push({ name: `line-${l.n}`, kind: 'rubric-step', fromLine: [l.n], params: { step: l.n, parts: lineParts } });
      // fwd keeps: no `carriesText` on the floor row and no `$prose` row (the tag sets the first for the card's floor words and adds the second for each text line; fwd's card draws neither today, and the v0.56.0 parity
      // test (test/m16-block-parity.test.js) holds the rows as they are; M19 S6 draws the floor row and brings both)
      // only a shape line's floor row carries the flag: every other row stays byte-identical to what it was
      const hasShape = lineParts.some((p) => p.class === 'shape');
      for (const f of this.rowsOn(l.n, 'floor')) { if (hasShape && !lineParts.some((p) => p.class === 'fact') && !lineParts.some((p) => p.class === 'countable')) f.listLine = true; else delete f.listLine; }
      lineParts.forEach((p, i) => {
        for (const k of lineRows[i] ?? []) { const row = this.rows.find((x) => x.key === k); if (row) row.part = { line: l.n, part: i }; }
        map.push({ part: parts.length, line: l.n, rows: lineRows[i] ?? [], origin: 'code' });
        parts.push(p);
      });
    }
    // a suggestion code has not built stays off the card (Audit only, F-b); a held one is trialled: shown under Suggested only when code has proved it builds (hamr 2026-11-13)
    for (const r of this.rows.filter((x) => x.held && x.kind !== 'sheet' && x.kind !== 'shape')) this.trialOffer(r);
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
    /** S4: the rows a sheet part carries (a `~` rule row the sheet built, an `[agent]` row, the `[default]` row) @type {Row[]} */
    const sheetRows = [];
    /** shape jobs: the rows a shape part carries (a `~` rule row with a field, an `[agent]` field row, the `[default]` row) @type {Row[]} */
    const shapeRows = [];
    for (const r of this.rowsOn(l.n)) {
      if (r.kind === 'floor') continue;
      r.part = null;
      r.grown = undefined;
      if (!r.can?.ok) { r.state = 'not-checked'; r.reason = r.can?.why ?? 'not checked'; continue; }
      if (r.held) { r.state = 'suggested'; r.reason = r.choice === 'drop' ? REASON.dropped : REASON.suggested; continue; }
      if (r.can.how === 'sheet') { sheetRows.push(r); continue; }
      if (r.can.how === 'shape') { shapeRows.push(r); continue; }
      // a line is a sheet line or a facts line, never both (a stage-shape red): a page fact on a sheet line is Not checked in plain words
      if (this.isSheetLine(l.n) && (r.kind === 'fact' || r.kind === 'phrase' || r.kind === 'count')) { r.state = 'not-checked'; r.reason = REASON.sheetFacts; continue; }
      if (r.can.how === 'pick') {
        const p = partOfPick(r.pick, r.text, [r.rule]);
        const reds = rubricStepShapeReds({ step: l.n, parts: [p] }, 'trial');
        if (reds.length) { r.state = 'not-checked'; r.reason = `the pick is not a legal check: ${reds[0].detail}`; continue; }
        pickParts.push({ p, key: r.key }); r.state = 'built'; r.reason = null;
        continue;
      }
      if (r.can.how === 'count') { countRow = r; continue; }
      const built = this.factsOf(r, facts);
      if ('why' in built) { r.state = 'not-checked'; r.reason = `code could not build a legal check from it: ${built.why}`; if (r.kind === 'rule') r.truthRefused = true; continue; }
      facts.push(...built.fresh);
      r.factNames = built.names;
      factRows.push({ r, src: built.src });
      if (r.kind === 'rule') rulesCarried.push(r.rule);
      r.state = 'built'; r.reason = null;
    }
    if (sheetRows.length > 0) this.buildSheetPartOf(l, sheetRows, lineParts, lineRows);
    if (facts.length) {
      // borrowed-from: bareloop src/checkblock.js@v0.60.0 (F337: the planner's example when a label sits off the result's first line; from the drafting copy, only here at signing)
      const asSeen = asSeenOf(this.textOf(factRows[0]?.src), facts, factRows[0]?.src ?? '');
      const part = {
        text: facts.map((f) => f.name).join('; '), class: 'fact', source: factRows[0]?.src, facts,
        ...(asSeen ? { asSeen } : {}),
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
    } else if (countRow) { countRow.state = 'not-checked'; countRow.reason = this.rowsOn(l.n).some((x) => x.held && (x.kind === 'fact' || x.kind === 'phrase')) ? REASON.countNeedsSuggested : REASON.countNeedsFact; }
    // facts+shape: the shape part follows the fact part (the same `results` list); its fields are the rules no truth check could take
    if (shapeRows.length > 0) this.buildShapePartOf(l, shapeRows, lineParts, lineRows);
    for (const { p, key } of pickParts) { lineParts.push(p); lineRows.push([key]); }
    this.buildDefaults(l, lineParts, lineRows, factLines);
  }

  /**
   * S4: ONE sheet part per sheet line, from the checks code built (the `[you]` rule rows' checks, then the `[agent]` checks the person has not dropped). Every row it carries points at it. A part code cannot legally build leaves its rows Not checked
   * in the stage-shape red's own words; a line whose checks were all dropped has no part and no `[default]` row.
   * @param {{n: number}} l @param {Row[]} sheetRows @param {any[]} lineParts @param {string[][]} lineRows
   */
  buildSheetPartOf(l, sheetRows, lineParts, lineRows) {
    const b = this.sheetBuilt?.built[l.n];
    const held = new Set(this.rows.filter((r) => r.kind === 'sheet' && r.line === l.n && r.held).map((r) => r.check.id));
    const checks = b ? [...b.ruleRows.map((p) => p.check), ...b.agentRows.map((p) => p.check).filter((c) => !held.has(c.id))] : [];
    if (checks.length === 0) { for (const r of sheetRows) { r.state = 'dropped'; r.reason = null; } return; }
    const rules = [...new Set(sheetRows.filter((r) => r.kind === 'rule').map((r) => Number(r.rule)))].sort((x, y) => x - y);
    // fwd keeps: the checks stay exactly as built (the tag's `buildSheetPart` shares one claim between a sum and a count of one condition for bareloop's worker; fwd's close.sheet keeps them apart, M15 am3a), and the part is
    // not tried by `rubricStepShapeReds`: fwd's one gate for a sheet check is the declaration validator (src/sheetchecks.js `sheetCheckReds`), which runs on the assembled close
    const part = { text: `the checks of line ${l.n} on the sheet`, class: 'sheet', checks: checks.map((c) => ({ ...c })), ...(rules.length ? { rules } : {}) };
    lineParts.push(part);
    lineRows.push(sheetRows.map((r) => r.key));
    for (const r of sheetRows) { r.state = 'built'; r.reason = null; }
  }

  /**
   * Shape jobs: ONE shape part per shape line, from the fields that stand (a `[you]` rule row's field, then the `[agent]` fields the person has not dropped and that are not Suggested) and the item count the person's words gave. Every
   * row it carries points at it. A line left with no field has no part and no `[default]` row.
   * The part is validated by `rubricStepShapeReds` (names, kinds, count, and bareguard's own `createRubric` over the `itemShape` check): a part code cannot legally build leaves its rows Not checked in that red's own words, as `buildSheetPartOf` does.
   * @param {{n: number, text: string}} l @param {Row[]} shapeRows @param {any[]} lineParts @param {string[][]} lineRows
   */
  buildShapePartOf(l, shapeRows, lineParts, lineRows) {
    const b = this.shapeBuilt?.built[l.n];
    const fields = (b?.fields ?? []).filter((f) => shapeRows.some((r) => (f.by === 'you' && r.kind === 'rule' && r.rule === f.rule) || (f.by === 'agent' && r.key === shapeRowKey(l.n, f.name))));
    if (!b || !fields.some((f) => f.by === 'you')) { for (const r of shapeRows) { r.state = 'dropped'; r.reason = null; } return; }
    const part = buildShapePart({ text: `the items of line ${l.n}`, fields: fields.map((f) => ({ name: f.name, spec: fieldSpec(f), rule: f.rule, by: f.by })), itemCount: b.itemCount });
    const reds = rubricStepShapeReds({ step: l.n, parts: [...lineParts.filter((p) => p.class === 'fact'), part] }, 'trial');
    if (reds.length) { for (const r of shapeRows) { r.state = 'not-checked'; r.reason = `code could not build the line's shape part: ${reds[0]?.detail}`; } return; }
    lineParts.push(part);
    lineRows.push(shapeRows.map((r) => r.key));
    for (const r of shapeRows) { r.state = 'built'; r.reason = null; }
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
    // S4: a sheet line quotes nothing and ties no number to a quote: its `$cited` default is never added (a cited part beside a sheet part is a stage-shape red)
    if (this.isSheetLine(l.n)) return;
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

  // ── a repo job's check TYPE (hamr 2026-11-15: "same flow as rubric, no exceptions; only the TYPE of checks varies") ──────────────────────────────────────────────────────────────────────────
  // The rows are the same rows. A `~` rule is kept (built) only when CODE finds a repo path in the person's own words that the write fence keeps; every other rule is asked about (Agree / Drop it / own
  // words, the same ask the rubric flow uses) or Not checked with a REASON. A `!` row is a work stage the drafter wrote from the catalogue (the check type), droppable like any `!` row, never the last one on a line.

  /**
   * The person's job lines as they stand now (a try-3 answer replaced or added a `~` rule): a rule whose words changed is the person's own typed words (its old answer is void), a new rule is a new row, a rule that is gone leaves.
   * @param {{n: number, text: string, rules?: string[]}[]} jobLines
   */
  syncJob(jobLines) {
    this.lines = jobLines.map((l) => ({ n: l.n, text: l.text }));
    const keep = new Set();
    for (const l of jobLines) {
      (l.rules ?? []).forEach((t, i) => {
        const key = `L${l.n}.~${i + 1}`;
        keep.add(key);
        const row = this.rows.find((r) => r.key === key);
        if (!row) { this.addRow({ key, line: l.n, kind: 'rule', by: 'you', from: 'rule', origin: 'typed', cantAsked: true, text: t, rule: i + 1 }); return; }
        if (row.text !== t) { row.text = t; row.origin = 'typed'; row.left = false; row.cantAsked = true; }
      });
    }
    this.rows = this.rows.filter((r) => r.kind !== 'rule' || keep.has(r.key));
  }

  /** the repo listing at the seed, once it is read (the rule rows are judged against it) @param {string[]|null} files */
  setListing(files) { if (this.repo !== null) this.repo.files = Array.isArray(files) ? [...files] : null; }

  /**
   * The drafter's work stages as `!` rows (a mandatory guard is not one), and a Not checked `!` row for each line the drafter refused: the refusal is only the SIGNAL, the reason is code's (`REASON.noRule`, the one table). Idempotent: the stage rows are made again from `stages`.
   * @param {any[]} stages the declaration's stages, guards included @param {{guardNames?: string[], refused?: any[], guardLines?: any[]}} [o]
   */
  addStages(stages, { guardNames = [], refused = [], guardLines = [] } = {}) {
    this.rows = this.rows.filter((r) => r.kind !== 'stage');
    this.declared = Array.isArray(stages) ? stages : [];
    this.guardCover = new Set((Array.isArray(guardLines) ? guardLines : []).flatMap((/** @type {any} */ g) => (Array.isArray(g?.lines) ? g.lines : [])));
    const guards = new Set(guardNames);
    // a line a live stage or a guard's `guardLines` covers is never refused (the rubric's rule: only a line no check could be built for is refused)
    const covered = new Set([...this.guardCover, ...this.declared.filter((st) => st && !guards.has(st.name) && Array.isArray(st.fromLine)).flatMap((st) => st.fromLine)]);
    for (const l of this.lines) {
      for (const st of this.declared) {
        if (!st || typeof st.name !== 'string' || guards.has(st.name) || !Array.isArray(st.fromLine) || st.fromLine.length === 0 || Math.min(...st.fromLine) !== l.n) continue;
        this.addRow({ key: stageKeyOf(st.name), line: l.n, kind: 'stage', by: 'agent', from: 'agent', stageName: st.name, cover: [...st.fromLine] });
      }
      (Array.isArray(refused) ? refused : []).filter((/** @type {any} */ x) => x && x.line === l.n && !Number.isInteger(x.rule) && typeof x.reason === 'string' && !covered.has(l.n))
        .forEach((/** @type {any} */ x, /** @type {number} */ i) => this.addRow({ key: `L${l.n}.refused.${i + 1}`, line: l.n, kind: 'stage', by: 'agent', from: 'agent', refusal: true, said: REASON.noRule }));
    }
  }

  /** the repo paths outside the write scope (the pointing call is shown these); empty when there is no listing or no fence @returns {string[]} */
  outsideScope() {
    const files = this.repo?.files;
    const scope = this.repo?.writeScope;
    return Array.isArray(files) && Array.isArray(scope) && scope.length ? files.filter((f) => !this.inScope(f)) : [];
  }

  /** the folders every file of which lies outside the write scope (a rule may ask such a folder to stay as it is, written `folder/`); the pointing call is shown them beside the files @returns {string[]} */
  outsideFolders() {
    const files = this.repo?.files;
    if (!Array.isArray(files) || this.outsideScope().length === 0) return [];
    const all = new Set();
    /** the folders above at least one file the run may change (one pass over the listing) */
    const open = new Set();
    for (const f of files) {
      const inside = this.inScope(f);
      for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) { all.add(f.slice(0, i)); if (inside) open.add(f.slice(0, i)); }
    }
    return [...all].filter((d) => !open.has(d));
  }

  /** is this repo file a place the run may change? @param {string} f */
  inScope(f) {
    return (this.repo?.writeScope ?? []).some((s) => { const pre = String(globToPrefix(String(s))).trim().replace(/^\.\//, '').replace(/\/+$/, ''); return pre === '' || pre === '.' || pre === '/' || f === pre || f.startsWith(`${pre}/`); });
  }

  /** the listing paths (a file, or a folder written `folder/`) a text names as whole tokens @param {string} text @returns {string[]} */
  namedPaths(text) {
    const files = this.repo?.files;
    if (!Array.isArray(files)) return [];
    const said = ` ${String(text).replace(/(^|[\s"'(])\.\//g, '$1')} `;
    const all = new Set(files);
    for (const f of files) for (let i = f.indexOf('/'); i > 0; i = f.indexOf('/', i + 1)) all.add(f.slice(0, i));
    // borrowed-from: bareloop src/checkblock.js@v0.60.0 (`namedPaths`): the tag builds a pattern from each path; src/ builds none (test/signed-text.test.js), so the same two tests are written by hand:
    // before the path no word character, `.`, `/` or `-`; after a file no word character or `-`, and no `.` that starts an extension; after a folder written `folder/` no word character, `.` or `-`
    const wordy = (/** @type {string} */ c) => /\w/.test(c);
    const holds = (/** @type {string} */ p) => {
      const tail = files.includes(p) ? '' : '/';
      for (let i = said.indexOf(p + tail); i !== -1; i = said.indexOf(p + tail, i + 1)) {
        const before = said[i - 1] ?? '';
        const after = said[i + p.length + tail.length] ?? '';
        const afterNext = said[i + p.length + tail.length + 1] ?? '';
        if (before !== '' && (wordy(before) || before === '.' || before === '/' || before === '-')) continue;
        if (files.includes(p) ? (after !== '' && (wordy(after) || after === '-' || (after === '.' && wordy(afterNext)))) : (after !== '' && (wordy(after) || after === '.' || after === '-'))) continue;
        return true;
      }
      return false;
    };
    return [...all].filter((p) => said.includes(p) && holds(p));
  }

  /**
   * Code's proof of a fence pointer: `path` is on the listing, the rule's own words name it (whole token; a folder as `folder/`), and neither it nor any other path those words name holds a place the run may change.
   * @param {string} text the rule's own words @param {string} path @returns {boolean}
   */
  provesFence(text, path) {
    const files = this.repo?.files;
    if (!Array.isArray(files) || this.outsideScope().length === 0) return false;
    const p = String(path).trim().replace(/^\.\//, '').replace(/\/+$/, '');
    const named = this.namedPaths(text);
    if (!named.includes(p)) return false;
    return !named.some((n) => files.some((f) => (f === n || f.startsWith(`${n}/`)) && this.inScope(f)));
  }

  /** the AI's pointer at a repo `~` rule ({op:'fence', line, rule, path}): judged ALONE; code's proof decides, the AI only points @param {any} e */
  editFence(e) {
    if (this.repo === null) return { refusedBecause: 'a fence pointer is for a repo job' };
    const r = this.ruleRows(e.line).find((x) => x.rule === e.rule);
    if (!r) return { refusedBecause: 'names no ~ rule of this line' };
    const path = typeof e.path === 'string' ? e.path.trim().replace(/^\.\//, '').replace(/\/+$/, '') : '';
    if (!path) return { refusedBecause: 'no path given' };
    if (!(this.repo.files ?? []).some((f) => f === path || f.startsWith(`${path}/`))) return { refusedBecause: `${path} is not on the repo listing` };
    if (!this.provesFence(r.text, path)) return { refusedBecause: `the rule's own words do not name ${path}, or it names a place the run may change` };
    r.pointed = path;
    return { accepted: true, landedKey: r.key };
  }

  /** a repo `~` rule: kept by the write fence when the AI pointed at a path and code proves it from the person's words; else the same ask the rubric flow uses (the person's Agree / Drop it / own words), Not checked when nobody can be asked @param {Row} r */
  matchRepoRule(r) {
    // the AI points, code proves (never kept without a pointer; own words that replaced the rule are proved again against the same pointer)
    if (typeof r.pointed === 'string' && this.provesFence(r.text, r.pointed)) { r.can = { ok: true, how: 'fence', path: r.pointed }; return; }
    if (r.origin === 'typed' || r.cantAsked) { r.can = { ok: false, why: REASON.nothingOnPage }; return; }
    r.can = { ok: false, why: REASON.noRule };
  }

  /** a repo job's rows: a rule is built with the path the fence keeps for it or Not checked with its reason; a work stage is built, or dropped when the person dropped it and it is not the last thing on its line */
  buildRepo() {
    for (const r of this.rows) {
      if (r.kind !== 'rule' && r.kind !== 'stage') continue;
      r.part = null;
      if (r.can?.ok) { r.state = 'built'; r.reason = null; if (r.kind === 'rule') r.fence = r.can.path; } else { r.state = 'not-checked'; r.reason = r.can?.why ?? 'not checked'; delete r.fence; }
    }
    for (const r of this.rows) {
      if (r.kind !== 'stage' || r.state !== 'built' || r.choice !== 'drop') continue;
      if (this.dropOk(r)) { r.state = 'dropped'; r.reason = REASON.dropped; } else r.choice = undefined;
    }
    const gone = new Set(this.rows.filter((r) => r.kind === 'stage' && r.state === 'dropped').map((r) => r.stageName));
    this.closeCache = { stages: this.declared.filter((st) => !gone.has(st?.name)), parts: [], map: [] };
    return this.closeCache;
  }

  /** may this repo work-stage row be dropped? Never the last check on a line it serves (another live stage, a guard's `guardLines` or a line refusal still covers it), and never the last work stage of the job @param {Row} r */
  dropOk(r) {
    const others = this.rows.filter((x) => x !== r && x.kind === 'stage');
    const live = others.filter((x) => !x.refusal && x.state === 'built');
    return live.length > 0 && (r.cover ?? [r.line]).every((/** @type {number} */ n) => this.guardCover.has(n) || live.some((x) => (x.cover ?? []).includes(n)) || others.some((x) => x.refusal && x.line === n));
  }

  /** a row the person can Drop (and Add back): a `!` fact, phrase or count; in a repo job also a work stage the drafter wrote @param {Row} r */
  droppable(r) { return this.isBang(r) || (this.repo !== null && r.kind === 'stage' && r.refusal !== true) || (r.kind === 'sheet' && r.by === 'agent') || (r.kind === 'shape' && r.by === 'agent') || (r.kind === 'rule' && r.can?.how === 'shape'); }

  // 5. the code-forced questions for rows code cannot settle (a person answers; the CHOICE decides, never the words). Cap 3 is the caller's (MAX_QUESTIONS).
  ask() {
    this.open = [];
    for (const r of this.rows) {
      if (!r.can?.ask) continue;
      this.open.push({ key: `${r.key}:${r.can.ask}`, rowKey: r.key, line: r.line, ruleText: r.text, ask: r.can.ask, proposal: r.can.proposal ?? null, ...(typeof r.can.question === 'string' ? { question: r.can.question } : {}), ...(Array.isArray(r.can.columns) ? { columns: r.can.columns, readings: r.can.readings } : {}), offers: { agree: r.can.proposal != null, drop: true } });
    }
    return this.open;
  }
  hasOpenQuestions() { return this.open.length > 0; }
  hasPendingDelta() { return this.queue.length > 0; }

  // 6. the person's answer: a row edit from the typed CHOICE (agree | drop), buttons only (hamr 2026-11-15: a typed own-words answer is retired; a rule is changed by Revise). ONE rule in, ONE rule out (hamr 2026-11-14):
  // an agreed answer REPLACES the asked rule, same line and same rule number; this list is the one owner (the job text is rebuilt from it, `jobLinesView`).
  /** @param {string} qKey @param {string} choice @param {string} [text] the person's correction (a reading question only) @returns {{ok: true} | {ok: false, why: string}} */
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
    // S1 tie: the person picked one of the tied columns (`text` = its name); the rule is the rule's own words with that column in place, one rule in, one rule out
    if (choice === 'column') {
      if (!Array.isArray(q.columns)) return { ok: false, why: 'that choice is not offered for this question' };
      const col = String(text ?? '');
      if (!q.columns.includes(col)) return { ok: false, why: 'that is not one of the columns offered' };
      r.text = String(q.readings?.[col]); r.agreed = true;
      return { ok: true };
    }
    if (choice === 'drop') { r.left = true; return { ok: true }; }
    // fwd keeps: the tag takes the person's own words only for a READING question (and marks them `corrected`); fwd takes them for any question (M10 am16)
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
    // S4: a rule has never two rows: the rules of a sheet line belong to the sheet checks, so a row edit about the line cannot add a second check or a second reason
    if (this.isSheetLine(e.line)) return { refusedBecause: REASON.sheetLine };
    if (e.op === 'add') {
      if (kept.adds >= MAX_BANG) return { refusedBecause: `more than ${MAX_BANG} checks proposed` };
      const res = this.editAdd(e);
      if (res.accepted) kept.adds += 1;
      return res;
    }
    if (e.op === 'fence') return this.editFence(e);
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

  /** the loop: while a question is open or a reply waits, apply it and reconcile the WHOLE list again. `answer(q)` gives {choice, text?} or null (a person who did not answer) */
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
    return { stages: c.stages, picks: this.picksOf(c), list: this.signedRows(), ...(this.fence ? { fence: [...this.fence] } : {}) };
  }

  /** the picks code records: a countable part carrying the `~` rule numbers it settles @param {{parts: any[], map: {part: number, line: number}[]}} c the build @returns {{line: number, part: any}[]} */
  picksOf(c) {
    return c.map.flatMap((m) => { const part = c.parts[m.part]; return part && part.class === 'countable' && Array.isArray(part.rules) ? [{ line: m.line, part }] : []; });
  }

  /**
   * The rules and lines the close has no check for, as the signed close's `refused` (one owner: the draft's assembled declaration and a final-card Drop both read it): each `~` rule row that is not built, then each job line no stage serves.
   * @param {{n: number}[]|null|undefined} jobLines @param {any[]} stages the block's stages @returns {{line: number, rule?: number, reason: string}[]}
   */
  refusedView(jobLines, stages) {
    /** @type {{line: number, rule?: number, reason: string}[]} */
    const refused = this.rows.filter((r) => r.kind === 'rule' && r.state !== 'built').map((r) => ({ line: r.line, rule: r.rule, reason: String(r.reason ?? 'not checked') }));
    for (const l of jobLines ?? []) if (!stages.some((st) => Array.isArray(st.fromLine) && st.fromLine.includes(l.n))) refused.push({ line: l.n, reason: REASON.noRule });
    return refused;
  }

  /** the standing ruling "a run needs one check": one row that is not the floor is built */
  hasBuiltCheck() { return this.rows.some((r) => r.state === 'built' && r.kind !== 'floor'); }

  /**
   * The signed list (`closeDecl.list`): the signed fields of every row, never its words. A suggestion not added is signed `dropped` ("suggested, not added"), a suggestion code could not build
   * `dropped` with code's reason (it is on the Audit, never on the card), and a built row carries the names of the facts it made (`facts`), so every reader can tag each fact by its row's kind.
   */
  signedRows() {
    const rows = (this.repo !== null ? [...this.rows].sort((a, b) => a.line - b.line) : this.rows).map((r) => {
      const gone = r.state === 'suggested' || r.hidden === true;
      const row = { ...r, ...(gone ? { state: 'dropped' } : {}), ...(r.state === 'built' && r.factNames?.length ? { facts: r.factNames } : {}) };
      return Object.fromEntries(SIGNED_ROW_FIELDS.filter((f) => row[f] !== undefined && row[f] !== null).map((f) => [f, row[f]]));
    });
    return [...rows, ...this.guards.map((name) => ({ line: 0, key: guardKeyOf(name), from: 'default', by: 'default', kind: 'guard', state: 'built' })), ...(this.fence ? [{ line: 0, key: FENCE_KEY, from: 'default', by: 'default', kind: 'fence', state: 'built' }] : [])];
  }

  /** the `[you]` rule rows the person dropped (Not checked, "You dropped it."): the card gives each an Add back button @returns {{key: string, line: number, text: string}[]} */
  droppedRulesView() {
    return this.rows.filter((r) => r.kind === 'rule' && this.shapeDrops.rules.has(`${r.line}:${r.rule}`)).map((r) => ({ key: r.key, line: r.line, text: String(r.text ?? '') }));
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
    // a rule's own shape field (rules first: the rule had no truth check) can be dropped: that rule goes Not checked; to get it back, Revise
    if (r.kind === 'rule' && r.can?.how === 'shape') {
      if (choice !== 'drop') return { ok: false, why: 'that check is already on the card' };
      this.shapeDrops.rules.add(`${r.line}:${r.rule}`);
      this.reconcile();
      return { ok: true };
    }
    if (r.kind === 'rule' && this.shapeDrops.rules.has(`${r.line}:${r.rule}`)) {
      // Add back: the inverse of the Drop above; the rule is judged again by code, so it returns to its own row (Checked) exactly as before the drop
      if (choice !== 'add') return { ok: false, why: 'that check is already dropped' };
      this.shapeDrops.rules.delete(`${r.line}:${r.rule}`);
      this.reconcile();
      return { ok: true };
    }
    if (r.by === 'you') return { ok: false, why: 'that check comes from a rule you wrote; edit the job to change it' };
    if (r.by !== 'agent' || !this.droppable(r)) return { ok: false, why: 'that check is code\'s own and stays' };
    if (choice !== 'drop' && choice !== 'add') return { ok: false, why: 'not one of the choices' };
    if (r.kind === 'stage') {
      // a repo work stage: Drop takes it out of the close (never the last check on its line), Add puts it back
      if (choice === 'drop' && r.state !== 'built') return { ok: false, why: 'only a check that is on the card can be dropped' };
      if (choice === 'add' && r.state !== 'dropped') return { ok: false, why: 'only a dropped check can be added back' };
      if (choice === 'drop' && !this.dropOk(r)) return { ok: false, why: `Dropping that check would leave line ${r.line} with no check, so it stays.` };
      r.choice = choice === 'drop' ? 'drop' : undefined;
      this.reconcile();
      return { ok: true };
    }
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
    return choiceEntries(this.lines, this.rows.filter((r) => r.kind !== 'sheet' && r.kind !== 'shape' && (r.choice === 'drop' || r.choice === 'add')).map((r) => ({ line: r.line, key: r.key, choice: String(r.choice) })));
  }

  /** a Revise keeps the last draft's Drop/Add choices on the rows that are still there (same line words, same row); code still judges every one @param {{lineWords: string, occurrence: number, tail: string, choice: string}[]} rec */
  carryChoices(rec) {
    const seen = new Map();
    const lines = this.lines.map((l) => { const w = norm(l.text); const o = seen.get(w) ?? 0; seen.set(w, o + 1); return { n: l.n, w, o }; });
    for (const c of Array.isArray(rec) ? rec : []) {
      if (!c || (c.choice !== 'drop' && c.choice !== 'add')) continue;
      const line = lines.find((l) => l.w === c.lineWords && l.o === c.occurrence);
      const r = line ? this.rows.find((x) => x.line === line.n && this.droppable(x) && x.key.replace(/^L\d+\./, '') === c.tail) : undefined;
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
