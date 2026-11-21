// borrowed-from: bareloop src/kinds.js@v0.61.0 (fc56e1f3)
// THE KIND EXECUTOR — close-authoring v1, module M1 (design record
// 2026-08-07, gate-1 Result 3; gate-2 POC closed 2026-08-08).
//
// A close stops being a hand-written script and becomes a DECLARATION over
// kinds whose implementations we own. This module is those implementations.
// The agent never authors a stage body — it parameterises four kinds, and
// anything it could not say here it cannot make the arbiter do (the
// `check-passes(name)` move: illegal is inexpressible, not rejected late).
//
// The four kinds are the small part. The load-bearing part is the THREE
// RUNTIME CONTRACTS every kind inherits — they live HERE, in the executor,
// never in a kind, and no declaration can weaken them:
//
//   (a) THE INSTRUMENT-STOP CONTRACT. exit 97 with `judged` deliberately
//       WITHHELD — for a timeout, a null exit code, unreadable or
//       unparseable required output, a buffer overrun, a missing seed
//       commit, a region anchor that located nothing, and a `first` term
//       that was never reported. A broken instrument is a CASUALTY, never a
//       red (F45); a close that reports one as a red manufactures fake
//       evidence, and the judged floor (F17) is what makes the difference
//       visible downstream. The sharp edge is the zero-match split: `sum`
//       over nothing is a COUNTED zero (the region was searched), `first`
//       over nothing is UNKNOWN — and unknown is never zero (F6).
//
//   (b) THE GAP OUTPUT CONTRACT. Every line carries the spec's `gapKeep`, a
//       trim is ANNOUNCED with its counts and never silent (F28 — a bound
//       that eats the failure names deletes exactly the mechanical detail
//       that converts, F38/F46), and no culprit is named beyond what the
//       instrument itself reported.
//
//   (c) THE CHANGED-SET PRIMITIVE. `git diff --name-only <seed>` PLUS
//       untracked files, MINUS two arbiter books. Both exclusions were paid
//       for live: the `gate-audit.jsonl` one red-carded the arbiter's own
//       file mid-run (u-msdonzxl) and burned a run to the wall. No user
//       could know to exclude them, which is why they sit below the stage
//       level in a shared primitive rather than in anyone's parameters.
//
// D12 rides on top of (a): the close stores the COUNTING RULE, never the
// number. `baseline: "seed"` is MEASURED at this run's own seed every run —
// in a detached worktree, or in place when the tree is verifiably identical
// to the seed — and WHICH route was taken is recorded (`baselineSource`),
// never silent. A frozen constant would judge run 5 against run 1's tree.
//
// Two deliberate divergences from the gate-2 POC executor, both for shipped
// reasons (this module is a graduation — a rewrite, never a copy):
//   - it is ASYNC. `spawnSync` blocks the host event loop for the child's
//     whole duration (F68 measured 9 loop freezes in one green run, worst
//     74.3s), which is precisely when the stall fuse's timers cannot fire.
//     Only the WAIT is async; every observable semantic is spawnSync's.
//   - seed worktrees live in a caller-scoped holder under the OS temp dir
//     and are removed, never in a module-global cache inside the package.
//
// Secrets: this module does NOT scrub. A stage's output is redacted by the
// CALLER at the emission boundary, through the one `SECRET_PATTERNS`
// inventory, before anything reaches the append-only spine — the same split
// `src/exits.js` documents. The env handed to the child IS blinded here,
// because a stage runs worker-authored code (`npm test`, `pytest`) and the
// operator's credentials have no business in it: `CLOSE_ENV_DENY` is
// imported from the arbiter's shell, never re-spelled — two inventories are
// two instruments.

import { spawn } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { readFile, stat, lstat, mkdtemp, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep, dirname } from 'node:path';
import { globToPrefix, isNonEmptyString } from './validate.js';
import { CLOSE_ENV_DENY } from './ralph.js';
import { gradeStep, stepFileRel, STEP_MAX_BYTES, citedLabels, sha256Of } from './rubricstep.js';
import { readStageSheets } from './sheetrun.js';
import { rowResultsOf } from './rowresults.js';

/** the close's two judgment exits — a stage's verdict, in the shape the
 * hand-written closes already spoke (exit code is truth) */
export const EXIT_GREEN = 0;
export const EXIT_RED = 1;
/** contract (a): the instrument-stop exit. `judged` is withheld with it. */
export const EXIT_STOP = 97;
/** The judgment-rendered marker a rendered close prints, for ralph's
 * `runClose` judged floor (src/ralph.js). It rides EVERY real judgment, green or red,
 * and NEVER a stop — this module reports the same fact as the boolean
 * `judged`; the marker exists so a renderer and the floor agree on one
 * spelling. */
export const JUDGED_MARKER = 'judged=1';

/** contract (b): the per-stage gap ceiling. Trims are announced, never silent. */
export const GAP_LINE_CAP = 40;
/**
 * The exact phrase this executor's trim announcement carries. Exported for the
 * same reason ralph exports `GAP_KEEP_TRIM_MARKER`: Layer R's detector must be
 * able to see that a gap window was TRIMMED, because failures beyond the window
 * can move while the visible lines stay identical — and an undetected trim makes
 * the detector claim "reds unchanged" off an instrument that was blind (F43,
 * finding 5). A magic string on the reading side would drift the day this
 * wording changes; the renderer below is its only other use.
 */
export const GAP_TRIM_MARKER = 'gap trimmed:';
/** used when neither the stage nor the ctx names a bound. A stage that could
 * run forever is not a red — it is a stop, and something must decide when. */
export const DEFAULT_TIMEOUT_MS = 300_000;
/** PER STREAM, like the arbiter's own close runner. An overrun truncates the
 * output mid-summary, so any number read out of it is unknown, not zero. */
export const MAX_BUFFER = 16 * 1024 * 1024;
/** an untracked file larger than this is not scanned line-by-line; the skip
 * is ANNOUNCED in the gap rather than passing as a clean scan */
export const MAX_SCAN_BYTES = 2 * 1024 * 1024;
/** ceiling on a parser's term list — a runaway parser is a red, not a bill */
export const MAX_TERMS = 8;

/**
 * WHICH KIND of instrument stop, in the ARBITER's own four-row vocabulary
 * (`CLOSE_FAULTS`, src/ralph.js). Stamped at the site that OBSERVES the fault —
 * never sniffed out of the stop's prose downstream (the typed-attribution rule:
 * a `lib`/fault field is stamped at the throw site, and prose is a fallback for
 * pre-typed spines only).
 *
 * The rows are kept apart for the reason `CLOSE_FAULTS` keeps them apart: they
 * are DIFFERENT HUMAN DECISIONS. "raise the close timeout", "fix the argv" and
 * "re-run, it was OOM-killed" are three answers, and a declared close that
 * pooled all three into `failed` would hand every one of them the same option
 * list. `failed` is the default because "the close cannot run" is the safe
 * reading of a fault nothing else claimed.
 */
export const STOP_FAULTS = Object.freeze({
  /** the stage cannot RUN at all: spawn failure, a missing seed commit, git refusing */
  FAILED: 'failed',
  /** it ran and never finished judging */
  TIMED_OUT: 'timed-out',
  /** it died by signal — no opinion was ever rendered */
  KILLED: 'killed',
  /** it ran, came back, and judged nothing: unreadable output, a blown buffer,
   * a number that was never reported, a parser that does not normalise */
  CRASHED: 'crashed',
});

export const AGGREGATES = Object.freeze(['first', 'sum']);
export const SIGNS = Object.freeze([1, -1]);
/** every kind this executor implements. It is asserted EQUAL to the catalogue's
 * own live half by the suite, both directions: a kind the catalogue offers and
 * this executor cannot run is a close that stops at runtime, and a kind this
 * executor runs that the catalogue never names is a capability nothing can
 * reach. */
export const LIVE_KINDS = Object.freeze(['command-exit', 'count-not-worse', 'pattern-absent-in-diff', 'files-changed', 'human-confirms', 'rubric-step']);
/** RULING 8 — the stages the seed-verdict read (D12) must NOT run: a person at seed is an interview, not a measurement; their bar comes from the person
 * themselves (hitl), never from the seed. The skip is RECORDED by name rather than taken in silence (F59: absent is not empty), so `seedRead` still returns
 * one row per declared stage. */
export const SEED_EXEMPT_KINDS = Object.freeze(['human-confirms']);
/** the one kind a PERSON renders — named once, because the runner keys three
 * decisions on it (is there a door to answer, which stage paused, whose ruling
 * this is) and three literals is how they come to disagree */
export const HUMAN_KIND = 'human-confirms';
/** the three doors the signer is offered at a hitl pause (2026-08-12 §1, doors
 * re-cut 2026-08-17). No fourth door, and no free-text-only variant: a red that
 * is not one of these two is not a ruling the run can act on.
 *
 * `cancel` was the third door and is DELETED as a concept (hamr: *"what's the
 * point of cancel anyways? pause can resume — that would be more honest"*). The
 * case it served — a person who looks and does not want to carry on — is a pause
 * nobody returns to, which the 60-day checkpoint TTL retires on its own. Nothing
 * here forces a forever-decision at the one moment the person has least reason
 * to make one. */
export const HUMAN_DECISIONS = Object.freeze(['accept', 'rerun', 'pause']);

// ── THE REVIEW DOOR's vocabulary (softgreen module 8, PRD v1.71 §3) ──────────
//
// The pause machinery re-homed: the same three doors, one level out — from a
// stage INSIDE the close to the door at the END of a run. The vocabulary lives
// here, beside the doors themselves, because `src/planrun.js` needs it to OPEN a
// door and `src/reviewdoor.js` needs it to ANSWER one, and a constant imported
// through the answering module would drag the registry (and `runJob` behind it)
// into the run's own import graph.

/** the door's record type on the spine. It is a DISPOSITION, never a verdict:
 * hamr's law, verbatim — *"it's important not to change the loop self verdict"*.
 * The close mints the verdict before this is written, and nothing downstream of
 * this record may change what the ledger recorded. */
export const REVIEW_DOOR = 'review-door';

/** the terminals a door opens on: the verdict-bearing ones, and only those. A red,
 * a casualty and a governance halt are not offered to a person as merchandise —
 * they are already decision-ready in their own right, with their own levers. */
export const DOOR_OPEN_OUTCOMES = Object.freeze(['green', 'already-green']);

/** the classes whose door opens WITHOUT being asked for. Soft-green is here
 * because the judge is young: its green is quarantined at mint (module 6) and a
 * person's `accept` is the only thing that releases the credit, so a run that
 * never offered the door would hold its own credit forever.
 *
 * `green` is deliberately ABSENT, and that is the one operator-facing default in
 * this module: a green-class run behaves exactly as it always has unless the
 * runner asks for the door (`reviewDoor: true`, `--review-door`). PRD v1.71 §3
 * says *"the door at the end of EVERY run"* and also that a green door is
 * NON-BLOCKING, and the two readings differ only in whether an unasked-for door
 * appears on an existing job's spine. Flipping it is one line — adding `'green'`
 * here — and it is hamr's to flip, not this module's to assume. A constant, never
 * a threshold; widening it is arbiter territory. */
export const REVIEW_DOOR_CLASSES = Object.freeze(['soft-green']);

/**
 * Does this run end at a review door? The operator's flag WINS in both
 * directions and is never inferred: `true` opens it for any class, `false` shuts
 * it for any class, and `null`/absent is the class default above.
 * @param {any} job the signed spec (its `verdictType` is the class)
 * @param {boolean|null} [reviewDoor] the operator's explicit choice, or null
 * @returns {boolean}
 */
export function doorOpens(job, reviewDoor = null) {
  if (reviewDoor === true) return true;
  if (reviewDoor === false) return false;
  return REVIEW_DOOR_CLASSES.includes(job?.verdictType ?? 'green');
}

/**
 * The stages an `accept` re-runs: the MECHANICAL ones, and never a judged floor
 * or a person (`SEED_EXEMPT_KINDS`, ruling 8's set, for the same reason it was
 * drawn — a machine may re-prove a machine's reading, and may not re-prove a
 * judgment). hamr's N4 ruling: an accept re-runs the mechanical stages, because a
 * door lives 60 days and nothing freezes a tree.
 * @param {any[]|null|undefined} stages
 * @returns {any[]}
 */
export function mechanicalStages(stages) {
  return (Array.isArray(stages) ? stages : []).filter((s) => !SEED_EXEMPT_KINDS.includes(s?.kind));
}

