// borrowed-from: bareloop src/shaperows.js@v0.61.0 (fc56e1f3)
// SHAPE JOBS (itemShape), docs/product/ITEM33-BUILD.md "Addendum 2026-11-18: shape jobs", clause 8 "Views" (and the rows' words of clause 4): the WORDS of the shape rows of the one list and the pure readers of a signed close's shape part.
// Modelled on src/sheetrows.js. The ROWS themselves live in the one owner, src/checkblock.js (`setShape`, `rowChoice`); this file only names them and reads them back, so the confirm card, the signed card, the Job tab, the
// Result tab and the report say the same thing.
// THE PART (what the views read and what `rubricStepShapeReds`, `buildStepSpec` and `lineBriefs` sign, check and brief):
//   { class: 'shape', text, fields: [{ name, spec: {kind, required?, ...bounds}, rule?: <the ~ rule number it comes from>, row?: 'agent' }], minItems?, maxItems?, rules?: [<rule numbers>] }
// Rows of one shape line: a `[you]` row per `~` rule that has a field (the rule's own row, kind `rule`), an `[agent]` row per extra field (kind `shape`, key `L<n>.shape.<name>`), and the line's `[default]` row (key
// `L<n>.$shape`): the answer is a list of items, with the item count when the person's words gave one.
import { createRubric, rubricVocabulary } from 'bareguard';
import { lineRules } from './rubricstep.js';
import { nameWhy, shapeNameRules, SHAPE_KINDS } from './shapemenu.js';

const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the key of an `[agent]` shape row and of a line's `[default]` shape row @param {number} line @param {string} name */
export const shapeRowKey = (line, name) => `L${line}.shape.${name}`;
/** @param {number} line */
export const shapeDefaultKey = (line) => `L${line}.$shape`;

/** the words of the `[default]` row of a shape line, drawn only when the person's words gave an item count (hamr 2026-11-18: the card's `$` row is the Not checked line): `exactly 2 items` @param {{min?: number, max?: number}|null} [count] @returns {string|null} */
export function shapeDefaultWords(count = null) {
  if (count && Number.isInteger(count.min) && count.min === count.max) return `the answer lists exactly ${count.min} item${count.min === 1 ? '' : 's'}`;
  return null;
}

/** why the truth of a shape line's items is not checked: the person judges it at Accept (the Not checked row of every shape line) */
export const SHAPE_TRUTH_PARTS = Object.freeze(['whether each one is true', 'you judge it at Accept']);
export const SHAPE_TRUTH_WORDS = SHAPE_TRUTH_PARTS.join(' \u2014 ');

/** @param {unknown} v @returns {string} */
const q = (v) => (typeof v === 'string' ? `"${v}"` : String(v));

/** the words of a shape card's heading, once above a shape line's rows (code's, never the model's) */
export const SHAPE_HEAD_PARTS = Object.freeze(['Shape checks', "code checks each item's form, not whether it is true"]);
export const SHAPE_HEAD = SHAPE_HEAD_PARTS.join(' \u00B7 ');

/** an upper bound `n` as the person's own form: "under N unit" when their words say under/fewer than/less than/below N+1 (so the signed N is "under N+1"), else "at most N unit" @param {number} n @param {string} unit @param {string} said */
export function upper(n, unit, said) {
  const u = unit ? ` ${unit}` : '';
  return new RegExp(`(?:under|fewer than|less than|below)\\s+${n + 1}\\b`, 'i').test(said) ? `under ${n + 1}${u}` : `at most ${n}${u}`;
}

/** one bound range as words: `at least 3`, `at most 10`, `over 3`, `under 10` @param {Record<string, any>} s @param {string} said @returns {string[]} */
function range(s, said) {
  return [
    ...(s.min !== undefined ? [`at least ${q(s.min)}`] : []), ...(s.gt !== undefined ? [`over ${q(s.gt)}`] : []),
    ...(s.max !== undefined ? [typeof s.max === 'number' ? upper(s.max, '', said) : `at most ${q(s.max)}`] : []), ...(s.lt !== undefined ? [`under ${q(s.lt)}`] : []),
  ];
}

/**
 * A field spec as one plain sentence, written by code from the signed fields, in the person's own form where their words show it ("under 200 characters", not "at most 199"). Pure.
 * @param {Record<string, any>} spec `{kind, required?, ...bounds}` @param {string} [said] the person's own rule for the field @returns {string}
 */
