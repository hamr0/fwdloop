// borrowed-from: bareloop src/shapebuild.js@v0.61.0 (fc56e1f3)
// SHAPE JOBS (itemShape), docs/product/ITEM33-BUILD.md "Addendum 2026-11-18: shape jobs (itemShape)", clause 2 "Build or refuse" and the code rules R1-R5 of "POC results and code rules": the ONE builder of the shape
// of a job line. The AI never writes the signed shape: what it sends in the row-edit reply's `itemShape` is read here only as a typed SUGGESTION, and code builds or refuses every field.
//   menu check      the kind is on the menu (src/shapemenu.js), the bound is one the kind lists, a bound has the right type, the name is legal (no `. : [ ]`, <= 128 characters, not one of bareguard's own reason
//                   words when this bareguard lists them: src/shapemenu.js `nameWhy`).
//   R1              a bound is grounded ONLY in that field's own `~` rule (a field with no rule has no grounded bound; the one exception: `minChars: 1` on a required field, the spec's "each item has a title").
//   R2              an AI-added field (no `~` rule of its own) whose name has no word in the job line or its rules is SUGGESTED: held out of the signed shape, off until the person's Add, no bounds.
//                   One with a word in them is job-derived (on, droppable), still with no grounded bound.
//   R3              `oneOf` keeps each grounded value and drops only the ungrounded ones.
//   R4              an item count is signed only when every label the AI picked is a REAL input label and the person's words say "per <label stem>" or "each <label stem>" (stem: the label without a trailing `-N`).
//   R5              `equals` is allowed only on a field with its own `~` rule, and only as the JSON true or false.
// One writer per field: a field's `rule` (the `~` rule it comes from) is the AI's `fromRule`, proved here to be a rule of THIS line; `by`, `held` and every bound that stands are assigned here.
// What this throws away: a refused field or bound (only its plain reason is kept, in `refused`, and on the rule that named it); the AI's `required` on an AI-added field's bounds; a second field for one rule.
// Not built (named): the `object` kind (src/shapemenu.js); an item count read from the person's words alone (a number, not a label): the spec says "else the count comes only from the person's words" and gives no
// mechanism, so none is invented here. The part code signs from this (`buildShapePartOf`) and the run's brief are clauses 5 and 6, waiting for the bareguard release that carries `itemShape`.
import { createRubric } from 'bareguard';
import { lineRules, wordsSaidOn } from './pagebits.js';
import { underNumbers, atMostNumbers } from './blockpick.js';
import { SHAPE_KINDS, ENTRY_KINDS, GROUNDED_BOUNDS, UPPER_BOUNDS, COUNT_BOUNDS, nameWhy, shapeNameRules } from './shapemenu.js';

/** @param {unknown} v @returns {v is Record<string, any>} */
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** why a `~` rule no field holds is Not checked, when no field named it (judged at Accept, not at an Ask) */
export const NO_FIELD_WHY = 'No field was picked for it, so you judge it at Accept.';

/** why a rule whose field carries no limit from its own words stays Not checked: a field with no bound checks nothing the person asked for (hamr 2026-11-19) */
export const NO_BOUND_WHY = 'The field picked for it has no limit from your words, so it checks nothing; you judge it at Accept.';

/**
 * Does a field carry at least ONE real bound the person's rule grounds (a number, a count of characters, words or entries, the one-of values, a yes/no value; `required` + `minChars: 1` is "each item has a title")?
 * A modifier alone (a currency, a unit, how a number is read) is no bound. A list counts when its entries do.
 * @param {Record<string, any>} bounds @returns {boolean}
 */
export function hasRealBound(bounds) {
  if (!isRec(bounds)) return false;
  if (Object.keys(bounds).some((k) => GROUNDED_BOUNDS.includes(k) || k === 'equals')) return true;
  return isRec(bounds.of) && hasRealBound(bounds.of);
}

/** bareguard's refusal of one field spec, in plain words: `price: currency must be one of "$", "€", "£"` @param {string} name @param {unknown} message @returns {string} */
function plainRefusal(name, message) {
  const m = /fields\.[^.\s]+\.(\S+) (.*)$/s.exec(String(message));
  return m ? `${name}: ${m[1]} ${m[2]}` : `${name}: ${String(message).replace(/^invalid rubric: /, '')}`;
}

