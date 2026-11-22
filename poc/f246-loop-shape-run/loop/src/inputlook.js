// borrowed-from: bareloop src/inputlook.js@v0.61.0 (fc56e1f3)
// THE LOOK (PART 1c, docs/product/ITEM33-BUILD.md "3. The look", PRD item 33 RF19/RF20): before the drafter writes a single check, the AI
// LOOKS at the person's input - read only, bounded, with tools that can do nothing but search and read the input's own text - and
// reports, per job line, the facts it can check (name, shape, a label PICKED from the code-made list, one example value it saw) and
// what it could not find. This module holds the pure parts: the two read-only tools, the strict answer form, the prompt, and the
// code that turns the AI's report into a verified one. The paid loop around them is `runInputLook` in src/authorscout.js.
//
// LABELS ARE PICKED, NEVER TYPED: the AI names a label by its id on the list (src/labelscan.js) or by its exact words; a label that is
// not on the list is NOT carried into the report - it is moved to "could not check", named. Code never decides two words mean the
// same: the AI proposes, the list and the source prove.

import { scanLabels, labelOnList, renderLabelList, normLabel, LABEL_SHAPES, TAG } from './labelscan.js';
import { FACT_SHAPES, FACT_OPS } from './facts.js';
import { dropRows, dropLine } from './pagedropwords.js';

/** the name of the answer tool - the one place the AI's report enters */
export const LOOK_REPORT_TOOL = 'report_look';
/** how many hits one search returns at most, and how long a snippet or a read line is */
export const LOOK_MAX_HITS = 40;
const SNIPPET = 220;
const READ_LINE = 320;
const READ_LINES = 40;
const WS = /[\s   ]+/g;

/**
 * The input as the AI sees it: lines with any run of white space (U+202F included) made one space and the page reader's bracketed tags
 * (`[ref=549]`) removed - an id that is only the page reader's, never part of a label.
 * @param {string} text @returns {string[]}
 */
export function lookLines(text) {
  return String(text ?? '').split('\n').map((l) => l.replace(TAG, ' ').replace(WS, ' ').trim());
}

/**
 * The two read-only tools: search the input text, read a slice around a hit. They are closures over in-memory text and touch nothing
 * else - read-only BY CONSTRUCTION, not by a fence. Several inputs: the `input` argument names which (its label).
 * @param {Record<string, string>} texts label -> frozen text
 * @returns {{name: string, description: string, parameters: any, execute: (a: any) => Promise<any>}[]}
 */
export function lookReadTools(texts) {
  const labels = Object.keys(texts);
  /** @type {Record<string, string[]>} */
  const lines = Object.fromEntries(labels.map((l) => [l, lookLines(texts[l])]));
  const which = (/** @type {any} */ a) => (typeof a?.input === 'string' && lines[a.input] ? a.input : (labels.length === 1 ? labels[0] : null));
  const inputProp = { type: 'string', description: `the input's label - one of: ${labels.join(', ')}` };
  return [
    {
      name: 'search_input',
      description: 'Case-insensitive search of one input for a word or phrase. Returns the line numbers and the start of each line that holds it. Search the person\'s own words AND other words that mean the same (nonstop / direct, San Francisco / SFO).',
      parameters: { type: 'object', properties: { input: inputProp, text: { type: 'string', minLength: 1 }, max: { type: 'integer', minimum: 1, maximum: LOOK_MAX_HITS } }, required: ['text'] },
      execute: async (a) => {
        const name = which(a);
        if (name === null) return { error: `name the input: ${labels.join(', ')}` };
        const q = String(a?.text ?? '').toLowerCase().replace(WS, ' ').trim();
        if (q === '') return { error: 'give the words to search for' };
        const max = Math.min(Number.isInteger(a?.max) ? a.max : 20, LOOK_MAX_HITS);
        /** @type {{line: number, text: string}[]} */
        const hits = [];
        let total = 0;
        lines[name].forEach((l, i) => { if (l.toLowerCase().includes(q)) { total += 1; if (hits.length < max) hits.push({ line: i + 1, text: l.slice(0, SNIPPET) }); } });
        return { input: name, total, hits };
      },
    },
    {
      name: 'read_input',
      description: 'Read some lines of one input, starting at a line number (from a search).',
      parameters: { type: 'object', properties: { input: inputProp, line: { type: 'integer', minimum: 1 }, count: { type: 'integer', minimum: 1, maximum: READ_LINES } }, required: ['line'] },
      execute: async (a) => {
        const name = which(a);
        if (name === null) return { error: `name the input: ${labels.join(', ')}` };
        const from = Math.max(1, Number.isInteger(a?.line) ? a.line : 1);
        const n = Math.min(Number.isInteger(a?.count) ? a.count : 12, READ_LINES);
        return { input: name, lines: lines[name].slice(from - 1, from - 1 + n).map((l, i) => ({ line: from + i, text: l.slice(0, READ_LINE) })) };
      },
    },
  ];
}

