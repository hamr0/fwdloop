// borrowed-from: bareloop src/panel/authorroutes.js@524a244 (the one-at-a-time rule `hasLiveSession` + terminal phases,
// the `/api/author/{live,start,:id,:id/abandon}` route set, the monthly/keys refusals before any spawn) and
// bareloop src/panel/authorsession.js@524a244 (the state's `card` field, kept so a refresh re-attaches).
// M4e piece 2a (docs/wiki/the-module-ladder.md, "M4e", scope 5, 6, 7, 11, 12): the DRAFT side of the panel's backend.
//
// Differences from bareloop, all signed: fwdloop's draft is a DETACHED CLI CHILD (`fwdloop draft <prose> --out <dir>
// --root <root> --name <flow>`), not an in-memory session, so every fact lives in FILES under
// `<root>/.drafts/<draftId>/` and the panel's memory holds NOTHING a restart would lose. No scouting, repo copy,
// install pause, revise menu or questions (fwdloop's drafter is one forced call with no questions back).
//
//   card.json     the typed card fields (what the human typed; never a key — checkCard refuses one)
//   prose.txt     the prose file `fwdloop draft` reads, built from the card by `cardToProse` (src/panel/authorcard.js)
//   child.log     the child's stdout+stderr, mode 0600 (quoted to the page only after `scrub`)
//   pid.json      { pid, procStart } written right after the spawn; the ONE liveness fact (`isFwdloopAlive`, M4c)
//   draft/        the CLI's own output (spec.hash, readout.txt, log.json, spend.jsonl, draft-spend.json ...)
//   abandoned.json  written by Abandon, after the child is gone
//   signed.json   written by the sign door (piece 2b); only READ here
//
// ONE WRITER PER FIELD: `start` writes card.json, prose.txt, pid.json (and, through the one spawn helper, child.log);
// `abandon` writes abandoned.json; the CLI child writes everything under draft/. The phase is never stored — it is
// READ from those files each time (`readDraft`), so a refresh or a panel restart cannot disagree with the disk.
//
// One at a time with no lock table: `start` is fully synchronous (check live -> create the folder -> spawn ->
// write pid.json, no await between), so two requests that arrive together run one after the other and the second
// sees the first's live child and is refused. A dead child never blocks (its pid is read, never assumed).
import { randomBytes } from 'node:crypto';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PANEL_DRAFTS_DIR, scrub } from '../authoring.js';
import { readFileInside, readdirInside } from '../flow.js';
import { isFwdloopAlive } from '../liveness.js';
import { PROVIDER_SLOTS } from '../provider.js';
import { cardFields, checkCard } from './authorcard.js';
import {
  childRunning, readJsonFile, spawnDetached, writePidFile,
} from './spawn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'fwdloop');

