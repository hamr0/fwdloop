// M4a piece 2 (docs/wiki/the-module-ladder.md, "M4a — read-only panel —
// SIGNED", scope item 2): the panel's data layer. Every function here is a
// pure reader — it takes `--root` plus a flow/run identity, reads fwdloop's
// own books through the readers `src/` already owns (`readFlow`, `readAudit`,
// `readHistory`, `readAsk`, `readRunState`, `readLog`, `readSpendRows`,
// `readAskEvidence`, `loadCatalogue`), and returns plain JSON-able data. No
// function here ever writes anything, and none reaches into `process.env`
// for a key/secret.
//
// Field derivations (the glyph rules, the cost-floor display) are ported
// from the M4a POC (poc/m4/panel-data.mjs, proven at F47 to hit the POC bar:
// 114 FILLED, 11 EMPTY-WITH-WHY, 0 GAP across every real run on disk) —
// never re-derived ad hoc, and the POC itself is never shipped (project
// rule: "never ship the POC" — this is the clean rebuild in `src/`).
//
// PATH SAFETY: every flow name is checked with `checkFlowName` and every
// runId is resolved with `resolveRunDir` (both `src/flow.js`) before this
// module touches a filesystem path for it — `src/panel/server.js` checks the
// same things at the route level, but this module refuses on its own too
// (negative scenario v: nothing outside `--root` is ever read).

import {
  existsSync, realpathSync,
} from 'node:fs';
import { join, basename, sep } from 'node:path';

import {
  readFlow, readRunJobCopy, listFlowNames, listRunIds, resolveRunDir, checkFlowName, readFileInside, readdirInside,
} from '../flow.js';
import {
  readAudit, readHistory, endRow, readPidRows, auditRowTokens, auditRowAt, auditRowTools,
} from '../books.js';
import {
  readAsk, readRunState, readLog, readHaltRecord, stopPending,
} from '../runner.js';
import { readSpendRows } from '../provider.js';
import { applyRunValues, parseWaitMs, pickRunValues, VALUES_FILE_RE } from '../runvalues.js';
import { readSetup } from '../setup.js';
import { checkedLines, notCheckedBlock, NOT_CHECKED_LABEL } from '../checked.js';
import { MAX_STRUCTURE_RETRIES } from '../drafter.js';
import {
  runLiveness, booksFresh, readResumeLock,
} from '../liveness.js';
import {
  readAskEvidence, listArchivedAsks, normalizeDecision, DECISION_STATUS, decisionStatus, answerTiming,
} from '../ask.js';

/** `{ ok:false, red }` result shape every exported function here can return
 *  instead of throwing — the server maps this to a 4xx, never a crash.
 *  `why` is an optional machine reason the server can branch on (never matched from `red`).
 *  @param {string} red
 *  @param {'outside-root'} [why]
 *  @returns {{ok:false, red:string, why?:'outside-root'}} */
function refuse(red, why) {
  return why ? { ok: false, red, why } : { ok: false, red };
}

/**
 * Resolve `<root>/<flowName>` safely — `checkFlowName` first (never a raw
 * string joined into a path). `checkFlowName` rules out a flowName that
 * escapes `root` lexically (no `/`, `\`, `..`), but a flow directory named
 * by URL is not required to have come from `listFlowNames` first — a
 * request can name a flow directly. So if `<root>/<flowName>` actually
 * exists, it is re-checked with `realpathSync`: it must resolve inside the
 * real `root`, same class of hole `resolveRunDir` closes for a run dir one
 * level down (a symlinked flow directory would never show up in a
 * `listFlowNames` listing, since a symlink dirent never reports
 * `isDirectory()`, but a direct request naming it by its allow-list-legal
 * name must still be refused). A not-yet-existing flow directory has
 * nothing to realpath, so only the lexical result applies to it.
 * Returns the flow directory, or a refusal.
 * @param {string} root
 * @param {string} flowName
 * @returns {{ok:true, flowDir:string}|{ok:false, red:string, why?:'outside-root'}}
 */
export function resolveFlowDir(root, flowName) {
  const check = checkFlowName(flowName);
  if (!check.ok) return refuse(check.red);
  const flowDir = join(root, flowName);
  if (existsSync(flowDir)) {
    let realFlowDir;
    let realRoot;
    try {
      realFlowDir = realpathSync(flowDir);
      realRoot = realpathSync(root);
    } catch {
      return refuse(`flow: could not resolve "${flowName}"`);
    }
    if (realFlowDir !== realRoot && !realFlowDir.startsWith(realRoot + sep)) {
      return refuse(`flow: "${flowName}" is a symlink that resolves outside root — refused`, 'outside-root');
    }
  }
  return { ok: true, flowDir };
}

/**
 * Resolve `<root>/<flowName>/runs/<runId>` safely — `resolveFlowDir` then
 * `resolveRunDir` (character allow-list plus a lexical-containment re-check,
 * same posture `src/flow.js` already applies everywhere else a runId
 * reaches a path). Neither check trusts the URL beyond what it verifies.
 * @param {string} root
 * @param {string} flowName
 * @param {string} runId
 * @returns {{ok:true, flowDir:string, runDir:string}|{ok:false, red:string}}
 */
function resolveRunPath(root, flowName, runId) {
  const flow = resolveFlowDir(root, flowName);
  if (!flow.ok) return flow;
  const run = resolveRunDir(flow.flowDir, runId);
  if (!run.ok) return run;
  return { ok: true, flowDir: flow.flowDir, runDir: run.runDir };
}

/**
 * A consumed-answer marker exists for THIS ask (`askId`) — `answerAsk`'s own write
 * (`src/ask.js`) renames to `answer.<askId>.consumed.json` on accept, and
 * `resumeRun` (`src/runner.js`) does the same when it consumes an in-place
 * `answer.json`. A directory-naming-convention check, not a "book" with its
 * own single-row shape, so it lives here rather than growing a one-off
 * reader in either writer's module. Per the signed rule (ladder M4a scope
 * item 4) it is per the OPEN ask's askId: after redo -> re-park the old
 * ask's marker stays on disk and must not answer the new ask. An ask with no
 * askId (pre-M3) can be paired with no marker: false.
 * @param {string} runDir
 * @param {string|null} askId the open ask's own askId
 * @returns {boolean}
 */
export function hasConsumedAnswer(runDir, askId) {
  if (!existsSync(runDir) || typeof askId !== 'string' || askId.length === 0) return false;
  // F48 round 3: `readdirInside` (`src/flow.js`) skips a symlinked entry
  // rather than reporting its name — a run dir cannot be made to show a
  // consumed answer that isn't really there by planting a symlink named to
  // match the pattern.
  const names = readdirInside(runDir, '.');
  return names.includes(`answer.${askId}.consumed.json`);
}

/**
 * M4b piece 2: a SAVED, not-yet-consumed answer — `answer.json` (what
 * `answerAsk` writes; the resume consumes it by renaming it away, F44). Read
 * through `readFileInside` (a symlinked file is "none"). `null` when there is
 * none or it is unreadable/unparseable or names no askId.
 * @param {string} runDir
 * @returns {{askId: string, decision: string|null, answeredAt: string|null}|null}
 */
export function readSavedAnswer(runDir) {
  const r = readFileInside(runDir, 'answer.json');
  if (!r.ok) return null;
  try {
    const a = JSON.parse(r.text);
    if (a && typeof a.askId === 'string' && a.askId.length > 0) {
      return {
        askId: a.askId,
        decision: typeof a.decision === 'string' ? normalizeDecision(a.decision) : null,
        answeredAt: typeof a.answeredAt === 'string' ? a.answeredAt : null,
      };
    }
  } catch { /* unparseable: not a usable answer */ }
  return null;
}

/** What the `resume` field says when the panel has no attempt record for a run
 *  (it restarted since the answer was saved) — said so, never blank. */
export const RESUME_REASON_UNKNOWN = 'reason unknown: the panel restarted, so it has no record of the resume attempt';

/**
 * M4b amendment 1 scope 2: the ONE derivation of "answer saved, resume not
 * started" (now worded "your answer is saved; the run stopped before using it" — M4c-fix amendment 3 (c)).
 * From the books: an answer saved (`answer.json` present) and so unconsumed. From the panel's in-memory attempt record (`attempt`, may be
 * null): whether a resume is still being started, and the resume's own refusal.
 * `null` when there is nothing to say (no saved answer and no attempt).
 * M4c amendment 3: `ask` (the run's open `ask.json`, may be null; its `expiresAt` is the effective deadline). A saved
 * answer for that ask that was NOT saved in time, once the deadline has passed, is not a resumable answer: it reads
 * as none, so the ask is expired and offers the reopen (M4c-fix amendment 1 (b)). One with no readable time, before
 * the deadline, reads `broken` (amendment 1 (a)).
 * @param {{savedAnswer: {askId:string, decision:string|null, answeredAt?:string|null}|null, attempt: any, ask?: any}} ctx
 * @returns {{state: 'starting'|'not-started'|'broken'|'took-over', askId: string|null, tries: number|null, maxTries: number|null, reason: string|null, label: string}|null}
 */
export function deriveResumeState({ savedAnswer: savedOnDisk, attempt, ask = null }) {
  // An answer.json naming another ask than the open one is not this run's answer (answerAsk refuses to write one; a
  // hand-placed file can): the run reads as what it is, waiting at the open ask. Readers never move the file.
  const saved = savedOnDisk && ask && typeof ask.askId === 'string' && savedOnDisk.askId !== ask.askId ? null : savedOnDisk;
  const pastDeadline = !!(ask && saved && ask.askId === saved.askId && Date.parse(ask.expiresAt) < Date.now());
  if (saved && pastDeadline && answerTiming(saved.answeredAt, ask.expiresAt) !== 'on-time') return null;
  const tries = attempt ? attempt.tries : null;
  const maxTries = attempt ? attempt.maxTries : null;
  if (saved) {
    // M4c-fix amendment 1 (a): a saved answer with no readable time is broken — the resume would refuse it every
    // time. It is not stuck, not "answer saved": the doors come back with a note, and answering again sets it aside.
    if (Number.isNaN(Date.parse(saved.answeredAt ?? ''))) {
      return {
        state: 'broken', askId: saved.askId, tries: null, maxTries: null, reason: BROKEN_ANSWER_WHY, label: BROKEN_LABEL,
      };
    }
    if (attempt && attempt.state === 'in-flight' && attempt.askId === saved.askId) {
      return {
        state: 'starting', askId: saved.askId, tries, maxTries, reason: null, label: 'your answer is saved; the run is picking it up',
      };
    }
    const mine = attempt && attempt.askId === saved.askId;
    return {
      state: 'not-started',
      askId: saved.askId,
      tries: mine ? tries : null,
      maxTries: mine ? maxTries : null,
      reason: mine && typeof attempt.refusal === 'string' && attempt.refusal.length > 0 ? attempt.refusal : RESUME_REASON_UNKNOWN,
      label: 'your answer is saved; the run stopped before using it',
    };
  }
  if (attempt) {
    return {
      state: 'took-over', askId: attempt.askId, tries, maxTries, reason: null, label: 'resume took over the answer',
    };
  }
  return null;
}

export const WAITING_LABEL = 'waiting on you (parked, unanswered)';
export const STUCK_LABEL = 'stuck — your answer is saved; the run stopped before using it';
export const STUCK_LOCK_LABEL = 'stuck — an old resume lock is in the way';
export const BROKEN_LABEL = 'Your saved answer could not be read.';
export const BROKEN_ANSWER_WHY = 'Please answer again; the broken one is kept aside.';
export const CRASHED_LABEL = 'crashed after taking your answer — start a fresh run';

/**
 * M4c-fix amendment 2 (g): the ONE table from a sign to its bold word. Runs, the Inbox and the run header all show
 * the word this table gives (the server stamps it on every row; the page never invents one).
 * @type {Record<string, string>}
 */
export const SIGN_WORDS = {
  '[▶]': 'running', '[·]': 'waiting', '[II]': 'stuck', '[!]': 'expired', '[?]': 'crashed', '[✓]': 'passed', '[✗]': 'failed', '[■]': 'stopped',
};

/**
 * The sign's word and the plain line after the dash. The existing plain line is kept as is; only a line that already
 * opens with the word ("stuck — …") or is the word itself ("passed") loses that repeat, so it is never said twice.
 * `noWord`: a run the human ended on purpose with rerun wears `[✗]` but is never called "failed" (M4b amendment 3),
 * so it shows its plain line alone.
 * @param {string} glyph a `computeGlyph` sign @param {string} label its plain line @param {boolean} [noWord]
 * @returns {{word: string|null, line: string|null}}
 */
export function signParts(glyph, label, noWord = false) {
  const word = noWord ? null : (SIGN_WORDS[glyph] ?? null);
  if (word === null) return { word: null, line: label ?? null };
  if (typeof label !== 'string' || label === word) return { word, line: null };
  if (label.startsWith(`${word} — `)) return { word, line: label.slice(word.length + 3) };
  // amendment 16 I4: the signed words `stopped at the ask of step N` are drawn whole, never as a bold "stopped" + dash + the rest
  if (STOPPED_AT_ASK_START_RE.test(label)) return { word: null, line: label };
  return { word, line: label };
}

/** The sign an Inbox row wears (null for a past answer, which shows its status word instead). */
function stopGlyph(r) {
  if (r.working) return '[▶]';
  if (r.stuck) return '[II]';
  if (r.waiting || r.resume) return '[·]';
  return null;
}

/** The typed reasons a stuck run can have. `retry`: nothing is wrong that the books name, so trying again is the
 *  action. `lock-no-holder`: the resume lock has no recorded holder, so trying again can never work. */
export const STUCK_REASONS = {
  retry: { label: STUCK_LABEL, why: null },
  'lock-no-holder': { label: STUCK_LOCK_LABEL, why: 'the resume lock has no recorded holder (a lock from before holders were recorded, or a torn write)' },
};

/**
 * The ONE decision "is this run stuck, why, and what does it say" (M4c amendment 2 (a), amendment 3 (e), M4c-fix 15,
 * 16). The answer is saved and not yet taken (`resume.state === 'not-started'`: `answer.json` is on disk; the
 * panel's transient 'starting' and the `late` state are not stuck) and nothing is carrying the run on: the newest
 * pid row's process is not alive AND the resume lock is not held by a live process, nor by one whose liveness
 * cannot be told (`unknown`: never called stuck). The reason is typed, derived from the lock file and the saved
 * answer themselves — never from a refusal string, so it is the same after a panel restart. Everything that shows
 * "stuck" (computeGlyph, the Inbox, Runs, the Ask tab) reads this.
 * @param {{resume?: any, liveness?: 'running'|'gone'|'unknown', lock?: string}} ctx
 * @returns {{stuck: false, reason: null, label: null, why: null}|{stuck: true, reason: 'retry'|'lock-no-holder', label: string, why: string|null}}
 */
export function stuckState({ resume, liveness, lock }) {
  if (!resume || resume.state !== 'not-started' || liveness === 'running' || lock === 'live' || lock === 'unknown') {
    return {
      stuck: false, reason: null, label: null, why: null,
    };
  }
  // The runner takes the lock before it reads the answer, so a lock problem is what it would refuse on first.
  const reason = lock === 'empty' ? 'lock-no-holder' : 'retry';
  return { stuck: true, reason, ...STUCK_REASONS[reason] };
}

/** @param {{resume?: any, liveness?: 'running'|'gone'|'unknown', lock?: string}} ctx @returns {boolean} */
export function isStuck(ctx) {
  return stuckState(ctx).stuck;
}

/**
 * The ONE filesystem read behind "stuck": the newest pid row's liveness and the resume lock, read together once.
 * @param {string} runDir
 * @returns {{liveness: 'running'|'gone'|'unknown', lock: 'none'|'live'|'dead'|'unknown'|'empty', lockPath: string}}
 */
function readStuckInputs(runDir) {
  const lock = readResumeLock(runDir);
  return { liveness: runLiveness(runDir), lock: lock.state, lockPath: lock.path };
}

