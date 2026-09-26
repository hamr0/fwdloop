<!-- borrowed-from: bareloop docs/product/PANEL-BUILD.md@a30bbef -->
---
type: reference
title: "Panel (N6) build — layering, the gap, and the rungs"
status: active
sources: [docs/product/PRD.md]
---

# Panel (N6) build

The build plan for PRD item N6, the panel (§10 build order; superseded routing per PRD
addendum v1.84 below). The PRD holds the rulings; this file holds the layering law, the
measured gap between today's code and a panel, and the milestones each with its own exit
condition. Branch: TBD (opened when P0 starts). Builders are sonnet (strict pin); every rung
lands green on its own before the next starts.

## 1. What the panel is

From hamr's scope interview (`.claude/stash/2026-09-22-panel-design-settled.md`): the panel is
where hamr runs and starts workflows — his management panel and observability surface. He
fills the job's requirements (provider/token price, check type, time cap, money cap, up to two
review rounds plus a confirm turn) and, once a run is signed and firing, watches it live: turn,
elapsed time, glyph per step, step descriptions, and where a stuck run got to. It shows audit
traces, supports replaying a past run at $0, lists previous runs, and can import a run (bundle
and run record) for view-only inspection. It handles multiple workflows at once and runs at
127.0.0.1 (localhost) only — no LAN, no phone access (parked). It is lightweight JS with a
workflow map in the codegraph style (plain step boxes, not a text-only timeline).

## 2. The layering law

**hamr's ruling, option A — one source, each layer calls the next:**

> `src/` library function → `src/cli.js` command → panel HTTP handler.

Each layer calls the one inward of it. The library functions in `src/` are the single source
of truth for every flow; `src/cli.js` commands are the CLI's own callers of those functions
(the same shape `bin/bareloop.mjs` already is over `src/cli.js` — a thin ~10-line adapter
that supplies real deps and turns an exit code into `process.exitCode`, never re-implementing
anything `src/cli.js` does). The panel's HTTP server is one more caller in that same chain: it
calls the same library functions `src/cli.js` calls (directly, in-process — never by shelling
out to a script or another CLI invocation), and it never re-implements arbiter or flow logic
of its own.

**Consequence, stated as a gate:** a flow with no CLI command is not ready for the panel. If
the panel needs a flow that only exists today as inline logic in a `scripts/*.mjs` file, that
logic moves into `src/` and gets a `bareloop <command>` FIRST (rung P0, below) — the panel
never reaches past `src/cli.js` into a script.

This is also hamr's answer on where the panel lives: inside the bareloop package itself
(no separate process wired by IPC, no new dependency to talk to a sibling server) — the panel
HTTP handler is one more file in this same codebase, requiring nothing `src/cli.js` doesn't
already require.

## 3. The gap, measured

Measured 2026-09-23 (pre-P0); re-verified 2026-09-24 against the actual source
post-P0 — every row below the CLI line the 2026-09-23 table marked "No" now has a
`bareloop` command, confirmed by grep/`wc -l` on the current tree, not restated from the
earlier table.

