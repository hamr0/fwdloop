# fwdloop — the layer map (plain language)

> What this page is: one short map of the flow, the layers, and what happens when things go wrong.
> Rewritten 2026-10-08. Updated 2026-11-15 (the one check list, status to v0.34.0); shape borrowed from bareloop docs/product/LAYERS.md (origin/main, c57d199 + 1b8115c).
> The PRD is the contract; this is the map. Status diaries live in the PRD and `docs/logs/FINDINGS.md`, not here.
> Jump to: **harness vs arbiter** (in "The shell") · **the one check list (~ ! $)** (after "The flow") · **how many rungs** (near the end).

---

## The idea

You describe a job you already do by hand, in numbered lines. Beside each line you say how you would
know it was done right. A drafter turns that into steps and shows you a table. You **sign** it.
After that the job runs under a money cap it cannot raise, and **every step must prove it
happened**. Where you wrote "ask me", it stops and waits. This is the job **with a human in it**.
The machine never decides your work is good. It makes sure that what you said would happen, happened.

---

## The flow

```
YOU (panel Chat tab, or the CLI)
  │  describe the job: numbered lines, "how I'd know" (the ~ rules) beside each (or blank)
  ▼
SCOUT looks at the real files, a saved web page or a sheet (read only) · DRAFTER writes steps, no tools,
each step names the one line of yours it serves
  │
  ▼
THE CARD (the plan): your lines and the steps for them, and under each line ONE list of checks,
each row tagged ~ [you], ! [agent] or $ [default]. A question comes with buttons
(Agree · Drop it · your own words); the answer replaces its rule in the list; redraft.
  │
  ▼
CHECKS at $0 before any money: files exist · no secret in the text ·
the monthly limit has room · every wanted tool is really built ·
a check the machine cannot run is refused, naming the line
  │
  ▼
YOU SIGN  (one hash covers the job, the cap, the asks, the allow-list; any edit = sign again)
  │
  ▼
THE RUN, one step at a time, fresh context each:
  step → "did it happen?" check → red? gap goes back, try again (2 strikes = stop)
  The run uses the model you ticked for it (`fwdloop run --model`); resume keeps it.
  Thinking is set by code, per try: try 1 off (a rerun's first try too); a retry, and a redo at an ask, on.
  The ticked Chat-box "Thinking on" forces it on every try. The audit row says what was asked.
  │
  ▼
ASK: the run stops at the line you marked. It PARKS (the process ends, nothing is spent).
  │  you answer in the panel or the CLI: accept · redo (with a reason) · rerun (with a reason)
  ▼
RESUME: another process picks up exactly there. An answer is used once.
  │
  ▼
ACCEPT → SEND: your last line is the job's action: it writes everything before it, only to the signed folder, only the exact file you accepted (hash-checked).
  The AI says if your last line is the action; if there is none it suggests one and you Agree or type your own.
  An Ask before it is not required: if what goes out changed since your last accept, or you accepted nothing in this run, the run stops once
  and asks (Accept / Not now) before it writes. [M13 am11, unreleased]
  │
  ▼
ENDED:  passed · failed · stopped · expired
  passed           → the output is where you signed it to go
  failed           → read why; fix the job; sign again
  stopped / capped → Resume, once the cause is gone
  expired          → a person must reopen it (Reopen, on the Ask tab or the Run tab)
  │
  ▼
NEXT TIME: a trigger reruns the same signed job.  [M9, released in 0.18.0: set When on a job with one good run; the panel starts it while it is open. A schedule is its own signed file (`schedule.json` beside the job, with one queue file), so setting or cancelling one never re-signs the job (M9 am20, released in 0.20.0).]
  │  Learnings from ended runs lean the next draft, and a step's retry, redo or rerun
  │  (one block, at most 2,000 characters). They lean, never judge: the close alone judges.
  They are handed on a retry, a redo at an ask and a rerun's first try, never on any other first try, even with the Chat-box hatch.  [M8, released in 0.24.0]
```

---

## The one check list (~ ! $)

