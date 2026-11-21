// borrowed-from: bareloop src/rubricstep.js@v0.61.0 (checksOfClose, listRowName, ruleNotCheckedItems, DEFAULT_ROW_WORDS, refusedOf, cardOfClose), src/draftspend.js@v0.61.0 (readDraftLedger), src/checklist.js@v0.61.0 (ledgerRecord), shape of the walk; the words are fwd's own writers
// M19 am6 to am9 (docs/wiki/the-module-ladder.md): the ONE reader of the plan card's rows. Every check row on the card, the readout and the Job tab takes its words and tag from the SIGNED PLAN through this file,
// never from a row copy: one row per signed check part, words from fwd's own sentence writers (src/citedcheck.js, src/shaperows.js, src/checkwords.js), the tag and key from the signed list row that built the part.
// The Not checked rows are a list of their own (am8 item 3), named by am8 item 2 and am9 items 1 to 4; the draft's own ledger rows (am8 item 1) give the words of a row, else its key's tail.
// What this throws away: the row proofs (`can`, `pick`, parts) and the draft-time words; a Drop flag is joined by key from the saved card, never decided here.
import { factSentence, countSentence } from './citedcheck.js';
import { plainWords } from './checkwords.js';
import { closePartsOf, cardLinesOf } from './checklistsign.js';
import { sheetRowsOf } from './sheetrows.js';
import { ticketRowsOf } from './ticketrows.js';
import { shapeRowsOf } from './shaperows.js';
import { kindOfCheck } from './checklook.js';
import { rulesOfLine } from './sheetblock.js';
import { KEPT_WORDS } from './pickrecord.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the words of a line's floor row (src/cardlist.js drew them first; the reader is their one owner now) */
export const FLOOR_WORDS = "the file exists and its text is not empty (code's own floor)";
export const FLOOR_LIST_WORDS = "the file exists (code's own floor); this line lists items, so it has no text check";
/** am7 item 3: the numbers tie's words, `on line 1, 2` for several */
export const numbersWords = (/** @type {number[]} */ from) => `every number in the text is in a quote checked on line ${from.join(', ')}`;
/** am9 item 3 (bareloop `DEFAULT_ROW_WORDS`) */
export const DEFAULT_ROW_WORDS = Object.freeze({ cited: 'every claim quotes its input', numbers: 'every number matches a quote', note: 'the note' });
const FACT_KINDS = new Set(['fact', 'phrase', 'count']);

/**
 * am9 item 4: every list row in state not-checked is in the Not checked list, but the floor, a Tickets row (fwd draws those itself, am7 item 5) and a fact line's default cited.
 * @param {any[]} list @param {any} r
 */
export const isListedNotChecked = (list, r) => isRec(r) && r.state === 'not-checked' && r.kind !== 'floor' && r.kind !== 'ticket' && !(r.kind === 'cited' && list.some((x) => isRec(x) && x.line === r.line && FACT_KINDS.has(x.kind)));

/** the person's rule text a signed `rule` row holds (its line's `~` rule at the row's number), else undefined @param {any[]} lines @param {any} r a signed `rule` row */
export const ruleTextOf = (lines, r) => (Number.isInteger(r.rule) ? rulesOfLine(lines.find((l) => l.n === r.line))[r.rule - 1] : undefined);

/**
 * am8 item 1 and am9 item 5: the draft's ledger rows, one per Not checked list row, for the draft's own `log.json` `log` list (no new file). A `~` rule's words are its own text.
 * @param {any} declaration @param {any[]} lines @param {Record<string, string[]>} [wordsByKey] the words the build gave a row (its name)
 * @returns {{kind: 'ledger', phase: 'final', key: string, rowKind: string, words: string[], state: 'not-checked'}[]}
 */
export function ledgerRowsOf(declaration, lines, wordsByKey = {}) {
  const list = isRec(declaration) && Array.isArray(declaration.checkList) ? declaration.checkList : [];
  return list.filter((r) => isListedNotChecked(list, r)).map((r) => ({ kind: /** @type {const} */ ('ledger'), phase: /** @type {const} */ ('final'), key: String(r.key), rowKind: String(r.kind), words: r.kind === 'rule' ? [ruleTextOf(lines, r) ?? ''] : wordsByKey[r.key] ?? [], state: /** @type {const} */ ('not-checked') }));
}

