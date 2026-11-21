// F242 candidate reader (M19 am6 to am9). Wraps reader2.mjs (F240, kept as it was); changes only what am8 and am9 change: the ledger rows, the Not checked list's members, order and words.
// borrowed-from: bareloop src/rubricstep.js@v0.61.0 (ruleNotCheckedItems, listRowName, DEFAULT_ROW_WORDS, refusedOf), src/draftspend.js@v0.61.0 (readDraftLedger), src/checklist.js@v0.61.0 (ledgerRecord)
import { checkRowsOfPlan as planRows } from './reader2.mjs';
import { rulesOfLine } from '../../src/sheetblock.js';
export { expectedParts } from './reader2.mjs';

const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const DEFAULT_ROW_WORDS = Object.freeze({ cited: 'every claim quotes its input', numbers: 'every number matches a quote', note: 'the note' });
const factKinds = new Set(['fact', 'phrase', 'count']);
/** am9 item 4: every not-checked list row but the floor, a ticket row (fwd draws those itself) and a fact line's default cited */
const isListed = (list, r) => isRec(r) && r.state === 'not-checked' && r.kind !== 'floor' && r.kind !== 'ticket' && !(r.kind === 'cited' && list.some((x) => x.line === r.line && factKinds.has(x.kind)));
const ruleTextOf = (lines, r) => (Number.isInteger(r.rule) ? rulesOfLine(lines.find((l) => l.n === r.line))[r.rule - 1] : undefined);

/** am8 item 1 + am9 item 5: one ledger row per listed row; a rule's words are its own text. */
export function ledgerRowsOf(declaration, lines, wordsByKey = {}) {
  const list = Array.isArray(declaration?.checkList) ? declaration.checkList : [];
  return list.filter((r) => isListed(list, r)).map((r) => ({ kind: 'ledger', phase: 'final', key: r.key, rowKind: r.kind, words: r.kind === 'rule' ? [ruleTextOf(lines, r) ?? ''] : wordsByKey[r.key] ?? [], state: 'not-checked' }));
}
/** am8 item 1: the last ledger row per key wins. */
export function readLedger(log) {
  const m = new Map();
  for (const r of Array.isArray(log) ? log : []) if (isRec(r) && r.kind === 'ledger' && typeof r.key === 'string') m.set(r.key, r);
  return m;
}
/** am8 item 2 as sharpened by am9 items 1 to 4 */
export function notCheckedName(r, ruleText, words) {
  const reason = r.reason ?? '';
  if (r.kind === 'rule') return ruleText !== undefined ? `line ${r.line}: "${ruleText}" — ${reason}` : `line ${r.line}: rule ${r.rule} — ${reason}`;
  if (r.kind === 'prose' || r.kind === 'stage') return `line ${r.line}: ${reason}`;
  if (r.kind in DEFAULT_ROW_WORDS) return DEFAULT_ROW_WORDS[r.kind];
  const tail = String(r.key).replace(/^L\d+\.(?:[^.]*\.)?/, '').trim();
  const w = Array.isArray(words) && words.length ? words : [tail || r.key];
  return `${r.kind} ${w.map((x) => `"${x}"`).join(', ')}`;
}
export function cardOfPlan({ declaration, lines, csvRoles = [], kept = [], log = [] }) {
  const led = readLedger(log);
  const list = Array.isArray(declaration?.checkList) ? declaration.checkList : [];
  const listed = list.filter((r) => isListed(list, r));
  const keys = new Set(listed.map((r) => r.key));
  const all = planRows({ declaration, lines, csvRoles, kept, ledger: [...led.values()].map((x) => ({ key: x.key, words: x.words })) });
  const rows = all.filter((r) => !(r.state === 'not-checked' && String(r.part).startsWith('nc:')) && !keys.has(r.key));
  const notChecked = listed.map((r) => ({ line: r.line, key: r.key, by: r.by, state: 'not-checked', kind: 'truth', reason: r.reason ?? null, part: `nc:${r.key}`, text: notCheckedName(r, ruleTextOf(lines, r), led.get(r.key)?.words) }));
  return { rows, notChecked };
}
