// borrowed-from: bareloop src/authorscout.js@v0.56.0 (3383cce)
// THE LOOKING HALF — close-authoring v1, module M3a (design record 2026-08-07
// D11; gate-2 POC prereg addendum 5, lever L1).
//
// D11's line, verbatim: *the scout looks, the author writes, neither acts.* This
// module is the LOOKING. It produces the two inputs the authoring call cannot
// derive from an interview answer, and it produces them WITHOUT the authoring
// call ever gaining a tool:
//
//   1. THE FACTS OBJECT — a bounded, read-only LLM survey of the patient. Result
//      5's knowledge (`MYPYPATH`, pytest `-ra`, per-stage timeouts) came from
//      paying for live runs; none of it is in an interview answer and none of it
//      is derivable from prose.
//   2. THE SEED FILE LISTING — mechanical, $0, deterministic. No model. Round 2's
//      arm A derived `src/alertEmail.js` from the user's words ("the alert email
//      one") and silently reclassified 15 real errors into the wrong population.
//      A path is read off the repository or it does not exist.
//
// WHAT TRANSFERS FROM THE PLAN SCOUT, BY NAME (`src/planrun.js:41-62`): a hard
// round bound (`SCOUT_ROUNDS` 8); write-class and store-class verbs filtered OUT
// of the menu, so the survey is read-only BY CONSTRUCTION and not by promise; an
// output cap (`SCOUT_BLOB_MAX`); F59's reserved TOOLLESS final round; and
// `SCOUT_MIN_BYTES`, below which a survey is ABSENT rather than empty.
//
// WHAT DOES NOT TRANSFER, stated rather than assumed (D11): the plan scout
// derives its menu from a SIGNED `tools` ceiling and runs inside a fenced
// workdir. This scout runs at JOB CREATION, before any spec exists — there is no
// signed ceiling and no fence to derive from, so its grant is FIXED HERE and is
// not spec-authorable. Same arbiter line, one step earlier than usual.
//
// F59 IS THE FINDING THIS MODULE EXISTS TO HONOUR, and it bites harder here than
// it did upstream. An empty `{}` must read as *"the scout did not complete"*,
// never as *"no special facts are needed"*: the plan scout's version of that
// mistake cost a survey; this one lands in a SIGNED artefact, and a missing
// `MYPYPATH` becomes a close that grades the wrong checkout, signed by a user who
// could not have known. Five routes to ABSENT, and every one of them says which.
//
// The listing has TWO consumers and they get DIFFERENT things, deliberately:
//   - the VALIDATOR (`validateDeclaration`'s `listing`) gets the WHOLE tree.
//     Handing it the scoped subset would make `scopeOfJob` read a job scoped to
//     `src/` as whole-tree and silently switch off the F84 one-population law.
//   - the PROMPT gets the block, scoped to the survey's own sourcePaths/testPaths
//     and capped in announced tiers (F28 — nothing is hidden without being
//     counted).
//
// Secrets: the survey blob is scrubbed AT CAPTURE through the one
// `SECRET_PATTERNS` inventory, before it becomes a prompt ingredient or a record
// — a log that captures a key captures it forever.

import { createRequire } from 'node:module';
import { join } from 'node:path';
import { Gate } from 'bareguard';
import { LiteCtx } from 'litectx';
import { seedListing, GATE_AUDIT_FILE, ARBITER_BOOK_STORES } from './kinds.js';
import { TOOL_MENU, WRITE_VERBS, STORE_VERBS } from './job.js';
import { TOOL_BY_VERB, CTX_TOOLS, createCtxTools, toolAction, gatedShellOptions, strategyFor } from './tools.js';
import { redactSecrets, SECRET_PATTERNS } from './validate.js';
import { extractArtifact, priceOf, scrubRaw, stampRaw, tallyCalls, capStop, callCasualty } from './text.js';
import { PROVIDER_TIMEOUT_MS } from './clock.js';
import { lookReadTools, lookReportSchema, lookPrompt, verifyLookReport, labelListsOf, LOOK_REPORT_TOOL } from './inputlook.js';

const require = createRequire(import.meta.url);
const { Loop, wireGate } = require('bare-agent');
const { createShellTools } = require('bare-agent/tools');

/**
 * F152/PRD 30.4 — the scout's per-call IDLE bound. Every `loop.run()` in this
 * module carried NO time bound at all: a live endpoint that accepts and never
 * answers hangs the process forever (measured) — an open socket is an active
 * handle, so node never drains and no backstop can fire.
 *
 * UNLIKE the run path (`callBounds()`, src/planrun.js:1518), this pipeline has
 * NO wall clock to derive a bound FROM — the authoring pipeline is genuinely
 * clockless (`src/authorjob.js`/`src/authorflow.js`/`scripts/run-author.mjs`
 * carry a money ceiling, `ceilingUsd`/`capStop`, and never a `maxWallMs`).
 * Rather than inventing a fresh number, this reuses the EXACT ceiling the run
 * path itself falls back to when ITS OWN wall is unbounded
 * (`PROVIDER_TIMEOUT_MS`, `src/clock.js` — BA-18's idle timeout, already an
 * approved "no wall present" default one layer up): an authoring-time call is
 * the identical situation, one call earlier.
 *
 * It bounds SOCKET INACTIVITY only (reset by every byte, per BA-18) — a call
 * that is merely slow keeps streaming and is untouched; only a truly silent
 * endpoint trips it. TIGHTEN-ONLY, like every cap in this file: this is an
 * operator-set ceiling fixed here, not a param a caller or a signed spec may
 * widen (a defaulted cap is a silent second ceiling, and there is no clock
 * whose narrower reading could ever tighten it further).
 */
export const AUTHOR_CALL_TIMEOUT_MS = PROVIDER_TIMEOUT_MS;

/** src/planrun.js:42 — the survey's hard round bound. */
export const AUTHOR_SCOUT_ROUNDS = 8;
/** src/planrun.js:44 — the survey is a PROMPT INGREDIENT for the authoring call. */
export const AUTHOR_SCOUT_BLOB_MAX = 8000;
/**
 * src/planrun.js:62 — below this a survey is ABSENT, not empty. Sized off the
 * archive rather than taste: 15 truncated scouts produced 0/74/86 bytes; every
 * real survey was 5991-8056. It is imported as a NUMBER, not as an import, on
 * purpose — planrun does not export it, and a `SCOUT_MIN_BYTES` that drifts
 * between the two scouts is two instruments, so the suite pins them equal.
 */
export const AUTHOR_SCOUT_MIN_BYTES = 200;
/** F30 — the 4096 provider default cannot hold a whole survey. */
export const AUTHOR_SCOUT_MAX_TOKENS = 32000;

