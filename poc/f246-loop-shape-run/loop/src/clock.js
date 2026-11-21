// borrowed-from: bareloop src/clock.js@v0.61.0 (fc56e1f3)
// T's wall clock — the shell's time instrument (PRD v1.27/v1.29; materials
// design record 2026-07-26, addenda 1 and 3).
//
// Time is arbiter territory with exactly `budgetUsd`'s status: operator input,
// the agent may tighten and never widen, never self-raised. The agent has no time
// field in the plan vocabulary at all (addendum 2), so nothing here is reachable
// from an agent-authored document — this module is read by the runner only.
//
// Three measured facts shape it, none of them assumed:
//
//   1. `loop.stop()` CANNOT cut an in-flight call. Measured (F61/C1): fired at
//      500ms against a 4,000ms hanging generate(), run() returned at 4,018ms.
//      bare-agent reads the flag at the round boundary (loop.js:661) and between
//      tool calls (:916). So a wall deadline is a BETWEEN-ROUND check, and
//      enforcement is `maxWallMs + closeStages × closeTimeoutMs` — reported, never
//      rounded down to the requested number (F6 in a time coat). The multiplier is
//      W5: a STAGED close (PRD v1.28) runs its stages one at a time and hands EACH
//      one the full `closeTimeoutMs` (`runStages` → `runClose`, ralph.js:257), so a
//      4-stage close at 900s is 60 minutes of close, not 15. The runner's own
//      outside watchdog already sized its stale window this way
//      (scripts/run-u.mjs: `CLOSE_TIMEOUT_MS * spec.close.length`); the clock
//      quoting the 1× number was the same arithmetic disagreeing with itself.
//      That figure counts ONE close, and the RUNNER is what holds both of its loops
//      to one: past the deadline it refuses to open a new fix iteration and stops on
//      the verdict the last close already minted (W-2), and it refuses to open a
//      STEP's attempt on the same reading — a step that would begin past the deadline
//      is never funded. Before that second refusal a step starting with zero time left
//      burned every attempt it was allowed (measured on the real flow: three attempts,
//      three judged exits, all past the deadline), because the variance meter scores a
//      step's time share against what the run had left when the step BEGAN and so is
//      structurally blind to a step that began with nothing.
//      It is still not a universal bound and is not claimed as one. Two overshoots
//      remain outside this number, both deliberate. A step ALREADY UNDER WAY when the
//      deadline trips finishes its attempt and runs its own exit checks (themselves
//      close stages, at the full timeout each): grading real work always completes, or
//      the run is unreadable after the money is spent. And that same mid-step deadline
//      still routes through the ONE replan — the meter's own terminal, unchanged — so
//      it pays a drafting call (floored at MIN_CALL_TIMEOUT_MS) before the new plan's
//      first step is the one refused.
//   2. BA-18's provider timeout is the only instrument that fires on the ABSENCE
//      of events. Measured (F61/C2): 1,259ms against a socket that accepts and
//      never answers; without it the bound is the OS TCP timeout (~2h). Deriving
//      it from the remaining budget is what stops the LAST round outliving the run.
//   3. ~90% accuracy is the bar, by hamr's ruling (addendum 3). This module does
//      not chase precision; it reports honestly at the precision it has.
//   4. SUSPENDED MINUTES NEVER CHARGE A SIGNED WALL (hamr's ruling, 2026-08-15:
//      "if computer suspended, time shouldn't count"). The default source is
//      therefore MONOTONIC — `performance.now()`, which reads libuv's `uv_hrtime`
//      and so CLOCK_MONOTONIC, which per clock_gettime(2) "does not count time
//      that the system is suspended" on Linux (CLOCK_BOOTTIME is the one that
//      would). `Date.now()` is CLOCK_REALTIME and counts every suspended minute:
//      that was not a hypothetical, it charged 45 phantom minutes against a
//      45-minute wall when an s2idle suspend landed mid-run, and it is the same
//      exposure for an NTP step or a hand-set date. Nothing here corrects for a
//      suspend after the fact; the reading simply never includes one.
//      The epoch change is safe by construction: every use of `now()` below is
//      RELATIVE (`now() - startedAt`), and no value derived from this clock is
//      ever published as a calendar timestamp — `report()` carries durations only,
//      and the `at:`/`ts:` stamps a run writes come from their own `Date.now`
//      seams (src/reuse.js), which stay calendar-correct on purpose.
//
// Unbounded is a REAL state, not a large number: hamr ruled `maxWallMs` has no
// default, so a run without one is time-unbounded by explicit operator choice and
// says so (F45 — a defaulted cap is a silent second ceiling).

