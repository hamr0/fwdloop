// M4e piece 2a, item 4 (docs/wiki/the-module-ladder.md, "M4e", scope 5): the ONE detached spawn the panel uses
// for every CLI child it starts — `fwdloop resume` (src/panel/resume.js) and `fwdloop draft` (src/panel/author.js)
// (and, later, `fwdloop run`). Extracted from resume.js's tryOnce, shape unchanged:
//   process.execPath + the bin + an ARRAY argv (no shell), `detached: true` (own process group, so the child
//   outlives the panel and a group kill reaches only it), `unref()`, stdio -> the log file (mode 0600 on create),
//   env = exactly the object the caller passes.
// The caller passes the merged keys env (`keysForDoor`) and uses THAT SAME OBJECT as its scrub list (POC (a)
// wiring rule, M4d) — this function never reads process.env itself.
import { spawn } from 'node:child_process';
import { closeSync, openSync } from 'node:fs';

/**
 * @param {{ bin: string, argv: string[], env: Record<string, string|undefined>, logPath: string }} a
 * @returns {import('node:child_process').ChildProcess} the child (already `unref()`ed; the log fd is closed here)
 */
export function spawnDetached({
  bin, argv, env, logPath,
}) {
  const fd = openSync(logPath, 'a', 0o600);
  try {
    const child = spawn(process.execPath, [bin, ...argv], { detached: true, stdio: ['ignore', fd, fd], env });
    child.unref();
    return child;
  } finally {
    closeSync(fd);
  }
}
