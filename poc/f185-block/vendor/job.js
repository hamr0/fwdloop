// borrowed-from: bareloop src/job.js@v0.56.0 (3383cce)
// Job-spec validator — the OPERATOR-owned half of the config story (N1,
// design record: docs/logs/2026-07-12-n1-job-close-schema-design.md).
// A job spec is the arbiter's rulebook: the close chain, the budget, the
// outer write fence, the escalation route. It is pure declarative data —
// no freeform code is expressible anywhere in it — and it validates
// reds-before-tokens like its sibling validate.js (workflow, agent-authored).
// The arbiter split is guarded from both sides by INEXPRESSIBILITY: the
// workflow config cannot say close/provider (validate.js, shipped at N0);
// the job spec cannot say hooks/loop/memory, any minting claim, or the
// shell-owned retry cap — all unknown-field reds here.
//
// Close-authoring hierarchy (PRD §7) as a class menu keyed by close type:
// verdict-class laundering (a rubric claiming hard) is a named red, never a
// judgment call. Minting policy is product doctrine, not job-authorable.

import { createHash } from 'node:crypto';
import { globToPrefix, scopeContained, isObj, isNonEmptyString, sweepSecretLiterals, hasNestedQuantifier, closeScriptCandidateToken } from './validate.js';
import { validateCloseDecl, DECLARED_CLOSE_CLASSES } from './declaredclose.js';
import { inputLabelsOf } from './rubricstep.js';
import { CLOSE_TIMEOUT_FLOOR_MS } from './closetimeout.js';
import { validateTrigger } from './trigger.js';
import { WATCHABLE } from './ticketshape.js';
import { resolveJobJudge } from './judged.js';
import { ticketFilterReds } from './ticketfilter.js';

// The menus below ARE the close-authoring hierarchy (PRD §7) and ship frozen:
// they are read at call time, so a mutable export would let adopter code
// enable verdict-class laundering process-wide with one push().
export const CLOSE_TYPES = Object.freeze(['predicate', 'gold', 'rubric', 'hitl']);
/** the hierarchy: which verdict classes a close type may claim (PRD §7). Read by
 * the verdictType check — a declared verdict may not demand a class its close
 * type cannot legally claim (green-on-rubric is laundering). The `CLASSES`
 * vocabulary export went with steps[] (PRD v1.32): a class was a STEP field, and
 * nothing declares one now. */
export const CLASS_BY_CLOSE = Object.freeze({
  predicate: Object.freeze(['hard']),
  gold: Object.freeze(['hard']),
  rubric: Object.freeze(['soft']),
  hitl: Object.freeze(['hitl']),
  // The AUTHORED close (M4, `closeDecl`) is not a `close.type` — it is the other
  // field a plan-shape spec may carry — but it claims a verdict class exactly
  // like one, so it belongs in the SAME table rather than in a second constant
  // beside it. Hard by construction: every live kind is a mechanical command
  // whose measurement is the truth, and the two judgment kinds are locked out at
  // the catalogue and absent from the executor. The suite pins the key set
  // against CLOSE_TYPES so the two can never drift apart silently.
  declared: DECLARED_CLOSE_CLASSES,
});
export const GOLD_COMPARE = Object.freeze(['exact', 'json-equal']);
/** the tool grant menu (2b interview #1): read/grep/write, plus the two litectx
 * RETRIEVAL verbs (F19) — `run` stays locked-but-listed; a spec requesting it
 * reds, and that red IS the request-red evidence admission waits on (curation
 * doctrine, PRD F2).
 *
 * `recall`/`get` are READ-ONLY BY CONSTRUCTION, not by promise: `recall` returns
 * pointers (path/symbol/line-range, no bodies) and `get` trades ONE pointer for
 * ONE chunk — it refuses any range that is not a chunk boundary, so it cannot be
 * widened into a whole-file read, and it is content-hash gated (a drifted file
 * throws rather than serving a stale body). Admitting them does NOT weaken the
 * `run` lock: the worker still cannot execute anything, so it still cannot run
 * its own close (the arbiter). F19: `shell_read` starts at byte ZERO and cannot
 * seek, so a pointer was INERT — the worker paged 1.37 MB of source through
 * context to reach 8 lines. The ranged read is the pager.
 *
 * `edit` (BA-13, bare-agent 0.29.0) is the anchored exact-once replace — a
 * WRITE-class verb judged by the SAME writeScope fence as `write` (bareguard
 * action type 'edit'). Admitted because whole-file rewrite is measurably
 * unreliable at size (F31: 4 of 5 big-file whole-writes broke the tree) and
 * taxes output tokens ∝ file size. It admits no execution either.
 *
 * P (design record 2026-07-28, hamr: full catalog) widened the menu to the four
 * components — write · select · compress · isolate — every verb an EXISTING
 * litectx implementation (menu-is-inventory). impact/related/recent/compress/
 * peek are read-only like the retrieval pair; stash/remember/forget are
 * STORE-writes (`.litectx`, never the tree — own gate action types, and the U
 * runner deletes the store at reset so cold stays cold). None admits execution:
 * the `run` lock is untouched. */
export const TOOL_MENU = Object.freeze(['read', 'grep', 'write', 'edit', 'recall', 'get', 'impact', 'related', 'recent', 'compress', 'peek', 'stash', 'remember', 'forget']);
/** the write-class split the validator and the scout filter read: tree writes
 * (writeScope fence) vs store writes (isolate) — NEITHER is read-capable. */
export const WRITE_VERBS = Object.freeze(['write', 'edit']);
export const STORE_VERBS = Object.freeze(['stash', 'remember', 'forget']);
/**
 * The floor for `maxWallMs`: one default close timeout (`runClose`'s 120_000).
 * Addendum 1 MEASURED that a wall deadline can only be read BETWEEN rounds —
 * `loop.stop()` does not cut an in-flight call (fired at 500ms, returned at
 * 4,018ms) — so enforcement is `maxWallMs + closeStages × closeTimeoutMs` (W5: a
 * staged close runs every stage under the FULL timeout, ralph.js `runStages`).
 * Under this floor the overshoot exceeds the budget itself and the advertised
 * number would be more wrong than right, which is the advertised-must-equal-
 * enforced line.
 *
 * The VALUE is a one-stage, default-timeout floor and is deliberately left alone —
 * a threshold is operator territory, not something this module re-derives from a
 * spec's own stage count. It therefore bounds only the degenerate case; a job with
 * many stages or a raised `closeTimeoutMs` can still sit far above it while its
 * overshoot dwarfs its cap. The clock reports that honestly (`closeStages` and
 * `enforcedMs` are both on the `wall-clock` record) rather than the floor pretending
 * to prevent it.
 */
export const MIN_WALL_MS = 120_000;
/** locked-but-listed tools: real capabilities deliberately outside the grant
 * menu. Requesting one is a DISTINCT `request-red` (module 4) — the ledger
 * counts admission demand, and a generic invalid-value would bury it as a typo. */
export const LOCKED_TOOLS = Object.freeze(['run']);
/** Layer 2 (design record 2026-07-21, decision 5): the verdict-type radio of
 * the four-field plan shape. All three are ADMITTED as of softgreen module 3;
 * the declared-but-locked mechanism below (`LOCKED_VERDICTS`) is what carried
 * them here one rung at a time — declaring a locked one is a `request-red` (the
 * tool-menu pattern: disclosure ≠ admission), so the ledger counted the demand
 * instead of the schema being reshaped when the rung finally landed. */
export const VERDICT_TYPES = Object.freeze(['green', 'soft-green', 'hitl']);
/** N4 slice 1 admitted `hitl`; softgreen module 3 admits `soft-green`, and the
 * menu is now EMPTY — every class the radio names is built.
 *
 * `soft-green`'s lock was never a policy, it was a missing floor: a judged
 * verdict with no ruler mints nothing honestly. Modules 1 and 2 built the ruler
 * (a pinned judge that only LOCATES, an arbiter-owned `decide()`, a calibration
 * gate) and wired it as the `judged-floor` kind, so the lock has nothing left to
 * protect (design record 2026-08-17 §4, and the 2026-08-18 thresholds addendum).
 *
 * EMPTY here means "nothing is locked", which is a TRUE statement about a closed
 * menu — not F59's absent-read-as-empty, where a `{}` stood in for a fact nobody
 * gathered. The mechanism below stays exactly as it is: it is read at call time
 * from this constant, so re-locking a class (or admitting a fourth) is one edit
 * and the counted `request-red` path comes back with it. `LOCKED_CLASSES` in
 * src/authoring.js is the twin and moved in the same commit; the suite pins the
 * two identical. */
/** @type {readonly string[]} */
export const LOCKED_VERDICTS = Object.freeze([]);
/** which close CLASS a declared verdictType demands — the close hierarchy one
 * level up: the same laundering guard as CLASS_BY_CLOSE, applied to the plan
 * shape's single close (green on a rubric would be a fake-hard verdict). */
const CLASS_BY_VERDICT = Object.freeze({ green: 'hard', 'soft-green': 'soft', hitl: 'hitl' });
export const CADENCE_UNITS = Object.freeze(['hour', 'day', 'week']);
/** SP-2: API-first; local deferred (PRD §5/§8). `clipipe-subscription` (F42,
 * bare-agent 0.32.0 tool mode): the CLI as a bare turn-provider on a Claude
 * subscription — its costUsd axis is NOTIONAL (API-equivalent value, not
 * billed), so it is a DISTINCT condition: rows never pool with anthropic-api
 * rows on the cost axis, and budgets sized for one do not transfer. */
