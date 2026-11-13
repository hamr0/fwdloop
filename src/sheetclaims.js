// M10b piece 2 (docs/wiki/the-module-ladder.md "M10b scope" item 5): what a step that reads a sheet is told and what box it answers in.
// A step answers each `cells` check's CLAIM in bareguard's typed box ({value}, {rows}, {days}, {bands}, ...), never a cite or a formula. The schema of every box is
// bareguard's `claimSchema` of the check; the box the step is TOLD is bareguard's own worked example for the op (`rubricVocabulary.rules.cells.ops.<op>.example`). Never hand-copied here. The step is told the box, not the
// check: no op, no condition, no bound, no column ever reaches it (the construction test in test/m10b-sheet-run.test.js proves the request carries none).
// Throws away: a check with no claim (a `table` check judges the sheet itself) adds no box; two checks with the same claim name share one box.
import { rubricVocabulary, claimSchema } from 'bareguard';
import { bareguardChecks } from './sheetchecks.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

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
 * The `emit_artifact` tool's properties for a step that reads a sheet: one typed box per claim, each required, the box's schema bareguard's `claimSchema` of the check
 * (two checks that share a claim name share one box: their keys merge). `covers` is fwdloop's own and is stripped before bareguard reads the check. (`done` is added by the caller.)
 * @param {any[]} checks @returns {{properties: Record<string, any>, required: string[]}}
 */
export function sheetAnswerProps(checks) {
  /** @type {Record<string, any>} */
  const properties = {};
  for (const c of Array.isArray(checks) ? checks : []) {
    if (!isRec(c) || c.rule !== 'cells' || typeof c.claim !== 'string') continue;
    const box = /** @type {any} */ (claimSchema(bareguardChecks([c])[0]));
    if (box === null) continue;
    const have = properties[c.claim];
    properties[c.claim] = have === undefined ? box : { ...have, ...box, properties: { ...have.properties, ...box.properties }, required: [...new Set([...(have.required ?? []), ...(box.required ?? [])])] };
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
