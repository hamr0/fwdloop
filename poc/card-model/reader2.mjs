// F240 candidate reader (M19 am6 + am7 words); derived from reader.mjs (F239, kept as it was). F239 candidate reader (POC only, lives in poc/, imports src read-only). M19 am6: the card's check rows read from the signed plan, never from row copies.
// Shape follows bareloop v0.61.0 src/rubricstep.js checksOfClose (:1177): one row per signed check part, words from fwd's own sentence writers, tag and key from the signed checkList row that built the part.
// borrowed-from: bareloop src/rubricstep.js@v0.61.0 (checksOfClose, shape of the walk; the words are fwd's own writers)
import { factSentence, countSentence } from '../../src/citedcheck.js';
import { plainWords } from '../../src/checkwords.js';
import { closePartsOf, cardLinesOf } from '../../src/checklistsign.js';
import { CARD_T } from '../../src/checkblock.js';
import { sheetRowsOf } from '../../src/sheetrows.js';
import { ticketRowsOf } from '../../src/ticketrows.js';
import { shapeRowsOf } from '../../src/shaperows.js';
import { kindOfCheck } from '../../src/checklook.js';
import { rulesOfLine } from '../../src/sheetblock.js';
import { KEPT_WORDS } from '../../src/pickrecord.js';
import { FLOOR_WORDS, FLOOR_LIST_WORDS } from './reader.mjs';
export { expectedParts } from './reader.mjs';

const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);


/**
 * @param {{declaration: any, lines: {n: number, text?: string, guardrail?: string}[], csvRoles?: string[], kept?: {line: number, check: any}[], ledger?: {key: string, words: string[]}[]}} o
 * @returns {{line: number, key: string, by: string, state: string, kind: string, text: string, reason: string|null, part: string}[]}
 */