/** PRD item 28 (2026-09-06/09-09): `openai-api` — an OpenAI-shaped provider,
 * constructed via `src/providers.js`'s factory. hamr's ruling (PRD 30.7):
 * `deepseek-flash` is THE secondary provider (one, not a menu of half-tested
 * models; F171, item 34 L16: swapped from the retired `deepseek-chat`); the
 * factory's tier table is where that lives, not this menu.
 *
 * PRD item 31.3 (hamr, 2026-09-09: *"anthropic, openai, gemini drop ollama for
 * now"*): `gemini-api` joins. That is bareloop matching bare-agent's own
 * adapter surface rather than curating a shorter list — bare-agent exports four
 * real HTTP backends (Anthropic, OpenAI, Gemini, Ollama) plus CLIPipe and the
 * FallbackProvider composite; `provider-http.js`, `provider-stop-reason.js`,
 * `provider-temperature.js` and `provider-usage.js` are shared HELPERS, not
 * backends, and were miscounted as providers once — the export list, never the
 * filenames, is the source of truth.
 *
 * Ollama is deliberately NOT here. Beyond hamr's word, it is the one entry
 * whose economics differ in kind: it takes no API key and bills nothing, so
 * every round would price at $0 through machinery that treats $0 as a real
 * price. An unpriced round reported as free is the exact honesty violation the
 * `?? 0` rule exists to stop, and admitting it needs that question answered
 * first, not a menu entry.
 *
 * `gemini-api` is ADMITTED-PENDING-PROBE: the probe rule stands (item 28
 * ruling (d)) and gemini has zero runs. See `PROBE_STATUS` in
 * `src/providers.js` — a spec may name it, and the runner says out loud that
 * nothing has proven it. */
export const PROVIDERS = Object.freeze(['anthropic-api', 'openai-api', 'gemini-api', 'clipipe-subscription']);
/** V3 environment label: declared keys only — every field is a lineage-key
 * candidate at N3. `provider` is part of the key by definition (top-level,
 * not duplicated here). */
export const CONDITION_KEYS = Object.freeze(['providerPath', 'closeVerbosity', 'taskFraming', 'scaffold']);
// `steps` stays in the field list ONLY so a retired spec reds by name
// (`shape-retired`) instead of falling through to a generic unknown-field —
// the operator gets told what happened, not just that something is wrong.
const JOB_FIELDS = ['schema', 'job', 'description', 'provider', 'baseUrl', 'conditions', 'cadence', 'trigger', 'budgetUsd', 'maxWallMs', 'closeTimeoutMs', 'model', 'thinking', 'handoffNote', 'seedNote', 'mcp', 'flowType', 'ticketFilter', 'ticketWatch', 'readMap', 'judge', 'writeScope', 'steps', 'escalation', 'goal', 'verdictType', 'close', 'closeDecl', 'checks', 'tools', 'jobLines', 'inputs'];
/** the exact fields of a signed `judge` override — nested objects red unknown
 * keys too, because no smuggling level exists in a signed spec */
const JUDGE_FIELDS = ['provider', 'model'];
/** the four-field plan shape's core (decision 5) — presence of any of these
 * declares the shape; `tools` (the ceiling) rides the shape but alone does not
 * declare it, so a legacy spec carrying it gets a pointed red, not a conflict */
const PLAN_CORE_FIELDS = ['goal', 'verdictType', 'close', 'closeDecl', 'checks'];
/** exact field set per close type — anything else is an unknown-field red
 * (freeform code, script bodies, and minting claims all land there) */
const CLOSE_FIELDS = {
  predicate: ['type', 'cmd', 'expect', 'judged', 'gapKeep', 'sha256'],
  gold: ['type', 'expected', 'compare'],
  rubric: ['type', 'criteria'],
  hitl: ['type', 'prompt'],
};
const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;

/** @typedef {{code: string, path: string, detail?: string, verb?: string, lib?: string}} Red — `verb` and `lib` ride request-reds as structured data (the ledger keys on them, never on prose).
 * `lib` is the TERRITORY the demand lands against, stamped HERE at the emit site
 * (the typed-lib rule): one code, two catalogues — a locked TOOL verb is demand
 * against the worker-surface package, a locked VERDICT type is demand against
 * bareloop's OWN menu. Inferring it downstream is how a bareloop refusal gets
 * filed as an upstream bug (the BA-2 misattribution class). */

/**
 * The `baseUrl` SHAPE rule, standalone (PRD item 28 ruling (d); PRD item 33
 * close-out, "authoring provider selectable" — a bad `--base-url` used to
 * refuse only at the end of the interview, through `validateJob`, after every
 * question had already been asked). ONE spelling of the rule: `validateJob`
 * below calls this, and so does `scripts/run-interview.mjs`, at flag-parse
 * time, before it asks anything.
 *
 * No network access, so this checks SHAPE only: `https://` for a real
 * endpoint, or `http://` restricted to a loopback host (a local
 * OpenAI-compatible server, the only legitimate reason to skip TLS) — and
 * never a credential embedded IN the URL itself. A URL travels into logs and
 * spine records far more casually than a header ever would, and secrets never
 * enter the tree/spine (hard line #3) — a baseUrl carrying `user:pass@host`
 * is exactly that leak, just spelled differently. The returned message never
 * echoes the value it judged — it is printed as-is by both callers, and a
 * value that failed for carrying credentials must not repeat them back.
 * @param {unknown} value
 * @returns {string|null} a red `detail`, or `null` when the value is admitted
 */
export function validateBaseUrl(value) {
  if (!isNonEmptyString(value)) {
    return 'non-empty string — an https:// URL (http:// admitted only to 127.0.0.1/localhost/::1)';
  }
  /** @type {URL|null} */
  let u = null;
  try { u = new URL(value); } catch { /* u stays null — caught below */ }
  if (!u) return 'must be a parseable URL';
  if (u.username !== '' || u.password !== '') return 'no embedded credentials (user:pass@host) — secrets never enter a signed spec';
  if (u.protocol === 'https:') return null; // admitted
  if (u.protocol === 'http:' && (u.hostname === '127.0.0.1' || u.hostname === 'localhost' || u.hostname === '::1')) {
    return null; // admitted — a local OpenAI-compatible endpoint, the one case that legitimately skips TLS
  }
  return 'https:// required (http:// admitted only to 127.0.0.1/localhost/::1)';
}

/** the job's flow types; `flowType` is set by code from the job card and signed with the job (fwdloop M13 piece 4) */
export const FLOW_TYPES = Object.freeze(['plain', 'mcp', 'tickets']);

/** the words the card's Flow type menu and the Job tab use for each flow type (fwd's am2 names) */
export const FLOW_TYPE_LABELS = Object.freeze({ plain: 'plain', mcp: 'MCP', tickets: 'Tickets MCP' });

/**
 * The ONE reader of a job's flow type: the field when present; an `mcp` block with no `flowType` is a Tickets job; no `mcp` block is plain.
 * @param {Record<string, any>} spec @returns {'plain'|'mcp'|'tickets'}
 */
export function flowTypeOf(spec) {
  if (typeof spec?.flowType === 'string' && FLOW_TYPES.includes(spec.flowType)) return /** @type {any} */ (spec.flowType);
  return spec?.mcp ? 'tickets' : 'plain';
}

/** the shape of an MCP server or tool name in a job (the bridge names a tool `<server>_<tool>`) */
const MCP_NAME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/**
 * Validate `mcp`, `flowType`, `ticketFilter`, `ticketWatch` (all optional; a spec without them is unchanged). Reds name the field and the legal shape.
 * @param {Record<string, any>} spec @param {(code: string, path: string, detail?: string) => void} red
 */
