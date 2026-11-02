---
type: reference
title: "bareloop exchange — what fwdloop gives, what we take"
status: draft
sources: [CHANGELOG.md, docs/wiki/the-module-ladder.md, docs/logs/FINDINGS.md]
---

# bareloop exchange

Written 2026-11-02 from fwdloop `chore/fix-ledger` (tag `v0.28.0` = 1138f32). bareloop was checked at
v0.52.0 (CHANGELOG head, `../bareloop/src`, read-only). Nothing on this page is signed text. Ladder
headings are pointers, not quotes.

- fwdloop gives bareloop everything built since the last sync that bareloop lacks: tickets through
  MCP (M12, v0.27.0) and the one setup for outside sources (M13 and am1-am5, v0.28.0).
- It is split into 11 pieces in the order we delivered them. Each piece can land alone after the ones
  it depends on.
- Copy from tag `v0.28.0`, not from a branch. Header: `// borrowed-from: fwdloop <path>@<commit>`.
  Never import fwdloop code.
- bareloop has no MCP and no tickets (grep of `src/` finds `mcp` only in a comment in `planrun.js`).
  It already has an online dot and time/file schedules.
- Part 2 lists five small fixes worth taking on their own. Part 3 is for what we take back.

Not given: came from bareloop (M4d am36 Audit check grid, the Providers page changes).

## Piece table

| # | Piece | Release | Depends on | bareloop has it? |
|---|-------|---------|------------|------------------|
| 1 | MCP source in the job + ticket reader | v0.27.0 | bare-agent bridge | no |
| 2 | Ticket filter + `skipped` outcome | v0.27.0 | 1 | no |
| 3 | Ticket look + schedule (15 min, baseline, watch) | v0.27.0 | 1, 2 | schedules yes, tickets no |
| 4 | Ticket Result list + Run it anyway (as first built) | v0.27.0 | 2, 3 | no |
| 5 | Online dot (M4d am35) | v0.27.0 | none | yes, skip |
| 6 | MCP passEnv + steps call signed MCP tools | v0.28.0 | 1 | no |
| 7 | Settings > MCP tab (sources, check tools, use counts) | v0.28.0 | 6 | no (has Settings page) |
| 8 | Flow type + MCP pick on the New job card (+ am2, am4) | v0.28.0 | 6, 7 | no |
| 9 | Schedule on the card, waits for green (+ am3) | v0.28.0 | 3, 8 | similar (schedule needs a green) |
| 10 | Result grid (replaces piece 4's list) | v0.28.0 | 2, 3, 8 | no |
| 11 | Ticket fixes 9.x + required marks (am5) + caption looks | v0.28.0 | 3, 8, 10 | partly unchecked |

Order note: piece 4 is superseded by piece 10 (the list becomes the grid, the `ticket #` box is
removed). If bareloop takes tickets at all, taking 1-3, 6-11 and skipping 4 is likely cleaner. That is
bareloop's call. Unchecked: whether 10 still lands cleanly without 4.

Versions: fwdloop runs bare-agent `^0.57.0` (`passEnv` needs 0.56+); bareloop pins `^0.55.0`,
bareguard `^0.27.0`. Piece 6 needs the bare-agent bump. bareguard `carriesAny` is NOT used yet
(keyword filters are a later slice). Both repos' run models differ (fwdloop: flow dir with `run-N`,
signed job file, arbiter block; bareloop: bundles, specs, work folders). Every "adapt" below means
mapping to that. Unchecked in detail.

## Part 1 - pieces

### Piece 1 - MCP source in the job + ticket reader (M12 p1)

- Source: ladder `## M12 - outside tools through MCP, and tickets that start a run`, the restart block
  (M12 scope (restart)); POC F100, F101, F105. Release v0.27.0.
- Commits: afc2bea (typed MCP tools in the declaration, preflight refuses an unused tool), 1d16e27
  (ticket reader through the job's MCP tools, frozen as an input), da3c061 (typecheck), 77c5fe7 (live
  check).
- Does: a job declares `mcp: {server, tools}`; a step lists `mcpTools`. Only those tools exist for the
  run. A declared tool no step uses is refused at preflight. A ticket list in Inputs
  (`issues: <url>`) is read through the MCP and frozen as an input. A ticket is data, never
  instructions. A missing tool or server refuses at $0 by name.