const norm = (/** @type {unknown} */ s) => String(s).toLowerCase().replace(/\b0(\d:)/g, '$1');
const words = (/** @type {unknown} */ s) => String(s).replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().match(/[a-z0-9]+/g) ?? [];

/**
 * @typedef {{name: string, kind: string, required: boolean, bounds: Record<string, any>, rule: number|null, by: 'you'|'agent', held: boolean, why?: string}} ShapeField
 * @typedef {{rule: number, text: string, state: 'built'|'not-checked', reason: string|null, name: string|null}} ShapeRule
 * @typedef {{line: number, ok: boolean, fields: ShapeField[], itemCount: {labels: string[], n: number}|null, rows: ShapeRule[], refused: {helper: string, why: string}[], reservedChecked: boolean}} LineShape
 */

/**
 * Is ONE bound value in the person's words? A number counts when it is written as a number there (an upper bound also when it is the written number minus one: "under 60" signs 59); a string value when it is
 * written there, case and spacing aside.
 * @param {string} key @param {unknown} v @param {string} text the person's words (the field's own rule) @param {boolean} required
 * @returns {boolean}
 */
export function boundGrounded(key, v, text, required = false) {
  const t = norm(text);
  if (key === 'minChars' && v === 1 && required) return true;
  const numeric = typeof v === 'number' || (key !== 'values' && typeof v === 'string' && /^\s*[$€£]?\s*-?\d+([.,]\d+)?\s*[$€£]?\s*$/.test(v));
  if (numeric) {
    const n = typeof v === 'number' ? v : Number(String(v).replace(',', '.').match(/-?\d+(?:\.\d+)?/)?.[0]);
    if (!Number.isFinite(n)) return false;
    const cands = UPPER_BOUNDS.includes(key) ? [n, n + 1, Math.ceil(n)] : [n];
    const said = new Set((t.match(/\d+(?:[.,]\d+)?/g) ?? []).map((x) => Number(x.replace(',', '.'))));
    return cands.some((c) => said.has(c));
  }
  return typeof v === 'string' && v.trim() !== '' && t.includes(norm(v));
}

/** the type of a bound: null when legal, else the plain reason @param {string} kind @param {string} key @param {unknown} v @returns {string|null} */
function boundTypeWhy(kind, key, v) {
  if (COUNT_BOUNDS.includes(key)) return Number.isInteger(v) && /** @type {number} */ (v) >= 0 ? null : `${key} must be a whole number, 0 or more`;
  if (['min', 'max', 'gt', 'lt'].includes(key)) {
    if (kind === 'number' || kind === 'money') return typeof v === 'number' && Number.isFinite(v) ? null : `${key} must be a number`;
    return typeof v === 'string' && v.trim() !== '' ? null : `${key} must be written as text for a ${kind}`;
  }
  if (key === 'values') return Array.isArray(v) && v.length >= 1 && v.length <= 50 && v.every((x) => typeof x === 'string' && x.trim() !== '') && new Set(v).size === v.length ? null : 'values must be 1 to 50 different words';
  if (['ignoreCase', 'fromText', 'unique'].includes(key)) return typeof v === 'boolean' ? null : `${key} must be true or false`;
  if (key === 'equals') return typeof v === 'boolean' ? null : 'equals must be true or false';
  return null;
}

/**
 * The person's own form of an upper bound, signed by CODE whatever the AI sent (the same law as "under N bullets = N-1", src/checkpick.js): a field's own rule that says "under / fewer than / less than / below N" signs the EXCLUSIVE
 * form (a count: N-1, `maxChars` / `maxWords` / `maxEntries`; a number or money: `lt: N`), and one that says "at most / up to / no more than N" signs N (`max`, inclusive), whether the AI sent N or N-1. Mutates `out`.
 * @param {string} kind @param {Record<string, any>} out the grounded bounds @param {string} text the field's own rule
 */