| Flow the panel needs | Where the logic lives today | CLI command today? |
|---|---|---|
| Export a job spec to a bundle | `src/bundle.js` (`exportBundle`, exported from `src/index.js`) | Yes — `bareloop export` (`src/cli.js:doExport`) |
| Run a signed bundle against a repo | `src/run.js` (`runJob`) + `src/bundle.js` (bundle read/bless/envelope) | Yes — `bareloop run` (`src/cli.js:doRun`) |
| List a bundle's history + bridges | `src/index.js` (`loadRegistry`, `listingRow`) + `history.jsonl` | Yes — `bareloop history` (`src/cli.js:doHistory`) |
| **The interview** — the ENTRY GATE for a new job (source/destination, goal, guardrails, check type, judge examples, confirm turn) | `src/interviewrun.js` (one argv-parsing `main(argv, deps)`, lifted verbatim out of the former `scripts/run-interview.mjs` repo script per P0); `scripts/run-interview.mjs` is now a thin ~22-line adapter over it | **Yes** — `bareloop interview` (`src/cli.js`, routes to `interviewMain`) |
| **Authoring** — draft/revise/sign a job spec from interview answers | `src/authorrun.js` (one argv-parsing `main(argv, deps)`, lifted verbatim out of the former `scripts/run-author.mjs`); `scripts/run-author.mjs` is now a thin ~22-line adapter over it | **Yes** — `bareloop author` (`src/cli.js`, routes to `authorMain`) |
| **Person-path run** — the full run-a-job flow (resume, pause, review door, replay) | `src/userrun.js` — one internal engine behind three thin named doors (`startRun`/`resumeRun`/`answerDoor`, per the settled "one module three thin doors" shape below), lifted out of the former `scripts/run-u.mjs`; `scripts/run-u.mjs` is now a thin ~20-line adapter over it | **Yes** — `bareloop run-u` (`src/cli.js`, routes to `runUMain`) |
| Replay an archived run at $0 | `src/replay.js` (`replayRun`, `formatReplay`) + `src/replayio.js` (the IO layer: `parseJsonl`/`looksLikeSpine`/`replayOne`/`listSpines`, lifted out of the former `scripts/run-replay.mjs`) | **Yes** — `bareloop replay <spine.jsonl>` and `bareloop replay --all <dir>` (`src/cli.js:doReplay`) |
| Read the spine for History/Run/Audit tabs | `src/replayio.js`'s `parseJsonl` (tolerant JSONL reader, skips a malformed line instead of throwing) is now the one named reader; `doHistory` (`readHistoryLog`) and `doRun`'s own job-end tail read both call it instead of hand-rolling `readFileSync`/`JSON.parse` inline | **Yes** — no separate read-only subcommand was needed; the panel's read side calls `src/replayio.js`'s exported functions directly, in-process, the same way `src/cli.js` does (per the layering law, §2) |
| Gate-audit trail for the Audit tab | `src/replayio.js`'s `replayOne` resolves and reads a spine's `-gate-audit.jsonl` sidecar by the name convention (content-based spine detection, sidecar-by-name) — one library reader, no per-caller re-implementation | **Yes** — same as the row above: `bareloop replay` exercises it; the panel calls `src/replayio.js` directly for the Audit tab |

**P0 status: COMPLETE** (see §4 below for the exit condition text and what was actually
delivered against it).

