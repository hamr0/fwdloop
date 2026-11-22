// borrowed-from: bareloop src/validate.js@v0.61.0 (fc56e1f3)
// The shared validation primitives — the fence transform, containment, the
// secret-shape inventory, and the small type guards. Both validators
// (`validateJob`, `validatePlan`) go through this ONE module, because a scope
// that validated under one transform and enforced under another is the F9
// red-class: green at the gate, gate-red on every write.
//
// This file WAS the config-v1 workflow-config validator. config-v1 died in F22
// (of its 7 knobs only `loop.shape` was ever live, on a never-green run) and
// was DELETED with the operator-authored steps[] path on 2026-07-26 (PRD
// v1.32). What remains is what the live path imports — the primitives were
// housed here, they were never part of the dead schema.

import { redact } from 'bareguard';
import { TICKET_INPUT_DIR } from './worktree.js';

/**
 * Map a schema writeScope entry to its enforcement prefix. bareguard
 * fs.writeScope is prefix-containment, not glob (adaptlearn F4/F9): the
 * trailing "/**" | "/*" form maps to its directory prefix. The validator's
 * legality rule and the interpreter's enforcement mapping BOTH go through this
 * one helper — if they ever used different transforms, a scope could validate
 * green and then gate-red every write at runtime (the F9 red-class).
 * @param {string} scope
 */
export function globToPrefix(scope) {
  // One canonical spelling for equivalent paths — leading "./", interior "/./",
  // doubled "//", trailing "/" all collapse — so the legality rule, the fence
  // comparison, and bareguard enforcement agree on what a scope NAMES. Without
  // this, a validateJob-green fence like "src/" would reject every workflow
  // scope inside it (the F9 red-class across two documents).
  //
  // Order is load-bearing: "//" collapses and interior "/./" drops BEFORE the
  // leading "./" strip, so ".//src" → "src" and never "/src". Stripping first
  // would MINT an absolute prefix from a relative scope — a design-law-#1
  // containment escape (resolve(workdir, "/src") ignores workdir entirely).
  //
  // Deliberately NOT path.posix.normalize: it resolves ".." segments
  // (normalize("src/../etc") === "etc"), which must stay VISIBLE so
  // scopeContained can reject them — the whole point of the containment law.
  let p = scope.replace(/\/\*\*?$/, '');
  p = p.replace(/\/{2,}/g, '/').replace(/\/\.(?=\/|$)/g, '').replace(/^(?:\.\/)+/, '').replace(/\/+$/, '');
  return p;
}

/**
 * Path segments a fence/scope may never contain, checked WHOLE-SEGMENT
 * (`prefix.split('/')`), never substring — a look-alike (`.github`,
 * `.gitignore`, `my.git`, `node_modules_util`) is a DIFFERENT name and stays
 * admitted. hamr's ruling (option B, 2026-09-14, block both): F178 — a
 * signed fence naming `.git` could let a worker write git's own files (refs,
 * the seed, `info/exclude`) and hide those writes from `changedSet`. F177's
 * follow-up — a signed fence naming `node_modules` directly is the same class
 * of gap (an installed/worker-written file inside it is invisible to
 * `changedSet` the same way, and installs are the person's job now, F177).
 * This catches only a fence that NAMES one of these directly; a fence like
 * `packages/api/**` that later reaches a NESTED `node_modules` beneath it is a
 * distinct, only partially closeable gap — see the runtime belt in
 * planrun.js for `node_modules` (`.git` has no such gap: there is exactly one
 * `.git` per repo, always at the workdir root, so its own runtime belt is a
 * single `fs.deny` entry). Both are inexpressible at declaration time, the
 * same law #1 already applies to `..`.
 * The frozen-ticket folder (`.bareloop-input`, one spelling in worktree.js) is bareloop's own write, never the worker's: a fence naming it is refused the same way.
 * @type {readonly string[]}
 */
export const FORBIDDEN_SCOPE_SEGMENTS = Object.freeze(['.git', 'node_modules', TICKET_INPUT_DIR]);

