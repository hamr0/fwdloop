---
type: reference
title: "The module ladder — M0 through M10"
status: draft
sources: [docs/archive/PRD.md]
---

# The module ladder

The modules in order, each with its scope, exit criteria and negative scenarios. Identity and
claims live in `PRD.md`; close mechanics in `how-a-step-closes.md`.

## The rule that binds this section

A module does not start until its **scope, exit and negative scenario** are written down and
signed. Modules run in order; never start N+1 while N is unproven. Every POC result updates the
PRD — a result that flips a claim is a spec change, not a footnote. A module works on its own,
then connects to what is built, before the next starts. **Never ship the POC**
(docs/archive/PRD.md:483-488). This is the fix for v0.5's drift (docs/archive/PRD.md:483-483).

## M0 — go/no-go, both claims

Two POCs, ordered: **M0a must pass before M0b starts** (docs/archive/PRD.md:493-493).

### M0a — scout, primitive selection, walkable chain

**SIGNED by hamr, 2026-09-12.** Exit met on DeepSeek-V4.1-Flash (`deepseek-flash`); branch `m0a`
review-clean (9/9 findings fixed, each with a test proven to fail without its fix; security
review clean). Signing M0a proves Claim 2's first half only — it does not close go/no-go.

A bounded read-only scout looks at the fixtures first, its menu stripped of write and store
primitives by construction. The drafter then gets job #1 as prose plus guardrails, the scout's
facts, and the primitive catalogue, and emits steps carrying a **granted primitive list** and the
**artifact ids each step reads** — authoring no bodies and no plumbing. Steps share one artifact
space, fwdloop's stand-in for bareloop's tree. A deterministic validator proves the chain is
walkable (docs/archive/PRD.md:495-506).

- **Exit:** the chain is walkable end to end on the baseline model, and the validator names both
  primitives when it is not. **The scout's facts appear in the draft** — a column name in the
  declaration matches the fixture and was not invented (docs/archive/PRD.md:507-509).
- **Negative scenarios**, each of which must be able to fail (docs/archive/PRD.md:510-523):
  (i) reading an artifact no earlier step declared is a red naming step and artifact;
  (ii) a job line with no groundable check is refused at draft, never given a proxy check;
  (iii) a primitive not in the catalogue is a red, **never invented**;
  (iv) a primitive outside the signed skillset is a red even though it exists;
  (v) the scout attempting a write-class primitive is **impossible, not merely refused** — the verb
  is absent from its menu and a test proves the filtering;
  (vi) the **uncovered-line plant** — a prose line no guardrail covers must land at `hitl`, never at
  a green or an invented softgreen shape.
- **Kills the module:** the catalogue cannot express job #1 without a new primitive → upstream ask,
  and M0 stops until it is delivered (docs/archive/PRD.md:524-525).

**What M0 is actually asking:** *a job → its close → can the LLM form one → citations.* Primitive
selection is in M0a because a close cannot be formed without knowing what the step does; it is the
means, never the point. If a measurement forces a choice, **close formation wins**
(docs/archive/PRD.md:527-530).

### M0b — run it, close it

Execute M0a's declaration against job #1 using **only** baresuite primitives. Every step closes
under its declared class — green on the `derive` steps, softgreen on `compose`, hitl at the signed
`ask` — plus the mechanical *happened* check on all of them (docs/archive/PRD.md:532-536).

- **Exit:** the four plants reproduce on primitives — a wrong derived total reds naming the figure
  and formula; a wrong copied cell reds naming the cell; an ambiguous customer lands at an `ask` and
  never a pick; a clean run goes green through `send`. False reds 0. Both providers
  (docs/archive/PRD.md:537-541).
- **Negatives:** (i) a plant F5 caught on bespoke code must still red on primitives — one that goes
  green is the headline finding and a spec change; (ii) the **green-by-omission plant (F7)** — a
  reply missing the total and due date must red on the softgreen shape check; (iii) a step whose
  class is not declared is refused at validation, because the machine never picks a class
  (docs/archive/PRD.md:542-548).
- **Inputs:** both fixtures are frozen and hashed at job start and every step reads the frozen copy.
  An unreadable source or unwritable destination refuses by name, at $0, before any model call
  (docs/archive/PRD.md:550-552).

Numbers before firing: plants caught N/N, false reds 0/N, $ per run against the human cost, wall per
run, under a **$5 total** cap (docs/archive/PRD.md:554-555).

### AMENDMENT to M0b — SIGNED by hamr, 2026-09-12

In force. It does not change M0b's exit above; A, B and C add to it.

**A. The redo edge at an `ask`.** Today an `ask` has two outcomes: the human accepts and the run
moves on, or the run stops. This adds a third: the human **rejects**, and the run re-executes the
step the `ask` sits behind. Bound by three things the drafter cannot express or alter:

- **Cap: 3 redos per `ask`.** The 4th rejection halts the run and names the step. Human-signed,
  tighten-only, and inexpressible to the drafter — same class as the spend cap.