/**
 * Read a run's stuck state: the inputs once, then `stuckState`. Used by the Ask tab and the Inbox; the run
 * list's own read is `loadRunContext` (the same `readStuckInputs`).
 * @param {string} runDir @param {any} resume the run's `deriveResumeState`
 */
function runStuck(runDir, resume) {
  const inputs = readStuckInputs(runDir);
  return { ...inputs, ...stuckState({ resume, ...inputs }) };
}

/**
 * M4c item 1: does this sign pulse? Only `[▶]` running and `[·]` WAITING ON YOU
 * do, and `[II]` stuck (M4c amendment 2: it is not a final state). The other
 * `[·]` states (answered not resumed, resume starting) are not waiting on the
 * human, so they stay still. The one place that decides.
 * @param {{glyph: string, label: string}} g a `computeGlyph` result
 * @returns {boolean}
 */
export function glyphPulses(g) {
  return g.glyph === '[▶]' || g.glyph === '[II]' || (g.glyph === '[·]' && g.label === WAITING_LABEL);
}

/**
 * The glyph + human-words label for one run — ported verbatim (in spirit,
 * from real derivation, not a shortcut) from `poc/m4/panel-data.mjs`'s
 * `computeGlyph`, the derivation the M4a POC proved against every real run
 * on disk. Ladder wording (M4a scope item 4):
 *  - `[✓]` passed — a history row with `outcome:'complete'`.
 *  - `[■]` stopped (M4e amendment 4) — a history row `stopped`, or `cap-halt` with a halt record to continue from.
 *  - `[✗]` failed — a history row with any other outcome (never `[?]`).
 *  - `[·]` waiting on you — parked (`ask.json` present), no consumed answer,
 *    NOT past its own `expiresAt`.
 *  - `[!]` ask expired, not resumed yet — parked, no consumed answer, but
 *    its own `expiresAt` is already past (hamr's 2026-09-27 browser-walk bug
 *    #3: the runs list/header glyph disagreed with the Inbox, which already
 *    reports `expired` correctly off the exact same `askJson.expiresAt` —
 *    `[!]` is not in the ladder's signed M4a vocabulary; picked here as an
 *    honest fourth state, distinct from every signed glyph, pending a
 *    ruling — see the report). Never `[·]` waiting (nobody can still answer
 *    it in time), never `[✗]` (the run itself never failed a check), never
 *    `[?]` (the books DO know what happened here).
 *  - `[·]` answered, not resumed yet — parked, a consumed answer exists, but
 *    no history row yet (resume hasn't finished) — always in words, never
 *    the same line as "waiting on you", never `[?]`.
 *  - `[?]` died / unknown — no history row, no open ask, and either the
 *    pid row's process is gone (M4c), or there is no pid row / no /proc and
 *    the books are older than 10 minutes. Never guessed into `[✗]` or `[✓]`.
 *  - `[·]` your answer is saved; the run stopped before using it / starting (M4b amendment 1) —
 *    `answer.json` still on disk (`resume` = `deriveResumeState`): never
 *    "waiting on you" (the human already answered) and never a success.
 *  - `[▶]` running (M4c) — no end row, no open unanswered ask, and either the
 *    newest pid row's process is alive and is fwdloop (`liveness`, src/liveness.js)
 *    or (`liveness` unknown) the run's books changed in the last 10 minutes
 *    (`booksFresh`). A gone process is `[?]`. Absent `liveness`/`booksFresh`
 *    (a direct caller) reads as unknown / not fresh.
 *  - `[II]` stuck (M4c amendment 2, `isStuck`) — the answer is saved, not taken,
 *    and no live process (pid row or resume lock holder) carries the run on.
 *    A saved answer with a live process is `[▶]` working on your answer.
 *  - `[?]` crashed after taking your answer (amendment 2 (f)) — the answer was
 *    consumed, the process is gone, no end row: cannot be carried on.
 * @param {{historyRow: any, askJson: any, consumedAnswerExists: boolean, hasStateJson: boolean, resume?: any, liveness?: 'running'|'gone'|'unknown', booksFresh?: boolean, lock?: string, resumable?: boolean, stoppedAtAsk?: string|null}} ctx
 * @returns {{glyph: '[✓]'|'[✗]'|'[·]'|'[!]'|'[▶]'|'[?]'|'[II]'|'[■]', label: string}}
 */
export function computeGlyph({
  historyRow, askJson, consumedAnswerExists, hasStateJson, resume, liveness, booksFresh, lock, resumable, stoppedAtAsk,
}) {
  if (historyRow) {
    if (historyRow.outcome === 'complete') return { glyph: '[✓]', label: 'passed' };
    // M4e amendment 4 item 4: a run the human stopped, or one that hit its money cap and can be continued, is `[■]` stopped — never "failed".
    if (historyRow.outcome === 'stopped') {
      return { glyph: '[■]', label: stoppedAtAsk ? `${stoppedAtAsk}${STOPPED_AT_ASK_START_RE.test(stoppedAtAsk) ? ';' : ' —'} Resume to go on` : 'stopped — after the step that was running; Resume to go on' };
    }
    if (historyRow.outcome === 'cap-halt' && resumable) return { glyph: '[■]', label: 'stopped — the money cap was reached; raise it and Resume' };
    // M4b amendment 3: a run the human ended on purpose with rerun is not a failure.
    if (historyRow.outcome === 'rerun') return { glyph: '[✗]', label: 'stopped by you (rerun), a fresh run was started' };
    // M4c-fix amendment 1 (c): a run ended because its ask expired is `[!]` expired, never failed (it spent nothing more).
    if (historyRow.outcome === 'ask-expired') return { glyph: '[!]', label: 'ask expired — nobody answered in time' };
    return { glyph: '[✗]', label: `failed (${historyRow.outcome ?? 'unknown outcome'})` };
  }
  if (askJson && resume && resume.state === 'starting') {
    return { glyph: '[·]', label: resume.label };
  }
  if (askJson && resume && resume.state === 'not-started') {
    const stuck = stuckState({ resume, liveness, lock });
    if (stuck.stuck) return { glyph: '[II]', label: stuck.label };
    return { glyph: '[▶]', label: 'working on your answer' };
  }
  // No history row. A park never writes one, and a consumed answer file
  // stays on disk until resume writes its own history row — "no history
  // row" alone never means died.
  if (askJson && !consumedAnswerExists) {
    const expiresMs = typeof askJson.expiresAt === 'string' ? Date.parse(askJson.expiresAt) : NaN;
    if (Number.isFinite(expiresMs) && Date.now() > expiresMs) {
      return { glyph: '[!]', label: 'ask expired, not resumed yet' };
    }
    return { glyph: '[·]', label: WAITING_LABEL };
  }
  if (askJson && consumedAnswerExists) {
    // M4c: the answer was consumed — a resume process took it. Alive = working on it.
    if (liveness === 'running') return { glyph: '[▶]', label: 'working on your answer' };
    if (liveness === 'gone') return { glyph: '[?]', label: CRASHED_LABEL };
    return { glyph: '[·]', label: 'answered, not resumed yet' };
  }
  // M4c: no end row, no open ask — is a process still working? Pid row first
  // (`liveness`, src/liveness.js); with no row or no /proc (`unknown`), the
  // 10-minute books rule. Never `[▶]` off a parked ask (branches above).
  if (liveness === 'running') return { glyph: '[▶]', label: 'running' };
  if (liveness === 'gone') return { glyph: '[?]', label: 'the process working on this run is gone (no end row was written)' };
  if (booksFresh) return { glyph: '[▶]', label: 'running (no pid record; its books changed in the last 10 minutes)' };
  if (hasStateJson && !askJson) {
    return { glyph: '[?]', label: 'running or died: unknown (parked state with no open ask and no history row)' };
  }
  return { glyph: '[?]', label: 'running or died: unknown (no pid record, books older than 10 minutes)' };
}

/**
 * "$X.XXXX" or, when the book itself says the number is a floor
 * (`spendComplete:false`), "at least $X.XXXX" — never a bare total presented
 * as complete when it isn't (negative scenario iv), and never `$0` standing
 * in for a missing/unknown number (project rule).
 * @param {number|null|undefined} spentUsd
 * @param {boolean|undefined} spendComplete
 * @returns {{ok:true, display:string}|{ok:false, why:string}}
 */
export function costDisplay(spentUsd, spendComplete) {
  if (typeof spentUsd !== 'number') {
    return { ok: false, why: 'spentUsd is not a number' };
  }
  if (spendComplete === false) {
    return { ok: true, display: `at least $${spentUsd.toFixed(4)}` };
  }
  return { ok: true, display: `$${spentUsd.toFixed(4)}` };
}

/**
 * A floor summed from whatever priced rows a run's own `spend.jsonl`
 * already recorded — used ONLY when there is no history row yet (died or
 * still parked) to show "at least $X" rather than nothing/zero. `null`
 * (never `$0`) when zero rows are priced yet.
 * @param {any[]} spendRows
 * @returns {string|null}
 */
function spendFloorDisplay(spendRows) {
  const priced = spendRows.filter((r) => typeof r.costUsd === 'number' && Number.isFinite(r.costUsd));
  if (priced.length === 0) return null;
  const sum = priced.reduce((acc, r) => acc + r.costUsd, 0);
  return `at least $${sum.toFixed(4)}`;
}

/**
 * The model this run's own book rows actually name — hamr's review #1/#7:
 * no `declaration.json`/`signature.json` field records a model at all (the
 * flow's steps carry primitives and a close class, never a model choice),
 * so `audit.jsonl`'s own per-attempt `model` field (`src/books.js`'s
 * `appendAudit` row shape) is the ONLY book that can answer "what model did
 * this run use" — never invented, never defaulted to a catalogue/provider
 * default the run may not have actually hit. Reads book order BACKWARDS and
 * returns the LAST row that names a model (the most recent attempt's own
 * choice), so a run that changed model slot mid-run (would show as a
 * `modelMatch:"substituted"` row) still reports what actually ran last,
 * never a stale first-attempt value. `null` (never a guess) when no row in
 * this run ever named one (e.g. every step is `hitl`, no model step ran).
 * No provider/API-kind field exists in ANY book (`src/provider.js`'s
 * `PROVIDER_SLOTS` maps a slot name to a model, but nothing writes which
 * slot served a given run back to `audit.jsonl`/`spend.jsonl`) — provider is
 * never shown alongside it (hamr's own instruction: "if the provider isn't
 * in any book, show model only").
 * @param {any[]} auditRows
 * @returns {string|null}
 */
export function deriveRunModel(auditRows) {
  for (let i = auditRows.length - 1; i >= 0; i -= 1) {
    const m = auditRows[i]?.model;
    if (typeof m === 'string' && m.length > 0) return m;
  }
  return null;
}

/**
 * The Audit tab's "Action" column (hamr's review #6, tightened by hamr's
 * 2026-09-27 live check): exactly three words, derived STRICTLY from a
 * row's own fields — never the step name/id, never a model name, never
 * "unknown action":
 *  - "model call" — a row with a non-empty `model` field (the model itself
 *    still shows in the Cost/Verdict area elsewhere; this column names only
 *    the KIND of action).
 *  - "human" — an ask-slot row: `src/runner.js`'s `runAskSlot` is the ONLY
 *    place that ever passes a third argument (`unjudgedCount`) into
 *    `recordAudit`, so `Object.prototype.hasOwnProperty.call(row,
 *    'unjudgedCount')` is true for exactly that step's own rows (paused,
 *    and the human's own accept/redo/rerun/refused answers) and false for
 *    every other row shape in the book — a real, always-present marker
 *    (`unjudgedCount` is a number, 0 included, never omitted on an ask row),
 *    never the step's close class (a NON-ask hitl step, e.g. a plain write
 *    step, is ALSO `class:'hitl'` — that was the exact bug this replaces:
 *    class alone can't tell "the ask" apart from "any other hitl step").
 *  - "no model call" — everything else: a mechanical green/not-done/red
 *    close, a cap-halt, a send confirmation, a non-ask hitl pass-through
 *    (e.g. a write step) — no model ran and no human answered THIS row.
 * @param {any} row one `audit.jsonl` row
 * @returns {'model call'|'human'|'no model call'}
 */
export function deriveAuditAction(row) {
  if (row && Object.prototype.hasOwnProperty.call(row, 'unjudgedCount')) return 'human';
  if (typeof row?.model === 'string' && row.model.length > 0) return 'model call';
  return 'no model call';
}

/**
 * The Audit tab's Cost cell token phrase (hamr's 2026-09-27 review item c):
 * a per-ROW token total, read through `auditRowTokens` (`src/books.js`) so
 * this module never re-derives "was this row written before M4a-2" itself.
 * Three honest outcomes, never folded into one another:
 *  - `{kind:'total', total}` — a real (post-M4a-2) model-call row: `total`
 *    sums ALL three fields the row's own `tokens` object carries
 *    (`inputTokens + outputTokens + cacheReadTokens`) — every token this
 *    row's call actually touched, cache-read included (labelled plainly as
 *    "N tokens", never split out here; a cache-read token is still a token
 *    the call processed, so folding it into the total is the honest sum,
 *    not a hidden discount).
 *  - `{kind:'not-recorded'}` — a row written before Amendment M4a-2 (no
 *    `tokens` key at all) — shown as "tokens not recorded", never a 0 or a
 *    blank.
 *  - `{kind:'no-model'}` — a post-M4a-2 row that genuinely carries no model
 *    call (`tokens:null`, `model:null` — an ask/hitl row) — the tokens
 *    phrase is omitted entirely rather than shown as "0 tokens" or "not
 *    recorded" (there was never anything to record).
 * @param {any} row one `audit.jsonl` row
 * @returns {{kind:'total', total:number}|{kind:'not-recorded'}|{kind:'no-model'}}
 */
export function deriveAuditTokensDisplay(row) {
  const result = auditRowTokens(row);
  if (result.tokens === null) {
    return result.why ? { kind: 'not-recorded' } : { kind: 'no-model' };
  }
  const { inputTokens, outputTokens, cacheReadTokens } = result.tokens;
  return { kind: 'total', total: inputTokens + outputTokens + cacheReadTokens };
}

/**
 * hamr's request (Amendment M4a-3): the Audit tab's Action cell gets a
 * one-line tool tally appended for a MODEL-call row whose own `tools` was
 * actually recorded (Amendment M4a-3) — `", read 3, write 1"` — read
 * straight through `auditRowTools` (`src/books.js`), never re-derived. Three
 * honest outcomes, matching `deriveAuditTokensDisplay`'s own shape exactly:
 * `null` for a non-model row (nothing to append — a human/no-model-call row
 * never claims a tool tally), `null` for a pre-M4a-3 model row (`why` set —
 * appending nothing beats guessing a tally that was never recorded), and a
 * real phrase, sorted by count desc then name, for a model row that DOES
 * carry `tools` (including `{}` — zero tool calls that round — which still
 * returns `null`: there is nothing to list, so nothing is appended).
 * @param {any} row one `audit.jsonl` row
 * @returns {string|null}
 */
export function deriveAuditToolsPhrase(row) {
  if (!(typeof row?.model === 'string' && row.model.length > 0)) return null;
  const { tools, why } = auditRowTools(row);
  if (why || !tools) return null;
  const entries = Object.entries(tools).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (entries.length === 0) return null;
  return entries.map(([name, count]) => `${name} ${count}`).join(', ');
}

/**
 * Amendment M4a-3's own step-level tool tally, the same honesty rules
 * `deriveAuditGroups` already applies to `tokensTotal`: sums `auditRowTools`
 * over every row in one step's own group. `toolsTotal` is `null` (never a
 * guessed `{}`) when the step made no model call at all (nothing to sum) OR
 * when ANY model-call row in the step predates Amendment M4a-3 (`why` set on
 * that row) — a partial sum is never shown as if it were the whole step's
 * total, mirroring the tokens rule exactly. `ungranted` unions every row's
 * own `ungranted` list (deduped, insertion order) regardless of whether the
 * total itself could be summed — an ungranted call is never hidden just
 * because an earlier row in the same step predates M4a-3.
 * @param {any[]} rows one step's own audit rows (book order)
 * @returns {{toolsTotal: Record<string, number>|null, toolsWhy: string|null, ungranted: string[]}}
 */
