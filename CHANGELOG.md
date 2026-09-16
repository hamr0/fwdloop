# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