/**
 * @typedef {{code: string, path: string, detail: string}} Red
 * @typedef {{workdir: string, seedRef: string, gapKeep: string,
 *   timeoutMsDefault?: number, baselineMode?: 'auto'|'worktree',
 *   gapCap?: number, maxBuffer?: number, seedTrees?: SeedTrees,
 *   humanRuling?: {decision: string, text?: string|null}|null,
 *   onRubricEvidence?: (e: {step: number, evidence: any[], evidenceTotal?: number}) => void,
 *   list?: any[]|null,
 *   onStage?: (row: {stage: string|null, kind: string|null, verdict: string, durationMs: number}) => void}} Ctx
 *   The arbiter's half of a stage run. Every field here is operator/runner
 *   territory: a declaration parameterises kinds, never the contracts.
 *   `humanRuling` is the SIGNER's answer at a hitl pause, carried in from the
 *   runner — never authored, never defaulted, and absent on every ordinary run.
 *   `onStage` is a REPORTING seam and nothing else: the seed read spawns a real
 *   toolchain per stage (a suite is the slow one) and a whole read is one opaque
 *   await, so the shell gets told as each stage lands. It decides nothing, it is
 *   never consulted, and no verdict depends on it — the house pattern is
 *   `runJob`'s `emit` (the library reports, the shell prints).
 * @typedef {{verdict: 'green'|'red'|'instrument-stop'|'not-reached'|'pause'|'skipped',
 *   exitCode: number|null, value: number|null, baseline: number|null,
 *   baselineSource: string|null, gapLines: string[], judged: boolean,
 *   stage: string|null, kind: string|null, detail: Record<string, any>}} StageResult
 *   Six outcomes, and only two of them are verdicts. `pause` is N4's fifth: the
 *   close reached a stage a machine cannot render and is WAITING on a person —
 *   neither green nor red, and never graded (the F17 forbidden-zone rule applied
 *   to a non-verdict). `skipped` is the sixth and says a stage was deliberately
 *   not run at THIS reading (ruling 8's seed exemption), which is a different
 *   fact from `not-reached` (an earlier stage decided first).
 * @typedef {{ensure: (workdir: string, seedRef: string) => Promise<{stop: string, fault: string}|{stop: null, dir: string}>,
 *   cleanup: () => Promise<{ok: boolean, leaked: string[], detail: string|null}>}} SeedTrees
 */

// ── contract (b): the gap ────────────────────────────────────────────────────

/**
 * Gap lines, prefixed and capped, with the trim ANNOUNCED. Embedded newlines
 * are split so one pushed blob cannot smuggle past the line cap.
 */
class Gap {
  /** @param {string} keep @param {number} [cap] */
  constructor(keep, cap = GAP_LINE_CAP) {
    this.keep = keep;
    this.cap = cap > 0 ? cap : GAP_LINE_CAP;
    /** @type {string[]} */
    this.lines = [];
  }

  /** @param {string} line */
  push(line) {
    for (const part of String(line).split('\n')) this.lines.push(part);
    return this;
  }

  /** @returns {string[]} */
  render() {
    const p = (/** @type {string} */ l) => `${this.keep}${l}`;
    if (this.lines.length <= this.cap) return this.lines.map(p);
    const kept = this.lines.slice(0, this.cap - 1);
    const withheld = this.lines.length - kept.length;
    return [...kept.map(p), p(`[${GAP_TRIM_MARKER} ${withheld} of ${this.lines.length} lines withheld — the cap is ${this.cap}]`)];
  }
}

// ── the child process: only the WAIT is async (F68) ──────────────────────────

/**
 * The environment a stage's child receives. Two strips, both deliberate:
 *
 *  - `NODE_TEST_CONTEXT`: inherited from a host test runner, a `node --test`
 *    stage silently no-ops — a confident fake green.
 *  - `CLOSE_ENV_DENY` (imported, never re-spelled): a stage runs
 *    worker-authored code, and none of git/tsc/mypy/pytest needs the
 *    operator's provider key to judge a tree.
 *
 * A DECLARED env var whose name is on the deny list is dropped too — the
 * declaration is authored, and an authored close must not be able to hand
 * worker code a credential — and the drop is ANNOUNCED by name (never the
 * value) rather than applied silently.
 * @param {Record<string, string>} [declared]
 * @returns {{env: NodeJS.ProcessEnv, dropped: string[]}}
 */
function stageEnv(declared = {}) {
  const denied = (/** @type {string} */ name) => CLOSE_ENV_DENY.names.includes(name)
    || CLOSE_ENV_DENY.prefixes.some((p) => name.startsWith(p))
    || CLOSE_ENV_DENY.shape.test(name);
  /** @type {NodeJS.ProcessEnv} */
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const name of Object.keys(env)) if (denied(name)) delete env[name];
  // NO_COLOR keeps ANSI escapes out of the text every parser reads. Anything
  // the stage declared rides on top of it and may override it.
  env.NO_COLOR = '1';
  env.FORCE_COLOR = '0';
  /** @type {string[]} */
  const dropped = [];
  for (const [name, value] of Object.entries(declared)) {
    if (denied(name)) { dropped.push(name); continue; }
    env[name] = String(value);
  }
  return { env, dropped };
}

/**
 * Run a command and read its world. Faithful to `spawnSync`'s observable
 * result — the same `{status, signal, stdout, stderr}`, the same per-stream
 * ceiling, SIGTERM at the deadline — but without freezing the host loop
 * (F68). Every fault comes back as a `stop` STRING; nothing throws, because
 * a throw here would have to be caught and turned back into a stop anyway.
 * @param {string} cmd @param {string[]} args
 * @param {{cwd: string, env?: Record<string,string>, timeoutMs?: number, maxBuffer?: number}} o
 * @returns {Promise<{stop: string, fault: string}|{stop: null, code: number, out: string, dropped: string[]}>}
 */
async function sh(cmd, args, { cwd, env: declared = {}, timeoutMs = DEFAULT_TIMEOUT_MS, maxBuffer = MAX_BUFFER }) {
  const { env, dropped } = stageEnv(declared);
  const r = await new Promise((/** @type {(v: {error: (Error & {code?: string})|null, status: number|null, signal: string|null, stdout: string, stderr: string}) => void} */ resolve) => {
    /** @type {import('node:child_process').ChildProcess} */
    let child;
    try {
      child = spawn(cmd, args, { cwd, env });
    } catch (e) {
      resolve({ error: /** @type {any} */ (e), status: null, signal: null, stdout: '', stderr: '' });
      return;
    }
    /** @type {Buffer[]} */ const outChunks = [];
    /** @type {Buffer[]} */ const errChunks = [];
    let outBytes = 0; let errBytes = 0;
    /** @type {(Error & {code?: string})|null} */
    let error = null;
    /** @type {NodeJS.Timeout|undefined} */ let timer;
    /** @type {NodeJS.Timeout|undefined} */ let killTimer;
    // FIRST FAULT WINS: a child that blew the buffer and then hit the
    // deadline is one story, not two.
    const fault = (/** @type {string} */ code) => {
      if (error) return;
      error = Object.assign(new Error(`spawn ${cmd} ${code}`), { code });
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone */ } }, 2000);
      killTimer.unref();
    };
    child.stdout?.on('data', (/** @type {Buffer} */ c) => { outBytes += c.length; outChunks.push(c); if (outBytes > maxBuffer) fault('ENOBUFS'); });
    child.stderr?.on('data', (/** @type {Buffer} */ c) => { errBytes += c.length; errChunks.push(c); if (errBytes > maxBuffer) fault('ENOBUFS'); });
    child.on('error', (e) => { if (!error) error = e; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      // Concat-then-decode, never per chunk: a multi-byte character across a
      // chunk boundary must not become two replacement characters in the text
      // every parser reads.
      resolve({ error, status, signal, stdout: Buffer.concat(outChunks).toString('utf8'), stderr: Buffer.concat(errChunks).toString('utf8') });
    });
    if (typeof timeoutMs === 'number' && timeoutMs > 0 && Number.isFinite(timeoutMs)) timer = setTimeout(() => fault('ETIMEDOUT'), timeoutMs);
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });

  const argv = `${cmd}${args.length ? ` ${args.join(' ')}` : ''}`;
  if (r.error) {
    const code = /** @type {any} */ (r.error).code;
    if (code === 'ETIMEDOUT') return { stop: `INSTRUMENT: "${cmd}" did not finish inside ${timeoutMs}ms`, fault: STOP_FAULTS.TIMED_OUT };
    if (code === 'ENOBUFS') return { stop: `INSTRUMENT: "${cmd}" output exceeded the ${maxBuffer}B ceiling — the output is truncated, so any number read from it is unknown, not zero`, fault: STOP_FAULTS.CRASHED };
    return { stop: `INSTRUMENT: "${argv}" could not be run (${code ?? String(r.error.message)})`, fault: STOP_FAULTS.FAILED };
  }
  if (r.status === null) return { stop: `INSTRUMENT: "${cmd}" returned a null exit code (killed by ${r.signal ?? 'an unknown signal'})`, fault: STOP_FAULTS.KILLED };
  if (typeof r.stdout !== 'string' || typeof r.stderr !== 'string') return { stop: `INSTRUMENT: "${cmd}" produced unreadable output`, fault: STOP_FAULTS.CRASHED };
  return { stop: null, code: r.status, out: `${r.stdout}${r.stderr}`, dropped };
}

/**
 * git, in a repository (reads by every caller in this file; `src/source.js`
 * also uses it for the hidden-git seed's `init`/`add`/`commit`). Faults come
 * back as `ok:false` with the stderr — a caller decides whether that is a
 * stop.
 *
 * Exported (PRD item 33/M2, `src/source.js`) so the hidden-git seed a plain
 * folder/file/URL job runs against goes through the SAME spawn primitive as
 * every other git call in this file — a second `spawn('git', …)` for the
 * source front door would be a second instrument with its own timeout and
 * buffer ceiling to keep in sync with this one.
 * @param {string} cwd @param {string[]} args
 */
export async function git(cwd, args) {
  const r = await sh('git', args, { cwd, timeoutMs: 120_000 });
  // git refusing IS "the close cannot run": the changed-set primitive is not an
  // optional enrichment, so a non-zero git carries FAILED rather than inheriting
  // whatever the spawn layer said about the process itself.
  if (r.stop !== null) return { ok: false, out: '', err: r.stop, code: null, fault: r.fault };
  return { ok: r.code === 0, out: r.out, err: r.out, code: r.code, fault: STOP_FAULTS.FAILED };
}

/**
 * D8's seed, READ rather than typed: HEAD at run start. A close stores the
 * counting rule and never the number (D12), so which commit the run is measured
 * from is a fact about THIS run — recorded and shown, never carried in a signed
 * spec where it would judge run 5 against run 1's tree.
 *
 * A fault is a named `stop`, never a fallback ref: measuring against the wrong
 * baseline is the failure direction that reads as a clean tree.
 * @param {string} workdir
 * @returns {Promise<{stop: string, seedRef: null}|{stop: null, seedRef: string}>}
 */
export async function seedAtHead(workdir) {
  const r = await git(workdir, ['rev-parse', 'HEAD']);
  if (!r.ok) return { stop: `INSTRUMENT: could not read HEAD in ${workdir}: ${String(r.err).trim()}`, seedRef: null };
  const sha = r.out.trim().split('\n')[0].trim();
  if (!/^[0-9a-f]{7,64}$/.test(sha)) {
    return { stop: `INSTRUMENT: git rev-parse HEAD in ${workdir} did not return a commit sha`, seedRef: null };
  }
  return { stop: null, seedRef: sha };
}

/**
 * The files that exist AT THE SEED COMMIT. Deliberately not `ls-files`, which
 * reads the index and the working tree: this listing is what a declared path is
 * judged against, and it must describe the tree the close measures from rather
 * than whatever is lying around today.
 *
 * ONE spelling, here beside the other git reads (`src/authorscout.js`'s
 * `seedFileList` delegates to it) — a second listing command is a second
 * instrument, and the one that grades would be the one nobody validated.
 * @param {string} workdir @param {string} seedRef
 * @returns {Promise<{stop: string, files: null}|{stop: null, files: string[]}>}
 */
export async function seedListing(workdir, seedRef) {
  // `-z`: NUL-separated, names raw. Without it git C-quotes any name with a non-ASCII byte
  // (`"caf\303\251.js"`), so a listing entry would never equal the path on disk (F276 gap c).
  const r = await git(workdir, ['ls-tree', '-r', '-z', '--name-only', seedRef]);
  if (!r.ok) {
    return { stop: `INSTRUMENT: git ls-tree -r ${seedRef} failed in ${workdir}: ${String(r.err).trim()}`, files: null };
  }
  return { stop: null, files: r.out.split('\0').filter(Boolean) };
}

// ── contract (c): the changed-set primitive ──────────────────────────────────

