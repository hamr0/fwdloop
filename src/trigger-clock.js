// M9 piece 1 (docs/wiki/the-module-ladder.md, "M9" items 1 and 3, amendment 2 item 1): the clock trigger.
// Pure schedule maths plus an append-only ledger. Proven first in poc/m9 (ported, not imported).
//
// A schedule is a typed object, never cron text:
//   { kind:'daily', hour, minute } | { kind:'weekdays', hour, minute } | { kind:'weekly', day:'mon'|..., hour, minute }
// Times are LOCAL. One slot per calendar day at most (built with the local Date constructor), so a DST
// change day can neither lose nor double a slot: a 02:30 that does not exist shifts to 03:30, one that
// happens twice is the first.
//
// Ledger: append-only JSONL, write-once rows keyed by `id`, re-read from disk every time (no process state).
//   { id:'armed:<ms>', kind:'armed', at }                       the trigger was set: the starting point
//   { id:'fire:<slotMs>', kind:'fire', slot, at, catchUp, missed } one run started for that slot
// Starting a run is NOT this file; the caller does it after `recordFire`.
import {
  appendFileSync, existsSync, mkdirSync, readFileSync,
} from 'node:fs';
import { dirname } from 'node:path';

/** @typedef {{kind:'daily'|'weekdays', hour:number, minute:number} | {kind:'weekly', day:string, hour:number, minute:number}} Schedule */
/** @typedef {{id:string, kind:'armed'|'fire', at:number, slot?:number, catchUp?:boolean, missed?:number}} ClockRow */
/** @typedef {{fire:boolean, catchUp:boolean, missed:number, slot?:number}} Due */

/** A slot seen MORE than this after its set time is a catch-up (M9 am2 item 1). Exactly this late is on time. */
export const GRACE_MS = 120_000;

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

/**
 * The only way a schedule enters the system. Refuses anything else, naming the field.
 * @param {unknown} s
 * @returns {Schedule}
 */
export function validateSchedule(s) {
  if (!s || typeof s !== 'object' || Array.isArray(s)) throw new Error('schedule must be an object like { kind, hour, minute }, not text');
  const o = /** @type {Record<string, unknown>} */ (s);
  const kinds = ['daily', 'weekdays', 'weekly'];
  if (!kinds.includes(/** @type {string} */ (o.kind))) throw new Error(`schedule kind "${o.kind}" is not one of ${kinds.join(', ')}`);
  const allowed = o.kind === 'weekly' ? ['kind', 'day', 'hour', 'minute'] : ['kind', 'hour', 'minute'];
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Error(`schedule field "${k}" is not allowed on a ${o.kind} schedule`);
  const hour = o.hour; const minute = o.minute;
  if (!Number.isInteger(hour) || /** @type {number} */ (hour) < 0 || /** @type {number} */ (hour) > 23) throw new Error('schedule hour must be a whole number 0-23');
  if (!Number.isInteger(minute) || /** @type {number} */ (minute) < 0 || /** @type {number} */ (minute) > 59) throw new Error('schedule minute must be a whole number 0-59');
  if (o.kind === 'weekly') {
    if (typeof o.day !== 'string' || !DAYS.includes(o.day)) throw new Error(`schedule day must be one of ${DAYS.join(', ')}`);
    return { kind: 'weekly', day: o.day, hour: /** @type {number} */ (hour), minute: /** @type {number} */ (minute) };
  }
  return { kind: /** @type {'daily'|'weekdays'} */ (o.kind), hour: /** @type {number} */ (hour), minute: /** @type {number} */ (minute) };
}

/**
 * Slots (epoch ms) in (afterMs, untilMs], oldest first.
 * @param {Schedule} sc
 * @param {number} afterMs
 * @param {number} untilMs
 * @returns {number[]}
 */
function slotsBetween(sc, afterMs, untilMs) {
  const out = [];
  const s = new Date(afterMs);
  for (let i = 0; ; i++) {
    const d = new Date(s.getFullYear(), s.getMonth(), s.getDate() + i);
    if (d.getTime() > untilMs) break;
    const dow = d.getDay();
    const ok = sc.kind === 'daily'
      || (sc.kind === 'weekdays' && dow >= 1 && dow <= 5)
      || (sc.kind === 'weekly' && dow === DAYS.indexOf(/** @type {{day:string}} */ (sc).day));
    if (!ok) continue;
    const slot = new Date(d.getFullYear(), d.getMonth(), d.getDate(), sc.hour, sc.minute).getTime();
    if (slot > afterMs && slot <= untilMs) out.push(slot);
  }
  return out;
}

