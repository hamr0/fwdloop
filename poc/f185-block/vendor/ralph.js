// borrowed-from: bareloop src/ralph.js@v0.56.0 (3383cce)
// The outer shell — fixed, deliberately dumb, permanent (PRD §4). It holds the
// arbiter (the close: exit code = truth) and the iteration budget, and nothing
// inside negotiates with either (design law #1: the agent never authors its
// arbiter). Stateless across runs and stdlib-only by design: it must stay too
// dumb to be gamed. Do not make it smarter.

import { spawn } from 'node:child_process';

// ── the close's child process, run WITHOUT freezing the host (F68) ───────────
// The close used to run through `spawnSync`, which blocks the host event loop for
// the child's entire duration: F68 measured 9 loop-freeze records in one green run
// (worst 74.3s, bracketing a ~65s close exactly) and 4 more bracketing three
// check-preflights — "the close-runner freezes the loop it reports to". While a
// close ran, the stall fuse's timers could not fire, the lag sampler recorded a
// block, and any in-flight instrument shared the freeze.
//
// ONLY THE WAIT IS ASYNC. Every observable semantic below is spawnSync's own,
// replicated field for field, because the close is the arbiter and its reading of
// the world must not shift by a byte:
//   - the same `{error, status, signal, stdout, stderr}` result shape;
//   - the same 1 MiB PER-STREAM output ceiling, reported the same way spawnSync
//     reports it — an `ENOBUFS` error with the child killed (so an over-long close
//     stays `failed`/broken-close, exactly as before, rather than silently
//     becoming a red on truncated output);
//   - the same deadline behaviour: SIGTERM at `timeoutMs`, surfaced as an
//     `ETIMEDOUT` error (which runClose reads BEFORE any exit code, so the
//     forbidden zone's `timed-out` band is unchanged);
//   - the same stdin: closed immediately, so a close that reads stdin sees EOF
//     instead of hanging on a pipe nobody will ever write to.
// The one deliberate difference is prose: a spawn fault names itself `spawn …`
// rather than `spawnSync …` in its message, because that is now what happened.
// Nothing parses that string (it rides out as an escalation `detail`).
const CLOSE_MAX_BUFFER = 1024 * 1024; // spawnSync's default maxBuffer, per stream
const CLOSE_KILL_SIGNAL = 'SIGTERM';  // spawnSync's default killSignal
// SIGTERM is a REQUEST, and a close is free to refuse it — a runner installing its
// own handler, a wrapper that traps to clean up. There is no second deadline after
// the first, so a refused SIGTERM leaves the wait below pending FOREVER: no `close`
// event ever arrives, and the run's only remaining stop is the out-of-process
// watchdog. The grace is the escalation — long enough for an honest close to flush
// and leave on its own terms, then SIGKILL, which nothing can refuse. Verdict
// semantics are untouched: the FIRST fault already named the outcome, and the kill
// only enforces it. (spawnSync sends killSignal and then simply keeps waiting; this
// is the one place the arbiter's clock is deliberately harder than its reference.)
const CLOSE_KILL_GRACE_MS = 2000;

/**
 * @param {string} cmd
 * @param {string[]} args
 * @param {{env: NodeJS.ProcessEnv, cwd?: string, timeoutMs?: number}} o
 * @returns {Promise<{error: (Error & {code?: string})|null, status: number|null, signal: string|null, stdout: string, stderr: string}>}
 */
export function spawnClose(cmd, args, { env, cwd, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { env, cwd });
    /** @type {Buffer[]} */ const outChunks = [];
    /** @type {Buffer[]} */ const errChunks = [];
    let outBytes = 0, errBytes = 0;
    /** @type {(Error & {code?: string})|null} */
    let error = null;
    /** @type {NodeJS.Timeout|undefined} */
    let timer;
    /** @type {NodeJS.Timeout|undefined} */
    let killTimer;

    // The FIRST fault wins and kills the child, exactly as spawnSync does: a close
    // that blew the buffer and then hit the deadline is one story, not two. The
    // escalation rides inside that same first-fault-wins guard, so a child is asked
    // once and, if it refuses, ended once.
    const fault = (/** @type {string} */ code) => {
      if (error) return;
      error = Object.assign(new Error(`spawn ${cmd} ${code}`), { code, syscall: `spawn ${cmd}`, path: cmd, spawnargs: args });
      try { child.kill(CLOSE_KILL_SIGNAL); } catch { /* already gone — nothing to kill */ }
      // …and SIGKILL if it is still there after the grace. `unref` so this timer can
      // never hold the host's event loop open by itself (F68's whole point) — and it
      // is cleared on `close`, so it cannot fire at a child that already left.
      killTimer = setTimeout(() => { try { child.kill('SIGKILL'); } catch { /* gone in the meantime */ } }, CLOSE_KILL_GRACE_MS);
      killTimer.unref();
    };

    child.stdout.on('data', (/** @type {Buffer} */ c) => { outBytes += c.length; outChunks.push(c); if (outBytes > CLOSE_MAX_BUFFER) fault('ENOBUFS'); });
    child.stderr.on('data', (/** @type {Buffer} */ c) => { errBytes += c.length; errChunks.push(c); if (errBytes > CLOSE_MAX_BUFFER) fault('ENOBUFS'); });
    // A spawn failure (ENOENT, an unreadable cwd) arrives as an event here and as
    // `result.error` in spawnSync; `close` still fires after it, so there is ONE
    // resolution path and the promise can never be left pending.
    child.on('error', (e) => { if (!error) error = e; });
    child.on('close', (status, signal) => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      resolve({
        error, status, signal,
        // Concat-then-decode, never per-chunk: a multi-byte character straddling a
        // chunk boundary must not become two replacement characters — spawnSync
        // decodes the whole buffer once, and the judged/gapKeep patterns read this.
        stdout: Buffer.concat(outChunks).toString('utf8'),
        stderr: Buffer.concat(errChunks).toString('utf8'),
      });
    });
    if (typeof timeoutMs === 'number' && timeoutMs > 0 && Number.isFinite(timeoutMs)) timer = setTimeout(() => fault('ETIMEDOUT'), timeoutMs);
    // stdin closed at once (spawnSync with no `input` hands the child EOF): a close
    // that reads stdin gets the same EOF instead of blocking on an idle pipe. The
    // error swallow is for the ordinary case where the child has already exited.
    child.stdin?.on('error', () => {});
    child.stdin?.end();
  });
}