/**
 * The arbiter books, and the shape of each exclusion is the whole point.
 *
 * `.litectx/` and `.smoke/` are PREFIXES — everything beneath either store
 * belongs to the arbiter. `gate-audit.jsonl` is an EXACT repo-relative path and
 * never a basename or a pattern: the gate audit is written to
 * `join(workdir, 'gate-audit.jsonl')` and nowhere else, so a worker-authored
 * `src/gate-audit.jsonl` is NOT an arbiter book and must still count as work.
 * Matching by basename would swallow it — and swallowing a worker's real
 * write is the failure direction that reads as a clean tree. `src/smoke.js` and
 * `tests/smoke.test.js` are that same decoy for the store below.
 *
 * `.smoke/` — F98's parked residual, closed here. The fence has always denied
 * `join(workdir, '.smoke')` on every worker (src/planrun.js, src/authorscout.js)
 * and the persona now states the rule; this reader, which decides what COUNTS AS
 * WORK, was the one place that never knew the name. On patients whose .gitignore
 * default-denies dot-directories the store never reaches `ls-files --others` and
 * the gap is masked — by the PATIENT's config, not by anything here. Incidental
 * masking is not an exclusion: on a patient without that line the arbiter's own
 * store would enter the changed set as the worker's writing.
 * @param {string} rel a repo-relative POSIX path
 * @returns {string|null} the book it belongs to, or null
 */
export function isArbiterBook(rel) {
  for (const store of ARBITER_BOOK_STORES) {
    if (rel === store || rel.startsWith(`${store}/`)) return `${store}/`;
  }
  if (rel === GATE_AUDIT_FILE) return GATE_AUDIT_FILE;
  return null;
}

/**
 * The arbiter's book NAMES, one home. F98's mechanism was exactly this list
 * living as independent literals: the fence deny arrays (src/planrun.js,
 * src/authorscout.js) knew `.smoke` while `isArbiterBook` — the reader that
 * decides what COUNTS AS WORK — did not, and the drift was masked by the
 * patient's own .gitignore. Every consumer (the fence deny lists, this file's
 * reader, the persona's stated law, run.js's smoke-store root) now spells the
 * names from here, so adding or renaming a book is one edit that cannot leave
 * a site behind.
 *
 * `ARBITER_BOOK_STORES` are directory PREFIXES; `GATE_AUDIT_FILE` is an EXACT
 * repo-relative path (see `isArbiterBook`'s docstring for why never a
 * basename). Order is the fence deny-list order and the persona's prose order.
 */
export const SMOKE_STORE = '.smoke';
export const LITECTX_STORE = '.litectx';
export const GATE_AUDIT_FILE = 'gate-audit.jsonl';
export const ARBITER_BOOK_STORES = Object.freeze([SMOKE_STORE, LITECTX_STORE]);

/**
 * Everything this run changed against the seed: the tracked diff PLUS
 * untracked files (an untracked file has no diff — the case a naive
 * `git diff` scan silently misses), minus the arbiter's own books.
 * @param {string} workdir @param {string} seedRef
 * @returns {Promise<{stop: string, fault: string}|{stop: null, paths: string[], tracked: string[], untracked: string[], excluded: {path: string, book: string}[]}>}
 */
export async function changedSet(workdir, seedRef) {
  const verify = await git(workdir, ['rev-parse', '--verify', `${seedRef}^{commit}`]);
  if (!verify.ok) return { stop: `INSTRUMENT: the seed commit "${seedRef}" does not exist in ${workdir}`, fault: STOP_FAULTS.FAILED };
  const d = await git(workdir, ['diff', '--name-only', seedRef]);
  if (!d.ok) return { stop: `INSTRUMENT: git diff against "${seedRef}" failed: ${String(d.err).trim()}`, fault: d.fault };
  const u = await git(workdir, ['ls-files', '--others', '--exclude-standard']);
  if (!u.ok) return { stop: `INSTRUMENT: git ls-files --others failed: ${String(u.err).trim()}`, fault: u.fault };
  const split = (/** @type {string} */ s) => s.split('\n').map((x) => x.trim()).filter(Boolean);
  /** @type {{path: string, book: string}[]} */
  const excluded = [];
  const keep = (/** @type {string[]} */ list) => list.filter((p) => {
    const book = isArbiterBook(p);
    if (book) { excluded.push({ path: p, book }); return false; }
    return true;
  });
  const tracked = keep(split(d.out));
  const untracked = keep(split(u.out));
  return { stop: null, tracked, untracked, excluded, paths: [...new Set([...tracked, ...untracked])].sort() };
}

/**
 * The lines this run ADDED to one file. A tracked file's additions come from
 * its own unified diff; an UNTRACKED file has no diff at all, so its ENTIRE
 * body is added — the half of this primitive a diff-only scan misses.
 * @param {string} workdir @param {string} seedRef @param {string} rel
 * @param {{untracked?: boolean}} [o]
 * @returns {Promise<{stop: string, fault: string}|{stop: null, lines: {n: number, text: string}[], note: string|null}>}
 */
export async function addedLines(workdir, seedRef, rel, { untracked = false } = {}) {
  if (untracked) {
    const abs = join(workdir, rel);
    let st;
    // NOT a stop: a dangling symlink or a file that vanished between the
    // changed-set read and this one has no content to hide, so refusing to grade
    // the run over it would be the wrong direction. But it is not SCANNED either,
    // and every sibling branch below (the cap, the binary check) says so out
    // loud — returning note:null here made an unscannable file read as clean.
    try { st = await stat(abs); } catch (e) {
      const code = String(/** @type {any} */ (e)?.code ?? /** @type {any} */ (e)?.message ?? e);
      return { stop: null, lines: [], note: `${rel}: could not stat (${code}) — NOT scanned` };
    }
    if (!st.isFile()) return { stop: null, lines: [], note: null };
    if (st.size > MAX_SCAN_BYTES) return { stop: null, lines: [], note: `${rel}: ${st.size}B exceeds the ${MAX_SCAN_BYTES}B scan cap — NOT scanned` };
    let buf;
    try { buf = await readFile(abs); } catch (e) { return { stop: `INSTRUMENT: ${rel} could not be read: ${String(/** @type {any} */ (e)?.message ?? e)}`, fault: STOP_FAULTS.CRASHED }; }
    if (buf.includes(0)) return { stop: null, lines: [], note: `${rel}: binary — NOT scanned` };
    return { stop: null, lines: buf.toString('utf8').split('\n').map((text, i) => ({ n: i + 1, text })), note: null };
  }
  const d = await git(workdir, ['diff', '-U0', '--no-color', seedRef, '--', rel]);
  // `ok` IS `code === 0` (see `git`), and a spawn fault comes back `code: null`,
  // so a second `code !== 0` clause was a tautology reading as a live guard.
  if (!d.ok) return { stop: `INSTRUMENT: git diff -U0 for ${rel} failed: ${String(d.err).trim()}`, fault: d.fault };
  /** @type {{n: number, text: string}[]} */
  const lines = [];
  let n = 0;
  // The `+++`/`---` skip is scoped to the PREAMBLE, and the scope is the fix for a
  // real fake-green: git renders an ADDED line whose own text begins with `++` as
  // `+++i;`, so a header test applied inside a hunk swallowed it and the guard read
  // GREEN over a line it never opened. File headers only ever appear before the
  // first `@@`, so `inHunk` says exactly where a header can legally be — the guard's
  // dangerous direction, closed by construction rather than by a sharper pattern.
  let inHunk = false;
  for (const raw of d.out.split('\n')) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk) { n = Number(hunk[1]); inHunk = true; continue; }
    if (!inHunk && (raw.startsWith('+++') || raw.startsWith('---'))) continue;
    if (raw.startsWith('+')) { lines.push({ n, text: raw.slice(1) }); n += 1; }
  }
  return { stop: null, lines, note: null };
}

// ── scope: one prefix spelling, the shipped one ──────────────────────────────

/** normalise a declared prefix through the SHIPPED spelling, never a second
 * one — `globToPrefix`'s collapse order is fence territory (F9). */
