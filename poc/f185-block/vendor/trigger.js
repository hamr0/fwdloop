// borrowed-from: bareloop src/trigger.js@v0.56.0 (3383cce)
// T Part 3 (docs/product/PANEL-BUILD.md, "T: triggers build spec", C.3): the `trigger` field of a signed spec,
// as typed data. Pure. Never cron text, never a model's word: the agent does not write this field (assembleSpec
// refuses a draft carrying it) and the interview never does either. By hand = the key is ABSENT (never null),
// so a by-hand spec hashes exactly as it did before triggers existed.
//   {kind:'daily'|'weekdays', hour, minute}
//   {kind:'weekly', day:'mon'..'sun', hour, minute}
//   {kind:'new-file', folder}        absolute path
//   {kind:'file-updated', path}      absolute path
//   {kind:'new-ticket', input}       the LABEL of the job's ticket-list Inputs line (MCP + tickets piece 3); the server, list address and look tool are
//                                    read from the signed spec (`mcp`, `inputs`, `ticketWatch`), never stored here
// Rewritten from fwdloop src/trigger-line.js (its prose-line grammar is replaced: the signed thing is the JSON spec).
import { isAbsolute } from 'node:path';
import { validateSchedule } from './triggerclock.js';

/** @typedef {import('./triggerclock.js').Schedule | {kind:'new-file', folder:string} | {kind:'file-updated', path:string} | {kind:'new-ticket', input:string}} Trigger */

export const TRIGGER_KINDS = Object.freeze(['daily', 'weekdays', 'weekly', 'new-file', 'file-updated', 'new-ticket']);
export const CLOCK_KINDS = Object.freeze(['daily', 'weekdays', 'weekly']);
export const FILE_KINDS = Object.freeze(['new-file', 'file-updated']);
export const TICKET_KINDS = Object.freeze(['new-ticket']);

/** @param {unknown} t @returns {t is {kind:'daily'|'weekdays'|'weekly', hour:number, minute:number}} */
export const isClockTrigger = (t) => !!t && typeof t === 'object' && CLOCK_KINDS.includes(/** @type {any} */ (t).kind);
/** @param {unknown} t @returns {t is {kind:'new-file', folder:string} | {kind:'file-updated', path:string}} */
export const isFileTrigger = (t) => !!t && typeof t === 'object' && FILE_KINDS.includes(/** @type {any} */ (t).kind);
/** @param {unknown} t @returns {t is {kind:'new-ticket', input:string}} */
export const isTicketTrigger = (t) => !!t && typeof t === 'object' && TICKET_KINDS.includes(/** @type {any} */ (t).kind);

/**
 * The only way a trigger enters the system. Returns the typed trigger, or says what to fix (and which field).
 * @param {unknown} t
 * @returns {{ok: true, trigger: Trigger} | {ok: false, say: string, code: 'invalid-value'|'unknown-field', path: string}}
 */
export function validateTrigger(t) {
  /** @param {string} say @param {string} [path] @param {'invalid-value'|'unknown-field'} [code] */
  const no = (say, path = 'trigger', code = 'invalid-value') => ({ ok: /** @type {const} */ (false), say, code, path });
  if (!t || typeof t !== 'object' || Array.isArray(t)) return no('a trigger is an object like {kind, hour, minute}, not text');
  const o = /** @type {Record<string, unknown>} */ (t);
  if (!TRIGGER_KINDS.includes(/** @type {string} */ (o.kind))) return no(`trigger kind "${o.kind}" is not one of ${TRIGGER_KINDS.join(', ')}`, 'trigger.kind');
  if (CLOCK_KINDS.includes(/** @type {string} */ (o.kind))) {
    const allowed = o.kind === 'weekly' ? ['kind', 'day', 'hour', 'minute'] : ['kind', 'hour', 'minute'];
    const extra = Object.keys(o).find((k) => !allowed.includes(k));
    if (extra !== undefined) return no(`trigger field "${extra}" is not allowed on a ${o.kind} trigger`, `trigger.${extra}`, 'unknown-field');
    try { return { ok: true, trigger: validateSchedule(o) }; } catch (e) { return no(/** @type {Error} */ (e).message.replace(/^schedule/, 'trigger')); }
  }
  if (o.kind === 'new-ticket') {
    const stray = Object.keys(o).find((k) => k !== 'kind' && k !== 'input');
    if (stray !== undefined) return no(`trigger field "${stray}" is not allowed on a new-ticket trigger (it takes an input)`, `trigger.${stray}`, 'unknown-field');
    // eslint-disable-next-line no-control-regex
    if (typeof o.input !== 'string' || o.input.trim() === '' || /[\x00-\x1f\x7f]/.test(o.input)) return no('the input must be the name of a ticket list in the job\'s Inputs, on one line, like issues', 'trigger.input');
    return { ok: true, trigger: { kind: 'new-ticket', input: o.input } };
  }
  const where = o.kind === 'new-file' ? 'folder' : 'path';
  const extra = Object.keys(o).find((k) => k !== 'kind' && k !== where);
  if (extra !== undefined) return no(`trigger field "${extra}" is not allowed on a ${o.kind} trigger (it takes a ${where})`, `trigger.${extra}`, 'unknown-field');
  const p = o[where];
  // eslint-disable-next-line no-control-regex
  if (typeof p !== 'string' || p === '' || !isAbsolute(p) || /[\x00-\x1f\x7f]/.test(p)) return no(`the ${where} must be a full path on one line, like /home/you/inbox`, `trigger.${where}`);
  return { ok: true, trigger: /** @type {Trigger} */ (o.kind === 'new-file' ? { kind: 'new-file', folder: p } : { kind: 'file-updated', path: p }) };
}
