# PRD v0.4 gaps review — what must be pinned before M0 is pre-registered

**Status: review, 2026-09-08, by the fwdloop session on hamr's ask ("any ideas on prd? missing
items?"). Nothing here is decided. Items are proposals for a v0.5 round; each is marked [?]
(hamr's word needed) or [pre-reg] (must be written down before M0 fires so the POC cannot be
fitted to pass). The PRD is a portal: this list exists so the goal and shape mutate on
evidence, not on drift.**

## 1. Steps vs open prose — answered

hamr's question: does breaking the description into steps make more sense than open prose?

**Both, at different moments. Prose is the human's input; steps are the signed artifact.**
Three mechanical reasons steps must be the thing that is signed, none of them taste:

1. **Every step carries an effect check and, where prose, a citation close** (PRD §3.11, §5).
   Prose has no seams: there is nothing to attach a check to until the description is cut
   into units that each produce one artifact.
2. **An `ask` has a position, and the position is an arbiter field** (PRD §5). A position is a
   step index. In prose "then check with me" is a sentence; it cannot be locked.
3. **The audit row is per step** (PRD §3.13). "Where did it go wrong" in one screen needs the
   run to be a list.

The risk of steps-only input is granularity: humans cut at the wrong grain, and bareloop F81
measured that few large outcome-checked steps beat many self-graded substeps (7/7 vs 0). So
the drafter needs one more allowed edit than §3.4 lists today: **merge**, alongside reorder
and insert. All three show as a diff; the human signs the whole. The kind menu is what makes
the merge safe — a merged step still has exactly one kind and one effect check.

**Proposal for §3.4:** input is prose *or* a step list, the human's choice; the drafter always
emits steps over the kind menu; allowed drafter edits are reorder / insert / **merge**; a step
that cannot be given a kind is refused at draft, not paraphrased into one.

## 2. Missing items, ranked by what breaks if absent

### [pre-reg] 2.1 The citation schema is the go/no-go and is not specified

§2 says every figure carries a citation to a source artifact and the close is "cited value
equals the value stated". That is the whole product claim, and the PRD does not say what a
citation *is*. Before M0 the following must be written down, because each one is a place a
POC can be quietly fitted:

- **Address forms per source kind**: sheet → `sheet!cell` (and whether a range is allowed);
  mail → message id + span (line/offset? header field?); doc → span. One resolver per kind.
- **Equality rule for figures**: `1,000.00` vs `1000` vs `1e3`; currency symbols; rounding
  when the sheet holds 3 decimals and the summary shows 2. Unsure = red (§2) — but the
  normaliser must be fixed *before* the run, or the first red gets "fixed" by widening it.
- **What counts as a figure/quote needing a citation**: numbers only? dates? names? A name
  match is the accountant's step 3 and is not a number.

### [pre-reg] 2.2 Derived figures need a formula, not just citations — M0's hardest case

`derive` "computes, matches, verifies". If the model computes `owed = balance − paid` and
cites both inputs correctly but sums wrong, the citation close as written **goes green**: every
cited value equals its source; the *derived* value has no source to equal. That is a wrong
number with perfect citations — the exact hole the go/no-go exists to close.

**Proposal:** a derived figure carries `formula` over cited inputs, and the close evaluates it
deterministically (`+ − × ÷`, min/max, count over a cited range — a fixed tiny grammar, no
`eval`). **M0's planted wrong number must be a derived one**, not a copied one. A copied-number
plant tests the resolver; a derived-number plant tests the claim. This is the hardest scenario
and the POC aims there first (AGENT_RULES: POC the riskiest mechanism, not the easy part).

### [pre-reg] 2.3 Fixture policy for job #1

AGENT_RULES: prefer real, uncrafted data; a fixture authored to contain the phenomenon can
only confirm it. The PRD says "local sheet + local mail file" and nothing about where they
come from. Needed: **what format** (CSV vs XLSX decides whether a dependency is needed — CSV
is stdlib; XLSX is a parser dep and a §9b dependency-count question), **who authors them**
(hamr supplies a real-shaped sheet with a real-shaped mail; the session never authors the
data it will then check), and **which cells are the truth** (recorded before the run).