const normPrefix = (/** @type {string} */ p) => globToPrefix(String(p)).replace(/^\.\//, '');

/** @param {string} rel @param {string} prefix */
function underPrefix(rel, prefix) {
  const pre = normPrefix(prefix);
  if (pre === '' || pre === '.' || pre === '/') return true;
  const p = pre.endsWith('/') ? pre : `${pre}/`;
  return rel === pre.replace(/\/$/, '') || rel.startsWith(p);
}

/**
 * Physical identity, for when two SPELLINGS name one file. A live aurora run
 * measured the cost of not having this: the patient's layout carries a tracked
 * `src/aurora_spawner -> ../packages/spawner/src/aurora_spawner` symlink (the
 * ordinary python monorepo shape), mypy printed every error as
 * `src/aurora_spawner/...`, the declared scope said
 * `packages/spawner/src/aurora_spawner/`, and a lexical matcher dropped all 16
 * REAL error lines — 0 against a baseline of 0 is a fake green, and only the
 * crash-stop caught it.
 *
 * `fs.realpathSync` and nothing else: lexical `..` resolution (and
 * `path.posix.normalize`, which does it silently) HIDES escapes, which is why
 * `globToPrefix` refuses to do it. The kernel's answer cannot be spoofed.
 * Resolution failure is not an answer — the caller falls back to the lexical
 * reading, so a path that is not in the measured tree can never GAIN scope
 * membership it did not already have.
 * @param {string} workdir
 * @returns {{real: (rel: string) => string|null}|null} null when the measuring
 *   directory itself cannot be resolved — then there is no physical reading at all
 */
function physicalIn(workdir) {
  if (!workdir) return null;
  /** one realpath per distinct path per stage/parse call — a tool names the same
   * file on many lines, and the scope filter reads every one of them */
  const cache = new Map();
  const real = (/** @type {string} */ abs) => {
    if (cache.has(abs)) return /** @type {string|null} */ (cache.get(abs));
    /** @type {string|null} */
    let r = null;
    try { r = realpathSync(abs); } catch { r = null; }
    cache.set(abs, r);
    return r;
  };
  const root = real(workdir);
  if (root === null) return null;
  return { real: (/** @type {string} */ rel) => real(join(root, rel)) };
}

/**
 * Is `rel` the same PHYSICAL file as something under `prefix`? Both sides are
 * resolved, so a symlinked report matches a physical prefix AND a physical
 * report matches a symlinked prefix. Containment is checked on two realpaths,
 * where a segment-prefix test means what it says — no symlink can sit inside
 * either spelling any more, so this cannot widen scope to an escape: a file
 * only matches when the prefix PHYSICALLY contains it.
 * @param {string} rel @param {string} prefix
 * @param {{real: (rel: string) => string|null}} phys
 */
function underPrefixPhysically(rel, prefix, phys) {
  const pre = normPrefix(prefix).replace(/\/+$/, '');
  // '' / '.' / '/' already answered TRUE lexically, and an absolute prefix
  // matches nothing lexically (linePath never returns one) — resolving either
  // against the workdir would invent a membership the declaration never made
  if (pre === '' || pre === '.' || pre.startsWith('/')) return false;
  const preAbs = phys.real(pre);
  if (preAbs === null) return false;
  const fileAbs = phys.real(rel);
  if (fileAbs === null) return false;
  return fileAbs === preAbs || fileAbs.startsWith(preAbs.endsWith(sep) ? preAbs : `${preAbs}${sep}`);
}

/**
 * The fence's ONE containment reading, shared by every site that has one.
 * Lexical FIRST and physical only on a miss: every spelling that matched
 * before still matches, so resolution can only ever unify two names for one
 * file — it never takes membership away, and it never reaches past a prefix
 * that does not physically contain the file.
 *
 * Without a resolver (`phys === null`) this IS the old lexical fence, byte for
 * byte.
 * @param {string} rel @param {string} prefix
 * @param {{real: (rel: string) => string|null}|null} phys
 */
function underPrefixEither(rel, prefix, phys) {
  return underPrefix(rel, prefix) || (phys !== null && underPrefixPhysically(rel, prefix, phys));
}

/** @param {string} rel @param {any} scope
 * @param {{real: (rel: string) => string|null}|null} [phys] physical resolver;
 *   absent leaves the comparison purely lexical */
function inScope(rel, scope, phys = null) {
  if (!scope || typeof scope !== 'object') return true;
  const inc = Array.isArray(scope.includePrefixes) ? scope.includePrefixes : null;
  const exc = Array.isArray(scope.excludePrefixes) ? scope.excludePrefixes : null;
  const under = (/** @type {string} */ p) => underPrefixEither(rel, p, phys);
  if (inc && !inc.some(under)) return false;
  // exclusion resolves too: a symlink spelling must not smuggle a file past an
  // exclude the physical spelling would have caught
  if (exc && exc.some(under)) return false;
  return true;
}

/** does this declared scope actually filter anything? — one spelling of the
 * question, so no caller can decide it differently from another
 * @param {any} scope */
const scopeFilters = (scope) => !!scope && (Array.isArray(scope.includePrefixes) || Array.isArray(scope.excludePrefixes));

/**
 * The first repository-relative path a tool named on a line, or null. At
 * least one `/` is required, so prose ("Found 3 errors in 2 files") never
 * reads as a path — a false path would silently steer the scope filter.
 * @param {string} line @param {string} workdir
 */
function linePath(line, workdir) {
  const m = /(?:^|[\s"'(\[<])((?:\.\/)?\/?(?:[\w.@+~-]+\/)+[\w.@+~-]+)/.exec(line);
  if (!m) return null;
  let p = m[1].replace(/^\.\//, '');
  const wd = workdir.endsWith(sep) ? workdir : `${workdir}${sep}`;
  if (p.startsWith(wd)) p = p.slice(wd.length);
  else if (p.startsWith('/')) return null; // absolute, outside the patient — attributes to nothing
  return p;
}

// ── the parser: ONE spelling, shared by validator and executor ───────────────

/**
 * Count a pattern's capture groups without running it against real input:
 * `src + '|'` always matches the empty string, so the result array's length
 * names the group count. Also the ONE place a declared regex is compiled at
 * validation time, so a broken pattern reds before any process is spawned.
 * @param {any} src
 * @returns {{count: number, red: string|null}}
 */
export function regexGroups(src) {
  if (typeof src !== 'string' || src === '') return { count: 0, red: 'a regular expression, as a string' };
  try {
    const m = new RegExp(`${src}|`).exec('');
    return { count: (m?.length ?? 1) - 1, red: null };
  } catch (e) {
    return { count: 0, red: `/${src}/ is not a valid regular expression: ${String(/** @type {any} */ (e)?.message ?? e)}` };
  }
}

/**
 * THE normalisation of a `count-not-worse` parser (gate-1 amendment #5).
 * The declaration validator and this executor both call it, so there is
 * exactly one spelling of what a parser MEANS — two normalisers that
 * disagree are two instruments, and the one that grades is the one nobody
 * validated.
 *
 *     value = Σ over terms of  sign × (first | sum of that term's captures,
 *                                      inside that term's region)
 *
 * Backwards compatible by construction: the short form
 * `{lineMatch, capture?}` resolves to exactly one term with
 * `sign +1, aggregate "first", region "whole-output"`, which is the
 * pre-amendment semantics unchanged.
 *
 * Never throws — reds come back in the shipped `{ok, reds, ...}` shape.
 * @param {any} parser @param {string} [at] path prefix for reds
 * @returns {{ok: boolean, reds: Red[], terms: any[]|null}}
 */
export function normalizeParser(parser, at = 'parser') {
  /** @type {Red[]} */
  const reds = [];
  const red = (/** @type {string} */ path, /** @type {string} */ detail, code = 'invalid-value') => reds.push({ code, path, detail });
  if (parser === null || typeof parser !== 'object' || Array.isArray(parser)) {
    red(at, 'a parser object: {terms:[...]} or the short form {lineMatch, capture?}', 'missing-field');
    return { ok: false, reds, terms: null };
  }
  const hasTerms = Object.hasOwn(parser, 'terms');
  const hasShort = Object.hasOwn(parser, 'lineMatch');
  if (hasTerms && hasShort) {
    red(at, 'a parser declares EITHER terms or the short form lineMatch — never both');
    return { ok: false, reds, terms: null };
  }
  /** @type {any[]} */
  let raw;
  if (hasShort) {
    for (const k of Object.keys(parser)) if (!['lineMatch', 'capture'].includes(k)) red(`${at}.${k}`, 'the short form takes lineMatch and capture only');
    raw = [{ lineMatch: parser.lineMatch, ...(Object.hasOwn(parser, 'capture') ? { capture: parser.capture } : {}), sign: 1, aggregate: 'first', region: 'whole-output' }];
  } else if (hasTerms) {
    for (const k of Object.keys(parser)) if (k !== 'terms') red(`${at}.${k}`, 'the long form takes terms only');
    if (!Array.isArray(parser.terms) || parser.terms.length === 0) {
      red(`${at}.terms`, 'a non-empty array of terms');
      return { ok: false, reds, terms: null };
    }
    if (parser.terms.length > MAX_TERMS) red(`${at}.terms`, `${parser.terms.length} terms exceeds the ceiling of ${MAX_TERMS}`);
    raw = parser.terms;
  } else {
    red(at, 'a parser object: {terms:[...]} or the short form {lineMatch, capture?}', 'missing-field');
    return { ok: false, reds, terms: null };
  }

  /** @type {any[]} */
  const terms = [];
  raw.forEach((t, i) => {
    const p = `${at}${hasShort ? '' : `.terms[${i}]`}`;
    if (t === null || typeof t !== 'object' || Array.isArray(t)) { red(p, 'a term object'); return; }
    for (const k of Object.keys(t)) if (!['lineMatch', 'capture', 'sign', 'aggregate', 'region'].includes(k)) red(`${p}.${k}`, 'a term takes lineMatch, capture, sign, aggregate, region');
    const groups = regexGroups(t.lineMatch);
    if (groups.red) { red(`${p}.lineMatch`, groups.red); return; }
    // capture defaults to group 1; a pattern with NO group tallies 1 per match,
    // which is how a stage COUNTS occurrences instead of reading a printed figure
    const capture = Object.hasOwn(t, 'capture') && t.capture !== null && t.capture !== undefined
      ? t.capture
      : (groups.count === 0 ? null : 1);
    if (capture !== null && !(Number.isInteger(capture) && capture >= 0)) { red(`${p}.capture`, 'a non-negative integer capture-group index'); return; }
    if (capture !== null && capture > groups.count) { red(`${p}.capture`, `group ${capture} does not exist — /${t.lineMatch}/ has ${groups.count} capture group(s)`); return; }
    const sign = Object.hasOwn(t, 'sign') ? t.sign : undefined;
    if (!SIGNS.includes(sign)) { red(`${p}.sign`, `one of ${SIGNS.join(' | ')}`, Object.hasOwn(t, 'sign') ? 'invalid-value' : 'missing-field'); return; }
    const aggregate = Object.hasOwn(t, 'aggregate') ? t.aggregate : undefined;
    if (!AGGREGATES.includes(aggregate)) { red(`${p}.aggregate`, `one of ${AGGREGATES.join(' | ')}`, Object.hasOwn(t, 'aggregate') ? 'invalid-value' : 'missing-field'); return; }
    const rawRegion = Object.hasOwn(t, 'region') ? t.region : undefined;
    /** @type {any} */
    let region;
    if (rawRegion === 'whole-output') region = 'whole-output';
    else if (rawRegion !== null && typeof rawRegion === 'object' && !Array.isArray(rawRegion)) {
      const ag = regexGroups(rawRegion.anchor);
      if (ag.red) { red(`${p}.region.anchor`, ag.red); return; }
      const rc = Object.hasOwn(rawRegion, 'capture') && rawRegion.capture !== null ? rawRegion.capture : 0;
      if (!(Number.isInteger(rc) && rc >= 0)) { red(`${p}.region.capture`, 'a non-negative integer capture-group index (0 = the whole anchor match)'); return; }
      if (rc > ag.count) { red(`${p}.region.capture`, `group ${rc} does not exist — /${rawRegion.anchor}/ has ${ag.count} capture group(s)`); return; }
      for (const k of Object.keys(rawRegion)) if (!['anchor', 'capture'].includes(k)) red(`${p}.region.${k}`, 'a region takes anchor and capture only');
      region = { anchor: rawRegion.anchor, capture: rc };
    } else { red(`${p}.region`, '"whole-output" or {anchor, capture}', Object.hasOwn(t, 'region') ? 'invalid-value' : 'missing-field'); return; }
    terms.push({ lineMatch: t.lineMatch, capture, sign, aggregate, region });
  });

  if (reds.length) return { ok: false, reds, terms: null };
  return { ok: true, reds, terms };
}

/**
 * Read ONE number out of a command's output, as signed arithmetic over
 * normalised terms.
 *
 * The zero-match split is contract (a), not a convenience:
 *   - `sum` over zero matches is a COUNTED zero. The region was searched and
 *     nothing was there; that is legitimately 0.
 *   - `first` over zero matches is UNKNOWN — the number was never reported —
 *     and unknown is an instrument stop, never a defaulted 0 (F6).
 *   - a region whose anchor matches nothing was never LOCATED: stop.
 * The scope filter runs per OUTPUT LINE, before aggregation, and both its
 * drop count and its unattributable count are ANNOUNCED: a line naming no
 * path is KEPT (no filter can exclude what it cannot locate) and the notes
 * say so, rather than the number quietly meaning something else.
 *
 * `preScopeMatches` is reported alongside the reading because a POST-scope
 * count cannot answer "did the tool run at all". It tallies (term, line) pairs
 * that matched BEFORE the filter judged them — kept, unattributable and dropped
 * alike — and it is the only evidence of liveness a caller has once the scope
 * has removed the whole population. It is never the number being read.
 *
 * `matched` is the KEPT lines themselves, PER TERM and index-aligned with
 * `breakdown`: entry i holds, in output order, exactly the lines term i's
 * subtotal was computed FROM. Run u-msn227nq paid for the echo — the executor
 * counted 8 real `error TS…` lines and told the worker "8 match(es)", discarding
 * every address, and a worker with a number and no file to open went looking for
 * the arbiter's own books instead.
 *
 * TWO EXCLUSIONS, both of them "this line is not what the count is made of":
 *  - a scope-DROPPED line is never in here. It was never counted, so aiming the
 *    worker at it would aim it outside its own population.
 *  - under `first`, only the line the aggregate actually READ. The later matches
 *    are real matches (`breakdown[i].matches` still counts them) but the value
 *    never contained them, and echoing them points the worker at a number that
 *    is not in the reading.
 *
 * And the GROUPING is the third: a term's sign lives in `breakdown[i]`, so lines
 * pooled flat across terms lose the one fact that says what they DID to the
 * number. A subtracted term's line rendered beside an added one reads as a wall
 * to go fix, and fixing it moves the count the wrong way. Deduplication is
 * therefore within a term only — one line matched by two terms plays two
 * arithmetic roles and is named under each. The count is computed from `values`,
 * never from this list.
 * @param {string} output @param {any[]} terms normalised terms
 * Every stop here is `crashed` in the arbiter's vocabulary — the command RAN,
 * came back, and the number could not be read out of it. Nothing in this
 * function can observe a spawn failure, a timeout or a signal, so it never
 * claims one.
 * @param {{scope?: any, workdir?: string}} [o]
 * @returns {{stop: string, fault: string, notes?: string[]}|{stop: null, value: number, breakdown: any[], notes: string[], preScopeMatches: number, matched: string[][]}}
 */
export function parseValue(output, terms, { scope = null, workdir = '' } = {}) {
  let value = 0;
  // liveness, tallied before the filter has an opinion — see the note above
  let preScopeMatches = 0;
  /** @type {any[]} */
  const breakdown = [];
  /** @type {string[]} */
  const notes = [];
  // the KEPT lines PER TERM, in output order and deduplicated within the term —
  // see the note above
  /** @type {string[][]} */
  const matched = [];
  const filtering = scopeFilters(scope);
  // one resolver (and one realpath cache) per call, built only when a filter
  // will actually read it
  const phys = filtering ? physicalIn(workdir) : null;

  for (const [i, t] of terms.entries()) {
    // 1. locate the region
    let region = output;
    if (t.region !== 'whole-output') {
      let anchor;
      try { anchor = new RegExp(t.region.anchor, 'm'); } catch (e) { return { stop: `INSTRUMENT: term ${i} region anchor /${t.region.anchor}/ is not a valid regex: ${String(/** @type {any} */ (e)?.message ?? e)}`, fault: STOP_FAULTS.CRASHED }; }
      const m = anchor.exec(output);
      if (!m) return { stop: `INSTRUMENT: term ${i} region anchor /${t.region.anchor}/ matched nothing — the region the number lives in could not be located`, fault: STOP_FAULTS.CRASHED };
      const got = m[t.region.capture];
      if (typeof got !== 'string') return { stop: `INSTRUMENT: term ${i} region anchor matched but capture group ${t.region.capture} did not participate`, fault: STOP_FAULTS.CRASHED };
      region = got;
    }

    // 2. collect matches line by line, so the scope filter can read each
    //    line's own path
    let re;
    try { re = new RegExp(t.lineMatch, 'g'); } catch (e) { return { stop: `INSTRUMENT: term ${i} lineMatch /${t.lineMatch}/ is not a valid regex: ${String(/** @type {any} */ (e)?.message ?? e)}`, fault: STOP_FAULTS.CRASHED }; }
    /** @type {number[]} */
    const values = [];
    /** @type {string[]} */
    const kept = [];
    const seen = new Set();
    let dropped = 0;
    let unattributable = 0;
    for (const line of region.split('\n')) {
      const hits = [...line.matchAll(re)];
      if (!hits.length) continue;
      preScopeMatches += 1;
      if (filtering) {
        const p = linePath(line, workdir);
        if (p === null) unattributable += 1;
        else if (!inScope(p, scope, phys)) { dropped += 1; continue; }
      }
      // past the filter, so this line is a CANDIDATE for the harvest — kept here
      // rather than at aggregation because this is the only place the raw line
      // still exists, and narrowed to what the aggregate actually read below
      if (!seen.has(line)) { seen.add(line); kept.push(line); }
      for (const h of hits) {
        if (t.capture === null) { values.push(1); continue; }
        const rawCapture = h[t.capture];
        if (typeof rawCapture !== 'string') return { stop: `INSTRUMENT: term ${i} matched but capture group ${t.capture} did not participate — the number is unknown, not zero`, fault: STOP_FAULTS.CRASHED };
        const n = Number.parseInt(rawCapture, 10);
        if (!Number.isFinite(n)) return { stop: `INSTRUMENT: term ${i} captured "${rawCapture}", which is not an integer`, fault: STOP_FAULTS.CRASHED };
        values.push(n);
      }
    }
    if (filtering) {
      if (dropped) notes.push(`term ${i}: ${dropped} matching line(s) dropped by the scope filter`);
      if (unattributable) notes.push(`term ${i}: ${unattributable} matching line(s) named no path, so the scope filter could not judge them — they were KEPT`);
    }

    // 3. aggregate
    let subtotal;
    if (t.aggregate === 'sum') subtotal = values.reduce((a, b) => a + b, 0);
    else {
      if (!values.length) {
        // TWO DIFFERENT FAULTS, and they used to read as one. "Matched nothing"
        // sends the reader to the parser; lines that matched and were then
        // EXCLUDED BY SCOPE send them to the scope, which is where the problem
        // actually is. The counts are named mechanically (F38's genre split:
        // a wall with a number converts, a description does not), and the notes
        // this function already computed ride out with the stop instead of being
        // dropped on the floor — the diagnostic exists either way.
        // `dropped` alone, never dropped+unattributable: an unattributable line
        // is KEPT, so it would already be in `values` — claiming it was excluded
        // would be the message lying about which lane the line went down.
        return {
          stop: dropped > 0
            ? `INSTRUMENT: term ${i} (/${t.lineMatch}/, aggregate "first") matched ${dropped} line(s) and the scope filter excluded every one of them — the number was never reported FOR THIS POPULATION, so it is unknown, not zero`
            : `INSTRUMENT: term ${i} (/${t.lineMatch}/, aggregate "first") matched nothing — the number was never reported, so it is unknown, not zero`,
          fault: STOP_FAULTS.CRASHED,
          notes,
        };
      }
      subtotal = values[0];
    }
    // `first` read ONE line — `kept[0]`, since `values[0]` is the first hit on
    // the first kept line. The rest matched (and `matches` below still says so)
    // but are not what this subtotal is made of.
    matched.push(t.aggregate === 'first' ? kept.slice(0, 1) : kept);
    breakdown.push({ term: i, lineMatch: t.lineMatch, aggregate: t.aggregate, sign: t.sign, matches: values.length, subtotal, contribution: t.sign * subtotal });
    value += t.sign * subtotal;
  }
  return { stop: null, value, breakdown, notes, preScopeMatches, matched };
}

// ── D12: the baseline is MEASURED at this run's own seed, every run ──────────

/**
 * A caller-scoped holder for detached seed worktrees. Scoped rather than
 * module-global on purpose: a global cache in a published library leaks
 * worktrees into whatever process imported it, and nothing would ever remove
 * them. `seedRead`/`runClose` create one, share it across stages (so a
 * multi-stage close pays for one checkout), and remove it in a `finally`.
 * @returns {SeedTrees}
 */
export function makeSeedTrees() {
  /** @type {Map<string, {workdir: string, root: string, dir: string}>} */
  const made = new Map();
  /** @type {Map<string, {stop: string, fault: string}|{stop: null, dir: string}>} */
  const answers = new Map();
  return {
    async ensure(workdir, seedRef) {
      const key = `${workdir}::${seedRef}`;
      const cached = answers.get(key);
      if (cached) return cached;
      const verify = await git(workdir, ['rev-parse', '--verify', `${seedRef}^{commit}`]);
      if (!verify.ok) {
        const v = { stop: `INSTRUMENT: the seed commit "${seedRef}" does not exist in ${workdir}`, fault: STOP_FAULTS.FAILED };
        answers.set(key, v);
        return v;
      }
      const root = await mkdtemp(join(tmpdir(), 'bareloop-seed-'));
      const dir = join(root, 'tree');
      const add = await git(workdir, ['worktree', 'add', '--detach', dir, seedRef]);
      if (!add.ok) {
        await rm(root, { recursive: true, force: true });
        const v = { stop: `INSTRUMENT: could not create a seed worktree at ${seedRef}: ${String(add.err).trim()}`, fault: add.fault };
        answers.set(key, v);
        return v;
      }
      // A checkout without its toolchain measures a BROKEN toolchain, which
      // would read as an instrument stop on every single run rather than a
      // baseline. Best effort: a missing link surfaces loudly as that stop.
      for (const dep of ['node_modules', '.venv', 'venv']) {
        try { await symlink(join(workdir, dep), join(dir, dep)); } catch { /* absent, or already there */ }
      }
      made.set(key, { workdir, root, dir });
      const v = { stop: null, dir };
      answers.set(key, v);
      return v;
    },
    /**
     * Removal — and it NEVER THROWS, which is the load-bearing half.
     *
     * EVERY call site runs this inside a `finally` (`runStage`, `seedRead`,
     * `runDeclaredClose` below; `src/declaredclose.js` and `src/authorflow.js`
     * outside). A rejection from a `finally` REPLACES whatever the try block
     * was returning, so an unremovable directory — EACCES, EBUSY, a mount that
     * went away — would discard an ALREADY-COMPUTED verdict and surface
     * downstream as something that looks like a transport failure. A paid green
     * would simply vanish. A cleanup hiccup never outranks a paid verdict.
     *
     * It is not swallowed either, which is the other half: the failure comes
     * back as DATA (`ok:false` plus the leaked roots and the real error) that a
     * caller who cares can read and attach a note to. Never `undefined`, never a
     * silent success — and, because it is only a return value, never able to
     * move a verdict. One unremovable tree also never strands the rest.
     * @returns {Promise<{ok: boolean, leaked: string[], detail: string|null}>}
     */
    async cleanup() {
      /** @type {string[]} */
      const leaked = [];
      /** @type {string[]} */
      const details = [];
      for (const { workdir, root, dir } of made.values()) {
        try {
          // git's own refusal is a LEAK the instrument must be able to see. `git`
          // never throws — it hands failure back as `ok:false` — so a bare call
          // here left `git worktree remove` failing invisibly: the directory went
          // away under `rm` and a stale admin entry stayed behind in
          // `.git/worktrees/`, while this reported `ok:true, leaked:[]`. That is
          // the blind-instrument class on the one report that exists to name a
          // leak, so the answer is READ rather than discarded.
          const wr = await git(workdir, ['worktree', 'remove', '--force', dir]);
          await rm(root, { recursive: true, force: true });
          if (!wr.ok) {
            leaked.push(root);
            details.push(`${root}: git worktree remove refused (${String(wr.err).trim()}) — the checkout is gone but its admin entry survives; \`git worktree prune\` in ${workdir} clears it`);
          }
        } catch (e) {
          leaked.push(root);
          details.push(`${root}: ${String(/** @type {any} */ (e)?.message ?? e)}`);
        }
      }
      made.clear();
      answers.clear();
      return { ok: leaked.length === 0, leaked, detail: details.length ? details.join('; ') : null };
    },
  };
}

/**
 * Is the working tree byte-identical to the seed (the arbiter's own books
 * aside)? When it is, the baseline can honestly be taken in place — and the
 * record SAYS which route was taken.
 * @param {string} workdir @param {string} seedRef
 */
async function treeIsAtSeed(workdir, seedRef) {
  const cs = await changedSet(workdir, seedRef);
  if (cs.stop !== null) return { at: false, stop: cs.stop, fault: cs.fault };
  return { at: cs.paths.length === 0, stop: null, fault: STOP_FAULTS.FAILED };
}

// ── results ─────────────────────────────────────────────────────────────────

/**
 * @param {any} stage @param {Partial<StageResult>} over
 * @returns {StageResult}
 */
const result = (stage, over) => ({
  verdict: 'green',
  exitCode: EXIT_GREEN,
  value: null,
  baseline: null,
  baselineSource: null,
  gapLines: [],
  judged: true,
  stage: stage?.name ?? null,
  kind: stage?.kind ?? null,
  detail: {},
  ...over,
});

/**
 * Contract (a). The stop's own reason still rides the gap channel — an
 * operator reading the close's output must see WHY nothing was judged — and
 * what it never carries is the judged marker.
 *
 * `fault` is the arbiter's four-row vocabulary (`STOP_FAULTS`), stamped by the
 * site that OBSERVED the fault. It defaults to `failed` — "the close cannot
 * run" is the safe reading — and it is carried on `detail` so a consumer routes
 * the stop by a typed field instead of pattern-matching the stop's prose.
 * `notes` are diagnostics a measurement had ALREADY COMPUTED when it stopped —
 * the scope filter's own arithmetic, chiefly. They ride out on the same gap
 * channel as the stop rather than being dropped on the floor: the stop says the
 * number could not be read, and the notes say which lane the lines went down,
 * which is usually the difference between hunting a parser bug and reading the
 * scope. Default empty, so every other stop site is unchanged.
 * @param {any} stage @param {Ctx} ctx @param {string} stop @param {Record<string, any>} [detail]
 * @param {string} [fault] @param {string[]} [notes]
 * @returns {StageResult}
 */
const stopped = (stage, ctx, stop, detail = {}, fault = STOP_FAULTS.FAILED, notes = []) => {
  const gap = new Gap(ctx.gapKeep, ctx.gapCap).push(stop);
  for (const n of notes) gap.push(`  ${n}`);
  return result(stage, {
    verdict: 'instrument-stop',
    exitCode: EXIT_STOP,
    judged: false,
    gapLines: gap.render(),
    detail: { ...detail, stop, fault },
  });
};

// ── the four kinds ──────────────────────────────────────────────────────────

/**
 * The bound a stage ACTUALLY runs under: the tighter of what the declaration
 * asked for and what the operator allows.
 *
 * `timeoutMs` is AUTHORED — it rides in the declaration, on the emergent side
 * of the line. `ctx.timeoutMsDefault` is the operator's ceiling and is not.
 * This is the budget rule applied to time: the advertised bound and the
 * enforced bound must be the same number, and the authored side may only ever
 * TIGHTEN it (a declaration that could widen its own ceiling is a second,
 * silent ceiling above the signed one). A declared value that is unusable —
 * absent, non-finite, zero or negative — falls back to the ceiling rather than
 * to `sh`'s "no timer at all", which is the same direction: never wider.
 * @param {any} declared @param {Ctx} ctx
 * @returns {number}
 */
function effectiveTimeoutMs(declared, ctx) {
  const ceiling = ctx.timeoutMsDefault ?? DEFAULT_TIMEOUT_MS;
  return typeof declared === 'number' && Number.isFinite(declared) && declared > 0
    ? Math.min(declared, ceiling)
    : ceiling;
}

/** @param {any} stage @param {Ctx} ctx @returns {Promise<StageResult>} */
async function runCommandExit(stage, ctx) {
  const p = stage.params;
  const r = await sh(p.cmd, p.args ?? [], {
    cwd: ctx.workdir,
    env: p.env ?? {},
    timeoutMs: effectiveTimeoutMs(p.timeoutMs, ctx),
    maxBuffer: ctx.maxBuffer ?? MAX_BUFFER,
  });
  if (r.stop !== null) return stopped(stage, ctx, r.stop, {}, r.fault);
  const gap = new Gap(ctx.gapKeep, ctx.gapCap);
  for (const name of r.dropped) gap.push(`${stage.name}: declared env var ${name} was DROPPED — the close never hands worker code a credential`);
  const green = r.code === p.expectExit;
  if (!green) {
    gap.push(`${stage.name}: "${p.cmd}${(p.args ?? []).length ? ` ${(p.args ?? []).join(' ')}` : ''}" exited ${r.code}, expected ${p.expectExit}`);
    for (const l of r.out.split('\n').filter((x) => x.trim() !== '')) gap.push(`  ${l}`);
  }
  return result(stage, {
    verdict: green ? 'green' : 'red',
    exitCode: green ? EXIT_GREEN : EXIT_RED,
    gapLines: gap.render(),
    detail: { exit: r.code, expected: p.expectExit, envDropped: r.dropped },
  });
}

/**
 * The counting kind. `measure` below carries the broken-ruler rule and its one
 * ACCEPTED LIMIT: a tool whose convention is "non-zero exit MEANS zero found"
 * (`grep -c`, pytest's exit 5) stops here rather than counting zero. That is
 * deliberate and fail-safe — unreachable on the shipped TYPES genre, a loud
 * false stop at worst, and never a false green. A genre that needs the other
 * behaviour declares it; this default is not softened. See `measure`.
 * @param {any} stage @param {Ctx} ctx @returns {Promise<StageResult>} */
async function runCountNotWorse(stage, ctx) {
  const p = stage.params;
  const norm = normalizeParser(p.parser, `${stage.name}.parser`);
  if (!norm.ok) {
    return stopped(stage, ctx, `INSTRUMENT: ${stage.name}'s parser does not normalise: ${norm.reds.map((r) => `${r.path} — ${r.detail}`).join('; ')}`,
      {}, STOP_FAULTS.CRASHED);
  }
  const terms = /** @type {any[]} */ (norm.terms);

  /** @param {string} cwd @param {string} where */
  const measure = async (cwd, where) => {
    const r = await sh(p.cmd, p.args ?? [], {
      cwd,
      env: p.env ?? {},
      timeoutMs: effectiveTimeoutMs(p.timeoutMs, ctx),
      maxBuffer: ctx.maxBuffer ?? MAX_BUFFER,
    });
    if (r.stop !== null) return { stop: `${r.stop} (measuring ${where})`, fault: r.fault };
    const v = parseValue(r.out, terms, { scope: p.scope, workdir: cwd });
    if (v.stop !== null) return { stop: `${v.stop} (measuring ${where})`, fault: v.fault, notes: v.notes ?? [] };
    // A BROKEN RULER NEVER CERTIFIES ZERO — the zero-match split (contract (a))
    // finished. `sum` over nothing is a COUNTED zero because the region was
    // searched, and that reading is only believable when the tool itself came
    // back clean: a checker that died before it ever looked at the tree also
    // matches nothing, and 0 against a baseline of 0 reads GREEN. `first`
    // already stops on zero matches; `sum` did not, and the exit code the
    // measurement was already carrying was never consulted.
    //
    // So: zero matched AND a non-zero exit is could-not-run — the existing stop
    // lane, in BOTH directions. A crash that would have flattered the count and
    // one that would have faked a red are the same casualty, and a casualty is
    // never evidence either way (F45). Non-zero exit WITH matches stays a normal
    // reading: that is a checker reporting real findings, which is its job.
    //
    // "Matched" here is `preScopeMatches`, and the distinction is the whole
    // guard. A POST-scope count cannot tell a dead tool from a live one whose
    // every finding belonged to another population — they are TWO DIFFERENT
    // FAULTS and they read as one, the same class the `first` aggregate's own
    // stop already split above. Run mslsnnzk paid for it twice: tsc exited 2
    // and printed 67 real error lines, all under `src/`, against a stage scoped
    // `excludePrefixes:["src/"]`; post-scope the count was 0 and a good close
    // was refused as a crashed instrument. So liveness is read where liveness
    // lives — BEFORE the filter — and a live tool over an empty population is a
    // counted zero carrying the filter's own dropped-line note, which is what
    // the paragraph above always claimed and the code did not do. The fail-safe
    // is untouched in the direction that matters: a genuinely silent non-zero
    // exit still matched nothing pre-scope, and still stops.
    //
    // ACCEPTED LIMIT, stated rather than fixed. Some tools spell "I found
    // nothing" as a NON-ZERO EXIT — `grep -c` exits 1 on no match, pytest exits
    // 5 when it collects no tests. Declared as a count stage, one of those would
    // stop here instead of recording a true zero. No such misfire is
    // CONSTRUCTIBLE on the shipped TYPES genre (mypy and tsc exit 0 on a clean
    // tree and print the "found 0 errors" line the parser matches), so today the
    // rule can only produce a false STOP, never a false green — and that is
    // exactly the direction it is chosen for. A stop is loud, honest and
    // re-runnable; counting a crashed tool's silence as zero grades a red tree
    // GREEN. The F49 precedent governs: the fail-safe direction is never traded
    // away to chase the sharper one, and this default is not softened.
    //
    // A genre that genuinely needs exit-N-means-zero DECLARES it — a catalogue
    // parameter added at that rework, so the exception rides the signed spec and
    // is visible per stage. Never by loosening the default here, which would
    // silently re-open the fake-green lane under every close already signed.
    if (r.code !== 0 && v.preScopeMatches === 0) {
      return {
        stop: `INSTRUMENT: "${p.cmd}" exited ${r.code} and its output matched none of the parser's terms — a crashed tool reporting nothing is unknown, not zero (measuring ${where})`,
        fault: STOP_FAULTS.CRASHED,
        // empty BY CONSTRUCTION, not by oversight: every scope note requires a
        // matching line, and this branch requires that there were none
        notes: [],
      };
    }
    return { stop: null, value: v.value, breakdown: v.breakdown, notes: v.notes, matched: v.matched, exit: r.code, dropped: r.dropped, fault: STOP_FAULTS.FAILED };
  };

  const now = await measure(ctx.workdir, 'the current tree');
  if (now.stop !== null) return stopped(stage, ctx, now.stop, {}, now.fault, now.notes);

  // D12 — the close stores the COUNTING RULE, never the number, so "seed" is
  // MEASURED at this run's own seed. Which route measured it is recorded.
  let baseline = 0;
  let baselineSource = 'declared 0';
  /** @type {any} */
  let baselineDetail = null;
  if (p.baseline === 'seed') {
    const at = await treeIsAtSeed(ctx.workdir, ctx.seedRef);
    if (at.stop !== null) return stopped(stage, ctx, at.stop, {}, at.fault);
    if ((ctx.baselineMode ?? 'auto') === 'auto' && at.at) {
      baseline = /** @type {number} */ (now.value);
      baselineSource = 'measured IN PLACE — the working tree is verifiably identical to the seed';
      baselineDetail = { breakdown: now.breakdown };
    } else {
      const seedTrees = /** @type {SeedTrees} */ (ctx.seedTrees);
      const st = await seedTrees.ensure(ctx.workdir, ctx.seedRef);
      if (st.stop !== null) return stopped(stage, ctx, st.stop, {}, st.fault);
      const b = await measure(st.dir, `the seed tree at ${ctx.seedRef}`);
      if (b.stop !== null) return stopped(stage, ctx, b.stop, {}, b.fault, b.notes);
      baseline = /** @type {number} */ (b.value);
      baselineSource = `measured in a detached worktree at ${ctx.seedRef}`;
      baselineDetail = { breakdown: b.breakdown, notes: b.notes };
    }
  }

  const value = /** @type {number} */ (now.value);
  const worse = p.direction === 'lower-is-better' ? value > baseline : value < baseline;
  const gap = new Gap(ctx.gapKeep, ctx.gapCap);
  for (const name of /** @type {string[]} */ (now.dropped ?? [])) gap.push(`${stage.name}: declared env var ${name} was DROPPED — the close never hands worker code a credential`);
  // the scope filter's own arithmetic is announced whichever way the stage
  // lands: a green measured over a filtered population is still a filtered
  // number, and the operator reads why
  for (const n of /** @type {string[]} */ (now.notes)) gap.push(`${stage.name}: ${n}`);
  if (worse) {
    gap.push(`${stage.name}: ${value} against a baseline of ${baseline} (${p.direction}) — worse`);
    gap.push(`  baseline ${baselineSource}`);
    // …each term stating itself, and THEN the lines that term's subtotal is made
    // of, nested under it. A count with no addresses is the semantic genre F38
    // measured as inert: run u-msn227nq's worker was handed "8 match(es)", had
    // nowhere to open, and probed the arbiter's books until the deny guard ended
    // the run. The instrument NAMED these lines — echoing what it named is the
    // same licence `pattern-absent-in-diff` already runs under, not the barred
    // move of naming a culprit the instrument never reported.
    //
    // NESTED, not pooled, because a line's arithmetic role is the term's and only
    // the term's row carries it. `value` is a SIGNED sum: a term declared
    // `sign: -1` subtracts, so its lines are ones the count went DOWN for, and a
    // worker handed them flat beside the added ones reads every line as a wall
    // and "fixes" one that moves the number the wrong way. The row directly above
    // each block already says `contributes +n` / `-n`; sitting the lines under it
    // is what makes that statement reach them. Nothing is withheld — under
    // `higher-is-better` the subtracted term is exactly where the news usually is
    // — and nothing is relabelled: the lines are still verbatim, one indent in.
    //
    // They ride the Gap like every other line: the stage prefix (Layer R's
    // redKeep derives from it), the cap, and the trim marker on overflow.
    const perTerm = /** @type {string[][]} */ (now.matched ?? []);
    for (const [i, b] of /** @type {any[]} */ (now.breakdown).entries()) {
      gap.push(`  term ${b.term} /${b.lineMatch}/ ${b.aggregate}: ${b.matches} match(es), subtotal ${b.subtotal}, contributes ${b.contribution >= 0 ? '+' : ''}${b.contribution}`);
      for (const l of perTerm[i] ?? []) gap.push(`    ${l}`);
    }
  }
  return result(stage, {
    verdict: worse ? 'red' : 'green',
    exitCode: worse ? EXIT_RED : EXIT_GREEN,
    value,
    baseline,
    baselineSource,
    gapLines: gap.render(),
    detail: {
      direction: p.direction,
      breakdown: now.breakdown,
      baselineBreakdown: baselineDetail,
      notes: now.notes,
      commandExit: now.exit,
      envDropped: now.dropped ?? [],
    },
  });
}

/** @param {any} stage @param {Ctx} ctx @returns {Promise<StageResult>} */
async function runPatternAbsentInDiff(stage, ctx) {
  const p = stage.params;
  const cs = await changedSet(ctx.workdir, ctx.seedRef);
  if (cs.stop !== null) return stopped(stage, ctx, cs.stop, {}, cs.fault);

  const untracked = new Set(cs.untracked);
  const exts = p.extensions.map((/** @type {string} */ e) => (String(e).startsWith('.') ? String(e) : `.${e}`));
  // git spells the tree it walked; the declared scope spells the job's own
  // target, and on a symlinked package those are two names for one file. The
  // lexical-only reading dropped the real file out of the scanned set and read
  // GREEN over a suppression it never opened — a guard's fake-green direction.
  const phys = scopeFilters(p.scope) ? physicalIn(ctx.workdir) : null;
  const scanned = cs.paths.filter((rel) => exts.some((e) => rel.endsWith(e)) && inScope(rel, p.scope, phys));

  /** @type {RegExp[]} */
  const res = [];
  for (const q of p.patterns) {
    try { res.push(new RegExp(q.regex)); } catch (e) { return stopped(stage, ctx, `INSTRUMENT: pattern "${q.id}" is not a valid regex: ${String(/** @type {any} */ (e)?.message ?? e)}`, {}, STOP_FAULTS.CRASHED); }
  }

  const gap = new Gap(ctx.gapKeep, ctx.gapCap);
  /** @type {any[]} */
  const hits = [];
  /** @type {string[]} */
  const notes = [];
  for (const rel of scanned) {
    const a = await addedLines(ctx.workdir, ctx.seedRef, rel, { untracked: untracked.has(rel) });
    if (a.stop !== null) return stopped(stage, ctx, a.stop, {}, a.fault);
    if (a.note) notes.push(a.note);
    for (const { n, text } of a.lines) {
      p.patterns.forEach((/** @type {any} */ q, /** @type {number} */ i) => {
        if (res[i].test(text)) hits.push({ id: q.id, path: rel, line: n, text: text.trim().slice(0, 200) });
      });
    }
  }
  for (const n of notes) gap.push(`${stage.name}: ${n}`);
  if (hits.length) {
    gap.push(`${stage.name}: ${hits.length} forbidden pattern occurrence(s) in lines this run ADDED`);
    // the file is named because the SCAN itself reported it — contract (b)'s
    // limit bars naming a culprit the instrument did not name, not echoing
    // one it did
    for (const h of hits) gap.push(`  [${h.id}] ${h.path}:${h.line}: ${h.text}`);
  }
  return result(stage, {
    verdict: hits.length ? 'red' : 'green',
    exitCode: hits.length ? EXIT_RED : EXIT_GREEN,
    gapLines: gap.render(),
    detail: { scannedFiles: scanned, hits, notes, changedTotal: cs.paths.length, excluded: cs.excluded },
  });
}

/** @param {any} stage @param {Ctx} ctx @returns {Promise<StageResult>} */
async function runFilesChanged(stage, ctx) {
  const p = stage.params;
  const cs = await changedSet(ctx.workdir, ctx.seedRef);
  if (cs.stop !== null) return stopped(stage, ctx, cs.stop, {}, cs.fault);
  // the containment fence resolves too. Only ONE of its two sides is git's
  // spelling — `allowPrefixes` is the job's own target, and on the aurora shape
  // (`src/pkg -> ../packages/x/src/pkg`) the declaration says `src/pkg/` while
  // git says `packages/x/src/pkg/...`: a real in-target edit read as a stray.
  // Physical only on a lexical miss, both sides resolved, so a spelling that
  // lands outside every prefix is still outside. ACCEPTED, stated rather than
  // fixed: a link that LIVES outside a prefix and POINTS inside it now counts
  // as inside — the same reading the scope filter has shipped since de61e87,
  // and the mild direction; the escaping one stays shut.
  const phys = physicalIn(ctx.workdir);
  const outside = cs.paths.filter((rel) => !p.allowPrefixes.some((/** @type {string} */ pre) => underPrefixEither(rel, pre, phys)));
  const empty = p.requireNonEmpty === true && cs.paths.length === 0;
  const gap = new Gap(ctx.gapKeep, ctx.gapCap);
  if (empty) gap.push(`${stage.name}: nothing changed against the seed — the changed set is empty`);
  if (outside.length) {
    gap.push(`${stage.name}: ${outside.length} changed file(s) lie outside ${p.allowPrefixes.join(', ')}`);
    for (const o of outside) gap.push(`  ${o}`);
  }
  const red = empty || outside.length > 0;
  return result(stage, {
    verdict: red ? 'red' : 'green',
    exitCode: red ? EXIT_RED : EXIT_GREEN,
    gapLines: gap.render(),
    detail: { changed: cs.paths, outside, excluded: cs.excluded, empty },
  });
}

/**
 * PART 1a — the `rubric-step` kind: grade ONE job line's step file (output/steps/N.json) with bareguard's rubric primitive.
 * It spawns nothing and buys nothing. The inputs a step cites are read from the frozen tree (`input/...`) and held to the
 * sha256 the SOURCE DOOR recorded in `<into>/source.json` (`inputs: [{label, rel, sha256}]`), so an input that changed after
 * the freeze is a stopped instrument, never a green. The rubric is built here, at every run, from the stage's own parameters
 * (the inputs belong to the run, not to the signed job). A step file that is missing, cut off, or not a JSON object is a RED
 * (the worker has not finished the line); an instrument that cannot read what it must is a STOP (97), never a red.
 * @param {any} stage @param {Ctx} ctx @returns {Promise<StageResult>}
 */
async function runRubricStep(stage, ctx) {
  const p = stage.params;
  const step = p.step;
  const stop = (/** @type {string} */ why, /** @type {string} */ fault = STOP_FAULTS.FAILED) => stopped(stage, ctx, `INSTRUMENT: stage "${stage.name}": ${why}`, { step }, fault);
  // the source door's record of what was frozen: beside the tree, one level up (`<into>/source.json`, `<into>/tree`)
  /** @type {any} */
  let manifest;
  try { manifest = JSON.parse(await readFile(join(dirname(ctx.workdir), 'source.json'), 'utf8')); } catch (e) {
    return stop(`the source record (source.json beside the job's tree) could not be read: ${/** @type {Error} */ (e).message}`);
  }
  const recorded = Array.isArray(manifest?.inputs) ? manifest.inputs : [];
  /** @type {Record<string, string>} */
  const inputShas = {};
  /** @type {Record<string, string>} */
  const inputs = {};
  for (const label of citedLabels(p)) {
    const row = recorded.find((/** @type {any} */ r) => r && r.label === label);
    if (!row || typeof row.rel !== 'string' || typeof row.sha256 !== 'string') return stop(`the step cites "${label}", but the source record has no input with that label`);
    let buf;
    try { buf = await readFile(join(ctx.workdir, row.rel)); } catch (e) { return stop(`input "${label}" (${row.rel}) could not be read: ${/** @type {Error} */ (e).message}`); }
    if (sha256Of(buf) !== row.sha256) return stop(`input "${label}" (${row.rel}) no longer matches the bytes frozen at the source door`);
    inputShas[label] = row.sha256;
    inputs[label] = buf.toString('utf8');
  }
  // S3: each sheet the stage reads, as bareguard's table of the run's FROZEN copy, held to the `tableSha` the run recorded at its start (an unrecorded or changed sheet is a stop naming the input)
  const sheets = await readStageSheets({ workdir: ctx.workdir, recorded, params: p });
  if (!sheets.ok) return stop(sheets.why);
  Object.assign(inputShas, sheets.shas);
  // the step file: a regular file, read once, bounded
  const abs = join(ctx.workdir, stepFileRel(step));
  /** @type {string|null} */
  let bytes = null;
  let notRegular = false;
  try {
    const ls = await lstat(abs);
    if (!ls.isFile()) notRegular = true;
    else if (ls.size > STEP_MAX_BYTES) return stop(`${stepFileRel(step)} is over the ${STEP_MAX_BYTES} byte limit the rubric reads`);
    else bytes = (await readFile(abs)).toString('utf8');
  } catch (e) {
    if (/** @type {any} */ (e)?.code !== 'ENOENT') return stop(`${stepFileRel(step)} could not be read: ${/** @type {Error} */ (e).message}`);
  }
  // PART 1b: a prose step's numbers are tied to the quotes the earlier fact lines' step files hold (those stages ran, and were
  // green, before this one: the close is first-red-wins in stage order, which the validator pins). Unreadable = a stopped instrument.
  /** @type {Record<number, string[]>} */
  const factQuotes = {};
  /** @type {number[]} */
  const factMissing = [];
  const tie = Array.isArray(p.parts) ? p.parts.find((/** @type {any} */ x) => x && x.class === 'countable' && x.check === 'numbersFromFacts') : null;
  for (const n of tie ? tie.from : []) {
    try {
      const parsedFacts = JSON.parse(await readFile(join(ctx.workdir, stepFileRel(n)), 'utf8'));
      const results = Array.isArray(parsedFacts?.results) ? parsedFacts.results : [];
      factQuotes[n] = results.map((/** @type {any} */ r) => (r && typeof r.quote === 'string' ? r.quote : ''));
    } catch (e) {
      // M2: an earlier line's file that is not there (the seed read, before any worker wrote) is a normal red, never an instrument fault
      if (/** @type {any} */ (e)?.code === 'ENOENT') { factMissing.push(n); continue; }
      return stop(`the checked facts of line ${n} (${stepFileRel(n)}) could not be read for the number tie: ${/** @type {Error} */ (e).message}`);
    }
  }
  const graded = await gradeStep({ params: p, bytes: notRegular ? null : bytes, outputBytes: notRegular ? null : bytes, inputs, factQuotes, factMissing, ...(sheets.roles.length > 0 ? { tables: sheets.tables } : {}) }, inputShas);
  if (graded.verdict === 'stopped') return stop(`the rubric stopped: ${graded.fault}`, STOP_FAULTS.CRASHED);
  // REPORT-ONLY: what each cited check read, handed to the runner's seam (the spine's `rubric-evidence`); nothing below reads it
  if (graded.evidence && typeof ctx.onRubricEvidence === 'function') {
    ctx.onRubricEvidence({ step, evidence: graded.evidence, ...(graded.evidenceTotal !== undefined ? { evidenceTotal: graded.evidenceTotal } : {}) });
  }
  const gap = new Gap(ctx.gapKeep, ctx.gapCap);
  if (notRegular) gap.push(`${stage.name}: line ${step}: ${stepFileRel(step)} is not a regular file`);
  for (const l of graded.gapLines) gap.push(`${stage.name}: ${l}`);
  const red = graded.verdict === 'red' || notRegular;
  // each row of the line gets its own result (Addendum 2026-11-14 (c) piece 4), when the signed list is at hand: a REPORT of which row each gap belongs to, read by no verdict, governor or money path
  const per = Array.isArray(ctx.list) ? rowResultsOf(ctx.list, p, notRegular ? { ...graded, rawGaps: [{ id: 'happened', check: 'happened', kind: 'wrong-type' }], detail: { ...graded.detail, why: 'not-object' } } : graded) : null;
  return result(stage, {
    verdict: red ? 'red' : 'green',
    exitCode: red ? EXIT_RED : EXIT_GREEN,
    gapLines: gap.render(),
    // the trend number (`trendValueOf`, src/declaredclose.js, reads `detail.redCount` for a stage with no measurement)
    detail: { ...graded.detail, ...(notRegular ? { redCount: 1 } : {}), ...(per ? { rows: per.rows, unclaimed: per.unclaimed, ...(per.items ? { items: per.items } : {}) } : {}) },
  });
}

/**
 * THE SIGNER'S ANSWER, normalised at the seam that accepts it — the library half
 * of the three-button gate (2026-08-12 §1).
 *
 * `null` is not a refusal: no ruling at all IS the pause path, which is how every
 * ordinary run and every first leg of a hitl run arrives here. What is refused is
 * an answer that is not one of the three doors, and — the case the POC's negative
 * control measured — a `rerun` with no text. Ruling 3 makes the human's words the
 * gap the worker converts from; an empty one launches a fix worker that re-runs
 * as though nothing had been said, which is the failure this refusal exists for.
 *
 * It never throws and never repairs: a decision that cannot be read is handed
 * back as a refusal with its reason, and the caller decides what to do about it.
 * @param {any} ruling
 * @returns {{ok: boolean, ruling: {decision: string, text: string|null}|null, why: string|null}}
 */
export function normalizeHumanRuling(ruling) {
  if (ruling === null || ruling === undefined) return { ok: true, ruling: null, why: null };
  if (typeof ruling !== 'object' || Array.isArray(ruling)) {
    return { ok: false, ruling: null, why: `a decision is an object {decision, text?} — one of ${HUMAN_DECISIONS.join(' | ')}` };
  }
  const decision = String(/** @type {any} */ (ruling).decision);
  if (!HUMAN_DECISIONS.includes(decision)) {
    return {
      ok: false,
      ruling: null,
      why: `"${decision}" is not one of the three doors (${HUMAN_DECISIONS.join(' | ')}). There is no fourth, and no `
        + 'free-text-only variant: a red that is not one of these two is not a ruling the run can act on',
    };
  }
  const text = /** @type {any} */ (ruling).text;
  if (decision === 'rerun') {
    if (typeof text !== 'string' || text.trim().length === 0) {
      return {
        ok: false,
        ruling: null,
        why: 'a "rerun" decision needs TEXT: the human is the gap author (ruling 3), and their words are the whole of '
          + 'what the fix worker is given. An empty gap re-runs the worker as though nothing had been said',
      };
    }
    return { ok: true, ruling: { decision, text }, why: null };
  }
  return { ok: true, ruling: { decision, text: null }, why: null };
}

/**
 * WHICH ANSWER IS THIS LEG ACTING ON — the fresh one, or the one the checkpoint
 * held? F102's cure needs one seam that can say, because two callers ask the same
 * question (`runJob` declares the fold on `job-start` before `runPlan` reads the
 * ruling at all), and two spellings of "is this a fresh engagement" is how the
 * record and the clock come to disagree about the same leg.
 *
 * THE AMBIGUITY IS REFUSED, NEVER MERGED. A checkpoint that holds a decision and a
 * command line that carries another are two answers to one question. Merging them
 * picks a winner nobody chose; overriding silently discards words a person typed
 * (the F98/F28 class at a process boundary). So it comes back as a refusal that
 * NAMES the held decision, and the operator resolves it — by answering the held
 * one, or by starting a fresh run against the tree as it stands.
 *
 * `fresh` is F103's half: a `rerun` is a FRESH ENGAGEMENT (design record §3.4 —
 * *"redo/rerun comes with new authoring for money+time and keeps accounting of
 * this far and this session separate counters"*), and nothing else is. An `accept`
 * commissions no work and a `pause` runs nothing, so neither opens one.
 *
 * A REVIEW DOOR's rerun (module 8) is the SAME fact arriving one level out, and it
 * is folded in here rather than beside the clock, because "is this a fresh
 * engagement" gets ONE spelling — a second one is how a record and a clock come to
 * disagree about the same leg, which is the very thing this resolver exists to
 * prevent. It is deliberately NOT read as a ruling: a `humanRuling` answers a
 * close's human STAGE and is refused for a close that has none, so the door's words
 * stay in their own parameter and only this reading is shared.
 *
 * PRECEDENCE, stated because both CAN be handed to one leg: a door rerun makes the
 * engagement fresh whatever the ruling says, and the two are OR'd, never merged.
 * Freshness is the FAIL-SAFE direction — a fresh clock costs a leg nothing, while
 * inheriting a dead leg's wall is F103's measured, structurally-impossible
 * engagement. The door's own validation (empty words are refused) stays where it
 * is, at the seam that accepts it.
 * @param {any} fresh the answer arriving on this invocation (`--decide`), or null
 * @param {any} held the answer the CHECKPOINT carries (`readResume`'s
 *   `restart.pendingDecision`), or null. `receivedAt` is when the PERSON said it —
 *   carried through so the resumed leg records the receipt, not its own re-reading.
 * @param {any} [doorRerun] MODULE 8 — the review door's rerun, when this leg IS the
 *   fresh engagement a signer commissioned at a previous run's door. Presence is the
 *   whole of what is read here; the words are the accepting seam's business.
 * @returns {{ok: boolean, why: string|null, ruling: {decision: string, text: string|null}|null,
 *   source: 'operator'|'checkpoint'|null, receivedAt: string|null, fresh: boolean}}
 */
export function resolveHumanRuling(fresh, held, doorRerun = null) {
  const has = (/** @type {any} */ v) => v !== null && v !== undefined;
  const atDoor = has(doorRerun);
  const none = { ruling: null, source: /** @type {any} */ (null), receivedAt: null, fresh: atDoor };
  if (has(fresh) && has(held)) {
    const d = typeof held === 'object' && !Array.isArray(held) ? String(/** @type {any} */ (held).decision) : String(held);
    return {
      ok: false,
      why: `this checkpoint already holds a "${d}" decision that no round was ever bought for, and a second answer `
        + 'arrived with this invocation. Two answers to one question is ambiguity, not a merge: resume with no '
        + 'decision to act on the held one, or start a fresh run against the tree as it stands.',
      ...none,
    };
  }
  const raw = has(fresh) ? fresh : held;
  const norm = normalizeHumanRuling(raw ?? null);
  if (!norm.ok) return { ok: false, why: norm.why, ...none };
  if (norm.ruling === null) return { ok: true, why: null, ...none };
  const at = has(held) ? /** @type {any} */ (held).receivedAt : null;
  return {
    ok: true,
    why: null,
    ruling: norm.ruling,
    source: has(fresh) ? 'operator' : 'checkpoint',
    receivedAt: typeof at === 'string' && at.length > 0 ? at : null,
    // OR'd, never merged: either door the person came through commissions work
    fresh: atDoor || norm.ruling.decision === 'rerun',
  };
}

/**
 * THE HUMAN STAGE (N4 slice 1) — the one kind that measures nothing.
 *
 * With no ruling in hand it does not RUN, it PAUSES: the fifth outcome, neither
 * green nor red, so nothing downstream grades it. With the signer's ruling in
 * hand it renders exactly what the person said — `accept` is a green a PERSON
 * judged, and `rerun` is a red whose gap is the human's own words, verbatim,
 * through the same bounded/announced channel every other stage's gap uses.
 *
 * It spawns nothing, reads nothing and touches no tree, which is why it can
 * render both without a workdir that exists.
 *
 * `pause` is deliberately NOT a case here. It is not a judgment about the tree
 * — it is the signer saying "not now" — and it is consumed above this stage, by
 * the runner and by `runPlan` before the close is ever asked (a `pause` that
 * reached this far has bypassed that seam, so it renders NO verdict rather than
 * being guessed into one). With no ruling in hand this kind pauses anyway, which
 * is the same place the person is left; what the door adds is the RECORD that
 * they looked and chose to keep the checkpoint.
 * @param {any} stage @param {Ctx} ctx @returns {Promise<StageResult>}
 */
async function runHumanConfirms(stage, ctx) {
  const ask = stage?.params?.ask;
  const norm = normalizeHumanRuling(ctx.humanRuling ?? null);
  if (!norm.ok) {
    return stopped(stage, ctx, `INSTRUMENT: stage "${stage.name}" was handed a decision it cannot read — ${norm.why}`,
      {}, STOP_FAULTS.CRASHED);
  }
  if (norm.ruling === null) {
    // THE PAUSE. `judged: false` and `exitCode: null` together are the whole
    // contract: nothing was measured and no process ran, so a zero here would be
    // F6 in an exit code's coat.
    return result(stage, {
      verdict: 'pause',
      exitCode: null,
      judged: false,
      detail: { ask: isNonEmptyString(ask) ? ask : null },
    });
  }
  if (norm.ruling.decision === 'accept') {
    return result(stage, { verdict: 'green', exitCode: EXIT_GREEN, judged: true, detail: { ask: ask ?? null, decision: 'accept' } });
  }
  if (norm.ruling.decision === 'rerun') {
    const gap = new Gap(ctx.gapKeep, ctx.gapCap);
    gap.push(`${stage.name}: the signer reviewed the result and asked for another pass. Their words:`);
    gap.push(/** @type {string} */ (norm.ruling.text));
    return result(stage, {
      verdict: 'red',
      exitCode: EXIT_RED,
      judged: true,
      gapLines: gap.render(),
      detail: { ask: ask ?? null, decision: 'rerun' },
    });
  }
  return stopped(stage, ctx, `INSTRUMENT: stage "${stage.name}" was handed a "${norm.ruling.decision}" decision, which `
    + 'is the signer ending the run and is never a verdict about the tree — the runner consumes it before the close',
  {}, STOP_FAULTS.CRASHED);
}

/** @type {Record<string, (stage: any, ctx: Ctx) => Promise<StageResult>>} */
const RUNNERS = {
  'command-exit': runCommandExit,
  'count-not-worse': runCountNotWorse,
  'pattern-absent-in-diff': runPatternAbsentInDiff,
  'files-changed': runFilesChanged,
  'human-confirms': runHumanConfirms,
  'rubric-step': runRubricStep,
};

/**
 * Run ONE declared stage against a workdir at a seed.
 *
 * It never throws. An unexpected throw inside a kind — a malformed parameter
 * the validator did not catch, an unreachable path — is an INSTRUMENT STOP,
 * not a red: that is the casualty-vs-evidence split at its narrowest, and
 * the direction that matters, because a crash rendered as a red is fake
 * evidence about the worker.
 * @param {any} stage `{name, kind, params}`
 * @param {Ctx} ctx
 * @returns {Promise<StageResult>}
 */
export async function runStage(stage, ctx) {
  const owned = !ctx.seedTrees;
  const seedTrees = ctx.seedTrees ?? makeSeedTrees();
  try {
    return await runStageIn(stage, { ...ctx, seedTrees });
  } finally {
    if (owned) await seedTrees.cleanup();
  }
}

/** @param {any} stage @param {Ctx} ctx @returns {Promise<StageResult>} */
async function runStageIn(stage, ctx) {
  if (stage === null || typeof stage !== 'object' || Array.isArray(stage)) return stopped(null, ctx, 'INSTRUMENT: a stage must be an object {name, kind, params}', {}, STOP_FAULTS.CRASHED);
  const fn = RUNNERS[stage.kind];
  if (!fn) {
    return stopped(stage, ctx, `INSTRUMENT: stage "${stage.name}" declares kind "${stage.kind}", which this executor does not implement (locked or unknown) — the live kinds are ${LIVE_KINDS.join(', ')}`,
      { kind: stage.kind }, STOP_FAULTS.CRASHED);
  }
  if (stage.params === null || typeof stage.params !== 'object') return stopped(stage, ctx, `INSTRUMENT: stage "${stage.name}" declares no params object`, {}, STOP_FAULTS.CRASHED);
  try {
    return await fn(stage, ctx);
  } catch (e) {
    return stopped(stage, ctx, `INSTRUMENT: stage "${stage.name}" threw: ${String(/** @type {any} */ (e)?.stack ?? e)}`, {}, STOP_FAULTS.CRASHED);
  }
}

/**
 * D12's seed-verdict read: run EVERY declared stage at the seed, regardless
 * of reds, and hand back one row per stage.
 *
 * Not first-red-wins, and the reason is structural rather than a preference:
 * every shipped close opens with `changed-from-seed`, which is RED at its own
 * seed by construction (nothing has changed yet), so a first-red-wins seed
 * read measures exactly one stage and mints no baseline for any other. The
 * baseline every `baseline: "seed"` stage is later graded against comes from
 * here, so a stage that never ran is a stage with no bar.
 * @param {any} declaration `{stages: [...]}`
 * @param {Ctx} ctx
 * @returns {Promise<StageResult[]>}
 */
export async function seedRead(declaration, ctx) {
  const owned = !ctx.seedTrees;
  const seedTrees = ctx.seedTrees ?? makeSeedTrees();
  const inner = { ...ctx, seedTrees };
  /** AFTER the stage completes, never before: a line saying a stage STARTED and
   * a line saying what it RETURNED are two different facts, and only the second
   * one can carry a verdict. The duration is measured around the call rather
   * than reported by it, so a stage that stops still gets a real number.
   * @param {StageResult} row @param {number} startedAt */
  const told = (row, startedAt) => {
    if (typeof ctx.onStage === 'function') {
      ctx.onStage({ stage: row.stage, kind: row.kind, verdict: row.verdict, durationMs: Date.now() - startedAt });
    }
    return row;
  };
  try {
    /** @type {StageResult[]} */
    const rows = [];
    for (const stage of declaration?.stages ?? []) {
      // RULING 8 — judged and human stages are EXEMPT from the seed read, and
      // the exemption is a ROW, not an absence (F59). A person asked at the seed
      // is being interviewed, not measured, and there is nothing to baseline.
      const startedAt = Date.now();
      if (SEED_EXEMPT_KINDS.includes(stage?.kind)) {
        rows.push(told(result(stage, {
          verdict: 'skipped',
          exitCode: null,
          judged: false,
          detail: {
            skipped: true,
            why: 'ruling 8 (2026-08-07): judged and human stages skip the seed-verdict read — a judged number at seed '
              + 'is unstable and a person at seed is an interview, not a measurement. This stage has no seed baseline '
              + 'and contributes none.',
          },
        }), startedAt));
        continue;
      }
      rows.push(told(await runStageIn(stage, inner), startedAt));
    }
    return rows;
  } finally {
    if (owned) await seedTrees.cleanup();
  }
}

/**
 * The GRADING path: stages in declared order, FIRST RED WINS. The deciding
 * stage names the verdict; everything after it is `not-reached` and is
 * reported as such rather than as a green nobody ran.
 *
 * An instrument stop ends the close UNJUDGED — the run has no verdict to
 * carry, which is the whole point of keeping a casualty out of the evidence.
 *
 * NAMED `runDeclaredClose`, not `runClose` (M4's export-surface decision): the
 * arbiter's shell already ships a public `runClose(argv, redact, opts)` that
 * adopters import, and the two take different things and mean different things
 * — one runs a DECLARATION, the other an argv. Renaming the shipped one to make
 * room would break a documented adopter contract for nothing; the new name says
 * exactly what differs. `src/declaredclose.js` is what bridges the two shapes.
 * @param {any} declaration @param {Ctx} ctx
 * @returns {Promise<{verdict: 'green'|'red'|'instrument-stop'|'pause', exitCode: number|null, judged: boolean, firstRed: string|null, pausedAt: string|null, stages: StageResult[]}>}
 */
export async function runDeclaredClose(declaration, ctx) {
  const owned = !ctx.seedTrees;
  const seedTrees = ctx.seedTrees ?? makeSeedTrees();
  const inner = { ...ctx, seedTrees };
  try {
    /** @type {StageResult[]} */
    const stages = [];
    let ended = false;
    for (const stage of declaration?.stages ?? []) {
      if (ended) {
        stages.push(result(stage, { verdict: 'not-reached', exitCode: null, judged: false }));
        continue;
      }
      const r = await runStageIn(stage, inner);
      stages.push(r);
      if (r.verdict !== 'green') ended = true;
    }
    // A PAUSE stops the close exactly like a red does, and is DELIBERATELY not
    // in this list: `deciding` names the stage that rendered a VERDICT, and a
    // pause rendered none. Reading it as one would fall through to green — the
    // close would mint a verdict nobody gave (the defect this line exists to
    // make impossible).
    const deciding = stages.find((s) => s.verdict === 'red' || s.verdict === 'instrument-stop');
    const paused = deciding ? null : stages.find((s) => s.verdict === 'pause') ?? null;
    return {
      verdict: /** @type {'green'|'red'|'instrument-stop'|'pause'} */ (deciding ? deciding.verdict : (paused ? 'pause' : 'green')),
      exitCode: deciding ? /** @type {number} */ (deciding.exitCode) : (paused ? null : EXIT_GREEN),
      judged: deciding ? deciding.judged : (paused ? false : true),
      firstRed: deciding ? deciding.stage : null,
      /** the stage the close is WAITING on, when it is waiting on a person */
      pausedAt: paused ? paused.stage : null,
      stages,
    };
  } finally {
    if (owned) await seedTrees.cleanup();
  }
}