export function shapeFieldSentence(spec, said = '') {
  const s = isRec(spec) ? spec : {};
  /** @type {string} */
  let out;
  switch (s.kind) {
    case 'text': {
      const c = [
        ...(s.minChars === 1 ? ['not empty'] : s.minChars !== undefined ? [`at least ${s.minChars} characters`] : []), ...(s.maxChars !== undefined ? [upper(s.maxChars, 'characters', said)] : []),
        ...(s.minWords !== undefined ? [`at least ${s.minWords} words`] : []), ...(s.maxWords !== undefined ? [upper(s.maxWords, 'words', said)] : []),
      ];
      out = c.length ? c.join(', ') : 'text';
      break;
    }
    case 'number': out = ['a number', ...range(s, said)].join(', '); break;
    case 'money': out = ['an amount of money', ...range(s, said)].join(', '); break;
    case 'date': out = ['a date', ...range(s, said)].join(', '); break;
    case 'time': out = ['a time', ...range(s, said)].join(', '); break;
    case 'url': out = 'a web address'; break;
    case 'oneOf': out = `one of: ${(Array.isArray(s.values) ? s.values : []).join(', ')}`; break;
    case 'boolean': out = s.equals === true ? 'yes' : s.equals === false ? 'no' : 'yes or no'; break;
    case 'list': {
      const c = [...(s.minEntries !== undefined ? [`at least ${s.minEntries} entries`] : []), ...(s.maxEntries !== undefined ? [upper(s.maxEntries, 'entries', said)] : []), ...(s.unique === true ? ['no repeats'] : [])];
      out = [`a list of ${isRec(s.of) ? shapeFieldSentence(s.of, said) : 'values'}`, ...c].join(', ');
      break;
    }
    default: out = String(s.kind ?? 'a value');
  }
  return out;
}

/**
 * The signed part of ONE shape line, from the fields that stand (the `[you]` rule fields and the `[agent]` fields the person has not dropped or left Suggested).
 * @param {{text: string, fields: {name: string, spec: Record<string, any>, rule?: number|null, by?: 'you'|'agent'}[], itemCount?: {n: number}|null}} o
 * @returns {Record<string, any>}
 */
export function buildShapePart({ text, fields, itemCount = null }) {
  const rules = [...new Set(fields.filter((f) => Number.isInteger(f.rule)).map((f) => /** @type {number} */ (f.rule)))].sort((a, b) => a - b);
  return {
    class: 'shape', text,
    fields: fields.map((f) => ({ name: f.name, spec: f.spec, ...(Number.isInteger(f.rule) ? { rule: f.rule } : {}), ...(f.by === 'agent' ? { row: 'agent' } : {}) })),
    ...(itemCount ? { minItems: itemCount.n, maxItems: itemCount.n } : {}),
    ...(rules.length ? { rules } : {}),
  };
}

/** the shape part of a rubric-step stage's params, or null: picked by the line's signed CLASS, never by a key of the answer file @param {any} params @returns {any} */
export const shapePartOf = (params) => (isRec(params) && Array.isArray(params.parts) ? params.parts.find((/** @type {any} */ p) => isRec(p) && p.class === 'shape' && Array.isArray(p.fields)) ?? null : null);

/** the signed shape part of job line `n` in a close, or null @param {any} closeDecl @param {number} n */
export function shapePartOfLine(closeDecl, n) {
  for (const st of Array.isArray(closeDecl?.stages) ? closeDecl.stages : []) {
    if (!isRec(st) || st.kind !== 'rubric-step' || !isRec(st.params) || st.params.step !== n) continue;
    const p = shapePartOf(st.params);
    if (p) return p;
  }
  return null;
}

/** the words of one signed field row: `name \u00B7 sentence` (the rule it comes from is the `~ [you]` tag's, the card's heading says what is checked) @param {any} f @param {string[]} rules the line's `~` rules @returns {string} */
export function shapeFieldText(f, rules) {
  const said = Number.isInteger(f.rule) ? rules[f.rule - 1] : undefined;
  return `${f.name} \u00B7 ${shapeFieldSentence(f.spec, said ?? '')}`;
}

/**
 * The shape rows of a signed close, read from its shape parts: one per field (a `[you]` rule row's, an `[agent]` row's), then the line's `[default]` row. A close with no shape part has none.
 * `rule` is the rule a `[you]` row is. Text is code's (never a model's).
 * @param {any} closeDecl @param {any[]|null} [jobLines] the person's numbered lines
 * @returns {{line: number, key: string, by: 'you'|'agent'|'default', text: string, name?: string, rule?: number}[]}
 */
