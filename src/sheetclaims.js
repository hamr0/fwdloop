// M10b piece 2 (docs/wiki/the-module-ladder.md "M10b scope" item 5): what a step that reads a sheet is told and what box it answers in.
// A step answers each `cells` check's CLAIM in bareguard's typed box ({value}, {rows}, {days}, {bands}, ...), never a cite or a formula. The shape of every box is
// generated from bareguard's own worked example for the op (`rubricVocabulary.rules.cells.ops.<op>.example`), never hand-copied here. The step is told the box, not the
// check: no op, no condition, no bound, no column ever reaches it (the construction test in test/m10b-sheet-run.test.js proves the request carries none).
// Throws away: a check with no claim (a `table` check judges the sheet itself) adds no box; two checks with the same claim name share one box.
import { rubricVocabulary } from 'bareguard';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** whole-number boxes: a row number list, and a days map (bareguard compares these as integers) */
const INTEGER_KEYS = Object.freeze(['rows', 'days']);

/**
 * The JSON schema of one value in a worked example. Typed from the example's own value; `intKey` = the box key it sits under.
 * @param {any} v @param {string} [intKey] @returns {Record<string, any>}
 */
function schemaOf(v, intKey = '') {
  if (typeof v === 'boolean') return { type: 'boolean' };
  if (typeof v === 'number') return { type: INTEGER_KEYS.includes(intKey) ? 'integer' : 'number' };
  if (typeof v === 'string') return { type: 'string' };
  if (Array.isArray(v)) return v.length > 0 ? { type: 'array', items: schemaOf(v[0], intKey) } : { type: 'array' };
  if (isRec(v)) {
    const keys = Object.keys(v);
    // a map keyed by row number (days, bands): every value has the first one's type
    if (keys.length > 0 && keys.every((k) => /^\d+$/.test(k))) return { type: 'object', additionalProperties: schemaOf(v[keys[0]], intKey) };
    return { type: 'object', properties: Object.fromEntries(keys.map((k) => [k, schemaOf(v[k], k)])), required: keys };
  }
  return {};
}

/**
 * The claim box of every `cells` check in the list: `[{claim, example}]`, one per claim name, in order. `example` is the op's worked-example answer (the box's shape
 * with example values). A check bareguard has no example for, and a `table` check, add nothing.
 * @param {any[]} checks a step's `close.sheet` @returns {Array<{claim: string, example: Record<string, any>, ops: string[]}>}
 */
export function sheetClaims(checks) {
  /** @type {Map<string, {claim: string, example: Record<string, any>, ops: string[]}>} */
  const out = new Map();
  const ops = /** @type {any} */ (rubricVocabulary).rules?.cells?.ops ?? {};
  for (const c of Array.isArray(checks) ? checks : []) {
    if (!isRec(c) || c.rule !== 'cells' || typeof c.claim !== 'string' || typeof c.op !== 'string') continue;
    const ex = ops[c.op]?.example;
    const shape = isRec(ex) && isRec(ex.output) && isRec(ex.check) ? ex.output[ex.check.claim] : undefined;
    if (!isRec(shape)) continue;
    const have = out.get(c.claim);
    if (have) { Object.assign(have.example, shape); have.ops.push(c.op); } else out.set(c.claim, { claim: c.claim, example: { ...shape }, ops: [c.op] });
  }
  return [...out.values()];
}

/**
 * The `emit_artifact` tool's properties for a step that reads a sheet: one typed box per claim, each required. (`done` is added by the caller, as for every step.)
 * @param {any[]} checks @returns {{properties: Record<string, any>, required: string[]}}
 */
export function sheetAnswerProps(checks) {
  /** @type {Record<string, any>} */
  const properties = {};
  for (const { claim, example, ops } of sheetClaims(checks)) {
    const keys = Object.keys(example);
    properties[claim] = {
      type: 'object',
      properties: Object.fromEntries(keys.map((k) => [k, ops.includes('lookup') && k === 'value' ? { type: ['string', 'number'] } : schemaOf(example[k], k)])),
      required: keys,
    };
  }
  return { properties, required: Object.keys(properties) };
}

/**
 * What the step is told about its answer (one key of its request): the name and the shape of each box, with the worked example's values. Never the check.
 * @param {any[]} checks @returns {{answer: string, fields: Record<string, Record<string, any>>}}
 */
export function sheetBrief(checks) {
  return {
    answer: 'Answer with one field for each name in "fields", in the shape shown for it. Give the values themselves, worked out from the input - never a cell reference and never a formula. The values shown only illustrate the shape; use the real ones from the input and the job line.',
    fields: Object.fromEntries(sheetClaims(checks).map(({ claim, example }) => [claim, example])),
  };
}