/** the strict answer form (a JSON schema - never free prose with JSON inside) */
export function lookReportSchema() {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['facts', 'prose', 'notFound'],
    properties: {
      facts: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['line', 'name', 'shape', 'source', 'example'],
          properties: {
            line: { type: 'integer', minimum: 1, description: 'the job line this fact belongs to' },
            name: { type: 'string', minLength: 1, description: 'a short name, letters only' },
            shape: { enum: [...FACT_SHAPES] },
            source: { type: 'string', minLength: 1, description: 'the label of the input it is read from' },
            label: { type: 'string', description: 'the words right before the value: the id (like t1) or the exact words of a label on the LIST for this input and shape - never a word you typed that is not on the list' },
            value: { type: 'string', description: 'a phrase fact only: the fixed words, copied from the input exactly as it writes them (a place, a name, a word)' },
            example: { type: 'string', description: 'ONE value you really saw in the input for this fact' },
            rule: {
              type: 'object',
              additionalProperties: false,
              required: ['op'],
              properties: { op: { enum: [...FACT_OPS] }, value: {}, lo: {}, hi: {} },
              description: 'only where the person asked for a limit (or you made one out of their words and set aiProposal)',
            },
            aiProposal: { type: 'boolean', description: 'true when YOU made this number out of the person\'s words (for example a night window for "not a red-eye")' },
            forRule: { type: 'integer', minimum: 1, description: 'the number of the ~ rule under that line this fact carries out (1 = the first), when it carries one - a rule you turned into a number or range yourself ("not a red-eye") is carried by a fact with aiProposal, never reported as not found' },
          },
        },
      },
      prose: {
        type: 'array',
        description: 'job lines (and their ~ limits) that ask for written text - a summary, a report. They are not looked up.',
        items: { type: 'object', additionalProperties: false, required: ['line'], properties: { line: { type: 'integer', minimum: 1 }, text: { type: 'string' } } },
      },
      notFound: {
        type: 'array',
        description: 'what you could not find in the input, and, when it is one ~ rule, which one',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['line', 'why'],
          properties: { line: { type: 'integer', minimum: 1 }, rule: { type: 'integer', minimum: 1, description: 'the number of the ~ rule under that line (1 = the first), when the thing not found is one rule' }, words: { type: 'string', description: 'the person\'s own words that you could not find' }, why: { type: 'string', minLength: 1 } },
        },
      },
    },
  };
}

/**
 * What the AI is told: the numbered job, the inputs and their label lists, and what to do.
 * @param {{jobLines: {n: number, text: string, rule?: string, rules?: string[]}[], labels: string[], lists: Record<string, string>}} o
 * @returns {string}
 */