export function shapeRowsOf(closeDecl, jobLines = null) {
  const stages = isRec(closeDecl) && Array.isArray(closeDecl.stages) ? closeDecl.stages : [];
  /** @type {{line: number, key: string, by: 'you'|'agent'|'default', text: string, name?: string, rule?: number, shape: true}[]} */
  const out = [];
  for (const st of stages) {
    if (!isRec(st) || st.kind !== 'rubric-step' || !isRec(st.params)) continue;
    const part = shapePartOf(st.params);
    if (!part) continue;
    const n = st.params.step;
    const rules = lineRules((jobLines ?? []).find((/** @type {any} */ l) => isRec(l) && l.n === n));
    for (const f of part.fields.filter(isRec)) {
      out.push(Number.isInteger(f.rule) && f.row !== 'agent'
        ? { line: n, key: `L${n}.~${f.rule}`, by: 'you', text: shapeFieldText(f, rules), name: String(f.name), rule: f.rule, shape: true }
        : { line: n, key: shapeRowKey(n, String(f.name)), by: 'agent', text: shapeFieldText(f, rules), name: String(f.name), shape: true });
    }
    const dw = shapeDefaultWords(Number.isInteger(part.minItems) ? { min: part.minItems, max: part.maxItems } : null);
    if (dw !== null) out.push({ line: n, key: shapeDefaultKey(n), by: 'default', text: dw, shape: true });
  }
  return out;
}

/** the fields that say what a shape field IS: all but the names code gives it (the row's own key) — two drafts spell the same field alike @param {{name: string, kind: string, required?: boolean, bounds?: Record<string, any>}} f @returns {Record<string, any>} */
export const shapeFieldBody = (f) => ({ name: f.name, kind: f.kind, required: f.required === true, bounds: f.bounds ?? {} });

/** bareguard's own worked example item of `itemShape` (its address and values are bareguard's, not ours) @type {Record<string, any>} */
const WORKED = /** @type {any} */ (rubricVocabulary).rules.itemShape.example.output.items[0];

/** the answer field the `itemShape` check reads: the shape answer's one list (the step file is `{"results": [...]}`) */
export const SHAPE_FIELD = 'results';

/**
 * The bareguard `itemShape` check of a signed shape part (clause 6, `buildStepSpec`): the answer field `results`, the item count the person's words gave, and one field spec per signed field.
 * @param {any} part a `shape` part @param {string} id @param {any} [factPart] the step's fact part, when the line is facts+shape @returns {Record<string, any>}
 */
export function shapeItemCheck(part, id, factPart = null) {
  const own = Object.fromEntries((Array.isArray(part.fields) ? part.fields : []).filter(isRec).map((f) => [String(f.name), f.spec]));
  // FACTS + SHAPE (the rules-first spec, verified on real data in .claude/scratch/shape-combined/round2): the one list is also read by `cited`, and the itemShape is CLOSED, so it lists the keys the fact result carries:
  // `quote` (text, required) and `values` (an object, one OPTIONAL field per signed fact: a number read from text for a money or number fact, text for every other shape). No `claim` key: `cited` reads claims
  // that `flattenStep` builds from the signed fact names. The item COUNT stays with the fact part's own count checks (one fault, one report); the shape part's count is used only when the fact part has none.
  const facts = isRec(factPart) && Array.isArray(factPart.facts) ? factPart.facts.filter(isRec) : null;
  const factCounted = isRec(factPart) && isRec(factPart.count) && (Number.isInteger(factPart.count.min) || Number.isInteger(factPart.count.max));
  const count = facts !== null && factCounted ? {} : { ...(Number.isInteger(part.minItems) ? { minItems: part.minItems } : {}), ...(Number.isInteger(part.maxItems) ? { maxItems: part.maxItems } : {}) };
  const fields = facts === null ? own : {
    quote: { kind: 'text', required: true },
    values: { kind: 'object', fields: Object.fromEntries(facts.map((f) => [String(f.name), f.shape === 'money' || f.shape === 'number' ? { kind: 'number', fromText: true } : { kind: 'text' }])) },
    ...own,
  };
  return { id, rule: 'itemShape', field: SHAPE_FIELD, ...count, fields };
}

/**
 * The SHAPE of a `shape` part (clause 5, called by `rubricStepShapeReds`): its fields are named legally and once, each spec has a kind on the menu, the count is whole numbers, a rule number is a whole number, and bareguard itself
 * accepts the check (`createRubric`, which refuses an impossible bound or a field spec it does not know, naming the path). Pure, never throws.
 * @param {any} part @param {string} w the path of the part @param {(code: string, path: string, detail: string) => void} red
 */