function checkMcpFields(spec, red) {
  const has = (/** @type {string} */ k) => spec[k] !== undefined;
  const hasMcp = has('mcp');
  if (hasMcp) {
    const m = spec.mcp;
    if (!isObj(m)) red('invalid-value', 'mcp', 'an object {server, tools}');
    else {
      for (const key of Object.keys(m)) if (key !== 'server' && key !== 'tools') red('unknown-field', `mcp.${key}`, 'declared keys only: server|tools');
      if (typeof m.server !== 'string' || !MCP_NAME.test(m.server)) red('invalid-value', 'mcp.server', 'a plain server name (letters, digits, _ or -)');
      if (!Array.isArray(m.tools) || m.tools.length === 0) red('invalid-value', 'mcp.tools', 'a non-empty list of tool names');
      else {
        const seen = new Set();
        for (const t of m.tools) {
          if (typeof t !== 'string' || !MCP_NAME.test(t)) red('invalid-value', 'mcp.tools', `names ${JSON.stringify(t)}, which is not a plain tool name`);
          else if (seen.has(t)) red('invalid-value', 'mcp.tools', `names "${t}" twice`);
          else seen.add(t);
        }
      }
    }
  }
  if (has('flowType')) {
    const t = spec.flowType;
    if (typeof t !== 'string' || !FLOW_TYPES.includes(t)) red('invalid-value', 'flowType', `one of ${FLOW_TYPES.join(', ')}`);
    else {
      if (t === 'plain' && hasMcp) red('invalid-value', 'flowType', 'a "plain" job takes no "mcp" server');
      if (t !== 'plain' && !hasMcp) red('invalid-value', 'flowType', `a "${t}" job needs an "mcp" server`);
      if (t !== 'tickets') {
        if (has('ticketFilter')) red('invalid-value', 'ticketFilter', 'belongs to a Tickets MCP job');
        if (has('ticketWatch')) red('invalid-value', 'ticketWatch', 'belongs to a Tickets MCP job');
      }
    }
  }
  if (has('ticketFilter')) {
    // ONE reader of a legal filter (src/ticketfilter.js), shared with the drafter's proposal
    for (const r of ticketFilterReds(spec.ticketFilter, { hasMcp })) red(r.code, r.path, r.detail);
  }
  if (has('ticketWatch')) {
    const w = spec.ticketWatch;
    if (!Array.isArray(w) || w.length === 0) red('invalid-value', 'ticketWatch', `a non-empty list of fields (${WATCHABLE.join(' and ')})`);
    else {
      if (!hasMcp) red('invalid-value', 'ticketWatch', 'watches tickets read through the job\'s "mcp" tools, but the job lists no "mcp" server');
      const seen = new Set();
      for (const f of w) {
        if (typeof f !== 'string' || !WATCHABLE.includes(f)) red('invalid-value', 'ticketWatch', `names ${JSON.stringify(f)}, which is not a field that can be watched (${WATCHABLE.join(' and ')})`);
        else if (seen.has(f)) red('invalid-value', 'ticketWatch', `names "${f}" twice`);
        else seen.add(f);
      }
    }
  }
}

/**
 * Validate an operator-owned job spec (`schema: "job-v1"`). Never throws on
 * JSON text or plain parsed data — the ingest contract; a live object with a
 * hostile accessor is outside it. Every failure is a named red. Returns the
 * parsed spec on ok (single parse), null on any red.
 * @param {object|string} input parsed spec, or raw JSON text (parse failures are a red)
 * @param {{ shellCapUsd?: number }} [opts] the shell's hard ceiling — the job
 *   budget may tighten it, never exceed it (ceiling chain: workflow ≤ job ≤ shell)
 * @returns {{ ok: boolean, reds: Red[], job: object|null }}
 */
