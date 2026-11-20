// borrowed-from: bareloop src/panel/jobplan.js@v0.56.0 (3383cce) (planFromConfirm: the card's suggested list and the checks under each line, from the block's own readers)
// M16 P4 item 4 (docs/wiki/the-module-ladder.md, "M16" item 5): what the plan card shows of the list, written ONCE at draft time from the block's own rows (`renderCard`, `suggestedView`)
// and kept in the draft's log.json as `checkCard`. The page only draws it (bareloop src/panel/jobplan.js@v0.56.0 reads the same two readers); it never decides a check.
// What this throws away: the rows' proofs (`can`, `pick`, parts). Only the words, the tag, the reason and whether a Drop is offered survive.
import { renderCard } from './checkblock.js';
import { kindOfCheck } from './checklook.js';

/**
 * @param {import('./checkblock.js').CheckBlock} block
 * @returns {{rows: {key: string, line: number, by: string, state: string, text: string, reason: string|null, drop: boolean, kind: 'truth'|'shape'|'file'}[], suggested: {key: string, line: number, text: string, dropped?: boolean}[]}}
 */
export function cardOfBlock(block) {
  const dropOffered = new Set(block.rows.filter((r) => r.state === 'built' && block.isBang(r)).map((r) => r.key));
  return {
    // M19 S3: the rows of a sheet line are drawn by src/sheetrows.js (`withSheetCard`), from the close the block's sheet part made; a dropped sheet check is the block's own suggested row
    // M19 S6 (section 3.3, 3.7): each row carries its kind word (`kindOfCheck`: a field of a list of items is `shape`, a line's output-file floor is `file`); the floor row of each line is drawn, `[default]` `file`, in fwd's words
    rows: [
      ...renderCard(block.rows.filter((r) => !block.isSheetLine(r.line))).map((r) => {
        const own = block.rows.find((x) => x.key === r.key);
        return { key: r.key, line: r.line, by: r.by, state: r.state, text: r.text.replace(/^[~!$] /, ''), reason: r.reason ?? null, drop: dropOffered.has(r.key), kind: kindOfCheck({ key: r.key, ...(own?.kind === 'shape' || own?.can?.how === 'shape' ? { shape: /** @type {true} */ (true) } : {}) }) };
      }),
      ...block.rows.filter((r) => r.kind === 'floor' && r.state === 'built' && !block.isSheetLine(r.line)).map((r) => ({
        key: r.key, line: r.line, by: r.by, state: r.state, text: r.listLine === true ? "the file exists (code's own floor); this line lists items, so it has no text check" : String(r.text), reason: null, drop: false, kind: kindOfCheck({ key: r.key }),
      })),
    ].sort((a, b) => a.line - b.line),
    suggested: block.suggestedView(),
  };
}