/**
 * TOTAL survey attempts, HARDCODED (hamr, 2026-08-09: *"depending on causes, we
 * can hardcode 3 attempts, but if reasons are beyond malformed then we may verge
 * into self-healing but i don't think we should"*).
 *
 * It is a ceiling, not a target: an operator may pass a LOWER cap and never a
 * higher one, exactly the direction the standing budget rule runs in (*the agent
 * may only TIGHTEN*). A widened value CLAMPS here rather than throwing, because
 * the number is not a signed artefact — nothing downstream depends on a caller
 * having asked for the right one, and refusing a run over a too-generous cap
 * costs a paid scout for no safety.
 *
 * Sited beside `MAX_REVISIONS`/`MAX_STRUCTURE_RETRIES` in spirit: the same
 * bounded-retry family, one axis each. This one is the SURVEY's axis.
 */
export const SCOUT_ATTEMPTS = 3;

/**
 * THE TYPED CAUSE, at the detection site.
 *
 * The retry gate reads this enum and nothing else. Typing it here is what stops
 * the gate quietly widening to "any ABSENT" the next time someone edits the
 * classifier: a new route to ABSENT has to be named, and naming it is the moment
 * somebody decides whether it retries.
 */
export const SURVEY_CAUSES = Object.freeze({
  /** the call itself died — provider error, transport, `truncated:max_tokens` */
  CALL_FAILED: 'call-failed',
  /** the model returned nothing at all, and nothing went wrong to explain it */
  EMPTY: 'empty',
  /** short of the ABSENT floor but not empty — F59's cut-off population */
  SHORT: 'short',
  /** nothing extractable in the reply */
  NO_ARTIFACT: 'no-artifact',
  /** there IS a body and it is not JSON — run mslhn707's own death */
  UNPARSEABLE: 'unparseable',
  /** valid JSON, wrong shape */
  NON_OBJECT: 'non-object',
  /** valid JSON, no content — F59's whole point, and a SEMANTIC failure */
  EMPTY_OBJECT: 'empty-object',
  /**
   * THE SURVEY WAS NEVER ASKED FOR: the operator's money ceiling was already
   * spent when the first attempt came due, so no call was made. Named as its own
   * cause for the reason this enum exists at all — a new route to ABSENT has to
   * be named, and naming it is the moment somebody decides whether it retries.
   * This one does not, and cannot: a retry is precisely what the cap forbade.
   * It is deliberately ABSENT of the model's own doing, and the prose says so —
   * "the scout did not complete" would blame a model that never spoke.
   */
  NOT_FUNDED: 'not-funded',
});

/**
 * THE MALFORMED CLASS — the only causes a retry fires on.
 *
 * What is deliberately NOT here, and why:
 *   - `call-failed` covers `truncated:max_tokens` and every transport death.
 *     Standing doctrine routes both as provider-red with NO redraft; a retry
 *     here would pay for the same failure again under a different name.
 *   - `short` is F59's cut-off population, and it already has an instrument: the
 *     reserved TOOLLESS recovery round, which fires inside the attempt.
 *   - `non-object` and `empty-object` are VALID JSON with wrong or vacuous
 *     content. That is a SEMANTIC failure, and F38/F39 measured what re-asking
 *     one buys: the same distribution, sampled twice. Reacting to content is a
 *     designed loop; this is a retry. The line between them is the self-healing
 *     line, and it is not crossed here.
 */
/** @type {readonly string[]} */
export const SCOUT_RETRY_CAUSES = Object.freeze([SURVEY_CAUSES.EMPTY, SURVEY_CAUSES.UNPARSEABLE]);

/**
 * The re-ask, when the survey came back MALFORMED. It names what failed
 * MECHANICALLY — the parse error and its position — which is the gap genre that
 * converts (F38/F39), and it says explicitly that the FINDINGS are not in
 * question, only their form.
 *
 * There is NO JSON repair anywhere behind this and there never will be: a
 * repairer decides what the model meant to say and writes it down as though the
 * model had said it. That is a dishonest instrument in the one artefact whose
 * entire job is to be honest about what the repository contains.
 * @param {string} reason the classifier's own mechanical reason
 */
export function scoutReaskTurn(reason) {
  return `MEASURED PARSE — your survey could not be read:\n  ${redactSecrets(String(reason ?? ''))}\n\n`
    + 'The facts you found are not in question — only the form was unreadable. Do not go looking again and do not '
    + 'change what you reported. Reply with ONLY the JSON object, in a single fenced block, and nothing else.';
}

/**
 * THE GRANT: the full menu MINUS every write-class and store-class verb.
 * Read-only by MENU CONSTRUCTION — no write-class tool object is ever built, so
 * there is nothing for a fence to have to refuse. Derived from the shipped
 * constants so a verb added to `TOOL_MENU` is covered the day it lands.
 */
export const AUTHOR_SCOUT_VERBS = Object.freeze(
  TOOL_MENU.filter((v) => !WRITE_VERBS.includes(v) && !STORE_VERBS.includes(v)),
);

export const SCOUT_SYSTEM = 'You are a senior engineer performing a READ-ONLY survey of a repository. '
  + 'ALWAYS use absolute paths — relative paths resolve against the process, not the repository, and will be denied. '
  + 'You cannot write, and you cannot run commands: you have no shell and no test runner, so every statement you make '
  + 'is read off configuration, source, lockfiles and documentation. '
  + 'You have a hard, small number of exploration turns. Read only what you need. '
  + 'Your single deliverable is a facts object about how this repository is BUILT, TYPE-CHECKED and TESTED. '
  + 'You are not deciding what should be done to it and you are not proposing any work.';

/**
 * F59's reserved round, as a FIXED constant. The round is toolless BY
 * CONSTRUCTION (`defs` is `[]`, so text is the only output the model can
 * produce) — never by asking politely in prose (F19/F37).
 */
export const SCOUT_RECOVERY_PROMPT = 'You are out of exploration turns. Write the facts object NOW, from what you '
  + 'have already read. Reply with ONLY the JSON object in a single fenced block.';

/**
 * The survey brief. Deliberately NEUTRAL about what anyone will do with the
 * facts: this scout is not allowed to have an opinion about the work, because
 * the authoring call is the only thing that composes a close (D11).
 * @param {string} workdir the ABSOLUTE repository root
 */
export function scoutPrompt(workdir) {
  return `Repository root (absolute): ${workdir}

Survey this repository and report how it is type-checked and tested. You cannot execute
anything, so mark anything you infer rather than read as "inferred".

Report, as a single JSON object, with these keys — use null for anything you genuinely
could not establish, and never guess a command you did not find written down somewhere:

{
  "language":        e.g. "javascript" | "typescript" | "python" | ...,
  "runner":          the test runner this repository actually uses,
  "typecheck":       { "cmd": "<executable>", "args": ["..."], "cwd": "<relative dir or null>",
                       "env": {"NAME": "value"} | {}, "source": "<where you read this>",
                       "inferred": true|false },
  "test":            { "cmd": "<executable>", "args": ["..."], "cwd": "<relative dir or null>",
                       "env": {"NAME": "value"} | {}, "source": "<where you read this>",
                       "inferred": true|false },
  "envNeeds":        [ { "name": "...", "value": "...", "why": "..." } ],
  "sourcePaths":     ["..."],
  "testPaths":       ["..."],
  "extensions":      [".js", ...],
  "outputShapes":    { "typecheckErrorLine": "<the literal shape of one diagnostic line>",
                       "testSummaryLine": "<the literal shape of the runner's count summary line>",
                       "inferred": true|false },
  "layout":          "<one or two sentences: packages, nesting, anything unusual>",
  "notes":           ["anything else load-bearing for grading work done in this repository"]
}

On "envNeeds": include any environment variable WITHOUT WHICH the type checker or the test
runner would resolve to the wrong files, cache stale results, or emit output that cannot be
parsed. Say why, in the "why" field. If there are none, use [].

Reply with ONLY the JSON object, in a single fenced block. No commentary before or after.`;
}