/**
 * What the close child must NOT be able to read (operator ruling, 2026-07-31:
 * "strip it when unnecessary, minimize unneeded exposure").
 *
 * The close child executes WORKER-AUTHORED CODE. `pytest`, `npm test`, `tsc`
 * run whatever the worker just wrote into the tree, in a child that — before
 * this — inherited the whole operator environment, credentials included. None
 * of git/npm/tsc/pytest/mypy needs an API key to judge a tree, so the exposure
 * bought nothing and is removed. This is EXPOSURE REDUCTION, not a sandbox:
 * see the threat-model note in the PRD (v1.41) and README for what remains.
 *
 * Two rules, deliberately kept BOTH ways round:
 *  - `names` / `prefixes` — the knowns. A literal denylist is a chase (every
 *    new provider mints a new variable), so it is not load-bearing on its own;
 *    it exists for names the shape rule STRUCTURALLY cannot see — either no
 *    `_`-bounded credential suffix at all (`AWS_ACCESS_KEY_ID`, `PGPASSWORD`,
 *    `MYSQL_PWD`), a `*_KEY` that is not `*_API_KEY` (`SSH_PRIVATE_KEY`), or a
 *    BARE spelling with nothing in front of the suffix (`TOKEN`, `SECRET`).
 *    Names are matched EXACTLY, which is what keeps connection config out of
 *    the strip (`PGHOST`, `SECRETS_DIR`, `TOKENIZERS_PARALLELISM` all survive).
 *  - `shape` — the NAME-SHAPE rule, which is what bounds the chase: anything
 *    whose name ends in the credential suffixes goes, whoever minted it and
 *    whether or not anyone here has heard of it. Case-insensitive; no `g` flag,
 *    so `.test` stays stateless and safe to reuse across every key.
 *
 * It is arbiter territory like the rest of this file: no drafted plan or config
 * can express, widen, or opt out of it.
 * @type {Readonly<{names: readonly string[], prefixes: readonly string[], shape: RegExp}>}
 */
export const CLOSE_ENV_DENY = Object.freeze({
  names: Object.freeze([
    // provider keys
    'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY',
    'ANTHROPIC_AUTH_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN', 'NPM_TOKEN',
    // credential spellings the shape rule structurally cannot see, because their
    // names carry no `_`-bounded suffix (operator ruling 2026-07-31, "add", on a
    // delta-review finding that MEASURED every one of these reaching the child).
    // Documented tools' own variables, not invented ones:
    'PGPASSWORD', 'PGPASSFILE', 'PGSSLKEY',   // libpq (`PGPASS` is NOT a libpq variable — the FILE is ~/.pgpass, named by PGPASSFILE)
    'MYSQL_PWD', 'REDISCLI_AUTH',             // mysql client, redis-cli
    'STRIPE_KEY', 'STRIPE_SECRET_KEY',        // `*_KEY` is not `*_API_KEY`: the shape rule misses it
    'SSH_PRIVATE_KEY', 'PRIVATE_KEY', 'SECRET_KEY',
    'TOKEN', 'SECRET', 'API_KEY', 'PASSWORD', 'PASSWD', // the bare spellings; a suffix rule needs a prefix to bound
  ]),
  prefixes: Object.freeze(['AWS_']),
  shape: /(_API_KEY|_SECRET|_TOKEN|_PASSWORD|_CREDENTIALS?)$/i,
});

/**
 * Run a close command; its exit code is the verdict (hard green, PRD §4).
 * `expect` → satisfied; any other exit → needs_revision (gap fed back).
 *
 * THE FORBIDDEN ZONE (PRD v1.11, F17; adaptlearn F25/V10). The two clean bands
 * are green (exit == expect, judgment rendered) and red (exit != expect,
 * judgment rendered). Every other outcome rendered NO JUDGMENT and is therefore
 * NOT A VERDICT — it gets its own name and escalates; coercing one into a
 * verdict IS the instrument fault (law #8 generalized):
 *   - `failed`    — the close cannot RUN (spawn error).             → broken-close
 *   - `timed-out` — it ran and never finished judging.              → close-timeout
 *   - `killed`    — it died by signal (status null, no spawn error). → close-killed
 *   - `crashed`   — it ran, exited, and judged nothing.             → close-crashed
 * `timed-out` is split OUT of `failed` deliberately: "raise the timeout" and
 * "fix the argv" are different human decisions, so pooling them erases the
 * decision information the escalation exists to carry.
 *
 * `judged` is the judgment-rendered signal, and it is the hard one. Exit code
 * ALONE cannot separate a crash-at-load from an honest red — they are
 * byte-identical at this seam, and against `node --test` so are the test counts
 * (node synthesizes ONE failing test for the file that crashed, so a crash
 * reports `tests 1 / fail 1`, exactly like a one-assertion failure). So the
 * signal cannot be "zero judged"; it must be a FLOOR against a declared
 * baseline: litectx runs ~390 tests, and a run claiming it judged 1 did not
 * judge. `judged.pattern` extracts one integer from the close's own (redacted)
 * output; below `judged.min` the close crashed, WHATEVER its exit code says —
 * and that check runs on the GREEN side too: a close that exits 0 having judged
 * nothing is a confident fake green, the only real failure there is (law #8).
 * `judged` is OPTIONAL — a linter or a hitl close may have no count to give —
 * and its absence stamps `unaudited: true` so the blind spot is NAMED on the
 * record rather than passed off as a trustworthy exit code.
 *
 * `redact` scrubs the close's own output at the SOURCE — before the gap becomes
 * a spine event or a worker prompt — so a secret a checked command echoes
 * (a 401 dumping an `Authorization: Bearer …` header) never enters the
 * append-only spine (the hard line). It is INJECTED, not imported: the shell
 * stays stdlib-only and un-gameable, and the redactor is a fixed shell
 * primitive (bareguard's, wired by the interpreter), never an emergent
 * component — so V4 holds. The shell's canonical emission IS the redacted text;
 * a benign gap is returned byte-identical (default: identity).
 * `cwd` is where the close RUNS, and it is load-bearing (F8): a close is a
 * command in a repository — `npm test`, `make check` — and every one of them is
 * cwd-relative. Run it anywhere but the workdir and the arbiter judges the wrong
 * tree: exit-code-is-truth silently becomes exit-code-of-some-other-repo-is-truth.
 * The default (the runner's own cwd) exists only for callers with an absolute
 * close; the runner and the interpreter always pass the workdir.
 *
 * `gapKeep` (F28) is a regex SOURCE whose matching lines are PRESERVED through
 * the gap bound in addition to the head/tail sample: a large TAP suite prints
 * its `not ok` lines in the middle of the stream, exactly where `boundGap`
 * elides — so the failing-test NAMES (the causal input the worker navigates on)
 * were deleted in transit and the worker was told "5 fail" and never WHICH. It
 * is arbiter territory like the rest here: the drafted config cannot express it.
 *
 * @param {string[]} close argv, e.g. ['node', '--test', 'close/']
 * @param {(s: string) => string} [redact] source scrubber; identity by default
 * @param {{ timeoutMs?: number, cwd?: string, expect?: number, judged?: {pattern: string, min: number}, gapKeep?: string, closeDir?: string|null }} [opts]
 *   close wall-clock cap (operator-set via the runner, never the config's — the
 *   agent must not author its arbiter's clock), the directory the close runs in
 *   (the workdir — the tree it is judging), the exit code the SIGNED spec calls
 *   success, the judgment-rendered signal, and the kept-failures pattern. All
 *   five are arbiter territory: the drafted workflow config cannot express any.
 *   `closeDir` (PRD item 27/M3 Part B) is the close's OWN books directory —
 *   pristine copies, calibration thresholds, logs — deliberately outside the
 *   patient tree (the worker must never read the arbiter's books). Handed to
 *   the child as `BARELOOP_CLOSE_DIR` (`CLOSE_DIR_ENV_VAR`,
 *   src/close-integrity.js); a close script that needs one and gets none
 *   instrument-stops itself, by the script's own contract — this seam only
 *   ever THREADS the value, it never invents one.
 * @returns {Promise<{verdict: 'satisfied'|'needs_revision'|'failed'|'timed-out'|'killed'|'crashed',
 *   gap?: string, exitCode?: number, signal?: string, detail?: string,
 *   judgedCount?: number|null, unaudited?: boolean}>}
 */
