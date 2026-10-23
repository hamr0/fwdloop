// M10b piece 3 (docs/wiki/the-module-ladder.md "M10b scope" item 4): what the drafter is OFFERED for a sheet. Things, each once:
//   - `sheetChecksProp`      the tool schema of `close.sheet`, GENERATED from bareguard's `rubricVocabulary` (fields, ops, date formats), never hand-copied. Every field that
//                            names a column is a JSON-schema `enum` of the sheet's exact header strings, so the model can only pick one (code still re-checks, piece 1);
//   - `sheetOpsBrief`        the plain list of every op with its summary, what it requires and allows, and bareguard's worked example check, generated the same way;
//   - `isColumnChoiceRule`   the agreed-column rule, covered by the column lock.
// `covers` (which `~` rules of a job line a check verifies, the drafter's typed field) is KEPT on the check and signed (M10b am2: you see it before you sign); it is
// stripped only on the way into bareguard (src/sheetchecks.js `bareguardChecks`) and read by src/sheetblock.js. A field type the vocabulary gains that this file does not know
// THROWS at build time (a bareguard upgrade fails loud, it never silently drops a field).
// Third outcomes, named: a sheet with no header (no enum can be built: no sheet schema is offered).
import { rubricVocabulary } from 'bareguard';
import {
  SHEET_RULES, MAX_SHEET_CHECKS, COLUMN_STRING_FIELDS, COLUMN_OPERAND_FIELDS, COLUMN_CELL_FIELDS, COLUMN_LIST_FIELDS,
} from './sheetchecks.js';
import { columnRuleWords } from './sheetlook.js';

const V = /** @type {any} */ (rubricVocabulary);
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The comparisons of a `where` condition. bareguard publishes them only inside the `where` description (no list), so this is the one copy; a test proves each is named there. */
export const WHERE_CMPS = Object.freeze(['gt', 'gte', 'lt', 'lte', 'eq', 'between', 'before', 'after', 'dateBetween', 'dateOn', 'equals', 'empty', 'notEmpty']);

/** @param {Record<string, {header: string[]}>} tables @returns {string[]} the exact header strings of every sheet, once each, in order */
const headerUnion = (tables) => [...new Set(Object.values(tables).flatMap((t) => t.header))];

/**
 * The JSON schema of one vocabulary field. `col` = the schema every column name uses (an enum of the header).
 * @param {string} key @param {any} f @param {Record<string, any>} col @param {string[]} roles @returns {Record<string, any>|null} null = not offered
 */
function fieldSchema(key, f, col, roles) {
  const d = f.description ? { description: f.description } : {};
  if (key === 'table') return { type: 'string', enum: roles, description: 'the role of the CSV input this check reads (also in the step\'s reads)' };
  if (key === 'claim') return { type: 'string', minLength: 1, maxLength: 128, description: 'a cells check only: a short name for the field that holds the step\'s answer to this check; the step is told the shape of the answer, never the check', };
  if (COLUMN_STRING_FIELDS.includes(key)) return { ...col, ...d };
  if (COLUMN_OPERAND_FIELDS.includes(key)) return { anyOf: [col, { type: 'object', properties: { const: { type: 'number' } }, required: ['const'], additionalProperties: false }], ...d };
  switch (f.type) {
    case 'name': case 'string': return { type: 'string', ...d };
    case 'explanation': return null; // free text: never offered (a check carries no prose)
    case 'date': return { type: 'string', ...d };
    case 'integer': return { type: 'integer', ...d };
    case 'number': return { type: 'number', ...d };
    case 'boolean': return { type: 'boolean', ...d };
    case 'enum': return { type: 'string', enum: f.enum, ...d };
    case 'range': return { type: 'object', properties: { from: { type: 'integer' }, to: { type: 'integer' } }, required: ['from', 'to'], additionalProperties: false, ...d };
    case 'cell': return { type: 'object', properties: { column: col, row: { type: 'integer' } }, required: ['column', 'row'], additionalProperties: false, ...d };
    case 'condition-list': return { type: 'array', items: { type: 'object', properties: { column: col, cmp: { type: 'string', enum: [...WHERE_CMPS] }, value: {}, lo: {}, hi: {} }, required: ['column', 'cmp'], additionalProperties: false }, ...d };
    case 'date-format-list': return { type: 'array', items: { type: 'object', properties: { column: col, format: { type: 'string', enum: V.cells.dateFormats } }, required: ['column', 'format'], additionalProperties: false }, ...d };
    case 'band-list': return { type: 'array', items: { type: 'object', properties: { name: { type: 'string' }, gt: { type: 'number' }, gte: { type: 'number' }, lt: { type: 'number' }, lte: { type: 'number' } }, required: ['name'], additionalProperties: false }, ...d };
    default: throw new Error(`sheetoffer: bareguard's rubricVocabulary has a field type "${f.type}" (${key}) this file does not know - add it before offering sheet checks`);
  }
}

/**
 * The tool schema of `close.sheet`: a list of bareguard cells / table checks. Every field is a field of bareguard's vocabulary; every column-bearing field
 * (`column keyColumn groupColumn result a b from to cell where[].column dateFormats[].column`) is an enum of the sheet's exact header. `covers` is fwdloop's own field
 * (which `~` rules of the job line the check covers), kept and signed.
 * @param {Record<string, {header: string[]}>} tables the drafting copy's table of each CSV input role
 * @returns {Record<string, any>|null} null when there is no sheet with a header to pick from
 */