/** BA-18's default request/idle timeout (`AnthropicProvider.timeoutMs`), the
 * ceiling every derived per-call timeout starts from. Kept in sync deliberately:
 * a value ABOVE the provider's own default would be inert. */
export const PROVIDER_TIMEOUT_MS = 600_000;

/**
 * The floor for a derived per-call timeout. Below this a call cannot plausibly
 * succeed, and a timeout that is certain to trip manufactures a `provider-red`
 * out of a time budget — a transport CASUALTY, which is never evidence
 * (F45/F48). The deadline check is what must stop a run out of time; the per-call
 * timeout exists to bound a HANG, not to enforce the budget's last second.
 */
export const MIN_CALL_TIMEOUT_MS = 30_000;

/** bare-agent's rejection code when its request/idle timeout trips (BA-18,
 * `provider-http.js` → `TimeoutError`). The error carries a `code` and NO
 * `category`, so every consumer that defaults an uncategorised throw would file
 * it as transport. */
export const TIMEOUT_CODE = 'ETIMEDOUT';

/** bare-agent's rejection code when its TOTAL-duration deadline trips (BA-19,
 * `provider-http.js` → `applyRequestDeadline`). A DIFFERENT code from the idle
 * bound's on purpose — upstream splits them precisely so a consumer routing
 * governance stops apart from transport casualties can tell which timer fired. Like
 * `TIMEOUT_CODE` it carries no `category`, so every default-to-transport catch site
 * would file it as a casualty. */
export const DEADLINE_CODE = 'EDEADLINE';

/**
 * F64 — is this throw the run's OWN deadline coming back dressed as a provider
 * error? `callTimeoutMs()` hands the provider a bound derived from the wall, so
 * when the wall is what shrank that bound, the resulting `TimeoutError` is a
 * GOVERNANCE stop, not a casualty. Filing it as `provider-red` would discard it
 * (a casualty is never evidence, F45/F48) and attach the F44
 * `spendComplete:false` floor to a run that simply ran out of time.
 *
 * The discriminator is the wall itself, not the derived number: on a bounded
 * clock a trip can only precede expiry when the bound came from the provider's
 * own default (`remainingMs() > PROVIDER_TIMEOUT_MS`), and that case is transport
 * by construction. So "already expired" IS the wall-derived set. An unbounded run
 * can never produce one, and needs no separate `bounded` term to say so —
 * `expired()` is false by construction with no cap. (A mutation run proved the
 * extra term inert; the unbounded case is guarded by its own test instead, which
 * is where that invariant belongs.)
 *
 * A genuine dead socket on a run whose wall has ALSO passed reads as a wall-halt.
 * That is deliberate and honest: the run is out of time either way, the remedy is
 * the same (raise `maxWallMs`), and the alternative — calling a governance stop
 * transport on the chance that it was — is the failure this closes.
 *
 * BOTH derived bounds land here, because both are derived from the same wall:
 * BA-18's idle timeout (`callTimeoutMs`) and BA-19's total-duration deadline
 * (`callDeadlineMs`). Adding the second CODE does not widen the rule — the
 * discriminator is still `clock.expired()`, never the code. That matters for the
 * deadline specifically: a provider someone else constructed with its own
 * `deadlineMs` could throw this code on a run with time left, and that is transport,
 * exactly as it was before.
 *
 * @param {any} err the throw as caught
 * @param {Clock} clock the run's clock
 * @returns {boolean}
 */
