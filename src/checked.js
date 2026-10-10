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

const list = (xs) => xs.join(', ');

/**
 * One entry per step, in plan order: the plain sentences for what its typed close checks.
 * @param {{ steps?: any[] }} declaration @param {{ hasAsk?: boolean, askLines?: number[] }} [opts] hasAsk = the job has a signed ask line (so "you check it at the ask" is true);
 *   askLines = the job lines of the signed asks, which also lets a step after the LAST ask read "you check it after you accept" (am41 item 2, am42: the ONE place for these words)
 * @returns {{ step: number, line: number|null, goal: string, class: string, sentences: string[] }[]}
 */
export function checkedLines(declaration, { hasAsk = true, askLines } = {}) {
  const steps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  if (Array.isArray(askLines)) hasAsk = askLines.length > 0;
  const lastAsk = Array.isArray(askLines) ? steps.reduce((m, st, i) => (askLines.includes(st?.fromLine) ? i : m), -1) : -1;
  return steps.map((st, i) => {
    const cls = st?.close?.class;
    const shape = st?.close?.shape && typeof st.close.shape === 'object' ? st.close.shape : {};
    /** @type {string[]} */
    const out = [];
    if (cls === 'green') {
      out.push('Every figure must cite its source cell, or a formula over cells, and the machine recomputes it and compares it with its source.');
    } else if (cls === 'softgreen') {
      out.push('The reply is checked as plain text only.');
      if (Number.isInteger(shape.maxWords)) out.push(`The whole output is under ${shape.maxWords} words.`);
      if (Array.isArray(shape.sections) && shape.sections.length > 0) out.push(`These section headings are there, in this order: ${list(shape.sections)}.`);
      if (Number.isInteger(shape.wordsPerSection) && Array.isArray(shape.sections) && shape.sections.length > 0) out.push(`Each of those sections is about ${shape.wordsPerSection} words.`);
      if (Number.isInteger(shape.linesPerInvoice)) out.push(`The output comes in blocks of ${shape.linesPerInvoice} lines.`);
      if (Array.isArray(shape.mustCarry) && shape.mustCarry.length > 0) out.push(`Every block carries: ${list(shape.mustCarry)}.`);
    } else {
      if (lastAsk !== -1 && i > lastAsk) out.push('No machine check of the content; you check it after you accept.');
      else out.push(hasAsk ? 'No machine check of the content: you check it at the ask.' : 'No machine check of the content; the machine checks only that the step happened.');
    }
    return {
      step: i + 1, line: Number.isInteger(st?.fromLine) ? st.fromLine : null, goal: typeof st?.goal === 'string' ? st.goal : '', class: String(cls), sentences: out,
    };
  });
}

/** The "Not checked" block the page shows: always the label, then the drafter's items (an empty list says the drafter listed nothing). @param {unknown} items */
export function notCheckedBlock(items) {
  const clean = Array.isArray(items) ? items.filter((x) => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()) : [];
  return { label: NOT_CHECKED_LABEL, items: clean };
}
