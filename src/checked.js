// M4e amendments 24 item 6, 25: "Checked" and "Not checked" at sign.
//
// CHECKED is built here, by code, from the plan's TYPED closes (`close.class` and `close.shape`) — never from model text. It says only what a
// typed check really does (src/closers.js): `green` recomputes a cited figure; `softgreen` runs the declared shape (headings in order, word
// ceilings, lines per invoice and the fields each block carries); `hitl` has no content check — a human reads it at the ask. A shape key that is
// not in SHAPE_KEYS has no sentence, so a key the closers do not run can never be listed as checked.
//
// NOT CHECKED is the drafter's own reading (a list of short phrases it wrote in the same call). It is information only: shown with its label,
// never signed, never in the readout, never in the spec hash. What this throws away: anything the drafter did not list; the list is not complete.

/** The label that always sits with the "Not checked" list (am41 item 3: the ONE place these words live; the Job tab and the Chat card read it off their payloads). */
export const NOT_CHECKED_LABEL = "not checked (the AI's own reading)";
/** M16 item 5 (replaces M4e am40/am41's words for the checks of a line on the list): the label of a plan that has a list */
export const LIST_NOT_CHECKED_LABEL = 'Not checked';
/** the label that sits with a plan's Not checked list: a plan with a list says "Not checked", an older plan keeps the words it was signed with @param {any} declaration */
export const notCheckedLabelOf = (declaration) => (listLinesOf(declaration).size > 0 ? LIST_NOT_CHECKED_LABEL : NOT_CHECKED_LABEL);

import { factRows } from './citedcheck.js';
import { plainWords, labelled, tagged } from './checkwords.js';
import { listLinesOf } from './checklistsign.js';
import { stepRowsOf } from './checkrows.js';
import { sheetCheckRows } from './sheetchecks.js';
import { sheetLineBlocks } from './sheetblock.js';
import { splitReadNotes, signedFactNames } from './pagedropwords.js';

/** the quote check's lead sentence (one writer: both the listed and the unlisted line) @param {string} source */
const citedLead = (source) => `Each result must be quoted word for word from the saved page "${source}", and the machine checks every quote, every value and the count against that copy.`;
const list = (xs) => xs.join(', ');

/** The words for a step with no machine check of its content: the ONE owner (the card and the draft readout both call it). @param {boolean} hasAsk the job has a signed ask @param {boolean} afterLastAsk the step comes after the last ask */
export function hitlWords(hasAsk, afterLastAsk) {
  if (afterLastAsk) return 'No machine check of the content; you check it after you accept.';
  return hasAsk ? 'No machine check of the content: you check it at the ask.' : 'No machine check of the content; the machine checks only that the step happened.';
}

/**
 * One entry per step, in plan order: the plain sentences for what its typed close checks.
 * M10b piece 4: with `lines` (the signed job lines) a step that reads a sheet also carries `sheet`, its line's block (src/sheetblock.js `sheetLineBlocks`: guardrails,
 * Checked with `covers`, Not checked), and its sentences are only the lead sentence; the surfaces draw the block. Without `lines` the older one-row-per-check sentences.
 * @param {{ steps?: any[] }} declaration @param {{ hasAsk?: boolean, askLines?: number[], lines?: any[], csvRoles?: string[], keptChecks?: {line: number, check: any}[], keptWords?: string }} [opts] hasAsk = the job has a signed ask line (so "you check it at the ask" is true);
 *   askLines = the job lines of the signed asks, which also lets a step after the LAST ask read "you check it after you accept" (am41 item 2, am42: the ONE place for these words)
 * @returns {{ step: number, line: number|null, goal: string, class: string, lead: string|null, sentences: string[], sheet?: ReturnType<typeof sheetLineBlocks>[number] }[]}
 */