/**
 * @typedef {{bytes: number, rounds: number, bounded: boolean, recovered: boolean, error: string|null,
 *   attempts?: number, attemptsAllowed?: number}} SurveyMeta
 * @typedef {{state: 'PRESENT'|'ABSENT', facts: any, reason: string|null, cause: string|null, meta: SurveyMeta}} Survey
 */

/**
 * THE F59 CONTRACT, IN CODE. Six routes to ABSENT, one route to PRESENT — and
 * the LAST of them is the whole point of the finding: a parsed `{}` is the
 * scout FAILING, never "no special facts are needed".
 *
 * Every ABSENT route also carries a TYPED `cause` beside its prose reason. The
 * prose is for the operator; the type is what the retry gate reads, so widening
 * that gate requires editing the enum rather than a regular expression over a
 * sentence (the standing rule: hand over the enumerated set, never a rule about
 * prose). `empty` is split OUT of the byte floor for exactly that reason — "the
 * model said nothing" and "the model was cut off mid-sentence" are two findings
 * that used to render as one number.
 * @param {string} blob the scrubbed, capped survey text
 * @param {SurveyMeta} meta
 * @returns {Survey}
 */
export function classifySurvey(blob, meta) {
  const absent = (/** @type {string} */ reason, /** @type {string} */ cause) => ({
    state: /** @type {'ABSENT'} */ ('ABSENT'), facts: null, reason, cause, meta,
  });
  if (meta.error) return absent(`the survey call failed: ${meta.error}`, SURVEY_CAUSES.CALL_FAILED);
  if (String(blob ?? '').trim() === '') {
    return absent('the survey came back EMPTY and nothing failed to explain it — the scout did not complete', SURVEY_CAUSES.EMPTY);
  }
  if (meta.bytes < AUTHOR_SCOUT_MIN_BYTES) {
    return absent(`survey ${meta.bytes} bytes < ${AUTHOR_SCOUT_MIN_BYTES} — the scout did not complete`, SURVEY_CAUSES.SHORT);
  }
  const { code, red } = extractArtifact(blob);
  if (!code) return absent(`no artifact in the survey: ${red}`, SURVEY_CAUSES.NO_ARTIFACT);
  let parsed;
  try { parsed = JSON.parse(code); } catch (e) {
    return absent(`the survey did not parse as JSON: ${String(/** @type {any} */ (e)?.message ?? e)}`, SURVEY_CAUSES.UNPARSEABLE);
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return absent('the survey parsed to a non-object', SURVEY_CAUSES.NON_OBJECT);
  }
  if (Object.keys(parsed).length === 0) {
    return absent('the survey parsed to an EMPTY object — that is the scout not completing, never "no special facts are needed"', SURVEY_CAUSES.EMPTY_OBJECT);
  }
  return { state: 'PRESENT', facts: parsed, reason: null, cause: null, meta };
}

/**
 * The DEFAULT surveyor: a real bareguard fence plus the granted read-only tools.
 * Read-only TWICE OVER — the menu carries no write verb, and the fence grants no
 * write path — and the arbiter's own books are denied outright, exactly as every
 * worker's are.
 *
 * It is a seam because it is the only part of this module that needs a live
 * process, an index and a gate; the ROUND BOUND and the F59 recovery stay in
 * `runAuthorScout` where they can be proven.
 * @param {{workdir: string, granted: readonly string[], auditPath?: string, ctx?: boolean}} o
 */
export async function defaultSurveyor({ workdir, granted, auditPath = join(workdir, GATE_AUDIT_FILE), ctx = true }) {
  const gate = new Gate({
    fs: { writeScope: [], readScope: [workdir], deny: [auditPath, ...ARBITER_BOOK_STORES.map((s) => join(workdir, s))] },
    limits: { maxTurns: AUTHOR_SCOUT_ROUNDS + 2 },
    audit: { path: auditPath },
    secrets: { patterns: SECRET_PATTERNS },
    humanChannel: async () => ({ decision: 'terminate' }),
  });
  await gate.init();
  const { policy, onLlmResult } = wireGate(gate, {
    actionTranslator: (/** @type {string} */ n, /** @type {any} */ a) => toolAction(n, a, workdir),
  });

  const names = new Set(granted.map((v) => /** @type {Record<string,string>} */ (TOOL_BY_VERB)[v]));
  const shell = createShellTools(gatedShellOptions(gate, workdir)).tools.filter((/** @type {{name: string}} */ t) => names.has(t.name));
  /** @type {any[]} */
  let ctxTools = [];
  if (ctx && [...CTX_TOOLS].some((t) => names.has(t))) {
    const lc = new LiteCtx({ root: workdir });
    await lc.index({ yield: true });
    ctxTools = createCtxTools(lc, workdir, () => {}).filter((/** @type {{name: string}} */ t) => names.has(t.name));
  }
  return { tools: [...shell, ...ctxTools], policy, onLlmResult, cleanup: async () => {} };
}

/** the default loop seam — one spelling of how this repo drives a model */
const defaultLoop = (/** @type {any} */ { system, policy, onLlmResult, provider, rates }) =>
  new Loop({ provider, system, policy, onLlmResult, ...(rates ? { rates } : {}) });