Since M16 (0.33.0) and M17 (0.34.0) there is **one list of checks per job line, and nowhere else.**
Every surface shows the same list: the plan card, the Job tab, the Audit "Checks" fold, the Result tab.
Copied from bareloop (M16 from v0.56.0, M17 from v0.57.0), with fwdloop's own parts kept.

**Three kinds of row, each wearing a tag:**

| tag | who made it | what it means | what you can do |
|---|---|---|---|
| `~` **[you]** | you, in your own words | your own rule. One rule is one row, never two | keep it, or reword it |
| `!` **[agent]** | the AI suggested it; code proved it and built it | on by default | **Drop** it (and Add it back) |
| `$` **[default]** | code's own floor | the step's answer is not empty, the model said `done:true`, a page fact is quoted, numbers tie back to the quotes | nothing; it is the floor |

**Who does what.** The AI only *suggests* (on a row-edit turn). Code proves each suggestion and builds
the check itself, on **bareguard**. The AI never writes a check. A check code cannot build is not faked.

**One in, one out.** When something asks you a question and you answer it, the answer **replaces** the
rule it is about. Agree to a reading, type your own words, or answer a column question: the `~` rule is
rewritten in place. Nothing is added beside it. The same number of rules comes out as went in. A rule whose
words already are the check is not asked at all. The AI naming a new rule is the only way to add one.

**Questions are buttons.** Agree, Drop it, or your own words. Only the button's typed code counts; the machine
never reads "agree" or "drop" out of what you typed. If the AI said "can't find X, found Y" and you Agree,
the AI's reading becomes a `!` row (it replaces in place; nobody asks what it checks).

**Not checked.** A rule that no check holds shows **once** in Not checked, with its reason. The usual
reason: "No check was picked for it, so you judge it at the Ask." On a rule that sits on an Ask line:
"you judge it at the Ask." The machine never invents a check, and never says covered when it is not.

**By job type:**

| job | how the list is built |
|---|---|
| **page** (read a web page) | facts quoted from the page; a rule code can tie to a quote becomes a check. Money in another currency than the page, or a phrase found in no result row, is Not checked. |
| **sheet** (a CSV) | a cells check reads the step's own answer; code builds it on bareguard's helpers (M10b, M17). A second check on the same rule is its own `!` row with Drop. A **table** check reads only the input sheet ("the sheet has 8 rows"), so it is its own `!` row and **never covers your `~` rule** (M17 am7); a rule only it named is Not checked. A sheet step with no built check becomes a human-checked step. |
| **Tickets** | the filter and the watch are rows on the list: the AI suggests the value, code proves it and writes the run's filter and watch from the row. Content rules are Not checked. |
| **line with no guardrail of yours** | only the numbers tie; other checks cannot be signed there and show Not checked with the reason. |

