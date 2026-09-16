---
type: reference
title: "Playbook and open questions"
status: draft
sources: [docs/archive/PRD.md]
---

# Playbook and open questions

Which playbook rules bind how we build fwdloop versus every flow it produces, and the questions
left open that do not block M0. Identity and claims live in `PRD.md`; close mechanics in
`how-a-step-closes.md`; module order in `the-module-ladder.md`.

## The playbook, split by target

Each rule binds either **how we build fwdloop** or **every flow fwdloop produces**
(docs/archive/PRD.md:622-625).

**Binds us (construction)** (docs/archive/PRD.md:627-633):

| rule | what it means here | lands |
|---|---|---|
| P2 — numbers before the module | a pass/fail with no pre-registered number cannot be tracked | every module |
| P10 — model chosen last, by the suite | no module selects or tunes a provider | done |
| P5 — prompts as code | `src/prompts/` hashed, `promptVersion` in every audit row | M2 |

**Binds the product (every generated flow)** (docs/archive/PRD.md:635-645):

| rule | becomes | lands |
|---|---|---|
| P1 — living case library | `cases/<id>/` per flow, owned and tagged | M7 |
| P3 — behavioural audit columns | `toolCalls`, `reads`, `rounds`, `retries`, `duplicateReads` | M2 |
| P4 — freshness at `gather` | stale input is a red, not a confident hallucination downstream | M2 |
| P6 — model change = maintenance | provider and model are signed fields; changing them needs re-accept | M4 + M7 |
| P7 — data residency | a `local-only` guardrail restricts the provider factory | M6 |
| P8 — incident loop | detect → diagnose → contain → extend cases | M7 |
| P9 — rollback | `accept --version <hash>` re-activates the last accepted flow | M4 |

**Where we deliberately do the opposite of the talk:** the human sits where the human **placed** the
ask, never where a confidence number falls — confidence is unmeasured, uncalibrated and gameable,
while a position is signed and immovable. And groundedness is checked by **resolving pointers**, not
by asking a second model (docs/archive/PRD.md:647-651).

## Open questions

None of these block M0 (docs/archive/PRD.md:654-654).

1. **Does the drafter need more than one shot?** RESOLVED 2026-09-09: yes, and that is the
   multi-turn — draft-time negotiation over the table until the human agrees, then sign. Run time
   stays one shot per step (docs/archive/PRD.md:655-657).
2. **Does a typed artifact carry enough between steps?** If a step needs something the previous
   step's artifact did not capture, the schema is too narrow — a spec change, not a wiring layer.
   M0a answers it (docs/archive/PRD.md:658-660).
3. **Is the step-kind menu still needed** once steps name primitives, or does the primitive imply
   the kind? M0a will show (docs/archive/PRD.md:661-662).
4. **Human cost to beat:** SIGNED 2026-09-09 as a stated assumption, not a measurement — 15 minutes
   of a bookkeeper at $50/h = **$12.50/day**. If a real number arrives it replaces this
   (docs/archive/PRD.md:663-666).
5. **Memory across runs** (litectx as the store, facts superseded by id) — not in any module yet
   (docs/archive/PRD.md:667-667).
6. **What does a flow directory look like on disk?** Deferred to M1
   (docs/archive/PRD.md:668-668).

### 7. Pinning a proven step — recorded, not a module

After a flow works, can its probabilistic part be frozen into deterministic code to stop spending
tokens on it (docs/archive/PRD.md:669-672)?

**It does not contradict "wiring ages, closes don't"** — that argument is about building wiring *up
front*, guessing what the model cannot do. This is the opposite: recording what the model already
did, N times, with the close still watching (docs/archive/PRD.md:674-677).

*The mechanism already exists.* A green step's citation **is** a program — it says exactly where the
number came from — and the arithmetic is already ours, so the only thing a model does in a green
step is **extraction**. Freeze the extraction and the step costs $0
(docs/archive/PRD.md:679-682).

*The catch:* a citation records `row: 2`, and tomorrow the row moves. Pinning requires promoting a
citation to a **rule** — not "row 2" but "the row where Customer = the matched name" — and
generalising from one run is where it gets dangerous. From twenty, much less so
(docs/archive/PRD.md:684-687).

*Why freezing stays safe:* you lose adaptability, never safety. A wrong frozen selector goes **red on
the same close** a model would have; red → unpin → the model takes over
(docs/archive/PRD.md:689-691).

*The shape:* a step whose citations resolve to the same shape across N greens becomes a **pin
candidate**; pinning is an **edit**, so it takes a new hash and a human re-accept, and a pinned step
is judged identically to a modelled one (docs/archive/PRD.md:693-697).

