// M4c piece 1: "is this run's process alive?" — the ONE rule. The panel's `[▶]`
// and (M4d) the money hold both call `isFwdloopAlive`/`runLiveness`, so the two
// never disagree (bareloop's own open inconsistency). No panel imports here.
// borrowed-from: bareloop src/runlist.js@00b2b75
// fwdloop tightened bareloop's rule: bareloop matched `fwdloop` in ANY argv
// position after node; here only the SCRIPT (first non-option arg) may name it
// (the panel's own resume spawn passes `--root <dir>`, and a root whose last
// segment is `fwdloop` would otherwise read as a fwdloop process). And it adds
// `procStart` (field 22 of /proc/<pid>/stat) to close a recycled pid that is
// itself a DIFFERENT fwdloop process. Proof: poc/m4c/README.md.
import { lstatSync, readFileSync, writeSync } from 'node:fs';
import { basename, join } from 'node:path';

import { appendPidRow, readPidRows } from './books.js';

const NAME = 'fwdloop';

/**
 * Field 22 (`starttime`, clock ticks since boot) of /proc/<pid>/stat, as a
 * string; `null` when unreadable. The comm field (2) may contain spaces and
 * parens, so fields are counted from the LAST ')'.
 * @param {number|'self'} pid
 * @returns {string|null}
 */
export function procStartOf(pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const after = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    const v = after[19]; // field 3 is after[0], so field 22 is after[19]
    return v !== undefined && /^\d+$/.test(v) ? v : null;
  } catch { return null; }
}

/**
 * Is `pid` a live fwdloop process — and, when `procStart` is given, the SAME
 * process that recorded it?
 *   true  - exists AND its command line is fwdloop (AND its starttime matches)
 *   false - gone, a zombie, alive but something else, or a different process on a recycled pid
 *   null  - cannot tell (no /proc, or not ours to read): caller falls back to the 10-minute rule
 * @param {number} pid
 * @param {string|null} [procStart] the starttime recorded by the process itself; absent/null = not compared
 * @returns {boolean|null}
 */
export function isFwdloopAlive(pid, procStart) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); } catch (e) { if (e?.code !== 'EPERM') return false; /* EPERM: exists, not ours */ }
  let cmdline;
  try { cmdline = readFileSync(`/proc/${pid}/cmdline`, 'utf8'); } catch (e) {
    return e?.code === 'ENOENT' && process.platform === 'linux' && hasProc() ? false : null; // died between the two calls vs no /proc
  }
  if (cmdline === '') return false; // zombie (or kernel thread): not a runner
  const [argv0, ...rest] = cmdline.split('\0');
  let isFwdloop;
  if (basename(argv0) === NAME) isFwdloop = true; // direct exec of a renamed/compiled bin
  else if (!basename(argv0).startsWith('node')) isFwdloop = false;
  else {
    // node <script> ...: only the SCRIPT (first non-option arg) may name fwdloop.
    const script = rest.find((a) => a !== '' && !a.startsWith('-'));
    isFwdloop = script !== undefined && basename(script) === NAME;
  }
  if (!isFwdloop) return false;
  if (typeof procStart === 'string') {
    const live = procStartOf(pid);
    if (live === null) return null; // cannot compare: never a silent true
    if (live !== procStart) return false; // a different fwdloop process reusing the pid
  }
  return true;
}

function hasProc() {
  try { readFileSync('/proc/self/cmdline'); return true; } catch { return false; }
}

/**
 * The one writer call: this process records itself in the run dir's
 * `pids.jsonl`, before its first step.
 * @param {string} runDir
 * @param {'run'|'resume'} leg
 * @param {string} at ISO timestamp from the run's own clock
 */
export function recordPid(runDir, leg, at) {
  appendPidRow(runDir, { pid: process.pid, startedAt: at, procStart: procStartOf('self'), leg });
}

/**
 * Is the process that last worked on this run still alive? Reads the newest
 * `pids.jsonl` row (the one reader, `readPidRows`).
 * `unknown` = no row (a pre-M4c run), a malformed row, or the check said `null`.
 * @param {string} runDir
 * @returns {'running'|'gone'|'unknown'}
 */
export function runLiveness(runDir) {
  const rows = readPidRows(runDir);
  const row = rows[rows.length - 1];
  if (!row || !Number.isInteger(row.pid)) return 'unknown';
  const alive = isFwdloopAlive(row.pid, typeof row.procStart === 'string' ? row.procStart : null);
  return alive === true ? 'running' : alive === false ? 'gone' : 'unknown';
}

/**
 * M4c amendment 2 (d): the resume lock records who holds it. The one writer:
 * `resumeRun` calls this on the fd it just created with `wx`.
 * @param {number} fd
 */
export function writeLockHolder(fd) {
  writeSync(fd, JSON.stringify({ pid: process.pid, procStart: procStartOf('self') }));
}

/**
 * The one reader of `resume.lock`. Through `lstat` (a symlinked lock is read as
 * `empty`, never followed).
 *   none    - no lock file
 *   live    - the holder is a live fwdloop process (same rule as `[▶]`)
 *   dead    - the holder is gone (or a different process on a recycled pid)
 *   unknown - liveness cannot be told (no /proc): never treated as dead
 *   empty   - a lock with no readable holder (pre-amendment resumer, torn write)
 * @param {string} runDir
 * @returns {{state: 'none'|'live'|'dead'|'unknown'|'empty', pid: number|null, path: string}}
 */
export function readResumeLock(runDir) {
  const path = join(runDir, 'resume.lock');
  let st;
  try { st = lstatSync(path); } catch { return { state: 'none', pid: null, path }; }
  if (!st.isFile()) return { state: 'empty', pid: null, path };
  let h;
  try { h = JSON.parse(readFileSync(path, 'utf8')); } catch { return { state: 'empty', pid: null, path }; }
  if (!h || !Number.isInteger(h.pid) || h.pid <= 0) return { state: 'empty', pid: null, path };
  const procStart = typeof h.procStart === 'string' ? h.procStart : null;
  // This very process holds it (two resumeRun calls in one process): alive by definition,
  // whatever its command line says.
  if (h.pid === process.pid && procStart === procStartOf('self')) return { state: 'live', pid: h.pid, path };
  const alive = isFwdloopAlive(h.pid, procStart);
  return { state: alive === true ? 'live' : alive === false ? 'dead' : 'unknown', pid: h.pid, path };
}

/** The run's books, for the 10-minute fallback: state, audit, model log, spend ledger, and the pid file itself. */
const BOOK_FILES = ['state.json', 'audit.jsonl', 'log.json', 'spend.jsonl', 'pids.jsonl'];
const FRESH_MS = 10 * 60 * 1000;

/**
 * bareloop's fallback (signed M4c scope item 2): when liveness is `unknown`
 * (a pre-M4c run with no pid row, or /proc unreadable), a run with no end row
 * whose books changed in the last 10 minutes is still working; older is not.
 * Symlinked files are skipped (lstat), never followed.
 * @param {string} runDir
 * @param {number} [nowMs]
 * @returns {boolean}
 */
export function booksFresh(runDir, nowMs = Date.now()) {
  for (const f of BOOK_FILES) {
    try {
      const st = lstatSync(join(runDir, f));
      if (st.isFile() && nowMs - st.mtimeMs <= FRESH_MS) return true;
    } catch { /* missing file: not evidence of freshness */ }
  }
  return false;
}
