// M16 am4 (docs/wiki/the-module-ladder.md, "M16 amendment 4" (2)): a sheet line's checks (`close.sheet`) are rows on the plan's list, beside every other check.
// The AI writes the sheet checks (M10b); code only READS them as rows: this file is the ONE writer of a sheet row, of its tag and of its card text, and of the Drop and Add of one.
//   tag     a check whose `covers` names one of the person's `~` rules is `[you]`; a check that covers none (the AI added it) is `[agent]`. (A `[default]` sheet check does not exist: no code adds one.)
//   Drop    only an `[agent]` row; the check leaves `close.sheet` and is kept in the picks record (`sheetDropped`) so Add can put it back. A `[you]` row has no Drop.
//   Add     puts a dropped check back at the place it had.
// Words are fwd's existing sheet-check words (src/sheetblock.js `sheetPlainText`); nothing here words a check. What this throws away: the check's fields (id, claim, range ...); a row keeps its line, tag, part and key.
import { sheetLineBlocks, sheetPlainText } from './sheetblock.js';
import { closePartsOf } from './checklistsign.js';
import { sheetByOf } from './checkwords.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the key of a sheet row: the block's `L<line>.<tail>` shape, tail `sheet.<check id>` @param {number} line @param {string} id */
export const sheetRowKey = (line, id) => `L${line}.sheet.${id}`;
/** @param {unknown} key @returns {boolean} the key is a sheet row's */
export const isSheetKey = (key) => typeof key === 'string' && key.startsWith('L') && key.includes('.sheet.');

/**
 * The sheet rows of a declaration, read from its steps' `close.sheet`: the signed rows (for `declaration.checkList`) and the card rows (words, tag, whether a Drop is offered).
 * @param {{declaration: any, lines: any[], csvRoles: string[]}} o
 * @returns {{signed: Record<string, any>[], card: {key: string, line: number, by: 'you'|'agent', state: 'built', text: string, reason: null, drop: boolean}[]}}
 */
export function sheetRowsOf({ declaration, lines, csvRoles }) {
  /** @type {Record<string, any>[]} */
  const signed = [];
  /** @type {any[]} */
  const card = [];
  const steps = isRec(declaration) && Array.isArray(declaration.steps) ? declaration.steps : [];
  steps.forEach((st, i) => {
    if (!isRec(st) || !isRec(st.close) || st.close.class !== 'green' || !Array.isArray(st.close.sheet) || st.close.sheet.length === 0 || !Number.isInteger(st.fromLine)) return;
    // the parts the earlier steps of this line have, then this step's own (the fact, the picks, the tie) come before its sheet checks (src/checklistsign.js `closePartsOf`)
    const before = steps.slice(0, i).filter((x) => isRec(x) && x.fromLine === st.fromLine).reduce((n, x) => n + closePartsOf(x, true).length, 0);
    const own = closePartsOf({ ...st, close: { ...st.close, sheet: undefined } }).length;
    const block = sheetLineBlocks({ declaration: { steps: [st] }, lines, csvRoles })[0];
    if (!block) return;
    block.checked.forEach((e, j) => {
      const by = sheetByOf(e.covers);
      const key = sheetRowKey(st.fromLine, e.id);
      const nums = Array.isArray(st.close.sheet[j]?.covers) ? st.close.sheet[j].covers.filter((/** @type {unknown} */ x) => Number.isInteger(x) && /** @type {number} */ (x) >= 1 && /** @type {number} */ (x) <= block.guardrails.length) : [];
      signed.push({
        line: st.fromLine, key, from: by === 'you' ? 'rule' : 'agent', by, kind: 'sheet', state: 'built',
        ...(by === 'you' ? { rule: Math.min(...nums) } : {}), part: { line: st.fromLine, part: before + own + j },
      });
      card.push({ key, line: st.fromLine, by, state: 'built', text: sheetPlainText(e.name, e.words, e.coversWords), reason: null, drop: by === 'agent' });
    });
  });
  return { signed, card };
}

/**
 * The plan's card with the sheet rows on it: the sheet rows after the block's rows, a dropped sheet check among the suggestions (Add), as the block's dropped suggestions are.
 * @param {{rows: any[], suggested: any[]}} card the block's card (src/cardlist.js) @param {{card: any[]}} sheet `sheetRowsOf` @param {{key: string, line: number, text: string}[]} [dropped]
 */