function summarizeStepTools(rows) {
  let sawModelRow = false;
  let anyNotRecorded = false;
  const totals = {};
  const ungrantedSeen = [];
  const ungrantedSet = new Set();
  for (const r of rows) {
    const hasModel = typeof r.model === 'string' && r.model.length > 0;
    const { tools, ungranted, why } = auditRowTools(r);
    for (const u of ungranted) {
      if (!ungrantedSet.has(u)) { ungrantedSet.add(u); ungrantedSeen.push(u); }
    }
    if (!hasModel) continue;
    sawModelRow = true;
    if (why) { anyNotRecorded = true; continue; }
    if (tools) {
      for (const [name, count] of Object.entries(tools)) totals[name] = (totals[name] ?? 0) + count;
    }
  }
  if (!sawModelRow) return { toolsTotal: null, toolsWhy: null, ungranted: ungrantedSeen };
  if (anyNotRecorded) {
    return { toolsTotal: null, toolsWhy: 'not recorded (before M4a-3)', ungranted: ungrantedSeen };
  }
  const sorted = Object.entries(totals).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  return { toolsTotal: Object.fromEntries(sorted), toolsWhy: null, ungranted: ungrantedSeen };
}

/**
 * The Audit tab's new Time column (hamr's 2026-09-27 review item d): this
 * row's own `why` when `at` predates Amendment M4a-2, else `null` (the row
 * DOES carry a real `at` — the client formats it with `readableDateTime`,
 * the same local-time formatter every other timestamp on this page already
 * uses; formatting to the viewer's own locale belongs in the browser, not
 * here). Read through `auditRowAt` (`src/books.js`) — never re-derived.
 * @param {any} row one `audit.jsonl` row
 * @returns {string|null}
 */
export function deriveAuditAtWhy(row) {
  return auditRowAt(row).why ?? null;
}

/**
 * hamr's 2026-09-27 exit-check review #2: the Audit tab's Blocked filter —
 * ONE server-side function naming exactly which verdicts count as "did not
 * pass", derived strictly from a row's own `verdict` string (never a second,
 * client-side guess). Blocked: `not-done`, `red` (a mechanical close miss OR
 * a human's own redo on a hitl step — both are "this attempt did not
 * pass"), `refused` (a blank redo/rerun reason), `ask-timeout` and
 * `ask-expired` (the human never answered in time), `cap-halt`,
 * `provider-red`, `pricing-red`, `close-casualty` (every other halt shape
 * `src/runner.js` records). NOT blocked: `green`/`hitl` (passed), `paused`
 * (still open — waiting, not yet failed), `stale-answer-ignored` (a book
 * hygiene note about a late answer, not an attempt outcome).
 * @param {string|null|undefined} verdict
 * @returns {boolean}
 */
const BLOCKED_VERDICTS = new Set([
  'not-done', 'red', 'refused', 'ask-timeout', 'ask-expired', 'cap-halt', 'provider-red', 'pricing-red', 'close-casualty',
]);
export function isBlockedVerdict(verdict) {
  return typeof verdict === 'string' && BLOCKED_VERDICTS.has(verdict);
}

/**
 * hamr's 2026-09-27 exit-check review #1: one mark per TRY (never per raw
 * audit row — a `hitl`-classed ask step's `paused` row and its own
 * resolution row are the SAME try, the same pairing `computeTryCount`
 * already applies) for the Audit tab's grouped-by-step header. `✓` passed
 * (`green`/`hitl`), `✗` failed/redone/blocked (everything
 * `isBlockedVerdict` names, plus any other non-passing verdict), `·` still
 * open (`paused`/`refused`/`ask-timeout`/`ask-expired` — waiting, not yet
 * resolved either way). A `refused` (blank-reason) row is its own re-ask,
 * not a resolution, so it reads as `·` like `paused` — the try it belongs to
 * is still open.
 * @param {string|null|undefined} verdict
 * @param {string|null|undefined} closeClass
 * @returns {'✓'|'✗'|'·'}
 */
function markForVerdict(verdict, closeClass) {
  if (closeClass === 'hitl' && verdict === 'red') return '✗'; // the human's own redo
  if (verdict === 'green' || verdict === 'hitl') return '✓';
  if (verdict === 'paused' || verdict === 'refused' || verdict === 'ask-timeout' || verdict === 'ask-expired' || verdict === 'ask-reopened' || verdict === 'lock-removed' || verdict === 'stop-asked' || verdict === 'stopped' || verdict === 'stop-not-honoured') return '·';
  return '✗';
}

/**
 * One mark per try, in try order — mirrors `computeTryCount`'s own pairing
 * exactly (a `hitl` step's `paused` row plus its next resolving row is ONE
 * try; every other step's own row is ONE try each) so a group header's
 * `tryMarks.length` always equals its own `tryCount`. A `paused` row with no
 * resolution yet in this run's own book order keeps its `·` mark (still
 * open, not resolved).
 * @param {string|null} closeClass
 * @param {Array<{verdict:string}>} rows one step's own audit rows, book order
 * @returns {Array<'✓'|'✗'|'·'>}
 */
export function deriveStepTryMarks(closeClass, rows) {
  if (!rows || !rows.length) return [];
  if (closeClass === 'hitl') {
    const pausedIdxs = [];
    rows.forEach((r, i) => { if (r.verdict === 'paused') pausedIdxs.push(i); });
    if (pausedIdxs.length === 0) {
      // No paused row at all is not a shape this step produces in practice
      // (guarded the same way `computeTryCount` already is) — one mark per
      // row rather than hiding that a try happened.
      return rows.map((r) => markForVerdict(r.verdict, closeClass));
    }
    return pausedIdxs.map((idx, i) => {
      // The resolving row is the LAST row before the next `paused` boundary
      // (or the end of the run), never the first non-paused row after this
      // one: a blank-reason `refused` re-ask (`src/runner.js`'s redo loop
      // never writes a new `paused` row for it — it just re-asks in place)
      // can sit BETWEEN a `paused` row and its real resolution, and taking
      // the first non-paused row would wrongly read that in-progress re-ask
      // as the try's own outcome.
      const nextPausedIdx = pausedIdxs[i + 1] ?? rows.length;
      const lastIdx = nextPausedIdx - 1;
      if (lastIdx === idx) return '·'; // still paused, no resolution row yet in this run's book
      return markForVerdict(rows[lastIdx].verdict, closeClass);
    });
  }
  return rows.map((r) => markForVerdict(r.verdict, closeClass));
}

/** A Stop's notes are not tries: the asked/not-honoured rows, and a `stopped` row that cut no try (no attempt number). */
function isTryRow(r) {
  return r.verdict !== 'stop-asked' && r.verdict !== 'stop-not-honoured' && !(r.verdict === 'stopped' && !Number.isInteger(r.attempt));
}

/** The name of the one group for audit rows that name no step. */
const RUN_GROUP = 'run';
/** The one decider of a row's step name for the Audit tab: its step, else the run's own group name. */
function auditStepName(step) {
  return typeof step === 'string' && step.length > 0 ? step : RUN_GROUP;
}

/**
 * A step group's own state word for the Audit tab's collapsed header —
 * the ONE decider of a step's state: the Run tab's map and cards read it too
 * (`groupState` on each step; the page keeps no rule of its own), last-row-wins: `waiting`
 * (the run is currently parked on this step — its last attempt's verdict is
 * `paused`/`refused`), `done` (the last attempt passed — `green`/`hitl`),
 * `user-stopped` (M4e amendment 10: the step's own last row is `stopped`, a Stop
 * the human asked), `stopped` (the last attempt failed for any other reason). A group only
 * ever exists for a step with at least one row, so `pending` never appears
 * here (unlike the Run tab's map, which also covers never-attempted steps).
 * @param {Array<{verdict:string}>} rows one step's own audit rows, book order
 * @returns {'done'|'waiting'|'stopped'|'user-stopped'}
 */
export function deriveStepGroupState(rows) {
  // a Stop's notes (asked / not honoured) say nothing about the step's own state; a step with only notes reads as stopped
  const own = rows.filter((r) => r.verdict !== 'stop-asked' && r.verdict !== 'stop-not-honoured');
  const last = own.length > 0 ? own[own.length - 1] : rows[rows.length - 1];
  if (last.verdict === 'paused' || last.verdict === 'refused') return 'waiting';
  if (last.verdict === 'stopped') return 'user-stopped';
  return (last.verdict === 'green' || last.verdict === 'hitl') ? 'done' : 'stopped';
}

/**
 * hamr's 2026-09-27 exit-check review #1: the Audit tab's grouped-by-step
 * header pieces, computed HERE (server-side) so `src/panel/index.html` only
 * ever renders them, never re-derives them. One entry per step, first-seen
 * order preserved (never re-sorted): `step` (the emits id, the header IS the
 * step's own name — no separate Step column in Grouped view), `state`
 * (`deriveStepGroupState`), `closeClass`, `timeMs` (this step's own attempts'
 * `wallMs` summed — "total time from wallMs", never a guess), `cost`/
 * `costWhy` (a bare `$X` sum when every priced row is complete, `"at least
 * $X"` when any priced row in this step is a floor, `null`+why when no row
 * in this step has ever priced), `tokensTotal` (the sum of every row's own
 * token total, ONLY when every row in the step either carries real
 * (post-M4a-2) tokens or genuinely made no model call — one row missing
 * tokens (a pre-M4a-2 row) means the WHOLE step's total is withheld, never a
 * partial sum shown as complete; `null` also when the step made no model
 * call at all, nothing to sum), `toolsTotal`/`toolsWhy`/`ungranted`
 * (Amendment M4a-3, `summarizeStepTools` — the same "no partial sum" honesty
 * rule as `tokensTotal`, plus the deduped union of every row's own
 * `ungranted` calls), `tryCount`/`tryMarks` (`deriveStepTryMarks`),
 * `rows` (this step's own enriched audit rows, for the group's own table —
 * never a second, separately-filtered copy on the client).
 * @param {any[]} enrichedRows `getRunAudit`'s own rows, already carrying
 *   `action`/`tokensDisplay`/`atWhy`/`blocked` (this function never
 *   re-derives any of those, only groups and sums them)
 * @returns {any[]}
 */
export function deriveAuditGroups(enrichedRows) {
  const order = [];
  const byStep = new Map();
  // a row naming no step (a Stop before step 1) is the run's own: one group, `run: true`, never a null id
  for (const r of enrichedRows) {
    const key = typeof r.step === 'string' && r.step.length > 0 ? r.step : null;
    if (!byStep.has(key)) { byStep.set(key, []); order.push(key); }
    byStep.get(key).push(r);
  }
  return order.map((key) => {
    const rows = byStep.get(key);
    const step = auditStepName(key);
    const closeClass = rows[0].class ?? null;
    const timeMs = rows.reduce((acc, r) => acc + (typeof r.wallMs === 'number' ? r.wallMs : 0), 0);

    const priced = rows.filter((r) => typeof r.usd === 'number' && Number.isFinite(r.usd));
    let cost = null;
    let costWhy = null;
    if (priced.length === 0) {
      costWhy = 'no row in this step has a known cost yet';
    } else {
      const sum = priced.reduce((acc, r) => acc + r.usd, 0);
      const partial = priced.some((r) => r.spendComplete === false);
      const cd = costDisplay(sum, partial ? false : true);
      cost = cd.ok ? cd.display : null;
      if (!cd.ok) costWhy = cd.why;
    }

    let anyNotRecorded = false;
    let anyTotal = false;
    let tokensTotal = 0;
    for (const r of rows) {
      const td = r.tokensDisplay;
      if (td && td.kind === 'not-recorded') anyNotRecorded = true;
      else if (td && td.kind === 'total') { anyTotal = true; tokensTotal += td.total; }
    }
    const tokensTotalValue = (anyNotRecorded || !anyTotal) ? null : tokensTotal;

    const tryMarks = deriveStepTryMarks(closeClass, rows.filter(isTryRow));
    const { toolsTotal, toolsWhy, ungranted } = summarizeStepTools(rows);
    return {
      step,
      state: deriveStepGroupState(rows),
      closeClass,
      timeMs,
      cost,
      costWhy,
      tokensTotal: tokensTotalValue,
      toolsTotal,
      toolsWhy,
      ungranted,
      tryCount: key === null ? 0 : tryMarks.length,
      tryMarks: key === null ? [] : tryMarks,
      ...(key === null ? { run: true } : {}),
      rows,
    };
  });
}

/**
 * Run-level totals from `spend.jsonl` (hamr's review #1): rounds, input/
 * output/cache-read tokens — shown ONLY as a run-wide sum, never attributed
 * to a step (a spend row carries no `step` field at all — `src/model-step.js`
 * appends it before any step identity is threaded through, so per-step
 * attribution would be invented, not read). Honest about partial data: a
 * field this run's rows never populated (e.g. no row ever carried
 * `tokens.cacheReadTokens`) is `null` with its own `*Why`, never folded into
 * a 0. `null` `rows`/`empty:true` (with a why) when spend.jsonl has no rows
 * at all yet.
 * @param {any[]} spendRows
 * @returns {{empty:true, why:string}|{empty:false, rounds:number, tokensIn:number|null, tokensInWhy:string|null, tokensOut:number|null, tokensOutWhy:string|null, cacheReadTokens:number|null, cacheReadTokensWhy:string|null}}
 */
export function summarizeSpendRows(spendRows) {
  if (!Array.isArray(spendRows) || spendRows.length === 0) {
    return { empty: true, why: 'spend.jsonl has no rows yet (no model round has been priced)' };
  }
  const rounds = spendRows.reduce((acc, r) => acc + (typeof r.rounds === 'number' ? r.rounds : 0), 0);
  const sumTokenField = (field) => {
    let any = false;
    let total = 0;
    for (const r of spendRows) {
      const v = r?.tokens?.[field];
      if (typeof v === 'number' && Number.isFinite(v)) { any = true; total += v; }
    }
    return any ? total : null;
  };
  const tokensIn = sumTokenField('inputTokens');
  const tokensOut = sumTokenField('outputTokens');
  const cacheReadTokens = sumTokenField('cacheReadTokens');
  return {
    empty: false,
    rounds,
    tokensIn,
    tokensInWhy: tokensIn === null ? 'no spend.jsonl row recorded input tokens' : null,
    tokensOut,
    tokensOutWhy: tokensOut === null ? 'no spend.jsonl row recorded output tokens' : null,
    cacheReadTokens,
    cacheReadTokensWhy: cacheReadTokens === null ? 'no spend.jsonl row recorded cache-read tokens' : null,
  };
}

/**
 * Read every book fwdloop can hold for one run, once. The shared context
 * every deriver below (and the POC before it) builds its fields from.
 * @param {string} root
 * @param {string} flowDir
 * @param {string} runDir
 * @param {string} flowName
 * @param {string} runId
 * @param {any} catalogue
 * @param {any} [attempt] the panel's in-memory resume-attempt record for this run, or null
 * @returns {any}
 */
