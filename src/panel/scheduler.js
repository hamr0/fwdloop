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
// What a tick does for one job with a signed schedule (M9 am20: the schedule is the job's own `schedule.json`, read by the door, never a line in the job):
//   0. a schedule whose job was Edited since is cancelled the way Cancel does it (`retireStale`);
//   1. clock kinds: `due` against this signing's rows of the job's one schedule ledger; a due slot is written to the ledger (`recordFire`) BEFORE the fire;
//   2. file kinds: `poll` of this job's file trigger; each file taken is already in the ledger (`ran`) BEFORE the fire.
// A schedule change or a Cancel settles the queue in its own click (src/schedule.js `dropQueue` / `carryQueue`): no tick settles anything.
// A failure on one job (a folder that went away) is written once to `triggers.jsonl` as `refused` and never stops the other jobs.
import { due, readRows, recordFire } from '../trigger-clock.js';
import {
  createFileTrigger, queueOf, readSeen, recheck, recordArrived, recordDropped, recordRan,
} from '../trigger-files.js';
import { ledgerOf } from '../schedule.js';
import { readOutcomes } from './authortrigger.js';

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

  /**
   * M9 am3: the queue of a file trigger (arrived minus ran, oldest first). Busy: every queued file is told ONCE (`busy`) and waits. Free: the
   * head is looked at again at use time (deleted / changed -> one row, dropped, the next head), then goes through the fire checks; `ran` is
   * written right before the start. A head refused BEFORE `ran` is written (month, keys, input) stays queued, told once, and blocks the ones behind it; a refusal by the starter itself lands after `ran`, so that file is then marked run and leaves the queue.
   * @param {any} job @param {string} ledger @param {number} nowMs
   */
  function runQueue(job, ledger, nowMs) {
    const { sig } = job;
    let queue = queueOf(readSeen(ledger, sig));
    if (queue.length === 0) return;
    const key = (/** @type {string} */ sha, /** @type {Record<string, any>} */ r) => `${sha}|${r.outcome}|${r.why ?? ''}`;   // a refusal is told once PER REASON; busy / monthly carry no `why`
    const spoken = new Set(readOutcomes(job.flowDir).filter((r) => typeof r.sha === 'string' && r.sig === sig).map((r) => key(r.sha, r)));
    const cause = (/** @type {any} */ q) => ({ kind: /** @type {'file'} */ ('file'), path: q.path, sha: q.sha });
    const told = (/** @type {any} */ q) => (/** @type {Record<string, any>} */ row) => { const k = key(q.sha, row); const had = spoken.has(k); spoken.add(k); return had; };
    if (door.busy(job)) {
      for (const q of queue) door.fire(job, cause(q), { told: told(q) });
      return;
    }
    while (queue.length > 0) {
      const q = queue[0];
      const seen = recheck(q);
      if (seen.state !== 'ok') {
        const why = seen.state === 'deleted' ? 'deleted' : 'changed';
        recordDropped(ledger, q, why, nowMs, sig);
        door.note(job, {
          outcome: why, file: q.path, sha: q.sha, say: seen.state === 'deleted' ? `${q.name} did not run: ${seen.say}.` : `${q.name} did not run: it changed before its turn; the new version arrives again.`,
        });
        queue = queue.slice(1);
        continue;
      }
      door.fire(job, cause({ ...q, path: seen.path }), { told: told(q), holdIfCannotStart: true, beforeStart: () => recordRan(ledger, seen, nowMs, sig) });
      return;
    }
  }

  function tick() {
    const nowMs = now();
    const live = new Set();
    try { door.retireStale(); } catch { /* one job's files never stop the others; tried again next tick */ }
    for (const job of door.scan()) {
      const { sig } = job;
      const key = `${job.flow}|${sig}`;
      live.add(key);
      try {
        const ledger = ledgerOf(job.flowDir);
        const { trigger } = job;
        if (trigger.kind === 'file-updated' || trigger.kind === 'new-file') {
          let w = watchers.get(key);
          if (!w) {
            w = createFileTrigger({
              mode: trigger.kind === 'new-file' ? 'new' : 'updated', target: trigger.kind === 'new-file' ? trigger.folder : trigger.path, ledger, sig,
            });
            watchers.set(key, w);
          }
          const { arrived, refused } = w.poll();
          for (const r of refused) door.refuse(job, `${r.path}: ${r.why}`);
          for (const f of arrived) recordArrived(ledger, f, nowMs, sig);   // THE writer of the file ledger: arrival time is this clock, never the file's mtime
          runQueue(job, ledger, nowMs);
        } else {
          const d = due(trigger, readRows(ledger, sig), nowMs);
          if (d.fire) {
            recordFire(ledger, d, nowMs, sig);   // BEFORE the fire: a crash loses a run, never doubles one
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
