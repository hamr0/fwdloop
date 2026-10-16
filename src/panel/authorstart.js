// borrowed-from: bareloop src/panel/authorroutes.js@524a244 (`signRun`, its ONE spawn site: sign and run both start a run only here;
// the one-at-a-time rule while a start is still spawning).
// M4e piece 2b (docs/wiki/the-module-ladder.md, "M4e", scope 5, 7, 8): the ONE run-start path. Both the sign door and the
// Run-a-signed-flow door call `start` and nothing else spawns `fwdloop run`.
//
// A start is a DETACHED CLI CHILD (`fwdloop run <flow> --root <root> --source <role>=<path> ... --run-id <id>`) through the one
// `spawnDetached`, env = the merged keys env (the same object is the scrub list). The CLI may refuse BEFORE the run dir
// exists (monthly limit, empty key, preflight), so the start's own files live in a panel-owned folder:
//
//   <root>/.starts/<startId>/start.json   what was started (flow, runId, sources, kind) — no key, ever
//                            child.log    the child's stdout+stderr, 0600 (quoted to the page only after `scrub`)
//                            pid.json     { pid, procStart, startedAt } — the ONE liveness fact (spawn.js `writePidFile`)
//
// ONE WRITER PER FIELD: `start` writes start.json, pid.json (and child.log through the spawn helper); `clear` writes cleared.json
// (the human dismissed a refusal, so a reload no longer shows it); the CLI child writes the run dir. The phase is never stored — it is READ from those files each time (`readStart`):
//   starting  the child is alive and the run dir has no book row yet
//   started   the run dir has its first book row (`pids.jsonl`, written by the run itself before its first step); `state` is
//             working / parked / ended from `runLiveness` + `ask.json` (M4c's one "is it running?" rule), never a timer
//   refused   the child is dead and the run dir never got a book row: `say` = the CLI's own sentence (scrubbed) + "Nothing spent."
//
// One click, one start: `start` is fully synchronous (check -> mkdir -> spawn -> write pid.json, no await), so two requests that
// arrive together run one after the other and the second sees the first's `starting` start and is refused.
import { randomBytes } from 'node:crypto';
import {
  existsSync, mkdirSync, realpathSync, rmdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { loadCatalogue } from '../catalogue.js';
import { scrub } from '../authoring.js';
import { readPidRows } from '../books.js';
import {
  PANEL_STARTS_DIR, checkRunId, claimRunId, nextRunId, readFileInside, readdirInside, resolveRunDir, runOwnsPlan, copyRunPlan, RUN_PLAN_MARKER,
} from '../flow.js';
import { booksFresh, runLiveness } from '../liveness.js';
import { dropUnstartedValues, writeRunValues } from '../runvalues.js';
import { TRIGGER_RECORD_FILE } from '../trigger-line.js';
import {
  childRunning, providerKeys, readJsonFile, spawnDetached, writePidFile,
} from './spawn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'fwdloop');
const ID_RE = /^s-[0-9a-z]{10}-[0-9a-f]{4}$/;
const newId = () => `s-${Date.now().toString(36).padStart(10, '0')}-${randomBytes(2).toString('hex')}`;
const LOG_TAIL_CHARS = 1500;
const NOTHING_SPENT = 'Nothing spent.';
const ENDED_SAY = `The run process ended before it started. ${NOTHING_SPENT}`;

/**
 * @param {{ root: string, bin?: string }} opts
 */
export function createStarter(opts) {
  const { root, bin = BIN } = opts;

  /** The starts folder's real path, or null when the flows root does not exist. */
  const startsDir = () => {
    try { return join(realpathSync(root), PANEL_STARTS_DIR); } catch { return null; }
  };

  /** Is this run id one the CLI would take? Its own check, and no run dir (or file) of that name yet. @param {string} flow @param {unknown} runId */
  function checkRun(flow, runId) {
    const c = checkRunId(runId);
    if (!c.ok) return { ok: false, say: `${c.red.replace(/^run: /, '')}.` };
    const r = resolveRunDir(join(realpathSync(root), flow), runId);
    if (!r.ok) return { ok: false, say: `${r.red.replace(/^run: /, '')}.` };
    if (existsSync(r.runDir)) return { ok: false, say: `There is already a run "${runId}" of this flow. Use a new run id.` };
    return { ok: true, runDir: r.runDir };
  }

  /**
   * The start's state, READ from its files.
   * @param {string} dir the start folder @param {string} id @param {string[]} keys the provider key values to scrub from anything quoted
   */
  function readStart(dir, id, keys) {
    const st = readJsonFile(dir, 'start.json');
    if (!st || typeof st.flow !== 'string' || typeof st.runId !== 'string') return null;
    const base = { startId: id, kind: st.kind, flow: st.flow, runId: st.runId };
    const resolved = resolveRunDir(join(realpathSync(root), st.flow), st.runId);
    if (!resolved.ok) return null;
    // alive FIRST, then the book row: a child that writes its row and exits between the two reads as started, never refused
    const alive = childRunning(dir);
    const carriedOn = () => {
      const live = runLiveness(resolved.runDir);
      if (live === 'running') return 'working';
      if (readFileInside(resolved.runDir, 'ask.json').ok) return 'parked';
      if (live === 'unknown' && booksFresh(resolved.runDir)) return 'working';
      return 'ended';
    };
    // A Resume (M4e amendment 4): the run already has book rows from its first leg, so "took over" is read from the halt record
    // (`halt.json`), which only the continuing process consumes — still there means the child has not taken the run yet.
    if (st.kind === 'resume') {
      const waiting = readFileInside(resolved.runDir, 'halt.json').ok;
      if (!waiting) return { ...base, phase: 'started', state: carriedOn() };
      if (alive) return { ...base, phase: 'starting' };
    } else if (readPidRows(resolved.runDir).length > 0) {
      return { ...base, phase: 'started', state: carriedOn() };
    } else if (alive) return { ...base, phase: 'starting' };
    const log = readFileInside(dir, 'child.log');
    const tail = log.ok ? scrub(log.text, keys).trim().slice(-LOG_TAIL_CHARS).replace(/^fwdloop: /, '') : '';
    const say = tail === '' ? ENDED_SAY : (tail.includes(NOTHING_SPENT) ? tail : `${tail}\n${NOTHING_SPENT}`);
    return { ...base, phase: 'refused', say };
  }

  const view = (id, keys) => {
    const d = startsDir();
    return d === null ? null : readStart(join(d, id), id, keys);
  };

  /** @type {Set<string>} start ids whose child is dead for good: `startingFor` skips them (cost does not grow with old finished starts) */
  const deadStarts = new Set();

  /**
   * M6 amendment 3: the ONE rule for "a run of this flow is starting": the newest start folder of the flow in phase `starting`, or null.
   * With `runId`, only a start of that run (the Runs list reads a run folder as `[▶]` starting by this same rule).
   * @param {string} flow @param {string[]} keys @param {string} [runId]
   */
  function startingFor(flow, keys, runId) {
    const sd = startsDir();
    if (sd === null) return null;
    for (const id of readdirInside(sd, '.').filter((n) => ID_RE.test(n)).sort().reverse()) {
      if (deadStarts.has(id)) continue;
      // phase `starting` needs a live child (readStart's `alive`), and a child that has a pid.json and is not running never runs again (a pid recorded with its
      // procStart; the no-/proc fallback is a 10-minute window that only closes), so that folder can never be `starting`: it is not read again, nothing is pruned.
      // A folder with no pid.json yet is NOT remembered (a start still being written).
      if (!childRunning(join(sd, id))) {
        if (readJsonFile(join(sd, id), 'pid.json') !== null) deadStarts.add(id);
        continue;
      }
      const v = readStart(join(sd, id), id, keys);
      if (v && v.flow === flow && (runId === undefined || v.runId === runId) && v.phase === 'starting') return id;
    }
    return null;
  }

  /**
   * The ONE decider of whether a start can begin, for `start` and for a trigger's pre-check: only the three checks that need no side effect. The flows root exists, the run
   * id is one the CLI would take (`runId` '' = the next `run-<n>`, looked at and NOT claimed; a signed plan's run folder already exists and is not looked at), and no run of
   * this flow is starting. Nothing is written. A refusal is the `{status, body}` `start` returns; null = it can start.
   * @param {{ flow: string, runId: string, planRun?: boolean }} a @param {{ env: Record<string, string|undefined>, keyNames?: string[] }} loaded
   * @returns {{ status: number, body: any }|null}
   */
  function canStart({ flow, runId, planRun = false }, loaded) {
    if (startsDir() === null) return { status: 400, body: { ok: false, refused: 'root', say: 'The flows folder this panel serves does not exist.' } };
    if (!planRun) {
      const flowDir = join(realpathSync(root), flow);
      if (runId === '') {
        const next = nextRunId(flowDir);
        const r = resolveRunDir(flowDir, next);
        if (!r.ok) return { status: 400, body: { ok: false, refused: 'run-id', say: `${r.red.replace(/^run: /, '')}.` } };
        if (existsSync(r.runDir)) return { status: 400, body: { ok: false, refused: 'run-id', say: `There is already a run "${next}" of this flow. Use a new run id.` } };
      } else {
        const run = checkRun(flow, runId);
        if (!run.ok) return { status: 400, body: { ok: false, refused: 'run-id', say: run.say } };
      }
    }
    const startingId = startingFor(flow, providerKeys(loaded));
    if (startingId !== null) return { status: 409, body: { ok: false, refused: 'start-live', startId: startingId, say: 'A run of this flow is already starting. Wait for it.' } };
    return null;
  }

  return {
    checkRun,
    startingFor,
    canStart,

    /**
     * Start `fwdloop run` for a flow whose every $0 check already passed at the calling door. Re-checks the run id here (nothing
     * awaits between this check and the spawn). 202 { startId, runId } or a refusal; a refusal creates nothing.
     * `runId` '' = no typed id: the start CLAIMS the next `run-<n>` itself (claimRunId, folder created exclusively; amendment 3).
     * `values` (M4e amendment 5 item 3): the human's signed values for THIS run (the page's second click), written once into the run's own
     * folder as `signed-values.json` BEFORE the spawn; the run then uses them (`pickRunValues`). None = the flow's own.
     * `trigger` (M9): `{kind, reason, catchUp, ...}` for a start a trigger fired (kind 'trigger'): written once into the run's own folder as `trigger.json`
     * BEFORE the spawn; `appendHistory` copies it into the run's history row (the catch-up mark, am2 item 1).
     * @param {{ kind: 'run'|'sign'|'trigger', flow: string, runId: string, sources: {role: string, path: string}[], planRun?: boolean, planOf?: string|null, values?: any, pick?: {slot: string, model: string}|null, trigger?: Record<string, any>|null }} a
     * @param {{ env: Record<string, string|undefined>, keyNames?: string[] }} loaded the keys load: its env is the child's env AND (with its key names) the scrub list
     * @returns {{ status: number, body: any }}
     */
    start({
      kind, flow, runId, sources, values = null, pick = null, trigger = null, planRun = false, planOf = null,
    }, loaded) {
      const { env } = loaded;
      const refused = canStart({ flow, runId, planRun }, loaded);
      if (refused !== null) return refused;
      const sd = /** @type {string} */ (startsDir());
      /** @type {string|null} */
      let claimedDir = null;
      if (runId === '') {
        const c = claimRunId(join(realpathSync(root), flow));
        if (!c.ok) return { status: 400, body: { ok: false, refused: 'run-id', say: `${c.red.replace(/^run: /, '')}.` } };
        ({ runId } = c);
        claimedDir = c.runDir;
      } else if (planRun) {
        // M6 am9: the run's folder already exists (signing claimed it and put its plan there); it is a run that keeps its plan, or nothing starts
        const r = resolveRunDir(join(realpathSync(root), flow), runId);
        if (!r.ok || !runOwnsPlan(r.runDir)) return { status: 400, body: { ok: false, refused: 'run-id', say: `"${runId}" is not a run that holds its own plan. ${NOTHING_SPENT}` } };
        claimedDir = r.runDir;
      }
      const runDirOf = () => claimedDir ?? join(realpathSync(root), flow, 'runs', runId);
      const unclaim = () => {
        if (planRun) return; // a signed plan's run folder is never removed here
        if (claimedDir === null && values === null && trigger === null && planOf === null) return;
        if (planOf !== null) { try { rmSync(join(runDirOf(), 'job'), { recursive: true, force: true }); rmSync(join(runDirOf(), RUN_PLAN_MARKER), { force: true }); } catch { /* best-effort */ } }
        dropUnstartedValues(runDirOf());
        try { rmdirSync(runDirOf()); } catch { /* not empty / gone */ }
      };
      if (values !== null || trigger !== null || planOf !== null) {
        // the run folder holds its signed values (and a triggered start's reason) from before the first step: a claimed one already exists,
        // a typed id's is made here (exclusively: a folder that appeared meanwhile refuses)
        try { if (claimedDir === null) mkdirSync(runDirOf()); } catch { return { status: 400, body: { ok: false, refused: 'run-id', say: `There is already a run "${runId}" of this flow. Use a new run id.` } }; }
      }
      if (planOf !== null) {
        // M6 am9: this run executes the plan another run kept: a verified copy goes into its folder BEFORE the spawn (the source is read through the same safe door)
        const src = resolveRunDir(join(realpathSync(root), flow), planOf);
        const cat = loadCatalogue();
        const c = src.ok && cat.ok ? copyRunPlan({ fromRunDir: src.runDir, runDir: runDirOf(), catalogue: cat.primitives }) : { ok: false, red: 'The plan to reuse cannot be read.' };
        if (!c.ok) { unclaim(); return { status: 409, body: { ok: false, refused: 'plan', say: `${c.red} ${NOTHING_SPENT}` } }; }
      }
      if (values !== null) {
        const w = writeRunValues(runDirOf(), { ...values, runId });
        if (!w.ok) { unclaim(); return { status: 500, body: { ok: false, refused: 'values', say: `The signed values could not be saved. ${NOTHING_SPENT}` } }; }
      }
      if (trigger !== null) {
        try { writeFileSync(join(runDirOf(), TRIGGER_RECORD_FILE), `${JSON.stringify(trigger)}\n`, { flag: 'wx', mode: 0o600 }); } catch { unclaim(); return { status: 500, body: { ok: false, refused: 'trigger', say: `The reason this run started could not be saved. ${NOTHING_SPENT}` } }; }
      }
      // one start at a time while one is still spawning for this flow (a double click, two tabs): `canStart` above decided it, and nothing between it and the spawn awaits or starts anything
      const id = newId();
      const dir = join(sd, id);
      mkdirSync(sd, { recursive: true, mode: 0o700 });
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, 'start.json'), `${JSON.stringify({
        kind, flow, runId, sources, startedAt: new Date().toISOString(),
      }, null, 2)}\n`, { mode: 0o600 });
      const argv = ['run', flow, '--root', realpathSync(root), ...sources.flatMap((s) => ['--source', `${s.role}=${s.path}`]), '--run-id', runId, ...(pick ? ['--model', pick.model, '--provider', pick.slot] : [])]; // M4d am7b: a flow with no record runs with the model picked in Chat
      let child;
      try {
        child = spawnDetached({
          bin, argv, env, logPath: join(dir, 'child.log'),
        });
      } catch (e) {
        unclaim();
        return { status: 500, body: { ok: false, refused: 'spawn', say: `The run could not be started (${/** @type {any} */ (e)?.code ?? 'error'}). ${NOTHING_SPENT}`, startId: id } };
      }
      child.on('error', () => {}); // a later spawn failure leaves no pid-backed child: the start then reads as refused
      writePidFile(dir, child);
      return { status: 202, body: { ok: true, startId: id, flow, runId } };
    },

    /**
     * Start `fwdloop continue <runId>` (M4e amendment 4 item 4): Resume of a stopped or cap-halted run, after the door wrote the run's new
     * signed values version. The same detached-child shape as `start`; the start folder reads as `starting` until the child consumes
     * `halt.json`, then `started`; a child that died with `halt.json` still there is `refused` with its own sentence. One start at a time per flow.
     * @param {{ flow: string, runId: string, version: number }} a @param {{ env: Record<string, string|undefined>, keyNames?: string[] }} loaded the keys load
     * @returns {{ status: number, body: any }}
     */
    startContinue({ flow, runId, version }, loaded) {
      const { env } = loaded;
      const sd = startsDir();
      if (sd === null) return { status: 400, body: { ok: false, refused: 'root', say: 'The flows folder this panel serves does not exist.' } };
      const keys = providerKeys(loaded);
      const startingId = startingFor(flow, keys);
      if (startingId !== null) return { status: 409, body: { ok: false, refused: 'start-live', startId: startingId, say: 'A run of this flow is already starting. Wait for it.' } };
      const id = newId();
      const dir = join(sd, id);
      mkdirSync(sd, { recursive: true, mode: 0o700 });
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, 'start.json'), `${JSON.stringify({
        kind: 'resume', flow, runId, version, sources: [], startedAt: new Date().toISOString(),
      }, null, 2)}\n`, { mode: 0o600 });
      let child;
      try {
        child = spawnDetached({
          bin, argv: ['continue', runId, '--flow', flow, '--root', realpathSync(root)], env, logPath: join(dir, 'child.log'),
        });
      } catch (e) {
        return { status: 500, body: { ok: false, refused: 'spawn', say: `The resume could not be started (${/** @type {any} */ (e)?.code ?? 'error'}). ${NOTHING_SPENT}`, startId: id } };
      }
      child.on('error', () => {});
      writePidFile(dir, child);
      return { status: 202, body: { ok: true, startId: id, flow, runId } };
    },

    /**
     * The newest start the human has not cleared, for a page that was reloaded: `starting` (re-attach the poll) or `refused` (show the
     * CLI's sentence). Null when that start began (`started`: the run is in Runs) or there is none.
     * @param {string[]} keys
     */
    newestOpen(keys) {
      const sd = startsDir();
      if (sd === null) return null;
      for (const id of readdirInside(sd, '.').filter((n) => ID_RE.test(n)).sort().reverse()) {
        if (readFileInside(join(sd, id), 'cleared.json').ok) continue;
        const v = readStart(join(sd, id), id, keys);
        if (v === null) continue;
        return v.phase === 'started' ? null : v;
      }
      return null;
    },

    /**
     * `POST /api/author/start/:startId/clear`: the human dismisses a REFUSED start. Writes `cleared.json` once; any other phase is refused.
     * @param {string} id @param {string[]} keys
     */
    clear(id, keys) {
      const v = ID_RE.test(id) ? view(id, keys) : null;
      if (v === null) return { status: 404, body: { ok: false, refused: 'no-such-start' } };
      if (v.phase !== 'refused') return { status: 409, body: { ok: false, refused: 'not-clearable', say: 'Only a refused start can be cleared.' } };
      try {
        writeFileSync(join(/** @type {string} */ (startsDir()), id, 'cleared.json'), `${JSON.stringify({ at: new Date().toISOString() })}\n`, { mode: 0o600, flag: 'wx' });
      } catch (e) {
        if (/** @type {any} */ (e)?.code !== 'EEXIST') return { status: 500, body: { ok: false, refused: 'clear', say: 'The refusal could not be cleared.' } };
      }
      return { status: 200, body: { ok: true, startId: id } };
    },

    /** `GET /api/author/start/:startId`. @param {string} id @param {string[]} keys */
    get(id, keys) {
      if (!ID_RE.test(id)) return { status: 404, body: { ok: false, refused: 'no-such-start' } };
      const v = view(id, keys);
      return v === null ? { status: 404, body: { ok: false, refused: 'no-such-start' } } : { status: 200, body: { ok: true, ...v } };
    },
  };
}