export async function runClose(close, redact = (s) => s, { timeoutMs = 120_000, cwd, expect = 0, judged, gapKeep, closeDir = null } = {}) {
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT; // a `node --test` close inherits this from a test runner and silently no-ops — a fake green
  // …and the operator's credentials go with it (CLOSE_ENV_DENY above). A COPY is
  // stripped, never `process.env` itself: the host still needs its key (bare-agent
  // reads it every round) — only the child that runs worker-authored code is blinded.
  for (const name of Object.keys(env)) {
    if (CLOSE_ENV_DENY.names.includes(name)
      || CLOSE_ENV_DENY.prefixes.some((p) => name.startsWith(p))
      || CLOSE_ENV_DENY.shape.test(name)) delete env[name];
  }
  // PRD item 27/M3 Part B — a `BARELOOP_` name, deliberately not matched by
  // any CLOSE_ENV_DENY rule above (checked: no name/prefix/suffix entry there
  // touches it), set AFTER the strip loop so it can never be stripped by a
  // future denylist edit either. Only set when the runner actually has one —
  // an empty/absent `closeDir` leaves the child's env exactly as it was
  // before this rung, so a script that never reads the variable is unaffected.
  if (typeof closeDir === 'string' && closeDir.length > 0) env.BARELOOP_CLOSE_DIR = closeDir;
  const r = await spawnClose(close[0], close.slice(1), { env, cwd, timeoutMs });

  // ── forbidden zone, before any exit code is believed ──────────────────────
  if (r.error) {
    // The runner reports BOTH "cannot run" and "ran too long" through `error`;
    // they are different human decisions, so they get different names.
    const code = /** @type {NodeJS.ErrnoException} */ (r.error).code;
    if (code === 'ETIMEDOUT') return { verdict: 'timed-out', detail: `close exceeded ${timeoutMs}ms and was killed — it never finished judging` };
    return { verdict: 'failed', detail: String(r.error) };
  }
  // No spawn error and no exit status: the close died by signal (OOM, an
  // external kill). It did not fail — it never rendered an opinion.
  if (r.status === null) {
    return { verdict: 'killed', signal: r.signal ?? undefined, detail: `close died by signal ${r.signal ?? 'unknown'} — no judgment was rendered` };
  }

  // Redact at the SOURCE, before anything is read back: the count is extracted
  // from scrubbed text, so a secret in the close's output can never ride out on
  // the judged path any more than it can on the gap path (the hard line).
  const out = redact(r.stdout || '');
  const err = redact(r.stderr || '');

  // ── the judgment-rendered signal: did this close actually judge anything? ──
  // Checked on BOTH bands — an exit-0 close that judged nothing is a fake green.
  let judgedCount;
  if (judged) {
    const m = new RegExp(judged.pattern, 'm').exec(`${out}\n${err}`);
    const n = m ? Number(m[1]) : NaN;
    judgedCount = Number.isFinite(n) ? n : null; // honest null: no number rendered (F6)
    if (judgedCount === null || judgedCount < judged.min) {
      return {
        verdict: 'crashed', judgedCount, exitCode: r.status,
        detail: `close judged ${judgedCount ?? 'nothing'} of a declared floor of ${judged.min} — it exited ${r.status} without rendering judgment (a crash, not a verdict)`,
      };
    }
  }

  if (r.status === expect) return { verdict: 'satisfied', ...(judged ? { judgedCount } : { unaudited: true }) };
  // The gap must never be falsy: every consumer guards with `if (gap)` — an
  // empty-output red would silently kill gap feedback, after-red hooks, AND
  // stall detection, leaving the worker re-prompted byte-identically to the cap.
  // Bound AFTER redaction so a token straddling the bound can't survive.
  // BOTH streams, not one (F28 hazard): the old `err || out` returned stderr
  // ALONE whenever it was non-empty, so a close writing its `not ok` lines to
  // stdout while emitting any stderr noise lost the failures entirely, before
  // the bound ever ran. Combine them (out then err, matching the judged path's
  // `${out}\n${err}`); both empty still falls to the no-output message.
  const combined = [out, err].filter(Boolean).join('\n');
  return {
    verdict: 'needs_revision',
    gap: boundGap(combined, gapKeep) || `(close exited ${r.status}, expected ${expect}, with no output)`,
    exitCode: r.status,
    ...(judged ? { judgedCount } : { unaudited: true }),
  };
}

