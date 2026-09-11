---
type: reference
title: "How a step closes — the load-bearing assumptions for v1"
status: draft
sources: [docs/archive/PRD.md]
---

# How a step closes

The assumptions v1 rests on, each of which must be proven. Ruled 2026-09-09
(docs/archive/PRD.md:117-117). Identity and scope live in `PRD.md`; the module order in
`the-module-ladder.md`.

## The eight load-bearing items

1. **Step validation and citation.** Every step's output exists (the mechanical *happened*
   check), then closes under its declared class: green recomputes, softgreen matches a
   human-declared shape, hitl goes to a person. Every figure points at where it came from
   (docs/archive/PRD.md:119-121).
2. **Citations land in the audit**, so anyone can trace a wrong number back to source.
   Diagnosis is a product feature, not a log (docs/archive/PRD.md:122-124).
3. **Skills gate the tool menu.** A signed checkbox unlocks a tool subset; the drafter only sees
   what is enabled. Menu-is-inventory — a checkbox with no skill directory is a validation red
   (docs/archive/PRD.md:125-128).
4. **Persona** shapes how `compose` output reads. Voice, never correctness
   (docs/archive/PRD.md:129-129).
5. **Scout looks, drafter writes, neither acts** — see below.
6. **Flow-to-flow handover** — A's `send` writes an artifact, B's trigger fires on it. Separate
   flows, caps and signatures, one history row each side naming the other's run id. No bus, no
   orchestrator: the handover is a file (docs/archive/PRD.md:180-185).
7. **Nothing fails silently** — see the healing rules below.
8. **Token cost is a go/no-go the buyer applies before we build** — see the money knobs below.

## Scout looks, drafter writes, neither acts

Borrowed verbatim from bareloop's `src/authorscout.js:4` (docs/archive/PRD.md:130-132).

- **The scout LOOKS.** A bounded read-only pass over the real inputs before any drafting, so the
  drafter proposes steps against what is there instead of inventing a column name. Write-class and
  store-class primitives are filtered **out of its menu, so it is read-only by construction and
  not by promise**; round-bounded, output-capped. Its grant is fixed in code and is **not
  spec-authorable**, because at job-creation time no signed ceiling exists yet to derive one from
  (docs/archive/PRD.md:133-141).
- **The drafter WRITES.** It never gets a tool. It takes prose plus guardrails plus the scout's
  facts, and names per step which primitive to use and how that step closes
  (docs/archive/PRD.md:142-144).
- **Neither acts.** Signing does not replay a recording; it runs the plan for the first time
  (docs/archive/PRD.md:145-145).

**The drafter is multi-turn, and that is where the turns live.** The pipeline is *scout → draft →
negotiate → sign → run*: the drafter replies with a clean table, the human replies with changes in
prose, it redrafts, and that repeats until the shape is agreed. At run time every step is one shot
with fresh context and no negotiation (docs/archive/PRD.md:147-152).

**Why this chat is safe where bareloop's was not:** this chat produces **a spec, not work**.
Nothing it says takes effect until a human signs the hash, so the negotiation is pre-signature and
needs no close at all (docs/archive/PRD.md:154-158).

**A human stop is mandatory in v1** — every flow has at least one human accept before any egress
(docs/archive/PRD.md:160-162).

## Healing: transport only, plus the ralph loop

Every failure surfaces with enough detail to fix it — which step, which artifact, which citation
did not resolve, the exact red string, and the $ and wall spent to that point. A run that stops is
`escalated` with its gap text, never a silent no-op (docs/archive/PRD.md:187-191).

**Transport:** one immediate retry on a provider 5xx or timeout, then the run parks as
`provider-red` and the trigger retries at +5, +15, +45 minutes — three tries, fixed, tighten-only
— then escalates. A parked run is already funded; retries do not re-fund
(docs/archive/PRD.md:193-196).

**Close-reds use the ralph loop, borrowed whole:** `while close-red and under-cap: run the step
again`, stopping at first green. Transport-only healing was ruled first and then reversed on
evidence — bareloop has retried close-reds for 680 commits (docs/archive/PRD.md:198-202).

**What makes the retry safe is one line, and fwdloop must copy it exactly: the step never sees its
own close, and never sees the cap.** Only the **gap text** comes back. A worker that cannot read
the check cannot tune to it — that is the fit-to-pass fence. Two other bounds ride with it: the
loop stops at first green, and **strikes** govern, so a repeated identical gap strikes out and a
step that will never go green cannot burn the cap (docs/archive/PRD.md:204-211).

**The subtlety fwdloop has and bareloop does not:** bareloop's close is a command exit, but ours
can be a softgreen declared shape, which reads like an instruction. So the step sees its **goal**
("write a reply, one line per invoice"), never its **close** (the field list). Goal in, gap back,
close never — and if a shape cannot be split from its goal that way, that step is **hitl**, not
softgreen (docs/archive/PRD.md:213-219).

**Still never:** rewriting a step, re-picking a primitive, or re-drafting the flow. Those are edits
to a signed artifact and need a human and a new hash (docs/archive/PRD.md:221-225).

## Money: two knobs, both signed, both tighten-only

Every flow states its cost up front and every audit row carries $ per run and per step; a budget
knob the human signs is a first-class product feature (docs/archive/PRD.md:227-233).

- `cap.usd` — per RUN, binding between rounds, may overshoot by at most one round
  (docs/archive/PRD.md:235-236).
- `cap.monthlyUsd` — per calendar month. **The trigger fires only if the whole run is funded**;
  otherwise it records `monthly-exhausted` and does not start (docs/archive/PRD.md:237-239).
