// borrowed-from: bareloop src/panel/jobplan.js@v0.56.0 (3383cce) (planFromConfirm: the card's suggested list and the checks under each line, from the block's own readers)
// M16 P4 item 4 (docs/wiki/the-module-ladder.md, "M16" item 5): what the plan card shows of the list, written ONCE at draft time from the block's own rows (`renderCard`, `suggestedView`)
// and kept in the draft's log.json as `checkCard`. The page only draws it (bareloop src/panel/jobplan.js@v0.56.0 reads the same two readers); it never decides a check.
// What this throws away: the rows' proofs (`can`, `pick`, parts). Only the words, the tag, the reason and whether a Drop is offered survive.
import { renderCard } from './checkblock.js';

/**
 * @param {import('./checkblock.js').CheckBlock} block
 * @returns {{rows: {key: string, line: number, by: string, state: string, text: string, reason: string|null, drop: boolean}[], suggested: {key: string, line: number, text: string, dropped?: boolean}[]}}
 */
export function cardOfBlock(block) {
  const dropOffered = new Set(block.rows.filter((r) => r.state === 'built' && block.isBang(r)).map((r) => r.key));
  return {
    // M19 S3: the rows of a sheet line are drawn by src/sheetrows.js (`withSheetCard`), from the close the block's sheet part made; a dropped sheet check is the block's own suggested row
    rows: renderCard(block.rows.filter((r) => !block.isSheetLine(r.line))).map((r) => ({
      key: r.key, line: r.line, by: r.by, state: r.state, text: r.text.replace(/^[~!$] /, ''), reason: r.reason ?? null, drop: dropOffered.has(r.key),
    })),
    suggested: block.suggestedView(),
  };
}