/**
 * A scope may never reach the arbiter's inputs (design law #1): it must
 * resolve to a PROPER subdirectory of the run directory. Absolute paths and
 * ".." segments escape it; "." / "./**" cover the whole run directory — where
 * the close suite lives. Windows spellings ("..\", "C:\") count as escapes.
 * A `.git` or `node_modules` segment anywhere in the prefix is refused too
 * (F178/F177, see {@link FORBIDDEN_SCOPE_SEGMENTS}).
 * Exported for the job validator: the operator's outer fence obeys the SAME
 * law through the same code — two containment transforms would be the F9
 * red-class one level up.
 * @param {string} s
 */
export function scopeContained(s) {
  if (s.startsWith('/') || s.includes('\\') || /^[a-zA-Z]:/.test(s)) return false;
  const prefix = globToPrefix(s);
  // Belt: reject a prefix that is empty, the run dir, absolute, or a drive —
  // checked on the NORMALIZED prefix, not just the raw string, so a spelling
  // that normalizes to something absolute can never pass (defense in depth
  // against a future globToPrefix regression; the un-gameable gate, law #1).
  if (prefix === '' || prefix === '.' || prefix.startsWith('/') || /^[a-zA-Z]:/.test(prefix)) return false;
  const segments = prefix.split('/');
  return segments.every((seg) => seg !== '..' && !FORBIDDEN_SCOPE_SEGMENTS.includes(seg));
}

/** Shared with the job validator — one definition of "a JSON object" for both
 * documents (the sibling-validator drift class).
 * @param {unknown} v */