export function isWallTimeout(err, clock) {
  return !!err && (err.code === TIMEOUT_CODE || err.code === DEADLINE_CODE) && clock.expired();
}

/**
 * @typedef {object} Clock
 * @property {boolean} bounded whether the operator set a cap at all
 * @property {number|null} requestedMs the operator's number; `null` when unbounded
 * @property {number} closeStages how many close stages one verdict can pay for (W5)
 * @property {() => number} elapsedMs wall time since the clock was created
 * @property {() => number} remainingMs what is left, floored at 0; `Infinity` when unbounded
 * @property {() => boolean} expired whether the deadline has passed (always false when unbounded)
 * @property {(closeTimeoutMs: number) => number|null} enforcedMs the HONEST worst case
 * @property {(providerDefaultMs?: number) => number} callTimeoutMs the derived per-call bound
 * @property {() => number|null} callDeadlineMs the derived per-call TOTAL-duration ceiling; `null` when unbounded
 * @property {(closeTimeoutMs: number) => object} report one spine-safe shape carrying both numbers
 */

/**
 * Start a wall clock for one run.
 * @param {{ maxWallMs?: number|null, closeStages?: number, now?: () => number, priorElapsedMs?: number }} [opts]
 *   `maxWallMs`: the signed operator cap, or absent/null for an honestly unbounded
 *   run. `closeStages`: how many stages the job's close runs (W5) — each one gets
 *   the FULL `closeTimeoutMs`, so this is the multiplier on the overshoot, not a
 *   decoration. Defaults to 1, the single-predicate close. `now`: injected for
 *   tests — the default is the real clock, and it stays injectable precisely so
 *   every test here can drive time deterministically without a sleep. That default
 *   is MONOTONIC (fact 4 above), not `Date.now`: a wall-clock jump — a suspend, an
 *   NTP step, a hand-set date — must not be able to reach a signed deadline.
 *   `priorElapsedMs`: time this attempt's PREDECESSOR already consumed (see below).
 * @returns {Clock}
 */