/** am8 item 1: the last ledger row per key wins (bareloop `readDraftLedger`). @param {unknown} log @returns {Map<string, any>} */
export function readLedger(log) {
  const m = new Map();
  for (const r of Array.isArray(log) ? log : []) if (isRec(r) && r.kind === 'ledger' && typeof r.key === 'string') m.set(r.key, r);
  return m;
}

/**
 * The name of a Not checked row: am9 item 1 (a `~` rule: `line <n>: "<rule text>" - <reason>`, else `line <n>: rule <n> - <reason>`), item 2 (prose or stage: `line <n>: <reason>`), item 3 (cited, numbers, note: fixed words),
 * item 4 and am8 item 2 (any other: `<kind> "<ledger words>"`, else its key's tail). The dash is an em dash with a space each side.
 * @param {any} r the signed row @param {string|undefined} ruleText @param {string[]|undefined} words
 */
export function notCheckedName(r, ruleText, words) {
  const reason = r.reason ?? '';
  if (r.kind === 'rule') return ruleText !== undefined ? `line ${r.line}: "${ruleText}" — ${reason}` : `line ${r.line}: rule ${r.rule} — ${reason}`;
  if (r.kind === 'prose' || r.kind === 'stage') return `line ${r.line}: ${reason}`;
  if (r.kind in DEFAULT_ROW_WORDS) return DEFAULT_ROW_WORDS[/** @type {'cited'|'numbers'|'note'} */ (r.kind)];
  const tail = String(r.key).replace(/^L\d+\.(?:[^.]*\.)?/, '').trim();
  const w = Array.isArray(words) && words.length ? words : [tail || r.key];
  return `${r.kind} ${w.map((x) => `"${x}"`).join(', ')}`;
}

/**
 * The Not checked ITEM a plan saves for a list row (the string the readout, the Job tab, the Audit and the card's Not checked group read, src/checklook.js `ncRowsOf`): the row's name, with the code-written prefix `line <n>: ` for a row whose name
 * does not name its line (the prefix is how the surfaces place a row under its job line; `ncRowsOf` strips it), and M10 am17 (6)'s words when a Revise carried the row. ONE writer: src/blockassemble.js and the reader both call it.
 * @param {any} r the signed row @param {string|undefined} ruleText @param {string[]|undefined} words @param {boolean} [keptFromLast]
 */
export function notCheckedItem(r, ruleText, words, keptFromLast = false) {
  const name = notCheckedName(r, ruleText, words);
  const own = r.kind === 'rule' || r.kind === 'prose' || r.kind === 'stage' ? name : `line ${r.line}: ${name}`;
  return keptFromLast ? `${own} (${KEPT_WORDS})` : own;
}

/**
 * The rows of ONE step's close, in the close's part order (facts, the result count, the field rows of a list of items, each picked check, the numbers tie), each with `idx`, the index of the part the signed list's rows point at (src/checklistsign.js).
 * The ONE place the words of these rows are written: the card, the readout, the Job tab and the Audit's Checks fold all read them from here.
 * @param {{declaration: any, st: any, lines: any[], kept?: {line: number, check?: any, rule?: number}[], idx?: number}} o `idx` = the first part's index (the parts the earlier steps of the line have)
 * @returns {{rows: any[], next: number}}
 */
