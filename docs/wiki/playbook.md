# Production AI Playbook → fwdloop guideline

**Status: guideline, 2026-09-08. Source: "The Production AI Playbook: Deploying Agents at
Enterprise Scale", Sandipan Bhaumik (Databricks), as summarised by hamr. hamr: "this is a fde
talk that we need to understand and bake into what we are doing." Each item below says what
the talk asks for, what fwdloop already has, and what is MISSING from PRD v0.4 — the missing
items are numbered P1–P10 and carried into PRD §11. Where fwdloop deliberately does the
opposite of the talk, it says so and why.**

## 0. The one-line reading

The talk's failure pattern — "which model?" first, demo signed off, dies in production weeks
later — is the same failure AGENT_RULES exists to prevent: picking machinery before defining
"good". Its cure is the same as ours: define success with numbers, build the evaluation and
the data path first, choose the model last by running candidates against the suite. fwdloop's
module order already does this (M0 = the close and the plants; the provider is a factory
argument). What the talk adds is **operational** structure around a running system: a living
test library, decision tracing, an incident loop, and change management for prompts and
models. Those are the gaps.

## 1. The three gaps, mapped

| gap (talk) | fwdloop today (v0.4) | missing |
|---|---|---|
| **Observability** — trace every sub-decision and tool call | `audit.jsonl` per step (inputs by id+hash, output, effect check, close, $, ms, provider, model); `spine.jsonl` per round | per-step **tool-call and read counts** in the audit row, so duplicate work is visible (→ P3) |
| **Evaluation** — continuous, metric-driven, beyond "accuracy" | one pre-registered plant in M0; unsure = red | a **living case library per flow** with owners and tags; **quantitative targets** before M0 (→ P1, P2) |
| **Governance** — who owns it at 3 AM; drift; incident handling | caps, arbiter fields, provider-red ladder, egress rule | an **incident loop** (detect → diagnose → contain → fix & extend), **rollback** to the previous accepted version, **prompt/model change management** (→ P4, P5, P6) |

## 2. The five pillars, one by one

### Pillar 1 — Evaluation (three layers)

The talk's layers: deterministic (format, regex, classic ML) → semantic (LLM-as-judge for
groundedness/safety/relevance) → behavioural (tool-call audit: retries, duplicate queries).

fwdloop's three tiers (hamr, 2026-09-08: "agree in 3 shapes") line up, with one deliberate
swap:

| talk | fwdloop | note |
|---|---|---|
| deterministic | **shape check** (effect check: output exists, fields present) — every step, $0 | same thing |
| semantic (LLM judge) | **citation close** — deterministic; every figure cites a source, derived figures carry a formula, machine recomputes — $0 | **opposite mechanism, same goal.** Groundedness is checked by resolving pointers, not by asking a second model. A judge on `compose` exists as a signed OFF flag with a calibration refusal (PRD §5). Reason: a judge is wrong in the same ways as the worker (bareloop close-verdicts §5: judge extracts, rule decides, unsure = red) |
| behavioural | **strikes + caps** today; **tool-call audit per step** missing | → P3 |
| human | **ask** at a human-placed position | the talk puts the human at a confidence threshold; fwdloop puts the human where the human said (see Pillar 4) |

**Golden/test data set (talk §08:22, §33:26): a living dataset, owned, tagged.** fwdloop has
one plant. → **P1: a case library per flow** (`cases/<id>/` in the flow directory: inputs,
expected close verdict, tag, origin — "planted", "escalated run <id>", "hamr rerun answer").
Every red that a human resolves becomes a case; the flow is re-run against its cases on every
edit (maintenance mode) and on every model/provider change. Cases are $0 where the close is
deterministic and only the drafted step outputs are replayed; paid only when a model round is
needed, and then under the cap.

**Quantitative targets up front (talk §07:34).** → **P2:** before M0 fires, write the numbers:
plants caught (N of N), false reds on clean runs (0 of N), $ per run against the human cost of
the same task (PRD gaps review 2.10), wall per run. A pass/fail with no number cannot be
tracked over time.

### Pillar 2 — Observability (decision tracing)

Talk: trace intent → lookup → retrieval → reasoning → guardrail for every query; regulators
ask for it; online monitoring drives fallbacks and retry limits (max 3 → human).

fwdloop: `audit.jsonl` is the product feature (PRD §3.13); `spine.jsonl` carries rounds; the
provider-red ladder is exactly "retry limit then human" (PRD §10). Two additions:

- → **P3: behavioural columns in the audit row** — `toolCalls`, `reads` (by artifact id),
  `rounds`, `retries`, and a `duplicateReads` count (same artifact id read twice in one step).
  A signed per-step ceiling on `toolCalls` is a guardrail; exceeding it is a strike, not a
  silent cost. This is the talk's "3 duplicate DB queries for one answer" made visible.
- **Compliance reading:** the audit must answer "why did it send that?" for a dispute months
  later. The row already names inputs by hash; add the **accepting human's exact words and
  the ask id** to the `send` row (they exist on the ask row; duplicate them onto the send so a
  single row is self-contained).

### Pillar 3 — Data foundation

Talk: "data was built for forgiving humans; agents don't forgive bad data — they hallucinate
confidently." Split **question data** (what the agent reads) from **tracking data** (traces,
logs). Metadata and catalogues.