function loadRunContext(root, flowDir, runDir, flowName, runId, catalogue, attempt = null) {
  const flowRead = readFlow({ root, name: flowName, catalogue });
  // M4e amendment 5 item 3 / amendment 4 item 6: the run's own signed values (its newest version) lie over the flow's
  const inForce = flowRead.ok ? applyRunValues(flowRead.arbiter, flowName, flowRead.signature.flow, pickRunValues(runDir)) : null;
  const historyRows = readHistory(flowDir);
  const historyRow = endRow(historyRows, runDir, runId);
  const halt = readHaltRecord(runDir);
  const auditRows = readAudit(runDir);
  const spendRows = readSpendRows(join(runDir, 'spend.jsonl'));
  const logJson = readLog(runDir);
  const askJson = readAsk(runDir);
  const stateJson = readRunState(runDir);
  const consumedAnswerExists = hasConsumedAnswer(runDir, askJson && typeof askJson.askId === 'string' ? askJson.askId : null);
  // A finished run has no resume to report (its history row says how it ended).
  const resume = historyRow ? null : deriveResumeState({ savedAnswer: readSavedAnswer(runDir), attempt, ask: askJson });
  const stuckInputs = historyRow ? { liveness: 'unknown', lock: 'none' } : readStuckInputs(runDir);

  return {
    flowName,
    runId,
    flowDir,
    runDir,
    flowRead,
    // the arbiter this run executes under (the flow's own unless the run has signed values), or null when the flow does not read
    arbiter: inForce && inForce.ok ? inForce.arbiter : (flowRead.ok ? flowRead.arbiter : null),
    historyRow,
    // M4e amendment 4 item 4: a cap-halted or stopped run that can be continued (`halt.json` is the runner's record)
    resumable: halt.ok && historyRow !== null && historyRow.outcome === halt.halt.outcome,
    // M6 F5: the job on disk is still the one the run halted under (the runner refuses a Resume otherwise: "signature mismatch")
    sameJob: halt.ok && flowRead.ok && halt.halt.signatureHash === flowRead.signature.flow,
    // amendment 16 I4: how a stopped run was stopped, in the runner's own words (`stopped at the ask of step N`), or null (stopped after a step)
    stoppedAtAsk: lastStoppedAtAsk(runDir, auditRows, historyRow !== null),
    auditRows,
    spendRows,
    logJson,
    askJson,
    stateJson,
    consumedAnswerExists,
    hasStateJson: stateJson !== null,
    resume,
    // M4c: only read for a run with no end row (an end row always wins).
    liveness: stuckInputs.liveness,
    lock: stuckInputs.lock,
    booksFresh: historyRow ? false : booksFresh(runDir),
    // M4c exit walk: when the process that is working on the run started (its newest pid row's
    // own `startedAt`), so a `[▶]` run has a real time and never "parked or died". Not a book change.
    startedAt: historyRow ? null : lastPidStartedAt(runDir),
  };
}

const STOPPED_AT_ASK_RE = /^stopped at the ask of step \d+$/;
const STOPPED_AT_ASK_START_RE = /^stopped at the ask of step \d+/;
/**
 * The ONE reader of the words a stopped ask wears (amendment 19 3): for each ask, oldest-first, the `stopped at the ask of step N`
 * row written for the step `deriveAskStepInfo` pairs it with, or null when the books cannot name that step (never a guess; never
 * by counting those rows in order: a Stop that landed before any ask parked writes one too, with no ask behind it).
 * @param {any[]} ordered `runAsksInOrder`'s asks, oldest-first @param {any[]} audit this run's audit rows
 * @returns {(string|null)[]}
 */
function stoppedAskWords(ordered, audit) {
  const stepOf = deriveAskStepInfo(ordered, audit, null);
  const atAsk = audit.filter((r) => r.verdict === 'stopped' && STOPPED_AT_ASK_RE.test(String(r.gap)));
  return ordered.map((_, i) => {
    if (stepOf[i].step === null) return null;
    const words = atAsk.filter((r) => r.step === stepOf[i].step).pop()?.gap;
    return typeof words === 'string' ? words : null;
  });
}

/** What the Runs label says of a run stopped at an ask whose step the books cannot name; the Ask tab and the Inbox say the same. */
const STOPPED_STEP_UNKNOWN = 'stopped';
/** The whole line a stopped run reads when its step cannot be named (Runs, Ask and Inbox alike; am41 item 4). `computeGlyph` builds the same words from STOPPED_STEP_UNKNOWN. */
const STOPPED_UNKNOWN_LINE = `${STOPPED_STEP_UNKNOWN} — Resume to go on`;

/**
 * How a stopped run was stopped, for its Runs label: the newest `stopped` audit row, when the runner wrote its `gap` as
 * `stopped at the ask of step N` (amendment 13's signed words) -> those words, as the Ask tab's row for that ask reads them
 * (`stoppedAskWords`, the one reader); `stopped` alone when the step cannot be known; null for any other stop (after a step, before step 1).
 * @param {string} runDir @param {any[]} auditRows @param {boolean} hasHistoryRow @returns {string|null}
 */
function lastStoppedAtAsk(runDir, auditRows, hasHistoryRow) {
  const stopped = auditRows.filter((r) => r.verdict === 'stopped' && typeof r.gap === 'string' && !Number.isInteger(r.attempt));
  const last = stopped.length > 0 ? stopped[stopped.length - 1] : null;
  if (!last || !STOPPED_AT_ASK_RE.test(last.gap)) return null;
  const ordered = runAsksInOrder(runDir, hasHistoryRow);
  const stepOf = deriveAskStepInfo(ordered, auditRows, null);
  const words = stoppedAskWords(ordered, auditRows);
  const i = stepOf.findIndex((x) => x.step !== null && x.step === last.step);
  return i >= 0 && words[i] !== null ? words[i] : STOPPED_STEP_UNKNOWN;
}

/** @param {string} runDir @returns {string|null} */
function lastPidStartedAt(runDir) {
  const rows = readPidRows(runDir);
  const at = rows[rows.length - 1]?.startedAt;
  return typeof at === 'string' && !Number.isNaN(Date.parse(at)) ? at : null;
}

/** The ONE running rule for wording is the glyph's own (`computeGlyph` -> `[▶]`, which already
 *  folds in `runLiveness`): a run with no end row whose glyph is `[▶]` is running. */
const RUNNING_WHY = 'still running — not finished yet';
/** @param {any} ctx @param {string} glyph */
const isRunningNow = (ctx, glyph) => !ctx.historyRow && glyph === '[▶]';

/**
 * M4e amendment 4 item 4: the ONE decision for the Run tab's Stop and Resume buttons (the Stop and Resume doors read the
 * same object, so the page never offers what the door would refuse). `running` is the glyph's own rule (`isRunningNow`);
 * a run with no process record yet is `starting`; a parked run (`[·]`/`[!]`, an open ask) is neither.
 * @param {any} ctx `loadRunContext`'s result @param {string} glyph `computeGlyph`'s sign
 * @returns {{canStop: boolean, atAsk: boolean, stopRequested: boolean, starting: boolean, canResume: boolean, resumeOutcome: string|null, spentUsd: number|null, spendComplete: boolean|null, capUsd: number|null}}
 */
export function runControls(ctx, glyph, label = '') {
  // M6 F1: ask.json stays on disk once the human has answered, so it blocks `running` only while the ask is unanswered
  // (`[▶]` with an ask is only ever "working on your answer": a saved answer, or a consumed one with a live process).
  const running = isRunningNow(ctx, glyph) && (!ctx.askJson || ctx.consumedAnswerExists || ctx.resume?.state === 'not-started');
  // M4e amendment 13: a run waiting at its ask (open, unanswered, not expired) shows Stop too; it stops the run at the ask.
  const atAsk = !ctx.historyRow && !!ctx.askJson && glyph === '[·]' && label === WAITING_LABEL;
  const starting = !ctx.historyRow && !ctx.askJson && readPidRows(ctx.runDir).length === 0;
  const canResume = ctx.resumable === true && ctx.sameJob === true;
  return {
    canStop: running || atAsk,
    atAsk,
    stopRequested: running && stopPending(ctx.runDir),
    starting,
    canResume,
    resumeOutcome: canResume ? ctx.historyRow.outcome : null,
    spentUsd: canResume && typeof ctx.historyRow.spentUsd === 'number' ? ctx.historyRow.spentUsd : null,
    spendComplete: canResume ? ctx.historyRow.spendComplete !== false : null,
    capUsd: canResume && typeof ctx.historyRow.capUsd === 'number' ? ctx.historyRow.capUsd : null,
  };
}

/**
 * `runControls` for one run read straight from the books (the Stop door's own read). `null` when the run does not resolve.
 * @param {{root: string, flow: string, runId: string, catalogue: any}} opts
 */
export function getRunControls({
  root, flow, runId, catalogue,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok || !existsSync(run.runDir)) return null;
  const ctx = loadRunContext(root, run.flowDir, run.runDir, flow, runId, catalogue, null);
  const g = computeGlyph(ctx);
  return runControls(ctx, g.glyph, g.label);
}

/**
 * `GET /api/runs` — every flow under `root`, every run under each flow
 * (M4a scope item 2). A flow with zero runs still gets one row (`runId:
 * null`, an explicit `why`) — no flow is silently missing from the list.
 * Ordered by `orderRuns` (waiting on you, running, then newest `at` first; a row
 * with no `at` is never given a guessed one).
 * @param {{root: string, catalogue: any, resumeAttempt?: (flow: string, runId: string) => any}} opts
 *   `resumeAttempt`: the panel's in-memory resume-attempt lookup (M4b piece 2); absent = none.
 * @returns {any[]}
 */
export function listRuns({ root, catalogue, resumeAttempt }) {
  const rows = [];
  for (const flowName of listFlowNames(root)) {
    const flowDir = join(root, flowName);
    const runIds = listRunIds(flowDir);
    if (runIds.length === 0) {
      rows.push({
        flow: flowName, runId: null, glyph: null, label: null, spend: null, at: null,
        why: 'this flow has no runs yet',
      });
      continue;
    }
    for (const runId of runIds) {
      const run = resolveRunPath(root, flowName, runId);
      if (!run.ok) {
        rows.push({
          flow: flowName, runId, glyph: null, label: null, spend: null, at: null, why: run.red,
        });
        continue;
      }
      const ctx = loadRunContext(root, run.flowDir, run.runDir, flowName, runId, catalogue, resumeAttempt?.(flowName, runId) ?? null);
      const { glyph, label } = computeGlyph(ctx);
      // M4c amendment 1 (c): the ask waiting on the human, by the same rule
      // listStops uses (deriveAskOpenFields) — the least time left if several.
      const waitingAsk = runAsksInOrder(run.runDir, !!ctx.historyRow)
        .map((ask) => ({ ask, ...deriveAskOpenFields(ask, !!ctx.historyRow, ctx.resume) }))
        .filter((r) => r.waiting)
        .reduce((best, r) => (best === null || (r.timeLeftMs ?? Infinity) < (best.timeLeftMs ?? Infinity) ? r : best), /** @type {any} */ (null));
      let spend;
      if (ctx.historyRow) {
        const cd = costDisplay(ctx.historyRow.spentUsd, ctx.historyRow.spendComplete);
        spend = cd.ok ? cd.display : null;
      } else {
        spend = spendFloorDisplay(ctx.spendRows);
      }
      // browser re-walk bug #4: a parked run's ask.json holds a real,
      // book-held timestamp (`askedAt`) — a run with an open ask is never
      // "unknown", even with no history row yet. `atWhy`'s generic "no
      // history row" text is reserved for the case that's ACTUALLY true of
      // it: no history row AND no ask either (e.g. died before ever
      // parking) — never rendered when the books do hold a date.
      const askedAt = (!ctx.historyRow && ctx.askJson && typeof ctx.askJson.askedAt === 'string')
        ? ctx.askJson.askedAt
        : null;
      rows.push({
        flow: flowName,
        runId,
        glyph,
        label,
        ...signParts(glyph, label, ctx.historyRow?.outcome === 'rerun'),
        pulse: glyphPulses({ glyph, label }),
        stuck: glyph === '[II]',
        controls: runControls(ctx, glyph, label),
        resume: ctx.resume,
        spend,
        spendWhy: (!ctx.historyRow && spend === null)
          ? (isRunningNow(ctx, glyph) ? 'running — no priced spend yet' : 'no history row yet and no priced spend.jsonl rows — nothing to floor')
          : null,
        waiting: waitingAsk !== null,
        waitingAskId: waitingAsk ? waitingAsk.ask.askId : null,
        timeLeftMs: waitingAsk ? waitingAsk.timeLeftMs : null,
        at: ctx.historyRow ? ctx.historyRow.at : null,
        wallMs: ctx.historyRow && typeof ctx.historyRow.wallMs === 'number' ? ctx.historyRow.wallMs : null,
        askedAt,
        startedAt: isRunningNow(ctx, glyph) ? ctx.startedAt : null,
        atWhy: (ctx.historyRow || askedAt) ? null
          : isRunningNow(ctx, glyph)
            ? (ctx.startedAt ? null : 'running — start time not recorded (no pid record)')
            : 'no history row yet (parked or died before one was written)',
      });
    }
  }
  return orderRuns(rows);
}

/**
 * The ONE ordering of Runs — History and Workflows both render the list in the
 * order given (M4c amendment 1 (c)); a flow's top row is therefore the first
 * run of that flow here, so a waiting run is the parent with no second rule:
 *  1 waiting on you — least time left first; a stuck run (`[II]`, amendment 2)
 *    after the ones with a timer;
 *  2 running (`[▶]`, the glyph's own liveness rule);
 *  3 everything else — finish time `at`, newest first.
 * A row with no known time keeps input order at the end of its section.
 * @param {any[]} rows
 * @returns {any[]}
 */
