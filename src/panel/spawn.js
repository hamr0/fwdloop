// M4e piece 2a, item 4 (docs/wiki/the-module-ladder.md, "M4e", scope 5): the ONE detached spawn the panel uses
// for every CLI child it starts — `fwdloop resume` (src/panel/resume.js) and `fwdloop draft` (src/panel/author.js)
// (and, later, `fwdloop run`). Extracted from resume.js's tryOnce, shape unchanged:
//   process.execPath + the bin + an ARRAY argv (no shell), `detached: true` (own process group, so the child
//   outlives the panel and a group kill reaches only it), `unref()`, stdio -> the log file (mode 0600 on create),
//   env = exactly the object the caller passes.
// The caller passes the merged keys env (`keysForDoor`) and uses THAT SAME OBJECT as its scrub list (POC (a)
// wiring rule, M4d) — this function never reads process.env itself.
import { spawn } from 'node:child_process';
import { closeSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFileInside } from '../flow.js';
import { isFwdloopAlive, procStartOf } from '../liveness.js';

/** A pid whose liveness cannot be told (no /proc) counts as running only while its pid.json is this fresh (M4c's 10-minute rule). */
const UNKNOWN_FRESH_MS = 10 * 60 * 1000;

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

/**
 * The ONE writer of a panel child's `pid.json` (`<dir>/pid.json`): the pid, its /proc starttime and when it was started.
 * Called right after the spawn by the draft door and the start door. A child with no pid writes nothing.
 * @param {string} dir @param {import('node:child_process').ChildProcess} child
 */
export function writePidFile(dir, child) {
  if (!Number.isInteger(child.pid)) return;
  writeFileSync(join(dir, 'pid.json'), `${JSON.stringify({ pid: child.pid, procStart: procStartOf(/** @type {number} */ (child.pid)), startedAt: Date.now() })}\n`, { mode: 0o600 });
}

/** One JSON file of a panel folder through the one safe gateway; null when missing, unreadable or not an object. @param {string} dir @param {string} rel */
export function readJsonFile(dir, rel) {
  const r = readFileInside(dir, rel);
  if (!r.ok) return null;
  try { const j = JSON.parse(r.text); return j && typeof j === 'object' && !Array.isArray(j) ? j : null; } catch { return null; }
}

/**
 * Is the child recorded in `<dir>/pid.json` running? true / false, never null: no pid.json = nothing known to be running =
 * false; a liveness that cannot be told (no /proc) reads as running only while pid.json is fresh (M4c's rule).
 * @param {string} dir
 */
export function childRunning(dir) {
  const pid = readJsonFile(dir, 'pid.json');
  if (!pid || !Number.isInteger(pid.pid)) return false;
  const alive = isFwdloopAlive(pid.pid, typeof pid.procStart === 'string' ? pid.procStart : null);
  if (alive !== null) return alive;
  return typeof pid.startedAt === 'number' && Date.now() - pid.startedAt <= UNKNOWN_FRESH_MS;
}
