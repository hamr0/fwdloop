// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED"): the live `sendStep(target, filename, content)` `src/runner.js`'s
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createShellTools } from 'bare-agent/tools';

import { checkSendDestination } from './runner.js';
import { serializeArtifact, sha256Hex } from './ask.js';

const { tools: SHELL_TOOLS } = createShellTools();
const FOUND_WRITE_TOOL = SHELL_TOOLS.find((t) => t.name === 'shell_write');
if (!FOUND_WRITE_TOOL) throw new Error('send: bare-agent/tools does not export a "shell_write" tool');
const WRITE_TOOL = FOUND_WRITE_TOOL;

/**
 * @param {string} target - a signed arbiter target, e.g. `file:poc/m0/out`.
 * @param {string} filename
 * @param {unknown} content - JSON-serialised before writing.
 * @param {string|null} [acceptedSha256] - the sha256 the human's accept recorded
 *   (`answerAsk`, M4b piece 3). Required: none recorded (an answer written by an
 *   older version, or no accept in this process) refuses by name.
 * @returns {Promise<{ok:true, path:string, bytes:number} | {ok:false, red:string}>}
 */
export async function sendViaPrimitive(target, filename, content, acceptedSha256) {
  const destination = checkSendDestination(target);
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

  const path = join(destination.dir, filename);
  await WRITE_TOOL.execute({ path, content: serialised });

  const bytes = readFileSync(path);
  if (bytes.byteLength === 0) {
    return { ok: false, red: `send: "${path}" wrote 0 bytes` };
  }
  return { ok: true, path, bytes: bytes.byteLength };
}
