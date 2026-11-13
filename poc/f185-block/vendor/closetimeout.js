// borrowed-from: bareloop src/closetimeout.js@v0.56.0 (3383cce)
// Close timeout — PRD item 27/M3, `docs/product/CLOSE-INTEGRITY-BUILD.md`.
//
// hamr's ruling (2026-09-06, verbatim): "both … autoset and can be override,
// same like api pricing" — the guesstimate-plus-loud-sign-plus-customer-
// override shape, never a hidden knob. Today `runClose`'s own default
// (`src/ralph.js:221`, `timeoutMs = 120_000`) is a defaulted cap with no
// operator-set floor — the same shape the wall's no-default rule already
// forbids for `maxWallMs`. This module is the fix: measure the close's own
// stages once at $0, before any provider call, and derive a per-stage ceiling
// from what was actually measured, unless the signed spec names one itself.
//
// CONSTANTS BELOW ARE ARBITER CONSTANTS — hamr set them 2026-09-07, verbatim:
// "floor = 120,000 ms; K = 5 ('2 and 5 are fine')." Never agent- or
// adopter-settable; a build changing them is arbiter territory, not a tuning
// knob a drafted spec or a runner script can reach for.

import { runClose } from './ralph.js';

/** hamr, 2026-09-07: the floor, verbatim. Also the value `runClose`'s own
 * un-autoset default has always used — kept as its own named constant here
 * (not re-exported from ralph.js) because the two are different CLAIMS: one is
 * "what runClose does if nobody says otherwise", the other is "the arbiter's
 * chosen floor for autoset" — they happen to be the same number today, and a
 * future change to either must not silently move the other. */
export const CLOSE_TIMEOUT_FLOOR_MS = 120_000;
/** hamr, 2026-09-07, verbatim: "K = 5 ('2 and 5 are fine')." */
export const CLOSE_TIMEOUT_K = 5;
/** `runClose`'s own shipped default when nobody passes a timeout at all
 * (`src/ralph.js:221`) — the ceiling the $0 timing PASS ITSELF runs each
 * stage under is a multiple of this, never of the floor above (the two are
 * the same number today; named separately on purpose, see the constant
 * above). */
export const LIBRARY_DEFAULT_CLOSE_TIMEOUT_MS = 120_000;
/**
 * The generous PROVISIONAL ceiling the timing preflight runs every stage
 * under, so "a genuinely hung stage still ends" (build spec, M3 §2) rather
 * than blocking the timing pass forever. Deliberately the library default × K
 * (600s) — NOT the autoset/override ceiling this module computes, which is
 * only known after the pass completes.
 */
export const TIMING_PREFLIGHT_CEILING_MS = LIBRARY_DEFAULT_CLOSE_TIMEOUT_MS * CLOSE_TIMEOUT_K;

/**
 * The $0 timing preflight (PRD item 27, M3 §2): run every close STAGE once,
 * ignoring verdicts — first-red-wins stays for the real verdict precheck
 * (`src/planrun.js`'s `check-preflight`); this is a separate, sequential pass
 * (F131/F68: never two closes in flight against one tree) whose only purpose
 * is TIMING. A declared-close stage (no `.cmd`, a kind executor) has nothing
 * a command runner can spawn and is skipped — it contributes no reading, not
 * a zero one (a silent zero would understate the real close's later cost).
 *
 * @param {any[]} stages a close stage chain (`runStages`'s own shape)
 * @param {{cwd?: string, redact?: (s: string) => string, ceilingMs?: number}} [opts]
 *   `ceilingMs` (test seam only — never wired to any spec/runner surface):
 *   overrides `TIMING_PREFLIGHT_CEILING_MS` so a hang-detection test does not
 *   have to wait 10 real minutes. Production callers never pass it.
 * @returns {Promise<{
 *   perStage: {name: string, ms: number, exitCode: number|null, timedOut: boolean}[],
 *   slowestMs: number, slowestName: string|null, anyTimedOut: boolean,
 * }>}
 */
export async function timeCloseStages(stages, { cwd, redact = (s) => s, ceilingMs = TIMING_PREFLIGHT_CEILING_MS } = {}) {
  /** @type {{name: string, ms: number, exitCode: number|null, timedOut: boolean}[]} */
  const perStage = [];
  for (const st of Array.isArray(stages) ? stages : []) {
    if (!st || typeof st !== 'object' || typeof st.cmd !== 'string') continue; // declared/kind stage — nothing to spawn
    const start = Date.now();
    // Sequential by construction (F68), same discipline as `runStages`: a
    // stage's own timing pass is never in flight beside another close.
    // eslint-disable-next-line no-await-in-loop
    const r = await runClose(st.cmd.trim().split(/\s+/), redact, {
      timeoutMs: ceilingMs, cwd, expect: st.expect, judged: st.judged, gapKeep: st.gapKeep,
    });
    const ms = Date.now() - start;
    // `runClose` only reports `exitCode` on a NON-satisfied verdict (a
    // satisfied close's exit code is implied by `expect`, never re-stated) —
    // this timing pass records it either way, since "which exit code did
    // this stage return" is a cheap, honest thing to keep for `close-timing`.
    const exitCode = typeof r.exitCode === 'number' ? r.exitCode
      : (r.verdict === 'satisfied' && typeof st.expect === 'number' ? st.expect : null);
    perStage.push({
      name: typeof st.name === 'string' ? st.name : st.cmd,
      ms,
      exitCode,
      timedOut: r.verdict === 'timed-out',
    });
  }
  let slowest = null;
  for (const s of perStage) if (slowest === null || s.ms > slowest.ms) slowest = s;
  return {
    perStage,
    slowestMs: slowest ? slowest.ms : 0,
    slowestName: slowest ? slowest.name : null,
    anyTimedOut: perStage.some((s) => s.timedOut),
  };
}