fwdloop maps cleanly: question data = the flow's inputs (path/url/api/doc) + memory facts;
tracking data = `audit.jsonl`, `spine.jsonl`, `history.jsonl`. The lesson we lack:

- → **P4: input validation at `gather` is a red, not a hallucination downstream.** Shape
  (expected columns/headers, signed), **freshness** (a daily sheet older than its expected
  window → `stale-input` red), and hash (already there). PRD gaps review 2.4 named shape
  drift; the talk adds staleness — its own case study incident was exactly stale policy
  embeddings served confidently.
- No catalogue, no vector store, no RAG in v1: inputs are files the human named. A "unified
  catalogue" for fwdloop is the flow directory's `artifacts/` index by id + hash. Keep it that
  small.

### Pillar 4 — Multi-agent orchestration and HITL

Talk: orchestrator-worker, choreography over a message bus, human handoff when confidence
drops below a threshold.

fwdloop takes the opposite position on all three, deliberately:

- **One process per run, no swarm** (PRD §4). A flow is a fold over steps. The talk itself
  says multi-agent complexity grows exponentially; job #1 does not need it.
- **Flow-to-flow handoff is a file drop** (PRD §3.12), not a bus. Same effect, one file, two
  history rows.
- **The human sits where the human placed the ask, not where a confidence number falls.**
  Confidence is unmeasured, uncalibrated, and gameable; a position is signed and immovable.
  fwdloop's deterministic analogue of "low confidence → human" is **close-red → escalate with
  the gap text** (PRD §3.6). Nothing routes on a model's self-report.

### Pillar 5 — Governance and change management

Talk: audit trails; **prompts as code** (versioned in git, commit says why); **model change
management** (test candidates against your own eval set, never trust leaderboards); PII
pre-validation.

- → **P5: prompt versioning.** fwdloop's own prompts (drafter, step executors, the close's
  extractor if any) are files in `src/prompts/`, hashed; the hash lands in every audit row
  (`promptVersion`). A prompt change is a commit whose message states the failure it fixes,
  and it re-runs the case libraries of every flow in the repo's fixtures before merge.
- → **P6: model change = maintenance mode.** `provider` + `model` are part of the signed flow
  (pinned, recorded per row already). Changing either is an edit: new version, dry-run against
  the flow's cases, re-accept. A cheaper model is adopted the same way, never by a config flip.
  M0 should already run its plants against two providers (the factory is there) so the first
  model pick is made the talk's way — by the suite, in the last step.
- → **P7: data residency as a signed guardrail.** The talk pre-validates PII before it reaches
  the model. For an accountant flow the customer data *is* the input, so the question is
  **which model may see it**: a guardrail checkbox `local-only` restricts the provider
  factory to Ollama for that flow; cloud providers are refused at draft. Cheaper than
  PII-scrubbing and honest about what it does. Scrubbing at capture stays for secrets (PRD §5).

## 3. The incident playbook, adopted

Talk: **Detect** (eval dashboard) → **Diagnose** (tracing) → **Contain** (prompt version /
fallback) → **Fix & extend** (add the case to the suite). Lesson: CSAT dropped after a policy
update; tracing found stale embeddings; fixed same day.

→ **P8: fwdloop's incident loop**, with each stage pinned to something that exists or is
numbered above:

| stage | fwdloop |
|---|---|
| Detect | `history.jsonl` outcome ≠ `complete` (close-red, escalated, cap-halt, input-drift, stale-input); `fwdloop inbox` shows it; the monthly pace line |
| Diagnose | `fwdloop audit <run>` — the row that went red, its inputs by hash, the gap text, `promptVersion`, model |
| Contain | **rollback**: `fwdloop accept --version <previous hash>` re-activates the last accepted version (→ P9, missing today); park the run (exists for provider-red; generalise to any red the human wants to hold) |
| Fix & extend | the red's inputs + the human's answer become a case in `cases/` (P1); the next version must pass it before re-accept |

→ **P9: rollback to the previous accepted version** is not in v0.4. Versions and hashes are
(M4); "re-activate an older one" is one command and belongs in M4's exit.

## 4. The 8-week order, as a rule for module order

Talk's case: weeks 1–2 evals (200 real transcripts, 85% target), 3–6 data + tracing, 7–8 model
selection by running candidates. fwdloop's ladder already runs in this order; make it a
rule so it survives pressure:

→ **P10: the model is chosen last, by the suite.** No module may select or tune a provider
before its cases exist. M0's cost line is measured on ≥2 providers against the same plants;
the PRD records which passed and at what $, and that record is the reason for the pick.

Also from the talk's execution lessons: run the **cheap subset in CI on every PR** ($0 cases:
close-only replays) and the **full paid suite only on merge to main or on hamr's word** — the
same split AGENT_RULES makes between fast gate and full suite.

## 5. What we take, what we leave

**Take:** three-layer evaluation (as three tiers), decision tracing with behavioural counts,
the living case library with ownership, prompts-as-code, model change through the suite,
input freshness as a red, the four-stage incident loop, model chosen last.

**Leave, with reasons stated:** LLM-as-judge as the semantic layer (deterministic citation
close instead; judge optional and calibrated), confidence-threshold HITL (positional asks
instead), multi-agent patterns and a message bus (one process, file-drop handoff), catalogues
and vector stores (files by hash, no RAG in v1).
