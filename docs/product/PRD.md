# fwdloop — preliminary PRD (DRAFT v0.3, 2026-09-08, for discussion, NOT signed)

> Status: discussion draft in AGENT_RULES shape (problem/goal, go/no-go, out of scope, modules,
> open questions). v0.1 assumed a repo patient and N hops of bareloop; hamr's interview
> (2026-09-08) replaced that: fwdloop is a **standing, non-repo, human-described daily
> automation**, its own repo, borrowing bareloop's solved problems by COPY, never import.
> Sources mined for this draft: bareloop wiki + FINDINGS (F1–F137), litectx
> `docs/02-engineering/build-studies.md`, multis (its memory is vendored litectx), and the
> bare-suite adopter contracts (bareagent 0.41, bareguard 0.15, barebrowse 0.20,
> baremobile 0.11, litectx 0.32, beeperbox 0.9, mailproof 1.3).
> **[B]** = borrowed with source. **[NEW]** = proposed here. **[?]** = needs hamr's word.
> v0.3 folds in interview round 2 (§3 items 11–14, §5 effect checks, §9 answers, §10 ceilings).

## §1 Problem & goal

A forward deployment engineer has a good description of a flow: *check inbox for mail from
@domain, capture the customer's mail, match the name in this sheet, summarise name / balance /
owed / due, hand it to me, wait for approve or cancel, then send.* They do not want to design
the workflow. They want to describe it as **steps + guardrails**, have an agent build it, dry-run
it on non-live docs, accept it once, and then run it every day from a simple local UI. It must
keep history, self-heal (bounded retry, then tell the human exactly what is wrong), and stop at
every point the human placed a stop. Editing it is a deliberate maintenance act, not drift.

Goal: **describe → build → accept once → rerun forever, under an arbiter the flow cannot touch.**
Not green-minting. "Done" for one run = every step closed, every ask answered, spend under cap.

## §2 Go / no-go — the capability the product stands or falls on

**Can a non-code step be checked without a human?** bareloop's whole record works because every
close was mechanical (F104: the one doc-genre job could not be checked, so the composer invented
a fake proxy check; doc-genre was then dropped). A daily automation that asks a human at every
step is not automation. So the load-bearing claim is:

> **Grounded structured output makes non-code steps mechanically checkable.** Every step emits a
> typed artifact; every figure/quote in it carries a citation to a source artifact (sheet cell,
> mail id, doc span); the step's close is deterministic: shape valid, every citation resolves,
> cited value equals the value stated. The judge (if any) only extracts; a fixed rule decides
> (bareloop softgreen doctrine **[B]** close-verdicts §5). Unsure = red.

Module 0's POC aims at exactly this. Pre-registered pass: on job #1 with a **planted wrong
number** in the model's output (not in the check), the citation close goes red and names the
gap; with no plant it goes green; a step whose output cannot be grounded is refused at draft
time, never "checked" by a proxy. **Fails → stop; fwdloop v1 becomes human-checked only, and
that is a different, smaller product.**

## §3 What was heard (load-bearing decisions — sign each, or strike)

1. **Own repo, complete separation.** `fwdloop` depends on bare-suite packages; it COPIES what it
   needs from bareloop (with a `borrowed-from:` header naming file + commit), never imports it.
   Standing dev rule: before building anything, check bareloop wiki/FINDINGS, litectx
   build-studies, and multis for the solved problem.
2. **Not a repo.** A flow lives in a **flow directory**: `flow.json` (signed), `artifacts/`,
   `notes/`, `history.jsonl`, `spine.jsonl`, `memory.db`. Inputs arrive as path / URL / API / doc.
   Consequence: no git branch, no worktree, no "tree-changed" pairing — the blast radius is the
   flow directory plus a signed egress allow-list.
3. **Fixed after accept.** First run is a dry-run (egress to files only, advised on non-live
   docs). Accept once → the flow is immutable and reruns on its trigger. Edit = maintenance mode
   = new version, new hash, new dry-run, re-accept. **No cross-run learning in v1** (bareloop's
   bridges/inheritance do NOT transfer — hamr: "it won't change").
4. **Human input shape = steps + guardrails.** Steps: one line each, action verbs, free text
   allowed. Guardrails: expectations as a checkbox skillset (memory, accounting, read pdf,
   browse, mail, chat…) plus limits. The drafter may **reorder or insert** steps at draft time if
   the human erred; it shows a diff; the human signs the whole. After signing, immovable.