export function validateJob(input, { shellCapUsd = 2 } = {}) {
  /** @type {Red[]} */
  const reds = [];
  /** @type {(code: string, path: string, detail?: string) => void} */
  const red = (code, path, detail) => { reds.push(detail ? { code, path, detail } : { code, path }); };

  let j = input;
  if (typeof j === 'string') {
    try { j = JSON.parse(j); } catch (e) {
      return { ok: false, reds: [{ code: 'parse-error', path: '$', detail: String(/** @type {Error} */ (e).message) }], job: null };
    }
  }
  if (!isObj(j)) return { ok: false, reds: [{ code: 'parse-error', path: '$', detail: 'job spec must be a JSON object' }], job: null };
  const spec = /** @type {Record<string, any>} */ (j);

  // 1. shape — unknown fields red here: hooks/loop/memory (agent domain),
  // capRuns (shell domain), minting claims — inexpressibility is the guard.
  for (const key of Object.keys(spec)) {
    if (!JOB_FIELDS.includes(key)) red('unknown-field', key);
  }
  if (spec.schema === undefined) red('missing-required', 'schema');
  else if (spec.schema !== 'job-v1') red('invalid-value', 'schema', `expected "job-v1", got ${JSON.stringify(spec.schema)}`);
  if (!isNonEmptyString(spec.job) || !SLUG_RE.test(spec.job)) red('invalid-value', 'job', 'kebab-case slug');
  if (!isNonEmptyString(spec.description)) red('missing-required', 'description');

  if (spec.provider === undefined) red('missing-required', 'provider');
  else if (!PROVIDERS.includes(spec.provider)) red('invalid-value', 'provider', `menu: ${PROVIDERS.join('|')}`);

  // 2. the environment label (V3, design law #5): declared keys only
  if (spec.conditions !== undefined) {
    if (!isObj(spec.conditions)) red('invalid-value', 'conditions', 'flat object of declared condition keys');
    else {
      for (const [key, value] of Object.entries(spec.conditions)) {
        if (!CONDITION_KEYS.includes(key)) red('unknown-field', `conditions.${key}`, `declared keys only: ${CONDITION_KEYS.join('|')} (every field is a lineage-key dimension, V3)`);
        else if (!isNonEmptyString(value)) red('invalid-value', `conditions.${key}`, 'non-empty string');
      }
    }
  }

  // T (PRD v1.99): `cadence` is no longer required. A spec signed before triggers keeps its `cadence` (still validated
  // when present, read as by hand, never rewritten, never re-hashed); a new spec carries none.
  if (spec.cadence !== undefined) {
    if (!isObj(spec.cadence)) red('invalid-value', 'cadence', 'object of {unit, every}');
    else {
      const cad = spec.cadence;
      for (const key of Object.keys(cad)) {
        if (key !== 'unit' && key !== 'every') red('unknown-field', `cadence.${key}`, 'nested objects red unknown keys too — no smuggling level exists in a signed spec');
      }
      if (!CADENCE_UNITS.includes(cad.unit)) red('invalid-value', 'cadence.unit', CADENCE_UNITS.join('|'));
      if (!(Number.isInteger(cad.every) && cad.every >= 1 && cad.every <= 30)) red('bounds', 'cadence.every', '1..30');
    }
  }

  // T: the trigger the person signed (a typed object, never cron text). ABSENT = by hand. Set only by the panel's
  // two-click schedule door; the agent never writes it (assembleSpec refuses a draft that carries it).
  if (spec.trigger !== undefined) {
    const tv = validateTrigger(spec.trigger);
    if (!tv.ok) red(tv.code, tv.path, tv.say);
  }

  if (spec.budgetUsd === undefined) red('missing-required', 'budgetUsd');
  else if (!(typeof spec.budgetUsd === 'number' && Number.isFinite(spec.budgetUsd) && spec.budgetUsd > 0 && spec.budgetUsd <= shellCapUsd)) {
    red('bounds', 'budgetUsd', `a finite 0 < budget <= shell cap ${shellCapUsd} (cap-not-estimate; no self-adjusted budgets, ever)`);
  }

  // T (PRD v1.27/v1.29) — TIME, with exactly budgetUsd's status: operator input,
  // the agent may tighten and never widen, never self-raised. OPTIONAL AND WITH NO
  // DEFAULT, decided by hamr 2026-07-26: a defaulted cap is a silent second
  // ceiling, which is the F45 failure (a money rule with no wired detector let
  // four cut rows be classed as evidence). A spec without it is time-unbounded by
  // explicit operator CHOICE — so nothing here mints a fallback, and the runner
  // reports the absence rather than letting it be inferred.
  if (spec.maxWallMs !== undefined
      && !(typeof spec.maxWallMs === 'number' && Number.isInteger(spec.maxWallMs) && spec.maxWallMs >= MIN_WALL_MS)) {
    red('bounds', 'maxWallMs',
      `integer milliseconds >= ${MIN_WALL_MS} (one close timeout). Enforcement is a between-round deadline, measured as maxWallMs + closeStages x closeTimeoutMs (design addendum 1: loop.stop() cannot cut an in-flight call; W5: every close stage runs under the full timeout), so a budget under one close cannot fund its own close and the advertised number would be more wrong than right`);
  }

  // CLOSE TIMEOUT (PRD item 27/M3, hamr 2026-09-06: "both … autoset and can be
  // override, same like api pricing"). OPTIONAL and WITH NO CEILING: absent
  // means the runner autosets it from a $0 seed timing pass
  // (`src/closetimeout.js`); present is the OPERATOR's own number and — like a
  // rates-passthrough override (F113) — it may legally sit ABOVE the autoset
  // estimate, so this is not tighten-only. The one bound that IS enforced is
  // the floor every close timeout has always had (`CLOSE_TIMEOUT_FLOOR_MS`,
  // hamr's arbiter constant, 2026-09-07): a value below it could never fund
  // even a fast close, exactly the "advertised number more wrong than right"
  // failure `maxWallMs` already guards above.
  if (spec.closeTimeoutMs !== undefined
      && !(typeof spec.closeTimeoutMs === 'number' && Number.isInteger(spec.closeTimeoutMs) && spec.closeTimeoutMs >= CLOSE_TIMEOUT_FLOOR_MS)) {
    red('bounds', 'closeTimeoutMs', `integer milliseconds >= ${CLOSE_TIMEOUT_FLOOR_MS} (the arbiter's floor) — a signed override may sit above the autoset estimate, never below the floor every close timeout has always had`);
  }

  // MODEL — the worker's provider model id (build-list #3, hamr's GO
  // 2026-08-30). OPTIONAL, exactly like budgetUsd/maxWallMs before it: absent
  // means today's behaviour (the runner's own default), present it is part
  // of the signed hash — jobSpecHash canonizes the whole resolved spec
  // (resolveSpec), so a spec that names a model is an operator signing off
  // on THAT model, not merely on the goal/close it runs against. The judge
  // model stays library-pinned pending recalibration — out of scope here.
  if (spec.model !== undefined && !isNonEmptyString(spec.model)) {
    red('invalid-value', 'model', 'non-empty string — the exact model id of a line ticked in Settings > Providers');
  }
  // THINKING (P8) — the job's "Thinking on" tick, OPTIONAL: absent means off (and an old spec keeps the hash it always had); present it is
  // signed like `model`. It covers DRAFTING and the rubric JUDGE, and makes every WORKER call think (src/thinking.js `workerThinkingMode`; without it the worker's mode is decided from phase and attempt). A boolean, nothing else.
  if (spec.thinking !== undefined && typeof spec.thinking !== 'boolean') {
    red('invalid-value', 'thinking', 'true or false — the job\'s "Thinking on" tick (absent = off)');
  }
  // LEGACY `handoffNote` (the handoff note was folded into the carry memo, 2026-10-31): still accepted and hashed so an old signed spec
  // verifies; it has NO effect since 2026-11-01 (the carry memo is always on). A boolean if present. New specs and drafts never write it.
  if (spec.handoffNote !== undefined && typeof spec.handoffNote !== 'boolean') {
    red('invalid-value', 'handoffNote', 'true or false (legacy, ignored: the carry memo is always on)');
  }

  // THE SEED NOTE (src/seednote.js): a declared job condition, signed like `thinking`. A boolean; ABSENT = on (an old spec keeps its
  // bytes, so its hash), only an explicit `false` turns off handing the planner and the first worker what the job's own check said at start. The switch is hashed; the text never is.
  if (spec.seedNote !== undefined && typeof spec.seedNote !== 'boolean') {
    red('invalid-value', 'seedNote', 'true or false (absent = on): whether the planner and the first worker are told what the job\'s own count check said on the untouched tree');
  }

  // THE MCP SOURCE AND TICKET FIELDS (ITEM33-BUILD, MCP+tickets piece 1): `mcp {server, tools}`, `flowType`, `ticketFilter`, `ticketWatch`.
  // Signed like `seedNote`: ABSENT keeps every old spec's bytes, so its hash. Set by CODE from the person's card pick, never by the drafter
  // (assembleSpec refuses a draft carrying them). Validated here; the run-start reader is src/ticketmcp.js.
  checkMcpFields(spec, red);

  // THE FIRST-READ MAP (src/readshim.js, EXPERIMENTAL): a declared job condition, signed like `thinking`. A boolean; ABSENT = off (an old spec keeps
  // its bytes, so its hash), `true` makes the first shell_read of a big non-test file in an ask return a map of its parts. The switch is hashed.
  if (spec.readMap !== undefined && typeof spec.readMap !== 'boolean') {
    red('invalid-value', 'readMap', 'true or false (absent = off, experimental): whether the first read of a big file in an ask returns a map of its parts instead of the file');
  }

  // JUDGE — PRD item 32.1 (hamr, 2026-09-10: the judge "defaults to whatever
  // llm is used and can be overriden"). OPTIONAL, and the OVERRIDE half: absent,
  // the judge resolves to this job's own worker provider and model
  // (`resolveJudge`, src/judged.js), which is what lets a DeepSeek or Gemini job
  // judge without a second account. Present, it pins a judge deliberately
  // different from the worker — an independent reader.
  //
  // It is signed like `model`/`baseUrl` above: `jobSpecHash` canonizes the whole
  // resolved spec, so naming a judge is the OPERATOR signing off on who examines
  // this work. The drafting agent cannot express it — naming your own examiner is
  // arbiter territory, and the authoring schema has no such field.
  //
  // BOTH halves are required together, deliberately. A `judge` carrying only a
  // provider would have to invent a model, and a judge identity nobody wrote is
  // the state the calibration record exists to make impossible.
  if (spec.judge !== undefined) {
    if (!isObj(spec.judge)) {
      red('invalid-value', 'judge', 'an object {provider, model} — the signed judge override; omit it to judge on this job\'s own worker model');
    } else {
      for (const key of Object.keys(spec.judge)) {
        if (!JUDGE_FIELDS.includes(key)) red('unknown-field', `judge.${key}`, `declared keys only: ${JUDGE_FIELDS.join('|')}`);
      }
      if (!PROVIDERS.includes(spec.judge.provider)) {
        red('invalid-value', 'judge.provider', `menu: ${PROVIDERS.join('|')} — the judge runs through the same provider factory the worker does, so an off-menu judge is a provider nothing can construct`);
      }
      if (!isNonEmptyString(spec.judge.model)) {
        red('invalid-value', 'judge.model', 'non-empty string — exact provider model id; a judge with a provider and no model is an identity nobody signed');
      }
    }
  }

  // BASE URL — PRD item 28, ruling (d), 2026-09-09: admitted in v1 of
  // openai-api (an OpenAI-compatible gateway/endpoint), OPTIONAL and part of
  // the signed hash like `model` above. `validateBaseUrl` (below) is the ONE
  // spelling of the shape rule — `scripts/run-interview.mjs` calls it too, at
  // flag-parse time, before the interview asks a single question, rather than
  // this file's copy being the only one that ever ran it.
  if (spec.baseUrl !== undefined) {
    const err = validateBaseUrl(spec.baseUrl);
    if (err) red('invalid-value', 'baseUrl', err);
  }

  // 3. the outer write fence — operator law (interview decision #4), same
  // containment rules as the workflow layer THROUGH THE SAME CODE (F9: two
  // transforms would let a fence validate green and mean something else).
  if (spec.writeScope === undefined) red('missing-required', 'writeScope', 'the fence is operator law — the workflow scope must fit inside it');
  else if (!(Array.isArray(spec.writeScope) && spec.writeScope.length > 0
             && spec.writeScope.every((/** @type {unknown} */ s) => isNonEmptyString(s)))) {
    red('invalid-value', 'writeScope', 'non-empty array of glob strings');
  } else if (!spec.writeScope.every((/** @type {string} */ s) => !globToPrefix(s).includes('*'))) {
    red('invalid-value', 'writeScope', 'wildcards only as a trailing "/**" or "/*" (enforcement is prefix-containment, adaptlearn F9)');
  } else if (!spec.writeScope.every(scopeContained)) {
    red('invalid-value', 'writeScope', 'must be a proper subdirectory of the run directory — no absolute paths, no ".." segments, not the run dir itself (design law #1)');
  }

  if (spec.escalation === undefined) red('missing-required', 'escalation.mode', 'the pain channel is not optional (law #7)');
  else {
    const esc = isObj(spec.escalation) ? spec.escalation : {};
    for (const key of Object.keys(esc)) {
      if (key !== 'mode') red('unknown-field', `escalation.${key}`, 'nested objects red unknown keys too — no smuggling level exists in a signed spec');
    }
    if (esc.mode !== 'decision-ready') red('invalid-value', 'escalation.mode', 'must be "decision-ready"');
  }

  // 4. the plan shape — the ONLY shape (PRD v1.32, 2026-07-26). The legacy
  // operator-authored steps[] chain was deleted with the rest of that path:
  // hand-writing the workflow is the exact thing the product removes, and its
  // co-existence forced every downstream schema decision to carry two spellings.
  // `steps` is now an unknown field like any other, so an old spec reds by name
  // rather than half-running.
  if (spec.steps !== undefined) {
    red('shape-retired', 'steps', 'operator-authored steps[] was deleted (PRD v1.32) — a job declares goal/verdictType/close and the AGENT authors the steps. hitl and soft-green return as a Layer 3 decision, rebuilt in this shape');
  } else if (PLAN_CORE_FIELDS.some((f) => spec[f] !== undefined) || spec.tools !== undefined) {
    validatePlanShape(spec, red, reds);
  } else {
    red('missing-required', 'goal', 'a job declares goal/verdictType/close — the agent authors the steps');
  }

  // 5. secrets sweep — the SAME shared guard the workflow validator runs
  // (defense-in-depth against known token shapes; env-only loading is the law)
  sweepSecretLiterals(spec, red);

  return { ok: reds.length === 0, reds, job: reds.length === 0 ? spec : null };
}

/**
 * Per-type close contract — fixed menus only. ONE home for both call sites
 * (a legacy step's close, the plan shape's top-level close): two copies would
 * be the F9 two-transforms class on the arbiter's own contract.
 * @param {Record<string, any>} close
 * @param {string} at path prefix of the close object (e.g. `steps.0.close`, `close`)
 * @param {(code: string, path: string, detail?: string) => void} red
 * @returns {boolean} type-in-menu — false means per-type checks were unreachable
 */
function validateClose(close, at, red) {
  if (!CLOSE_TYPES.includes(close.type)) {
    red('close-type', `${at}.type`, `menu: ${CLOSE_TYPES.join('|')} — a close is data, never code`);
    return false;
  }
  if (close.type === 'predicate') {
    predicateBody(close, at, red);
  } else if (close.type === 'gold') {
    if (close.expected === undefined) red('missing-required', `${at}.expected`);
    if (!GOLD_COMPARE.includes(close.compare)) red('invalid-value', `${at}.compare`, GOLD_COMPARE.join('|'));
  } else if (close.type === 'rubric') {
    if (!isNonEmptyString(close.criteria)) red('missing-required', `${at}.criteria`);
  } else if (close.type === 'hitl') {
    if (!isNonEmptyString(close.prompt)) red('missing-required', `${at}.prompt`);
  }
  for (const key of Object.keys(close)) {
    if (!CLOSE_FIELDS[close.type].includes(key)) {
      red('unknown-field', `${at}.${key}`, `not a ${close.type} field (script bodies and minting claims land here)`);
    }
  }
  return true;
}

