// F194 POC ($0): sheet checks built by CODE from a line's `~` rules plus typed `!` suggestions, on bareguard's helpers only. Not shipped, no class or hitl code.
// A suggestion is a saved AI-written check read as typed data: its `covers` and its bareguard rule fields. Its id, claim and text are dropped (code names every check).
// One writer per field: id, claim, table(when absent and one role), covers (= the rule rows that hold the check) are assigned here and nowhere else.
// What this throws away: a suggestion's id, claim, text; a refused suggestion's check (only its reason is kept). Third outcomes named: a table bareguard cannot read
// (tableSha null) refuses every check on it with the checkTables reason; a covers list with no valid rule is SURPLUS, never silently built.
import { rubricVocabulary, claimSchema, groundedLiterals } from 'bareguard';
import { SHEET_RULES, sheetCheckColumns, sheetCheckReds, bareguardChecks } from '../../src/sheetchecks.js';
import { tableChecksFailingOnInput } from '../../src/sheetrun.js';
import { isColumnChoiceRule } from '../../src/sheetoffer.js';
import { rulesOfLine } from '../../src/sheetblock.js';
import { wordsSaidOn } from '../../src/pagebits.js';

const V = /** @type {any} */ (rubricVocabulary);
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
/** the fields code names itself; a suggestion never carries them into a built check */
export const DROPPED = Object.freeze(['id', 'claim', 'text', 'covers']);

/** @param {any} ai a saved AI-written check @returns {{covers: any[], fields: Record<string, any>}} the typed `!` suggestion */
export function toSuggestion(ai) {
  const fields = {};
  if (isRec(ai)) for (const [k, v] of Object.entries(ai)) if (!DROPPED.includes(k)) fields[k] = v;
  return { covers: isRec(ai) && Array.isArray(ai.covers) ? ai.covers : [], fields };
}

const idOf = (line, nums) => `l${line}r${nums.join('_')}`;

/**
 * @param {{line: {n: number, text?: string, rules?: string[], guardrail?: string}, tables: Record<string, {header: string[], rows: any[]}>, suggestions: any[]}} o
 *   suggestions: saved AI checks, in order
 * @returns {{rows: Array<{rule: number, text: string, state: 'built'|'column'|'not-checked', reason: string|null, id: string|null}>,
 *   built: any[], surplus: Array<{src: any, why: string}>, refused: Array<{src: any, helper: string, why: string}>}}
 */
export async function buildSheetLine({ line, tables, suggestions }) {
  const rules = rulesOfLine(line);
  const roles = Object.keys(tables);
  const words = wordsSaidOn(line);
  const held = new Map(); // rule number -> built check id
  const built = []; const surplus = []; const refused = [];
  const refusedFor = new Map(); // rule number -> first reason
  for (const src of suggestions) {
    const s = toSuggestion(src);
    const nums = [...new Set(s.covers)].filter((n) => Number.isInteger(n) && n >= 1 && n <= rules.length && !isColumnChoiceRule(rules[n - 1])).sort((a, b) => a - b);
    if (nums.length === 0) { surplus.push({ src, why: 'it covers none of your rules' }); continue; }
    if (nums.some((n) => held.has(n))) { surplus.push({ src, why: 'a rule it covers already has a check' }); continue; }
    const refuse = (helper, why) => { refused.push({ src, helper, why }); for (const n of nums) if (!refusedFor.has(n)) refusedFor.set(n, `suggestion refused: ${helper}: ${why}`); };
    const f = s.fields;
    if (!SHEET_RULES.includes(f.rule) || !isRec(V.rules[f.rule]?.ops) || !Object.hasOwn(V.rules[f.rule].ops, f.op)) { refuse('vocabulary', `no ${String(f.rule)} op "${String(f.op)}"`); continue; }
    const role = typeof f.table === 'string' ? f.table : roles.length === 1 ? roles[0] : null;
    if (role === null || !roles.includes(role)) { refuse('tables', `"${String(f.table)}" is not one of the line's sheets`); continue; }
    const id = idOf(line.n, nums);
    const check = { id, ...f, table: role, ...(f.rule === 'cells' ? { claim: id } : {}) };
    const bad = Object.keys(check).filter((k) => k !== 'id' && k !== 'rule' && !Object.hasOwn(V.rules[f.rule].fields, k));
    if (bad.length > 0) { refuse('schema', `field ${bad.join(', ')} is not a ${f.rule} field`); continue; }
    const cols = sheetCheckColumns(check).filter((c) => !tables[role].header.includes(c));
    if (cols.length > 0) { refuse('columnAt', `'${cols[0]}' is not a column of "${role}"`); continue; }
    const reds = sheetCheckReds([check], line.n, tables);
    if (reds.length > 0) { refuse('checkTables', reds[0].replace(/^declaration: line \d+: /, '')); continue; }
    const miss = groundedLiterals(bareguardChecks([check])[0], words).missing;
    if (miss.length > 0) { refuse('groundedLiterals', `${miss[0].kind} ${JSON.stringify(miss[0].value)} (${miss[0].path}) is not in your words`); continue; }
    if (f.rule === 'cells' && claimSchema(bareguardChecks([check])[0]) === null) { refuse('claimSchema', 'no answer box for this check'); continue; }
    if (f.rule === 'table') {
      const fails = await tableChecksFailingOnInput({ steps: [{ fromLine: line.n, close: { class: 'green', sheet: [check] } }] }, tables);
      if (fails.length > 0) { refuse('runTableChecks', 'the table check already fails on the sheet'); continue; }
    }
    for (const n of nums) held.set(n, id);
    built.push({ check, covers: nums, src });
  }
  const out = rules.map((text, i) => {
    const n = i + 1;
    if (isColumnChoiceRule(text)) return { rule: n, text, state: /** @type {const} */ ('column'), reason: null, id: null };
    if (held.has(n)) return { rule: n, text, state: /** @type {const} */ ('built'), reason: null, id: held.get(n) };
    return { rule: n, text, state: /** @type {const} */ ('not-checked'), reason: refusedFor.get(n) ?? 'no suggestion', id: null };
  });
  return { rows: out, built, surplus, refused };
}
