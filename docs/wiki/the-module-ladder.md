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

### M4 (the UI) — scope, exit, negative — M4a SIGNED by hamr 2026-09-26 ("signed M4a"), M4a EXIT SIGNED 2026-09-27, M4b SIGNED by hamr 2026-09-29 ("sign m4b"), M4b EXIT SIGNED 2026-09-30 ("sign m4b exit"), M4c SIGNED 2026-09-30 ("sign m4c")

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