export function isObj(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
/** @param {unknown} v @returns {v is string} */
export function isNonEmptyString(v) {
  return typeof v === 'string' && v.length > 0;
}

/**
 * PRD item 27/M2 close-bytes signature, orchestrator-flagged gap
 * (2026-09-06): a close stage's `cmd` can name an addressable script TWO
 * ways — `node <path> …` (M1's original scope) or a BARE directly-executable
 * absolute path (a `.sh` wrapper, e.g. `jobs/aurora-testgen-cold.json`'s
 * close, which `readCloseScripts` used to skip entirely, leaving both
 * `close-absolute-path` and the sha256 signature blind to it — a "blind
 * instrument" the audit named directly). This list is the shared, STATIC
 * (no fs) shape test both `src/job.js` (which only needs to know WHETHER a
 * stage names an addressable script, to decide whether `sha256` is
 * demanded) and `src/close-integrity.js` (which resolves the token against
 * a real cwd and reads it off disk) key off — one spelling, so the demand
 * and the detector can never drift apart about which stages are in scope.
 * A leading-interpreter cmd (`sh`/`bash`/`python`/`python3`/`npx` besides
 * `node`) is included for the same reason `node` is: a close author may use
 * any of them, and a scope that only recognized `node` would just move the
 * blind spot rather than close it.
 * @type {readonly string[]}
 */
export const CLOSE_SCRIPT_INTERPRETERS = Object.freeze(['node', 'sh', 'bash', 'python', 'python3', 'npx']);

/**
 * The candidate script path TOKEN a close stage's `cmd` names, by SHAPE
 * alone — no fs, no cwd resolution, so this is safe for `validateJob` (pure)
 * to call directly. Two recognized forms, first match wins:
 *   - an INTERPRETER cmd: the token is the first argv[1..] element that is
 *     PATH-SHAPED (not a `-`-prefixed flag, and either contains `/` or ends
 *     in one of `.mjs .cjs .js .ts .sh .py`) — never just argv[1] outright.
 *     `node --enable-source-maps ./close/x.mjs stage` names `./close/x.mjs`,
 *     not `--enable-source-maps`; `python -m pytest` and `npx tsc --noEmit`
 *     name NOTHING (`-m`/`--noEmit` are flags, `pytest`/`tsc` are bare
 *     command names with no path shape) — fixed 2026-09-06 (orchestrator
 *     audit) after the earlier bare-argv[1] version demanded a sha256 for a
 *     token that named no file, making such a spec unsignable forever (the
 *     sign helper reads nothing, the validator reds permanently);
 *   - a bare cmd whose argv[0] ITSELF is an absolute path (no interpreter
 *     prefix — a `.sh`/other directly-executable close script) → the token
 *     is argv[0].
 * Anything else — a relative bare executable (`true`, `pytest`), an
 * interpreter with no path-shaped argument (`python -m pytest`, `npx tsc
 * --noEmit`), a non-string/empty cmd — names no addressable file under this
 * scheme and returns null; those stages carry no sha256 demand and are
 * invisible to the byte/path detectors, exactly as they always were (most
 * test-fixture closes use exactly this shape on purpose, to exercise
 * runtime behaviour with no real script file at all).
 * @param {unknown} cmd
 * @returns {string|null}
 */
export function closeScriptCandidateToken(cmd) {
  if (typeof cmd !== 'string') return null;
  const parts = cmd.trim().split(/\s+/);
  if (!parts[0]) return null;
  if (CLOSE_SCRIPT_INTERPRETERS.includes(parts[0])) {
    const pathShaped = (/** @type {string} */ tok) => !tok.startsWith('-') && (tok.includes('/') || /\.(?:mjs|cjs|js|ts|sh|py)$/.test(tok));
    return parts.slice(1).find(pathShaped) ?? null;
  }
  return parts[0].startsWith('/') ? parts[0] : null;
}

// Secrets never enter the tree/spine/configs (hard line) — BOTH config
// documents get the same sweep: the agent-authored workflow config is the
// riskier entry point (machine-written), the operator's job spec the other.
// Known token shapes only, left-bounded so hyphenated words ("flask-sqlalchemy")
// never red — defense-in-depth; env-only loading is the law, not this regex.
// ONE shape inventory for the whole system: detection (this sweep) and the
// spine redactor (interpret wires these into bareguard's redact) must never
// disagree on what a secret looks like — a shape the validator reds but the
// redactor passes is a leak on the very output the validator was guarding.
export const SECRET_PATTERNS = [
  /(?<![A-Za-z0-9_-])sk-[A-Za-z0-9_-]{16,}/,
  // The prefixes below are distinctive (an ordinary hyphenated word never starts with `ghp_`, `AKIA`, ...), so their left bound
  // drops only the `-`: a key right after a hyphen (`step-ghp_...`) is still a key. `sk-` keeps the full bound above, because
  // `sk-` ends real words (`task-`, `desk-`, `risk-`...). KNOWN LIMIT: an `sk-` key directly after a hyphen or word character
  // (`step-sk-...`) is not found by THIS inventory, so the scan (validator, source door, pagefetch) misses it. (Measured: the
  // redactor still masks it today, but through bareguard's own built-in `sk-` shape, not through this list.)
  /(?<![A-Za-z0-9_])ghp_[A-Za-z0-9]{20,}/,
  /(?<![A-Za-z0-9_])github_pat_[A-Za-z0-9_]{20,}/,
  /(?<![A-Za-z0-9_])AKIA[0-9A-Z]{16}/,
  /(?<![A-Za-z0-9_])xox[bap]-[A-Za-z0-9-]{10,}/,
  // Google/Gemini API key: `AIza` + 35 chars of [0-9A-Za-z_-] (39 total, fixed
  // length by Google's own issuance format). Admitted with the gemini-api
  // provider (PRD item 31.3, F160) — was missing on this branch until then.
  /(?<![A-Za-z0-9_])AIza[0-9A-Za-z_-]{35}/,
];
const SECRET_RE = new RegExp(SECRET_PATTERNS.map((r) => r.source).join('|'));

/** Human-readable name for each entry in `SECRET_PATTERNS`, SAME order, SAME
 * length — for a caller that must name WHICH shape matched (a refusal
 * message, an audit line) without ever printing the matched text itself. Kept
 * beside the inventory it describes rather than hand-typed at each call site,
 * for the same reason `scanSecrets`/`redactSecrets` are: a second, drifting
 * copy is how a name and its pattern come apart. */
export const SECRET_PATTERN_NAMES = [
  'sk- prefixed API key',
  'GitHub personal access token (ghp_)',
  'GitHub fine-grained PAT (github_pat_)',
  'AWS access key ID (AKIA)',
  'Slack token (xox)',
  'Google/Gemini API key (AIza)',
];

/**
 * Scan a RAW text stream (a spine file, a close's output, a transcript) for
 * known secret shapes and return the literal matches. The ONE spelling of the
 * text-side scan, for the same reason SECRET_PATTERNS is the ONE inventory: a
 * hand-rolled copy that misses a shape is a leak on the very output it guards.
 * The dedup is now COMPLETE and the count is grepped, not remembered: all 11
 * call sites in scripts/ go through this function, and zero hand-rolled copies
 * of the expression remain anywhere in the repo. (F40 landed the helper and
 * converted 2 of 7 sites; the 5 it left alone plus 4 that accreted afterwards
 * were converted in one sweep, byte-identical behaviour — measured equivalent
 * on 900 spiked real spines, 0 divergences.)
 * `sweepSecretLiterals` is the config-tree twin — same shapes, tree walk.
 * Never throws; returns [] for a missing stream.
 * @param {unknown} raw
 * @returns {string[]} every match, in stream order per pattern
 */
export function scanSecrets(raw) {
  const text = String(raw ?? '');
  // a fresh global clone per call: a shared /g regex carries lastIndex between
  // calls and would skip matches on the next stream
  return SECRET_PATTERNS.flatMap((re) => text.match(new RegExp(re.source, `${re.flags.replace('g', '')}g`)) ?? []);
}

/**
 * Mask known secret shapes in a text. The REDACTION twin of `scanSecrets` and
 * the ONE spelling of it: detection and redaction read the same inventory, so a
 * shape the validator reds can never be a shape the redactor passes (a divergence
 * there is a leak on the very output the validator was guarding). Housed beside
 * the inventory rather than at each consumer for the same reason `scanSecrets`
 * is — a hand-rolled copy is how the two drift.
 * Consumers: the plan flow's spine/close/prompt `scrub`, and the isolate verbs,
 * which write model-authored text into `<workdir>/.litectx` — a file INSIDE the
 * tree that outlives the run and reads back through ctx_recall.
 * @param {unknown} raw
 * @returns {string}
 */
export function redactSecrets(raw) {
  return redact(String(raw ?? ''), { patterns: SECRET_PATTERNS });
}

/**
 * Red every string in a config tree that carries a known secret-token shape.
 * @param {any} root
 * @param {(code: string, path: string, detail?: string) => void} red
 */
export function sweepSecretLiterals(root, red) {
  (/** @type {(node: any, at: string) => void} */
  function sweep(node, at) {
    if (typeof node === 'string') {
      if (SECRET_RE.test(node)) red('secret-literal', at, 'secrets load from the environment; an append-only record that captures a key captures it forever');
      return;
    }
    if (Array.isArray(node)) node.forEach((v, i) => sweep(v, `${at}.${i}`));
    else if (isObj(node)) {
      for (const [k, v] of Object.entries(node)) {
        const path = at ? `${at}.${k}` : k;
        // keys too: inside free-form values (a gold expected, a conditions map)
        // a key is unconstrained, so a token can ride a KEY onto the spine
        if (SECRET_RE.test(k)) red('secret-literal', path, 'secrets load from the environment; an append-only record that captures a key captures it forever');
        sweep(v, path);
      }
    }
  })(root, '');
}

// ── the catastrophic-backtracking reject (F49) ────────────────────────────────
// Housed here, with the other primitives BOTH validators share, because THREE
// regex fields reach an untimed evaluator and they are split across the two
// documents: the agent's `artifact-written.pattern` (plan.js) and the
// operator's `judged.pattern` + `gapKeep` (job.js). plan.js already imports
// job.js, so job.js cannot import plan.js — and a second copy here would be the
// drift class SECRET_PATTERNS exists to prevent: a shape one side rejects and
// the other admits. ONE inventory, imported by both.

/** Length of an UNBOUNDED quantifier token at `src[i]` (`*`, `+`, or `{n,}`,
 * plus an optional trailing lazy `?`), or 0. Bounded forms (`?`, `{n}`,
 * `{n,m}`) return 0: they cannot drive exponential backtracking (a bounded
 * outer repeat is polynomial at worst, and the body is self-authored — F49).
 * @param {string} src @param {number} i */
function unboundedQuantLen(src, i) {
  let len = src[i] === '*' || src[i] === '+' ? 1 : 0;
  if (!len && src[i] === '{') { const m = /^\{\d+,\}/.exec(src.slice(i)); if (m) len = m[0].length; }
  if (len && src[i + len] === '?') len++; // the lazy modifier is part of the same token
  return len;
}

/** How many characters of `(`-prologue sit at `src[i]` before the group's BODY:
 * 1 for a plain or capturing group, 3 for `(?:` `(?=` `(?!`, 4 for `(?<=` `(?<!`,
 * and past the `>` of a named group `(?<name>`. The body is read back when the
 * group closes, and a prologue counted as body text would make `(?:a|aa)` split
 * as `?:a` / `aa` — no prefix relation, and the hazard read as safe.
 * @param {string} src @param {number} i index of the `(` */
function groupPrologueLen(src, i) {
  if (src[i + 1] !== '?') return 1;
  const c = src[i + 2];
  if (c === ':' || c === '=' || c === '!') return 3;
  if (c === '<') {
    if (src[i + 3] === '=' || src[i + 3] === '!') return 4;   // lookbehind
    const close = src.indexOf('>', i + 3);                    // named group
    return close === -1 ? 3 : close - i + 1;
  }
  return 1;                                                    // modifier groups etc — read the lot as body (fail-safe)
}

/**
 * Do a group body's TOP-LEVEL alternation branches overlap — is one a prefix of
 * another, equality included? That is the practical detectable core of the
 * overlapping-alternation blowup (`(a|aa)`, `(a|a)`, `(\d|\d\d)`, `(a|a?)`):
 * two branches that can consume the same text give the engine two ways to reach
 * the same position, and an unbounded repeat multiplies them.
 *
 * The comparison is over the branches' SOURCE TEXT, which is what makes it
 * conservative rather than exact — `(ab|abc)+` carries the prefix relation and
 * did not blow up on the body measured. Exactness needs the real regex engine
 * F49 declined to take as a dependency, and guessing it wrong would ADMIT an
 * exponential pattern, so the over-rejection stands as a named limit.
 *
 * Splitting respects escapes, character classes and nested groups: a `|` inside
 * `[a|b]` or inside `(x|y)` is not this group's alternation, and treating it as
 * one would invent branches nobody wrote.
 * @param {string} body the text between a group's prologue and its `)`
 * @returns {boolean}
 */
function altBranchesOverlap(body) {
  /** @type {string[]} */
  const branches = [];
  let start = 0;
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    const c = body[i];
    if (c === '\\') { i++; continue; }
    if (c === '[') { i++; if (body[i] === '^') i++; while (i < body.length && body[i] !== ']') { if (body[i] === '\\') i++; i++; } continue; }
    if (c === '(') { depth++; continue; }
    if (c === ')') { depth--; continue; }
    if (c === '|' && depth === 0) { branches.push(body.slice(start, i)); start = i + 1; }
  }
  if (branches.length === 0) return false;                    // no top-level alternation at all
  branches.push(body.slice(start));
  for (let i = 0; i < branches.length; i++) {
    for (let j = 0; j < branches.length; j++) {
      // `startsWith` covers EQUALITY, which is the 2ⁿ case: `(a|a)+$` took 52.3s
      // on a 27-character body. Skipping i===j is what keeps that from being
      // every pattern's own reflexive match.
      if (i !== j && branches[j].startsWith(branches[i])) return true;
    }
  }
  return false;
}