- Code: `src/ticket-mcp.js` (`readTicketMcp`, `configForServer`, `startRefusal`, `remoteRefusal`,
  `isDeviceLogin`), `src/declaration.js` (mcp block parse/validate), `src/canrun.js` (preflight),
  `src/runner.js` (freeze), `src/signed-text.js`, `src/types.js`.
- UI: none in this piece.
- Tests: `test/m12-p1-declaration.test.js`, `m12-p1-reader.test.js`, `m12-p1-run.test.js`,
  `m12-p1-ticket.test.js`, `test/fixtures/fake-mcp-server.mjs`.
- POCs: F100 (frozen MCP ticket end to end), F101 (missing tool/server refuses at $0), F102 (ticket
  cannot instruct), F105 (unwired tool refused), F92-F98 (earlier page-based work), `poc/mcp/m12p1/`.
- Fits as: adapt. bareloop's job/spec shape and preflight differ; `ticket-mcp.js` is mostly pure.
  Pieces older than the restart (F88-F90, M12 am1/am3 first try) were withdrawn; do not copy those.
- Depends on: bare-agent MCP bridge (`bare-agent/mcp`).

### Piece 2 - Ticket filter + `skipped` outcome (M12 p3 core)

- Source: same M12 restart block. POC F93, F95, F96, F97, F98, F99. v0.27.0.
- Commits: 3b54ba7 (label filters decided by code), e39f0b3 (`ticketFilter {priority, labels}` valid
  only with mcp), c56fcdf (skipped outcome), d1585fe (drafter told the ticket role exists), b778d0e
  (skipped is grey, not a refused start; CLI exits 0).
- Does: code, not the model, decides RUN or SKIP from label fields. Priority reads `P0`-`P3`. An
  unsure label (other scale) is carried, not skipped. A skipped ticket (no match, or closed) ends
  `skipped` at $0 with a reason, books balanced, no learnings note.
- Code: `src/ticket-labels.js` (`priorityOf`, `readTicketFields`, `filterUnsure`, `decideTicket`),
  `src/ticket-draft.js` (`ticketFactsLines`, `ticketSchemaParts`, `ticketReds`), `src/declaration.js`,
  `src/drafter.js`, `src/runner.js` (skip path), `src/learnstore.js` (no note on skip),
  `bin/fwdloop` (`skipped:` line, exit 0), `src/summary-words.js`.
- UI: grey `[-]` skipped ending (`src/panel/data.js` glyph map, `src/panel/index.html`).
- Tests: `test/m12-p3-labels.test.js`, `m12-p3-declaration.test.js`, `m12-p3-drafter.test.js`,
  `m12-p3-skipped.test.js`, `m12-p3-readout.test.js`.
- POCs: F93, F95, F96, F97, F98; F99 re-runs on bareguard `carriesAny` (not used in the build).
- Fits as: adapt. bareloop's green/softgreen/red model needs a new grey end state; check its ledger
  and books for a "skipped" row. Unchecked how bareloop's outcome enum would take it.
- Depends on: piece 1.

### Piece 3 - Ticket look + schedule (M12 p2)

- Source: M12 restart block, trigger items; POC F103, F104, F94b. v0.27.0.
- Commits: 8e34dff (look: newest-first cursor walk, watched fields, unreadable never "0 new"),
  fcec05d (scheduler: 15-min look, baseline, queue copied from M9, watched change arrives once),
  fe466a7 (When choice, door fills the look, run starts with `--ticket N`), bc69607 (signed
  `ticketWatch`), 2565b63 (import-free `ticket-shape.js`).
- Does: a schedule "When a new ticket arrives" looks every 15 minutes at $0, newest first, stops at a
  seen number. Tickets on the list at signing are the baseline and never run. Each new ticket queues
  one run, oldest first. A watched field (`state`, `labels`) change starts exactly one more run.
- Code: `src/trigger-tickets.js` (`lookTickets`, `watchedOf`, `reasonFor`, `seenNumbers`, `lastSeen`,
  `hasBaseline`, `recordLook`, `recordAnyway`), `src/ticket-shape.js` (`parseTicketList`,
  `ticketListsOf`, `WATCHABLE`), `src/trigger-line.js`, `src/trigger-files.js`, `src/schedule.js`,
  `src/panel/scheduler.js`, `src/panel/authortrigger.js`, `src/panel/authorstart.js`.
