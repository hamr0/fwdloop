# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.26.2] - 2026-10-28

M4b amendment 9 (update wording), M10 amendment 13 (an error page is never a job's input), and a
borrowed bareloop fix for typed look-ask readings. The MCP and tickets POCs (F85–F90c) are recorded in
`docs/logs/FINDINGS.md`; they change nothing for users.

### Changed
- `fwdloop update` now ends `Updated to <version>. Then run fwdloop restart.` The `6 update` menu pick
  still says `Then pick 3 restart.`
- barebrowse `^0.26.0` is now the minimum for a web page input (its `goto()` reports the HTTP status). An
  older barebrowse refuses every page read, by name. bare-agent is now `^0.54.1`.

### Fixed
- A page input that answers with a non-2xx status, or gives no HTTP status at all, is refused at $0
  before any reading, naming the page and the status (M10 am13).
- A typed look-ask reading that starts with `yes,` or `agree:` has that lead dropped before it becomes
  the signed rule (copied from bareloop F240, v0.49.0).

## [0.26.1] - 2026-10-26

M4b amendment 8: the launcher can check for a newer fwdloop.

### Added
- `6 update` in the `fwdloop` menu, and `fwdloop update`. Only when pressed, it asks the npm registry
  for the latest version (5-second deadline). Nothing goes online at start, in the panel, or in the
  background.
- When a newer version is out it asks `Update now? (y/n)`; `y` runs `npm install -g fwdloop@latest`
  and says to pick `3 restart`. With no terminal it never installs, it prints the command.

### Changed
- `5 install` with nothing to do now says `Already set up. This does not update fwdloop. Pick 6 update for that.`

## [0.26.0] - 2026-10-26

M4b amendment 7 (all jobs live in one folder), barebrowse 0.24.1, honest spend rows, a scheduled-run
fix, and the M10b exit (sheet checks through bareguard; the aging job is green on deepseek-flash).

### Changed
- With no `--root`, every command uses `~/.config/fwdloop/flows`, never the current folder. The folder
  is made if it is missing, even by `status`. `--root <folder>` still overrides it. `run`, `resume`,
  `continue`, `draft` and `learn seed` no longer require `--root`.
- Upgrade note: jobs kept anywhere else (for example a `flows/` folder in the folder you used to start
  from) must be moved into `~/.config/fwdloop/flows` or opened with `--root`. A run that was stopped and
  offered Resume before such a move is refused on Resume (it recorded the old folder); listing,
  opening and books still work.
- barebrowse `^0.24.1` is now required for a web page input. It keeps its browser tied to the run, so a
  killed run or an Abandoned draft leaves no browser behind. An older barebrowse is refused by name.
- The job card's Model menu and Thinking box lock with the rest of the card while a draft is live.
- README: a walkthrough GIF of a real flights run (Job, Run, Ask, Audit, Result).

### Fixed
- A scheduled run on a job that can no longer run (a retired check form) is refused at $0 and starts
  nothing, instead of leaving a red run folder every day.
- An audit row whose retry cost is unknown is no longer marked complete (red and stopped rows); the
  panel shows "at least".
- A jobs-folder error with no `--root` names the folder instead of `--root "undefined"`.
- The base URL trailing-slash cleanup is linear (copied from bareloop v0.48.0).

## [0.25.1] - 2026-10-25

A fix for CSV files saved by Excel.

### Fixed
- A CSV saved from Excel as "CSV UTF-8" starts with a byte-order mark. When its first header was in
  quotes, the file did not parse. The mark is now dropped before the file is read.

## [0.25.0] - 2026-10-25

M4b amendments 4-6 (the `fwdloop` launcher: menu, start, stop, restart, status, install; copied from
bareloop v0.47.1), M8b (a tidy run folder), M6 amendments 11-12 (Reuse), M9 amendment 24 (NEXT, one
instruction per line), and two learnings fixes (F83).

### Added
- The launcher. A bare `fwdloop` shows a menu (`1 start  2 stop  3 restart  4 status  5 install  q quit`)
  under a two-line header (version, the panel's address and start time, the run counts); the same five
  are verbs: `fwdloop start | stop | restart | status | install`. The panel is found by asking ports
  4800 to 4809 for `GET /api/whoami`; there is no pid file. `start` runs the panel detached and opens it;
  it refuses to start a second panel next to a taken port that stays silent. `stop` signals every panel
  it finds and, with drafts open, warns that they will be lost and asks y/N (`--yes` skips the question).
  `restart` is stop then start, on the stopped panel's port when it is free; with no panel running it just
  starts; a declined or failed stop starts nothing. `install` creates the keys file (mode 600) and the
  config. Colour follows the terminal (`NO_COLOR` is honoured).
- `GET /api/whoami` on the panel: app, pid, version (read once at start), open drafts, schedules and the
  time the panel started. The header and `status` show `started MM/DD HH:MM` (local time); an older panel
  without the field shows nothing extra.
- A run folder has fewer files. `run.json` is the run's start record (model, thinking and inputs in one
  file, written once); `diary.jsonl` is the step diary (rows of kind `call`, `tool` or `checks`);
  `line-checks.json` holds the cited and sheet check records (sections `cited` and `sheet`). The step's
  model is still denied the diary. No reader of the old file names is kept.

### Changed
- NEXT on the Run tab puts one instruction per line, as a label and an instruction in two columns, for the
  four endings that carry more than one.
- Reuse workflow: the Model line and picker sit under Signed flow, above the job.
- The Audit tab's learnings fold wears the same arrow as the other folds.
- Settings' Open keys folder and the launcher share one OS opener.

### Fixed
- Reuse workflow fills Cap $ with the job's signed cap, not the earlier run's cap.
- A run that went through an ask keeps every earlier try in `log.json` (a resumed or continued leg used to
  replace the file with only its own tries) (F83).
- A lesson's notes are counted on one row per workflow, not one per plan version, so one lesson no longer
  fills several hint slots (F83).
- Piped input to the launcher's prompts is queued, not dropped, when a line ends during the header's port
  probe (bareloop 1bad2c8).

## [0.24.0] - 2026-10-24

M8 (learnings: notes from earlier runs handed to drafts and retries, copied from bareloop v0.46.0 and
v0.47.0) with amendments 1-8, M11 amendment 22 (Reopen on the Run tab), and M10 fixes for a cited step.

### Added
- Learnings. At the end of every run (stopped, cap-halted, rerun and expired runs count; a run still
  waiting, a provider red and a crashed check do not) its failures and fixes are written as notes to a
  ledger in the config home. A note kept for a step that was never fixed is kept; a too-thin note is
  dropped only when fixed, and a changed line over 150 characters is left out whole.
- `learningHints` in `config.json`, OFF when absent (a bad value reads OFF). Only when it is `true` is the
  drafter handed the hints from earlier runs of the same workflow name (a changed job starts empty). The
  block is the same on every round of a draft, a hint failure hands nothing, and the draft keeps the
  block it was handed once as `learnings.json`, which reaches the run. There is no control for it on the
  Settings page.
- `fwdloop learn seed --root <flows folder>` reads every ended run already recorded and seeds the ledger
  from them ($0, code only), so the ledger does not start empty.
- A step's retry, redo or rerun try is handed the drafter's one block of hints; a first try, and a run
  with hints OFF, get none. The block rides that try's audit row.
- The Audit tab shows a learnings box at the top (one read-only fold, hidden when the run was handed
  nothing), and a try that was handed hints shows `told from earlier runs · N hints`; a click opens the
  exact text.
- Reopen on the Run tab: a run waiting on an expired ask shows the Ask tab's Reopen button, with the same
  rule and the same click.

### Changed
- The Job tab calls the box `Inputs` (was `Source`) and shows each input's full path or web address, not
  only the file name.
- The notes' place is one function, and a leading `~` is the home folder for both the run-end notes and the
  drafter's hints.

### Fixed
- A plan whose cited close drops the limit that the page look read from a guardrail ("under $40") is
  refused at draft time at $0, naming the line (bound-missing), and the drafter is told to carry the limit.
- The ask of a cited step shows its results (the Result tab's own line) and the unjudged cells, not the
  unrecognised-shape line.
- A run starts when its draft left `learnings.json` in the flow folder.
- Leaving Reuse clears the boxes it filled, so a refused start cannot redraft as a new job.
- A key right after a hyphen is masked by the secret redaction (bareloop 76168c8).
- The page-tag regex and the number-before-a-label scan no longer backtrack quadratically on a long
  unclosed `[a=[a=...` run or a long digit run (bareloop c59935e, 95f14b4, d7917d6).

## [0.23.0] - 2026-10-23

M10b (a sheet's checks are bareguard's cells checks; the CSV case runs green) with amendments 1-4.

Known open: the M10b exit is met for the expenses job only. The aging job's exit walk is still open
(F78 in `docs/logs/FINDINGS.md`).

### Added
- Sheet checks are bareguard's cells checks (bareguard ^0.26.0). For a CSV sheet the drafter suggests
  checks from bareguard's `rubricVocabulary` (the sheet's header is its only column choice), you sign
  them with the job (`close.sheet`), and bareguard judges. The step only answers in bareguard's typed
  claim boxes and is told their shapes, never the checks. A number or date in a check must be in the
  job's words, and a list of checks that only checks the table is refused at draft time at $0,
  naming the line.
- The sheet is locked per run. The run's frozen copy gets a `tableSha` written down once with the run's
  inputs, every check uses it, and a sheet changed by one cell after start stops the run at $0, naming
  the input. The run writes `sheet-checks.json`.
- Each guardrail shows what checked it. The plan card, the Job tab and the Result tab draw one sheet
  block: the line's guardrails, `Checked:` with one line per check (its plain words and
  `covers "<guardrail>"` when the drafter tagged one; on the Result tab and in the ask, ✓ or ✗ and
  what was found), and `Not checked:` with every guardrail no check covers, or `none`.
- The ask card of a sheet step shows the same sheet lines and the step's answer value by value, above
  the Reason box.
- `scripts/m10b-recheck.mjs`, a separate re-check of a run's signed sheet checks against its own
  frozen copy.

### Changed
- The CSV reader reads quoted cells (doubled quotes, commas and line breaks inside quotes, CRLF), and a
  row's number is the real line it starts on (a blank line is skipped but counted).
- The column lock follows the sheet checks. A job word that matches a column name no longer locks that
  column by itself; a column you agreed to in a column ask must be used by one of the line's checks, or
  the draft is refused at $0.
- The CSV cell cite is retired. A green step that reads a sheet without sheet checks is refused at draft
  time at $0, naming the line, and the drafter is told no cite form. A signed job whose green step
  still has the old cite is refused at start (run, resume, continue and the panel Run door) at $0,
  naming the line; it can still be viewed. The cite code was deleted.

### Fixed
- An answer identical (after trim) to a `~` rule already on its line is not added a second time.
- A cited money unit list with two entries equal after whitespace normalization is deduped (first kept),
  as bareguard 0.26.0 refuses it.

## [0.22.0] - 2026-10-22

M10 (read a web page, a CSV sheet or a .docx / .md / .txt document, with cited checks and code-forced
asks) with amendments 1-12, the M10 ports from bareloop (money forms, phrase dry read), M4d amendments
30-33 (try numbers after a Redo, a draft frees its cap, a run picks its model) and a books fix.

### Added
- A job can read a web page. A web address on the New job card is signed with the job as
  `source <role> = page:<address>`; the page is fetched with barebrowse, frozen with a sha256 at run
  start like a file, and an empty page stops the run at $0. A run uses only the signed address: the
  Run row shows it read-only, the CLI and a schedule carry it, and another address is refused at $0. A
  file-arrival trigger is never offered for a page.
- A job can quote a sheet or a document. A CSV sheet and a .docx, .md or .txt document are read from
  the run's own frozen copy (sha256 checked), and a .docx is handed to the cited check only as text.
- Cited checks. A step's check can carry the facts it quotes (`close.cited`): the drafter writes
  them, code checks them at $0 and refuses the draft naming the line, and at run time each quote must
  be word for word in the run's own frozen copy, each value read after its label, each number rule
  met, and the result count right. A number rule must come from a signed `~` line, and the result
  count must be a number you said on the line. No model grades; the run writes `cited-checks.json`.
  A place word grows to its role word ("Leaves Amsterdam ...") so a flipped route goes red. A step
  that quotes a page is told its fact rules and the form of its answer; a step that cites cells is
  told the cite forms the checker accepts, and the red for a cite that fits none names them.
