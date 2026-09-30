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
  readFlow, listFlowNames, listRunIds, resolveRunDir, checkFlowName, readFileInside, readdirInside,
} from '../flow.js';
import {
  readAudit, readHistory, auditRowTokens, auditRowAt, auditRowTools,
} from '../books.js';
import { readAsk, readRunState, readLog } from '../runner.js';
import { readSpendRows } from '../provider.js';
import {
  readAskEvidence, listArchivedAsks, normalizeDecision, DECISION_STATUS,
} from '../ask.js';

/** `{ ok:false, red }` result shape every exported function here can return
 *  instead of throwing — the server maps this to a 4xx, never a crash.
 *  @param {string} red
 *  @returns {{ok:false, red:string}} */
function refuse(red) {
  return { ok: false, red };
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
 * @returns {{ok:true, flowDir:string}|{ok:false, red:string}}
 */
function resolveFlowDir(root, flowName) {
  const check = checkFlowName(flowName);
  if (!check.ok) return refuse(check.red);
  const flowDir = join(root, flowName);
  if (existsSync(flowDir)) {
    let realFlowDir;
    let realRoot;
    try {
      realFlowDir = realpathSync(flowDir);
      realRoot = realpathSync(root);
    } catch (err) {
      return refuse(`flow: could not resolve "${flowDir}" — ${err.message}`);
    }
    if (realFlowDir !== realRoot && !realFlowDir.startsWith(realRoot + sep)) {
      return refuse(`flow: "${flowName}" is a symlink that resolves outside root (${realFlowDir}) — refused`);
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
function hasConsumedAnswer(runDir, askId) {
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
 * @returns {{askId: string, decision: string|null}|null}
 */
export function readSavedAnswer(runDir) {
  const r = readFileInside(runDir, 'answer.json');
  if (!r.ok) return null;
  try {
    const a = JSON.parse(r.text);
    if (a && typeof a.askId === 'string' && a.askId.length > 0) {
      return { askId: a.askId, decision: typeof a.decision === 'string' ? normalizeDecision(a.decision) : null };
    }
  } catch { /* unparseable: not a usable answer */ }
  return null;
}

/** What the `resume` field says when the panel has no attempt record for a run
 *  (it restarted since the answer was saved) — said so, never blank. */
export const RESUME_REASON_UNKNOWN = 'reason unknown: the panel restarted, so it has no record of the resume attempt';

/**
 * M4b amendment 1 scope 2: the ONE derivation of "answer saved, resume not
 * started". From the books: an answer saved (`answer.json` present) and so
 * unconsumed. From the panel's in-memory attempt record (`attempt`, may be
 * null): whether a resume is still being started, and the resume's own refusal.
 * `null` when there is nothing to say (no saved answer and no attempt).
 * @param {{savedAnswer: {askId:string, decision:string|null}|null, attempt: any}} ctx
 * @returns {{state: 'starting'|'not-started'|'took-over', askId: string|null, tries: number|null, maxTries: number|null, reason: string|null, label: string}|null}
 */
export function deriveResumeState({ savedAnswer, attempt }) {
  const tries = attempt ? attempt.tries : null;
  const maxTries = attempt ? attempt.maxTries : null;
  if (savedAnswer) {
    if (attempt && attempt.state === 'in-flight' && attempt.askId === savedAnswer.askId) {
      return {
        state: 'starting', askId: savedAnswer.askId, tries, maxTries, reason: null, label: 'answer saved, resume starting',
      };
    }
    const mine = attempt && attempt.askId === savedAnswer.askId;
    return {
      state: 'not-started',
      askId: savedAnswer.askId,
      tries: mine ? tries : null,
      maxTries: mine ? maxTries : null,
      reason: mine && typeof attempt.refusal === 'string' && attempt.refusal.length > 0 ? attempt.refusal : RESUME_REASON_UNKNOWN,
      label: 'answer saved, resume not started',
    };
  }
  if (attempt) {
    return {
      state: 'took-over', askId: attempt.askId, tries, maxTries, reason: null, label: 'resume took over the answer',
    };
  }
  return null;
}

/**
 * The glyph + human-words label for one run — ported verbatim (in spirit,
 * from real derivation, not a shortcut) from `poc/m4/panel-data.mjs`'s
 * `computeGlyph`, the derivation the M4a POC proved against every real run
 * on disk. Ladder wording (M4a scope item 4):
 *  - `[✓]` passed — a history row with `outcome:'complete'`.
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
 *  - `[?]` died / unknown — no history row, no open ask, no consumed answer:
 *    `resume.lock` carries no pid and nothing checks liveness (M4a's own
 *    open POC question), so a crashed resumer and a live one look the same
 *    on disk. Never guessed into `[✗]` or `[✓]`.
 *  - `[·]` answer saved, resume not started / starting (M4b amendment 1) —
 *    `answer.json` still on disk (`resume` = `deriveResumeState`): never
 *    "waiting on you" (the human already answered) and never a success.
 * @param {{historyRow: any, askJson: any, consumedAnswerExists: boolean, hasStateJson: boolean, resume?: any}} ctx
 * @returns {{glyph: '[✓]'|'[✗]'|'[·]'|'[!]'|'[?]', label: string}}
 */
export function computeGlyph({
  historyRow, askJson, consumedAnswerExists, hasStateJson, resume,
}) {
  if (historyRow) {
    if (historyRow.outcome === 'complete') return { glyph: '[✓]', label: 'passed' };
    // M4b amendment 3: a run the human ended on purpose with rerun is not a failure.
    if (historyRow.outcome === 'rerun') return { glyph: '[✗]', label: 'stopped by you (rerun), a fresh run was started' };
    return { glyph: '[✗]', label: `failed (${historyRow.outcome ?? 'unknown outcome'})` };
  }
  if (askJson && resume && (resume.state === 'starting' || resume.state === 'not-started')) {
    return { glyph: '[·]', label: resume.label };
  }
  // No history row. A park never writes one, and a consumed answer file
  // stays on disk until resume writes its own history row — "no history
  // row" alone never means died.
  if (askJson && !consumedAnswerExists) {
    const expiresMs = typeof askJson.expiresAt === 'string' ? Date.parse(askJson.expiresAt) : NaN;
    if (Number.isFinite(expiresMs) && Date.now() > expiresMs) {
      return { glyph: '[!]', label: 'ask expired, not resumed yet' };
    }
    return { glyph: '[·]', label: 'waiting on you (parked, unanswered)' };
  }
  if (askJson && consumedAnswerExists) {
    return { glyph: '[·]', label: 'answered, not resumed yet' };
  }
  if (hasStateJson && !askJson) {
    return { glyph: '[?]', label: 'running or died: unknown (parked state with no open ask and no history row)' };
  }
  return { glyph: '[?]', label: 'running or died: unknown (resume.lock has no pid, no liveness check)' };
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
  if (verdict === 'paused' || verdict === 'refused' || verdict === 'ask-timeout' || verdict === 'ask-expired') return '·';
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

/**
 * A step group's own state word for the Audit tab's collapsed header —
 * the SAME rule `src/panel/index.html`'s client-side `stepBoxState` already
 * applies to the Run tab's map/cards (ported here so the Audit header can
 * be computed server-side too, off the SAME last-row-wins logic): `waiting`
 * (the run is currently parked on this step — its last attempt's verdict is
 * `paused`/`refused`), `done` (the last attempt passed — `green`/`hitl`),
 * `stopped` (the last attempt failed for any other reason). A group only
 * ever exists for a step with at least one row, so `pending` never appears
 * here (unlike the Run tab's map, which also covers never-attempted steps).
 * @param {Array<{verdict:string}>} rows one step's own audit rows, book order
 * @returns {'done'|'waiting'|'stopped'}
 */
export function deriveStepGroupState(rows) {
  const last = rows[rows.length - 1];
  if (last.verdict === 'paused' || last.verdict === 'refused') return 'waiting';
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
  const byStep = {};
  for (const r of enrichedRows) {
    if (!Object.prototype.hasOwnProperty.call(byStep, r.step)) { byStep[r.step] = []; order.push(r.step); }
    byStep[r.step].push(r);
  }
  return order.map((step) => {
    const rows = byStep[step];
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

    const tryMarks = deriveStepTryMarks(closeClass, rows);
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
      tryCount: tryMarks.length,
      tryMarks,
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
  const historyRows = readHistory(flowDir);
  const historyRow = historyRows.find((r) => r && r.runId === runId) ?? null;
  const auditRows = readAudit(runDir);
  const spendRows = readSpendRows(join(runDir, 'spend.jsonl'));
  const logJson = readLog(runDir);
  const askJson = readAsk(runDir);
  const stateJson = readRunState(runDir);
  const consumedAnswerExists = hasConsumedAnswer(runDir, askJson && typeof askJson.askId === 'string' ? askJson.askId : null);
  // A finished run has no resume to report (its history row says how it ended).
  const resume = historyRow ? null : deriveResumeState({ savedAnswer: readSavedAnswer(runDir), attempt });

  return {
    flowName,
    runId,
    flowDir,
    runDir,
    flowRead,
    historyRow,
    auditRows,
    spendRows,
    logJson,
    askJson,
    stateJson,
    consumedAnswerExists,
    hasStateJson: stateJson !== null,
    resume,
  };
}

/**
 * `GET /api/runs` — every flow under `root`, every run under each flow
 * (M4a scope item 2). A flow with zero runs still gets one row (`runId:
 * null`, an explicit `why`) — no flow is silently missing from the list.
 * Newest-first by history `at` where known; a row with no history row (died
 * or still parked) sorts after every row that has one, in flow/run order
 * (a real ordering, never `Date.now()` guessed in for a missing `at`).
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
        resume: ctx.resume,
        spend,
        spendWhy: (!ctx.historyRow && spend === null) ? 'no history row yet and no priced spend.jsonl rows — nothing to floor' : null,
        at: ctx.historyRow ? ctx.historyRow.at : null,
        askedAt,
        atWhy: (ctx.historyRow || askedAt) ? null : 'no history row yet (parked or died before one was written)',
      });
    }
  }
  // Newest first by `at` where present; rows with no `at` keep flow/run
  // order (already alphabetical from listFlowNames/listRunIds) at the end.
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const am = typeof a.row.at === 'string' ? Date.parse(a.row.at) : NaN;
      const bm = typeof b.row.at === 'string' ? Date.parse(b.row.at) : NaN;
      const aKnown = Number.isFinite(am);
      const bKnown = Number.isFinite(bm);
      if (aKnown && bKnown) return bm - am;
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
 * @param {Array<{verdict:string}>} list
 * @returns {number}
 */
function computeTryCount(closeClass, list) {
  if (!list || !list.length) return 0;
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
    : (ctx.historyRow ? 'history row has no wallMs recorded' : 'no history row yet (parked or died before completion)');

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
    resume: ctx.resume,
    outcome: ctx.historyRow ? ctx.historyRow.outcome : null,
    outcomeWhy: ctx.historyRow ? null : 'no history row (parked or died before completion)',
    capUsd: ctx.historyRow ? ctx.historyRow.capUsd : (ctx.flowRead.ok ? ctx.flowRead.arbiter.capUsd : null),
    spend,
    model,
    modelWhy,
    spendSummary,
    wallMs,
    wallMsWhy,
    steps,
    stepsWhy,
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
    atWhy: (ctx.historyRow || (ctx.askJson && typeof ctx.askJson.askedAt === 'string'))
      ? null
      : 'no history row yet (parked or died before completion)',
  };
}

/**
 * `GET /api/runs/:flow/:runId/audit` — the Audit/logs tab (M4a scope item
 * 2): the raw `audit.jsonl` rows, scoped strictly to this run (each run's
 * own `audit.jsonl` file already carries only its own rows — there is no
 * shared-sidecar contamination risk here the way bareloop's gate-audit
 * sidecar had). `null` when the flow/runId doesn't resolve (404).
 * @param {{root: string, flow: string, runId: string}} opts
 * @returns {{flow:string, runId:string, rows:any[], groups:any[], empty:boolean, why:string|null}|null}
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
    empty: rows.length === 0,
    why: rows.length === 0 ? 'audit.jsonl is empty or missing — no attempt has been made yet' : null,
  };
}

/**
 * `GET /api/runs/:flow/:runId/job` — the Job tab (M4a scope item 2): the
 * signed prose, the arbiter block (cap, asks with TTL, redo cap, sends,
 * sources), and the signature (who, when, hash). Derived purely from the
 * flow's own signed files (`readFlow`) — fwdloop always has exactly one
 * signed `declaration.json` + `signature.json` per flow, so there is no
 * multi-source provenance chain to resolve (unlike bareloop's `getRunJob` —
 * DROPPED per the fit-check). `runId` is only used to confirm the run
 * exists at all; `null` when it doesn't (404).
 * @param {{root: string, flow: string, runId: string, catalogue: any}} opts
 * @returns {any|null}
 */
/**
 * hamr's 2026-09-27 exit-check review #5: one plain-words sentence for a
 * declared step's own close rule — the Job tab's "Success" field. Derived
 * STRICTLY from `step.close` (and, for the "your accept" wording, whether
 * this step is the one line `arbiter.asks[]` itself binds to) — never a
 * fabricated cite/shape value:
 *  - `hitl`: "human check", or "human check (your accept)" when this step's
 *    own `fromLine` is a signed ask line (the ask step itself — the one a
 *    human pauses a run on, distinct from an ordinary hitl pass-through
 *    step with no ask binding).
 *  - `softgreen`: "shape: N headings (a / b / c)" when `close.shape.sections`
 *    is signed, "max W words" appended when `close.shape.maxWords` is
 *    signed, "blocks of L lines" / "must carry: a, b" for the invoice-block
 *    shape keys (`linesPerInvoice`/`mustCarry`) — every signed shape key
 *    shown, nothing invented; "shape (no shape rules signed)" when a
 *    softgreen step signs no `close.shape` at all (declaration.js allows
 *    this — an empty/absent shape is not itself a red).
 *  - `green`: "cited" — `CLOSE_ALLOWED` (`src/declaration.js`) never lets a
 *    step declare WHAT it cites ahead of time (that's the drafted
 *    artifact's own per-run field data, not signed prose), so there is
 *    never anything honest to append here.
 *  - anything else: the raw class name, named as unknown, never silently
 *    dropped or guessed into one of the three above; no class at all names
 *    that plainly too.
 * @param {{close?: {class?: string, shape?: any}, fromLine?: number|null}} step one `declaration.steps` entry
 * @param {Array<{line:number}>} arbiterAsks `arbiter.asks`, for the "your accept" check
 * @returns {string}
 */
export function deriveStepSuccessText(step, arbiterAsks) {
  const cls = step?.close?.class ?? null;
  if (cls === null) return 'no close class recorded';
  if (cls === 'hitl') {
    const isAskStep = Array.isArray(arbiterAsks) && arbiterAsks.some((a) => a.line === step.fromLine);
    return isAskStep ? 'human check (your accept)' : 'human check';
  }
  if (cls === 'green') return 'cited';
  if (cls === 'softgreen') {
    const shape = step?.close?.shape;
    if (!shape || typeof shape !== 'object') return 'shape (no shape rules signed)';
    const parts = [];
    if (Array.isArray(shape.sections) && shape.sections.length > 0) {
      parts.push(`${shape.sections.length} heading${shape.sections.length === 1 ? '' : 's'} (${shape.sections.join(' / ')})`);
    }
    if (typeof shape.maxWords === 'number') parts.push(`max ${shape.maxWords} words`);
    if (typeof shape.linesPerInvoice === 'number') parts.push(`blocks of ${shape.linesPerInvoice} lines`);
    if (Array.isArray(shape.mustCarry) && shape.mustCarry.length > 0) parts.push(`must carry: ${shape.mustCarry.join(', ')}`);
    return parts.length > 0 ? `shape: ${parts.join(', ')}` : 'shape (no shape rules signed)';
  }
  return `unknown close class "${cls}"`;
}

/**
 * `GET /api/runs/:flow/:runId/job` — the Job tab (hamr's 2026-09-27
 * exit-check review #5: bareloop-style one-field-per-piece layout,
 * replacing the old split asks/sends/sources/signed-lines blocks). Every
 * field is read straight off `readFlow`'s own signed declaration.json/
 * signature.json/prose lines — nothing invented; a piece the books can't
 * name carries its own why, never a blank or a guess. Field order (server
 * order matches the page's own render order): prose, asks, model, cap
 * (+redo cap), sources, sends, guardrails, success (one row per step, off
 * `deriveStepSuccessText`), signature.
 * @param {{root: string, flow: string, runId: string, catalogue: any}} opts
 * @returns {any|null}
 */
export function getRunJob({
  root, flow, runId, catalogue,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;

  const flowRead = readFlow({ root, name: flow, catalogue });
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
  const a = flowRead.arbiter ?? {};
  const asks = a.asks ?? [];
  const sends = a.sends ?? [];
  const sources = a.sources ?? [];
  const declSteps = Array.isArray(flowRead.declaration?.steps) ? flowRead.declaration.steps : [];
  return {
    flow,
    runId,
    resolved: true,
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
    // review #5: "Success" — one row per declared step, in declaration order.
    success: declSteps.map((s) => ({ step: s.emits, text: deriveStepSuccessText(s, asks) })),
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
  const open = isOpenStatus(ask.status) && !hasHistoryRow;
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
    evidence: flattenEvidence(a.evidence),
  };
}

/** `^answer\.<askId>\.consumed\.json$` — deliberately excludes
 *  `answer.stale.<n>.json` (no capture group would match "stale" as a real
 *  askId; the stale-quarantine writer in `src/ask.js` uses that different
 *  name specifically so this convention-based scan never mistakes a
 *  quarantined stale answer for a real consumed one). */
const CONSUMED_ANSWER_RE = /^answer\.(.+)\.consumed\.json$/;

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
      status: DECISION_STATUS[normalizeDecision(parsed.decision)] ?? `unrecognised: ${parsed.decision}`,
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
function runAsksInOrder(runDir, hasHistoryRow) {
  const archivedResult = listArchivedAsks(runDir);
  const rows = archivedResult.archived
    ? archivedResult.asks.map(normalizeArchivedRow)
    : legacyRunAsks(runDir, hasHistoryRow);
  return rows
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
 * @returns {{flow:string, runId:string, asks:any[], resume: any}|null}
 */
export function getRunAsks({
  root, flow, runId, catalogue, resumeAttempt,
}) {
  const run = resolveRunPath(root, flow, runId);
  if (!run.ok) return null;
  if (!existsSync(run.runDir)) return null;
  const hasHistoryRow = readHistory(run.flowDir).some((r) => r && r.runId === runId);
  // hamr's 2026-09-27 browser-walk bug #4: the Ask tab's own asks must carry
  // the SAME `open`/`timeLeftMs` fields listStops already computes for the
  // Inbox — otherwise an open ask's Ask-tab header/body falls back to the
  // raw status word "unanswered" and no time-left, disagreeing with the
  // Inbox row for that exact same ask.
  const ordered = runAsksInOrder(run.runDir, hasHistoryRow);
  const auditRows = readAudit(run.runDir);
  const flowRead = readFlow({
    root, name: flow, catalogue,
  });
  const declSteps = flowRead.ok ? flowRead.declaration.steps : null;
  const stepInfo = deriveAskStepInfo(ordered, auditRows, declSteps);
  const resume = hasHistoryRow ? null : deriveResumeState({ savedAnswer: readSavedAnswer(run.runDir), attempt: resumeAttempt?.(flow, runId) ?? null });
  const asks = ordered.map((ask, i) => ({
    ...ask,
    ...deriveAskOpenFields(ask, hasHistoryRow, resume),
    index: i + 1,
    total: ordered.length,
    stepName: stepInfo[i].step,
    stepLine: stepInfo[i].line,
    stepWhy: stepInfo[i].why,
  }));
  return {
    flow, runId, asks, resume,
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
    const historyRunIds = new Set(readHistory(flowDir).filter((r) => r && typeof r.runId === 'string').map((r) => r.runId));
    for (const runId of listRunIds(flowDir)) {
      const run = resolveRunPath(root, flowName, runId);
      if (!run.ok) continue;
      const hasHistoryRow = historyRunIds.has(runId);
      const resume = hasHistoryRow ? null : deriveResumeState({ savedAnswer: readSavedAnswer(run.runDir), attempt: resumeAttempt?.(flowName, runId) ?? null });
      for (const ask of runAsksInOrder(run.runDir, hasHistoryRow)) {
        rows.push({
          flow: flowName,
          runId,
          ...ask,
          ...deriveAskOpenFields(ask, hasHistoryRow, resume),
        });
      }
    }
  }
  return rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      if (a.row.waiting !== b.row.waiting) return a.row.waiting ? -1 : 1;
      if (a.row.waiting && b.row.waiting) {
        const at = typeof a.row.timeLeftMs === 'number' ? a.row.timeLeftMs : Infinity;
        const bt = typeof b.row.timeLeftMs === 'number' ? b.row.timeLeftMs : Infinity;
        if (at !== bt) return at - bt;
        return a.index - b.index;
      }
      const am = typeof a.row.answeredAt === 'string' ? Date.parse(a.row.answeredAt) : NaN;
      const bm = typeof b.row.answeredAt === 'string' ? Date.parse(b.row.answeredAt) : NaN;
      const aKnown = Number.isFinite(am);
      const bKnown = Number.isFinite(bm);
      if (aKnown && bKnown) return bm - am;
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      return a.index - b.index;
    })
    .map(({ row }) => row);
}
