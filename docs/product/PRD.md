---
type: reference
title: "fwdloop — what it is, and what must hold"
status: draft
sources: [docs/archive/PRD.md]
---

# fwdloop — what it is, and what must hold

The product's identity, the two claims it lives or dies by, what it deliberately does not do,
the stack, and the model it runs on. The mechanics of a close are a separate page
(`how-a-step-closes.md`); the module order is `the-module-ladder.md`.

## The line: fwdloop is the job with a human in it

bareloop closes jobs that need **no human mid-run** — a machine check (`green`) or a rubric
judge (`softgreen`), over a repo or a plain folder, one-shot, healing itself by retry
(docs/archive/PRD.md:20-24). Human-in-the-loop never fit those rails: a HITL turn has different
hardness requirements, and bolting it in would entangle two sets of rails until every small
change became a release nightmare (docs/archive/PRD.md:20-24).

The line was ruled from both sides — bareloop PRD item 33, signed 2026-09-10
(docs/archive/PRD.md:26-34). **fwdloop = jobs with humans in them:** daily-grind automation of
part of a person's work, hitl windows, chat and multi-turn, daily/monthly budgets, prose plus
guardrails. It escalates to a person more than it retries, and may still carry deterministic or
rubric steps. A non-code job a machine or a judge can close with no human is bareloop's, not ours
(docs/archive/PRD.md:26-34).

The older framing — "fwdloop is the job bareloop refuses" — is **superseded and kept only so it
is not re-derived**: bareloop now takes plain folders via a hidden git scratch copy, so the
dividing line was never "no repo", it is the human (docs/archive/PRD.md:39-43).

## The goal

fwdloop replaces **a human's job** with code — not a repo, a job. The human describes the job in
their own words plus guardrails; the machine works out the steps, picks the primitives, wires
them, runs them, and stops where the human said to stop. **The human never thinks about which
primitive goes where.** That is the product (docs/archive/PRD.md:45-49).

This is FDE-shaped work: read a job, find the automatable portion, build a flow that runs most of
it with handover windows for a human to review, continue or push back
(docs/archive/PRD.md:51-53).

## Relationship to the bare suite — a hard rule

fwdloop is a **customer** of bareagent, bareguard, litectx, beeperbox, barebrowse and baremobile.
Never patch a primitive, never invent one. A missing or buggy primitive is an **upstream ask** in
`docs/product/UPSTREAM-ASKS.md`, and we wait for delivery. Learnings are borrowed from bareloop
and multis by **copying code with a `// borrowed-from:` header** — never by importing
(docs/archive/PRD.md:55-61).

## The two paired claims

Both must hold; either one false and there is no product (docs/archive/PRD.md:62-66).

- **Claim 1 — the close.** A step of a human's job closes **deterministically with no repo**.
  Every step emits a typed artifact; every figure cites its source; the close is mechanical —
  shape valid, every citation resolves, cited value equals stated value, derived figures
  recompute. Unsure = red (docs/archive/PRD.md:68-72).
- **Claim 2 — the description turn.** The human describes the job in their own words and **never
  names a primitive**. The drafter selects from the baresuite catalogue, and a deterministic
  validator proves the chain is **walkable** — step N's output shape fits step N+1's input
  (docs/archive/PRD.md:73-77).

If Claim 1 is false we are back in an unfenceable chat. If Claim 2 is false, fwdloop is a wiring
tool for engineers, and the person who benefits is the one who least needs it
(docs/archive/PRD.md:100-103).

**Neither claim is closed by prior evidence.** F5 proved a citation close catches planted errors,
but on hand-wired bespoke code, so Claim 1 holds only for code we wrote by hand. F10 proved a
drafter turns prose into a valid declaration and refuses an ungroundable step 6/6, but it emitted
**step kinds, never primitives**, and nothing checked that a chain composes — Claim 2 is untested
(docs/archive/PRD.md:105-110).

