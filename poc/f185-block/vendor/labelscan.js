// borrowed-from: bareloop src/labelscan.js@v0.56.0 (3383cce)
// THE LABEL LIST (PART 1c, docs/product/ITEM33-BUILD.md "3. The look", "LABELS ARE PICKED, NEVER TYPED"): before the look, code scans a
// source at $0 and lists, per shape (money, number, date, time, text), the words that sit right before a value of that shape,
// with how often each occurs. The look and the drafter pick a label ONLY from this list (by id or exact text); a label that is not on
// it is a $0 red naming it. ONE generic scan for every page or file - there is no per-site table here and never will be.
//
// How a label is found (all of it plain string work, no model):
//   - each line is cleaned (any run of white space, U+202F / U+00A0 included, becomes one space; bracketed tags like `[ref=549]` that a
//     page reader adds are dropped);
//   - values are found in a fixed order of shapes: date, time, money, number, and last `text` = any other token that holds a digit
//     (a version like 0.41.0, an id). A value is only a place to look BEFORE: bareguard reads the real value at run time;
//   - the words before a value are the text between the previous value on the line and this one, cut to its last one or two
//     tokens (and the whole gap when it is short); a label holds no digit;
//   - text facts also get the words before each REPEATED capitalised phrase (an airport, a city, a name): `Leaves` before one phrase,
//     `arrives at` before another.
// A label is listed when it occurs at least MIN_COUNT times. Nothing here decides what a label MEANS.

/** the shapes a list is made for */
export const LABEL_SHAPES = Object.freeze(['money', 'number', 'date', 'time', 'text']);
/** a label must occur at least this often to be listed (1: a one-page document with one total still has its label; the list is cut to the highest counts) */
export const MIN_COUNT = 1;
/** how many labels one shape's list holds at most (the highest counts first) */
export const MAX_PER_SHAPE = 40;
/** the longest label, in characters */
const MAX_LABEL = 40;
/** the longest whole gap taken as a label when it is short */
const MAX_GAP_LABEL = 24;
/** a phrase must repeat this often to be a repeated phrase */
const MIN_PHRASE = 3;
/** how many repeated phrases are looked behind */
const MAX_PHRASES = 20;
/** a line is scanned up to this many characters, and for this many values (a minified page is one huge line; the bound caps the work per line, each finder's own regex is kept linear below) */
const MAX_LINE = 20000;
const MAX_VALUES_PER_LINE = 400;
/** only this much of a source is scanned (a source over it is scanned up to a line end) */
export const SCAN_MAX_CHARS = 2_000_000;

const WS = /[\s   ]+/g;
/**
 * The page reader's bracketed tag (`[ref=549]`), shared by the three places that strip it. The lookahead and lookbehind add no match and drop no
 * match: a `[` that sits inside the run of an earlier `[letters=` (no `]` or white space between) is skipped, because that earlier start reads the same
 * run to the same end - it matches (and consumes this one) or fails (and so does this one). Without them "[a=[a=[a=..." with no `]` is quadratic.
 */
export const TAG = /\[(?=[A-Za-z]+=)(?<!\[[A-Za-z]+=[^\]\s]*?)[A-Za-z]+=[^\]\s]*\]/g;
const MONTH = '(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)';
/** value finders in priority order: an earlier shape owns a span a later one would also match */
const FINDERS = /** @type {[string, RegExp][]} */ ([
  ['date', new RegExp(`\\b\\d{4}-\\d{2}-\\d{2}\\b|\\b\\d{1,2}/\\d{1,2}/\\d{2,4}\\b|\\b${MONTH}\\.? \\d{1,2}(?:, \\d{4})?\\b|\\b\\d{1,2} ${MONTH}\\.? \\d{4}\\b`, 'g')],
  ['time', /\b\d{1,2}:\d{2}(?: ?[AaPp]\.?[Mm]\.?)?(?![\w:])/g],
  // the 2nd shape's leading lookbehind skips a start inside a digit/comma run that an earlier start of the run already covers (that start reads the same
  // run to the same end, so it matches first or fails like this one); without it "1,1,1,...x" is quadratic. The covering start is never one right after
  // a "." - the digits of a decimal can already belong to an earlier match ("$1.5,2 dollars" reads "2 dollars" as its own)
  ['money', /[$€£] ?\d[\d,]*(?:\.\d+)?|(?<!(?<!\.)\b\d[\d,]*?)\b\d[\d,]*(?:\.\d+)? ?(?:US dollars?|dollars?|USD|euros?|EUR|pounds?|GBP)\b/g],
  ['number', /(?<![\w.,])\d[\d,]*(?:\.\d+)?(?![\w]|\.\d)/g],
  // (?<![A-Za-z]): a start inside a run of letters is covered by the run's first letter (same match, earlier), so a long run of letters with no digit is linear
  ['text', /(?<![A-Za-z])[A-Za-z]*\d[\w.\-]*/g],
]);
const PHRASE = /\b[A-Z][a-z]+(?: [A-Z][a-z]+)+\b/g;

