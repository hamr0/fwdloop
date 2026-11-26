import { isClockKind } from './trigger-clock.js';
import { isFileKind } from './trigger-files.js';

// M20 am5 item 1: the ONE list of schedule choices per flow type. The Run card's When and the New job card's Schedule both ask it (the page gets it from the server,
// `__FWDLOOP_SCHEDULE_CHOICES__`; the server's own card check asks `scheduleKindsOf`). The words are the Run card's.
// What a choice needs from the job (a file input for the two file kinds, a ticket list for a new ticket) is the card's own availability rule, not this list's.

/** @type {Record<string, string>} the Run card's words, one per kind */
const LABELS = Object.freeze({
  hand: 'By hand',
  daily: 'Every day at HH:MM',
  weekdays: 'Weekdays at HH:MM',
  weekly: 'Every <day> at HH:MM',
  'file-updated': 'When <file> is updated',
  'new-file': 'When a new file arrives in <folder>',
  'new-ticket': 'When a new ticket arrives in <input name>',
});

/** the New job card has no input box for a ticket list (the plan names the one list), so its word for that choice is the signed M13 item 7 one */
const NEW_CARD_LABELS = Object.freeze({ 'new-ticket': 'When a new ticket arrives' });

const PLAIN = Object.freeze(['hand', 'daily', 'weekdays', 'weekly', 'file-updated', 'new-file']);
const BY_TYPE = Object.freeze({
  plain: PLAIN,
  // a generic MCP job: By hand and every day only
  mcp: Object.freeze(['hand', 'daily']),
  // a Tickets MCP job: today's plain choices and a new ticket
  tickets: Object.freeze([...PLAIN, 'new-ticket']),
});

/** @param {unknown} flowType @returns {'plain'|'mcp'|'tickets'} */
const typeOf = (flowType) => (flowType === 'mcp' || flowType === 'tickets' ? flowType : 'plain');

/** the kinds a flow type offers, in the Run card's order @param {unknown} flowType @returns {string[]} */
export const scheduleKindsOf = (flowType) => [...BY_TYPE[typeOf(flowType)]];

/** the whole list as the page takes it: per flow type, `{kind, clock, file, label, newCardLabel}` (clock, file: the one answers of isClockKind and isFileKind) @returns {Record<string, {kind: string, clock: boolean, file: boolean, label: string, newCardLabel: string}[]>} */
export function scheduleChoices() {
  return Object.fromEntries(Object.entries(BY_TYPE).map(([type, kinds]) => [type, kinds.map((kind) => ({ kind, clock: isClockKind(kind), file: isFileKind(kind), label: LABELS[kind], newCardLabel: NEW_CARD_LABELS[kind] ?? LABELS[kind] }))]));
}