export function checkedLines(declaration, { hasAsk = true, askLines, lines, csvRoles = [], keptChecks = [], keptWords = '' } = {}) {
  const blocks = Array.isArray(lines) ? sheetLineBlocks({ declaration, lines, csvRoles }) : [];
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const keptOf = (/** @type {number} */ line, /** @type {any} */ c) => (keptChecks.some((k) => k.line === line && plainWords(k.check) === plainWords(c)) ? ` (${keptWords})` : '');
  if (Array.isArray(askLines)) hasAsk = askLines.length > 0;
  const onList = listLinesOf(declaration); // M16: a line with a list shows each check with the tag of its row
  const lastAsk = Array.isArray(askLines) ? steps.reduce((m, st, i) => (askLines.includes(st?.fromLine) ? i : m), -1) : -1;
  return steps.map((st, i) => {
    const cls = st?.close?.class;
    const firstGreen = steps.findIndex((x) => x?.fromLine === st?.fromLine && x?.close?.class === 'green') === i;
    const sheet = firstGreen ? (blocks.find((b) => b.line === st?.fromLine) ?? null) : null;
    const shape = st?.close?.shape && typeof st.close.shape === 'object' ? st.close.shape : {};
    /** F252: the ONE lead sentence of the step (null when it states none); `sentences` is the lead, then the rows */
    /** @type {string|null} */
    let lead = null;
    /** @type {string[]} */
    const out = [];
    const listed = onList.has(st?.fromLine);
    if (listed && cls === 'green' && st.close.cited && typeof st.close.cited === 'object') {
      // M16: a list line states the quote check's lead, then each check as a row with the tag of its own row (below)
      lead = citedLead(st.close.cited.source);
    } else if (cls === 'green' && st.close.cited && typeof st.close.cited === 'object') {
      // M10 am7 item 1: the facts the drafter wrote, as plain rows written by code from the typed fields
      lead = citedLead(st.close.cited.source);
      out.push(...factRows(st.close.cited).map((r) => labelled(r, 'agent')));
    } else if (cls === 'green' && Array.isArray(st.close.sheet)) {
      // M10b piece 1: the signed sheet checks, one row each, written by code from the typed fields
      lead = 'The machine recomputes each of these from the saved sheet and compares it with what the step gave:';
      out.push(...(sheet ? [] : sheetCheckRows(st.close.sheet).map((r) => labelled(r, 'agent'))));
    } else if (cls === 'green') {
      // M19 am11 item 6: a list line (itemShape) states no lead sentence; its checks are the rows below (listPartRows)
      if (!(st.close.itemShape && typeof st.close.itemShape === 'object')) lead = 'Every figure must cite its source cell, or a formula over cells, and the machine recomputes it and compares it with its source.';
    } else if (cls === 'softgreen') {
      lead = 'The reply is checked as plain text only.';
      if (Number.isInteger(shape.maxWords)) out.push(labelled(`The whole output is under ${shape.maxWords} words.`, 'agent'));
      if (Array.isArray(shape.sections) && shape.sections.length > 0) out.push(labelled(`These section headings are there, in this order: ${list(shape.sections)}.`, 'agent'));
      if (Number.isInteger(shape.wordsPerSection) && Array.isArray(shape.sections) && shape.sections.length > 0) out.push(labelled(`Each of those sections is about ${shape.wordsPerSection} words.`, 'agent'));
      if (Number.isInteger(shape.linesPerInvoice)) out.push(labelled(`The output comes in blocks of ${shape.linesPerInvoice} lines.`, 'agent'));
      if (Array.isArray(shape.mustCarry) && shape.mustCarry.length > 0) out.push(labelled(`Every block carries: ${list(shape.mustCarry)}.`, 'agent'));
      // M10 am16: each check the person picked, in the words it was picked in (src/checkwords.js, the one place)
      if (!listed && Array.isArray(shape.picked)) for (const c of shape.picked) out.push(labelled(`You picked: ${plainWords(c)}.${keptOf(st.fromLine, c)}`, 'picked'));
    } else {
      lead = hitlWords(hasAsk, lastAsk !== -1 && i > lastAsk);
    }
    // M10 am22 (1)(4): the checks the person picked for a fact line, beside its fact rows
    if (!listed && cls === 'green' && Array.isArray(st.close.picked)) for (const c of st.close.picked) out.push(labelled(`You picked: ${plainWords(c)}.${keptOf(st.fromLine, c)}`, 'picked'));
    // M16 item 5: the checks of a list line, one tagged sentence each, from the rows' own reader
    if (listed) out.push(...listPartRows(declaration, st, { lines: Array.isArray(lines) ? lines : [], kept: keptChecks }).map((r) => tagged(r.text, r.by)));
    return {
      step: i + 1, line: Number.isInteger(st?.fromLine) ? st.fromLine : null, goal: typeof st?.goal === 'string' ? st.goal : '', class: String(cls), lead, sentences: lead === null ? out : [lead, ...out],
      ...(sheet && cls === 'green' ? { sheet } : {}),
    };
  });
}

/** The "Not checked" block the page shows: always the label, then the drafter's items (an empty list says the drafter listed nothing). @param {unknown} items @param {string} [label] */
export function notCheckedBlock(items, label = NOT_CHECKED_LABEL) {
  const clean = Array.isArray(items) ? items.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
  return { label, items: clean };
}

/**
 * M10 am11: the Not checked block split for showing. The drafter's list and code's drop lines are one list on disk (and in the sign row, unchanged);
 * the page shows code's notes about written forms it did not use apart, as "How the page was read" (`readNotes`). The signed facts decide an s1 note.
 * @param {unknown} items @param {any} declaration the plan's declaration (its cited facts are the signed ones)
 */
export function notCheckedView(items, declaration) {
  const block = notCheckedBlock(items, notCheckedLabelOf(declaration));
  const { notChecked, readNotes } = splitReadNotes(block.items, signedFactNames(declaration));
  return { label: block.label, items: notChecked, readNotes };
}

/**
 * The checks of one list line's step as rows `{text, by, part}` in the close's part order (the quote check's facts and count, the field rows of a list of items, each picked check, the numbers tie), each with the `by` of the row that built it.
 * M19 am7 items 1 to 3 and 8: the words are the card's, from the one reader (src/checkrows.js `stepRowsOf`); `part` is the index the signed list's rows point at (src/checklistsign.js), with a list line's shape part counted.
 * ONE reader for the plan card's sentences, the Job tab and the Audit's Checks fold. Pure.
 * @param {any} declaration @param {any} st the step @param {{lines?: any[], kept?: {line: number, check: any}[]}} [o] `lines` = the signed job lines (a field row's words read the person's rule), `kept` = the picks a Revise carried
 * @returns {{text: string, by: 'you'|'agent'|'default', part: number, key: string}[]}
 */
export function listPartRows(declaration, st, { lines = [], kept = [] } = {}) {
  return stepRowsOf({ declaration, st: st ?? {}, lines, kept }).rows.map((r) => ({ text: r.text, by: r.by, part: r.idx, key: r.key }));
}
