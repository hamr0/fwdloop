// borrowed-from: bareloop src/sheetbuild.js@v0.60.0 (`buildSheetChecks`, and the `line` routing field `buildSheetLine` strips; bareloop copied `buildSheetLine` from this file, M17 am2/am3, so it stays as it is)
// M17 am2 + am3 (docs/wiki/the-module-ladder.md "M17 am2", "M17 am3"): the ONE builder of the sheet checks of a line. The AI never writes a sheet check: what it sends on the row-edit reply (`sheetChecks`) is read here only as a typed SUGGESTION (bareguard's rule fields plus the `covers` numbers); code refuses or builds every one on bareguard's shapes and writes the check itself.
// Ported from poc/f195-agentrows/build.mjs (F195 PASS, $0); no class code, no send-back loop, no word-to-column guess, no per-case validator patch.
//   refusals (each by bareguard, in this order): the vocabulary (rule, op), the line's sheets, the schema (a field of the rule), `columnAt` (a column of the sheet's header), `checkTables`
//   (and its problems), `groundedLiterals` (a number or date in the person's own words), `claimSchema` (an answer box), and for a `table` check `runTableChecks` on the sheet frozen at draft time.
//   placement (am3 item 1): every suggestion that passes all of them is BUILT. A cells (answer) check is placed before a table check, then in the order sent. A cells check is a RULE ROW's check when none of the
//   rules it covers is held by an earlier rule row, else (or when it covers no rule) its own `[agent]` row. M17 am7: a `table` check reads only the input sheet, so it is never a rule row: it is always
//   its own `[agent]` row, on by default, and covers no rule (a rule only a table check named is Not checked). Nothing is hidden; nothing sits beside a rule's row.
// One writer per field: `id`, `claim`, `covers` and `table` (when absent and the line reads one sheet) are assigned here. A rule row's id is `l<line>r<rules>`, an agent row's `l<line>a<k>`; the claim is the id.
// What this throws away: a suggestion's `id`, `claim`, `text` (and its `covers`: an agent row's is only the rule no rule row holds); a refused suggestion's check (only its reason is kept, on the rules it named).
// Third outcomes, named: a suggestion that is not an object, names no rule or op bareguard has, a table it cannot read, a column that is no header: refused with that helper's words; a rule that no
// check holds is Not checked with the last refusal that named it, or the no-pick sentence (`NO_VALUE_WHY`).
import { rubricVocabulary, claimSchema, groundedLiterals } from 'bareguard';
import { SHEET_RULES, sheetCheckColumns, sheetCheckReds, bareguardChecks } from './sheetchecks.js';
import { tableChecksFailingOnInput } from './sheetrun.js';
import { isColumnChoiceRule } from './sheetoffer.js';
import { rulesOfLine } from './sheetblock.js';
import { wordsSaidOn } from './pagebits.js';
import { NO_VALUE_WHY } from './ticketrows.js';