export function orderRuns(rows) {
  const sectionOf = (r) => ((r.waiting || r.stuck) ? 1 : r.glyph === '[▶]' ? 2 : 3);
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const sa = sectionOf(a.row);
      const sb = sectionOf(b.row);
      if (sa !== sb) return sa - sb;
      if (sa === 1) {
        if (!!a.row.stuck !== !!b.row.stuck) return a.row.stuck ? 1 : -1;
        const at = typeof a.row.timeLeftMs === 'number' ? a.row.timeLeftMs : Infinity;
        const bt = typeof b.row.timeLeftMs === 'number' ? b.row.timeLeftMs : Infinity;
        return at !== bt ? at - bt : a.index - b.index;
      }
      const am = typeof a.row.at === 'string' ? Date.parse(a.row.at) : NaN;
      const bm = typeof b.row.at === 'string' ? Date.parse(b.row.at) : NaN;
      const aKnown = Number.isFinite(am);
      const bKnown = Number.isFinite(bm);
      if (aKnown && bKnown && am !== bm) return bm - am;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/**
 * hamr's 2026-09-27 step-card review: the ONE place raw `audit.jsonl` rows
 * get their server-derived fields (`action`/`tokensDisplay`/`atWhy`/
 * `blocked`) added — called by BOTH `getRunAudit` (the Audit tab) and
 * `getRunDetail` (the Run tab's step cards), off the SAME raw rows, so
 * `deriveAuditGroups` run on this output always produces identical numbers
 * for both tabs. Never mutates `rawRows`.
 * @param {any[]} rawRows `readAudit`'s own rows for one run
 * @returns {any[]}
 */
function enrichAuditRows(rawRows) {
  return rawRows.map((row) => ({
    ...row,
    stepName: auditStepName(row.step),
    action: deriveAuditAction(row),
    tokensDisplay: deriveAuditTokensDisplay(row),
    toolsPhrase: deriveAuditToolsPhrase(row),
    atWhy: deriveAuditAtWhy(row),
    blocked: isBlockedVerdict(row.verdict),
  }));
}

/**
 * "try N" (map node / step-card badge) counts different things for
 * different close classes, and must never just be `attempts.length` (browser
 * re-walk bug #2): an ask (`hitl`-classed) step's audit rows are
 * paused/answer PAIRS — a `paused` row starts one ask shown to the human,
 * and its very next resolution row (the reject or the accept) is that SAME
 * try, never a second one. So a paused, reject, paused, accept shape (4
 * rows) is 2 tries, not 4. A model-classed step has no pause/answer
 * pairing at all — each row IS one model attempt, so try N stays
 * `list.length` there, unchanged from before this fix.
 * @param {string|null} closeClass
 * @param {Array<{verdict:string}>} listAll
 * @returns {number}
 */
function computeTryCount(closeClass, listAll) {
  const list = (listAll ?? []).filter(isTryRow);
  if (!list.length) return 0;
  if (closeClass === 'hitl') {
    const pausedCount = list.filter((a) => a.verdict === 'paused').length;
    // No paused row at all is not a shape this step ever produces in
    // practice, but falls back to the row count rather than 0 — a missing
    // pause is never grounds to hide that a try happened.
    return pausedCount > 0 ? pausedCount : list.length;
  }
  return list.length;
}

/**
 * `GET /api/runs/:flow/:runId` — the Run tab (M4a scope item 2): the step
 * map from `declaration.steps`, step cards -> attempts from `audit.jsonl`
 * (verdict, gap, cost, model, strike), and what the model wrote from
 * `log.json`. `null` when the flow/runId doesn't resolve to a real run
 * directory at all (caller renders 404); a `red` field names why a
 * sub-derivation couldn't fill (never invented).
 * @param {{root: string, flow: string, runId: string, catalogue: any, resumeAttempt?: (flow: string, runId: string) => any}} opts
 * @returns {any|null}
 */
export function getRunDetail({
  root, flow, runId, catalogue, resumeAttempt,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;

  const ctx = loadRunContext(root, run.flowDir, run.runDir, flow, runId, catalogue, resumeAttempt?.(flow, runId) ?? null);
  const { glyph, label } = computeGlyph(ctx);

  // hamr's 2026-09-27 step-card review: the Run tab's step cards reuse the
  // EXACT SAME per-step group numbers (timeMs/cost/tokensTotal/tryMarks/
  // state) the Audit tab's own group headers show — computed here off the
  // SAME enriched rows `getRunAudit` builds (via the shared
  // `enrichAuditRows`/`deriveAuditGroups` pair), never a second, separately
  // summed copy. A step with no audit rows at all (never attempted) has no
  // entry here — its card falls back to "not started", same as before.
  const auditGroupsByStep = {};
  for (const g of deriveAuditGroups(enrichAuditRows(ctx.auditRows))) auditGroupsByStep[g.step] = g;

  let steps = null;
  let stepsWhy = null;
  if (!ctx.flowRead.ok) {
    stepsWhy = `readFlow refused: ${ctx.flowRead.reds.join('; ')}`;
  } else {
    const declSteps = ctx.flowRead.declaration.steps;
    if (!Array.isArray(declSteps) || declSteps.length === 0) {
      stepsWhy = 'declaration.json has no steps array';
    } else {
      const byStep = {};
      const byStepAuditIdx = {}; // step -> this row's index in ctx.auditRows, parallel to byStep[step]
      ctx.auditRows.forEach((row, auditIdx) => {
        (byStep[row.step] ??= []).push({
          attempt: row.attempt,
          verdict: row.verdict,
          gap: row.gap,
          cost: row.usd,
          spendComplete: row.spendComplete,
          model: row.model,
          modelMatch: row.modelMatch,
          strike: row.strike,
          afterReject: null,
        });
        (byStepAuditIdx[row.step] ??= []).push(auditIdx);
      });
      // A step's own attempt numbers can repeat/restart in book order after
      // a human reject (src/runner.js's redo path numbers a redo from the
      // reject count, not the previous attempt counter — M4a piece 3 fix
      // #6). Never renumber or hide a row; instead name the boundary, but
      // ONLY on a non-ask step: an ask (`hitl`-classed) step's OWN rows
      // legitimately repeat the same attempt number for a paused row
      // followed by its own resolution (paused N, then red/green N) — that
      // pairing is the normal shape, never a restart, and must never be
      // mislabelled (coordinator's re-walk: labelling both rows of an ask
      // step's pause+reject pair was the exact bug this guards against). A
      // restart whose interleaved reject can't be found gets NO label at
      // all — a missing hint beats a wrong one.
      for (const s of declSteps) {
        if (s.close?.class === 'hitl') continue;
        const list = byStep[s.emits];
        const idxs = byStepAuditIdx[s.emits];
        if (!list) continue;
        for (let i = 1; i < list.length; i += 1) {
          if (list[i].attempt > list[i - 1].attempt) continue;
          let rejectRow = null;
          for (let j = idxs[i - 1] + 1; j < idxs[i]; j += 1) {
            const r = ctx.auditRows[j];
            if (r.class === 'hitl' && r.verdict === 'red') rejectRow = r;
          }
          if (rejectRow) list[i].afterReject = rejectRow.gap;
        }
      }
      steps = declSteps.map((s) => {
        const group = auditGroupsByStep[s.emits] ?? null;
        return {
          emits: s.emits,
          goal: s.goal,
          primitives: s.primitives ?? null,
          closeClass: s.close?.class ?? null,
          attempts: byStep[s.emits] ?? [],
          attemptsWhy: byStep[s.emits] ? null : 'no audit.jsonl rows yet for this step',
          tryCount: computeTryCount(s.close?.class ?? null, byStep[s.emits] ?? []),
          // The step card's own actions line (hamr's 2026-09-27 review):
          // `group` is `null` only for a step with no audit rows at all
          // (never attempted) — every field below stays `null`/empty rather
          // than a guessed 0, matching `deriveAuditGroups`'s own honesty
          // rules exactly (it's the SAME group object).
          groupState: group ? group.state : null,
          timeMs: group ? group.timeMs : null,
          cost: group ? group.cost : null,
          costWhy: group ? group.costWhy : null,
          tokensTotal: group ? group.tokensTotal : null,
          toolsTotal: group ? group.toolsTotal : null,
          toolsWhy: group ? group.toolsWhy : null,
          ungranted: group ? group.ungranted : [],
          tryMarks: group ? group.tryMarks : [],
          // Filled below, ONLY on the one step that actually stopped this
          // run (never guessed onto every step) — see stoppedStepEmits.
          stoppedReason: null,
        };
      });
    }
  }

  let modelWrote = null;
  let modelWroteWhy = null;
  if (!ctx.logJson) {
    modelWroteWhy = ctx.historyRow
      ? `run "${runId}" completed (history row present) but log.json is missing`
      : 'log.json has not been written yet (parked before any close, or still running)';
  } else {
    modelWrote = { artifacts: ctx.logJson.artifacts ?? null, attempts: ctx.logJson.attempts ?? null };
  }

  // A run that completed clean never shows a stop reason, full stop — an
  // earlier attempt on some step can carry a superseded not-done/red row
  // (a human rejected a draft, or a first pass missed the shape, and a
  // later attempt on the SAME step went on to pass) even though the run as
  // a whole finished clean. Checking `historyRow.outcome === 'complete'`
  // FIRST, before ever looking at `auditRows`, is what keeps a passed run
  // from reporting a stale, superseded failure as its own "why" (found live
  // against `flows/`, M4a piece 3 fix #1 — a real run, not a synthetic
  // fixture, is what caught this).
  //
  // hamr's 2026-09-27 browser-walk bug #1: the SAME staleness bug also hit a
  // run that's genuinely still PARKED (waiting on you) — an earlier step's
  // superseded gap (e.g. a first draft that missed the shape, redone and
  // accepted before the run went on to park on its own ask) was surfacing
  // as "why" even though the run hasn't stopped at all, it's just waiting.
  // Checked SECOND (right after the completed-clean case, before ever
  // looking at `auditRows` for a redRow): a run with an open, unanswered ask
  // (`askJson` present, no consumed answer — the same test `computeGlyph`
  // uses for "waiting on you") reports the ask's own question as its whole
  // "why", never an unrelated earlier attempt's gap.
  let stopReason = null;
  let stopReasonWhy = null;
  if (ctx.historyRow && ctx.historyRow.outcome === 'complete') {
    stopReasonWhy = 'run completed clean — there is no stop reason to show';
  } else if (ctx.historyRow && ctx.historyRow.outcome === 'rerun') {
    // M4b amendment 3: the human ended this run on purpose; an earlier redo's
    // audit row is not "why it stopped".
    stopReasonWhy = 'stopped by you (rerun), a fresh run was started — there is no failure to show';
  } else if (ctx.historyRow && ctx.historyRow.outcome === 'stopped') {
    // M4e amendment 4: the human's Stop is not a failure on any step; no step card carries it.
    stopReasonWhy = typeof ctx.logJson?.red === 'string' && ctx.logJson.red.length > 0 ? ctx.logJson.red : 'stopped by you';
  } else if (ctx.resume && (ctx.resume.state === 'starting' || ctx.resume.state === 'not-started')) {
    // M4b amendment 1: the human already answered — never "waiting on you".
    stopReasonWhy = ctx.resume.reason ? `${ctx.resume.label}: ${ctx.resume.reason}` : ctx.resume.label;
  } else if (!ctx.historyRow && ctx.askJson && !ctx.consumedAnswerExists) {
    stopReasonWhy = `waiting on you: ${typeof ctx.askJson.question === 'string' && ctx.askJson.question.length > 0 ? ctx.askJson.question : 'no question recorded'}`;
  } else if (ctx.logJson && typeof ctx.logJson.red === 'string' && ctx.logJson.red.length > 0) {
    stopReason = ctx.logJson.red;
  } else {
    // The LAST matching row, not the first — a step can fail, then redo and
    // fail again differently (or fail on a later step entirely); the most
    // recent stop is the one that actually describes where the run sits now.
    let redRow = null;
    for (const r of ctx.auditRows) {
      if (r.verdict === 'not-done' || r.verdict === 'red') redRow = r;
    }
    if (redRow) {
      stopReason = `${redRow.step}: ${redRow.gap}`;
    } else {
      stopReasonWhy = 'run has not stopped on a red/not-done step (still parked, waiting, or clean so far)';
    }
  }

  // hamr's 2026-09-27 step-card review: which declared step is the one that
  // actually stopped the run, so exactly ONE card (never every card, never a
  // passed one) can show `stopReason`'s full text. This is safe to derive
  // even for the `logJson.red` branch above (not just the `redRow` fallback
  // branch): every halt path in src/runner.js's own step loop calls
  // `recordAudit` for its own step in the SAME return that produces the red
  // text which becomes either `logJson.red` or `redRow.gap` — so whenever
  // `stopReason` is non-null, the LAST blocked-verdict row in book order
  // names the real step, never a text-matched guess. Left `null` (no card
  // gets a reason) for a clean or still-waiting run, matching stopReason's
  // own `null` in both those cases.
  let stoppedStepEmits = null;
  if (stopReason !== null) {
    for (const r of ctx.auditRows) {
      if (isBlockedVerdict(r.verdict)) stoppedStepEmits = r.step;
    }
  }
  if (steps && stoppedStepEmits !== null) {
    const stoppedStep = steps.find((s) => s.emits === stoppedStepEmits);
    if (stoppedStep) stoppedStep.stoppedReason = stopReason;
  }

  // "took Xs" for a finished run (M4a piece 3 fix #5) — straight off the
  // history row's own `wallMs` (never derived/guessed); a died/parked run
  // (no history row) or a history row predating this field both say why
  // rather than showing nothing.
  const wallMs = ctx.historyRow && typeof ctx.historyRow.wallMs === 'number' ? ctx.historyRow.wallMs : null;
  const wallMsWhy = wallMs !== null
    ? null
    : (ctx.historyRow ? 'history row has no wallMs recorded'
      : isRunningNow(ctx, glyph) ? RUNNING_WHY : 'no history row yet (parked or died before completion)');

  let spend;
  if (ctx.historyRow) {
    const cd = costDisplay(ctx.historyRow.spentUsd, ctx.historyRow.spendComplete);
    spend = cd.ok ? cd.display : null;
  } else {
    spend = spendFloorDisplay(ctx.spendRows);
  }

  // hamr's review #1 (Summary tab): model + spend.jsonl totals — read here
  // ONCE, off the same auditRows/spendRows this function already loaded, so
  // the Run tab's summary box and the step cards can never disagree about
  // what model ran or what spend.jsonl actually holds.
  const model = deriveRunModel(ctx.auditRows);
  const modelWhy = model === null ? 'no audit.jsonl row in this run has ever named a model (no model step has run yet)' : null;
  const spendSummary = summarizeSpendRows(ctx.spendRows);

  return {
    flow,
    runId,
    glyph,
    label,
    ...signParts(glyph, label, ctx.historyRow?.outcome === 'rerun'),
    signWords: SIGN_WORDS,
    pulse: glyphPulses({ glyph, label }),
    controls: runControls(ctx, glyph, label),
    resume: ctx.resume,
    outcome: ctx.historyRow ? ctx.historyRow.outcome : null,
    outcomeWhy: ctx.historyRow ? null : (isRunningNow(ctx, glyph) ? RUNNING_WHY : 'no history row (parked or died before completion)'),
    capUsd: ctx.historyRow ? ctx.historyRow.capUsd : (ctx.arbiter ? ctx.arbiter.capUsd : null),
    spend,
    model,
    modelWhy,
    spendSummary,
    wallMs,
    wallMsWhy,
    steps,
    stepsWhy,
    // M4e amendment 7 item 2: the Draft is the run's first step on the Map and under it — one summary, read from the same function the Audit group uses
    draft: ((b) => ({ ...b.summary, rows: b.rows }))(getDraftBlock(ctx.flowDir, ctx.runDir)),
    modelWrote,
    modelWroteWhy,
    stopReason,
    stopReasonWhy,
    at: ctx.historyRow ? ctx.historyRow.at : null,
    // browser re-walk bug #4: same "the books hold a date, so never say
    // unknown" rule as listRuns above — a parked run's own ask.json
    // `askedAt` is a real timestamp, shown ahead of the generic `atWhy`.
    askedAt: (!ctx.historyRow && ctx.askJson && typeof ctx.askJson.askedAt === 'string')
      ? ctx.askJson.askedAt
      : null,
    startedAt: isRunningNow(ctx, glyph) ? ctx.startedAt : null,
    atWhy: (ctx.historyRow || (ctx.askJson && typeof ctx.askJson.askedAt === 'string'))
      ? null
      : isRunningNow(ctx, glyph)
        ? (ctx.startedAt ? null : 'running — start time not recorded (no pid record)')
        : 'no history row yet (parked or died before completion)',
  };
}

/** The words the Draft says for a flow with no `setup.jsonl` (M4e amendment 6 item 4; renamed Draft by amendment 7 item 2). */
export const NO_DRAFT_WORDS = 'no draft record';
/** M6: what the Job tab says for a run that started before runs kept a copy of their job. */
export const NO_JOB_COPY_WORDS = 'This run started before runs kept a copy of their job, so this shows the job as it is now.';

/**
 * What the Draft adds up to, ONE place (the Map box, the first step card and the Audit group all read it, so the three can never disagree).
 * M4e amendment 9: `timeMs` is the card row's `at` to the sign row's `at` (the whole drafting, human time included), `null` when either has no
 * usable `at`; never a sum of the model rows' `wallMs`. `calls` sums the rows' `calls`, a row with none counts 1 and sets `callsAtLeast`, so an
 * unknown never shows as a smaller exact number; no model rows = `null`. `humanChecks` = the note rows + the revise rows (each is the card the human edited and sent) + the sign row + the run's signed-values
 * rows (the card is not a check), given by the caller as `ctx.humanChecks`. Money follows `costDisplay` ("at least $X" for a floor).
 * @param {any[]} modelRows the draft and change rows (`kind` draft | change) of `setup.jsonl`
 * @param {{cardAt?: any, signAt?: any, humanChecks?: number|null}} [ctx]
 * @returns {{calls: number|null, callsAtLeast: boolean, timeMs: number|null, humanChecks: number|null, usd: number|null, spendComplete: boolean, cost: string|null, modelRows: number}}
 */
export function draftTotals(modelRows, ctx = {}) {
  const priced = modelRows.filter((r) => typeof r.costUsd === 'number');
  const usd = priced.length > 0 ? priced.reduce((a, r) => a + r.costUsd, 0) : null;
  const spendComplete = modelRows.length > 0 && priced.length === modelRows.length && modelRows.every((r) => r.spendComplete === true);
  const cd = usd === null ? null : costDisplay(usd, spendComplete);
  const t0 = typeof ctx.cardAt === 'string' ? Date.parse(ctx.cardAt) : NaN;
  const t1 = typeof ctx.signAt === 'string' ? Date.parse(ctx.signAt) : NaN;
  const timeMs = Number.isFinite(t0) && Number.isFinite(t1) && t1 >= t0 ? t1 - t0 : null;
  const calls = modelRows.length > 0 ? modelRows.reduce((a, r) => a + (typeof r.calls === 'number' ? r.calls : 1), 0) : null;
  return {
    calls, callsAtLeast: modelRows.some((r) => typeof r.calls !== 'number'), timeMs,
    humanChecks: typeof ctx.humanChecks === 'number' && Number.isInteger(ctx.humanChecks) ? ctx.humanChecks : null,
    usd, spendComplete, cost: cd && cd.ok ? cd.display : null, modelRows: modelRows.length,
  };
}

/**
 * M4e amendment 6 item 4 / amendment 7 item 2: the Draft of a run — the flow's own `setup.jsonl` (card, drafts, changes, notes, sign), then this
 * run's own signed-values rows (amendment 5: "Sign & run" for version 0, "Sign & resume" for a later version), every row in the SAME shape
 * as the run's audit rows so the page draws both with one row builder. Reads only through the safe gateways; never throws.
 * @param {string} flowDir @param {string} runDir
 * @returns {{present: boolean, why: string|null, rows: any[], summary: {present: boolean, why?: string, calls?: number|null, callsAtLeast?: boolean, humanChecks?: number|null, timeMs?: number|null, usd?: number|null, spendComplete?: boolean, cost?: string|null, modelRows?: number}}}
 */
export function getDraftBlock(flowDir, runDir) {
  const setup = readSetup(flowDir);
  const rows = [];
  const human = (r, attempt, extra) => ({
    attempt, step: 'drafting', class: 'hitl', verdict: 'hitl', at: r.at ?? null, setup: true, blocked: false, action: 'human', tokensDisplay: { kind: 'no-model' }, ...extra,
  });
  const model = (r, attempt, label) => ({
    attempt, step: 'drafting', class: null, verdict: r.verdict === 'green' ? 'green' : (r.verdict === 'red' ? 'red' : 'not-done'), gap: r.gap ?? '', at: r.at ?? null, setup: true, blocked: false,
    action: `${label} · ${r.model ?? 'model not recorded'}${r.hash ? ` · plan ${String(r.hash).slice(0, 8)}` : ''}`,
    usd: typeof r.costUsd === 'number' ? r.costUsd : undefined, spendComplete: r.spendComplete === true, tokensDisplay: { kind: 'no-model' },
    ...(typeof r.wallMs === 'number' ? { wallMs: r.wallMs } : {}),
  });
  // M4e amendment 8 item 1, line 4: one short phrase per Draft row, in order (the drafting card joins them with ` · `)
  const happened = [];
  const retry = (r) => (Number.isInteger(r.structureRetries) && r.structureRetries >= 1 ? ` (retry ${r.structureRetries} of ${MAX_STRUCTURE_RETRIES})` : '');
  if (setup.present) {
    setup.rows.forEach((r, i) => {
      const n = i + 1;
      if (r.kind === 'card') happened.push('your card');
      else if (r.kind === 'note') happened.push('your note');
      else if (r.kind === 'draft') happened.push(r.verdict === 'green' ? `drafting${retry(r)}` : 'draft red');
      else if (r.kind === 'change') happened.push(r.verdict === 'red' ? 'change red' : `changing${retry(r)}`);
      else if (r.kind === 'startover') happened.push(r.verdict === 'green' ? `starting over${retry(r)}` : 'start over red');
      else if (r.kind === 'revise') happened.push(r.verdict === 'red' ? 'revise red' : `revising${retry(r)}`);
      else if (r.kind === 'redraft') happened.push(r.verdict === 'red' ? 'redraft red' : `redrafting with your answers${retry(r)}`);
      else if (r.kind === 'sign') happened.push(`signed (${r.signedBy ?? 'you'})`);
      if (r.kind === 'card') {
        const c = r.card && typeof r.card === 'object' ? r.card : {};
        const gap = [`flow ${c.flowName ?? '?'}`, `cap $${c.capUsd ?? '?'}`, c.destination ? `destination ${c.destination}` : null, c.askWait ? `ask wait ${c.askWait}` : null,
          typeof c.inputs === 'string' && c.inputs.trim() ? `inputs: ${c.inputs.trim().replace(/\n+/g, ' / ')}` : null, `job: ${String(c.job ?? '').trim().replace(/\n+/g, ' / ')}`].filter(Boolean).join(' · ');
        rows.push(human(r, n, { action: 'card (you)', gap }));
      } else if (r.kind === 'note') rows.push(human(r, n, { action: 'note (you)', gap: String(r.text ?? '') }));
      else if (r.kind === 'draft') rows.push(model(r, n, 'draft'));
      else if (r.kind === 'change') rows.push(model(r, n, `change ${r.n}`));
      else if (r.kind === 'startover') rows.push(model(r, n, 'start over'));
      else if (r.kind === 'revise') rows.push(model(r, n, `revise ${r.n}`));
      else if (r.kind === 'redraft') rows.push(model(r, n, `answers redraft ${r.n}`));
      else if (r.kind === 'sign') rows.push(human(r, n, { action: `sign (${r.signedBy ?? 'you'})`, gap: `plan ${String(r.hash ?? '').slice(0, 12)}` }));
    });
  }
  const versions = [];
  for (const f of readdirInside(runDir, '.')) {
    const m = VALUES_FILE_RE.exec(f);
    if (m !== null) versions.push({ file: f, version: m[1] === undefined ? 0 : Number(m[1]) });
  }
  versions.sort((a, b) => a.version - b.version);
  for (const { file, version } of versions) {
    const t = readFileInside(runDir, file);
    let rec = null;
    try { rec = t.ok ? JSON.parse(t.text) : null; } catch { rec = null; }
    const v = rec && typeof rec === 'object' ? rec.values : null;
    const waits = v && typeof v === 'object' && v.askWaits && typeof v.askWaits === 'object'
      ? Object.entries(v.askWaits).map(([line, wait]) => ({ line, wait: String(wait), waitMs: parseWaitMs(wait) })) : [];
    const head = v && typeof v === 'object' ? [`cap $${v.capUsd}`, v.destination ? `destination ${v.destination}` : null].filter(Boolean) : [];
    const gap = v && typeof v === 'object'
      ? [...head, waits.length ? `ask waits ${waits.map((w) => `line ${w.line}: ${w.wait}`).join(', ')}` : null].filter(Boolean).join(' · ')
      : `${file} could not be read`;
    happened.push(`${version === 0 ? 'signed to run' : 'signed to resume'} (${rec?.signedBy ?? 'you'})`);
    rows.push(human({ at: rec?.at }, rows.length + 1, { action: `${version === 0 ? 'Sign & run' : 'Sign & resume'} (${rec?.signedBy ?? 'you'})`, gap, ...(waits.length ? { gapHead: head, gapWaits: waits } : {}) }));
  }
  const lastSign = setup.present ? [...setup.rows].reverse().find((r) => r.kind === 'sign') : undefined;
  const humanChecks = setup.present ? setup.rows.filter((r) => r.kind === 'note' || r.kind === 'sign' || r.kind === 'revise' || r.kind === 'redraft').length + versions.length : null;
  const totals = setup.present
    ? draftTotals(setup.rows.filter((r) => r.kind === 'draft' || r.kind === 'change' || r.kind === 'revise' || r.kind === 'redraft' || r.kind === 'startover'), { cardAt: setup.rows.find((r) => r.kind === 'card')?.at, signAt: lastSign?.at, humanChecks })
    : null;
  // the group the Audit tab draws as a normal card (collapsed by default) and the box the Map and the first step card read
  // `ended` = how the drafting ended: `done` only with a sign row, else `not signed` (no `red` state: a red change shows on line 4 only)
  const ended = setup.present && setup.rows.some((r) => r.kind === 'sign') ? 'done' : 'not signed';
  const summary = setup.present && totals ? { present: true, ...totals, ended, happened } : { present: false, why: NO_DRAFT_WORDS };
  return {
    present: setup.present, why: setup.present ? null : NO_DRAFT_WORDS, rows, summary,
  };
}

/**
 * `GET /api/runs/:flow/:runId/audit` — the Audit/logs tab (M4a scope item
 * 2): the raw `audit.jsonl` rows, scoped strictly to this run (each run's
 * own `audit.jsonl` file already carries only its own rows — there is no
 * shared-sidecar contamination risk here the way bareloop's gate-audit
 * sidecar had). `null` when the flow/runId doesn't resolve (404).
 * @param {{root: string, flow: string, runId: string}} opts
 * @returns {{flow:string, runId:string, rows:any[], groups:any[], draft:ReturnType<typeof getDraftBlock>, empty:boolean, why:string|null}|null}
 */
export function getRunAudit({ root, flow, runId }) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;
  const rawRows = readAudit(run.runDir);
  // hamr's review #6: the Audit tab's "Action" column is derived server-side
  // (never guessed client-side from partial data) — `action` is added to
  // each row here, off that SAME row's own fields, book order preserved.
  // hamr's 2026-09-27 review items (c)/(d): the Cost cell's token phrase
  // (`tokensDisplay`) and the new Time column's old-row "why" (`atWhy`) are
  // likewise derived here, off this same row, never client-side.
  const rows = enrichAuditRows(rawRows);
  return {
    flow,
    runId,
    rows,
    // hamr's 2026-09-27 exit-check review #1: the Audit tab's grouped-by-
    // step header pieces, computed here off these SAME enriched rows —
    // never a second, client-side re-grouping.
    groups: deriveAuditGroups(rows),
    draft: getDraftBlock(run.flowDir, run.runDir),
    empty: rows.length === 0,
    why: rows.length === 0 ? 'audit.jsonl is empty or missing — no attempt has been made yet' : null,
  };
}

/**
 * M4e amendment 34: the signed plan as the Job tab shows it. One row per declared step: the job line it came from, what it reads, what it makes, the
 * primitives it may use (an ask step grants none), its check (the `checkedLines` sentences, the same words the human saw at sign) and, for the step a
 * signed ask binds to, that ask's wait. "Not checked" comes from the sign row of the flow's setup.jsonl: `recorded:false` (and no items) for a flow
 * signed before amendment 36, which the page says in words; never an empty list read as "nothing".
 * M6: a sign row that names another signing than the job being shown (`flowHash`) is not this job's record: `recorded:false`, never the new job's words.
 * @param {any} declaration @param {Array<{line:number, ttlMs?:number}>} asks @param {string} flowDir @param {string|null} [flowHash] the signature hash of the job being shown
 */
function buildJobPlan(declaration, asks, flowDir, flowHash = null) {
  const lines = checkedLines(declaration, { askLines: asks.map((x) => x.line) });
  const declSteps = Array.isArray(declaration?.steps) ? declaration.steps : [];
  const steps = declSteps.map((st, i) => {
    const ak = asks.find((x) => x.line === st.fromLine);
    return {
      step: i + 1,
      line: Number.isInteger(st.fromLine) ? st.fromLine : null,
      reads: Array.isArray(st.reads) ? st.reads : [],
      makes: typeof st.emits === 'string' ? st.emits : null,
      mayDo: Array.isArray(st.primitives) ? st.primitives : [],
      check: lines[i].sentences,
      checkClass: lines[i].class,
      ask: !!ak,
      waitMs: ak && typeof ak.ttlMs === 'number' ? ak.ttlMs : null,
    };
  });
  const setup = readSetup(flowDir);
  const signRow = setup.present ? setup.rows.find((r) => r.kind === 'sign') : undefined;
  const ofThisJob = !!signRow && (typeof signRow.flowHash !== 'string' || flowHash === null || signRow.flowHash === flowHash);
  const nc = ofThisJob ? signRow?.notChecked : undefined;
  const recorded = !!nc && Array.isArray(nc.items);
  return { steps, notChecked: { label: NOT_CHECKED_LABEL, items: recorded ? notCheckedBlock(nc.items).items : [], recorded } };
}

/**
 * `GET /api/runs/:flow/:runId/job` — the Job tab (hamr's 2026-09-27
 * exit-check review #5: bareloop-style one-field-per-piece layout,
 * replacing the old split asks/sends/sources/signed-lines blocks). Every
 * field is read straight off `readFlow`'s own signed declaration.json/
 * signature.json/prose lines — nothing invented; a piece the books can't
 * name carries its own why, never a blank or a guess. Field order (server
 * order matches the page's own render order): prose, asks, model, cap
 * (+redo cap), sources, sends, guardrails, plan (one row per step, amendment 34), signature.
 * @param {{root: string, flow: string, runId: string, catalogue: any}} opts
 * @returns {any|null}
 */
export function getRunJob({
  root, flow, runId, catalogue,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;

  // M6: the job THIS run ran is its own copy (`<run>/job/`, saved when it started). A run from before M6 has none: it shows the flow's job as it is
  // now and says so (`jobFrom: 'current'`, `jobFromWhy`). A copy that does not verify is refused by name, never swapped for the flow's job.
  const copy = readRunJobCopy(run.runDir, catalogue);
  if (copy.present && !copy.ok) {
    return {
      flow, runId, resolved: false, why: `This run's saved copy of its job does not match its signature, so it is not shown: ${copy.reds.join('; ')}`,
    };
  }
  const flowRead = copy.present ? copy : readFlow({ root, name: flow, catalogue });
  if (!flowRead.ok) {
    return {
      flow, runId, resolved: false, why: `readFlow refused: ${flowRead.reds.join('; ')}`,
    };
  }
  const sig = flowRead.signature;
  // hamr's review #7: the Job tab is missing the model name entirely — the
  // signed declaration/signature never record one (checked: no module in
  // `src/` writes a `model` field into either), so this reads the SAME
  // per-attempt `audit.jsonl` field the Run tab's summary uses
  // (`deriveRunModel`) and says so plainly when it does, rather than
  // pretending the signed prose named it.
  const auditRows = readAudit(run.runDir);
  const model = deriveRunModel(auditRows);
  // the run's own signed values (cap, send folder, ask waits) when it has them; the flow's own otherwise
  const applied = applyRunValues(flowRead.arbiter, flow, sig.flow, pickRunValues(run.runDir));
  const a = (applied.ok ? applied.arbiter : flowRead.arbiter) ?? {};
  const asks = a.asks ?? [];
  const sends = a.sends ?? [];
  const sources = a.sources ?? [];
  return {
    flow,
    runId,
    resolved: true,
    jobFrom: copy.present ? 'run' : 'current',
    jobFromWhy: copy.present ? null : NO_JOB_COPY_WORDS,
    model,
    // `model` is read from this run's own audit.jsonl rows, never the signed
    // prose/declaration (neither records one) — the page says so in words
    // ("model used: X (from this run's rows)") rather than implying it came
    // from the signed job itself.
    modelWhy: model === null ? 'no audit.jsonl row for this run has ever named a model' : null,
    // review #5: "Job (prose)" — the signed lines WITHOUT their guardrail
    // mixed in (guardrails get their own field below).
    prose: flowRead.lines.map((l) => ({ line: l.n, text: l.text })),
    // review #5: "Ask" — one row per signed ask line; `waitMs` is the raw
    // signed ttlMs, formatted client-side by the SAME `duration()` every
    // other elapsed-time field on this page already uses.
    asks: asks.map((ak) => ({ line: ak.line, question: ak.question, waitMs: ak.ttlMs })),
    capUsd: typeof a.capUsd === 'number' ? a.capUsd : null,
    redoCap: typeof a.redoCap === 'number' ? a.redoCap : null,
    // review #5: "Source" — role -> basename only (never the full signed
    // path, even though sources are themselves signed input — hamr's own
    // "to be safe" instruction).
    sources: sources.map((s) => ({
      role: s.role, kind: s.kind, path: s.path, basename: basename(s.path),
    })),
    // review #5: "Destination" — one row per send.
    sends: sends.map((s) => ({ line: s.line, kind: s.target?.kind ?? null, target: s.target?.path ?? null })),
    // review #5: "Guardrails" — ONE field, one row per NUMBERED-LINE
    // guardrail (never the separate "Arbiter guardrails" block, already
    // covered by cap/asks/sends/sources above); empty guardrails skipped.
    guardrails: flowRead.lines
      .filter((l) => typeof l.guardrail === 'string' && l.guardrail.length > 0)
      .map((l) => ({ line: l.n, guardrail: l.guardrail })),
    plan: buildJobPlan(flowRead.declaration, asks, run.flowDir, typeof sig?.flow === 'string' ? sig.flow : null),
    signature: (sig && typeof sig.signedBy === 'string' && typeof sig.signedAt === 'string' && typeof sig.flow === 'string')
      ? { signedBy: sig.signedBy, signedAt: sig.signedAt, hash: sig.flow }
      : null,
    signatureWhy: (sig && typeof sig.signedBy === 'string' && typeof sig.signedAt === 'string' && typeof sig.flow === 'string')
      ? null
      : 'signature.json is missing signedBy/signedAt/flow (hash)',
  };
}

// ---------------------------------------------------------------------------
// M4a Amendment M4a-1 — the panel's Inbox/Ask surface (docs/wiki/the-module-
// ladder.md, "M4a" section, signed 2026-09-27). Every stop (parked ask) this
// panel can name is read through ONE reader per run —
// `listArchivedAsks(runDir)` (`src/ask.js`) for a run that has an `asks/`
// archive, or `legacyRunAsks` (below, THIS module's own reader) for a run
// that predates M4a-1 (no `asks/` directory at all) — never a third,
// ad-hoc reconstruction. Status vocabulary, used everywhere in the panel
// (Inbox list, Ask tab, both API responses), is exactly the words
// `listArchivedAsks` itself already returns from the books' own decision
// field: `accepted` / `redo` / `reran` / `expired` / `unanswered` (a
// parked, not-yet-expired ask with no consumed answer — this IS "open" in
// the UI) / `open` (the rare case `listArchivedAsks` falls back to when an
// archived ask.json itself fails to parse — no question/evidence can be
// read for it either). Nothing here invents a question, a draft, or a
// decision that no book actually recorded.
// ---------------------------------------------------------------------------

/**
 * An ask row is "open" (still waiting on a human, right now) exactly when
 * its book-derived status is `unanswered` (parked, not yet answered, not
 * expired — `listArchivedAsks` already applies the expiry check at read
 * time) or the rare unparseable-archive fallback `open`. Every other status
 * (`accepted`/`redo`/`reran`/`expired`, or an `unrecognised: X` decision
 * value) is a PAST stop.
 * @param {string} status
 * @returns {boolean}
 */
function isOpenStatus(status) {
  return status === 'unanswered' || status === 'open';
}

/**
 * `open` + `timeLeftMs` for one ask row — the ONE place both are computed,
 * shared by `listStops` (the Inbox) and `getRunAsks` (the Ask tab), so a
 * given ask can never read "open, no time-left" in one surface and
 * something else in the other (hamr's 2026-09-27 browser-walk bug #4: the
 * Ask tab's own asks never carried these fields at all — only `listStops`
 * computed them — so an open ask's Ask-tab header/body fell back to the raw
 * `status` word "unanswered" and no time-left, while the Inbox row for the
 * SAME ask correctly showed a dot and "time left: …").
 *  - `open`: this ask's own status reads as open (`isOpenStatus`) AND the
 *    run hasn't already ended (`!hasHistoryRow` — the same rule
 *    `legacyRunAsks` itself already applies when building the row, repeated
 *    here as the same belt-and-braces `listStops` already had).
 *  - `timeLeftMs`: only meaningful while `open` — the real ms remaining
 *    until `expiresAt`, floored at 0, `null` when not open or `expiresAt`
 *    can't be parsed (never a guessed number).
 * @param {any} ask one row from `runAsksInOrder`
 * @param {boolean} hasHistoryRow
 * @param {any} [resume] the run's `deriveResumeState` result, or null
 * @returns {{open: boolean, waiting: boolean, resume: any, timeLeftMs: number|null}}
 */
function deriveAskOpenFields(ask, hasHistoryRow, resume = null) {
  // M4c amendment 3: an ask past its deadline reads `expired`, but one whose answer was saved in time
  // (`resume` is null for a late/unreadable one, `deriveResumeState`) is still open: it can be carried on.
  const answerSaved = resume != null && resume.askId === ask.askId
    && (resume.state === 'starting' || resume.state === 'not-started');
  const open = (isOpenStatus(ask.status) || (ask.status === 'expired' && answerSaved)) && !hasHistoryRow;
  // M4b fix: the ONE decision "is this ask waiting on the human". An open ask
  // whose answer is already saved (`resume` = `deriveResumeState` for THIS
  // ask, the run's own label) is open but not waiting: the human answered.
  const answered = open && resume != null && resume.askId === ask.askId
    && (resume.state === 'starting' || resume.state === 'not-started');
  const waiting = open && !answered;
  const expiresMs = waiting && typeof ask.expiresAt === 'string' ? Date.parse(ask.expiresAt) : NaN;
  return {
    open,
    waiting,
    resume: answered ? resume : null,
    timeLeftMs: waiting && Number.isFinite(expiresMs) ? Math.max(0, expiresMs - Date.now()) : null,
  };
}

/**
 * M4c-fix amendment 1 (b): does this ask offer the human's "Reopen"? Only the run's current open ask (`ask.json`),
 * only once its deadline has passed with no usable answer waiting (`resume` is null for it: a late or unreadable saved
 * answer reads as none, an in-time one is resumed, not reopened), only while the run has not ended. `waitMs` is the
 * signed wait it repeats; `late` says an answer was saved but came after the deadline. The Run's end row is the caller's `openAskJson === null`.
 * @param {any} ask one row from `runAsksInOrder` @param {any} openAskJson `readAsk` of the run, or null (ended)
 * @param {any} resume the run's `deriveResumeState`
 * @returns {{waitMs: number, late: boolean, why: string}|null}
 */
function reopenOffer(ask, openAskJson, resume, lateAnswerSaved = false) {
  if (!openAskJson || openAskJson.askId !== ask.askId || ask.status !== 'expired') return null;
  if (resume && resume.askId === ask.askId && (resume.state === 'starting' || resume.state === 'not-started')) return null;
  // `late`: an answer was saved but came after the deadline (the page says so, instead of "nobody answered");
  // `why` is that line, the one the Ask tab and the Inbox row both draw.
  return Number.isFinite(openAskJson.waitMs)
    ? { waitMs: openAskJson.waitMs, late: lateAnswerSaved, why: lateAnswerSaved ? LATE_ANSWER_WHY : NO_ANSWER_WHY }
    : null;
}

/**
 * `readAskEvidence`'s own return shape (`src/ask.js`) carries the draft as
 * `{ text: string } | null` (never a bare string) so a caller can tell "no
 * draft" apart from "a draft with an empty string" — this panel's UI wants
 * a flat, renderable string instead. The ONE place that unwraps `.text`, so
 * every row this module produces (archived or legacy) carries the same
 * flat `{ draft: string|null, unjudged, why }` shape.
 * @param {ReturnType<typeof readAskEvidence>} evidence
 * @returns {{draft: string|null, unjudged: any[], why?: string}}
 */
function flattenEvidence(evidence) {
  return {
    draft: evidence.draft ? evidence.draft.text : null,
    unjudged: evidence.unjudged,
    why: evidence.why,
  };
}

/**
 * Flattens one `listArchivedAsks` entry (its nested `answer` object) into
 * this module's own flat row shape, shared by both the archived and
 * pre-M4a-1 legacy paths so callers (the Inbox list, the Ask tab, both
 * routes) never have to branch on which reader produced a row.
 * @param {any} a one entry of `listArchivedAsks(runDir).asks`
 * @returns {any}
 */
function normalizeArchivedRow(a) {
  return {
    askId: a.askId,
    question: a.question ?? null,
    askedAt: a.askedAt ?? null,
    expiresAt: a.expiresAt ?? null,
    status: a.answer.status,
    reason: a.answer.reason ?? null,
    answeredAt: a.answer.answeredAt ?? null,
    archived: true,
    emits: typeof a.emits === 'string' ? a.emits : null,
    evidence: flattenEvidence(a.evidence),
  };
}

/** `^answer\.<askId>\.consumed\.json$` — deliberately excludes
 *  `answer.stale.<n>.json` (no capture group would match "stale" as a real
 *  askId; the stale-quarantine writer in `src/ask.js` uses that different
 *  name specifically so this convention-based scan never mistakes a
 *  quarantined stale answer for a real consumed one). */
const CONSUMED_ANSWER_RE = /^answer\.(.+)\.consumed\.json$/;

/** The line under an ask that ended expired though an answer was saved: the answer came too late. */
const LATE_ANSWER_WHY = 'Your answer came after the deadline.';
/** The line under an expired ask nobody answered. */
const NO_ANSWER_WHY = 'Nobody answered in time.';

/**
 * The pre-M4a-1 fallback reader (M4a-1 scope item 1): for a run with no
 * `asks/` archive directory at all, reconstructs what the books STILL hold —
 * the current (single-slot, mutable) `ask.json`, if any, plus every
 * `answer.<askId>.consumed.json` marker still on disk. A past askId's own
 * question/draft can never be recovered (the single ask.json slot was
 * overwritten by the next park) — those fields come back `null` with the
 * fixed `why` the brief specifies, never guessed from the CURRENT ask.json
 * (which may name a completely different, later question).
 * hamr's 2026-09-27 live check: a run that has a history row has ENDED —
 * the single mutable `ask.json` slot left on disk is a stale leftover from
 * whatever it last held, and the answer to it (if any) is already
 * represented by its own `answer.<id>.consumed.json` marker, read above.
 * Never rebuilt as a second, "still open" row for an ended run — that
 * double-counts one real ask as two stops and inflates the Inbox's open
 * count with something no human can actually act on any more.
 * @param {string} runDir
 * @param {boolean} hasHistoryRow whether this run's flow-level history.jsonl
 *   already carries a row for it (the run ended, one way or another)
 * @returns {any[]}
 */
function legacyRunAsks(runDir, hasHistoryRow) {
  const rows = [];
  // F48 round 3: `readdirInside` (`src/flow.js`) — a symlinked entry is
  // skipped, never followed, so a legacy consumed-answer row can never be
  // synthesised off a planted symlink's outside content.
  const names = readdirInside(runDir, '.');

  const askJson = readAsk(runDir);
  const currentAskId = askJson && typeof askJson.askId === 'string' ? askJson.askId : null;

  const consumedFiles = names.filter((n) => CONSUMED_ANSWER_RE.test(n)).sort();

  for (const file of consumedFiles) {
    const match = CONSUMED_ANSWER_RE.exec(file);
    if (!match) continue; // eslint-disable-line no-continue -- filtered by the same regex above; never actually null
    const askId = match[1];
    const fileRead = readFileInside(runDir, file);
    if (!fileRead.ok) {
      continue; // eslint-disable-line no-continue -- missing/symlink-refused, same as a torn write: skipped, never invented
    }
    let parsed;
    try {
      parsed = JSON.parse(fileRead.text);
    } catch {
      continue; // eslint-disable-line no-continue -- a torn write is skipped, never invented
    }
    if (parsed === null || typeof parsed !== 'object') continue; // eslint-disable-line no-continue -- valid JSON that is no answer (`null`, a number) is skipped like a torn write
    // A consumed legacy row never recovers question/askedAt/expiresAt from
    // the CURRENT ask.json, even when its askId happens to still match it —
    // the single mutable slot is not a reliable append log for a past ask
    // (a later park would silently overwrite it), so this deliberately
    // shows only what a consumed-answer marker itself can prove: askId,
    // decision, reason, answeredAt (brief, M4a-1 scope item 1).
    rows.push({
      askId,
      question: null,
      questionWhy: 'question not kept (before M4a-1)',
      askedAt: null,
      expiresAt: null,
      status: decisionStatus(parsed.decision) ?? `unrecognised: ${parsed.decision}`,
      reason: typeof parsed.reason === 'string' ? parsed.reason : null,
      answeredAt: typeof parsed.answeredAt === 'string' ? parsed.answeredAt : null,
      archived: false,
      evidence: { draft: null, unjudged: [], why: 'draft not kept (before M4a-1)' },
    });
  }

  // The currently open ask, when its own askId has no consumed marker yet —
  // and only when the run hasn't already ended. A history row means the run
  // is over; the leftover `ask.json` slot is never rebuilt into a second
  // "still open" stop at that point, no matter what its own askId says.
  if (askJson && !hasHistoryRow) {
    const hasConsumed = currentAskId !== null
      && consumedFiles.includes(`answer.${currentAskId}.consumed.json`);
    if (!hasConsumed) {
      if (currentAskId === null) {
        // A genuine pre-M3 ask.json: no askId/expiresAt at all — cannot be
        // paired with a future answer or timed, shown for visibility only.
        rows.push({
          askId: null,
          question: askJson.question ?? null,
          askedAt: askJson.askedAt ?? null,
          expiresAt: null,
          status: 'unanswered',
          reason: null,
          answeredAt: null,
          archived: false,
          evidence: flattenEvidence(readAskEvidence(askJson)),
          why: 'pre-M3 ask.json (no askId/expiresAt) — not answerable, shown for visibility only',
        });
      } else {
        const expiresMs = typeof askJson.expiresAt === 'string' ? Date.parse(askJson.expiresAt) : NaN;
        const expired = !Number.isNaN(expiresMs) && Date.now() > expiresMs;
        rows.push({
          askId: currentAskId,
          question: askJson.question ?? null,
          askedAt: askJson.askedAt ?? null,
          expiresAt: askJson.expiresAt ?? null,
          status: expired ? 'expired' : 'unanswered',
          reason: null,
          answeredAt: null,
          archived: false,
          evidence: flattenEvidence(readAskEvidence(askJson)),
        });
      }
    }
  }

  return rows;
}

/**
 * Every ask (open or past) this run's own books can name, oldest first —
 * archived (`asks/<askId>.json`, M4a-1) when the run has that directory,
 * else the pre-M4a-1 fallback (`legacyRunAsks`). `listArchivedAsks` orders
 * its own entries by askId (a UUID, not chronological) — re-sorted here by
 * `askedAt` so the Ask tab reads as a real timeline; a row with no readable
 * `askedAt` (a legacy past entry — the field was never recoverable) sorts
 * after every row that has one, in the order `listArchivedAsks`/
 * `legacyRunAsks` themselves returned it.
 * @param {string} runDir
 * @param {boolean} hasHistoryRow whether this run's flow-level history.jsonl
 *   already carries a row for it — threaded into `legacyRunAsks` so an ended
 *   run's stale `ask.json` slot is never rebuilt into a fake "still open" row
 *   (hamr's 2026-09-27 live check).
 * @returns {any[]}
 */
function runAsksInOrder(runDir, hasHistoryRow, endedExpired = false) {
  const archivedResult = listArchivedAsks(runDir);
  const rows = archivedResult.archived
    ? archivedResult.asks.map(normalizeArchivedRow)
    : legacyRunAsks(runDir, hasHistoryRow);
  const ordered = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const am = typeof a.row.askedAt === 'string' ? Date.parse(a.row.askedAt) : NaN;
      const bm = typeof b.row.askedAt === 'string' ? Date.parse(b.row.askedAt) : NaN;
      const aKnown = Number.isFinite(am);
      const bKnown = Number.isFinite(bm);
      if (aKnown && bKnown) return am - bm;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
  // M4c-fix amendment 1 (c): a run ended because its ask expired reads expired, never accepted. The late answer the
  // terminal resume consumed was refused, so the newest ask carries `expired` (and says why), not the answer's word.
  // amendment 17 1A: an ask a Stop set aside takes its words from its OWN place in the run: the step `deriveAskStepInfo` (the one
  // reader of which step each ask belongs to) names for it, matched to the `stopped at the ask of step N` row written for that step.
  // Never by counting those rows in order: a Stop that landed before any ask parked writes one too, with no ask behind it.
  if (ordered.some((a) => a.status === 'stopped')) {
    const words = stoppedAskWords(ordered, readAudit(runDir));
    for (let i = 0; i < ordered.length; i++) {
      if (ordered[i].status === 'stopped' && words[i] !== null) ordered[i] = { ...ordered[i], statusText: words[i] };
    }
    // am41 item 4: the newest stopped ask whose step the books cannot name says what the Runs label says (the same words), not a bare "stopped".
    const newest = ordered.length - 1;
    if (ordered[newest].status === 'stopped' && words[newest] === null) ordered[newest] = { ...ordered[newest], statusText: STOPPED_UNKNOWN_LINE };
  }
  const last = ordered[ordered.length - 1];
  if (endedExpired && last && (last.status === 'accepted' || last.status === 'redo' || last.status === 'reran')) {
    ordered[ordered.length - 1] = { ...last, status: 'expired', reason: null, why: LATE_ANSWER_WHY };
  }
  return ordered;
}

/**
 * hamr's 2026-09-27 exit-check review #3: which declared step (and its
 * signed prose line) each ask in `orderedAsks` belongs to — no book field
 * names this directly (`ask.json`/the archive carry only question/evidence,
 * never a step id), so this is derived by POSITION, the same honest
 * correlation technique this module already uses for `afterReject`
 * (`getRunDetail`, above): `src/runner.js`'s `runAskSlot` writes exactly one
 * `verdict:'paused'` audit row per park, in the SAME real-time order the
 * asks themselves were parked in, and that row's own `step` field (set by
 * `makeAuditRow` from the step object's `emits`) names the real step. Paired
 * 1:1, in order, with `orderedAsks` (already sorted oldest-askedAt-first) —
 * NEVER when the counts disagree (a crash between the ask.json/archive write
 * and the audit-row write, or a pre-M4a-1 run with no paused rows at all
 * left to correlate): every entry gets `step:null, line:null` with a stated
 * why, rather than a guessed pairing. `line` is read off the matching
 * `declaration.steps` entry's own `fromLine` (`src/declaration.js`) — never
 * invented when no step matches the paused row's name.
 * @param {any[]} orderedAsks `runAsksInOrder`'s own return, oldest-first
 * @param {any[]} auditRows this run's own `audit.jsonl` rows, book order
 * @param {any[]|null} declSteps `readFlow(...).declaration.steps`, or null
 *   when the flow itself didn't resolve
 * @returns {Array<{step:string|null, line:number|null, why:string|null}>}
 */
export function deriveAskStepInfo(orderedAsks, auditRows, declSteps) {
  const pausedRows = auditRows.filter((r) => r.verdict === 'paused');
  if (pausedRows.length !== orderedAsks.length) {
    const why = `ask count (${orderedAsks.length}) does not match this run's own "paused" audit rows (${pausedRows.length}) — step/line not determinable without guessing`;
    return orderedAsks.map(() => ({ step: null, line: null, why }));
  }
  return orderedAsks.map((ask, i) => {
    const stepEmits = typeof pausedRows[i].step === 'string' ? pausedRows[i].step : null;
    if (stepEmits === null) {
      return { step: null, line: null, why: 'this ask\'s paused audit row names no step' };
    }
    const declStep = Array.isArray(declSteps) ? declSteps.find((s) => s.emits === stepEmits) : undefined;
    if (!declStep || typeof declStep.fromLine !== 'number') {
      return { step: stepEmits, line: null, why: 'no declared step with a numbered line matches this ask\'s own step' };
    }
    return { step: stepEmits, line: declStep.fromLine, why: null };
  });
}

/**
 * M4c item 5 — the Ask tab's ONE grouping function: one block per signed ask
 * line. Key = the archive's recorded `emits`, else the step the ask's own "paused" audit row names (`stepName`,
 * `deriveAskStepInfo`); when the books cannot name a step (count mismatch, a
 * pre-M4a-1 run) the key falls back to the question text, then to one shared
 * "unknown" key — never a guessed pairing. Draft numbers are the ask's 1-based
 * position within its own block (how many times this line has parked).
 * `current` is the newest draft; `answers` is one row per draft that has a
 * recorded decision (the newest draft only when it is not itself open),
 * decision word via `DECISION_STATUS` (old `reject` files already read `redo`).
 * @param {any[]} asks rows as built by `getRunAsks` (oldest first)
 * @returns {any[]}
 */
export function groupAskBlocks(asks) {
  const decisionWord = (status) => Object.keys(DECISION_STATUS).find((k) => DECISION_STATUS[k] === status) ?? status;
  const byKey = new Map();
  for (const ask of asks) {
    let key = 'unknown';
    if (typeof ask.emits === 'string') key = `step:${ask.emits}`;
    else if (typeof ask.stepName === 'string') key = `step:${ask.stepName}`;
    else if (typeof ask.question === 'string') key = `q:${ask.question}`;
    if (!byKey.has(key)) byKey.set(key, []);
    byKey.get(key).push(ask);
  }
  return [...byKey.entries()].map(([key, drafts]) => {
    const current = drafts[drafts.length - 1];
    const answers = [];
    drafts.forEach((d, i) => {
      if (d === current && d.open) return;
      if (d.status === 'unanswered' || d.status === 'open') return;
      answers.push({
        draft: i + 1, askId: d.askId, decision: decisionWord(d.status), reason: d.reason ?? null, answeredAt: d.answeredAt ?? null,
      });
    });
    return {
      key,
      stepName: current.emits ?? current.stepName ?? null,
      stepLine: current.stepLine ?? null,
      question: current.question ?? null,
      questionWhy: current.questionWhy ?? null,
      draftNo: drafts.length,
      askIds: drafts.map((d) => d.askId),
      current,
      answers,
    };
  });
}

/**
 * `GET /api/runs/:flow/:runId/asks` — the Ask tab (M4a-1 scope item 1):
 * every ask this run's books can name, in order, each carrying full
 * evidence (`readAskEvidence`'s draft + unjudged, or the pre-M4a-1 `why`).
 * `null` when the flow/runId doesn't resolve (caller renders 404).
 *
 * hamr's 2026-09-27 exit-check review #3: each ask also carries `index`/
 * `total` (its own 1-based position among this run's own asks, e.g. "2 of
 * 3" — a plain array position, not derived from any book) and `stepName`/
 * `stepLine`/`stepWhy` (`deriveAskStepInfo`) so the Ask tab's header can
 * name which ask is open without the client re-deriving any of it.
 * M4b piece 4: also carries `resume` (the SAME `deriveResumeState` the run
 * detail carries, `null` for a finished run or nothing to say) so the Ask tab
 * can tell "open, answerable" from "answer saved" without a second fetch.
 * @param {{root: string, flow: string, runId: string, catalogue: any, resumeAttempt?: (flow: string, runId: string) => any}} opts
 * @returns {{flow:string, runId:string, asks:any[], resume: any, blocks: any[]}|null}
 */
export function getRunAsks({
  root, flow, runId, catalogue, resumeAttempt,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;
  const histRow = endRow(readHistory(run.flowDir), run.runDir, runId) ?? undefined;
  const hasHistoryRow = !!histRow;
  // hamr's 2026-09-27 browser-walk bug #4: the Ask tab's own asks must carry
  // the SAME `open`/`timeLeftMs` fields listStops already computes for the
  // Inbox — otherwise an open ask's Ask-tab header/body falls back to the
  // raw status word "unanswered" and no time-left, disagreeing with the
  // Inbox row for that exact same ask.
  const ordered = runAsksInOrder(run.runDir, hasHistoryRow, histRow?.outcome === 'ask-expired');
  const auditRows = readAudit(run.runDir);
  const flowRead = readFlow({
    root, name: flow, catalogue,
  });
  const declSteps = flowRead.ok ? flowRead.declaration.steps : null;
  const stepInfo = deriveAskStepInfo(ordered, auditRows, declSteps);
  let resume = hasHistoryRow ? null : deriveResumeState({ savedAnswer: readSavedAnswer(run.runDir), attempt: resumeAttempt?.(flow, runId) ?? null, ask: readAsk(run.runDir) });
  // M4c amendment 2: the Ask tab says what the run list says — stuck, by the one rule (`stuckState`).
  let runStuckNow = false;
  if (resume) {
    const st = runStuck(run.runDir, resume);
    if (st.stuck) {
      resume = {
        ...resume,
        label: st.label,
        ...(resume.reason === RESUME_REASON_UNKNOWN && st.why ? { reason: st.why } : {}),
        ...(st.reason === 'lock-no-holder' ? { lockPath: st.lockPath } : {}),
      };
      runStuckNow = true;
    }
  }
  const openAskJson = hasHistoryRow ? null : readAsk(run.runDir);
  const asks = ordered.map((ask, i) => ({
    ...ask,
    ...deriveAskOpenFields(ask, hasHistoryRow, resume),
    reopen: reopenOffer(ask, openAskJson, resume, readSavedAnswer(run.runDir)?.askId === ask.askId),
    stuck: runStuckNow && resume?.askId === ask.askId,
    index: i + 1,
    total: ordered.length,
    stepName: stepInfo[i].step,
    stepLine: stepInfo[i].line,
    stepWhy: stepInfo[i].why,
  }));
  return {
    flow, runId, asks, resume, blocks: groupAskBlocks(asks),
  };
}

/**
 * `GET /api/inbox` — every stop (parked ask, open or past) across every
 * flow under `root` (M4a-1 scope item 1), read-only, no answer controls
 * (those are M4b). Sorted open-first (soonest-expiring first — the most
 * urgent), then every past stop newest-answered-first; a row with neither a
 * known time-left nor a known answeredAt sorts last within its group rather
 * than being guessed into either end.
 *
 * hamr's 2026-09-27 live check: a run that has ended (its flow's own
 * history.jsonl carries a row for it) never contributes an open/unanswered
 * stop, no matter what its own ask.json/archive says — `legacyRunAsks`
 * already refuses to rebuild a stale slot into one, but `open` is ALSO
 * force-`false` here as a second, independent check (belt-and-braces on the
 * one thing the brief calls out by name: "the Inbox tab's open count counts
 * only truly open asks — parked run, no history row, unexpired, unanswered").
 * @param {{root: string, resumeAttempt?: (flow: string, runId: string) => any}} opts
 * @returns {any[]}
 */
export function listStops({ root, resumeAttempt }) {
  const rows = [];
  for (const flowName of listFlowNames(root)) {
    const flowDir = join(root, flowName);
    const historyRows = readHistory(flowDir).filter((r) => r && typeof r.runId === 'string');
    for (const runId of listRunIds(flowDir)) {
      const run = resolveRunPath(root, flowName, runId);
      if (!run.ok) continue;
      const end = endRow(historyRows, run.runDir, runId);
      const hasHistoryRow = end !== null;
      const resume = hasHistoryRow ? null : deriveResumeState({ savedAnswer: readSavedAnswer(run.runDir), attempt: resumeAttempt?.(flowName, runId) ?? null, ask: readAsk(run.runDir) });
      // M4c amendment 2: stuck by the ONE rule (`stuckState`), marked on the ask whose answer is saved.
      const st = runStuck(run.runDir, resume);
      const stuckAskId = !hasHistoryRow && st.stuck ? (resume?.askId ?? null) : null;
      const openAskJson = hasHistoryRow ? null : readAsk(run.runDir);
      const savedAskId = readSavedAnswer(run.runDir)?.askId;
      const runAsks = runAsksInOrder(run.runDir, hasHistoryRow, end?.outcome === 'ask-expired').map((ask) => ({
        flow: flowName,
        runId,
        ...ask,
        ...deriveAskOpenFields(ask, hasHistoryRow, resume),
        // an expired ask still open to Reopen says why, by the same offer (and line) its Ask tab draws
        ...(ask.why ? {} : { why: reopenOffer(ask, openAskJson, resume, savedAskId === ask.askId)?.why }),
        stuck: stuckAskId !== null && ask.askId === stuckAskId,
        stuckLabel: stuckAskId !== null && ask.askId === stuckAskId ? st.label : null,
        stuckLine: stuckAskId !== null && ask.askId === stuckAskId ? signParts('[II]', st.label ?? '').line : null,
      }));
      // M4c item 4: a run with no end row, no ask waiting on the human and no
      // saved-but-unresumed answer, whose newest pid row is alive, is "working
      // on your <decision>" — marked on that run's newest answered ask (the
      // one the live process took). `runLiveness` is the ONE liveness rule.
      const nothingWaiting = !runAsks.some((r) => r.waiting || r.resume);
      if (!hasHistoryRow && nothingWaiting && st.liveness === 'running') {
        const answered = runAsks.filter((r) => WORKING_WORD[r.status]);
        const newest = answered.reduce((best, r) => (best === null || sortMs(r.answeredAt) >= sortMs(best.answeredAt) ? r : best), null);
        if (newest) newest.working = WORKING_WORD[newest.status];
      }
      for (const r of runAsks) rows.push(r);
    }
  }
  return orderStops(rows).map((r) => {
    const glyph = stopGlyph(r);
    return glyph === null ? r : { ...r, glyph, word: SIGN_WORDS[glyph] };
  });
}

/** ask status -> the answer's own word, for "working on your <word>…". */
const WORKING_WORD = { accepted: 'accept', redo: 'redo', reran: 'rerun' };

/** ms for sorting; NaN when the stamp is absent/unparseable. */
function sortMs(iso) {
  return typeof iso === 'string' ? Date.parse(iso) : NaN;
}

/**
 * The ONE ordering of the Inbox (M4c item 4, hamr 2026-09-30); the page renders
 * in the order given and stamps each row's `section`:
 *  1 waiting on you — least time left first ("runs out first"); a stuck run
 *    (amendment 2: answer saved, nobody carrying it on) after the timed asks;
 *  2 working on an answer you gave (`working`), or answer saved and resume not
 *    started (`resume`) — newest answer first;
 *  3 answered and expired asks — newest first (answeredAt, else expiresAt).
 * A row with no known time sorts last within its section, ties by input order.
 * @param {any[]} rows
 * @returns {any[]}
 */
export function orderStops(rows) {
  const sectionOf = (r) => ((r.waiting || r.stuck) ? 1 : (r.working || r.resume) ? 2 : 3);
  const key = (r) => {
    const t = sectionOf(r) === 3 ? (sortMs(r.answeredAt) || sortMs(r.expiresAt)) : sortMs(r.answeredAt);
    return Number.isFinite(t) ? t : NaN;
  };
  return rows
    .map((row, index) => ({ row: { ...row, section: sectionOf(row) }, index }))
    .sort((a, b) => {
      const sa = a.row.section;
      const sb = b.row.section;
      if (sa !== sb) return sa - sb;
      if (sa === 1) {
        if (!!a.row.stuck !== !!b.row.stuck) return a.row.stuck ? 1 : -1;
        const at = typeof a.row.timeLeftMs === 'number' ? a.row.timeLeftMs : Infinity;
        const bt = typeof b.row.timeLeftMs === 'number' ? b.row.timeLeftMs : Infinity;
        return at !== bt ? at - bt : a.index - b.index;
      }
      const ak = key(a.row);
      const bk = key(b.row);
      const aKnown = Number.isFinite(ak);
      const bKnown = Number.isFinite(bk);
      if (aKnown && bKnown && ak !== bk) return bk - ak;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}

/**
 * N for `Inbox (N)` (M4c item 3): asks open and not expired, across every flow
 * and run, plus stuck runs (amendment 2: the human must act). An answered ask
 * whose resume is carried on is not `waiting`, so not counted; a crashed one
 * (answer taken, process gone) is not stuck and not counted;
 * an expired ask is not `open`. The page only shows this number.
 * @param {any[]} rows `listStops` rows
 * @returns {number}
 */
export function inboxOpenCount(rows) {
  return rows.filter((r) => r.waiting || r.stuck).length;
}
