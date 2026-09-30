// M4b piece 2 (docs/wiki/the-module-ladder.md, "M4b — inputs" scope 3 and
// "M4b amendment 1" scope 1-2): how the panel starts a resume and checks it
// took over. The proven shape is `poc/m4b/answer-door.mjs` (F51), ported, not
// imported.
//
// What happens after the library accepts an answer:
//  1. The panel spawns `fwdloop resume <runId> --flow <name> --root <root>` as
//     its own detached process (own process group, `unref()`), env = the
//     panel server's own env, stdout+stderr -> one log file. The HTTP reply
//     never waits for it, and killing the panel (or closing the tab) does not
//     stop it.
//  2. "Took over" is read from the BOOKS: the resume consumes `answer.json`
//     by renaming it to `answer.<askId>.consumed.json` (F44) — never from the
//     child's output. If the child exited, the answer is still unconsumed and
//     its refusal is the run-lock one ("locked by another resumer"), start it
//     again: up to `RESUME_MAX_TRIES` tries within `RESUME_WINDOW_MS` (signed
//     numbers). Only the lock refusal is retried.
//  3. Still unconsumed after the last try (or a non-lock refusal): the attempt
//     record says so, with the child's own refusal text verbatim; `data.js`
//     turns that into "answer saved, resume not started".
//
// No second mutex: exactly one resume applies the answer because the resume's
// own rename-to-consume is atomic (F44). This module only decides whether to
// launch another process; it never consumes, deletes or writes a book.
//
// ONE WRITER for the per-run "resume attempt" record: only `createResumer`'s
// `start` (create) and its loop (`finish`) assign its fields; everything else
// reads a copy through `get`.
//
// Log location: `<os tmpdir>/fwdloop-panel-logs-<uid>/`, mode 0700, files 0600
// — OUTSIDE the flows root and every run dir, so no step's sandboxed read/grep
// can reach it and it is never one of a run's frozen inputs. The CLI does not
// redact: it prints only its own error messages (never the key), so a key
// could reach the log only through a provider error body that echoes it.

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync, statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'fwdloop');

/** Signed with M4b amendment 1, scope 1: up to 5 tries within 10 seconds. */
export const RESUME_MAX_TRIES = 5;
export const RESUME_WINDOW_MS = 10_000;

/** The runner's own lock refusal (`src/runner.js` resumeRun) — the ONLY one retried. */
const LOCK_REFUSAL = /locked by another resumer/;
/** How often the books are checked for the consumed marker while a child runs. */
const POLL_MS = 20;
/** A refusal longer than this is cut (verbatim up to the cut). */
const MAX_REFUSAL_CHARS = 2000;

/** @param {number} ms */
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** The private log directory; refuses a directory we do not own or a symlink.
 *  @param {string|undefined} dir */
function ensureLogDir(dir) {
  const uid = typeof process.getuid === 'function' ? process.getuid() : null;
  const d = dir ?? join(tmpdir(), `fwdloop-panel-logs-${uid ?? 'user'}`);
  mkdirSync(d, { recursive: true, mode: 0o700 });
  const st = lstatSync(d);
  if (!st.isDirectory() || (uid !== null && st.uid !== uid)) {
    throw new Error(`resume log dir ${d} is not a directory owned by this user`);
  }
  return d;
}

/**
 * @param {{ root: string, env?: Record<string, string|undefined>, bin?: string, logDir?: string,
 *   maxTries?: number, windowMs?: number, slotMs?: number }} opts
 *   `env`/`bin`/`logDir`/`maxTries`/`windowMs`/`slotMs` are injectable so tests neither sleep 10 s
 *   nor need a live key; production passes none of them. `slotMs` (default `windowMs / maxTries`,
 *   i.e. 2000 ms) is only the spacing between tries: a test sets it small and `windowMs` (the
 *   per-try "did it take over" deadline) large, so CPU load cannot turn a slow child start into a
 *   false "stuck".
 */
