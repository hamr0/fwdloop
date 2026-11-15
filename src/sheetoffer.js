// M10b piece 3 (docs/wiki/the-module-ladder.md "M10b scope" item 4): what the drafter is OFFERED for a sheet. Things, each once:
//   - `sheetChecksProp`      the tool schema of `close.sheet`: bareguard's `checkSchema` (fields, ops, date formats), never hand-copied, plus fwdloop's own `covers`. Every field that
//                            names a column is a JSON-schema `enum` of the sheet's exact header strings, so the model can only pick one (code still re-checks, piece 1);
//   - `sheetOpsBrief`        the plain list of every op with its summary, what it requires and allows, and bareguard's worked example check, generated the same way;
//   - `isColumnChoiceRule`   the agreed-column rule, covered by the column lock.
// `covers` (which `~` rules of a job line a check verifies, the drafter's typed field) is KEPT on the check and signed (M10b am2: you see it before you sign); it is
// stripped only on the way into bareguard (src/sheetchecks.js `bareguardChecks`) and read by src/sheetblock.js. A field type the vocabulary gains that this file does not know
// THROWS at build time (a bareguard upgrade fails loud, it never silently drops a field).
// Third outcomes, named: a sheet with no header (no enum can be built: no sheet schema is offered).
import { rubricVocabulary, checkSchema } from 'bareguard';
import { SHEET_RULES, MAX_SHEET_CHECKS } from './sheetchecks.js';
import { columnRuleWords } from './sheetlook.js';

const V = /** @type {any} */ (rubricVocabulary);
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** The comparisons of a `where` condition, as bareguard's vocabulary lists them. */
export const WHERE_CMPS = Object.freeze([...V.rules.cells.fields.where.cmps]);

/** @param {Record<string, {header: string[]}>} tables @returns {string[]} the exact header strings of every sheet, once each, in order */
const headerUnion = (tables) => [...new Set(Object.values(tables).flatMap((t) => t.header))];

/** what the drafter is told about a field, in fwdloop's words where they steer a draft better than bareguard's */
const DRAFTER_WORDS = Object.freeze({
  id: 'a short unique name for this check',
  rule: 'cells: the step gives a value that bareguard recomputes; table: bareguard judges the sheet itself',
  table: 'the role of the CSV input this check reads (also in the step\'s reads)',
  claim: 'a cells check only: a short name for the field that holds the step\'s answer to this check; the step is told the shape of the answer, never the check',
  op: 'a cells op goes with rule "cells", a table op with rule "table" (listed in the system prompt)',
});

/**
 * The tool schema of `close.sheet`: a list of bareguard cells / table checks. The check's schema is bareguard's `checkSchema` (every column-bearing field an enum of the sheet's
 * exact header, `table` an enum of the roles, one `op` enum); fwdloop drops what a check must not carry (the free-text `explanation` fields: a check carries no prose), puts its
 * own words on id / rule / table / claim / op, and adds `covers` (which `~` rules of the job line the check covers), kept and signed.
 * @param {Record<string, {header: string[]}>} tables the drafting copy's table of each CSV input role
 * @returns {Record<string, any>|null} null when there is no sheet with a header to pick from
 */
