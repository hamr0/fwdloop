// M16 am4 (docs/wiki/the-module-ladder.md, "M16 amendment 4" (2)): a sheet line's checks (`close.sheet`) are rows on the plan's list, beside every other check.
// The AI writes the sheet checks (M10b); code only READS them as rows: this file is the ONE writer of a sheet row, of its tag and of its card text.
//   tag     a check whose `covers` names one of the person's `~` rules is `[you]`; a check that covers none (the AI added it) is `[agent]`. (A `[default]` sheet check does not exist: no code adds one.)
//   Drop    only an `[agent]` row, and only the check block drops it (src/checkblock.js `rowChoice`, M19 S3): the check leaves `close.sheet` and the block's `sheetDroppedRecord` keeps it in the picks record (`sheetDropped`). A `[you]` row has no Drop.
//   Add     the block puts a dropped check back.
// Words are fwd's existing sheet-check words (src/sheetblock.js `sheetPlainText`); nothing here words a check. What this throws away: the check's fields (id, claim, range ...); a row keeps its line, tag, part and key.
import { sheetLineBlocks, sheetPlainText } from './sheetblock.js';
import { closePartsOf } from './checklistsign.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the key of a sheet row: the block's `L<line>.<tail>` shape, tail `sheet.<check id>` @param {number} line @param {string} id */
export const sheetRowKey = (line, id) => `L${line}.sheet.${id}`;
// borrowed-from: bareloop src/sheetrows.js@v0.60.0 (`sheetCheckBody`; the tag's own header says bareloop copied the rest of that file from fwd)
/** the fields that say what a check IS: all but the names code gives it (id, claim), the rules it covers and its row tag. Two drafts name checks differently, so "the very same check" is read on these @param {any} c @returns {Record<string, any>} */
export function sheetCheckBody(c) { const { id: _i, claim: _c, covers: _v, row: _r, ...rest } = c; return rest; }
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
      const by = /** @type {'you'|'agent'} */ (e.by);
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
 * The plan's card with the sheet rows on it: the sheet rows after the block's rows. A dropped sheet check is among the block's own suggestions (Add), like any dropped `!` row (src/cardlist.js).
 * @param {{rows: any[], suggested: any[]}} card the block's card (src/cardlist.js) @param {{card: any[]}} sheet `sheetRowsOf`
 */
export function withSheetCard(card, sheet) {
  return { ...card, rows: [...card.rows, ...sheet.card] };
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
