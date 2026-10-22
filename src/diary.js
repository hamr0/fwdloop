// M4d am29 item 1-3: the run's three add-only diaries, in the run's own folder, the way bareloop keeps its gate audit sidecar
// (src/planrun.js: `new Gate({ audit: { path } })`, the path denied to the worker with `fs.deny`).
//   calls.jsonl  one row per MODEL CALL:  step, try, round, cost, tokens, time, stop reason, thinking asked and status
//   tools.jsonl  one row per TOOL CALL:   step, try, round, tool, path, the guard's decision (allow / deny + rule / no check)
//   checks.jsonl one row per TRY that ran checks: each check numbered, ✓/✗, its result, where it comes from, and the output it judged
// Never saved: what the model said, what was in any file (a tool row names a path, never its content). Every string is scrubbed with the
// ONE secret inventory (`redactSecrets`, src/redact.js) before the row is written. The model can never read these files: the step's
// bareguard Gate denies them (src/primitives.js) and a grep over the run folder drops their hits.
// Rounds count from 1 in EACH STEP (they keep counting across that step's tries); `nextRound` reads the count off the diary.
//
// borrowed-from: bareloop src/planrun.js@fd78723 (the gate audit sidecar + fs.deny of its path; the per-round rows emitted from the onLlmResult wrapper)
import { join } from 'node:path';
import { appendRow } from './jsonl-append.js';
import { readLines } from './books.js';
import { redactSecrets } from './redact.js';

export const DIARY_FILES = Object.freeze({ calls: 'calls.jsonl', tools: 'tools.jsonl', checks: 'checks.jsonl' });

/** Every diary's absolute path for a run, for the model's deny list. @param {string} runDir @returns {string[]} */
export const diaryPaths = (runDir) => Object.values(DIARY_FILES).map((f) => join(runDir, f));

/** A copy of a JSON value with every string scrubbed. @param {any} v @returns {any} */
function scrub(v) {
  if (typeof v === 'string') return redactSecrets(v);
  if (Array.isArray(v)) return v.map(scrub);
  if (v !== null && typeof v === 'object') return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, scrub(x)]));
  return v;
}

/** The ONE writer of a diary row. @param {string} runDir @param {keyof typeof DIARY_FILES} kind @param {Record<string, any>} row */
function write(runDir, kind, row) { appendRow(join(runDir, DIARY_FILES[kind]), scrub(row)); }

/** @param {string} runDir @param {{step:string|null, try:number|null, round:number, at:string, model:string|null, costUsd:number|null, tokens:{in:number,out:number,cache:number}|null, ms:number|null, stopReason:string|null, thinking:{asked:string|null,status:string|null}}} row */
export const appendCall = (runDir, row) => write(runDir, 'calls', row);
/** @param {string} runDir @param {{step:string|null, try:number|null, round:number, at:string, tool:string, path:string|null, decision:'allow'|'deny'|'no check', rule:string|null}} row */
export const appendTool = (runDir, row) => write(runDir, 'tools', row);
/** @param {string} runDir @param {{step:string|null, try:number, at:string, lastRound:number, checks:Array<{n:number, text:string, ok:boolean, result:string|null, source:string}>, output:{file:string, bytes:number, sha256:string}|null}} row */
export const appendChecks = (runDir, row) => write(runDir, 'checks', row);

/** @param {string} runDir @returns {any[]} */
export const readCalls = (runDir) => readLines(runDir, DIARY_FILES.calls);
/** @param {string} runDir @returns {any[]} */
export const readTools = (runDir) => readLines(runDir, DIARY_FILES.tools);
/** @param {string} runDir @returns {any[]} */
export const readChecks = (runDir) => readLines(runDir, DIARY_FILES.checks);

/** The round number of this step's next model call: one more than the highest round it has in the diary, so it counts on across tries and across resumes.
 *  Read off the file each time (the diary is the one record), never a copy held in memory. @param {string} runDir @param {string|null} step */
export const nextRound = (runDir, step) => readCalls(runDir).filter((r) => r.step === step).reduce((m, r) => Math.max(m, r.round), 0) + 1;