- Column lock. For a sheet, a fact names its column in the step's check (`close.columns`). Code checks
  at $0 that it is a real column, and at run time a cell from another column is red, naming it.
- Code-forced asks, at drafting and before any model draft. Code reads the job's `~` rules against
  the page or sheet and asks about what it cannot check: up to 3 asks, each a plain Chat message
  (`A question the plan raised (K of N), about job line L: ...`) answered with `agree`, your own
  words, or `drop it`. An agreed reading or your words becomes a new `~` line under that job line; `drop
  it` leaves the rule Not checked. More than 3 asks stops the draft at $0 with the rewrite list and
  `Spent so far`. A column ask for a sheet word that is no column offers the one column of numbers. The
  questions and answers are in the draft log and the Audit (`you were asked` / `you said`). The CLI
  has `--left` for a left rule.
- Result tab, copied from bareloop's: the results that matter and what got checked for a page job, a
  Your call card to Accept or Rerun with your words, and a Download button. Every other job (a sheet,
  a document) lists each check its step ran, newest try, with ✓ or ✗ and its reason. A red page line
  keeps the rows the check judged, never a tick.
- The Chat Checked list shows each check on its own line (also on the Job tab step rows), and a new
  How the page was read list (Chat, Job tab, Result tab) holds code's notes about written forms it did
  not use. Not checked reasons use the signed words, for example `there is no column '<word>'`.
- `fwdloop run --model <id>` picks any model ticked in Settings with both prices for that new run (M4d
  am33). The job's recorded model stays the default and is never rewritten. The run records its pick
  once (`run-model.json`), and resume and continue keep it: another `--model` on a resume is refused by
  name at $0.
- `scripts/check-cited-run.mjs`, a separate checker of a run's cited results that shares no code with
  fwdloop. It re-reads the run's saved page, `inputs.json` and `cited-checks.json`.

### Changed
- The AI's money forms are sorted by code (a sign is a currency, any other form a unit), and a price
  fact that reads no result line is Not checked. A kept phrase fact is read on the same result lines
  as the money facts, and one that reads none is Not checked as `phrase-no-result` (ports from
  bareloop).
- A simple plural matches a column or heading: your "amounts" is the column "Amount". A real header
  the sheet look names is kept only when it is your own word; otherwise it is Not checked.
- A step quoting a page is told a money value is only the digits, and the refusal names the form.
- A number inside a time, a date or an amount is no longer read as a bare number you said, for the
  result count and for number rules.
- A .docx gets the same word look as a page; a job word that is no heading is Not checked with its
  reason, and nothing is asked.
- Try numbers keep counting after a Redo (M4d am30): try 1 and 2, Redo, then try 3 and 4. A try's
  checks and output are paired by its number.
- A draft frees its hold on the monthly limit when its result is written (M4d am32), so a Draft
  posted right after one finishes is no longer refused as held by a run in progress.