function lawOfWords(kind, out, text) {
  const unders = underNumbers(text);
  const atMost = atMostNumbers(text);
  for (const key of ['maxChars', 'maxWords', 'maxEntries']) {
    const v = out[key];
    if (!Number.isInteger(v)) continue;
    const u = unders.find((n) => n === v || n === v + 1);
    const a = atMost.find((n) => n === v || n === v + 1);
    if (u !== undefined) out[key] = u - 1;
    else if (a !== undefined) out[key] = a;
  }
  if (kind !== 'number' && kind !== 'money') return;
  const v = out.lt !== undefined ? out.lt : out.max;
  if (typeof v !== 'number') return;
  const near = (/** @type {number} */ n) => n === v || Math.ceil(v) === n || (out.max !== undefined && n === v + 1);
  const u = unders.find(near);
  const a = atMost.find((n) => near(n) || n === v + 1);
  if (u !== undefined) { delete out.max; out.lt = u; } else if (a !== undefined) { delete out.lt; out.max = a; }
}

/**
 * One field's bounds, built or refused: the menu check, then grounding. Pure.
 * @param {{kind: string, bounds: unknown, required: boolean, ruleText: string|null, refuse: (what: string, why: string) => void, top?: boolean}} o `ruleText` null = the field has no `~` rule of its own
 * @returns {Record<string, any>}
 */
function buildBounds({ kind, bounds, required, ruleText, refuse, top = true }) {
  /** @type {Record<string, any>} */
  const out = {};
  const given = isRec(bounds) ? bounds : {};
  for (const [k, v] of Object.entries(given)) {
    if (!/** @type {readonly string[]} */ (SHAPE_KINDS[/** @type {keyof typeof SHAPE_KINDS} */ (kind)]).includes(k)) { refuse(k, `${k} is not a bound of a ${kind} field`); continue; }
    if (k === 'of') {
      if (!top) { refuse(k, 'a list entry cannot be a list'); continue; }
      const entry = typeof v === 'string' ? { kind: v } : isRec(v) ? v : null;
      if (entry === null || !ENTRY_KINDS.includes(String(entry.kind))) { refuse(k, `a list holds ${ENTRY_KINDS.join(', ')} entries`); continue; }
      const { kind: ek, ...rest } = entry;
      out.of = { kind: ek, ...buildBounds({ kind: String(ek), bounds: rest, required: false, ruleText, refuse, top: false }) };
      continue;
    }
    const typed = boundTypeWhy(kind, k, v);
    if (typed !== null) { refuse(k, typed); continue; }
    if (k === 'equals') { // R5
      if (ruleText === null || typeof v !== 'boolean') refuse(k, ruleText === null ? 'equals needs a rule of your own on this field' : 'equals must be true or false');
      else out[k] = v;
      continue;
    }
    if (!GROUNDED_BOUNDS.includes(k)) { out[k] = v; continue; } // a modifier (currency, unit, fromText ...): how the value is read, not a bound
    // R1: only the field's own rule grounds a bound
    if (ruleText === null && !(k === 'minChars' && v === 1 && required)) { refuse(k, `${k} ${JSON.stringify(v)} is not in a rule of yours for this field`); continue; }
    const text = ruleText ?? '';
    if (k === 'values') { // R3: each value on its own
      const good = /** @type {string[]} */ (v).filter((x) => boundGrounded(k, x, text));
      for (const x of /** @type {string[]} */ (v)) if (!good.includes(x)) refuse(`values:${x}`, `"${x}" is not in your rule for this field`);
      if (good.length > 0) out.values = good;
      continue;
    }
    if (!boundGrounded(k, v, text, required)) { refuse(k, `${k} ${JSON.stringify(v)} is not in your rule for this field`); continue; }
    out[k] = v;
  }
  if (ruleText !== null) lawOfWords(kind, out, ruleText);
  // an empty range is bareguard's refusal at sign time; say it here, at $0, in the same direction
  for (const [lo, hi] of [['minChars', 'maxChars'], ['minWords', 'maxWords'], ['minEntries', 'maxEntries']]) {
    if (Number.isInteger(out[lo]) && Number.isInteger(out[hi]) && out[lo] > out[hi]) { refuse(hi, `${hi} is below ${lo}`); delete out[hi]; }
  }
  return out;
}

/**
 * Build the shape of ONE job line from the AI's suggestion, or refuse each part with its plain reason.
 * @param {{line: {n: number, text?: string, rules?: string[], rule?: string}, labels: string[], suggestion: unknown, nameRules?: ReturnType<typeof shapeNameRules>}} o
 * @returns {LineShape}
 */
