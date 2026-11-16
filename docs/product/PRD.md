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

*Update 2026-11-11: dropped by hamr. No job has needed a routing gate, and a classifier deciding is close to the "No LLM judge" rule.*

**Parked, not scheduled: two panel asks** (hamr, 2026-10-16, raised during the m11-am5 live walk; after the m11-am5 release). Not signed, not drafted; each needs its own amendment signed by hamr before it is built.
1. The Run tab summary shows how long the run took: `passed · $0.0047` becomes `passed · $0.0047 1m56s`.
2. The runs list Scheduled section gets its own filter/search, like the other sections.

*Update 2026-11-11: both built, nothing left.* 1: the Run tab top line shows the run time after the cost, from the history row's `wallMs` (M9 am21/am22; src/panel/index.html:3080). 2: the one search box narrows the Scheduled cards by job name and the ◷ chip shows only Scheduled (M11 am17, am19, am20; src/panel/index.html:2255, 2431).

**Parked, not scheduled: two hitl ideas** (raised by hamr 2026-10-19, unsigned). Not drafted; each needs its own amendment signed by hamr before it is built.
1. A guardrail code cannot check becomes a human review item instead of only a "Not checked" line. It complements the rubric and removes nothing that works.
2. A code-forced mid-run stop: when a step's check could not be judged by code and a later step reads that step's output, the run pauses for a human before the dependent step runs, even if the job signed no ask there. Open points: (a) it would need a signed amendment, because ask positions are human-signed today and this is a code-decided stop like M10's code-forced asks; (b) how it relates to today's rule that unjudged hitl output rides as evidence to the next signed ask; (c) scheduled runs would wait on a human; (d) measure how often it would fire on existing runs before designing. hamr's note, 2026-10-19, unsigned: it could be offered as an extra hitl with max limits (a cap on how many such stops a run may take). Otherwise it needs a rethink, or the job is split into two workflows, with a later design letting one workflow trigger another. Any version must be designed, tested and validated before it is built.

*Update 2026-11-11: both dropped by hamr. Idea 1: bareloop's one check list gives every rule a row that ends built or not-checked with a reason at Accept. Idea 2: splitting the job into chained workflows is the way instead.*

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

**Parked, not scheduled: M14 item 11 gap** (hamr, 2026-11-02, unsigned). A drafter question that is not a page-look question has no human row in the Audit; the answer shows only inside the redraft's `card` row (F130 survey, M14 build p4). Fixing it needs new screen words.

*Update 2026-11-11: hamr: fix it. The question and its answer go into the Audit. Seen in 1 of 46 saved draft questions (`~/.config/fwdloop/flows/.drafts/d-00mv5hai9f-6c7b/draft`, abandoned draft). Today `humanRows` (src/setup.js:69) keeps only `source === 'look'` answers; the Audit row words `you were asked:` / `you said:` (src/panel/data.js:1944) already exist. Needs a signed M14 amendment.*

**Parked, not scheduled: raise the bareguard pin** (hamr, 2026-11-10, unsigned). fwdloop pins bareguard `^0.31.0` (package.json). hamr ruled bareguard's tighten #80: `cells` rows and keys give `claim-malformed` (e679db4 on its branch, validated 33/33 identical on our saved runs), and `topN` rows and values give a red (0 of 3,859 files use it). Raise the pin when it ships, and re-run the 33 pairs on the installed package.

*Update 2026-11-10: done, pinned ^0.34.1 in bd453c3; 33/33 saved pairs identical on 0.34.1 from npm.*

**Parked, not scheduled: use bareguard 0.35.0's at-most / at-least list counts** (hamr, 2026-11-11, unsigned). Today countCheck (src/checkpick.js:191, borrowed from bareloop 0408a8f) turns "at most / no more than / up to / at least N bullets" into an EXACT `listItems N`, so a correct shorter list reds (fix ledger). bareguard 0.35.0 (ruling #81, approved by hamr in the guard session) adds `maxListItems` (value 0 or more; no list is green) and `minListItems` (value 1 or more); `listItems` and every rubricSha are unchanged. F175 ($0): 33/33 saved checks identical on 0.35.0 from npm, 20/20 planted outputs right; no saved fwdloop job has an at-most or at-least bullet rule (648 job texts, every count rule exact), so the gap has never been hit. fwdloop stays pinned `^0.34.1` (excludes 0.35.x). Raising the pin and mapping the rules needs an amendment signed by hamr; copy bareloop's countCheck from its tag if it adopts them first. Also noted, not seen live: countCheck maps "more than N words" to `minWords N` (off by one; "more than" is strict).

**Parked, not scheduled: two ledger gaps bareloop's check list does not cover** (hamr, 2026-11-11, unsigned). F171 disagreement 4 (two `~` rules with one meaning each get a checker) and disagreement 9 (a page "drop it" is not carried on a Revise, so the same question could be asked again). The `loop` session said on 2026-11-11 that neither is solved by its one-check-list build (Phase A or B). F174 ($0, docs/logs/FINDINGS.md) found no live failure for either: disagreement 9 has no case (no Revise followed a "drop it" in any saved draft), and disagreement 4's only pair (`listItems 3` plus a cited count of 3 on the flights job) measures two different things; in the 5 split runs the second check caught a real bad output. Built only if one is seen failing live; then the fix is also sent to bareloop.

**Parked, not scheduled: a Not checked note shows a raw key** (hamr, 2026-11-14, unsigned; found in the M16 P7 practice walk). On m14-walk-5 (scratch copy pw-m14), Add on a Suggested line 3 fact also built `$numbers` default checks on lines 5 and 7; Drop on that fact turned both into Not checked, so the card's Not checked count went from 4 to 6 (draft-1 vs draft-3 `not-checked.json`, .claude/scratch/m16/practice-walk). *Correction 2026-11-14: this paragraph first said fwdloop waits on a bareloop fix. That was wrong.* The `loop` session ran bareloop's real CheckBlock at $0: after the Drop both rows go back to not-checked with no check behind them, which is bareloop's design (buildLine, src/checkblock.js:360-366, clears every row's part on each rebuild; pinned by bareloop tests/checkblock-add-drop-numbers.test.js, commit 23c0cdb1 on fix/after-0.56, unreleased). fwdloop's copy has the same reset (src/checkblock.js:393), so the leftover Not checked rows are copied behaviour, not a bug. fwdloop's own bug: a Not checked note with no rule text shows the raw key (`line 5: numbers L5.$numbers - not checked`, src/blockassemble.js:126) instead of words. *Status 2026-11-14 (docs sweep): fixed in 48c9918 (a Not checked note for a row without rule text uses the card's own words, never the row key; test/m16-note-words.test.js).*

**Waiting on bareloop: two check-block fixes from the M16 walk** (hamr, 2026-11-14: option 1, "go" given in the `loop` session). On hamr's real panel, walk-m16-flights run-1 went red 3 tries and stopped (about $0.11). (A) The ledger-suggest call added `phrase "Rome" [agent]`; code proved it on the whole page (the search box and "Track prices" toggles say Rome), never on the result rows, though the look had already left "Rome" Not checked as in no result. After a Drop it was offered again under Suggested. The test that refuses it exists (src/pagedry.js dryReadPhrases, bareloop c550dc8, F75) but runs only on look facts. (B) The page came back in euros; code found "the amount is in another currency than the page fact" for `under $150` and then fell back to the AI's reading `lt 150`, so the run checked euro prices. Both are in src/checkblock.js, copied from bareloop v0.56.0, and bareloop has the same code. bareloop fixes both and releases a tag; fwdloop copies the fix from that tag, then re-walks the flights job. Root cause and proof scripts: .claude/scratch/m16/rome/FINDINGS.md. The euro page was caused by the walk sheet: its link ended `curr=USD.` with a trailing period (the practice run without it got US dollars). Status 2026-11-14: bareloop fixed both on fix/after-0.56 (B fd943e49, A 637e76ad, Drop-then-Add test fa942d5d), not released; fwdloop copies the three from the release tag. (C) Also waiting, from the `loop` session's live finding (bareloop run mwgjlezb, old behaviour already in v0.56.0, so in fwdloop's copy too): a rubric line whose `~` rule maps to a fact becomes facts-only (checkblock buildLine factLines, buildDefaults `$cited`, rubricstep lineBriefs), so a line asking for a written note plus a quoted title gave results only and no note; and the confirm line "carry text" is display-only and false on fact lines. hamr picked bareloop's fix there: one typed yes/no AI question per fact line ("also asks for written words?"); on yes code keeps both text and facts. POC first in bareloop; fwdloop copies it from the tag. Ruling 2026-11-14 (hamr): no small bareloop tag; M16 ships without A and B, and fwdloop copies fd943e49, 637e76ad and fa942d5d from bareloop's next regular release as the next item after M16, together with the one check flow. *Status 2026-11-15: A and B (with their tests, the money-line fix and the label colon fix) are copied from bareloop's tag v0.57.0 (c18df406) on branch m17-one-list-sheets (M17 am1 P2); the re-walk and (C) are not done.*