/**
 * The staged gap's header — WHICH wall the close stopped at, in front of that
 * wall's own output. A worker handed three stages' worth of output cannot tell
 * which one it must satisfy, and `src/trend.js` parses this exact line to bucket
 * a grade per stage (its `STAGE_HEADER`).
 *
 * Exported for the one reason `GAP_KEEP_TRIM_MARKER` is: a SECOND executor now
 * renders staged gaps (`src/declaredclose.js`, the declared close), and two
 * spellings of this line would be two instruments — the reader would silently
 * stop bucketing whichever one drifted. Behaviour here is unchanged; this is the
 * same template, named.
 * @param {string} name @param {string} gap
 */
export const stageGap = (name, gap) => `close stage "${name}" failed:\n${gap}`;

/**
 * Run a STAGED close (PRD v1.28) — an ordered list of named command stages, run
 * in order until one renders a verdict that is not `satisfied`. The return is
 * runClose's own shape, so every consumer (the precheck, ralph's judge, the
 * escalation's CLOSE_FAULTS routing) is unchanged: a staged close is still ONE
 * verdict, not a scoreboard.
 *
 * Two additions, both mechanical information the worker can act on:
 *  - `stage` names which stage rendered the verdict. The close's output must
 *    never name the CULPRIT FILE (v1.12/F28 — the worker finds that itself), and
 *    naming the wall it hit is the opposite of that: it is the mechanical genre
 *    that converts (F38/F46), not the answer.
 *  - `stages` is the ordered record of what actually ran. A stage after the
 *    first red never runs, so a later green can never mask an earlier failure.
 *
 * The same function runs a DERIVED CHECK: a check is its stage's chain
 * (`checkMenu` puts the prerequisites first), so there is one execution path for
 * the close and for the rulers derived from it — never two, which is the F9
 * two-transforms class applied to the arbiter.
 *
 * @param {any[]} stages the stage list (already validated by validateJob)
 * @param {(s: string) => string} [redact] scrub, applied at capture on EVERY stage
 * @param {{timeoutMs?: number, cwd?: string, closeDir?: string|null}} [opts]
 * @returns {Promise<any>} runClose's verdict shape, plus `stage` and `stages`
 */
export async function runStages(stages, redact = (s) => s, /** @type {{timeoutMs?: number, cwd?: string, closeDir?: string|null}} */ { timeoutMs, cwd, closeDir } = {}) {
  const ran = [];
  let last;
  for (const st of stages) {
    // Sequential by construction (F68): stages run one at a time under a single
    // await, so nothing here ever has two closes in flight against one tree.
    const r = await runClose(st.cmd.trim().split(/\s+/), redact, {
      timeoutMs, cwd, expect: st.expect, judged: st.judged, gapKeep: st.gapKeep, closeDir,
    });
    ran.push({ name: st.name, verdict: r.verdict, ...(r.exitCode !== undefined ? { exitCode: r.exitCode } : {}) });
    last = r;
    if (r.verdict !== 'satisfied') {
      return {
        ...r,
        stage: st.name,
        stages: ran,
        // The gap says WHICH wall, then the wall's own output (`stageGap`, the
        // one spelling — the declared executor renders the same header).
        ...(r.gap ? { gap: stageGap(st.name, r.gap) } : {}),
      };
    }
  }
  return { ...last, stages: ran };
}

// Tail-biased bound: a test runner's useful output (the assertion diff, the
// failing case name) is at the END; head-only truncation fed the worker the
// preamble and dropped the cause (N2 queue, F2). Head sample kept so "what ran"
// stays visible; the truncation marker is hygiene, not load-bearing (F3).
const GAP_HEAD = 400, GAP_TAIL = 1500;
// The keep-block cap (F28): a large suite's `not ok` lines live in the elided
// middle, so gapKeep re-surfaces them — but a pathological close (thousands of
// matching lines) could rebuild the very 67KB bloat the bound exists to prevent.
// Hard-capped by BOTH lines and bytes, whichever binds first; when the cap trims
// matches it says so with an explicit marker — silent truncation is the disease
// this whole fix cures (F28), never a cure that truncates silently in turn.
const GAP_KEEP_MAX_LINES = 50, GAP_KEEP_MAX_BYTES = 8192;
// The exact phrase the trim announcement carries when kept failures are dropped
// by the cap above. Exported so Layer R's detector (src/root.js) keys off the
// SAME string the shell emits — a magic string on the reading side would drift
// silently the day this wording changes (the blind-instrument class). Reference
// only: the shell's behavior is unchanged, the label below is byte-identical.
export const GAP_KEEP_TRIM_MARKER = 'more elided by the';

/**
 * Bound an over-long close stream to a head sample + elided middle + tail. When
 * `keepPattern` is set (F28), lines of the WHOLE stream matching it are also
 * carried in a clearly-delimited block between head and tail — capped — so the
 * failing-test names buried in the middle still reach the worker.
 * Exported for the ONE reason `GAP_KEEP_TRIM_MARKER` above is: a second consumer
 * that needs a gap bounded must reuse THIS envelope, not spell its own. A private
 * copy would be a second truncation scheme, and the two would drift on exactly the
 * property that matters — whether the red lines survive, and whether the trim
 * announces itself (F28: silent truncation is the disease this function cures).
 * The close path is unchanged: `runClose` still calls it with the stage's own
 * `gapKeep`, byte-identically.
 * @param {string} s the (redacted) close output
 * @param {string} [keepPattern] regex source; matching lines survive the elision
 */