const V = /** @type {any} */ (rubricVocabulary);
const isRec = (/** @type {unknown} */ v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/** the fields of a suggestion code does not read: it names every check itself */
export const SUGGESTION_DROPPED = Object.freeze(['id', 'claim', 'text', 'covers']);

/**
 * @param {any} ai a suggestion as the AI sent it @returns {{covers: number[], fields: Record<string, any>}}
 */
export function toSuggestion(ai) {
  /** @type {Record<string, any>} */
  const fields = {};
  if (isRec(ai)) for (const [k, v] of Object.entries(ai)) if (!SUGGESTION_DROPPED.includes(k)) fields[k] = v;
  return { covers: isRec(ai) && Array.isArray(ai.covers) ? ai.covers : [], fields };
}

/**
 * @typedef {{check: any, covers: number[]}} Placed
 * @typedef {{rule: number, text: string, state: 'built'|'column'|'agent-row'|'not-checked', reason: string|null, id: string|null}} RuleState
 * @param {{line: {n: number, text?: string, rules?: string[], guardrail?: string, rule?: string}, tables: Record<string, {header: string[], rows: any[]}>, suggestions: any[]}} o
 * @returns {Promise<{rows: RuleState[], ruleRows: Placed[], agentRows: Placed[], checks: any[], refused: {helper: string, why: string}[]}>}
 */
export async function buildSheetLine({ line, tables, suggestions }) {
  const rules = rulesOfLine(line);
  const roles = Object.keys(tables);
  const words = wordsSaidOn({ text: line.text, rules });
  /** @type {{helper: string, why: string}[]} */
  const refused = [];
  /** @type {Map<number, string>} */
  const refusedFor = new Map();
  /** @type {{nums: number[], fields: Record<string, any>}[]} */
  const buildable = [];
  for (const src of suggestions) {
    const s = toSuggestion(src);
    const nums = [...new Set(s.covers)].filter((n) => Number.isInteger(n) && n >= 1 && n <= rules.length && !isColumnChoiceRule(rules[n - 1])).sort((a, b) => a - b);
    const refuse = (/** @type {string} */ helper, /** @type {string} */ why) => { refused.push({ helper, why }); for (const n of nums) if (!refusedFor.has(n)) refusedFor.set(n, `suggestion refused: ${helper}: ${why}`); };
    const f = s.fields;
    if (!SHEET_RULES.includes(f.rule) || !isRec(V.rules[f.rule]?.ops) || !Object.hasOwn(V.rules[f.rule].ops, f.op)) { refuse('vocabulary', `no ${String(f.rule)} op "${String(f.op)}"`); continue; }
    const role = typeof f.table === 'string' ? f.table : roles.length === 1 ? roles[0] : null;
    if (role === null || !roles.includes(role)) { refuse('tables', `"${String(f.table)}" is not one of the line's sheets`); continue; }
    // `line` is the reply's own routing field (src/sheetoffer.js `sheetSuggestProp`), read by buildSheetChecks, never part of a check
    const { line: _line, ...own } = f;
    const check = { ...own, table: role };
    const bad = Object.keys(check).filter((k) => k !== 'rule' && !Object.hasOwn(V.rules[f.rule].fields, k));
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
    buildable.push({ nums, fields: check });
  }
  // placement: answer (cells) checks first, then the order sent (a stable sort)
  const order = buildable.map((b, i) => ({ b, i })).sort((x, y) => (x.b.fields.rule === 'cells' ? 0 : 1) - (y.b.fields.rule === 'cells' ? 0 : 1) || x.i - y.i).map((x) => x.b);
  /** @type {Map<number, string>} */
  const held = new Map();
  /** @type {Map<number, string>} */
  const coveredByAgent = new Map();
  /** @type {Placed[]} */
  const ruleRows = [];
  /** @type {Placed[]} */
  const agentRows = [];
  for (const b of order) {
    const asRule = b.fields.rule !== 'table' && b.nums.length > 0 && b.nums.every((n) => !held.has(n) && !coveredByAgent.has(n));
    const id = asRule ? `l${line.n}r${b.nums.join('_')}` : `l${line.n}a${agentRows.length + 1}`;
    // an [agent] row shows only a rule no rule row holds and no earlier [agent] row shows (F195's rule: never shown nowhere, never two rows); `row: 'agent'` is the tag's own typed field (src/sheetblock.js)
    const shown = asRule ? b.nums : b.fields.rule === 'table' ? [] : b.nums.filter((n) => !held.has(n) && !coveredByAgent.has(n));
    const check = { id, ...b.fields, ...(b.fields.rule === 'cells' ? { claim: id } : {}), covers: shown, ...(asRule ? {} : { row: 'agent' }) };
    if (asRule) { for (const n of b.nums) held.set(n, id); ruleRows.push({ check, covers: b.nums }); } else { for (const n of shown) coveredByAgent.set(n, id); agentRows.push({ check, covers: shown }); }
  }
  /** @type {RuleState[]} */
  const rows = rules.map((text, i) => {
    const n = i + 1;
    if (isColumnChoiceRule(text)) return { rule: n, text, state: 'column', reason: null, id: null };
    if (held.has(n)) return { rule: n, text, state: 'built', reason: null, id: /** @type {string} */ (held.get(n)) };
    if (coveredByAgent.has(n)) return { rule: n, text, state: 'agent-row', reason: null, id: /** @type {string} */ (coveredByAgent.get(n)) };
    return { rule: n, text, state: 'not-checked', reason: refusedFor.get(n) ?? NO_VALUE_WHY, id: null };
  });
  return { rows, ruleRows, agentRows, checks: [...ruleRows, ...agentRows].map((p) => p.check), refused };
}

// borrowed-from: bareloop src/sheetbuild.js@v0.60.0 (`buildSheetChecks`: the suggestions and the sheet lines in, one result per line out; the check block (`setSheet`) holds the rows. fwd's own `buildSheetChecks` rewrote a declaration's
// `close.sheet` per step; the declaration is now made from the block's rows by src/blockassemble.js)
/**
 * Build the checks of every sheet line from the reply's suggestions, each routed to its job line by its own `line`. Every sheet line in `lines` gets a result, a line with no suggestion included (its rules are
 * then Not checked with the no-pick sentence, never silently nothing). A suggestion that names no sheet line, or is not an object, is refused and listed with its helper.
 * @param {{lines: {n: number, text?: string, rules?: string[], guardrail?: string, rule?: string}[], tables: Record<string, {header: string[], rows: any[]}>, suggestions: any[]}} o
 * @returns {Promise<{built: Record<number, Awaited<ReturnType<typeof buildSheetLine>>>, checks: any[], notChecked: Record<string, string>, refused: {line: number|null, helper: string, why: string}[]}>}
 * `notChecked`: `line N: "rule"` -> the refusal that named it (or `NO_VALUE_WHY`), for each rule of a sheet line that no check holds
 */
export async function buildSheetChecks({ lines, tables, suggestions }) {
  /** @type {Record<number, Awaited<ReturnType<typeof buildSheetLine>>>} */
  const built = {};
  /** @type {Record<string, string>} */
  const notChecked = {};
  /** @type {{line: number|null, helper: string, why: string}[]} */
  const refused = [];
  /** @type {Map<number, any[]>} */
  const byLine = new Map(lines.map((l) => [l.n, []]));
  for (const s of suggestions) {
    if (!isRec(s)) { refused.push({ line: null, helper: 'schema', why: 'a suggestion is not an object' }); continue; }
    const mine = byLine.get(/** @type {number} */ (s.line));
    if (mine === undefined) { refused.push({ line: Number.isInteger(s.line) ? s.line : null, helper: 'line', why: `line ${String(s.line)} is not a sheet line` }); continue; }
    mine.push(s);
  }
  for (const line of lines) {
    const r = await buildSheetLine({ line, tables, suggestions: byLine.get(line.n) ?? [] });
    built[line.n] = r;
    for (const x of r.refused) refused.push({ line: line.n, ...x });
    for (const row of r.rows) if (row.state === 'not-checked') notChecked[`line ${line.n}: "${row.text}"`] = /** @type {string} */ (row.reason);
  }
  return { built, checks: lines.flatMap((l) => built[l.n].checks), notChecked, refused };
}

/**
 * M17 am5 / P5 (fwd's own, kept from the declaration-rewriting builder): the green steps that read a sheet and hold no check after the build (no suggestion, or none code could build), each with its rules as Not-checked lines
 * and the refusal that named each (else the no-pick sentence). What class such a step gets is the caller's to decide (src/blockassemble.js closeUnbuiltSheetSteps); this file writes no class.
 * @param {{declaration: any, lines: {n: number, text?: string, rules?: string[], guardrail?: string, rule?: string}[], roles: string[], notChecked: Record<string, string>}} o
 * @returns {{line: number, lost: string[]}[]}
 */
export function unbuiltSheetLines({ declaration, lines, roles, notChecked }) {
  /** @type {{line: number, lost: string[]}[]} */
  const unbuilt = [];
  for (const st of isRec(declaration) && Array.isArray(declaration.steps) ? declaration.steps : []) {
    if (!isRec(st) || !isRec(st.close) || st.close.class !== 'green' || (Array.isArray(st.close.sheet) && st.close.sheet.length > 0) || isRec(st.close.cited) || !Number.isInteger(st.fromLine)) continue;
    if (!Array.isArray(st.reads) || !st.reads.some((/** @type {string} */ r) => roles.includes(r)) || unbuilt.some((u) => u.line === st.fromLine)) continue;
    const line = lines.find((l) => l.n === st.fromLine);
    const rules = line ? rulesOfLine(line).filter((r) => !isColumnChoiceRule(r)) : [];
    if (rules.length === 0) continue;
    unbuilt.push({ line: st.fromLine, lost: rules.map((r) => `line ${st.fromLine}: "${r}" \u2014 ${notChecked[`line ${st.fromLine}: "${r}"`] ?? NO_VALUE_WHY}`) });
  }
  return unbuilt;
}