- No daily number, no grace, no borrowing. Any row with `spendComplete: false` makes the month's
  sum a **floor**, and a floor at or over the wall halts — unknown is never rendered as 0, and a
  pause spends nothing (docs/archive/PRD.md:240-243).
- A monthly/30 daily allowance with a 10% grace was raised twice and **not adopted**: three
  numbers plus an exception, and the exception widens where everything else tightens
  (docs/archive/PRD.md:246-249).

## There is no wiring layer

Borrowed doctrine: **bareloop is not deterministic in how work gets done — it is deterministic in
how work gets judged** (docs/archive/PRD.md:251-254).

- **Inside a step** the LLM calls primitives and intermediates live in its own transcript. It *is*
  the wiring there, and nothing checks its shape (docs/archive/PRD.md:255-257).
- **Between steps** the step emits **one typed artifact carrying its citations**, and the next step
  reads it by id, with fresh context per step (docs/archive/PRD.md:258-260).

Shape variance is absorbed by the typed artifact and the close, never by a wiring graph. Wiring is
not a primitive, is not authored, and is not a module (docs/archive/PRD.md:262-264).

Two bareloop mechanisms explain why the problem never arose there: the close is **a declaration
over kinds whose implementations we own** — illegal is *inexpressible*, not rejected late — and the
worker gets a **granted verb list** mapped onto existing implementations, menu-is-inventory
(docs/archive/PRD.md:266-276). **A primitive is a tool call inside a turn, never a turn**
(docs/archive/PRD.md:278-279). The reason wiring surfaced here: bareloop's steps share a repo, so
the **filesystem is the wiring**; fwdloop has no repo, so steps get a shared **artifact space** and
plumbing is *addressed, not authored* (docs/archive/PRD.md:281-288).

## What the human writes

**Prose** — the job description, in normal human order. Not a step list, not a spec, no primitives,
no jargon (docs/archive/PRD.md:290-294).

**Guardrails** — the rules the job runs under, in the human's own words. Five kinds map to
machinery: a "point at the cell" rule becomes a **green** close; "one line per invoice" a
**softgreen** shape; "ask me first" a **hitl** `ask`; "don't disclose PII" redaction at the tool
boundary; a skill checkbox gates the menu; and "cap $0.25 per run" is an **arbiter field**,
restated by the human and never by the drafter (docs/archive/PRD.md:296-307). A guardrail the
drafter cannot map is **surfaced in the draft table**, never silently dropped
(docs/archive/PRD.md:309-309).

### One line, one guardrail — strict 1-for-1

The job description is a numbered list; beside each line the human writes ONE guardrail or leaves
it blank. **Guardrail *n* belongs to line *n* and to nothing else.** The drafter may still cut one
line into several steps, but every step declares `fromLine: n` and its class is **derived from
guardrail *n*, never chosen**. A blank guardrail makes every step serving that line `hitl`
(docs/archive/PRD.md:311-317).

**Why the choice had to go, measured (F16):** a live drafter stretched job #1's broad citation
guardrail 3 runs out of 3 to justify `green` on a step that emitted a yes/no and no figures at all.
It could do that because it was allowed to POINT at any guardrail; removing the pointing removes
the stretch (docs/archive/PRD.md:322-327).

**A "generic rule" (`#` = applies to every step) was built and then REJECTED**, in hamr's words: *a
rule stops being generic once it doesn't apply to all*. The cost is accepted — the human repeats a
guardrail on each line where it applies. Explicit and repeated beats clever and mostly-true
(docs/archive/PRD.md:329-335).

### Silence is hitl; invention is a red

**A missing close IS `hitl`, not a red** — silence about how a step is proven done means a person
proves it, which makes silence safe and guessing unsafe. An **invented** class stays a red:
`"yellow"` is not silence, it is a wrong answer (docs/archive/PRD.md:340-345).

**A shape stated only in the prose is NOT a softgreen.** Job #1's prose says "one line per
invoice", and that is a shape — but it is not a guardrail, so the step falls to `hitl` and the
human's fix is to restate it as a guardrail (docs/archive/PRD.md:347-351). Letting the drafter read
a shape out of prose was declined: it puts the machine in the position of deciding a sentence was a
shape, which is the one thing softgreen exists to prevent. Prose says WHAT the job is; guardrails
say HOW each step is proven done (docs/archive/PRD.md:353-360).

## The signed artifact

One flow, one hash, signed whole; any edit flips the hash and demands re-accept
(docs/archive/PRD.md:362-364). Arbiter fields — trigger, caps, ask TTL, egress allow-list, skills,
persona, provider and model — sit **inside** the hash, alongside the human's verbatim guardrails
and the drafted steps (docs/archive/PRD.md:366-386).

**How a class is set:** the drafter maps each guardrail to a class and attaches one to every step
it cuts; the human sees the whole thing as a **diff at sign time** and may change any class before
signing. Nothing is final until signed (docs/archive/PRD.md:388-392).

**The draft table is the negotiation surface** — one row per step, read in one pass, with changes
replied in prose. Fire only on agreement, and agreement is the signature
(docs/archive/PRD.md:394-398).

**Both lists are numbered and the link is shown from both ends**, which makes both holes impossible
to miss: a guardrail with no step is a rule nothing uses, and a step with no guardrail shows `hitl`
— the human sees the cost of hand-checking before signing rather than after. Neither is an error;
they are decisions the human is being shown (docs/archive/PRD.md:400-401).
