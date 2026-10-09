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
//   card-<n>.json the card as the human submitted it for revise <n> (M4e amendment 14 item 2), written by `revise`, write-once ('wx'), never a key
//   prose-<n>.txt the prose file built from card-<n>.json (the ONE `cardToProse`); the model gets this card only, never the old plan
//   draft-<n>/    the CLI's output for revise <n> (`fwdloop draft prose-<n>.txt --out draft-<n>`, a plain fresh draft): its own full draft dir;
//                 `revise-<n>.log` is that child's log. The plan to sign is the NEWEST of draft, draft-1, ... and only if it is green (`withRevises`).
//   abandoned.json  written by Abandon, after the child is gone
//   signed.json   written by `sign` (piece 2b) right after `signDraft` succeeds; the phase reader reads it
//
// ONE WRITER PER FIELD: `start` writes card.json, prose.txt, pid.json (and, through the one spawn helper, child.log);
// `abandon` writes abandoned.json; `sign` writes signed.json; the CLI child writes everything under draft/. The phase is never stored — it is
// READ from those files each time (`readDraft`), so a refresh or a panel restart cannot disagree with the disk.
//
// One at a time with no lock table: `start` is fully synchronous (check live -> create the folder -> spawn ->
// write pid.json, no await between), so two requests that arrive together run one after the other and the second
// sees the first's live child and is refused. A dead child never blocks (its pid is read, never assumed).
import { randomBytes } from 'node:crypto';
import {
  mkdirSync, realpathSync, rmSync, writeFileSync,
} from 'node:fs';
import { userInfo } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ANSWER_FILE, OPEN_QUESTION_SAY, PANEL_DRAFTS_DIR, readQuestions, readoutHeadIndexes, scrub, signDraft,
} from '../authoring.js';
import { nextRunId, readFileInside, readdirInside } from '../flow.js';
import { isFwdloopAlive } from '../liveness.js';
import {
  checkMonthlyRoom, ConfigError, monthlyNote, monthlyRefusalText,
} from '../monthly.js';
import {
  answerClash, appendAnswersToJob, capFloorText, capFloorUsd, cardFields, checkCard, checkInputRows, parseInputLines, parseJobBox,
} from './authorcard.js';
import { leastResumeCapUsd } from './authorvalues.js';
import { createFlowsDoor } from './authorflows.js';
import { createResumeDoor } from './authorresume.js';
import { createStarter } from './authorstart.js';
import {
  childRunning as childRunningNow, providerKeys, readJsonFile, spawnDetached, writePidFile,
} from './spawn.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = join(HERE, '..', '..', 'bin', 'fwdloop');

/** A draft id: `d-` + the start time in base 36 (so ids sort oldest to newest) + 4 random hex. */
const STARTED_OVER_FILE = 'started-over-from.json';
const ID_RE = /^d-[0-9a-z]{10}-[0-9a-f]{4}$/;
const newId = () => `d-${Date.now().toString(36).padStart(10, '0')}-${randomBytes(2).toString('hex')}`;
/** The phases that end a card's life: Abandon or a sign. Everything else is still on the card (to read, to sign, to retry). */
const FINISHED = new Set(['abandoned', 'signed']);
const LOG_TAIL_CHARS = 1500;
const STOPPED_SAY = 'The draft process ended before it finished (it was stopped from outside). Nothing was signed and nothing was sent. Draft again.';
const RED_SAY = 'The drafter\'s plan did not pass the checks. Nothing was signed and nothing was sent. Fix the job and draft again; this draft is kept on disk and is never reused.';
/** Up to 2 revises per draft (amendment 14 item 3); a revise is used once its `draft-<n>/` exists (a refusal at $0 makes none). */
export const MAX_REVISES = 2;
const CARD_RE = /^card-(\d+)\.json$/;
/** The phases in which a draft child is running (a first draft, a revise, or the redraft after the human's answers). */
const LIVE_PHASES = new Set(['drafting', 'revising', 'redrafting']);
const ANSWERS_NOT_DRAFTED_SAY = 'Your answers are saved, but the plan was not drafted again with them (the process did not start). Nothing was signed. Draft again from the card.';
const REDRAFT_RED_SAY = 'The plan drafted with your answers did not pass the checks. Nothing can be signed until a plan is green. Your answers are kept in the card: change it and draft again.';
const BLANK_ANSWER_SAY = 'Write an answer. A question can\'t be skipped; the plan waits for it.';
const ONE_LINE_ANSWER_SAY = 'Write the answer on one line. It is added to your job as one guardrail line.';
const PLAN_DIR_RE = /^draft-(\d+)$/;
const REVISE_RED_SAY = 'The revised plan did not pass the checks. Nothing can be signed until a plan is green. Your edits are kept: change the card and draft again.';
const KILL_WAIT_MS = 3000;
const KILL_HARD_WAIT_MS = 2000;
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/**
 * @param {{ root: string, home?: string, skipMonthly?: boolean, loadEnv: () => { ok: boolean, env: Record<string, string|undefined>, refusal: string|null }, bin?: string, childRunning?: (dir: string) => boolean }} opts
 *   `loadEnv` is the keys-file door (`keysForDoor`): called before EVERY spawn and every reply that quotes a log, so editing
 *   the file needs no restart. Its `env` is BOTH the child's spawn env AND the scrub list (POC (a), M4d wiring rule).
 */