export function boundGap(s, keepPattern) {
  if (s.length <= GAP_HEAD + GAP_TAIL + 100) return s;
  const head = s.slice(0, GAP_HEAD);
  const tail = s.slice(-GAP_TAIL);
  const elided = s.length - GAP_HEAD - GAP_TAIL;
  const base = `${head}\n…[${elided} chars truncated]…`;
  if (!keepPattern) return `${base}\n${tail}`;

  // Scan the WHOLE stream, keep matching lines in original order, cap by lines
  // AND bytes. `re.test` with no `g` flag is stateless, so reuse is safe.
  const re = new RegExp(keepPattern, 'm');
  /** @type {string[]} */
  const matched = [];
  let bytes = 0, trimmed = 0;
  for (const line of s.split('\n')) {
    if (!re.test(line)) continue;
    if (matched.length >= GAP_KEEP_MAX_LINES || bytes + line.length + 1 > GAP_KEEP_MAX_BYTES) { trimmed += 1; continue; }
    matched.push(line);
    bytes += line.length + 1;
  }
  if (!matched.length) return `${base}\n${tail}`; // pattern matched nothing — behave as the plain bound
  const label = `kept failures matching /${keepPattern}/ (${matched.length}${trimmed ? `, ${trimmed} ${GAP_KEEP_TRIM_MARKER} ${GAP_KEEP_MAX_LINES}-line/${GAP_KEEP_MAX_BYTES}-byte cap` : ''})`;
  return `${base}\n── ${label} ──\n${matched.join('\n')}\n── end kept failures ──\n${tail}`;
}

/**
 * The forbidden zone, named (PRD v1.11). Each row is an outcome in which the
 * close rendered NO JUDGMENT — so it is not a verdict, it never feeds a gap
 * back, and it is never retried. They are kept SEPARATE on purpose: pooling
 * them would erase the decision information the escalation exists to carry —
 * "raise the timeout", "fix the argv", and "re-run, it was OOM-killed" are
 * three different human answers.
 * Exported because the RUNNER's close-first precheck runs the same arbiter
 * before any tokens: two maps would be two instruments, and two instruments
 * disagreeing about the same outcome is the fault this whole addendum exists
 * to close.
 * @type {Record<string, {category: string, decision: string, options: string[]}>}
 */
export const CLOSE_FAULTS = Object.freeze({
  failed: {
    category: 'broken-close',
    decision: 'The close itself cannot run — no verdict is trustworthy until it is fixed.',
    options: ['fix the close command', 'abandon the task'],
  },
  'timed-out': {
    category: 'close-timeout',
    decision: 'The close ran but never finished judging — it hit the timeout and was killed. It did not fail; it did not answer.',
    options: ['raise the close timeout', 'make the close faster', 'abandon the task'],
  },
  killed: {
    category: 'close-killed',
    decision: 'The close died by signal (OOM, or an external kill) — it rendered no judgment, so its exit tells you nothing about the tree.',
    options: ['re-run (a transient kill)', 'fix the close environment (memory, sandbox limits)', 'abandon the task'],
  },
  crashed: {
    category: 'close-crashed',
    decision: 'The close exited without judging anything — it crashed rather than failed. Its exit code is NOT a verdict, in either direction.',
    options: ['fix what makes the close crash at startup', 'fix the close argv', 'lower the declared judgment floor if the suite legitimately shrank', 'abandon the task'],
  },
  // PRD item 27/M2 (`docs/product/CLOSE-INTEGRITY-BUILD.md`) — a close
  // script's bytes no longer match what was signed. Distinct from every row
  // above: those are read off HOW THE CHILD PROCESS TERMINATED, and this one
  // is decided BEFORE the process is even spawned (`runCloseStages`,
  // `src/planrun.js`, re-verifies before every close run and short-circuits
  // to this verdict on a mismatch, the same forbidden-zone shape as a
  // crash). Never `close-red` (a judged "no" from a working close) and never
  // `close-crashed` (an instrument fault the close itself hit) — this is a
  // THIRD thing: the close that ran would not have been the one the operator
  // approved.
  'close-tampered': {
    category: 'close-tampered',
    decision: "A close script's bytes no longer match its signed sha256 — it would run something other than what was approved, so no verdict from it can be trusted.",
    options: ['restore the close script to its signed bytes', 're-sign the close if the change is intentional (a new spec hash needs re-approval)', 'abandon the task'],
  },
});

/**
 * The exhaustion-by-PROGRESS seam, as a contract rather than "whatever one module
 * happens to return". Two governors implement it and they read different signals —
 * the step ladder's repeats-and-writes (src/ladder.js) and the close-fix loop's
 * per-stage graded numbers (src/trend.js) — which is the whole reason ralph takes an
 * interface here and interprets nothing itself.
 *
 * `record` returns the governor's own reading, which ralph emits verbatim and never
 * inspects; each reading names its `governor` so two instruments under one spine type
 * can never be averaged into one number. `report` is the only shape ralph itself
 * reads. `terminal` is optional and overrides the exhaustion PROSE only — never the
 * category, never the outcome.
 *
 * @typedef {object} LoopGovernor
 * @property {(o: {iteration: number, gap?: string}) => object} record
 * @property {() => boolean} struckOut
 * @property {() => {strikes: number, limit: number, iterations: number, distinctGaps?: number}} report
 * @property {() => string} brief
 * @property {() => {decision: string, options: string[]}} [terminal]
 */