export function sheetChecksProp(tables) {
  const roles = Object.keys(tables);
  const schema = /** @type {any} */ (checkSchema({ rules: /** @type {('cells'|'table')[]} */ ([...SHEET_RULES]), columns: headerUnion(tables), tables: roles }));
  if (roles.length === 0 || schema === null) return null;
  /** @type {Record<string, any>} */
  const props = { ...schema.properties };
  for (const r of SHEET_RULES) for (const [k, f] of Object.entries(V.rules[r].fields)) if (/** @type {any} */ (f).type === 'explanation') delete props[k];
  for (const [k, d] of Object.entries(DRAFTER_WORDS)) if (props[k]) props[k] = { ...props[k], description: d };
  // the left operand `a` is offered the same two shapes as `b` (bareguard's own `b` schema; a `{const}` there is refused by createRubric, as before)
  if (props.a && props.b?.anyOf) props.a = { ...props.b, description: props.a.description, anyOf: [props.a, props.b.anyOf[1]] };
  props.covers = { type: 'array', items: { type: 'integer', minimum: 1 }, description: 'the numbers of the line\'s ~ guardrail rules this check verifies (1 is its first rule); [] when it verifies none of them' };
  return {
    type: 'array',
    minItems: 1,
    maxItems: MAX_SHEET_CHECKS,
    description: 'only on a green step that reads a CSV input: the checks bareguard runs on the step\'s answer. Omit on any other step',
    items: { type: 'object', properties: props, required: [...schema.required, 'covers'], additionalProperties: false },
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
export function sheetOfferRules(roles, lineNums = /** @type {number[]} */ ([])) {
  return [
    ...(lineNums.length ? [`- The job's sheet lines are ${lineNums.join(', ')} (the lines shown with their ~ rules that are not on the list's own rows): "line" in a sheetChecks suggestion is one of those numbers, exactly as shown. The checks of a sheet line are sent only in sheetChecks: an edit that names a sheet line is refused.`] : []),
    `- M17: you write NO sheet check in the declaration (it has no "close.sheet"). A job line whose step reads a CSV input (${roles.join(', ')}) and has a guardrail about values in it lists that input's role in the step's reads and gets its checks from your row-edit reply: "sheetChecks", 1 to ${MAX_SHEET_CHECKS} suggestions, each a bareguard check object from the ops below with "line" = the job line's number and "table" = the CSV input's role. Suggest the checks the line's guardrail needs and nothing else; code builds each one on bareguard or refuses it with its reason, and the person sees every one and can drop it.`,
    '- A column name in a suggestion is picked from the sheet\'s header, spelled exactly; the tool only lets you pick a header name.',
    '- A number in a where condition (gt, gte, lt, lte, eq, between) must be a number the person wrote on that job line or its guardrail; a date (asOf, and the values of before, after, dateOn, dateBetween) must be a date they wrote there as YYYY-MM-DD. Never make a number or a date up: if the person gave none, leave that condition out.',
    '- A "cells" check names "claim", any short name (code renames it); the step is told only the shape of the answer, never the check. A "table" check has no claim and judges the input sheet itself, so it must already hold on that sheet; to check what a step gives, use a cells check. If every check of a step is a table check the step has nothing to answer: suggest at least one cells check too.',
    '- "covers" on each suggestion lists the numbers of the line\'s guardrail rules (the ~ parts, counted from 1 in the order shown) that this check really verifies; [] if none. A guardrail rule that no check covers is shown to the person as Not checked, so cover every rule you can with a real check, and never claim a rule a check does not verify. A rule shaped like "use the column \'X\' for \'Y\'" is a column choice, not a rule to cover.',
    ...sheetOpsBrief(),
  ];
}

/**
 * M17 am2 item 2: the row-edit reply's `sheetChecks` property: bareguard's `checkSchema` items (src/sheetoffer.js `sheetChecksProp`) plus the job line each suggestion is for. Typed suggestions only; code builds or refuses each.
 * @param {Record<string, {header: string[]}>} tables @param {number[]} [lineNums] the job's sheet lines: `line` can only name one of them @returns {Record<string, any>|null}
 */
export function sheetSuggestProp(tables, lineNums = /** @type {number[]} */ ([])) {
  const p = sheetChecksProp(tables);
  if (p === null) return null;
  return { ...p, description: 'suggested sheet checks, only for a job line whose step reads a CSV input: code builds or refuses each one on bareguard; you never write a check into the plan', items: { ...p.items, properties: { line: { type: 'integer', ...(lineNums.length ? { enum: lineNums } : { minimum: 1 }), description: 'the number of the job line this check is for (one of the sheet lines shown)' }, ...p.items.properties }, required: ['line', ...p.items.required] } };
}

/** @param {unknown} rule @returns {boolean} true for the `use the column 'X' for 'Y'` rule an agreed column ask writes ({@link columnRuleWords}) */
export function isColumnChoiceRule(rule) {
  const r = String(rule);
  const head = columnRuleWords('', '').split("''")[0]; // "use the column '"
  return r.startsWith(head) && r.endsWith("'") && r.includes("' for '");
}

/**
 * M17 ruling 1 (hamr 2026-11-14): the parts of an agreed column rule (`use the column 'Amount' for 'Price'`), read from the words code wrote ({@link columnRuleWords}); null for any other text.
 * @param {unknown} rule @returns {{column: string, word: string}|null}
 */
export function columnChoiceParts(rule) {
  if (!isColumnChoiceRule(rule)) return null;
  const r = String(rule);
  const head = "use the column '";
  const mid = r.indexOf("' for '", head.length);
  if (mid < 0) return null;
  return { column: r.slice(head.length, mid), word: r.slice(mid + "' for '".length, r.length - 1) };
}

/**
 * M17 ruling 1: the rule's own words with the job's word (case aside, whole word) swapped for the agreed column: "Price over 500" + Amount -> "Amount over 500". Null when the word is not in the rule.
 * @param {string} text @param {string} word @param {string} column @returns {string|null}
 */
export function swapColumnWord(text, word, column) {
  const w = word.trim().toLowerCase();
  if (w === '') return null;
  const low = text.toLowerCase();
  const isWordChar = (/** @type {string|undefined} */ c) => c !== undefined && c.toLowerCase() !== c.toUpperCase() || (c !== undefined && c >= '0' && c <= '9');
  let from = 0;
  for (;;) {
    const at = low.indexOf(w, from);
    if (at < 0) return null;
    if (!isWordChar(text[at - 1]) && !isWordChar(text[at + w.length])) return `${text.slice(0, at)}${column}${text.slice(at + w.length)}`;
    from = at + 1;
  }
}

/** M17 ruling 2: what the AI is told of a column the person agreed for a word of the job's prose (no `~` rule): the word and the column, typed @param {{line: number, word: string, column: string}} c @returns {string} */
export const agreedColumnWords = (c) => `- The person agreed that on line ${c.line} the word '${c.word}' means the column '${c.column}'. If a check on that line needs it, suggest it on that column.`;