### The three close classes, in one line each

Every step declares how it closes, and the class is an **arbiter field** — human-declared,
validated, never inferred by the drafter (docs/archive/PRD.md:79-86).

| class | what closes it | cost |
|---|---|---|
| green | deterministic recompute — the citation close | $0 |
| softgreen | a human-declared **shape**, checked mechanically; no model judges anything | $0 |
| hitl | a person, at an `ask` whose position the human signed | $0 to pause |

On top of its class, **every step carries a mechanical *happened* check** — the artifact exists
and is non-empty, a sent message has a delivery id, a file landed with non-zero bytes. Never "it
ran" (docs/archive/PRD.md:88-95). Anything that fits no class falls to **hitl**, or a human writes
a shape for it; the machine never invents a check (docs/archive/PRD.md:96-99).

## The anchor job

Every POC runs against AR-aging job #1: `fixtures/ar-aging.csv` plus `fixtures/message.txt`. A
chat message asks what a customer owes; read the sheet, match the customer, list open invoices,
total owed, earliest due, count overdue as of a fixed `businessDate`, draft a reply, human
accepts, send. The fixture is real, from field research (docs/archive/PRD.md:112-116).

## Out of scope for v1

No swarm, no multi-agent orchestration, no RAG or vector store, no LLM summarisation as the
default compressor, no self-adjusted budgets ever, no cloud or multi-user, no learning between
flows, no fully automated flow without a human stop, and **no patching or inventing a baresuite
primitive** (docs/archive/PRD.md:404-409).

**No LLM judge.** Our `softgreen` is a declared shape checked mechanically; a second model never
decides a close (docs/archive/PRD.md:411-413). Name collision worth keeping straight: bareloop's
`softgreen` is a **judged** close with a calibration gate — same word, different mechanism
(docs/archive/PRD.md:415-417). Their calibration gate was offered and declined for now: it has
never run in 167 archived runs, and we have no judge to calibrate, so borrowing it would be
unproven machinery ahead of need (docs/archive/PRD.md:419-425).

**No CLI as a product surface.** `npm install`, one command, a localhost server starts and **the
browser is the product**; the server owns the scheduler. A CLI exists for M0–M4 but is
undocumented and carries no stability promise (docs/archive/PRD.md:427-431).

## Guiding principles — borrowed from bareloop, reminders not features

DRAFT 2026-09-15, unsigned. Lifted from bareloop `docs/logs/CYBERNETICS.md@4bd52fe` (Ashby, Beer,
Wiener, and gate-level digital design), kept only where fwdloop has already been bitten or
already leans on it. None of these is a module or a feature. Each is a question to ask of any
new piece before it is built. The date is the day it cost us.

1. **Only a clean yes/no crosses a step boundary.** A model's artifact is analog — plausible,
   degraded in ways nobody can see. The close collapses it to one bit before the next step
   reads it. No score, confidence, or "mostly passing" ever travels between steps or feeds a
   decision. (2026-09-10 F7: a model minted greens by omitting fields; the fix was a harder bit,
   not a softer one.)
2. **Right and cheap are two numbers, never one.** Green gates; cost ranks. No function in the
   tree may combine verdict and cost into one scalar. A "fitness score" is the smell; reject it
   on sight. (2026-09-15 F28 reports pass/20 and $/run in separate columns for this reason.)
3. **Every check names its third outcomes.** Besides green and red there is always a forbidden
   zone — a crash, an unparseable reply, an unpriced round, a killed close. Each gets its own
   name and its own path; rounding one to green or red is itself the fault. (2026-09-14 F27
   `cost unknown`; 2026-09-15 F28 `malformed tool call` — both were third outcomes, and the
   one we rounded to "provider-red" cost a day of restarts.)
