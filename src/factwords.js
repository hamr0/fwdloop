// borrowed-from: bareloop src/factwords.js@v0.56.0 (3383cce) (checkFactWords, keptSetOf and what they call; squash, countExact and countPhrase are fwd's, src/pagebits.js, the same counts with no built pattern; fwd's own keptSetOf, src/citedwords.js, is a different older copy and stays for the page-word path)
// THE FOUND-ONCE CHECK: code proves, at $0, that every word a fact check depends on is really in the person's source, and that every label (anchor) is one PICKED
// from the list code made from that source (src/labelscan.js), never typed. Nothing is graded here and no model is involved.
import { labelOnList, scanLabels } from './labelscan.js';
import { asList, normLabel, countExact, countPhrase } from './pagebits.js';
import { dropSentence } from './pagedropwords.js';

/** @param {string} shape @returns {'money'|'number'|'date'|'time'|'text'} the label list a fact's anchor is picked from */
const listOf = (shape) => /** @type {any} */ (['money', 'number', 'date', 'time'].includes(shape) ? shape : 'text');

/**
 * What the page-word map (src/pagemap.js) KEPT and DROPPED for one input: the sets the second proof reads. A look from the old search-and-read
 * path has no `dropped` list, so it gives null and the label is proved against the code-made list as before.
 * @param {{facts?: any[], dropped?: (import('./pagerules.js').Dropped & {source?: string})[]}|null|undefined} look @param {string} source
 * @returns {{labels: Set<string>, units: Set<string>, currencies: Set<string>, words: Set<string>, dropped: Map<string, import('./pagerules.js').Dropped>, forms: {labels: Set<string>, lang?: string, decimal?: string}[]}|null}
 */
export function keptSetOf(look, source) {
  if (!look || !Array.isArray(look.dropped)) return null;
  const facts = (Array.isArray(look.facts) ? look.facts : []).filter((f) => f && f.source === source && Array.isArray(f.words));
  const set = (/** @type {string[]} */ a) => new Set(a.map((w) => normLabel(String(w))));
  /** @type {Map<string, import('./pagerules.js').Dropped>} */
  const dropped = new Map();
  for (const d of look.dropped) if (d.source === source && typeof d.word === 'string' && !dropped.has(normLabel(d.word))) dropped.set(normLabel(d.word), d);
  return {
    labels: set(facts.filter((f) => f.shape !== 'phrase').flatMap((f) => f.words)),
    units: set(facts.flatMap((f) => f.unit ?? [])),
    currencies: set(facts.flatMap((f) => f.currency ?? [])),
    words: set(facts.flatMap((f) => [...f.words, ...(f.unit ?? []), ...(f.currency ?? [])])),
    dropped,
    forms: facts.filter((f) => f.shape !== 'phrase' && (f.lang !== undefined || f.decimal !== undefined))
      .map((f) => ({ labels: new Set(f.words.map((w) => normLabel(String(w)))), lang: f.lang, decimal: f.decimal })),
  };
}

/**
 * The reds for ONE fact part against its frozen source text.
 * @param {{part: any, text: string, line: number|string, scan?: import('./labelscan.js').LabelScan, kept?: ReturnType<typeof keptSetOf>}} o
 * @returns {{code: string, detail: string}[]}
 */