**The entry gate for a new job is the interview** (`scripts/run-interview.mjs`) — hamr's own
words point here: *"on all scripts, they should have had cli, shouldn't they?"* Every flow in
the table above the CLI already has (export/run/history) stays as-is; every flow below it
(interview, author, person-path run, replay, and the two read paths the panel's tabs need)
is the P0 gap.

## 4. Rungs

A rung that cannot meet its exit stops the ladder (PRD build-ladder discipline, §1 hard lines);
the stop is a result, never widened to force a green.

### P0 — one source

Lift the interview/author/person-path-run logic out of `scripts/run-interview.mjs`,
`scripts/run-author.mjs`, and `scripts/run-u.mjs` into `src/` library functions, each callable
in-process with an injectable `deps` object (the same test seam `src/cli.js`'s `main(argv,
deps)` already uses — `deps.provider` etc. skip the real-key check for tests). Give each flow a
real `bareloop <command>` in `src/cli.js` — **signed, hamr: "cli names are fine"**:
- `bareloop interview` — wraps the library form of `run-interview`'s flow.
- `bareloop author` — wraps the library form of `run-author`'s flow.
- `bareloop run-u` — wraps the person-path run flow, itself split into the three doors below.
- A read-side library function per spine/gate-audit consumer the panel's tabs need (History,
  Run, Audit, Job), so the panel never hand-rolls its own `JSON.parse` over `spine.jsonl`
  the way `src/cli.js:doRun`'s own tail-read currently does either — this rung also gives that
  inline read a named library function.
- `bareloop replay` — wraps `src/replayio.js`'s read side over `src/replay.js`'s
  `replayRun`/`formatReplay`. **Provenance note, added honestly:** unlike `interview`/`author`/
  `run-u` above, hamr never separately named `replay` verbatim in the scope interview — it
  was signed on **2026-09-24**, when a post-P0 debrief listed it (among 3 other items) as
  needing his confirmation, and he replied **"fix all"**. That is a blanket approval of the
  debrief's items, not a separate verbatim CLI-naming quote like the other three — recorded
  here plainly as what it was, not dressed up as an equivalent quote.

`scripts/*.mjs` reduce to thin adapters over the library, the same ~10-line shape
`bin/bareloop.mjs` already is over `src/cli.js` (parse argv, supply real deps, print, set
`process.exitCode`) — never re-implementing the flow itself.

**The person-path-run shape — hamr's ruling:** *"i think run-u one libary is better to
prevent drift"*, then *"agreed, one module three thin doors."* Settled shape:

- **One new module, `src/userrun.js`, holding one internal engine.**
- **Three thin named doors** onto that one engine, replacing `run-u.mjs`'s flag-driven entry:
  - `startRun(spec, opts)` — a fresh run (today's `--job` / `--spec`).
  - `resumeRun(runId, opts)` — a halted run (today's `--resume`).
  - `answerDoor(runId, decision)` — a finished run's review door (today's `--door`).
- All three build the same run context and hand off to one shared internal `execute()` — the
  engine is written once; the doors differ only in how they arrive at that shared context.
- **Replay is not a door.** `src/replay.js` already IS library (`replayRun`, `formatReplay` —
  both confirmed exported this session) and stays exactly where it is; it is not moved into
  `userrun.js` or folded into the three doors.
- **Why three doors, not one flag or three separate flows** (both rejected, one line each):
  a single function with a mode flag just relocates the 1992-line monolith as a giant internal
  `if` tree inside one function, buying nothing; three fully independent flows are the exact
  drift hamr is preventing — they fork on resume/spend/branch handling exactly the way
  `run-u.mjs`'s single file has drifted internally already.
- **The three doors are already mutually exclusive in `run-u.mjs` today** — verified this
  session, `scripts/run-u.mjs:542`: `die('--door answers the review door of a run that
  FINISHED; --resume continues one that HALTED. Those are two ' …)`. That refusal is the
  real shape already enforced by the current script; three named doors make it structural
  instead of a runtime flag check.
- **The semantics are already library today — this rung lifts ORCHESTRATION, not semantics.**
  Verified this session, all exported: `runJob` (`src/run.js:245`), `answerReviewDoor`
  (`src/reviewdoor.js:108`), `readResume` (`src/reuse.js:817`), `replayRun`/`formatReplay`
  (`src/replay.js:362`/`:886`). `src/userrun.js`'s job is calling these in the right order with
  the right context per door, the way `scripts/run-u.mjs` does today by hand across 1992 lines
  — not reimplementing what `runJob`/`answerReviewDoor`/`readResume` already do.
- `scripts/run-u.mjs` reduces to a thin adapter over `src/userrun.js`'s three doors, the same
  `bin/bareloop.mjs` shape used everywhere else in this rung.

Also folds in the standing cleanup this session verified live: `scripts/run-author.mjs` has
**6 real `process.exit()` calls** (lines 96, 288, 326, 412, 419, 956 — re-counted this session;
the 2026-09-15 stash's "12" figure had drifted, three of the grep's earlier hits were comment
lines, not calls) and **7 `emit('author-end', …)` sites** (lines 558, 720, 859, 916, 1077,
1096, 1131), all needing one ending-owner once the flow moves into `src/` — a single library
function shouldn't have nine different exit paths written by hand at different points in a
1182-line script.

**Exit:** every panel-needed flow (interview, author, person-path run, replay, spine read,
gate-audit read) is a library function in `src/` with a `bareloop` CLI command over it; full
suite green; the old `scripts/*.mjs` entry points still work, now calling through the new
library seam instead of holding the logic themselves.

**Delivered (P0 COMPLETE, this branch, 8 commits):** `src/interviewrun.js`,
`src/authorrun.js`, `src/userrun.js` (one engine, three doors: `startRun`/`resumeRun`/
`answerDoor`), and `src/replayio.js` hold the lifted logic; `bareloop interview`/`author`/
`run-u`/`replay` are wired in `src/cli.js`; `scripts/run-interview.mjs`, `scripts/
run-author.mjs`, and `scripts/run-u.mjs` are now thin ~20-line adapters (down from 764/1182/
1992 lines respectively); spine and gate-audit reads go through `src/replayio.js`'s
`parseJsonl`/`readHistoryLog`/`replayOne` rather than a per-caller hand-rolled parse — including
`doRun`'s own job-end tail read, retargeted onto `parseJsonl` the same session (see §3's read-side
row). The run-author ending-owner consolidation (§4's "also folds in" note above) is delivered
too: `src/authorrun.js` has zero real `process.exit()` calls left (verified by grep) — every
ending now throws one `ExitSignal(n)`, caught once at the bottom of `main`; the 7 `author-end`
emit sites are unchanged in place (a behaviour-preserving lift, not a re-architecture of WHEN each
fires). §3's gap table above was re-verified against this delivered state on 2026-09-24. See §7
for what P0 did NOT close (the step-title wrap fixture, F192 — both explicitly out of P0's scope).

### P1 — read-only panel

A `node:http` server (`node:http` only — no new dependency; the one-production-dependency bar
from `LIBRARY_CONVENTIONS.md` already spends its one slot on `bare-agent`), default port
**4700**, bound to `127.0.0.1` only. Serves the mockup's History, Run, Audit, and Job tabs from
REAL archived spine records (via the P0 read functions) — no fabricated/sample data. Nothing on
this rung can spend a cent: no interview, no author, no run trigger, no key ever read.

**Port 4700, checked this session:** `/etc/services` on this machine lists `4700` as
`netxms-agent` (NetXMS monitoring agent, TCP+UDP) — not one of the commonly-collided dev ports
(3000, 5000, 5173, 8000, 8080, 8888, 9000 are all in heavier everyday use); `ss -ltn` showed no
live listener on 4700 on this machine at check time. Reasonable default; not guaranteed
collision-free on every machine, so the server should still fail loudly (not silently pick
another port) if 4700 is taken.

**Exit:** a real past run renders end to end in the panel, matching the mockup's exact wording
and glyphs (`design/panel-mockup.html` — see §6 below for what "matching" means).

**Rulings 2026-09-24 (this session, before the HTTP server itself):**

- **Option B: "one home" for runs, not a move.** hamr: *"B, i need one home for them
  anyways."* A run LIST at `~/.config/bareloop/runs.jsonl` (the same directory the keys file
  lives in, PRD §7d) — one row per run, `{ at, runid, job, spine, patient, via }`. Patient
  copies are NEVER moved (they stay at `bareloop-patients/…` for run-u, or
  `<bundleDir>/runs/<runid>/` for `bareloop run`); the list only points at them.
- **Jobs stay in `jobs/` for now.** hamr picked "A" — moving job specs into the home directory
  too is deferred to P3, not built here.
- **hamr's "OK"** ("commit, and p1") signed this sub-spec.

**Delivered against that spec (this session):** `src/runlist.js` — `appendRun`/`readRunList`
(idempotent by runid), `backfillRuns` (scans a directory and its immediate subdirectories for
both the free-standing spine layout and the bundle layout
`<x>/runs/<runid>/spine.jsonl`, reusing `src/replayio.js`'s `parseJsonl`/`isSidecarByName`/
`looksLikeSpine`, never a second parser), and `formatRunRow` (`file missing` when a listed
spine no longer exists on disk). Wired to append one row at run START, BEFORE the first paid
call, in exactly two callers: `src/userrun.js` (`run-u`) and `src/cli.js`'s `doRun`
(`bareloop run`, bundle path) — interview/author sessions are NOT added (deferred to P3, no
run to list yet at that stage). A list-append failure is caught at both call sites and printed
loudly to stderr; the run itself continues (hamr's rule: a panel list must never block real
work). New CLI surface: `bareloop runs` (print the list) and `bareloop runs backfill <dir>`
(reconstruct rows from spines already archived on disk, idempotent). No new production
dependency, no new env var (grepped for an existing HOME-override convention first — none
exists; `home` is an injectable test-seam param instead, the same shape `deps.provider` already
is elsewhere).

### P2 — live run view

2-second polling (hamr: *"2s sounds good, no rush in publish progress, 2s sounds enough if map
will update, and panel is well connected"* — not SSE). The step map, step cards, counters line,
and the always-visible summary box update on each poll while a run is live.

**Exit:** a real live run is watched start to finish in the panel.

### P3 — chat / authoring

Left pane: review round message, job card, chat thread, `[Send] [Sign & run] [Revise]` (per
the settled job-card field order and button set, §6). This is where P0's `bareloop interview`
and `bareloop author` commands get an HTTP face — the chat turns hamr's replies into the same
library calls the CLI's interactive flow already makes; it adds no authoring logic that isn't
already in `src/`.

**Exit:** a job is authored and signed from the page alone, end to end.

### P4 — Settings

Providers table (name, API shape, base URL, key variable, test, tokens used, balance, price,
edit/remove) and Money & Limits tab (total spent, this month, monthly $ limit, monthly time
limit, per-provider breakdown), per the 2026-09-22 stash's Settings decisions.

**Exit:** per the 2026-09-22 stash's Settings decisions (Ollama re-admitted with an estimated
price shown, never $0; keys file wired per §5 below).

## 5. The arbiter's hard lines inside the panel

Not negotiable, and not re-litigated by any panel code:

- **The chat can never press Sign & run, accept, or raise a cap.** Only hamr's own click signs
  — the mockup's own note says it (*"Only your click signs. The chat can't."*). The panel's
  HTTP server must REFUSE a sign/accept/cap-raise request that did not originate from a human
  click in the page (no chat-driven, no scripted, no replay-triggered signature).
- **Merge stays human.** Nothing in the panel merges; `bareloop run`'s own tail already prints
  `merge stays human — this CLI never merges`, and the panel adds no path around that.
- **Keys never appear in the page.** The panel shows provider names and found/not-set only,
  read server-side from `~/.config/bareloop/.env` (chmod 600 warning shown in Settings) — see
  §7d of the PRD addendum for the full shape.
- **The panel is a client of the arbiter, never a second arbiter.** Every budget check, verdict,
  and signature still happens inside the library (`checkEnvelope`, `checkApproval`, `bless`,
  etc.) exactly as it does for the CLI today; the panel calls those functions, it does not
  reimplement or bypass any of them.

## 6. Settled UI rulings carried in

`design/panel-mockup.html` is the visual contract — read it rather than this section
restating pixels. The rulings that constrain the real build (not just the mockup):

- **Wording ruling:** check type shown as `Check type` with value `deterministic` (internal
  hard green) or `rubric` (internal soft green); a run's result is shown ONLY as a glyph —
  `[✓]` passed, `[✗]` failed, `[▶]` running, `[·]` waiting, `[?]` died (no result) — never the
  words green/red/soft-green anywhere in the page. (Saved to auto-memory `ui-verdict-words.md`.)
  2026-09-25, hamr: B — died is not failed; a run with no verdict never shares the failed
  glyph. `[?]` is a run whose spine carries no `job-end` at all (killed, crashed, or the
  machine slept) — distinct from `[✗]`, which stays reserved for a run whose close/arbiter
  actually rendered a "no" (a real result).
- **Run ID format and placement:** `workflow-name (mu2p83go)` — bracketed after the workflow
  name — shown on the run's summary line 1 and in every History row. (Closes the open question
  from the 2026-09-22 stash.)
- **Tagline:** `bareloop · automate a job, verified · @127.0.0.1:4700` — "verified" is fixed
  title text (bareloop's own close decides done), never changes per workflow.
- **Job card field order:** Check type, Model, Job name (unique), Goal, Source, Destination,
  Success, Guardrails, Judge examples (rubric only), then `$ cap | Time cap | Token price` in
  one row.
- **Row shape:** Workflows and History rows are 3 lines — glyph+name / `deterministic · $0.66 ·
  4m 02s · 2026-09-20` / buttons. Left pane 420px.
- **The one step-map renderer:** a single SVG map for every run — snake wrap (row 1 L→R, arrow
  down, row 2 R→L, …), stretched to fill the pane's full width (`boxW = (usableW -
  (perRow-1)*gap) / perRow`), one font size, never squeezed text to fit. There is no second,
  simplified map renderer anywhere in the panel.
- **Three right-pane tabs, verified in the mockup:** `Run` (`#tab-run`), `Audit / logs`
  (`#tab-audit`), `Job` (`#tab-details`, labelled "Job"). Three left-pane tabs: `Chat`,
  `Workflows`, `History`. (superseded — see Addendum 2026-09-26)

## 7. Known gaps the real build must close

From both mockup-feedback stashes, carried forward, not fixed by the mockup itself:

- The mockup's port (4700) is a hardcoded fake in the HTML/JS; the real build wires the actual
  server port (P1).
- The `>1`-line step-title wrap path is UNPROVEN — no fixture title in the mockup is long
  enough to force a second line. Needs a real long-title fixture before P1 is called done.
- F192 (soft-green calibration refused on every live run so far, `docs/logs/FINDINGS.md`) is
  still OPEN — the panel shows this honestly (no papering over a refused calibration), it does
  not fix it. Reopens after the panel per hamr's ruling B (2026-09-21).
- `scripts/run-author.mjs`'s ending-owner cleanup (6 `process.exit()` calls, 7 `author-end`
  writes — re-verified this session, see P0) folds naturally into P0's move into `src/`.
- Phone/LAN access is parked — `127.0.0.1` only; a phone cannot reach it (noted, not built).

## 8. Not in scope

- M3b–M7 (language guards, non-code checks, the judge, web search, the proof fires) — come
  after the panel, per the 2026-09-21 order amendment (PRD.md, item 33's build-order section).
- LAN access.
- Anything that changes a budget, a verdict, or merge behaviour — those stay arbiter territory,
  outside what any panel rung may touch (§5 above).

## Addendum 2026-09-26 — P1 panel redesign (hamr's live-review rulings)

This is a dated addendum, not a rewrite — §6's "Three left-pane tabs: Chat, Workflows,
History" and its Row-shape ruling are prose from the ORIGINAL mockup contract and are left
untouched above; the following ships instead, decided during P1's live click-to-annotate
review rounds:

- **Workflows and History merged into one `Runs` tab**, with a toggle between "Workflows"
  view (grouped by job, default) and "History" view (flat, newest-first) — never two separate
  left-pane tabs. `/api/workflows` and its client-side `listWorkflows` were deleted; both views
  are now built from the one `/api/runs` list.
- **Run tab: map + two-line part cards.** A PLAN-shape run renders one card per PART (scout,
  plan, each step, each replan, the post-step fix loop, the judge stage where recorded) — never
  one card per step only. An old-shape (iterations, no step-start) run collapses to a single
  "run" box, same as before. Clicking a part's map box OR its card jumps to the Audit tab,
  pre-filtered/scrolled to that part.
- **Audit tab: Grouped + Flat toggle.** "Grouped" (the default) nests rows as part → attempt →
  a rounds table (lazy-fetched per attempt via `/api/runs/:runid/rounds`); "Flat" is the old
  single ungrouped row list. Three filter chips — All / Writes / Blocked — auto-open every
  matching group so a filtered result is never hidden behind a collapsed toggle.
- **Short paths** (`pathShort`, relative to the run's own resolved tree root) apply only to
  runs recorded under this new layout; an older archived run with no resolvable tree root keeps
  showing the absolute path, honestly, rather than a guessed shortening.
- **Run Summary box** gained a `model` line (provider in parens when recorded, e.g. `deepseek-
  flash (openai-api)`) and a `judge:` line when a judge-round was recorded on the spine.
- **"offered" line** (Job tab) shows the FULL granted-tools list from the spec, never a
  top-N-truncated version.

Build item (2026-09-26, this branch, `feat/panel-p1`) additionally fixed two panel-only bugs
found during this same review pass: the Audit tab's "Raw log" leaking an EARLIER unrelated
run's rows when a gate-audit sidecar is shared across runs (now windowed to this run's own
ts range, same rule as the parsed `rows`), and a `~2`-backfill-collision run's header/lookups
echoing the wrong (unsuffixed) runid.
