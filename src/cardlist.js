// borrowed-from: bareloop src/panel/jobplan.js@v0.56.0 (3383cce) (planFromConfirm: the card's suggested list and the checks under each line, from the block's own readers)
// M16 P4 item 4 (docs/wiki/the-module-ladder.md, "M16" item 5): what the plan card shows of the list, written ONCE at draft time from the block's own rows (`renderCard`, `suggestedView`)
// and kept in the draft's log.json as `checkCard`. The page only draws it (bareloop src/panel/jobplan.js@v0.56.0 reads the same two readers); it never decides a check.
// What this throws away: the rows' proofs (`can`, `pick`, parts). Only the words, the tag, the reason and whether a Drop is offered survive.
import { renderCard } from './checkblock.js';
import { kindOfCheck } from './checklook.js';
import { planCard } from './checkrows.js';

/**
 * @param {import('./checkblock.js').CheckBlock} block
 * @returns {{rows: {key: string, line: number, by: string, state: string, reason: string|null, drop: boolean, kind: 'truth'|'shape'|'file'}[], suggested: {key: string, line: number, text: string, dropped?: boolean}[], restorable?: {key: string, line: number, text: string}[]}}
 */
export function cardOfBlock(block) {
  // borrowed-from: bareloop src/panel/index.html@v0.61.0 (checkRow: a shape row has a Drop unless it is code's own) (M19 S9, section 3.7): every shape row has a Drop but code's own `$` one, the person's own `~` rule that took a field too (`droppable`, as the tag's page draws it: Drop unless `c.by` is "default"); a non-shape row is offered as before
  const dropOffered = new Set(block.rows.filter((r) => r.state === 'built' && (block.isBang(r) || ((r.kind === 'shape' || r.kind === 'rule') && block.droppable(r)))).map((r) => r.key));
  return {
    // M19 S3: the rows of a sheet line are drawn by src/sheetrows.js (`withSheetCard`), from the close the block's sheet part made; a dropped sheet check is the block's own suggested row
    // M19 S6 (section 3.3, 3.7): each row carries its kind word (`kindOfCheck`: a field of a list of items is `shape`, a line's output-file floor is `file`); the floor row of each line is drawn, `[default]` `file`, in fwd's words
    rows: [
      ...renderCard(block.rows.filter((r) => !block.isSheetLine(r.line))).map((r) => {
        const own = block.rows.find((x) => x.key === r.key);
        return { key: r.key, line: r.line, by: r.by, state: r.state, reason: r.reason ?? null, drop: dropOffered.has(r.key), kind: kindOfCheck({ key: r.key, ...(own?.kind === 'shape' || own?.can?.how === 'shape' ? { shape: /** @type {true} */ (true) } : {}) }) };
      }),
      ...block.rows.filter((r) => r.kind === 'floor' && r.state === 'built' && !block.isSheetLine(r.line)).map((r) => ({
        key: r.key, line: r.line, by: r.by, state: r.state, reason: null, drop: false, kind: kindOfCheck({ key: r.key }),
      })),
    ].sort((a, b) => a.line - b.line),
    suggested: block.suggestedView(),
    // borrowed-from: bareloop src/panel/jobplan.js@v0.61.0 (`restorable`: the `[you]` rules the person dropped, Not checked "You dropped it."; the card gives each an Add back button) (M19 S9); only when a rule is dropped, so the saved card of every other job is byte for byte what it was
    ...(block.droppedRulesView().length ? { restorable: block.droppedRulesView() } : {}),
  };
}

/**
 * M19 am6 to am9: the card a draft saves and the panel draws. The block's own card gives the suggestions, the restorable rows and the Drop flags; the rows come from the signed plan through the one reader (src/checkrows.js `planCard`),
 * with the Not checked rows as a list of their own. `kept` = the picks and rules a Revise carried (the block's `keptFromLast` rows).
 * @param {import('./checkblock.js').CheckBlock} block @param {any} withSheetAndTickets the block's card with the sheet and Tickets rows (src/sheetrows.js `withSheetCard`) @param {{declaration: any, lines: any[], csvRoles?: string[], log?: unknown}} plan
 */
export function cardOfPlanBlock(block, withSheetAndTickets, plan) {
  const kept = block.rows.filter((r) => r.keptFromLast === true && Number.isInteger(r.line) && Number.isInteger(r.rule)).map((r) => ({ line: r.line, rule: r.rule, ...(r.pick ? { check: r.pick } : {}) }));
  return planCard(withSheetAndTickets, { ...plan, kept });
}