/**
 * Run the authoring scout.
 *
 * `createLoop` and `createSurveyor` are the two seams, both REAL by default. The
 * round bound, F59's reserved round, the blob cap, the scrub and the
 * classification all live HERE rather than behind a seam, because those are the
 * behaviours the finding is about.
 *
 * THE ATTEMPT LADDER (hamr, 2026-08-09) sits OUTSIDE all of that, and it fires
 * on the typed malformed class only — see `SCOUT_RETRY_CAUSES` for what is
 * deliberately excluded and why. Attempt 1 is the full survey; a re-ask is
 * TOOLLESS over the conversation the survey already produced, because the model
 * has already READ the repository and only its final emission was unreadable —
 * re-paying the exploration would buy the same facts twice. Every attempt is a
 * paid call, metered under its own label, and every attempt's raw text is
 * persisted so the malformation can be READ later rather than remembered.
 *
 * ONE FALLBACK, stated because the code has it: a retry with NO conversation to
 * re-ask over re-runs the FULL toolable survey instead. The toolless form rests
 * entirely on "the model already read the tree", and an empty transcript is that
 * premise gone — re-asking over nothing would be a bare "say it again" to a model
 * that was never shown the repository. Re-surveying costs the exploration twice;
 * the alternative buys a second sample of noise. It is not reachable through the
 * shipped Loop (whose `msgs` starts from the caller's own messages and is never
 * empty) and it is reachable through the `createLoop` seam, so it is a fail-safe
 * with a test rather than a promise with a comment.
 *
 * @param {{workdir: string, provider?: any,
 *   rounds?: number, minBytes?: number, blobMax?: number, maxTokens?: number, ctx?: boolean,
 *   attempts?: number, ceilingUsd?: number|null, callTimeoutMs?: number,
 *   onCall?: (call: {label: string, costUsd: number|null, unpricedRounds: number, thinkingStatus?: string, raw?: string}) => void,
 *   createLoop?: (o: {system: string, policy: any, onLlmResult: any, provider: any, rates?: {in: number, out: number}}) => any,
 *   rates?: {in: number, out: number}|null, callOptions?: Record<string, any>,
 *   createSurveyor?: (o: {workdir: string, granted: readonly string[], ctx: boolean}) => Promise<any>}} o
 * @returns {Promise<Survey & {raw: string, raws: ReturnType<typeof scrubRaw>[],
 *   calls: {label: string, costUsd: number|null, unpricedRounds: number}[],
 *   budgetStop: 'cap-halt'|'pricing-red'|null}>}
 */