export function createClock({ maxWallMs = null, closeStages = 1, now = () => performance.now(), priorElapsedMs = 0 } = {}) {
  // RESUME (module C) — hamr's checkpoint ruling in a time coat: a run killed
  // mid-try restarts THAT try under the REMAINDER of its signed per-try numbers,
  // because "a budget ceiling folds in prior spend so re-invoking cannot silently
  // widen it". The fold happens HERE rather than by editing `maxWallMs`, and that
  // is the whole point: the cap the operator signed stays the number reported and
  // the number hashed (a rewritten cap is a new spec version needing a new
  // signature), while the clock simply starts already partly spent. A fresh
  // allotment on every kill would let a resumed run outlive the worst case the
  // operator signed, one kill at a time.
  //
  // Belted like `maxWallMs` above: a non-finite, negative or garbage fold is 0. A
  // NaN here would make every comparison false and silently unbound the run, which
  // is the inverse of what the fold exists to do.
  const prior = typeof priorElapsedMs === 'number' && Number.isFinite(priorElapsedMs) && priorElapsedMs > 0 ? priorElapsedMs : 0;
  const startedAt = now() - prior;
  // A cap is only a cap if it is a usable positive number. validateJob already
  // reds anything else, so this is the belt (a caller that hand-builds a spec
  // must not be able to turn a garbage value into a silent unbounded run OR a
  // silent instant expiry).
  const bounded = typeof maxWallMs === 'number' && Number.isFinite(maxWallMs) && maxWallMs > 0;
  const cap = bounded ? maxWallMs : null;
  // The same belt on the stage count. A close always runs at least once, so 1 is
  // the floor: a 0 or a NaN sneaking in here would quote an enforced number BELOW
  // the requested cap, which is the dishonesty this multiplier exists to remove.
  const stages = typeof closeStages === 'number' && Number.isFinite(closeStages) && closeStages >= 1
    ? Math.floor(closeStages) : 1;
  /** the ONE arithmetic, so the advertised record and the enforced worst case
   * cannot be computed two ways (the two-transforms class, F9). */
  const enforced = (/** @type {number} */ closeTimeoutMs) => (cap === null ? null : cap + stages * closeTimeoutMs);

  const elapsedMs = () => now() - startedAt;
  const remainingMs = () => (cap === null ? Infinity : Math.max(0, cap - elapsedMs()));
  // Inclusive: AT the deadline is out of budget. A run resumes to cap, and the
  // stop IS the checkpoint (v1.12) — so stopping one round early is correct and
  // stopping one round late is the overshoot addendum 1 quantifies.
  const expired = () => cap !== null && elapsedMs() >= cap;

  return {
    bounded,
    requestedMs: cap,
    closeStages: stages,
    elapsedMs,
    remainingMs,
    expired,
    enforcedMs: enforced,
    callTimeoutMs: (providerDefaultMs = PROVIDER_TIMEOUT_MS) => {
      if (cap === null) return providerDefaultMs;
      // Clamped BOTH ways. Upper: never above the provider's own default, which
      // would be inert. Lower: never below MIN_CALL_TIMEOUT_MS, and in
      // particular never 0 — `0` DISABLES the provider timeout entirely
      // (provider-anthropic.js), which is the exact opposite of the intent and
      // would restore the ~2h OS-TCP hang on the last round of a tight budget.
      return Math.min(providerDefaultMs, Math.max(MIN_CALL_TIMEOUT_MS, remainingMs()));
    },
    // BA-19 (F72 park D) — the TOTAL-duration ceiling beside the idle one. The idle
    // bound resets on every byte, so a response that trickles forever never trips it
    // (F66's 274-minute call, and F67's 81.5-minute freeze happened above it); this
    // one is a plain timer that no byte resets.
    //
    // Three properties, each a rule this repo already paid for:
    //   - NULL when unbounded. An operator who set no wall gets no ceiling — a
    //     defaulted cap is a silent second ceiling (F45, and the reason `maxWallMs`
    //     has no default). The caller must OMIT the knob on null, not pass a number.
    //   - REMAINING, read at call time. A constant would bound the last call by the
    //     first call's budget, which is the thing `callTimeoutMs` already refuses.
    //   - NOT clamped to the provider default. That upper clamp exists on the idle
    //     bound because a value above the provider's own default is inert; a
    //     total-duration ceiling above it is the entire point of BA-19.
    // The lower floor is shared with `callTimeoutMs` and for the same two reasons: a
    // bound certain to trip manufactures a stop out of arithmetic, and `0` DISABLES
    // the bound upstream (`if (!(deadlineMs > 0)) return`) — the exact inverse of the
    // intent. A trip past the floor is still honest: the wall has expired by then, so
    // `isWallTimeout` reads it as the governance stop it is.
    callDeadlineMs: () => (cap === null ? null : Math.max(MIN_CALL_TIMEOUT_MS, remainingMs())),
    report: (closeTimeoutMs) => ({
      bounded,
      requestedMs: cap,
      // On the record, not just in the arithmetic: without it a reader seeing
      // enforced 90min against a requested 30min cannot tell a 60-minute close
      // timeout from four 15-minute stages, and an unexplained gap is exactly the
      // kind of number a later reader rounds back down to the requested one.
      closeStages: stages,
      enforcedMs: enforced(closeTimeoutMs),
      elapsedMs: elapsedMs(),
      // null, not Infinity: JSON.stringify turns Infinity into null anyway, and
      // an append-only record must not depend on that coincidence — worse, a
      // downstream `?? 0` on an Infinity would read as "no time left" (F6 class).
      remainingMs: cap === null ? null : remainingMs(),
    }),
  };
}