4. **The human's alarm goes by a wire nothing summarises.** An ask reaches the human word for
   word, on a path no log, fold, or emergent component rewrites or filters. What the shell
   emitted is what the human reads. (2026-09-13 F25: `ASK OPEN` printed once and was lost in
   scroll; both asks expired; the fix was a blocking prompt, not a better log line.)
5. **Test the checker before trusting what it says.** Every close ships with a fixture that
   must fail and a fixture that must pass, run token-free before any batch is believed. "The
   test must be able to fail" is this rule; "revert the fix alone, see red, restore" is its
   manual form. (2026-09-15: a deadline test accepted `0`, which means *off* — caught only by
   reverting by hand.)
6. **The doer never writes its own judge.** The agent authors steps; a human signs the
   trigger, the cap, the ask, the allow-list, and what "done" means. A confident fake green is
   an accountability sink; this is the wall against it. (Standing since 2026-09-08; the hard
   lines in CLAUDE.md are this rule spelled out.)
7. **Every summary says what it threw away.** A fold, a ledger row, a red string, an ask text:
   per field, what is destroyed, what survives, and why nothing downstream needs the dropped
   part. A summariser without that manifest is a review blocker. (2026-09-15 F28: a red run
   kept only its red string; five misses could not be told from a close bug until `log.json`
   kept the reply.)
8. **Green steps do not add up to a green job.** Each step is its own small viable system with
   its own close; the job still needs its own last check — for fwdloop, the human accept in the
   same run — or the steps are individually green and jointly wrong. (Plant d exists to prove
   this; 2026-09-15: 240 clean runs, nothing incomplete reached a send.)
9. **A repeat at the same byte is a shape, not weather.** When a provider red recurs with the
   same position, size, or timing, capture the body before blaming the wire. (2026-09-15 F28:
   three "provider" reds at position 476/476/432 were our own parser dropping the model's usage.)

Deliberately not borrowed (no home in fwdloop v1): the across-run learning items — contrast
bits per knob, one-knob mutation, toggle coverage, order-from-noise pre-flight. fwdloop does
not yet learn across runs; if it ever does, those come in as their own signed module.

## Stack — vanilla JS

**Vanilla JavaScript, ESM, node stdlib.** No TypeScript, no framework, no build step; types go in
JSDoc (docs/archive/PRD.md:434-436). AGENT_RULES' dependency hierarchy binds as written: vanilla →
stdlib → external, and external only when stdlib cannot do it in under 100 lines, with the
standing exception for security-critical code. The bare suite is a **dependency, not an
external** — it is the thing under validation (docs/archive/PRD.md:438-441). The one real test is
M5's UI: vanilla holds there too, and a framework needs a reason, not a preference
(docs/archive/PRD.md:443-447).

## Baseline model — settled, not reopened

**`deepseek-flash` (DeepSeek direct, DeepSeek-V4.1-Flash) is the baseline for every experiment**;
`hf:Qwen/Qwen3.8-27B` on synthetic.new is the second provider — a different company behind a
different gateway, so losing one does not lose both (docs/archive/PRD.md:450-455).

It was flipped on measured reasons (F12): fwdloop's workload is **warm**, every step re-sending
the same standing instructions, and F9 measured 99.8% of a 4,361-token prefix coming back cached
at roughly a tenth the price, where synthetic exposes no caching at all. Second reason: no ~250s
request cliff (docs/archive/PRD.md:457-466). Stated against the flip, honestly: DeepSeek had the
slightly worse step-count spread and slower median wall, neither a correctness signal
(docs/archive/PRD.md:468-472).

**Claude and OpenAI are a differential probe only** — one round, to split "our mechanical code or
the model" when stuck. Never a baseline, never a default, always named in the finding
(docs/archive/PRD.md:474-476). **No model hopping:** a change of baseline needs a measured reason
filed in FINDINGS, and `poc/m0/provider.mjs` is the one writer for provider, rates and key, so
swapping is a slot, not a rewrite (docs/archive/PRD.md:478-480).
