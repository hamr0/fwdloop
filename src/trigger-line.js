// M9 piece 3 (docs/wiki/the-module-ladder.md, "M9" item 1, am1): the trigger as typed data in the signed arbiter block.
// Pure text: the grammar of the one `guardrail: trigger ...` line. M9 am20: a schedule is its own signed file (src/schedule.js); NOTHING writes this line any more.
// The signed-text parser still accepts it so a job signed before am20 still reads and verifies, but nothing acts on it: such a job is By hand.
//
//   guardrail: trigger daily 09:00
//   guardrail: trigger weekdays 09:00
//   guardrail: trigger weekly mon 09:00
//   guardrail: trigger file-updated <role> = file:<path>
//   guardrail: trigger new-file <role> = file:<folder>
//
// No trigger line = By hand (`trigger: null`), so a job signed before M9 parses and hashes exactly as it did. Never cron text.
// Every regex is a fixed literal, anchored, with no nested quantifiers (signed-text.js's ReDoS rule).
import { createHash } from 'node:crypto';

import { validateSchedule } from './trigger-clock.js';

/** @typedef {import('./trigger-clock.js').Schedule} Schedule */
/** @typedef {Schedule | {kind:'file-updated', role:string, path:string} | {kind:'new-file', role:string, folder:string}} Trigger */

const LINE_RE = /^\s*guardrail:\s*trigger\b/i;
const CLOCK_RE = /^(daily|weekdays) (\d{2}):(\d{2})$/;
const WEEKLY_RE = /^weekly ([a-z]{3}) (\d{2}):(\d{2})$/;
const FILE_RE = /^(file-updated|new-file) ([a-z][a-z0-9_-]*) = file:(.*)$/;

/**
 * The text after `trigger ` on a guardrail line, as a typed trigger. Never throws.
 * @param {string} text
 * @returns {{ok: true, trigger: Trigger} | {ok: false, error: string}}
 */
export function parseTrigger(text) {
  const t = String(text).trim();
  const clock = CLOCK_RE.exec(t);
  const weekly = clock ? null : WEEKLY_RE.exec(t);
  const file = clock || weekly ? null : FILE_RE.exec(t);
  try {
    if (clock) return { ok: true, trigger: validateSchedule({ kind: clock[1], hour: Number(clock[2]), minute: Number(clock[3]) }) };
    if (weekly) return { ok: true, trigger: validateSchedule({ kind: 'weekly', day: weekly[1], hour: Number(weekly[2]), minute: Number(weekly[3]) }) };
  } catch (e) {
    return { ok: false, error: /** @type {Error} */ (e).message };
  }
  if (file) {
    const where = file[3].trim();
    if (where === '') return { ok: false, error: 'has an empty path' };
    return { ok: true, trigger: file[1] === 'new-file' ? { kind: 'new-file', role: file[2], folder: where } : { kind: 'file-updated', role: file[2], path: where } };
  }
  return { ok: false, error: `is not "daily HH:MM", "weekdays HH:MM", "weekly <day> HH:MM", "file-updated <role> = file:<path>" or "new-file <role> = file:<folder>": "${t}"` };
}

/** The signed-text line for a trigger. @param {Trigger} t */
export function triggerLine(t) {
  const hhmm = (/** @type {Schedule} */ s) => `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  if (t.kind === 'daily' || t.kind === 'weekdays') return `guardrail: trigger ${t.kind} ${hhmm(t)}`;
  if (t.kind === 'weekly') return `guardrail: trigger weekly ${t.day} ${hhmm(t)}`;
  if (t.kind === 'file-updated') return `guardrail: trigger file-updated ${t.role} = file:${t.path}`;
  const f = /** @type {{role: string, folder: string}} */ (t);
  return `guardrail: trigger new-file ${f.role} = file:${f.folder}`;
}

/** Is this signed-text line a trigger line (so the grammar sees it, and `stripTrigger` removes it)? @param {string} line */
export const isTriggerLine = (line) => LINE_RE.test(line);

/** The prose without any trigger line. Everything else is byte-for-byte what it was. @param {string} prose */
export function stripTrigger(prose) {
  return prose.split('\n').filter((l) => !LINE_RE.test(l)).join('\n');
}

/**
 * What the human's second click carries: binds the job, the exact signature it was shown at and the trigger.
 * @param {{flow: string, flowSignatureHash: string, trigger: Trigger|null, model?: {slot: string, model: string}|null, destination?: string|null, inputs?: {role: string, path: string}[]|null, plan?: {run: string, flowHash: string, declSha: string}|null}} a
 */
export function triggerHash({ flow, flowSignatureHash, trigger, model = null, destination = null, inputs = null, plan = null }) {
  // M6 am5 item 3: the scheduled model is part of what the click signs; absent = the exact bytes (and hashes) a trigger had before
  return createHash('sha256').update(JSON.stringify({ m9: 'trigger', flow, flowSignatureHash, trigger, ...(model ? { model } : {}), ...(destination ? { destination } : {}), ...(inputs ? { inputs } : {}), ...(plan ? { plan } : {}) })).digest('hex');
}

/** M9: the file a triggered start writes (once, before the spawn) into the run's own folder: why this run started. `appendHistory` copies it into the run's history row. */
export const TRIGGER_RECORD_FILE = 'trigger.json';