**Still waiting, not built.** (1) The AI's third-try questions that name the rule they are about, so an answer
can replace or add (waits for bareloop's release; today such an answer adds a rule). (2) The Tickets filter rule is
still found by a fixed table of words (waits for the same bareloop change).

**Parked.** "under N words" means `maxWords N`, so N passes (needs hamr's ruling on "under"). A word of a job's
prose that is no rule (such as "aging report") can show in Not checked as a missing column (F198, recorded, not fixed).
What was proven, by number: F185-F190 (the M16 copy and bareguard's sheet helpers), F191-F197 (one in, one out,
code-built sheet checks, the table row), F196 (the aging practice walk), F198.

*The kid version:* one clipboard per chore. Some lines mom wrote (`~`). Some a helper pencilled in and mom's
rulebook proved (`!`; mom can rub it out). Some are printed on every clipboard (`$`). A wrong answer
fixes the line it was about; it never starts a second line.

---

## The architecture: a shell and six layers

### The shell (not a layer)

The fixed frame around every step. The agent can never touch it. Two words you will meet:

**The harness** is the machine around the model. It runs steps one at a time, checks each one,
holds the money cap, and writes the records. *Example: the model says "I wrote the file"; the
harness looks, and the file is empty, so the step is red.*

**The arbiter** is the signed, typed block the agent never writes: the cap, where asks sit and
how long they wait, the allow-list, the send target. (The schedule is typed data a human signs too,
but since M9 am20 it lives in its own `schedule.json`, not in this block.) *Example: the drafter may add
a step, but it cannot add a second send folder; only a signed arbiter line names one.*

Harness = how it runs. Arbiter = what you allowed. The harness obeys the arbiter.

```
 THE HOUSE (harness)  ─ walls, door, and mom's chore checklist ───────────────────────
 │                                                                                    │
 │  THE FRIDGE NOTE (arbiter) ─ signed by mom. The kid cannot rewrite it.            │
 │   when to start · how much allowance · when to come and ask · where things may go │
 │                                                                                    │
 │  ONE AFTERNOON OF CHORES (a run)                                                   │
 │   ┌────────┐  does a chore   ┌────────────────────────────┐                        │
 │   │  KID   │ ──────────────▶ │ MOM'S CHECK: did it happen │ ── no ─▶ "try again"   │
 │   │(model) │                 │ (the close of the step)    │                        │
 │   └────────┘                 └─────────────┬──────────────┘                        │
 │      ▲                                     │ yes                                   │
 │      │ allowance runs out ─▶ STOP (cap)    ▼                                       │
 │      │                       KID WAITS AT MOM'S DOOR (an ask, parked, costs nothing)│
 │      │                                     │ mom says "yes" (accept)                │
 │      │                                     ▼                                       │
 │      └─────────────────────────  BOX GOES OUT THE DOOR (send, hash-checked)         │
 ────────────────────────────────────────────────────────────────────────────────────
```

So in fwdloop terms:
- **Fridge note** = the arbiter block in the signed flow. **House + checklist** = the harness: runner, closers, books.
- **Kid** = the model doing one step. It never sees its own check or the money left.
- **Afternoon** = one run. **Door wait** = an ask that parks. **Box out** = send, only after your accept.

### Layer 0 — the close

- **Built on:** the rule "something came out, and it was not empty", plus a typed `done` flag from the model.
- **Does:** each step proves it happened. Then one of three checks: sums that point to their source (**green**), a shape you described (**softgreen**), or you look (**hitl**, a human check).
- **Whose checks:** fwdloop owns the "something came out" rule, the typed `done` flag, page and document quotes (cited checks, with the column lock) and the ask. Every other check is **bareguard's**: code builds it from one list of `~` `!` `$` rows (see "The one check list"), you sign it, bareguard judges, and the step only gives values in its typed boxes. For a CSV sheet the AI only suggests, code builds (M10b, M17). bareguard's defaults equal fwdloop's closers. A step never writes its own formula.
- **Survives:** the run's records. Nothing is judged by a model.
- **Status:** built.

### Layer 1 — the description

- **Built on:** your numbered lines, strictly 1-for-1 with your "how I'd know" lines.
- **Does:** the drafter cuts lines into steps. It picks no tool outside the signed list and writes no arbiter field. The step's goal is your line, word for word.
- **Survives:** the draft folder, until you sign it.
- **Status:** built (CLI `draft`; the panel Chat tab).

### Layer 2 — the signature

- **Built on:** one hash over prose, steps and arbiter. Tighten-only.
- **Does:** sign needs a person: a typed flow name at a real terminal, or two hash-bound clicks plus the name on the page. Any edit means signing again.
- **Survives:** forever, with the flow.
- **Status:** built.

### Layer 3 — the run

- **Built on:** a fold over the steps, each with fresh context, joined only by what the last one made.
- **Does:** try, check, gap, retry. Two strikes stop the run. At most four tries per step. It spends only under the cap.
- **Thinking:** code decides it per step, never the model. Try 1 off (a rerun's first try too); a retry (and a redo) on; the ticked Chat-box hatch forces on everywhere. bare-agent says what a model supports; on DeepSeek, thinking cannot go with a forced tool call, so that is the drafter only. The audit row records what was asked and the status, and Audit shows it on each try.
- **Model:** the run records the model it started on once. Resume keeps it.
- **Survives:** books on disk: every try, its cost, its check. A red run keeps its log too.
- **Status:** built.

### Layer 4 — the ask

- **Built on:** a signed ask line, which is a pure stop.
- **Does:** parks the run, spends nothing, waits. The answer is used once. A redo or rerun needs a reason. The ask has a signed time limit.
- **Survives:** across processes. Resume can be a different process.
- **Status:** built.

### Layer 5 — the screen

- **Built on:** a local panel (Runs, Ask, Inbox, Job, Settings, Chat).
- **Does:** describe, sign, run, answer, Stop, Resume, set keys, providers, models, prices and limits, all in a browser, and it works on a phone.
- **Survives:** nothing of its own; it reads the books. It is a client of the arbiter, never a second arbiter.
- **Status:** built.

### Layer 6 and on — in-run tools, learnings, triggers, real IO

- **Does:** tools a step may use, with memory for one run (M7); learnings from earlier runs (M8); triggers (M9); reading a web page, a sheet or a document, with cited checks and asks that code forces (M10), and a sheet's checks from bareguard (M10b).
- **Does (since then):** outside tools through MCP and tickets that start a run (M12); one setup for outside sources (M13); the carry memo, in-run memory told to every try (M14); one friendly `.md` result for every job (M15); one check list for every job line (M16, M17).
- **Status:** released through v0.34.0, in order, on the ladder below. M5 is closed (Accept is sign; dry-run waits for a real outside send; versions moved to editing a signed job, M6). M6 to M17 are released (M16 in 0.33.0, M17 in 0.34.0). Mail and chat are not built.

### Who keeps what

| thing | kept by | changed by |
|---|---|---|
| steps | the drafter | you, by redraft |
| cap, asks, TTL, allow-list, send target | the arbiter (signed) | you, tighter only |
| trigger (the schedule) | `schedule.json` (signed by you in two clicks) | you |
| "did it happen" | the harness | nobody mid-run |
| money spent | the books | nobody; unknown stays unknown |
| the answer to an ask | you | once |
| learnings (notes from ended runs) | code, at run end, in one ledger per user (`~/.config/fwdloop`, mode 600) | nobody; seeded once from past runs with `fwdloop learn seed`; handed only when `learningHints` is on |
| thinking per try | code (try 1 off, retries on) | you, only with the Chat-box "Thinking on" box; it is kept with the job |
| a job's checks (the `~` `!` `$` list) | code builds on bareguard, bareguard judges; the AI only suggests | you: your `~` rules, Drop or Add a `!` row, and the signature |
| the monthly limit | Settings | you, up or down |
| providers, models, prices, base URLs | Settings (none live in code) | you; a model is usable only when ticked with both prices |

**One rule: the machine may not author, loosen, or hide any of it.**

---

## Workflow or run

A workflow is the job: its lines, guardrails, asks and steps. A run is one go at it,
with its own inputs, destination, cap, ask wait, model and plan. Reuse workflow, on
any run, opens every box; what you change decides the rest.

| the run you start from | the job | you get | it drafts a new plan? |
|---|---|---|---|
| red | changed | a new workflow `<name>-N` | yes |
| red | same | `run-N` of the same workflow | yes, the old plan failed |
| green | changed | a new workflow `<name>-N` | yes |
| green | same | `run-N` of the same workflow | no, it reuses that run's plan |

The old workflow is never changed. A new workflow has no schedule until its first green.
A stopped run uses Resume instead.

---

## When something goes wrong

| what happened | what it does | what you see | who decides |
|---|---|---|---|
| a step's check is red | gap goes to the next try; a strike | running | nobody; the harness |
| two strikes, or four tries | stops the run, keeps the books | failed (struck-out) | you: fix the job, sign again |
| model says `done:false` | stops at once, no retry | failed, with its blocker | you |
| a check cannot judge (crash, unparseable) | no strike; a casualty, not a verdict | failed, named | you |
| money cap | refuses a try it cannot fund; writes a resume record | stopped, "money cap reached" | you: raise it, then Resume |
| provider or transport fault | one retry; a second fault halts, cost may be partial | failed (provider-red) | you |
| price unknown | halts; shown as "at least", never 0 | failed (pricing-red) | you: fix the price |
| you press Stop | stops after the step running; a Stop at an ask stops there | stopped | you: Resume |
| ask expired | ends; costs nothing more | expired | a person reopens it |
| answer saved but nothing took it | shows the cause | stuck | you: retry, or clear an old lock |
| process gone, no end row | no guess | crashed / unknown | you |
| redo or rerun with no reason | refused and re-asked | the ask stays open | you |
| sign refused | writes no flow, names the reason | the refusal, in words | you: fix, sign again |

Sign is refused for: a key in the text, a draft edited since it was hashed, a missing input file,
a missing person at the terminal, a wrong typed name. Resume is one at a time per run.

**A red goes to the HUMAN. Never "up a layer", and never talked green.**

---

## The verdicts

| verdict | meaning |
|---|---|
| **green** | every figure points at its source cell; sums are recomputed. |
| **softgreen** | the answer has the shape you described, checked mechanically. |
| **red** | a check said no; the gap feeds the next try (a strike). |
| **hitl** | no mechanical check; it goes to your ask. |
| **unparseable / crash** | the check could not judge. A casualty, never a strike. |
| **not-done** | the model itself said it did not do it. Halts. |

No model judges. Nothing fits? It becomes yours. "Probably fine" is not a verdict.

---

## The kid version

A kid builds a LEGO castle. Mom pays for the bricks and decides what goes on the shelf.
Mom does not change. (The picture above shows the house and the fridge note.)

- **The toy box.** First someone opens the box and *looks*. They can only look.
- **The plan.** A helper writes steps from your list. It never touches a brick.
- **Your list.** Beside each wish you write how you would know. Blank means you inspect it.
- **The signature.** Mom signs the plan. Change one line, she signs again.
- **The build.** The kid does one step at a time. It is never shown the ruler, or the money left.
- **The door.** At a marked spot the kid stops and waits. It costs nothing.
- **The shelf.** Nothing leaves the house until mom says yes.

The kid cannot see the ruler. If it knew the tower gets measured at 10cm, it would build 10cm and
still be wrong. So it hears "crooked", never "2mm off".

---

## Hard lines

- The agent writes steps. It never writes the trigger, the cap, an ask's place, its wait, the allow-list, or what "done" means. A human signs those, tighter only.
- Nothing leaves the machine without a signed place to go and your accept in the same run.
- Secrets come from the environment. Never the files, never the records.
- Unknown cost is never shown as 0. A pause costs nothing.
- Only a person signs.
- Code goes on a branch. Review, then release.

---

## How many rungs

`docs/wiki/the-module-ladder.md` holds **18 main modules (M0 to M17)** and the sub-rungs under them
(M0a, M0b, M4a to M4e, M4c-fix, M6a, M8b, M10b). Counts and every signed text are there; this table is only
the state. M6b was folded into M4e. A rung starts only when its scope, exit and negative are signed by hamr.
Latest release: **v0.34.0** (2026-11-15).

| rung | what | state |
|---|---|---|
| M0a, M0b, M0 | go/no-go: scout, drafter, run it, close it | released (0.1.0 to 0.3.0) |
| M1 | declaration, validator, hash | released (0.4.0) |
| M2 | the runner | released (0.5.0) |
| M3 | ask, park, resume, CLI | released (0.6.0) |
| M4 | the panel (parent of M4a to M4e) | released in parts |
| M4a | read-only panel | released (0.7.0) |
| M4b | answer doors, resume; the launcher (a bare `fwdloop` menu, start / stop / restart / status / install); all jobs in one folder | released (0.9.0); launcher in 0.25.0; one folder in 0.26.0 |
| M4c, M4c-fix | answers read clearly, stuck runs; the fix list | released (0.10.0, 0.11.0) |
| M4d | Settings | released (0.12.0 on); amendments through 0.32.0 (see the ladder and `CHANGELOG.md`) |
| M4e | Chat card: draft, sign, run | released (0.13.0, 0.14.0) |
| M5 | dry-run, accept, versions | closed, signed 2026-10-10 (Accept is sign; dry run waits for a real outside send) |
| M6a | authoring backend (draft, sign) | released (0.8.0) |
| M6 | edit a flow, add turns, Reuse | released (0.15.0); amendments through 0.25.0 |
| M7 | in-run tools (one run's memory) | released (0.17.0) |
| M8 | learnings (notes from earlier runs, handed to the drafter and to retries) | released (0.24.0); M8b, a tidy run folder, released (0.25.0) |
| M9 | triggers (clock, file watch) and the run summary | released (0.18.0, amendments through 0.21.0); inbox-poll and flow handover not built |
| M10 | real IO: read a web page, a sheet or a document, cited checks, code-forced asks (mail, chat, page actions not in this scope) | released (0.22.0); amendments through 0.32.0 |
| M10b | a sheet's checks are bareguard's | released (0.23.0); exit signed 2026-10-26 (0.26.0); a table check that fails on the input is refused at draft time (0.32.0) |
| M11 | one runs list (Running now, Needs you, Scheduled, Jobs) | released (0.19.0 on; Reopen on the Run tab in 0.24.0) |
| M12 | outside tools through MCP, and tickets that start a run | released (0.27.0) |
| M13 | one setup for outside sources | released (0.28.0); later amendments see the ladder |
| M14 | the carry memo (memory in one run) | released (0.29.0) |
| M15 | one friendly `.md` result for every job | released (0.29.0) |
| M16 | one check list (`~` `!` `$`), copied from bareloop v0.56.0 | released (0.33.0); exit signed 2026-11-14 |
| M17 | one check list for sheets and Tickets; an answer replaces its rule | released (0.34.0); exit: see the ladder |

---

## Pointers

| for | read |
|---|---|
| the contract | `docs/product/PRD.md` |
| what we learned | `docs/logs/FINDINGS.md` |
| the rungs | `docs/wiki/the-module-ladder.md` |
| how a step closes | `docs/wiki/how-a-step-closes.md` |
| the panel | `docs/product/PANEL-BUILD.md` |
| upstream asks | `docs/product/UPSTREAM-ASKS.md` |
| what shipped when | `CHANGELOG.md` |

The one place implementation names appear:

| layer or part | where it lives |
|---|---|
| the arbiter keys | `src/declaration.js` (`ARBITER_KEYS`), read by `src/flow.js` |
| the harness (steps, strikes, caps, halts, stop) | `src/runner.js` |
| the checks (green, softgreen, hitl) | `src/closers.js` |
| the one check list (rows, tags, Drop and Add, replace on answer) | `src/checkblock.js`, `src/blockassemble.js`, `src/blockdraft.js`, `src/planrebuild.js`; sheet rows `src/sheetbuild.js`; Tickets rows `src/ticketrows.js` |
| a sheet's checks (bareguard's), cited page quotes | `src/sheetchecks.js`, `src/sheetrun.js`, `src/sheetclaims.js`, `src/sheetoffer.js` (what the drafter is offered), `src/sheetblock.js` (what a sheet job line shows); `src/citedcheck.js` (the cited check), `src/cited-record.js`, `src/pagebits.js` |
| thinking per try | `src/thinking.js`, `src/model-step.js` |
| the description (drafter, catalogue) | `src/drafter.js`, `src/catalogue.js` |
| the signature, sign at a terminal | `src/signature.js`, `src/authoring.js`, `src/sign-confirm.js` |
| the ask | `src/ask.js` |
| learnings (the notes and hint text; the ledger and run-end reader/writer) | `src/learn.js`, `src/learnstore.js` |
| send | `src/send.js` |
| money books, monthly limit | `src/books.js`, `src/monthly.js` |
| stuck and running | `src/liveness.js`, `src/panel/data.js` |
| the screen | `src/panel/` |
| the model loop, thinking support | `bare-agent` |
| the gate, the cells and rubric checks | `bareguard` (a dependency, never copied) |