/** A draft id: `d-` + the start time in base 36 (so ids sort oldest to newest) + 4 random hex. */
const ID_RE = /^d-[0-9a-z]{10}-[0-9a-f]{4}$/;
const newId = () => `d-${Date.now().toString(36).padStart(10, '0')}-${randomBytes(2).toString('hex')}`;
/** The phases that end a card's life: Abandon or a sign. Everything else is still on the card (to read, to sign, to retry). */
const FINISHED = new Set(['abandoned', 'signed']);
const LOG_TAIL_CHARS = 1500;
const STOPPED_SAY = 'The draft process ended before it finished (it was stopped from outside). Nothing was signed and nothing was sent. Draft again.';
const RED_SAY = 'The drafter\'s plan did not pass the checks. Nothing was signed and nothing was sent. Fix the job and draft again; this draft is kept on disk and is never reused.';
const KILL_WAIT_MS = 3000;
const KILL_HARD_WAIT_MS = 2000;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** @param {Record<string, string|undefined>} env the provider key VALUES in it (the same object that is the child's env) */
function keysOf(env) {
  /** @type {string[]} */
  const out = [];
  for (const p of Object.values(PROVIDER_SLOTS)) { const k = env[p.envVar]; if (typeof k === 'string' && k !== '') out.push(k); }
  return out;
}

/**
 * @param {{ root: string, loadEnv: () => { ok: boolean, env: Record<string, string|undefined>, refusal: string|null }, bin?: string }} opts
 *   `loadEnv` is the keys-file door (`keysForDoor`): called before EVERY spawn and every reply that quotes a log, so editing
 *   the file needs no restart. Its `env` is BOTH the child's spawn env AND the scrub list (POC (a), M4d wiring rule).
 */
export function createAuthor(opts) {
  const { root, loadEnv, bin = BIN } = opts;

  /** The drafts folder's real path, or null when the flows root does not exist. */
  const draftsDir = () => {
    try { return join(realpathSync(root), PANEL_DRAFTS_DIR); } catch { return null; }
  };

  const readJson = readJsonFile;

  /**
   * The draft's state, READ from its files. `keys` = the provider key values to scrub from anything quoted.
   * @param {string} dir the draft folder @param {string} id @param {string[]} keys
   */
  function readDraft(dir, id, keys) {
    const card = readJson(dir, 'card.json');
    const base = { draftId: id, card };
    if (readJson(dir, 'abandoned.json')) return { ...base, phase: 'abandoned' };
    const signed = readJson(dir, 'signed.json');
    if (signed) return { ...base, phase: 'signed' };

    const hashFile = readFileInside(dir, 'draft/spec.hash');
    if (hashFile.ok && hashFile.text.trim() !== '') {
      const readout = readFileInside(dir, 'draft/readout.txt');
      return {
        ...base, phase: 'green', hash: hashFile.text.trim(), readout: readout.ok ? scrub(readout.text, keys) : '',
      };
    }
    const leak = readFileInside(dir, 'draft/scrub-leak.red');
    const log = readJson(dir, 'draft/log.json');
    if (leak.ok || (log && log.ok === false)) {
      const reds = Array.isArray(log?.reds) ? log.reds.map((r) => scrub(String(r), keys)) : [];
      if (leak.ok) reds.push(scrub(leak.text.trim(), keys));
      return {
        ...base, phase: 'red', reds, say: RED_SAY,
      };
    }
    // no result yet: the child is the only thing that can still produce one
    if (childRunning(dir)) return { ...base, phase: 'drafting' };
    const logText = readFileInside(dir, 'child.log');
    const tail = logText.ok ? scrub(logText.text, keys).trim().slice(-LOG_TAIL_CHARS).replace(/^fwdloop: /, '') : '';
    return { ...base, phase: 'stopped', say: tail !== '' ? tail : STOPPED_SAY };
  }

  /** Draft ids, newest first. */
  const listIds = () => {
    const d = draftsDir();
    return d === null ? [] : readdirInside(d, '.').filter((n) => ID_RE.test(n)).sort().reverse();
  };

  const view = (id, keys) => {
    const d = draftsDir();
    return d === null ? null : readDraft(join(d, id), id, keys);
  };

  /** The one request-time read of the keys door: the merged env (scrub list + child env) or null on its refusal. */
  const keysNow = () => {
    const loaded = loadEnv();
    return { loaded, keys: keysOf(loaded.env) };
  };

  return {
    /**
     * `POST /api/author/draft`: card -> $0 checks -> one detached `fwdloop draft` -> 202 { draftId }. Nothing is created
     * on a refusal. Synchronous on purpose (see the file header).
     * @param {any} body
     * @returns {{ status: number, body: any }}
     */
    start(body) {
      const { loaded, keys } = keysNow();
      if (!loaded.ok) return { status: 409, body: { ok: false, refused: 'keys-file', say: String(loaded.refusal) } };
      const dd = draftsDir();
      if (dd === null) return { status: 400, body: { ok: false, refused: 'root', say: 'The flows folder this panel serves does not exist.' } };
      const card = cardFields(body);
      const checked = checkCard(card, { root: realpathSync(root), env: loaded.env });
      if (!checked.ok) return { status: 400, body: { ok: false, refused: 'card', refusals: checked.refusals } };
      for (const id of listIds()) {
        const v = view(id, keys);
        if (v && v.phase === 'drafting') {
          return { status: 409, body: { ok: false, refused: 'draft-live', draftId: id, say: 'A draft is already running. Wait for it, or abandon it, before starting another.' } };
        }
      }
      const id = newId();
      const dir = join(dd, id);
      mkdirSync(dd, { recursive: true, mode: 0o700 });
      mkdirSync(dir, { mode: 0o700 });
      const proseFile = join(dir, 'prose.txt');
      writeFileSync(join(dir, 'card.json'), `${JSON.stringify(card, null, 2)}\n`, { mode: 0o600 });
      writeFileSync(proseFile, checked.prose, { mode: 0o600 });
      let child;
      try {
        child = spawnDetached({
          bin, argv: ['draft', proseFile, '--out', join(dir, 'draft'), '--root', realpathSync(root), '--name', card.flowName], env: loaded.env, logPath: join(dir, 'child.log'),
        });
      } catch (e) {
        return { status: 500, body: { ok: false, refused: 'spawn', say: `The draft could not be started (${/** @type {any} */ (e)?.code ?? 'error'}). Nothing was spent.`, draftId: id } };
      }
      child.on('error', () => {}); // a later spawn failure leaves no pid-backed child: the draft then reads as stopped
      writePidFile(dir, child);
      return { status: 202, body: { ok: true, draftId: id } };
    },

    /** `GET /api/author/live`: the newest draft that is not abandoned or signed — read from files, never memory. */
    live() {
      const { keys } = keysNow();
      for (const id of listIds()) {
        const v = view(id, keys);
        if (v && !FINISHED.has(v.phase)) return { status: 200, body: { ok: true, draft: v } };
        break; // only the NEWEST draft can be the card's: an older one was replaced by it
      }
      return { status: 200, body: { ok: true, draft: null } };
    },

    /** `GET /api/author/:id`. @param {string} id */
    get(id) {
      if (!ID_RE.test(id)) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      const { keys } = keysNow();
      const v = view(id, keys);
      if (v === null || v.card === null) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      return { status: 200, body: { ok: true, ...v } };
    },

    /**
     * `POST /api/author/:id/abandon`: stop the child (by its recorded pid, only after `isFwdloopAlive` says it is ours),
     * confirm it is gone, then write `abandoned.json`. No further model call; the spend already booked stays booked.
     * @param {string} id
     */
    async abandon(id) {
      if (!ID_RE.test(id)) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      const dd = draftsDir();
      const dir = dd === null ? null : join(dd, id);
      const { keys } = keysNow();
      const v = dir === null ? null : readDraft(dir, id, keys);
      if (dir === null || v === null || v.card === null) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      if (FINISHED.has(v.phase)) return { status: 409, body: { ok: false, refused: 'not-abandonable', say: `This draft is already ${v.phase}.` } };
      const pid = readJson(dir, 'pid.json');
      let killed = false;
      if (pid && Number.isInteger(pid.pid)) {
        const procStart = typeof pid.procStart === 'string' ? pid.procStart : null;
        const alive = isFwdloopAlive(pid.pid, procStart);
        if (alive === null) return { status: 409, body: { ok: false, refused: 'cannot-tell', say: 'The panel cannot tell whether the draft process is still running, so it did not stop anything.' } };
        if (alive === true) {
          // the child leads its own process group (detached), so one signal to the group reaches it and nothing else
          for (const { sig, wait } of [{ sig: 'SIGTERM', wait: KILL_WAIT_MS }, { sig: 'SIGKILL', wait: KILL_HARD_WAIT_MS }]) {
            try { process.kill(-pid.pid, /** @type {NodeJS.Signals} */ (sig)); } catch { /* already gone */ }
            const t0 = Date.now();
            // eslint-disable-next-line no-await-in-loop
            while (isFwdloopAlive(pid.pid, procStart) === true && Date.now() - t0 < wait) await sleep(25);
            if (isFwdloopAlive(pid.pid, procStart) !== true) break;
          }
          if (isFwdloopAlive(pid.pid, procStart) === true) {
            return { status: 500, body: { ok: false, refused: 'still-running', say: 'The draft process did not stop. Nothing was marked abandoned.' } };
          }
          killed = true;
        }
      }
      writeFileSync(join(dir, 'abandoned.json'), `${JSON.stringify({ at: new Date().toISOString(), killed, phaseWas: v.phase })}\n`, { mode: 0o600 });
      return { status: 200, body: { ok: true, phase: 'abandoned', stopped: killed } };
    },
  };
}