export function stepRowsOf({ declaration, st, lines, kept = [], idx = 0 }) {
  const list = isRec(declaration) && Array.isArray(declaration.checkList) ? declaration.checkList.filter(isRec) : [];
  const builtOn = (/** @type {number} */ line) => list.filter((r) => r.line === line && r.state === 'built' && r.kind !== 'floor');
  const owner = (/** @type {any[]} */ rows) => rows.find((r) => r.by === 'you') ?? rows[0] ?? null; // am7 item 5: the first [you] row
  /** @type {any[]} */
  const out = [];
  const line = st.fromLine;
  const close = isRec(st.close) ? st.close : {};
  if (isRec(close.cited)) {
    const c = close.cited;
    for (const f of Array.isArray(c.facts) ? c.facts : []) {
      const own = owner(builtOn(line).filter((r) => Array.isArray(r.facts) && r.facts.includes(f.name)));
      out.push({ line, key: own?.key ?? `L${line}.fact.${f.name}`, by: own?.by ?? 'agent', state: 'built', kind: 'truth', text: factSentence(f, c.source), reason: null, idx, part: `L${line}:fact:${f.name}` });
    }
    const cs = countSentence(c);
    if (cs) {
      const own = builtOn(line).find((r) => r.kind === 'count');
      out.push({ line, key: own?.key ?? `L${line}.count`, by: own?.by ?? 'agent', state: 'built', kind: 'truth', text: cs, reason: null, idx, part: `L${line}:count` });
    }
    idx += 1;
  }
  if (isRec(close.itemShape)) {
    const shim = { stages: [{ kind: 'rubric-step', params: { step: line, parts: [{ ...close.itemShape, class: 'shape' }] } }] };
    for (const x of shapeRowsOf(shim, lines.map((l) => ({ n: l.n, text: l.text, rules: rulesOfLine(l) })))) {
      const signed = list.find((r) => r.key === x.key);
      if (x.by === 'default' && !signed) continue;
      out.push({ line, key: x.key, by: signed?.by ?? x.by, state: 'built', kind: kindOfCheck({ key: x.key, shape: true }), text: x.text, reason: null, idx, part: `L${line}:shape:${/** @type {any} */ (x).name ?? '$'}` });
    }
    idx += 1;
  }
  const picked = Array.isArray(close.picked) ? close.picked : isRec(close.shape) && Array.isArray(close.shape.picked) ? close.shape.picked : [];
  for (const c of picked) {
    const own = owner(builtOn(line).filter((r) => isRec(r.part) && r.part.part === idx));
    const isKept = kept.some((k) => k.line === line && isRec(k.check) && plainWords(k.check) === plainWords(c));
    out.push({ line, key: own?.key ?? `L${line}.pick.${idx}`, by: own?.by ?? 'agent', state: 'built', kind: 'truth', text: `${plainWords(c)}${isKept ? ` · ${KEPT_WORDS}` : ''}`, reason: null, idx, part: `L${line}:pick:${idx}` });
    idx += 1;
  }
  if (Array.isArray(close.numbersFrom) && close.numbersFrom.length > 0) {
    const own = owner(builtOn(line).filter((r) => r.kind === 'numbers' || (isRec(r.part) && r.part.part === idx)));
    out.push({ line, key: own?.key ?? `L${line}.$numbers`, by: own?.by ?? 'default', state: 'built', kind: 'truth', text: numbersWords(close.numbersFrom), reason: null, idx, part: `L${line}:numbers` });
    idx += 1;
  }
  return { rows: out, next: idx };
}

/**
 * The card's rows and its Not checked list, read from the signed plan.
 * @param {{declaration: any, lines: {n: number, text?: string, guardrail?: string}[], csvRoles?: string[], kept?: {line: number, check?: any, rule?: number}[], log?: unknown}} o `log` = the draft's own `log.json` `log` list (the ledger rows are read from it)
 * @returns {{rows: {line: number, key: string, by: string, state: string, kind: string, text: string, reason: string|null, drop?: boolean, part: string}[], notChecked: {line: number, key: string, by: string, state: 'not-checked', kind: string, text: string, reason: string|null, part: string}[]}}
 */
