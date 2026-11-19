// borrowed-from: bareloop src/shapelook.js@v0.61.0 (fc56e1f3) -- P1 EXTRACT ONLY: lines 17-30 (SHAPE_SYSTEM, shapeMenuLines and the constants above them); the rest is S2 and was not copied
import { SHAPE_KINDS, SHAPE_OPTION_VALUES } from '../../src/shapemenu.js';

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
