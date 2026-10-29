---
type: reference
title: "fwdloop — what it is, and what must hold"
status: draft
sources: [docs/archive/PRD.md]
---

# fwdloop — what it is, and what must hold

The product's identity, the two claims it lives or dies by, what it deliberately does not do,
the stack, and the model it runs on. The mechanics of a close are a separate page
(`how-a-step-closes.md`); the module order is `the-module-ladder.md`.

## The line: fwdloop is the job with a human in it

bareloop closes jobs that need **no human mid-run** — a machine check (`green`) or a rubric
judge (`softgreen`), over a repo or a plain folder, one-shot, healing itself by retry
(docs/archive/PRD.md:20-24). Human-in-the-loop never fit those rails: a HITL turn has different
hardness requirements, and bolting it in would entangle two sets of rails until every small
change became a release nightmare (docs/archive/PRD.md:20-24).

The line was ruled from both sides — bareloop PRD item 33, signed 2026-09-10
(docs/archive/PRD.md:26-34). **fwdloop = jobs with humans in them:** daily-grind automation of
part of a person's work, hitl windows, chat and multi-turn, daily/monthly budgets, prose plus
guardrails. It escalates to a person more than it retries, and may still carry deterministic or
rubric steps. A non-code job a machine or a judge can close with no human is bareloop's, not ours
(docs/archive/PRD.md:26-34).

The older framing — "fwdloop is the job bareloop refuses" — is **superseded and kept only so it
is not re-derived**: bareloop now takes plain folders via a hidden git scratch copy, so the
dividing line was never "no repo", it is the human (docs/archive/PRD.md:39-43).

## The goal

fwdloop replaces **a human's job** with code — not a repo, a job. The human describes the job in
their own words plus guardrails; the machine works out the steps, picks the primitives, wires
them, runs them, and stops where the human said to stop. **The human never thinks about which
primitive goes where.** That is the product (docs/archive/PRD.md:45-49).

This is FDE-shaped work: read a job, find the automatable portion, build a flow that runs most of
it with handover windows for a human to review, continue or push back
(docs/archive/PRD.md:51-53).

## Relationship to the bare suite — a hard rule

fwdloop is a **customer** of bareagent, bareguard, litectx, beeperbox, barebrowse and baremobile.
Never patch a primitive, never invent one. A missing or buggy primitive is an **upstream ask** in
`docs/product/UPSTREAM-ASKS.md`, and we wait for delivery. Learnings are borrowed from bareloop
and multis by **copying code with a `// borrowed-from:` header** — never by importing
(docs/archive/PRD.md:55-61).

## The two paired claims

Both must hold; either one false and there is no product (docs/archive/PRD.md:62-66).

- **Claim 1 — the close.** A step of a human's job closes **deterministically with no repo**.
  Every step emits a typed artifact; every figure cites its source; the close is mechanical —
  shape valid, every citation resolves, cited value equals stated value, derived figures
  recompute. Unsure = red (docs/archive/PRD.md:68-72).
- **Claim 2 — the description turn.** The human describes the job in their own words and **never
  names a primitive**. The drafter selects from the baresuite catalogue, and a deterministic
  validator proves the chain is **walkable** — step N's output shape fits step N+1's input
  (docs/archive/PRD.md:73-77).

If Claim 1 is false we are back in an unfenceable chat. If Claim 2 is false, fwdloop is a wiring
tool for engineers, and the person who benefits is the one who least needs it
(docs/archive/PRD.md:100-103).

**Neither claim is closed by prior evidence.** F5 proved a citation close catches planted errors,
but on hand-wired bespoke code, so Claim 1 holds only for code we wrote by hand. F10 proved a
drafter turns prose into a valid declaration and refuses an ungroundable step 6/6, but it emitted
**step kinds, never primitives**, and nothing checked that a chain composes — Claim 2 is untested
(docs/archive/PRD.md:105-110).

### The three close classes, in one line each

Every step declares how it closes, and the class is an **arbiter field** — human-declared,
validated, never inferred by the drafter (docs/archive/PRD.md:79-86).

| class | what closes it | cost |
|---|---|---|
| green | deterministic recompute — the citation close | $0 |
| softgreen | a human-declared **shape**, checked mechanically; no model judges anything | $0 |
| hitl | a person, at an `ask` whose position the human signed | $0 to pause |

On top of its class, **every step carries a mechanical *happened* check** — the artifact exists
and is non-empty, a sent message has a delivery id, a file landed with non-zero bytes. Never "it
ran" (docs/archive/PRD.md:88-95). Anything that fits no class falls to **hitl**, or a human writes
a shape for it; the machine never invents a check (docs/archive/PRD.md:96-99).