**Parked, not scheduled: two old check paths M17 leaves open** (hamr, 2026-11-14, unsigned). M17 am4 (docs/wiki/the-module-ladder.md) removes 8 of the survey's old paths; these two stay until each has a replacement. (A4) The drafter's third-try questions (src/drafter.js ~:197/857; signed M4e am24/am25, M10 am32 A). An answer to such a question still adds a new `~` rule, even when the question was about an existing rule. bareloop (the `loop` session) is building the fix: the question names the rule it is about ("rule 2 on line 3" or "new"), code checks the tag, and the answer replaces that rule or adds a new one. The box shows "This replaces: ..." or "This adds a new rule to line N" before you answer. fwdloop copies it from bareloop's released tag. Not seen failing live; parked by hamr 2026-11-14 ("leave that gap for now"). (B2) "under N words" (src/checkpick.js ~:123/72; signed M10 am16 (1)-(2)). "under 80 words" becomes `maxWords 80`, so an 80-word answer passes. bareloop has the same. It needs hamr's ruling on what "under" means before any change; out of scope in M17 and M17 am4.

**Parked, not scheduled: the Tickets filter rule is found by a word reader** (hamr, 2026-11-15, unsigned). M17 am6 P3 ties the AI's filter/watch suggestion to a `~` rule with a fixed code table over the person's own words (src/ticketrows.js `ticketRuleField`: P0-P3 or label = filter; state/labels then change = watch). Missed wordings ("high priority", "urgent", "status changes", "tagged bug", "P1s") show as Not checked and the job gets no filter. bareloop has no tie today; its planned tag (the drafter names `rule: N` or `new`, code checks it exists; feat/one-list-rubric 421e06ef, unreleased) replaces the word reader when released. Not seen failing live.

**Parked, not scheduled: tell a content-writing last line from the final write-out** (hamr, 2026-11-16, unsigned). F204 (docs/logs/FINDINGS.md): on a job whose last line writes new content ("Write a short closing note to my neighbour"), the AI took it for the final write in 2 of 5 drafts; code accepts it because it is the last line, so the note would not be written. M13 am10 (signed 2026-11-16) ships with this as a known limit: the pick shows on the card as the AI's `[agent]` row with Drop, and Revise changes it. Later: one more paid round making "a step that writes new content" vs "write everything that came before it" clearer to the AI, pre-registered with held-out cases.

**Next, not scheduled: one check flow** (hamr, 2026-11-14, unsigned DRAFT; module number: hamr picks; after M16 ships). DRAFT for hamr to edit. Not signed, not built. It needs its scope, exit and negative scenario signed by hamr before it starts.

**hamr's words.**
- "in the end we should have one place that reads ~ suggest ~ and add default $ that checks all and returns honest feedback on what is checkable, no side questions, no extra checks for guardrails"
- Clarification: "read ~ suggest ! and default $ check all against code if checkable and suggest add/drop where it fits, asks extra clarification questions as needed"
- "my goal again is one flow, one place to generate/check/accept/keep ~ ! $ and human approvs plan and code is honest on what it can/cannot check, extra asks to clarify a rule still comes in before card appears with add/drop"
- "just to be clear on next move/prd, we are cleaning up any old judge that got replaced by new redesign for rules, ok?" (hamr, 2026-11-14)
- "yeah, asking same rule that is obvious without suggestions doesn't do anything, if i type my new words it should replace the ask. it's simple, one list one rule (~ ! $) one in one out, one updated replacing the one it's updating. why this is so hard?" (hamr, 2026-11-14)

**Scope in one line.** Every old path that judges, asks about or reports on a rule, and that the check block now does, is removed; what the block cannot do yet feeds the block instead of judging on its own.
**The rule in one line.** One list; one guardrail is one row (`~`, `!` or `$`); an answer updates that row in place (Agree picks its check, your own words replace it); nothing is ever added beside it; a rule whose check is obvious is not asked.

**Who builds it (hamr, 2026-11-14).** bareloop (the `loop` session) builds the one-in-one-out rule first; fwdloop copies it from bareloop's released tag, as with the rest of the check list. This is fwdloop's next item after M16 ships.

**Why.**
- M16 copied bareloop's check block. Its item 4 ("stay as they are") and item 5 ("Every other signed text stands") kept the older per-case paths: pages (M10), sheets (M10b), Tickets (M12/M13), the AI's own notes (M4e am24/am25). The block sits beside them, and their output merges into one card.
- The 2026-11-14 survey (`.claude/scratch/m16/survey/SURVEY.md`, a $0 read of repo `m16-check-list` @ 3f7e77c) found 23 paths outside the block: 4 ask (A1-A4), 8 add a check (B1-B8), 9 write a Not checked claim (C1-C9), 3 hide a rule (D1-D3).
- Examples, each with its evidence:
  1. Agree makes two rules for one meaning. m14 `prose-1.txt`: `guardrail: exactly 3 bullets; exactly 3 list items`. `draft-1/declaration.json` has `L3.~1 you built` and `L3.~2 you built`, both on part 0. Nothing says which covers which (B1).
  2. The AI says the opposite of a check. Flights `draft/not-checked.json`: `price under $150 is not machine-checked [agent]`, while the same card shows `› check · "under $150" [you]` (C1).
  3. One thing is said three times. Flights Not checked says "destination city" three times: a `[default]` page-look note, an `[agent]` row with a raw key, and the AI's own `destination city Rome is not verified`. "airport code" the same (C2).
  4. Two Not checked claims that disagree. The CSV card (`practice-walk-2/c-card-d3.txt`) shows `Not checked: none` under line 2 and `Not checked · 2` at its end (C7).
  5. A rule shown nowhere. A Tickets content rule such as "mention the reporter's name" is removed from the block by `ticketLeaveOut` (src/blockdraft.js:88). It gets no ask, no row, no note. Proved at $0 with one `node -e` call. No saved job has such a rule (D1).
  6. "under 80 words" becomes `maxWords 80`. `draft-3/declaration.json` line 5 has `picked [{"rule":"maxWords","value":80}]`, so an 80-word answer passes. The prompt (src/checkpick.js:123) says "under N words ... use maxWords N" (B2).