export function createResumer(opts) {
  const {
    root, env = process.env, bin = BIN, maxTries = RESUME_MAX_TRIES, windowMs = RESUME_WINDOW_MS, slotMs = windowMs / maxTries,
  } = opts;
  const rootTag = createHash('sha256').update(root).digest('hex').slice(0, 8);
  /** @type {Map<string, any>} */
  const attempts = new Map();
  const keyOf = (flow, runId) => `${flow}/${runId}`;

  /** One resume process. Resolves as soon as the books show the answer consumed,
   *  or the child exited, or `deadline` passed — never waits for a long resume. */
  function tryOnce({ flow, runId, runDir, askId, logPath, deadline }) {
    const consumedPath = join(runDir, `answer.${askId}.consumed.json`);
    const fd = openSync(logPath, 'a', 0o600);
    const offset = statSync(logPath).size;
    const child = spawn(process.execPath, [bin, 'resume', runId, '--flow', flow, '--root', root], {
      detached: true, stdio: ['ignore', fd, fd], env,
    });
    child.unref();
    closeSync(fd);
    const sliceOfLog = () => {
      try { return readFileSync(logPath).subarray(offset).toString('utf8').trim(); } catch { return ''; } // offset is in BYTES
    };
    return new Promise((resolve) => {
      let done = false;
      const end = (v) => {
        if (done) return;
        done = true;
        clearInterval(iv);
        resolve(v);
      };
      child.once('exit', (code, sig) => end({ kind: 'exited', code, sig, text: sliceOfLog() }));
      child.once('error', (e) => end({ kind: 'exited', code: null, sig: null, text: `spawn failed: ${e.message}` }));
      const iv = setInterval(() => {
        if (existsSync(consumedPath)) end({ kind: 'took-over' });
        else if (Date.now() > deadline) end({ kind: 'slow', pid: child.pid, text: sliceOfLog() });
      }, POLL_MS);
    });
  }

  /** @param {any} rec @param {'took-over'|'stuck'} state @param {string|null} refusal */
  function finish(rec, state, refusal) {
    rec.state = state;
    rec.refusal = refusal;
    rec.endedAt = Date.now();
  }

  async function loop(rec, runDir) {
    const t0 = Date.now();
    const logPath = join(ensureLogDir(opts.logDir), `resume-${rootTag}-${rec.flow}-${rec.runId}.log`);
    rec.logPath = logPath;
    const consumed = () => existsSync(join(runDir, `answer.${rec.askId}.consumed.json`));
    for (let n = 1; n <= maxTries; n += 1) {
      if (rec.superseded) return;
      rec.tries = n;
      // eslint-disable-next-line no-await-in-loop
      const r = await tryOnce({
        flow: rec.flow, runId: rec.runId, runDir, askId: rec.askId, logPath, deadline: Date.now() + windowMs,
      });
      if (rec.superseded) return;
      if (r.kind === 'took-over' || consumed()) { finish(rec, 'took-over', null); return; }
      if (r.kind === 'slow') {
        finish(rec, 'stuck', `the resume process (pid ${r.pid}) had not taken over the answer within ${windowMs} ms${r.text ? `: ${r.text.slice(0, MAX_REFUSAL_CHARS)}` : ''}`);
        return;
      }
      const text = r.text.slice(0, MAX_REFUSAL_CHARS);
      if (!LOCK_REFUSAL.test(r.text) || n === maxTries) {
        finish(rec, 'stuck', text.length > 0 ? text : `the resume exited (code ${r.code}${r.sig ? `, signal ${r.sig}` : ''}) without taking over the answer and printed nothing`);
        return;
      }
      // Locked: the next try starts at its slot, so the last one still lands inside the window.
      // eslint-disable-next-line no-await-in-loop
      await sleep(Math.max(0, t0 + n * slotMs - Date.now()));
    }
  }

  return {
    /**
     * Start the detached resume for a saved answer and return at once with the
     * attempt record (a copy); the verify/retry loop runs in the background.
     * @param {{ flow: string, runId: string, runDir: string, askId: string }} a
     */
    start({
      flow, runId, runDir, askId,
    }) {
      const key = keyOf(flow, runId);
      const old = attempts.get(key);
      if (old) old.superseded = true;
      const rec = {
        flow, runId, askId, state: 'in-flight', tries: 0, maxTries, windowMs, refusal: null, startedAt: Date.now(), endedAt: null, logPath: null, superseded: false,
      };
      attempts.set(key, rec);
      loop(rec, runDir).catch((e) => finish(rec, 'stuck', `the panel could not start the resume: ${e.message}`));
      return { ...rec };
    },
    /** A copy of the run's attempt record, or null (none yet, or the panel restarted).
     *  @param {string} flow @param {string} runId */
    get(flow, runId) {
      const rec = attempts.get(keyOf(flow, runId));
      return rec ? { ...rec } : null;
    },
    /** Every log file this resumer has written (for tests and hygiene checks). */
    logPaths() {
      return [...new Set([...attempts.values()].map((r) => r.logPath).filter(Boolean))];
    },
  };
}