export function checkRowsOfPlan({ declaration, lines, csvRoles = [], kept = [], ledger = [] }) {
  const list = Array.isArray(declaration?.checkList) ? declaration.checkList.filter(isRec) : [];
  const steps = Array.isArray(declaration?.steps) ? declaration.steps.filter(isRec) : [];
  const out = [];
  const builtOn = (line) => list.filter((r) => r.line === line && r.state === 'built' && r.kind !== 'floor');
  const ruleText = (line, n) => rulesOfLine(lines.find((l) => l.n === line))[n - 1];
  const owner = (rows) => rows.find((r) => r.by === 'you') ?? rows[0] ?? null; // am7 item 5: the first [you] row
  const cardLines = cardLinesOf(declaration);
  const seenLine = new Set();
  const offsets = new Map();
  for (const st of steps) {
    const line = st.fromLine;
    if (!Number.isInteger(line) || !cardLines.has(line)) continue;
    const close = isRec(st.close) ? st.close : {};
    let idx = offsets.get(line) ?? 0;
    seenLine.add(line);
    if (isRec(close.cited)) {
      const c = close.cited;
      for (const f of Array.isArray(c.facts) ? c.facts : []) {
        const own = owner(builtOn(line).filter((r) => Array.isArray(r.facts) && r.facts.includes(f.name)));
        out.push({ line, key: own?.key ?? `L${line}.fact.${f.name}`, by: own?.by ?? 'agent', state: 'built', kind: 'truth', text: factSentence(f, c.source), reason: null, part: `L${line}:fact:${f.name}` });
      }
      const cs = countSentence(c);
      if (cs) {
        const own = builtOn(line).find((r) => r.kind === 'count');
        out.push({ line, key: own?.key ?? `L${line}.count`, by: own?.by ?? 'agent', state: 'built', kind: 'truth', text: cs, reason: null, part: `L${line}:count` });
      }
      idx += 1;
    }
    if (isRec(close.itemShape)) {
      const shim = { stages: [{ kind: 'rubric-step', params: { step: line, parts: [{ ...close.itemShape, class: 'shape' }] } }] };
      for (const x of shapeRowsOf(shim, lines.map((l) => ({ n: l.n, text: l.text, rules: rulesOfLine(l) })))) {
        const signed = list.find((r) => r.key === x.key);
        if (x.by === 'default' && !signed) continue;
        const text = x.text; // am7 item 1
        out.push({ line, key: x.key, by: signed?.by ?? x.by, state: 'built', kind: kindOfCheck({ key: x.key, shape: true }), text, reason: null, part: `L${line}:shape:${x.name ?? '$'}` });
      }
      idx += 1;
    }
    const picked = Array.isArray(close.picked) ? close.picked : isRec(close.shape) && Array.isArray(close.shape.picked) ? close.shape.picked : [];
    for (const c of picked) {
      const own = owner(builtOn(line).filter((r) => isRec(r.part) && r.part.part === idx));
      const isKept = kept.some((k) => k.line === line && isRec(k.check) && plainWords(k.check) === plainWords(c));
      out.push({ line, key: own?.key ?? `L${line}.pick.${idx}`, by: own?.by ?? 'agent', state: 'built', kind: 'truth', text: `${plainWords(c)}${isKept ? ` · ${KEPT_WORDS}` : ''}`, reason: null, part: `L${line}:pick:${idx}` });
      idx += 1;
    }
    if (Array.isArray(close.numbersFrom) && close.numbersFrom.length > 0) {
      const own = owner(builtOn(line).filter((r) => r.kind === 'numbers' || (isRec(r.part) && r.part.part === idx)));
      out.push({ line, key: own?.key ?? `L${line}.$numbers`, by: own?.by ?? 'default', state: 'built', kind: 'truth', text: `every number in the text is in a quote checked on line ${close.numbersFrom.join(', ')}`, reason: null, part: `L${line}:numbers` });
      idx += 1;
    }
    offsets.set(line, idx);
  }
  // sheet and ticket rows: fwd's own readers (item 5), `lines` as the signed text gives them
  const sheet = sheetRowsOf({ declaration: { ...declaration, checkList: undefined }, lines, csvRoles });
  for (const r of sheet.card) out.push({ line: r.line, key: r.key, by: r.by, state: r.state, kind: 'truth', text: r.text, reason: r.reason, part: `${r.key}` });
  const tk = ticketRowsOf({ declaration, lines });
  for (const r of tk.card) if (list.some((x) => x.key === r.key)) out.push({ line: r.line, key: r.key, by: r.by, state: r.state, kind: 'truth', text: r.text, reason: r.reason, part: `${r.key}` });
  // the signed rows with no part: the floor, and Not checked (a rule reads its job line, a fact its key)
  for (const r of list) {
    if (r.kind === 'floor') {
      const on = steps.filter((s) => s.fromLine === r.line).map((s) => s.close ?? {});
      const listLine = on.some((c) => isRec(c.itemShape)) && !on.some((c) => isRec(c.cited)) && !on.some((c) => (Array.isArray(c.picked) && c.picked.length) || (Array.isArray(c.shape?.picked) && c.shape.picked.length) || (Array.isArray(c.numbersFrom) && c.numbersFrom.length));
      out.push({ line: r.line, key: r.key, by: r.by, state: 'built', kind: kindOfCheck({ key: r.key }), text: listLine ? FLOOR_LIST_WORDS : FLOOR_WORDS, reason: null, part: `${r.key}` });
    } else if (r.state === 'not-checked' && r.kind !== 'sheet' && r.kind !== 'ticket') {
      const tail = String(r.key).split('.').slice(2).join('.');
      const said = ledger.find((x) => x.key === r.key)?.words?.[0]; // am7 item 6: the draft's own words, the key tail only as the fallback
      const text = r.kind === 'rule' && Number.isInteger(r.rule) ? `"${ruleText(r.line, r.rule)}"` : `${r.kind} "${said ?? tail}"`;
      out.push({ line: r.line, key: r.key, by: r.by, state: 'not-checked', kind: 'truth', text, reason: r.reason ?? null, part: `nc:${r.key}` });
    }
  }
  // am7 item 4: sheet; facts, count; shape; picks; defaults (cited, numbers); floor last. A Ticket row sits after the sheet, a Not checked row after the floor (neither is ranked by the bar).
  const rank = (r) => (/\.sheet\./.test(r.key) ? 0 : /\.ticket\./.test(r.key) ? 0.5 : r.state === 'not-checked' ? 9 : /:fact:/.test(r.part) ? 1 : /:count$/.test(r.part) ? 2 : /:shape:/.test(r.part) ? 3 : /:pick:/.test(r.part) ? 4 : /:numbers$/.test(r.part) ? 5 : /\$floor$/.test(r.key) ? 6 : 4.5);
  return out.map((r, i) => ({ ...r, rank: rank(r), i })).sort((a, b) => a.line - b.line || a.rank - b.rank || a.i - b.i);
}