5. **One cap per run.** Agent allocates per-step shares, replan on variance (bareloop T·A **[B]**).
   Wall = machine time only. Ask TTL = 60 days, same for all, tighten-only later.
6. **Self-heal ladder.** One retry on transport-class failure only; two strikes on a step's close
   → escalate to the human with the actual gap text and what was tried, never "it failed"
   (**[B]** workflow-governance "two strikes", F98 gap carries the lines).
7. **CLI first**, localhost UI after (responsive, mandatory when it lands).
8. **Job #1 = the accountant** (recommended over the inbox monitor): daily sheet → numbers
   calculated/verified with citations → ask (review) → on accept, send. It needs no live inbox,
   no trigger beyond "run now", and works on local docs — matches "start small with local reads."
   The inbox monitor becomes job #2 once triggers + mail land (M5/M6).
9. **LLM-agnostic from day one** via bareagent's providers (OpenAI / Anthropic / Ollama), one
   factory, env-key by name. bareloop's item 28 shape, done first here instead of last.
10. **bareloop item 21 closes by ruling**: `human-confirms` is not deleted; it is copied into
    fwdloop as the `ask` step. bareloop keeps it as the end-of-close pause it already is.
11. **Every step has an effect check** (hamr, round 2: "you will make sure that it happened,
    humans will verify"). Each step kind carries a mandatory mechanical *happened* check —
    output exists and is non-empty, a sent message has a delivery id, a file landed — and the
    citation close on top where the output is prose. This is bareloop's `tree-changed`
    pairing **[B]** generalised: one effect check per step, always; never "it ran".
12. **Handoffs between flows.** Flow B may wait on flow A's artifact. v1 shape: A's `send`
    writes to a directory; B's trigger is `file-drop` on it. Separate flows, one file, one
    history row each side naming the other's run id. No new machinery in v1 **[NEW]**.
13. **Audit trail is a product feature, not a log.** `history.jsonl` (one row per run) plus
    `audit.jsonl` (one row per step: inputs by artifact id + hash, output id + bytes, effect
    check, close result, $ and ms, provider, model). Loadable by anyone, readable by a human
    in a table (`fwdloop audit <run>`, borrowed from bareloop `replayRun`/`formatReplay`
    **[B]**). Built for diagnosis: "where did it go wrong" in one screen.
14. **Skills and a persona from day one.** A flow directory carries `skills/<name>/SKILL.md`
    (doc + the tool subset it unlocks; bareagent `SkillRegistry` **[B]**) and a signed persona
    line under guardrails. The skillset checkboxes in §3.4 map one-to-one onto skills.
    Menu-is-inventory: a checkbox without a skill dir is a validation red.

## §4 Out of scope (v1)

No learning/bridges/inheritance. No swarm; one process per run. No LLM summarisation as the
default compressor (Arize finding via litectx build-studies:971). No new worker verb `run`
(locked, as in bareloop). No mobile control, no cloud, no multi-user, no chat UI (the inbox is
a list). No live inbox/mail egress until M6. No self-adjusted budgets, ever.

## §5 The shape

**Flow spec** (signed whole, hash flips on any edit, `--version` folded in):
`{ name, version, trigger, steps[], guardrails, cap: { usd, wallMs }, askTtlMs, egress: allowList }`.
`trigger`, `cap`, `askTtlMs`, `egress`, and every `ask` step's position are arbiter fields:
human-authored, inexpressible to the drafter (bareloop's locked-kinds pattern **[B]**).

**Step kinds** (menu, frozen; anything else is a red at validation):

| kind | does | effect check (always) | grounding close (where prose) | bucket |
|---|---|---|---|---|
| `gather` | read inbox / sheet / doc / url → typed artifact | artifact non-empty, source hash recorded | — | SELECT / io |
| `derive` | compute, match, verify from artifacts | output non-empty | every figure cites a source; cited == stated | COMPRESS |
| `compose` | summary / mail draft from artifacts | output > 0 bytes, shape valid | every claim cites; no uncited figure | COMPRESS |
| `ask` | render question + evidence, PAUSE | disposition recorded with exact words | — | ISOLATE |
| `send` | egress: mail / chat / file | delivery id / file path captured | target ∈ signed allow-list; prior `ask` accept this run | io |
| `remember` | write facts to memory (supersede by id) | row count or hash changed | schema valid | WRITE |

The four buckets are litectx's context-engineering taxonomy (build-studies:1126-1168). Proposed
use: **internal**, to organise the primitive catalogue the drafter selects from — not the
human-facing step labels (humans think in verbs: check, match, summarise, ask, send). hamr said
this frame can be discarded; recommendation is keep it as the catalogue index only **[?]**.

**Run = a fold over steps.** Each step runs in a fresh context carrying only: the signed goal
line for that step, the prior steps' compact artifacts (never their transcripts), the notes
file, and the memory facts it pulls on demand. That is litectx's "frequent intentional
compaction" (build-studies:993-1015) and bareloop's notes-forward channel **[B]**; retrieval is
need-initiated, never gifted (HARNESS-TALK row 10, F36/F39). Stable content first, run-specific
last, append-only, deterministic serialisation (KV-cache finding, build-studies:845).

**Untrusted input.** Inbox/doc content enters tagged `provenance: untrusted`; the assembler
drops or quarantines any such block that reads as instruction, by shape not by judgment
(build-studies:733,761). Secrets: env only, denylist + shape-match at the tool boundary, scrub at
capture (bareloop `CLOSE_ENV_DENY` **[B]**). bareguard's `Gate` fences fs / net / secrets per step.

**Ask.** `human-confirms` copied: pause costs nothing, consumes no allowance, no fourth door;
the checkpoint stores the door taken + exact words so a resume re-enters the next step, never
the question (F102 **[B]**). A rerun is a fresh engagement with its own slice, cumulative and
this-engagement shown side by side (F103 **[B]**). Expiry of the TTL is what cancel used to be.

**Memory across days.** litectx as the store (it is what multis actually runs): `owner` = flow,
`session` = run; episodes run-scoped and pruned on a rolling window; facts durable, superseded
by id (never accumulated), promoted only by demand (`recall_log` hits, fetch ≠ recall); raw
day-N dumps parked in `stash`, retrievable by id, never searched (multis survey, store.js:231).
Nothing is silently dropped: `dropped[]` with a reason and a restorable handle.

**History.** `history.jsonl` one row per run: version hash, trigger, outcome
(`complete | paused | cap-halt | wall-halt | escalated | provider-red | close-red`), spend
(`spentUsd` + `spendComplete`, unknown never rendered as 0 **[B]**), asks answered, artifacts.

**Money honesty** copied whole from bareloop: per-round metering, cap binds between rounds and
may overshoot one round, unpriced halts, `estimated` is a state not a refusal, budget told to
the planner as a remaining balance and never to the step executor (money-time wiki **[B]**).

## §6 Primitives to expose (the full inventory, by bucket)

From the suite, tagged for the catalogue. Not all land in v1; the drafter sees only what a
signed skillset checkbox enables (bareloop: a widened menu is inert without a reason to reach
**[B]**; menu-is-inventory — every entry maps to an existing implementation).

- **WRITE:** litectx `remember` / `ingest` / `stash` / `forget` / `purge`; bareagent `Memory`
  + `Store` (SQLite FTS5), `remember` (spans → facts), `StateMachine`, `JsonlTransport`;
  bareguard `gate.record`, `gate.annotate`; barebrowse `saveState`; mailproof `ingest`,
  event lifecycle.
- **SELECT:** litectx `recall` / `get` / `peek` / `impact` / `related` / `recentMemory` /
  `promotionCandidates`; bareagent MCP bridge / `buildMetaTools`; barebrowse `snapshot`;
  baremobile `snapshot` / `find_by_text`; beeperbox `list_inbox` / `list_unread` /
  `search_messages` / `poll_messages`; mailproof `loadEvent` / `listCommits` / `verify`.
- **COMPRESS:** litectx `compress` / `assemble` / `summaryWindow` / `trim`; bareagent
  `toUnits` / `unitAssembler` / `unitTrimmer` / `harvestKey`, `SkillRegistry`; barebrowse
  `readable`; bareguard `redact`.
- **ISOLATE:** bareguard `Gate` (`check` / `run` / `terminate` / `raiseCap`, fs/net/secrets/
  budget config); bareagent `Checkpoint` (human gate), `Retry` / `CircuitBreaker` /
  `FallbackProvider`, `wireGate`, spawn/defer with depth+budget bounds; litectx `scoped` /
  `WriteAudit`; barebrowse tabs / incognito / `blockPrivateNetwork`; baremobile sessions.
- **IO (egress, always fenced):** mailproof `sendmail` / `buildRawMessage`; beeperbox
  `send_message` / `note_to_self`; barebrowse interact + `pdf`; baremobile interact.
- **Providers:** bareagent `OpenAIProvider` / `AnthropicProvider` / `OllamaProvider` /
  `FallbackProvider`. (`CLIPipe` exists; OUT as a peer per bareloop F48 **[B]**.)

## §7 Modules, in order (one at a time; a rung that cannot meet its exit stops)

- **M0 — go/no-go POC** (~1 day, one paid draft + one paid dry-run ≤ $5, rest $0). Hand-written
  steps+guardrails for the accountant → drafter emits a declaration over the kind menu →
  runner executes on a local sheet + a local mail file → citation close on `derive`/`compose` →
  `ask` pauses → `answer accept` from another process resumes → `send` writes a file.
  Exit: planted-wrong-number goes red with the cell named; unplanted goes green; an ungroundable
  step is refused at draft. Measure: $ per run, tokens per step, wall. Riskiest assumption is
  §2, aimed first.
- **M1 — spec + validator + hash.** Step-kind menu, guardrail schema, arbiter fields
  inexpressible to the drafter, ReDoS-safe patterns, mutation-proven.
- **M2 — runner.** Fold over steps, per-step fresh context, artifacts/notes, spine, money +
  wall, strikes, checkpoint/resume at step level, provider factory (agnostic).
- **M3 — ask + CLI inbox.** `fwdloop inbox`, `fwdloop answer <id> accept|rerun "<t>"|pause`, TTL.
- **M4 — dry-run / accept / maintenance.** Versions, hash, re-accept, `history.jsonl`.
- **M5 — triggers.** `manual`, `cron`, `file-drop`; then `inbox-poll` (beeperbox / mailproof).
- **M6 — real IO.** mail in/out, chat, browse — each behind the signed allow-list and a prior ask.
- **M7 — localhost UI.** Steps+guardrails editor, inbox, history. Responsive, phone-tested.

## §8 Learnings that transfer (the discussion — all cited)

1. Verdict and disposition never merge; a person's answer layers on, never rewrites
   (close-verdicts:69). 2. Three doors, cancel deleted; TTL expiry is the cancel (close-verdicts:71).
3. Pause is allowance-free (close-verdicts:72). 4. Never re-ask an answered question after
resume (F102). 5. Rerun = fresh engagement, two counters side by side (F103). 6. One durable
checkpoint record: time, money, strikes, notes, pending ask (softgreen door §3.5). 7. Steps end on
progress, two strikes, gap travels forward (workflow-governance). 8. Bound retries by typed
cause; fund retry + its check together (money-time). 9. Unknown cost is never 0; floors are
floors (money-time). 10. Budget as remaining balance to the planner, never to the executor.
11. Notes carry the actual detail, not a count (F28/F98). 12. Delivery ≠ conversion: verify the
answer changed the output (F32). 13. Retrieval is navigation, never gifts (F36/F39). 14. Secrets
denylist + shape at the tool boundary, scrubbed at capture. 15. The automation never authors its
trigger, cap, ask, or done. 16. Judge extracts, rule decides, unsure = red (close-verdicts §5).
17. A loose ask breeds a proxy check (F87/F104) — the reason §2 is the go/no-go. 18. Few large
outcome-checked steps beat many self-graded substeps (F81, 7/7 vs 0). 19. Scout retries only on
malformed output, logs every raw emission. 20. Stable-prefix-first, append-only context
(build-studies:845). 21. Compact between phases, carry the artifact, reset the window
(build-studies:993). 22. Restorable compression only; `dropped[]` with handles (build-studies:615).
23. Provenance-untrusted gate by shape (build-studies:733). 24. Supersede facts by id; promote
by demand; stash raw dumps unsearched (multis/litectx store.js). 25. Popularity/recency/edit
signals are surfaced, never scored (litectx, falsified thrice).

**Learnings that do NOT transfer (named so nobody copies them):** bridges / run-as-executed
inheritance / contrast attribution (no learning in v1); work-branch + worktree rules (no repo);
`tree-changed` pairing and typecheck/test-count kinds (code genre); the bench and its tiers;
the read shim (tool-result cost profile is unmeasured here — measure in M0 before borrowing).

## §9 Open questions — round-2 answers folded (2026-09-08)

Answered by hamr: (1) lib conventions apply; npm name checked BEFORE the repo name —
`fwdloop` is TAKEN on npm (jaltez, 2026-03, a Pi dev CLI); free on npm+GitHub: `open-loop`,
`bareflow`, `fwdloopjs` — **name pending hamr**. (2) egress rule explained below, kept:
allow-list + prior accept. (3) monthly ceiling: yes — see §10. (4) W/S/C/I stays internal.
(5) no judge for `compose` in v1; the human at the `ask` is the judge; citations only.
(6) CLI first. (7) provider-red = the model API is down/erroring/timing out: bounded retry
then escalate — see §10. (8) name check done.

**Egress, in plain words.** Egress is anything that leaves the machine: an email sent, a Slack
message posted, a file pushed to a URL. The rule: the human signs a short list of allowed
destinations, and inside one run nothing goes out until a human has hit accept at an `ask` in
that same run. The agent never sends on its own say-so.

**Judge for `compose`, in plain words.** `compose` writes prose. The citation close proves the
numbers. A judge would be a second cheap model reading the prose to pull out facts ("does it
name the due date", "is the tone right") with a fixed rule deciding. It costs money per run and
needs a 10-of-10 calibration per provider. v1 skips it: the human at the `ask` reads the prose.

## §9b Still open (do not block M0)

1. **Name** (blocks repo creation only): `open-loop` / `bareflow` / `fwdloopjs`. **[?]**
2. **Dependency count under lib conventions.** Suite packages are the budget's first claim
   (bareloop ships 3). fwdloop needs bareagent + bareguard + litectx; mail/chat/browse arrive
   as optional peers only when a skill is checked. Confirm 3 is acceptable. **[?]**
3. **Ask notification.** Chat ping (beeperbox `note_to_self`) that an ask is waiting, answer
   still via CLI — M3 or M6? Recommendation: M6, with the other IO. **[?]**
4. **Monthly shape.** Pick A or B in §10. **[?]**

## §10 Ceilings and outages — proposed rules (discussion)

**Why monthly matters** (hamr): companies ask up front how to make the best use of tokens so
the machine stays cheaper than the human. So the audit row carries $ per run and per step, and
a monthly wall exists that the trigger itself respects.

**Shape A — hamr's sketch.** Monthly `M` signed; daily = `M / 30`; resets on the 1st; a run in
its LAST step may exceed its daily by 10%, debited against `M`.
Cost of A: three numbers (monthly, daily, grace) and one exception. The exception is a widening
rule, and bareloop's record says every widening rule gets found by the agent (F-series: a run
learns where the slack is). It also has a hole: a run paused at an `ask` for two days resumes
on day N+2 — whose daily does it debit?

**Shape B — recommended, simpler, tighten-only.** Two signed walls, both hard:
- `cap.usd` per RUN (already in §5). Overshoot only by one round, as bareloop **[B]**.
- `cap.monthlyUsd`. The trigger fires ONLY if `monthlyUsd − spentThisMonth ≥ cap.usd`, i.e.
  the whole run is funded before it starts (bareloop: fund the attempt plus its close **[B]**).
  Otherwise the trigger records `monthly-exhausted` and does not start. No daily number, no
  grace, nothing to borrow: a resumed run debits the month it spends in.
- Month = calendar month, reset on the 1st 00:00 local; `spentThisMonth` is summed from
  `history.jsonl`, `spendComplete` false makes it a floor (unknown never reads as 0).
- Informative only, in the UI/CLI: "at this pace, `N` runs left this month."
Under B the "last step" case cannot strand a run, because the run was funded whole at start.
The only way to get more runs is a human raising `monthlyUsd` and re-signing.

**Provider-red** (the model API down / 5xx / timeout): one immediate transport retry (bareloop
rule **[B]**), then the run parks as `provider-red` (resumable, nothing lost), the trigger retries
the parked run at +5, +15, +45 min (three tries, fixed, tighten-only), then escalates to the
human with the error text. A run parked this way is funded already; retries do not re-fund.
