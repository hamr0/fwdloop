# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
