# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2026-09-29

M6a: the authoring backend. `fwdloop draft` turns signed prose into a declaration draft and
`fwdloop sign` records the human signature; amendment 1 makes each step's goal its signed line
verbatim and requires every ask's wait to be signed.

### Added
- `fwdloop draft` / `fwdloop sign` (CLI + `src/authoring.js`): `draft` writes a draft dir (the
  declaration, a readout of the steps, asks and exact signed waits, and a `spec.hash` that covers
  the prose, the sources and the target root+name). Paid spend is booked before anything else, so a
  write failure keeps the cost. The draft dir is claimed before the paid round. A draft is scrubbed
  for key values; a leak leaves a marker and no `spec.hash`, and `sign` re-sweeps and refuses a leak
  marker. A budget below one round's ceiling is refused at $0 before any provider call.
- `src/drafter.js`: the drafter. One forced `emit_declaration` tool call whose schema is built from
  the wired menu only (an unwired verb is never offered and reds by name if granted anyway). The
  structure retry keeps the validator's reds, and the log's `kind` reflects the real round.
- Input facts: the harness reads each source's headings (markdown and docx) into `inputFacts`, so
  the drafter can pin `picks` to real heading names.
- `validateDeclaration` takes `wired` (an unwired verb reds by name) and `verbatimGoals` (a step
  goal that is not exactly its signed line reds) options; `wiredMenu` lives in one place.
- `makeProvider` takes a `thinking` option, sent verbatim as `body.thinking`; the drafter passes
  `{ type: 'disabled' }` (F49). Deps: `bare-agent` bumped to `^0.49.0`.
- Amendment 1: each step's `goal` is its signed line, verbatim, set by the machine at draft
  and refused at sign if edited; an ask needs a signed wait (`ask 30m:`), never a code default.
- Amendment 2: `fwdloop sign` needs an interactive terminal (stdin and stdout TTYs) and a typed flow
  name; piped or scripted input is refused and no flow is written. It raises the bar, it is not
  proof of a person (a script can fake a TTY). `signDraft` stays a library for tests.

### Changed (breaking for authoring)
- Prose with a bare `ask:` (no signed wait) is now refused by `draft`/`sign`; write `ask 30m:`.
  Flows signed before 0.8.0 still run unchanged, with the 30m default.
- The drafter no longer authors `goal` (removed from its forced schema).

### Fixed
- A drafter provider call that failed with no metering (e.g. a timeout after a priced round) was booked and printed as a complete cost. The draft result, the booked spend row, the readout and the CLI's `cost:` now carry `spendComplete:false` ("at least $X", the runner's convention) and `calls` counts every provider call.
- F50: the drafter paraphrased goals and dropped prose detail ("200ish each"); goals are now the
  signed line verbatim. Prose-only sizes are still judged only by the human at the ask.
- The catalogue's `compress` is described as a code shrinker, not a text shortener (the drafter
  picked it for prose).

## [0.7.0] - 2026-09-29

M4a: a read-only panel over the run books, the F48 symlink-escape class closed, and the
bareguard/bare-agent switch-over.