export async function runAuthorScout({
  workdir, provider = null,
  rounds = AUTHOR_SCOUT_ROUNDS,
  minBytes = AUTHOR_SCOUT_MIN_BYTES,
  blobMax = AUTHOR_SCOUT_BLOB_MAX,
  maxTokens = AUTHOR_SCOUT_MAX_TOKENS,
  ctx = true,
  attempts = SCOUT_ATTEMPTS,
  ceilingUsd = null,
  // F152/PRD 30.4 — TIGHTEN-ONLY, the same clamp shape `attempts` carries just
  // below: an operator (a test included) may buy a SHORTER idle bound and never
  // a longer one. A garbage/absent value floors at the module ceiling
  // (`AUTHOR_CALL_TIMEOUT_MS`), never at "no bound at all".
  callTimeoutMs = AUTHOR_CALL_TIMEOUT_MS,
  onCall = () => {},
  createLoop = defaultLoop,
  rates = null,
  // the drafter's per-call model options (`thinkingCallOptions`, src/thinking.js; e.g. thinking off) — {} = nothing extra, byte-identical
  callOptions = {},
  createSurveyor = defaultSurveyor,
}) {
  const callTimeout = Number.isFinite(Number(callTimeoutMs)) && Number(callTimeoutMs) > 0
    ? Math.min(Math.trunc(Number(callTimeoutMs)), AUTHOR_CALL_TIMEOUT_MS)
    : AUTHOR_CALL_TIMEOUT_MS;
  const granted = AUTHOR_SCOUT_VERBS;
  const system = SCOUT_SYSTEM + strategyFor([...granted]);
  const surveyor = await createSurveyor({ workdir, granted, ctx });
  // the customer's own price for this provider's key row (USD per 1K, `ratesFor`); absent = the built-in guess
  const priced = rates ? { rates } : {};
  /** @type {{label: string, costUsd: number|null, unpricedRounds: number}[]} */
  const calls = [];
  /** @type {ReturnType<typeof scrubRaw>[]} */
  const raws = [];
  /**
   * ONE recorder for a model call: the cost entry and the persisted raw are
   * written together, so a call can never be metered without leaving its output
   * on the trail (or leave output nobody paid for). The pairing is the audit's
   * own invariant, and the suite pins it.
   * Returns the raw's INDEX, so the caller can attach the verdict to the
   * emission it actually describes — see `verdictAt` below.
   * @param {string} label @param {number} attempt @param {any} r @returns {number}
   */
  const record = (label, attempt, r) => {
    const call = { label, ...priceOf(r) };
    calls.push(call);
    // …and the SHELL is told, at the same instant and off the same entry. A run
    // killed from outside used to lose 100% of its spend record (F6/F12: a
    // halted attempt's spend was invisible by 300×) — the totals only ever
    // existed in this array, which dies with the process. Fired from inside the
    // one recorder rather than at the call sites, so a paid call cannot be
    // metered without the report going out: exactly the pairing invariant the
    // raw already rides. It REPORTS and decides nothing; the ceiling still binds
    // through `capStop` between calls, untouched.
    // bare-agent's per-run `thinkingStatus` rides the reporting seam only, never the stored entry (see makeCostBook.add)
    // R9 (Part B 4): the scrubbed answer rides the same report, so the session's drafting log keeps what an unusable scout answer said (an empty one adds nothing)
    const kept = scrubRaw({ label, attempt, text: r?.text });
    onCall({ ...call, ...(kept.text === '' ? {} : { raw: kept.text }), ...(r?.thinkingStatus === undefined ? {} : { thinkingStatus: r.thinkingStatus }) });
    return raws.push(kept) - 1;
  };
  // TIGHTEN-ONLY: an operator may lower the ceiling, never raise it. A garbage
  // value floors at one attempt rather than at zero — a scout that never ran is
  // an ABSENT nobody can act on.
  const allowed = Math.max(1, Math.min(Math.trunc(Number(attempts)) || 1, SCOUT_ATTEMPTS));

  /**
   * F152/PRD 30.4 — ONE call seam for every `loop.run()` below, so a REJECTED
   * call (a `TimeoutError` off `AUTHOR_CALL_TIMEOUT_MS` included — bare-agent
   * 0.42 rejects every known transport/idle-timeout casualty, F141) lands in the
   * SAME place a call that merely RESOLVED with an error already did: as an
   * `{error}` shape, read by `record()` (cost null, same as a `provider-red`
   * locate call — a rejected call has no knowable cost) and by `classifySurvey`
   * under the EXISTING `call-failed` cause. Without this seam a rejection would
   * escape uncaught to `run-author.mjs`'s top-level crash handler instead of the
   * honest, already-typed terminal this module was built to report through.
   *
   * The admitted-casualty test is `callCasualty` (`src/text.js`, beside
   * `priceOf`) — the SAME predicate `askStructured` (`src/authorflow.js`, F179)
   * uses for its own generate seam, widened past the idle-timeout class this
   * comment originally named to also admit a malformed tool-call-arguments
   * SyntaxError (F179's class): both are "a call that produced nothing", the
   * definition `call-failed` already carries. Swallowing every throw would
   * launder a budget HaltError, a programming bug, or any other named terminal
   * into "the survey call failed" — the exact class of dishonesty this repo
   * refuses (an unknown reported as a known) — so anything `callCasualty` does
   * not admit still re-raises and is relayed after cleanup, as it was before
   * this seam existed.
   * @param {Promise<any>} p @returns {Promise<any>}
   */
  const settled = async (p) => {
    try { return await p; } catch (e) {
      const reason = callCasualty(e);
      if (reason === null) throw e;
      return { error: reason };
    }
  };

  try {
    /** @type {Survey|null} */
    let survey = null;
    let blob = '';
    /** the conversation the last call left behind — what a re-ask re-asks OVER */
    /** @type {any[]|null} */
    let lastMsgs = null;
    let attempt = 0;
    /** which persisted raw the current verdict actually describes. NOT simply
     * "the last one": a recovery round that came back SMALLER is DISCARDED, and
     * the blob being classified is then the first call's — stamping the verdict
     * on the recovery's raw would attribute a failure to an emission nobody
     * judged. An instrument that misaddresses its own reading is the blind
     * -instrument class, one field wide. */
    let verdictAt = -1;
    /** the operator's money ceiling, when it is what ended the ladder. `null` on
     * every other path INCLUDING the unbounded one, so a reader never has to
     * infer a governance stop from an absence.
     * @type {'cap-halt'|'pricing-red'|null} */
    let budgetStop = null;

    while (attempt < allowed) {
      // THE CEILING, between attempts. The attempt cap bounds how many times the
      // survey may ask; it says nothing about what those asks cost, and this is
      // the pipeline's FIRST paid stage — a ladder that spends the whole wallet
      // before the declaration is ever authored is the failure this closes.
      // Checked before the counter moves, so `attempt` stays the number of
      // attempts that actually happened.
      const halt = capStop({ ceilingUsd, ...tallyCalls(calls) });
      if (halt) { budgetStop = halt; break; }
      attempt += 1;
      const label = attempt === 1 ? 'author-scout' : `author-scout#${attempt}`;

      if (attempt === 1 || !lastMsgs?.length) {
        // The round bound is the plan scout's own mechanism: `loop.stop()` read
        // at the round boundary. It cannot cut an in-flight call (F61) — it
        // bounds the NEXT round, which is exactly why F59's reserved round
        // exists at all.
        let seen = 0;
        let bounded = false;
        /** @type {any} */
        let loop = null;
        const metered = async (/** @type {any} */ arg) => {
          if ((arg?.kind ?? 'turn') === 'turn') {
            seen += 1;
            if (seen >= rounds) { bounded = true; loop.stop(); }
          }
          return surveyor.onLlmResult ? surveyor.onLlmResult(arg) : undefined;
        };
        loop = createLoop({ system, policy: surveyor.policy, onLlmResult: metered, provider, ...priced });

        const r = await settled(loop.run([{ role: 'user', content: scoutPrompt(workdir) }], surveyor.tools,
          { cacheMessages: true, maxTokens, timeoutMs: callTimeout, ...callOptions }));
        verdictAt = record(label, attempt, r);
        blob = redactSecrets(String(r?.text ?? '')).slice(0, blobMax);
        lastMsgs = Array.isArray(r?.msgs) && r.msgs.length ? r.msgs : null;
        let recovered = false;
        /** the recovery call's own result, held in scope so its FAILURE is visible
         * to the classifier — `null` whenever the recovery never fired */
        /** @type {any} */
        let s2 = null;

        // F59's reserved TOOLLESS final round. It fires on the ONE population it
        // was sized for — a survey that was CUT OFF and came back short — never
        // on a survey that simply finished with little to say.
        // …and the reserved round is a PAID CALL like any other, so it sits behind
        // the same ceiling. Left outside it, the one call the cap most needs to
        // stop is the one that escapes: the recovery fires exactly when the first
        // call was cut off, which is exactly when the wallet is thinnest.
        //
        // THE CEILING IS ASKED ABOUT A CALL THAT WOULD ACTUALLY BE MADE, and the
        // ORDER is what makes that true: the recovery predicate is settled FIRST,
        // and `capStop` is consulted only when a recovery was genuinely pending.
        // Asked unconditionally it answers a question nobody put — the wallet is
        // over, but nothing was refused — and `budgetStop` means the ceiling is
        // WHAT ENDED THE LADDER, which is then a lie on every other attempt-1
        // ending: a dead socket on an unbounded first call, or a survey that came
        // back PRESENT and needed no second call at all. Both then render as
        // `cap-halt` at `path: budgetUsd`, steering the operator to raise a number
        // that cannot move the outcome. Nothing about the REFUSAL moves here — the
        // same predicate, the same tally, the same call not made (the top-of-loop
        // latch still names the ceiling whenever a retry was due). This is which
        // ending gets the label, and nothing else.
        const recoveryWanted = bounded && Buffer.byteLength(blob) < minBytes
          && Array.isArray(r?.msgs) && r.msgs.length > 0;
        const recoveryHalt = recoveryWanted ? capStop({ ceilingUsd, ...tallyCalls(calls) }) : null;
        if (recoveryHalt) budgetStop = recoveryHalt;
        if (recoveryWanted && !recoveryHalt) {
          const recovery = createLoop({ system, policy: surveyor.policy, onLlmResult: surveyor.onLlmResult, provider, ...priced });
          // F147 (second instance; sibling fix: src/planrun.js `askFrom`, commit
          // 031ffe1): `r.msgs` is a prior `loop.run()`'s returned transcript,
          // which bare-agent already prepended `system` to (Loop.run, loop.js
          // ~482-486). `recovery` below is built with the same `system` and
          // would prepend it again, leaving two identical system messages at
          // index 0/1 — real OpenAI tolerates it, vLLM-class OpenAI-compatible
          // backends 400 on it. Strip the leading one before re-running.
          const rMsgs = r.msgs[0]?.role === 'system' ? r.msgs.slice(1) : r.msgs;
          s2 = await settled(recovery.run([...rMsgs, { role: 'user', content: SCOUT_RECOVERY_PROMPT }], [],
            { cacheMessages: true, maxTokens, timeoutMs: callTimeout, ...callOptions }));
          const recoveryAt = record('author-scout-recovery', attempt, s2);
          const t = redactSecrets(String(s2?.text ?? '')).slice(0, blobMax);
          // the verdict follows the blob that WON, never the call that came last
          if (Buffer.byteLength(t) > Buffer.byteLength(blob)) { blob = t; recovered = true; verdictAt = recoveryAt; }
          if (Array.isArray(s2?.msgs) && s2.msgs.length) lastMsgs = s2.msgs;
        }

        // The RECOVERY's error first, when it fired. It is the call that produced
        // (or failed to produce) the blob being classified, so its death is what
        // describes the survey; the first call's error belongs to the very call
        // the recovery exists to replace, and a recovery dying of
        // `truncated:max_tokens` after a clean-but-bounded first round reported
        // no error at all. Falling back to `r.error` keeps every other
        // classification unchanged.
        survey = classifySurvey(blob, {
          bytes: Buffer.byteLength(blob), rounds: seen, bounded, recovered,
          error: s2?.error ?? r?.error ?? null,
          attempts: attempt, attemptsAllowed: allowed,
        });
      } else {
        // THE RE-ASK. Toolless by construction, over the survey's own
        // conversation, naming only what failed mechanically.
        const reask = createLoop({ system, policy: surveyor.policy, onLlmResult: surveyor.onLlmResult, provider, ...priced });
        // F147 (second instance; sibling fix: src/planrun.js `askFrom`, commit
        // 031ffe1): `lastMsgs` is a prior `loop.run()`'s returned transcript
        // (system already prepended by bare-agent); `reask` is built with the
        // same `system` and would prepend it again. Strip the leading one.
        const askMsgs = lastMsgs[0]?.role === 'system' ? lastMsgs.slice(1) : lastMsgs;
        const rr = await settled(reask.run(
          [...askMsgs, { role: 'user', content: scoutReaskTurn(/** @type {Survey} */ (survey).reason ?? '') }], [],
          { cacheMessages: true, maxTokens, timeoutMs: callTimeout, ...callOptions },
        ));
        verdictAt = record(label, attempt, rr);
        blob = redactSecrets(String(rr?.text ?? '')).slice(0, blobMax);
        if (Array.isArray(rr?.msgs) && rr.msgs.length) lastMsgs = rr.msgs;
        survey = classifySurvey(blob, {
          bytes: Buffer.byteLength(blob), rounds: 1, bounded: false, recovered: false,
          error: rr?.error ?? null, attempts: attempt, attemptsAllowed: allowed,
        });
      }

      // the raw that describes THIS attempt carries the attempt's own verdict —
      // the raw is the autopsy artifact, and an autopsy without a cause of death
      // is a body. STAMPED rather than assigned: `reason` quotes the transport's
      // own error prose (`classifySurvey`'s CALL_FAILED route) and this record is
      // persisted, so it rides the same one boundary the raw's text already did.
      const mine = raws[verdictAt];
      if (mine) stampRaw(mine, { cause: survey.cause, reason: survey.reason });

      if (survey.state === 'PRESENT') break;
      if (!SCOUT_RETRY_CAUSES.includes(/** @type {string} */ (survey.cause))) break;
    }

    // THE SURVEY THAT WAS NEVER ASKED FOR. The ceiling was already spent when the
    // first attempt came due, so no call was made and there is no reply to
    // classify. It is spelled out rather than run through `classifySurvey`, which
    // would read the empty blob and report that the model came back EMPTY — a
    // model that never spoke cannot have said nothing, and blaming it would send
    // the operator to the scout when the fact is the wallet.
    const final = /** @type {Survey} */ (survey ?? {
      state: 'ABSENT',
      facts: null,
      cause: SURVEY_CAUSES.NOT_FUNDED,
      reason: budgetStop === 'pricing-red'
        ? 'the survey was never asked for: spend could not be priced, so the ceiling could not be enforced (F6)'
        : `the survey was never asked for: the $${ceilingUsd} ceiling was already spent`,
      meta: { bytes: 0, rounds: 0, bounded: false, recovered: false, error: null, attempts: 0, attemptsAllowed: allowed },
    });
    // Exhaustion is still the same honest ABSENT — it now says how many times we
    // paid to find out. One attempt says nothing about retries, because there
    // were none.
    const reason = final.reason !== null && attempt > 1 ? `${final.reason} — after ${attempt} attempts` : final.reason;
    return { ...final, reason, raw: blob, raws, calls, budgetStop };
  } finally {
    // a leaked surveyor leaks a gate handle and a litectx index — always, even
    // when the loop threw
    await surveyor.cleanup();
  }
}