export function lookPrompt({ jobLines, labels, lists }) {
  const job = jobLines.map((l) => `${l.n}. ${l.text}${(l.rules ?? (l.rule ? l.rule.split('; ') : [])).map((r, i) => `\n   ~ ${i + 1}. ${r}`).join('')}`).join('\n');
  return `The person's job (line numbers start at 1; "~" lines are the person's rules for the line above, numbered under it):\n${job}\n\n`
    + `The inputs you can look at: ${labels.map((l) => JSON.stringify(l)).join(', ')}. You can only use search_input and read_input, then you MUST finish by calling ${LOOK_REPORT_TOOL} once.\n\n`
    + `${labels.map((l) => lists[l]).join('\n\n')}\n\n`
    + `Shapes a value can have: ${FACT_SHAPES.join(', ')} (phrase = fixed words the quote must contain; text = the words after a label).\n`
    + 'For each job line, find the facts the person asked for and report ONLY what you can check in the input:\n'
    + ' - Search the input with the person\'s words AND other words that mean the same, read the spots you find, and use what you know (for example what a red-eye is: propose a night time window and set aiProposal true).\n'
    + ' - A ~ rule whose meaning you can turn into a number or a range from what you know (a red-eye is a night departure; a weekend; business hours) is NOT something to ask the person about and NOT "notFound": report it as a fact on the time, date or amount the input does hold, with a between (or other) rule, aiProposal true and forRule set to that rule\'s number. Use notFound with a rule number only for intent you cannot know (for example "one per week" when the input has no weekly grouping).\n'
    + ' - Every place, date or name written in the job line itself is a fact too. Bind it to the label that sits right before it in the input - a direction like "from X to Y" is the label before the origin (for example Leaves) and the label before the destination (for example arrives at): report each as a phrase fact whose label is that label and whose value is the place EXACTLY as the input writes it.\n'
    + ' - A label is PICKED from the LIST above (its id or its exact words) - never typed. A label that is not on the list is refused. Never use the person\'s own words as a label unless the list holds them, never a one-time id like [ref=...], and never one result\'s own value.\n'
    + ' - Lines that ask for written prose (a summary, a short text) and the ~ limits on them (word count, paragraphs) are NOT looked up: put them in "prose" with their line number.\n'
    + ' - Whatever you cannot find in the input goes to "notFound" with the person\'s own words; when it is one ~ rule, give that rule\'s number.\n'
    + `Report only through ${LOOK_REPORT_TOOL}.`;
}

/** @typedef {{line: number, name: string, shape: string, source: string, label?: string, labelId?: string, value?: string, phrase?: string, example: string, rule?: any, aiProposal?: boolean, forRule?: number, reading?: import('./pagerules.js').Reading,
 *   words?: string[], labels?: string[], unit?: string[], currency?: string[], lang?: string, decimal?: string}} LookFact  `words` / `labels` / `unit` / `currency`: what the page-word map kept (idea A core) */
/** @typedef {{line: number, rule?: number, words?: string, why: string}} LookNotFound */
/** @typedef {{facts: LookFact[], prose: {line: number, text?: string}[], notFound: LookNotFound[], dropped?: import('./pagerules.js').Dropped[]}} LookReport */

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Is this input a spreadsheet the sheet look reads (src/sheetlook.js)? A value (a file path or a URL) that ends `.csv`, any case. The one decider; the look door tells the look which inputs are sheets by it.
 * @param {{value?: unknown}} input @returns {boolean}
 */
export const isSheetInput = (input) => typeof input?.value === 'string' && input.value.toLowerCase().endsWith('.csv');

/**
 * A fact the page-word map kept (src/pagerules.js `KeptFact`), as the look report carries it: a phrase fact holds its alternative
 * phrases; any other holds its labels (the first is the primary), and a money fact its units and currencies.
 * @param {import('./pagerules.js').KeptFact} k @param {string} source @returns {LookFact}
 */
export function lookFactOf(k, source) {
  /** @type {LookFact} */
  const out = { line: k.line, name: k.name, shape: k.shape, source, example: '', words: [...k.words] };
  if (k.shape === 'phrase') out.phrase = k.words[0];
  else { out.labels = [...k.words]; if (k.words.length) out.label = k.words[0]; }
  if (k.unit) out.unit = [...k.unit];
  if (k.currency) out.currency = [...k.currency];
  if (k.lang !== undefined) out.lang = k.lang;
  if (k.decimal !== undefined) out.decimal = k.decimal;
  if (k.forRule !== undefined) out.forRule = k.forRule;
  if (k.reading) out.reading = { ...k.reading };
  return out;
}

/**
 * Turn the AI's raw report into a VERIFIED one, by code, at $0. A fact is carried only when: its shape is a real shape, its source is
 * a real input, and its label is ON THE LIST for that input and shape (an id is resolved to its exact words). Anything else is moved
 * to `notFound` with a plain reason naming the word - never dropped silently. `prove` is the "found in the source" test of the
 * phrase a phrase fact builds (label + value), supplied by the caller.
 * @param {unknown} raw
 * @param {{scans: Record<string, import('./labelscan.js').LabelScan>, jobLines: {n: number}[], prove?: (source: string, phrase: string) => number}} o
 * @returns {LookReport}
 */