### Added
- M4a `fwdloop panel [--port 4800] [--root <dir>]` (`src/panel/`, borrowed from bareloop's panel
  and rewired to fwdloop's own books): a read-only local web panel with Runs (Workflows/History),
  Run (step map with try-N badges and a dashed retry loop, step cards), Audit (collapsible
  per-step groups, Blocked/Human filter, time/tokens/cost/tool-tally cells), Job (signed
  declaration), Ask (open ask plus archived asks, i-of-n) and Inbox (stops list) tabs. It works at
  390px width. It never writes; an expired unresumed ask draws `[!]`, and unknown data reads as
  "not recorded", never as a number. Built on one reader per book (`src/panel/data.js`).
- CLI: `--root` is resolved to its real path once at command start (one helper for run, resume,
  inbox, show, answer, panel; a missing root fails by name). Everything inside the root stays
  under bareguard's symlink refusal.
- Deps: `bareguard` bumped to `^0.19.2` — a symlinked `fs.readScope`/`fs.writeScope` root (or any
  symlinked ancestor) is refused at Gate construction and denied `.symlinkRoot` on every later
  check, closing the `<runDir>/out`-symlink write escape. `resolvePrimitives` turns the construct
  throw into a red with no tools for the step, and `runFlow`/`resumeRun` (new `primitiveReds`
  option, wired by `bin/fwdloop`) refuse the run by name at $0.
- Audit: every model-attempt `audit.jsonl` row (and its `log.json` attempt entry) carries
  `refused`, an array of `{ verb, path, rule }` for each bareguard fs-gate refusal that attempt
  (`[]` when none, never omitted). Rows with no model call carry `refused: []` too.
- Deps: `bareguard` bumped to `^0.19.1` (patch: a file action with no path is denied `fs.invalidPath`; `bash.allow` matches whole words; blank allow entries rejected — none affect fwdloop, which sends absolute paths and grants no bash).
- Deps: `bare-agent` bumped to `^0.48.0`; `makeProvider` sets `exposeMalformedArgs: true`, so the
  "arguments were not valid JSON twice" red carries the model's raw broken arguments again
  (`; raw: ...`, capped at 500 chars upstream, ` (truncated)` appended when clipped). Provider
  error bodies are still not exposed.
- Deps: `bare-agent` bumped to `^0.47.0`, `bareguard` bumped to `^0.19.0` — pulls in
  `createShellTools({ noFollowSymlinks: true })`/`resolveToolPath` (bare-agent) and bareguard's
  fs `Gate` (deny-by-default read/write scopes, symlink-safe resolved-path checking on by
  default), both wired into `src/primitives.js` — see the "Fixed" entry below.
- Amendment M4a-3 (docs/wiki/the-module-ladder.md, "M4a"): every new `audit.jsonl` row also
  carries `tools`, a `{toolName: count}` tally of every GRANTED tool the model actually invoked
  that attempt, summed across every round — taken straight from bare-agent's own per-round
  `result.metrics.byTool` (never a separately-maintained hook, so an unknown-tool name the model
  hallucinated is counted the same honest way bare-agent already counts it); `{}` when the model
  called no tool, `null` only when the row has no model call at all. A tool name the step never
  granted is flagged in `ungranted` (an array, omitted when empty) — bare-agent refuses it before
  `execute` ever runs, and this amendment records that refusal rather than folding it into `tools`
  as if it had been allowed. `src/books.js`'s `appendAudit` refuses at write time an omitted
  `tools`, a model-call row with `tools: null`, a malformed `tools`/`ungranted` shape. Rows written
  before M4a-3 simply lack the keys; `auditRowTools(row)` (`src/books.js`, re-exported from
  `src/index.js`) reads them back as "not recorded (before M4a-3)" rather than inventing a tally.
  Now wired into the panel: `src/panel/data.js` uses `auditRowTools` for the Audit tab's tool
  tallies (commit 9064e7c).
- Amendment M4a-2 (docs/wiki/the-module-ladder.md, "M4a"): every new `audit.jsonl` row now
  carries `at` (ISO time the attempt finished) and `tokens` (`{inputTokens, outputTokens,
  cacheReadTokens}` summed over that attempt's model calls, threaded from the same per-round
  metering `src/model-step.js` already sums into `costUsd` — never re-derived from spend.jsonl by
  position; `null` when the row has no model call). `src/books.js`'s `appendAudit` refuses at write
  time a row with an invalid/missing `at`, an omitted `tokens`, or a model-call row with no
  `tokens`. Rows written before M4a-2 simply lack the keys; `auditRowTokens(row)` (`src/books.js`,
  re-exported from `src/index.js`) reads them back as "not recorded (before M4a-2)" rather than
  inventing a number.
- Amendment M4a-1 (docs/wiki/the-module-ladder.md, "M4a"): every park now writes a permanent,
  write-once archive of its ask into the run dir, `asks/<askId>.json` (question, askedAt,
  expiresAt, evidence), alongside the existing (mutable) `ask.json`. Nothing deletes an archived
  ask — not resume, not answer consumption, not rerun. `writeAskArchive`/`listArchivedAsks`
  (`src/ask.js`, re-exported from `src/index.js`); `listArchivedAsks` pairs each archived ask with
  its consumed answer by `askId`, never by position, and reports "draft not kept (before M4a-1)"
  for a run with no `asks/` dir. Now wired into the panel: `src/panel/data.js` uses
  `listArchivedAsks` for the Ask tab (commit 9064e7c).

### Fixed
- `read`/`grep` `role` lookup is own-key only: `__proto__`/`constructor`/`toString` now get the named `no frozen input for role` refusal instead of a raw TypeError. Stale `allowedRoots` comment reworded.
- Fix-once switch-over (fix-ledger "step `write` may overwrite frozen inputs"): `src/primitives.js`
  now routes `read`/`grep`/`write` through a bareguard `Gate` (readScope: the run dir + every
  frozen input's own directory; writeScope: ONLY `<runDir>/out` — the run dir root, `state.json`,
  `audit.jsonl`, `spend.jsonl`, `answer*.json`, `ask.json`, and `inputs/` are readable but no
  longer writable) plus `createShellTools({ noFollowSymlinks: true })`, which refuses (`ELOOP`) a
  symlinked FINAL path component (file, dir, or dangling link) at open time, closing the "open
  what the check approved" gap the old lexical-only check left. The old `isPathAllowed`/
  `sandboxError` pair (lexical containment only, no resolved-path/symlink check, and one writable
  root covering the whole run dir) is removed. `<runDir>/out` is created lazily on the first
  actual write, never at tool-resolve time, so `bin/fwdloop`'s own predicted-run-dir call before
  `runFlow` creates anything stays a no-op on disk for a run that goes on to refuse.
- BA-27 (bare-agent >=0.47.0): a malformed tool-call's arguments are now reported via
  `result.malformedToolCall: { name, error }` on a normal `generate()` return instead of a thrown
  `SyntaxError` — `src/provider.js`'s `MalformedToolCallTolerantOpenAI` read the old throw-based
  shape and silently stopped catching the case under 0.47 (the F28/2026-09-15 red degenerated into
  the wrong "returned text instead of the tool" message). Now reads `result.malformedToolCall` as
  delivered; `rawArguments` is no longer recovered from a private response field (bare-agent never
  echoes it back) — `src/model-step.js`'s red omits "; raw: ..." when it's absent.
- F48 (docs/logs/FINDINGS.md): F36 refused `runs/` itself being a symlink, but a runId-named
  symlink INSIDE `runs/` pointing outside `--root` was still followed — the panel's
  `GET /api/runs/<flow>/<runId>/audit` route returned the symlink target's `audit.jsonl` at HTTP
  200. `resolveRunDir` (`src/flow.js`) now `realpathSync`s `runs/` and the run dir (when they
  exist) and refuses either one if it resolves outside the flow directory; a not-yet-created run
  dir is unaffected. The panel's own flow-name segment (`resolveFlowDir`, `src/panel/data.js`) got
  the same real-path check, closing a symlinked-flow-directory variant of the same hole.
- F48 round 3 (docs/logs/FINDINGS.md): the same class one level deeper — a real (non-symlinked) run
  dir whose own book FILE (`audit.jsonl`, `ask.json`, `state.json`, `log.json`, `spend.jsonl`, an
  `asks/<id>.json` archive entry, a consumed-answer marker) is a symlink pointing outside `--root`
  was still followed by every reader. New `resolveInside`/`readFileInside`/`readdirInside`
  (`src/flow.js`) is the one mechanism every reader in `src/books.js`, `src/runner.js`,
  `src/provider.js`, `src/ask.js`, and `src/panel/data.js` now routes through. This round also
  corrects round 2's wrong "not actually exploitable" claim about `bin/fwdloop`'s CLI: a live
  plant showed `fwdloop inbox`/`show` printing a symlinked `ask.json`'s outside content as a real
  ask (status 0, no refusal) — `findRunDirByAskId`/`cmdInbox`/`cmdShow`/`cmdResume` built their own
  paths with a private `join()` + raw `readdirSync`/`readFileSync`, bypassing
  `checkFlowName`/`checkRunId`/`resolveRunDir` entirely; they now walk flows/runs via
  `listFlowNames`/`listRunIds`/`resolveRunDir` and read book files via `readFileInside`, same as the
  panel. Several writers (`appendAudit`/`appendHistory`/`appendSpendRow`, `log.json`/`state.json`/
  a fresh park's `ask.json`, `inputs.json`, an `overwrite:true` artifact write) are reported, not
  fixed, in `docs/logs/FINDINGS.md`'s F48 round-3 entry — `answer.json`/`asks/<id>.json` are already
  safe (`{ flag: 'wx' }`).
- F48 round 3 follow-up (docs/logs/FINDINGS.md): round 3 itself missed one reader —
  `resumeRun`'s own inline `state.json` parse (as opposed to `readRunState`, its already-converted
  display sibling) was still a raw `readFileSync`. A parked run whose `state.json` was swapped for
  a symlink to a forged outside file (spend matching the run's own `audit.jsonl` sum, `expiresAt`
  far in the future) resumed straight to completion instead of being refused. Now goes through
  `readFileInside` like every other reader in `src/runner.js`. The same audit found `readArtifact`
  (`runs/<runId>/artifacts/<id>.json`) was the same class of bypass — converted too. Added
  `test/f48-guard-raw-reads.test.js`, a mechanical scan that fails on any raw
  `readFileSync`/`readdirSync`/`createReadStream`/`openSync` call in `src/**/*.js`/`bin/fwdloop`
  outside a narrow, per-call-site allow-list, so a future missed reader fails a test instead of
  waiting for another debrief.
- F48 round 4 (docs/logs/FINDINGS.md): round 3's fix collapsed `readArtifact`'s result to one
  value (`undefined`) for BOTH "never written" and "read refused" — a swapped/deleted accepted
  artifact at the send slot looked identical to "nothing to send yet". Added `readArtifactResult`/
  `readArtifactsMapChecked` (tri-state: `ok` / `missing` / `red`); every call site that can see
  fresh content now halts the run by name on a `red` instead of silently feeding tampered content
  forward. `readArtifact` survives only as a documented collapsing wrapper for the four call sites
  the resume "done?" gate already proved `ok`. `src/send.js` now refuses `undefined`/`null`/
  non-object/array content by name, writing nothing, instead of serialising `content ?? null`.
  Replaced `test/f48-guard-raw-reads.test.js` (evadable via an aliased import, a namespace
  dot/bracket access, `fs/promises`'s `readFile`, or a pasted copy of an allowed line — a debrief
  proved all four) with `test/f48-guard-fs-imports.test.js`: an import-level scan that pins the
  EXACT per-name use count of every `fs` binding reached per allow-listed file (aliases and
  namespace/default access fold under the real name), catches `require('fs')` via a
  `createRequire`-aliased local name, and pins `readArtifact(`'s 4 remaining call sites in
  `src/runner.js`. Finding C (no hash of the ACCEPTED ARTIFACT'S CONTENT — send trusts whatever is
  on disk at send time) is reported, not fixed; hamr sent it to M4b as a signed-amendment
  candidate, not yet signed.
- F47 (docs/logs/FINDINGS.md): `fwdloop show` (and `bin/fwdloop`'s `artifactText()`) read
  ask.json's evidence only in the M3 shape (`evidence.artifact.text`/`evidence.unjudged`) and
  printed the literal string `"undefined"` for a real M2-era ask.json (`evidence.text`/
  `evidence.lines` directly), or for an ask.json with no `evidence` key at all. One shared reader,
  `readAskEvidence()` (`src/ask.js`, re-exported from `src/index.js`), now normalises all three
  real shapes — M3, M2, and none (parked pre-F45) — into `{ draft, unjudged, why? }`, never
  inventing `"undefined"`/`""`/`0` for missing data; an unrecognised shape is a named `why`,
  never a crash. `fwdloop show` and `poc/m4/panel-data.mjs`'s Inbox evidence fields both use it.
- Path escape: `bin/fwdloop`'s `--run-id` (and `resume`'s runId positional) could name a path
  outside the flow's `runs/` directory (e.g. `--run-id ../../../../tmp/pwned`). Both now go
  through one shared `resolveRunDir` (`src/flow.js`): a strict allow-list on the runId's
  characters, then a check that the built path actually resolves inside `runs/`. `runFlow`/
  `resumeRun` (`src/runner.js`) carry the same check as defense in depth. A run id generated by
  the CLI, or a rerun id (`<runId>-rerun-1`), is unaffected.
- F46 (docs/logs/FINDINGS.md): a step whose declaration grants a verb `resolvePrimitives` has no
  wired implementation for (e.g. litectx's `compress`) used to print a warning to stderr and let
  the run continue and spend against it. `bin/fwdloop`'s `run`/`resume` now refuse at preflight,
  naming the step and the verb, before any model call or ledger spend. Wiring the litectx verbs
  themselves is still open.

## [0.6.0] - 2026-09-26

M3: a run parks at a signed ask and resumes in another process, a `fwdloop`
CLI, rerun as a fresh run.

### Added
- `resumeRun`/`makeParkingAskStep` (`src/runner.js`) and `answerAsk`/
  `makeFileAskStep` (`src/ask.js`): a run now parks at the signed ask and
  exits instead of blocking in-process; resume locks the run, re-verifies
  flow identity, signature, frozen inputs, artifacts and spend, consumes the
  answer once (rename), and continues from the same step index.
- A per-ask signed TTL now governs expiry (F43) in place of a fixed
  in-process wait; an expired ask cancels the run carrying its real spend,
  never `$0`.
- `bin/fwdloop` CLI: `run` (parks at the ask and prints the answer command),
  `inbox` (lists open/expired asks, read-only), `answer`, `resume`, and
  `show <askId>` (prints the parked ask's evidence, read-only); the key
  loads from `DEEPSEEK_API_KEY` only, refused at $0 before any run dir or
  book row is written.
- `rerun "<reason>"`: starts a fresh run (`<runId>-rerun-1`) with its own
  frozen inputs, cap and redo counter; the reason is recorded as the first
  step's gap; the old run's history row is marked `rerun`.
- `src/declaration.js`: a send's "earlier" signed ask is now judged by step
  order in `declaration.steps`, not by prose line number (M3 item 8),
  matching how the runner actually folds over steps.

### Fixed
- (F45) `inbox` no longer shows an unanswerable ask as open: an M2-era ask
  reads as "legacy (not answerable)", a malformed one as "unreadable", both
  naming the run.
- (F45) A parked ask carries its evidence (`artifact`, `unjudged`) forward
  on every park/re-park; a run's history `wallMs` is now measured from the
  run's real first start, not from the resume that reported it.
- An unparseable `expiresAt` (`Number.isNaN(Date.parse(...))`) is never
  treated as unexpired, in both `answerAsk` and `resumeRun`.
- `resumeRun` refuses a negative spend or a spend below the run's own
  `audit.jsonl` sum, instead of resuming on a state row that doesn't add up.
- The audit-sum check tolerates floating-point summation order
  (`SPEND_TOLERANCE_USD` = `1e-9`), so an honest retry-floor run no longer
  false-refuses.
- Removed an unreachable send ask-count branch (`askIdsInReads.length !==
  1`): `readFlow` already validates exactly one earlier signed ask at
  signing time.

### Known limits
- Resume is manual after an answer is written — nothing watches for the
  answer and resumes the run automatically.
- A `runId` (`run --run-id`, `resume <runId>`) is not validated: a `..` in
  it can place the run's files outside the flows tree. Only the operator
  types it today; it is on the fix list before the UI takes run ids.

## [0.5.0] - 2026-09-25

M2: the runner — one fold over a signed flow, live-wired to a provider, with
an in-process human ask and a signed send.

### Added
- `src/runner.js`: one fold over a signed flow at $0 baseline — `readFlow`+
  hash refusal, frozen inputs, executor built without close or cap (a leaky
  double reds on construction), closers by class (citation core; every
  `SHAPE_KEYS` checker, all failing checks reported), ralph loop
  (`STRIKE_LIMIT` 2, attempt fallback 4), cap-halt before the attempt,
  pricing-red on null cost, provider-red after one retry, ask with redo cap
  and consume-once answers, write-time send re-check, `audit.jsonl` +
  `history.jsonl` (one writer each). Amendment 1 (signed 2026-09-24):
  `checkDoneBlocker` halts a step red on `done:false` (outcome `not-done`,
  kept in `log.json` but stripped before closers/disk); unjudged hitl
  artifacts carry forward into the next signed ask as
  `evidence.unjudged`/`unjudgedCount`. F42: a send whose `reads` hold none or
  more than one signed ask's artifact halts red before `sendStep`, so does a
  send whose ask was not accepted this run.
- `src/provider.js`: model slots, rates, ceiling, key preflight.
- `src/model-step.js`: metered rounds, malformed tool-call retry, transport
  floor, wall-halt never retried, `emit_artifact` schema gains the typed
  `done` (required)/`blocker` self-report fields, by class only.
- `src/declaration.js`: `validateDeclaration` reds a hitl step after the last
  signed ask that isn't the send slot (Amendment 1); requires exactly one
  earlier ask emit in a send's `reads` (F42).
- `src/primitives.js`: sandboxed read/write/grep; `readDocx`/`addressCells`
  by role. Amendment 2 (signed 2026-09-24): read/grep list and accept only
  text roles (`.md`/`.txt`); a `.docx` role is refused by name pointing at
  `readDocx`, `.csv` at `addressCells`, any other extension "no text
  primitive serves it" — enforced on the role name beyond the schema enum;
  no `role` property emitted when no text role exists.
- `src/ask.js`: in-process file ask — consume-once answers, stale-answer
  quarantine, timeout halt.
- `src/send.js`: the file send primitive — ships to a signed destination,
  re-checking it at write time.
- The M2 gap-back healing POC and live-wiring drivers live under `poc/m2/`
  in the repo (not shipped in the published package).

### Fixed
- Artifacts are written to `runs/<id>/artifacts/` by one writer and read
  back from disk; `log.json` keeps every attempt's raw model output on every
  exit path, including halts; a late `answer.json` is audited as
  answer-after-run.
- (F41) Halted runs carry `signatureHash` on the history row (`null` only
  before `readFlow` succeeds); an attempt's audit `usd` sums a retried
  transport fault's priced floor with its own cost, so audit rows sum to
  history `spentUsd` (never `?? 0`, a known partial is never dropped).
- `closeWordsAndSections` (shape closer) reports every failing check
  (`reds[]`, joined red) instead of first-red-wins, and its heading sentence
  states the form (F38).

## [0.4.1] - 2026-09-23

### Fixed
- `poc/m0/runner.mjs` — `checkSendDestination` now follows a send target's
  realpath after the lexical containment check, refusing a symlink inside
  the repo that resolves outside it (was lexical-only).
- `src/declaration.js` — `close.shape` now enforces a signed v1 vocabulary
  (`maxWords`, `sections`, `linesPerInvoice`, `mustCarry`, exported as
  `SHAPE_KEYS`); any other top-level key inside a shape reds by name;
  `sections`/`mustCarry` must be non-empty arrays; any shape that is not
  an object reds too; new `checkShapes(declaration)` for batch scoring.
- `poc/m0/drafter.mjs` — the drafter prompt and tool schema now name the
  four signed shape keys, built from `SHAPE_KEYS` so prompt and validator
  cannot drift; measured 40/40 shape-green on deepseek-flash vs 2/60
  before (F37).
- `src/flow.js` — `readFlow` now checks `runs/` exists, is not a symlink,
  is a directory, and is readable, combining with the other file-read
  reds.
- `poc/m1/slot-batch.mjs` — `shape=` column per draft, `shapeGreen` in
  SUMMARY and `--rescore`.
- `poc/m0/runner.mjs` — `sendViaPrimitive` takes the signed `file:` target and
  re-runs `checkSendDestination` at write time, so a destination swapped for
  an outside symlink during the human ask pause reds instead of landing
  outside the repo (was checked once at preflight only).
- `src/declaration.js` — `checkShapes` now reds a `close.shape` that isn't a
  plain object (array, string, number, null) and still counts it toward
  `shapedSteps`, matching `validateDeclaration`'s existing red for the same
  malformed input (previously it silently skipped a non-object shape,
  counting and redding neither).

## [0.4.0] - 2026-09-22

M1: the flow module — signed prose and declaration become real `src/` code
(five pieces: arbiter grammar, signature, declaration, catalogue, flow
directory), plus the three signed M1 amendments and the paid-path batch
tool.

### Added
- `src/signed-text.js` (piece 1): typed arbiter grammar (cap, ask+ttl, redo
  cap, send, skills, source, round budget) — every red is by line and
  field, no regex run against signed text. A send requires an earlier ask;
  `url:` kinds refused until M9.
- `src/signature.js` (piece 2): sha256 hash pinning over canonical prose
  (CRLF→LF only) and canonical declaration JSON (sorted keys); signature
  version 2 pins who signed and when (`[proseHash, declHash, signedBy,
  signedAt]`), any other version refused by name; `verifyFlow` names the
  file that changed.
- `src/declaration.js` (piece 3): closed declaration schema — unknown key
  refused by name and path, arbiter keys refused at any depth;
  `inputFacts`/`picks` replace `realColumns`/`columns` (Amendment 1, signed
  2026-09-21); ask slots and a send lock on `arbiter.asks[]`/`sends[]` with
  writes checked by catalogue class and a walkable chain; job #1 and job #2
  validate through one code path.
- `src/catalogue.js` / `src/catalogue.json` (piece 4): the primitive
  catalogue as a data file (14 primitives, 4 plumbing), parsed against a
  closed schema; `checkpoint` moved from the drafter's menu to plumbing
  (F31: a pause exists only where a human signed one); own readers
  (`addressCells`, `readDocx`) pinned as unresolved until their modules
  land in `src` at M2.
- `src/flow.js` (piece 5): the one reader and one writer of
  `flows/<name>/` (`prose.txt`, `declaration.json`, `signature.json`,
  empty `runs/`) — `writeFlow` writes nothing unless the text parses, the
  declaration validates and a caller-supplied `signedBy` signs it; never
  overwrites a signed flow; signature written last and read back;
  `readFlow` verifies the hash on the bytes on disk before trusting
  anything and refuses symlinks.
- `types/*.d.ts` for all five `src/` modules, per `LIBRARY_CONVENTIONS`.
- Amendment 3 (signed 2026-09-21): the ask becomes a mark on its own
  numbered line — `N. ask: <words>` or `N. ask <int><s|m|h>: <words>`,
  words required, zero wait refused; `guardrail: ask at line N` is no
  longer grammar and reds once, naming the line; duplicate-ask red deleted
  as impossible by construction. The one step bound to a signed ask line
  now grants no primitive, else reds naming the line, step and verbs
  (before: a read/write step on the ask line validated green).
- `poc/m1` batch tool: `--job job1|job2|twoask` selects the prose (ask
  lines always parsed from the chosen one, job name in output paths,
  unknown job refused at $0); M1's own ledger
  (`poc/m1/out/spend.jsonl`) under `M1_CAP_USD` 5.00; a live batch saves
  the prose it ran against per tag, and `--rescore` prefers the saved
  prose and never overwrites consumed results; a draft with no
  declaration now keeps what actually came back (outcome, the model's
  text verbatim, the provider's message) instead of a bare null; the live
  key is redacted by literal replacement (trimmed and raw forms) before
  provider or model text reaches an artifact or the jsonl row.
- A default ceiling price always exists (hamr's ruling 2026-09-21, F31): a
  null-cost row is priced at read time — a known model at its own peak
  rate, an unknown model at the table's highest — never rendered as
  unknown or as $0; the cap lock survives as money, and the rate table is
  the human override.

### Fixed
- **The publish workflow now fails when `package-lock.json`'s version drifts from `package.json`.** npm writes that field on install, so a release that bumps `package.json` without running one leaves it behind — and nothing caught it: `npm ci` fails when the lockfile's *dependency* entries disagree, but never checks the lockfile's copy of the project's own version. `scripts/check-lockfile.mjs` (`npm run check:lockfile`) compares both places npm writes it and runs in the publish workflow. No lockfile is not a failure.
- (F35) The batch checker never had the stop-only rule, and the ask mark
  had never actually run in front of a paid model; both fixed. Old
  job1/job2 tags rescored at $0 with 0 stop-only hits; F34's two-ask count
  corrected to 14; re-measured on `deepseek-flash`: job1 20/20, two asks on
  their own lines 20/20 with every read bound to its line.
- (F34) The two-ask fixture had signed an ask on a line that also carried
  work, invalidating F33's 20/20 reading; corrected. A 691s provider red
  on the job #2 path was traced to a machine suspend plus an `ECONNRESET`
  on resume, not a deadline gap — the 240s race covers both draft paths
  (retraction of the earlier F34 deadline claim).
- `package.json` `files` drops `bin` and `fwdloop.context.md`, neither of
  which exist (`npm pack` unchanged, 19 files).

### Changed
- `ledger`/steps.txt now carries the ask mark directly instead of the
  retired `ask at line N` guardrail text (same parsed slot); the M1 ladder's
  scope item 2 names `picks`/`inputFacts`, not the dead `columns`.
- M0's `parseArbiterSlots` learns the ask mark (the legacy `ask at line N`
  form is kept for M0 fixtures only; both forms present at once is an
  error).

## [0.3.0] - 2026-09-16

M0b Amendments A and B: the redo edge (`askWithRedo`) and job #2 — a second
job, resume/JD in from a `.docx`, drafted and run through the same signed
fold as job #1.

### Added
- `shape.mjs`: declared-shape close (`closeWordsAndSections(text, {maxWords,
  sections})`) — green/red naming the word count and limit, or the
  missing/out-of-order heading; unparseable for non-string input.
- `redo.mjs` (Amendment A): `askWithRedo` — a typed, tighten-only redo cap
  (1..3, >3 refused); a reason-less rerun is refused and re-asked without
  spending a redo; every attempt/reason/cost is written to `audit.jsonl`
  with a parent; a 4th rejection halts the run naming the step; unknown
  cost is never rendered as 0.
- `docx.mjs`: stdlib `.docx` text reader — hand-parsed zip (EOCD, central
  directory, local header, inflateRaw/stored, CRC-32 and size verified)
  plus paragraph/run extraction from `word/document.xml`; negatives
  (non-zip, missing `document.xml`, truncated, CRC mismatch) never throw.
- `job2.mjs`: job #2's own fold, hard-wired to its shape — read docx, read
  JD, compose under `askWithRedo`, send on accept. Reuses `freezeInputs`,
  `checkFreshRunDir`, `checkSendDestination`, `runModelStepOnPrimitives`,
  `sendViaPrimitive`, `checkStepHappened`. Catalogue gains `readDocx`.
- Drafter/scout job #2 path: `scoutJob2` gives $0 shape facts (docx
  paragraphs/words, md headings) with body text withheld; `draftJob2`
  reuses job #1's paid `emit_declaration` round; `bindJob2DeclarationSteps`
  and `checkJob2Grants` bind steps by line and check grants
  (readResume→readDocx, readJd→read, send→write).
- `JOB2_SHAPE` headings taken verbatim from hamr's own prose ("summary of
  work history" etc.) rather than the ladder's paraphrase.
- Three signed checks on job #2's compose step: a `.docx` 20 MB cap
  enforced at two layers, the send target must resolve inside the repo,
  and job #2's inputs are fenced as data in the compose prompt (not
  instructions) — plus the CRC-mismatch test the review ledger asked for.

### Fixed
- (F29) One human rerun replayed as four rejections and halted the run at
  the redo cap with no human in the loop; `answer.mjs` now renames each
  answer to `answer.attempt<n>.<seq>.consumed.json` the moment it is read,
  and quarantines (`stale-answer-ignored`) any answer whose `answeredAt`
  predates its ask's `askedAt`.
- (F30) A drafter report file passed as `--declaration` reds at preflight
  ("declaration must have a non-empty steps array"); `job2.mjs` now
  unwraps it the same way `runner.mjs` already does.

## [0.2.1] - 2026-09-15

### Fixed
- Runner tests seeded from committed fixtures under `poc/m0/fixtures/stale-run/`
  instead of git-ignored `poc/m0/out/` dirs, so the suite passes on a
  tracked-files-only checkout (CI). v0.2.0 was tagged but never published to
  npm because the publish workflow's Test step failed on these two tests.

## [0.2.0] - 2026-09-15

M0b: "run it, close it" — the drafter's declaration runs for real, against real
baresuite primitives, under a signed send lock.

### Added
- Runner: executes a drafter declaration as a fold over steps (PRD §5) on real
  baresuite primitives (`gather`/`ask`/`send`/`derive`/`compose`) instead of
  mocked I/O — each step in a fresh Loop carrying only its goal line and the
  prior steps' compact artifacts.
- Signed arbiter send lock: typed slots wired to a real job line, proven by
  preflight grant checks rather than prompt wording (F24).
- Preflight: freezes inputs, binds by line, checks grants, and resolves the
  destination and cap before a run starts.
- `close.mjs`: deterministic $0 close per step that decides green/red; first
  red ends the run. Close classes cover the mechanical and model-derived
  steps.
- Batch harness (`poc/m0/batch.mjs`) for repeated stability runs (Amendment
  C, 20 runs per plant per provider), every accept a real human accept.
- Every primitive run writes `<runDir>/log.json` with each model stage's
  args and reply, so a compose red keeps the reply it refused (F28).
- A 240s total deadline on every live model round, so a zombie stream reds
  in 4 minutes, not 15 (F27).
- A malformed tool-call arguments string is now metered and retried once,
  never read as an unknown-cost transport red (F28).
- `litectx` and `bareguard` installed as real dependencies; catalogue
  entries resolve against the real package exports, not bareloop's tool
  wrappers (F23), and every entry carries a `desc` shown on the
  drafter/scout menus.
- PRD guiding principles, borrowed from bareloop's `CYBERNETICS.md` as
  reminders (not features), signed by hamr 2026-09-15.

### Changed
- Catalogue's `remember`/`forget` moved to a new "memory" skill (M0b
  orchestrator ruling).
- `send()` takes its allow-list from the caller instead of a hard-coded
  copy.

### Fixed
- Sheet stage grant now requires `addressCells` only, matching the
  drafter's menu — the two had disagreed and refused fresh drafts at
  preflight (F26).
- An identifier must carry its own citation: compose could pass a made-up
  invoice number through the close undetected (F25 / M0b negative
  scenario).
- `checkpointAsk` prints an ASK OPEN notice instead of silence; a stale
  `answer.json`/`ask.json` is now caught as a pre-accept hazard.
- A failed attempt's spend row always carries `costUsd: null`.

### Removed
- Real mail egress (`mailproof`) dropped as a wrong-fit primitive for this
  catalogue.

## [0.1.0] - 2026-09-13

### Added
- Scout: a bounded, read-only-by-construction step that gathers grounded facts for the drafter (`poc/m0/scout.mjs`).
- Primitive catalogue and artifact space as data, with one writer for cell addresses (`poc/m0/catalogue.mjs`, `poc/m0/artifacts.mjs`).
- Draft table: the two numbered lists (job lines, guardrails) joined and shown from both ends, plus a redraft round (`poc/m0/drafttable.mjs`, `poc/m0/redraft.mjs`).
- Deterministic walkable-chain validator (`poc/m0/validator.mjs`).
- Detection of a silently substituted model: a live ledger row's `modelMatch` is checked against what was actually served, not just what was requested (F14, F22).
- A test that fails if any provider slot's default model has no price, so a model rename can no longer silently price a run at $0.

### Changed
- Baseline model switched from `deepseek-v4-flash` to `deepseek-flash` (DeepSeek-V4.1-Flash): DeepSeek retired the old model, and requests naming it were silently served by V4.1-Flash (F22).
- The drafter now names primitives instead of step kinds, sends each job line once per round (previously twice), and enforces strict 1-for-1 job-line-to-guardrail mapping — it can no longer point at another line's guardrail.
- Docs reorganised under `docs/{product,wiki,logs,archive}`.

### Fixed
- Redraft now sums every round's token usage instead of only the last, so cost was previously understated.
- Scout's "reported" count is now computed from grounded columns instead of raw ones.
- A scout round truncated at the output cap now reads as `TRUNCATED`, not a no-call.
- A refusal's line is now keyed on a typed `line` field instead of parsed prose, in both the validator and the redraft's refused schema.
- A redraft now carries a prior refusal forward unless a step reclaims it.
- `resolveModelRate` checks own properties (`Object.hasOwn`), so a model id like `constructor` or `toString` can no longer resolve to an inherited value and slip past the no-rate guard.
- The scout CLI takes its default model from the provider slot instead of a hard-coded retired name.

### Removed
- Superseded POC scripts `poc/m0/bakeoff.mjs` and `poc/probe-synthetic.mjs`.