/**
 * F49 — a heuristic reject for the catastrophic-backtracking footgun: an
 * unbounded quantifier applied to a group whose body itself repeats unboundedly
 * (`(a+)+`, `(\d*)*`, `([a-z]+){1,}`) — including through a redundant wrapping
 * group (`((a+))+`, `(?:(a+))*`), which is the SAME exponential class as `(a+)+`
 * and is caught by propagating the inner repeat up through the wrapper. Such a
 * pattern can hang `RegExp.test` for seconds on a short crafted body, and THREE
 * fields feed it to an evaluator with NO timeout — one per document:
 *   - the AGENT's `artifact-written.pattern`, run by `evalExits` (F49, the
 *     original site). Self-DoS only: the agent authors both the pattern and
 *     (via the worker) the artifact, so a hang burns only its own run's
 *     wall-clock, and there is no arbiter compromise — it cannot escape the
 *     fence, forge a green, or leak a secret.
 *   - the OPERATOR's `judged.pattern` (`runClose`) and `gapKeep` (`boundGap`),
 *     compiled and run against close output in BARELOOP'S OWN PROCESS. These
 *     are worse than an operator self-DoS, and the reason is F67's lesson: the
 *     regex blocks the MAIN EVENT LOOP, so the in-process stall fuse — a timer
 *     in that same loop — cannot fire. The run dies to the OUTSIDE watchdog and
 *     is read as a model stall, so a bad regex in a SIGNED spec presents as a
 *     provider problem. MEASURED: `boundGap(stream, '(a+)+$')` on a 40-char
 *     body does not finish in 20s.
 * So the reject targets the dominant exponential class and fails it as a
 * mechanical gap at the validation gate, before any tokens burn. A full ReDoS
 * analyzer needs a real regex engine (an external native dep we do not take for
 * a LOW issue).
 *
 * SECOND CLASS, added 2026-08-12 — OVERLAPPING ALTERNATION under an unbounded
 * repeat (`(a|aa)+`, `(a|a)+`, `(\d|\d\d)*`). F49 recorded this as a genuine
 * false NEGATIVE of the shape approach and PARKED the widening, because changing
 * the detector changes which SIGNED specs are admissible. It is closed here on
 * measurement, one fresh process per point (a hot RegExp tiers up out of the V8
 * interpreter, and a single-process sweep read a LONGER body as faster —
 * backwards for an exponential, and the harness rather than the regex).
 * `(a|aa)+$` against a run of `a` with one non-matching tail character:
 *
 *     27ch 218ms · 31ch 1,879ms · 35ch 12,082ms · 39ch 52,563ms · 41ch 189,420ms
 *
 * ~6.8× per 4 characters — the Fibonacci decomposition count, φ⁴. `(a|a)+$` (the
 * 2ⁿ equal-branch case) took 52,256ms on 27ch, and `((a|aa))+$` — the redundant
 * wrapper the `((a+))+` entry above exists for — 15,426ms on 35ch, which is why
 * the overlap propagates up through a wrapper exactly as the inner repeat does.
 * Input-bounding is theater here for F49's own reason: tens of characters suffice.
 *
 * The detected core is the PREFIX RELATION between top-level branches (one branch
 * a prefix of another, equality included — `(a|a)+` is the 2ⁿ case). Whether a
 * given prefix overlap can actually be DRIVEN exponentially depends on what
 * follows the group, and deciding that needs the real engine this file declined
 * to take as a dependency — so the reject is conservative by construction, which
 * is the fail-safe direction.
 *
 * MONOTONIC, and that is the rule this change lives under: it only ever ADDS
 * rejections. Nothing above is narrowed, and no previously-rejected shape became
 * admissible (asserted over the whole corpus in tests/plan.test.js). F49's
 * "never sharpen the detector" bars chasing false POSITIVES; closing a false
 * NEGATIVE by adding rejections is the opposite, allowed direction — distinct
 * rules, not in tension (the `((a+))+` widening set the precedent).
 *
 * SCOPE IS ASYMMETRIC, both directions named on purpose:
 *   - false POSITIVE: a group whose repetitions are disambiguated by a literal
 *     anchor/delimiter (`(?:^- .+$\n?)+`, `(?:CHANGELOG:.+\n)+`) is FLAGGED even
 *     though a real engine runs it linearly — the scan sees the nested-quantifier
 *     SHAPE, not the disambiguation. Rejecting it is the FAIL-SAFE direction (it
 *     never admits an unsafe pattern), and the cost is bounded: the plan drafter
 *     gets a mechanical gap and rewrites (drop the outer `+`, or match once).
 *     Detecting "safe because anchored" needs the same real engine we declined,
 *     and guessing it wrong would ADMIT an exponential pattern — so the shape
 *     reject stands, and the over-rejection is a named, accepted limitation.
 *
 *     The alternation class has its OWN instance of the same limit, measured and
 *     locked in `REDOS_OVERREJECTED_ALT`: `(ab|abc)+$`, `(x|xy|xyz)+$` and
 *     `(x(a|aa))+$` carry the prefix relation and did NOT blow up on the bodies
 *     measured (0.3–0.4ms at 41–91 characters). "Did not blow up on the body
 *     measured" is the honest claim — no adversarial search was run for a worse
 *     input — and rejecting them is again the direction that never admits an
 *     exponential pattern.
 *
 * The input is guaranteed to compile as a RegExp (checked first by the caller),
 * so this scan assumes valid, balanced JS regex syntax.
 * @param {string} src a compiled regex source string
 * @returns {boolean} true iff a nested unbounded quantifier, or an unboundedly
 *   repeated group with overlapping alternation branches, is present
 */