- Dependencies: bareguard `^0.25.1` and barebrowse `^0.21.0`. The package now needs Node >= 22
  (bareguard's requirement; CI and publish already ran 22).

### Fixed
- A try that ends with no artifact (a length stop) now adds its cost to the run's spend, so the
  history total equals the audit sum and the cap check sees it.
- The separate checker no longer calls a red line ok: it keeps the rows it judged.
- The CLI's one prose read goes through the safe file gateway, so a symlinked prose file is refused;
  `fwdloop draft` reads the prose file once, and a plan's questions file is read once per poll.
- `canStart` asks the same decider as claiming a run id, so a stray `runs/run-N` file no longer
  refuses a Run.

M10's CSV case asks once and the answer is kept in the draft log, the Audit and the signed job; its
cited checks going green waits for bareguard's computed-over-cells check (M10 am12).

## [0.21.0] - 2026-10-19

M4d amendments 25-29 (thinking per step, run diaries and the Audit step fold), M9 amendments 21-23
(run time in the Run tab summary, the schedule header) and M11 amendments 16-21 (Scheduled found by the
one search box, the ◷ chip sized to match ✓).

### Added
- Thinking per step. A step's 1st try thinks off; its 2nd and later tries, and a step redone after
  Redo, think on. The Chat "Thinking on" box now also covers the job's runs: ticked, every step
  thinks on every try, and the box's state at signing is kept with the job. Code decides this, never
  the model. Each step call's audit row records the thinking it asked for and what bareagent reported.
- Thinking in Audit. Each try line inside a step ends with its thinking: `thinking on` or
  `thinking off` when bareagent confirms it, otherwise the same words Chat uses. A try that ends with
  no reply from the model names what was asked plus `(no reply)`. Runs from before this show no
  thinking words.
- The Job tab shows Model and Thinking side by side on one row. Thinking reads `on retries` or
  `always on`, and `—` for a run from before thinking per step.
- Run diaries, written next to the run and never readable by the model: `calls.jsonl` (one row per
  model call: step, try, round, cost, tokens, time, stop reason, thinking asked and status),
  `tools.jsonl` (one row per tool call with the guard's decision; a call that did not pass the guard
  is marked `no check`, a denied call keeps its own row) and `checks.jsonl` (each try's numbered
  checks with ✓ or ✗, result and where the check comes from, plus the output it judged: file name,
  size, sha256). What the model said and what was in a file are never saved.
- Audit step fold. A step header ends with `[model]` or `[human · ask]`. Opened, it shows the tool
  tally, one line per try with its thinking and gap, every check under its try, the output judged, and
  a Round table (Round, Try, Action, Path, Decision, Time) paged 20 at a time. A human row reads
  `paused for you`, `you said redo: "..."`, `you accepted` or `you cancelled`. Read from disk; opening
  it never calls a model. Runs from before this show what they showed before.
- Run tab summary lines `calls: <n> model · <n> tool · <n> denied` and `checks: <n> run · <n> passed ·
  <n> failed (<step> tries <n>)`; `—` for a run with no diaries. Step cards carry the same
  `[model]` / `[human · ask]` marker and one line: `<n> rounds · checks on the last try <passed>/<run>`
  for a model step, `last answer: <answer> · <time>` for a human step.
- The Run tab summary's top line shows how long the run took after its cost, behind a middle dot
  (`passed · $0.0062 · 3m28s`), the same time as the `took ...` line; `time not recorded` when it is
  not recorded, and nothing for a run still going or waiting.
- The one search box also narrows the Scheduled cards, by job name. A new `◷` chip (hover: `scheduled
  jobs only`) shows only Scheduled; with no match the list says `no scheduled job matches`, and with
  `◷` pressed the count line reads `showing 1 scheduled job`. The result and time chips never touch
  Scheduled. The faint line above the search box reads `search also finds Scheduled; ◷ shows only
  Scheduled`.

### Changed
- Scheduled sits below the search box, above Jobs; Running now and Needs you stay above it, never
  filtered.
- The schedule header in Audit reads sign, word, `schedule`, then the parts separated by ` · `, for
  example `▾ [✗] failed schedule · when a new file arrives in ~/fwdloop-in/ · from run-1 · 5 tries
  started nothing`. The word comes from the one sign-to-word table.

### Fixed
- A grep over the run folder no longer spends its match cap on the diaries: the diaries are left out
  before the cap, and each entry still goes through the same guard.
- The `◷` chip is sized by measurement: the page measures ✓ and sizes ◷ so its ink is as tall as
  ✓'s, within 1px, whatever font draws it (M11 am21). Before, a fixed size tuned on one machine drew
  it a third too big on others.

### Development only (not in the package)
- A $0 harness for the thinking POCs (`poc/thinking`); F69 (thinking on retries vs everywhere, NO
  BUILD) and F70 (thinking on retries vs today, BUILD) are recorded in `docs/logs/FINDINGS.md`.
- `test/m11-am20.test.js` forces symbol fonts and needs at least two of them installed. On
  Debian/Ubuntu: `sudo apt-get install fonts-symbola fonts-freefont-ttf` (CI installs them).

## [0.20.0] - 2026-10-16

M11 runs list amendments 5-15, M9 schedules in their own signed file (amendments 13-20), M6 Reuse
workflow (amendments 5-10), and the Cap and Thinking notes of M4d (amendments 22-24).

### Added
- Runs search by words. Every word must match a job name, a run or a day; `run-2` never matches
  run-20; a day can be typed `10/13`, `10-13` or `2026-10-13`; brackets are ignored. While searching,
  a job's older-runs fold shows matching runs only (newest 7), and a line under it counts the rest
  with their real start days. A search that matches an older run highlights each matching run card.
- Reuse workflow, one button that replaces both Run again and Edit this job. It opens every field and
  the button names its cost before the click: Run (only inputs changed), Sign & run (only destination,
  cap, time cap, ask wait or model changed), Start drafting (a job field changed). A changed job signs
  as a new workflow `<name>-N` and never touches the old one; otherwise it is a new `run-N`. A red run
  always drafts. Each run keeps its own copy of the job and its plan: Resume, an answer or Reopen carries
  on that run from its own copy, and editing the workflow afterwards changes only new runs. A schedule
  set from a run uses that run's plan, model, destination and inputs.
- Needs you: the tags read Answer (a run at its ask) and Resume; an expired ask that can be reopened
  is listed with the tag Reopen. A Needs you click opens the run on the Run tab and, for a run at an
  ask, moves the left side to the Inbox. A button "Remove from Needs you" takes an expired, stopped or
  stuck card out of the pile (written once, shown in Audit); a card also leaves after 7 days.
- Running now, Needs you and Scheduled cards read `job · run-N`.
- Schedules are their own signed file, `flows/<job>/schedule.json`, with one queue file,
  `schedule-ledger.jsonl`. Setting, changing or cancelling a schedule never re-signs the job.
- A folded "schedule" section at the top of the Audit of a job with a schedule (tries across every
  signing, newest 7), with a sign: `[▶]` running, `[✗]` red, `[·]` waiting. The Job tab shows Started
  and Schedule, and the Run tab shows a SCHEDULE block and the end date and time.
- When a New file schedule changes folder or is cancelled, each waiting file gets one row ("was waiting
  when the schedule changed, so it will not run. Drop it in again to run it."), shown in Audit also
  after the cancel. Files waiting under the same folder stay queued.
- The Chat Thinking-off note is always shown next to the box, ticked or not.
- A run with no saved copy says why it cannot carry on.

### Changed
- The Run tab summary is one box, and its frame takes the colour of that run's card in the runs list
  for every glyph, including expired and stuck. The older SUMMARY box uses the same rule.
- A schedule's busy check: a run waiting at its ask does not block the next one.
- Cancel schedule works at any time and only stops future runs; a run that is starting, working or
  waiting is never touched. Changing to a new schedule is also allowed while a run is going; the next fire uses the new one. A Set that
  cannot be armed changes nothing: the earlier signing's queue rows are written only after the new
  schedule is armed and written.
- The panel checks that a queued file can start (no run starting, root exists, run number free) before
  marking it run; if not, it stays queued and tries again next turn.
- A Cap at or below what the earlier draft already spent is red with the Resume words, and Draft is
  refused with the same words before any draft folder or child starts.
- Faster panel tick and runs list: ended runs are skipped by the end-row rule in the scheduler's busy
  check and the job's waiting line, and dead starts are remembered instead of re-read.
- Development only (not in the package): the browser test helper reports a headless browser that is
  installed but starts too slowly instead of reading it as a skip, and sweeps dead owners' leftovers on
  launch.

### Fixed
- An empty Inbox shows only the nothing-waiting line.
- A stuck run that has left Needs you is no longer the top row of its job.
- A selected Inbox card looks like a selected Jobs card and scrolls into view.
- Appended books (history, audit, pids, runs, provider spend, triggers) start each row on a fresh line,
  so a torn last line no longer glues the next row and loses a run's end row. A torn trigger-ledger
  line is skipped.
- A job replace cut short by a kill (SIGKILL) is recovered: the old job reads again.

### Removed
- Edit this job and Run again (replaced by Reuse workflow). M6 amendments 1 and 3 no longer apply:
  Reuse workflow is open while a run waits.

### Known
- Schedule lines inside jobs signed before this release are read but no longer act. Set the schedule
  again by hand.

## [0.19.1] - 2026-10-14

Trigger fixes: a file that was already in the folder never runs, a new refusal reason is told, and a
new schedule no longer opens with an old trigger's red line.

### Fixed
- New file trigger: a file already in the folder when the trigger was set never runs, even when it is
  renamed or copied. The starting point is matched by the file's content (sha) alone, not by name.
- A queued file that is refused again for a different reason is told again. A refusal is told once per
  reason, not once per file.
- A newly signed schedule's NEXT line no longer leads with an older trigger's red "The last try did not
  start". Only tries from the current signing on count.

## [0.19.0] - 2026-10-14

M11 one runs list: the left Runs list is now one list (Running now, Needs you, Scheduled, Jobs), cards
match the signed mockup, and the Inbox gets its own filters. Display only: nothing on disk changes.

### Added
- One runs list, top to bottom: Running now (N), Needs you (N), Scheduled (N), then Jobs (N) · run in
  the last 30 days and a folded "quiet jobs" line (no run in 30 days). A section with 0 items is not
  shown. Search and filters act on Jobs and quiet jobs only; the top three sections are never hidden.
- Needs you holds a run waiting at an ask (tag Accept) and a stuck or stopped run you can resume
  (tag Resume). The tag is a label, not a button. A click opens that run on the Run tab and scrolls to its job card, as Running now does.
- A Scheduled card shows the next time and the schedule words. A click opens that job's newest run on
  the Run tab, where Cancel / modify schedule is.
- A Schedule run button on the Run tab, next to Run again, for a job with a green run and no schedule.
  Once a schedule is set it reads Cancel / modify schedule.
- Each job card reads `[sign] job · k runs` with the word and why of its newest run. Older runs fold
  under "older runs (k)": the newest 7, the selected run, then "(and k older: use search)".
- The Inbox gets the search box and the 7d / 30d / all / clear chips, plus status chips accepted,
  redo, rerun and expired (pick any; none picked = all). They act on "answered and expired" only;
  "waiting on you" and "working on your answer" are never hidden.
- Inbox search reads the whole row: job name, run, status word, the question and your reason.
- `GET /api/runs` answers `{rows, jobs, scheduled, limits}`: the server decides every state, the page
  works none out. The 30 days, 7 older runs and 7 days in Needs you are named constants in one place.

### Changed
- The Workflows / History switch is gone. One list; search covers old runs. The Audit tab's Grouped /
  Flat stays.
- Every section header in Runs and Inbox uses one style (bold, normal case) and carries its count.
- A Resume run leaves Needs you 7 days after it stopped. A stuck run counts the 7 days from when its
  saved answer was written. It stays under Jobs and its Run tab still has Resume.
- Cards follow the signed mockup: one short date (`10/13 19:12`), and each card line stays on one line, cut with … when too long.

### Fixed
- A search that matches an older run opens the job's fold on it, even when the job's newest run
  matches too, and keeps only the one newest older match past the 7.
- The Inbox search finds a row by its status word (searching rerun finds a reran row).

## [0.18.0] - 2026-10-13

M9 triggers: a signed job can rerun on a clock or when a file appears or changes, from the panel, with
no human click per run. A run's page opens with an ENDED or SCHEDULED summary block.

### Added
- A When dropdown on the Run card: by hand, every day, weekdays, every <day> at HH:MM, file updated,
  or new file in folder. The trigger is typed data in the signed arbiter block, set from a job that
  has one green run, in two clicks, at $0. The drafter never authors it.
- The panel runs the clock and a poll-based file watch. After the panel was off, a due slot runs once
  as a catch-up; more than 2 minutes late reads as a catch-up. A file counts only once it is stable.
- Every fire that does not start is a row in `triggers.jsonl` (append-only): busy (a run is already
  going), monthly limit exhausted, or refused. A refused start stays a refused row.
- File triggers queue by arrival, oldest first. The scheduler is the only writer of the file ledger
  (arrived, ran, dropped). A version (sha) that ran never runs again; files already present when the
  trigger is armed never run; a dropped version may arrive again.
- One button on the Run card: Run now, or Sign schedule when a trigger is chosen. Click 1 shows
  Confirm: <words>, click 2 saves and the card returns to its New job state. The Run tab gets
  Cancel / modify schedule. The card dims on press and ignores click-through for 1.5 s after a sign.
- A summary block on the run page: ENDED / NEXT for a finished run, SCHEDULED / NEXT for a job with a
  schedule; the NEXT line is red for a paused or refused trigger.
- A trigger-only re-sign appends a `trigger-resign` setup row under the new flow hash.

### Changed
- Editing a signed job clears its trigger back to by hand; the card says so.
- A trigger fire runs the Run door's model checks at $0 first: no record or an unticked model gives a
  refused row and nothing starts.
- A run whose start is still spawning reads `[▶] starting`, not `[?]` (one rule, `starter.startingFor`).

### Fixed
- A legacy green run survives trigger-only re-signs, so the one-green-run rule still holds; Cancel
  schedule is never refused for lack of a green run.
- The Job tab keeps reading this job's Not checked list after a trigger-only re-sign.
- Only a file version that ran is blocked from running again; a baseline blocks only while it is the
  starting point.

## [0.17.0] - 2026-10-12

M7 in-run tools: a step can use recall, get, recent, related, impact, compress, peek and stash over a
store that belongs to its own run. M4d amendments 12-21: one cap and one pot for drafting and
running, plain one-line Chat step lists with a Fix line, a version header and reload bar, and
refusals in words.

### Added
- In-run tools (M7): a step granted recall, get, recent, related, impact, compress, peek or stash can
  use them over one fresh store per run, kept outside every read scope. `edit` goes through the same
  write fence as `write`. `get` also reads a stashed item by id. `remember` and `forget` stay
  refused, since memory lasts one run.
- `impact` needs ripgrep (`rg`) on PATH; without it the tool is refused in words, and CI installs it.
- A stash holds at most 64 KB (65536 bytes) per payload, measured after known secret shapes are
  masked; a larger one is refused with nothing parked, and the refusal says what to do. Run 2 cannot
  see run 1's stash, even when a run reuses a deleted run's id (it starts empty).
- The drafter is told when to use compress, peek and stash. The tool words are true: recall, impact
  and related search code and markdown files only; recent finds nothing inside a run (amendment 19).
- One cap, one pot (amendments 13, 16, 19, 21): the card's Cap $ also caps drafting, and drafting
  spend comes off it. Each round must fit what is left; a draft reserves what is left of the cap
  against the monthly limit, not one round; a revise and the redraft after answers check the month
  for what is left, not the whole cap again. Sign & run shows the split and refuses at $0 when one
  run round cannot be paid. Start over keeps the pot: drafting spent before it still comes out of the
  cap, and the Cap note counts the pot left.
- The panel header shows fwdloop's version, read from its own package.json at serve time, and a
  reload bar appears when the panel restarted on a different version under an open page
  (amendments 17, 18).
- An empty job box gets a grey line under the Cap note (amendment 21).
- The Audit Draft group gets one row per try with its plain reason and the raw text under it; a try
  row has no cost of its own, its Cost cell reads a dash (amendment 15).

### Changed
- The Chat step list is one line per step, facts joined by " · ". Each try is its own grey line, the
  free retry reads "try N again", with one grey note above. A red step shows one plain reason and a
  Fix line (every plan-check reason has its own Fix sentence); the revise and redraft lines are one
  line, with no details or raw text. Plain words live in `src/plain-checks.js` (amendments 12, 15).
- An open question is not red, and a first plan that asked a question never reads red after it is
  answered (amendment 15).
- One function writes the cap-too-small sentence, for drafting on the card, in the drafter, and for
  Run a signed flow and Resume; "needs at least" is gone (amendments 19, 20).
- One key-name rule: `provider.js` uses `keysfile.js`'s `..._KEY` rule, so a slot like GROQ_TOKEN is
  refused with the rule named (amendment 21).

### Removed
- `DRAFT_BUDGET_USD` and `--budget`: the card's Cap $ is the one cap (amendment 13).

### Fixed
- A made-up Start-over id is refused; a missing earlier draft is never read as $0, and Start over is
  refused in words (amendment 21).
- A live child whose cmdline reads empty in its exec window, or an exiting task with an empty
  cmdline, is no longer misread (the draft "stopped" flake): the first reads "cannot tell", the
  second reads dead.
- The am15 revise line reads the result before its log, so a settled line never has `lines` null (a
  two-read race).

## [0.16.0] - 2026-10-12

M4d amendments 3-11: Settings > Providers becomes the only place for providers, models, prices and
thinking; bare-agent 0.52.0 decides thinking; the plan checker refuses two more hollow shapes at $0;
the Chat card lists every step of a draft.

### Added
- Settings > Providers: every `*_KEY` name in the keys file is a provider row, named by its env name.
  Each row carries an API shape, a Base URL and a legacy max_tokens setting, a model list with
  Refresh, a Use tick, and In/Out prices per model, with each model line showing its own tokens
  spent (amendments 3, 5, 6).
- A [ Test ] button on each key row asks the provider's free model list, and an [ Open keys folder ]
  button next to Reload keys opens the folder of the server's own keys file; the request carries no
  path.
- The model a job was drafted with is recorded in `model.json` (draft folder, then flow folder) and
  the job runs with it; `bin/fwdloop draft` takes `--model`, `--provider` and `--thinking`. An old
  signed flow with no `model.json` takes the model picked in Chat's "Run a signed flow" card and
  records it on a successful start. Chat's Model menu says it is reading, and a failed read says so
  and reads again by itself (amendments 6, 7).
- Thinking is decided by bare-agent 0.52.0 (0.51.0 first): the drafter sends thinking on or off per
  model, the thinking status is kept per round and the worst one per draft, and the page says it
  loudly. The thinking words are bareloop's, one function; an unverified model shows "thinking off
  (not verified for this model)" beside the box (amendments 4, 7, 11).
- The plan checker refuses, at $0, a green step that reads no input with cells (amendment 8, a run
  reads the frozen CSV as cells) and an ask step that reads no earlier step's output (amendment 9);
  the drafter is told both rules.
- The Chat card shows every step of a draft as a list: thinking, inputs, drafted, plan checks,
  rubrics and tries. The thinking block beside the plan is gone; a thinking failure is red
  (amendment 10).
- The New job card shows Destination below Inputs, and the job hint says the last line writes to
  Destination.

### Changed
- Providers, models, prices, the default model and the thinking switch live only in Settings; the
  built-in provider rows, the code price table and the per-model thinking allow-list are deleted. A
  ticked model's prices are only what was typed; a half-typed line becomes an unticked line. The cap
  floor and the test-double hold read the ticked model's price. A broken config is refused by name
  with "Nothing spent" (amendments 3, 5, 6).
- Thinking on forces no tool choice; thinking off still forces it. A cap cut-off during drafting is a
  failed try (amendments 3, 4).
- A try line's validator reasons read as plain sentences, the same path as plan checks, with the raw
  text folded under details (amendment 10).
- Any ValidationError from the provider is a loud provider-red counted unmetered; the dead
  thinking-refused branch is removed.
- Only API-key-looking names (ending `_KEY`) are a Settings row, reach a child env, or are accepted
  as a slot, at every gate; other names are refused by name at $0.
- A step's raw tool arguments are bounded on display at 2000 characters plus "… (N more chars)",
  since bare-agent hands over all of them (F64).

### Fixed
- A refresh tick no longer rebuilds the Ask tab: time left counts down in place and every box keeps
  its scroll position.
- Clear on the Chat card also unpicks the flow chosen in "Run a signed flow".
- The KEYS strip text is never crushed at any width, and the Test result sits under its button.

## [0.15.0] - 2026-10-10

M6: edit a signed job from the Chat card. Signing the edit replaces the job all or nothing, and each
run keeps a copy of the job it ran. Also the v0.14.0 leftovers (amendment 41), one place for "you
check it after you accept" (amendment 42), and a write-once copy of the signed files that lets a
refusal say what changed (amendment 43).

### Added
- Edit a signed job (M6): "Edit this job" on a signed flow fills the Chat card with its lines,
  guardrails, inputs, destination, cap and waits. The AI drafts the plan again with the same checks,
  and Revise and sign work as for a new job. Signing replaces the job all or nothing; an edit you
  abandon or never sign leaves the signed job exactly as it was.
- Each run saves a copy of the job it ran when it starts, and its Job tab shows that copy, so an old
  run still shows the old lines after the job is edited.
- Sign keeps a write-once `signed/` copy of the signed files (amendment 43). When a later verify
  fails, the refusal names what changed ("line 3's guardrail", "the cap"), not just the file; the run
  and resume doors say so too.
- A job card shows its latest 7 runs, then "older runs: use search" (amendment 41 item 5). The Job tab
  carries a "The job" title under Model (item 6).

### Changed
- "Edit this job" is greyed while a run of the job is running or waiting ("finish or stop run-N
  first"), and the replacing sign is refused (M6 amendment 1). It is also greyed while a run is
  starting ("a run is starting"), only for as long as the start is alive (amendment 3).
- The left pane is 630px wide on a wide screen, and job boxes grow to 8 lines, then scroll (M6
  amendment 2).
- A stopped run whose job was edited and signed since says "stopped — the job was edited; start a new
  run" in Runs, Ask and Inbox, with no Resume. Other stopped runs say "stopped — Resume to go on" in
  Runs, Ask and Inbox alike (M6 amendment 4; amendment 41 item 4).
- A step after the last ask reads "after you accept" on the Job tab and "you check it after you
  accept" in the Chat card's Checked list; one place holds those words, and one holds the Not-checked
  words (amendments 41 items 2 and 3, 42).
- On the Chat card, a failed plan check reads as one plain sentence with the raw checker text folded
  under "details"; an opened fold stays open across refreshes (amendment 41 item 7).

### Fixed
- An empty `[]` for `unjudgeable` counts as nothing, the same as `{}`; a non-empty list is still red
  (F63, amendment 41 item 1).
- A run working on your answer counts as running, so Edit is greyed and the replacing sign is refused
  (M6 F1).
- The run's job copy is written only if the job on disk still has the signature hash the run
  verified; if the job was replaced while the run was starting, the run stops `preflight-red` and
  writes no copy (M6 F3).
- A run halted under a job that was later replaced offers no Resume button, since the runner would
  refuse it as a signature mismatch (M6 F5).

### Known limits
- A hard kill (SIGKILL) in the middle of a replacing sign leaves the old files in
  `.replace-old-<pid>-<ms>/` and the job refused until they are moved back by hand.
- The Run, Map and Audit tabs read the flow's current job, not the run's copy; only the Job tab reads
  the copy.

## [0.14.0] - 2026-10-10

M4e, second half: Revise is now the card itself, the plan's checks run on bareguard's rubric with
plain-words refusals, the drafter shows what it Checked and what it did Not check, and the Job tab
reads as your lines with the approved plan folded under each one. bareguard moves to ^0.21.2.

### Added
- Revise reopens the Chat card (amendment 14): Sign & run and Revise sit side by side, a revise takes
  the card rather than a note box, up to two revises are left and then Start over; only the newest
  green plan can be signed. Revise rows are kept in setup, and a start over is recorded and shown as
  "start over" in Audit.
- Per-section word math (amendments 15 and 16): a size guardrail is read per section ("250 words each",
  "250ish each", "250ish words per section", thousands separators), the machine sets
  `wordsPerSection`, a guardrail whose numbers do not add up is red at $0 before any model call and
  at sign, and the readout says "about N words each". A softgreen step is never granted write or edit
  and the drafter is told so.
- Softgreen checks run on bareguard's rubric (amendments 18 to 20): one render function keeps our
  wording, every softgreen check is built at preflight before the first model call, and a shape
  bareguard cannot build is red at draft, revise and sign, by name. "N more" is derived from each
  gap's total minus the list shown.
- Plain-words refusals (amendments 21 to 23): the run door refuses a signed flow that will not run
  up front (409), and Run again says the same sentence; a refused flow is not listed under Run a
  signed flow. The reason names the step and what to do, in plain words; bareguard's raw reason is
  kept in the run's records, never shown as the sentence.
- Drafter questions, Checked and Not checked (amendments 24 and 25): the drafter's Not checked list
  is kept on every try, questions open only on the third try, after tries 1 and 2 both failed, your answers are write-once
  on disk and trigger a redraft, and the Draft view shows Your answers, Checked (built from the typed
  closes) and Not checked (labelled, unsigned). The panel has a question view.
- The drafter picks `maxWords` itself and the code checks it is a number the guardrail names
  (amendment 29, after a paid POC at 10/10, $0.0124). Code still reads the size for each section.
- The step map wraps like text, as HTML boxes and arrows (amendment 31), and a retried step shows a
  dashed box with a retry mark before its status (amendment 35); both borrowed from bareloop.
- The sign row in `setup.jsonl` keeps the drafter's Not checked list (amendment 36).
- The Job tab shows your lines with the signed plan folded under each (amendments 34, 37 to 40): each
  job line, its `~` rows, then its step as a folded line (details/summary); only the marker is blue
  (› folded, ⌄ open), step text is plain ink and detail dim, the legend reads "› = the approved plan",
  and Not checked is a folded plan line with a gap before Ask. The Job data carries the signed plan
  (steps, checks, Not checked); the Success box is removed.

### Changed
- bareguard dependency bumped from ^0.19.2 to ^0.21.2 (0.21.0 for the rubric; 0.21.2 so a numbered
  `#` heading matches its section, amendment 33).
- Reading 10,000 runs took about 1 s (amendment 16 I1, F62), so settled runs are now rolled up into
  `rolled` rows in `runs.jsonl`; no month total changes. A "process gone" run is never rolled, and a deleted rolled run keeps its spend.
- The keys file passes only the known key names to a child process; `NODE_OPTIONS` in the file never
  reaches one. One `draftKeyRefusal` checks the draft key for the CLI and the panel.
- Several `~` lines under one step are one guardrail, joined once; answers join the same way.

### Fixed
- The history end row is written last and always, even when the log, `halt.json` or the settle row
  fails.
- A Stop counts as stopped only when another Stop took the ask; any other error says the stop failed
  and leaves the run as it was. A stop time that is no real date is treated as now.
- A rerun names its new run folder in the money records when it starts.
- A draft is read "is it still running" first, then its result, so a finished draft is never shown as
  ended before it finished.
- An outside-folder 403 says so in plain words; the Draft header counts each revise; a run stopped at
  its ask reads "stopped at the ask of ..." and plain "stopped" when the step is unknown, in Runs,
  Ask and Inbox alike.
- Two softgreen answer forms: `lines` is dropped (text is the only answer field) and extra keys on a
  softgreen artifact are red by name.

## [0.13.0] - 2026-10-08

M4e: a Chat card in the panel. Describe a job, watch it drafted, sign it with two clicks and run it,
all without leaving the panel. A run can be stopped and continued, and a stop at an ask stops at the
ask.

### Added
- A Chat tab, borrowed from bareloop's Chat card and opened by default: Flow name, The job, Cap,
  Destination folder, Inputs and Ask wait. Draft writes the plan through the one drafter, shows it
  with its checks, and Sign & run is two clicks bound to the plan's hash (no typed name). A draft is
  a panel-owned folder under `.drafts/`; its spend is booked per call and counted once by Money and
  the monthly check. A refused start survives a reload; Clear removes it.
- The job box takes one step per line, `~` guardrail lines under their job line, and Ask marks; the
  inputs box takes the input files. The card shows the plan, the chat history as bubbles, and a note
  box in a fixed order.
- Revise the plan: "Ask for a change to the plan" sends up to two changes (`fwdloop draft
  --revise-from <plan> --note <file>` on the CLI, `POST /api/author/:id/revise` on the panel). Notes
  are write-once; a red change keeps the last green plan; Start over gives a fresh draft.
- A plan that fights its job line (sections out of order or unnamed, a word limit off the guardrail)
  is red at draft, change and sign. A check can no longer be emptied.
- Run a signed flow from the panel: a typing search over flows that have passed and can run, with
  their track record; Run again sits first in the Run tab's action row. Run opens Inputs,
  Destination, Cap $ and each ask wait; a changed value needs the same two-click hash, and the
  values in force are written once into the run's folder and shown in the Run and Job tabs.
- Stop: a Stop button on the Run tab, read before every model call and between tries. Every stop
  leaves audit rows, reads `[■] stopped` and shows as neutral. Resume is the cap alone (Cap $, a
  money note with the real smallest accepted cap, Sign & resume in two clicks); `fwdloop continue`
  does the same from the CLI under a write-once signed-values version.
- A money note under Cap ("needs $0.50 ($0.10 left monthly)" or "$4.90 left monthly"), re-read as
  you type; a cap below one round of the first model step is refused at Draft and at sign.
- Amendment 13: a Stop at an ask stops at the ask, and Resume asks again, fresh. A waiting run
  offers Stop but is not "running" to the Resume door.
- Run names are `run-<n>` per flow, claimed by an exclusive mkdir, shown as `<flow> (run-<n>)`; the
  send file is named `<flow>-<runId>-<emits>.json`.
- Setup is shown as Draft: `setup.jsonl` is written once at sign and every run's Audit tab starts
  with a Draft block (drafting is step 0, with the card-to-sign time, model calls, human checks and
  cost; unknown cost never reads 0). Audit headers use the step card's status word, in bold.
- Ask headers (a short one-line paragraph before a paragraph) show in the panel's accent colour; the
  text is unchanged.

### Changed
- The send destination is any folder you name (an absolute `file:` target). Only the flow root, flow
  folders, the run folder, the config folder and `.drafts` are refused by name; a send never
  overwrites.
- The panel needs no token and no cookie: `fwdloop panel` prints `http://127.0.0.1:<port>/`. The
  127.0.0.1 bind, the own-Host gate on every route, the own-Origin gate on every POST and the loud
  taken-port failure stay. The token file, the `?t=` link and the cookie gate are removed, and an old
  token file is never read or deleted. The panel is single-user (F59).
- Runs sub-cards read `(run-n) word - label` and drop the flow name; a passed one reads
  `(run-n) passed - goal met`.
- Cached input is priced as input (M4d amendment 2): the Cached in column and box are gone and a
  POST of `cachedInPerM` is refused.
- Job tab reads like the card: no "time cap", `~` guardrail, wait and destination rows under their
  lines; the ask wait prints through one plain formatter (90m reads 1h 30m).

### Fixed
- `haltRun` writes the halt record before the history end row, so a stopped run always shows Resume.
- A stray answer for another ask no longer makes a waiting run read stuck; the saved-answer
  classifier ignores an answer for an ask that is not open.
- The Chat card has its own id, `chat-job-card`; a duplicate id had emptied the Job tab. At 320px the
  card's top-right button no longer covers the radio row.
- After Sign & resume click 2 the Run tab shows a disabled "resuming..." until the run is live or
  ended; of two resume POSTs one continues and one is refused.
- "Fix the marked boxes" clears when the last marked box clears; the ask box placeholder shows only
  while the box is open.
- The test suite's fixture sends and `runner.test.mjs` write to a temp dir and clean up.
- A Stop and an answer saved in the same millisecond keep the answer, and the run stops before the
  next step instead of at the ask; only a Stop strictly before the answer stops at the ask (F60,
  hamr's ruling).

### Known limits
- F58 is open: a change to the plan can silently drop a section. The fix is the next amendment.
- F59: the panel is single-user; anything on this machine that can reach 127.0.0.1 reaches it, with
  no token.

## [0.12.0] - 2026-10-05

M4d: a Settings page. Provider keys, provider details, prices and a monthly spend limit are set in
one place, and a run, resume or draft that would pass the limit is refused before it spends.

### Added
- A keys file, `~/.config/fwdloop/.env`, read for every key call (run, resume, draft, panel). The
  merged keys are passed down to each call site; the process environment is never changed, and a
  test child never reads the real keys file. A key set in the shell still wins.
- One `config.json` reader and writer in the same config home, borrowed from bareloop.
- A Settings page in the panel, behind the panel's own gates and laid out like bareloop's: a KEYS
  strip, one Providers table (Key, Name, API shape, Base URL, Test, Tokens used, Balance, and three
  price columns) and a Money & limits tab (a money strip and a breakdown table). A key shows only
  as set or not set, never its value.
- Providers: Test asks the provider for its list of models (no completion, $0) and Balance asks the provider for its balance,
  both at $0 to the run books; Balance works only for a deepseek host. Name, API shape and Base URL
  are text boxes and a dropdown saved on change (amendment 1), and `makeProvider` builds an openai,
  anthropic or gemini provider by that shape. Prices are saved on change and validated.
- A monthly limit. Every run is recorded in `runs.jsonl` with a hold, and the limit is checked at
  run, resume and draft; the Money tab shows the month's spend. The monthly limit moves freely up or
  down; the per-run cap stays signed.
- Spend rows now record the provider and the price used. `deepseek-flash` has a cache-hit input
  price in the rate table, measured against a real cached call.

### Changed
- One price lookup serves every model call. A model with no rate in the table is now priced at the
  table's highest rate and builds, where it used to throw. Unknown cost is still never shown as 0.
- Settings tokens read like bareloop's (16.8M, 4.0k), and the undated-rows hint reads in the
  singular when it is one row.
- Settings inputs and selects use bareloop's look.

### Fixed
- A run with no monthly limit set was invisible to the monthly check and the Money tab (F55); every
  run is now recorded, with a $0 hold when no limit is set, so its spend is counted.
- Settings Test and Balance never follow a redirect with the key attached; a redirect is shown as a
  plain sentence.
- A real provider can no longer be reached with `NODE_ENV=test` skipping the money checks: the CLI
  refuses at $0.
- The drafter now gets a key that lives only in the keys file, and a key loaded from the file is
  scrubbed from a resume child's log.
- The new `src/monthly.js` is on the F48 safe-read guard's allow-list, so the symlink-escape guard
  covers it.

## [0.11.0] - 2026-10-05

M4c-fix: the whole fix list is cleared before M4d. The panel is locked down, every word it shows is
plain, an expired ask can be reopened by a human, and a pile of crash, leak and money bugs are closed.

### Added
- Panel safety. The token lives in a 0600 file, is printed as a `?t=` link, then rides in an
  HttpOnly SameSite=Strict cookie, and is reused across restarts so a bookmark keeps working (a
  loose or junk token file is replaced). A bare `GET /` without the cookie gets a plain page that
  says to open the printed link. `X-Frame-Options`, `frame-ancestors` and `no-store` go on every
  response. A flow must sit inside `--root` by realpath for reads and answers, and no reply carries
  an absolute path. An over-limit request body is cut off at once with a 413. One resume at a time
  per run (409 already-resuming), with one log file per resume attempt.
- Reopen (amendment 1): an expired ask is reopened only by a human click ("Reopen for another
  <wait>", `POST /api/reopen`), recorded as a write-once reopen record and one audit row. The old
  resume-to-record-expiry button is gone, and a run ended by expiry reads `[!] expired`, never
  accepted. A broken saved answer gives the answer buttons back with a note and is moved aside as a
  write-once record. A late answer is set aside first on reopen, or the reopen is refused plainly.
- "Remove the old lock" (amendment 2): one confirm, a gated POST that re-checks the lock has no
  holder right before the unlink, removes it, writes one audit row and continues the run.
- One bold word after every sign (amendment 2): `[▶] running`, `[·] waiting`, `[II] stuck`,
  `[!] expired`, `[?] crashed`, `[✓] passed`, `[✗] failed`, the same in Runs, Inbox and the run
  header, in bareloop's row layout (sign + name, word and why, then meta).
- The practice root gains run-gap, run-expired, run-expired-late and run-ended-expired rows, made
  through the real path, so each state can be clicked live.

### Changed
- Plain words everywhere the panel speaks (amendment 2): no HTTP codes, ids or paths; a failed load
  reads as a plain sentence; "Try the resume again" is "Continue the run"; a redo or rerun with no
  reason is caught on the page. The Inbox says "your answer is saved; the run is picking it up" or
  "the run stopped before using it" (amendment 3).
- Phone Audit is one line per entry up to 640 px, and every entry opens on a tap to its full step,
  result, gap, refused list, tools, close, cost and time. Grouped Audit shows a closed group as one
  header line with a caret; a group with a failed try starts open; a one-try step opens its detail in
  the same tap. Step titles are short: `[sign] name . cost . try N`.
- A run that needs you opens both Inbox and Ask; clicking a waiting or stuck run in Runs always
  jumps to its Inbox ask, decided from the run's fresh asks. An expired ask's Inbox row says why,
  from the same line its Ask tab draws; every Ask block names its flow and run.
- The run header reads like its Runs row, three lines on a phone, no frame; step cards under the map
  read in lower case (amendment 4).
- CI: the `test` check is now required on `main`, and a second push to `main` no longer cancels the
  first push's run.

### Fixed
- Crashes and leaks: `fwdloop show` and `fwdloop inbox` strip terminal control codes from model
  text and questions; a drafter's red message and a resume's quoted child output are scrubbed of the
  provider key; `answer.json` that is not an object is refused by name, and decision words read as
  own entries only; a consumed-answer marker holding null no longer crashes the panel; `draft --out`
  inside the flows root is refused by name; resume compares the recorded and requested roots by
  realpath; a resumer unlinks `resume.lock` only while it is still the recorded holder, and a failed
  lock-holder write removes the empty lock it just created.
- Money: `readSpendTotal` counts an incomplete spend row at floor plus ceiling, and a transport retry
  keeps the first call's refusals and tool tally. A model-step key red books a valid audit row when a
  model is named. An ask's `askedAt` and `expiresAt` come from one clock read.
- Refresh: finished and unreadable runs re-read at list rate; a late reply to a run's detail, audit,
  job or asks fetch can no longer overwrite a newer one; a long run title wraps inside the header at
  320 px.
- An answer is not refused as already-resuming when the previous resume child is only closing on a
  run already waiting on you. The Inbox cleans terminal codes out of the question.

### Known limits
- A narrow lock window remains between the last holder check and the unlink in "Remove the old
  lock" (amendment 3 d); it is recorded in the module ladder.

## [0.10.0] - 2026-10-02

M4c: the panel's answers read clearly. A run says whether it is running, waiting on you or stuck;
the Inbox is always there; the page keeps itself fresh without redrawing over what you are typing.

### Added
- A running sign, `[▶]`, for a live run, from per-run pid rows (`pids.jsonl`) and one liveness
  rule, with a 10-minute fallback and a matching filter chip. Only a live run and a run waiting on
  you pulse; answered-not-resumed and answer-saved runs stay still.
- Inbox (N) is always shown, with the open count computed server-side (`/api/inbox` `openCount`).
  One ordering serves it: waiting (least time left first), working/answer-saved, then answered and
  expired newest first. A run you have answered but that is not yet resumed shows as a working
  row. Runs use one ordering too (waiting, running, finished); a click on a run opens Run, and on a
  waiting run opens its Inbox ask.
- Ask tab: one block per ask line, labelled "draft N", with the answers so far. Blocks group by the
  archived ask's recorded `emits`, else the paused audit row's step, else the question text. A
  click shows a working state, and a block you opened or closed by hand stays that way.
- One stuck rule: a run whose resume was taken but never finished reads `[II]` and pulses, and one
  that crashed after taking the ask reads `[?]`. `resume.lock` now records its holder so a dead
  holder is told from a live one.
- Amendment 3, "on time is on time": a resume checks `answeredAt` against the ask's deadline, so an
  answer given in time is not refused for a slow resume; a stuck run stays `[II]` after the
  deadline; an empty lock reads as stuck.

### Changed
- A running run says when it started and that it is "still running", never "parked or died". The
  time comes from the newest pid row's `startedAt`; died and parked wording is unchanged.
- The Workflows job card reads time and spend through the same words as run rows. Before, it read
  only the last row's time, so a running or parked flow's card said "unknown". The header spend of
  a `[▶]` run says "no priced spend yet".
- The page now refreshes itself: the runs list, Inbox (N) and the open run's header update without
  a reload (before, only the post-answer watch polled). The open run refreshes every 2 s while it
  is live; the Inbox and Runs lists refresh at most every 10 s, and at once when a run goes
  live-to-done, on tab return and after any action of yours. A payload that has not changed is not
  redrawn, and selection, focus and scroll survive a rebuild.
- The Ask tab shows the one stuck label, and the resume label is said once, in the header.

### Fixed
- Typing a reason is never redrawn over by a refresh. A redraw that was held back is retried: the
  asks signature is stamped only after the ask really draws (F54, found by `/branch-review`).
- An askId hand-edited to contain `"` or `]` no longer makes opening a run from the Runs list
  throw; the Inbox row is looked up by `data-testid` equality, not by a selector built from ids.
- Placeholder dots (the empty header dot, the "no runs" row) no longer pulse; the pulse follows a
  `.pulse` class the server decides.

### Known limits
- F53's drafter variation (repeated asks looking identical at draft time) stays open.

## [0.9.0] - 2026-09-30

M4b: the panel answers asks. The read-only panel gets three answer doors (Accept, Redo, Rerun) and
resumes the run after an answer; the answer word `reject` is now `redo` everywhere.

### Added
- Panel answer doors: Accept, Redo and Rerun on an open ask, through a gated `POST /api/answer`.
  Every route checks the Host header, the write routes need the per-process token (sent in a header
  only), and `askId` is required, so a stale or replayed answer is refused by name. Refusals show
  inline next to the door.
- The panel resumes the run after an answer in a detached process, retrying the run lock (5 tries
  over about 10 s). If the resume cannot start it says so by name, "answer saved, resume not
  started", and offers "Try the resume again" (`POST /api/resume`). The page reloads from the
  books after an answer, and the live watch stops on the typed run outcome rather than label text.
- Accept records the sha256 of the accepted draft; `send` re-hashes the artifact and refuses on a
  mismatch or a missing hash. An archived ask now records `emits`, and a resume in a later process
  reads the earlier accept's hash by `askId`.
- A run ended by a rerun reads "stopped by you (rerun), a fresh run was started", never "failed".

### Changed
- The answer word `reject` is now `redo` in the CLI (`fwdloop answer <askId> redo "<reason>"`), the
  library and the panel. Old `reject` input and old answer files are still read as redo and never
  rewritten.
- The `[✗]` filter chip in the panel says "stopped", not "failed".
- An ask that is answered but not yet resumed no longer reads "waiting on you" in the Inbox or the
  Ask tab; it carries the run's resume state in words, with no countdown. A re-parked ask reads
  waiting on you again.
- The panel's read-only strings are reworded now that it can answer.
- A resume log is deleted after a clean resume (exit 0, best effort) and kept otherwise.
- Internal, no behavior change: one decision-to-status table, exported from `ask.js`.

### Known limits
- Accepts recorded without a hash (before 0.9.0) and runs parked before the `emits` field existed
  are refused by `send` by name; nothing ships unchecked.
- The panel does not yet show that it is working, and repeated asks look identical (F53, open).

## [0.8.1] - 2026-09-30

Patch: every audit row carries `refused: []`, and the repo gets CI on pull requests.

### Changed
- CI: a new `.github/workflows/ci.yml` runs the lockfile check, typecheck and tests on every PR and
  push to `main`. Repo tooling only, not shipped in the package.
- Internal, no behavior change: test hygiene (`CI=false`/`0` is not CI, no permanent skip, a
  missing-arg sign test names its refusal, input-facts heading levels h1-h6 pinned), two stale
  comments corrected, the dead panel helper `auditTimeCellText` deleted, and the `AuditRow.refused`
  type doc now says `[]` on every row.

### Fixed
- The `stale-answer-ignored`, `ask-expired` and `answer-after-run` audit rows now carry
  `refused: []` like every other row; the 0.8.0 notes already promised this for every row.

## [0.8.0] - 2026-09-30

M6a: the authoring backend. `fwdloop draft` turns signed prose into a declaration draft and
`fwdloop sign` records the human signature; amendment 1 makes each step's goal its signed line
verbatim and requires every ask's wait to be signed.

### Added
- `fwdloop draft` / `fwdloop sign` (CLI + `src/authoring.js`): `draft` writes a draft dir (the
  declaration, a readout of the steps, asks and exact signed waits, and a `spec.hash` that covers
  the prose, the sources and the target root+name). Paid spend is booked before anything else, so a
  write failure keeps the cost. The draft dir is claimed before the paid round. A draft is scrubbed
  for key values; a leak leaves a marker and no `spec.hash`, and `sign` re-sweeps and refuses a leak
  marker. A budget below one round's ceiling is refused at $0 before any provider call.
- `src/drafter.js`: the drafter. One forced `emit_declaration` tool call whose schema is built from
  the wired menu only (an unwired verb is never offered and reds by name if granted anyway). The
  structure retry keeps the validator's reds, and the log's `kind` reflects the real round.
- Input facts: the harness reads each source's headings (markdown and docx) into `inputFacts`, so
  the drafter can pin `picks` to real heading names.
- `validateDeclaration` takes `wired` (an unwired verb reds by name) and `verbatimGoals` (a step
  goal that is not exactly its signed line reds) options; `wiredMenu` lives in one place.
- `makeProvider` takes a `thinking` option, sent verbatim as `body.thinking`; the drafter passes
  `{ type: 'disabled' }` (F49). Deps: `bare-agent` bumped to `^0.49.0`.
- Amendment 1: each step's `goal` is its signed line, verbatim, set by the machine at draft
  and refused at sign if edited; an ask needs a signed wait (`ask 30m:`), never a code default.
- Amendment 2: `fwdloop sign` needs an interactive terminal (stdin and stdout TTYs) and a typed flow
  name; piped or scripted input is refused and no flow is written. It raises the bar, it is not
  proof of a person (a script can fake a TTY). `signDraft` stays a library for tests.

### Changed (breaking for authoring)
- Prose with a bare `ask:` (no signed wait) is now refused by `draft`/`sign`; write `ask 30m:`.
  Flows signed before 0.8.0 still run unchanged, with the 30m default.
- The drafter no longer authors `goal` (removed from its forced schema).

### Fixed
- A drafter provider call that failed with no metering (e.g. a timeout after a priced round) was booked and printed as a complete cost. The draft result, the booked spend row, the readout and the CLI's `cost:` now carry `spendComplete:false` ("at least $X", the runner's convention) and `calls` counts every provider call.
- F50: the drafter paraphrased goals and dropped prose detail ("200ish each"); goals are now the
  signed line verbatim. Prose-only sizes are still judged only by the human at the ask.
- The catalogue's `compress` is described as a code shrinker, not a text shortener (the drafter
  picked it for prose).

## [0.7.0] - 2026-09-29

M4a: a read-only panel over the run books, the F48 symlink-escape class closed, and the
bareguard/bare-agent switch-over.

### Added
- M4a `fwdloop panel [--port 4800] [--root <dir>]` (`src/panel/`, borrowed from bareloop's panel
  and rewired to fwdloop's own books): a read-only local web panel with Runs (Workflows/History),
  Run (step map with try-N badges and a dashed retry loop, step cards), Audit (collapsible
  per-step groups, Blocked/Human filter, time/tokens/cost/tool-tally cells), Job (signed
  declaration), Ask (open ask plus archived asks, i-of-n) and Inbox (stops list) tabs. It works at
  390px width. It never writes; an expired unresumed ask draws `[!]`, and unknown data reads as
  "not recorded", never as a number. Built on one reader per book (`src/panel/data.js`).
- CLI: `--root` is resolved to its real path once at command start (one helper for run, resume,
  inbox, show, answer, panel; a missing root fails by name). Everything inside the root stays
  under bareguard's symlink refusal.
- Deps: `bareguard` bumped to `^0.19.2` — a symlinked `fs.readScope`/`fs.writeScope` root (or any
  symlinked ancestor) is refused at Gate construction and denied `.symlinkRoot` on every later
  check, closing the `<runDir>/out`-symlink write escape. `resolvePrimitives` turns the construct
  throw into a red with no tools for the step, and `runFlow`/`resumeRun` (new `primitiveReds`
  option, wired by `bin/fwdloop`) refuse the run by name at $0.
- Audit: every model-attempt `audit.jsonl` row (and its `log.json` attempt entry) carries
  `refused`, an array of `{ verb, path, rule }` for each bareguard fs-gate refusal that attempt
  (`[]` when none, never omitted). Rows with no model call carry `refused: []` too.
- Deps: `bareguard` bumped to `^0.19.1` (patch: a file action with no path is denied `fs.invalidPath`; `bash.allow` matches whole words; blank allow entries rejected — none affect fwdloop, which sends absolute paths and grants no bash).
- Deps: `bare-agent` bumped to `^0.48.0`; `makeProvider` sets `exposeMalformedArgs: true`, so the
  "arguments were not valid JSON twice" red carries the model's raw broken arguments again
  (`; raw: ...`, capped at 500 chars upstream, ` (truncated)` appended when clipped). Provider
  error bodies are still not exposed.
- Deps: `bare-agent` bumped to `^0.47.0`, `bareguard` bumped to `^0.19.0` — pulls in
  `createShellTools({ noFollowSymlinks: true })`/`resolveToolPath` (bare-agent) and bareguard's
  fs `Gate` (deny-by-default read/write scopes, symlink-safe resolved-path checking on by
  default), both wired into `src/primitives.js` — see the "Fixed" entry below.
- Amendment M4a-3 (docs/wiki/the-module-ladder.md, "M4a"): every new `audit.jsonl` row also
  carries `tools`, a `{toolName: count}` tally of every GRANTED tool the model actually invoked
  that attempt, summed across every round — taken straight from bare-agent's own per-round
  `result.metrics.byTool` (never a separately-maintained hook, so an unknown-tool name the model
  hallucinated is counted the same honest way bare-agent already counts it); `{}` when the model
  called no tool, `null` only when the row has no model call at all. A tool name the step never
  granted is flagged in `ungranted` (an array, omitted when empty) — bare-agent refuses it before
  `execute` ever runs, and this amendment records that refusal rather than folding it into `tools`
  as if it had been allowed. `src/books.js`'s `appendAudit` refuses at write time an omitted
  `tools`, a model-call row with `tools: null`, a malformed `tools`/`ungranted` shape. Rows written
  before M4a-3 simply lack the keys; `auditRowTools(row)` (`src/books.js`, re-exported from
  `src/index.js`) reads them back as "not recorded (before M4a-3)" rather than inventing a tally.
  Now wired into the panel: `src/panel/data.js` uses `auditRowTools` for the Audit tab's tool
  tallies (commit 9064e7c).
- Amendment M4a-2 (docs/wiki/the-module-ladder.md, "M4a"): every new `audit.jsonl` row now
  carries `at` (ISO time the attempt finished) and `tokens` (`{inputTokens, outputTokens,
  cacheReadTokens}` summed over that attempt's model calls, threaded from the same per-round
  metering `src/model-step.js` already sums into `costUsd` — never re-derived from spend.jsonl by
  position; `null` when the row has no model call). `src/books.js`'s `appendAudit` refuses at write
  time a row with an invalid/missing `at`, an omitted `tokens`, or a model-call row with no
  `tokens`. Rows written before M4a-2 simply lack the keys; `auditRowTokens(row)` (`src/books.js`,
  re-exported from `src/index.js`) reads them back as "not recorded (before M4a-2)" rather than
  inventing a number.
- Amendment M4a-1 (docs/wiki/the-module-ladder.md, "M4a"): every park now writes a permanent,
  write-once archive of its ask into the run dir, `asks/<askId>.json` (question, askedAt,
  expiresAt, evidence), alongside the existing (mutable) `ask.json`. Nothing deletes an archived
  ask — not resume, not answer consumption, not rerun. `writeAskArchive`/`listArchivedAsks`
  (`src/ask.js`, re-exported from `src/index.js`); `listArchivedAsks` pairs each archived ask with
  its consumed answer by `askId`, never by position, and reports "draft not kept (before M4a-1)"
  for a run with no `asks/` dir. Now wired into the panel: `src/panel/data.js` uses
  `listArchivedAsks` for the Ask tab (commit 9064e7c).

### Fixed
- `read`/`grep` `role` lookup is own-key only: `__proto__`/`constructor`/`toString` now get the named `no frozen input for role` refusal instead of a raw TypeError. Stale `allowedRoots` comment reworded.
- Fix-once switch-over (fix-ledger "step `write` may overwrite frozen inputs"): `src/primitives.js`
  now routes `read`/`grep`/`write` through a bareguard `Gate` (readScope: the run dir + every
  frozen input's own directory; writeScope: ONLY `<runDir>/out` — the run dir root, `state.json`,
  `audit.jsonl`, `spend.jsonl`, `answer*.json`, `ask.json`, and `inputs/` are readable but no
  longer writable) plus `createShellTools({ noFollowSymlinks: true })`, which refuses (`ELOOP`) a
  symlinked FINAL path component (file, dir, or dangling link) at open time, closing the "open
  what the check approved" gap the old lexical-only check left. The old `isPathAllowed`/
  `sandboxError` pair (lexical containment only, no resolved-path/symlink check, and one writable
  root covering the whole run dir) is removed. `<runDir>/out` is created lazily on the first
  actual write, never at tool-resolve time, so `bin/fwdloop`'s own predicted-run-dir call before
  `runFlow` creates anything stays a no-op on disk for a run that goes on to refuse.
- BA-27 (bare-agent >=0.47.0): a malformed tool-call's arguments are now reported via
  `result.malformedToolCall: { name, error }` on a normal `generate()` return instead of a thrown
  `SyntaxError` — `src/provider.js`'s `MalformedToolCallTolerantOpenAI` read the old throw-based
  shape and silently stopped catching the case under 0.47 (the F28/2026-09-15 red degenerated into
  the wrong "returned text instead of the tool" message). Now reads `result.malformedToolCall` as
  delivered; `rawArguments` is no longer recovered from a private response field (bare-agent never
  echoes it back) — `src/model-step.js`'s red omits "; raw: ..." when it's absent.
- F48 (docs/logs/FINDINGS.md): F36 refused `runs/` itself being a symlink, but a runId-named
  symlink INSIDE `runs/` pointing outside `--root` was still followed — the panel's
  `GET /api/runs/<flow>/<runId>/audit` route returned the symlink target's `audit.jsonl` at HTTP
  200. `resolveRunDir` (`src/flow.js`) now `realpathSync`s `runs/` and the run dir (when they
  exist) and refuses either one if it resolves outside the flow directory; a not-yet-created run
  dir is unaffected. The panel's own flow-name segment (`resolveFlowDir`, `src/panel/data.js`) got
  the same real-path check, closing a symlinked-flow-directory variant of the same hole.
- F48 round 3 (docs/logs/FINDINGS.md): the same class one level deeper — a real (non-symlinked) run
  dir whose own book FILE (`audit.jsonl`, `ask.json`, `state.json`, `log.json`, `spend.jsonl`, an
  `asks/<id>.json` archive entry, a consumed-answer marker) is a symlink pointing outside `--root`
  was still followed by every reader. New `resolveInside`/`readFileInside`/`readdirInside`
  (`src/flow.js`) is the one mechanism every reader in `src/books.js`, `src/runner.js`,
  `src/provider.js`, `src/ask.js`, and `src/panel/data.js` now routes through. This round also
  corrects round 2's wrong "not actually exploitable" claim about `bin/fwdloop`'s CLI: a live
  plant showed `fwdloop inbox`/`show` printing a symlinked `ask.json`'s outside content as a real
  ask (status 0, no refusal) — `findRunDirByAskId`/`cmdInbox`/`cmdShow`/`cmdResume` built their own
  paths with a private `join()` + raw `readdirSync`/`readFileSync`, bypassing
  `checkFlowName`/`checkRunId`/`resolveRunDir` entirely; they now walk flows/runs via
  `listFlowNames`/`listRunIds`/`resolveRunDir` and read book files via `readFileInside`, same as the
  panel. Several writers (`appendAudit`/`appendHistory`/`appendSpendRow`, `log.json`/`state.json`/
  a fresh park's `ask.json`, `inputs.json`, an `overwrite:true` artifact write) are reported, not
  fixed, in `docs/logs/FINDINGS.md`'s F48 round-3 entry — `answer.json`/`asks/<id>.json` are already
  safe (`{ flag: 'wx' }`).
- F48 round 3 follow-up (docs/logs/FINDINGS.md): round 3 itself missed one reader —
  `resumeRun`'s own inline `state.json` parse (as opposed to `readRunState`, its already-converted
  display sibling) was still a raw `readFileSync`. A parked run whose `state.json` was swapped for
  a symlink to a forged outside file (spend matching the run's own `audit.jsonl` sum, `expiresAt`
  far in the future) resumed straight to completion instead of being refused. Now goes through
  `readFileInside` like every other reader in `src/runner.js`. The same audit found `readArtifact`
  (`runs/<runId>/artifacts/<id>.json`) was the same class of bypass — converted too. Added
  `test/f48-guard-raw-reads.test.js`, a mechanical scan that fails on any raw
  `readFileSync`/`readdirSync`/`createReadStream`/`openSync` call in `src/**/*.js`/`bin/fwdloop`
  outside a narrow, per-call-site allow-list, so a future missed reader fails a test instead of
  waiting for another debrief.
- F48 round 4 (docs/logs/FINDINGS.md): round 3's fix collapsed `readArtifact`'s result to one
  value (`undefined`) for BOTH "never written" and "read refused" — a swapped/deleted accepted
  artifact at the send slot looked identical to "nothing to send yet". Added `readArtifactResult`/
  `readArtifactsMapChecked` (tri-state: `ok` / `missing` / `red`); every call site that can see
  fresh content now halts the run by name on a `red` instead of silently feeding tampered content
  forward. `readArtifact` survives only as a documented collapsing wrapper for the four call sites
  the resume "done?" gate already proved `ok`. `src/send.js` now refuses `undefined`/`null`/
  non-object/array content by name, writing nothing, instead of serialising `content ?? null`.
  Replaced `test/f48-guard-raw-reads.test.js` (evadable via an aliased import, a namespace
  dot/bracket access, `fs/promises`'s `readFile`, or a pasted copy of an allowed line — a debrief
  proved all four) with `test/f48-guard-fs-imports.test.js`: an import-level scan that pins the
  EXACT per-name use count of every `fs` binding reached per allow-listed file (aliases and
  namespace/default access fold under the real name), catches `require('fs')` via a
  `createRequire`-aliased local name, and pins `readArtifact(`'s 4 remaining call sites in
  `src/runner.js`. Finding C (no hash of the ACCEPTED ARTIFACT'S CONTENT — send trusts whatever is
  on disk at send time) is reported, not fixed; hamr sent it to M4b as a signed-amendment
  candidate, not yet signed.
- F47 (docs/logs/FINDINGS.md): `fwdloop show` (and `bin/fwdloop`'s `artifactText()`) read
  ask.json's evidence only in the M3 shape (`evidence.artifact.text`/`evidence.unjudged`) and
  printed the literal string `"undefined"` for a real M2-era ask.json (`evidence.text`/
  `evidence.lines` directly), or for an ask.json with no `evidence` key at all. One shared reader,
  `readAskEvidence()` (`src/ask.js`, re-exported from `src/index.js`), now normalises all three
  real shapes — M3, M2, and none (parked pre-F45) — into `{ draft, unjudged, why? }`, never
  inventing `"undefined"`/`""`/`0` for missing data; an unrecognised shape is a named `why`,
  never a crash. `fwdloop show` and `poc/m4/panel-data.mjs`'s Inbox evidence fields both use it.
- Path escape: `bin/fwdloop`'s `--run-id` (and `resume`'s runId positional) could name a path
  outside the flow's `runs/` directory (e.g. `--run-id ../../../../tmp/pwned`). Both now go
  through one shared `resolveRunDir` (`src/flow.js`): a strict allow-list on the runId's
  characters, then a check that the built path actually resolves inside `runs/`. `runFlow`/
  `resumeRun` (`src/runner.js`) carry the same check as defense in depth. A run id generated by
  the CLI, or a rerun id (`<runId>-rerun-1`), is unaffected.
- F46 (docs/logs/FINDINGS.md): a step whose declaration grants a verb `resolvePrimitives` has no
  wired implementation for (e.g. litectx's `compress`) used to print a warning to stderr and let
  the run continue and spend against it. `bin/fwdloop`'s `run`/`resume` now refuse at preflight,
  naming the step and the verb, before any model call or ledger spend. Wiring the litectx verbs
  themselves is still open.

## [0.6.0] - 2026-09-26

M3: a run parks at a signed ask and resumes in another process, a `fwdloop`
CLI, rerun as a fresh run.

### Added
- `resumeRun`/`makeParkingAskStep` (`src/runner.js`) and `answerAsk`/
  `makeFileAskStep` (`src/ask.js`): a run now parks at the signed ask and
  exits instead of blocking in-process; resume locks the run, re-verifies
  flow identity, signature, frozen inputs, artifacts and spend, consumes the
  answer once (rename), and continues from the same step index.
- A per-ask signed TTL now governs expiry (F43) in place of a fixed
  in-process wait; an expired ask cancels the run carrying its real spend,
  never `$0`.
- `bin/fwdloop` CLI: `run` (parks at the ask and prints the answer command),
  `inbox` (lists open/expired asks, read-only), `answer`, `resume`, and
  `show <askId>` (prints the parked ask's evidence, read-only); the key
  loads from `DEEPSEEK_API_KEY` only, refused at $0 before any run dir or
  book row is written.
- `rerun "<reason>"`: starts a fresh run (`<runId>-rerun-1`) with its own
  frozen inputs, cap and redo counter; the reason is recorded as the first
  step's gap; the old run's history row is marked `rerun`.
- `src/declaration.js`: a send's "earlier" signed ask is now judged by step
  order in `declaration.steps`, not by prose line number (M3 item 8),
  matching how the runner actually folds over steps.

### Fixed
- (F45) `inbox` no longer shows an unanswerable ask as open: an M2-era ask
  reads as "legacy (not answerable)", a malformed one as "unreadable", both
  naming the run.
- (F45) A parked ask carries its evidence (`artifact`, `unjudged`) forward
  on every park/re-park; a run's history `wallMs` is now measured from the
  run's real first start, not from the resume that reported it.
- An unparseable `expiresAt` (`Number.isNaN(Date.parse(...))`) is never
  treated as unexpired, in both `answerAsk` and `resumeRun`.
- `resumeRun` refuses a negative spend or a spend below the run's own
  `audit.jsonl` sum, instead of resuming on a state row that doesn't add up.
- The audit-sum check tolerates floating-point summation order
  (`SPEND_TOLERANCE_USD` = `1e-9`), so an honest retry-floor run no longer
  false-refuses.
- Removed an unreachable send ask-count branch (`askIdsInReads.length !==
  1`): `readFlow` already validates exactly one earlier signed ask at
  signing time.

### Known limits
- Resume is manual after an answer is written — nothing watches for the
  answer and resumes the run automatically.
- A `runId` (`run --run-id`, `resume <runId>`) is not validated: a `..` in
  it can place the run's files outside the flows tree. Only the operator
  types it today; it is on the fix list before the UI takes run ids.

## [0.5.0] - 2026-09-25

M2: the runner — one fold over a signed flow, live-wired to a provider, with
an in-process human ask and a signed send.

### Added
- `src/runner.js`: one fold over a signed flow at $0 baseline — `readFlow`+
  hash refusal, frozen inputs, executor built without close or cap (a leaky
  double reds on construction), closers by class (citation core; every
  `SHAPE_KEYS` checker, all failing checks reported), ralph loop
  (`STRIKE_LIMIT` 2, attempt fallback 4), cap-halt before the attempt,
  pricing-red on null cost, provider-red after one retry, ask with redo cap
  and consume-once answers, write-time send re-check, `audit.jsonl` +
  `history.jsonl` (one writer each). Amendment 1 (signed 2026-09-24):
  `checkDoneBlocker` halts a step red on `done:false` (outcome `not-done`,
  kept in `log.json` but stripped before closers/disk); unjudged hitl
  artifacts carry forward into the next signed ask as
  `evidence.unjudged`/`unjudgedCount`. F42: a send whose `reads` hold none or
  more than one signed ask's artifact halts red before `sendStep`, so does a
  send whose ask was not accepted this run.
- `src/provider.js`: model slots, rates, ceiling, key preflight.
- `src/model-step.js`: metered rounds, malformed tool-call retry, transport
  floor, wall-halt never retried, `emit_artifact` schema gains the typed
  `done` (required)/`blocker` self-report fields, by class only.
- `src/declaration.js`: `validateDeclaration` reds a hitl step after the last
  signed ask that isn't the send slot (Amendment 1); requires exactly one
  earlier ask emit in a send's `reads` (F42).
- `src/primitives.js`: sandboxed read/write/grep; `readDocx`/`addressCells`
  by role. Amendment 2 (signed 2026-09-24): read/grep list and accept only
  text roles (`.md`/`.txt`); a `.docx` role is refused by name pointing at
  `readDocx`, `.csv` at `addressCells`, any other extension "no text
  primitive serves it" — enforced on the role name beyond the schema enum;
  no `role` property emitted when no text role exists.
- `src/ask.js`: in-process file ask — consume-once answers, stale-answer
  quarantine, timeout halt.
- `src/send.js`: the file send primitive — ships to a signed destination,
  re-checking it at write time.
- The M2 gap-back healing POC and live-wiring drivers live under `poc/m2/`
  in the repo (not shipped in the published package).

### Fixed
- Artifacts are written to `runs/<id>/artifacts/` by one writer and read
  back from disk; `log.json` keeps every attempt's raw model output on every
  exit path, including halts; a late `answer.json` is audited as
  answer-after-run.
- (F41) Halted runs carry `signatureHash` on the history row (`null` only
  before `readFlow` succeeds); an attempt's audit `usd` sums a retried
  transport fault's priced floor with its own cost, so audit rows sum to
  history `spentUsd` (never `?? 0`, a known partial is never dropped).
- `closeWordsAndSections` (shape closer) reports every failing check
  (`reds[]`, joined red) instead of first-red-wins, and its heading sentence
  states the form (F38).

## [0.4.1] - 2026-09-23

### Fixed
- `poc/m0/runner.mjs` — `checkSendDestination` now follows a send target's
  realpath after the lexical containment check, refusing a symlink inside
  the repo that resolves outside it (was lexical-only).
- `src/declaration.js` — `close.shape` now enforces a signed v1 vocabulary
  (`maxWords`, `sections`, `linesPerInvoice`, `mustCarry`, exported as
  `SHAPE_KEYS`); any other top-level key inside a shape reds by name;
  `sections`/`mustCarry` must be non-empty arrays; any shape that is not
  an object reds too; new `checkShapes(declaration)` for batch scoring.
- `poc/m0/drafter.mjs` — the drafter prompt and tool schema now name the
  four signed shape keys, built from `SHAPE_KEYS` so prompt and validator
  cannot drift; measured 40/40 shape-green on deepseek-flash vs 2/60
  before (F37).
- `src/flow.js` — `readFlow` now checks `runs/` exists, is not a symlink,
  is a directory, and is readable, combining with the other file-read
  reds.
- `poc/m1/slot-batch.mjs` — `shape=` column per draft, `shapeGreen` in
  SUMMARY and `--rescore`.
- `poc/m0/runner.mjs` — `sendViaPrimitive` takes the signed `file:` target and
  re-runs `checkSendDestination` at write time, so a destination swapped for
  an outside symlink during the human ask pause reds instead of landing
  outside the repo (was checked once at preflight only).
- `src/declaration.js` — `checkShapes` now reds a `close.shape` that isn't a
  plain object (array, string, number, null) and still counts it toward
  `shapedSteps`, matching `validateDeclaration`'s existing red for the same
  malformed input (previously it silently skipped a non-object shape,
  counting and redding neither).

## [0.4.0] - 2026-09-22

M1: the flow module — signed prose and declaration become real `src/` code
(five pieces: arbiter grammar, signature, declaration, catalogue, flow
directory), plus the three signed M1 amendments and the paid-path batch
tool.

### Added
- `src/signed-text.js` (piece 1): typed arbiter grammar (cap, ask+ttl, redo
  cap, send, skills, source, round budget) — every red is by line and
  field, no regex run against signed text. A send requires an earlier ask;
  `url:` kinds refused until M9.
- `src/signature.js` (piece 2): sha256 hash pinning over canonical prose
  (CRLF→LF only) and canonical declaration JSON (sorted keys); signature
  version 2 pins who signed and when (`[proseHash, declHash, signedBy,
  signedAt]`), any other version refused by name; `verifyFlow` names the
  file that changed.
- `src/declaration.js` (piece 3): closed declaration schema — unknown key
  refused by name and path, arbiter keys refused at any depth;
  `inputFacts`/`picks` replace `realColumns`/`columns` (Amendment 1, signed
  2026-09-21); ask slots and a send lock on `arbiter.asks[]`/`sends[]` with
  writes checked by catalogue class and a walkable chain; job #1 and job #2
  validate through one code path.
- `src/catalogue.js` / `src/catalogue.json` (piece 4): the primitive
  catalogue as a data file (14 primitives, 4 plumbing), parsed against a
  closed schema; `checkpoint` moved from the drafter's menu to plumbing
  (F31: a pause exists only where a human signed one); own readers
  (`addressCells`, `readDocx`) pinned as unresolved until their modules
  land in `src` at M2.
- `src/flow.js` (piece 5): the one reader and one writer of
  `flows/<name>/` (`prose.txt`, `declaration.json`, `signature.json`,
  empty `runs/`) — `writeFlow` writes nothing unless the text parses, the
  declaration validates and a caller-supplied `signedBy` signs it; never
  overwrites a signed flow; signature written last and read back;
  `readFlow` verifies the hash on the bytes on disk before trusting
  anything and refuses symlinks.
- `types/*.d.ts` for all five `src/` modules, per `LIBRARY_CONVENTIONS`.
- Amendment 3 (signed 2026-09-21): the ask becomes a mark on its own
  numbered line — `N. ask: <words>` or `N. ask <int><s|m|h>: <words>`,
  words required, zero wait refused; `guardrail: ask at line N` is no
  longer grammar and reds once, naming the line; duplicate-ask red deleted
  as impossible by construction. The one step bound to a signed ask line
  now grants no primitive, else reds naming the line, step and verbs
  (before: a read/write step on the ask line validated green).
- `poc/m1` batch tool: `--job job1|job2|twoask` selects the prose (ask
  lines always parsed from the chosen one, job name in output paths,
  unknown job refused at $0); M1's own ledger
  (`poc/m1/out/spend.jsonl`) under `M1_CAP_USD` 5.00; a live batch saves
  the prose it ran against per tag, and `--rescore` prefers the saved
  prose and never overwrites consumed results; a draft with no
  declaration now keeps what actually came back (outcome, the model's
  text verbatim, the provider's message) instead of a bare null; the live
  key is redacted by literal replacement (trimmed and raw forms) before
  provider or model text reaches an artifact or the jsonl row.
- A default ceiling price always exists (hamr's ruling 2026-09-21, F31): a
  null-cost row is priced at read time — a known model at its own peak
  rate, an unknown model at the table's highest — never rendered as
  unknown or as $0; the cap lock survives as money, and the rate table is
  the human override.

### Fixed
- **The publish workflow now fails when `package-lock.json`'s version drifts from `package.json`.** npm writes that field on install, so a release that bumps `package.json` without running one leaves it behind — and nothing caught it: `npm ci` fails when the lockfile's *dependency* entries disagree, but never checks the lockfile's copy of the project's own version. `scripts/check-lockfile.mjs` (`npm run check:lockfile`) compares both places npm writes it and runs in the publish workflow. No lockfile is not a failure.
- (F35) The batch checker never had the stop-only rule, and the ask mark
  had never actually run in front of a paid model; both fixed. Old
  job1/job2 tags rescored at $0 with 0 stop-only hits; F34's two-ask count
  corrected to 14; re-measured on `deepseek-flash`: job1 20/20, two asks on
  their own lines 20/20 with every read bound to its line.
- (F34) The two-ask fixture had signed an ask on a line that also carried
  work, invalidating F33's 20/20 reading; corrected. A 691s provider red
  on the job #2 path was traced to a machine suspend plus an `ECONNRESET`
  on resume, not a deadline gap — the 240s race covers both draft paths
  (retraction of the earlier F34 deadline claim).
- `package.json` `files` drops `bin` and `fwdloop.context.md`, neither of
  which exist (`npm pack` unchanged, 19 files).

### Changed
- `ledger`/steps.txt now carries the ask mark directly instead of the
  retired `ask at line N` guardrail text (same parsed slot); the M1 ladder's
  scope item 2 names `picks`/`inputFacts`, not the dead `columns`.
- M0's `parseArbiterSlots` learns the ask mark (the legacy `ask at line N`
  form is kept for M0 fixtures only; both forms present at once is an
  error).

## [0.3.0] - 2026-09-16

M0b Amendments A and B: the redo edge (`askWithRedo`) and job #2 — a second
job, resume/JD in from a `.docx`, drafted and run through the same signed
fold as job #1.

### Added
- `shape.mjs`: declared-shape close (`closeWordsAndSections(text, {maxWords,
  sections})`) — green/red naming the word count and limit, or the
  missing/out-of-order heading; unparseable for non-string input.
- `redo.mjs` (Amendment A): `askWithRedo` — a typed, tighten-only redo cap
  (1..3, >3 refused); a reason-less rerun is refused and re-asked without
  spending a redo; every attempt/reason/cost is written to `audit.jsonl`
  with a parent; a 4th rejection halts the run naming the step; unknown
  cost is never rendered as 0.
- `docx.mjs`: stdlib `.docx` text reader — hand-parsed zip (EOCD, central
  directory, local header, inflateRaw/stored, CRC-32 and size verified)
  plus paragraph/run extraction from `word/document.xml`; negatives
  (non-zip, missing `document.xml`, truncated, CRC mismatch) never throw.
- `job2.mjs`: job #2's own fold, hard-wired to its shape — read docx, read
  JD, compose under `askWithRedo`, send on accept. Reuses `freezeInputs`,
  `checkFreshRunDir`, `checkSendDestination`, `runModelStepOnPrimitives`,
  `sendViaPrimitive`, `checkStepHappened`. Catalogue gains `readDocx`.
- Drafter/scout job #2 path: `scoutJob2` gives $0 shape facts (docx
  paragraphs/words, md headings) with body text withheld; `draftJob2`
  reuses job #1's paid `emit_declaration` round; `bindJob2DeclarationSteps`
  and `checkJob2Grants` bind steps by line and check grants
  (readResume→readDocx, readJd→read, send→write).
- `JOB2_SHAPE` headings taken verbatim from hamr's own prose ("summary of
  work history" etc.) rather than the ladder's paraphrase.
- Three signed checks on job #2's compose step: a `.docx` 20 MB cap
  enforced at two layers, the send target must resolve inside the repo,
  and job #2's inputs are fenced as data in the compose prompt (not
  instructions) — plus the CRC-mismatch test the review ledger asked for.

### Fixed
- (F29) One human rerun replayed as four rejections and halted the run at
  the redo cap with no human in the loop; `answer.mjs` now renames each
  answer to `answer.attempt<n>.<seq>.consumed.json` the moment it is read,
  and quarantines (`stale-answer-ignored`) any answer whose `answeredAt`
  predates its ask's `askedAt`.
- (F30) A drafter report file passed as `--declaration` reds at preflight
  ("declaration must have a non-empty steps array"); `job2.mjs` now
  unwraps it the same way `runner.mjs` already does.

## [0.2.1] - 2026-09-15

### Fixed
- Runner tests seeded from committed fixtures under `poc/m0/fixtures/stale-run/`
  instead of git-ignored `poc/m0/out/` dirs, so the suite passes on a
  tracked-files-only checkout (CI). v0.2.0 was tagged but never published to
  npm because the publish workflow's Test step failed on these two tests.

## [0.2.0] - 2026-09-15

M0b: "run it, close it" — the drafter's declaration runs for real, against real
baresuite primitives, under a signed send lock.

### Added
- Runner: executes a drafter declaration as a fold over steps (PRD §5) on real
  baresuite primitives (`gather`/`ask`/`send`/`derive`/`compose`) instead of
  mocked I/O — each step in a fresh Loop carrying only its goal line and the
  prior steps' compact artifacts.
- Signed arbiter send lock: typed slots wired to a real job line, proven by
  preflight grant checks rather than prompt wording (F24).
- Preflight: freezes inputs, binds by line, checks grants, and resolves the
  destination and cap before a run starts.
- `close.mjs`: deterministic $0 close per step that decides green/red; first
  red ends the run. Close classes cover the mechanical and model-derived
  steps.
- Batch harness (`poc/m0/batch.mjs`) for repeated stability runs (Amendment
  C, 20 runs per plant per provider), every accept a real human accept.
- Every primitive run writes `<runDir>/log.json` with each model stage's
  args and reply, so a compose red keeps the reply it refused (F28).
- A 240s total deadline on every live model round, so a zombie stream reds
  in 4 minutes, not 15 (F27).
- A malformed tool-call arguments string is now metered and retried once,
  never read as an unknown-cost transport red (F28).
- `litectx` and `bareguard` installed as real dependencies; catalogue
  entries resolve against the real package exports, not bareloop's tool
  wrappers (F23), and every entry carries a `desc` shown on the
  drafter/scout menus.
- PRD guiding principles, borrowed from bareloop's `CYBERNETICS.md` as
  reminders (not features), signed by hamr 2026-09-15.

### Changed
- Catalogue's `remember`/`forget` moved to a new "memory" skill (M0b
  orchestrator ruling).
- `send()` takes its allow-list from the caller instead of a hard-coded
  copy.

### Fixed
- Sheet stage grant now requires `addressCells` only, matching the
  drafter's menu — the two had disagreed and refused fresh drafts at
  preflight (F26).
- An identifier must carry its own citation: compose could pass a made-up
  invoice number through the close undetected (F25 / M0b negative
  scenario).
- `checkpointAsk` prints an ASK OPEN notice instead of silence; a stale
  `answer.json`/`ask.json` is now caught as a pre-accept hazard.
- A failed attempt's spend row always carries `costUsd: null`.

### Removed
- Real mail egress (`mailproof`) dropped as a wrong-fit primitive for this
  catalogue.

## [0.1.0] - 2026-09-13

### Added
- Scout: a bounded, read-only-by-construction step that gathers grounded facts for the drafter (`poc/m0/scout.mjs`).
- Primitive catalogue and artifact space as data, with one writer for cell addresses (`poc/m0/catalogue.mjs`, `poc/m0/artifacts.mjs`).
- Draft table: the two numbered lists (job lines, guardrails) joined and shown from both ends, plus a redraft round (`poc/m0/drafttable.mjs`, `poc/m0/redraft.mjs`).
- Deterministic walkable-chain validator (`poc/m0/validator.mjs`).
- Detection of a silently substituted model: a live ledger row's `modelMatch` is checked against what was actually served, not just what was requested (F14, F22).
- A test that fails if any provider slot's default model has no price, so a model rename can no longer silently price a run at $0.

### Changed
- Baseline model switched from `deepseek-v4-flash` to `deepseek-flash` (DeepSeek-V4.1-Flash): DeepSeek retired the old model, and requests naming it were silently served by V4.1-Flash (F22).
- The drafter now names primitives instead of step kinds, sends each job line once per round (previously twice), and enforces strict 1-for-1 job-line-to-guardrail mapping — it can no longer point at another line's guardrail.
- Docs reorganised under `docs/{product,wiki,logs,archive}`.

### Fixed
- Redraft now sums every round's token usage instead of only the last, so cost was previously understated.
- Scout's "reported" count is now computed from grounded columns instead of raw ones.
- A scout round truncated at the output cap now reads as `TRUNCATED`, not a no-call.
- A refusal's line is now keyed on a typed `line` field instead of parsed prose, in both the validator and the redraft's refused schema.
- A redraft now carries a prior refusal forward unless a step reclaims it.
- `resolveModelRate` checks own properties (`Object.hasOwn`), so a model id like `constructor` or `toString` can no longer resolve to an inherited value and slip past the no-rate guard.
- The scout CLI takes its default model from the provider slot instead of a hard-coded retired name.

### Removed
- Superseded POC scripts `poc/m0/bakeoff.mjs` and `poc/probe-synthetic.mjs`.
