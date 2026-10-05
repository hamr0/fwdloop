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
// ONE WRITER PER FIELD: `start` writes start.json, pid.json (and child.log through the spawn helper); the CLI child writes the
// run dir. The phase is never stored — it is READ from those files each time (`readStart`):
//   starting  the child is alive and the run dir has no book row yet
//   started   the run dir has its first book row (`pids.jsonl`, written by the run itself before its first step); `state` is
//             working / parked / ended from `runLiveness` + `ask.json` (M4c's one "is it running?" rule), never a timer
//   refused   the child is dead and the run dir never got a book row: `say` = the CLI's own sentence (scrubbed) + "Nothing spent."
//
// One click, one start: `start` is fully synchronous (check -> mkdir -> spawn -> write pid.json, no await), so two requests that
// arrive together run one after the other and the second sees the first's `starting` start and is refused.
import { randomBytes } from 'node:crypto';
import {
  existsSync, mkdirSync, realpathSync, writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scrub } from '../authoring.js';
import { readPidRows } from '../books.js';
import {
  PANEL_STARTS_DIR, checkRunId, readFileInside, readdirInside, resolveRunDir,
} from '../flow.js';
import { booksFresh, runLiveness } from '../liveness.js';
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

/** The default run id, the CLI's own shape. */
export const newRunId = () => `run-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`;

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
    if (readPidRows(resolved.runDir).length > 0) {
      const live = runLiveness(resolved.runDir);
      let state = 'ended';
      if (live === 'running') state = 'working';
      else if (readFileInside(resolved.runDir, 'ask.json').ok) state = 'parked';
      else if (live === 'unknown' && booksFresh(resolved.runDir)) state = 'working';
      return { ...base, phase: 'started', state };
    }
    if (alive) return { ...base, phase: 'starting' };
    const log = readFileInside(dir, 'child.log');
    const tail = log.ok ? scrub(log.text, keys).trim().slice(-LOG_TAIL_CHARS).replace(/^fwdloop: /, '') : '';
    const say = tail === '' ? ENDED_SAY : (tail.includes(NOTHING_SPENT) ? tail : `${tail}\n${NOTHING_SPENT}`);
    return { ...base, phase: 'refused', say };
  }

  const view = (id, keys) => {
    const d = startsDir();
    return d === null ? null : readStart(join(d, id), id, keys);
  };

  return {
    checkRun,

    /**
     * Start `fwdloop run` for a flow whose every $0 check already passed at the calling door. Re-checks the run id here (nothing
     * awaits between this check and the spawn). 202 { startId, runId } or a refusal; a refusal creates nothing.
     * @param {{ kind: 'run'|'sign', flow: string, runId: string, sources: {role: string, path: string}[] }} a
     * @param {Record<string, string|undefined>} env the merged keys env: the child's env AND the scrub list
     * @returns {{ status: number, body: any }}
     */
    start({
      kind, flow, runId, sources,
    }, env) {
      const sd = startsDir();
      if (sd === null) return { status: 400, body: { ok: false, refused: 'root', say: 'The flows folder this panel serves does not exist.' } };
      const run = checkRun(flow, runId);
      if (!run.ok) return { status: 400, body: { ok: false, refused: 'run-id', say: run.say } };
      const keys = providerKeys(env);
      // one start at a time while one is still spawning for this flow (a double click, two tabs)
      for (const id of readdirInside(sd, '.').filter((n) => ID_RE.test(n)).sort().reverse()) {
        const v = readStart(join(sd, id), id, keys);
        if (v && v.flow === flow && v.phase === 'starting') {
          return { status: 409, body: { ok: false, refused: 'start-live', startId: id, say: 'A run of this flow is already starting. Wait for it.' } };
        }
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
        return { status: 500, body: { ok: false, refused: 'spawn', say: `The run could not be started (${/** @type {any} */ (e)?.code ?? 'error'}). ${NOTHING_SPENT}`, startId: id } };
      }
      child.on('error', () => {}); // a later spawn failure leaves no pid-backed child: the start then reads as refused
      writePidFile(dir, child);
      return { status: 202, body: { ok: true, startId: id, flow, runId } };
    },

    /** `GET /api/author/start/:startId`. @param {string} id @param {string[]} keys */
    get(id, keys) {
      if (!ID_RE.test(id)) return { status: 404, body: { ok: false, refused: 'no-such-start' } };
      const v = view(id, keys);
      return v === null ? { status: 404, body: { ok: false, refused: 'no-such-start' } } : { status: 200, body: { ok: true, ...v } };
    },
  };
}