export function buildShapeLine({ line, labels, suggestion, nameRules = shapeNameRules() }) {
  const rules = lineRules(line);
  const said = wordsSaidOn({ text: line.text, rules });
  const jobWords = new Set(words(said));
  const s = isRec(suggestion) ? suggestion : {};
  /** @type {{helper: string, why: string}[]} */
  const refused = [];
  /** @type {Map<number, string>} the plain reason a refusal gives the rule that named it */
  const refusedFor = new Map();
  /** @type {ShapeField[]} */
  const fields = [];
  const seen = new Set();
  const lists = /** @type {[string, unknown][]} */ ([['fields', s.fields], ['extraFields', s.extraFields]]);
  for (const [listName, arr] of lists) {
    for (const f of Array.isArray(arr) ? arr : []) {
      const nm = isRec(f) ? f.name : undefined;
      const rule = isRec(f) && Number.isInteger(f.fromRule) && f.fromRule >= 1 && f.fromRule <= rules.length ? /** @type {number} */ (f.fromRule) : null;
      const refuse = (/** @type {string} */ helper, /** @type {string} */ why) => { refused.push({ helper, why }); if (rule !== null && !refusedFor.has(rule)) refusedFor.set(rule, `field refused: ${why}`); };
      if (!isRec(f)) { refuse('schema', `an entry of ${listName} is not an object`); continue; }
      const nameBad = nameWhy(nm, nameRules);
      if (nameBad !== null) { refuse('name', nameBad); continue; }
      if (seen.has(nm)) { refuse('name', `the name "${nm}" is used twice`); continue; }
      if (f.kind === 'object') { refuse('menu', 'a nested object field is not offered yet'); continue; }
      if (typeof f.kind !== 'string' || !Object.hasOwn(SHAPE_KINDS, f.kind)) { refuse('menu', `${String(f.kind)} is not a field kind on the menu`); continue; }
      if (rule !== null && fields.some((x) => x.rule === rule)) { refuse('rule', `rule ${rule} already has a field`); continue; }
      const required = f.required === true;
      const ruleText = rule === null ? null : rules[rule - 1];
      const own = rule !== null;
      // R2: an AI-added field with none of its words in the job is Suggested (held out, off until Add); one with a word in the job is job-derived
      const derived = own || words(nm).some((w) => jobWords.has(w));
      const bounds = buildBounds({ kind: f.kind, bounds: f.bounds, required, ruleText, refuse: (what, why) => refuse(`${nm}.${what}`, why) });
      // a field picked for the person's own rule must carry a real bound from that rule, else it checks nothing and the rule stays Not checked
      if (own && !hasRealBound(bounds)) { refused.push({ helper: 'bound', why: `${nm}: no limit from your rule` }); refusedFor.set(/** @type {number} */ (rule), NO_BOUND_WHY); continue; }
      // bareguard is the judge of the field: a combination it refuses (a currency word it has no sign for) is this field's refusal, told in plain words, and never the whole shape's
      try { createRubric({ schema: 1, goal: 'field', inputs: [], checkpoints: { field: { gating: false, checks: [{ id: 'f', rule: 'itemShape', field: 'results', fields: { [nm]: { kind: f.kind, ...(required ? { required: true } : {}), ...bounds } } }] } } }); } catch (e) { refuse('bareguard', plainRefusal(nm, /** @type {any} */ (e)?.message ?? e)); continue; }
      seen.add(nm);
      fields.push({ name: nm, kind: f.kind, required, bounds, rule, by: own ? 'you' : 'agent', held: !derived, ...(own ? {} : { why: derived ? 'job-derived' : 'suggested' }) });
    }
  }
  // the rule fields in rule order first, then the agent's, in the order sent
  const ordered = [...fields.filter((x) => x.by === 'you').sort((a, b) => /** @type {number} */ (a.rule) - /** @type {number} */ (b.rule)), ...fields.filter((x) => x.by === 'agent')];
  // R4: the item count
  /** @type {{labels: string[], n: number}|null} */
  let itemCount = null;
  const pick = s.itemCountFrom;
  if (Array.isArray(pick) && pick.length > 0) {
    const set = [...new Set(pick.map(String))];
    if (!set.every((x) => labels.includes(x))) refused.push({ helper: 'itemCount', why: `${set.filter((x) => !labels.includes(x)).map((x) => `"${x}"`).join(', ')} is not an input of this job` });
    else {
      const says = (/** @type {string} */ label) => {
        const stem = label.replace(/-\d+$/, '').toLowerCase();
        const t = said.toLowerCase();
        // `s?\b` after the stem, read at its place in the whole text (sticky), so \b sees the stem's last character as the tag's regex does
        const end = /s?\b/y;
        return [...t.matchAll(/\b(?:per|each)\s+/g)].some((m) => {
          const at = m.index + m[0].length;
          if (!t.startsWith(stem, at)) return false;
          end.lastIndex = at + stem.length;
          return end.test(t);
        });
      };
      if (set.every(says)) itemCount = { labels: set, n: set.length };
      else refused.push({ helper: 'itemCount', why: 'the count is not in your words (say "per" or "each" and the input, e.g. "one summary per resume")' });
    }
  }
  /** @type {ShapeRule[]} */
  const rows = rules.map((text, i) => {
    const n = i + 1;
    const f = ordered.find((x) => x.rule === n);
    return f ? { rule: n, text, state: /** @type {const} */ ('built'), reason: null, name: f.name } : { rule: n, text, state: /** @type {const} */ ('not-checked'), reason: refusedFor.get(n) ?? NO_FIELD_WHY, name: null };
  });
  const ok = ordered.some((x) => x.by === 'you');
  if (!ok && fields.length === 0 && refused.length === 0 && !isRec(suggestion)) refused.push({ helper: 'schema', why: 'no shape was suggested for the line' });
  return { line: line.n, ok, fields: ordered, itemCount, rows, refused, reservedChecked: nameRules.reserved !== null };
}