export function verifyLookReport(raw, { scans, jobLines, prove }) {
  const rep = isRec(raw) ? raw : {};
  const lineNos = new Set(jobLines.map((l) => l.n));
  /** @type {LookFact[]} */
  const facts = [];
  /** @type {LookNotFound[]} */
  const notFound = [];
  const dropped = (/** @type {any} */ f, /** @type {string} */ why) => notFound.push({
    line: Number.isInteger(f?.line) && lineNos.has(f.line) ? f.line : (jobLines[0]?.n ?? 1),
    words: typeof f?.name === 'string' ? f.name : undefined,
    why,
  });
  for (const f of Array.isArray(rep.facts) ? rep.facts : []) {
    if (!isRec(f) || !Number.isInteger(f.line) || !lineNos.has(f.line)) { dropped(f, 'the look named a job line that does not exist'); continue; }
    const name = typeof f.name === 'string' ? f.name.replace(/[^A-Za-z _-]/g, '').trim() : '';
    if (name === '') { dropped(f, 'the look gave a fact no usable name'); continue; }
    if (!FACT_SHAPES.includes(f.shape)) { dropped({ ...f, name }, `the look gave "${name}" a shape (${String(f.shape)}) that does not exist`); continue; }
    const scan = typeof f.source === 'string' ? scans[f.source] : undefined;
    if (!scan) { dropped({ ...f, name }, `the look read "${name}" from an input (${String(f.source)}) that is not one of yours`); continue; }
    /** @type {LookFact} */
    const out = { line: f.line, name, shape: f.shape, source: f.source, example: typeof f.example === 'string' ? f.example : '' };
    if (typeof f.label === 'string' && f.label.trim() !== '') {
      const row = labelOnList(scan, f.shape === 'phrase' ? 'text' : f.shape, f.label);
      if (!row) { dropped({ ...f, name }, `the label "${normLabel(f.label)}" for "${name}" is not one of the labels found in "${f.source}", so it was not used`); continue; }
      out.label = row.label;
      out.labelId = row.id;
    }
    if (f.shape === 'phrase') {
      const value = typeof f.value === 'string' ? normLabel(f.value) : '';
      if (value === '') { dropped({ ...f, name }, `the look gave the phrase fact "${name}" no words`); continue; }
      out.value = value;
      out.phrase = out.label ? `${out.label} ${value}` : value;
      if (prove && prove(f.source, out.phrase) < 1) { dropped({ ...f, name }, `"${out.phrase}" is not in the input "${f.source}"`); continue; }
    }
    if (isRec(f.rule)) out.rule = f.rule;
    if (f.aiProposal === true) out.aiProposal = true;
    if (Number.isInteger(f.forRule) && f.forRule >= 1) out.forRule = f.forRule;
    facts.push(out);
  }
  for (const n of Array.isArray(rep.notFound) ? rep.notFound : []) {
    if (!isRec(n) || !Number.isInteger(n.line) || !lineNos.has(n.line) || typeof n.why !== 'string') continue;
    // a rule that a verified fact carries is checked, so it is not also "not found" (L3: a ~ rule is one or the other)
    if (Number.isInteger(n.rule) && facts.some((x) => x.line === n.line && x.forRule === n.rule)) continue;
    notFound.push({ line: n.line, ...(Number.isInteger(n.rule) ? { rule: n.rule } : {}), ...(typeof n.words === 'string' && n.words ? { words: n.words } : {}), why: n.why });
  }
  const prose = (Array.isArray(rep.prose) ? rep.prose : []).filter((p) => isRec(p) && Number.isInteger(p.line) && lineNos.has(p.line))
    .map((p) => ({ line: p.line, ...(typeof p.text === 'string' ? { text: p.text.slice(0, 400) } : {}) }));
  return { facts, prose, notFound };
}

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

/**
 * The label scans and the rendered lists for the inputs the look will read.
 * @param {Record<string, string>} texts
 * @returns {{scans: Record<string, import('./labelscan.js').LabelScan>, lists: Record<string, string>}}
 */
export function labelListsOf(texts) {
  /** @type {Record<string, import('./labelscan.js').LabelScan>} */
  const scans = {};
  /** @type {Record<string, string>} */
  const lists = {};
  for (const [label, text] of Object.entries(texts)) { scans[label] = scanLabels(text); lists[label] = renderLabelList(label, scans[label]); }
  return { scans, lists };
}

export { LABEL_SHAPES };