export function hasNestedQuantifier(src) {
  /** `quant`: the body repeats unboundedly. `alt`: the body (or a group beneath
   * it) carries overlapping alternation branches. `at`: where the body starts,
   * so the branches can be read back when the group closes. The two hazard flags
   * are tracked separately and propagate separately — merging them would let a
   * plain nested repeat be reported as an alternation overlap and vice versa,
   * and the two are different rewrites for the author. */
  /** @type {{ quant: boolean, alt: boolean, at: number }[]} */
  const stack = [];
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === '\\') { i++; continue; }          // escaped atom — the next char is a literal
    if (c === '[') {                            // character class: quantifier chars inside are literals
      i++;
      if (src[i] === '^') i++;
      // NO POSIX leading-`]`-is-a-literal rule: JS is not POSIX here. `[]` is the
      // EMPTY class (matches nothing) and `[^]` the any-char idiom — both close at
      // that first `]`. Skipping it ran the scan past the class's real end and
      // swallowed every quantifier after it, so `x[^](a+)+$` read as safe while
      // RegExp.test on it does not finish in 15s on a 31-char body. A false
      // NEGATIVE is the dangerous direction (F49), so the scan follows JS.
      //
      // Honest limit on the monotonicity claim: this is a PARSE correction, not
      // the "add rejections only" tightening F49's rule contemplates, and it is
      // not strictly rejection-monotonic. Measured over 14,862 compilable
      // generated patterns (2,369 previously rejected): 2 rejections disappear,
      // both pathological `[]`-bearing shapes whose old `true` came from the very
      // misparse being fixed, and both verified to finish RegExp.test in ~0ms.
      // Every entry of the checked-in REDOS_BAD/GOOD/OVERREJECTED corpus is
      // unchanged. So no real hazard was un-rejected — but the claim is
      // "measured, no hazard lost", never "monotonic by construction".
      while (i < src.length && src[i] !== ']') { if (src[i] === '\\') i++; i++; }
      continue;
    }
    if (c === '(') { stack.push({ quant: false, alt: false, at: i + groupPrologueLen(src, i) }); continue; }
    if (c === ')') {
      const g = stack.pop();
      const qlen = unboundedQuantLen(src, i + 1);
      if (g && g.quant && qlen) return true;    // group repeats unboundedly AND its body did too
      // …and the SECOND class: the body's own top-level branches overlap, so the
      // engine has more than one way to consume the same text and an unbounded
      // repeat multiplies those ways (MEASURED: `(a|aa)+$` 12.1s on a 35-char
      // body). `g.alt` carries an overlap found in a group BENEATH this one, for
      // the redundant-wrapper reason one comment down.
      const overlap = !!g && (g.alt || altBranchesOverlap(src.slice(g.at, i)));
      if (overlap && qlen) return true;
      if (overlap && stack.length) stack[stack.length - 1].alt = true;
      // The group is an unbounded-repeated atom of its parent when it is directly
      // re-quantified (qlen) OR its own body already repeats unboundedly (g.quant):
      // a redundant wrapper — ((a+))+ , (?:(a+))* , (((\d*)))+ — is the SAME
      // exponential class as (a+)+, so an inner repeat must propagate THROUGH the
      // enclosing group or the outer quantifier's close never sees it. Propagation
      // is MONOTONIC (it only ever SETS quant=true → only ever adds rejections): it
      // can widen over-rejection — the named FAIL-SAFE direction — but can never
      // introduce a false negative, which is the dangerous one (F49).
      if ((qlen || (g && g.quant)) && stack.length) stack[stack.length - 1].quant = true;
      i += qlen;
      continue;
    }
    const qlen = unboundedQuantLen(src, i);     // a quantifier applying to the preceding atom, inside the current group
    if (qlen) { if (stack.length) stack[stack.length - 1].quant = true; i += qlen - 1; }
  }
  return false;
}