- **Reason required.** A rejection with no reason is refused at the `ask`; the run does not
  advance and does not redo. The reason is rubric-shaped free text ("this was wrong, should be
  more X") and is carried into the redo as an input to that step, so attempt N+1 differs from
  attempt N by something a human wrote.
- **Every attempt is recorded.** Each attempt's artifact, its rejection reason, and its cost land
  in `audit.jsonl`. A redo is not a retry that overwrites; it is a new attempt with a parent.

Rationale: without the reason, a redo re-runs the same step on the same inputs and burns the cap
producing the same artifact. The reason is the only thing that makes attempt 2 a different step.

**B. Job #2 — the resume/JD job, described cold by hamr.** Job #1 (AR-aging) remains M0b's exit,
unchanged. Job #2 is an **additional** run after M0b's exit is met, and is the first job whose
prose was written by hamr rather than by us. It is the only evidence Claim 2 has that is not in
our own words.

- Inputs, frozen and hashed at job start:
  `/home/hamr/Documents/resumes/Amr Hassan - Resume.docx`
  (sha256 3d6b24a881e5600e1dc2910cdcb11ce6e65c4f6d46c2238d74b4c7a7f7c5beab)
  `/home/hamr/Documents/resumes/jd-anthropic-applied-ai-architect.md`
  (sha256 7eaea1c00e8b7487f0ea5d910b33acd2fd32d354817bef80ec026b4b1fc12c00)
- Shape: read the resume; read the JD; write a summary under 600 words in three sections
  (story of experience / technical skills / soft skills), compared against the JD; `ask` — hamr
  accepts or rejects with a reason; on accept, write the summary to a document.
- Why it earns its place: it closes on **two** classes in one job — "under 600 words, three
  sections present" is a mechanical `softgreen` shape, and "is it any good" is a `hitl` — and it
  is the only job that exercises the redo edge in A.
- New code it requires: a `.docx` text reader. A `.docx` is a zip of XML; file-format knowledge
  is ours to write, not an upstream ask (F13). It is in M0b's scope only as an input reader and
  carries no stability promise.

**C. Stability numbers.** M0b's exit says "both providers" without a count. This sets one: **20
runs per scenario per provider, both on the same day**, bar declared before the runs at **19/20**.
Same-day/two-model separates "the shape works" from "we fitted to DeepSeek's habits"; it does not
detect a model changing under us, which the request-vs-served stamp (F22) covers instead.

**A and B built and probed, 2026-09-15** (branch `job2`): the redo edge (`redo.mjs`) and job #2's
own fold (docx reader, declared-shape close, drafter path) are live — one probe on example prose
(F29) and one counting run with hamr in the loop, reject → redraft → accept (F30). n=1 for the
human-in-the-loop step; Amendment C's 20-run bar was never signed for it. See F29/F30
(`docs/logs/FINDINGS.md`) for the evidence and the stale-answer fix the live run needed.

### RULINGS on M0b — by hamr, 2026-09-13

In force. Asked by the orchestrator after the first live M0b pass (F25); answers recorded verbatim in
meaning, nothing added.

1. **Negative (iii) reworded.** It clashed with the 2026-09-10 ruling that a step with no class falls
   to `hitl` (silence is safe, F16/F17). hamr kept that ruling. Negative (iii) now reads: **the
   machine never gives an undeclared step a `green` or `softgreen` close** — a step whose class is not
   declared derives `hitl`, and a declared class its own line does not derive is a red. It is no
   longer "refused at validation".
2. **Every accept in Amendment C's runs is a human accept.** Plants c and d stop at an `ask` in each
   of their 20 runs per provider — 80 accepts. hamr answers all of them by hand; no scripted answerer,
   in any batch. A rejected reply is recorded as its own count, never as a pass or a miss.

Noted, not ruled: negative (ii) says the F7 omission plant must red "on the softgreen shape check".
Live, it reds on `closeCompose`'s completeness check; no code checks a step's declared `close.shape`
(F25). The plant is caught; the named mechanism is not the one that catches it.

### RULING on M0b's exit reading — by hamr, 2026-09-15

In force. Asked after Amendment C's 240 counting runs (F28): the literal 19/20 counted a correct red on
a clean input against the cell.

3. **The sign-off logic is: if the LLM fails, the mechanical harness (the arbiter) catches it.** A run
   where the model slipped on a clean input and the close refused it is the harness doing exactly what
   M0b exists to prove — it counts as a catch, not a miss. What counts against a cell is a model
   failure that reached a send or an accept unrefused, or a close that refused a correct artifact.

Under that reading, F28's ten cells recount (catches folded in): deepseek a 20, b 20, e 20, c 20,
d 20 (the one preflight refusal was the harness refusing an operator double-start, nothing sent);
Qwen a 20, b 20, e 20, c 20 (the one human-rejected was the harness honouring an empty Enter as no),
d 20 (three omissions and a dangling bracket, all refused by the compose close). No cell holds a
model failure that got through, and no cell holds a close that refused a correct artifact — the
saved replies in each red run's `log.json` show what was refused.

**M0b EXIT SIGNED — hamr, 2026-09-15** ("m0b signed"). Evidence: F28 and its addendum; 240 counting
runs on deepseek-flash and Qwen3.8-27B, all 120 c/d accepts human; code at `958ee66`, branch m0b.

## M1 — declaration spec, validator, hash

The grammar M0 proved, written down and mutation-tested: primitive catalogue as data, arbiter
fields inexpressible to the drafter, **`ask` positions as declared slots the drafter fills, never
steps it may add or omit** (F10: both providers wobbled on exactly this), ReDoS-safe patterns, and a
hash that flips on any edit (docs/archive/PRD.md:557-562).

- **Exit:** a mutation suite where every single-field corruption is caught, and a drafter cannot
  express an arbiter field in any position (docs/archive/PRD.md:563-564).
- **Negative:** a declaration missing a required `ask` slot is a red, not an absence
  (docs/archive/PRD.md:565-565).

### M1 — scope, exit, negative — SIGNED by hamr 2026-09-21 ("sign m1, start poc")

In force. Proposed 2026-09-16, signed with §6 and §10. It restates the M1 paragraph above as the three
things the binding rule needs, using what M0 actually built. M1 writes the spec and the checks;
it runs nothing (M2) and asks nothing (M3).

**Scope.**

1. **One signed text, one typed arbiter block.** The human's job is `prose.txt` as today: numbered
   lines, a `guardrail:` under the lines that carry one (strict 1-for-1), and an arbiter block at
   the bottom. The arbiter block becomes a typed grammar, not free text the runner regexes:
   `cap $N per run`, `ask at line N` (with `ttl <duration>`, default 30m), `redo cap N` (1..3),
   `send at line N to <target>`, `skills <list>`, and — if §10 is signed as option 1 —
   `source <role> = <file>` per input. Every field is human-signed, tighten-only; each has exactly
   one parser and one writer. Unknown lines in the block are a red naming the line, never ignored.
2. **The drafter's half is a schema with no arbiter fields in it.** `declaration.json` carries
   steps (`goal, primitives, reads, emits, picks, fromLine, close`) plus `guardrailClasses`,
   `unjudgeable`, `refused`, `inputFacts` — the fields M0a/M0b already validate. It has no place for a cap, an
   ask, a TTL, a target, a source or a trigger: not "forbidden", absent from the schema, and the
   validator refuses any unknown key at any depth by name.
3. **`ask` positions are slots, not steps.** `ask at line N` in the arbiter block means: exactly
   one step must bind to line N and its close must be `hitl`. The drafter fills the slot; it
   cannot add a second ask, drop this one, or move it. (F10: both providers wobbled on exactly
   this when it was theirs to decide.)
4. **A hash that flips on any edit.** `signature.json` pins sha256 over the canonical bytes of
   `prose.txt` and `declaration.json`, plus who signed and when. The M2 runner will refuse a run
   whose files do not hash to the signature, naming the file. In M1 the check exists and is
   tested; nothing runs yet.
5. **Catalogue as data.** The primitive catalogue is a data file the validator reads, not code the
   drafter can reach. Skills gate the visible subset (M7 does persona; M1 only makes the
   catalogue a file).
6. **Patterns are literal or typed, never user regex.** No field in the signed text is
   interpreted as a regular expression; a guardrail is matched by its line number, a shape by its
   typed fields. ReDoS is impossible by construction, and a test proves no `new RegExp` is built
   from signed text.
7. **The flow directory** (§6, deferred here) — proposed shape, hamr to sign:

   ```
   flows/<flow-name>/
     prose.txt          the signed text: numbered lines + guardrails + arbiter block
     declaration.json   the drafter's half, validated
     signature.json     sha256 of both, signed-by, signed-at
     runs/<run-id>/     inputs/ (frozen + sha256), step artifacts, audit.jsonl,
                        log.json, result.json — exactly M0b's run dir, moved under the flow
   ```
   One flow, one directory, three signed files, N runs. `poc/m0/out/` becomes `runs/`.

8. **Carried in from M0, as fields not features:** a per-step round budget lives in the arbiter
   block (`round budget 120s`, F-era rule: a step that can exceed ~2 min is a spec bug, split at
   draft time); the compose prompt states its own outputs (F-era prompt gap) — a drafter-prompt
   change, tested at $0 like the fence.

**Not in M1:** running a declaration (M2), the inbox (M3), dry-run and versions (M5), any UI,
learning across runs.

**POC first — the riskiest assumption:** that slots kill the wobble. Twenty drafts of job #1's
prose on `deepseek-flash` under the slot grammar: every draft binds exactly the signed asks (one
at the signed line, `hitl`) or is refused by name. The bar is **20/20 — zero wobble — or the
grammar is wrong**, not the model. Under M0 the count differed between runs of the same prose.
Cost: about 20 × $0.004.

**Exit.**

- The mutation suite: for every field of `prose.txt`'s arbiter block and of `declaration.json`,
  each single-field corruption (removed, retyped, value swapped, unknown key added, moved to
  another depth) is caught by a red that names the field. Every corruption is a separate test
  that can fail; the count of fields equals the count of mutations, checked by the suite itself.
- The drafter cannot express an arbiter field in any position: a declaration carrying `cap`,
  `ask`, `ttl`, `send`, `source`, `trigger` or `skills` at top level, inside a step, or inside a
  close is refused naming the key and the path.
- Both job #1 and job #2 are expressed under the one grammar with **no per-job field** — the
  validator has no code path that knows which job it is reading.
- The slot POC above at 20/20.

**Negative scenarios**, each of which must be able to fail:

- (i) a declaration missing a required `ask` slot is a **red naming the slot**, never an absence;
- (ii) a declaration with an ask the arbiter block did not sign is a red naming the extra step;
- (iii) a one-byte edit to `prose.txt` or `declaration.json` after signing flips the hash and the
  check reds naming the file;
- (iv) an arbiter-block line the grammar does not know is a red naming the line, not skipped;
- (v) a signed text containing regex metacharacters is matched literally — a test plants
  `(a+)+$` in a guardrail and proves no regex is compiled from it.

**Kills the module:** job #1 or job #2 cannot be expressed without a per-job field, or the slot
POC lands below 20/20 and the fix on the table is prompt wording rather than grammar.

**§6 and §10 SIGNED by hamr 2026-09-21** ("agree on both"): the directory in item 7, and sources
as typed arbiter lines, one per line (`guardrail: source <role> = file:<path>`), option 1. The
scope, exit and negative above were signed the same day. POC (the slot grammar, 20/20) starts on
branch `m1`.

**M1 spend cap: $5.00 — SIGNED by hamr 2026-09-21** ("cap $5, go"). M1's own, separate from M0's
$5.00; the POC's $0.18 (F31) ran under M0's cap before this was signed and is not re-charged.
**POC bar met** (F31: slot 20/20, control 0/20); build started the same day.

**M1 amendment 1 — input facts, not columns — SIGNED by hamr 2026-09-21** ("i think form should be
flexible", then "1"). Scope item 2 above lists `columns` among a step's fields, and M0's declaration
carried a top-level `realColumns`. Both are spreadsheet-only; job #2 carried them empty, which is a
per-job field by another name and would have failed the exit. They are replaced, not kept beside:
`inputFacts` (top level, one list per signed `source` role — column names for a sheet, headings for
a doc; harness-supplied, never the model's) and `picks` (per step, per role). The listing rule is
unchanged in spirit and stricter in one place: a pick whose role has no listing is a red, where M0
skipped the check. `columns` and `realColumns` are now unknown keys and are refused by name. Built in
piece 3 (f918dfe). Item 2's wording above is left as signed; this paragraph is what is in force.

**M1 amendment 2 — the signature pins who and when — SIGNED by hamr 2026-09-21** ("1"). Scope item 4
says `signature.json` carries "who signed and when"; piece 5 found those two fields were in no hash,
so a name or date edited after signing stayed green. They are folded into the flow hash, and an edit
to either is a red naming `signature.json`.

**M1 amendment 3 — the ask is a mark on its own line — SIGNED by hamr 2026-09-21** ("sign amendment
3"). Proposed the same day after hamr chose the direction ("use the ask"); the seven items below are
the signed text. hamr's bound on it: good to this point, no deeper until the design step for the
other parts — what an ask shows and which answers it takes stays as M0b Amendment A signed it and is
M3's to build, not M1's. Why: `ask at line N` points at a
line by number from the bottom block, so inserting a line by hand silently moves the stop to the wrong
step and the text still signs (the same drift a UI with separate step and guardrail lists would have);
and F34 showed a stop signed on a line that also carries work leaves the drafter no honest binding.

1. A numbered line that starts with `ask:` is a stop: `5. ask: check it with me,`. With a wait time:
   `5. ask 30m: check it with me,` (`<int>` then `s`, `m` or `h`; default 30m, as today). Since M6a amendment 1, `draft`/`sign` refuse a bare `ask:`: the wait must be signed (`ask 30m:`); the 30m default applies only to flows signed before it).
2. The words after the mark are required and are the human's own; they are what the ask shows.
3. A marked line may carry its own `guardrail:` under it, free wording, strict 1-for-1 as any line.
4. A marked line is only the stop: exactly one step binds to it, human-checked, granting no
   primitive. Work drafted onto it is a red naming the line; the human splits the line. The parser
   does not read the sentence to decide this — the declaration check does, as today.
5. `guardrail: ask at line N` in the arbiter block is no longer grammar: it is a red naming the line
   and saying to mark the line instead. Both forms never coexist. (`src/signed-text.js` has never
   been on `main`, so no signed flow exists under the old form.)
6. Unchanged: the drafter cannot add, drop or move a stop; `checkpoint` stays off its menu; the mark
   is inside `prose.txt`, so the signature pins it. `send at line N to <target>` stays in the arbiter
   block and still points by number; the existing rule that a send needs an earlier ask stays.
7. A UI maps one row per step to this one for one: step box is the numbered line, guardrail box is
   the `guardrail:` under it, the ticked "stop and wait for me" box is the `ask:` mark.

Cost if signed: one $0 build pass (parser, its mutation suite, both jobs' fixtures), and one small
paid re-measure of the slot bar under the marked prose, because F31 to F34 were measured with the
bottom-block form in front of the model.

**Amendment 3 — built (2026-09-21), and its cost line was right after all (2026-09-22).** Built in
f61d05e (the mark) and 4deca9c (item 4: the step on a marked line grants no primitive — a hole that
predated the mark and let a `read` step on the ask line validate green). A note here (2e4d4b9)
claimed no paid re-measure was needed because the drafter never sees the mark; the debrief showed
that note rested on `parseSignedText`, which the paid batches never call, and that the batch checker
in `poc/m1/slots.mjs` never had item 4 at all. Both fixed in 27647e6 and re-measured on
deepseek-flash: job #1 with the mark on line 5, 20/20; two asks on their own lines, 20/20, every
read step bound to its line, no `fromLine: null`. F35 has the rows. What M2 must keep: the model
sees the numbered line text as written, mark included, plus the slots sentence — that is the prompt
the numbers are for.

**Ruled 2026-09-23 (hamr):** `close.shape` has a signed v1 vocabulary — `maxWords`, `sections`,
`linesPerInvoice`, `mustCarry` — enforced in `src/declaration.js` (`SHAPE_KEYS`). An unknown key
inside a shape is red by name, and the exit's "unknown key added" mutation covers that position.
Lands in the release after v0.4.0 (see CHANGELOG Unreleased).

## M2 — runner

A fold over steps with fresh context per step (artifacts, never transcripts), an effect check per
step, close by declared class, the ralph loop, `audit.jsonl` plus `history.jsonl`, money honesty and
the provider-red ladder (docs/archive/PRD.md:567-571).

**Load-bearing invariant:** the step executor is constructed **without its close and without the
cap** — goal in, gap back — and a test must prove the close is not reachable from the executor's
context (docs/archive/PRD.md:572-573).

- **Exit:** an arbitrary valid declaration runs, not job #1's shape hand-wired — v0.5's M0 could not
  do this, and that is logged as its scope limit (docs/archive/PRD.md:574-575).
- **Negative:** a step whose effect check fails halts the run and names the step
  (docs/archive/PRD.md:576-576).

### M2 — scope, exit, negative — SIGNED by hamr 2026-09-24 ("sign m2, cap $5")

Restates the M2 paragraph above as the three things the binding rule needs, using what M1 built.
Three design picks were made in the interview of 2026-09-24 (hamr: "1A, 2A 3A") and are folded in
below; scope, exit, negative and the cap were signed together on 2026-09-24.

**Scope.**

1. **One fold, no job code.** `src/runner.js` reads a flow directory through M1's `readFlow`
   (three signed files, hash verified, refusing by file name) and folds over `declaration.steps`
   in order. It has no code path that knows job #1 from job #2. What M0's `poc/m0/runner.mjs`
   proved (freeze inputs with sha256, bind steps by line, check grants by what is granted, the
   fresh-run-dir refusal, `shell_read`/`shell_write` through the catalogue, the write-time send
   re-check) is borrowed by copy into `src/`, never imported from `poc/`. The POC is never shipped.
2. **Fresh context per step.** A step's executor is constructed with its **goal**, its granted
   primitives from the catalogue, the artifacts it `reads` (by id, from the run's artifact
   space), and nothing else. No transcript crosses a step boundary. The step emits **one typed
   artifact** under its `emits` id; the next step reads it by id. (bareloop F18: a carried
   transcript is re-bought every round; F21: a never-green run needs an explicit channel.)
3. **Goal in, gap back — the load-bearing invariant, as a mechanism.** The executor is built
   **without its close and without the cap**: the object handed to the model step has no field,
   closure or import through which the close function, the shape, the cap or the strike count
   can be reached. A construction test proves it at $0: the executor's context is serialised and
   searched for every close/cap identifier, and the close function is not callable from it. Only
   the **gap text** (the red string, at most one sentence per failed check) goes back to the next
   attempt. A softgreen shape that cannot be split from its goal is **hitl**, not softgreen.
4. **Close by declared class, one closer per class.** `green`: the citation check (every stated
   figure resolves to a cell or formula in a frozen input — M0's `closeDerive`, borrowed).
   `softgreen`: the signed shape, one checker per `SHAPE_KEYS` entry (`maxWords`, `sections`,
   `linesPerInvoice`, `mustCarry`) and nothing else; an unknown key cannot reach the runner
   because M1 refuses it. `hitl`: the ask (item 6). Every closer names its third outcomes (crash,
   unparseable, unpriced) besides green/red; a closer that renders no judgment is a **casualty,
   never a red** (bareloop F17).
5. **The ralph loop with strikes, borrowed whole.** `while close-red and under-cap: run the step
   again`, stop at first green. A **strike** is a red attempt that either repeats a gap already
   seen this step (normalised gap hash, a seen-set, never last-only) or wrote no artifact.
   Strikes stick; **`STRIKE_LIMIT = 2`** is a constant the runner owns — not in the arbiter
   block, not in the declaration, so nothing can raise it (hamr 2026-09-24, "2A"; bareloop
   `src/ladder.js@cfa5447`). Striking out halts the run naming the step and its last gap. The
   per-attempt bound is structural, constructed per attempt, never run-wide (bareloop F20). Never:
   rewriting a step, re-picking a primitive, re-drafting the flow.
6. **The ask, M0's file checkpoint, in-process** (hamr 2026-09-24, "3A"). A hitl step writes
   `ask.json` (question plus evidence) into the run dir and waits for `answer.json`
   (`accept` / `reject "<reason>"` / `rerun "<reason>"`), consumed exactly once; a rerun without
   a reason is refused and re-asked; a stale answer arriving mid-redraft is quarantined. The
   signed `redo cap` (default 3) governs; the 4th rejection halts naming the step. A pause spends
   nothing. Cross-process inbox, TTL and resume are **M3**, not here.
7. **Money honesty, per attempt.** Cost is `number | null`, never `?? 0`; a null or an unpriced
   round halts `pricing-red`; an unknown model prices at the rate table's ceiling with the row
   stamped `substituted`. `cap $ per run` binds **between attempts** and may overshoot by at most
   one attempt; an attempt is funded together with its close (bareloop F45) or is not started. A
   cut mid-attempt prices at ceiling and is a casualty, not evidence. `spendComplete: false` on
   any row makes the run's total a **floor**. Every row carries `modelMatch`.
8. **Provider-red, rungs 1 to 3 only.** Transport faults (`ECONNRESET`, `ETIMEDOUT`, `fetch
   failed`, TLS) get exactly **one** immediate retry on the same attempt; an HTTP status is not
   transport; a wall-clock timeout (`round budget`, default 120s) is never retried. A second
   failure parks the run `provider-red` with `spendComplete: false`. The trigger's +5/+15/+45
   retries are the trigger's (a later module); M2 has no trigger.
9. **Two books, append-only, one writer each.** `runs/<run-id>/audit.jsonl`: one row per attempt
   `{ step, attempt, class, verdict, gap, usd, spendComplete, wallMs, model, modelMatch, strike }`
   plus one row per ask and per send. `flows/<name>/history.jsonl`: one row per run `{ runId, at,
   outcome, spentUsd, spendComplete, capUsd, wallMs, signatureHash }`. Both written by the runner
   through one function each; nothing else appends. `log.json` (what the model wrote, every
   attempt, red runs included) stays, as M0 ruled.
10. **Every step has a mechanical happened check** before its close: the emitted artifact exists
    and is non-empty, for every class, no exception. A 0-byte write is a red naming the step
    (bareloop F23).

**Not in M2:** the trigger and its retry ladder, `cap.monthlyUsd`, the cross-process inbox and
TTL (M3), dry-run/accept/versions (M5), any UI, learning across runs, an LLM judge.

**POC first — the riskiest assumption** (hamr 2026-09-24, "1A"): **that a step which sees only
the gap can heal.** Take job #2's compose step (softgreen: `maxWords 600`, three named
`sections`). Plant a first attempt that must red (the goal handed in asks for four sections, or
the word ceiling is set to 300 for attempt 1 only). Attempt 2 gets the goal plus the gap text
("sections: expected 3, found 4") and nothing else. Twenty runs on `deepseek-flash`. The bar is
**18/20 green by attempt 3 (within `STRIKE_LIMIT`)** — below that, a gap-only channel does not
heal and the fence-plus-loop design is wrong, not the model. Alongside, at $0: the construction
test of item 3 must fail against a deliberately leaky executor (the close passed as a field) and
pass against the real one. Cost: about 20 × $0.015.

**Exit.**

- Both `test/fixtures` flows (job #1 and job #2) run end to end through `src/runner.js` with no
  per-job code path, on fake primitives and a fake ask at $0, and job #2 live on `deepseek-flash`
  reaching its ask with a green shape.
- The construction test of item 3 is in the suite and can fail (proven by the leaky executor).
- The POC bar above is met.
- `audit.jsonl` and `history.jsonl` exist for every run, red runs included, and every row prices
  (no null cost reaches a book).

**Negative scenarios**, each of which must be able to fail:

- (i) a step whose happened check fails (0-byte artifact) halts the run naming the step;
- (ii) a step that reds its close with the same gap twice strikes out at the second strike, and
  the run halts naming the step and the gap, under cap;
- (iii) a run whose next attempt cannot be funded under `cap $ per run` halts `cap-halt` before
  the attempt starts, never after;
- (iv) a flow whose files do not hash to `signature.json` is refused naming the file, at $0;
- (v) a transport fault twice on one attempt parks the run `provider-red` with
  `spendComplete: false`, and the ledger shows the floor, never 0;
- (vi) the executor's serialised context contains no close, shape, cap or strike identifier —
  and the same test goes red when the close is smuggled in as a field.

**Kills the module:** the POC lands below 18/20 and the fix on the table is showing the step its
shape; or job #1 and job #2 cannot run through one fold without a per-job branch.

**M2 spend cap: $5.00 — SIGNED by hamr 2026-09-24** ("sign m2, cap $5"). M2's own, separate from
M1's $5.00 ($1.10 used). POC (gap-back healing, 18/20) starts on branch `m2`.
**POC bar RULED MET by hamr 2026-09-24** ("pass"). F38: batch a 6/20 healed (closer reported one
check at a time — the gap ping-ponged); batch b, closer reporting every failing check, 18/20 healed,
17/20 by attempt 3, the two fallbacks halted honestly naming the step and the gap. Ruled on the
2026-09-15 rule: a catch is a catch. $0.53 of the $5.00 cap. Build starts on `m2`.

**M2 amendment 1 — the step's own word, and evidence at the next ask — SIGNED by hamr 2026-09-24**
("sign both"). From F39 (first live run: the JD step was blocked, said so honestly, and passed).

1. **`done` and `blocker` on every artifact.** The `emit_artifact` schema for every close class carries
   `done: boolean` (required) and `blocker: string | null`. `done: false` is a **red naming the step and
   the blocker**, mechanically, before any close runs and for every class, hitl included. No judge:
   the model's own typed word that it did not do the step is the one statement the machine takes at
   face value. `done: true` proves nothing — the close still decides.
2. **Unjudged artifacts go to the next signed ask.** A hitl-class step that is not bound to a signed
   ask line does not pause; its artifact is carried as **evidence into the next signed ask**, labelled
   by step, alongside that ask's own artifact. The human's accept covers every artifact shown. A flow
   whose last steps after the final ask are hitl-class and unasked is a validation red at M1 (nothing
   may leave unseen), to be added to `validateDeclaration`.

Both are mechanisms, not prompt wording: a test proves `done: false` halts with the close never
called, and a test proves the ask's `evidence` lists every unasked hitl artifact since the previous
ask.

**M2 EXIT SIGNED — hamr, 2026-09-24** ("both", after the F41 live plant). Evidence below, plus F41: `done: false` fired from a live model on an empty JD and the run halted `not-done`, nothing sent; the two book bugs F41 found are fixed at `55c1629`. Runner at `a045b73` + F41 fixes.

| exit / negative | evidence |
|---|---|
| both fixtures through one fold, $0 | `test/runner.test.js` "job #1 fixture runs end to end" and "job #2 fixture runs end to end"; `src/runner.js` has no per-job branch |
| job #2 live on `deepseek-flash`, ask reached, shape green | F39 (run-1, $0.0118) and F40 (run-2, $0.0446): JD read by role, two rejects redrafted live, stale accept quarantined, sent |
| construction test can fail | `test/runner.test.js` "construction test … a leaky double is caught" |
| POC bar 18/20 | RULED MET above (F38 batch b) |
| both books every run, every row priced | `flows/job2-live-1/history.jsonl` has run-1 and run-2; 20 audit rows, no null `usd`, `spendComplete: true` |
| (i) 0-byte artifact halts naming the step | `test/runner.test.js` "negative (i)" |
| (ii) same gap twice strikes out | "negative (ii)" |
| (iii) cap-halt before the attempt | "negative (iii)" |
| (iv) tampered flow refused by name at $0 | "negative (iv)" plus `test/signature.test.js` |
| (v) transport fault twice parks provider-red, floor never 0 | "negative (v)" and the floor test after it |
| (vi) executor context carries no close/shape/cap/strike | same construction test as above |
| amendment 1 | three `done:false` tests, three `evidence.unjudged` tests; F40 shows `unjudgedCount: 2` on every live ask row |

Spend: $0.53 POC + $0.21 live (F39, F40, F41) = $0.74 of the $5.00 cap. Suite 1173/1173.

**M2 amendment 2 — `read`/`grep` serve text roles only — SIGNED by hamr 2026-09-24** ("both"). From F41
item 3: a step granted `read` pulled a .docx role's raw bytes into context, 12 rounds, $0.15. `read` and
`grep` list and accept only roles whose frozen input is text (`.md`, `.txt`); a `.docx` role is refused
by name pointing at `readDocx`, a `.csv` role at `addressCells`, any other extension "no text primitive
serves it". The refusal fires on the role name, not the schema alone. Mechanism, not wording; `readDocx`
and `addressCells` unchanged. Suite 1180/1180.

**F42 fix — the send ships the signed ask's artifact by identity, not `reads[0]` — found by
`/branch-review` 2026-09-24.** The runner picked the send's content as the first id in the step's
`reads` with an artifact on disk; every read names an earlier step, so that was always `reads[0]`.
Neither fixture's send happened to expose it (job #2's `reads[0]` holds the same text as the
accepted artifact). Fixed: the send ships the one artifact emitted by a signed ask step named in
its `reads`, **only if that ask was accepted this run**; zero or more than one such id halts red
naming the step and the ids, before `sendStep` is ever called. `validateDeclaration` now requires
**exactly one** earlier signed ask's `emits` in a send's `reads` (was: at least one). First tests
to enter the runner's send branch with a real `arbiter.sends` line. Suite 1185/1185.

## M3 — ask and inbox, the HITL window

The inbox and its answers, TTL, and checkpoint/resume at step level. A pause spends nothing, and a
resume never re-asks an answered question (docs/archive/PRD.md:578-581).

- **Exit:** a run pauses, a separate process answers, the run resumes into the next step
  (docs/archive/PRD.md:582-582).
- **Negative:** an expired TTL cancels; a rerun is a fresh engagement with its own counter
  (docs/archive/PRD.md:583-583).

### M3 — scope, exit, negative — SIGNED by hamr 2026-09-25 ("1 A, 2A. $2 budget approved, sign m3")

Restates the M3 paragraph above against what M2 built. Two design picks were made on 2026-09-25
(hamr: "1 A, 2A"): park-and-exit at the ask (item 2) and rerun as a fresh run (item 7). Scope, exit,
negative and the cap were signed together.

**What M2 left for M3, found by reading the code at `9c6b420`.**

- The ask lives inside the running process: `src/ask.js` polls `answer.json` every 500 ms and the
  process holds the run open the whole time. If the process dies, the run dies with it.
- **The signed TTL is parsed and never used.** `src/signed-text.js` turns `ask 30m:` into `ttlMs`,
  but `src/runner.js:791` calls `askStep` without it, so every ask waits `makeFileAskStep`'s own
  default (120 s) whatever the human signed. That breaks a hard line: an ask's TTL is signed by a
  human, and the machine must not replace it.
- `reject` and `rerun` do the same thing today (`src/runner.js:805`): both redo the step before the
  ask, under one `redo cap` counter.
- Parked from F42: `validateDeclaration` counts asks by prose line; the runner counts every step
  bound to an ask line. The two can disagree.
- There is no CLI. `package.json` has no `bin`.

**Scope.**

1. **The signed TTL governs.** Each ask's `ttlMs` comes from its own signed `ask <dur>:` line
   (default 30m, as M1 parses it). No code-side default overrides it. `ask.json` carries
   `askedAt` and `expiresAt`. A test proves a signed `ask 2s:` expires at 2 s and not at 120 s.
2. **Park and exit** (hamr 2026-09-25, "1A"). At a signed ask, the run writes `ask.json` plus a run-state
   file `state.json` (`{ runId, flow, signatureHash, inputsManifest, stepIndex, askId, expiresAt,
   spent, redone }`), appends an audit row `paused`, and the process **exits**. No process waits, so
   a pause spends nothing, not even a poll.
3. **A separate process answers.** `fwdloop inbox` lists open asks across `flows/*/runs/*`: id,
   flow, question, time left. An ask past `expiresAt` is shown as expired, never as open.
   `fwdloop answer <askId> accept | reject "<reason>" | rerun "<reason>"` writes `answer.json`
   **once**, stamped with `answeredAt` and the `askId`. It refuses a missing or blank reason, an
   unknown or expired `askId`, and a second answer to the same ask, each by name. An answer for
   ask A can never be consumed by ask B.
4. **Resume into the next step.** `fwdloop resume <runId>` (or `answer` starting it right after it
   writes) re-reads the flow through `readFlow`, then checks three things before anything else:
   the signature hash equals `state.signatureHash`, every frozen input's sha256 equals
   `state.inputsManifest`, and every earlier step's artifact is on disk. Any mismatch refuses by
   name at $0. Then it consumes the answer exactly once and carries on from `stepIndex`. It
   **never** re-runs a paid step that already went green and **never** re-asks an answered ask.
5. **One resumer.** Resume takes an exclusive lock on the run (`O_EXCL` create of `resume.lock`).
   A second resumer at the same time refuses and names the run. The lock is released on exit.
   A lock left behind by a killed resumer is a red naming it for the human, never stolen silently.
6. **Expiry cancels.** Answering or resuming an ask past `expiresAt` cancels the run: outcome
   `ask-expired`, a `history.jsonl` row, $0, nothing sent. Nothing runs in the background, so
   expiry is checked whenever anyone touches the run (`inbox`, `answer`, `resume`).
7. **`reject` vs `rerun`** (hamr 2026-09-25, "2A"). `reject "<reason>"` stays M2's: it redoes the step before
   the ask under `redo cap`. `rerun "<reason>"` becomes a **fresh run**: this run ends with outcome
   `rerun`, and a new `runId` starts on the same signed flow with fresh inputs, its own redo
   counter and its own cap, with the reason carried as the first step's starting gap.
8. **One ask count.** `validateDeclaration` and the runner count asks the same way: by signed ask
   line, one bound step per line (closes the F42 side note).
9. **The CLI is stdlib only.** `bin/fwdloop` uses `node:util` `parseArgs` with four verbs: `run`,
   `inbox`, `answer`, `resume`. It adds no dependency.

**Not in M3:** resuming a run killed mid-step (that run is a casualty; start a fresh run), a
daemon or timer that expires asks unattended, triggers, `pause` as an answer (an open ask already
is a pause), dry-run/versions (M5), any UI (M4).

**POC first, the riskiest assumption:** **a run can die at the ask and come back exactly as it
was.** $0, fake model steps that count their calls, job #2's fixture flow. Twenty loops, each:
start the run as a real child process, let it park, `SIGKILL` whatever is left, answer from a
second process, resume from a third. Every loop must show: the pre-ask steps were called exactly
once, `ask.json` was written exactly once, the answer was consumed exactly once, and the run
finished with the same artifacts an in-process run produces. In five of the loops, two resumers
start at the same moment and exactly one proceeds. In five more, an input is edited while the run
is parked and resume refuses it by name. **Bar: 20/20.** Any loop that re-runs a paid step,
re-asks, or double-consumes means the design is wrong.

**Exit.**

- The POC bar is met.
- Job #2 live on `deepseek-flash`: the run parks at its ask and the process exits; hamr answers
  `reject "<reason>"` from another terminal with `fwdloop answer`; the run resumes, redoes the step,
  parks again; `accept`; it sends. Both books show one run, and the spend is only the model rounds.
- A signed `ask 2s:` expires at its own TTL (item 1).

**Negative scenarios**, each of which must be able to fail:

- (i) an answer arriving after `expiresAt` cancels the run `ask-expired`, $0, nothing sent;
- (ii) `rerun "<reason>"` starts a new `runId` whose redo counter starts at 0 and whose cap is its
  own, and the old run's `history.jsonl` row says `rerun`;
- (iii) a frozen input changed while parked makes resume refuse, naming the input, at $0;
- (iv) a second `answer` to an answered ask is refused, and the first answer stands;
- (v) two resumers at once: exactly one proceeds, the other refuses naming the run.

**Kills the module:** the POC shows a resume can re-run a paid step or re-ask, and the only fix
is keeping the process alive (which is M2's design, not a resume).

**M3 spend cap: $2.00 — SIGNED by hamr 2026-09-25.** M3's own, separate from M2's $5.00 ($0.74 used).
POC $0; live exit about $0.05 a run. POC starts on branch `chore/fix-ledger` (hamr: same branch).
**POC bar RULED MET by hamr 2026-09-25** ("pass, commit"). F44: 20/20 at $0, stable over repeated
runs; the three broken resumers go red where they should (rerun-from-start 5/20, no-input-check 15/20,
no-lock 14–17/20). Build starts on the same branch.

**M3 EXIT SIGNED — hamr, 2026-09-26** ("sign m3 exit, commit"). Evidence below; F45's three bugs fixed first.

| exit / negative | evidence |
|---|---|
| POC bar 20/20 | RULED MET above (F44) |
| job #2 live: park, reject from another terminal, resume, re-park, accept, send | F45: run `m3-live-1`, three processes, sent text equals the accepted artifact, one history row, both books sum to $0.0307 |
| signed `ask 2s:` expires at its own TTL | `test/park-resume.test.js` TTL tests (F43 fixed) |
| (i) answer after `expiresAt` cancels `ask-expired`, nothing sent | `test/park-resume.test.js` "negative (i)", carries the run's real spend |
| (ii) `rerun` starts a fresh run with its own counter and cap | `test/rerun.test.js` "negative (ii)" |
| (iii) input changed while parked is refused by name at $0 | `test/park-resume.test.js` "negative (iii)", POC loops 6–10 |
| (iv) second answer refused, first stands | `test/park-resume.test.js` "negative (iv)", `wx` write |
| (v) two resumers: exactly one proceeds | `test/park-resume.test.js` "negative (v)", POC loops 1–5 |
| item 8, one ask count | `test/declaration.test.js`, the F42 test rewritten to the signing-time refusal |
| CLI (`run`, `inbox`, `answer`, `resume`, `show`) | `test/cli.test.js`; unset key refused at $0 before any book |

Spend: $0.03 of the $2.00 cap. Suite 1216/1216.

### RULING on the ladder order — by hamr, 2026-09-26 ("A")

**The UI moves up to M4; dry-run, accept and versions move to M5.** Why: in bareloop the UI came late,
and a lot of UX (what to show, what to hide) was never thought about until a person used it. fwdloop
has a bareloop UI to borrow, so M4 is mostly adjusting, not designing.

- **Start from bareloop's latest UI** (the one `loop` actively serves on port 4700) as the skeleton,
  borrowed by copy with a pinned `borrowed-from` commit. It carries every change so far.
- **M4 wires only what is built** (M0–M3: describe/sign, run, watch, the inbox with `show` /
  accept / reject / rerun, the audit and history books). A screen whose feature is not built yet
  stays unwired until its module lands. Nothing is faked to look live.
- **"Edit an existing workflow and add turns" is not in M4.** It lands with authoring (now M6),
  re-signing through versions (now M5). Every module after M4 ships its screen.
- **RULING C, by hamr 2026-09-26 ("1, renumber"):** the ladder below is renumbered to match — old
  "M4 — dry-run, accept, versions" is now M5, old "M5 — localhost UI, the crux" is trimmed to
  authoring only and is now M6, and every module after it shifts by one (old M6→M7, M7→M8, M8→M9,
  M9→M10). The renumber is done in the sections below, not deferred.

### M4 (the UI) — scope, exit, negative — M4a SIGNED by hamr 2026-09-26 ("signed M4a"), M4a EXIT SIGNED 2026-09-27, M4b SIGNED by hamr 2026-09-29 ("sign m4b"), M4b EXIT SIGNED 2026-09-30 ("sign m4b exit"), M4c SIGNED 2026-09-30 ("sign m4c"), M4d SIGNED 2026-10-05 ("sign m4d"), M4d amendment 1 + exit SIGNED 2026-10-05

**Where it comes from** (answered by the `loop` session, 2026-09-26). bareloop's panel:
`src/panel/index.html` (one file, all CSS and JS inline, vanilla, no build step, no npm UI deps; only
Google Fonts) and `src/panel/server.js` (`node:http` only, binds `127.0.0.1`). Visual contract:
`design/panel-mockup.html`. Rulings: `docs/product/PANEL-BUILD.md` §5–§7 and
`design/panel-feedback.jsonl`. **Pin: `a30bbef`** (bareloop `feat/panel-p1`, pushed to origin
2026-09-26 per `loop`, gate 3012/3012; the fit-check below ran against the intervening `43543cc`).
It is on GitHub now, so we copy from `../bareloop` at the pin. **2026-09-27:** the step map's dashed
retry loop (fwdloop commit `880784d`) was borrowed from bareloop commit `16825a7`, AFTER the `a30bbef`
pin above — bareloop has since released `v0.30.0` with a live run view, which is a candidate for M4b,
not this M4a pin. `loop` may ping a newer hash after its
own debrief; we pin the last one pinged before M4 starts. What changed since `4879437` (hamr's goal: no
duplication, no clutter; Run is the summary, Audit is the investigation): Workflows and History are
one **Runs** tab with a toggle; the Run tab is a map plus one two-line card per ordered **part**
(computed once server-side), with no expanding; Audit is grouped part → attempts → rounds, with a flat
toggle and All/Writes/Blocked filters. `loop`'s added lessons: one ordered list must drive the map,
the cards and Audit, or they drift; show hidden cost (a fix loop was over half the spend and
invisible). bareloop's own lesson was to label each **round's** recorded phase, never a timestamp —
fwdloop has no round unit in its books (`audit.jsonl` is one row per step **attempt**, not per
round), so the lesson lands one level coarser here: one ordered list of step attempts drives the
map, the cards and Audit; label each by its step and attempt, never by timestamp. What bareloop has
wired: Workflows and History lists, the Run tab (step map, step cards → attempts → rounds),
Audit/logs, Job. Not wired there: Chat (authoring), Settings, and any action buttons (their P1 is
read-only).

**Design source rule** (hamr 2026-09-26): bareloop started read-only first; fwdloop does the same.
Where the latest bareloop panel at the pin and the original mockup (`design/panel-mockup.html`,
bareloop, same file at the pin) conflict, the latest panel wins — it is the more-tested artifact.
Where the panel has nothing to say because it is read-only (no inputs, no action buttons), the
mockup is the design source, mainly for inputs: the inbox's accept / reject-with-reason /
rerun-with-reason controls follow the mockup's Run-tab action bar (`data-testid="action-bar"`,
`#btn-accept`, `#btn-rerun` — the mockup also has `#btn-pause` and `#btn-replay`, not ours to use)
rather than being invented from scratch.

**Fit check (2026-09-26, $0).** A field-by-field read of bareloop's panel against fwdloop's own
books (`docs/logs/FINDINGS.md`-style, kept as a scratch note, not filed as a finding since nothing
here is a bareloop bug): roughly 80% of `index.html`'s CSS and page shell is reusable as-is
(layout, tabs, mobile breakpoints, fonts); the JS that renders Workflows/Run/Audit is entangled with
bareloop's round/part/scoutPlan data shapes and needs rewriting against fwdloop's flatter one
(declaration steps joined to `audit.jsonl` rows). bareloop's `server.js` is GET/HEAD only by
construction (405s everything else) — the inbox's `POST` answer path, with its Origin/Host/token
checks, is new code, not a port. Died/floor logic (`[?]`, "at least $X") has no bareloop analog and
is new. `resume.lock` has no pid and no liveness check today (already an open POC question, M4a
scope item 4 below) — confirmed by reading `runner.js`.

**What fwdloop has built that a screen can show** (M0–M3, in `src/` and `bin/`): signed flows
(`readFlow`), both books (`audit.jsonl`, `history.jsonl`), `log.json`, artifacts, the parked ask with
its evidence (`ask.json`, `state.json`), `answerAsk`, `resumeRun`, `runFlow`. **Not built:** the
drafter in `src/` (it lives only in `poc/m0/drafter.mjs`), so "describe a job" has no engine yet.

**Split, like M0a/M0b** (hamr 2026-09-26): M4a is the read-only panel; M4b is the inbox's answer
doors, and does not start until M4a's exit is signed.

#### M4a — read-only panel — SIGNED by hamr 2026-09-26 ("signed M4a"), spend cap $0 signed

**Scope.**

1. **Borrow by copy.** `src/panel/index.html` and `src/panel/server.js` copied from bareloop at the
   pinned commit, each with a `borrowed-from: bareloop <path>@<commit>` header. bareloop internals the
   server imports (runlist, replay, ledger, job, authorflow) are rewired to fwdloop's own books, never
   imported. The live-canvas overlay is not copied. `fwdloop panel [--port 4800] [--root <dir>]`
   serves on `127.0.0.1` only. No new dependency. **No POST route exists at all in M4a** — the server
   is GET/HEAD only, exactly like bareloop's own (405 on anything else).

   **Ruling, hamr 2026-09-27:** fwdloop's panel default port is **4800**, not bareloop's 4700 — the
   two panels must be able to run side by side (bareloop owns 4700).
2. **Wire what is built** (read-only screens):
   - **Workflows**: every flow under `--root`, with its last run's glyph, cost and time.
   - **History**: every run row from `history.jsonl`.
   - **Run tab**: the step map from `declaration.steps`, and step cards → attempts from `audit.jsonl`
     (verdict, gap, cost, model, strike) plus what the model wrote from `log.json`.
   - **Audit/logs**: the raw audit rows, scoped to the one run, one row per step attempt
     (`audit.jsonl` has no round-level or tool-call-level rows). bareloop's All/Writes/Blocked
     filters and per-round detail have no fwdloop book to fill them from — they stay unwired, not
     faked; logging per-round or per-call rows is a possible later books amendment, not M4.
   - **Job**: the signed prose, the arbiter block (cap, asks with TTL, redo cap, sends, sources),
     and the signature (who, when, hash).
   - **Inbox, read-only**: open asks across all flows — question, time left, and the evidence (the
     draft under review first, then each unjudged artifact labelled by step), the same thing
     `fwdloop show` prints. No answer controls yet; those are M4b.
3. **Unbuilt screens stay honest.** Chat/describe says "authoring isn't built yet (the drafter is a
   POC)". Settings, version/edit controls, and the inbox's answer doors stay unwired until their
   module. Nothing shows fake data.
4. **fwdloop words, bareloop's rulings.** Results are glyphs only: `[✓]` passed, `[✗]` failed,
   `[▶]` running, `[·]` waiting on you (parked, `ask.json` present, no `answer.json` and no consumed
   answer for its askId), `[·]` answered, not resumed yet (parked, `answer.json` present; said in words,
   not the same line as an unanswered ask), `[?]` died (no history row and no `state.json` park; never
   `[✗]`), `[!]` ask expired, not resumed yet (parked, ask past its `expiresAt`, unanswered; never
   counted as waiting on you). Ruling, hamr 2026-09-27: "the '!' is fine for expired asks."
   **Open for M4a's POC** (debrief 2026-09-26): the books cannot tell "running right now" from
   "died" today. `resume.lock` is an empty file with no pid and nothing checks liveness, so a crashed
   resumer and a live one look the same. Either the runner writes a pid (and the panel checks it), or
   the panel shows "running or died: unknown" and never guesses. A park never writes a history row, and `answerAsk` leaves
   `ask.json` in place until resume consumes the answer (debrief 2026-09-26), so "no history row" alone
   never means died. Close classes are shown as `cited` (green), `shape` (softgreen) and `human check`
   (hitl), never the words green, red or softgreen. "took 6m08s" for a finished run, "Xs elapsed"
   only while live. Every empty state says why. No list is truncated silently. Cost is never
   rendered as `$0` when unknown, and a floor says "at least".
5. **Mobile is mandatory.** Works at 390 px with no horizontal scroll; checked with a real screenshot,
   not "verified" in prose.

**POC first, the riskiest assumption:** **that fwdloop's books hold everything the borrowed screens
need.** No screen is built. A $0 script builds the panel's data for every real run already on disk
(`flows/job2-live-1`: `run-1`, `run-2`, `m3-live-1`, `m3-live-2`; `flows/job2-plant-notdone`) and
lists every field on the skeleton's screens that it cannot fill from the books. **Bar: every field is
filled from a book, or has a stated why-empty. Zero fields filled with a made-up value, 0 or
"unknown".** Each gap found is either a books change (its own small signed amendment) or a screen that
stays unwired.

**M4a exit.**

- The POC bar is met.
- Someone who has not used the CLI opens `fwdloop panel`. They find job #2's parked ask and read
  the draft and both inputs (read-only — no answer yet).
- They open a red run (the F41 plant, `not-done`) and can say which step stopped it and why, from one
  screen.
- A phone-width screenshot of every wired screen at 390 px shows no horizontal scroll.

**M4a negative scenarios**, each of which must be able to fail:

- (iii) a run with no history row and no park shows `[?]`, never `[✗]` and never `[✓]`; a run parked
  and answered but not resumed shows "answered, not resumed yet", never `[?]` and never waiting on you;
- (iv) a run whose spend is a floor (`spendComplete: false`) shows "at least $X", never a bare total;
- (v) no screen renders a key, a secret, or a path outside `--root`.

**Kills M4a:** the books cannot fill the core screens (Run tab, inbox) without the panel inventing
values; then the fix is in the books first, and M4a (and M4b behind it) waits.

**M4a spend cap: $0 — SIGNED by hamr 2026-09-26** ("signed M4a") — read-only, no paid calls.

**Amendment M4a-1 — SIGNED by hamr 2026-09-27** ("sign m4a1"). Every time a run parks at an ask, the
runner also writes a permanent copy of that ask into the run dir: `asks/<askId>.json` — question,
askedAt, expiresAt, evidence (the draft under review + the unjudged inputs), same content as
`ask.json` at that moment. Write-once: a second write for the same `askId` is refused (a red naming
the file), and nothing deletes it — not resume, not answer consumption, not rerun (a rerun is a fresh
run dir anyway; checked). `ask.json` keeps its current role unchanged. Runs from before M4a-1 have no
`asks/` dir; readers show "draft not kept (before M4a-1)", never an invented one. Negative scenarios,
each able to fail: (a) a second write to the same `asks/<askId>.json` is refused and the first file is
byte-identical afterwards; (b) resume + answer consumption leave every `asks/*.json` in place; (c) a
reader pairs each archived ask with its answer by `askId` (consumed answer files
`answer.<askId>.consumed.json`), never by position/order. Cost $0 (tests only, no paid call).

Built: `writeAskArchive`/`listArchivedAsks` in `src/ask.js`, called from the one place `ask.json` is
written on park (`runAskSlot` in `src/runner.js`, right after `ask.json`, before `state.json`) — a
crash between the two writes leaves `ask.json` present with no archive entry for that one `askId`; the
run is still correctly parked/resumable, and `listArchivedAsks` only ever reports what is actually on
disk, never invents an entry. `listArchivedAsks` is exported from `src/index.js` but not wired into
the panel — that is the next M4a/M4b piece's job. Tests: `test/ask-archive.test.js`.

**Amendment M4a-2 — SIGNED by hamr 2026-09-27 ("sign mfa2", = M4a-2).** Each new audit.jsonl row also
records `at` (ISO time the attempt finished) and `tokens` (`{ inputTokens, outputTokens,
cacheReadTokens }` summed over that attempt's model calls; `null` with no model call). Rows written
before M4a-2 read as "not recorded (before M4a-2)", never an invented number. Negative scenarios,
each must be able to fail: (a) a model-call audit row written without tokens is refused at write
time (a red naming the row), like the existing cost-field check; (b) the sum of a run's audit-row
tokens equals the sum of its spend.jsonl tokens; (c) every new row carries a valid `at`. Cost $0
(tests only).

Built: `src/model-step.js`'s `liveModelStep` now sums `tokens` alongside `costUsd` at the SAME
place, across every round of an attempt (`addMeter`, replacing `addCost`) — carried on every
returned result (`ok:true` and every red/halt shape), never re-derived later by position from
spend.jsonl. `src/runner.js`'s `makeAuditRow` (and `runStepRalph`'s new `now` parameter, threaded
from `runFlow`'s own injected clock down through every call site) stamps `at: now()` and threads
`tokens: result.tokens ?? null` on every attempt row; every non-model-call row (cap-halt, paused,
ask-timeout, refused, accept, redo-rejected, the send row, `ask.js`'s stale-answer-ignored,
`recordLateAnswerIfAny`, resume's ask-expired) carries `tokens: null`. `src/books.js`'s
`appendAudit` gained `checkAtField`/`checkTokensField` (mirroring `checkCostField`'s discipline) and
a reader helper, `auditRowTokens(row)`, exported from `src/index.js`; `readAudit` itself is
unchanged (one reader per book — the panel reads it later). A row whose cost is unknown
(`spendComplete:false`) may still carry known, possibly-partial tokens (the same "known partial
survives as itself" rule `sumKnownUsd` already applies to cost) — never invented, never coerced to
zero. Tests: `test/books.test.js` (checks (a)/(c), `auditRowTokens`'s pre/post-M4a-2 read, both
proven able to fail by reverting the check alone), `test/runner.live-shape.test.js` (check (b), an
end-to-end run's audit-row token sum against its spend.jsonl sum, also proven able to fail by
reverting the threading alone).

**Amendment M4a-3 — SIGNED by hamr 2026-09-27 ("sign m4a3").** Each new audit.jsonl row also records
`tools`: the tools that attempt's model calls actually invoked, with a count per tool (e.g. { read:
3, write: 1 }); `{}` when the model called no tool; `null` for a row with no model call. Counts come
straight from the model's own tool calls as the loop executes them — never inferred. Rows before
M4a-3 read "not recorded (before M4a-3)". The panel's step card shows `tools: read 3 · write 1` with
the signed grant beside it as `allowed: …` (panel wiring is a separate follow-up). Negative
scenarios, each must be able to fail: (a) a tool call made during an attempt that is missing from
the row's counts is caught (the test drives a fake model that calls tools and asserts exact counts);
(b) a called tool that the step was NOT granted is flagged in the row (e.g. `ungranted: ["grep"]`) —
never silently merged into the counts as if allowed; (c) an old row never shows an invented count.
Cost $0 (tests only).

Built: `src/model-step.js`'s `liveModelStep` sums `tools` the same place it already sums
`tokens`/`costUsd`, across every round of an attempt — but the counts themselves come from
bare-agent's OWN per-round `result.metrics.byTool`, not a separately-maintained hook (an
`onToolCall` callback only fires for a call bare-agent's `toolMap` actually recognised, so it would
silently miss a genuinely ungranted/hallucinated name; `byTool` counts every attempted call
regardless of outcome, matching bare-agent's own "a denied or unknown call is still an invocation
the operator wants to see"). A new `addToolCounts` splits each round's `byTool` against the step's
own granted verb set (`grantedTools`'s keys) into the running `tools` tally and a de-duplicated,
sorted `ungranted` list; `emit_artifact` itself (the step's mandatory output call, not a granted
primitive) is excluded from both — flagged here for hamr's ruling if that reads differently, since
the amendment text doesn't say so explicitly. `addMeter` was fixed alongside this (a real bug this
amendment's own tests caught live): it used to return a bare `{costUsd, rounds, tokens}`, silently
dropping `tools`/`ungranted` the moment any round after the first ran — now it carries both through
unchanged. `src/runner.js`'s `makeAuditRow` threads `tools: result.tools ?? null` and
`ungranted: result.ungranted` (included only when non-empty) on every attempt row, alongside
`tokens`; every non-model-call row keeps `tools: null` by default. `src/books.js`'s `appendAudit`
gained `checkToolsField`/`checkUngrantedField` (mirroring `checkTokensField`'s discipline: `tools`
must not be `undefined`, may be `null` only when `model` is `null`, else a plain object of
non-negative integers; `ungranted`, when present, must be an array of strings) and a reader helper,
`auditRowTools(row)`, exported from `src/index.js`. Today, an ungranted tool call is refused by
bare-agent before `tool.execute` ever runs — `[Loop] Unknown tool: <name>` is fed back to the model
as the tool result, never real data, and the model never learns anything but that the name doesn't
exist; this amendment records that refusal honestly rather than folding it into `tools`. Tests:
`test/model-step.test.js` (checks (a)/(b)/no-model-call and no-tool-call shapes — (a)'s fake model
spans two of `liveModelStep`'s own outer rounds so the assertion actually exercises summing across
rounds, not just within one; both (a) and (b) proven able to fail by reverting `addToolCounts`
alone), `test/books.test.js` (write-time checks and `auditRowTools`'s pre/post-M4a-3 read, each
proven able to fail by reverting the relevant check alone). `test/panel.test.js` (owned by a
concurrent M4 panel piece) still builds audit-row fixtures without `tools` and needs those fixtures
updated in a follow-up — not touched here. **Landed 2026-09-27:** the fixture update
(`70656cf`) and the panel wiring itself — step card `tools: … · allowed: …` (red `not allowed:
<names>` for `ungranted`) and the Audit Action-cell tally (`9064e7c`). **Ruling by hamr,
2026-09-27:** `not allowed:` shows tool names only, no count — the books record names, not
attempt counts — "keep name only".

**M4a EXIT SIGNED — hamr, 2026-09-27** ("sign mfa exit", = M4a).

| exit / negative | evidence |
|---|---|
| POC bar met (114 FILLED / 11 EMPTY-WITH-WHY / 0 GAP) | `docs/logs/FINDINGS.md` F47, fix `4e145ab`; POC script `poc/m4/panel-data.mjs` |
| panel shows job #2's parked ask, draft + both inputs, read-only | F47 (`readAskEvidence`, `src/ask.js`); no test-name citation found beyond F47 — no recorded evidence found for a dedicated panel test |
| a red run (F41 plant, not-done) shows which step stopped it and why | `test/panel.test.js` "review #2: a not-done row is blocked, the run's only red" (`run-failed` fixture, `log.json` `red` field) |
| 390px screenshot, every wired screen, no horizontal scroll | `.claude/stash/2026-09-27-fwd-m4a-built-exit-pending.md`: "headless chromium at 1280 and 390px" browser walk, verdict "better, pass for all"; no screenshot file found on disk — no recorded evidence found beyond the stash note |
| (iii) no history/no park is `[?]`, never `[✗]`/`[✓]` | `test/panel.test.js` "negative (iii): no history row, no park at all is [?], never [✗] and never [✓]" |
| (iii) answered, not resumed reads distinctly, never `[?]`/"waiting on you" | `test/panel.test.js` "negative (iii): answered but not yet resumed is worded distinctly, never [?] and never \"waiting on you\"" |
| (iv) `spendComplete:false` shows "at least $X", never a bare total | `test/panel.test.js` "negative (iv): spendComplete:false shows \"at least $X\", never a bare total" |
| (v) no screen renders a key, secret, or path outside `--root` | `test/panel.test.js` "negative (v): a path-escape flow segment never reads outside root", "negative (v): a path-escape runId segment never reads outside root", "negative (v): a secret-looking env var never appears in any response" |

#### M4b — inputs (SIGNED by hamr 2026-09-29, "sign m4b")

**Pre-step (before M4b starts).** (a) The catalogue `compress` description is fixed (it is a code
shrinker, not a text shortener; the drafter had read the old text and granted it to job #2's
prose-summary step). (b) Job #2 is re-drafted and re-signed as a new flow without `compress`,
because both signed job #2 flows grant `compress` and are refused at preflight since the
2026-09-26 unwired-verb refusal (F46). A small paid draft plus hamr's signature. hamr's ruling
2026-09-29, "A1". **Superseded by M6a's exit
(2026-09-29):** the new job #2 flow comes from `fwdloop draft` + `fwdloop sign`, not a hand-rebuild;
M4b waits for it. Part (a) stands.
M6a exit signed 2026-09-29 — M4b is unblocked.

**Scope.**

1. **The inbox's answer doors, designed from the mockup.** Per the design-source rule above: the
   mockup's Run-tab action bar (`#btn-accept`, `#btn-rerun`) is the source for shape and placement,
   since bareloop's own panel has no action buttons to borrow. Three doors: accept, reject
   "<reason>", rerun "<reason>" — reject has no mockup analog and is fwdloop's own. The server calls
   `answerAsk` and nothing else, so every refusal (blank reason, expired, already answered) is the
   library's, shown by name. The panel is a client of the arbiter, never a second arbiter
   (bareloop §5).
2. **Only a human click answers.** The server refuses an answer that did not come from the page: it
   checks `Origin` and `Host` against its own address, requires a per-process token that is only
   embedded in the served page, and accepts only `POST`. A scripted `curl` without the page's token
   is a red naming the reason. Keys never reach the page. The `Origin`/`Host` check applies to
   EVERY route, `GET` included: the `/branch-review` of M4 reproduced a DNS-rebinding read (a `GET`
   with `Host: evil.example.com` returned 200). hamr's ruling 2026-09-29, "B1".
3. **Resume after an answer — ruled (b)** (hamr 2026-09-26, "1b"), now specified (hamr 2026-09-29):
   the panel starts the resume as a separate detached background process, not inside the HTTP
   request, using the key from the panel server's own environment. The page shows the run live
   from the books. Closing the tab does not stop it. This is the "no terminal" product; showing
   "answered — run `fwdloop resume <runId>`" and leaving the resume to a human terminal, as today,
   is not built.
4. **Accept records a hash; send verifies it** (moved in from the pending amendment; hamr "B1"
   2026-09-29; F48 finding C). Accept records a sha256 of the accepted artifact. Send re-hashes the
   artifact at send time and refuses by name on a mismatch, shipping nothing.

**M4b exit.** Someone who has not used the CLI opens `fwdloop panel`, finds job #2's parked ask
(via the new re-signed flow), reads the draft and both inputs, rejects with a reason, sees it
re-park (after the resume, per ruling 1b), accepts, and sees the run's glyph turn `[✓]` and the
sent artifact in the Run tab. hamr does this on a live run, panel only.

**M4b negative scenarios**, each of which must be able to fail:

- (i) a scripted `POST` to the answer endpoint without the page's token, or from another `Origin`, is
  refused, and no `answer.json` is written;
- (ii) an answer the library refuses (expired, blank reason, second answer) shows that refusal by name
  in the page, never a success;
- (iii) the accepted artifact changed on disk between accept and send: send refuses by name and
  nothing is shipped;
- (iv) a `GET` with a foreign `Host` is refused.

**Kills M4b:** the answer/resume path cannot be made to refuse (i) or (ii) without a books or arbiter
change; then the fix is upstream of the panel, and M4b waits.

**M4b spend cap: $1.00** (the live exit is about $0.05 a run) — SIGNED 2026-09-29.

#### M4b amendment 1 — an answer always resumes; every answer names its ask — SIGNED by hamr 2026-09-30 ("sign m4b amendment 1"; rulings "1A, 2A")

- **Why:** F51. The POC showed (1) an answer accepted while `resume.lock` is still held is saved, the resume exits "locked by another resumer", and nothing retries, so the page would say "answered" forever; (2) an answer with no `askId` lands on whatever ask is open, so a tab left open across a re-park answers an ask its human never read.
- **Scope:**
  1. **Answer means resume.** After the library accepts an answer, the panel starts the resume and then checks it took over (the answer was consumed, read from the books, never from the child's output). If the resume was refused because the run is locked and the answer is still unconsumed, the panel starts it again: **up to 5 tries within 10 seconds (signed with this amendment)**. Exactly one resume ever applies the answer (the rename-to-consume mutex, F44, is unchanged).
  2. **A stuck answer is said by name.** If the answer is still unconsumed after the last try, the page and the API say "answer saved, resume not started" with the resume's own refusal, verbatim. Never "answered" alone, never a success. The answer stays on disk and is applied exactly once by whichever resume next succeeds. The page offers "try the resume again" in this state only; it starts a resume and nothing else (it cannot answer).
  3. **Every answer names its ask.** The answer request must carry the `askId` the page was showing. No `askId` is refused by name, nothing written. An `askId` that is not the open ask (the run re-parked, or it was already answered) gets the library's refusal, by name, and the open ask is untouched.
- **Negatives** (each must be able to fail):
  - (v) an answer with no `askId` is refused and no answer file is written;
  - (vi) after a re-park, an answer carrying the previous ask's `askId` is refused by name and the new ask is still unanswered;
  - (vii) an answer sent while `resume.lock` is held, with the lock released inside the retry window, resumes the run: one resume, the answer consumed once;
  - (viii) with the lock held past the retry window, the page and API show "answer saved, resume not started" and the reason, never success, and a later resume applies that answer exactly once.
- **Exit:** no separate exit. M4b's exit stands, and negatives (v)-(viii) join (i)-(iv).
- **Cap:** $0 extra; inside M4b's $1.00.
- **Honest limit:** a resume that crashed leaves `resume.lock` behind forever (no pid, no liveness; the open question from M4a). This amendment shows that state by name; it does not take over a dead lock, because a wrong takeover could run a paid step twice. Clearing it stays a terminal job until a later ruling.
- **Kill check:** none of this changes the books or the arbiter; the change is in `src/panel` and how the panel starts `resume`.

#### M4b amendment 2 — a saved ask records which step output it is about — SIGNED by hamr 2026-09-30 ("sign m4b amendment 2"; ruling "1A")

- **Why:** F52. With two asks, an artifact accepted at ask 1 is refused at send after a later resume, because nothing on disk says which step output an ask was about, so its recorded hash cannot be found again. Bareloop was consulted: such a fact belongs in a write-once record keyed by id, never in a file that is overwritten.
- **Scope:**
  1. When an ask parks, its archived record `asks/<askId>.json` also records `emits`, the step output the ask is about. It is written once with the rest of that record by the one function that writes the archive, and never rewritten.
  2. A resume finds the hash for an ask accepted in an earlier process by joining that archive's `emits` to the consumed answer by `askId`. Only an answer that says accept and carries a recorded hash counts. The hash is never recomputed from the file as it is now.
  3. A run parked before this field existed has no `emits`, so no hash is found and send refuses by name. Nothing ships unchecked.
- **Negatives** (each must be able to fail):
  - (ix) two asks, each answer resumed in its own process, send ships ask 1's artifact: the run completes and the shipped bytes hash to the value recorded at ask 1's accept;
  - (x) the same flow with one byte changed after ask 1's accept: send refuses with "the artifact changed after it was accepted" and nothing ships;
  - (xi) an archived ask with no `emits`: send refuses by name and nothing ships.
- **Exit:** no separate exit. M4b's exit stands, and (ix)-(xi) join the other negatives.
- **Cap:** $0 extra; inside M4b's $1.00.
- **Not in scope:** a pid or liveness check in `resume.lock`; replacing rename-to-consume with an appended event. Both are recorded in F52 for a later ruling.
- **Kill check:** one added field in the saved ask. The arbiter, `audit.jsonl`, `history.jsonl` and `spend.jsonl` are unchanged.

#### M4b amendment 3 — the word is "redo" everywhere; a run ended by rerun is not "failed" — SIGNED by hamr 2026-09-30 ("sign m4b amendment 3"; rulings "accept, redo, rerun" and "terminal says redo too")

- **Why:** the browser walk of M4b showed a run the human ended on purpose with rerun as `[✗] failed (rerun)`. "Reject" and "rerun" also read alike, and "reject" hides what it does (it redoes the step before the ask, M3 scope item 7). hamr ruled the three answers are **accept, redo, rerun**, and that the terminal and the page use the same words.
- **Scope:**
  1. **One word everywhere.** The answer that was `reject` is `redo`: in the panel's doors (Accept, Redo, Rerun), in the CLI (`fwdloop answer <runId> redo "<reason>"`), in the library's decision value and its refusal messages, and in what new answers write to disk. What it does is unchanged: it redoes the step before the ask under `redo cap` (M3 scope item 7, read with this word).
  2. **The old word is still understood.** `reject` given to the CLI or the library means `redo` and is recorded as `redo`. A file already on disk that says `reject` (an old run's answer, archive, audit or history row) is read as `redo`. Nothing already written is rewritten. One function does this translation; everything else calls it.
  3. **The page says what each door does**, next to the doors: Redo is "redo the last step with your reason"; Rerun is "end this run and start a fresh one from the top".
  4. **An ask the human sent back** reads "redo" with its reason in the ask list and the inbox, where it read "rejected".
  5. **A run ended by rerun** shows `[✗]` with the label "stopped by you (rerun), a fresh run was started". It never says "failed". A real red still says "failed".
- **Negatives** (each must be able to fail):
  - (xii) `redo` with a reason, from the CLI and from the panel, redoes the step before the ask, and the consumed answer on disk says `redo`;
  - (xiii) `reject` given to the CLI does the same thing and the consumed answer on disk says `redo`;
  - (xiv) a run whose files on disk say `reject` (written before this amendment) resumes and shows as `redo`, and none of its files is rewritten;
  - (xv) a blank reason on `redo` is refused by name, and the refusal says "redo";
  - (xvi) a run whose outcome is `rerun` never renders the word "failed";
  - (xvii) a run that ended red still renders "failed".
- **Exit:** no separate exit. M4b's exit stands, read with these words: hamr clicks Redo with a reason, sees it re-park, then accepts.
- **Cap:** $0.
- **Not in scope:** renaming `rerun` or `accept`; renaming `redo cap`; rewriting old files.
- **Kill check:** the arbiter is unchanged. The books keep their shape; one recorded value changes its spelling for new rows, and the old spelling is still read.

#### M4b exit — SIGNED by hamr 2026-09-30 ("sign m4b exit"); evidence from hamr's live walk

hamr signed the M4b exit on 2026-09-30 after the walk below. Numbers are from the books on disk.

- **Who and how:** hamr, panel only (`fwdloop panel --root flows --port 4811`, started in hamr's own terminal with the key). Real provider deepseek-flash. Branch `m4b` at HEAD 8998823, which `/branch-review` gave verdict ready.
- **First try, run `m4b-exit-1` on flow `job2-m6a-3`: never reached the ask.** Step `summary_resume` was red on all 4 attempts on the shape check (exact headings missing). Outcome `attempt-fallback`, spent $0.0311 (`spentUsd` 0.031085, cap $0.25). No ask, so no doors. Cause: the two flows have byte-identical signed prose (`cmp` of `prose.txt`), but the drafted declaration of `job2-m6a-3` checks four section headings (it adds "how it matches the JD") where `job2-m6a-2` checks three. A correct red: the model missed, the check caught it.
- **Second try, run `m4b-exit-2` on flow `job2-m6a-2`: reached the ask.** hamr clicked Redo with a reason three times (reasons "redo again", "ok", "redo"). Each one redid step `summary_resume` and re-parked under a new askId. 4 asks are archived, all with `emits` = `accepted_summary_resume`. hamr then clicked Accept on the fourth ask (reason "yes"). The consumed answer records `decision: accept` and an `artifactSha256` (e8ba06a2…). Outcome `complete`. The sent artifact landed at `poc/m0/out/m4b-exit-2-final_summary_resume.json`. All four consumed answers use the new word: `redo`, `redo`, `redo`, `accept`.
- **Run cost:** `spentUsd` 0.076502 ($0.0765), cap $0.25, `spendComplete` true, wall 406 s. The audit rows' usd sum is 0.07650228, equal to `spentUsd`.
- **One observation from the audit.** The `summary_resume` verdicts in order were: red, green, red, green, red, green, red, green. The first draft and each redraft after a redo were red on the same heading gap, and the next attempt was green.
- **Spend:** $0.0311 + $0.0765 = $0.1076 for both runs, against the signed M4b cap of $1.00. Earlier M4b work was $0.
- **What the exit text asked vs what happened.** The signed exit says the person "rejects with a reason, sees it re-park ... accepts, and sees the run's glyph turn `[✓]` and the sent artifact in the Run tab", read with amendment 3's word "redo". The books show the redo, the re-park and the accept and complete. hamr reported: accepted, and on the glyph: "yes, i see passed". He did not separately state that he saw the sent artifact in the Run tab; the books show it landed at the signed destination.
- **"Via the new re-signed flow".** The walk completed on `job2-m6a-2`, not `job2-m6a-3`. The two flows' signed prose is byte-identical. The orchestrator put this question to hamr before signing (sign if it counts); hamr signed.
- **hamr's notes from the walk:** "i got confused on workflows as it didnt have pulsing play (working) but i found it, same at inbox, ask 1 of 2, 2 of 2 was not clear, that was confusing. inbox should highlight or flow on the right should be different" and "so every redo it reasked again and they were all same ask?". These are recorded as F53 and are not part of the signed M4b scope. F53 stays open as later work; it did not hold the exit.

#### M4c — the answers read clearly — SIGNED by hamr 2026-09-30 ("sign m4c")

- **Why:** hamr's M4b live walk (F53). While a run worked there was no sign it was working; "Ask 1 of 2 / 2 of 2" was not clear; the inbox did not put the ask that needs you first; after a redo the new ask looked like the same ask again. hamr agreed a mockup on 2026-09-30 ("mockup agreed"); this scope is that mockup in words. Ladder order agreed the same day: M4c (this), then M4d (Settings: providers, keys, money, ported from bareloop), then M4e (run a job from the panel). Keys are typed by hand into a file, never on the page (hamr 2026-09-30, "keys handtyped").
- **Scope:**
  1. **Signs, the same everywhere** (Runs list, Inbox, run header): `[▶]` running, pulsing; `[·]` waiting on you, pulsing; `[✓]` passed; `[✗]` failed, or stopped by you (rerun); `[!]` ask expired; `[?]` died or unknown. Under the browser's reduced-motion setting the sign stays and only the pulse stops.
  2. **How "running" is known — agreed by hamr at signing** (hamr asked to check with bareloop; `loop` answered 2026-09-30, "both, pid first"): each process that works on a run (the first run and every resume) appends one row `{pid, startedAt}` to a new append-only file in the run dir, written by that process itself before its first step. The panel shows `[▶]` while the newest row's pid is alive and its command line is `fwdloop` (`/proc` check). The moment it is gone, `[?]`. A run with no such row (started before M4c) or where `/proc` cannot be read falls back to bareloop's rule: no end row and the run's books changed in the last 10 minutes is `[▶]`, older is `[?]`. An end row in `history.jsonl` always wins over both. The rule lives in one function, so M4d's money hold can reuse it and the two never disagree (bareloop's own open inconsistency). No existing book changes shape; one new file is added.
  3. **`Inbox (N)` is always in the top tab.** N counts asks that are open and not expired, across all flows and runs. N drops as soon as an answer is saved.
  4. **Inbox order:** asks waiting on you first and highlighted, the one with the least time left on top (hamr 2026-09-30, "runs out first"). Then runs working on an answer you just gave (`[▶]` "working on your redo…"). Then answered and expired asks, dimmed, newest first.
  5. **The Ask tab shows one block per ask line**, titled with the signed question. Under it: the current draft, labelled "draft N" (N = how many times this ask line has parked in this run), in full; then "your answers so far", one line per earlier draft: `draft k → <decision> "<reason>" <time>`. The words "Ask 1 of 2" go. A flow's second ask line is its own block with its own title.
  6. **After a click the doors hide** and the block says what is happening, with `[▶]` pulsing, until the books show the next state: redo "working on your redo… draft N+1 is coming"; accept "shipping draft N…"; rerun "ending this run, starting a fresh one…".
  7. **The live refresh never redraws over what you are doing:** a reason being typed, or a refusal just shown, stays until your next click (bareloop F199: a 2 s re-render wiped a typed answer).
- **Negatives** (each must be able to fail):
  - (i) a run parked at an ask never shows `[▶]`;
  - (ii) a run whose process is killed shows `[?]` on the next refresh, never `[▶]`; a pre-M4c run with no pid row shows `[?]` once its books are older than 10 minutes;
  - (iii) a recycled pid that is not `fwdloop` does not read as running;
  - (iv) `Inbox (N)`: one open ask gives 1; 0 once the answer is saved; an expired ask is not counted;
  - (v) with two runs waiting, the one with less time left is on top;
  - (vi) after three redos the Ask tab shows "draft 4" and three answer lines, and never "Ask 1 of";
  - (vii) a reason typed in the box survives three refresh ticks; a refusal shown stays until the next click;
  - (viii) a run from before M4c still renders, and none of its files is rewritten.
- **Exit:** hamr, live on deepseek-flash, panel only: sees `[▶]` pulse while the run works; sees `Inbox (1)` and `[·]` pulse when it parks; clicks Redo with a reason and sees "working on your redo…", then "draft 2" with his answer listed under it; clicks Accept and sees `Inbox (0)` and `[✓]`. The orchestrator walks the same at desktop and 390 px first, at $0.
- **Cap:** $1.00 (hamr 2026-09-30).
- **Not in scope:** Settings (M4d); a Run button (M4e); new answer words; any change to an existing book's shape; the drafter.

**M4c amendment 1 — where a click takes you, and run order — SIGNED by hamr 2026-09-30 ("sign m4c amendment 1")**
- (a) From **Runs**, clicking a run opens it on the right on the **Run** tab. If that run has an ask waiting on you, the left side also switches to the **Inbox** with that ask selected. If not, the left side stays on Runs.
- (b) From the **Inbox**, clicking any card opens the **Ask** tab on the right. That includes a waiting card and an old answered or expired one.
- (c) Runs and History list the runs waiting on you first, the one with the least time left on top. Everything else follows by finish time, newest first. A running run sits just below the waiting ones. A job's top row is its waiting run, if it has one.
- No book changes.
- Why: hamr's M4c review walk 2026-09-30 — clicking a `[·]` run in Runs landed on the Audit tab, and Runs/History put finished runs above the run waiting on him (a parked run has no end row, so the finish-time sort dropped it to the bottom).

**M4c amendment 2 — a stuck run, and how to unstick it — SIGNED by hamr 2026-09-30 ("sign m4c amendment 2")**
- (a) A run is **stuck** when your answer is saved but no process is carrying the run on. It shows `[II]` "stuck — answer saved, click try the resume again", **pulsing** (it is not a final state). Under reduced motion the sign stays and only the pulse stops.
- (b) A stuck run counts in `Inbox (N)` and sits in the Inbox's "waiting on you" section, below the asks that have a timer. In Runs and History it sits with the waiting runs.
- (c) Clicking a stuck card in the Inbox opens the Ask tab, where the "Try the resume again" button is.
- (d) The resume lock records the process that holds it. "Try the resume again" clears a lock only when that process is gone (the same liveness rule as `[▶]`). If it is alive, it refuses by name. Two resumes never run at once.
- (e) Once the resume starts, it shows `[▶]` "working on your answer".
- The lock file gains its holder's process number. No other book changes.
- Why: hamr's M4c review walk 2026-09-30 — the walk fixture's run-stuck (answer saved, resume.lock held) showed `[·]` "waiting on you" though nothing waited on him; and a resumer killed hard leaves an empty `resume.lock` (src/runner.js ~1548, removed only in its finally ~1968), so "Try the resume again" is refused forever until the file is deleted by hand.

**M4c amendment 2 (revised) — a stuck run, and how to unstick it — SIGNED by hamr 2026-09-30 ("sign m4c amendment 2 revised")**
- Replaces M4c amendment 2 above. The POC (poc/m4c/stuck-probe.mjs, e493228) proved a resume that took the answer and then died cannot be carried on: clearing the lock leaves "no answer yet", and the taken answer's askId refuses a second answer.
- (a) A run is **stuck** when your answer is saved and not yet taken, but no process is carrying the run on. It shows `[II]` "stuck — answer saved, click try the resume again", **pulsing**. Under reduced motion the sign stays and only the pulse stops.
- (b) A stuck run counts in `Inbox (N)` and sits in the Inbox's "waiting on you" section, below the asks that have a timer. In Runs and History it sits with the waiting runs.
- (c) Clicking a stuck card in the Inbox opens the Ask tab, where the "Try the resume again" button is.
- (d) The resume lock records the process that holds it. "Try the resume again" clears a lock only when that process is gone (the same liveness rule as `[▶]`). If it is alive, it refuses by name. Two resumes never run at once.
- (e) Once the resume starts, it shows `[▶]` "working on your answer".
- (f) If a resume took your answer and then died, the run cannot be carried on. It shows `[?]` "crashed after taking your answer — start a fresh run", not pulsing, and does not count in `Inbox (N)`. Replaying the taken answer is out of scope.
- The lock file gains its holder's process number. No other book changes.

**M4c amendment 3 — on time is on time — SIGNED by hamr 2026-10-01 ("sign m4c amendment 3")**
- (a) A resume checks **when your answer was saved** against the ask's deadline, not the clock at the moment it restarts. An answer saved in time is carried on whenever "Try the resume again" is clicked.
- (b) An answer saved after the deadline (for example a hand-written file) is still refused and cancels the run, as M3 says today. An answer with a missing or unreadable saved time is refused by name, never treated as on time.
- (c) A stuck run with an on-time answer stays `[II]` pulsing in the Inbox, and its Ask tab shows "Try the resume again", even after the deadline. The Inbox and the Ask tab always say the same thing.
- (d) An ask that ran out with no answer is `[!]` expired, as today.
- (e) When "Try the resume again" was refused because of a lock it cannot clear (no recorded holder), the stuck label says so: `[II]` "stuck — remove the old resume lock by hand, then try again", with the file path shown in the box.
- No book changes.
- Why: hamr's M4c review walk 2026-10-01 — after the walk fixture's 30-minute asks ran out, the stuck runs still showed `[II]` in the Inbox (and counted in Inbox (N)) while the Ask tab said "expired" with no buttons; resumeRun (src/runner.js ~1782) checks expiry against the clock at resume time, so an answer saved in time is cancelled if the restart comes late. answerAsk (src/ask.js ~296) already refuses a late answer, so a saved answer was on time. And after an empty-lock refusal the label kept saying "click try the resume again", which can never work until the lock is removed by hand.

#### M4c exit evidence — SIGNED by hamr 2026-10-01; from hamr's live walk 2026-10-01

Numbers are from the books on disk under `flows/job2-m6a-2/` (times UTC).

- **Who and how:** hamr, panel only, real provider deepseek-flash, flow `job2-m6a-2`. Three runs. Branch `m4c`.
- **Run `m4c-exit-1` — walked on the panel before the refresh fix.** Run leg pid 09:26:28, first ask parked 09:27:37. hamr found: (1) no page-wide refresh, so the lists and Inbox stayed `[▶]` / "Inbox (0)" after the run parked; (2) while a run worked, the job card said "time unknown" and the header said "no history row yet (parked or died…)"; (3) after Redo (answered 09:31:27, reason "redo babe") the panel-spawned resume had no `DEEPSEEK_API_KEY` (the panel had been started without it), so it was refused at $0 and the run sat `[II]` — amendment 2 working as signed. hamr restarted the panel with the key and clicked "Try the resume again"; the resume pid row is 09:47:28, which proves amendment 2 live. Draft 2 parked 09:48:05, accept (reason "looks good", 09:48:20) with an `artifactSha256` (c617ea67…), a second resume pid row at 09:48:20, outcome `complete`, `spentUsd` 0.030518 (cap $0.25), wall 1311656 ms. The audit usd sum (12 rows) is 0.03051846, equal to `spentUsd`. Fixes made from this walk: d35d545, 1f1c41f, 2daeb49 (one page-wide refresh loop; running-run wording; job card time).
- **Run `m4c-exit-2` — killed by hamr mid-step.** Run leg pid 09:51:30; no history row, no ask. The panel shows it `[?]` gone. Its 3 audit rows sum to $0.012897 of spend with no history row.
- **Run `m4c-exit-3` — on the fixed panel.** Run leg pid 09:55:25, draft 1 parked 09:56:38, redo (reason "redo babe") 09:58:06, resume pid 09:58:07, draft 2 parked 09:59:04, accept (reason "good") 10:03:56 with an `artifactSha256` (c732088f…), resume pid 10:03:57, outcome `complete`, `spentUsd` 0.035863 (cap $0.25), wall 511150 ms. The audit usd sum (11 rows) is 0.03586338, equal to `spentUsd`. hamr: "pass".
- **Spend:** $0.030518 + $0.012897 + $0.035863 = $0.079279 across the three runs (sum of audit usd), against the signed M4c cap of $1.00.
- **Branch reviews:** `/self-review` at 5decfe8: 0 fix now, 7 later. `/branch-review` at 5decfe8: ready, no blockers, fail-first 10/10; docs sweep a429bc0. `npm test` at 2daeb49: 1799 pass.
- **Refresh rates (F54):** /branch-review found (code read) that the one 2 s loop re-drew the Inbox and Runs lists every tick, so a selected row lost its highlight and focus and the lists lost their scroll. The page now polls the open run's own panes every 2 s only while that run is live, the Inbox and Runs lists at most every 10 s, skips any render whose payload is unchanged, and keeps selection, focus and scroll across a rebuild. This does not change the signed scope: scope item 7 and negative (vii) (a typed reason survives three refresh ticks) still hold and are covered by `test/m4c-refresh.test.js`.
- **Open, not in M4c as signed:** the signs key (proposed M4c amendment 4, not signed); the "parked or died" wording on a parked run's header; the panel needs the provider key in its own environment until M4d.

Exit: SIGNED by hamr 2026-10-01 ("sign m4c exit")

#### M4c-fix — clean the fix list before M4d — SIGNED by hamr 2026-10-03 ("sign m4c fix"), EXIT SIGNED 2026-10-04 ("sign m4c-fix amendment 2 and exit version 0.11"); releases as v0.11.0

- **Why:** hamr 2026-10-03: "we have to clean all before we move to m4d". The fix list (`.claude/remember/fix-ledger.md`) holds the reviews' unfixed findings from M2–M4c. hamr's 2026-10-02 triage grouped them into three plans; the rest are folded in here so M4d starts clean.
- **Rulings hamr gave at drafting (2026-10-03):**
  1. No presses-per-minute limit; instead one resume at a time per run (hamr "A").
  2. The panel token moves to a file only hamr's user can read (hamr "Token file 0600").
  3. CI becomes a required check on `main` (hamr "Yes, require it").
  4. Two hand-edit cases are accepted as known limits and dropped (hamr "Accept, drop both"): the 1e-9 USD spend tolerance in `src/runner.js` (economically inert), and a hand-written `answer.json` `answeredAt` that dodges the deadline (amendment 3's signed trade-off; needs write access to the run dir).
- **Scope** — four groups:
  - **A. Panel safety** (`src/panel/server.js`, `src/panel/resume.js`):
    1. One resume at a time per run: a Resume (or an Answer that starts one) while that run is already resuming is refused 409 "already resuming", and no second process starts.
    2. Token file: `fwdloop panel` writes its token to a file only your user can read (mode 0600; proposed `$XDG_RUNTIME_DIR/fwdloop/panel-<port>.token`, else `~/.cache/fwdloop/`), and prints a link `http://127.0.0.1:<port>/?t=<token>`. Opening that link sets a cookie (HttpOnly, SameSite=Strict) and goes to `/`. Every request, the page itself included, needs that cookie; without it, 403 and the page carries no token. How you open the panel changes: open the printed link.
    3. Every response says it must not be framed or cached: `X-Frame-Options: DENY`, `Content-Security-Policy: frame-ancestors 'none'`, `Cache-Control: no-store`.
    4. A flow folder must really sit inside `--root` (checked with realpath), for reads and answers alike; a flow symlinked outside root is refused by name.
    5. Errors never show an absolute path: a 500 says "internal error" and refusals name paths relative to `--root`.
    6. A request body over the size limit is cut off at once, not read to its end.
    7. Two resumes of one run never share one log file, so one finishing can't delete the other's reason.
  - **B. Small crash and leak fixes:**
    8. `fwdloop show` strips terminal control codes (keeps new lines and tabs) from model text before printing.
    9. An `answer.json` that is not an object (e.g. `null`) is refused by name, never a crash.
    10. An unsigned draft folder never shows up as a flow in the panel or Inbox (`fwdloop draft --out` inside the flows root is refused by name); the readout names the flows root.
    11. A drafter's red message is scrubbed of the key before it is printed.
    12. Answer words are looked up only as real entries ("constructor" or "toString" read as unrecognised), in `src/ask.js` and `src/panel/data.js`.
    13. A model-step key red records a valid audit row even when a model is named.
    14. A run parked through a symlinked `--root` resumes (both sides compared by realpath).
    15. Stuck runs: one function decides stuck state and its label from a typed reason, not by matching a refusal string; an unknown lock holder is never called stuck; a panel restart does not cost a wasted click; two resumers never delete each other's lock (unlink only a lock that is still yours).
    16. An answer with no saved time: the stuck label says so ("answer has no saved time — answer again"), not "try the resume again" forever.
    17. An answer saved after the deadline: the panel offers the resume, which records the expiry and ends the run `[!]`, instead of leaving it with no action until someone uses the CLI.
  - **C. Money honesty:**
    18. A spend row marked incomplete counts at the ceiling price toward a run's cap, never only its known floor ("unknown cost is never 0").
    19. A transport retry keeps the first call's refusals and tool tally in the attempt's audit row.
  - **D. Panel refresh, tests and CI:**
    20. A finished run is re-read at the list rate (10 s), so a late change shows without a re-click; a run whose books can't be read drops to the list rate, not 2 s forever; a late reply for a run you already left never paints over the one you opened.
    21. At 320 px a long run title wraps inside the Run header.
    22. Test gaps closed: the fake page honours its selector; the fs-import guard also catches destructured fs, `process.binding('fs')` and `process.getBuiltinModule('fs')`; the key-hygiene test scans a clean resume's log before it is deleted; a test header that credits hamr's walk for F54 is corrected.
    23. CI: `CI / test` is a required check on `main`, and a second push to `main` no longer cancels the first push's run.
    24. The docs index is regenerated by the docs tool.
- **Negatives** (each must be able to fail):
  - (i) a second Resume while one is running gets 409 and no second process starts;
  - (ii) `curl` of `/` without the cookie gets 403 and no token; the token file is mode 0600;
  - (iii) a page from another origin cannot frame the panel (headers present on every response);
  - (iv) a flow symlinked outside `--root` is refused for read and answer;
  - (v) no error body contains an absolute path;
  - (vi) `answer.json` = `null` gives a named refusal;
  - (vii) an incomplete spend row never counts below the ceiling price;
  - (viii) a transport retry's audit row keeps the first call's refusal;
  - (ix) `fwdloop show` of text holding an ESC sequence prints no ESC byte;
  - (x) a PR to `main` with a red `CI / test` cannot be merged without admin override (checked with `gh api` on the branch protection);
  - (xi) a run from before M4c-fix still renders and none of its files is rewritten.
- **Exit:** every fix has a test that went red with the fix taken out; the fix list holds none of the in-scope items (dropped by /refactor revalidation, not by hand); a real browser walk at 1280 and 390 opens the panel by the printed link, shows a run, answers an ask, and a second Resume is refused; hamr opens the panel by the printed link and signs.
- **Cap:** $0 — no paid model runs needed (fakes and the existing books).
- **Not in scope:** Settings (M4d); a Run button (M4e); per-run read/write folders; new answer words; any change to an existing book's shape beyond the token file; the two accepted hand-edit limits.
- **Known limits written down:** the 1e-9 USD spend tolerance; a hand-written in-time `answeredAt`; the panel trusts your own user's programs (anything running as you can read the token file).; "Remove the old lock" (amendment 2 (h)) re-checks the holder twice but a resume can still take the lock between the last check and the unlink, which deletes that resume's fresh lock (amendment 3 (d): "cannot close it fully").
- **Later ruling, not a signed amendment (hamr "1A", 2026-10-03, built in d1aa5fb after the scope was signed):** the panel token is reused across restarts while its file is still mode 0600 and owned by you (a loose, foreign or junk file gets a new token), so a bookmark of the page keeps working once the printed link was opened; a bare browser `GET /` without the cookie gets a plain 403 page that says to open the link the terminal printed, not blank JSON (API routes keep the JSON 403).
- **Branch-review fixes, not a signed amendment (2026-10-04, d87656d..c99df79):** (1) a resume whose lock-holder write fails (disk full or file-size limit) removes the empty `resume.lock` that same call just created and refuses by name, so no stuck lock is left behind; a lock another resumer made is never touched. (2) A failed page load is one of three plain sentences, painted from one function in the page: 403 "The panel does not recognise this page. Open the link the terminal printed.", 404 "This run is no longer there.", anything else (including no network) "Could not load this; reload the page." Run, Ask, Workflows, History and Inbox all use it (amendment 2 (b)).

**M4c-fix amendment 1 — a broken answer gives the buttons back; an expired ask can be reopened by you — SIGNED by hamr 2026-10-03 ("sign m4c-fix amendment 1")**
- (a) **A broken answer gives the buttons back.** You click an answer and the buttons dim. If within a few seconds the answer turns out broken (refused, or saved without a readable time), a short note says why and the buttons come back, so you can answer again. A broken saved answer is moved aside as a record (never deleted) so it does not block the new one. Replaces scope item 16's "answer again" label, which pointed at an answer the panel could not take.
- (b) **An expired ask can be reopened, by you only.** An ask whose time ran out (no answer, or an answer that came after the deadline) shows `[!]` expired with one button, "Reopen for another <wait>" (the flow's signed wait, e.g. 30 min). One click starts a fresh window of the same length on the same draft, and the answer buttons come back. A late answer is moved aside as a record. The audit records who reopened it and when. The flow's signed wait does not change; only a human click reopens; the machine never does. A reopen is not an answer word. Replaces scope item 17's "Resume — record the expiry" button.
- (c) A run you never reopen stays `[!]` expired and spends nothing. If a run is ended because its ask expired (e.g. by `fwdloop resume` from the terminal), it reads `[!]` expired, never `[✗]` failed.
- (d) Later, not now: a flow may say "no reopen" when it is signed (for jobs that go stale, like "reply today"). Until then every flow allows reopen.
- (e) **Four rulings from the build (hamr "ok to all", 2026-10-03):** an answer is not refused as "already resuming" while the previous resume is only closing and the run already waits on you; when a new resume starts, the old finished resume's log is deleted; the child's output quoted in a resume's reason is scrubbed of the key; the Run tab's asks, audit and job fetches get the same late-reply guard as the detail fetch.
- No change to an existing book's shape beyond new records: the moved-aside answer and the reopen row are new write-once files or rows, keyed by id; nothing existing is rewritten.
- Why: hamr 2026-10-03, while the build of items 16-17 showed both as signed could not work ("answer again" with no way to answer; "record the expiry" ends a job that may not have gone stale). hamr: "if 2-3 seconds and it's broken, feedback tooltip and reallow/undim button"; "it expired (why? safety?) same button changes unlock to answer, click once ... i start a new 30 mins".

**M4c-fix amendment 2 — plain words on the panel — SIGNED by hamr 2026-10-04 ("sign m4c-fix amendment 2 and exit version 0.11")**
- (a) **Every stuck or expired state shows one clear button and one short line saying why.** Replaces the wording signed in M4c amendment 2 and amendment 3 (e):
  - stuck button "Try the resume again" → "Continue the run";
  - stuck label "stuck — answer saved, click try the resume again" → "stuck — your answer is saved; the run stopped before using it", with the line "Your answer is saved; the run stopped before using it.";
  - lock label "stuck — remove the old resume lock by hand, then try again" → "stuck — an old resume lock is in the way", with the line "An old resume lock is in the way." and the (h) button;
  - expired ask keeps amendment 1's button "Reopen for another <wait>", with the line "Nobody answered in time." or "Your answer came after the deadline."; the Inbox row for that ask shows the same line;
  - a run ended by expiry reads "expired" everywhere (Inbox, Ask tab), never "accepted".
- (b) **Every message the panel shows you is a plain sentence:** never an HTTP code, a refusal code, an ask id, a file path, or a library function name.
- (c) **A redo or rerun with an empty reason is stopped on the page** with "Please write a reason for the redo." (or "rerun") before anything is sent. The server still judges every answer; the page check only saves a round trip, so the panel stays a client of the arbiter, never a second arbiter (M4b).
- (d) **Every Ask block names its flow and run first** ("job2 (run-id) · …").
- (e) **Clicking a waiting `[·]` or stuck `[II]` run in Runs always opens the Inbox on its ask,** judged from that run's fresh state at the click, never from a list up to 10 s old.
- (f) **On a phone or any window up to 640 px wide, each Audit entry is one line** (sign, step, result, cost, time); a tap opens its full step, result, action, gap, refused list, close, cost and time. In the Grouped view (all widths) a closed step is one line with ▶, open shows ▼; a step with any failed try starts open, others start closed; a manual open/close wins until another run is opened; a long step name is cut as (l), never past its own box. On a phone the gap shows after one tap on the failed line, never without it (hamr 2026-10-04: "A").
- (g) **One bold word after every sign**, from one table, the same in Runs, Inbox, the run header and the step map, then a dash and the plain line: `[▶]` **running**, `[·]` **waiting**, `[II]` **stuck**, `[!]` **expired**, `[?]` **crashed**, `[✓]` **passed**, `[✗]` **failed** (e.g. "`[II]` **stuck** — your answer is saved; the run stopped before using it"). Layout as bareloop: a Runs row is line 1 sign + run name, line 2 **word** — why, line 3 cost · date · runs; an Inbox card is sign + name, then **word** — why; the run header follows (k). No legend: each step card and map node wears its own sign and word; a step not started shows none. Exceptions: a run ended by rerun keeps `[✗]` with no word (M4b amendment 3: never called "failed"); Inbox past rows (accepted, expired, redo) keep their badge, no sign word.
- (h) **A button to remove an old resume lock.** When a lock has no recorded holder, the panel shows "Remove the old lock". One click asks once: "Only do this if nothing else is working on this run. Remove it?" On yes the lock file is removed, an audit row records that you removed it and when, and the run continues. Only a human click does this; the machine never removes a lock it cannot judge. Replaces "remove this file by hand". The panel shows only this button in that case (not "Continue the run" too). If something starts working on the run between the page drawing and the click, it is refused with a plain sentence and the lock is left alone.
- (i) **Clicking a run that needs you opens both sides on it:** a waiting `[·]`, stuck `[II]` or expired-with-Reopen `[!]` run moves the left side to the Inbox with its ask selected and the right side to the Ask tab, where its buttons are. Any other run opens on the Run tab. Judged from that run's fresh state at the click, as (e).
- (j) **A step with one try opens in one tap:** in the Grouped Audit, tapping the header of a step that has a single try opens that try's full detail at once; a step with several tries opens to one line per try, and each opens on its own tap.
- (k) **The run header reads like its Runs row:** sign + run name first, then **word** — why, then the asked/started time. One line on a wide screen (`[II] job2 (run-stuck) │ **stuck** — your answer is saved; the run stopped before using it · asked 10/4/2026, 6:01 PM`); on a phone the same three parts on three lines. No ┤ ├ frame and no capitals on the name. Replaces the header order in (g).
- (l) **An Audit step's title line is short:** `[sign] step name · cost · try N ✗✓`; a name too long for one line is cut with … and shown whole when the step opens. Time and tokens live in each try's detail, not the title. On a phone (≤640 px) the dots and the word "try" drop (`[sign] step name $cost N ✗✓`) so a name up to about 24 characters shows whole at 390 px. The step map cuts a long name the same way; the whole name shows on its step card.
- No book changes beyond the audit row in (h).
- Why: hamr's M4c-fix exit walk 2026-10-04 — "try resume again? weird message"; a raw "HTTP 409 — answerAsk: askId … needs a non-blank reason to redo"; a run ended by expiry read "accepted"; Runs → Inbox jump inconsistent for `[II]`; mobile Audit rows still not one line between 481 and 640 px; hamr 2026-10-04: "no legend needed ... choose a word for the non obvious ones ... one keyword in bold followed by -"; lock: "A" (a button, not by hand); layout: hamr 2026-10-04 picked "A" (match bareloop); Audit grouped boxes drew empty on desktop and phone (exit walk 2026-10-04); hamr 2026-10-04: Reopen sat on the Ask tab while the click landed on Run — "take me to inbox and open right pane on ASK"; two taps for a one-try step on a phone; hamr 2026-10-04: the Inbox row of a still-open expired ask said only "expired"; hamr 2026-10-04: header should read "job2 (run-stuck) | stuck — … asked …"; an Audit title "is not a header" with time, cost, tokens and tries in it.

**M4c-fix amendment 3 — four self-review findings — SIGNED by hamr 2026-10-04 ("sign m4c-fix amendment 3, check twice")**
- (a) **Inbox question:** `fwdloop inbox` cleans hidden terminal codes out of the question before printing it, the same way `fwdloop show` already does.
- (b) **Reopen:** if the late answer can't be moved aside, the Reopen is refused with a plain sentence: "Could not clear the late answer; nothing was reopened." No reopen record is written and the clock is not reset. Moving the answer aside happens first, and the reopen record is written only after that works, so a stale answer can never count as fresh.
- (c) **Two Inbox words:** "answer saved, resume starting" → "your answer is saved; the run is picking it up"; "answer saved, resume not started" → "your answer is saved; the run stopped before using it" (the same line the stuck sign already uses).
- (d) **Lock window — check twice:** right before removing the lock, check one more time that nobody holds it. This makes the gap much smaller but cannot close it fully; the remaining gap is a written known limit.
- Why: /self-review 2026-10-04 (ledger items @ de0e0c7): `fwdloop inbox` printed a model-written question raw; a failed set-aside after a reopen let a stale late answer count as on time; two Inbox labels still read as internal state; a resume could take the lock between the check and the unlink.

**M4c-fix amendment 4 — step cards in lower case — SIGNED by hamr 2026-10-04 ("sign m4c-fix amendment 4")**
- (a) **The step cards under the map read in their real case:** `1 · resume-text   [✓] passed   [human check]`, never capitals; the sign badge is one `[sign] word`, the same as the map node, never double brackets.
- Why: hamr 2026-10-04: "under maps, all headers should be lower case"; the card badge read `[[✓] PASSED]`.

**Exit evidence (2026-10-04) — EXIT SIGNED by hamr 2026-10-04 ("sign m4c-fix amendment 2 and exit version 0.11"):**
- hamr walked the practice root (`scripts/panel-fixtures/walk-root.mjs`) by the printed link at desktop and 390 px, three sheets, all pass: Runs/Inbox/header sign words; Continue the run and Remove the old lock to [✓] passed with the audit row; Reopen on an expired ask; empty redo reason stopped on the page; Grouped and Flat Audit with the gap one tap away; run header and short Audit titles.
- Every amendment 2 piece has a test that went red with the fix taken out alone; suite 1902 pass / 0 fail, typecheck clean, at 8821b90.
- Negative (x) closed 2026-10-04 after signing: hamr ran `gh api -X PUT repos/hamr0/fwdloop/branches/main/protection` in his terminal (the session's gate refuses it); the response shows `required_status_checks.contexts: ["test"]` with every other protection field unchanged (1 review, stale reviews dismissed, linear history, conversation resolution, no force push or deletion, admins not enforced).
- Version: hamr ruled v0.11.0 (not v0.10.1).

#### M4d — Settings: keys, providers, money — SIGNED by hamr 2026-10-05 ("sign m4d"), cap $0.25; amendment 1 and EXIT SIGNED 2026-10-05 ("sign m4d amendment 1 and exit")

- **Why:** the ladder order agreed 2026-09-30: M4c, then M4d (Settings: providers, keys, money, ported from bareloop), then M4e (run a job from the panel). Today a key reaches fwdloop only from the shell that started it (`pass` loaded by hand, and the panel needs it in its own environment for a resume), there is no monthly money limit at all (each run has only its signed cap), and the prices live in code. M4e's Run button spends money, so the key and the monthly limit come first. hamr 2026-10-05: "let's start m4d".
- **Rulings at drafting (hamr 2026-10-05):** "1A" — a keys file other users can read is refused, not warned; "2A" — the page shows providers, it does not add or edit them (model and address stay in code); "yes balance too"; "editable on page" — prices are set on the page. That last one **replaces the 2026-09-21 ruling** ("a rate changes by editing a row here, never a second table or a runtime flag"): from M4d the code table is the default and a price typed on the page wins.
- **Ported from bareloop** (P4a: `src/keysfile.js`, `src/config.js`, `src/monthly.js`, `src/panel/settingsroutes.js`) by copy with a `borrowed-from` header. bareloop's lessons taken (`loop`, 2026-10-05): every model call uses the same price — runs, resumes and drafts — or some rounds book at a guess (bareloop booked DeepSeek ~28× its real bill and a run died on its cap); a changed price applies forward only; unknown cost is never $0; every spend row names its provider, so no money lands on a "not recorded" row.
- **Scope:**
  1. **The keys file.** `~/.config/fwdloop/.env`, mode 0600, `NAME=value` lines typed by hand. It is created empty (commented key names, 0600) when missing. The CLI (`run`, `resume`, `draft`) and the panel read it through one loader; a key exported in the shell wins over the file. The panel's resume child gets the merged keys, so the panel no longer needs `pass` in its own shell. **A file other users can read or write is refused** (ruling 1A): nothing that needs a key runs, and the page and the terminal say "Your keys file can be read by other users. Run: chmod 600 ~/.config/fwdloop/.env". No page, route, reply, log, audit or book ever carries a key value, and no route writes the keys file.
  2. **Settings page, Providers tab.** A `[ ⚙ Settings ]` button in the panel header opens it, with a Back button. A strip names the keys file path, says keys are typed into it by hand and never shown here, and has `[ Reload keys ]`. One row per provider fwdloop knows (deepseek, synthetic; ruling 2A — show only): key name, **set / not set** (or "found in shell"), model, address, **Test**, tokens used, **Balance**, and the **price**.
     - **Test** asks the provider for its list of models. It never asks for a completion and costs $0. It shows "OK · N ms" or a plain why.
     - **Balance** (DeepSeek only — the one provider with a free balance call) shows the account's credit left, read on a click, $0. Other rows say "not offered by this provider".
     - **Price** (ruling "editable on page"): three boxes per row, USD per 1M tokens — input, cached input, output. Empty = the code table's price, shown greyed as the default. A typed price is saved to `~/.config/fwdloop/config.json` and wins from the next model call on; it never changes a run already booked. Each box takes a number above 0; anything else is refused on the page with a plain sentence. Thinking tokens are priced as output (they arrive inside the output count).
  3. **Settings page, Money tab.** `$ this month / to date` and `tokens this month / to date`, each with "at least" (`≥`) when any cost in it is unknown. A **monthly limit** box: raise it, lower it, or empty it to have none (hamr's standing rule: free up or down). Under it: "A run whose cap is more than what is left this month does not start." A **per-provider breakdown**: provider · $ month / to date · minutes month / to date · tokens. "This month" is the local calendar month. The per-run cap is not on this page and cannot be changed here; it stays signed.
  4. **The monthly check.** Before a run starts, before a resume, and before a draft: if the money still needed does not fit in what is left this month, it refuses at $0 with "Nothing spent. Raise the monthly limit in Settings, or wait for next month." and the amount. A run or resume holds its cap (a resume: its cap minus what the run already spent) while its process lives, so two runs started together cannot both slip past the limit; a dead process's hold is freed by the next check, using M4c's one "is it running?" function. A draft has no signed cap, so it holds one ceiling round. With no limit set, nothing is checked and nothing is held. An unreadable or broken `config.json` refuses by name; it never reads as "no limit".
  5. **One record of holds and spend across roots.** `~/.config/fwdloop/runs.jsonl`, append-only, one row per hold and per settle (bareloop's claim shape). Month spend is read from each held run's own books, so the total is the same whichever `--root` a run used.
  6. **One price, every model call.** Runs, resumes, model steps and the drafter all take the price from one lookup (page price, else code table, else the highest rate in the table), and every spend row records the provider and the price it was booked at.
- **First POC (riskiest assumption, $0 except one tiny paid call):** (a) a canary key planted in the keys file never appears in any page, reply, log, audit, book or the resume child's log, across Settings, Test, Balance, a run and a resume; (b) fwdloop's booked cost for a real DeepSeek round with cache hits matches DeepSeek's published cache-hit price (`loop` 2026-10-05: cache hits dominate input, bare-agent prices them at 0.1× input by default). If (b) does not match, hamr sees the numbers before anything changes.
- **POC result (2026-10-05, $0.0015 paid):** (a) a key from the file is scrubbed like a shell key when the merged env is the one env handed to both the resume spawn and its scrub list — no leak; ten call sites read keys from `process.env` only and must take the merged env (list in `poc/m4d/RESULTS.md`). (b) fresh input and output book exactly right; a DeepSeek cache hit books at $0.03/M against a real $0.006/M (bare-agent's 0.1× default), so cached calls book ~1.6× real at peak; no double count. **Ruling "A" (hamr 2026-10-05):** the code table carries DeepSeek's published cache-hit price for deepseek-flash, $0.006/M (peak), as the default.
- **Negatives** (each must be able to fail):
  - (i) a canary key value never appears in any response, page, log, audit, book or child log;
  - (ii) no route writes the keys file; a POST that tries is refused;
  - (iii) a keys file with group or other read bits refuses every keyed command and shows the chmod sentence;
  - (iv) a key exported in the shell wins over the file;
  - (v) a run, a resume and a draft over the limit each refuse with $0 spent and the plain sentence;
  - (vi) two runs started together whose caps fit alone but not together: exactly one starts;
  - (vii) a killed run's hold is freed on the next check;
  - (viii) a broken `config.json` refuses by name, never runs with no limit;
  - (ix) Test and Balance make no completion call and book no spend row;
  - (x) a price changed on the page books the next call at the new price and leaves every earlier spend row and month total unchanged;
  - (xi) a price box with 0, a negative, or text is refused and nothing is saved;
  - (xii) the drafter, a model step and a resume all book the page price — none falls back to the code table while a page price is set;
  - (xiii) unknown cost reads `≥$X`, never $0, in both tabs and the breakdown;
  - (xiv) the per-run cap is shown nowhere on Settings as editable, and no settings route changes a flow;
  - (xv) the Settings page works at 390 px and 320 px: no box spills, no page scroll sideways.
- **Exit:** hamr, live on deepseek-flash: puts his key in the keys file by hand, starts the panel **without** `pass` loaded; Test shows OK; Balance shows his credit; sets the monthly limit below a run's cap and `fwdloop run` refuses at $0 with the sentence; raises it, the same run goes through, and the Money tab's month total and the DeepSeek breakdown row go up by the run's cost; types a deepseek-flash price, runs again, and that run's spend rows show the new price while the first run's stay as they were. The orchestrator walks Settings at 1280, 390 and 320 px first, at $0.
- **Exit evidence (2026-10-05, live, deepseek-flash, key only in the keys file, shell `env -u DEEPSEEK_API_KEY`):** Test OK and Balance shown; limit $0.10 refused run `m4d-exit-2` at $0 with the sentence (`runs.jsonl` refused rows); limit raised to $5, `m4d-exit-2` parked, accepted, complete, $0.0270; Money month total and the DeepSeek row went $0 → $0.0270; page prices in 0.4 / cached 0.4 booked on every `m4d-exit-2` spend row (`source: settings`) while `m4d-exit-1` (12:15, before any page price) keeps 0.3 / 0.006 (`source: table`). Found on the walk and fixed after signing: a run started with no limit set was never recorded, so its spend ($0.0185, `m4d-exit-1`) is in no Money figure — see the fix commit; that one run stays uncounted (F55 in `docs/logs/FINDINGS.md`).
- **Cap:** $0.25 (two short live runs plus the cache-price check).
- **Not in scope:** a Run button (M4e); adding or editing a provider, model or address on the page (ruling 2A); a balance for providers without a free balance call; editing a flow or its cap; per-run read/write folders.
- **Amendment 1 — SIGNED by hamr 2026-10-05 ("sign m4d amendment 1 and exit") (ruling: "name should be text > shape should be drop down > base url should be text"):** on the Providers table, **Name** (the model id) is a text box, **API shape** is a dropdown, **Base URL** is a text box — exactly as bareloop's Settings (bareloop `src/panel/index.html`, `src/panel/settingsroutes.js` `/api/settings/providers/row`, `src/providerrows.js` `SHAPES` @5a5a811). This **replaces ruling 2A for these three fields**; the rows are still fwdloop's fixed provider slots (no adding or removing a provider).
  - **Where it lives:** saved to `~/.config/fwdloop/config.json` under the provider slot; empty = the code default (shown greyed as the placeholder). Saved on change, one field at a time.
  - **When it applies:** from the next model call on; it never changes a run already booked.
  - **One lookup:** every model call (run, resume, model step, drafter, Test, Balance) reads the slot's model, shape and address through ONE function (same rule as prices: page value, else code default).
  - **Refusals:** the Base URL must be blank (= the code default) or an http(s) address, else the page says so in a plain sentence and nothing is saved. An empty model id or a shape not in the list is refused the same way.
  - **Money:** a model id the price table does not know is priced at the table's highest rate (unknown cost is never $0).
  - **Balance** shows only for a slot whose shape is OpenAI-compatible and whose host is `api.deepseek.com` (bareloop's rule); other rows say "not offered by this provider".
  - **Risk, one line:** the key is sent to whatever Base URL is saved; the page is local and token-gated, same as bareloop.
  - **Negatives:** (a) a bad Base URL, an empty model id or an unknown shape is refused and nothing is saved; (b) a saved model id is what the next run's spend rows record, and it is priced by the one lookup; (c) a run already booked keeps its recorded model and price; (d) no route writes the keys file and no key value appears (unchanged).
- **Amendment 2 — SIGNED by hamr 2026-10-06 ("sign m4d amendment 2"): no Cached input box; cached input is priced as input.**
  - **Why:** hamr 2026-10-06: "remove cached in column from settings > providers", ruling "cached is same as input". Replaces the "cached input" box of M4d scope item 2's **Price** line (three boxes become two: input, output).
  - **1.** The Providers table shows **In $/1M** and **Out $/1M** only; the **Cached in** column is gone.
  - **2.** Cached input tokens are priced at the row's input price (the typed In $/1M, or the code table's input price when empty). Never cheaper than input, so cost is never under-counted; with a provider that discounts cached tokens it can over-count, which is the safe side.
  - **3.** A `cachedInPerM` already saved in `~/.config/fwdloop/config.json` is no longer read for pricing and is never shown; the file is not rewritten. The code table's own cached rate (`cacheIn`, the 10% default multiplier) is no longer used for pricing either. One function sets the cached rate; every caller reads it.
  - **4.** Runs already booked keep their recorded costs; this applies from the next model call on.
  - **Negatives:** (a) the Providers table has no Cached in column or box at 1280, 390 and 320 px; (b) with input $0.40/1M and a saved `cachedInPerM` of 0.04, a round with cached tokens books them at $0.40/1M; (c) with In $/1M empty, cached tokens book at the table's input price, never its cached rate; (d) a POST that sets `cachedInPerM` is refused and saves nothing.
  - **Cap:** $0 (build and tests with stub providers).
- **Built after signing — not signed text (2026-10-05):**
  - F55 fix: every run, resume and draft now writes a record row to `runs.jsonl` even with no monthly limit set ($0 hold, nothing held), so its spend is counted; a row that cannot be written refuses by name.
  - A shell with `NODE_ENV=test` (or a `node --test` child) and no `FWDLOOP_CONFIG_HOME` refuses a real run, resume or draft at $0 with "fwdloop: NODE_ENV=test is set without FWDLOOP_CONFIG_HOME, so the keys file, prices and monthly limit would be skipped. Nothing spent. Unset NODE_ENV, or set FWDLOOP_CONFIG_HOME."
  - Test and Balance never follow a redirect with the key; a 3xx reads "The provider answered with a redirect; the key was not sent on. Check the Base URL."

#### M4e — Chat: describe, draft, sign and run a job from the panel — SIGNED by hamr 2026-10-05 ("sign m4e"), cap $0.50

- **Why:** the ladder order agreed 2026-09-30: M4c, then M4d (Settings), then M4e (run a job from the panel). Today a job is drafted, signed and run only from a terminal (`fwdloop draft`, `fwdloop sign` at a TTY, `fwdloop run`). M4d put the key and the monthly limit in place first, because this card spends money. hamr 2026-10-05: "start m4e", then "1. you will also copy same ui and change captions/add remove as needed to fit fwdloop".
- **Rulings at drafting (hamr 2026-10-05):**
  - **"1"** — M4e is bareloop's whole Chat card: one button that drafts, signs and runs. This **pulls M6b (the authoring UI) into M4e**; M6b is no longer a separate module.
  - **Same UI as bareloop, fwdloop captions** — the Chat tab, the job card, the one main button, the progress list and the ask box are copied from bareloop's panel; labels, fields and buttons are changed, added or removed only where fwdloop's shape differs (listed below).
  - **"Type a path"** — each input is a text box holding a file path, as `--source` on the command line.
  - This module **replaces the 2026-09-26 ruling "no Run button in M4"** (that ruling was for M4a/M4b; the 2026-09-30 ladder order added M4e).
  - This module **amends M6a amendment 2** ("sign needs a human TTY and a typed flow name; never sign from a script"): a flow may also be signed **on the page**, by the two-click hash sign (below) **plus the flow name typed into a box**. The CLI `fwdloop sign` keeps its TTY rule unchanged. A script still cannot sign: the page sign needs the panel token, the typed name, and the hash the page was shown.
- **Ported from bareloop** (branch `feat/panel-import-run`, reviewed at `ca7195e`; `loop` 2026-10-05) by copy with a `borrowed-from` header: `src/panel/index.html` Chat section (`mainButtonFor`, `askBoxOpenFor`, `renderProgress`, `attachSession`/`reattachLive` without the reuse/auto-sign branch, `syncCardLock`, `CLIENT_TERMINAL_PHASES`, `openNewCard`/`resetCard`/`refreshStartEnabled`, the scroll-on-change block in `renderActions` (`scrollIntoView({block:'nearest'})` only when `renderProgress` reports a change, never `.focus()`), `staleTokenCheck` together with its `authorPost`/`authorGet` wrapper and `staleTokenHook`, `fitBox`); its CSS (`--field-bg`/`--field-soft-bg`/`--field-border` tokens in light and dark, `.jf-wrap`, `.locked`, the `wait` step class, the one `#panel-chat` focus rule); `src/panel/authorroutes.js` (the `/api/author/*` routes including `abandon`, `checkHumanGuard`, the one spawn site, the server lock `hasLiveSession` + `TERMINAL_PHASES`); from `src/panel/authorsession.js` the step table (`STEP_LABELS`, `PHASE_STEP`, `advanceSteps`, `latestStep`) and the state's `card` field (for re-attach); `src/draftspend.js` (`writeDraftSpend`, atomic per call; `readOrphanDraftSpends`) and the `src/monthly.js` hook that counts it.
- **Not ported (bareloop-only, `loop` 2026-10-05):** the unattended run after sign; auto-sign on Reuse; one cap covering drafting + run (fwdloop's per-run cap is signed and covers the run only; drafting is booked on its own, as M4d); signing gates that need a red seed; Stop-at-round-seam / Resume legs; scouting a source repo, copying a repo, the install-needed pause and Check again; the revise-menu ("N changes left"); Model, Check type, Goal, Success, Judge examples and Time cap fields. fwdloop's drafter is one forced call with no questions back, so the ask box is used only for the sign step's typed name.
- **Scope:**
  1. **Chat tab, one job card, always shown.** A `Chat` tab in the panel header. The card is empty when nothing is live; top-right: **Abandon** while a draft is live and unsigned, else **Clear**. Two modes on a radio row at the top of the card: **New job** and **Run a signed flow**.
  2. **New job fields (fwdloop captions):**
     - **Flow name** — the same name check as the CLI.
     - **The job** — numbered lines, each line's guardrails under it (`guardrail: ...`), asks written as `ask 30m: ...` — the PRD's intake shape, strict 1-for-1.
     - **Cap** — $ per run (becomes `guardrail: cap $X per run`).
     - **Send to** — line number and a `file:` folder (becomes `guardrail: send at line N to file:<folder>`), or empty for no send.
     - **Inputs** — one row per input: role and path (becomes `guardrail: source <role> = file:<path>`).
     The card writes exactly the prose file `fwdloop draft` reads today; the arbiter guardrails are typed by the human on the card, never by the drafter (hard line unchanged).
  3. **The one main button (bareloop's `mainButtonFor`, fwdloop states):**
     - empty or filled card, nothing live → **Draft** → $0 checks on the card first (below), then spawns `fwdloop draft` as a detached child into a draft folder; the card locks.
     - draft running → button disabled, progress shows one "drafting" line.
     - draft red → the reds show in plain sentences; the button reads **Fix and draft again** and unlocks the card (the old draft is kept on disk, never reused).
     - draft green → the plan shows (steps, which line each step serves, its tools, its close, the asks with their TTLs, the send line and the cap) with its hash; button **Sign & run**. A first click shows the box "Type the flow name to sign" and changes the button to **Sign `<hash8>` & run — spends up to $`<cap>`**. A second click with the typed name matching signs and starts the run.
     - Run a signed flow mode → pick a signed flow (only flows whose `readFlow` passes are listed); inputs filled from the last run of that flow; Run id prefilled; button **Run — spends up to $`<cap>`**.
  4. **Sign on the page.** The server signs only when the click's hash equals the draft's hash on disk and the typed name equals the draft's `target.json` name; it calls the same `signDraft` as `fwdloop sign` (all its $0 checks: hash, wired verbs, goals, TTL, sources, send, leak sweep). `signedBy` is the panel's OS user. Any mismatch refuses, signs nothing, spends nothing.
  5. **One door, the CLI.** Drafts and runs start only as detached CLI children (`fwdloop draft ...`, `fwdloop run ...`), array argv, no shell, own process group, `unref()`, the merged keys env, output to a log in the draft or run folder — the same shape as the panel's resume. So the keys-file mode check, the empty-key refusal, the monthly hold, the unwired-verb preflight and the input freeze apply with no copy. Draft and run state live in files, never only in panel memory, so a refresh or a panel restart re-attaches the card (bareloop's `/api/author/live` + `attachSession`).
  6. **$0 checks before any spawn** (bareloop's lesson: every refusal before any model call). Each input path is checked with `realpathSync` at the click: exists, is a regular file, readable; every declared role has a path and no extra role; the send folder resolves; the flow name and run id pass the CLI's own checks and do not exist yet; the cap is a number above 0. A refusal names the box, says why in a plain sentence, spends $0 and creates nothing. The page never reads or shows an input file's contents.
  7. **One click, one start.** The card is locked as a whole while anything is live (`syncCardLock`); the main button is disabled from the click until the reply; the server holds a lock per flow name while it spawns, so two clicks or two tabs start one draft or one run.
  8. **After the run starts.** The card clears (the run lives in Runs, as bareloop). The run shows on Runs with M4c's working sign, parks at its ask, and is answered in the Inbox/Runs as today. If the child exits before its first book row (a CLI refusal), the card's error line shows the CLI's own sentence, persisting, and nothing is marked spent. "Did it start?" uses M4c's one "is it running?" function, never a timer.
  9. **Money on the card.** The card shows the cap and **left this month** (or "no monthly limit set"), as a courtesy; the server's monthly check is what refuses. Draft spend is booked per call to the draft folder and counted in Money (bareloop's draft-spend lesson), never only in memory.
  10. **Stale page.** A panel restart changes the token; an old tab shows "The panel restarted. Reload this page." (`staleTokenCheck`), never a raw "wrong token".
  11. **Abandon.** Abandon on a live draft stops its child by pid (M4c's one "is it running?" function confirms it is gone), freezes its state on disk, makes no further model call, and keeps its spend booked. A finished but unsigned draft is abandoned the same way, with no child to stop.
  12. **Live state from files, never memory.** `/api/author/live` is read from the draft folders plus the pid liveness check, not an in-memory map. A dead draft child is read as stopped (its last state frozen), so it never holds the lock and never blocks a new card.
  13. **Draft spend counted once.** Draft spend is booked per call to the draft folder (`writeDraftSpend`) and counted by Money and the monthly check from there. The run that follows a sign never folds the draft's spend in again, and its per-run cap covers the run only.
  14. **Progress list and ask box (bareloop's rules).** One chronological list under the card, above the ask box: a waiting step has no ✓; a step's detail sits on its own "> " line; one "drafting" line carrying the model and cap, with no early duplicate; no repeated identical lines; it scrolls into view on change and never steals focus. The ask box is dimmed and emptied unless it has a purpose — in fwdloop only the typed-name sign step. One main button only, never a second Sign button. A refusal from a child is shown in its own error line (`#chat-action-error`) that the poll never wipes, separate from the poll-owned status.
- **First POC (riskiest assumptions, $0, stub provider):** (a) page sign binds to what the human saw: a draft changed on disk after the plan was shown is refused at sign, and a POST with no typed name or the wrong name signs nothing; (b) a draft child and a run child started by the panel survive a panel kill, and a restarted panel re-attaches the card from files and shows the run parked at its ask; (c) a canary key from the keys file never appears in the card, any reply, either child log, the audit or a book. If any fails, nothing is built until hamr has seen it.
- **Negatives** (each must be able to fail):
  - (i) a page sign with a stale hash, a missing typed name, or a wrong typed name signs nothing and writes nothing;
  - (ii) a sign or start POST without the panel token, or as a GET, is refused;
  - (iii) an input path to a folder, a missing file or a broken symlink is refused by name, $0, nothing created; a symlink is checked at its real target and the frozen copy's sha256 matches that target;
  - (iv) a missing or undeclared input role is refused, $0;
  - (v) an existing flow name or run id, or one with `/` or `..`, is refused, $0;
  - (vi) two Draft or two Start requests sent together for one flow start exactly one child;
  - (vii) over the monthly limit, the draft and the run each refuse at $0 and the card shows "Nothing spent. Raise the monthly limit in Settings, or wait for next month.";
  - (viii) a keys file other users can read refuses both, and the card shows the chmod sentence;
  - (ix) no key value appears anywhere (canary, as M4d (i));
  - (x) only flows whose `readFlow` passes appear in Run a signed flow; a POST naming an unsigned or tampered flow is refused;
  - (xi) killing the panel mid-draft and mid-run leaves both going; a restarted panel re-attaches the card and shows the run working, then parked;
  - (xii) the drafter never writes the cap, the send target, an ask's TTL or an input path: they come only from the card's typed fields (hard line);
  - (xiii) the CLI `fwdloop sign` still refuses without a TTY (M6a amendment 2 unchanged for the CLI);
  - (xiv) a refreshed tab while a draft is live re-attaches; it never shows an empty card with the lock still held;
  - (xv) the Chat tab works at 1280, 390 and 320 px: textareas wrap, no box spills, no sideways page scroll; editable fields white, locked grey, focus blue (bareloop's rule);
  - (xvi) Abandon on a running draft stops its child, books no further model call, and keeps the spend already booked;
  - (xvii) a draft child killed from outside never leaves the card locked: the next load reads it as stopped and a new card can start;
  - (xviii) a draft that is signed and run is counted once in Money and the monthly check — the run's books never carry the draft's spend.
- **Build notes (`loop` 2026-10-05):** after any commit, restart the panel before judging the UI (the page is read fresh from disk, the routes only at start), and never restart while a draft is live; the orchestrator's screenshots wait for the page's fetch to finish, never right after a click; every test runs with a scratch HOME and `FWDLOOP_CONFIG_HOME`, never the real one.
- **Exit:** hamr, live on deepseek-flash, from the panel only (no `fwdloop` command typed): fills a New job card for a small job with one ask, clicks Draft, reads the plan, types the flow name and signs; the run shows working, parks at its ask, he answers it on the page and it completes; its cost shows on the run and the draft's cost and the run's cost both show in the Money tab. Then, in Run a signed flow, he runs the same flow again with its inputs filled in. Then he sets the monthly limit below the cap and clicks Run: the card shows the refusal and $0 spent. The orchestrator walks the Chat tab at 1280, 390 and 320 px first, at $0, and compares it side by side with bareloop's Chat tab.
- **Cap:** $0.50 (a few drafts plus two short live runs).
- **Not in scope:** triggers or schedules (a run starts only on a click); uploading a file through the page; a file or folder picker; editing a signed flow or its cap; per-run read/write folders; stopping a running run from the page; drafter questions back to the human (fwdloop's drafter asks none).
- **POC result (2026-10-05, $0, stub providers; `poc/m4e/RESULTS.md`):** (a) page sign binds to what the human saw — PASS 14/14 (a draft changed on disk after its hash was read is refused; a missing, empty, wrong, wrong-case or trailing-space name is refused; nothing is written on any refusal). (b) a draft child and a run child spawned the panel's way survive a SIGKILL of the panel; a fresh process reads "working" and then "parked" from files plus liveness alone — PASS 12/12. Gap: a draft dir is empty until its model round returns, so a dead draft cannot be told from a running one by its own dir (`src/authoring.js:198`); the only signal is the `runs.jsonl` hold row, and a SIGKILLed draft leaves that hold open. (c) a key from the keys file reaches no book, audit, `runs.jsonl` or draft dir on the real paths — PASS 6/7; FAIL c5: a run model step that copies the key into its output writes it raw into the run's books (artifacts, `ask.json`, `log.json`, `state.json`), because only the draft side scrubs (`scrub`/`sweepForSecrets` live in `src/authoring.js` and `src/panel/resume.js` only). A real model is never given the key. Also found: a send folder must sit inside fwdloop's own install folder (`src/runner.js` `checkSendDestination`, joined onto `REPO_ROOT`), so for an npm install the card's destination has no usable meaning.
- **Rulings on the POC (hamr 2026-10-05):** "A1" — the run-side key sweep (c5) goes on the fix list, after M4e; M4e's negative (ix) is proven on the real paths. "any folder" — amendment 1 below.
- **Amendment 1 — SIGNED by hamr 2026-10-05 ("sign m4e amendment 1"): Destination is any folder.**
  - **Why:** the POC found the send folder is fenced to fwdloop's install folder, which is useless for an npm install. hamr 2026-10-05: "any folder" — the accepted result is placed where the human says.
  - **Caption:** the card's "Send to" box is named **Destination**, as bareloop's card. It is the folder the one accepted result is placed in after the human accepts; empty = no send, the result stays in the run's `out/`.
  - **What changes:** a signed `file:<path>` send target that is an **absolute path** is used as that folder, anywhere on the machine. A **relative** path keeps today's meaning (inside the install folder), so every flow already signed reads and runs unchanged. This replaces the install-folder fence in `checkSendDestination` (M0/M2 send rule) for absolute targets, for the CLI and the panel alike — one function, one rule.
  - **Always refused, by name, at sign and again at send:** the run's own folder and its records and `inputs/`; any flow folder under the panel's root; the fwdloop config folder (`~/.config/fwdloop/`, which holds the keys file); a target that is not a folder. Checked with `realpathSync` at sign and re-checked at write time (symlinks followed to the real folder; time-of-check vs time-of-use, as today).
  - **Never overwrites:** if a file with the result's name already exists in the folder, the send refuses by name and writes nothing.
  - **Unchanged:** the destination is human-typed and signed (the drafter never writes it); nothing is sent without the human's accept in the same run; send ships the one accepted artifact by identity, hash-checked at send; send writes to a local folder only.
  - **Negatives:** (a) an absolute folder outside the install folder is written to, with the accepted bytes, after accept; (b) a relative target behaves exactly as before (an already signed flow runs unchanged); (c) a target inside the run folder, a flow folder, or `~/.config/fwdloop/` — directly or through a symlink — is refused at sign and at send, nothing written; (d) a symlink swapped in after sign to point into a refused folder is refused at send; (e) an existing file with the result's name is never overwritten; (f) a target that is a file, or missing, is refused at sign.
- **Amendment 2 — SIGNED by hamr 2026-10-06 ("sign m4e amendment 2"): the card, reshaped after hamr's first look.**
  - **Why:** hamr's first look at the built card, 2026-10-06: the job box should mark steps and guardrails for him; inputs should be one `name: path` box; the field order should follow the job; the send should not need a line number; the time box should hold the ask wait; the sign button was too long and typing the flow name to sign was not wanted. Rulings in his words: "Numbers + > / ~", "make it one step per CR", "default is 1 hr", "Default + optional", "why send needs a step? doesn't it know?", "time cap can be used optional wait time", "Two clicks only", "write amendment 2".
  - **What does not change:** the card still writes exactly the job file `fwdloop draft` reads today (`N. text`, `   guardrail: text`, `N. ask <wait>: text`, and the arbiter guardrails block). The drafter, the signature, the plan checks, the hard lines and every scope item not named here stay as signed.
  - **1. The job box.** One line is one step: Enter starts the next step. Outside the box, on the left, each step line shows its number and `>` (`1 >`, `2 >` ...). A line that starts with `~` is a guardrail of the step above it: the left side shows `~`, the numbering does not move on, and a step may have several. A step that starts with `Ask:` is an ask with the card's default wait; `Ask 2h:` (minutes or hours, as the job file allows) sets that ask's own wait. A long line wraps on screen and shows its number on its first line only. Empty lines are dropped, never a step. A `~` line before the first step is refused on the card by line, in a plain sentence. The card writes `N. ask <wait>: <question>` with the wait always written out, so every ask's wait is signed text, never a code default.
  - **2. Inputs.** One box, one line per input, written `name: path`; outside the box, each line shows its number (`1`, `2` ...). Each line is checked as today (absolute path, a regular file that exists and can be read, no name used twice); a refusal names the line number and says why.
  - **3. Destination.** One folder box, no line number. A destination is always sent at the **last step**: the card writes `guardrail: send at line <last> to file:<folder>`. The plan shows that line and folder before signing. Empty = no send. If the last step cannot be the send step (for example no accepted ask before it), the plan checks refuse it as they do today. Amendment 1's folder rules are unchanged.
  - **4. Field order:** Flow name, The job, Destination, Inputs, then one row with **Cap $** and **Ask wait**.
  - **5. Ask wait.** The Time box returns, captioned **Ask wait**, filled in with `1h`. It is the wait for every `Ask:` step that does not set its own. It takes a number with `m` or `h`; anything else is refused on the card. It is not a whole-run time limit: fwdloop keeps no wall-clock cap on a run (each model call already has its hard deadline and a failing step stops on its strikes). An ask that runs out is renewed with Reopen, as today.
  - **6. Sign: two clicks, no typed name.** First click **Sign & run**; the button becomes **Sign `<hash8>` & run · $`<cap>`**; the second click signs and starts the run. The server signs only when the click's hash equals the draft's hash on disk (unchanged); a single click never signs. This **replaces the typed flow name on the page** (from this module's amendment of M6a amendment 2). The CLI `fwdloop sign` keeps its TTY and typed-name rule unchanged. With no typed name the ask box has no use in fwdloop's card and is removed (added to "Not ported").
  - **7. The button fits.** The main button's label stays on one line inside the card at 1280, 390 and 320 px.
  - **Negatives:**
    - (a) a job typed in the box becomes exactly the job file lines: numbers in order, each `~` line as a `guardrail:` under its step (1-for-1), `Ask:` with the default wait, `Ask 2h:` with its own;
    - (b) a `~` line before the first step is refused by line; empty lines never become steps;
    - (c) an inputs line with no `:`, a relative path, a missing file or a name used twice is refused by its line number, $0, nothing created;
    - (d) a destination is sent at the last step and the plan shows that line; an empty destination writes no send line;
    - (e) an Ask wait that is not a number with `m` or `h` is refused on the card;
    - (f) one click never signs; a second click with a hash that no longer matches the draft on disk signs nothing; no typed name is asked for;
    - (g) the CLI `fwdloop sign` still refuses without a TTY and without the typed name;
    - (h) the card at 1280, 390 and 320 px: the left-side numbers and marks stay aligned with their lines, the main button's label stays on one line, no box spills, no page scroll sideways.
- **Amendment 3 — SIGNED by hamr 2026-10-06 ("sign m4e amendment 3", with the run shown as newjob-resume (run-1)): plain numbers, run-1 run names, revise the plan.**
  - **Why:** hamr's live look at the amendment 2 card, 2026-10-06: the left-side marks should be plain numbers lined up with the Flow name box; run names are too long; and "what if i don't agree with plan, we usually have 2 attempts to revise through chat, draft again like bareloop, why we don't have that?". Rulings: "flow-1, flow-2", then "run-1 is better than flow-1, as it's the same flow but different runs right?", and "bareloop's way". This module's "Not ported" list wrongly dropped bareloop's revise: it was read as the drafter asking questions back, which fwdloop's drafter does not do, but revise is the human asking for a change.
  - **1. Plain numbers.** The job box and the inputs box show `1`, `2`, `3` on the left, without `>`; a guardrail line in the job box still shows `~`. The numbers start at the left edge of the Flow name box (the gutter sits inside the card's field column, no extra space before it). This replaces amendment 2's `N >` mark; everything else in amendment 2 items 1 and 2 stands.
  - **2. Run names `run-<n>`.** A new run is named `run-1`, `run-2` ..., counting up per flow (the run lives inside its flow's folder, so the name only has to be unique within that flow); the page shows it as `<flow> (run-<n>)`, e.g. `newjob-resume (run-1)` (hamr 2026-10-06: "newjob-resume (run-muwftflz-26aa345f) > newjob-resume (run-1)"). One function picks the name, used by the CLI `fwdloop run` when no `--run-id` is given and by both panel doors (sign and Run a signed flow); the number is claimed by creating the run folder exclusively, so two starts at once never get the same name. The Run id box on Run a signed flow is prefilled with the next name and stays editable; a typed id still passes the CLI's own run-id check. Because `run-1` repeats across flows, the file a send places in the destination is named `<flow>-<runId>-<emits>.json` (today `<runId>-<emits>.json`), so two flows sending to one folder never collide with amendment 1's never-overwrite rule. Runs already made keep their ids; nothing is renamed.
  - **3. Revise the plan (bareloop's way).** When a green plan shows, the ask box opens with "Ask for a change to the plan" and the main button reads **Send** while the box has text (**Sign & run** while it is empty). Send redrafts: one paid drafter call given the current plan and the human's note, and the new plan replaces the shown one with its new hash. Up to **2 changes per draft**, shown as "2 changes left" / "1 change left"; at 0 the box closes and only Sign & run, Abandon or editing the card remain. A revise that comes back red shows its reds and keeps the last green plan to sign. The note can change how steps are done (their tools, reads, checks); it cannot change the card's own fields — the job lines (still the steps' goals, verbatim), cap, destination, asks and their waits, inputs — those come only from the card, so the drafter's existing checks refuse any plan that differs there (hard line unchanged). Each revise is booked like a draft call (counted once, in Money and the monthly check) and holds one ceiling round at the monthly check. The note is kept with the draft on disk and shown in the progress list; a key value in a note is refused. Sign still signs only the plan whose hash the page shows (amendment 2 item 6).
  - **Negatives:**
    - (a) the left side shows plain numbers and `~`, no `>`, lined up with their lines and starting at the Flow name box's left edge, at 1280, 390 and 320 px;
    - (b) two runs started together for one flow get two different names; a third start gets the next number; another flow starts again at `run-1`; the CLI with no `--run-id` names the same way;
    - (b2) two flows whose `run-1` both send to one destination folder place two different files, neither refused;
    - (c) a typed run id that fails the CLI's check, or already exists, is refused, $0;
    - (d) a revise with a note returns a new plan with a new hash; signing the old hash after a revise signs nothing;
    - (e) a third revise on one draft is refused and makes no model call;
    - (f) a revise whose plan changes a job line, the cap, the destination, an ask or its wait, or an input is red, and the last green plan stays signable;
    - (g) revise spend is counted once in Money and the month total; over the monthly limit a revise refuses at $0;
    - (h) a note carrying a key value is refused and never sent;
    - (i) a refresh during or after a revise re-attaches the newest plan, its "changes left" count and the notes.
- **Amendment 4 — SIGNED by hamr 2026-10-06 ("sign m4e amendment 4"): money note under Cap, chat history, Stop and Resume, blue ask headers.**
  - **Why:** hamr's live exit walk, 2026-10-06. A card signed with cap $0.01 cap-halted at $0 on its first step and there was no way on from it ("we need resume"); with the monthly limit at $0.01 and a $0.50 cap nothing warned before a click ("refusal should [show] without clicking"); the revise notes do not read as a chat; "this is an automation flow, we should have under run (start, stop (stops after this step cleanly), resume)"; the ask's section headers are hard to pick out. Rulings: "A1", "B shorter: needs 0.50 (0.10 left monthly)", "show chat history two rounds max then start over", "if cap halts, i should get to resume and takes me to chat to adjust cap, ask, input, destination; if you change the ask, that's a new job". Shape copied from bareloop (`loop` 2026-10-06, branch chore/fix-ledger @ c1d87ce) where it fits, with fwdloop's differences named.
  - **1. Money note under Cap.** Under the Cap $ box (New job) and the signed cap (Run a signed flow, and the Resume form in item 4), one short line: `needs $0.50 ($0.10 left monthly)` in red when the cap is more than what is left this month, `$4.90 left monthly` in plain text when it fits. It re-reads on typing (debounced), when the card opens, when a signed flow is picked, and when the monthly limit changes in Settings. While it is red the main button (Draft, Run, Sign & resume) is off, so a short month stops you before any click. The server's refusal at $0 stays and is the real gate (the page is never the arbiter; bareloop P4a); the note uses the same numbers as that refusal, from one function. A fetch error clears the note and leaves the button to the server. Difference from bareloop: bareloop's note never turns the button off; hamr asked to be stopped.
  - **2. Cap too small for one step (A1).** If the cap cannot fund one ceiling round of the first model step, the card says `needs at least $X per run` in red under Cap before Draft, and Draft and sign refuse at $0 with that sentence. A run can no longer be signed that cap-halts on its first step with $0 spent.
  - **3. Chat history, two rounds.** After a green plan, the card shows the conversation as bubbles under the plan: each note as a **you** bubble in the human's words, and each new plan's reply as a **fwdloop** bubble ("New plan, hash <8-hex>. N changes left."). Pipeline progress stays a separate list. Up to 2 changes per draft (amendment 3 item 3, unchanged). After the second change the ask box closes; the choices are Sign & run, or **Start over**, which clears the bubbles and the plan and drafts again from the card as it is now (a fresh draft, its own 2 changes, booked as a draft call). Clear still empties the card and the history. Difference from bareloop: bareloop has no Start over in the panel (its library has one, unwired).
  - **4. Run controls: Start, Stop, Resume.** In the Run tab's top action row (bareloop's `#run-actions`), never on run cards:
    - **Start** is the Chat card's main button, as today.
    - **Stop** shows while the run is running. A click writes a stop file next to the run's records; the runner reads it at the seam after the current step closes, finishes that step cleanly (its artifact and check written), books it, and ends the run as **stopped** — resumable, never "failed". While waiting the button reads "stopping after this step…". A run parked at an ask is not running and shows no Stop (its ask has its own answers). Refusals in plain words ("This run is not running, so there is nothing to stop."). Unlike bareloop's known gap, every kind of step reads the stop file; the page never says "stopping…" for a step that ignores it.
    - **Resume** shows on a stopped run and on a cap-halted run. It opens the Chat card in a **Resume run-<n>** form (same run, not a new one): the Cap $ box is open and must be more than what is already spent ("The cap must be above what is already spent (at least $X)"); the money note (item 1) shows under it; every other field shows read-only. **Sign & resume** (two clicks, hash-bound, like page sign) signs the new cap and continues the same run: done steps and their spend are kept, the cut step is re-entered, the plan is never redrawn, spend so far counts against the new cap.
  - **5. What a change makes (hamr's rule, bareloop's split).**
    - Changing **only the cap** is a Resume: the same run continues (item 4).
    - Changing the **inputs or the destination** is a new run of the same flow: Resume's form has a **Change inputs or destination** link that opens Run a signed flow (inputs) or a prefilled New job card (destination, which is signed) — the stopped run stays as it is. Inputs are pinned by a frozen copy at job start, so a running run's inputs never change.
    - Changing a **job line or an ask** (its words, its position, its wait) is a **new job**: the card says so and offers Clear + a fresh draft.
  - **6. A cap raise is a human re-sign, never an edit.** The new cap is written as a new signed version next to the old one (write-once; the original `prose.txt` and `signature.json` are never overwritten), and the run's resume names the version it ran under. The agent, the chat notes and the drafter can never raise a cap (unchanged hard line: only the human's own signed click can). One function picks which signed version a run resumes under.
  - **7. Blue ask headers.** In the ask view, each section header of the artifact (e.g. the resume's three section headings) shows in the panel's blue accent, light and dark theme, so the sections stand out. Text only; nothing else in the ask changes.
  - **8. No token, no cookie: open `http://127.0.0.1:4800/`.** hamr 2026-10-06: "i don't see a value from cookie to open the fwdloop. it's local and trusted and doesnt add value only hindrance, only node start and you can 127.0.0.1:4800, drop it". This replaces M4c-fix scope item 2 (token file 0600, the `?t=` link, the cookie) and its negative (ii), and the 2026-10-03 "1A" token-reuse ruling. `fwdloop panel` prints `http://127.0.0.1:<port>/` (default 4800) and writes no token file; an old token file is left alone and never read. What stays, unchanged: the panel binds to 127.0.0.1 only; every POST still needs the panel's own Origin and Host (so another website open in the browser cannot sign, run, answer or change Settings, and a DNS-rebinding name is refused); a taken port is still a loud failure. What is given up: nothing new — another program running as hamr could already read the token file (M4c-fix's written known limit), and now it does not need to.
  - **Negatives:**
    - (a) with $0.10 left and cap $0.50 the note reads `needs $0.50 ($0.10 left monthly)` in red and the main button is off before any click; raise the limit in Settings and the note turns plain and the button comes on without a reload; a forced POST still refuses at $0;
    - (b) a cap below one ceiling round is refused at Draft and at sign, $0, with the sentence;
    - (c) two notes show as two **you** bubbles and two **fwdloop** bubbles; after the second, the box is closed; Start over clears them and makes one new draft call; a refresh re-attaches the bubbles;
    - (d) Stop on a running multi-step run ends it **stopped** after the current step with that step's artifact and check written and booked; no next step starts; Stop on a parked or ended run is refused in words;
    - (e) Resume on a cap-halted run with a higher cap continues the same run id: done steps are not re-run, spend so far counts, the old signed version is unchanged on disk; a cap at or below spend so far is refused, $0;
    - (f) a Resume that changes inputs, destination, a job line or an ask is refused as a resume and sends the human to new run / new job;
    - (g) the drafter, a note or any non-human POST cannot raise a cap (no typed/clicked sign = nothing written);
    - (h) ask section headers are blue at 1280/390/320, light and dark; all of the above at 1280/390/320 with no spill.
    - (i) `http://127.0.0.1:4800/` opens the panel with no `?t=` and no cookie; a POST with another site's Origin, or a Host other than 127.0.0.1:<port>, is refused and writes nothing; no token file is written;
  - **Cap:** within M4e's $0.50 (build at $0 with stub providers; one short live walk).
- **Amendment 5 — SIGNED by hamr 2026-10-06 ("sign m4e amendment 5"): Resume is the cap; Run opens files, destination, cap and ask wait; anything else is a new flow.**
  - **Why:** hamr, 2026-10-06, before amendment 4 item 5 was built: "keep it simple, resume is for the same run that got stopped by cap, or by you > only allowed to change cap, all else is dimmed; run is a new run for the same flow, same contract but input/output path may change but same steps so, it's considered same job, all else is dimmed, else, start a new flow", then "a daily run opens up cap/ask time too, add it". Amendment 4 item 5 sent a destination change to a new job; a daily-driver flow needs it per run.
  - **Replaces amendment 4 item 5 and its negative (f).** Amendment 4 items 4 and 6 (Resume, cap re-sign) stand as signed.
  - **1. Resume (unchanged from amendment 4 item 4).** The same run that stopped at its cap or by Stop. Only Cap $ is open; every other field shows dimmed. Same run id.
  - **2. Run a signed flow = a new run of the same flow.** The same steps and the same job lines and asks; it gets the next `run-<n>`. Open boxes: **Inputs** (the files), **Destination**, **Cap $**, and each ask's **wait**. Everything else shows dimmed: the job lines, the ask words and their positions, the steps.
  - **3. What needs a signature.** Inputs alone: the button is **Run** (one click), as today. A Destination, Cap $ or ask wait different from the flow's signed value: the button is **Sign & run** (two clicks, bound to a hash of those values, like page sign); a non-human POST signs nothing. The signed values for that run are written once into the run's own folder before it starts, and that run uses them; the flow's `prose.txt` and `signature.json` are never changed, and the next run starts again from the flow's signed values.
  - **4. Same checks as a new job.** A changed destination passes amendment 1's checks (refused: the run folder, flow folders, the root, `.drafts`, `.starts`, `~/.config/fwdloop`, a file, a missing folder; never overwrite). A changed cap gets amendment 4's money note and the too-small check. A changed ask wait passes the same wait grammar as the card (`<int>` then `s`, `m` or `h`). Nothing leaves the machine without the destination signed for that run and a human accept in that run (hard line unchanged).
  - **5. Anything else is a new flow.** A change to a job line, an ask's words or position, or the number of steps is not a run: the card says so and offers New job (prefilled from the flow) — a fresh draft and a new flow name.
  - **Negatives:**
    - (a) Run with new input files only starts with one click as `run-<n+1>`; the flow's signed files are unchanged on disk;
    - (b) Run with a new destination, a higher cap, or a different ask wait shows Sign & run; one click or a stale hash signs nothing and starts nothing; two clicks start the run, it uses the new values (the send lands in the new folder; the cap and the wait are the new ones), and the next plain Run uses the flow's own values again;
    - (c) a refused destination, a too-small cap, a cap over the monthly room, or a malformed wait is refused at $0, nothing written;
    - (d) a POST that changes a job line, an ask's words or the steps through Run is refused and starts nothing;
    - (e) Resume shows only Cap $ open (amendment 4 (e) stands).
  - **Cap:** within M4e's $0.50.
- **Amendment 6 — SIGNED by hamr 2026-10-06 ("sign m4e amendment 6"): a change can't fight the job line; plan sits between chat and button; setup goes into the audit; the Job tab reads like the card.**
  - **Why:** hamr's live walk of amendments 4-5, 2026-10-06, run `m4e-exit-3 (run-1)`: the second note "put skills before work history" made the revised plan's check want the sections in the order skills, work history, while the job line (the step's goal, verbatim) says work history, skills. The step never sees its close (hard line), so the model wrote the job line's order and the check failed it four times: `failed (attempt-fallback)`, $0.0505. The machine caught it, as it should; the plan should never have been green. hamr also asked "is there a chance the plan blocks inputs/steps/asks/job lines", "draft plan should always sit between chat and button", and "should beginning part of drafting/setup get into audit, same output? i think yes". On the Job tab of `m4e-exit-3a`: "cap says no ask time limit even though 1 hr was there" (the line read `$0.50 · redo cap 3 · time cap: no time cap signed`) and "job should be simplified like chat ask", with his own mock of the layout.
  - **1. A change can't fight the job line.** A plan (first draft or any change) whose step check names sections in an order different from the order the step's job line names them is red, naming the step and both orders: "the job line says work history, then skills; the check says skills, then work history — change the job line on the card to change the order". The same for a section name not in the job line's words, and for a word limit tighter or looser than the line's own guardrail. A note that asks for such a change gets a red change (amendment 3: the last green plan stays signable). What a note can still change: a step's tools, what it reads, and its check where the job line and guardrail say nothing.
  - **2. What a change can never touch (unchanged, written here plainly):** the job lines, the asks (words, position, wait), the inputs, the cap, the destination, and the number and order of steps. A plan that differs there is already red (amendment 3 item 3).
  - **3. Plan between chat and button.** The card's order, top to bottom: the card fields, the chat bubbles (oldest first), the current plan, the note box, the main button. The plan is always right above the note box and the button, so what you sign is what sits next to Sign & run. Replaces amendment 4 item 3's "bubbles under the plan".
  - **4. Setup goes into the audit.** At sign, the draft's record is copied once into the flow folder as `setup.jsonl` (write-once; outside the three signed files): the card as submitted, each draft and change (model, cost, green or red, plan hash), each note in the human's words, and the sign (hash, when). The Audit / logs tab shows these rows first, under **Setup**, in the same row format as the run's rows, for every run of that flow; a run with changed values (amendment 5) adds its own Sign & run row. Flows signed before this have no Setup block and say "no setup record (signed before amendment 6)". A key value never appears (the draft side already scrubs).
  - **5. No "time cap" on the Job tab.** fwdloop has no run-wide time cap (a run waits at its asks; each ask has its own wait). The cap line reads `$0.50 per run · redo up to 3`; the words "time cap" never show. The ask's wait shows with the ask (item 6).
  - **6. The Job tab reads like the card.** The **Job** block shows the numbered lines as the card does, each line's guardrail right under it as `~ <guardrail>`, and the ask line's wait on its own `~` row as `~ waits 1h`; the send line shows `~ writes out to <destination>`. Waits read in plain units (`1h`, `30m`, `1h 30m`), never `60m00s`. The separate **Guardrails** block is gone (its rows now sit under their lines). **Ask**, **Source**, **Destination**, **Success** and **Signed** stay as they are. A run with its own signed values (amendment 5) shows the values in force for that run.
  - **Negatives:**
    - (a) a plan whose check reorders, renames or re-limits a section against its job line is red at draft and at change, names both, and the last green plan stays; replaying hamr's "put skills before work history" note on the m4e-exit-3 card gives a red change, $0 beyond that one call;
    - (b) a note that changes only a tool or a read gives a green plan;
    - (c) the card shows bubbles, then plan, then note box, then button, at 1280, 390 and 320 px;
    - (d) after sign, `setup.jsonl` exists with the card, every draft/change row with its cost, every note and the sign row; writing it twice is refused; Audit / logs shows the Setup block first for run-1 and for run-2; a flow signed earlier says so in words;
    - (e) no key value in `setup.jsonl` (canary);
    - (f) the Job tab never shows "time cap"; the cap line is `$<cap> per run · redo up to <n>`;
    - (g) the Job tab shows each guardrail as `~` under its own line, the wait under the ask line in plain units, the send line's destination under it, and no Guardrails block, at 1280, 390 and 320 px; a run with its own signed values shows those.
  - **Cap:** within M4e's $0.50 ($0 build; the replay in (a) is one paid change call, about $0.01).
- **Amendment 7 — SIGNED by hamr 2026-10-06 ("sign m4e amendment 7"): a check can't be emptied; Draft is the first step; Run again on the run; Stop between turns and tries; pick a flow or run by typing; small readout and card fixes.**
  - **Why:** hamr's live walk of amendment 6, 2026-10-06, flow `m4e-exit-4`. The note "put skills before work history" came back **green**, not red: the change replaced the three section names with ONE "section" equal to the whole job line, which is a substring of the line, so amendment 6 item 1 let it through. The run then pasted the whole job line as its first line (attempt 3 green), so the signed "3 sections" guardrail was never checked. Amendment 6's negative (a) failed live. hamr also asked: the readout's headings in bold; "audit, setup renamed to draft and be a normal card collapsed by default, similar to bareloop but keep fwdloop different columns … all/humans/blocked, grouped/flat stay on top"; "drafting should also appear as first step on map under run and cards below map under run"; the cap line "`$0.50 per run · 1 hr wait · redo up to 3`"; and a Runs card read `2026-10-061 run`. Then, walking part C: "reuse workflow should be top of run next to other controls resume, stop"; and Run a signed flow started `job2-live-1` (an old flow, picked by default) as `run-3`, refused at $0: `preflight-red — step "resume-summary" (line 3) grants verb "compress", which has no wired implementation`. Then on `m4e-exit-3a (run-2)` (Sign & run with cap $0.30, destination `~/fwdwalk/out`, wait 2h — those worked): "i clicked stop and it failed": the Stop came during step 3, which was retrying (4 tries, each red on headings or words), so the step ended red before the after-the-step seam and the run read `attempt-fallback`, $0.0514; the stop request left no trace in the run's books. And "run a workflow should filter by typing or text box typing and autofilters to choose".
  - **1. A check can't be emptied.** On top of amendment 6 item 1, at draft, change and sign:
    - when a line's guardrail states a number of sections ("3 sections"), the step's `sections` must have exactly that many; otherwise red: "the guardrail says 3 sections; the check has 1";
    - a section name is a short phrase from the line (at most 8 words), never the whole line or most of it; otherwise red naming it;
    - one section name may not contain another.
    A red change keeps the last green plan (amendment 3). The step still never sees its close; a gap names what is missing, as today.
  - **2. Draft is the first step.** "Setup" is renamed **Draft** everywhere. On a run's **Map**, the first box is **drafting**, with an arrow to step 1; under the map, the first card is `drafting · <time> · $<cost> · <n> calls · ✓`, with the draft's rows (card, draft, notes, changes, sign) under it. In **Audit / logs**, Draft is a normal group card, **collapsed by default**, opening to its rows in fwdloop's own columns; the All / Humans / Blocked and Grouped / Flat controls stay on top. Clicking the drafting card on the Map opens Audit on the Draft group. Its total time, calls and cost add up to the Draft rows, and the cost equals the drafting figure shown elsewhere. A flow signed before amendment 6 shows the drafting box as "no draft record" and no cost (never $0).
  - **3. The readout's headings are bold, and it shows the guardrails.** In the draft readout (fwdloop's fixed template, not model text), **INPUTS**, **STEPS**, **ASKS**, **SEND TARGET** and **JOB LINES** are bold. Under **JOB LINES**, each line's guardrail shows right under it as `~ <guardrail>`, as the card and the Job tab show it (hamr 2026-10-06: "1"), so the plan you sign shows everything you wrote.
  - **4. The wait on the cap line.** The Job tab's cap line reads `$0.50 per run · 1h wait · redo up to 3` (one ask; with several asks: `waits 1h, 30m`), plain units from the one formatter.
  - **5. Runs card spacing.** A Runs card's last line keeps its separators: `$0.0616 · 6m23s · 2026-10-06 · 1 run`, never `2026-10-061 run`; the time reads in plain units.
  - **6. Run again sits with Stop and Resume.** The Run tab's top action row holds every run control: **Run again** (bareloop's Reuse workflow), **Stop**, **Resume**. Run again shows on any run of a signed flow and opens the Chat card in Run a signed flow with that flow picked and its last run's inputs, destination, cap and waits filled in (amendment 5 rules unchanged: files alone = Run; destination, cap or wait changed = Sign & run).
  - **7. Pick a flow or a run by typing; only flows that have passed.** The Signed flow box is a text box: typing filters as you type, on any part of a flow name or a run name — `run-2` lists every flow's `run-2` as `<flow> (run-2)`. Picking a flow fills in its own signed values; picking a run fills in that run's values (as Run again does). The list holds only flows that have at least one passed run and that the run's own preflight would accept (hamr 2026-10-06: "only green ran flows show … i'd keep green"); a flow with no passed run, or one preflight would refuse (an unwired verb, a signature that does not check out), is not listed — it can still be run again from one of its runs with Run again (item 6), where a preflight refusal shows its reason. Nothing is picked until the human picks (or Run again picks it). One function decides "can this flow run", shared with preflight; the run's own preflight stays the real gate.
  - **8. Stop between turns and tries, and Stop is always recorded.** Amendment 4 item 4's seam "after the current step closes" also sits before every model call — every turn inside a try and every new try (hamr: "stop stops between turns, tries"): a Stop ends the run **stopped** after the model call in flight — that call is booked, no new call starts — and Resume re-enters that step as a new try, with its tries and spend so far counted. A Stop is never cleared silently: the request and its outcome are an audit row — "stop asked (you) at <time>", then "stopped after step N" / "stopped after turn T of try K of step N" / "not honoured: the run ended (<outcome>) first". Replaces amendment 4 item 4's "the runner reads it at the seam after the current step closes" only by adding the seam before every model call.
  - **Negatives:**
    - (a) replaying "put skills before work history" on the m4e-exit-4 card gives a red change (never green), the last green plan stays; a plan with one section on a "3 sections" guardrail is red; a section named by the whole line is red;
    - (b) Draft shows as the first Map box and first card under the map for a run of a flow signed after amendment 6, collapsed in Audit by default with the filters above it, and its time/calls/cost add up; an older flow says "no draft record";
    - (c) the readout headings are bold and each guardrail shows as `~` under its job line; the cap line shows the wait; the Runs card reads with its separators; at 1280, 390 and 320 px, light and dark;
    - (d) Run again on a run opens Run a signed flow with that flow and its values filled in; Stop, Resume and Run again sit in one row; a flow with an unwired verb or no passed run is not listed; with nothing picked, no run starts; typing part of a flow or run name filters the list, `run-2` lists every flow's run-2, and picking a run fills in that run's values;
    - (e) a Stop during a step ends the run stopped after the model call in flight (a turn or a try), no new call starts, Resume re-enters that step; every Stop leaves an audit row with its outcome, including "not honoured" when the run ended first.
  - **Cap:** within M4e's $0.50 ($0 build; the replay in (a) is one paid change call, about $0.01).

- **Built after signing — not signed text (2026-10-06):**
  - hamr's ruling on item 7's list rows ("Signed flow" pick list), after signing: each row is two lines, bareloop's shape with fwdloop's first part: `<flow name>` over `<n> steps · <n> asks · <G> green · <N> not green · about $<X> and <Y> a run`. An unknown cost or time is said ("time not recorded", "cost not recorded", "cost and time not recorded"), never $0 or 0; money and time come from the page's one `money()` and `duration()` (so the time reads `6m23s`, not minutes). A row for a typed run name (`run-2`) is the same two lines (the flow's record).
  - Built as: `src/canrun.js` `canFlowRun` (the list's rule and the Run again refusal; preflight's own words), `GET /api/author/run-again` (any run, any outcome), the Signed flow box a search box over a list with a picked box and `change` (borrowed from bareloop's job picker); the list holds flows with a passed run (a run whose last history row is `complete`) that `canFlowRun` accepts. `src/runner.js` still carries its own copy of the unwired-verb check (same words, proved equal by `poc/m4e-am7/canrun.mjs`); pointing it at `canFlowRun` is a one-line follow-up once the runner branch is merged.
  - Item 2 as built: the API key is `draft` (was `setup`); the file stays `setup.jsonl` (signed in amendment 6). A draft's spend row now records `startedAt` and `wallMs`; a Draft from before that shows "time unknown", never 0.

- **Amendment 8 — SIGNED by hamr 2026-10-07 ("sign m4e amendment 8"): the drafting card is short, bareloop's shape.**
  - **Why:** hamr's walk, 2026-10-07: the drafting card on the Run tab showed the whole card readout (inputs, job lines, plan ids). hamr: "drafting card on run should be smaller and look like steps/tools or what happens not a whole readout", pasting bareloop's card (`drafting` / `done` / `4m05s · $0.05 · 8 calls · ✓` / a ` · `-joined line of what happened, a retry as `drafting (retry 2 of 3)`), and picked copying bareloop's shape (hamr 2026-10-07: "go" on option 1).
  - **1. The drafting card is four short lines.** Replaces amendment 7 item 2's card line `drafting · <time> · $<cost> · <n> calls · ✓`, with the draft's rows (card, draft, notes, changes, sign) under it, with bareloop's four-line card:
    - line 1: `drafting`;
    - line 2, how it ended, from the Draft rows (`getDraftBlock` in `src/panel/data.js`, the rows of `setup.jsonl`): `done` when there is a sign row; `not signed` when there is none. The code today writes `setup.jsonl` only at sign, always with its sign row last, so `not signed` cannot show yet; it stays in the text so a card never says `done` without a sign row. There is no `red` state: a red change or red draft before the sign (a red change keeps the last green plan, amendment 3) shows only on line 4;
    - line 3: `<time> · $<cost> · <n> calls · ✓`, from the one `draftTotals`; a figure not recorded reads `unknown` (`time unknown`, `cost unknown`, `calls unknown`), never 0 (amendment 7 item 2 unchanged). The `✓` shows on `done`; on `not signed` no mark;
    - line 4, what happened: one short phrase per Draft row in order, joined by ` · `: card = `your card`; draft = `drafting`; a draft that was retried = `drafting (retry K of N)`; note = `your note`; change = `changing` (retried: `changing (retry K of N)`); a red change = `change red`; a red or stopped first draft = `draft red`; sign = `signed (<who>)`; a run's own signed-values row = `signed to run (<who>)` or `signed to resume (<who>)`. N is the drafter's `MAX_STRUCTURE_RETRIES` (2); K is the row's `structureRetries` (`src/drafter.js` already puts it in the plan's `log.json`; `planRow` in `src/setup.js` does not yet copy it onto the Draft row, so the build adds that one field there, and a Draft row from before it shows no retry text, never "retry 0").
    No card text, no inputs, no job lines, no destination and no plan id on the card. Everything else stays in Audit → Draft, which the card opens (amendment 7 item 2 unchanged). A flow signed before amendment 6: `no draft record`, unchanged.
  - **Negatives:**
    - (a) the drafting card shows no inputs, job lines, destination or plan id;
    - (b) its four lines read as above for a signed flow (`drafting` / `done` / `<time> · $<cost> · <n> calls · ✓` / `your card · drafting · your note · changing · signed (<who>)`), for a red change before the sign (`done`, `✓`, `... · change red · signed (<who>)`), and for a retried draft (`drafting (retry 1 of 2)`);
    - (c) an unknown time, cost or call count reads `unknown`, never 0;
    - (d) at 1280, 390 and 320 px, light and dark, nothing spills.
  - **Cap:** within M4e's $0.50; $0 build.

- **Amendment 9 — NOT SIGNED: the drafting card reads like a step card, step 0.**
  - **Why:** hamr's walk of amendment 8, 2026-10-07: "needs to be something like this> 0 . drafting [passed] / time unknown · $0.0048 · 2 human checks · ✓ / your card · drafting · your note · changing · signed (hamr) — 'drafting' should be bold, what other things you can show and why time is unknown, if it's always like that then something else". Time read unknown because a flow drafted before amendment 7's build carries no `wallMs` on its draft/change rows (the old rows lack the field); it is not always unknown, only for those flows. hamr said "yes" (2026-10-07) to the shape below.
  - **1. The drafting card is three lines, the first shaped like a Run-tab step card.** Replaces lines 1-3 of amendment 8 item 1 (line 4, the "what happened" list, becomes line 3 unchanged; everything else in amendment 8 stays):
    - line 1: `0 · drafting`, with `drafting` bold, and the status on the right. A step card's head is `<n> · <name>` in the bold `h4` plus a status badge made by the page's `stateWord`: the sign glyph and the server's word (`SIGN_WORDS`), so a passed step reads `[✓] passed`, and a step not started reads `not started` with no glyph. The drafting card uses the same form: `[✓] passed` when there is a sign row; `not signed` (plain, no glyph, like `not started`) when there is none. The code today writes `setup.jsonl` only at sign, so `not signed` cannot show yet; it stays so a card never says `passed` without a sign row. No close-class badge (the drafting card is not a step). This replaces amendment 8's `done` / `not signed` line; there is still no red state;
    - line 2: `<time> · $<cost> · <n> model calls · <h> human checks · ✓`:
      - **time** = from the card row's `at` to the sign row's `at` (the whole drafting, human time included, as bareloop counts it), shown through the page's one `duration()`. If either has no `at`, `time unknown`; never 0. This replaces `draftTotals.timeMs`, which summed the model rows' `wallMs` only, so any older row made it null;
      - **cost** from `draftTotals` as today (`$<cost>`, `at least $X` for a floor, `cost unknown` when no row priced);
      - **model calls** = the sum of the draft/change rows' `calls` where recorded. A draft/change row with no `calls` counts as 1 and the figure reads `at least <n> model calls` (`at least 1 model call` for one), so an unknown never shows as a smaller exact number. No draft/change rows: `calls unknown`. All rows recorded: `<n> model calls` (`1 model call`);
      - **human checks** = the note rows + the sign row (`kind` `note` and `kind` `sign` in `setup.jsonl`); the card row is not a check. A run's own signed-values rows (the run's `values` files, which `getDraftBlock` already reads: `signed to run` for version 0, `signed to resume` for a later one) count too, one each. Shown `<h> human checks` (`1 human check`); `0 human checks` cannot show on a signed flow, and is a real count, not a missing figure;
      - `✓` on passed; no mark on not signed;
    - line 3: amendment 8's line 4, unchanged: `your card · drafting · your note · changing · signed (<who>)`, with the retry, red and signed-to-run phrases as amendment 8 gives them.
    The old flow case (`no draft record`) unchanged: `0 · drafting` and `no draft record`. One decider for the draft's time: the build computes the card-to-sign time once in `getDraftBlock`/`draftTotals` (`src/panel/data.js`), and the card, the Map box's readout and the Audit group header (`draftLineText`) all read it, so the three can never disagree. Today the Map box draws only the state word, so this is a rule for any time it shows, not a new figure on it. The Audit header keeps its own line (`drafting · <time> · $<cost> · <n> calls · ✓`, amendment 7 item 2) with this time and the same model-calls words as line 2.
  - **Negatives:**
    - (a) a flow drafted before amendment 7 (rows without `wallMs` or `calls`) shows a real card-to-sign time and `at least <n> model calls`, never `time unknown` when both timestamps exist; with a missing `at` it reads `time unknown`, never 0;
    - (b) line 1 is `0 · drafting`, `drafting` bold, the status in step-card form (`[✓] passed`; `not signed` plain);
    - (c) human checks count the note rows + the sign row (the card not counted), plus a run's signed-to-run / signed-to-resume rows; a flow with no notes shows `1 human check`;
    - (d) the card, the Map box and the Audit header show the same draft time;
    - (e) at 1280, 390 and 320 px, light and dark, nothing spills.
  - **Cap:** within M4e's $0.50; $0 build.

**Next amendment to scope: per-run read/write folders (NOT SIGNED).** The fix-once switch-over
(fix-ledger "step `write` may overwrite frozen inputs", 2026-09-28) gave every step a bareguard fs
Gate scoped to today's default — read the run dir + frozen inputs, write only `<runDir>/out`. A
follow-on amendment would let a run name its OWN read/write folders instead of always defaulting to
that shape. Before it starts, hamr picks:

1. **How the folders are given at run start.** Proposed: `fwdloop run --read <dir> --write <dir>`,
   repeatable (so a run can grant several read dirs, several write dirs).
2. **The folders are fixed for the run, recorded in the audit at start.** A resume may only SHRINK
   them (tighten further), never grow past what the original run recorded.
3. **Always blocked, no matter what a run asks for.** The run's own records (`state.json`,
   `audit.jsonl`, `spend.jsonl`, `answer*.json`, `ask.json`) and `inputs/` — an asked-for folder that
   overlaps any of these refuses the whole run, by name, never a silent narrowing.
4. **Default when nothing is set:** exactly today's shape — read = the run dir (+ frozen inputs),
   write = `<runDir>/out`. This amendment only ADDS a way to ask for something else; it never changes
   what a run gets when it asks for nothing.
5. **Writing to a folder is local, not "send".** A step writing into a granted folder is not an
   egress — `send` still needs its own signed destination and a human accept in the same run,
   unchanged by this amendment.

**Not in M4 (a or b):** the drafter and describe/sign (a later module brings the drafter into
`src/`), editing a flow or adding turns (M6), dry-run and accept-a-version (M5), starting a new run
from the panel, Settings, LAN or phone access (localhost only).

**Ruling: no Run button in M4** (hamr 2026-09-26, "2"). bareloop's panel has no run-start affordance
at all — its Chat tab is a static "not built yet" string, no form, no POST route anywhere. Its own
lesson is to ask "when would you use this?" before building a button. fwdloop starts read-only too:
runs start from the CLI or a trigger, and the panel is where a human watches and answers. A Run
button is not deferred pending more design — it is out of scope for M4.

### M6a — authoring backend, pulled forward — SIGNED by hamr 2026-09-29 ("sign m6a, A"), EXIT SIGNED 2026-09-29

**Why (hamr, 2026-09-29).** Build the front (describe, draft, sign) before the M4b UI, the way
bareloop did: machinery first, then the UI wires to commands that already work. M4b stays signed and
waits until M6a's exit is signed. M6 splits: **M6a = the backend (this section), M6b = the authoring
UI, later.**

**Plainly: describe/sign was never built.** The ladder's M4 line ("M4 wires only what is built
(M0-M3: describe/sign, run, ...)") claimed it was. It was not. The drafter lives only in `poc/`, and
flows are written by `poc/m2/mkflow.mjs`, which stamps `signedBy` itself. Nothing in `src/` drafts a
flow or records a human signature. M6a builds that.

**Borrowed shape from bareloop (`edf4aa6`).** One catalogue drives the drafter's schema and prompt.
The drafter answers through a forced tool call. $0 gates run before any paid step. Sign is a
separate human step, bound to a hash of what the human saw. Keys never go in files or pages. A scrub
sweep checks every written file for key values.

**Scope.**

1. **One catalogue.** `src/catalogue.json` feeds the drafter. The drafter's menu is the WIRED verbs
   only (`src/primitives.js` `WIRED_VERBS`). The `poc/m0/catalogue.mjs` copy is retired from the
   product path.
2. **The drafter moves into `src/`.** It emits the `src` declaration shape directly (no converter)
   through a forced tool call whose schema is derived from the catalogue and `src/declaration.js`,
   and is checked by `validateDeclaration`. At most 2 structure retries and 2 revisions on validator
   reds. Every round is metered (`onLlmResult`), under a hard cap; unknown cost is never 0.
3. **Input facts are read mechanically at $0** (for example docx/md headings for `inputFacts`). No
   model scout.
4. **`fwdloop draft`** writes a draft dir (prose, declaration, readout, spec hash) and prints
   `DRAFTED — NOT SIGNED. To sign: fwdloop sign <dir> --approve <hash>`.
5. **`fwdloop sign <dir> --approve <hash>`** is the human step. $0 re-checks: hash match, every
   granted verb wired, sources exist, send target valid. Then `writeFlow`. Code never signs on its
   own; `mkflow`'s self-stamp is retired from the product path.

**Keys (hamr ruling "A", 2026-09-29).** Keys stay in `pass`, loaded in the launching shell, until API
settings land with the UI. Recorded for later, with the UI and bareloop-shaped: a Settings screen
for API keys and limits. bareloop's shape is a 0600 keys file with names-only exposure to the page,
a config file for limits, settings routes, and no route that writes a key value back. **Not in M6a.**

**Exit.** hamr drafts job #2 live on deepseek-flash with `fwdloop draft`, reads the readout, signs
with `fwdloop sign --approve`, and `fwdloop run` on the new flow reaches its ask. That flow is M4b's
job #2 (it replaces M4b's pre-step rebuild).

**Negatives, each able to fail.**
- Sign with no hash or the wrong hash: refused, no flow written.
- A draft or hand-edited declaration granting an unwired verb: refused at sign, $0.
- Prose edited after the draft: hash mismatch, refused.
- The draft dir never contains a key value (scrub sweep).
- Budget exceeded: stops, priced, booked.

**POC first (riskiest assumption).** The drafter emits a VALID `src` declaration for job #2 through
the new forced schema, with no converter. 20 paid drafts on deepseek-flash; bar >= 18/20 valid
(after at most the allowed retries and revisions). **Cap $1.00 for all of M6a — SIGNED 2026-09-29.**

**POC bar MET — ruled by hamr 2026-09-29:** m6a-poc-2, 20/20 valid on deepseek-flash (thinking disabled, bare-agent 0.49.0, F49), $0.017; M6a ledger $0.049 of $1.00.

**Exit evidence (live, 2026-09-29) — EXIT SIGNED by hamr 2026-09-29 ("sign m6a exit"):**
- Draft: `fwdloop draft`, 1 round, $0.0010, green, spec hash 19998ddf…; `sign --approve` wrote flows/job2-m6a.
- Run parked at the line-4 ask ($0.0287); hamr rejected ("too short"), resume redrafted (attempt 2, shape passed), hamr accepted, send wrote the artifact byte-identical to the accepted summary.
- Run cost $0.0701 (6 priced rows, 0 nulls, modelMatch "match"); M6a ledger $0.1199 of $1.00.
- Finding F50 (NOT fixed): the drafter dropped prose-only detail ("200ish each"); the ask caught it.

### M6a amendment 1 — goal is the signed line, verbatim; no default ask wait — SIGNED by hamr 2026-09-29 ("sign m6a amendment 1")

- **Why:** F50. The drafter paraphrased goals and dropped "200ish each". Before M6a, the goal was the line verbatim (F38). The ask showed a 30-minute wait hamr never set.
- **Scope:**
  1. The machine fills each step's `goal` with its signed job line (by `fromLine`), verbatim. The drafter no longer authors `goal` (removed from the forced schema). `sign` refuses any declaration whose step goal is not exactly its signed line.
  2. The model step still never sees its guardrail, close/shape or cap (the M2 rule stands); guardrails are NOT passed to the step.
  3. An ask's wait (TTL) has no code default: it must be signed by hamr in the prose, or draft/sign refuses by name.
- **Exit (live):** redraft and rerun job #2 with hamr's prose (plus hamr's own TTL line). The first attempt reaches the ask with sections of about 200 words each and no reject; hamr accepts; it sends.
- **Negatives:** a hand-edited goal that doesn't match its line is refused at sign; the step's prompt contains the line exactly; the step's context never contains the guardrail/shape/cap; no TTL signed is refused.
- **Cap:** $0.30, from M6a's remaining budget (a sub-cap within M6a's $1.00, not extra).
- **Not in scope (goes to M6b):** readout/UI wording (see M6).

**Exit evidence (live, 2026-09-29) — EXIT SIGNED by hamr 2026-09-29 ("sign m6a exit"):**

- Draft (`poc/m6a/out/exit-2/draft`): green, 2 rounds (one validator revision), $0.0015; every step goal is the signed line verbatim (line 3 kept "200ish each"); the ask shows hamr's signed wait, "ask 30m:".
- Run `exit2-run-1` (flow `flows/job2-m6a-2`): summary step attempt 1 a machine red (headings not exact lines, gap-back), attempt 2 green; parked at the ask with sections of about 180/152/145 words (477 total), against 100/45/25 before the fix (exit-1).
- hamr accepted with no reject; the resume file sent is byte-identical to the accepted artifact (checked).
- Costs: run $0.01497 (4 priced rows, 0 nulls, modelMatch match); M6a ledger total $0.13630 against the $0.30 cap. Note: "200ish" landed at 145-180 because it is prose-only and only the human judges it (F50 remaining note).

### M6a amendment 2 — only a person at a keyboard can sign — SIGNED by hamr 2026-09-29 ("sign m6a amendment 2")

- **Why:** /branch-review found `fwdloop sign` can't tell a human from a script: anything with a shell (an agent included) can run draft, then `sign --approve <printed hash>`. The hash stops tampering, not a non-human approver.
- **Scope:** `fwdloop sign` works only in an interactive terminal (stdin AND stdout are TTYs). It shows the flow name and asks the human to type the flow name back. `--approve <hash>` stays. No TTY -> refused, no flow written.
- **Negatives:** piped stdin -> refused, no flow; the wrong typed name -> refused, no flow; a real TTY + the right name + the right hash -> signs.
- **Exit:** hamr signs a draft in his own terminal and it works; the orchestrator's attempt from its non-interactive shell is refused.
- **Cap:** $0.
- **Honest limit:** this raises the bar and isn't proof; a determined script can fake a TTY (e.g. `expect`, `script`). Real proof of a person (a password, a hardware key) is later.

**Exit evidence (live, 2026-09-29) — EXIT SIGNED by hamr 2026-09-29 ("sign m6a amendment 2 exit"):**

- Draft: hamr drafted flow `job2-m6a-3` live on deepseek-flash, green, $0.00055 (spec hash 779e9c0a…), ledger row `m6a-exit-3-draft`.
- Refused: the orchestrator's non-interactive shell ran `sign` twice (stdin from /dev/null, and the right name piped with the right hash); both refused with "sign needs an interactive terminal", exit 1, no flow written.
- Signed by a person: hamr ran `sign` in his own terminal, typed `job2-m6a-3` at the confirm prompt, and it printed "signed: …/flows/job2-m6a-3 (by hamr)".
- M6a ledger total now $0.13684 (cap $1.00).

**Not in M6a:** the UI (M6b), editing and versions (M5), an LLM scout, litectx verbs, a settings
screen.

## M5 — dry-run, accept, versions

Placed here because the UI's "edit and add turns" is meaningless without versioning. Dry-run
redirects egress to a file and changes nothing else — reads stay real. Accept signs a version hash,
any edit flips it and demands re-accept, and rollback restores a previous accepted version
(docs/archive/PRD.md:585-591).

- **Exit:** an edited flow refuses to run until re-accepted, and rollback restores a prior version
  whose cases still pass (docs/archive/PRD.md:592-593).
- **Negative:** a flow edited on disk without re-accept is a red naming the changed field, never a
  silent run of the new version (docs/archive/PRD.md:594-595).

## M6 — describe, sign, and edit a flow (authoring)

Authoring only now — watching a run, the inbox and its three doors, and the audit view moved to M4
(RULING A, 2026-09-26). What's left here: describe a job in prose plus guardrails and see the
drafted steps; sign it; and **edit an existing workflow and add turns to it**, which re-signs
through M5 (docs/archive/PRD.md:597-605).

- **Exit:** a person who has never used the CLI can describe job #1 and sign it, then edit it to add
  a turn and see it re-sign through M5 — without opening a terminal. Running it, watching it,
  answering its ask, and reading why a red was red are M4's exit (see above), not repeated here
  (docs/archive/PRD.md:606-607).
- **Negative:** tracing a wrong number to its source cell is M4's negative (see above). This
  module's own negative is an edit that skips re-accept, which M5 catches
  (docs/archive/PRD.md:608-609).
- **Wording (from M6a amendment 1, M6b scope):** the readout/UI says "how each step is checked" where it now says "Success", and "shown to you at the next ask" where it says "human check" on non-ask lines.

## M7 — skills and persona

Skill directories gate the drafter's visible primitive subset, and a signed persona line affects
`compose` wording only. Menu-is-inventory: a checkbox with no skill directory is a validation red
(docs/archive/PRD.md:611-614).

- **Exit:** the drafter cannot select a primitive its signed skillset does not unlock
  (docs/archive/PRD.md:615-615).
- **Negative:** persona changes wording and never a cited figure (docs/archive/PRD.md:616-616).

## M8 — case library and maintenance mode

A `cases/<id>/` directory per flow; every human-resolved red becomes a case, re-run on every edit
and every model or provider change, with the incident loop detect → diagnose → contain → extend
(docs/archive/PRD.md:617-620).

- **Exit:** a model swap that breaks a case is refused at accept, naming the case
  (docs/archive/PRD.md:621-621).

## M9 — triggers and flow handover

`manual`, `cron`, `file-drop`, then `inbox-poll`. Flow-to-flow handover rides `file-drop`, and the
monthly wall is enforced **by the trigger**, before a run starts.

- **Exit:** a trigger refuses to fire when the month cannot fund a whole run, recording
  `monthly-exhausted` rather than starting and halting mid-way.

## M10 — real IO

Mail in and out, chat, browse — each behind the signed allow-list and a prior `ask` accept in the
same run. Scope is stated when its turn comes.
