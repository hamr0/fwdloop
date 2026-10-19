// M9 amendment 20 (docs/wiki/the-module-ladder.md, SIGNED 2026-10-16): a job's schedule lives in its OWN signed file, `<flow>/schedule.json`,
// and its queue in ONE file, `<flow>/schedule-ledger.jsonl`, for as long as the job exists. Setting, changing or cancelling a schedule never
// touches the job or its signature (prose.txt, declaration.json, signature.json are not opened here).
//
// borrowed-from: bareloop src/panel/schedules.js@73809db (readSchedule / writeSchedule / dropQueue / sameTarget / removeSchedule), adapted:
// fwdloop keeps a job's fire OUTCOMES in `triggers.jsonl` (the Audit's words are built from it), so this file's ledger holds only the clock and file rows.
//
// ONE WRITER PER FIELD: `writeSchedule` is the only function that writes `schedule.json` (temp + rename: a reader sees the old file or the new one,
// never half); `removeSchedule` the only one that removes it. `dropQueue` / `carryQueue` are the only places a waiting file leaves a queue because
// the schedule changed. The signing id (`sig`) is `sha256(bound + signedAt)`: the same schedule signed again after a Cancel is a NEW signing, so rows
// of the earlier one can never carry over. Every ledger row carries the `sig` that wrote it; "since this signing" is a filter on `sig`.
import { createHash } from 'node:crypto';
import { renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';

import { readFileInside } from './flow.js';
import { appendRow } from './jsonl-append.js';
import { queueOf, readSeen, recordDropped } from './trigger-files.js';
import { readRows, validateSchedule } from './trigger-clock.js';
import { triggerHash } from './trigger-line.js';

/** @typedef {import('./trigger-line.js').Trigger} Trigger */
/**
 * @typedef {{
 *   v: 1, flow: string, trigger: Trigger, flowSignatureHash: string, bound: string, sig: string, signedBy: string, signedAt: string,
 *   model: {slot: string, model: string}|null, destination: string|null, inputs: {role: string, path: string}[]|null,
 *   plan: {run: string, flowHash: string, declSha: string}|null, from: string|null,
 * }} Schedule
 */

const SCHEDULE_FILE = 'schedule.json';
const LEDGER_FILE = 'schedule-ledger.jsonl';
/** The words of the am16 row (also for a Cancel): signed text, M9 am16. @param {string} name */
const droppedSay = (name) => `${name} was waiting when the schedule changed, so it will not run. Drop it in again to run it.`;

/** @param {string} flowDir */
export const scheduleFileOf = (flowDir) => join(flowDir, SCHEDULE_FILE);
/** @param {string} flowDir */
export const ledgerOf = (flowDir) => join(flowDir, LEDGER_FILE);

/** @param {string} bound @param {string} signedAt */
export const sigOf = (bound, signedAt) => createHash('sha256').update(`${bound}\n${signedAt}`).digest('hex');

const isFile = (/** @type {any} */ t) => t?.kind === 'new-file' || t?.kind === 'file-updated';
const str = (/** @type {unknown} */ v) => typeof v === 'string' && v !== '';

/** Is this a typed trigger of the five shapes? (the same shapes `trigger-line.js` parses; the schedule file never carries a line) @param {any} t */
function triggerOk(t) {
  if (!t || typeof t !== 'object') return false;
  if (isFile(t)) return str(t.role) && isAbsolute(String(t.kind === 'new-file' ? t.folder : t.path));
  try { validateSchedule(t); return true; } catch { return false; }
}

/**
 * The job's schedule, or null (no file, unreadable, not the shape, or a file whose own hashes do not check: it was changed after it was signed, so it
 * is not the schedule a human signed and nothing acts on it). Read through the safe gateway.
 * @param {string} flowDir @returns {Schedule|null}
 */
export function readSchedule(flowDir) {
  const f = readFileInside(flowDir, SCHEDULE_FILE);
  if (!f.ok) return null;
  let o;
  try { o = JSON.parse(f.text); } catch { return null; }
  if (!o || typeof o !== 'object' || o.v !== 1 || !str(o.flow) || !triggerOk(o.trigger) || !str(o.flowSignatureHash) || !str(o.bound) || !str(o.sig) || !str(o.signedBy) || !str(o.signedAt)) return null;
  const optStr = (/** @type {unknown} */ v) => v === null || str(v);
  if (!optStr(o.destination) || !optStr(o.from)) return null;
  if (o.model !== null && !(o.model && str(o.model.slot) && str(o.model.model))) return null;
  if (o.inputs !== null && !(Array.isArray(o.inputs) && o.inputs.every((/** @type {any} */ r) => str(r?.role) && str(r?.path)))) return null;
  if (o.plan !== null && !(o.plan && str(o.plan.run) && str(o.plan.flowHash) && str(o.plan.declSha))) return null;
  const want = triggerHash({
    flow: o.flow, flowSignatureHash: o.flowSignatureHash, trigger: o.trigger, model: o.model, destination: o.destination, inputs: o.inputs, plan: o.plan,
  });
  if (want !== o.bound || sigOf(o.bound, o.signedAt) !== o.sig) return null;
  return /** @type {Schedule} */ (o);
}

/** THE writer of `schedule.json`: atomic (temp file, then rename). @param {string} flowDir @param {Schedule} schedule */
export function writeSchedule(flowDir, schedule) {
  const file = scheduleFileOf(flowDir);
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(schedule, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/** The only remover of `schedule.json`. @param {string} flowDir */
export function removeSchedule(flowDir) {
  rmSync(scheduleFileOf(flowDir), { force: true });
}

/** Does a re-sign keep the same kind and the same folder/file (so the queue and the baseline stand)? @param {Trigger|null|undefined} cur @param {Trigger|null} next */
export function sameTarget(cur, next) {
  if (!cur || !next || !isFile(cur) || !isFile(next) || cur.kind !== next.kind) return false;
  return cur.kind === 'new-file' ? cur.folder === /** @type {any} */ (next).folder : /** @type {any} */ (cur).path === /** @type {any} */ (next).path;
}

/** Is this signing armed (its `armed` row is in the ledger)? @param {string} flowDir @param {string} sig */
export const isArmed = (flowDir, sig) => readRows(ledgerOf(flowDir), sig).some((r) => r.kind === 'armed');

/**
 * Every file waiting under signing `sig` leaves its queue: one `dropped` row (under `sig`) and ONE row in the outcome file with am16's words. The drop is written
 * BEFORE the row: a crash loses a row, never doubles one. @param {string} flowDir @param {string} sig
 * @param {number} nowMs @param {(row: Record<string, any>) => void} note writes one outcome row
 */
export function dropQueue(flowDir, sig, nowMs, note) {
  const ledger = ledgerOf(flowDir);
  for (const q of queueOf(readSeen(ledger, sig))) {
    recordDropped(ledger, q, 'schedule-changed', nowMs, sig);
    note({ outcome: 'schedule-changed', file: q.path, sha: q.sha, say: droppedSay(q.name) });
  }
}

/**
 * The folder is the same: signing `to` takes over everything `from` knew about the files (baseline, arrived, ran, dropped, in order), so the queue and
 * the starting point stand. Written BEFORE the new `schedule.json`; the old signing's waiting files are marked `carried` after it (`finishCarry`).
 * @param {string} flowDir @param {string} from @param {string} to
 */
export function carryQueue(flowDir, from, to) {
  const ledger = ledgerOf(flowDir);
  for (const r of readSeen(ledger, from)) {
    if (!['baseline', 'arrived', 'ran', 'dropped'].includes(r.kind)) continue;
    const { sig: _old, ...row } = r;
    appendRow(ledger, { ...row, sig: to });
  }
}

/** The old signing's files that `carryQueue` copied are no longer its own to run. @param {string} flowDir @param {string} from @param {number} nowMs */
export function finishCarry(flowDir, from, nowMs) {
  const ledger = ledgerOf(flowDir);
  for (const q of queueOf(readSeen(ledger, from))) recordDropped(ledger, q, 'carried', nowMs, from);
}

/** Cancel's own row in the ledger. @param {string} flowDir @param {string} sig @param {number} nowMs */
export function recordCancelled(flowDir, sig, nowMs) {
  appendRow(ledgerOf(flowDir), { id: `cancelled:${nowMs}`, kind: 'cancelled', sig, at: nowMs });
}