### [?] 2.4 Input drift is not a red today

`gather` records a source hash (§5), so a changed file is detected. A changed *shape* is not:
a renamed column, a moved total row, a mail template that stops carrying the customer name.
Today that surfaces as a citation that fails to resolve, deep in `derive`, with a gap text
about a cell. **Proposal:** the signed flow carries an input expectation per `gather`
(column names / required headers), and `gather`'s effect check includes shape-matches-signed →
`input-drift` outcome, escalated with the diff. Cheap, deterministic, and it is where the
daily job will actually break in month two.

### [?] 2.5 Duplicate egress on rerun

A rerun (F103 shape: fresh engagement) of today's flow after a `send` would send again.
Nothing in §5 or §10 prevents it. **Proposal:** `send` carries a dedupe key
`(flow version, trigger instance, target)` recorded in `history.jsonl`; a second `send` with
the same key is refused at $0 and named in the audit. Tighten-only; the human can rerun by
naming the key.

### [?] 2.6 "Daily" has no calendar semantics

Which day's sheet; local timezone; a run paused at an `ask` across midnight, or across the
1st (§10 already answers the money half: it debits the month it spends in). Needed: the
trigger instance carries a `businessDate`; artifacts and the dedupe key (2.5) hang off it.

### [?] 2.7 Retention of customer data on disk

Job #1 writes customer names, balances, and mail bodies into `artifacts/` and `audit.jsonl`
every day, forever. §5 covers secrets; it does not cover **data**. Needed: a retention rule
per flow (signed, tighten-only), `fwdloop purge <before-date>` that leaves the audit *shape*
and removes the *bodies*, and a statement in §4 that this is v1 scope or explicitly not.
Cost of leaving it: the first real adopter is an accountant, and the first question they ask
is where the data goes.

### [?] 2.8 `remember` vs "no cross-run learning" reads as a contradiction

§3.3 "no cross-run learning in v1"; §5 has a `remember` step writing facts across days. Both
are right and the PRD should say why: **data memory yes, behaviour memory no** — facts about
the world (customer X's balance last seen Y) persist; nothing about *how the flow runs*
changes. One sentence in §3.3 closes it.

### [?] 2.9 Dry-run reads

Dry-run forces every `send` to a file (§10). It says nothing about `gather`: in dry-run does
the flow read the real inbox, or a fixture? For job #1 (local docs) the question is moot; for
job #2 it decides whether a dry-run can touch a live mailbox at all. Recommend: dry-run reads
are real (reads are not egress), stated explicitly.

### [?] 2.10 The number M0 must beat

§10 (hamr): "the machine stays cheaper than the human". M0 measures $ per run, tokens per
step, wall — against what? Pre-register the human cost of the accountant's daily sheet (even
a rough hamr number: minutes × rate) so M0's cost line is a comparison, not a figure.

### [?] 2.11 Persona has a checkbox and no shape

§3.14 signs a persona line under guardrails. Nothing says what it is for (tone of the
composed mail? the drafter's stance?) or what it may never override (an arbiter field). One
line: persona affects `compose` wording only; it is inexpressible to `derive` and `send`.

### [?] 2.12 Module exits beyond M0

Only M0 and M1 state an exit. A rung without an exit cannot fail, and a rung that cannot fail
cannot stop the ladder. One line each for M2–M7 before each starts (not now — but the PRD
should say that is the rule).

## 3. Housekeeping in v0.4 (strike at the next revision)

- §9 (1) and §9b (1): name is settled — `fwdloop`, on npm as 0.0.1 since 2026-09-08 (F1).
- §9 (5) says no judge for `compose` in v1; §5 now ships the flag OFF with a calibration
  refusal. Both true; one sentence in §9 should point at §5 so they do not read as a conflict.

## 4. What this review does not do

It does not change the go/no-go, the kind menu, the arbiter fields, or any ruling in §10.
It adds pre-registration detail under the existing claim so the M0 test can produce the
negative. If 2.2 turns out to be hard (formula extraction from model output is itself a
model task), that is a finding for FINDINGS.md and a spec change, not a reason to plant an
easier number.
