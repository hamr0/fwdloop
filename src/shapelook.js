// borrowed-from: bareloop src/shapelook.js@v0.61.0 (fc56e1f3) -- the prompt, the menu lines and the strict parse are copied unchanged (test/m19-shapelook-strings.test.js holds the tag's text); `runShapeLook` is not copied: fwd's drafter owns the call, the metering and the book (its `makeCallModel`), so `lookAtShape` below takes the same `callModel` seam as `lookAtSheet` and keeps the tag's plumbing (a 429 waited once, a transport failure retried once, an unreadable answer twice is no shape)
// The shape look (M19 S2): ONE AI call for the whole job that proposes, for the `~` rules still left Not checked, the fields of a list of items. The AI only SUGGESTS; code builds or refuses every field (src/shapebuild.js).
// Third outcomes: a call that failed, a cut-off answer (unreadable), an unreadable answer twice, the cap reached before the call: each is `{ok: false, reason}` and the caller goes on without a shape (the spend stays booked).
import { redactSecrets } from './redact.js';
import { isTransportFailure } from './model-step.js';
import { isRateLimited, rateLimitWaitMs } from './ratelimit.js';
import { MAP_UNREADABLE } from './pagemap.js';
import { lineRules } from './pagebits.js';
import { SHAPE_KINDS, SHAPE_OPTION_VALUES, NAME_MAX_CHARS } from './shapemenu.js';

/** the label of the one paid call about a shape, as the drafting book and the progress line see it (the sibling of `SHEET_CALL_LABEL`) */
export const SHAPE_CALL_LABEL = 'shape-map';
/** how much of each input the call is shown (the POC's bound, declared in its preregistration) */
export const SHAPE_SHOWN_CHARS = 8000;
/** at most this many fields in one suggestion (bareguard allows 50 per `fields` object; a person's rule list is far shorter) */
export const MAX_SHAPE_FIELDS = 20;

export const SHAPE_SYSTEM = 'You map a person\'s job to the SHAPE of an answer: a list of items, each item with named fields. You never grade and never invent bounds: a bound is only what the person wrote. Reply with JSON only.';

/** the menu as the drafter reads it, one line per kind of src/shapemenu.js (the one place it is named): `  boolean: bounds equals` @returns {string[]} */
export function shapeMenuLines() {
  return Object.entries(SHAPE_KINDS).map(([k, b]) => `  ${k}: bounds ${b.length ? b.map((o) => (SHAPE_OPTION_VALUES[k]?.[o] ? `${o} (one of ${SHAPE_OPTION_VALUES[k][o].map((v) => `"${v}"`).join(', ')})` : o)).join(', ') : '(none)'}`);
}

/**
 * What the AI is told: the job (its `~` rules numbered per line), the inputs (bounded), the kind menu and the answer form.
 * @param {{jobLines: {n: number, text: string, rule?: string, rules?: string[]}[], lineNums: number[], texts: Record<string, string>, left?: {line: number, rules: number[]}[]}} o `lineNums` the lines a shape can be offered for, `left` the rules still without a check
 * @returns {string}
 */
export function shapeLookPrompt({ jobLines, lineNums, texts, left = [] }) {
  const job = jobLines.map((l) => `LINE ${l.n}: ${l.text}${lineRules(l).map((r, i) => `\n~ rule ${i + 1}: ${r}`).join('')}`).join('\n');
  const inputs = Object.entries(texts).map(([label, t]) => `Input "${label}"${t.length > SHAPE_SHOWN_CHARS ? ` (first ${SHAPE_SHOWN_CHARS} of ${t.length} characters)` : ''}:\n<<<\n${t.slice(0, SHAPE_SHOWN_CHARS)}\n>>>`).join('\n\n');
  // only when code left some `~` rules without a check: say which, so the AI gives a field for those and no other (injected only IF the case happens)
  const needs = left.length ? `Only these ~ rules have no check yet: ${left.map((x) => `line ${x.line} rule${x.rules.length === 1 ? '' : 's'} ${x.rules.join(', ')}`).join('; ')}. Give a field for no other rule. For each of these, give a field ONLY if that rule's own words give it a limit code can check: a number, a count of characters, words or entries, a list of allowed values, or yes/no. "Each item has a title" counts: required, with minChars 1. A rule whose words give no limit gets no field; it stays with the person. "fromRule" is the rule's number on the line (1 is its first rule). Extra fields are fine.\n` : '';
  return `THE JOB (each ~ rule applies to the line above it):\n${job}\n\nTHE INPUTS:\n${inputs}\n\n`
    + `A job line whose answer is a LIST OF ITEMS with named fields (for example one item per flight, per resume or per research topic) gets a shape. The lines a shape can be offered for: ${lineNums.join(', ')}. A line whose answer is not such a list gets none.\n`
    + needs
    + '- "extraFields": any other field you think would help (none is fine); its "fromRule" is null and code shows it to the person as a suggestion.\n'
    + '- "kind" is one of the kinds below; "bounds" holds only the bounds that kind accepts, taken from that field\'s own rule. A yes/no rule ("the flight is nonstop") is kind boolean with "equals": true.\n'
    + '- "itemCountFrom": the labels of the inputs that give exactly one item each, only when the person wrote it ("one blurb per resume"); otherwise [].\n'
    + `- A field name is at most ${NAME_MAX_CHARS} characters and holds none of . : [ ] ; a list field writes its entries as "of": {"kind": "text", ...bounds}.\n\n`
    + `The field kinds (and the bounds each kind accepts):\n${shapeMenuLines().join('\n')}\n\n`
    + 'Return ONLY a JSON object, no prose, no code fence, with "shapes" empty when no line is a list of items:\n'
    + '{"shapes":[{"line":1,"fields":[{"name":"...","kind":"...","required":true,"bounds":{},"fromRule":1}],"extraFields":[{"name":"...","kind":"...","required":false,"bounds":{},"fromRule":null}],"itemCountFrom":[]}]}';
}