// ── THE LOOK AT A RUBRIC JOB'S INPUTS (PART 1c, docs/product/ITEM33-BUILD.md "3. The look") ─────────────────────────────────────
//
// The same pattern as the repo survey above, aimed at the person's own input text instead of a repository: a FIXED read-only grant
// (search the input, read a slice around a hit - closures over in-memory text, so there is nothing to fence), a hard round bound, a
// reserved final round whose ONLY tool is the answer form (no more looking), the spend metered per call into the same `calls` the
// drafting book absorbs, and the answer through a strict tool call (never free prose with JSON inside). The result is shaped like a
// survey (`state`, `facts`, `calls`, `raws`, `budgetStop`) so the drafting pipeline absorbs it exactly as it absorbs the repo scout.

/** the look's hard round bound */
export const LOOK_ROUNDS = AUTHOR_SCOUT_ROUNDS;

export const LOOK_SYSTEM = 'You are a careful analyst setting up a checkable job. You are given the person\'s job and the text of their inputs. '
  + 'You can only search and read that text - you cannot write, run anything or change anything. You have a hard, small number of turns. '
  + 'Your single deliverable is a report of which facts the job asks for can be CHECKED in the input, with the label that sits right before each value (picked from the list you are shown), and what you could not find. '
  + 'You do not judge whether a result is good and you do not decide what is done with the job.';

export const LOOK_RECOVERY_PROMPT = 'You are out of looking turns. Report NOW, from what you have already read: call the report tool once with everything you can check and everything you could not find.';

/**
 * Run the look. `createLoop` is the same seam the repo scout has; nothing else here needs a live process.
 * @param {{texts: Record<string, string>, inputs: {n: number, label: string}[], jobLines: {n: number, text: string, rule?: string, rules?: string[]}[],
 *   provider?: any, rounds?: number, maxTokens?: number, ceilingUsd?: number|null, callTimeoutMs?: number,
 *   onCall?: (call: {label: string, costUsd: number|null, unpricedRounds: number, thinkingStatus?: string, raw?: string}) => void,
 *   createLoop?: (o: {system: string, policy: any, onLlmResult: any, provider: any, rates?: {in: number, out: number}}) => any,
 *   rates?: {in: number, out: number}|null, callOptions?: Record<string, any>,
 *   prove?: (source: string, phrase: string) => number}} o
 * @returns {Promise<{state: 'PRESENT'|'ABSENT', facts: any, reason: string|null, cause: string|null, meta: any, raw: string,
 *   raws: ReturnType<typeof scrubRaw>[], calls: {label: string, costUsd: number|null, unpricedRounds: number}[],
 *   budgetStop: 'cap-halt'|'pricing-red'|null}>}
 */