/**
 * The starting point: the latest of the arm time(s) and every recorded fire slot. No arm row = null.
 * @param {ClockRow[]} rows
 */
function lastPoint(rows) {
  let armed = false; let last = -Infinity;
  for (const r of rows) {
    if (r.kind === 'armed') { armed = true; last = Math.max(last, r.at); } else if (r.kind === 'fire') last = Math.max(last, /** @type {number} */ (r.slot));
  }
  return armed ? last : null;
}

/**
 * Is a run due at `now`? Slots missed (panel off) collapse to ONE fire, for the latest slot, marked catch-up.
 * Catch-up = more than one slot was missed, or the latest slot is more than GRACE_MS old.
 * @param {Schedule} schedule
 * @param {ClockRow[]} rows
 * @param {number} now epoch ms
 * @returns {Due}
 */
export function due(schedule, rows, now) {
  const last = lastPoint(rows);
  if (last === null) return { fire: false, catchUp: false, missed: 0 };
  const slots = slotsBetween(validateSchedule(schedule), last, now);
  if (!slots.length) return { fire: false, catchUp: false, missed: 0 };
  const slot = slots[slots.length - 1];
  const catchUp = slots.length > 1 || now - slot > GRACE_MS;
  return { fire: true, catchUp, missed: catchUp ? slots.length : 0, slot };
}

/**
 * The next slot time strictly after `afterMs` (epoch ms). Words ("Next run Mon 13 Oct, 09:00.") are the caller's.
 * @param {Schedule} schedule
 * @param {number} afterMs
 * @returns {number}
 */
export function nextSlot(schedule, afterMs) {
  const sc = validateSchedule(schedule);
  // a week plus a day always holds a slot of any kind
  const found = slotsBetween(sc, afterMs, afterMs + 9 * 86_400_000)[0];
  return /** @type {number} */ (found);
}

/** The ledgers' one line reader: a line that does not parse (a torn append after a crash) is skipped, as `readOutcomes` does; the ledger is never rewritten. @param {string} text @returns {any[]} */
export const parseJsonl = (text) => text.split('\n').filter(Boolean).flatMap((l) => { try { return [JSON.parse(l)]; } catch { return []; } });

/** @param {string} file @returns {ClockRow[]} every row on disk, oldest first; a missing file is no rows. */
export function readRows(file) {
  if (!existsSync(file)) return [];
  return parseJsonl(readFileSync(file, 'utf8'));
}

/** The ledgers' one appender: a crash mid-append leaves a line with no newline, so the next row starts on a fresh line and is never glued to the fragment (a glued `ran` row would be skipped and the file would run twice). @param {string} file @param {object} row */
export function appendRow(file, row) {
  const text = existsSync(file) ? readFileSync(file, 'utf8') : '';
  appendFileSync(file, `${text !== '' && !text.endsWith('\n') ? '\n' : ''}${JSON.stringify(row)}\n`);
}

/** Append one row; a row whose id is already on disk is refused (write-once). @param {string} file @param {ClockRow} row */
function appendOnce(file, row) {
  if (readRows(file).some((r) => r.id === row.id)) throw new Error(`ledger row ${row.id} already written`);
  mkdirSync(dirname(file), { recursive: true });
  appendRow(file, row);
}

/** The trigger was set at `now`: no slot before this ever fires. @param {string} file @param {number} now */
export function armTrigger(file, now) {
  appendOnce(file, { id: `armed:${now}`, kind: 'armed', at: now });
}

/**
 * Record that the run for this due slot is starting. Call BEFORE starting the run: a crash loses a run, never doubles one.
 * @param {string} file @param {Due} d the result of `due` with fire true @param {number} now
 */
export function recordFire(file, d, now) {
  if (!d.fire || d.slot === undefined) throw new Error('recordFire needs a due result with fire true');
  appendOnce(file, { id: `fire:${d.slot}`, kind: 'fire', slot: d.slot, at: now, catchUp: d.catchUp, missed: d.missed });
}