/**
 * The loop: `while close-red and under-cap: run the middle`. Stops at first
 * green (within-run tuning past a visible close is the fit-to-pass surface,
 * PRD §2). The two honest terminals are green and a decision-ready escalation;
 * cap-halt means "not under cap", its own category, never merged with "wrong"
 * (design law #8). A broken close escalates immediately — a broken arbiter
 * must not masquerade as a bad harness.
 *
 * A middle that throws is read through the failure map: a throw carrying
 * `category: 'cap-halt'` (the USD gate tripping inside the middle) escalates
 * as cap-halt; any other named category is relayed as-is; an unnamed throw is
 * an interpreter-red — a broken interpreter must not masquerade as a bad
 * harness. Ralph never interprets, only relays.
 *
 * @param {object} opts
 * @param {(iteration: number, gap?: string) => void|Promise<void>} opts.middle the emergent middle; never sees close/cap
 * @param {string[]} [opts.close] argv whose exit code is truth (required unless `judge` is injected)
 * @param {() => Promise<{verdict: string, gap?: string, detail?: string}>|{verdict: string, gap?: string, detail?: string}} [opts.judge]
 *   Layer 2 (PRD v1.12 §4): the judge generalized to a SHELL-owned seam. When
 *   present it replaces runClose for this loop — a plan STEP's micro-loop is
 *   judged by the exit evaluator (declarative form checks), not a command. It
 *   returns the same verdict vocabulary runClose renders, so the forbidden
 *   zone, worker-crash routing (F32), and the cap taxonomy apply unchanged.
 *   Injected by run.js only; inexpressible in any config or plan — the agent
 *   never authors its judge any more than its close.
 * @param {number} [opts.capRuns] budget: max middle runs. Required UNLESS `ladder`
 *   is supplied — the two exhaustion rules are alternatives, never both at once.
 *   The "unless" is ENFORCED at entry (a param guard that throws), not merely
 *   documented: an optional-in-the-contract bound with nothing checking it made a
 *   loop that never ran report a governance stop that never happened.
 * @param {LoopGovernor} [opts.ladder]
 *   the PROGRESS governor (src/ladder.js) that replaces the fixed count for a plan
 *   STEP's micro-loop. With it, the loop is bounded by strikes rather than by a
 *   number of runs: iterations float, and money, the wall, the variance meter and
 *   the stall fuse keep every bit of their current authority (each still ends the
 *   loop through the middle's own throw). Ralph still interprets nothing — it hands
 *   the ladder the iteration's gap and reads back a boolean.
 *
 *   The CLOSE-FIX loop now supplies one too (PRD v1.46 §4, once its own $0 replay
 *   over all 8 archived fix loops came back clean: 0 greens harmed, 1 waste case
 *   caught). Its governor reads a different signal — the close's own per-stage
 *   graded numbers (src/trend.js), not repeats and writes — which is exactly why
 *   this is a SEAM and not a hard-coded rule: ralph still interprets nothing.
 *   An optional `terminal()` on the governor overrides the exhaustion prose, because
 *   the step ladder's copy offers the human a replan and there is no planner at the
 *   close. The category and the outcome are NOT overridable: one exhaustion terminal,
 *   two triggers.
 * @param {(type: string, data?: object) => object} opts.emit a spine emitter
 * @param {(s: string) => string} [opts.redact] source scrubber for close output
 *   (secrets never enter the spine); injected so the shell stays stdlib-only
 * @param {number} [opts.closeTimeoutMs] close wall-clock cap (shell/operator
 *   territory — the workflow config cannot express it)
 * @param {string} [opts.cwd] the directory every close runs in — the tree it is
 *   judging (F8: a cwd-relative close run elsewhere judges the wrong repository)
 * @param {number} [opts.expect] the exit code the SIGNED spec calls success
 * @param {{pattern: string, min: number}} [opts.judged] the judgment-rendered signal
 * @param {string} [opts.gapKeep] kept-failures pattern (F28): matching close-output
 *   lines survive the gap bound so a large suite's `not ok` names reach the worker
 * @param {() => string[]} [opts.workerWrites] the crash-attribution instrument (F32):
 *   answers "which files has the WORKER written so far this run?" — the runner wires
 *   it to the gate audit's allow-decision writes. Injected like `redact` so the shell
 *   stays stdlib-only and dumb; consulted ONLY at a crashed verdict. With no seam, or
 *   with zero writes, a crash stays what it always was: an instrument stop.
 * @param {string|null} [opts.closeDir] the close's own books directory
 *   (PRD item 27/M3 Part B), forwarded to the raw `close` path's `runClose`
 *   call unchanged; a caller supplying `judge` instead already closed over
 *   its own `closeDir` and this param does nothing for it.
 * @param {string} [opts.phase] the phase this loop runs in, when it is not the step loop
 *   (the fix loop passes `'fix'`): the person's-stop text then names it ("during the fix
 *   phase") instead of saying a resume re-enters "this step", which only the step loop has.
 *   Text only — it changes no category, outcome or option.
 * @returns {Promise<'green'|'escalated'>}
 */
