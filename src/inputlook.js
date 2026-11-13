// borrowed-from: bareloop src/inputlook.js@v0.56.0 (3383cce) (renderLookReport only: the look itself is fwd's, src/pagelook.js and src/sheetlook.js)
import { dropRows } from './pagedropwords.js';

/** @typedef {{line: number, name: string, shape: string, source: string, label?: string, labelId?: string, value?: string, phrase?: string, example: string, rule?: any, aiProposal?: boolean, forRule?: number, reading?: import('./pagerules.js').Reading,
 *   words?: string[], labels?: string[], unit?: string[], currency?: string[], lang?: string, decimal?: string}} LookFact  `words` / `labels` / `unit` / `currency`: what the page-word map kept (idea A core) */
/** @typedef {{line: number, rule?: number, words?: string, why: string}} LookNotFound */

/** @typedef {{facts: LookFact[], prose: {line: number, text?: string}[], notFound: LookNotFound[], dropped?: import('./pagerules.js').Dropped[]}} LookReport */

/**
 * The look's report as the DRAFTER reads it: one block, per job line, of what can be checked (with the exact words to copy) and what
 * could not be found. Written by code from the verified report.
 * @param {LookReport} report @returns {string}
 */
export function renderLookReport(report) {
  const byLine = new Map();
  const add = (/** @type {number} */ n, /** @type {string} */ s) => byLine.set(n, [...(byLine.get(n) ?? []), s]);
  for (const f of report.facts) {
    const bits = [`${f.name} - ${f.shape}`, `from "${f.source}"`];
    if (Array.isArray(f.words)) {
      // a fact the page-word map kept (idea A core): the words the page holds, each one proven by code; the first is the main one
      const quote = (/** @type {string[]|undefined} */ a) => (a ?? []).map((w) => JSON.stringify(w)).join(' or ');
      if (f.shape === 'phrase') bits.push(`the quote must say ${f.words.length > 1 ? 'ONE of these page words, copied exactly' : 'this page word'}: ${quote(f.words)}`);
      else {
        if (f.words.length) bits.push(`label ${quote(f.words)}${f.words.length > 1 ? ' (the first is the main one)' : ''}`);
        else bits.push('no label (read by its unit or sign alone)');
        if (f.unit?.length) bits.push(`unit ${quote(f.unit)}`);
        if (f.currency?.length) bits.push(`currency ${quote(f.currency)}`);
        // a page form the page rules proved is on the page: the drafter signs it as given, never a guess (the run reads that form and no other)
        if (f.lang !== undefined) bits.push(`lang ${JSON.stringify(f.lang)} (the page writes the month name in this language: sign it as the fact's lang)`);
        if (f.decimal !== undefined) bits.push(`decimal ${JSON.stringify(f.decimal)} (the page writes this mark before the decimals: sign it as the fact's decimal)`);
      }
    } else if (f.phrase !== undefined) bits.push(`the quote must say ${JSON.stringify(f.phrase)}`);
    else if (f.label !== undefined) bits.push(`label ${JSON.stringify(f.label)} (id ${f.labelId})`);
    else bits.push('no label (the value as the quote writes it)');
    if (f.example) bits.push(`seen: ${JSON.stringify(f.example)}`);
    if (f.rule) bits.push(`rule ${JSON.stringify(f.rule)}`);
    if (f.aiProposal) bits.push("AI's proposal");
    if (f.forRule !== undefined) bits.push(`carries ~ rule ${f.forRule}`);
    add(f.line, `CAN CHECK: ${bits.join(', ')}`);
  }
  // NO SILENT DROP: a word, fact or rule the page rules removed is said to the drafter too, so it is never written back as a check
  for (const row of dropRows(report.dropped)) {
    add(row.line, row.full
      ? `NOT CHECKED${row.rule !== undefined ? ` (rule ${row.rule})` : ''}: "${row.fact}" - ${row.sentences.join(' ')}`
      : `LEFT OUT of "${row.fact}" (the rest is still checked): ${row.sentences.join(' ')}`);
  }
  for (const p of report.prose) add(p.line, 'WRITTEN TEXT (not looked up; keep its word/section counts)');
  for (const n of report.notFound) add(n.line, `NOT FOUND${n.rule ? ` (rule ${n.rule})` : ''}: ${n.words ? `${JSON.stringify(n.words)} - ` : ''}${n.why}`);
  const lines = [...byLine.keys()].sort((a, b) => a - b).map((n) => `line ${n}:\n${byLine.get(n).map((/** @type {string} */ s) => `  ${s}`).join('\n')}`);
  return `WHAT THE LOOK AT THE INPUTS FOUND - write the facts from this; copy the label and phrase words exactly\n\n${lines.join('\n') || '(the look reported nothing)'}`;
}

