// M17 am6 (docs/wiki/the-module-ladder.md): a Tickets `~` rule about which tickets to take ("priority P1 only") or what to watch ("run a ticket again when its state changes") is a ROW on the list.
// Its check is the job's `ticketFilter` or `ticketWatch`. The AI suggests the value as an edit of the row-edit turn (src/rowedit.js); code proves it with the declaration's own readers
// (src/declaration.js checkTicketFilter / checkTicketWatch) and writes the declaration's field from it, only when a rule of that kind is on the job. This file is the ONE writer of a ticket row,
// its signed fields, its card words and its proof. A job with no ticket rows (a plan signed before M17) is not examined: its filter and watch run exactly as signed.
// What this throws away: the filter's and watch's values (they stay in the declaration); a row keeps its line, rule number, tag, state and reason.
import { checkTicketFilter, checkTicketWatch, isCountGuardrail } from './declaration.js';
import { isRec } from './isrec.js';
import { REASON } from './reasons.js';

/** @type {readonly ('ticketFilter'|'ticketWatch')[]} */
export const TICKET_FIELDS = Object.freeze(['ticketFilter', 'ticketWatch']);

/**
 * Which signed field a Tickets rule is the check of: `ticketWatch` (a state or labels change), `ticketFilter` (a priority P0 to P3 or a label), or null (a content rule or a count).
 * @param {string} t the rule's words @returns {'ticketFilter'|'ticketWatch'|null}
 */
export function ticketRuleField(t) {
  if (isCountGuardrail(t)) return null;
  if (/\b(?:state|labels)\b[^;]*\bchange/i.test(t)) return 'ticketWatch';
  if (/\bp[0-3]\b/i.test(t) || /\blabel(?:l?ed|s)?\b/i.test(t)) return 'ticketFilter';
  return null;
}

/**
 * The reds of a suggested value, by the declaration's own readers (a stand-in declaration with an `mcp` block so only the value is judged). Empty = legal.
 * @param {'ticketFilter'|'ticketWatch'} field @param {unknown} value @returns {string[]}
 */
export function proposalReds(field, value) {
  /** @type {string[]} */
  const reds = [];
  const d = { mcp: {}, [field]: value };
  if (field === 'ticketFilter') checkTicketFilter(d, reds); else checkTicketWatch(d, reds);
  return reds;
}

/** the words a value is drawn with: the readout's own (src/authoring.js) @param {'ticketFilter'|'ticketWatch'} field @param {any} v */
export function ticketWords(field, v) {
  if (field === 'ticketWatch') return `ticket watch: ${(Array.isArray(v) ? v : []).join(', ')}`;
  const parts = [...(v?.priority?.length ? [`priority ${v.priority.join(', ')}`] : []), ...(v?.labels?.length ? [`labels ${v.labels.join(', ')}`] : [])];
  return `ticket filter: ${parts.join(' · ')}`;
}

/** the key of a ticket row @param {number} line @param {number} rule @param {string} field */
export const ticketRowKey = (line, rule, field) => `L${line}.ticket.${field}.${rule}`;

/**
 * The ticket rows of a Tickets declaration: one per `~` rule of a filter or watch kind. Built when the declaration holds that field; else Not checked (the person judges it at the Ask).
 * @param {{declaration: any, lines: {n: number, guardrail?: string|null}[]}} o `lines` = the signed lines (a line's `guardrail` is its `; `-joined `~` rules)
 * @returns {{signed: Record<string, any>[], card: {key: string, line: number, by: 'you', state: string, text: string, reason: string|null, drop: false}[], notChecked: {line: number, rule: string, reason: string}[]}}
 */
export function ticketRowsOf({ declaration, lines }) {
  /** @type {Record<string, any>[]} */ const signed = [];
  /** @type {any[]} */ const card = [];
  /** @type {{line: number, rule: string, reason: string}[]} */ const notChecked = [];
  if (!isRec(declaration) || declaration.flowType !== 'tickets') return { signed, card, notChecked };
  for (const l of lines) {
    const rules = typeof l.guardrail === 'string' ? l.guardrail.split('; ').map((s) => s.trim()).filter(Boolean) : [];
    rules.forEach((t, i) => {
      const field = ticketRuleField(t);
      if (field === null) return;
      const key = ticketRowKey(l.n, i + 1, field);
      const has = Object.hasOwn(declaration, field);
      signed.push({ line: l.n, key, from: 'rule', by: 'you', kind: 'ticket', state: has ? 'built' : 'not-checked', rule: i + 1, field, ...(has ? {} : { reason: REASON.noPick }) });
      card.push({ key, line: l.n, by: 'you', state: has ? 'built' : 'not-checked', text: has ? `"${t}" -> ${ticketWords(field, declaration[field])}` : `"${t}"`, reason: has ? null : REASON.noPick, drop: false });
      if (!has) notChecked.push({ line: l.n, rule: t, reason: REASON.noPick });
    });
  }
  return { signed, card, notChecked };
}

/**
 * The list of a declaration with its ticket rows after the block's rows. A declaration with none keeps its list exactly as it was.
 * @param {{declaration: any, lines: any[]}} o @returns {{declaration: any, tickets: ReturnType<typeof ticketRowsOf>}}
 */
export function withTicketRows({ declaration, lines }) {
  const base = Array.isArray(declaration.checkList) ? declaration.checkList.filter((/** @type {any} */ r) => !(isRec(r) && r.kind === 'ticket')) : undefined;
  const tickets = ticketRowsOf({ declaration, lines });
  if (tickets.signed.length === 0) return { declaration, tickets };
  return { declaration: { ...declaration, checkList: [...(base ?? []), ...tickets.signed] }, tickets };
}

/**
 * The proof of a plan whose list has ticket rows (a plan with none is not examined): a built ticket row needs the declaration's field, and a field the declaration holds needs a built row for it.
 * @param {any} declaration @returns {string[]}
 */
export function ticketListReds(declaration) {
  const list = isRec(declaration) && Array.isArray(declaration.checkList) ? declaration.checkList.filter((/** @type {any} */ r) => isRec(r) && r.kind === 'ticket') : [];
  if (list.length === 0) return [];
  /** @type {string[]} */
  const reds = [];
  for (const f of TICKET_FIELDS) {
    const built = list.some((/** @type {any} */ r) => r.field === f && r.state === 'built');
    const has = Object.hasOwn(declaration, f);
    if (built && !has) reds.push(`declaration: checkList: a row says "${f}" is its check, but the plan has no "${f}". Nothing was signed - draft again.`);
    if (has && !built) reds.push(`declaration: "${f}" is not the check of any rule on the list. Nothing was signed - draft again.`);
  }
  return reds;
}