export async function ralph({ middle, close, judge, capRuns, ladder, emit, redact, closeTimeoutMs, cwd, expect, judged, gapKeep, workerWrites, closeDir, phase }) {
  // PARAM GUARD (the BA-4 class — a caller's malformed argument, which is the one
  // thing this shell throws for; a WORKER's bad reach comes back as a refusal
  // RESULT instead, and that rule is about feedback, not about the API contract).
  // `capRuns` became optional in this signature when `ladder` arrived, and nothing
  // enforced the "unless". MEASURED with neither supplied: `1 <= undefined` is
  // false, so the middle ran 0 times and ralph still emitted `cap-halt` and an
  // escalation reading `undefined/undefined runs spent, close still red` — a
  // governance stop narrated for a run that never happened, on the public export.
  // A bound that reports halting a loop it never entered is exactly the
  // blind-instrument class this repo keeps paying for, so the malformed call dies
  // at the door instead of minting a record. The message names BOTH alternatives:
  // either one repairs the call, and naming one would send the caller to the wrong
  // repair.
  if (!ladder && !(Number.isInteger(capRuns) && /** @type {number} */ (capRuns) > 0)) {
    // quoted only for a string, so `"3"` reads as the type error it is while
    // `NaN`/`undefined` read as themselves (JSON.stringify renders both as a lie)
    const got = typeof capRuns === 'string' ? JSON.stringify(capRuns) : String(capRuns);
    throw new Error(`ralph: capRuns must be a positive integer (got ${got}) unless a \`ladder\` governor is supplied — they are alternative exhaustion rules and a loop with neither cannot stop honestly`);
  }
  emit('run-start', {
    ...(ladder ? { strikeLimit: ladder.report().limit } : { capRuns }),
    close: judge ? 'judge:injected' : /** @type {string[]} */ (close).join(' '),
  });
  // The blind spot is NAMED, never hidden: with no judgment-rendered signal this
  // close cannot tell a crash from an honest red (they are byte-identical at the
  // exit-code seam), so the record says so out loud rather than passing the exit
  // code off as trustworthy (PRD v1.11). The judged-floor story belongs to
  // CLOSES: an injected judge (Layer 2 exit evaluation) owns its own honesty
  // reads, so the note would be noise there.
  if (!judged && !judge) emit('close-unaudited', { close: /** @type {string[]} */ (close).join(' '), meaning: 'no judgment-rendered signal declared — a crash-at-load is indistinguishable from an honest red for this close' });
  const verdicts = [];
  let gap;
  // ONE exhaustion terminal, two triggers — the same three records in the same
  // order either way, so the count path and the ladder path cannot drift into
  // reporting the stop differently. The CATEGORY is `cap-halt` for both, and
  // deliberately: downstream counts escalation categories against an executable
  // excluded-set (ledger.js), and the step loop routes its ONE replan off exactly
  // this name. Only the trigger changed; the taxonomy did not.
  /** @param {number} iteration @param {object} halt @param {object} spend @param {string} decision @param {string[]} options */
  const exhausted = (iteration, halt, spend, decision, options) => {
    emit('cap-halt', { category: 'cap-halt', meaning: 'not under cap — not "can\'t"', ...halt });
    emit('escalation', { category: 'cap-halt', decisionReady: true, verdicts, spend, decision, options });
    emit('run-end', { outcome: 'escalated', iterations: iteration });
    return /** @type {'escalated'} */ ('escalated');
  };
  // With a ladder the count is not the bound: the loop runs until the ladder strikes
  // out, or until the middle throws (money, wall, variance, stall — all unchanged).
  for (let iteration = 1; ladder || iteration <= /** @type {number} */ (capRuns); iteration++) {
    emit('iteration-start', { iteration });
    try {
      await middle(iteration, gap);
    } catch (e) {
      // dumb passthrough: the thrower names its category (cap-halt | gate-red | …)
      const category = e && typeof e.category === 'string' ? e.category : 'interpreter-red';
      if (category === 'cap-halt') emit('cap-halt', { category, meaning: 'not under cap — not "can\'t"', detail: String(e.message || e) });
      const DECISIONS = {
        'cap-halt': [`Budget gate tripped mid-run (${e && e.message}). Continue with a higher cap, change approach, or stop?`,
          ['raise the cap and rerun', 'change the middle/harness', 'abandon the task']],
        // No site in this tree mints `gate-red` any more: a BA-11 denial streak is
        // a bounded attempt now (planrun's two `ask`s), not a terminal, because the
        // fence HOLDING is governance working, not a fault. The entry stays because
        // this catch is a dumb passthrough — it files whatever category the thrower
        // names, so an unlisted one would read out with the generic text.
        'gate-red': ['The gate denied an action mid-run — the harness asked for something outside its scope.',
          ['widen the write scope deliberately', 'change the middle/harness', 'abandon the task']],
        'provider-red': ['The provider path failed mid-run (transport, not logic) — no verdict exists and the spend for the failed call is unknown (F6).',
          ['retry the run', 'fix the provider binding', 'abandon the task']],
        // A (PRD v1.27) — the METER stopped this attempt before it started: the
        // step had already eaten a declared share of the run with its exits
        // unmoved. Not a fault, not a cap: the caller reads this category and
        // REPLANS, so the message must not say anything broke.
        'step-variance': ['A step consumed a large share of the run with its exits still red — the meter stopped it before another attempt.',
          ['let the planner re-allocate what is left (replan)', 'raise the budget and rerun', 'abandon the task']],
        // T/F64 — the run's WALL CLOCK stopped this: either the caller's deadline
        // came back as the provider's own timeout (F64, mid-attempt) or the caller
        // read the clock and declined to START another attempt (W-2, between them).
        // A governance stop either way, not a fault and not a transport casualty:
        // the message must not send a human to debug a socket, and the remedy is the
        // operator's cap, not a retry. The wording says neither "mid-attempt" nor
        // "between attempts", because one entry serves both and a category that
        // narrates the wrong half is worse than one that narrates neither.
        // The two levers are BOTH spec edits (a changed spec hash the runner refuses
        // until it is re-approved), and they point opposite ways — which is why the
        // caller's detail carries the progress trend that says which one fits.
        'wall-halt': ['The run reached its wall-clock cap — time ran out, not capability. Nothing is discarded: the last verdict rendered stands, and the stop is the checkpoint.',
          ['raise maxWallMs and rerun (resume-to-cap; a spec edit, so the new hash needs re-approval)',
            'revise the goal/spec so the work fits the time (same re-approval)',
            'abandon the task']],
        // P5 item 5 — the PERSON asked to stop at a round boundary: nothing failed, nothing is discarded.
        'stopped': [phase
          ? `You stopped the run during the ${phase} phase. Nothing is discarded: the work on disk stands, and a resume continues the run.`
          : 'You stopped the run. Nothing is discarded: the work on disk stands, and a resume re-enters this step.',
          ['resume (the same run continues)', 'abandon the task']],
        // F66 — the STALL WATCHDOG gave up: no round completed for the stall window,
        // three times over, and reissuing the call did not recover it. It borrows both
        // siblings' rules. Like `step-variance`, the caller reads this category and
        // REPLANS, so the planner's lever leads. Like `wall-halt`, nothing broke — the
        // socket stayed alive the whole time (that is the measured mechanism), so the
        // message must not send a human to debug transport, and the default's "fix the
        // interpreter" would aim a human at the one component that did nothing wrong.
        'step-stalled': ['The model stopped producing rounds and reissuing the call did not recover it — a stall, not a fault.',
          ['let the planner re-allocate what is left (replan)', 'retry the run', 'check provider status', 'abandon the task']],
        // N4 — the close is WAITING ON A PERSON. Nothing failed and nothing is
        // discarded: every mechanical stage passes and the one stage left is a
        // question no worker can answer, so the loop stopped rather than buying
        // an attempt that could not change the answer. The caller renders the
        // real decision-ready package (`hitl-pause`, with the evidence); this
        // entry exists so the passthrough never narrates a paused run as a
        // broken middle.
        'hitl-pause': ['The close reached its human stage — the run is paused, decision-ready, and the clock is stopped.',
          ['accept', 'rerun (your words become the gap the worker converts)', 'pause (the checkpoint keeps, and it resumes)']],
      };
      // Object.hasOwn, not bare lookup: a category named after an
      // Object.prototype member ("toString") would return the inherited
      // function, and destructuring it would crash the shell inside its own
      // escalation path — the one place that must never break.
      const [decision, options] = (Object.hasOwn(DECISIONS, category) ? DECISIONS[category] : undefined)
        ?? ['The middle itself broke — no harness verdict is trustworthy until it is fixed.', ['fix the interpreter', 'abandon the task']];
      emit('escalation', {
        category, decisionReady: true, verdicts,
        spend: { runs: iteration, capRuns },
        // the thrower names its OWNER too when it knows one (interpret's worker
        // loop → bare-agent): the ledger prefers the typed field over sniffing
        // this detail string for library names
        ...(e && typeof e.lib === 'string' ? { lib: e.lib } : {}),
        // a stuck loop of refused tool arguments names the fault in structured fields (F265) so a reader renders it, never parses `detail`
        ...(e && e.badCall && typeof e.badCall === 'object' ? { badCall: e.badCall } : {}),
        decision, options, detail: String(e.message || e),
      });
      emit('run-end', { outcome: 'escalated', iterations: iteration });
      return 'escalated';
    }
    emit('middle-done', { iteration });
    const v = judge
      ? await judge()
      : await runClose(/** @type {string[]} */ (close), redact, { timeoutMs: closeTimeoutMs ?? 120_000, cwd, expect, judged, gapKeep, closeDir });
    // Worker-crash attribution (F32, measured in F31: 4 of 7 battery rows). A crash is
    // still not a verdict (F17) — but a crash that FOLLOWS worker writes, on a run whose
    // precheck proved the close judged at baseline (run.js escalates a crash-at-precheck
    // before any tokens), is the worker's own broken edit: the most recoverable red there
    // is, and the one red this loop could never feed back. The close's raw reading stays
    // 'crashed' on the record; the ROUTING is what attribution changes. Decided before
    // the satisfied check so an exit-0 crash (fake green, law #8) is caught the same way.
    const crashFiles = v.verdict === 'crashed' && workerWrites ? workerWrites() : [];
    const workerCrashed = crashFiles.length > 0;
    verdicts.push(workerCrashed ? 'worker-crash' : v.verdict);
    emit('close-verdict', { iteration, ...v });
    if (v.verdict === 'satisfied') {
      emit('run-end', { outcome: 'green', iterations: iteration });
      return 'green';
    }
    if (workerCrashed) {
      emit('worker-crash', { iteration, category: 'worker-crash', files: crashFiles, detail: v.detail });
      // the file list is bounded and the trim ANNOUNCED — silent truncation is the F28 disease
      const shown = crashFiles.slice(0, 30);
      const more = crashFiles.length - shown.length;
      gap = `Your edit CRASHED the test suite — it can no longer even load and judge (${v.detail}). `
        + `Files you have written this run: ${shown.join(', ')}${more > 0 ? ` (and ${more} more)` : ''}. `
        + 'Fix or revert your change so the suite can run again — nothing can pass while the suite cannot load.';
    } else {
      // Forbidden zone: no judgment was rendered, so there is no verdict. Escalate
      // by the outcome's OWN name and never retry — retrying a broken arbiter is
      // the §5b violation adaptlearn found live in its shipped shell (F25/Z-3).
      const fault = Object.hasOwn(CLOSE_FAULTS, v.verdict) ? CLOSE_FAULTS[v.verdict] : undefined;
      if (fault) {
        emit('escalation', {
          category: fault.category, decisionReady: true, verdicts,
          spend: { runs: iteration, capRuns },
          decision: fault.decision, options: fault.options, detail: v.detail,
        });
        emit('run-end', { outcome: 'escalated', iterations: iteration });
        return 'escalated';
      }
      gap = v.gap; // feedback for the next middle run; the shell itself learns nothing
    }
    // ── the ladder reads THIS red iteration, whichever gap it ended up with (a
    // worker-crash gap is feedback the attempt really received, so it is a reading
    // like any other). ONE call site, after both branches have settled `gap`: two
    // would let a future branch quietly opt out of the bound.
    if (ladder) {
      const r = ladder.record({ iteration, gap });
      emit('ladder', r);
      if (ladder.struckOut()) {
        const rep = ladder.report();
        // The governor may name its own decision/options; it may NOT name its own
        // category or outcome. A stop is spelled the same either way (`cap-halt`,
        // 'escalated') because downstream counts categories against an executable
        // excluded-set — only the PROSE a human reads is governor-specific.
        const term = typeof ladder.terminal === 'function' ? ladder.terminal() : null;
        return exhausted(iteration,
          {
            strikes: rep.strikes,
            strikeLimit: rep.limit,
            iterations: rep.iterations,
            ...(rep.distinctGaps === undefined ? {} : { distinctGaps: rep.distinctGaps }),
          },
          { runs: iteration, strikes: rep.strikes, strikeLimit: rep.limit },
          term?.decision ?? `${rep.strikes}/${rep.limit} strikes — the step stopped making progress. ${ladder.brief()} Continue, change approach, or stop?`,
          term?.options ?? ['let the planner re-allocate what is left (replan)', 'change approach', 'abandon the task']);
      }
    }
  }
  // The FIXED-COUNT exhaustion, reached only without a ladder. Both callers inside this
  // package now supply one (the step loop's `createLadder`, the close-fix loop's
  // progress governor), so the only route left is the public export — kept because it IS
  // the public export, and because a `capRuns` bound with no reachable exhaustion would
  // be a bound in name only.
  const spent = /** @type {number} */ (capRuns);
  return exhausted(spent, { capRuns }, { runs: spent, capRuns },
    `${spent}/${spent} runs spent, close still red. Continue, change approach, or stop?`,
    ['raise the cap and rerun', 'change the middle/harness', 'abandon the task']);
}