export function sheetChecksProp(tables) {
  const roles = Object.keys(tables);
  const headers = headerUnion(tables);
  if (roles.length === 0 || headers.length === 0) return null;
  const col = { type: 'string', enum: headers };
  /** @type {Record<string, any>} */
  const props = {
    id: { type: 'string', minLength: 1, description: 'a short unique name for this check' },
    rule: { type: 'string', enum: [...SHEET_RULES], description: 'cells: the step gives a value that bareguard recomputes; table: bareguard judges the sheet itself' },
  };
  for (const r of SHEET_RULES) {
    for (const [k, f] of Object.entries(V.rules[r].fields)) {
      if (k === 'op' || props[k] !== undefined) continue;
      const s = fieldSchema(k, f, col, roles);
      if (s !== null) props[k] = s;
    }
  }
  props.op = { type: 'string', enum: [...new Set(SHEET_RULES.flatMap((r) => Object.keys(V.rules[r].ops)))], description: 'a cells op goes with rule "cells", a table op with rule "table" (listed in the system prompt)' };
  props.covers = { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'the numbers of the line\'s ~ guardrail rules this check verifies (1 is its first rule); [] when it verifies none of them' };
  return {
    type: 'array',
    minItems: 1,
    maxItems: MAX_SHEET_CHECKS,
    description: 'only on a green step that reads a CSV input: the checks bareguard runs on the step\'s answer. Omit on any other step',
    items: { type: 'object', properties: props, required: ['id', 'rule', 'table', 'op', 'covers'], additionalProperties: false },
  };
}

/**
 * Every op of the cells and table rules with its summary, what it requires and allows, its claim shape and bareguard's worked example check. Generated from the
 * vocabulary; a new op bareguard adds shows up here by itself.
 * @returns {string[]} lines for the system prompt
 */
export function sheetOpsBrief() {
  const out = [];
  for (const rule of SHEET_RULES) {
    out.push(`Rule "${rule}" ops (each line: op, what it does, requires / allows, then bareguard's worked example check; the column names in the examples are only illustrations):`);
    for (const [op, o] of Object.entries(V.rules[rule].ops)) {
      out.push(`- ${op}: ${o.summary}. requires: ${(o.requires ?? []).join(', ') || 'nothing'}; allows: ${(o.allows ?? []).join(', ') || 'nothing'}${o.claim ? `; the step's answer: ${o.claim}` : ''}. Example: ${JSON.stringify(o.example.check)}`);
    }
  }
  out.push(`- The example table those checks run against: ${JSON.stringify(V.cells.exampleTables.t)}`);
  out.push(`- A date column needs a dateFormats entry, its format one of ${V.cells.dateFormats.join(' | ')}. Where conditions: ${V.rules.cells.fields.where.description}`);
  return out;
}

/**
 * The rules the validator enforces on `close.sheet`, as lines for the drafter (every one of them is a refusal at $0 in src/declaration.js / src/sheetchecks.js).
 * @param {string[]} roles the CSV input roles @returns {string[]}
 */
export function sheetOfferRules(roles) {
  return [
    `- A green step whose line has a guardrail about values in a CSV input (${roles.join(', ')}) lists that input's role in its reads and carries close.sheet = a list of 1 to ${MAX_SHEET_CHECKS} checks, each a bareguard check object from the ops below, with "table" = the CSV input's role. Write the checks the line's guardrail needs and nothing else; the person signs them. close.sheet is for a green step only.`,
    '- A column name in a check is picked from the sheet\'s header, spelled exactly; the tool only lets you pick a header name. A check that bareguard refuses (a wrong field for the op, overlapping bands, a missing dateFormats entry) is refused at $0 naming the job line.',
    '- A number in a where condition (gt, gte, lt, lte, eq, between) must be a number the person wrote on that job line or its guardrail; a date (asOf, and the values of before, after, dateOn, dateBetween) must be a date they wrote there as YYYY-MM-DD. Never make a number or a date up: if the person gave none, leave that condition out.',
    '- A "cells" check names "claim", a short name for the answer the step gives; the step is told only the shape of the answer, never the check. A "table" check has no claim and judges the sheet itself. If every check of a step is a table check the step has nothing to answer and the line is refused: pair a table check with at least one cells check.',
    '- "covers" on each check lists the numbers of the line\'s guardrail rules (the ~ parts, counted from 1 in the order shown) that this check really verifies; [] if none. A guardrail rule that no check covers is shown to the person as Not checked, so cover every rule you can with a real check, and never claim a rule a check does not verify. A rule shaped like "use the column \'X\' for \'Y\'" is a column choice, not a rule to cover.',
    ...sheetOpsBrief(),
  ];
}

/** @param {unknown} rule @returns {boolean} true for the `use the column 'X' for 'Y'` rule an agreed column ask writes ({@link columnRuleWords}) */
export function isColumnChoiceRule(rule) {
  const r = String(rule);
  const head = columnRuleWords('', '').split("''")[0]; // "use the column '"
  return r.startsWith(head) && r.endsWith("'") && r.includes("' for '");
}