export function cardOfPlan({ declaration, lines, csvRoles = [], kept = [], log = [] }) {
  const led = readLedger(log);
  const list = isRec(declaration) && Array.isArray(declaration.checkList) ? declaration.checkList.filter(isRec) : [];
  const steps = isRec(declaration) && Array.isArray(declaration.steps) ? declaration.steps.filter(isRec) : [];
  const listed = list.filter((r) => isListedNotChecked(list, r));
  const listedKeys = new Set(listed.map((r) => r.key));
  /** @type {any[]} */
  const out = [];
  const cardLines = cardLinesOf(declaration);
  const offsets = new Map();
  for (const st of steps) {
    const line = st.fromLine;
    if (!Number.isInteger(line) || !cardLines.has(line)) continue;
    const r = stepRowsOf({ declaration, st, lines, kept, idx: offsets.get(line) ?? 0 });
    out.push(...r.rows);
    offsets.set(line, r.next);
  }
  // fwd's own rows keep their own drawing (am6 item 5): sheet rows (`sheetRowsOf`), Tickets rows (`ticketRowsOf`, only where the signed list holds the row, am7 item 7)
  const sheet = sheetRowsOf({ declaration: { ...declaration, checkList: undefined }, lines, csvRoles });
  for (const r of sheet.card) if (!listedKeys.has(r.key)) out.push({ line: r.line, key: r.key, by: r.by, state: r.state, kind: 'truth', text: r.text, reason: r.reason, drop: r.drop === true, part: r.key });
  const tk = ticketRowsOf({ declaration, lines });
  for (const r of tk.card) if (list.some((x) => x.key === r.key)) out.push({ line: r.line, key: r.key, by: r.by, state: r.state, kind: 'truth', text: r.text, reason: r.reason, part: r.key });
  // the floor rows
  for (const r of list) {
    if (r.kind !== 'floor') continue;
    const on = steps.filter((s) => s.fromLine === r.line).map((s) => s.close ?? {});
    const listLine = on.some((c) => isRec(c.itemShape)) && !on.some((c) => isRec(c.cited)) && !on.some((c) => (Array.isArray(c.picked) && c.picked.length) || (Array.isArray(c.shape?.picked) && c.shape.picked.length) || (Array.isArray(c.numbersFrom) && c.numbersFrom.length));
    out.push({ line: r.line, key: r.key, by: r.by, state: 'built', kind: kindOfCheck({ key: r.key }), text: listLine ? FLOOR_LIST_WORDS : FLOOR_WORDS, reason: null, part: r.key });
  }
  // am7 item 4: sheet; (a Tickets row after the sheet rows); facts, then the result count; shape; picks; then the defaults (cited, numbers); the floor row last
  const rank = (/** @type {any} */ r) => (/\.sheet\./.test(r.key) ? 0 : /\.ticket\./.test(r.key) ? 0.5 : /:fact:/.test(r.part) ? 1 : /:count$/.test(r.part) ? 2 : /:shape:/.test(r.part) ? 3 : /:pick:/.test(r.part) ? 4 : /:numbers$/.test(r.part) ? 5 : /\$floor$/.test(r.key) ? 6 : 4.5);
  const rows = out.map((r, i) => ({ ...r, rank: rank(r), i })).sort((a, b) => a.line - b.line || a.rank - b.rank || a.i - b.i).map(({ rank: _r, i: _i, ...r }) => r);
  // am8 item 3: the Not checked rows are a list of their own, in the signed list's order
  const notChecked = listed.map((r) => ({ line: /** @type {number} */ (r.line), key: String(r.key), by: String(r.by), state: /** @type {const} */ ('not-checked'), kind: 'truth', reason: r.reason ?? null, part: `nc:${r.key}`, text: notCheckedName(r, ruleTextOf(lines, r), led.get(r.key)?.words), item: notCheckedItem(r, ruleTextOf(lines, r), led.get(r.key)?.words, r.kind === 'rule' && kept.some((k) => k.line === r.line && k.rule === r.rule)) }));
  return { rows, notChecked };
}

/**
 * M19 am6 item 3 (bareloop `planMatchesClose`): the checks a card shows must equal the checks the signed plan runs, line by line. Returns the reds, each naming the line; empty = they match. Pure.
 * @param {{declaration: any, lines: any[], csvRoles?: string[], kept?: any[], log?: unknown}} plan @param {any} card the card as shown
 * @returns {string[]}
 */
export function planMatchesCard(plan, card) {
  if (!isRec(card) || !Array.isArray(card.rows)) return [];
  const want = cardOfPlan(plan).rows;
  const shown = (/** @type {any[]} */ rows, /** @type {number} */ n) => rows.filter((r) => r.line === n && r.state === 'built').map((r) => `${r.key}|${r.by}|${r.text}`);
  const lines = [...new Set([...want.map((r) => r.line), ...card.rows.filter((r) => isRec(r) && Number.isInteger(r.line)).map((r) => r.line)])].sort((a, b) => a - b);
  return lines.filter((n) => shown(want, n).join('\n') !== shown(card.rows, n).join('\n')).map((n) => `The card shows different checks from the plan on line ${n}. Nothing was signed - draft again.`);
}

/**
 * The card as the draft saves and the panel draws it: the block's own card (suggestions, restorable, the Drop flags) with its rows read from the signed plan and its Not checked list beside them.
 * A Drop flag is joined by key from the block's card; a row the block's card has no flag for keeps the flag its own reader gave it (a sheet row), else false.
 * @param {any} card the block's card (src/cardlist.js, with the sheet and Tickets rows) @param {Parameters<typeof cardOfPlan>[0]} plan
 */
export function planCard(card, plan) {
  const { rows, notChecked } = cardOfPlan(plan);
  const dropOf = new Map((Array.isArray(card?.rows) ? card.rows : []).filter(isRec).map((/** @type {any} */ r) => [r.key, r.drop === true]));
  return { ...card, rows: rows.map((r) => ({ ...r, drop: dropOf.has(r.key) ? dropOf.get(r.key) : r.drop === true })), notChecked };
}
