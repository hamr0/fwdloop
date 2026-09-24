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

const { tools: SHELL_TOOLS } = createShellTools();
const FOUND_WRITE_TOOL = SHELL_TOOLS.find((t) => t.name === 'shell_write');
if (!FOUND_WRITE_TOOL) throw new Error('send: bare-agent/tools does not export a "shell_write" tool');
const WRITE_TOOL = FOUND_WRITE_TOOL;

/**
 * @param {string} target - a signed arbiter target, e.g. `file:poc/m0/out`.
 * @param {string} filename
 * @param {unknown} content - JSON-serialised before writing.
 * @returns {Promise<{ok:true, path:string, bytes:number} | {ok:false, red:string}>}
 */
export async function sendViaPrimitive(target, filename, content) {
  const destination = checkSendDestination(target);
  if (!destination.ok) return { ok: false, red: destination.red };

  const path = join(destination.dir, filename);
  const serialised = JSON.stringify(content ?? null, null, 2);
  await WRITE_TOOL.execute({ path, content: serialised });

  const bytes = readFileSync(path);
  if (bytes.byteLength === 0) {
    return { ok: false, red: `send: "${path}" wrote 0 bytes` };
  }
  return { ok: true, path, bytes: bytes.byteLength };
}
