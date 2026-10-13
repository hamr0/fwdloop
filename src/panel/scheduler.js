// M9 piece 4 (docs/wiki/the-module-ladder.md, "M9" item 3): the panel's scheduler. The panel's server runs the clock and the file watch; with
// the panel off, nothing fires, and the times missed run ONCE when it comes back (`due` collapses them, marked catch-up).
//
// ONE `tick()` does everything and is synchronous; the tests call it by hand with an injected clock. The real timer only calls it.
//   tick period 500 ms: the file watch needs a file's size and mtime to hold for STABLE_POLLS (2) polls before it is taken, so a drop is
//   seen about 1.5 s after it stops changing; the proof of piece 2 polled at 250 ms and found nothing that needed faster. The clock fires
//   to the minute and would do with a tick a minute apart, but one timer is one fewer moving part; a tick that finds no trigger set reads
//   each job's signed files (small, hash-checked) and does no more.
// No leaked timer: `start` is idempotent, the timer is unref'd, and the server's close calls `stop`.
//
// What a tick does for one job with a signed trigger (the trigger itself is read from the job, never from here):
//   1. arm it if it is not armed yet (a crash between the sign and the arm);
//   2. clock kinds: `due` against the clock ledger; a due slot is written to the ledger (`recordFire`) BEFORE the fire;
//   3. file kinds: `poll` of this job's file trigger; each file taken is already in the seen ledger (`ran`) BEFORE the fire.
// A failure on one job (a folder that went away) is written once to `triggers.jsonl` as `refused` and never stops the other jobs.
import { join } from 'node:path';

import { due, readRows, recordFire } from '../trigger-clock.js';
import { createFileTrigger } from '../trigger-files.js';
import { triggerLedgerDir } from './authortrigger.js';

/**
 * @param {{ door: ReturnType<typeof import('./authortrigger.js').createTriggerDoor>, now?: () => number, intervalMs?: number }} opts
 *   `intervalMs` 0 = no timer (a test drives `tick`).
 */
export function createScheduler(opts) {
  const { door, now = Date.now, intervalMs = 500 } = opts;
  /** @type {Map<string, ReturnType<typeof createFileTrigger>>} */
  const watchers = new Map();
  /** @type {Set<string>} refusals already written, so a folder that stays gone is told once, not every tick */
  const told = new Set();
  /** @type {ReturnType<typeof setInterval>|null} */
  let timer = null;

  function tick() {
    const nowMs = now();
    const live = new Set();
    for (const job of door.scan()) {
      const hash = job.read.signature.flow;
      const key = `${job.flow}|${hash}`;
      live.add(key);
      try {
        door.ensureArmed(job);
        const dir = triggerLedgerDir(job.flowDir, hash);
        const { trigger } = job;
        if (trigger.kind === 'file-updated' || trigger.kind === 'new-file') {
          let w = watchers.get(key);
          if (!w) {
            w = createFileTrigger({
              mode: trigger.kind === 'new-file' ? 'new' : 'updated', target: trigger.kind === 'new-file' ? trigger.folder : trigger.path, ledger: join(dir, 'seen.jsonl'),
            });
            watchers.set(key, w);
          }
          const { run, refused } = w.poll();
          for (const r of refused) door.refuse(job, `${r.path}: ${r.why}`);
          for (const f of run) door.fire(job, { kind: 'file', path: f.path, sha: f.sha });
        } else {
          const clock = join(dir, 'clock.jsonl');
          const d = due(trigger, readRows(clock), nowMs);
          if (d.fire) {
            recordFire(clock, d, nowMs);   // BEFORE the fire: a crash loses a run, never doubles one
            door.fire(job, {
              kind: 'clock', slot: /** @type {number} */ (d.slot), catchUp: d.catchUp, missed: d.missed,
            });
          }
        }
      } catch (e) {
        const why = /** @type {Error} */ (e).message;
        if (!told.has(`${key}|${why}`)) { told.add(`${key}|${why}`); door.refuse(job, why); }
      }
    }
    for (const k of [...watchers.keys()]) if (!live.has(k)) watchers.delete(k);
  }

  return {
    tick,
    /** Start the real timer (idempotent). */
    start() {
      if (intervalMs <= 0 || timer !== null) return;
      timer = setInterval(() => { try { tick(); } catch { /* one bad tick never stops the next */ } }, intervalMs);
      timer.unref();
    },
    /** Stop it (idempotent). The server's close calls this. */
    stop() {
      if (timer !== null) { clearInterval(timer); timer = null; }
    },
  };
}