- UI: Run card When dropdown option `When a new ticket arrives in <input name>`
  (`src/panel/index.html`).
- Tests: `test/m12-p2-look.test.js`, `m12-p2-scheduler.test.js`, `m12-p2-door.test.js`,
  `m12-p2-ui.test.js`, `m12-p2-world.mjs`.
- POCs: F103, F104, `poc/mcp/m12p2/live.mjs` (two real looks on microsoft/vscode, $0).
- Fits as: bareloop already has time/file schedules (`src/trigger*.js`, `src/schedulewords.js`,
  `src/panel/schedules.js`). The queue is copied from M9 files, which came from the same family. Adapt:
  add a `new-ticket` trigger kind beside `new-file`. Unchecked how close the ledger rows are.
- Depends on: pieces 1, 2.

### Piece 4 - Ticket Result list + Run it anyway, as first built (M12 p3 UI)

- Source: M12 restart block, Result items; hamr ruling A on the reason box. v0.27.0.
- Commits: 1188dfc (list data), 8b2b1da (`POST /api/author/ticket-anyway`), d5e9159 (list in Result,
  checked at 1280/390/320), fad1cd6 (by-hand Run takes a ticket # box), b990593 (Run it anyway wired),
  585cf23 (reason box copies the rerun box), 04993d1 (Sign & run takes the ticket #), 8ee7f89 (draft
  readout shows MCP, filter, watch, step tools), 9abd8d3 (run refused at $0 takes back its folder).
- Does: one ticket list (Needs you / Stopped / Passed / Skipped), newest first, filter chips, search.
  A skipped ticket has Run it anyway; it asks for a reason; the run is never skipped again for labels or
  closed.
- Code: `src/panel/tickets.js` (`ticketListOf`, `ticketAnyway`, `arriveAnywayOf`, `TICKET_GROUPS`),
  `src/panel/server.js`, `src/panel/data.js`, `src/panel/authorflows.js`.
- UI: Result tab list in `src/panel/index.html`; reason box copies the rerun box.
- Tests: `test/m12-p3-ticketlist.test.js`, `m12-p3-result-api.test.js`, `m12-p3-anyway-queue.test.js`,
  `m12-p3-anyway-run.test.js`, `m12-p3-run-door.test.js`, `m12-p3-signrun.test.js`,
  `m12-p3-panel.test.js`.
- POCs: F104; walk evidence on hamr0/hol-guard (see ladder M12 exit note).
- Fits as: adapt; bareloop's Result/Ended page differs. Piece 10 replaces the list and the `ticket #`
  box was removed in v0.28.0. Consider skipping this piece.
- Depends on: 2, 3.

### Piece 5 - Online dot (M4d am35)

- Source: ladder "M4d amendment 35" (signed 2026-10-28). v0.27.0. Commits cfab02e, a8765ee.
- Does: green `online` / red `offline` beside Settings, fed by the existing Inbox poll.
- Code/UI: `src/panel/index.html` only. Tests: `test/m4d-am35.test.js`. POC: F91.
- Fits as: bareloop already has it. `#online-dot` with `data-testid="online-dot"` is in its
  `src/panel/index.html`. Nothing to give. Unchecked: whether wording matches (fwdloop: dot left of
  Settings; HTTP error counts as online).
- Depends on: none.

### Piece 6 - MCP passEnv + steps call the signed MCP tools (M13 p1-p2)

- Source: ladder `## M13 - one setup for outside sources`, items 5 and 9.5. v0.28.0. POC F108, F109,
  F111, F111b, F115, F116, F118.
- Commits: 44f0e2a (bare-agent ^0.56.0, MCPs start with passEnv `PATH`+`HOME` only), 81cf69c (step Gate
  allowlist, one gated entry per signed MCP tool, plain refusal wording), f19f273 (a step starts its
  bridge once, closes after the last try), 00965ed (`bin/fwdloop` builds primitives with the job's
  signed MCP tools for run, resume, continue), b4c946b (tests build primitives like bin/fwdloop).
- Does: MCP servers never get provider keys. A model step may call only the tools the job signed;
  any other tool is refused by name at $0.
- Code: `src/primitives.js` (`stepMcp`, `mcpToolName`, `resolvePrimitives`), `src/ticket-mcp.js`
  (`MCP_PASS_ENV`, `mcpStartOpts`), `src/runner.js` (bridge once per step), `bin/fwdloop`.
- UI: none.
- Tests: `test/m13-p1-mcp-env.test.js`, `m13-p2-step-tools.test.js`,
  `test/fixtures/env-names-mcp-server.mjs`.
- POCs: F109 (env an MCP gets), F111/F111b (passEnv), F115, F116 (paid, real step calls a bridge tool).
- Fits as: adapt. bareloop's tool gate is bareguard-based too; map to its step runner. Needs bare-agent
  `^0.57.0`.
- Depends on: piece 1.

### Piece 7 - Settings > MCP tab (M13 p3)

- Source: M13 item 2. v0.28.0. POC F108, F112, F113.
- Commits: d2f2458 (one place decides MCP sources), 105f81a (routes, press-only check, append-only
  log, use counts), d539c52 (the tab as the signed mock), e24ec66 (check log in its own module),
  bf574d7 (shadowed MCP "same name as above, not used"), d453892 (never-checked MCP shows the primary
  look), 6cdc01e (status `not-json`, not "unreadable").
- Does: lists MCPs from the 4 bare-agent places plus added paths (first name wins). `check tools`
  (press only) lists tools with hints (info only) into `mcp-checks.jsonl`. Each tool shows how many
  runs used it. Never edits the user's config; never shows a command or key. Remote MCP is listed but
  not usable.
- Code: `src/mcp-sources.js` (`mcpSources`, `mcpConfigFor`, `startableMcpServers`, `showMcpPath`),
  `src/mcp-checks.js` (`appendMcpCheck`, `newestMcpChecks`, `newestOkMcpTools`), `src/mcp-use.js`
  (`countMcpUse`), `src/config.js` (`mcpPaths`), `src/panel/settings.js`, `src/panel/server.js`
  (doors `mcp-check`, `mcp-path`, `mcp-path-remove`).
- UI: Settings > MCP tab in `src/panel/index.html`; reuses `.pv-key`/`.pv-krow`/`.pv-mrow`; button
  `check tools`, `+ add a path`; caption words above.
- Tests: `test/m13-p3-mcp-settings.test.js`, `m13-real-door.test.js`; guards `f48-guard-fs-imports`,
  `panel.test.js` POST inventory.
- POCs: F108, F112, F113.
- Fits as: adapt. bareloop has `src/panel/settingsroutes.js` and its own Settings page; add the tab
  there. fwdloop copied the Providers layout from bareloop, so the markup should match.
- Depends on: piece 6 (same MCP starter).

### Piece 8 - Flow type + MCP pick on the New job card (M13 p4, am2, am4)

- Source: M13 item 4, am2, am4. v0.28.0. POC F105 (rewritten), F119, F123, F125.
- Commits: 28a28ee (`flowType` plain|mcp|tickets as a signed field), b82d44b (`findMcpPlanRed`), 13be64d
  (`mcpPickFor`: the MCP's newest checked tool list, set by code), 990d267 (drafter told flow type and
  tool names), 51bf460 (`--flow-type`, `--mcp` on draft), e275832 (card UI), 1a38545 (readout),
  ac85780 (am2 names `plain`, `MCP`, `Tickets MCP`), df6cc3e (am4: Reuse shows and changes Flow type/MCP;
  a change drafts anew; Job tab shows MCP details).
- Does: `Flow type` dropdown and `MCP` pick are signed with the job. An MCP job gets every tool of the
  newest check; a never-checked MCP is refused ("press check tools in Settings > MCP first"). A changed
  flow type or MCP is a changed job, so a new workflow.
- Code: `src/mcp-pick.js` (`mcpPickFor`, `NEVER_CHECKED_SAY`), `src/declaration.js` (`flowTypeOf`),
  `src/canrun.js`, `src/authoring.js`, `src/drafter.js`, `src/ticket-draft.js` (`mcpFactsLines`),
  `src/ticket-next.js` (`newestUnrunTicket`), `src/panel/authorcard.js`, `authorflows.js`, `author.js`,
  `bin/fwdloop` (`--flow-type`, `--mcp`).
- UI: New job card controls (Flow type select, MCP select), draft readout flow-type row, Reuse
  fields, Job tab MCP details. Ids/testids are in `src/panel/index.html`; list them with
  `grep -n "flow-type\|jf-mcp" src/panel/index.html` (unchecked exact names).
- Tests: `test/m13-p4-card.test.js`, `m13-p4-draft-cli.test.js`, `m13-p4-flowtype.test.js`,
  `m13-p4-next-ticket.test.js`, `m13-p4-pick.test.js`, `m13-p4-ui.test.js`, `m13-am2-result-tab.test.js`,
  `m13-am4.test.js`.
- POCs: F119, F123, F125 (failed on the letter, then built on hamr's word).
- Fits as: adapt. bareloop's New job and Reuse flow differ; its jobs are specs, so `flowType` is a new
  signed spec field (hash ignores or includes it: bareloop's call).
- Depends on: pieces 6, 7. Piece 3 for the `tickets` type.

### Piece 9 - Schedule on the card, waits for green (M13 p5, am3)

- Source: M13 item 7, am3. v0.28.0. POC F114, F120, F124.
- Commits: 7d7a691 (card schedule checked at $0, sign writes `schedule.json` off; `firstGreenRunFor`,
  `armWaiting`), 00ff948 (scheduler turns it on after the first green run; ticket baseline stops at
  the ticket the first run read), 239cb61 (Schedule row on the card), d5e4944 (am3: Run it anyway
  starts at once while the schedule is off).
- Does: a schedule is signed with the job, off until the first green run, then on. The Run card reads
  `Schedule waiting for a green run`. A ticket schedule's baseline ends at the ticket the first run
  read, so a ticket that arrived during the wait still runs.
- Code: `src/trigger-clock.js` (`armTrigger`, `validateSchedule`), `src/trigger-tickets.js`,
  `src/panel/scheduler.js`, `src/panel/authortrigger.js`, `src/panel/data.js`, `src/summary-words.js`.
- UI: Schedule row on the New job card (options follow flow type, time box, hints); Run tab grey line.
- Tests: `test/m13-p5-card.test.js`, `m13-p5-turnon.test.js`, `m13-p5-ui.test.js`,
  `m13-p5-real-door.test.js`, `m13-am3-anyway-now.test.js`, `m13-p5-world.mjs`.
- POCs: F114 (arm hook, starting point), F120, F124.
- Fits as: bareloop already has similar. Its `schedule-prepare`/`schedule` doors need a real green run
  of the job before a schedule (CHANGELOG, "A job can be scheduled from the panel"). Difference:
  fwdloop signs the schedule at job creation, off, and arms it after the first green. Adapt.
- Depends on: pieces 3, 8.

### Piece 10 - Result grid (M13 p6, am2 part 2)

- Source: M13 item 8, am2. v0.28.0. POC F123.
- Commits: 81f04ab (grid on the server, `GET /api/runs/:flow/:runId/grid`), 7d15791 (Result tab draws
  it; replaces piece 4's list), 25bb00f, bf05c11 (row reads `#<n> - <title>`; name opens the run),
  f2781cc (`output judged` reads `none`), 899e9e8 (Run it anyway is one button that swaps for the
  reason box), a7ded63 (prefix `tg`).
- Does: one grid, fold rows Needs you / Stopped / Passed / Skipped, newest first, stats line, one cell
  per check. Per am2 the grid is for Tickets MCP jobs only; plain and MCP jobs keep their old Result.
- Code: `src/panel/jobgrid.js` (`bucketOf`, `moneyWords`), `src/panel/tickets.js`, `src/panel/data.js`
  (`getJobGrid`), `src/panel/server.js`.
- UI: Result tab grid in `src/panel/index.html` (prefix `tg-`); copies the Audit check-grid look, which
  bareloop already owns (`feat/audit-grid`).
- Tests: `test/m13-p6-grid.test.js`, `m13-p6-page.test.js`, `m13-p6-title.test.js`,
  `m10-am4-result-page.test.js`, `m10-am4-result-walk.test.js`.
- POCs: F123.
- Fits as: adapt. Reuses bareloop's own grid CSS/markup, so the look should drop in. Unchecked.
- Depends on: pieces 2, 3, 8.

### Piece 11 - Ticket fixes 9.x, required marks (am5), caption looks

- Source: M13 items 9, 9b; am5. v0.28.0, plus one commit after the release on this branch. POC F121,
  F122, F126.
- Ticket fixes (commits): 28c7bbd (9.2 new only above the highest seen), f25a3bd (9.6 numeric id
  compare), 2be30d4 (9.3 failed ledger write is a refusal, panel stays up), c89352e (9.1 rerun re-reads
  through the MCP, keeps the mark), 30b3dcc (hints are info, read-only refusal dropped), 96f10d6
  (9b.3 look that could not read shows one red line), 7a98141 (9b.2 failed-preflight Reuse is Run
  now), 9650320 (9.7 ticket number cap, 10 digits, `TICKET_MAX`), 83b6d02 (9.4 unsure never skips,
  grey mark), 47a774b (9b.4 `ticketFilter` line required when a guardrail names a priority or label),
  e89196e (F122 ticket facts say reading needs `read`).
- am5: 0229765 (grey `required` on Flow name, The job, Inputs, Cap $; the button waits; Inputs optional
  for MCP). Test `test/m13-am5.test.js`.
- Looks (all `src/panel/index.html`): aea2e1d, 5bd929a, 9d3690c (section captions as colour bars with a
  count pill), 7d251eb (Chat card captions 14px bold, blue left mark), c4201a9, d71846c (Ask wait caption
  matches), 3b37e1b (tab rows lose `[n]`), 112f702 (this branch: caption text uses `--accent`; test
  `test/m13-chat-captions.test.js`). Element ids to match: `#chat-job-card .field > label`,
  `.cap-field > label`, `.jf-waitrow > label`.
- Tests: `test/m13-p7-fixes.test.js`, `m13-p7-look-card.test.js`, `m13-p7-reuse.test.js`,
  `m13-p7-unsure-cap.test.js`.
- Fits as: ticket fixes only matter if pieces 3 and 10 land. am5 and the caption looks are
  independent of tickets: bareloop's card may take them as-is. Unchecked whether bareloop's cards already
  look like this.
- Depends on: 3, 8, 10 (fixes); none (looks).

## Part 2 - fixes worth taking on their own

None needs MCP or tickets. Copy from tag `v0.28.0`.

1. MCP servers start with `PATH` and `HOME` only. `src/ticket-mcp.js` (`MCP_PASS_ENV`, `mcpStartOpts`)
   and `src/trigger-tickets.js`, commit 44f0e2a; test `test/m13-p1-mcp-env.test.js`. Needs bare-agent
   `^0.56.0`. Only relevant if bareloop starts MCP servers.
2. `fwdloop update` starts npm without any `*_KEY` from the shell. `src/launcher.js`, commit f6f2a7c
   (M13 am1; F110); tests `test/m13-p1-npm-env.test.js`, `launcher-update.test.js`. bareloop's
   `src/npminstall.js` and `launcher.js` may have the same leak. Unchecked.
3. A run the child refuses at $0 takes back the run folder the panel claimed, so no empty `run-1` husk
   is left. `bin/fwdloop`, commit 9abd8d3 (the exit cleanup is registered at the first line that can
   refuse). bareloop's equivalent is unchecked.
4. The drafter's `log.json` keeps each try's raw answer (args as parsed, `rawArguments` or `rawText`
   when unusable). `src/drafter.js`, commit cfe2499; test `test/drafter.test.js`. A failed draft with no
   saved raw answer is a gap.
5. Test isolation: panel tests point the panel's own `HOME` at the fixture, because `w.env.HOME` alone
   left in-process MCP discovery reading the real home (red on CI). Commit d814449,
   `test/m4e-world.mjs` (`useHome`), `m12-p3-signrun.test.js`, `m13-p5-card.test.js`. Needed only
   with piece 7.

## Part 3 - What we take

Empty on purpose. bareloop sends memory and planner fixes; we take only what fits our goals, copied
from their release tag with `// borrowed-from: bareloop <path>@<commit>`. Each row below is filled
when we decide.

| bareloop release | Fix | Decision (take / skip / later) | Why | Our commit |
|------------------|-----|--------------------------------|-----|------------|
| | | | | |

## Unchecked on this page

- Whether piece 10 lands without piece 4.
- Exact element ids of the New job card controls (piece 8).
- Whether bareloop already has the colour-bar captions, npm env cut, or run-folder husk fix.
- Whether bareloop's outcome model can take a `skipped` end state.
- No test was run for this page. Release mapping comes from `CHANGELOG.md`, tags `v0.27.0` and
  `v0.28.0`, and commit subjects.