/**
 * The catastrophic-backtracking reject, applied to a WHOLE signed document by
 * tree walk — `sweepSecretLiterals`'s twin, and for its reason: some signed
 * documents carry their regexes at a depth no per-field check enumerates.
 *
 * WHY IT EXISTS (PRD v1.60 §1, an OPEN GAP now closed). v1.55 took F49's reject
 * to the operator's own regex fields, and the admissibility sweep that backed it
 * walked `jobs/*.json`. That is not the population of signed specs: a REGISTRY
 * BRIDGE is signed the same way, ships its plans VERBATIM (reuse stores the
 * whole plan, never a template), and lives outside `jobs/`, so a pathological
 * pattern arriving through a bridge was never swept. Nothing had decided
 * bridge-borne patterns were safe — the sweep was written against the directory
 * that held every spec at the time and was never re-aimed.
 *
 * WHAT is rejected is UNCHANGED: `hasNestedQuantifier`, one inventory, shared
 * with job.js and plan.js. Only WHERE it looks is wider. Widening the DETECTOR
 * is arbiter-adjacent and stays parked (F49); widening the POPULATION is this.
 *
 * KEY-SCOPED, deliberately. `pattern` and `gapKeep` are the exactly-three regex
 * fields F49 names (`artifact-written.pattern`, `judged.pattern`, `gapKeep`);
 * every other string in a signed document is prose, a path or a command, and
 * running a regex-shape scan over prose would red goals for containing `(a+)+`
 * in a sentence. A field carrying a regex under a NEW key is not swept until
 * this list names it — stated so the limit is read rather than rediscovered.
 *
 * COMPILE-FIRST, like both per-field callers: the scan's contract is that its
 * input is valid regex syntax, and a string that does not compile is the OTHER
 * validator's red. Two reds on one string bury the real one.
 * @param {any} root
 * @param {(code: string, path: string, detail?: string) => void} red
 */
export function sweepNestedQuantifiers(root, red) {
  (/** @type {(node: any, at: string, key: string) => void} */
  function sweep(node, at, key) {
    if (typeof node === 'string') {
      if (key !== 'pattern' && key !== 'gapKeep') return;
      try { new RegExp(node, 'm'); } catch { return; }
      if (hasNestedQuantifier(node)) {
        red('invalid-value', at, `catastrophic-backtracking risk: a nested unbounded quantifier (${node}) can hang the untimed evaluator on the MAIN event loop, where the in-process stall fuse cannot fire (F49). Rewrite the pattern — drop the outer repeat, or match once.`);
      }
      return;
    }
    if (Array.isArray(node)) node.forEach((v, i) => sweep(v, `${at}.${i}`, key));
    else if (isObj(node)) for (const [k, v] of Object.entries(node)) sweep(v, at ? `${at}.${k}` : k, k);
  })(root, '', '');
}
