// F241 candidate reader (M19 am6 + am7 + am8). Wraps reader2.mjs (F240, kept as it was); changes only what am8 changes:
// item 1 the draft's ledger rows (write + read, last row per key wins), item 2 the Not checked name, item 3 Not checked rows in their own list, item 4 Tickets rows never after the floor.
// borrowed-from: bareloop src/rubricstep.js@v0.61.0 (listRowName shape, ruleNotCheckedItems), src/draftspend.js@v0.61.0 (readDraftLedger: last row per key wins)
import { checkRowsOfPlan as planRows } from './reader2.mjs';
import { rulesOfLine } from '../../src/sheetblock.js';
export { expectedParts } from './reader2.mjs';

const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNC = (r) => isRec(r) && r.state === 'not-checked' && r.kind !== 'sheet' && r.kind !== 'ticket';

/** am8 item 1, write side: one ledger row per signed Not checked row. @param {any} declaration @param {Record<string, string[]>} wordsByKey */
export function ledgerRowsOf(declaration, wordsByKey = {}) {
  return (Array.isArray(declaration?.checkList) ? declaration.checkList : []).filter(isNC).map((r) => ({ kind: 'ledger', phase: 'final', key: r.key, rowKind: r.kind, words: wordsByKey[r.key] ?? [], state: 'not-checked' }));
}
/** am8 item 1, read side: the last ledger row per key wins. @param {any[]} log @returns {Map<string, any>} */
export function readLedger(log) {
  const m = new Map();
  for (const r of Array.isArray(log) ? log : []) if (isRec(r) && r.kind === 'ledger' && typeof r.key === 'string') m.set(r.key, r);
  return m;
}
/** am8 item 2. @param {any} r the signed row @param {string|undefined} ruleText @param {string[]|undefined} words */
export function notCheckedName(r, ruleText, words) {
  if (r.kind === 'rule' && ruleText !== undefined) return ruleText;
  if (r.kind === 'prose') return `line ${r.line}: ${r.reason ?? ''}`;
  const tail = String(r.key).replace(/^L\d+\.(?:[^.]*\.)?/, '').trim();
  const w = Array.isArray(words) && words.length ? words : [tail || r.key];
  return `${r.kind} ${w.map((x) => `"${x}"`).join(', ')}`;
}
/**
 * @param {{declaration: any, lines: any[], csvRoles?: string[], kept?: any[], log?: any[]}} o `log` = the draft's own `log.json` `log` list (the ledger rows are read from it)
 * @returns {{rows: any[], notChecked: any[]}}
 */
export function cardOfPlan({ declaration, lines, csvRoles = [], kept = [], log = [] }) {
  const led = readLedger(log);
  const all = planRows({ declaration, lines, csvRoles, kept, ledger: [...led.values()].map((x) => ({ key: x.key, words: x.words })) });
  const rows = all.filter((r) => !(r.state === 'not-checked' && String(r.part).startsWith('nc:')));
  const list = Array.isArray(declaration?.checkList) ? declaration.checkList : [];
  const notChecked = list.filter(isNC).map((r) => ({
    line: r.line, key: r.key, by: r.by, state: 'not-checked', kind: 'truth', reason: r.reason ?? null, part: `nc:${r.key}`,
    text: notCheckedName(r, Number.isInteger(r.rule) ? rulesOfLine(lines.find((l) => l.n === r.line))[r.rule - 1] : undefined, led.get(r.key)?.words),
  }));
  return { rows, notChecked };
}
