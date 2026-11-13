// M16 (docs/wiki/the-module-ladder.md, "M16"): the pieces of the drafter that touch the check block, in one place. src/drafter.js calls them in bareloop's order (authorjob.js@v0.56.0:
// build the block after the look, carry the last picks, the AI's pre-edits, the asks; then authorflow.js@v0.56.0: the row-edit turn, a revise only when an edit was refused, at most twice).
// borrowed-from: bareloop src/authorflow.js@v0.56.0 (3383cce) (renderRejectBlock, 'edits' kind only; MAX_REVISIONS; the plan-red words)
import { redactSecrets } from './redact.js';
import { newJobBlock } from './blocklines.js';
import { EDIT_OPS } from './checkblock.js';

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
 * Is this validator red about a check the BLOCK built (R2)? It names a line the block gave a check to (`builtLines`, from the red's own line number) and is about a close the code wrote: the quote check, a
 * picked check, the numbers tie, the class, the list or the picked-lines record; or it is the cited words' own `line N:` red. A red on a step's primitives, reads, emits or an ask names none of those.
 * @param {string} red @param {number[]} builtLines the lines the red names that the block built a check on
 */
export function isBuildFault(red, builtLines) {
  if (builtLines.length === 0) return false;
  return /close\.(?:cited|picked|shape|numbersFrom|class)|checkList|pickedLines/.test(red) || /^declaration: line \d+:/.test(red);
}

/**
 * The block of a draft (M16 item 2): the person's `~` rules and `$` defaults, then the look's facts, then the picks the person made (kept from the last draft, and just answered), reconciled once.
 * Fresh answers go through `carry` like the kept ones (the draft is a child process: the answer comes back as a pick or a left rule), and are not marked "kept".
 * `scoped`: the rules the pick path owns (src/checkpick.js offerRules over the block's lines); one the record folded into another ask (a broken pair's partner) is neither asked nor given the old check (bareloop authorjob.js@v0.56.0).
 * @param {{texts: Record<string, string>, jobLines: any[], look: {facts: any[], dropped: any[]}, kept: {picks: any[], left: any[], askRules: any[]}, fresh: {picks: any[], left: {line: number, rule: number}[]}, asks: boolean, countScope: (t: string) => boolean, scoped?: {line: number, rule: number}[]}} o
 */
export function setUpBlock({ texts, jobLines, look, kept, fresh, asks, countScope, scoped = [] }) {
  const block = newJobBlock({ texts, jobLines, asks, countScope });
  // a rule the person left is the block's own `left` row (carry, below); the look's person-left drop would say it twice
  block.addLook(look.facts, look.dropped.filter((d) => d.reason !== 'person-left'));
  block.carry({ picks: kept.picks, left: kept.left }, kept.askRules);
  const rowOf = (/** @type {number} */ line, /** @type {number} */ rule) => block.ruleRows(line).find((x) => x.rule === rule);
  block.carry({ picks: fresh.picks, left: fresh.left });
  for (const x of [...fresh.picks, ...fresh.left]) { const r = rowOf(x.line, x.rule); if (r && !kept.picks.some((k) => k.line === x.line && k.rule === x.rule) && !kept.left.some((k) => k.line === x.line && k.rule === x.rule)) delete r.keptFromLast; }
  block.reconcile();
  for (const r of scoped) {
    const row = rowOf(r.line, r.rule);
    if (row && !kept.askRules.some((a) => a.line === r.line && a.rule === r.rule) && !row.pick && !row.cantAsked && !row.left && !row.parent) row.folded = true;
  }
  block.reconcile();
  return block;
}

/** the `pick` pre-edits of the one suggest call: a kept check on a block line, as the block's own edit (R1; bareloop authorjob.js@v0.56.0) @param {{line: number, rule: number, check: Record<string, any>|null}[]} rows @param {Set<number>} blockLines */
export const pickEdits = (rows, blockLines) => rows.filter((r) => r.check && blockLines.has(r.line)).map((r) => ({ op: 'pick', line: r.line, rules: [r.rule], check: r.check }));

/** the `add` pre-edits of the ledger-suggest call (bareloop authorjob.js@v0.56.0: a count or a phrase; anything else is not an edit) @param {any[]} extra */
export function ledgerEdits(extra) {
  /** @type {any[]} */
  const adds = [];
  for (const e of Array.isArray(extra) ? extra : []) {
    const line = Number.isInteger(e?.line) ? e.line : 1;
    if (e?.kind === 'count') adds.push({ op: 'add', kind: 'count', line, min: e.min, max: e.max });
    else if (e?.kind === 'phrase' && typeof e.phrase === 'string') adds.push({ op: 'add', kind: 'phrase', line, name: e.phrase, words: [e.phrase], source: e.source });
  }
  return adds;
}

/**
 * M4d am39 on the row-edit turn: a brace-repaired reply is used only when the block can read every edit in it (an `edits` list of objects with a known op). A reply the block would refuse as unreadable
 * is a structure failure instead, as the declaration turn does for an unknown key.
 * @param {any} value
 */
export const repairedEditsReadable = (value) => Array.isArray(value?.edits) && value.edits.every((/** @type {any} */ e) => e && typeof e === 'object' && !Array.isArray(e) && EDIT_OPS.includes(e.op));

/** one applied reply as the round log keeps it: each edit, kept or refused with its own reason @param {{edits: any[]}} rec */
export const editRecord = (rec) => rec.edits.map((e) => ({ op: e?.op, accepted: e.accepted === true, ...(e.accepted === true ? {} : { refusedBecause: e.refusedBecause }) }));