- The survey's summary table (copied; `kind`: a asks, b adds a check, c writes a Not checked claim, d hides a rule; file:line is src/ unless a path is given):

| path | kind | screen? | signed text keeping it | bareloop v0.56.0 same? | example |
|---|---|---|---|---|---|
| A1 page-look asks, non-block lines (pageask.js:116, drafter.js:763) | a | Chat | M10 item 4, am1, am2 | no (block asks only) | none after M16; block's "on the page" words hit Tickets before aaa637d |
| A2 sheet column offers (drafter.js:630) | a | Chat | M10 item 7, am8 | n/a (no sheets) | m10b-aging-2 "no column 'days past due'; 'Amount' has numbers…" |
| A3 shape-pick asks, non-block lines (drafter.js:745) | a | Chat | M10 am16 (3) | no | none found |
| A4 drafter try-3 questions (drafter.js:197/857) | a | Chat | M4e am24/am25, am32 A | no for rubric (wiped, authorflow:2359) | d-00mv5hai9f-6c7b "Which order should the card use?" |
| B1 Agree appends a 2nd `~` rule + `[you]` row (pageask.js:175, authorcard.js:158) | b | card, readout, Job, signed prose | M10 am2 item 3, am16 (3) | yes (follower row, F318) | "exactly 3 bullets; exactly 3 list items" |
| B2 under N → maxWords N (checkpick.js:123/72) | b | Chat, card | M10 am16 (1)-(2) | yes | "under 80 words" → maxWords 80 |
| B3 R2c phrases replace the block word (blockassemble.js:54) | b | card ≠ readout/plan | M10 am7 item 2, M16 am3 (1) | no | card "Madrid" vs plan "Adolfo Suárez Madrid" |
| B4 AI-written sheet checks as rows (sheetrows.js:102) | b | card, Job, Audit, Result | M16 item 4, am4, M10b am2 | n/a | pw-csv: rows + count both cover "Price over 500" |
| B5 old pick path, non-block lines (drafter.js:788/963) | b | card | M10 am16 (4) | no | none found |
| B6 ticketFilter/Watch typed by AI (ticket-draft.js:33) | b | readout | M16 item 4, M12/M13 | no (code from card pick) | "ticket filter: priority P1" |
| B7 ledger `!` on a write line (in-block) | b | card Suggested | M16 item 1 | call yes; NO_GUARDRAIL no | "line 4 · fact · Select flight" |
| B8 repairDeclaration (drafter.js:983, repairs.js) | b | round log only | M10 am27 (2) | unchecked | adds a cited source to `reads`, no check on screen |
| C1 AI notChecked (drafter.js:1026) | c | card, Job, Result, Audit | M4e am24 item 6, am25, am40; unsigned L:3710 | no for rubric (wiped) | "price under $150 is not machine-checked [agent]" beside a `[you]` check |
| C2 look drops [default] + block rows (pagelook.js:78, drafter.js:576) | c | card, Job, Result, Audit | M10 items 3, 5; M16 item 4 | yes (authorflow:2361+2366) | "destination city" ×3 |
| C3 read note as Not checked in Audit (auditchecks.js:44) | c | Audit (code read, not seen) | M10 item 3, am40 | no (bareloop splits) | "US dollars was listed twice" |
| C4 left/no-pick notes (drafter.js:596/793) | c | card, Job, Audit | M10 am2 item 3, am16 (5), am30 | rows only | "priority P1 only — You chose to leave it Not checked" vs ticket filter P1 |
| C5 sheet-look drops (drafter.js:634) | c | card, Job, Audit, Result | M10 am8 item 1 | n/a | line 1 "expenses" — no column 'expenses' (no rule there) |
| C6 uncoveredRules (sheetblock.js:122) | c | card, Job, Audit, Result | M10b am2 | n/a | "agree, why not" — no sheet check covers it |
| C7 sheet block "Not checked: none" (sheetblock.js:112) | c | card, Result | M10b am2 | n/a | "Not checked: none" + "Not checked · 2" on one card |
| C8 unjudgeable (blockassemble.js:106, checkpick.js:290) | c | none | declaration schema; M10 am16 (4) | n/a | in declaration.json only |
| C9 cited fault as notChecked on Result (cited-record.js:105) | c | Result | M10 am9 (unchecked) | unchecked | none found |
| D1 ticketLeaveOut (blockdraft.js:88) | d | nowhere | M16 item 4 (names only filter/watch) vs M10 item 5 "Never silent" | no | node: "mention the reporter's name" left out |
| D2 column-choice rule (sheetoffer.js:93, sheetblock.js:112) | d | listed as guardrail, never as checked/not | M10 am8 items 1-2 | n/a | "use the column 'Amount' for 'Price'" + "Not checked: none" |
| D3 `~` on an ask line (blocklines.js) | d | unchecked | unchecked | unchecked | none |

- Seen live 2026-11-14 (walk-m16-m14, a red run re-drafted through run-again): the re-draft asked again about rules already agreed, and each Agree added one more copy, so line 3 became `~ exactly 3 bullets; exactly 3 list items; exactly 3 list items` with three [you] rows. The answers changed the job text, so signing was refused ("the job in this plan is not the job of walk-m16-m14 ... a changed job is a new workflow"): a red run whose re-draft asks a question can never be signed as a run of its job. Root: Agree writes a second `~` rule into the job (survey B1). *Status 2026-11-14 (docs sweep): 86e6484 and d22f570 (bareloop F318 0291e910) stop the copy when the answer has the same words as a rule already on the line (also one `; ` part of a `~` line; test/m16-agree-same-words.test.js); an Agree of different words still adds a second rule (signed M10 am2 item 3), so the rest of this entry stands.*

**The flow (the goal).**
1. One place reads the `~` rules. The AI suggests `!` checks. Code adds the `$` defaults.
2. Code proves each one is checkable, or not.
3. A rule code cannot settle is asked by the block, before the card shows. Agree, Drop it, or your own words.
4. The card shows one list with Add and Drop. Not checked comes only from the block. It names each rule once with its reason. Nothing is silent.
5. The human approves. The plan holds only the list.