/**
 * Build the shape of every candidate line from the reply's suggestions, each routed to its job line by its own `line`. A suggestion naming no candidate line, or not an object, is refused and listed.
 * @param {{lines: {n: number, text?: string, rules?: string[], rule?: string}[], labels: string[], suggestions: unknown[], nameRules?: ReturnType<typeof shapeNameRules>}} o
 * @returns {{built: Record<number, LineShape>, notChecked: Record<string, string>, refused: {line: number|null, helper: string, why: string}[]}}
 * `built` holds only the lines whose shape stands (at least one field from a `~` rule); `notChecked`: `line N: "rule"` -> why, for each rule of a built line no field holds
 */
export function buildShapes({ lines, labels, suggestions, nameRules = shapeNameRules() }) {
  /** @type {Record<number, LineShape>} */
  const built = {};
  /** @type {Record<string, string>} */
  const notChecked = {};
  /** @type {{line: number|null, helper: string, why: string}[]} */
  const refused = [];
  /** @type {Map<number, unknown[]>} */
  const byLine = new Map(lines.map((l) => [l.n, []]));
  for (const s of suggestions) {
    if (!isRec(s)) { refused.push({ line: null, helper: 'schema', why: 'a suggestion is not an object' }); continue; }
    const mine = byLine.get(/** @type {number} */ (s.line));
    if (mine === undefined) { refused.push({ line: Number.isInteger(s.line) ? /** @type {number} */ (s.line) : null, helper: 'line', why: `line ${String(s.line)} is not a line a shape can be offered for` }); continue; }
    mine.push(s);
  }
  for (const line of lines) {
    const mine = byLine.get(line.n) ?? [];
    if (mine.length === 0) continue;
    // one shape per line: the first suggestion stands, a second is refused
    if (mine.length > 1) refused.push({ line: line.n, helper: 'line', why: 'more than one shape was suggested for the line; the first is used' });
    const r = buildShapeLine({ line, labels, suggestion: mine[0], nameRules });
    for (const x of r.refused) refused.push({ line: line.n, ...x });
    if (!r.ok) continue;
    built[line.n] = r;
    for (const row of r.rows) if (row.state === 'not-checked') notChecked[`line ${line.n}: "${row.text}"`] = /** @type {string} */ (row.reason);
  }
  return { built, notChecked, refused };
}

/**
 * The signed spec of one field, as bareguard's `itemShape` reads it: `{kind, required, ...bounds}` (`required` written only when true).
 * @param {ShapeField} f @returns {Record<string, any>}
 */
export const fieldSpec = (f) => ({ kind: f.kind, ...(f.required ? { required: true } : {}), ...f.bounds });