/**
 * The F49 reject's OPERATOR-side detail. ONE spelling for both regex fields —
 * they differ only in which untimed evaluator the pattern reaches — so the two
 * reds can never drift into saying different things about the same hazard.
 *
 * The second sentence is the part an operator cannot derive: on the agent side
 * F49 is self-DoS, but these two patterns are compiled and run in BARELOOP'S OWN
 * PROCESS, where the hang blocks the event loop the in-process stall fuse lives
 * on (F67 — a guard sharing the fate of the process it guards). The run then
 * dies to the outside watchdog and reads as a model stall, so without this red a
 * bad regex in a SIGNED spec is diagnosed as a provider problem.
 * @param {string} evaluator the consumer that would run it, named concretely
 */
const redosDetail = (evaluator) => `nested unbounded quantifier (e.g. (a+)+ , (\\d*)* , (x+){1,}) — a catastrophic-backtracking footgun that can hang ${evaluator}, untimed (F49). It runs in bareloop's own process, so the hang blocks the event loop the stall fuse lives on (F67) and the run dies to the outside watchdog looking like a model stall; rewrite without a repeated group inside a repeat`;

/**
 * The predicate BODY contract — cmd/expect/judged/gapKeep. Shared verbatim by
 * the predicate close and the Layer 2 named checks (decision 1: a check runs
 * under the same runClose machinery, so it validates under the same rules).
 * @param {Record<string, any>} o the close or check carrying the body
 * @param {string} at path prefix (e.g. `steps.0.close`, `close`, `checks.1`)
 * @param {(code: string, path: string, detail?: string) => void} red
 */
