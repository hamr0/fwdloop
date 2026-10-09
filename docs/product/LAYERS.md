# fwdloop — the layer map (plain language)

> What this page is: one short map of the flow, the layers, and what happens when things go wrong.
> Rewritten 2026-10-08; shape borrowed from bareloop docs/product/LAYERS.md (origin/main, c57d199 + 1b8115c).
> The PRD is the contract; this is the map. Status diaries live in the PRD and `docs/logs/FINDINGS.md`, not here.
> Jump to: **harness vs arbiter** (in "The shell") · **how many rungs** (near the end).

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
  │  describe the job: numbered lines, "how I'd know" beside each (or blank)
  ▼
SCOUT looks at the real files (read only) · DRAFTER writes steps, no tools,
each step names the one line of yours it serves
  │
  ▼
THE TABLE: your lines and the steps for them. You answer in plain words; redraft.
  │
  ▼
CHECKS at $0 before any money: files exist · no secret in the text ·
the monthly limit has room · every wanted tool is really built
  │
  ▼
YOU SIGN  (one hash covers the job, the cap, the asks, the allow-list; any edit = sign again)
  │
  ▼
THE RUN, one step at a time, fresh context each:
  step → "did it happen?" check → red? gap goes back, try again (2 strikes = stop)
  │
  ▼
ASK: the run stops at the line you marked. It PARKS (the process ends, nothing is spent).
  │  you answer in the panel or the CLI: accept · redo (with a reason) · rerun (with a reason)
  ▼
RESUME: another process picks up exactly there. An answer is used once.
  │
  ▼
ACCEPT → SEND: only to the signed folder, only the exact file you accepted (hash-checked)
  │
  ▼
ENDED:  passed · failed · stopped · expired
  passed           → the output is where you signed it to go
  failed           → read why; fix the job; sign again
  stopped / capped → Resume, once the cause is gone
  expired          → a person must reopen it
  │
  ▼
NEXT TIME: a trigger reruns the same signed job.  [PLANNED. Today you start it by hand.]
```

---

## The architecture: a shell and six layers

### The shell (not a layer)

The fixed frame around every step. The agent can never touch it. Two words you will meet:

**The harness** is the machine around the model. It runs steps one at a time, checks each one,
holds the money cap, and writes the records. *Example: the model says "I wrote the file"; the
harness looks, and the file is empty, so the step is red.*

**The arbiter** is the signed, typed block the agent never writes: the trigger, the cap, where
asks sit and how long they wait, the allow-list, the send target. *Example: the drafter may add
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
- **Survives:** books on disk: every try, its cost, its check. A red run keeps its log too.
- **Status:** built.

### Layer 4 — the ask

- **Built on:** a signed ask line, which is a pure stop.
- **Does:** parks the run, spends nothing, waits. The answer is used once. A redo or rerun needs a reason. The ask has a signed time limit.
- **Survives:** across processes. Resume can be a different process.
- **Status:** built.

### Layer 5 — the screen

- **Built on:** a local panel (Runs, Ask, Inbox, Job, Settings, Chat).
- **Does:** describe, sign, run, answer, Stop, Resume, set keys and limits, all in a browser, and it works on a phone.
- **Survives:** nothing of its own; it reads the books. It is a client of the arbiter, never a second arbiter.
- **Status:** built.

### Layer 6 and on — versions, dry-run, skills, triggers, real mail

- **Does:** edit with re-accept and rollback; dry-run; skills and persona; case library; triggers; real IO.
- **Status:** planned, in order, on the ladder below. Next is M5.

### Who keeps what

| thing | kept by | changed by |
|---|---|---|
| steps | the drafter | you, by redraft |
| trigger, cap, asks, TTL, allow-list, send target | the arbiter (signed) | you, tighter only |
| "did it happen" | the harness | nobody mid-run |
| money spent | the books | nobody; unknown stays unknown |
| the answer to an ask | you | once |
| the monthly limit | Settings | you, up or down |

**One rule: the machine may not author, loosen, or hide any of it.**

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

There are **20 rungs** on `docs/wiki/the-module-ladder.md`: 11 main modules (M0 to M10) and 9
sub-rungs (M0a, M0b, M4a, M4b, M4c, M4c-fix, M4d, M4e, M6a). Counted with grep on its headings.
M6b was folded into M4e. A rung starts only when its scope, exit and negative are signed by hamr.

| rung | what | state |
|---|---|---|
| M0a, M0b | go/no-go: scout, drafter, run it, close it | released (0.1.0 to 0.3.0) |
| M0 | the go/no-go as a whole | released |
| M1 | declaration, validator, hash | released (0.4.0) |
| M2 | the runner | released (0.5.0) |
| M3 | ask, park, resume, CLI | released (0.6.0) |
| M4 | the panel (parent of M4a to M4e) | released in parts |
| M4a | read-only panel | released (0.7.0) |
| M4b | answer doors, resume | released (0.9.0) |
| M4c | answers read clearly, stuck runs | released (0.10.0) |
| M4c-fix | the fix list, cleared | released (0.11.0) |
| M4d | Settings | released (0.12.0) |
| M4e | Chat card: draft, sign, run | released (0.13.0); later amendments built, not yet released |
| M6a | authoring backend (draft, sign) | released (0.8.0) |
| **M5** | **dry-run, accept, versions** | **next** |
| M6 | edit a flow, add turns | planned (the authoring screen is done; edit waits on M5) |
| M7 | skills and persona | planned |
| M8 | case library | planned |
| M9 | triggers, flow handover | planned |
| M10 | real IO (mail, chat, browse) | planned |

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
| the description (drafter, catalogue) | `src/drafter.js`, `src/catalogue.js` |
| the signature, sign at a terminal | `src/signature.js`, `src/authoring.js`, `src/sign-confirm.js` |
| the ask | `src/ask.js` |
| send | `src/send.js` |
| money books, monthly limit | `src/books.js`, `src/monthly.js` |
| stuck and running | `src/liveness.js`, `src/panel/data.js` |
| the screen | `src/panel/` |
| the model loop, the gate | `bare-agent`, `bareguard` |
