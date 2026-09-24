---
type: reference
title: "The module ladder — M0 through M9"
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
   drafter can reach. Skills gate the visible subset (M6 does persona; M1 only makes the
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

**Not in M1:** running a declaration (M2), the inbox (M3), dry-run and versions (M4), any UI,
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
   `5. ask 30m: check it with me,` (`<int>` then `s`, `m` or `h`; default 30m, as today).
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
TTL (M3), dry-run/accept/versions (M4), any UI, learning across runs, an LLM judge.

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

**M2 EXIT — evidence on the table, NOT yet signed** (proposed 2026-09-24, runner at `a045b73`, F40).

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

Spend: $0.53 POC + $0.06 live = $0.59 of the $5.00 cap. Suite 1171/1171. Known gap: `done: false` is
proven by tests, never yet fired by a live model. hamr signs or names what is missing.

## M3 — ask and inbox, the HITL window

The inbox and its answers, TTL, and checkpoint/resume at step level. A pause spends nothing, and a
resume never re-asks an answered question (docs/archive/PRD.md:578-581).

- **Exit:** a run pauses, a separate process answers, the run resumes into the next step
  (docs/archive/PRD.md:582-582).
- **Negative:** an expired TTL cancels; a rerun is a fresh engagement with its own counter
  (docs/archive/PRD.md:583-583).

## M4 — dry-run, accept, versions

Placed here because the UI's "edit and add turns" is meaningless without versioning. Dry-run
redirects egress to a file and changes nothing else — reads stay real. Accept signs a version hash,
any edit flips it and demands re-accept, and rollback restores a previous accepted version
(docs/archive/PRD.md:585-591).

- **Exit:** an edited flow refuses to run until re-accepted, and rollback restores a prior version
  whose cases still pass (docs/archive/PRD.md:592-593).
- **Negative:** a flow edited on disk without re-accept is a red naming the changed field, never a
  silent run of the new version (docs/archive/PRD.md:594-595).

## M5 — localhost UI, the crux

Ruled the crux of the product, where humans author, run, describe and observe — so it moves here
from last, and every module after it ships its screen (docs/archive/PRD.md:597-600).

Scope: describe a job in prose plus guardrails and see the drafted steps; run it; watch it; the
inbox and its three doors; `audit <run>` as a readable table with the citation trail; and **edit an
existing workflow and add turns to it**, which re-signs through M4. Responsive and phone-tested per
AGENT_RULES — this is not a POC (docs/archive/PRD.md:601-605).

- **Exit:** a person who has never used the CLI can describe job #1, sign it, run it, answer its ask,
  and read why a red was red — without opening a terminal (docs/archive/PRD.md:606-607).
- **Negative:** a wrong number is traceable to its source cell in one screen; if it is not, the audit
  is a log and not a product feature, and that is a spec change (docs/archive/PRD.md:608-609).

## M6 — skills and persona

Skill directories gate the drafter's visible primitive subset, and a signed persona line affects
`compose` wording only. Menu-is-inventory: a checkbox with no skill directory is a validation red
(docs/archive/PRD.md:611-614).

- **Exit:** the drafter cannot select a primitive its signed skillset does not unlock
  (docs/archive/PRD.md:615-615).
- **Negative:** persona changes wording and never a cited figure (docs/archive/PRD.md:616-616).

## M7 — case library and maintenance mode

A `cases/<id>/` directory per flow; every human-resolved red becomes a case, re-run on every edit
and every model or provider change, with the incident loop detect → diagnose → contain → extend
(docs/archive/PRD.md:617-620).

- **Exit:** a model swap that breaks a case is refused at accept, naming the case
  (docs/archive/PRD.md:621-621).

## M8 — triggers and flow handover

`manual`, `cron`, `file-drop`, then `inbox-poll`. Flow-to-flow handover rides `file-drop`, and the
monthly wall is enforced **by the trigger**, before a run starts.

- **Exit:** a trigger refuses to fire when the month cannot fund a whole run, recording
  `monthly-exhausted` rather than starting and halting mid-way.

## M9 — real IO

Mail in and out, chat, browse — each behind the signed allow-list and a prior `ask` accept in the
same run. Scope is stated when its turn comes.