function predicateBody(o, at, red) {
  if (!isNonEmptyString(o.cmd)) red('missing-required', `${at}.cmd`);
  // the runner executes cmd as whitespace-split argv with NO shell: quote
  // characters imply shell semantics the split cannot honor — honest
  // refusal beats silent misparse (N2 design default)
  else if (/["']/.test(o.cmd)) red('invalid-value', `${at}.cmd`, 'quote characters are inexpressible: cmd runs as whitespace-split argv, no shell');
  else if (o.cmd !== o.cmd.trim()) red('invalid-value', `${at}.cmd`, 'leading/trailing whitespace — argv splits on whitespace and an empty argv[0] cannot spawn; honest refusal beats a silent misparse');
  // Close-bytes signature (PRD item 27/M2, F129's general fix's own general
  // fix — N4): the signature must cover the close SCRIPT'S CONTENT, not only
  // its path (`cmd`). Demanded exactly where a byte-exact fingerprint can be
  // minted against something: `cmd` names an addressable script by the
  // SAME shape test `src/close-integrity.js`'s detectors use
  // (`closeScriptCandidateToken`, src/validate.js — `node <path> …`, OR a
  // bare directly-executable absolute path such as a `.sh` wrapper; widened
  // 2026-09-06 after an orchestrator audit found the bare form silently
  // invisible to both this demand and the byte/path detectors — a blind
  // instrument). A cmd naming no such script (most test-fixture closes:
  // `true`, `npx`, `pytest`, a relative bare executable — or a
  // missing/malformed cmd, already reded above) carries no demand — a stage
  // with nothing to hash gets no `missing-required` for a field that could
  // never be minted honestly. `validateJob` stays pure (no fs): this checks
  // the FIELD'S SHAPE only, never the bytes on disk (that is the runner's
  // job, `checkCloseByteSignature`/`checkStageByteSignature`).
  const isScriptCmd = closeScriptCandidateToken(o.cmd) !== null;
  if (isScriptCmd) {
    if (o.sha256 === undefined) {
      red('missing-required', `${at}.sha256`, 'hex sha256 of the script file bytes `cmd` names — mint it with signCloseScripts (src/close-integrity.js) / scripts/sign-close.mjs, never hand-typed');
    } else if (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256)) {
      red('invalid-value', `${at}.sha256`, '64 lowercase hex chars — sha256 of the script file bytes, never the spec, never the path');
    }
  } else if (o.sha256 !== undefined && (typeof o.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(o.sha256))) {
    // not demanded for a non-script cmd, but a PRESENT value is still
    // shape-checked — a malformed string is a typo either way
    red('invalid-value', `${at}.sha256`, '64 lowercase hex chars — sha256 of the script file bytes, never the spec, never the path');
  }
  if (!Number.isInteger(o.expect)) red('invalid-value', `${at}.expect`, 'integer exit code');
  // The judgment-rendered signal (PRD v1.11, optional). Exit code alone
  // cannot separate "the suite ran and failed" from "the suite crashed at
  // load" — they are byte-identical at the seam, and against `node --test`
  // so are the raw counts (a crashed file is reported as ONE failing test).
  // So the signal is a FLOOR, not a zero-check: a close declares how many
  // things it must judge before its exit code means anything at all.
  if (o.judged !== undefined) {
    const j = o.judged;
    if (!isObj(j)) red('invalid-value', `${at}.judged`, 'object {pattern, min} — proof the close actually judged something');
    else {
      for (const key of Object.keys(j)) {
        if (!['pattern', 'min'].includes(key)) red('unknown-field', `${at}.judged.${key}`);
      }
      if (!isNonEmptyString(j.pattern)) red('missing-required', `${at}.judged.pattern`, 'regex over the close output with ONE capture group yielding the count');
      else {
        let groups = 0;
        try {
          // `p|` always matches the empty string, so exec() returns an array
          // whose length is 1 + the number of capture groups — the only way
          // to count groups without executing the pattern against real output.
          groups = (new RegExp(`${j.pattern}|`).exec('')?.length ?? 1) - 1;
        } catch {
          red('invalid-value', `${at}.judged.pattern`, 'must compile as a RegExp');
          groups = -1;
        }
        // A pattern with no capture group extracts nothing, so EVERY close
        // would read as crashed — a dead arbiter that reds forever. Red the
        // spec, not every run.
        if (groups === 0) red('invalid-value', `${at}.judged.pattern`, 'no capture group — the count is read from group 1, so this pattern would crash every close');
        // More than one is the same defect wearing a subtler hat: runClose
        // reads group 1 ONLY, so an alternation whose other branch carries
        // the count leaves group 1 undefined → NaN → judgedCount null →
        // an exit-0 GREEN stamped 'crashed' (a fake crash, the mirror of
        // the fake green this floor exists to catch). Alternation stays
        // fully expressible with non-capturing branches: `(?:a|b) (\d+)`.
        else if (groups > 1) red('invalid-value', `${at}.judged.pattern`, `${groups} capture groups — the count is read from group 1 only; use exactly one capture group and non-capturing (?:…) branches`);
        // F49, operator side: `runClose` execs this against the close's whole
        // stdout+stderr with no timeout. Gated on `groups >= 0` — that is the
        // COMPILED flag in disguise (the catch sets -1), and the scan documents
        // that it assumes syntactically valid input.
        if (groups >= 0 && hasNestedQuantifier(j.pattern)) {
          red('invalid-value', `${at}.judged.pattern`, redosDetail('the close reader (runClose)'));
        }
      }
      if (!Number.isInteger(j.min) || j.min < 1) {
        red('invalid-value', `${at}.judged.min`, 'integer >= 1 — a floor of 0 is satisfied by judging nothing, which is the check it is meant to make');
      }
    }
  }
  // The kept-failures pattern (F28, optional). ralph's gap bound head/tail-
  // elides a large close stream, and a big TAP suite prints its `not ok`
  // lines in the MIDDLE — so the failing-test NAMES (the causal navigation
  // input the worker runs on) were deleted in transit and the worker was
  // told "5 fail" and never WHICH. gapKeep is a regex SOURCE whose matching
  // lines are PRESERVED in the gap in addition to head+tail. Same discipline
  // as judged.pattern: a non-empty string that must compile as a RegExp, or
  // it is a spec red before any tokens burn (reds-before-tokens) — an invalid
  // keep pattern must never surface as a runtime crash inside the arbiter.
  if (o.gapKeep !== undefined) {
    if (!isNonEmptyString(o.gapKeep)) red('invalid-value', `${at}.gapKeep`, 'regex source string — lines matching it survive the gap bound (F28)');
    else {
      let compiled = false;
      try { new RegExp(o.gapKeep, 'm'); compiled = true; }
      catch { red('invalid-value', `${at}.gapKeep`, 'must compile as a RegExp'); }
      // F49, operator side and the measured one: `boundGap` runs this per LINE
      // over the whole close stream, untimed. Measured: `(a+)+$` against a
      // 40-char line does not finish in 20s.
      if (compiled && hasNestedQuantifier(o.gapKeep)) {
        red('invalid-value', `${at}.gapKeep`, redosDetail('the gap bound (boundGap), once per line of close output'));
      }
    }
  }
}

/**
 * The staged close (PRD v1.28) — the close is an ORDERED LIST of named stages,
 * and the check menu DERIVES from it. The principle: *the user authors the
 * destination, never the road.* A user who cannot describe a workflow can still
 * say what done looks like, and everything downstream of that is derived — which
 * is why `checks[]` no longer exists as a field (hamr: *"there shouldn't be user
 * authoring anywhere, that defies the point of bareloop"*).
 *
 * Two stage classes cannot be handed to the agent as a mid-build ruler, and F58
 * measured both against a real close:
 *  - a PRECONDITION ("the seed commit exists") is not a ruler for the work; run
 *    as a check it passes instantly and teaches nothing. It sets `offer: false`.
 *  - a stage that reads what an EARLIER stage built ("the public API matches the
 *    emitted declarations") reds on its own for a reason that has nothing to do
 *    with the worker's edit. It names `needs`, and picking it runs that chain first.
 * Everything else is offerable: derivation gave job #5 SEVEN rulers where the
 * operator had hand-carved three (F58) — removing the operator does not cost the
 * agent rulers, it hands it more.
 *
 * The `needs` expansion is TRANSITIVE (fixed point, not one level): a
 * prerequisite may itself name one, and running an incomplete chain reproduces
 * the exact false-red `needs` exists to remove, one level deeper. The expanded
 * chain is ordered by the CLOSE, never by the order names were typed —
 * validateStagedClose forces `needs` to name EARLIER stages, so close order IS
 * a topological order. A `needs` cycle is inexpressible in a validated close for
 * that same reason; the walk is still cycle-safe by construction (each stage is
 * collected at most once), because a pure exported helper must terminate on
 * whatever it is handed rather than hang the runner before any token burns.
 *
 * @param {any[]} close the validated stage list
 * @returns {{name: string, run: any[]}[]} offerable stages, each with the ordered
 *   chain that must run for it (prerequisites first, the stage itself last)
 */
export function checkMenu(close) {
  if (!Array.isArray(close)) return [];
  const named = close.filter((s) => isObj(s) && isNonEmptyString(s.name));
  const byName = new Map(named.map((s) => [s.name, s]));
  const orderOf = new Map(named.map((s, i) => [s, i]));
  /** the transitive prerequisite closure of one stage, in close order */
  const chain = (/** @type {any} */ stage) => {
    /** @type {Set<any>} */
    const collected = new Set();
    const walk = (/** @type {any} */ s) => {
      for (const n of Array.isArray(s.needs) ? s.needs : []) {
        const p = byName.get(n);
        // already collected (a diamond) or the picked stage itself (a cycle):
        // the walk stops here, so it visits each stage at most once
        if (!p || p === stage || collected.has(p)) continue;
        collected.add(p);
        walk(p);
      }
    };
    walk(stage);
    return [...collected].sort((a, b) => (orderOf.get(a) ?? 0) - (orderOf.get(b) ?? 0));
  };
  return close
    .filter((s) => isObj(s) && s.offer !== false && isNonEmptyString(s.name))
    .map((s) => ({ name: s.name, run: [...chain(s), s] }));
}

/** the fields a close STAGE may carry — anything else is a smuggle channel */
const STAGE_FIELDS = ['name', 'cmd', 'expect', 'judged', 'gapKeep', 'offer', 'needs', 'direction', 'sha256'];

/**
 * Validate the staged close. Every stage is a predicate BODY under the same
 * rules the single close object has always used (one contract, never a second
 * copy — the F9 two-transforms class applied to the arbiter itself).
 * @param {any[]} stages
 * @param {(code: string, path: string, detail?: string) => void} red
 */
function validateStagedClose(stages, red) {
  if (stages.length === 0) {
    red('missing-required', 'close', 'a non-empty ordered list of named stages — a job with nothing to run is ungated spend');
    return;
  }
  const seen = new Set();
  stages.forEach((s, i) => {
    const at = `close.${i}`;
    if (!isObj(s)) { red('invalid-value', at, 'a stage is an object { name, cmd, expect, ... }'); return; }
    for (const key of Object.keys(s)) {
      if (!STAGE_FIELDS.includes(key)) red('unknown-field', `${at}.${key}`, `not a stage field (script bodies, close types and minting claims land here); fields: ${STAGE_FIELDS.join(', ')}`);
    }
    if (!isNonEmptyString(s.name) || !SLUG_RE.test(s.name)) red('invalid-value', `${at}.name`, 'kebab-case slug — the plan references stages by name (check-passes(name))');
    else if (seen.has(s.name)) red('duplicate-id', `${at}.name`, `"${s.name}" is already a stage name — check-passes(name) would be ambiguous`);
    else seen.add(s.name);
    // every stage is a COMMAND whose exit code is truth: a rubric or hitl stage
    // is inexpressible here by construction, which is the hierarchy enforced by
    // shape rather than by a check
    predicateBody(s, at, red);
    if (s.offer !== undefined && typeof s.offer !== 'boolean') {
      red('invalid-value', `${at}.offer`, 'boolean — omit it (the default) unless the stage cannot stand alone as a ruler');
    }
    if (s.needs !== undefined) {
      const earlier = new Set(stages.slice(0, i).filter((p) => isObj(p) && isNonEmptyString(p.name)).map((p) => p.name));
      if (!Array.isArray(s.needs) || s.needs.length === 0 || !s.needs.every((n) => typeof n === 'string')) {
        red('invalid-value', `${at}.needs`, 'non-empty array of EARLIER stage names — omit the field when the stage stands alone');
      } else if (s.offer === false) {
        red('invalid-value', `${at}.needs`, 'a stage that is never offered has no chain to run — needs and offer:false are incoherent together');
      } else {
        const bad = s.needs.filter((n) => !earlier.has(n));
        if (bad.length) red('invalid-value', `${at}.needs`, `must name stages declared BEFORE this one (a prerequisite that has not run yet cannot be one): ${bad.join(', ')} — earlier stages: ${[...earlier].join(', ') || 'none'}`);
      }
    }
    // the close-fix governor's comparison direction (2026-08-31 ruling, hamr's
    // option A): a signed, per-stage field, never inferred from goal prose and
    // never LLM-judged. 'up' = higher is better (a rate of good things caught,
    // e.g. mutation-kill %); 'down' = lower is better (a count of bad things
    // remaining, e.g. typecheck errors or suppressions). Absent means 'down' —
    // the field defaults to the trend reader's pre-existing behaviour exactly,
    // so every close authored before this field existed keeps an IDENTICAL
    // spec hash (an absent field adds nothing to the hash).
    if (s.direction !== undefined && s.direction !== 'up' && s.direction !== 'down') {
      red('invalid-value', `${at}.direction`, `"up" or "down" — up means higher is better (a rate of good things caught), down means lower is better (a count of bad things remaining); omit for down (the default)`);
    }
  });
}

/**
 * The plan-shaped job spec (design record 2026-07-21, decision 5): goal /
 * verdictType / close (+ the top-level tool ceiling). The fourth field of the
 * original four, `checks`, is RETIRED — the check menu derives from the close's
 * stages instead (PRD v1.28/v1.32), and a spec that still declares it gets the
 * `checks-derived` red below rather than a bare unknown-field.
 *
 * Every verdictType the radio names is admitted (softgreen module 3); a class
 * that were locked reds as `request-red` — admission demand the ledger counts,
 * never a grant.
 * The close is validated one level up as well: a declared verdict demands a
 * close CLASS, so green-on-rubric reds as `close-hierarchy` rather than
 * laundering a soft judgement into a hard one.
 * @param {Record<string, any>} spec
 * @param {(code: string, path: string, detail?: string) => void} red
 * @param {Red[]} reds direct access for structured request-reds
 */
function validatePlanShape(spec, red, reds) {
  // P7: the person's own words, signed beside the model's goal sentence. Exact fields (no smuggling level), numbered 1..n
  // in order. Optional: a spec that predates the job block has neither and keeps its hash.
  if (spec.jobLines !== undefined) {
    if (!Array.isArray(spec.jobLines) || spec.jobLines.length === 0) red('invalid-value', 'jobLines', 'a non-empty array of {n, text, rule}');
    else {
      spec.jobLines.forEach((/** @type {any} */ l, /** @type {number} */ i) => {
        const at = `jobLines[${i}]`;
        if (!isObj(l)) { red('invalid-value', at, '{n, text, rule}'); return; }
        for (const key of Object.keys(l)) if (!['n', 'text', 'rule', 'rules'].includes(key)) red('unknown-field', `${at}.${key}`, 'job line fields: n, text, rule, rules');
        if (l.n !== i + 1) red('invalid-value', `${at}.n`, `lines are numbered 1, 2, 3 in order — expected ${i + 1}`);
        if (!isNonEmptyString(l.text)) red('invalid-value', `${at}.text`, 'non-empty text');
        if (typeof l.rule !== 'string') red('invalid-value', `${at}.rule`, 'a string ("" when the line has no ~ rule)');
        // optional, beside `rule`: the same `~` lines one by one; it must join back to `rule` exactly
        if (l.rules !== undefined && (!Array.isArray(l.rules) || l.rules.some((/** @type {any} */ r) => !isNonEmptyString(r)) || l.rules.join('; ') !== l.rule)) {
          red('invalid-value', `${at}.rules`, 'an array of the ~ lines that joins with "; " to exactly `rule`');
        }
      });
    }
  }
  if (spec.inputs !== undefined) {
    if (!Array.isArray(spec.inputs) || spec.inputs.length === 0) red('invalid-value', 'inputs', 'a non-empty array of {n, label, value}');
    else {
      spec.inputs.forEach((/** @type {any} */ x, /** @type {number} */ i) => {
        const at = `inputs[${i}]`;
        if (!isObj(x)) { red('invalid-value', at, '{n, label, value}'); return; }
        for (const key of Object.keys(x)) if (!['n', 'label', 'value'].includes(key)) red('unknown-field', `${at}.${key}`, 'input fields: n, label, value');
        if (x.n !== i + 1) red('invalid-value', `${at}.n`, `inputs are numbered 1, 2, 3 in order — expected ${i + 1}`);
        if (!isNonEmptyString(x.label)) red('invalid-value', `${at}.label`, 'non-empty text');
        if (!isNonEmptyString(x.value)) red('invalid-value', `${at}.value`, 'non-empty text');
      });
    }
  }

  if (spec.goal === undefined) red('missing-required', 'goal');
  else if (!isNonEmptyString(spec.goal)) red('invalid-value', 'goal', 'non-empty text — the goal is what the agent plans against');

  /** @type {string|undefined} the close class the declared verdict demands */
  let demanded;
  if (spec.verdictType === undefined) red('missing-required', 'verdictType', `declared radio, never inferred: ${VERDICT_TYPES.join('|')}`);
  else if (LOCKED_VERDICTS.includes(spec.verdictType)) {
    // declared-but-locked (disclosure ≠ admission, the tool-menu pattern):
    // the type rides as a structured field — the ledger keys admission demand
    // on it, never on prose. `lib: 'bareloop'`: the refused catalogue is OURS
    // (VERDICT_TYPES), so this demand is never an upstream ask.
    reds.push({ code: 'request-red', path: 'verdictType', verb: spec.verdictType, lib: 'bareloop', detail: `"${spec.verdictType}" is declared-but-locked — not at this rung (admitted: ${VERDICT_TYPES.filter((v) => !LOCKED_VERDICTS.includes(v)).join(', ')}); this red IS the admission evidence, never a grant` });
    demanded = CLASS_BY_VERDICT[spec.verdictType];
  } else if (!VERDICT_TYPES.includes(spec.verdictType)) {
    red('invalid-value', 'verdictType', `menu: ${VERDICT_TYPES.join('|')} — an unknown type is a typo, never a request`);
  } else {
    demanded = CLASS_BY_VERDICT[spec.verdictType];
  }

  // THE TWO CLOSE FIELDS, and they are ALTERNATIVES (M4). `close` is the
  // operator's own command stages; `closeDecl` is the AUTHORED declaration over
  // owned kinds — the whole point of the close-authoring rung, and the field a
  // user who is not an engineer ends up with. Both at once is refused rather
  // than merged or precedence-ordered: a spec carrying two closes has two
  // arbiters, and picking one silently is how the signed artefact stops meaning
  // what the signer read.
  if (spec.close !== undefined && spec.closeDecl !== undefined) {
    red('close-duplicated', 'closeDecl', 'a job declares EITHER a command close (close) OR an authored declaration '
      + '(closeDecl) — never both. Two closes are two arbiters, and the close is the only truth');
  } else if (spec.closeDecl !== undefined) {
    // The DECLARED close. The tree-grounded half of the gate (hamr's listing
    // rule, and the scoped-job derivation that arms the F84 one-population law)
    // is DEFERRED here and re-run by the runner against the real seed before any
    // stage executes — a job spec is validated with no repository in hand, and a
    // validator that quietly skipped those two rules would report a declaration
    // it never examined. `grounded: false` is what the runner keys on.
    // the class rides along: the mandatory guard battery keys off the verdict
    // class the user picked (PRD v1.57 §2), so the gate cannot check D5 without
    // it. An unknown or locked class is refused there, on its own axis, beside
    // the counted `request-red` above.
    const cd = validateCloseDecl(spec.closeDecl, { at: 'closeDecl', deferListing: true, verdictType: spec.verdictType, writeScope: spec.writeScope, jobLines: Array.isArray(spec.jobLines) ? spec.jobLines : null, inputLabels: inputLabelsOf(spec.inputs) });
    for (const r of cd.reds) reds.push(r);
    if (demanded !== undefined && !CLASS_BY_CLOSE.declared.includes(demanded)) {
      // the same laundering guard as the close-type hierarchy, one level up: a
      // declared close is HARD, so a soft/hitl verdict can never ride one
      red('close-hierarchy', 'verdictType', `verdictType ${spec.verdictType} demands a ${demanded}-class close; an `
        + `authored declaration admits ${CLASS_BY_CLOSE.declared.join('|')} only — every live kind is a mechanical `
        + 'measurement, and the two judgment kinds are locked out of the catalogue (PRD §7)');
    }
  } else if (spec.close === undefined) red('missing-required', 'close', 'declared green with nothing to run it — preflight validates the declaration, never infers');
  // The staged close (PRD v1.28): an ordered list of named command stages, from
  // which the check menu derives. The object form remains ONLY for the
  // declared-but-locked verdict classes (gold/rubric/hitl), which name no
  // command and which the plan flow refuses at runtime (close-unsupported).
  else if (Array.isArray(spec.close)) validateStagedClose(spec.close, red);
  else if (!isObj(spec.close)) red('invalid-value', 'close', 'an ordered list of named stages [{ name, cmd, expect, ... }], or a close object for a locked verdict class');
  else if (validateClose(spec.close, 'close', red) && demanded !== undefined
           && !CLASS_BY_CLOSE[spec.close.type].includes(demanded)) {
    // the hierarchy one level up: the declared verdict demands a close class
    // its close type cannot legally claim (green-on-rubric is laundering)
    red('close-hierarchy', 'verdictType', `verdictType ${spec.verdictType} demands a ${demanded}-class close; ${spec.close.type} admits ${CLASS_BY_CLOSE[spec.close.type].join('|')} only (a rubric can never be hard — PRD §7)`);
  }

  // `checks[]` is RETIRED (PRD v1.28/v1.32): the check menu DERIVES from the
  // close's stages, so no operator authors checks per job, ever. The red names
  // what happened rather than leaving a bare unknown-field — and the hazard it
  // removes is measured, not theoretical: job #5's three hand-written checks
  // were re-implementations of three stages the close already ran, and a
  // hand-carved copy can drift LENIENT (the worker passes the operator's ruler
  // and fails the real inspection). Derivation removes that class by construction.
  if (spec.checks !== undefined) {
    red('checks-derived', 'checks', 'hand-authored checks are retired — declare the close as an ordered list of named stages and the check menu derives from it (the agent references them with check-passes(name)); a stage that cannot stand alone sets offer:false, one that needs an earlier stage names it in needs');
  }

  // the tool CEILING (plan-v1 anchor: every plan step's verbs ⊆ this) — same
  // grant rules as a step's tools; run stays locked-but-listed (request-red)
  if (spec.tools !== undefined) {
    if (!(Array.isArray(spec.tools) && spec.tools.length > 0
          && spec.tools.every((/** @type {unknown} */ t) => typeof t === 'string')
          && new Set(spec.tools).size === spec.tools.length)) {
      red('invalid-value', 'tools', `non-empty unique subset of ${TOOL_MENU.join('|')}`);
    } else {
      for (const t of spec.tools.filter((/** @type {string} */ t) => LOCKED_TOOLS.includes(t))) {
        // `lib: 'bare-agent'`: a locked TOOL verb is demand against the
        // worker-surface package that would have to expose it (the original case)
        reds.push({ code: 'request-red', path: 'tools', verb: t, lib: 'bare-agent', detail: `"${t}" is locked-but-listed — this red IS the admission evidence, never a grant; granted menu: ${TOOL_MENU.join('|')}` });
      }
      const unknown = spec.tools.filter((/** @type {string} */ t) => !TOOL_MENU.includes(t) && !LOCKED_TOOLS.includes(t));
      if (unknown.length) red('invalid-value', 'tools', `unknown tool(s) ${unknown.join(', ')} — menu: ${TOOL_MENU.join('|')}`);
      // a plan-shape ceiling must grant ≥1 READ-capable verb (review #8): the
      // scout surveys read-only (the write-class verbs are filtered out of its
      // menu), so a write-only ceiling hands the scout an EMPTY menu and it
      // surveys blind — a degradation the validator catches at sign time.
      else if (!spec.tools.some((/** @type {string} */ t) => TOOL_MENU.includes(t) && !WRITE_VERBS.includes(t) && !STORE_VERBS.includes(t))) {
        red('invalid-value', 'tools', 'a plan-shape ceiling must grant ≥1 read-capable verb — the scout surveys read-only; write-class and store-class verbs leave it blind');
      }
    }
  }
}

/**
 * Canonical JSON — recursive key sort, so the hash binds to CONTENT, not to
 * the accident of key order a drafting UX or an editor produced.
 * @param {any} v
 * @returns {string}
 */
function canon(v) {
  // Follow JSON.stringify semantics — the hash must equal the hash of the
  // disk round-trip, or an approval minted in memory fails after save/reload
  // (human-signs-always rejecting an unedited spec). That means honoring toJSON
  // (a Date serializes to its ISO string, not walked as {}) and dropping
  // undefined-valued keys, both of which JSON.stringify does. One divergence:
  // a function/symbol-VALUED key canonizes as null where stringify drops it —
  // reachable only on non-JSON specs, where a round-trip mismatch is correct.
  if (v !== null && typeof v === 'object' && typeof (/** @type {any} */ (v).toJSON) === 'function') {
    return canon(/** @type {any} */ (v).toJSON());
  }
  if (Array.isArray(v)) return `[${v.map((x) => (x === undefined ? 'null' : canon(x))).join(',')}]`;
  if (isObj(v)) {
    const obj = /** @type {Record<string, any>} */ (v);
    return `{${Object.keys(obj).sort().filter((k) => obj[k] !== undefined).map((k) => `${JSON.stringify(k)}:${canon(obj[k])}`).join(',')}}`;
  }
  const s = JSON.stringify(v);
  return s === undefined ? 'null' : s; // undefined/function/symbol leaf: not JSON-representable — 'null', never throw
}

/**
 * The spec as the RUNTIME reads it — the form both hash paths canonize (MED-1).
 * `tools` is optional and its absence means the whole TOOL_MENU: plan.js and
 * planrun.js resolve it with this exact predicate, so an omitted-`tools` spec's
 * ceiling GROWS whenever the menu does while its bytes never move. Hashing the
 * unresolved form leaves that widening unsigned; hashing the resolved form pins
 * WHICH menu was signed, so a menu change flips the hash into the existing
 * refuse-until-reapproved machinery. A spec that named its own ceiling is
 * untouched — no migration for a signature already in flight.
 * @param {any} job
 * @returns {any}
 */
function resolveSpec(job) {
  if (!isObj(job) || Array.isArray(job.tools)) return job;
  return { ...job, tools: [...TOOL_MENU] };
}

/**
 * Content hash of a job spec — what an approval record binds to. Any SEMANTIC
 * edit changes the hash, so a spec whose meaning moved is unapproved by
 * construction (interview decision #1: human signs, always, once per spec
 * VERSION). Not every BYTE edit: the hash is taken over the RESOLVED spec
 * (resolveSpec), so writing today's full TOOL_MENU into a spec that omitted
 * `tools` is hash-neutral — the two spell the same ceiling, and that identity
 * is the point of MED-1, since it is what pins WHICH menu the signature covers.
 * The direction that matters still bites: the menu itself changing (or the
 * explicit list changing) moves the resolved form, and the hash with it.
 * @param {object} job
 * @returns {string} sha256 hex
 */
export function jobSpecHash(job) {
  // NEVER throws: the N2 runner mints {specHash, signer, ts} by calling this
  // directly on the raw job object, so a non-JSON value (BigInt, a cycle, a
  // throwing getter) must yield a hash, not crash the signer. canon handles
  // JSON-representable inputs; the guard covers cycles and hostile getters.
  // resolveSpec sits INSIDE the guard: it spreads, and a spread runs getters.
  let c;
  try { c = canon(resolveSpec(job)); } catch { c = '\u0000unhashable'; }
  return createHash('sha256').update(c).digest('hex');
}

/**
 * The fields a "Reuse workflow" run may change: where the work lands (the write fence, `writeScope`, and a
 * `destination`/`source` where a spec ever carries them), the `inputs` the person pointed at (P7: Inputs is open on a reuse) and the two ceilings. Everything else in a signed spec is
 * the WORKFLOW — goal, checks, guardrails, close (the worker model is the third kind, {@link WORKFLOW_KEY_IDENTITY_FIELDS}). ONE list, shared by {@link workflowKey} and by the panel's
 * reuse (so what the key ignores is exactly what the person may edit, never two spellings).
 */
export const REUSE_OPEN_SPEC_FIELDS = Object.freeze(['source', 'destination', 'writeScope', 'budgetUsd', 'maxWallMs', 'inputs']);

/**
 * The signed spec's schedule fields: {@link workflowKey} ignores them too, so a scheduled spec keeps the workflow
 * key of the green run it was scheduled from (else Reuse would refuse every scheduled spec). They stay inside
 * {@link jobSpecHash}. Kept apart from {@link REUSE_OPEN_SPEC_FIELDS}, which names the Reuse boxes.
 */
export const SCHEDULE_SPEC_FIELDS = Object.freeze(['trigger']);

/**
 * The worker-identity fields {@link workflowKey} ALSO ignores (hamr 2026-10-04: Model is open on a reuse; the Name
 * chosen in Settings carries its provider and baseUrl with it). They stay inside {@link jobSpecHash}, so what the person
 * signs still covers the model the run will use. Kept apart from {@link REUSE_OPEN_SPEC_FIELDS} on purpose: those are the
 * fields the page's boxes edit directly; these three change together, as one Settings row.
 */
export const WORKFLOW_KEY_IDENTITY_FIELDS = Object.freeze(['provider', 'baseUrl', 'model']);

/**
 * The identity of a WORKFLOW (Reuse workflow, hamr 2026-10-03): sha256 over the signed spec WITHOUT the fields a
 * reuse may change ({@link REUSE_OPEN_SPEC_FIELDS}) and the worker identity ({@link WORKFLOW_KEY_IDENTITY_FIELDS}). Two runs
 * share a workflow key iff they ran the same goal, checks, guardrails and close — whatever source they ran on, wherever they wrote, whatever caps they had.
 * It is NOT a signature: {@link jobSpecHash} (which covers the caps and the fence) stays what the person signs, and
 * a reuse lands on a NEW jobSpecHash with the SAME workflowKey. Same never-throws contract as `jobSpecHash`, and
 * the same resolved-`tools` form, so an omitted-`tools` spec and its spelled-out menu share a key. A soft-green spec keys on its
 * RESOLVED judge identity (an absent `judge` is its worker's), so pinning the default judge never changes the key.
 * @param {object} job
 * @returns {string} sha256 hex
 */
export function workflowKey(job) {
  let c;
  try {
    /** @type {any} */
    const rest = isObj(job) ? { ...job } : job;
    // A RUBRIC job's judge defaults to its own worker. The worker identity is dropped below, so resolve the judge FIRST
    // (the runner's one spelling) and key on that: a spec with no `judge` and the same spec with the judge pinned to
    // its default (what a reuse/schedule signs) are one workflow; an explicitly different judge is another.
    // Deterministic specs have no judge, so their key is untouched. An unresolvable judge leaves the spec as signed.
    if (isObj(rest) && rest.verdictType === 'soft-green') {
      try { rest.judge = resolveJobJudge(/** @type {any} */ (rest), /** @type {any} */ (rest.provider), resolveWorkerModel); } catch { /* validateJob reds it */ }
    }
    if (isObj(rest)) for (const f of [...REUSE_OPEN_SPEC_FIELDS, ...WORKFLOW_KEY_IDENTITY_FIELDS, ...SCHEDULE_SPEC_FIELDS]) delete rest[f];
    c = canon(resolveSpec(rest));
  } catch { c = '\u0000unhashable'; }
  return createHash('sha256').update(`workflow-key-v1\n${c}`).digest('hex');
}

/**
 * Does an approval record cover this exact spec version? Pure predicate — the
 * N2 runner refuses to run without it; nothing here writes or prompts. The
 * approval record lives OUTSIDE the document it signs (a spec never contains
 * its own signature) and is shell/human territory, never agent-writable.
 * @param {object} job
 * @param {unknown} approvals array of { specHash, signer, ts } records
 * @returns {boolean}
 */
export function checkApproval(job, approvals) {
  if (!Array.isArray(approvals)) return false;
  // NOT jobSpecHash: its un-hashable sentinel would make every un-hashable
  // spec hash-equal — an approval minted for one would authorize any other.
  // Here un-hashable simply means unapproved, full stop. The RESOLVED spec is
  // what gets canonized, same as the signer's (MED-1) — a gate reading a
  // different form than the mint would unapprove every omitted-`tools` spec.
  let c;
  try { c = canon(resolveSpec(job)); } catch { return false; }
  const h = createHash('sha256').update(c).digest('hex');
  return approvals.some((a) => isObj(a) && /** @type {Record<string, unknown>} */ (a).specHash === h);
}

/**
 * Pure decision: which worker model id a run actually uses (build-list #3,
 * hamr's GO 2026-08-30). The signed spec's `model`, if present, is what an
 * operator SIGNED — it wins outright. A `--model` runner flag naming a
 * DIFFERENT id is refused rather than silently overridden (spec wins, a
 * mismatched flag is a mistake worth stopping on, never a silent swap); the
 * same id from both is not a conflict. Extracted from scripts/run-u.mjs so
 * the decision is testable without running the script or touching a provider.
 * @param {{ specModel?: string, flagModel?: string, suppliedModel?: string }} args
 *   `specModel` — `job.model` if the signed spec carries one, else undefined.
 *   `flagModel` — the model id an explicit `--model <tier>` resolved to, else
 *   undefined (a flag that was never passed, not merely a default tier name).
 *   `suppliedModel` — a model the CALLER supplies when neither spec nor flag says (bareloop keeps none of its own).
 * @returns {{ model: string, source: 'spec'|'flag'|'default' }}
 * @throws {Error} when the spec names a model and the flag names a different one, or when no model is named at all
 */
export function resolveWorkerModel({ specModel, flagModel, suppliedModel }) {
  if (specModel !== undefined) {
    if (flagModel !== undefined && flagModel !== specModel) {
      throw new Error(`spec names model "${specModel}" but --model resolved to "${flagModel}" — the signed spec wins; a mismatched --model flag is refused, never silently overridden. Drop --model or point it at the same model.`);
    }
    return { model: specModel, source: 'spec' };
  }
  if (flagModel !== undefined) return { model: flagModel, source: 'flag' };
  if (suppliedModel === undefined) throw new Error('no model is named — a job carries its own model, or the run is given --model <id> (one ticked in Settings > Providers with both prices)');
  return { model: suppliedModel, source: 'default' };
}