## The anchor job

Every POC runs against AR-aging job #1: `fixtures/ar-aging.csv` plus `fixtures/message.txt`. A
chat message asks what a customer owes; read the sheet, match the customer, list open invoices,
total owed, earliest due, count overdue as of a fixed `businessDate`, draft a reply, human
accepts, send. The fixture is real, from field research (docs/archive/PRD.md:112-116).

## Out of scope for v1

No swarm, no multi-agent orchestration, no RAG or vector store, no LLM summarisation as the
default compressor, no self-adjusted budgets ever, no cloud or multi-user, no learning between
flows, no fully automated flow without a human stop, and **no patching or inventing a baresuite
primitive** (docs/archive/PRD.md:404-409).

**No LLM judge.** Our `softgreen` is a declared shape checked mechanically; a second model never
decides a close (docs/archive/PRD.md:411-413). Name collision worth keeping straight: bareloop's
`softgreen` is a **judged** close with a calibration gate — same word, different mechanism
(docs/archive/PRD.md:415-417). Their calibration gate was offered and declined for now: it has
never run in 167 archived runs, and we have no judge to calibrate, so borrowing it would be
unproven machinery ahead of need (docs/archive/PRD.md:419-425).

**Parked, not scheduled: Jev as a triage gate** (hamr, 2026-09-28, idea passed on from the
bareloop session). bare-agent ≥0.44's `JevProvider.classify()` is a calibrated single-shot
classifier (yes/no probability, pick-one-key + confidence, or score; schema-checked output;
honest-null cost when unpriced; `calibrateJev` go/no-go harness). Candidate use: routing *before*
a signed ask ("which queue?", "does this need the human?"), never replacing a human accept or
deciding a close — as a close-decider it collides with **No LLM judge** above. Any confidence
threshold is an arbiter number hamr signs, never the agent's. Prerequisites before it can be
scoped: the use needs its own module with a signed scope/exit/negative (the bare-agent ≥0.44
prerequisite is met — fwdloop is on ^0.49.0 (0.48 at the fs-gate switch-over, 0.49 for the M6a drafter's `thinking` option)). Source: `../bareagent/src/provider-jev.js`,
`provider-jev-calibration.js`, bare-agent README "Fast gut check — Jev".

**Parked, not scheduled: two panel asks** (hamr, 2026-10-16, raised during the m11-am5 live walk; after the m11-am5 release). Not signed, not drafted; each needs its own amendment signed by hamr before it is built.
1. The Run tab summary shows how long the run took: `passed · $0.0047` becomes `passed · $0.0047 1m56s`.
2. The runs list Scheduled section gets its own filter/search, like the other sections.

**Parked, not scheduled: two hitl ideas** (raised by hamr 2026-10-19, unsigned). Not drafted; each needs its own amendment signed by hamr before it is built.
1. A guardrail code cannot check becomes a human review item instead of only a "Not checked" line. It complements the rubric and removes nothing that works.
2. A code-forced mid-run stop: when a step's check could not be judged by code and a later step reads that step's output, the run pauses for a human before the dependent step runs, even if the job signed no ask there. Open points: (a) it would need a signed amendment, because ask positions are human-signed today and this is a code-decided stop like M10's code-forced asks; (b) how it relates to today's rule that unjudged hitl output rides as evidence to the next signed ask; (c) scheduled runs would wait on a human; (d) measure how often it would fire on existing runs before designing. hamr's note, 2026-10-19, unsigned: it could be offered as an extra hitl with max limits (a cap on how many such stops a run may take). Otherwise it needs a rethink, or the job is split into two workflows, with a later design letting one workflow trigger another. Any version must be designed, tested and validated before it is built.

**Parked, not scheduled: clean up the run folder's JSON files** (hamr, 2026-10-24, unsigned). Not drafted; it needs its own amendment signed by hamr before it is built. A run folder has grown to about 30 kinds of JSON file, one or more added for most features. Counted over the 61 real runs in flows/ on 2026-10-24: `audit.jsonl`, `log.json`, `inputs.json`, `pids.jsonl` (61 each), `spend.jsonl` (55), `state.json`, `ask.json`, `answer.<askId>.consumed.json` (42 each), `trigger.json` (27), `thinking.json` (26), `signed-values.json` (20), `checks.jsonl` (19), `calls.jsonl` (18), `run-model.json` (13), `tools.jsonl` (10), `halt.json` (8), `sheet-checks.json`, `cited-checks.json` (7 each), `reopen.<askId>.N.json` (6), and the rarer `signed-values-r1.json`, `halt.N.consumed.json`, `state.<askId>.stopped.json`, `ask.<askId>.stopped.json`, `setup.jsonl`, `plan.json`, `needs-removed-<hash>.json`, `learnings.json`. *Update 2026-10-25: built as M8b (signed 2026-10-24; docs/wiki/the-module-ladder.md): `run.json`, `diary.jsonl`, `line-checks.json`; the file names in this paragraph are the old ones.*
1. Fold them into as few files as the rules allow: records stay write-once or append-only, keyed by id; an answer file is still consumed exactly once (rename-to-consume is the mutex); every reader still tells stale from fresh.
2. Old runs keep reading: a new reader reads both the old files and the new shape, or the old runs are moved once by a command, as hamr rules.
3. Rule from 2026-10-24 on: a new feature adds no new run-folder file; it puts its fact in a file that already exists.
4. hamr's goal (2026-10-24): one file per stage. Facts that are written about as often, and grow about as big, live together in one file, as several keyed sections; a stage's file collects and grows over the run. A first sketch, unsigned:
   - **Start** (written once, small): `inputs.json`, `run-model.json`, `thinking.json`, `signed-values.json`, `plan.json`, `trigger.json`, `setup.jsonl`.
   - **Steps** (every try, grows big): `audit.jsonl`, `checks.jsonl`, `calls.jsonl`, `tools.jsonl`, `spend.jsonl`, `cited-checks.json`, `sheet-checks.json`.
   - **Ask** (each ask, small): `ask.json`, `answer.<askId>.consumed.json`, `reopen.<askId>.N.json`, `ask.<askId>.stopped.json`, `needs-removed-<hash>.json`. An answer is consumed once by rename (the mutex), so answers may stay their own files inside this stage.
   - **End** (once, small): `log.json`, `halt.json`, `learnings.json`, `learn-error.jsonl`. The End stage stays open until everything at run end is done, so a run-end learnings failure lands here (today it cannot: `log.json` is already written once before the learnings run, so `learn-error.jsonl` is kept for that one case and the drafter-move failure, hamr 2026-10-24 "A").
   - **Live** (changes while running): `state.json`, `pids.jsonl`.

**Parked, not scheduled: an update option in the launcher menu** (hamr, 2026-10-26, unsigned; hamr picked A over a check on every start). Not drafted; it needs its own amendment signed by hamr before it is built. Today menu option `5 install` only creates the keys file and settings, and prints `Already installed, nothing to do.` even when npm has a newer fwdloop (seen live 2026-10-26: 0.25.1 installed, 0.26.0 on npm). *Update 2026-10-26: signed as M4b amendment 8 (docs/wiki/the-module-ladder.md).*
1. The menu gains `6 update`. Only when the human presses it does fwdloop ask the npm registry for the latest version; nothing goes online at start or in the background.
2. It says either that this is the newest version, or the new version number with the exact command `npm install -g fwdloop@latest` and that the panel then needs `3 restart`.
3. `5 install` keeps its job (folders, keys file, settings); its words say that it does not update fwdloop.

**Next, not scheduled: reopen the M10b aging exit after bareloop's learnings** (hamr, 2026-10-23, unsigned). The M10b exit is met for the expenses job; the aging job stays open (F78): the drafter drops or mis-tags the bucket check. The bareloop `loop` session will send its learnings on this; they are copied byte for byte, UI and inner working, under a signed amendment, before the aging exit walk is run again. The m10b branch is reviewed and released with this one issue open.
1. The learnings spec came from the bareloop `loop` session on 2026-10-23, as hamr signed it there. Source of truth: bareloop branch `feat/learnings`, commits `d185cfa` (the Audit box) and `1ba048d`, `107fce5`, `9ce156f` (ledger and memory rules). Code: bareloop `src/panel/index.html` `renderAuditLearnings` / `learnRow` / `learnHintLabel`, `src/panel/server.js` (getRunDetail `learnings`), `src/learn.js` `parseHintBlock` (reader) and `hintText` / `renderHints` (writer). A local copy of the message: `.claude/scratch/bareloop-learnings-spec-2026-10-23.md` (gitignored; bareloop's commits are the source).
2. What it is: a read-only Audit section showing the exact text the drafter was handed from earlier runs. One fold at the top of the Audit tab, the same box as the other Audit sections, closed by default, header `[✓] learnings  What the planner was told from earlier runs · N hints`, no arrow. Inside, each hint is a small table: its title line (n · level · seen N times · check · error kinds · fixed / never fixed), then "It said:", "Fix touched:", "What changed:". Hidden when a run has no learnings. Setting `learningHints` off by default. *Update 2026-10-25: the fold now wears the same ▶ / ▼ arrow as the other Audit folds (bareloop 417e80c, learnings part only).*
3. Its rules: the ledger keeps every row; a row last seen over 56 days ago, or from another signed job version, is not handed to the drafter; levels (this job, this place, all jobs) are worked out at read time; the block is capped at 2,000 characters; rubric lessons count only after a human Accept.
4. Open before it is built (hamr to rule): (a) this PRD says fwdloop does not learn across runs in v1, and if it ever does it comes in as its own signed module (Guiding principles, "Deliberately not borrowed"), so it needs a signed scope, exit and negative scenario first; (b) bareloop has a mid-run replan and fwdloop redrafts instead, so "At the first replan" needs a fwdloop meaning; (c) phone width is not yet checked on bareloop's side.

**Next, not scheduled: outside tools through MCP, with barebrowse as the fallback** (hamr, 2026-10-27, unsigned). Not drafted; it needs its own module with a signed scope, exit and negative scenario before it is built. Tickets (below) is its first real job. hamr's direction:
1. A job names an MCP server the person already set up as a source: `guardrail: source gh = mcp:<server name>` (the name in the person's own MCP config, e.g. `~/.mcp.json`). The human names it; the agent never discovers or adds a server, and a repo's own `.mcp.json` is never read (bareagent's default since v0.16.1).
2. Explored at draft: fwdloop lists the server's tools for the person to see.
3. Distilled, never open: the drafter proposes only the tools the job needs; the person signs that list (tighten-only). A run sees no other tool; an unsigned tool stays shut by mechanism, not prompt wording (bareagent's bridge allows new tools by default; fwdloop flips it to deny).
4. Keys: each server's key reaches it through that server's own `env` from the person's environment; fwdloop starts the server and never reads, writes or logs the key.
5. Read only first. A tool that changes or sends something is a send: a signed destination plus an accept, later.
6. Order of readers: an MCP server when the person has one; barebrowse for anything without one; fwdloop never calls a vendor API itself (that would grow a primitive).
7. Later, after the MCP path is clean: rwxmap labels each tool r / w / x and bareguard gates by the letter (r inside a run; w and x need a signed destination plus an accept). bareguard's own agent rwx scoping is the heavier alternative; distilled plus drafter-proposed is tried first because it is leaner.
8. POC first, the riskiest assumption: bareagent's MCP bridge (`createMCPBridge`, untested by us) starts a real GitHub MCP server, lists its tools and reads issues read-only, and a tool not on the signed list is refused (the test that must be able to fail). A gap is an upstream ask to bareagent, never a patch here.

**Next, not scheduled: tickets as an input and a trigger** (hamr, 2026-10-27, unsigned; chained workflows parked for this, beta first). Not drafted; it needs its own module with a signed scope, exit and negative scenario before it is built. hamr's direction, from the 2026-10-26/27 discussion:
1. A job names a ticket list as a source, like a page today: `guardrail: source issue = tickets:<list page URL>`. First target GitHub issues; later any ticket system (ServiceNow, Jira) through barebrowse. The human is already logged in in their own browser. A ticket list can also come from an MCP server (see "outside tools through MCP" above), e.g. `tickets:mcp github list_issues`; the trigger and one-ticket-per-run stay the same, only the reader changes.
2. The job stays signed and fixed; a ticket only brings this run's case. Its top part (title, description, link) is the run's frozen input. A ticket can never change steps, rules, cap, asks or destinations.
3. A `tickets:` source unlocks a trigger "When a new ticket arrives in <role>"; fwdloop remembers which tickets it has seen. By hand, Run asks which ticket (`#42` or its link).
4. A step may open the ticket's page and tickets it refers to ("see #41") on the same host as the signed list; anything else needs a signed address.
5. Writing back on a ticket (a comment) is a send: a signed destination plus an accept. After beta.
6. Email is the same shape later; until a mail peer exists, a request can arrive as a file in a folder (the new-file trigger today).
7. Waits on barebrowse (asked 2026-10-27, POC first): (a) link lines carry their absolute URL; (b) after a load, the final URL and HTTP status. fwdloop's own guard: a known list landmark must be present before "0 new" is trusted.

*Update 2026-10-27 (MCP and tickets).* M12 was signed, partly built, then withdrawn and reverted by hamr ("a, revert"): the code was built without a live POC. It restarts on a new branch after this release, with a fresh scope and a POC before every build. What the POCs proved:
- F85/F86/F88, the bare-agent bridge: allow mode, readOnlyHint marks, listServerTools; spawn errors fixed in bare-agent 0.54.1.
- F87, barebrowse: links carry their address, and a page reports its load status.
- F89 and its rerun: a ticket page needs `data` mode, or the body text is lost.
- F90/F90b/F90c: the drafter must be told the ticket role exists (one facts line); without it plans sign but never read the ticket, and once granted `get`. "priority P2 only" becomes hitl, not a typed check.

hamr's design asks to carry into the fresh scope:
- The ticket list address goes in the Inputs box (`issue: tickets <list url>`).
- New tickets queue and run one after another, oldest first.
- The job's own guardrails filter which tickets matter, no special words; a non-match ends skipped (grey), never red; a real failure stays red.
- The queue view could go in Result (needs a mockup first).
- `~/.mcp.json` is the only MCP config read.
- Ruled 2026-10-28 (after F93): a ticket's priority starts as its label; the goal is several guardrails that filter tickets from any ticket page or MCP source, label or a "Priority:" line in the text. A skipped ticket's read cost (about $0.003-$0.009, F93) is accepted.

*Update 2026-10-28 (MCP and tickets POCs).* Five more POCs ran on the restart branch; none changes the signed text (M12 is still withdrawn, nothing is signed). What they showed:
- F92: one ticket address runs end to end on the real path (data-mode read, frozen input, signed, ask, accept, send), 6/6 PASS, $0.02 total.
- F93: the model reads a ticket's priority label into a typed box (15/15 exact, none = null 5/5, label beats a body line 5/5). Its cost and round-count numbers failed my own registered bars (about $0.003-$0.009 a read).
- F94: new tickets on a real list page are found by code alone, oldest first, with no false hits and no model ($0). F94b: the flood case (more new tickets than page 1 holds) did not happen, so page-through is INCONCLUSIVE; the "too many new" path was never run.
- F95: plain-language guardrails read into boxes with an explicit `unsure`, and code decides RUN / SKIP / HITL with bareguard `in`: no wrong skip in 18 calls (Q2), label beats body (Q4), boxes always typed (Q5). Q1 and Q3 FAIL on one ticket (#180865, a fuzzy topic the model called crash-or-hang every time), $0.2192 for 42 calls.
- F96: the same tickets through the real GitHub MCP server, no model, $0: tools are all read-only, allow mode holds, labels/state/created_at are typed fields, code alone got 12 of 12 priorities, and the list pages by cursor (`after`). `since` filters on last update, so it cannot find new tickets. The flood was not run on MCP either.
- Ruled by hamr 2026-10-28 (after F97/F98): ticket filters are pure matching, no AI per ticket. Priority and ticket type are labels, found or not; body keywords are words found or not. The drafter may suggest the labels and keyword list at draft time; hamr signs them; code decides at run time.
- Ruled by hamr 2026-10-28 (option A, F98): a keyword miss is SKIPPED but listed, with the reason and a "Run it anyway" button; never a silent drop. F98 measured a 12-word list missing 1-3 of 12 real crash-labelled tickets.
- F98 also found: GitHub omits `labels` when a ticket has none (read as "no labels"); flutter has no hang label; bareguard `mustCarry` matches inside words ("hang" in "change") and needs all phrases, not any (upstream ask pending hamr's word).

Research done 2026-10-28 (web, some items unverified):
- Usual practice is poll + seen-id dedupe, existing items baselined at switch-on, and a non-match is no action and no cost (Zapier filter, n8n drop). Zapier polls page 1 only, so a flood can lose items; page-until-seen or a cursor fixes that.
- Structured fields come first (Jira recommends field conditions before JQL/regex; gitlab-triage conditions are structured). AI triage products mostly suggest and a human accepts (Linear, GitHub), so AI-into-enum-boxes with code checks is less common.
- Two patterns adopted for the design: an explicit `unsure` value in every box (unsure goes to a human, never skipped), and skipped tickets kept visible (a skip row).

hamr's rulings 2026-10-28:
1. A ticket's priority starts as its label, else a "Priority:" line in the text; the label wins (recorded above).
2. The goal is several plain-language guardrails that filter tickets from any ticket page or MCP source. No new bareguard shapes unless proven.
3. The cost of reading a skipped ticket is accepted.
4. Two readers: MCP typed fields when the source has them; barebrowse page plus AI boxes otherwise. Same guardrail, same check.
5. What cannot be boxed goes to hitl.

- Tried / proven / pending: see docs/logs/FINDINGS.md "Note — MCP + tickets (barebrowse and MCP) — tried, proven, pending (2026-10-28)".
- Ruled by hamr 2026-10-28: the fresh scope is named M12. The first slice delivers what MCP proved; skipped tickets show in the Results tab (placement detail still needs a mockup before build).
- Asked of bareguard 2026-10-28: carriesAny (ruling #69, any-of phrases on word edges, which phrase hit in full.matched); F99 pre-registered to validate it (see UPSTREAM-ASKS.md).

*Update 2026-10-29 (M12 design, hamr's rulings, unsigned).* M12 is still unsigned; these go into its draft scope.
- One run per ticket, like M9's files. Tickets queue in the job's `schedule-ledger.jsonl`: an `arrived` row, a `ran` row, oldest first. A run waiting at its ask does not block the next (M9 am8); waiting runs line up in the Inbox, answered one at a time.
- A ticket is known by its number. An edit does not run it again, unless a signed guardrail names a field to watch (e.g. "run again if the status changes"); then a changed value makes it arrive again. Unclear = hitl. fwdloop compares old and new itself; bareguard has no such rule and guard agreed (2026-10-29).
- The address is an ordinary Inputs line (`issues: <list url>`); the Run card's When dropdown gets `When a new ticket arrives in <input name>`. It looks every 15 minutes, fixed, at $0. This replaces the earlier `issue: tickets <list url>` form.
- Ruled by hamr 2026-10-29: a tool counts as used if a step or the signed schedule uses it. The job lists only the tools its steps use (e.g. `issue_read`); the ticket schedule carries the tool its look uses (`list_issues` on the named server) in `schedule.json`, signed with the schedule's two clicks. A job tool no step uses is refused by name. The run's server starts with only the job's tools; the look's with only the schedule's.
- Ruled by hamr 2026-10-29: a by-hand Run on a ticket job uses a ticket you pick by number.
- Ruled by hamr 2026-10-29 (A): the `Run it anyway` reason box copies the rerun box: placeholder "reason (needed to run it anyway)", its button says "Run it anyway", and an empty box says "Please write a reason to run it anyway."; nothing starts.
- A closed ticket is skipped at $0. The cap has no special rule: each ticket's run has the job's normal cap and asks the human when it runs out; the monthly limit stops a flood.
- Results: one cumulative ticket list in the Result tab of the run the schedule was set from: grouped Needs you / Stopped / Passed / Skipped, newest first in each group, with filter chips and search. Mockup: docs/product/m12-ticket-results-mock.html (variant E).
- `Run it anyway` on a skipped ticket asks for a short reason first, like a rerun; without a reason nothing starts. The ticket then queues as a new arrival with the job's normal cap.
- Later slices, same shape, different reader (each needs its own signed slice; not scheduled): page tickets through barebrowse (F92, F94 proven; labels on a page and the flood still open), and chats through beeperbox (a chat message is one item with an id: seen list, queue, guardrail filter, one run per item, the same Result list).

**Next, not scheduled: the Audit tab's check grid (bareloop variant F)** (hamr, 2026-10-29, unsigned; signed in bareloop by hamr 2026-10-29 as a mockup, not built there yet). Not drafted; it needs its own amendment signed by hamr before it is built here, copied from bareloop's released tag once bareloop builds it. A copy of bareloop's mockup is kept in `.claude/stash/2026-10-29-bareloop-audit-variant-F/` (gitignored). What it is, per bareloop:
1. Each part keeps its header and tools line. Under it, a check grid: rows are the part's checks in run order with their plain question; columns are try 1..N (with thinking on/off); cells ✓ ✗ · (not run) ? (no verdict). The grid scrolls inside its own box; no page side-scroll at 390px.
2. Under the grid, an errors list: one row per try that failed or has no verdict: try N, the first failing check ("+J more checks"), the first error line, "(+M more)". A part with no failure shows no list.
3. Opening a row (or its ✗ cell) shows the first 8 error lines, then "+M more lines"; several failing checks get a sub-heading each.
4. A "?" row (provider dropped) is faint and not clickable: "provider dropped (socket hang up), no check ran".
5. On load, only the last failed try's row is open per part; per-try rounds tables stay, folded under the list.
It replaces the stacked try blocks per step. fwdloop has no command-exit check, so bareloop's wording fix for that check does not apply here.

**Next after M10, not scheduled: chained workflows** (hamr, 2026-10-20, unsigned). Not drafted; it needs its own module with a signed scope, exit and negative scenario before it is built. Details are settled later. hamr's goal: automate a job as small pieces, like Lego. Each piece is its own workflow with its own asks; when one ends well it starts the next, so small proven pieces join into the whole job. hamr's answers so far (2026-10-20, unsigned):
1. Two ways to link: a trigger joins two workflows; a chain tab joins several, picking one workflow's output as the next one's input.
2. Every workflow put in a chain must have passed at least once (green or accepted), or the run-N the chain uses must be green.
3. A link fires only when the run before it is green or accepted. A red or stopped run ends the chain there. A run waiting on an ask does not fire the link: that is hitl, and the chain waits for the human.
4. What passes on is the accepted output, by identity and hash, pinned as the next run's input like any input today.
5. Links are signed by a human, like triggers and caps; the drafter never makes a link.
6. One cap for the whole chain. The chain tab adds up each piece's "about $X a run" from its own track record (the Signed flow row's figure; rule 2 means every piece has at least one passed run) and proposes the cap; the human can raise it, never set it below the proposal. A piece whose figure is unknown is refused, never counted as $0.
7. Not the multi-agent orchestration ruled out above: one workflow runs at a time, each under its own signed job.

**Signed as M10 scope: rubric checks and asks for jobs that check a page or a sheet** (hamr, 2026-10-18; M10 scope input, after v0.21.0). Signed by hamr 2026-10-18 as the M10 scope (docs/wiki/the-module-ladder.md, M10); starts after v0.21.0. hamr's goal: an automation job that checks something online (the shape of bareloop's flights job) with actions and asks, and the same for a local sheet when a citation isn't found: "hitl is rubric with hitl", borrow what fits. From bareloop (F226-F228, F234-F238 in `../bareloop/docs/wiki/FINDINGS.md`; build spec `../bareloop/docs/product/ITEM33-BUILD.md` "Idea A core"):
1. Page words must read a value of the right kind, not just be on the page (run mvdg1xo3 signed `StaticText` and `O` and could never pass).
2. An AI proposes the page's own words per fact; code keeps only words really on the page and applies small frozen rules; every dropped check is shown as "Not checked" with a plain reason, never dropped silently.
3. A guardrail with no word on the page (e.g. "not a red-eye") is reshaped into one the page holds (a departure window) and the person is asked before paid drafting whether that is what they mean.
4. Every question, answer and the fact it confirmed is recorded (draft log, Audit, signed job "you confirmed"); bareloop found it kept them nowhere.
bareloop's detailed borrow spec: `../bareloop/docs/product/fwd-borrow-from-bareloop-rubric-2026-10-18.md`; fwdloop's own POC 0/40 (the model never used an offered questions field) means code, not the model, decides when to ask.

**Tested, then built: thinking per step** (hamr, 2026-10-17). Idea borrowed from bareloop F230-F233: thinking off on a step's first try, on for retries and Redo, with thinking on everywhere kept as an escape hatch for hard jobs. Pre-registered and run as F69 in `docs/logs/FINDINGS.md`: NO BUILD (am29-walk-2: retries-only passed 1 of 4 vs thinking-on-everywhere 2 of 4). Follow-up F70 (today vs retries only on `m7-walk-2`, n=8): BUILD (8/8 both; retries only about 15% cheaper and 9% faster). F69 and F70 disagree on the job whose first tries fail often. hamr then signed it, and it was built as M4d am25-am28 on branch `m9-am21` (2026-10-17/18): am25 thinking per step with the Chat box as the hatch, am26 thinking words in Audit and the Job tab, am27 the `(no reply)` word, am28 Model and Thinking on one row.

**No CLI as a product surface.** `npm install`, one command, a localhost server starts and **the
browser is the product**; the server owns the scheduler. A CLI exists for M0–M4 and M6a (`fwdloop draft`, `fwdloop sign` — sign needs an interactive terminal and a typed flow name, M6a amendment 2) but is
undocumented and carries no stability promise (docs/archive/PRD.md:427-431).

## Guiding principles — borrowed from bareloop, reminders not features

Signed by hamr 2026-09-15. Lifted from bareloop `docs/logs/CYBERNETICS.md@4bd52fe` (Ashby, Beer,
Wiener, and gate-level digital design), kept only where fwdloop has already been bitten or
already leans on it. None of these is a module or a feature. Each is a question to ask of any
new piece before it is built. The date is the day it cost us.

1. **Only a clean yes/no crosses a step boundary.** A model's artifact is analog — plausible,
   degraded in ways nobody can see. The close collapses it to one bit before the next step
   reads it. No score, confidence, or "mostly passing" ever travels between steps or feeds a
   decision. (2026-09-10 F7: a model minted greens by omitting fields; the fix was a harder bit,
   not a softer one.)
2. **Right and cheap are two numbers, never one.** Green gates; cost ranks. No function in the
   tree may combine verdict and cost into one scalar. A "fitness score" is the smell; reject it
   on sight. (2026-09-15 F28 reports pass/20 and $/run in separate columns for this reason.)
3. **Every check names its third outcomes.** Besides green and red there is always a forbidden
   zone — a crash, an unparseable reply, an unpriced round, a killed close. Each gets its own
   name and its own path; rounding one to green or red is itself the fault. (2026-09-14 F27
   `cost unknown`; 2026-09-15 F28 `malformed tool call` — both were third outcomes, and the
   one we rounded to "provider-red" cost a day of restarts.)
4. **The human's alarm goes by a wire nothing summarises.** An ask reaches the human word for
   word, on a path no log, fold, or emergent component rewrites or filters. What the shell
   emitted is what the human reads. (2026-09-13 F25: `ASK OPEN` printed once and was lost in
   scroll; both asks expired; the fix was a blocking prompt, not a better log line.)
5. **Test the checker before trusting what it says.** Every close ships with a fixture that
   must fail and a fixture that must pass, run token-free before any batch is believed. "The
   test must be able to fail" is this rule; "revert the fix alone, see red, restore" is its
   manual form. (2026-09-15: a deadline test accepted `0`, which means *off* — caught only by
   reverting by hand.)
6. **The doer never writes its own judge.** The agent authors steps; a human signs the
   trigger, the cap, the ask, the allow-list, and what "done" means. A confident fake green is
   an accountability sink; this is the wall against it. (Standing since 2026-09-08; the hard
   lines in CLAUDE.md are this rule spelled out.)
7. **Every summary says what it threw away.** A fold, a ledger row, a red string, an ask text:
   per field, what is destroyed, what survives, and why nothing downstream needs the dropped
   part. A summariser without that manifest is a review blocker. (2026-09-15 F28: a red run
   kept only its red string; five misses could not be told from a close bug until `log.json`
   kept the reply.)
8. **Green steps do not add up to a green job.** Each step is its own small viable system with
   its own close; the job still needs its own last check — for fwdloop, the human accept in the
   same run — or the steps are individually green and jointly wrong. (Plant d exists to prove
   this; 2026-09-15: 240 clean runs, nothing incomplete reached a send.)
9. **A repeat at the same byte is a shape, not weather.** When a provider red recurs with the
   same position, size, or timing, capture the body before blaming the wire. (2026-09-15 F28:
   three "provider" reds at position 476/476/432 were our own parser dropping the model's usage.)

Deliberately not borrowed (no home in fwdloop v1): the across-run learning items — contrast
bits per knob, one-knob mutation, toggle coverage, order-from-noise pre-flight. fwdloop does
not yet learn across runs; if it ever does, those come in as their own signed module.

*Built after signing — not signed text: M8 (learnings, signed by hamr 2026-10-23) is that signed module; scope in docs/wiki/the-module-ladder.md under M8.*

## Stack — vanilla JS

**Vanilla JavaScript, ESM, node stdlib.** No TypeScript, no framework, no build step; types go in
JSDoc (docs/archive/PRD.md:434-436). AGENT_RULES' dependency hierarchy binds as written: vanilla →
stdlib → external, and external only when stdlib cannot do it in under 100 lines, with the
standing exception for security-critical code. The bare suite is a **dependency, not an
external** — it is the thing under validation (docs/archive/PRD.md:438-441). The one real test is
M5's UI: vanilla holds there too, and a framework needs a reason, not a preference
(docs/archive/PRD.md:443-447).

## Baseline model — settled, not reopened

**`deepseek-flash` (DeepSeek direct, DeepSeek-V4.1-Flash) is the baseline for every experiment**;
`hf:Qwen/Qwen3.8-27B` on synthetic.new is the second provider — a different company behind a
different gateway, so losing one does not lose both (docs/archive/PRD.md:450-455).

It was flipped on measured reasons (F12): fwdloop's workload is **warm**, every step re-sending
the same standing instructions, and F9 measured 99.8% of a 4,361-token prefix coming back cached
at roughly a tenth the price, where synthetic exposes no caching at all. Second reason: no ~250s
request cliff (docs/archive/PRD.md:457-466). Stated against the flip, honestly: DeepSeek had the
slightly worse step-count spread and slower median wall, neither a correctness signal
(docs/archive/PRD.md:468-472).

**Claude and OpenAI are a differential probe only** — one round, to split "our mechanical code or
the model" when stuck. Never a baseline, never a default, always named in the finding
(docs/archive/PRD.md:474-476). **No model hopping:** a change of baseline needs a measured reason
filed in FINDINGS, and `poc/m0/provider.mjs` is the one writer for provider, rates and key, so
swapping is a slot, not a rewrite (docs/archive/PRD.md:478-480).