/**
 * Read the AI's answer: ONE JSON object `{"shapes":[...]}`, each shape an object with a whole `line`, its `fields` and `extraFields` lists (an absent list is none). No repair: anything else is a malformed answer. What a field MEANS is judged by code (src/shapebuild.js).
 * @param {unknown} text @returns {{ok: true, shapes: Record<string, any>[]}|{ok: false}}
 */
export function parseShapeAnswer(text) {
  /** @type {any} */
  let m;
  try { m = JSON.parse(String(text ?? '').trim()); } catch { return { ok: false }; }
  if (m === null || typeof m !== 'object' || Array.isArray(m) || !Array.isArray(m.shapes)) return { ok: false };
  for (const s of m.shapes) {
    if (s === null || typeof s !== 'object' || Array.isArray(s) || !Number.isInteger(s.line)) return { ok: false };
    for (const k of ['fields', 'extraFields', 'itemCountFrom']) if (s[k] !== undefined && s[k] !== null && !Array.isArray(s[k])) return { ok: false };
  }
  return { ok: true, shapes: m.shapes };
}

/**
 * Look at the shape of the answer: the call (once; once more after an unreadable answer or one transport failure; a 429 waits the vendor's stated time once and is not an attempt).
 * `callModel(content, attempt)` makes and meters ONE model round (the drafter's `makeCallModel('shape-map', SHAPE_SYSTEM)`) and returns `{text}`, `{text, cutOff: true}` or `{error}` (with `budget: true` when the cap stopped the call, `threw` when the provider threw).
 * @param {{texts: Record<string, string>, jobLines: {n: number, text: string, rule?: string, rules?: string[]}[], lineNums: number[], left?: {line: number, rules: number[]}[], ceilingUsd?: number|null,
 *   callModel: (content: string, attempt: number) => Promise<{text?: string, cutOff?: boolean, error?: string, budget?: boolean, threw?: any}>, sleep?: (ms: number) => Promise<void>}} o
 * @returns {Promise<{ok: true, shapes: Record<string, any>[], attempts: number}|{ok: false, reason: string, attempts: number}>}
 */
export async function lookAtShape({ texts, jobLines, lineNums, left = [], ceilingUsd = null, callModel, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const content = shapeLookPrompt({ jobLines, lineNums, texts, left });
  let transportRetried = false;
  let rateRetried = false;
  let attempts = 0;
  for (;;) {
    attempts += 1;
    const r = await callModel(content, attempts);
    if (r.budget === true) return { ok: false, reason: `the AI's look at the shape of the answer was not made: the $${ceilingUsd} ceiling was already spent`, attempts };
    if (r.threw !== undefined) {
      if (isRateLimited(r.threw) && !rateRetried) {
        const wait = rateLimitWaitMs(r.threw);
        if (wait !== null) { rateRetried = true; attempts -= 1; await sleep(wait); continue; }
      }
      if (isTransportFailure(r.threw) && !transportRetried) { transportRetried = true; continue; }
    }
    if (r.error !== undefined && r.cutOff !== true) return { ok: false, reason: `the call about the shape of the answer failed: ${redactSecrets(String(r.error))}`, attempts };
    const parsed = r.cutOff === true ? { ok: false } : parseShapeAnswer(r.text);
    if (parsed.ok) return { ok: true, shapes: /** @type {any} */ (parsed).shapes, attempts };
    if (attempts >= 2) return { ok: false, reason: MAP_UNREADABLE.replace('about the page', 'about the shape of the answer'), attempts };
  }
}