export function withSheetCard(card, sheet, dropped = []) {
  return { ...card, rows: [...card.rows, ...sheet.card], suggested: [...card.suggested, ...dropped.map((d) => ({ key: d.key, line: d.line, text: d.text, dropped: true }))] };
}

/** the dropped sheet checks the picks record keeps: `{key, line, index, check, text}` @returns {any[]} */
export const droppedSheetOf = (/** @type {any} */ record) => (isRec(record) && Array.isArray(record.sheetDropped) ? record.sheetDropped.filter((d) => isRec(d) && typeof d.key === 'string' && isRec(d.check) && Number.isInteger(d.line)) : []);

/**
 * The person's Drop or Add on a sheet row, applied to the declaration (a copy). Same words as the block's own refusals (src/checkblock.js `rowChoice`).
 * @param {{declaration: any, lines: any[], csvRoles: string[], op: 'drop'|'add', key: string, dropped: any[]}} o
 * @returns {{ok: true, declaration: any, dropped: any[]}|{ok: false, why: string}}
 */
export function sheetChoice({ declaration, lines, csvRoles, op, key, dropped }) {
  if (op === 'drop') {
    const row = sheetRowsOf({ declaration, lines, csvRoles }).card.find((r) => r.key === key);
    if (!row) return { ok: false, why: 'there is no such check on the list' };
    if (row.by === 'you') return { ok: false, why: 'that check comes from a rule you wrote; edit the job to change it' };
    let gone = null;
    const steps = declaration.steps.map((/** @type {any} */ st) => {
      if (gone !== null || !isRec(st) || st.fromLine !== row.line || !isRec(st.close) || !Array.isArray(st.close.sheet)) return st;
      const index = st.close.sheet.findIndex((/** @type {any} */ c) => isRec(c) && sheetRowKey(row.line, String(c.id)) === key);
      if (index === -1) return st;
      gone = { key, line: row.line, index, check: st.close.sheet[index], text: row.text };
      const sheet = st.close.sheet.filter((/** @type {unknown} */ _c, /** @type {number} */ k) => k !== index);
      const { sheet: _s, ...close } = st.close;
      return { ...st, close: sheet.length > 0 ? { ...close, sheet } : close };
    });
    if (gone === null) return { ok: false, why: 'there is no such check on the list' };
    return { ok: true, declaration: { ...declaration, steps }, dropped: [...dropped.filter((d) => d.key !== key), gone] };
  }
  const was = dropped.find((d) => d.key === key);
  if (!was) return { ok: false, why: 'only a suggested check can be added' };
  let put = false;
  const steps = declaration.steps.map((/** @type {any} */ st) => {
    if (put || !isRec(st) || st.fromLine !== was.line || !isRec(st.close) || st.close.class !== 'green') return st;
    put = true;
    const sheet = Array.isArray(st.close.sheet) ? [...st.close.sheet] : [];
    sheet.splice(Math.min(was.index, sheet.length), 0, was.check);
    return { ...st, close: { ...st.close, sheet } };
  });
  if (!put) return { ok: false, why: 'only a suggested check can be added' };
  return { ok: true, declaration: { ...declaration, steps }, dropped: dropped.filter((d) => d.key !== key) };
}

/**
 * The list of a declaration with its sheet rows: the block's rows first, then the sheet rows. A declaration with no sheet check keeps the list exactly as it was.
 * @param {{declaration: any, lines: any[], csvRoles: string[]}} o @returns {{declaration: any, sheet: ReturnType<typeof sheetRowsOf>}}
 */
export function withSheetRows({ declaration, lines, csvRoles }) {
  const { checkList: _old, ...rest } = declaration;
  const base = Array.isArray(declaration.checkList) ? declaration.checkList.filter((/** @type {any} */ r) => !(isRec(r) && r.kind === 'sheet')) : [];
  const sheet = sheetRowsOf({ declaration: rest, lines, csvRoles });
  return { declaration: sheet.signed.length === 0 ? declaration : { ...declaration, checkList: [...base, ...sheet.signed] }, sheet };
}