export async function runInputLook({
  texts, inputs, jobLines, provider = null, rounds = LOOK_ROUNDS, maxTokens = AUTHOR_SCOUT_MAX_TOKENS, ceilingUsd = null,
  callTimeoutMs = AUTHOR_CALL_TIMEOUT_MS, onCall = () => {}, createLoop = defaultLoop, rates = null, callOptions = {}, prove,
}) {
  const callTimeout = Number.isFinite(Number(callTimeoutMs)) && Number(callTimeoutMs) > 0
    ? Math.min(Math.trunc(Number(callTimeoutMs)), AUTHOR_CALL_TIMEOUT_MS) : AUTHOR_CALL_TIMEOUT_MS;
  const priced = rates ? { rates } : {};
  /** @type {{label: string, costUsd: number|null, unpricedRounds: number}[]} */
  const calls = [];
  /** @type {ReturnType<typeof scrubRaw>[]} */
  const raws = [];
  const record = (/** @type {string} */ label, /** @type {any} */ r) => {
    const call = { label, ...priceOf(r) };
    calls.push(call);
    const kept = scrubRaw({ label, attempt: 1, text: r?.text });
    onCall({ ...call, ...(kept.text === '' ? {} : { raw: kept.text }), ...(r?.thinkingStatus === undefined ? {} : { thinkingStatus: r.thinkingStatus }) });
    raws.push(kept);
  };
  const settled = async (/** @type {Promise<any>} */ p) => {
    try { return await p; } catch (e) {
      const reason = callCasualty(e);
      if (reason === null) throw e;
      return { error: reason };
    }
  };
  const { scans, lists } = labelListsOf(texts);
  /** @type {{calls: any[]}} */
  const box = { calls: [] };
  /** @type {any} */
  let loop = null;
  const reportTool = {
    name: LOOK_REPORT_TOOL,
    description: 'Deliver the report. Call this exactly once, with the whole report as its arguments.',
    parameters: lookReportSchema(),
    execute: async (/** @type {any} */ args) => { box.calls.push(args); if (loop) loop.stop(); return 'received'; },
  };
  const tools = [...lookReadTools(texts), reportTool];
  const absent = (/** @type {string} */ reason, /** @type {string} */ cause, /** @type {'cap-halt'|'pricing-red'|null} */ budgetStop = null) => ({
    state: /** @type {'ABSENT'} */ ('ABSENT'), facts: null, reason, cause, meta: { rounds: seen, bounded }, raw: '', raws, calls, budgetStop,
  });
  let seen = 0;
  let bounded = false;
  const halt0 = capStop({ ceilingUsd, ...tallyCalls(calls) });
  if (halt0) return absent(`the look was never asked for: the $${ceilingUsd} ceiling was already spent`, SURVEY_CAUSES.NOT_FUNDED, halt0);

  const metered = async (/** @type {any} */ arg) => {
    if ((arg?.kind ?? 'turn') === 'turn') {
      seen += 1;
      if (seen >= rounds) { bounded = true; loop.stop(); }
    }
  };
  loop = createLoop({ system: LOOK_SYSTEM, policy: undefined, onLlmResult: metered, provider, ...priced });
  const r = await settled(loop.run([{ role: 'user', content: lookPrompt({ jobLines, labels: Object.keys(texts), lists }) }], tools,
    { cacheMessages: true, maxTokens, timeoutMs: callTimeout, ...callOptions }));
  record('input-look', r);
  /** @type {any} */
  let last = r;
  if (box.calls.length === 0 && !r?.error) {
    // THE RESERVED FINAL ROUND: no more looking - the only tool is the answer form
    const halt = capStop({ ceilingUsd, ...tallyCalls(calls) });
    if (halt) return absent(`the look stopped on the cost ceiling before it reported: ${halt}`, SURVEY_CAUSES.NOT_FUNDED, halt);
    const recovery = createLoop({ system: LOOK_SYSTEM, policy: undefined, onLlmResult: undefined, provider, ...priced });
    const rMsgs = Array.isArray(r?.msgs) && r.msgs.length ? (r.msgs[0]?.role === 'system' ? r.msgs.slice(1) : r.msgs) : [];
    const only = { ...reportTool, execute: async (/** @type {any} */ args) => { box.calls.push(args); recovery.stop(); return 'received'; } };
    last = await settled(recovery.run([...rMsgs, { role: 'user', content: LOOK_RECOVERY_PROMPT }], [only],
      { cacheMessages: true, maxTokens, timeoutMs: callTimeout, ...callOptions }));
    record('input-look-recovery', last);
  }
  if (box.calls.length === 0) {
    return absent(last?.error ? `the look call failed: ${redactSecrets(String(last.error))}` : 'the look ended without a report', last?.error ? SURVEY_CAUSES.CALL_FAILED : SURVEY_CAUSES.EMPTY);
  }
  const report = verifyLookReport(box.calls[0], { scans, jobLines, ...(prove ? { prove } : {}) });
  return {
    state: 'PRESENT', reason: null, cause: null, meta: { rounds: seen, bounded }, raw: '', raws, calls, budgetStop: null,
    facts: { rubricFiles: true, inputs: inputs.map((i) => ({ n: i.n, label: i.label })), look: report },
  };
}

// ── L1: THE MECHANICAL SEED LISTING ──────────────────────────────────────────

/** per-path full-listing cap; over it, names give way to counted directories */
export const LIST_CAP = 40;
/** whole-block ceiling — the block is a prompt ingredient, like the survey */
export const LISTING_BYTE_CAP = 12000;
/** how many bare file NAMES survive the deepest tier of a flat directory */
export const COUNTS_ONLY_NAMES = 12;

/**
 * A surveyor writes prose into path entries (`"src/aurora_cli (symlink)"`,
 * `"src (also …)"`). Strip the annotation, keep the path.
 * @param {any} e
 */
export const cleanEntry = (e) => String(e ?? '').split(' (')[0].trim().replace(/(?<!\/)\/+$/, '');

/**
 * `git ls-tree -r --name-only <seed>` — the files as of the SEED COMMIT.
 * Deliberately NOT `ls-files`, which reads the index and the working tree: this
 * listing is what a path is judged against, and it must describe the tree the
 * close will be measured from, not whatever is lying around today.
 *
 * A fault comes back as a named `stop`, never as an empty list — an unreadable
 * listing that rendered as "no files" would fail every path in the declaration
 * for the wrong reason.
 * `files` is spelled `null` on the stop branch rather than left off: a caller
 * that destructures the failure and finds `undefined` reads it as falsy, which
 * is the "absent renders as empty" shape this whole module exists to refuse.
 *
 * The command itself lives in `src/kinds.js` beside the executor's other git
 * reads (`seedListing`) — the declared close's runtime gate judges paths against
 * the SAME listing this scout hands the author, and two spellings of "what
 * exists at the seed" would be two instruments.
 * @param {string} workdir @param {string} seedRef
 * @returns {Promise<{stop: string, files: null}|{stop: null, files: string[]}>}
 */
export async function seedFileList(workdir, seedRef) {
  return seedListing(workdir, seedRef);
}

/** `src/*` style entries match by segment; everything else is a path prefix.
 * @param {string} entry @returns {(f: string) => boolean} */
function matcherFor(entry) {
  if (entry.includes('*')) {
    const rx = new RegExp(`^${entry.split('*').map((seg) => seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')}(/|$)`);
    return (f) => rx.test(f);
  }
  return (f) => f === entry || f.startsWith(`${entry}/`);
}

/**
 * Render ONE scoped entry. Three outcomes, and each one is stated in full:
 * nothing matched (say so — an invented source path is the failure this block
 * exists to prevent), under the cap (every name), or over it (direct children in
 * full, deeper files as COUNTED directories, with the trim announced). No file is
 * ever silently dropped: F28's rule is that a bound eats detail, never evidence.
 * @param {string} entry @param {string[]} all @param {number} cap @param {boolean} countsOnly
 */