export function shapeShapeReds(part, w, red, factPart = null) {
  const fs = part.fields;
  if (!Array.isArray(fs) || fs.length === 0) { red('invalid-value', `${w}.fields`, 'a non-empty list of fields: {name, spec, rule?, row?}'); return; }
  const rules = shapeNameRules();
  const seen = new Set();
  fs.forEach((/** @type {any} */ f, /** @type {number} */ i) => {
    const fw = `${w}.fields[${i}]`;
    if (!isRec(f)) { red('invalid-value', fw, '{name, spec, rule?, row?}'); return; }
    const bad = nameWhy(f.name, rules);
    if (bad !== null) red('invalid-value', `${fw}.name`, bad);
    else if (seen.has(f.name)) red('invalid-value', `${fw}.name`, `the field name "${f.name}" is used twice`);
    else seen.add(f.name);
    if (factPart && (f.name === 'quote' || f.name === 'values')) red('invalid-value', `${fw}.name`, `"${f.name}" is a key of the fact results on this line, so it cannot name a shape field`);
    if (!isRec(f.spec) || !Object.hasOwn(SHAPE_KINDS, String(f.spec.kind))) red('invalid-value', `${fw}.spec.kind`, `one of ${Object.keys(SHAPE_KINDS).join(' | ')}`);
    if (Object.hasOwn(f, 'rule') && !(Number.isInteger(f.rule) && f.rule >= 1)) red('invalid-value', `${fw}.rule`, 'the number of the ~ rule the field comes from (an integer, 1 or more)');
    if (Object.hasOwn(f, 'row') && f.row !== 'agent') red('invalid-value', `${fw}.row`, '"agent" (the tag of a field code made its own row) or absent');
  });
  for (const k of ['minItems', 'maxItems']) if (Object.hasOwn(part, k) && !(Number.isInteger(part[k]) && part[k] >= (k === 'maxItems' ? 1 : 0))) red('invalid-value', `${w}.${k}`, 'a whole number of items');
  if (Number.isInteger(part.minItems) && Number.isInteger(part.maxItems) && part.minItems > part.maxItems) red('invalid-value', `${w}.maxItems`, 'maxItems is below minItems');
  if (!isRec(part) || fs.some((/** @type {any} */ f) => !isRec(f) || !isRec(f.spec))) return;
  // bareguard is the judge of whether the shape is SIGNABLE: ask it here, at $0
  try {
    createRubric({ schema: 1, goal: 'shape', inputs: [], checkpoints: { shape: { gating: false, checks: [shapeItemCheck(part, 'shape', factPart)] } } });
  } catch (e) {
    red('invalid-value', `${w}.fields`, `bareguard refuses this shape: ${String(/** @type {any} */ (e)?.message ?? e)}`);
  }
}

/**
 * One worked example item of a shape, written by code from the signed fields (never by a model): a value of each field's kind that the field's own bounds accept.
 * @param {{name: string, spec: Record<string, any>}[]} fields @returns {Record<string, any>}
 */
export function shapeExampleItem(fields) {
  const one = (/** @type {Record<string, any>} */ s) => {
    switch (s.kind) {
      case 'text': {
        if (Number.isInteger(s.minWords) && s.minWords > 0) return Array.from({ length: s.minWords }, () => 'word').join(' ');
        const lo = Math.max(Number.isInteger(s.minChars) ? s.minChars : 1, 1);
        const len = Math.min(Math.max(12, lo), Number.isInteger(s.maxChars) ? s.maxChars : Infinity);
        return 'Example text'.padEnd(len, '.').slice(0, len);
      }
      case 'number': return s.min ?? (s.gt !== undefined ? s.gt + 1 : s.max ?? (s.lt !== undefined ? s.lt - 1 : 1));
      case 'oneOf': return Array.isArray(s.values) ? s.values[0] : 'value';
      case 'money': { const c = Array.isArray(s.currency) ? s.currency[0] : s.currency; const u = Array.isArray(s.unit) ? s.unit[0] : s.unit; const a = s.min ?? (s.gt !== undefined ? s.gt + 1 : s.max ?? (s.lt !== undefined ? s.lt - 1 : 10)); return typeof c === 'string' && c.length === 1 ? `${c}${a}` : `${a} ${u ?? c ?? ''}`.trim(); }
      case 'date': return s.min ?? '2026-01-15';
      case 'time': return s.min ?? '09:30';
      case 'url': return WORKED.link;
      case 'boolean': return s.equals ?? true;
      case 'list': return isRec(s.of) ? [one(s.of)] : [];
      default: return 'value';
    }
  };
  return Object.fromEntries(fields.map((f) => [f.name, one(f.spec)]));
}
