# fwdloop — PRD v1.0 (DRAFT, 2026-09-09, NOT signed)

**"Automate this job — it has humans in it."**

Rebuilt from scratch on 2026-09-09 after v0.5 drifted. v0.5 is parked at
`docs/archive/2026-09-08-PRD-v0.5-PARKED.md` — read it for evidence (F1–F11 still stand), never
for scope. This document is the only scope.

Binds: `.claude/remember/AGENT_RULES.md` and `.claude/remember/LIBRARY_CONVENTIONS.md` (both tracked
in this repo; the `hamr0/` copies are byte-identical). **AGENT_RULES wins where the two disagree**
— LIBRARY_CONVENTIONS says so itself. It adds only what is specific to shipping a JS library to
npm, and it binds from M5 onward; `poc/` is exempt while it is a POC.
Context-engineering reference: `~/PycharmProjects/litectx/docs/product/build-studies.md`.
Findings live in `docs/logs/FINDINGS.md` — never in this file.

---

## §1 Problem & goal

**The problem.** bareloop closes work because the work lands in a **repo**: files change, tests
run, and its two rails — `green` (deterministic) and `softgreen` (rubric) — have something real
to check. Human-in-the-loop never fit those rails. A HITL turn has different hardness
requirements from either rail, and bolting it into bareloop would entangle two sets of rails so
badly that every small change becomes a release nightmare (hamr, 2026-09-09). So HITL was never
built there.

**bareloop says this in its own source, and it is the sharpest statement of the problem we have.**
`src/authorjob.js` carries a declared radio — `green | soft-green | hitl` — and *"v1 STILL ADMITS
ONLY `green`. A soft-green or hitl pick returns the honest counted refusal"* (`:38`). What it
prints when it refuses (`:293`):

> *"This job has no code repository, so there is no seed to measure against and no changed set to
> read — nothing deterministic can decide whether it came back done. That needs a judged
> (soft-green) or a human close; this authoring flow drafts code-genre closes against a git seed
> only."*

**fwdloop is the job bareloop refuses.** Not a metaphor — that is the error message.

*Citation pinned to `bareloop@05ea1ab`, read 2026-09-09.* **That text is being rewritten upstream
and this quote will rot** (bareloop session, 2026-09-09): bareloop is unlocking `softgreen` as a
judged close, and **`hitl` is being retired there and moved here** — it is fwdloop's class now,
which is the same boundary this PRD draws from the other side. What does not change is the reason
the refusal existed: no repo, no seed, nothing deterministic to decide it came back done.

**The goal.** fwdloop replaces **a human's job** with code. Not a repo — a job. The human
describes the job in their own words plus guardrails; the machine works out the steps, picks
which primitives to use, wires them, runs them, and stops where the human said to stop. **The
human never thinks about which primitive goes where.** That is the product.

**Why now.** This is FDE-shaped work: read a job, find the automatable portion, build a flow
that runs most of it with handover windows for a human to review, continue, or push back —
sometimes fully automated with a report. Stock agent workflows are too vanilla for it.

**Relationship to the bare suite (hard rule).** fwdloop is a **customer** of bareagent (RLM),
bareguard (harness + evals), litectx (context engineering + memory), beeperbox, barebrowse,
baremobile. Never patch a primitive. Never invent one. A missing or buggy primitive is an
**upstream ask** in `docs/product/UPSTREAM-ASKS.md`, and we **wait for delivery**. The premise
under test: the primitive library covers everything the agent needs. Learnings are borrowed from
bareloop (680+ commits) and multis (facts, memory, persona, remember, stash) by **copying code
with a `// borrowed-from:` header** — never by importing.

---

## §2 Go / no-go — two paired claims

Both must hold. Either one false and there is no product.

> **Claim 1 — the close.** A step of a human's job closes **deterministically with no repo**.
> Every step emits a typed artifact; every figure in it cites its source (sheet cell, mail id,
> doc span); the close is mechanical — shape valid, every citation resolves, cited value equals
> stated value, derived figures recompute. Unsure = red.
>
> **Claim 2 — the description turn.** The human describes the job in their own words and
> **never names a primitive**. The drafter selects primitives from the baresuite catalogue; a
> deterministic validator proves the chain is **walkable** — step N's output shape fits step
> N+1's input shape.

### The three close classes (RULED 2026-09-09 — borrowed from bareloop, extended)

Every step declares how it closes. Borrowed whole from bareloop's radio, including the reason it
is declared and never inferred: *"whose knowledge it is settles it — the user is the one who knows
whether their done is machine-checkable, needs judgment, or needs a person"* (`authorjob.js:28`).
The class is an **arbiter field**: human-declared, validated, never inferred by the drafter.

| class | what closes it | cost | example |
|---|---|---|---|
| **green** | deterministic recompute — the citation close. Every figure cites a source; copied values equal the cell; derived values recompute under the closed formula grammar | $0 | "total owed = 5,700" recomputes from `sum(E2,E3)` |
| **softgreen** | a **declared shape** the human wrote at authoring time — these fields, these types, non-empty, one line per invoice, a date here. The machine checks the shape; **no model judges anything** | $0 | the reply has a customer line, N invoice lines, a total, a due date |
| **hitl** | a person. The `ask` step, its position signed by the human | $0 to pause | "does this read right, should it go out" |