export function checkFactWords({ part, text, line, scan = scanLabels(text), kept = null }) {
  /** @type {{code: string, detail: string}[]} */
  const reds = [];
  const src = part.source;
  const red = (/** @type {string} */ code, /** @type {string} */ msg) => reds.push({ code, detail: `line ${line}: ${msg} Nothing was signed.` });
  for (const f of Array.isArray(part.facts) ? part.facts : []) {
    const who = `fact "${f.name}"`;
    // a word the page rules DROPPED (and no other fact kept) can never come back through the drafter (idea A core, spec 4.3)
    const dropRed = (/** @type {string} */ what, /** @type {unknown} */ w) => {
      const n = normLabel(String(w));
      const d = kept?.dropped.get(n);
      if (!kept || !d || kept.words.has(n)) return false;
      red('rubric-fact-word-dropped', `${who}: the ${what} ${JSON.stringify(n)} cannot be used. ${dropSentence(d)}`);
      return true;
    };
    if (f.anchor !== undefined && f.shape !== 'phrase' && kept) {
      // a page input read by the page-word map: the label must be one the map KEPT (the code-made list cannot hold a marker after a number)
      const label = normLabel(String(f.anchor));
      if (dropRed('label', f.anchor)) { /* said above */ } else if (!kept.labels.has(label)) {
        const some = [...kept.labels].slice(0, 12).map((l) => JSON.stringify(l)).join(', ');
        red('rubric-fact-label-off-list', `${who}: the label ${JSON.stringify(label)} is not one of the labels the page words for "${src}" kept. A label is picked from those, never typed${some ? `: ${some}` : ' (there are none - leave the label out)'}.`);
      } else if (countExact(text, label) < 1) {
        red('rubric-fact-word-missing', `${who}: the label ${JSON.stringify(label)} is not in the input "${src}".`);
      } else if (Number.isInteger(part.count?.min) && countExact(text, label) < part.count.min) {
        const n = part.count.min;
        const seen = countExact(text, label);
        red('rubric-fact-label-rare', `${who}: the label ${JSON.stringify(label)} is in the input "${src}" only ${seen} time${seen === 1 ? '' : 's'}, but this line asks for ${n} results, so a label that sits in each result must be there at least ${n} times. Pick a label that is counted ${n} or more times.`);
      }
    } else if (f.anchor !== undefined && f.shape !== 'phrase') {
      const list = listOf(f.shape);
      const row = labelOnList(scan, list, f.anchor);
      if (!row) {
        const some = scan[list].slice(0, 12).map((r) => JSON.stringify(r.label)).join(', ');
        red('rubric-fact-label-off-list', `${who}: the label ${JSON.stringify(normLabel(String(f.anchor)))} is not one of the labels the input "${src}" holds before a ${f.shape === 'text' ? 'text value' : f.shape}. A label is picked from that list, never typed${some ? `: ${some}` : ' (the list is empty - leave the label out)'}.`);
      } else if (countExact(text, row.label) < 1) {
        red('rubric-fact-word-missing', `${who}: the label ${JSON.stringify(row.label)} is not in the input "${src}".`);
      } else if (Number.isInteger(part.count?.min) && row.count < part.count.min) {
        // M1: a label that starts each result must repeat as often as results were asked for; one that sits once on the page
        // (a sort tab, a switch) is in no result, so no one-result quote can hold it
        const n = part.count.min;
        red('rubric-fact-label-rare', `${who}: the label ${JSON.stringify(row.label)} is in the input "${src}" only ${row.count} time${row.count === 1 ? '' : 's'}, but this line asks for ${n} results, so a label that sits in each result must be there at least ${n} times. Pick a label from the list that is counted ${n} or more times.`);
      }
    }
    // a look fact that carries lang / decimal: the signed fact must sign the same, or a drafter that drops it signs a fact that reds at run time
    if (kept && f.anchor !== undefined && f.shape !== 'phrase') {
      const mine = kept.forms.filter((k) => k.labels.has(normLabel(String(f.anchor))));
      if (mine.length && !mine.some((k) => (k.lang === undefined || k.lang === f.lang) && (k.decimal === undefined || k.decimal === (f.decimal ?? '.')))) {
        const k = mine[0];
        const [field, value] = k.lang !== undefined && k.lang !== f.lang ? ['lang', k.lang] : ['decimal', k.decimal];
        reds.push({ code: 'rubric-fact-form-unsigned', detail: `line ${line}: the fact ${JSON.stringify(f.name)} must sign ${field} ${JSON.stringify(value)}, as the page look found. Nothing spent.` });
      }
    }
    if (f.until !== undefined) dropRed('closing label', f.until);
    if (f.until !== undefined && countExact(text, f.until) < 1) red('rubric-fact-word-missing', `${who}: ${JSON.stringify(f.until)} is not in the input "${src}". Copy the closing words from the input, or leave them out.`);
    // M19 am5: a several-word phrase fact (anyOf) holds when the page says ANY of its words; the count of results is the words' counts together
    const phraseOf = f.shape === 'phrase' ? (Array.isArray(f.anyOf) ? f.anyOf : typeof f.phrase === 'string' ? [f.phrase] : null) : null;
    if (phraseOf) {
      const shown = Array.isArray(f.anyOf) ? phraseOf.map((/** @type {string} */ x) => JSON.stringify(x)).join(', ') : JSON.stringify(f.phrase);
      const seen = phraseOf.reduce((/** @type {number} */ n, /** @type {string} */ x) => n + countPhrase(text, x), 0);
      if (seen < 1) red('rubric-fact-word-missing', `${who}: ${shown} is not in the input "${src}". Copy the words the input really uses, or remove the check.`);
      else if (Number.isInteger(part.count?.min) && seen < part.count.min) {
        // M4: the words each result's quote must say must repeat as often as results were asked for; page-header words (counted
        // once or twice) are in no result, so no one-result quote can say them
        const n = part.count.min;
        red('rubric-fact-phrase-rare', `${who}: the words ${shown} are in the input "${src}" only ${seen} time${seen === 1 ? '' : 's'}, but this line asks for ${n} results - each result's own quote must say them. Pick words every result says, or drop this check.`);
      }
    }
    // a unit (one string, or every one of a list) must be found as whole words; a currency sign (each of a list) must be found as written
    for (const u of asList(f.unit)) dropRed('unit', u);
    for (const c of asList(f.currency)) dropRed('currency', c);
    for (const u of asList(f.unit)) if (countPhrase(text, u) < 1) red('rubric-fact-word-missing', `${who}: the unit ${JSON.stringify(u)} is not in the input "${src}". Copy the words the input really uses.`);
    for (const c of asList(f.currency)) if (countExact(text, c) < 1) red('rubric-fact-word-missing', `${who}: the currency ${JSON.stringify(c)} is not in the input "${src}". Copy the sign the input really uses.`);
  }
  return reds;
}