*When to build it — a number, not a feeling:* job #1 costs $0.003–0.006 per run against a $12.50/day
human, so pinning saves a rounding error today. The trigger is a measurement showing token cost is
blocking a greenlight, never a hunch (docs/archive/PRD.md:699-701).

### 8. If a judge ever arrives, borrow these four

Offered by the bareloop session and recorded so it is not re-derived. **Not scope** — v1 rules no
judge (docs/archive/PRD.md:702-706).

1. **Locate vs decide.** The model never says pass/fail; it extracts facts and quotes, and a
   deterministic `decide()` renders the verdict, with unsure = red. This is what stops a
   probabilistic judge becoming the arbiter, and it is the same split our citation close already
   uses (docs/archive/PRD.md:707-711).
2. **Three readings never mixed.** A *graded case* compares verdict **and** itemized reds as sets —
   a pipe that reds the right case for the wrong reason was lucky, not calibrated. An *injection
   style* resists only when it moved neither the located list nor a single fact. A *casualty* is **no
   evidence in either direction** and stops the gate on its own axis — the same shape as "unknown
   cost is never 0" (docs/archive/PRD.md:712-718).
3. **The gate reports and never signs.** It picks no number; a separate step turns a failed
   calibration into a refusal (docs/archive/PRD.md:719-720).
4. **An absent judge seam is a wiring gap that stops the gate, never a silent skip**
   (docs/archive/PRD.md:721-721).

*Already taken from this, ahead of any judge:* the judge-model-inside-the-hash mechanism — provider
and model sit inside the signature, so a bump forces re-acceptance by construction rather than by
policy (docs/archive/PRD.md:723-725). *Sizing, if ever needed:* locate+decide ran ~$0.002–0.004 per
call, with malformed JSON roughly 1 in 6, mitigated by one retry and **never JSON repair**
(docs/archive/PRD.md:727-728).

### 9. Where are a flow's inputs pinned? — RESOLVED and SIGNED

A live draft's step read `fixtures/message.txt` straight through its `read` primitive with no step
emitting it as an artifact, so the walkable-chain validator could not see it
(docs/archive/PRD.md:730-733). bareloop's answer: steps declare no reads at all — inputs are
implicit and the whole tree is pinned by the **git seed** the run starts from
(docs/archive/PRD.md:734-737).

fwdloop has no git. **Signed by hamr 2026-09-11:** a **frozen copy plus sha256**, borrowing
bareloop's *source and destination proven at job start, mechanically, $0*. Before any tokens, each
signed input source is read, its bytes copied into the run's own folder and its sha256 recorded, and
the destination proven writable; anything that fails refuses **by name**. Every step reads the
frozen copy, so the run and its close judge the same bytes (docs/archive/PRD.md:741-748).

*Why not hidden git:* its extra powers — diff, undo, resume — serve runs that **edit** files.
bareloop edits code; job #1 reads two inputs and writes one reply, and `gather()` already hashes
each input, so the copy is the only new part (docs/archive/PRD.md:748-752). Re-confirmed after
weighing all four powers: *resume*, which fwdloop needs more than bareloop because humans pause runs,
restarts from the frozen inputs plus the step artifacts already on disk, not from a half-edited tree
(docs/archive/PRD.md:748-752). **Switch to hidden git when** a fwdloop flow edits a file and then
checks the edit, or bareloop's hidden git ships and one mechanism across both repos is wanted
(docs/archive/PRD.md:748-752).

### 10. Where do a job's *sources* live in the signed text? — OPEN, raised by hamr 2026-09-15

Raised while writing job #2's prose cold ("a resume in, and jd to compare against — not sure how
to have two sources"). Today the two are asymmetric: the **destination** is signed inside the prose
(`send at line 5 to file:poc/m0/out`, arbiter block), while **sources** are handed to the run at
launch (`--resume`, `--jd` for job #2; the sheet and message paths for job #1) and only then frozen
and hashed (§9). The prose names sources by role ("my resume", "the JD"), never by path — that part
holds Claim 2 (the human never names a primitive, and a path is close to one).

Two shapes on the table, hamr's to sign:

1. **Sources join the arbiter block as typed lines** — e.g. `source resume = <file>` / `source jd =
   <file>`, human-signed, next to `send at … to …`. One block then holds everything a human pins:
   cap, ask, destination, inputs. The drafter still sees roles only. (Orchestrator's recommendation:
   it makes the signed block the full picture and removes the launch-time flags as a second writer.)
2. **Sources stay outside the prose**, attached at intake like a mail attachment or a trigger's
   payload (M8). Simpler prose; the signed block no longer shows the full picture.

A live URL as a source (the JD came from a job board) is M9 real IO behind the allow-list either way;
until then the JD is a fetched, hashed markdown file. Not decided; job #2 runs with launch flags.