export function createAuthor(opts) {
  const {
    root, loadEnv, home, skipMonthly = false, bin = BIN, childRunning = childRunningNow,
  } = opts;
  // the ONE run-start path (sign and run both end in `starter.start`) and the Run-a-signed-flow door built on it
  const starter = createStarter({ root, bin });
  const flowsDoor = createFlowsDoor({
    root, home, skipMonthly, loadEnv, starter, monthlyClaim: (usd) => monthlyClaim(usd),
  });

  /** The ONE monthly check, defined below (a function declaration, so the doors above may take it now). */
  const resumeDoor = createResumeDoor({
    root, loadEnv, monthlyClaim: (usd) => monthlyClaim(usd), starter,
  });

  /** The drafts folder's real path, or null when the flows root does not exist. */
  const draftsDir = () => {
    try { return join(realpathSync(root), PANEL_DRAFTS_DIR); } catch { return null; }
  };

  const readJson = readJsonFile;

  /**
   * The monthly room for a cap, from the ONE read-only check the CLI's door also decides on (`checkMonthlyRoom`, src/monthly.js).
   * `null` when this process has no config home (the CLI skips its check there too); `{ problem }` when config.json cannot be read.
   * @param {number} capUsd
   */
  function monthlyClaim(capUsd) {
    if (skipMonthly) return null;
    try { return checkMonthlyRoom({ capUsd, home }); } catch (e) {
      if (e instanceof ConfigError) return { problem: e.message };
      throw e;
    }
  }

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

    // C9: ask "is it still running" FIRST, then read the result. A child that finishes between the two reads is then seen as finished
    // with its result on disk; the other order could see no result, then no child, and call a finished draft stopped.
    const running = childRunning(dir);
    const first = resultOf(dir, 'draft', keys);
    // a first plan that asked questions (green or red) is read by `withRevises` too: it is the ONE function that decides the phase of every plan
    if (first && (first.phase === 'green' || readQuestions(join(dir, 'draft')).questions.length > 0)) return withRevises(base, dir, first, keys);
    if (first) return { ...base, ...first };
    // no result yet: the child is the only thing that can still produce one
    if (running) return { ...base, phase: 'drafting' };
    return { ...base, phase: 'stopped', say: logTail(dir, 'child.log', keys) || STOPPED_SAY };
  }

  /** The tail of a child's log, scrubbed and without its `fwdloop: ` prefix; '' when there is none. */
  function logTail(dir, rel, keys) {
    const logText = readFileInside(dir, rel);
    return logText.ok ? scrub(logText.text, keys).trim().slice(-LOG_TAIL_CHARS).replace(/^fwdloop: /, '') : '';
  }

  /**
   * One plan folder's result, READ from its files: green (spec.hash), red (a log that says not ok, or a leak marker), or null (no result yet).
   * @param {string} dir the draft folder @param {string} rel `draft` or `draft-<n>` @param {string[]} keys
   * @returns {any}
   */
  function resultOf(dir, rel, keys) {
    const hashFile = readFileInside(dir, `${rel}/spec.hash`);
    if (hashFile.ok && hashFile.text.trim() !== '') {
      const readout = readFileInside(dir, `${rel}/readout.txt`);
      const text = readout.ok ? scrub(readout.text, keys) : '';
      return { phase: 'green', hash: hashFile.text.trim(), readout: text, readoutHeads: readoutHeadIndexes(text) };
    }
    const leak = readFileInside(dir, `${rel}/scrub-leak.red`);
    const log = readJson(dir, `${rel}/log.json`);
    if (leak.ok || (log && log.ok === false)) {
      const reds = Array.isArray(log?.reds) ? log.reds.map((r) => scrub(String(r), keys)) : [];
      if (leak.ok) reds.push(scrub(leak.text.trim(), keys));
      return { phase: 'red', reds, say: RED_SAY };
    }
    return null;
  }

  /**
   * A first plan (green, or red with questions), plus its revises and answer redrafts (amendments 14, 24). The ONE function that decides
   * what is signable and what phase a draft is in: the plan to look at is the NEWEST of `draft`, `draft-1`, ...; it is signable ONLY if it is
   * green AND has no question open. A newest plan with an unanswered question is `questions-open` (nothing is signable, a reload keeps it open).
   * A red or stopped newest plan means nothing is signable (an older green plan was drafted from a different card), and the card shown is the one
   * last submitted. `phase` is `revising` / `redrafting` only while the newest plan's child runs. A revise uses one of the 2; an answer redraft
   * (marked by `redraft-<n>.json`) uses none. One reader of every such fact: each `card-<n>.json`, its folder and log, its questions and answers.
   * @param {any} base @param {string} dir @param {any} first the first plan's result (green, or red that asked questions) @param {string[]} keys
   */
  function withRevises(base, dir, first, keys) {
    const names = readdirInside(dir, '.');
    const ns = names.map((n) => CARD_RE.exec(n)?.[1]).filter((x) => x !== undefined).map(Number).sort((a, b) => a - b);
    const redrafts = new Set(ns.filter((n) => readJson(dir, `redraft-${n}.json`) !== null));
    const used = names.filter((n) => PLAN_DIR_RE.test(n) && !redrafts.has(Number(PLAN_DIR_RE.exec(n)?.[1]))).length;
    const revisesLeft = Math.max(0, MAX_REVISES - used);
    const newest = ns.length > 0 ? ns[ns.length - 1] : 0;
    const card = newest > 0 ? (readJson(dir, `card-${newest}.json`) ?? base.card) : base.card;
    const revises = ns.map((n) => {
      const kind = redrafts.has(n) ? 'answers' : 'revise';
      const running = n === newest && childRunning(dir); // C9: running first, then the result
      const res = resultOf(dir, `draft-${n}`, keys);
      if (res && res.phase === 'green') return { n, kind, phase: 'green', hash: res.hash };
      if (res) return { n, kind, phase: 'red', reds: res.reds, say: kind === 'answers' ? REDRAFT_RED_SAY : REVISE_RED_SAY };
      if (running) return { n, kind, phase: 'running' };
      return { n, kind, phase: 'stopped', say: logTail(dir, `${kind === 'answers' ? 'redraft' : 'revise'}-${n}.log`, keys) || STOPPED_SAY };
    });
    const cur = newest > 0 ? revises[revises.length - 1] : { phase: first.phase, kind: 'first' };
    const shared = { ...base, card, revises, revisesLeft };
    const rel = newest > 0 ? `draft-${newest}` : 'draft';
    if (cur.phase === 'running') return { ...shared, phase: cur.kind === 'answers' ? 'redrafting' : 'revising' };
    if (cur.phase === 'stopped') return { ...shared, phase: 'stopped', say: cur.say };
    const res = newest > 0 ? resultOf(dir, rel, keys) : first;
    // the plan's questions: any open one makes the phase `questions-open`, whatever colour the plan is (the answers are what it was waiting for)
    const q = readQuestions(join(dir, rel));
    if (q.open.length > 0) {
      const lineText = (line) => parseJobBox(typeof card?.job === 'string' ? card.job : '').steps[line - 1]?.text ?? null;
      const questions = q.questions.map((x) => ({ k: x.k, line: x.line, lineText: lineText(x.line), question: scrub(x.question, keys), answered: x.answer !== null }));
      return { ...shared, phase: 'questions-open', plan: rel, questions, openK: q.open[0].k, total: q.questions.length };
    }
    if (q.questions.length > 0) return { ...shared, phase: 'stopped', say: ANSWERS_NOT_DRAFTED_SAY };
    if (res.phase === 'green') {
      const answers = newest > 0 && redrafts.has(newest) ? answersOf(dir, newest, keys) : [];
      return { ...shared, phase: 'green', hash: res.hash, readout: res.readout, readoutHeads: res.readoutHeads, plan: rel, answers };
    }
    return { ...shared, phase: 'red', reds: res.reds, say: newest === 0 ? RED_SAY : cur.say };
  }

  /** The answers an answer-redraft was drafted with, as the marker recorded them: `[{ line, lineText, question, answer }]` (scrubbed). @param {string} dir @param {number} n @param {string[]} keys */
  function answersOf(dir, n, keys) {
    const rec = readJson(dir, `redraft-${n}.json`);
    const card = readJson(dir, `card-${n}.json`);
    const steps = parseJobBox(typeof card?.job === 'string' ? card.job : '').steps;
    return (Array.isArray(rec?.answers) ? rec.answers : []).map((a) => ({
      line: a.line, lineText: steps[a.line - 1]?.text ?? null, question: scrub(String(a.question), keys), answer: scrub(String(a.answer), keys),
    }));
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
    return { loaded, keys: providerKeys(loaded.env) };
  };

  /**
   * The one reader both sign calls share: a well-formed id, a readable draft, phase `green` (so not abandoned, signed, red,
   * drafting or stopped), and the flow name from its own `target.json`.
   * @param {string} id
   */
  function greenDraft(id) {
    const no = (status, refused, say) => ({ ok: false, reply: { status, body: { ok: false, refused, ...(say ? { say } : {}) } } });
    if (!ID_RE.test(id)) return no(404, 'no-such-draft');
    const dd = draftsDir();
    const dir = dd === null ? null : join(dd, id);
    const v = dir === null ? null : readDraft(dir, id, keysNow().keys);
    if (dir === null || v === null || v.card === null) return no(404, 'no-such-draft');
    // amendments 24/25: a plan with a question open is never signed from here; signDraft refuses it again from the plan folder (the same check)
    if (v.phase === 'questions-open') return no(409, 'question-open', OPEN_QUESTION_SAY);
    if (v.phase !== 'green') return no(409, 'not-green', `This draft is ${v.phase}, not a finished plan, so it cannot be signed.`);
    const name = readJson(dir, `${v.plan}/target.json`)?.name;
    if (typeof name !== 'string') return no(409, 'no-name', 'The draft has no readable flow name. Nothing was signed.');
    return {
      ok: true, v: /** @type {any} */ (v), name, dir,
    };
  }

  /**
   * The $0 checks both a first draft and a revise run on the card as submitted: the card's own checks (a key value, the flow name,
   * every field), then the monthly room for its cap. `{ ok: true, card, prose }` or `{ ok: false, reply }`. Writes nothing.
   * @param {any} body @param {{ ok: boolean, env: Record<string, string|undefined> }} loaded
   */
  function vetCard(body, loaded) {
    const card = cardFields(body);
    const checked = checkCard(card, { root: realpathSync(root), env: loaded.env });
    if (!checked.ok) return { ok: false, reply: { status: 400, body: { ok: false, refused: 'card', refusals: checked.refusals } } };
    // amendment 4 item 1: a cap that does not fit this month refuses here too, at $0, with the one refusal text (the page's red note is only a courtesy)
    const claim = monthlyClaim(Number(card.capUsd));
    if (claim && 'problem' in claim) return { ok: false, reply: { status: 409, body: { ok: false, refused: 'monthly', say: `${claim.problem} — refusing rather than guess the monthly limit. Nothing spent.` } } };
    if (claim && !claim.ok) return { ok: false, reply: { status: 400, body: { ok: false, refused: 'card', refusals: [{ field: 'capUsd', say: monthlyRefusalText(claim.room) }] } } };
    return { ok: true, card, prose: checked.prose };
  }

  return {
    flows: flowsDoor.flows,
    runAgain: flowsDoor.runAgain,
    run: flowsDoor.run,
    runPrepare: flowsDoor.runPrepare,
    resumePrepare: resumeDoor.prepare,
    resumeForm: resumeDoor.form,
    resume: resumeDoor.resume,

    /**
     * `GET /api/author/monthly-check?cap=<usd>`: the note under Cap, one read-only check. `{ text, red }` is what to show (red =
     * the cap does not fit this month); `floorUsd` is the smallest cap that funds one round of a model step, for the page's
     * `needs at least $X per run` line. A cap that is not a number above 0 gets no note. Never spends, never writes.
     * @param {unknown} cap @param {string|null} [spent] what a resumed run has already spent (amendment 4 item 4)
     */
    monthlyCheck(cap, spent = null) {
      const n = Number(cap);
      const floorUsd = capFloorUsd('x');
      if (typeof cap !== 'string' || cap.trim() === '' || !Number.isFinite(n) || n <= 0) return { status: 200, body: { ok: true, text: '', red: false, floorUsd, floorText: capFloorText(floorUsd) } };
      // a Resume (amendment 4 item 1): only what the run still has to spend is held, so the note asks for `cap - spent`; a cap not above
      // what is spent says so in the door's own words (red)
      const spentUsd = typeof spent === 'string' && spent.trim() !== '' && Number.isFinite(Number(spent)) && Number(spent) > 0 ? Number(spent) : 0;
      if (spentUsd > 0 && n <= spentUsd + 1e-9) {
        return { status: 200, body: { ok: true, text: `The cap must be above what is already spent (at least $${leastResumeCapUsd(spentUsd, floorUsd).toFixed(2)}).`, red: true, floorUsd, floorText: capFloorText(floorUsd) } };
      }
      const claim = monthlyClaim(n - spentUsd);
      if (claim === null || 'problem' in claim) return { status: 200, body: { ok: true, text: '', red: false, floorUsd, floorText: capFloorText(floorUsd) } };
      return { status: 200, body: { ok: true, ...monthlyNote(claim), floorUsd, floorText: capFloorText(floorUsd) } };
    },

    /** `GET /api/author/start/:startId`: the start's phase, read from its files. @param {string} id */
    startGet(id) { return starter.get(id, keysNow().keys); },

    /** `POST /api/author/start/:startId/clear`: dismiss a refused start. @param {string} id */
    startClear(id) { return starter.clear(id, keysNow().keys); },

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
      const vet = vetCard(body, loaded);
      if (!vet.ok) return vet.reply;
      const { card } = vet;
      for (const id of listIds()) {
        const v = view(id, keys);
        if (v && LIVE_PHASES.has(v.phase)) {
          return { status: 409, body: { ok: false, refused: 'draft-live', draftId: id, say: 'A draft is already running. Wait for it, or abandon it, before starting another.' } };
        }
      }
      const id = newId();
      const dir = join(dd, id);
      mkdirSync(dd, { recursive: true, mode: 0o700 });
      mkdirSync(dir, { mode: 0o700 });
      const proseFile = join(dir, 'prose.txt');
      writeFileSync(join(dir, 'card.json'), `${JSON.stringify(card, null, 2)}\n`, { mode: 0o600 });
      // amendment 14 item 6: a Start over names the draft it started over from; write-once, here only. An id that is not one of this panel's drafts is ignored.
      const from = body?.startedOverFrom;
      if (typeof from === 'string' && ID_RE.test(from) && listIds().includes(from)) {
        writeFileSync(join(dir, STARTED_OVER_FILE), `${JSON.stringify({ startedOverFrom: from })}\n`, { mode: 0o600, flag: 'wx' });
      }
      writeFileSync(proseFile, vet.prose, { mode: 0o600 });
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

    /**
     * `POST /api/author/:id/sign-prepare` (the first click of "Sign & run"): what the human is about to sign — the readout, the
     * hash, the flow name, the cap. GREEN drafts only. Writes nothing: the page holds the hash it was shown, and `sign`
     * re-reads everything from disk.
     * @param {string} id
     */
    signPrepare(id) {
      const seen = greenDraft(id);
      if (!seen.ok) return seen.reply;
      return {
        status: 200,
        body: {
          ok: true, draftId: id, hash: seen.v.hash, flowName: seen.name, capUsd: seen.v.card.capUsd, readout: seen.v.readout, runId: nextRunId(join(root, seen.name)),
        },
      };
    },

    /**
     * `POST /api/author/:id/sign` body `{ hash, runId? }`: sign and start the run — only when the draft is green and
     * not abandoned/signed and the hash is the one on disk (M4e amendment 2: the second click, no typed name). Then the SAME `signDraft` as `fwdloop sign`, `signed.json`, and the ONE run start. Any mismatch
     * refuses by name, signs nothing, writes nothing, spends nothing. Fully synchronous (no await between the checks and the
     * writes), so two sign POSTs together sign once: the second reads the first's `signed.json` and is refused.
     * @param {string} id @param {any} body
     */
    sign(id, body) {
      const { loaded } = keysNow();
      if (!loaded.ok) return { status: 409, body: { ok: false, refused: 'keys-file', say: String(loaded.refusal) } };
      const seen = greenDraft(id);
      if (!seen.ok) return seen.reply;
      const { v, name, dir } = seen;
      const b = body && typeof body === 'object' ? body : {};
      // amendment 4 item 2: a cap that cannot fund one round of the first model step is never signed (it would cap-halt at $0 spent)
      const floor = capFloorUsd(typeof v.card.job === 'string' ? v.card.job : '');
      if (Number(v.card.capUsd) < floor) return { status: 400, body: { ok: false, refused: 'cap-too-small', say: capFloorText(floor) } };
      if (typeof b.hash !== 'string' || b.hash !== v.hash) {
        return { status: 409, body: { ok: false, refused: 'stale-hash', say: 'The plan on disk is not the one you were shown (its hash differs). Nothing was signed. Reload and read the plan again.' } };
      }
      // everything the run needs is checked BEFORE signing, so a refusal never leaves a signed flow with no run
      const inputs = parseInputLines(typeof v.card.inputs === 'string' ? v.card.inputs : '');
      const bad = checkInputRows(inputs);
      if (bad.length > 0) return { status: 400, body: { ok: false, refused: 'inputs', refusals: bad } };
      // '' = no typed id: the start claims the next `run-<n>` (M4e amendment 3); a typed one is checked here, before signing
      const runId = typeof b.runId === 'string' ? b.runId : '';
      if (runId !== '') {
        const run = starter.checkRun(name, runId);
        if (!run.ok) return { status: 400, body: { ok: false, refused: 'run-id', say: run.say } };
      }
      const signedBy = userInfo().username;
      const result = signDraft({
        dir: join(dir, v.plan), approve: v.hash, signedBy, env: loaded.env, sessionDir: dir,
      });
      if (!result.ok) {
        const keys = providerKeys(loaded.env);
        return { status: 409, body: { ok: false, refused: 'sign-refused', say: 'The draft did not pass the signing checks. Nothing was signed.', reds: result.reds.map((r) => scrub(String(r), keys)) } };
      }
      writeFileSync(join(dir, 'signed.json'), `${JSON.stringify({
        at: new Date().toISOString(), signedBy, hash: v.hash, flow: name, runId: runId === '' ? null : runId,
      })}\n`, { mode: 0o600 });
      const started = starter.start({
        kind: 'sign', flow: name, runId, sources: inputs.map((r) => ({ role: r.role, path: r.path })),
      }, loaded.env);
      if (started.status !== 202) return { status: started.status, body: { ...started.body, signed: true, flow: name, say: `${started.body.say ?? 'The run did not start.'} The flow is signed; start it from "Run a signed flow".` } };
      return { status: 202, body: { ...started.body, signed: true } };
    },

    /**
     * `POST /api/author/:id/revise` body = the card fields, as `POST /api/author/draft` takes them (M4e amendment 14): the human's edited
     * card on a draft whose first plan was green -> the same $0 checks as a first draft -> `card-<n>.json` + `prose-<n>.txt` (write-once)
     * -> one detached plain `fwdloop draft prose-<n>.txt --out draft-<n>` -> 202. The model gets the card only. Up to MAX_REVISES per
     * draft; a refusal makes no model call and writes nothing. A body carrying a note (`text`/`note`) is refused: nothing the human types
     * goes to the model as a note. Synchronous, like `start`.
     * @param {string} id @param {any} body
     */
    revise(id, body) {
      const { loaded, keys } = keysNow();
      if (!loaded.ok) return { status: 409, body: { ok: false, refused: 'keys-file', say: String(loaded.refusal) } };
      if (!ID_RE.test(id)) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      if (body && typeof body === 'object' && ('text' in body || 'note' in body)) {
        return { status: 400, body: { ok: false, refused: 'note', say: 'A revise takes the card only; a note is not accepted. Edit the card fields and draft again. Nothing was sent.' } };
      }
      const dd = draftsDir();
      const dir = dd === null ? null : join(dd, id);
      const v = dir === null ? null : /** @type {any} */ (readDraft(dir, id, keys));
      if (dir === null || v === null || v.card === null) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      if (v.phase === 'revising' || v.phase === 'redrafting') return { status: 409, body: { ok: false, refused: 'draft-live', say: 'A plan is already being drafted. Wait for it.' } };
      if (v.phase === 'questions-open') return { status: 409, body: { ok: false, refused: 'question-open', say: 'A question the plan raised is still open. Answer it first; it is not a revise.' } };
      // only a draft whose first plan was green has revises (`withRevises` is the one reader that sets them)
      if (!Array.isArray(v.revises)) return { status: 409, body: { ok: false, refused: 'not-revisable', say: `This draft is ${v.phase}, so it cannot be revised. Draft again from the card.` } };
      if (v.revisesLeft <= 0) return { status: 409, body: { ok: false, refused: 'no-revises-left', say: `This draft has used its ${MAX_REVISES} revises. Start over: it keeps the fields and gives ${MAX_REVISES} new revises.` } };
      if (childRunning(dir)) return { status: 409, body: { ok: false, refused: 'draft-live', say: 'The draft process is still finishing. Try again in a moment.' } };
      const vet = vetCard(body, loaded);
      if (!vet.ok) return vet.reply;
      for (const other of listIds()) {
        if (other === id) continue;
        const ov = view(other, keys);
        if (ov && LIVE_PHASES.has(ov.phase)) {
          return { status: 409, body: { ok: false, refused: 'draft-live', draftId: other, say: 'A draft is already running. Wait for it, or abandon it, before revising.' } };
        }
      }
      const n = Math.max(0, ...v.revises.map((x) => x.n)) + 1;
      const proseFile = join(dir, `prose-${n}.txt`);
      writeFileSync(join(dir, `card-${n}.json`), `${JSON.stringify(vet.card, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
      writeFileSync(proseFile, vet.prose, { mode: 0o600, flag: 'wx' });
      let child;
      try {
        child = spawnDetached({
          bin,
          argv: ['draft', proseFile, '--out', join(dir, `draft-${n}`), '--root', realpathSync(root), '--name', vet.card.flowName],
          env: loaded.env,
          logPath: join(dir, `revise-${n}.log`),
        });
      } catch (e) {
        return { status: 500, body: { ok: false, refused: 'spawn', say: `The revise could not be started (${/** @type {any} */ (e)?.code ?? 'error'}). Nothing was spent.`, draftId: id } };
      }
      child.on('error', () => {});
      writePidFile(dir, child);
      return { status: 202, body: { ok: true, draftId: id, n } };
    },

    /**
     * `POST /api/author/:id/answer` body `{ k, answer }` (M4e amendments 24, 25): the human's answer to the plan's question `k` of `n`, one at a time.
     * A blank answer is refused and the question stays open; there is no skip. The answer is written ONCE ('wx') as `<plan>/answer-<k>.json`. After
     * the LAST answer the plan is drafted again as a fresh plain `fwdloop draft --no-questions` child (it never asks), from the submitted card with
     * each answer added word for word as a `~` guardrail under its line (the one `appendAnswersToJob`, then the one `cardToProse`). It is booked as
     * an answer redraft (`redraft-<n>.json`), not a revise: it uses none of the 2. Synchronous, like `revise`; a refusal at $0 writes nothing.
     * @param {string} id @param {any} body
     */
    answer(id, body) {
      const { loaded, keys } = keysNow();
      if (!loaded.ok) return { status: 409, body: { ok: false, refused: 'keys-file', say: String(loaded.refusal) } };
      if (!ID_RE.test(id)) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      const dd = draftsDir();
      const dir = dd === null ? null : join(dd, id);
      const v = dir === null ? null : /** @type {any} */ (readDraft(dir, id, keys));
      if (dir === null || v === null || v.card === null) return { status: 404, body: { ok: false, refused: 'no-such-draft' } };
      if (v.phase !== 'questions-open') return { status: 409, body: { ok: false, refused: 'no-question-open', say: 'This draft has no question waiting for an answer.' } };
      const b = body && typeof body === 'object' ? body : {};
      if (b.k !== v.openK) return { status: 409, body: { ok: false, refused: 'stale-question', say: 'That is not the question now open. Reload and answer the one shown.' } };
      const answer = typeof b.answer === 'string' ? b.answer.trim() : '';
      if (answer === '') return { status: 400, body: { ok: false, refused: 'blank-answer', say: BLANK_ANSWER_SAY } };
      if (/[\r\n]/.test(answer)) return { status: 400, body: { ok: false, refused: 'one-line', say: ONE_LINE_ANSWER_SAY } };
      if (keys.some((k) => k.length >= 8 && answer.includes(k))) return { status: 400, body: { ok: false, refused: 'key', say: 'This answer contains an API key. Keys go in Settings only. Nothing was saved.' } };
      if (childRunning(dir)) return { status: 409, body: { ok: false, refused: 'draft-live', say: 'The draft process is still finishing. Try again in a moment.' } };
      const planDir = join(dir, v.plan);
      // A line carries one guardrail (strict 1-for-1), so an answer can't be a second `~` line under a line that has one. Refused up front,
      // before any answer is written, in plain words; never merged into the existing guardrail (that would rewrite what was signed in the card).
      const clash = answerClash(typeof v.card.job === 'string' ? v.card.job : '', v.questions);
      if (clash !== null) return { status: 409, body: { ok: false, refused: 'guardrail-clash', say: `These questions are about job line ${clash}, which can carry only one guardrail line, and the answer can't be added as a second one. Nothing was saved. Abandon this draft, write what you want into that line's guardrail on the card, and draft again.` } };
      const q = v.questions.find((x) => x.k === v.openK);
      const last = v.questions.filter((x) => !x.answered).length === 1;
      const answerFile = join(planDir, ANSWER_FILE(v.openK));
      // the whole redraft is checked at $0 BEFORE the answer is written, so a refusal leaves the question open and nothing on disk
      /** @type {any} */
      let redraft = null;
      if (last) {
        const all = readQuestions(planDir).questions.map((x) => ({ line: x.line, question: x.question, answer: x.k === v.openK ? answer : x.answer }));
        const grown = appendAnswersToJob(typeof v.card.job === 'string' ? v.card.job : '', /** @type {{line:number, answer:string}[]} */ (all));
        if (grown.added !== all.length) return { status: 409, body: { ok: false, refused: 'no-such-line', say: 'An answer is about a job line the card no longer has. Draft again from the card. Nothing was signed.' } };
        const vet = vetCard({ ...v.card, job: grown.job }, loaded);
        if (!vet.ok) return vet.reply;
        for (const other of listIds()) {
          if (other === id) continue;
          const ov = view(other, keys);
          if (ov && LIVE_PHASES.has(ov.phase)) return { status: 409, body: { ok: false, refused: 'draft-live', draftId: other, say: 'A draft is already running. Wait for it, or abandon it, before answering.' } };
        }
        redraft = { vet, all };
      }
      try {
        writeFileSync(answerFile, `${JSON.stringify({ k: v.openK, line: q.line, question: q.question, answer, at: new Date().toISOString() })}\n`, { mode: 0o600, flag: 'wx' });
      } catch (e) {
        return { status: 409, body: { ok: false, refused: 'already-answered', say: /** @type {any} */ (e)?.code === 'EEXIST' ? 'That question already has an answer.' : 'The answer could not be saved. Nothing was sent.' } };
      }
      if (!last) return { status: 200, body: { ok: true, draftId: id, next: v.openK + 1 } };
      const n = Math.max(0, ...v.revises.map((x) => x.n)) + 1;
      const files = [`card-${n}.json`, `prose-${n}.txt`, `redraft-${n}.json`].map((f) => join(dir, f));
      const undo = () => { for (const f of [...files, answerFile]) rmSync(f, { force: true }); };
      let child;
      try {
        writeFileSync(files[0], `${JSON.stringify(redraft.vet.card, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
        writeFileSync(files[1], redraft.vet.prose, { mode: 0o600, flag: 'wx' });
        writeFileSync(files[2], `${JSON.stringify({ fromPlan: v.plan, answers: redraft.all.map((x) => ({ line: x.line, question: x.question, answer: x.answer })) })}\n`, { mode: 0o600, flag: 'wx' });
        child = spawnDetached({
          bin,
          argv: ['draft', files[1], '--out', join(dir, `draft-${n}`), '--root', realpathSync(root), '--name', redraft.vet.card.flowName, '--no-questions'],
          env: loaded.env,
          logPath: join(dir, `redraft-${n}.log`),
        });
      } catch (e) {
        undo();
        return { status: 500, body: { ok: false, refused: 'spawn', say: `The plan could not be drafted again (${/** @type {any} */ (e)?.code ?? 'error'}). Your answer was not kept; answer again. Nothing was spent.`, draftId: id } };
      }
      child.on('error', () => {});
      writePidFile(dir, child);
      return { status: 202, body: { ok: true, draftId: id, n, redrafting: true } };
    },

    /**
     * `GET /api/author/live`: the newest draft that is not abandoned or signed, and the newest panel start the human has not cleared
     * (`starting` or `refused`; a `started` one is in Runs) — read from files, never memory.
     */
    live() {
      const { keys } = keysNow();
      /** @type {any} */
      let draft = null;
      for (const id of listIds()) {
        const v = view(id, keys);
        if (v && !FINISHED.has(v.phase)) draft = v;
        break; // only the NEWEST draft can be the card's: an older one was replaced by it
      }
      return { status: 200, body: { ok: true, draft, start: starter.newestOpen(keys) } };
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