**What each old path becomes.** Draft; "open" goes under Open questions.
- A1 page-look asks: feeds the block. The page look brings facts only; the block asks.
- A2 sheet column offers: open (does the offer stay as the block's clarifying ask?).
- A3 shape-pick asks on non-block lines: feeds the block. The block asks.
- A4 drafter try-3 questions: open (the block's own asks may cover it; hamr: "extra asks to clarify a rule still comes in before card appears").
- B1 Agree: deleted as a second rule. Agree replaces the rule's words; it never adds a second one.
- B2 under N: open.
- B3 R2c phrases replacing the block's word: open (card and plan must say the same words).
- B4 AI-written sheet checks: open (M16's own signed exception; M16 am4 (2)(3) at L:3717).
- B5 old pick path: deleted (the block is the one place).
- B6 ticketFilter/ticketWatch typed by the AI: becomes block rows, checked by code at run start.
- B7 ledger `!` on a write line: stays in the block. Its NO_GUARDRAIL words: open.
- B8 repairDeclaration: open (adds no check; whether it stays).
- C1 AI's own notChecked: deleted. Not checked comes from the block only.
- C2 look drops as `[default]` notes: feeds the block. One note per rule.
- C3 read note shown as Not checked in the Audit: becomes one split, as the card and Job tab already do.
- C4 left/no-pick notes: becomes block rows.
- C5 sheet-look drops: feeds the block. Words that are no rule are not a Not checked claim.
- C6 uncoveredRules: becomes block rows.
- C7 sheet block "Not checked: none": deleted. The one Not checked is the block's.
- C8 unjudgeable: open (it agrees with the block today, and no screen reads it).
- C9 cited fault on Result: open.
- D1 ticketLeaveOut: becomes block rows. A Tickets content rule is listed, never hidden.
- D2 column-choice rule: becomes a block row (the column lock stays; the card says so).
- D3 `~` on an ask line: open (not traced).

**Signed texts it would replace.** Line numbers are in `docs/wiki/the-module-ladder.md` (checked by grep, 2026-11-14).
- M10 scope (L:2762), items 3, 4, 5, 7: asks, "Never silent", the sheet offers. Changes: the asks come from the block only; Not checked has one writer.
- M10 am1 (L:2794) and am2 (L:2803, item 3 at L:2810-2817): how an ask shows up and Agree adding a new `~` line. Changes: Agree replaces, never adds.
- M10 am7 (L:2858, item 2 / R2c): where the facts are signed. Changes: card and plan words match.
- M10 am8 (L:2869-2875): column asks, the locked column. Changes: the offer is the block's ask (open); the column-choice rule becomes a row.
- M10 am16 (L:3419-3421), items (1)-(5): shape picks. Changes: one path, the block; the old pick and ask paths go.
- M10 am30 (L:3617) and am32 A (L:3628): Drop it and left-rule notes. Changes: the notes are block rows.
- M10b am2 (L:2911): each guardrail shows what checked it; "Not checked: ... or none". Changes: one Not checked, from the block.
- M4e am24 (L:2048, item 6 at L:2055), am25 (L:2062), am40 (L:2176): the AI's own Not checked, drafter questions, and the Not checked look. Changes: the AI's notes go; the questions come from the block.
- M12 scope (L:3063) and M13 scope (L:3136), Tickets items (the ticketFilter/ticketWatch build notes sit at L:3116, "not signed text"). Changes: filter and watch become block rows.
- M16 item 4 (L:3645) and item 5 (L:3646): "stay as they are" and "Every other signed text stands". Changes: this module replaces both. The unsigned note at L:3710 ("M4e am24/am25 stand; R4 overridden") goes with them.

**Done when (draft).**
- A flights page job, m14-walk-5, a CSV job and a Tickets job each draft and run green on deepseek-flash.
- Every question comes from the block, before the card shows.
- Each card's Not checked lists every unchecked `~` rule by name, once, and never contradicts a check row.
- One guardrail gives one check. Agree replaces; it never adds.
- No rule is silent.
- A $0 rescan of the good signed jobs refuses none.

**Must fail when (draft).**
- A question comes from outside the block.
- A Not checked line contradicts a check row, or repeats a rule.
- A `~` rule shows nowhere.
- Agree leaves two rules.
- A check reaches the plan that is not on the list.

**Order (draft).**
1. Ship M16 first.
2. A $0 POC on the riskiest part first: page-look questions asked from the block lose no quality. Pre-registered in FINDINGS before the run.
3. Then one family at a time: pages, sheets, Tickets, deletes.

**bareloop.** The survey's "bareloop same?" column: B1, B2 and C2 are in bareloop v0.56.0 too. Tell the `loop` session so both repos move together (hamr's word needed).

**Open questions.** Not settled; hamr rules.
- What does Not checked say for a Tickets filter row?
- Do sheet column offers (A2) stay as the block's clarifying ask?
- "Under N" as `maxWords N-1`, or a strict rule? (bareloop has the same.)
- Old signed plans: rerun as they are, or refused?
- A4 drafter questions, B3, B4, B7's NO_GUARDRAIL words, B8, C8, C9, D3: each is marked "open" above.

**Next, not scheduled — first thing next: one per-line ledger** (hamr, 2026-11-10, unsigned draft; module number: hamr picks). DRAFT for hamr to edit. Not signed, not built, no module number. It needs its own scope, exit and negative scenario signed by hamr, and a $0 POC first, before anything is built.

**Why.**
- What line N checks is spread over 21 lists (F171, "The lists (21)"). fwdloop has no per-line ledger (F171 answer 1).
- A fix to one list leaves the others. Example: M10 am24 stopped the double ask (pageask.js:103; 0 of 60 later plans), but the code still lets a rule be agreed and dropped (F171 disagreement 5).
- bareloop has the same shape: about 15 lists and no per-line ledger (bareloop `.claude/scratch/r10/ledger/MAP.md`, section 0). It mapped it and postponed its own build.

**The problems it must remove** (F171, one line each).
1. Not checked lists a rule the signed plan checks. "Under $150": 29 of 36 green line-2 plans. It is the "$150 mix-up" (disagreement 1; the display gap F172's 2026-11-10 note says is still open; the limit itself is not lost).
2. One thing is listed by several writers and deduped only by exact string. The destination is listed twice in 51 of 60 plans (disagreement 2).
3. After an "agree", two rules with one meaning ("exactly 3 bullets", "exactly 3 list items") each get a checker, and nothing says which covers which (disagreement 4).
4. A rule can be agreed and dropped at once. am24 stopped the double ask only (disagreement 5; `d-00mw9n54f1-e8a7`).
5. A line's signed reason it is unjudgeable is shown on no screen. Its other rules go only into the unsigned Not checked (disagreement 6).
6. No rule-level coverage anywhere. A rule that no check carries and no list names cannot be caught (disagreement 8). No live miss is proven; the code just cannot see one.
7. A "drop it" on a page can't-check is not carried on Revise, so the same question can be asked again (disagreement 9).
8. The page map re-runs per draft. The reason the person sees at sign is the last map's, not the one they answered against (disagreement 10; `d-00mwaei5w4-10f8`).
9. A plan with zero content checks can be signed (answer 7; `d-00mwaeaump-66c3/draft-1`: all six steps hitl, `spec.hash` written).
10. am27 (4)'s retention record counts picks as one boolean per line. It cannot see an agreed pick that was never built (answer 5).

**Side by side with bareloop** (MAP.md section 3 = D-numbers; their status as of the map).

| fwdloop (F171) | bareloop | bareloop status |
|---|---|---|
| disagreement 3 and 5: a "drop it" lands in different places by ask kind; agreed and dropped | D7: look `dropped` vs pick-ask `left`, two owners of one meaning | RD, not seen |
| answer 4 and disagreement 1: Not checked vs the signed Checked | D8: card vs Job tab Not checked, two renderings of one list | RD, not seen |
| answer 5: retention cannot see agreed-but-never-built | D15: retention does not count agreed AI items | RD |
| answer 7: a zero-content-check plan signs | D4: a close with no real check could sign | built on bareloop's branch feat/check-ledger (55e7234), NOT released: bareloop v0.55.0, 2026-11-10, does not include it |
| disagreement 8: no rule-level coverage | D10 / L11: every `~` rule carried or refused, red `rubric-rule-dropped` | reconciled at the validator |
| answer 6: the drafter prompt promises more than code does | D3: "code adds the checks the person picked" true only for `~` picks | text unchanged, seen as VANISHED in 2 of 5 |

- bareloop has two things we do not: the D4 end check (55e7234), built on bareloop's feat/check-ledger, not released in v0.55.0 (loop, 2026-11-10), and the rule-level red `rubric-rule-dropped` (MAP L11 / D10, rubricstep.js:727; in released tags since v0.42.0 by git tag --contains). bareloop's design draft 2 (`../bareloop/.claude/scratch/r10/ledger/DESIGN.md`, 2026-11-10) took our 9 gaps; one ruling (sign state/rule/line/part, not reason words) is with hamr.
- Our rule: copy bareloop code only from a released tag, with the `// borrowed-from:` header. Never import.
- Where we differ: bareloop has a confirm AI (L6, L7) that plans checks and takes free-text answers. We have none. Our close is one class per line, not parts (F171 "The one fact first"). So its confirm kinds (item kind 3, and the confirm half of kind 6) do not exist here.

**The shape (draft).**
- One code-owned row per (job line, rule or AI part). Item kinds, taken from MAP section 5 and adapted:
  1. `~ rule`: the person's own words, including an agreed reading written as a rule.
  2. `~ pick`: a rule's settled check, or left, or own words.
  3. look fact: a kept page or sheet fact with its `forRule` tie, and the drops with reasons.
  4. AI part: the drafter's close or fact for the line, after code transforms.
  5. answer: a look ask or shape ask answer (agree, own words, drop it).
  (bareloop's "AI proposal" kind and the confirm Q/A half of "answer" are dropped: no confirm AI here.)
- States: proposed, then agreed, dropped, or not-checked (with a reason code), then built (with a part reference) or refused (with a reason). Each row also records who set it (person, code or AI) and the words the person saw.
- One writer: one function assigns each field; everything else calls it.
- REPLACES (become views of the ledger), from F171's sketch: `not-checked.json` (list 15, three writers plus an AI list), the Not-checked part of lists 18 and 19, `picks-record.json` (list 10), the `left` and `picks` argv plumbing (list 9) and `redraft-N.json`'s `left` (list 8), `settled` (list 11), the per-line `unjudgeable` and `refused` strings of list 14 (kept in the signed declaration only as a rendering), and the retention input (the F170 POC `retentionOf`).
- FEEDS it (stay as their own step, write rows): the look (lists 2-4), the asks (5, 7), the answers (8), the drafter's declaration (13).
- STAYS: the signed job (lists 1, 14, 17, 20), the validator's per-line views (16) until readers switch, the run-time records (21).
- Readers that switch to it: the sign card, the Job tab, the Audit Draft group, the drafter prompt (its "settled before you draft" promise rendered from ledger states, F171 answer 6), the validator (every agreed row built or listed, by row id), and the retention record.
- Open for hamr: whether the signed spec gains a field. A signed-spec field change flips the hash. Without one, the ledger stays unsigned, like `not-checked.json` today.

**POC first ($0, before any scope is signed).**
- Riskiest assumption: one ledger can be derived from what a draft already saves, without losing anything.
- Method: a throwaway script rebuilds the ledger from the saved draft folders (F165, F168, F170, F172 in the session scratchpad, and `~/.config/fwdloop/flows/.drafts`). No src change. No model call.
- Bars to propose (the orchestrator pre-registers them in FINDINGS before the run):
  1. Every `~` rule of every plan gets exactly one row.
  2. The rows reproduce each disagreement F171 measured: they flag the 29 of 36 "$150" contradictions, the 51 of 60 doubled destinations, and `d-00mwaeaump-66c3/draft-1` as zero-check.
  3. A planted vanished rule (a rule deleted from a saved plan's carriers and lists) is flagged.
  4. The test can fail: break one derivation and see the bar go red.

**Draft scope, exit and negative scenario (DRAFT, not signed; hamr to edit).**
- Scope: the ledger, every reader above switched to it, and bareloop's two fixes (a zero-check plan cannot be signed; a rule-level red when a `~` rule is neither carried nor listed).
- Exit: a paid batch like F172 (same job, page and model), plus a hamr walk where the sign card and the Job tab show the same Checked and Not checked and no rule is missing.
- Must fail when: a `~` rule has no row; two screens disagree; a zero-check plan signs.

**Then share with bareloop.** Send the POC result, the design and the code to the `loop` session. FYI only.

**Open questions for hamr** (no answers invented).
1. The module number.
2. Order against "Next: reopen the M10b aging exit after bareloop's learnings" below. The memory order after v0.27.0 was setup redesign, then M10b aging, then parked items. The ledger goes before M10b aging only on hamr's word.
3. Release the open branch `fix/ticketfilter-schema-desc` first? The orchestrator recommends yes.
4. Does the signed spec gain a ledger field (flips the hash), or stays unsigned?

**Other open fixes (2026-11-10).**
- (a) Raise the bareguard pin: see "Parked, not scheduled: raise the bareguard pin" above.
- (b) F171 disagreement 7: the name `notChecked` means two things (Result tab `lines[].notChecked` is a run fault string, cited-record.js:105; the Job tab and sign card `notChecked` is the draft-time list 15). Naming only; it folds into the ledger.
- (c) hamr's ask, 2026-11-10, unsigned: am27 (3)'s code-built count pick covers a single count guardrail only (the am27 block in `docs/wiki/the-module-ladder.md` says "a single count guardrail"; F171's lists table row 4 in `docs/logs/FINDINGS.md` says "not two counts, a range, or a section count"). Two counts on one line, a range ("3 to 5 items"), or a section count with nothing kept still get am16 (3)'s "I can't check this". It needs its own signed amendment and folds naturally into the per-line ledger (a count row).

*Update 2026-11-11 (hamr and the `loop` session; unsigned).* The plan changed: fwdloop does not build its own ledger. It copies bareloop's "one check list" from a released tag, then fixes only what that list leaves.
- bareloop's design moved past draft 2: `../bareloop/.claude/scratch/r10/ledger/DESIGN3.md` (one list made once before the first try: `~` rules by you, `!` checks by the agent proven against the inputs, `$` defaults; frozen across tries; every row ends built, not-checked with a reason, or dropped) and `BUILD-SPEC.md` (Phase A built on bareloop `feat/check-ledger`, not yet run on a real model; Phase B not built). Before its tag bareloop still has: B1-B3, a no-loss test on real saved drafts, the full suite, one paid verify (cap $1), review, release. loop tells us when it is tagged.
- loop's mapping of our 10 problems (2026-11-11, loop's word, not measured here): solved by Phase A: 4, 6, 9. Solved by Phase B (designed, not proven): 1, 5, 10. Partly: 8 (frozen across tries, not across a Revise). Not solved: 3, 7. Unclear: 2 (bareloop has no destination row; unverified for our case).
- 3 and 7 are parked (see "Parked, not scheduled: two ledger gaps bareloop's check list does not cover"; F174 found no live failure for either).
- The "POC first" section above is replaced: no fwdloop $0 rebuild POC. After the tag, the copy gets its own validation on our saved drafts, pre-registered in FINDINGS, and its own signed scope.
- Ruling (a) settled in the `loop` session by hamr 2026-11-11, amended the same day: signed rows are line, key, from, by, kind, state, rule, part and reason (plain words). The row's word copy is not signed; it stays in the draft log.
- Open questions above: 3 is done (released as v0.30.0, PR #41). 1 (module number), 2 (order) and 4 (does our signed spec gain the field) stay open for hamr when the copy is scoped.
- Until bareloop tags, nothing on this entry is built.

**Next, not scheduled: reopen the M10b aging exit after bareloop's learnings** (hamr, 2026-10-23, unsigned). The M10b exit is met for the expenses job; the aging job stays open (F78): the drafter drops or mis-tags the bucket check. The bareloop `loop` session will send its learnings on this; they are copied byte for byte, UI and inner working, under a signed amendment, before the aging exit walk is run again. The m10b branch is reviewed and released with this one issue open.
1. The learnings spec came from the bareloop `loop` session on 2026-10-23, as hamr signed it there. Source of truth: bareloop branch `feat/learnings`, commits `d185cfa` (the Audit box) and `1ba048d`, `107fce5`, `9ce156f` (ledger and memory rules). Code: bareloop `src/panel/index.html` `renderAuditLearnings` / `learnRow` / `learnHintLabel`, `src/panel/server.js` (getRunDetail `learnings`), `src/learn.js` `parseHintBlock` (reader) and `hintText` / `renderHints` (writer). A local copy of the message: `.claude/scratch/bareloop-learnings-spec-2026-10-23.md` (gitignored; bareloop's commits are the source).
2. What it is: a read-only Audit section showing the exact text the drafter was handed from earlier runs. One fold at the top of the Audit tab, the same box as the other Audit sections, closed by default, header `[✓] learnings  What the planner was told from earlier runs · N hints`, no arrow. Inside, each hint is a small table: its title line (n · level · seen N times · check · error kinds · fixed / never fixed), then "It said:", "Fix touched:", "What changed:". Hidden when a run has no learnings. Setting `learningHints` off by default. *Update 2026-10-25: the fold now wears the same ▶ / ▼ arrow as the other Audit folds (bareloop 417e80c, learnings part only).*
3. Its rules: the ledger keeps every row; a row last seen over 56 days ago, or from another signed job version, is not handed to the drafter; levels (this job, this place, all jobs) are worked out at read time; the block is capped at 2,000 characters; rubric lessons count only after a human Accept.
4. Open before it is built (hamr to rule): (a) this PRD says fwdloop does not learn across runs in v1, and if it ever does it comes in as its own signed module (Guiding principles, "Deliberately not borrowed"), so it needs a signed scope, exit and negative scenario first; (b) bareloop has a mid-run replan and fwdloop redrafts instead, so "At the first replan" needs a fwdloop meaning; (c) phone width is not yet checked on bareloop's side.

*Update 2026-11-11 (orchestrator's reading, unchecked).* bareloop's one check list (every rule ends built or not-checked with a reason, list frozen before the draft) may be the learning this waits for, since the aging problem is a dropped or mis-tagged bucket check. So this also waits for bareloop's check-list tag. Not measured.

**Next, not scheduled: outside tools through MCP, with barebrowse as the fallback** (hamr, 2026-10-27, unsigned). Not drafted; it needs its own module with a signed scope, exit and negative scenario before it is built. Tickets (below) is its first real job. hamr's direction:
1. A job names an MCP server the person already set up as a source: `guardrail: source gh = mcp:<server name>` (the name in the person's own MCP config, e.g. `~/.mcp.json`). The human names it; the agent never discovers or adds a server, and a repo's own `.mcp.json` is never read (bareagent's default since v0.16.1).
2. Explored at draft: fwdloop lists the server's tools for the person to see.
3. Distilled, never open: the drafter proposes only the tools the job needs; the person signs that list (tighten-only). A run sees no other tool; an unsigned tool stays shut by mechanism, not prompt wording (bareagent's bridge allows new tools by default; fwdloop flips it to deny).
4. Keys: each server's key reaches it through that server's own `env` from the person's environment; fwdloop starts the server and never reads, writes or logs the key.
5. Read only first. A tool that changes or sends something is a send: a signed destination plus an accept, later.
6. Order of readers: an MCP server when the person has one; barebrowse for anything without one; fwdloop never calls a vendor API itself (that would grow a primitive).
7. Later, after the MCP path is clean: rwxmap labels each tool r / w / x and bareguard gates by the letter (r inside a run; w and x need a signed destination plus an accept). bareguard's own agent rwx scoping is the heavier alternative; distilled plus drafter-proposed is tried first because it is leaner.
8. POC first, the riskiest assumption: bareagent's MCP bridge (`createMCPBridge`, untested by us) starts a real GitHub MCP server, lists its tools and reads issues read-only, and a tool not on the signed list is refused (the test that must be able to fail). A gap is an upstream ask to bareagent, never a patch here.

*Update 2026-11-11: built as M12 (docs/wiki/the-module-ladder.md "M12 — outside tools through MCP, and tickets that start a run", scope signed 2026-10-27, exit signed 2026-10-30; CHANGELOG v0.27.0), then reshaped by M13 (MCPs used as offered, no write-tool locks). Item 7 (rwxmap gating) is later; hamr ruled no locks for now.

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

*Update 2026-11-11: built as M12 (docs/wiki/the-module-ladder.md "M12 — outside tools through MCP, and tickets that start a run", scope signed 2026-10-27, exit signed 2026-10-30; CHANGELOG v0.27.0), then reshaped by M13 (MCPs used as offered). The later slices in this entry stay unscheduled.*

**Next, not scheduled: one setup for outside sources (MCP dropdown, Schedule from day 1)** (hamr, 2026-10-30, unsigned). Not drafted; it needs its own amendment or module signed by hamr before it is built. Why: the M12 walk proved the engine (reading tickets, skip, queue, watched field, books), but the ticket setup feels like a carve-out from the normal job. hamr wants the experience to match across file, page, MCP and (later) chat and search. hamr's direction, from the 2026-10-30 tickets walk:

1. Inputs stay as today: a free name and a path or address (`report: /path/to/file.csv`, `airbnb: <url>`).
2. MCP is chosen from a dropdown, not typed. A new Settings tab (next to Providers) lists the servers from `~/.mcp.json`. hamr adds a path there and sees what each server can read (tools and read-only marks). The job card picks a server from a dropdown, in the style of "Run a signed flow". With the dropdown, `mcp:` and `chat:` input keywords are not needed. For now it is vanilla MCP (read-only). Later: from a job's chat, spin off a scoped copy of a server with w/x rights, guided by hints, then carry the same model to chat rwx.
3. barebrowse is one entry in the same dropdown (it already runs as an MCP server). A site with its own MCP server uses that; a site without one uses barebrowse; search later is barebrowse too. What was found:
   - F106 (2026-10-30, $0) FAILED on the letter: barebrowse 0.26.0 marked no tool read-only, so M12's rule refuses every barebrowse tool.
   - At hamr's ask, barebrowse is building 0.27.0 (branch `feat/mcp-tiers-site-lock`). It adds:
     - hints (annotations) on every tool;
     - tiers set at start, `BAREBROWSE_TIER=r|rw|rwx`; tools above the tier are not listed and are refused;
     - a site lock, `BAREBROWSE_ALLOW=host,*.host`, enforced in the browser on every page load, including redirects, clicks, JS jumps and popups;
     - a bad tier or allow value means the server refuses to start.
   - F107 (pre-release, $0) passed (a), (b), (d), (e) and (f). (c), the Codeberg body read, failed on the letter: a Chromium page-load timeout that also happens on 0.26.0 and that barebrowse could not reproduce. Firefox read the body with the lock on.
   - Owed: re-run the checks on the installed 0.27.0 once it is published.
   - fwdloop would start barebrowse at tier `r`, locked to the job's signed site.
4. Schedule can be set from day 1, on the job card. It stays off until the job's first green run, then turns itself on. A red run reused redrafts with the same schedule. "Schedule run" stays for a job that had none. No separate When box (that would be scope creep; the trigger is part of Schedule).
5. One run per ticket. The Result tab stays as for any job. Runs are named by the ticket number.
6. The by-hand `ticket #` box becomes a backend reach check: a $0 "can I reach it?" read at draft, the same for every source (MCP, browse, chat).
7. What this would change of signed M12 text: the Inputs form (item 8), the ticket-number ruling (PRD 2026-10-29), the Result ticket list (item 9). The engine stays.
8. rwx scoping is bound by the server's MCP hints (mcphints). With no hints, w/x can't be decided, so the server stays read-only. Building MCP servers for sites that have none is not pursued: sites rarely publish OpenAPI (rwxmap's experience). barebrowse grading its own tools is the gateway for any site. The w/x split of a hinted server (e.g. GitHub's 19 write tools) waits for the scoped spin-off, and starts as its own POC.

Open points (unsettled):

- Where do a skipped ticket and "Run it anyway" live if the Result list goes?
- Is a run name the number alone, or number plus title?
- What does the first run read when there is no ticket box (the newest ticket?)?
- Loose ends from the M12 walk (unsigned):
  - `list_issues` is signed only in `schedule.json` (`trigger.tool`), not in the declaration's `mcp.tools`. The M12 Done-when said both are signed. Settle where a trigger's tool is signed.
  - "Reuse workflow" from a preflight-red run showed **Start drafting** (a paid redraft) instead of **Run now**. Cause not found.
  - An `unreadable` look (for example pass locked) is recorded only in the schedule ledger. Nothing on screen shows it.
  - A watched change that arrives while the same ticket is still queued queues a second run. Fixed on this branch (8063c49): a watched change on a ticket still queued queues no second run.
  - The drafter emitted the ticket filter only for some wordings (`priority P1 only` worked; `only tickets with priority P1 count` did not).
  - The Audit grid (M4d am36) was copied from bareloop's unreleased branch. It must be re-checked against bareloop's release tag.

**Missing requirements found by /branch-review, to discuss before any fix (hamr, 2026-10-30, unsigned).** These fold into this redesign. None is fixed yet; each is discussed first, then fixed. All are in the fix ledger.

1. Rerun of a ticket run reads the issue as a web page, not through MCP (`src/runner.js`): no label or closed check, and the rerun drops off the Result list. Only the read step was reproduced, not a whole rerun.
2. Flood: when every seen ticket is closed, older open tickets read as new (`src/trigger-tickets.js`). 100 open, the 10 newest closed, 1 new = 91 queued runs; this clashes with signed M12 item 6.
3. A failed ledger write after a look exits the whole panel (`src/panel/scheduler.js`).
4. `unsure` from a label is written to run.json and read nowhere (`src/ticket-labels.js`); signed item 4 says an off-scale label goes to a human.
5. The MCP server is spawned with the full process env, so provider keys can reach a third-party server (`src/ticket-mcp.js`). UNVERIFIED which servers read them.
6. Digit-join run-id comparison (`src/panel/tickets.js`): `run-3-rerun-1` reads as 31 and beats `run-25`. UNVERIFIED; masked today because a rerun carries no ticket entry.
7. No upper bound on a numeric ticket value in the body (`src/ticket-draft.js`). UNVERIFIED; ends as a refused start (the page only sends strings).

Items 1-3 are the ones hamr asked about by name; the item numbers match the review report.

**Design talk 2026-10-30 (hamr, unsigned; replaces items 2, 3 and 6 above where they differ).**

1. No "where" box: the Inputs line names what to read. Inputs may be empty for a generic MCP job.
2. One dropdown labelled `Flow type` with modes: plain, MCP (generic), Tickets, Tickets URL, Search. Chat is added later when beeperbox is connected.
3. MCP (generic) takes any read-only server from a Settings > MCP tab and uses the normal Result page; it is the base. Named cases (Tickets, later Chat, others as needed) are known job shapes grown per need.
4. A server pick (labelled `MCP`) shows only for MCP (generic) and Tickets. Tickets URL and Search are barebrowse modes: no server pick, barebrowse at tier r locked to the Inputs URL's host.
5. Search takes a URL in Inputs (e.g. `search: https://google.com`) and searches there. Open, settled when Search is built: whether Search runs with the site lock (barebrowse can run without one) and whether it reads the results page only.
6. Schedule stays its own choice and grows with the mode: By hand and Every day at… for all; `When a new ticket arrives` only for a mode that defines "new" (Tickets, Tickets URL). A generic server has no "new".
7. Schedule can be set on a new job from the start (ruling 1 over "schedule only after green"). It stays off until the first green run, then turns on. While waiting, the Run card shows a grey line `Schedule waiting for a green run`; a red run is normal shaping, not a warning.
8. The first run of a ticket job reads the newest ticket at the time it starts; older tickets never run. There is no ticket # box.
9. Result tab: variant B, one grid for all runs with buckets Needs you / Stopped / Passed / Skipped as fold rows and a stats line; runs named by ticket number.
10. Mail: reading mail through a generic MCP server the user adds is the user's call later; nothing mail-specific is built (the earlier "no mail" suite-peer ruling stands).
11. Mode names are Tickets and Tickets URL (hamr, 2026-10-30): more generic than issues.
12. Labels (hamr, 2026-10-30): the mode dropdown is `Flow type`, its empty mode is `plain`, and the server pick is labelled `MCP`. This redesign starts as a new module, not an M12 amendment, because it changes M12 a lot; its number is hamr's to give.

**Design talk 2026-10-30, part 2 (hamr, unsigned; replaces the earlier points where they differ).**

1. Module: this is M13 (hamr, 2026-10-30), a new module, not an M12 amendment. Split: M13 = Settings > MCP tab, Flow type dropdown (plain, MCP (generic), Tickets), schedule from day 1, the Result grid (variant B), and the seven missing requirements above. M13b = Tickets URL and Search through barebrowse 0.27.0. Remote MCP servers (a web address plus login) are a later module of their own.
2. Where servers come from: the four places bare-agent's discovery reads (`~/.mcp.json`, `~/.claude/mcp_servers.json`, `~/.config/Claude/claude_desktop_config.json`, `~/.cursor/mcp.json`) plus any path the user adds on the MCP tab. A project folder's `.mcp.json` is never read. This widens signed M12 item 1 ("~/.mcp.json only").
3. Found at $0 on hamr's machine 2026-10-30 (files read, no server started, no keys printed): `~/.mcp.json` 1 server (github); `~/.claude/mcp_servers.json` 1 (aurora); the Claude Desktop and Cursor files absent; `~/.claude.json`, where Claude Code keeps its servers, has 4 (beeper, baremobile, barebrowse, litectx) but bare-agent does not read it by default, so "add a path" is needed on day one (an upstream ask to bare-agent to add it to its defaults is possible; not sent). beeper has no start command: a remote server, out of M13.
4. Settings > MCP tab (mock `docs/product/m13-settings-mcp-mock.html`), same look as Providers: one list "Path and MCP"; each path is a header (found with its count, or faint "not found"; an added path shows "(added)" and remove); its MCPs sit under it. Paths start open, MCPs start folded. An MCP row: tools count, last checked, `check tools`, and a usage line (used N times in M runs, last used, denied count). Open, it lists each tool with its hint and how many times it was used. `+ add a path` at the bottom. The Flow type / setup form mock is `docs/product/m13-setup-mock.html`.
5. `check tools` starts that server once, only when pressed, never on page load; the result is kept with its time. The page only reads the config files: it never edits them and never shows commands or keys.
6. Use counts come from what runs already record (`run.json` `mcp.calls` for ticket reads; the Audit fold's tool-call count for step tools): no new run-folder file. Speed over many runs is unmeasured; a small POC if slow.
7. MCPs are offered as-is; what a tool does outside is the user's responsibility. Scoping is done where the key is made (cloud IAM, a GitHub fine-grained token). This bends the CLAUDE.md hard line "nothing leaves the machine without a signed destination and a human accept"; M13's signed scope must say so in one plain line, and fwdloop's own sends still need a signed destination and an accept.
8. Hints are info only in M13: the read-only refusal of signed M12 item 2 is dropped. Kept: only the tools the user signs exist for the run (M12 item 3), and the page shows each tool's hint (read-only / none). Gating by hints (r, rw, rwx) is a later feature, when hints are common; it works at the gate (the server starts whole, the AI sees only allowed tools, bareguard blocks the rest), not by a smaller copy of the server. A server that supports limiting itself (barebrowse tiers) can also be limited at start.
9. Turning any site or app into an MCP is not pursued (point 8 above stands): barebrowse covers sites with no MCP, and once remote MCP is supported, services such as Zapier or n8n that offer an MCP server can be used as-is.
10. Unsettled: if two paths hold an MCP with the same name, which wins (proposal: the first in the list, with a warning on the page).
11. Working folder (hamr, 2026-10-31): every MCP starts in the home folder. A folder-based MCP that needs a project folder would take it from an Inputs line; parked until a real job needs it.
12. Parked (hamr, 2026-10-31): litectx as a job's MCP. It only finds what has been indexed; F116's `recall` worked because that repo was already indexed. Using it on a job's own files needs `index` to run first (a write tool), its support for CSV and docs checked (unchecked), and a folder for the index. Job files are small and already reach a step through fwdloop's read tools, so this waits for a real need and its own POC. M13's generic MCP walk uses GitHub or barebrowse, which need no index.
13. Open question, litectx in-run tools (hamr, 2026-10-31, unsigned, not in M13). M7 gives steps litectx-backed tools (`recall`, `get`, `recent`, `related`, `impact`, `compress`, `peek`, `stash`). Over 80 real runs (F113) only `get` (30 calls, 6 runs) and `stash` (12 calls, 6 runs) were used; `read` 45 in 12. hamr's goal: find what isn't used and what relies on indexing, then decide. Removal is likely: fwdloop jobs are single files, not repos, and grep/read are faster. Keep in mind: a job of a few huge documents could need chunking (not seen yet); indexing at draft time is one option; leaving it is another, since litectx's tools are described for big files, so agents won't reach for them anyway. First a $0 look at what those 6 runs used `stash` and `get` for. Touches signed M7 and the bare-suite rule in CLAUDE.md, so it needs its own signed scope.
14. Upstream ask, not yet answered (2026-10-31): a bridge-level `cwd` in bare-agent, so MCPs can start in the home folder (point 11).
15. MCPs are used as-is (hamr, 2026-10-31, ruling R1, unsigned): a job with an MCP gets ALL that MCP's tools. At draft the job's `mcp.tools` is the full tool list from that MCP's newest OK line in `mcp-checks.jsonl`, set by code, never chosen by the drafter or reviewed by the person: no tool picker, no review step. If the MCP was never checked OK, the card refuses before drafting at $0 with `press check tools in Settings > MCP first`. No server is ever started to fill this in (a server starts only on a press of `check tools`). A tool the server gains later does not exist for the job (signed M13 item 3).
16. Tickets, by-hand Run (hamr, 2026-10-31, ruling R2, unsigned): no ticket # box. A by-hand Run reads the newest ticket that has not run yet, through the job's filter. Nothing new: says so at $0 in one plain line, and no run starts. Run it anyway and a rerun keep their own ticket (signed M13 item 9.1).

*Update 2026-11-11: built as M13 (docs/wiki/the-module-ladder.md "M13 — one setup for outside sources", scope signed 2026-10-30, exit signed 2026-11-01; CHANGELOG v0.28.0). Settings > MCP, the MCP dropdown and Schedule on the card are the signed M13 items. Chat and Search as later sources stay unscheduled (item 10 of the 2026-10-30 design talk).*

*Update 2026-10-30: this ask was signed by hamr as M4d amendment 36 (2026-10-29) and is built on branch `mcp-tickets` (80676fe, 869a52b); the text below is the original unsigned ask, kept as written. The signed text is in docs/wiki/the-module-ladder.md.*

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

*Update 2026-11-11: hamr: kept for later. Next big module after the bareloop check-list copy; not before.*

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

**M14 — memory improvements, borrowed from bareloop's shape (DRAFT, not signed).**

**Why:** today a human's words at an ask reach one place only. Accept text is saved and thrown away; a Redo reason reaches only that step's redo; a Rerun reason reaches only the first step. F127b: later steps never learn them (0 of 12 today, 12 of 12 with a memo).

**A. The carry memo: what happened so far in this run, for every fresh worker.**
1. Plain code writes it, no AI. It is built fresh before each try from what the run already keeps. No new run-folder file. It survives a pause, resume or restart.
2. Every model step gets it on every try, including the first try of a later step. If nothing has happened yet, it is left out.
3. Human lines, in order, never cut: `ask N (after step X): accept / redo / rerun — user says "…"`. Accept text is now used. A blank answer adds no "user says" line.
4. Work lines: the last try and how it ended, then earlier tries of this step with each check result, then earlier steps' failures. Repeated failures fold into one line (the learnings fold rule). A try's result is taken from its check, never guessed.
5. Cap 4,000 characters. When too long, cut the oldest tries first, then the oldest failures. The heading and the human lines are never cut.
6. Left out: money and time, and the newest failure when the retry already gets it as its gap.
7. The text the AI saw is saved per try, on that try's audit row. The Audit tab shows it: in each step's grid, a `told in this run` row under `told from earlier runs`, with one button per try that opens the exact memo text, the same way the hints open.

**B. bare-agent 0.59: cut-offs and bad tool calls.**
8. bare-agent goes from `^0.57.0` to `^0.59.0`.
9. A cut-off retry's gap names bare-agent's facts: output tokens, how many were thinking, and the limit.
10. `checkArgs` is on. A wrong or missing tool value never runs the tool. `badCalls` go on the audit row.

**C. The Audit shows every hand-over.**
11. Every place learnings or the memo are handed to the AI has its Audit row. A place that hands text with no Audit row is a gap.

**D. What stays the same:** learnings stay separate and unchanged; in-run memory still lasts one run.

**Not in M14:** memory across runs from Accept notes, and anything bareloop marked as not proven (the notebook, readMap, seed note).

**POCs before build** (each small, on the real run path): (a) the memo built from real audit rows of an old run with 2 asks, at $0: is everything there and in order? (b) one live run with the memo and the 0.59 upgrade: do the books balance?

**Done when:** a live run with 2 asks where the Accept text and the Redo reason both appear in a later step's first-try memo, the saved memo matches what was sent and the `told in this run` row opens that exact text, a forced cut-off and a forced bad call both show on the audit row, the books balance, and the suite is green on 0.59.

**Negative case:** a run with no asks gets no human lines; a blank Accept adds nothing; the memo never shows money; a good tool call is never flagged.

Ruled by hamr 2026-11-02 (not a signature): the module number is M14; the memo text is saved on the audit row; learnings and the memo show in the Audit wherever they are handed on; the memo row reads `told in this run`. Sources: F127, F127b, F128, F129 in `docs/logs/FINDINGS.md`; bareloop v0.53.0 `docs/product/LAYERS.md` ("Notes to the AI") and loop's answers 2026-11-02.

*Built after signing — not signed text: the draft above is kept as written. M14 was signed by hamr 2026-11-02 (with its amendments 1 and 2) and its exit 2026-11-03; M15 (one result for every job) was signed 2026-11-03. The signed text and what was built are in docs/wiki/the-module-ladder.md under M14 and M15.*
*M16 (one check list, ported from bareloop v0.56.0; am1-am3) was signed by hamr 2026-11-13; signed text, build plan and rulings are in docs/wiki/the-module-ladder.md under M16; POCs F185-F189 in docs/logs/FINDINGS.md.*

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