**Every step also carries a mechanical *happened* check, always, on top of its class** — the
artifact exists and is non-empty, a sent message has a delivery id, a file landed with non-zero
bytes. Never "it ran".

**The rule for anything that fits no class (hamr, 2026-09-09):** it falls to **hitl**, *or* a human
must write a shape for it. The machine never invents a check for it. This is the mechanical form
of the F104/F87 lesson — a loose ask breeds a proxy check — and it is why v1 ships **no LLM judge
at all** (§4). A rubric here means a *declared shape*, not a judgement.

**If Claim 1 is false**, we are back in an unfenceable chat and bareloop's rails were the only
ones that ever worked. **If Claim 2 is false**, fwdloop is a wiring tool for engineers, not a
job-automation machine, and the person who benefits is the one who least needs it.

**Prior evidence, and why it does not close either claim.** F5 (v0.5's M0) proved a citation
close catches planted errors — but the runner that proved it was **hand-wired bespoke code**,
not baresuite primitives, so Claim 1 is proven only for code we wrote by hand. F10 proved a
drafter turns prose into a valid step declaration and refuses an ungroundable step 6/6 — but it
emitted **step kinds, never primitives**, and nothing checked that a chain composes. Claim 2 is
untested.

**Anchor job (every POC runs against this, ruled 2026-09-09).** AR-aging job #1:
`fixtures/ar-aging.csv` + `fixtures/message.txt`. A chat message asks what a customer owes; read
the sheet, match the customer, list open invoices, total owed, earliest due, count overdue as of
a fixed `businessDate`, draft a reply, human accepts, send. Real fixture from accounting.events,
derived from field research (`docs/logs/2026-09-08-fde-use-cases.md`).

---

## §3 Load-bearing for v1 (ruled 2026-09-09 — these are assumptions, and each must be proven)

1. **Step validation + citation.** Every step's output exists (mechanical *happened* check), and
   then closes under its declared class — **green** recomputes, **softgreen** matches a
   human-declared shape, **hitl** goes to a person (§2). Every figure points at where it came from.
2. **Citations land in the audit.** The audit row carries the citation trail so anyone can trace
   a wrong number back to its source. Diagnosis is a product feature, not a log.
3. **Skills gate the tool menu.** A flow carries `skills/<name>/SKILL.md`; a signed checkbox
   unlocks a tool subset. The drafter only sees what is enabled. Menu-is-inventory: a checkbox
   with no skill directory is a validation red.
4. **Persona.** A signed persona line shapes how `compose` output reads. Voice, never correctness.
5. **Scout looks, drafter writes, neither acts** (borrowed verbatim from `bareloop
   src/authorscout.js:4`, adopted 2026-09-09). Three separate things, and the separation is the
   point:
   - **The scout LOOKS.** Before any drafting, a bounded read-only pass over the real inputs —
     the CSV's actual columns, the message's actual shape — so the drafter proposes steps against
     what is there instead of inventing a column name. Write-class and store-class primitives are
     filtered **out of its menu, so it is read-only by construction and not by promise**;
     round-bounded; output-capped. Its grant is **fixed in code and is not spec-authorable**,
     because at job-creation time no signed ceiling exists yet to derive one from — the same
     arbiter line, one step earlier than usual.
   - **The drafter WRITES.** It never gets a tool. It takes prose + guardrails + the scout's facts
     and names, per step, which primitive to use and how that step closes.
   - **Neither acts.** Signing does not replay a recording; it runs the plan for the first time.

   **The drafter is multi-turn, and that is where the turns live (RULED 2026-09-09).** The
   pipeline is *scout → draft → negotiate → sign → run*. You send prose + guardrails; the scout
   looks at the real inputs; the drafter replies with a **clean table** — one row per step, its close, its
   primitives. You reply with changes. It redrafts. That repeats until you agree on the shape,
   and only then do you sign and fire. **This is the multi-turn conversation**, and it is the
   whole of it: at run time every step is one shot with fresh context and no negotiation.

   **Why this chat is safe when bareloop's was not.** The thing that could not be fenced in
   bareloop was a chat that *did work*. This chat produces **a spec, not work** — nothing it says
   takes effect until a human signs the hash. The negotiation is pre-signature, so it needs no
   close at all; the signed artifact is what gets fenced. That is the whole trick.

**Human stop is mandatory in v1 (ruled).** Every flow has at least one human accept before any
egress. Fully automated report-only flows are a later module, unlocked only once the close is
trusted.

6. **Flow-to-flow handover (hamr, 2026-09-09).** An automation may hand over to another
   automation: flow A's `send` writes an artifact; flow B's trigger fires on it. Separate flows,
   separate caps, separate signatures, one history row each side naming the other's run id. No
   bus, no orchestrator, no shared process — the handover is a file, the way bareloop's steps
   share a tree.

7. **Nothing fails silently; the machine heals transport only (RULED 2026-09-09).** Every
   failure surfaces to a human with enough detail to fix it: which step, which artifact, which
   citation did not resolve, the exact red string, and the $ and wall spent to that point. A run
   that stops is `escalated` in `history.jsonl` with the gap text, never a silent no-op.

   **Transport.** One immediate retry on a provider 5xx/timeout, then the run parks as
   `provider-red` (resumable, nothing lost) and the trigger retries the parked run at +5, +15,
   +45 minutes — three tries, fixed, tighten-only — then escalates with the error text. A parked
   run is already funded; retries do not re-fund.

   **Close-reds: the ralph loop, borrowed whole (RE-RULED 2026-09-09).** `while close-red and
   under-cap: run the step again`, **stopping at first green** (`bareloop src/ralph.js:499`).
   Transport-only healing was ruled first and then reversed on evidence — bareloop retries
   close-reds and has done for 680 commits, and diverging from that needs a reason we do not have.

   **What makes the retry safe is one line, and fwdloop must copy it exactly: the step never sees
   its own close, and never sees the cap.** bareloop's signature says it outright — *"the emergent
   middle; never sees close/cap"*. Only the **gap text** comes back. A worker that cannot read the
   check cannot tune to it, which is the fit-to-pass fence. Two other bounds ride with it: the
   loop stops at the first green (further tuning past a visible green is itself the fit-to-pass
   surface), and it is governed by **strikes** — a repeated identical gap is no progress and
   strikes out, so a step that will never go green cannot burn the cap.

   **The subtlety fwdloop has and bareloop does not.** bareloop's close is a command exit; a
   worker needs no knowledge of it to do the work. Ours can be a **softgreen declared shape**,
   which reads like an instruction. So the split must be stated: the step sees its **goal** ("write
   a reply, one line per invoice"), never its **close** ("the artifact must carry N invoice-line
   figures, a total and a due date, each cited, and here is the field list"). Goal in, gap back,
   close never. If a shape cannot be split from its goal that way, that step is **hitl**, not
   softgreen.

   **Still never:** rewriting a step, re-picking a primitive, or re-drafting the flow. Those are
   edits to a signed artifact and need a human and a new hash (M4). A close-red that strikes out
   escalates with the gap text — the deterministic analogue of the playbook's confidence-threshold
   handoff (§7). A model's self-report never routes anything.

8. **Token cost is a go/no-go the buyer applies before we build (hamr, 2026-09-09).** People ask
   "how do I make best use of tokens" *before* anything is built, and a job that is technically
   automatable may still not be greenlit because it is expensive per run. So every flow states
   its cost up front and every audit row carries $ per run and per step; a budget knob the human
   signs is a first-class product feature, not an ops detail.

   **Two knobs, both signed, both tighten-only (RE-RULED 2026-09-09, v0.5's shape kept):**
   - `cap.usd` — per RUN. Binds between rounds; may overshoot by at most one round.
   - `cap.monthlyUsd` — per calendar month, reset on the 1st at 00:00 local. **The trigger fires
     only if `monthlyUsd − spentThisMonth ≥ cap.usd`** — the whole run is funded before it starts,
     never funded halfway and halted. Otherwise it records `monthly-exhausted` and does not start.
   - No daily number, no grace, no borrowing. `spentThisMonth` sums `history.jsonl`; any row with
     `spendComplete: false` makes the sum a **floor**, and a floor at or over the wall halts —
     unknown is never rendered as 0. A pause spends nothing.
   - Informative only, never a rule: the UI prints "at this pace, N runs left this month."
   - More runs come only from a human raising `monthlyUsd` and re-signing the flow.

   *A monthly/30 daily allowance with a 10% last-step grace was re-raised on 2026-09-09 and again
   NOT adopted: three numbers plus an exception, the exception is a **widening** rule where
   everything else here is tighten-only, and a run paused at an ask across days has no clear daily
   to debit. Recorded twice now.*

**There is no wiring layer (RULED 2026-09-09, after reading bareloop).** We do not build one.
The doctrine borrowed whole: **bareloop is not deterministic in how work gets done — it is
deterministic in how work gets judged.** Inside a worker the model calls whatever granted verbs
it likes, in whatever order, and nothing constrains that; all the determinism lives in the
close. fwdloop copies the two channels and authors neither:
- **Inside a step** — the LLM calls primitives and intermediates live in its own transcript. It
  *is* the wiring here, exactly as in bareloop. Shape may vary freely; nothing checks it.
- **Between steps** — the step emits **one typed artifact carrying its citations**. The next step
  reads it by id. Fresh context per step, so the transcript never crosses the boundary.

Shape variance between steps is therefore absorbed by the **typed artifact and the close**, never
by a wiring graph. Wiring is not a primitive, is not authored, and is not a module.

**Why there should be no wiring problem at all — the bareloop answer (read 2026-09-09).**
bareloop does not wire primitives, and the reason is worth copying. Two mechanisms, neither of
them wiring:
- **The close** is *"a DECLARATION over kinds whose implementations we own. The agent never
  authors a stage body — it parameterises four kinds, and anything it could not say here it
  cannot make the arbiter do"* (`src/kinds.js:1`). Illegal is **inexpressible**, not rejected late.
- **The worker** gets a *granted verb list* per plan step. `TOOL_BY_VERB` (`src/tools.js:93`) maps
  each verb onto an existing implementation — menu-is-inventory — in four components: write
  (`write`, `edit`), select (`read`, `grep`, `recall`, `get`, `impact`, `related`, `recent`),
  compress (`compress`, `peek`), isolate (`stash`, `remember`, `forget`). The step says which
  verbs it may use. Nothing says what feeds what.

**A primitive is a tool call inside a turn, never a turn.** A plan step is one worker, one
`Loop`, many rounds; inside a round the model calls whatever granted tools it needs.

**The reason wiring never came up there and did here:** bareloop's steps share a **repo**.
Primitive A writes a file, primitive B reads it — the **filesystem is the wiring**, so nobody
authors it. fwdloop has no repo, and that hole is exactly where the wiring question appeared.
**The fix is to give steps a shared artifact space the way bareloop gives them a tree:** a step
names the primitives it may use and addresses artifacts by id. Plumbing is *addressed*, not
authored. M0a's validator therefore checks that the artifact a step reads is one an earlier step
declared — it does not build a graph.

### What the human writes (RULED 2026-09-09)

**Prose** — the job description. Open text, preferably bulleted or numbered in normal human
order. Not a step list, not a spec, no primitives, no jargon. The way you would tell a new hire
what the job is.

**Guardrails** — the rules the job runs under, in the human's own words. Five kinds, and the
drafter maps each to machinery:

| guardrail the human writes | what it becomes |
|---|---|
| "every number must point to the cell it came from" | a **green** close on that step |
| "one line per invoice" | a **softgreen** declared shape |
| "don't send without review" · "ask me if more than one matches" | a **hitl** `ask` step, position signed |
| "don't disclose PII" | redaction at the tool boundary; `local-only` restricts the provider factory (P7) |
| "make sure you have your skill" | a signed skillset checkbox — the drafter only sees unlocked primitives |
| "cap $0.25 per run" | `cap.usd` — an arbiter field, restated by the human, never by the drafter |

A guardrail the drafter cannot map is **surfaced in the draft table**, never silently dropped.

**Guardrails and steps are two MAPPING LISTS (RULED 2026-09-10).** The guardrails are a numbered
list of the human's own bullets. The steps are a second list. A step's close points at a guardrail
**by its number** — the number is the join key, never the text. Text matching was tried and dropped
in both forms it can take: a substring match lets a green close trace to a single letter, and a
whole-line match breaks the moment the drafter re-wraps or re-punctuates the human's words. A
number cannot be partially right. It also makes the surfacing rule above *computable* rather than
aspirational: the guardrails no step traced to are exactly the unmapped numbers.

**Every step has a close, and a MISSING close IS `hitl` (RULED 2026-09-10)** — not a red. This is
the same rule as *anything fitting no class falls to hitl*, applied to the case where the drafter
said nothing at all: silence about how a step is proven done means a person proves it. Silence is
therefore safe and guessing is not, which is the incentive we want. An **invented** class is a
different thing and stays a red — `"yellow"` is not silence, it is a wrong answer, and normalising
it to hitl would hide a drafter making up machinery.

**A shape stated only in the prose is NOT a softgreen (RULED 2026-09-10).** Job #1's prose says
"write me a short reply with one line per invoice", and that sentence is a shape — but it is not a
guardrail, so the drafter may not turn it into one. The step falls to `hitl`. The human's fix is to
restate it as a guardrail bullet, which is what job #1's fixture now does.

The alternative — letting the drafter read a shape out of the job description — was raised and
declined. It puts the machine in the position of deciding that a sentence was a shape, which is the
one thing softgreen exists to prevent: *a shape is the human's to write*. The cost of the hard rule
is one line of typing and a step that falls safely to a person when the human forgets. The cost of
the soft rule is a wrong inferred shape that closes green, and the only place it could be caught is
the draft table, before signing. Prose says WHAT the job is; guardrails say HOW each step is proven
done — and there is no judge in v1 to fall back on, so an unstated close is always a person.

### The signed artifact (RULED 2026-09-09)

One flow, one hash, signed whole. Any edit flips the hash and demands re-accept (M4).

```jsonc
{
  "name": "ar-aging-daily", "version": "<hash>",
  "trigger":    { ... },              // ARBITER — human only
  "cap":        { "usd": 0.25, "monthlyUsd": 30 },   // ARBITER
  "askTtlMs":   ...,                  // ARBITER
  "egress":     { "allowList": [...] },              // ARBITER
  "skills":     ["..."], "persona": "...",           // ARBITER (signed checkboxes)
  "provider":   "deepseek", "model": "deepseek-v4-flash", // ARBITER — INSIDE the hash
  "guardrails": "<the human's own words, verbatim>", // the SOURCE of every class
  "steps": [
    { "goal": "...",                  // drafted
      "primitives": ["..."],          // drafted — granted menu, menu-is-inventory
      "reads": ["a1","a3"],           // drafted — artifact ids an earlier step declared
      "emits": "a4",
      "close": { "class": "green|softgreen|hitl",
                 "shape": { ... },    // softgreen only — the human's declared shape
                 "tracesTo": "every number must point to the cell it came from" } }
  ]
}
```

**How a class is set (ruled).** The drafter reads the guardrails, maps each to a class, and
attaches one to **every step it cuts**, recording in `tracesTo` the guardrail phrase it came from.
The human sees the whole thing as a **diff at sign time** and may change any step's class before
signing. Nothing is final until signed — so the class is still *declared, never inferred*, and the
human never fills in a form for steps they did not write.

**The draft table is the negotiation surface.** The drafter replies with one row per step —
step, goal, close class, primitives, what it reads — as a clean list a human can read in one
pass. The human replies with changes in prose ("merge 3 and 4", "make step 5 my call", "that
total should be green"). Redraft, re-read, repeat. **Fire only on agreement**, and agreement is
the signature.

**Both lists are numbered, and the link is shown from both ends (RULED 2026-09-10).** The draft
table is not one table but two, joined by the number: guardrails with the step each one proves,
and steps with the guardrail each one is proven by. Numbering both sides is what makes the mapping
readable without being explained, and — the reason it is a rule, not a formatting preference — it
makes both kinds of hole impossible to miss:

- a guardrail with **no step** is a blank on the left: the human wrote a rule nothing uses;
- a step with **no guardrail** shows `hitl` on the right: the human will be checking that step by
  hand on every run, and can see the cost of that before signing rather than after.

Neither hole is inferred, and neither is an error — a `hitl` step is a legitimate outcome and an
unmapped guardrail is often an arbiter field (job #1's ask position, accept and cap are guardrails
3, 4 and 5, and no step's close may claim them). They are *decisions the human is being shown*.
The same numbered pair is the CLI's output, the draft table and M5's screen — one object, no
second format to keep in sync.

**A step no guardrail covers falls to `hitl`.** Never to green-by-default. The machine may claim
`green` only where every figure in that step cites a source and recomputes; it may never claim
`softgreen`, because a shape is the human's to write. This is the one-way default: unclassifiable
means a person, which is the mechanical form of "unsure = red".

**`provider` and `model` live inside the signed hash, not beside it (2026-09-09).** Borrowed from
bareloop's calibration design: storing the model *with* the thing it graded means a model bump
makes every signed spec hash differently — the signature dies and re-acceptance is forced **by
construction, not by policy**. This is playbook P6 (model change = maintenance mode) given a
mechanism instead of a rule. It applies to fwdloop with no judge at all, because the same argument
holds for the step executor: a flow proven on one model is not proven on another.

**Why the guardrails stay in the signed spec after mapping.** They are the human's own words, and
three things need them: the audit must be able to say *"this step is hitl because you wrote 'check
with me'"*; every class must trace to a guardrail or be hitl; and re-drafting after a prose edit
re-derives classes from them.

**One radio for the whole job was considered and rejected:** job #1 alone mixes all three
(calculations are green, the reply shape is softgreen, the accept is hitl), so a single class would
force the whole job down to its weakest.

---

## §4 Out of scope (v1)

No swarm; one process per run. No multi-agent orchestration; a flow is a fold over steps. No
RAG, no vector store, no catalogue — inputs are files the human named. No LLM summarisation as
the default compressor. No self-adjusted budgets, ever. No cloud, no multi-user, no chat UI (the
inbox is a list). No mobile control. No learning or inheritance between flows. No fully
automated flow without a human stop. **No patching or inventing a baresuite primitive.**

**No LLM judge (ruled 2026-09-09).** softgreen here is a **declared shape checked mechanically**.
A second model never decides a close.

*Name collision to keep straight:* bareloop's `softgreen` is a **judged** close — an LLM judge
against a rubric, with a calibration gate. Ours is a declared shape with no model in it. Same word,
different mechanism. When the two projects talk, say which one is meant.

*Their calibration gate is offered and declined for now (bareloop session, 2026-09-09):*
`src/calibrate.js`, `src/judged.js` at `05ea1ab` — a 10-of-10 floor with itemized reds, no partial
credit, before a judged close may sign. **It has never run: 0 calibrations across 167 archived
runs**, only because no softgreen job was ever authorable there. Reviewed and unit-tested, not
live-proven. We have no judge to calibrate, so borrowing it now would be machinery ahead of need —
and unproven machinery at that. Recorded in §8 with the four ideas worth taking if a judge ever
arrives.

**No CLI as a product surface (ruled 2026-09-09).** `npm install`, one command, a localhost server
starts and **the browser is the product**. The server owns the scheduler, so a trigger never needs
a separate command. A CLI exists — M0 through M4 have no UI yet and must be driven — but it is
undocumented, unsupported, and carries no stability promise. One surface, not two.

---

## §4b Stack — vanilla JS (RULED 2026-09-09)

**Vanilla JavaScript, ESM, node stdlib.** No TypeScript, no framework, no build step. Types where
they help go in JSDoc, the way bareloop and litectx do it — checkable without a compiler.

AGENT_RULES' dependency hierarchy binds as written: **vanilla → stdlib → external, and external
only when stdlib cannot do it in <100 lines**, with the standing exception that security-critical
code (crypto, auth, sanitisation) always uses a vetted library. The bare suite is a **dependency,
not an external** in that sense — it is the thing under validation.

This is what the POC already is (`poc/m0/*.mjs`, one declared dependency: `bare-agent`), stated
here so the language is not an inference. The one place this will be tested is M5's UI: **vanilla
over frameworks** holds there too, and a framework needs a reason, not a preference.

---

## §5 Baseline model — SETTLED, not reopened

**`deepseek-v4-flash` (DeepSeek direct) is the baseline for every experiment**
(`pass show amr/deepseek_api` → `DEEPSEEK_API_KEY`). **`hf:Qwen/Qwen3.8-27B` on synthetic.new is
the second provider** (`pass show amr/synthetic_api` → `SYNTHETIC_API_KEY`) — a different company
behind a different gateway, so losing one does not lose both.

**Flipped 2026-09-09 (F12), and the reason was already measured.** F10 ranked them and kept the
incumbent on a tie, but it *deliberately excluded* DeepSeek's cache discount because those 18
rounds were cold — "it would flatter a workload that is not this one." fwdloop's real workload is
not cold. Every step re-sends the same standing instructions, so a repeated prefix is the **normal
case**, and F9 measured 99.8% of a 4,361-token prefix coming back cached on a repeat at roughly a
tenth the price. synthetic exposes no prompt caching at all (`prompt_tokens_details: None`), so
there is nothing to discount there. Second measured reason: **no ~250s cliff** (F9) — synthetic
cuts any single request at ~250s regardless of streaming (F6), which forces every step to be sized
under it; DeepSeek returned a complete 32,000-token response at 296s.

*Stated against the flip, honestly:* F10 gave DeepSeek the slightly worse step-count spread (3 vs
2, including the lone 11-step outlier) and the slower median wall (55s vs 33s). Both were below the
money line in the ranked rule, and neither is a correctness signal — correctness and provider-reds
were dead even at 9/9 and 0. *What would flip it back:* a correctness or provider-red gap in either
direction, or the warm-cache advantage failing to appear on a real multi-step run.

**Claude / OpenAI are a differential probe only** — one round, to split "is this our mechanical
code or the model" when we are stuck. Never a baseline. Never a default. Always named in the
finding. hamr spent ~$300 on Claude in bareloop and is not repeating it.

**No model hopping.** A change of baseline needs a measured reason filed in FINDINGS.
fwdloop is LLM-agnostic by construction — `poc/m0/provider.mjs` is the one writer for
provider + rates + key, so swapping is a slot, not a rewrite.

---

## §6 Modules, in order

**The rule that binds this section (this is the fix for v0.5's drift).** A module does not start
until its **scope, exit, and negative scenario** are written in this file and signed. Modules run
in order; never start N+1 while N is unproven. Every POC result updates this PRD — a result that
flips a claim is a spec change, not a footnote. A module works on its own, then connects to what
is built, before the next starts. Never ship the POC.

### M0 — go/no-go (both claims)

Two POCs, ordered. M0a must pass before M0b starts.

**M0a — scout + selection + walkable chain.** A bounded read-only scout looks at
`fixtures/ar-aging.csv` and `fixtures/message.txt` first; its menu has write and store primitives
filtered out by construction. Then give the drafter job #1 as prose+guardrails, the scout's facts,
and the baresuite primitive catalogue. Copying bareloop's shape: it emits steps that each carry a
**granted primitive list** (menu-is-inventory — every entry an existing implementation) and the
**artifact ids it reads**; it authors no bodies and no plumbing. Steps share one artifact space,
which is fwdloop's stand-in for bareloop's tree. A deterministic validator then proves the chain
is walkable: every artifact a step reads was declared by an earlier step, and every primitive
named exists in the catalogue and is unlocked by the flow's skillset.
- *Exit:* the chain is walkable end to end on the baseline model, and the validator names both
  primitives when it is not. The scout's facts appear in the draft — a column name in the
  declaration matches the fixture and was not invented.
- *Negative scenarios (the test must be able to fail):* (i) a step reading an artifact no earlier
  step declared is a red naming the step and the artifact; (ii) a job line with no groundable
  check is refused at draft, never given a proxy check (F10's 6/6 must hold when the menu is
  primitives, not kinds); (iii) a primitive not in the catalogue is a red, **never invented** —
  this is the (f) rule made mechanical; (iv) a primitive outside the flow's signed skillset is a
  red even though it exists; (v) the scout attempting a write-class primitive is impossible, not
  merely refused — the verb is absent from its menu, and a test proves the menu is filtered;
  (vi) **the uncovered-line plant** — one prose line no guardrail covers (e.g. "flag anything that
  looks unusual") must land at **hitl**, never at a green or a softgreen the drafter invented a
  shape for. Job #1's own guardrails cover every step, so without this plant the
  unclassifiable-falls-to-hitl rule (§3) is never exercised — and that rule is the mechanical form
  of the F104 proxy-check lesson, so it is the one that most needs a test that can fail.
- *Kills the module:* the catalogue cannot express job #1 without a new primitive → upstream ask,
  and M0 stops until it is delivered.

*What M0 is actually asking (hamr, 2026-09-09):* **a job → its close → can the LLM form one →
citations.** Primitive selection is in M0a because a close cannot be formed without knowing what
the step does; it is the means, never the point. If a measurement forces a choice between proving
primitive selection and proving close formation, close formation wins.

**M0b — run it, close it.** Execute M0a's declaration against job #1 using **only** baresuite
primitives. Every step closes under its declared class (§2): **green** on the `derive` steps
(citation close), **softgreen** on `compose` (a declared shape — a customer line, one line per
invoice, a total, a due date), **hitl** at the signed `ask`, and the mechanical *happened* check
on all of them.
- *Exit:* the four v0.5 plants reproduce on primitives — (a) wrong derived total goes red naming
  the figure and formula; (b) wrong copied cell goes red naming the cell; (c) an ambiguous
  customer name lands at an `ask` and never a pick; (d) a clean run goes green through `send`.
  False reds 0. Both providers.
- *Negative scenarios:* (i) a plant that F5 caught on bespoke code must still go red on
  primitives — a plant that goes green is the headline finding and a spec change; (ii) **the
  green-by-omission plant (F7)**: a reply missing the total and the due date must go red on the
  **softgreen shape check**, because that is precisely what a declared shape exists to catch and
  what a truth-only close missed; (iii) a step whose class is not declared is refused at
  validation — the machine never picks a class.

*Numbers before firing (playbook P2):* plants caught N/N, false reds 0/N, $ per run against the
human cost, wall per run. Cap: **$5 total**, spend so far $0.167.

### M1 — declaration spec + validator + hash
*Scope:* the grammar M0 proved, written down and mutation-tested. Primitive catalogue as data;
arbiter fields inexpressible to the drafter; **`ask` positions as declared slots the drafter
fills, never steps it may add or omit** (F10: both providers wobbled on exactly this); ReDoS-safe
patterns; hash flips on any edit.
*Exit:* a mutation suite where every single-field corruption is caught; a drafter cannot express
an arbiter field in any position.
*Negative:* a declaration missing a required `ask` slot is a red, not an absence.

### M2 — runner
*Scope:* fold over steps, fresh context per step (artifacts, never transcripts), effect check per
step, close by declared class, the **ralph loop** (`while close-red and under-cap`, stop at first
green, strikes govern), `audit.jsonl` + `history.jsonl`, money honesty, provider-red ladder.
*Load-bearing invariant:* the step executor is constructed without its close and without the cap —
goal in, gap back. A test must prove the close is not reachable from the executor's context.
*Exit:* an arbitrary valid declaration runs — not job #1's shape hand-wired (v0.5's M0 could not
do this; it is logged as its scope limit).
*Negative:* a step whose effect check fails halts the run and names the step.

### M3 — ask + inbox (the HITL window)
*Scope:* `fwdloop inbox`, `fwdloop answer <id> accept|rerun "<t>"|pause`, TTL, checkpoint/resume
at step level. Pause spends nothing. A resume never re-asks an answered question.
*Exit:* a run pauses, a separate process answers, the run resumes into the next step.
*Negative:* an expired TTL cancels; a rerun is a fresh engagement with its own counter.

### M4 — dry-run / accept / versions
*Why here:* the UI's "edit and add turns" is meaningless without versioning, so accept lands
immediately before it.
*Scope:* dry-run redirects egress to a file and changes nothing else (reads stay real); accept
signs a version hash; any edit flips the hash and demands re-accept; rollback to a previous
accepted version (playbook P9).
*Exit:* an edited flow refuses to run until re-accepted; rollback restores a prior accepted
version and its cases still pass.
*Negative:* a flow edited on disk without re-accept is a red naming the changed field, never a
silent run of the new version.

### M5 — localhost UI (the crux)
*Ruled 2026-09-09: "UI is the crux of the product where humans author / run / describe /
observe."* It moves here from last. Every module after this one ships its screen.
*Scope:* describe a job in prose+guardrails and see the drafted steps; run it; watch it; the
inbox and its three doors; `audit <run>` as a readable table with the citation trail; **edit an
existing workflow and add turns to it**, which re-signs through M4. Responsive and phone-tested
per AGENT_RULES — this is not a POC.
*Exit:* a person who has never used the CLI can describe job #1, sign it, run it, answer its ask,
and read why a red was red — without opening a terminal.
*Negative:* a wrong number in the output is traceable to its source cell in the UI in one screen;
if it is not, the audit is a log and not a product feature, and that is a spec change.

### M6 — skills + persona
*Scope:* `skills/<name>/SKILL.md` gating the drafter's visible primitive subset; signed persona
line affecting `compose` wording only. Menu-is-inventory: a checkbox with no skill directory is a
validation red.
*Exit:* the drafter cannot select a primitive its signed skillset does not unlock.
*Negative:* persona changes wording and never a cited figure.

### M7 — case library + maintenance mode
*Scope:* `cases/<id>/` per flow (playbook P1); every human-resolved red becomes a case; re-run on
every edit and every model or provider change (P6); the incident loop (P8) detect → diagnose →
contain → extend cases.
*Exit:* a model swap that breaks a case is refused at accept, naming the case.

### M8 — triggers + flow handover
*Scope:* `manual`, `cron`, `file-drop`, then `inbox-poll`. Flow-to-flow handover (§3.6) rides
`file-drop`: A's `send` writes it, B's trigger fires on it, one history row each side naming the
other's run id. The monthly wall (§3.8) is enforced *by the trigger*, before a run starts.
*Exit:* a trigger refuses to fire when the month cannot fund a whole run, and records
`monthly-exhausted` rather than starting and halting mid-way.

### M9 — real IO
*Scope stated when its turn comes.* Mail in/out, chat, browse — each behind the signed
allow-list and a prior `ask` accept in the same run.

---

## §7 Playbook — split by target (ruled 2026-09-09)

`docs/product/playbook.md`. Each rule binds either **how we build fwdloop** or **every flow
fwdloop produces**.

**Binds us (construction):**

| rule | what it means here | lands |
|---|---|---|
| P2 — numbers before the module | pass/fail with no pre-registered number cannot be tracked | every module, §6 |
| P10 — model chosen last, by the suite | no module selects or tunes a provider | done, §5 |
| P5 — prompts as code | `src/prompts/` hashed; `promptVersion` in every audit row | M2 |

**Binds the product (every generated flow):**

| rule | becomes | lands |
|---|---|---|
| P1 — living case library | `cases/<id>/` per flow, owned and tagged | M7 |
| P3 — behavioural audit columns | `toolCalls`, `reads`, `rounds`, `retries`, `duplicateReads` | M2 |
| P4 — freshness at `gather` | stale input is a red, not a confident hallucination downstream | M2 |
| P6 — model change = maintenance | provider+model are signed fields; changing them needs re-accept | M4 + M7 |
| P7 — data residency | a `local-only` guardrail restricts the provider factory | M6 |
| P8 — incident loop | detect (`history`) → diagnose (`audit <run>`) → contain → extend cases | M7 |
| P9 — rollback | `accept --version <hash>` re-activates the last accepted flow | M4 |

**Where we deliberately do the opposite of the talk:** the human sits where the human **placed**
the ask, never where a confidence number falls — confidence is unmeasured, uncalibrated and
gameable, a position is signed and immovable. And groundedness is checked by **resolving
pointers**, not by asking a second model.

---

## §8 Open questions (do not block M0)

1. ~~Does the drafter need more than one shot?~~ **RESOLVED 2026-09-09: yes, and that is the
   multi-turn.** Draft-time negotiation over the table until the human agrees, then sign. Run time
   stays one shot per step. See §3.5.
2. **Does a typed artifact carry enough between steps?** If a step needs something the previous
   step's artifact did not capture, the artifact schema is too narrow — a spec change, not a
   wiring layer. M0a answers it.
3. **Is the step-kind menu still needed** once steps name primitives, or does the primitive imply
   the kind? M0a will show.
4. ~~Human cost to beat~~ **SIGNED 2026-09-09 as a stated assumption, not a measurement:**
   15 min of a bookkeeper at $50/h = **$12.50/day**. M0's $ per run is reported against it. It is
   an assumption hamr accepted, not a figure anyone measured — if a real number arrives, it
   replaces this and M0's ratio is restated.
5. **Memory across runs** (litectx as the store, facts superseded by id) — not in any module yet.
6. **What does a flow directory look like on disk?** Deferred to M1.
7. **Pinning a proven step — "3D-print the mockup" (hamr, 2026-09-09). Recorded, NOT a module.**
   After a flow works, can its probabilistic part be frozen into deterministic code to stop
   spending tokens on it?

   **Yes, and it does not contradict "wiring ages, closes don't"** — that argument is about
   building wiring *up front*, guessing what the model cannot do. This is the opposite: recording
   what the model already did, N times, with the close still watching.

   *The mechanism already exists.* A green step's citation **is** a program —
   `{value: 4200, source: {col: "Amount", cell: "E2"}}` says exactly where the number came from.
   The arithmetic is already ours (the closed formula grammar is machine-computed, never
   modelled), so the only thing a model does in a green step is **extraction**. Freeze the
   extraction and the step costs $0.

   *The catch.* A citation records `row: 2`; tomorrow the row moves. Pinning requires promoting a
   citation to a **rule** — not "row 2" but "the row where Customer = the matched name" — and
   generalising from one run is where it gets dangerous. From twenty, much less so.

   *Why freezing stays safe.* You lose adaptability, never safety: a wrong frozen selector goes
   **red on the same close** a model would have. Red → unpin → the model takes over. The close is
   what makes freezing survivable.

   *The shape, using only what is already planned.* M7's case library accumulates runs; a step
   whose citations resolve to the same shape across N greens (same column, same formula, row
   picked by the same predicate) becomes a **pin candidate**; pinning is an **edit**, so it takes a
   new hash and a human re-accept (M4); the close is unchanged, and a pinned step is judged
   identically to a modelled one.

   *When to build it — a number, not a feeling.* Job #1 costs $0.003–0.006 per run against a
   $12.50/day human, so pinning saves a rounding error today. The trigger is a measurement showing
   a flow's token cost is blocking a greenlight (§3.8), never a hunch.
8. **If a judge ever arrives, borrow these four, not the plumbing** (offered by the bareloop
   session, 2026-09-09; `src/calibrate.js`, `src/judged.js`, `src/declaredclose.js`,
   `src/cardauthor.js` at `05ea1ab`). Recorded now so it is not re-derived later. **Not scope** —
   §4 rules no judge in v1.
   1. **Locate vs decide.** The model never says pass/fail. It extracts facts and quotes only; a
      deterministic `decide()` renders the verdict; unsure = red. This is what stops a
      probabilistic judge becoming the arbiter, and it is the same split our citation close
      already uses — which is why it reads as familiar rather than new.
   2. **Three readings never mixed.** A *graded case* compares verdict **and** itemized reds as
      sets of `(rule, fn)` — a pipe that reds the right case for the wrong reason was lucky, not
      calibrated. An *injection style* resists only when it moved neither the located list nor a
      single fact. A *casualty* (call failed, cut off, unpriced, unparseable after retry) is **no
      evidence in either direction** and stops the gate on its own axis — the same shape as our
      "unknown cost is never 0".
   3. **The gate reports and never signs.** It picks no number; a separate step turns a failed
      calibration into a refusal.
   4. **An absent judge seam is a wiring gap that stops the gate, never a silent skip.**

   *Already taken from this, ahead of any judge:* the judge-model-inside-the-hash mechanism, now
   §3's signed artifact — `provider` and `model` sit inside the signature, so a bump forces
   re-acceptance by construction rather than by policy.

   *Sizing, if it is ever needed:* locate+decide ran ~$0.002–0.004 per call; haiku emitted
   malformed JSON on locate roughly 1 in 6, mitigated with one retry and **never JSON repair**.
