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
  existsSync, mkdirSync, realpathSync, rmdirSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scrub } from '../authoring.js';
import { readPidRows } from '../books.js';
import {
  PANEL_STARTS_DIR, checkRunId, claimRunId, readFileInside, readdirInside, resolveRunDir,
} from '../flow.js';
import { booksFresh, runLiveness } from '../liveness.js';
import { dropUnstartedValues, writeRunValues } from '../runvalues.js';
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

  /** M6 amendment 3: the ONE rule for "a run of this flow is starting": the newest start folder of the flow in phase `starting`, or null. @param {string} flow @param {string[]} keys */
  function startingFor(flow, keys) {
    const sd = startsDir();
    if (sd === null) return null;
    for (const id of readdirInside(sd, '.').filter((n) => ID_RE.test(n)).sort().reverse()) {
      const v = readStart(join(sd, id), id, keys);
      if (v && v.flow === flow && v.phase === 'starting') return id;
    }
    return null;
  }

  return {
    checkRun,
    startingFor,

    /**
     * Start `fwdloop run` for a flow whose every $0 check already passed at the calling door. Re-checks the run id here (nothing
     * awaits between this check and the spawn). 202 { startId, runId } or a refusal; a refusal creates nothing.
     * `runId` '' = no typed id: the start CLAIMS the next `run-<n>` itself (claimRunId, folder created exclusively; amendment 3).
     * `values` (M4e amendment 5 item 3): the human's signed values for THIS run (the page's second click), written once into the run's own
     * folder as `signed-values.json` BEFORE the spawn; the run then uses them (`pickRunValues`). None = the flow's own.
     * @param {{ kind: 'run'|'sign', flow: string, runId: string, sources: {role: string, path: string}[], values?: any }} a
     * @param {Record<string, string|undefined>} env the merged keys env: the child's env AND the scrub list
     * @returns {{ status: number, body: any }}
     */
    start({
      kind, flow, runId, sources, values = null,
    }, env) {
      const sd = startsDir();
      if (sd === null) return { status: 400, body: { ok: false, refused: 'root', say: 'The flows folder this panel serves does not exist.' } };
      /** @type {string|null} */
      let claimedDir = null;
      if (runId === '') {
        const c = claimRunId(join(realpathSync(root), flow));
        if (!c.ok) return { status: 400, body: { ok: false, refused: 'run-id', say: `${c.red.replace(/^run: /, '')}.` } };
        ({ runId } = c);
        claimedDir = c.runDir;
      } else {
        const run = checkRun(flow, runId);
        if (!run.ok) return { status: 400, body: { ok: false, refused: 'run-id', say: run.say } };
      }
      const runDirOf = () => claimedDir ?? join(realpathSync(root), flow, 'runs', runId);
      const unclaim = () => {
        if (claimedDir === null && values === null) return;
        dropUnstartedValues(runDirOf());
        try { rmdirSync(runDirOf()); } catch { /* not empty / gone */ }
      };
      if (values !== null) {
        // the run folder holds its signed values from before the first step: a claimed one already exists, a typed id's is made here
        // (exclusively: a folder that appeared meanwhile refuses)
        try { if (claimedDir === null) mkdirSync(runDirOf()); } catch { return { status: 400, body: { ok: false, refused: 'run-id', say: `There is already a run "${runId}" of this flow. Use a new run id.` } }; }
        const w = writeRunValues(runDirOf(), { ...values, runId });
        if (!w.ok) { unclaim(); return { status: 500, body: { ok: false, refused: 'values', say: `The signed values could not be saved. ${NOTHING_SPENT}` } }; }
      }
      const keys = providerKeys(env);
      // one start at a time while one is still spawning for this flow (a double click, two tabs)
      const startingId = startingFor(flow, keys);
      if (startingId !== null) {
        unclaim();
        return { status: 409, body: { ok: false, refused: 'start-live', startId: startingId, say: 'A run of this flow is already starting. Wait for it.' } };
      }
      const id = newId();
      const dir = join(sd, id);
      mkdirSync(sd, { recursive: true, mode: 0o700 });
      mkdirSync(dir, { mode: 0o700 });
      writeFileSync(join(dir, 'start.json'), `${JSON.stringify({
        kind, flow, runId, sources, startedAt: new Date().toISOString(),
      }, null, 2)}\n`, { mode: 0o600 });
      const argv = ['run', flow, '--root', realpathSync(root), ...sources.flatMap((s) => ['--source', `${s.role}=${s.path}`]), '--run-id', runId];
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
     * @param {{ flow: string, runId: string, version: number }} a @param {Record<string, string|undefined>} env the merged keys env
     * @returns {{ status: number, body: any }}
     */
    startContinue({ flow, runId, version }, env) {
      const sd = startsDir();
      if (sd === null) return { status: 400, body: { ok: false, refused: 'root', say: 'The flows folder this panel serves does not exist.' } };
      const keys = providerKeys(env);
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
