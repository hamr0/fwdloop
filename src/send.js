// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED"): the live `sendStep(target, jobName, content, sha, ctx)` `src/runner.js`'s
// `runFlow` expects. `checkSendDestination` — the containment check
// (lexical AND realpath, write-time re-check) — is owned by `src/runner.js`
// (piece 1 already wrote it); this module imports it rather than growing a
// second writer of the same rule.
//
// borrowed-from: fwdloop poc/m0/runner.mjs@76a3607 (`sendViaPrimitive`: a
// real `shell_write` call, never a bespoke `writeFileSync` standing in for
// it, and the "happened" re-read of the bytes ACTUALLY on disk — never the
// in-memory content handed in — so a write that silently truncates to 0
// bytes reds here, not upstream).

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createShellTools } from 'bare-agent/tools';

import { checkSendDestination } from './runner.js';
import { serializeArtifact, sha256Hex } from './ask.js';
import { nextFreeName, reportFileText, MAX_SAME_DAY } from './report.js';

const { tools: SHELL_TOOLS } = createShellTools();
const FOUND_WRITE_TOOL = SHELL_TOOLS.find((t) => t.name === 'shell_write');
if (!FOUND_WRITE_TOOL) throw new Error('send: bare-agent/tools does not export a "shell_write" tool');
const WRITE_TOOL = FOUND_WRITE_TOOL;

/**
 * M15 am3: the send writes ONE markdown report per run, `<job name>-YYYY-MM-DD.md` (then `-2`, `-3`, ... when that name is taken, never over a taken file): the title, the `Passed` line and the accepted
 * @param {string} target - a signed arbiter target, e.g. `file:poc/m0/out`.
 * @param {string} jobName - the job's name: the file's name starts with it
 * @param {unknown} content - the accepted artifact; hash-checked as its JSON (M4b item 4).
 * @param {string|null} [acceptedSha256] - the sha256 the human's accept recorded
 *   (`answerAsk`, M4b piece 3). Required: none recorded (an answer written by an
 *   older version, or no accept in this process) refuses by name.
 * @param {{root?: string, runDir?: string, report?: {runNo: number|null, now?: Date, body: string}}} [ctx] the flow root and this run's folder, for the destination refusals; the report's body, run number and day
 * @returns {Promise<{ok:true, path:string, name:string, bytes:number, sha256:string, taken:string|null} | {ok:false, red:string}>}
 */
export async function sendViaPrimitive(target, jobName, content, acceptedSha256, ctx = {}) {
  const destination = checkSendDestination(target, ctx);
  if (!destination.ok) return { ok: false, red: destination.red };

  // F48 round 4 (redesign) defense in depth: `src/runner.js`'s send slot
  // now halts BEFORE calling this function on a missing/refused read, so
  // `content` should never arrive `undefined` here — but this function must
  // never again paper over that with `?? null` the way it used to (that is
  // exactly what turned a swapped/deleted accepted artifact into a
  // recorded-green 4-byte `null` shipped to the signed destination). A
  // legitimate on-disk artifact is always a non-null object: every step's
  // model output is validated to carry a boolean `done` before it is ever
  // written (src/runner.js's checkDoneBlocker), and `done`/`blocker` are
  // stripped afterward (stripDoneBlocker) — the stripped artifact that
  // actually reaches disk (and this function) is always the remaining
  // object, never `null` and never a bare non-object value.
  if (content === undefined) {
    return { ok: false, red: 'send: no content to send (artifact missing or its read was refused) — refused' };
  }
  if (content === null || typeof content !== 'object' || Array.isArray(content)) {
    return { ok: false, red: `send: content is not an artifact object (got ${JSON.stringify(content)}) — refused` };
  }

  // M4b scope item 4 (F48 finding C): at use time, AFTER the destination
  // re-checks above, hash the exact string about to be written and compare it
  // to the hash the human's accept recorded. No hash recorded, or a mismatch
  // (the accepted artifact changed after accept) refuses by name, before
  // anything is written to the destination.
  const serialised = serializeArtifact(content);
  if (typeof acceptedSha256 !== 'string' || acceptedSha256.length === 0) {
    return { ok: false, red: 'send: no accepted-artifact hash was recorded for this accept — refused (nothing shipped)' };
  }
  const actualSha256 = sha256Hex(serialised);
  if (actualSha256 !== acceptedSha256) {
    return { ok: false, red: `send: the artifact changed after it was accepted (accepted sha256 ${acceptedSha256}, about to send ${actualSha256}) — refused (nothing shipped)` };
  }

  const report = ctx.report;
  if (!report || typeof report.body !== 'string') return { ok: false, red: 'send: no report body was given for this send — refused (nothing shipped)' };
  // M15 am3 item 1 (replaces M4e amendment 1's refusal for this file): a taken name is never written over; the report lands under the next free same-day name. `shell_write` has no exclusive-create
  // mode, so this is an existence check immediately before the write (a dangling symlink at the name counts as present); a file created in the instants between the check and the write is still overwritten.
  const now = report.now ?? new Date();
  const pick = nextFreeName(destination.dir, jobName, now);
  if (pick.name === null) return { ok: false, red: `send: every same-day name for "${jobName}" is taken (up to -${MAX_SAME_DAY}) — never overwritten (nothing shipped)` };
  const path = join(destination.dir, pick.name);
  await WRITE_TOOL.execute({ path, content: reportFileText(jobName, report.runNo, now, report.body) });

  const bytes = readFileSync(path);
  if (bytes.byteLength === 0) {
    return { ok: false, red: `send: "${path}" wrote 0 bytes` };
  }
  return { ok: true, path, name: pick.name, bytes: bytes.byteLength, sha256: createHash('sha256').update(bytes).digest('hex'), taken: pick.taken };
}