/**
 * The ceiling formula (PRD item 27, M3): `max(FLOOR, K × slowest measured
 * stage)`, unless an explicit override is given — the override is the
 * OPERATOR'S number (the rates-passthrough shape, F113: guesstimate + loud
 * sign + customer override), so it may legally sit ABOVE or BELOW the
 * autoset estimate; this is not tighten-only.
 * @param {{slowestMs: number, overrideMs?: number|null}} args
 * @returns {{ ceilingMs: number, source: 'estimated'|'override' }}
 */
export function computeCloseTimeoutCeiling({ slowestMs, overrideMs = null }) {
  if (typeof overrideMs === 'number' && Number.isFinite(overrideMs)) {
    return { ceilingMs: overrideMs, source: 'override' };
  }
  return { ceilingMs: Math.max(CLOSE_TIMEOUT_FLOOR_MS, CLOSE_TIMEOUT_K * slowestMs), source: 'estimated' };
}

/**
 * ONE resolver for "what per-stage close timeout does this job get", shared
 * by `src/planrun.js` (the in-run path) and `scripts/run-u.mjs` (which must
 * know the answer BEFORE it spawns the outside watchdog — F67 — so the
 * watchdog's own stale/grace windows are sized off the real ceiling rather
 * than a hardcoded guess). Two callers computing this independently is
 * exactly the class of drift this whole rung exists to close (F129's own
 * lesson, one level up): this function is the only place the precedence is
 * spelled out.
 *
 * Precedence: a signed spec override (`job.closeTimeoutMs`) wins outright,
 * with NO timing pass run (the pass would waste real machine time and, on a
 * deliberately slow/hung stage, block for up to `TIMING_PREFLIGHT_CEILING_MS`
 * for no purpose). Absent that, every stage is timed once (F131's autoset
 * design) and the ceiling is `max(FLOOR, K × slowest)`.
 * @param {{job: any, stages: any[], cwd: string, redact?: (s: string) => string, ceilingMs?: number}} args
 *   `ceilingMs` — see `timeCloseStages`; test seam only.
 * @returns {Promise<{
 *   closeTimeoutMs: number|null, source: 'estimated'|'override',
 *   timing: Awaited<ReturnType<typeof timeCloseStages>>|null, timedOut: boolean,
 * }>} `closeTimeoutMs: null, timedOut: true` means a stage never finished the
 *   timing pass — the caller reds `close-timing-red` rather than trusting any
 *   number here.
 */
export async function resolveCloseTimeoutMs({ job, stages, cwd, redact = (s) => s, ceilingMs }) {
  const signedOverride = typeof job?.closeTimeoutMs === 'number' ? job.closeTimeoutMs : null;
  if (signedOverride !== null) {
    return { closeTimeoutMs: signedOverride, source: 'override', timing: null, timedOut: false };
  }
  const timing = await timeCloseStages(stages, { cwd, redact, ...(ceilingMs !== undefined ? { ceilingMs } : {}) });
  if (timing.anyTimedOut) return { closeTimeoutMs: null, source: 'estimated', timing, timedOut: true };
  const computed = computeCloseTimeoutCeiling({ slowestMs: timing.slowestMs });
  return { closeTimeoutMs: computed.ceilingMs, source: computed.source, timing, timedOut: false };
}

/**
 * The printed banner (build spec M3 §2's exact wording) — ONE spelling, so
 * the run-u tail and the bundle CLI can never drift into two announcements of
 * the same number. `source` accepts 'explicit' too: a caller-passed
 * `closeTimeoutMs` runtime option (the pre-M3 shell/test knob, kept for
 * backward compatibility and test control — never the signed spec field) is
 * a real override but not a SIGNED one, so it earns its own honest word
 * rather than being folded into 'signed override'.
 * @param {{ceilingMs: number, source: 'estimated'|'override'|'explicit', slowestMs?: number, slowestName?: string|null}} args
 * @returns {string}
 */
export function closeTimeoutBanner({ ceilingMs, source, slowestMs, slowestName }) {
  const seconds = Math.round(ceilingMs / 1000);
  if (source === 'override') return `close timeout: ${seconds}s per stage (signed override)`;
  if (source === 'explicit') return `close timeout: ${seconds}s per stage (explicit runner override)`;
  return `close timeout: ${seconds}s per stage (estimated from seed timing: slowest ${slowestName ?? '<none>'} ${slowestMs ?? 0}ms × ${CLOSE_TIMEOUT_K}, floor ${Math.round(CLOSE_TIMEOUT_FLOOR_MS / 1000)}s)`;
}
