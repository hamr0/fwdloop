// POC m4c. NOT imported by src/. Shape borrowed, then tightened (see README).
// borrowed-from: bareloop src/runlist.js@00b2b75
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

const NAME = 'fwdloop';

/**
 * Is `pid` a live fwdloop process?
 *   true  - exists AND its command line is fwdloop
 *   false - gone, a zombie, or alive but something else (recycled pid)
 *   null  - cannot tell (no /proc, or not ours to read): caller falls back to the 10-minute rule
 * @param {number} pid
 * @returns {boolean|null}
 */
export function isFwdloopAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { if (e?.code !== 'EPERM') return false; /* EPERM: exists, not ours */ }
  let cmdline;
  try { cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch (e) {
    return e?.code === 'ENOENT' && process.platform === 'linux' && hasProc() ? false : null; // died between the two calls vs no /proc
  }
  if (cmdline === '') return false; // zombie (or kernel thread): not a runner
  const [argv0, ...rest] = cmdline.split('\0');
  if (basename(argv0) === NAME) return true; // direct exec of a renamed/compiled bin
  if (!basename(argv0).startsWith('node')) return false;
  // node <script> ...: only the SCRIPT (first non-option arg) may name fwdloop. bareloop's `rest.some`
  // also matched `node other.js --root /home/x/fwdloop` because the root's basename is fwdloop.
  const script = rest.find((a) => a !== '' && !a.startsWith('-'));
  return script !== undefined && basename(script) === NAME;
}

function hasProc() {
  try { readFileSync('/proc/self/cmdline'); return true; } catch { return false; }
}