/** @typedef {{id: string, label: string, count: number, example: string}} LabelEntry */
/** @typedef {Record<'money'|'number'|'date'|'time'|'text', LabelEntry[]>} LabelScan */

/** @param {string} t @returns {string} white space made one space, quote marks at the edges dropped, trimmed - how a label is compared */
export function normLabel(t) {
  return String(t ?? '').replace(WS, ' ').trim().replace(/^["'“”]+|["'“”]+$/g, '').trim();
}

/** @param {string} gap @returns {string[]} the labels a gap of text before a value offers */
function candidates(gap) {
  const g = normLabel(gap);
  if (g === '') return [];
  const tokens = g.split(' ');
  /** @type {Set<string>} */
  const out = new Set();
  out.add(normLabel(tokens.at(-1) ?? ''));
  if (tokens.length >= 2) out.add(normLabel(tokens.slice(-2).join(' ')));
  if (g.length <= MAX_GAP_LABEL) out.add(g);
  return [...out].filter((c) => c !== '' && c.length <= MAX_LABEL && !/\d/.test(c) && !/ref=/.test(c));
}

/**
 * Scan one source text for the labels that sit before values, per shape.
 * @param {string} text
 * @returns {LabelScan}
 */
export function scanLabels(text) {
  let src = String(text ?? '');
  if (src.length > SCAN_MAX_CHARS) { const nl = src.lastIndexOf('\n', SCAN_MAX_CHARS); src = src.slice(0, nl > 0 ? nl : SCAN_MAX_CHARS); }
  /** @type {Record<string, Map<string, {count: number, example: string}>>} */
  const seen = Object.fromEntries(LABEL_SHAPES.map((s) => [s, new Map()]));
  const bump = (/** @type {string} */ shape, /** @type {string} */ label, /** @type {string} */ example) => {
    const m = seen[shape];
    const cur = m.get(label);
    if (cur) cur.count += 1; else m.set(label, { count: 1, example });
  };
  /** @type {Map<string, number>} */
  const phraseCount = new Map();
  /** @type {string[]} */
  const lines = [];
  /** @type {{line: string, at: number, phrase: string}[]} */
  const variants = [];
  for (const raw of src.split('\n')) {
    const line = raw.slice(0, MAX_LINE).replace(TAG, ' ').replace(WS, ' ').trim();
    if (line === '') continue;
    lines.push(line);
    for (const m of line.matchAll(PHRASE)) {
      // a capitalised run may start with a sentence-initial word ("Leaves San Francisco ..."): the run is also read without its first word
      const words = m[0].split(' ');
      let off = m.index ?? 0;
      for (let j = 0; j <= 1 && words.length - j >= 2; j += 1) {
        const phrase = words.slice(j).join(' ');
        phraseCount.set(phrase, (phraseCount.get(phrase) ?? 0) + 1);
        variants.push({ line, at: off, phrase });
        off += words[j].length + 1;
      }
    }
  }
  for (const line of lines) {
    /** @type {{shape: string, s: number, e: number, v: string}[]} */
    const found = [];
    for (const [shape, re] of FINDERS) {
      for (const m of line.matchAll(re)) {
        const s = m.index ?? 0;
        const e = s + m[0].length;
        if (found.length >= MAX_VALUES_PER_LINE) break;
        if (found.some((f) => s < f.e && e > f.s)) continue;
        found.push({ shape, s, e, v: m[0] });
      }
    }
    found.sort((a, b) => a.s - b.s);
    let prevEnd = 0;
    for (const f of found) {
      for (const c of candidates(line.slice(prevEnd, f.s))) bump(f.shape, c, f.v);
      prevEnd = f.e;
    }
  }
  // the words before each REPEATED capitalised phrase (a place, a name): text facts
  const phrases = new Set([...phraseCount].filter(([, n]) => n >= MIN_PHRASE).sort((a, b) => b[1] - a[1]).slice(0, MAX_PHRASES).map(([p]) => p));
  for (const v of variants) {
    if (!phrases.has(v.phrase)) continue;
    for (const c of candidates(v.line.slice(0, v.at))) bump('text', c, v.phrase);
  }
  /** @type {Record<string, string>} */
  const prefix = { money: 'm', number: 'n', date: 'd', time: 't', text: 'x' };
  return /** @type {LabelScan} */ (Object.fromEntries(LABEL_SHAPES.map((shape) => {
    const rows = [...seen[shape]].filter(([, v]) => v.count >= MIN_COUNT)
      .sort((a, b) => b[1].count - a[1].count || a[0].length - b[0].length || (a[0] < b[0] ? -1 : 1))
      .slice(0, MAX_PER_SHAPE)
      .map(([label, v], i) => ({ id: `${prefix[shape]}${i + 1}`, label, count: v.count, example: v.example }));
    return [shape, rows];
  })));
}

/**
 * Is this label on the list for this shape? Compared the way a label is read: white space of any kind is one space, quote marks at the
 * edges are dropped. `idOrText` may be a list id (`t1`) or the exact words.
 * @param {LabelScan} scan @param {string} shape @param {unknown} idOrText
 * @returns {LabelEntry|null}
 */
export function labelOnList(scan, shape, idOrText) {
  const rows = scan[/** @type {'money'} */ (shape)];
  if (!rows || typeof idOrText !== 'string') return null;
  const asId = rows.find((r) => r.id === idOrText.trim());
  if (asId) return asId;
  const want = normLabel(idOrText);
  return rows.find((r) => r.label === want) ?? null;
}

/**
 * The list as the look and the drafter are shown it, one block per shape that has any label.
 * @param {string} inputLabel the input the list belongs to @param {LabelScan} scan
 * @returns {string}
 */
export function renderLabelList(inputLabel, scan) {
  const blocks = LABEL_SHAPES.filter((s) => scan[/** @type {'money'} */ (s)].length > 0).map((s) => {
    const rows = scan[/** @type {'money'} */ (s)].map((r) => `  ${r.id}  ${JSON.stringify(r.label)}  x${r.count}  e.g. ${JSON.stringify(r.example)}`);
    return `${s} (the words right before a ${s === 'text' ? 'repeated phrase or an id/version' : s}):\n${rows.join('\n')}`;
  });
  return `LABELS IN THE INPUT "${inputLabel}" - pick a label ONLY from this list (by its id or its exact words); a label that is not here is refused:\n\n${blocks.length ? blocks.join('\n\n') : '(no repeated label was found before a value)'}`;
}

/**
 * The list a page-word map input is shown: ONLY the labels the map kept (what the draft gate's `keptSetOf` accepts), so the prompt and the
 * proof read the same words. Empty = no label was kept, so the drafter leaves the label out.
 * @param {string} inputLabel @param {string[]} labels
 * @returns {string}
 */
export function renderKeptLabelList(inputLabel, labels) {
  return `LABELS IN THE INPUT "${inputLabel}" - pick a label ONLY from this list (its exact words); a label that is not here is refused:\n\n`
    + (labels.length ? labels.map((l) => `  ${JSON.stringify(l)}`).join('\n') : '(the page words kept no label for this input - leave the label out of every fact)');
}
