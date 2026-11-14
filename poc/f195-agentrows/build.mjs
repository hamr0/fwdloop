// F195 POC ($0): F194's builder with am3's rule. Not shipped, no class or hitl code.
// A saved AI check is a typed `!` suggestion (covers + bareguard rule fields); its id, claim, text are dropped, code names every check.
// One writer per field: id, claim, table(when absent and one role) are assigned here; a rule row's id is l<line>r<rules>, an agent row's l<line>a<k>.
// Placement (am3 item 1): every suggestion that passes all bareguard helpers is BUILT. A cells (answer) check is placed before a table check, then saved order.
// It is a RULE-ROW check when none of the rules it covers is held yet, else (or when it covers no rule) its own [agent] row. Nothing is SURPLUS or hidden.
// What this throws away: a suggestion's id, claim, text; a refused suggestion's check (only its reason is kept).
import { rubricVocabulary, claimSchema, groundedLiterals } from 'bareguard';
import { SHEET_RULES, sheetCheckColumns, sheetCheckReds, bareguardChecks } from '../../src/sheetchecks.js';
import { tableChecksFailingOnInput } from '../../src/sheetrun.js';
import { isColumnChoiceRule } from '../../src/sheetoffer.js';
import { rulesOfLine } from '../../src/sheetblock.js';
import { wordsSaidOn } from '../../src/pagebits.js';

const V = /** @type {any} */ (rubricVocabulary);
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const DROPPED = Object.freeze(['id', 'claim', 'text', 'covers']);
export function toSuggestion(ai) {
  const fields = {};
  if (isRec(ai)) for (const [k, v] of Object.entries(ai)) if (!DROPPED.includes(k)) fields[k] = v;
  return { covers: isRec(ai) && Array.isArray(ai.covers) ? ai.covers : [], fields };
}

/**
 * @returns {{rows: Array<{rule: number, text: string, state: 'built'|'column'|'agent-row'|'not-checked', reason: string|null, id: string|null}>,
 *   ruleRows: Array<{check: any, covers: number[], src: any}>, agentRows: Array<{check: any, covers: number[], src: any}>,
 *   built: any[], refused: Array<{src: any, helper: string, why: string}>}}
 */
export async function buildSheetLine({ line, tables, suggestions }) {
  const rules = rulesOfLine(line);
  const roles = Object.keys(tables);
  const words = wordsSaidOn(line);
  const refused = []; const refusedFor = new Map(); const buildable = [];
  for (const src of suggestions) {
    const s = toSuggestion(src);
    const nums = [...new Set(s.covers)].filter((n) => Number.isInteger(n) && n >= 1 && n <= rules.length && !isColumnChoiceRule(rules[n - 1])).sort((a, b) => a - b);
    const refuse = (helper, why) => { refused.push({ src, helper, why }); for (const n of nums) if (!refusedFor.has(n)) refusedFor.set(n, `suggestion refused: ${helper}: ${why}`); };
    const f = s.fields;
    if (!SHEET_RULES.includes(f.rule) || !isRec(V.rules[f.rule]?.ops) || !Object.hasOwn(V.rules[f.rule].ops, f.op)) { refuse('vocabulary', `no ${String(f.rule)} op "${String(f.op)}"`); continue; }
    const role = typeof f.table === 'string' ? f.table : roles.length === 1 ? roles[0] : null;
    if (role === null || !roles.includes(role)) { refuse('tables', `"${String(f.table)}" is not one of the line's sheets`); continue; }
    const check = { ...f, table: role }; // id and claim are set at placement
    const bad = Object.keys(check).filter((k) => k !== 'id' && k !== 'rule' && !Object.hasOwn(V.rules[f.rule].fields, k));
    if (bad.length > 0) { refuse('schema', `field ${bad.join(', ')} is not a ${f.rule} field`); continue; }
    const probe = { id: 'probe', ...check, ...(f.rule === 'cells' ? { claim: 'probe' } : {}) };
    const cols = sheetCheckColumns(probe).filter((c) => !tables[role].header.includes(c));
    if (cols.length > 0) { refuse('columnAt', `'${cols[0]}' is not a column of "${role}"`); continue; }
    const reds = sheetCheckReds([probe], line.n, tables);
    if (reds.length > 0) { refuse('checkTables', reds[0].replace(/^declaration: line \d+: /, '')); continue; }
    const miss = groundedLiterals(bareguardChecks([probe])[0], words).missing;
    if (miss.length > 0) { refuse('groundedLiterals', `${miss[0].kind} ${JSON.stringify(miss[0].value)} (${miss[0].path}) is not in your words`); continue; }
    if (f.rule === 'cells' && claimSchema(bareguardChecks([probe])[0]) === null) { refuse('claimSchema', 'no answer box for this check'); continue; }
    if (f.rule === 'table') {
      const fails = await tableChecksFailingOnInput({ steps: [{ fromLine: line.n, close: { class: 'green', sheet: [probe] } }] }, tables);
      if (fails.length > 0) { refuse('runTableChecks', 'the table check already fails on the sheet'); continue; }
    }
    buildable.push({ src, nums, fields: check });
  }
  // placement: answer (cells) checks first, then saved order (stable sort)
  const order = buildable.map((b, i) => ({ b, i })).sort((x, y) => (x.b.fields.rule === 'cells' ? 0 : 1) - (y.b.fields.rule === 'cells' ? 0 : 1) || x.i - y.i).map((x) => x.b);
  const held = new Map(); const ruleRows = []; const agentRows = []; const coveredByAgent = new Map();
  for (const b of order) {
    const asRule = b.nums.length > 0 && b.nums.every((n) => !held.has(n));
    const id = asRule ? `l${line.n}r${b.nums.join('_')}` : `l${line.n}a${agentRows.length + 1}`;
    const check = { id, ...b.fields, ...(b.fields.rule === 'cells' ? { claim: id } : {}) };
    if (asRule) { for (const n of b.nums) held.set(n, id); ruleRows.push({ check, covers: b.nums, src: b.src }); }
    else { for (const n of b.nums) if (!coveredByAgent.has(n)) coveredByAgent.set(n, id); agentRows.push({ check, covers: b.nums, src: b.src }); }
  }
  const rows = rules.map((text, i) => {
    const n = i + 1;
    if (isColumnChoiceRule(text)) return { rule: n, text, state: /** @type {const} */ ('column'), reason: null, id: null };
    if (held.has(n)) return { rule: n, text, state: /** @type {const} */ ('built'), reason: null, id: held.get(n) };
    if (coveredByAgent.has(n)) return { rule: n, text, state: /** @type {const} */ ('agent-row'), reason: null, id: coveredByAgent.get(n) };
    return { rule: n, text, state: /** @type {const} */ ('not-checked'), reason: refusedFor.get(n) ?? 'no suggestion', id: null };
  });
  return { rows, ruleRows, agentRows, built: [...ruleRows, ...agentRows], refused };
}
