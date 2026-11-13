// M16 (docs/wiki/the-module-ladder.md, "M16"): the pieces of the drafter that touch the check block, in one place. src/drafter.js calls them in bareloop's order (authorjob.js@v0.56.0:
// build the block after the look, carry the last picks, the AI's pre-edits, the asks; then authorflow.js@v0.56.0: the row-edit turn, a revise only when an edit was refused, at most twice).
// borrowed-from: bareloop src/authorflow.js@v0.56.0 (3383cce) (renderRejectBlock, 'edits' kind only; MAX_REVISIONS; the plan-red words)
import { redactSecrets } from './redact.js';
import { newJobBlock } from './blocklines.js';

/** the cap of refusals one revise turn carries (bareloop REVISE_RED_CAP) */
export const REVISE_RED_CAP = 20;

/** the tail of a revise turn that follows refused edits: each refusal's own reason and nothing else (bareloop renderRejectBlock) @param {string[]} reds */
export function renderRejectBlock(reds, cap = REVISE_RED_CAP) {
  const shown = reds.slice(0, cap);
  const tail = reds.length > shown.length ? [`  [${reds.length - shown.length} of ${reds.length} reds withheld — the cap is ${cap}]`] : [];
  return redactSecrets(['MEASURED EDITS — some of your edits were refused; each refusal is its own and your other edits stand:', ...shown.map((r) => `  ${r}`), ...tail].join('\n'));
}

/** the words a plan-red on a part the block built stops with (bareloop authorflow.js@v0.56.0): our fault, never sent to the AI @param {string[]} reds */
export const buildFaultWords = (reds) => `The plan code built from your checks did not pass its own gate (${reds.slice(0, 2).join('; ')}). That is a fault in the build, not in your job: nothing was spent on a close.`;

/**
 * The block of a draft (M16 item 2): the person's `~` rules and `$` defaults, then the look's facts, then the picks the person made (kept from the last draft, and just answered), reconciled once.
 * Fresh answers go through `carry` like the kept ones (the draft is a child process: the answer comes back as a pick or a left rule), and are not marked "kept".
 * @param {{texts: Record<string, string>, jobLines: any[], look: {facts: any[], dropped: any[]}, kept: {picks: any[], left: any[], askRules: any[]}, fresh: {picks: any[], left: {line: number, rule: number}[]}, asks: boolean, countScope: (t: string) => boolean}} o
 */
export function setUpBlock({ texts, jobLines, look, kept, fresh, asks, countScope }) {
  const block = newJobBlock({ texts, jobLines, asks, countScope });
  // a rule the person left is the block's own `left` row (carry, below); the look's person-left drop would say it twice
  block.addLook(look.facts, look.dropped.filter((d) => d.reason !== 'person-left'));
  block.carry({ picks: kept.picks, left: kept.left }, kept.askRules);
  const rowOf = (/** @type {number} */ line, /** @type {number} */ rule) => block.ruleRows(line).find((x) => x.rule === rule);
  block.carry({ picks: fresh.picks, left: fresh.left });
  for (const x of [...fresh.picks, ...fresh.left]) { const r = rowOf(x.line, x.rule); if (r && !kept.picks.some((k) => k.line === x.line && k.rule === x.rule) && !kept.left.some((k) => k.line === x.line && k.rule === x.rule)) delete r.keptFromLast; }
  block.reconcile();
  return block;
}