function renderEntry(entry, all, cap, countsOnly) {
  const files = all.filter(matcherFor(entry));
  if (files.length === 0) return { lines: [`under ${entry} — NO FILES EXIST at the seed (this path matches nothing)`], count: 0 };
  const depth = entry.split('/').length;
  /** @type {(f: string) => string} */
  const groupKey = (f) => {
    const segs = f.split('/');
    return segs.length > depth + 1 ? `${segs.slice(0, depth + 1).join('/')}/` : f;
  };
  if (countsOnly) {
    /** @type {Map<string, number>} */
    const groups = new Map();
    for (const f of files) groups.set(groupKey(f), (groups.get(groupKey(f)) ?? 0) + 1);
    // A FLAT directory has no subdirectories to collapse into, so grouping alone
    // shrinks nothing — 800 files under `src/` render as 800 names at every tier,
    // and the "deepest tier" would be no smaller than the first. The names are
    // what gets capped here; the TOTAL on the first line is complete either way.
    const dirs = [...groups].filter(([k]) => k.endsWith('/'));
    const named = [...groups].filter(([k]) => !k.endsWith('/')).map(([k]) => k);
    const shown = named.slice(0, COUNTS_ONLY_NAMES);
    return {
      lines: [
        `under ${entry} — ${files.length} files:`,
        ...dirs.map(([k, n]) => `  ${k} — ${n} files`),
        ...shown.map((k) => `  ${k}`),
        ...(named.length > shown.length
          ? [`  [${named.length - shown.length} of ${named.length} file names not printed — the counts above are complete]`]
          : []),
      ],
      count: files.length,
    };
  }
  if (files.length <= cap) {
    return { lines: [`under ${entry} — ${files.length} files:`, ...files.map((f) => `  ${f}`)], count: files.length };
  }
  /** @type {string[]} */ const direct = [];
  /** @type {Map<string, number>} */ const subdirs = new Map();
  for (const f of files) {
    if (f.split('/').length === depth + 1) direct.push(f);
    else subdirs.set(groupKey(f), (subdirs.get(groupKey(f)) ?? 0) + 1);
  }
  const withheld = files.length - direct.length;
  return {
    lines: [
      `under ${entry} — ${files.length} files; direct children listed in full, deeper files counted per directory:`,
      ...direct.map((f) => `  ${f}`),
      ...[...subdirs].map(([k, n]) => `  ${k} — ${n} files`),
      `  [listing trimmed: ${withheld} of ${files.length} files are behind the directory counts above — the full-list `
      + `cap is ${cap} per path; every file is counted, none is hidden]`,
    ],
    count: files.length,
  };
}

/**
 * THE SEED LISTING, both halves.
 *
 * `files` is the WHOLE tree and is what the validator judges paths against.
 * `block` is SCOPED to the survey's own sourcePaths/testPaths and is what the
 * prompt carries. Giving the validator the scoped half instead would make a job
 * scoped to `src/` read as whole-tree, and M2's one-population law — which fires
 * only on a SCOPED job — would silently stop firing.
 *
 * @param {{workdir: string, seedRef: string, sourcePaths?: any, testPaths?: any,
 *   listCap?: number, byteCap?: number}} o
 * @returns {Promise<{stop: string, files: null, block: null, meta: null}
 *   |{stop: null, files: string[], block: string, meta: {seedRef: string, totalSeedFiles: number,
 *     entries: {entry: string, raw: string, section: string, matched: number}[], tier: string}}>}
 */
export async function buildSeedListing({ workdir, seedRef, sourcePaths, testPaths, listCap = LIST_CAP, byteCap = LISTING_BYTE_CAP }) {
  const listed = await seedFileList(workdir, seedRef);
  if (listed.stop !== null) return { stop: listed.stop, files: null, block: null, meta: null };
  const all = listed.files;

  /** @type {{raw: string, entry: string, section: string}[]} */
  const entries = [];
  const seen = new Set();
  for (const [section, list] of /** @type {[string, any][]} */ ([['sourcePaths', sourcePaths], ['testPaths', testPaths]])) {
    for (const raw of Array.isArray(list) ? list : []) {
      const entry = cleanEntry(raw);
      if (!entry || seen.has(entry)) continue;
      seen.add(entry);
      entries.push({ raw: String(raw), entry, section });
    }
  }

  const render = (/** @type {number} */ cap, /** @type {boolean} */ countsOnly) => {
    const lines = [
      'FILES THAT ACTUALLY EXIST AT THE SEED — listed mechanically from the repository tree',
      'itself (git ls-tree at the seed commit), not by the surveyor. A source or test path not',
      'in this list DOES NOT EXIST, whatever it sounds like it should be called.',
      '',
    ];
    /** @type {{entry: string, raw: string, section: string, matched: number}[]} */
    const meta = [];
    for (const e of entries) {
      const r = renderEntry(e.entry, all, cap, countsOnly);
      meta.push({ entry: e.entry, raw: e.raw, section: e.section, matched: r.count });
      lines.push(`[${e.section}] ${r.lines[0]}`, ...r.lines.slice(1), '');
    }
    return { text: lines.join('\n').trimEnd(), meta };
  };

  // Deterministic degradation, each tier ANNOUNCED: full → tight → counts-only.
  // Counts stay complete at every tier; only names give way.
  //
  // "full" is rendered ONCE, here, and TIERS holds only the degradations — the
  // loop's job is to fall back, never to re-render the tier it was handed.
  // (`render` walks the whole seed listing per scoped entry, so rendering full
  // twice was the listing's own cost paid twice on every run that never needed
  // to degrade at all — which is every ordinary run.)
  /** @type {[string, number, boolean][]} */
  const TIERS = [['tight', 12, false], ['counts-only', 0, true]];
  let tier = 'full';
  let out = render(listCap, false);
  for (const [name, cap, countsOnly] of TIERS) {
    if (Buffer.byteLength(out.text) <= byteCap) break;
    tier = name;
    out = render(cap, countsOnly);
  }
  let block = out.text;
  let note = tier === 'full' ? ''
    : `[whole-listing cap: a full listing exceeds ${byteCap} bytes, so this block was reduced to tier "${tier}" — `
      + 'counts are complete even where names are not]';

  // THE BACKSTOP. Enough scoped paths, each with enough subdirectories, can beat
  // every tier — and this block is a PROMPT INGREDIENT, so "usually small" is not
  // a bound. Truncation is line-wise (a byte cut would split a multi-byte
  // character) and is ANNOUNCED with its count; the totals it printed above the
  // cut stay true.
  if (Buffer.byteLength(block) > byteCap) {
    /** @type {string[]} */
    const kept = [];
    let bytes = 0;
    let cut = 0;
    for (const line of block.split('\n')) {
      const b = Buffer.byteLength(line) + 1;
      if (bytes + b > byteCap) { cut += 1; continue; }
      bytes += b;
      kept.push(line);
    }
    block = kept.join('\n');
    note = `[whole-listing cap: even at tier "${tier}" this block exceeds ${byteCap} bytes, so ${cut} line(s) were cut. `
      + 'Every count printed above is complete — but a path you cannot see here is a path you must not assume exists.]';
  }
  if (note) block = `${block}\n\n${note}`;

  return { stop: null, files: all, block, meta: { seedRef, totalSeedFiles: all.length, entries: out.meta, tier } };
}
