# M4e first POC results (2026-10-05)

$0, stub providers only (`FWDLOOP_TEST_DRAFT_PROVIDER`, `FWDLOOP_TEST_MODEL_STEP`, `NODE_ENV=test`). Every child ran with a scratch
`HOME` and `FWDLOOP_CONFIG_HOME` under a mkdtemp dir that is deleted at the end. No `src/` or `bin/` change.
Run: `node poc/m4e/claim-a.mjs`, `claim-b.mjs`, `claim-c.mjs` (each prints PASS/FAIL per row, with the hypothesis that would make it FAIL).

Scorecard: (a) PASS 14/14. (b) PASS 12/12 (plus one dead-draft GAP, below). (c) 6 PASS, 1 FAIL (c5, a model that quotes the key into a run artifact).

## (a) Page sign binds to what the human saw — PASS

Script: `poc/m4e/claim-a.mjs`; `pageSign` in `poc/m4e/page-sign.mjs` (typed name vs `target.json` name, THEN `signDraft`).
Drafts made through the real CLI (`fwdloop draft`) with a fake provider; `spec.hash` read from the draft dir.

| row | would FAIL if | measured |
|---|---|---|
| a1 edit `declaration.json` after the hash was read, `signDraft({approve: oldHash})` | it signs, or the flows root changes | refused ("--approve does not match the draft as it is now"); flows root empty before and after |
| a1b control: the edit changed the bytes | bytes equal | differs=true (so a1 could fail) |
| a1c edit `prose.txt` (one trailing newline) | it signs | refused; flows root empty |
| a1d stale hash vs tampered files | it signs | refused |
| a2 unmodified + right hash | it refuses a clean draft | signs; `flow-four/{declaration.json,prose.txt,signature.json,runs/}` written |
| pageSign: missing name / empty / wrong / wrong case / trailing space | any signs, or the flows root listing differs | all refused, listing identical before/after (each row compares to the listing taken just before) |
| pageSign right name + WRONG hash | signs | refused by the inner gate |
| pageSign right name + right hash | refuses | signs, `signedBy` carried |
| pageSign a second time on a signed flow | overwrites | refused ("prose.txt already exists"), `signature.json` bytes unchanged |

### Finding from (a): the send folder must be inside the fwdloop install dir (card field "Send to")
`src/runner.js:62` sets `REPO_ROOT` to the package dir; `checkSendDestination` (`src/runner.js:341-368`) does `join(REPO_ROOT, <path after file:>)`
and refuses anything outside it. A draft with `file:/abs/scratch/out` drafts fine but fails at SIGN with
"send target directory ".../fwdloop/tmp/claude-1000/.../abs-out" is not writable (ENOENT)" (a leading `/` is joined under REPO_ROOT, not treated as absolute).
Consequences for M4e: (1) the scope's "`file:<folder>` the human types" only works for a folder INSIDE the package dir; for an npm install that is
`node_modules/fwdloop/...`, so a normal user has no usable send folder. (2) The card's "$0 checks before any spawn: the send folder resolves" must use this
same function or it passes a path that fails later at sign. (3) The refusal text prints the joined path, which is confusing for an absolute input.
This predates M4e (the CLI has the same behavior); the POC uses a repo-relative scratch folder (`poc/m4e/scratch-out-*`, removed at the end).
Needs hamr's ruling before the card's Send-to box is built.

## (b) Detached children survive a panel kill — PASS, with one GAP

Script: `poc/m4e/claim-b.mjs`, `poc/m4e/mini-panel.mjs` (spawns `bin/fwdloop` as `src/panel/resume.js` tryOnce does: `detached:true`,
`stdio:['ignore',fd,fd]`, array argv, no shell, `unref()`, env = `keysForDoor()` merged env), `poc/m4e/reattach.mjs` (a FRESH process that is given
only a run dir path; reads files + `runLiveness`/`isFwdloopAlive`/`readResumeLock`). Panel killed with SIGKILL from the orchestrator.

| row | would FAIL if | measured |
|---|---|---|
| b1a slow draft (5 s), panel SIGKILLed at 0.7 s | child dies with the panel / shares its group / still child of it | panel gone; child alive 1 s later, state S, pgid == pid (own group), ppid 1149 (reparented to the user's init, panel was 2636303) |
| b1b reader mid-draft | reader says stopped, or spec.hash already there | draft dir EMPTY (`files:[]`); hold row open + pid live |
| b1c wait for the draft | no `spec.hash` in 30 s | green draft: 8 files incl. `spec.hash`; hold row settled by the child's own exit hook |
| b2 sign it | | signs |
| b3a run (3 s/step), panel killed at 0.8 s; fresh reader at ~2 s | not `running`, or ask.json already there (timing control) | `runLiveness=running`; run dir has only `inputs/ inputs.json pids.jsonl`; no `state.json`, no `ask.json`; lock none; child alive |
| b3b after the run parks | no ask.json in 40 s, or liveness still running | `runLiveness=gone`, child exited; `ask.json` keys `[askId,question,askedAt,expiresAt,evidence]`; `state.json` keys `[runId,flow,signatureHash,inputsManifest,stepIndex,askId,expiresAt,spent,spendComplete,redone,evidenceUnjudged,unjudgedCount,startedAt]` (no `status` field: "parked" is read as `ask.json` present AND liveness gone); `pids.jsonl` 1 row, leg `run` |
| b3c running vs parked distinguishable | identical readings | t2 running/no ask vs t3 gone/ask: different |
| b3d child log | empty | `parked: askId=... expiresAt=... spentUsd=0.003` then the answer hint |

So the re-attach rule that works from files alone: **run dir: `ask.json` present => parked; else `runLiveness`: running => working, gone => stopped/finished (read `history.jsonl`/books), unknown => 10-minute books rule.**

### (b) dead-draft GAP (recorded, not fixed): a draft dir carries no liveness signal of its own
Slow draft (20 s), child SIGKILLed from outside (b4a control: before the kill the reader sees live; b4b after: dead):
- Draft dir while running AND after the kill: **empty** (`files:[]`). `draftToDir` makes the dir (`src/authoring.js:198`) and writes nothing until the paid round returns, so no pid file, no `spend.jsonl`, no state. Running and killed are byte-identical by the dir alone.
- The ONLY signal is `<configHome>/runs.jsonl`: the `hold` row `{what:'draft', runDir: <realpath of the draft dir>, pid, procStart}` written by `takeMonthlyHold` (`bin/fwdloop:76`, row shape `src/monthly.js:5`) with no `settled` row. `isFwdloopAlive(pid, procStart)` on it reads live vs dead correctly (b4a `hold-open+pid-live`, b4b `hold-open+pid-dead`).
- The settle is a `process.on('exit')` hook (`bin/fwdloop:100`), so SIGKILL never settles it: a killed draft leaves an open hold with a dead pid (the next monthly check settles it as "process gone", `src/monthly.js:151`).
- This signal exists only when the keys/config home is active AND the hold was written (a test process with no config home skips holds, `bin/fwdloop:80-88`). If `/api/author/live` reads draft state from files, it has to join the draft dir to runs.jsonl by the realpath'd `runDir`, not from the dir. Pairing that with a pid file written into the draft dir by the child would be the simpler signal (scope item 12 says "pid liveness check"; it needs one of these two to be built).
- A dead draft's dir cannot be reused: a retry with the same `--out` exits 1 ("already exists — never overwritten, use a new dir") (b4d). The card must pick a fresh dir per attempt, and abandoned/dead dirs pile up.
- A SIGKILLed draft books NO spend row (spend is appended only after the round returns, `src/authoring.js` spend append). With a real provider the call may still have been billed. That is scope items 11 and 13's "keep its spend booked" for an abandoned draft: nothing is booked for a round in flight.

## (c) Canary key — 6 PASS, 1 FAIL (c5)

Script: `poc/m4e/claim-c.mjs`. Canary `sk-canary-M4E-7f3a9c1d2b8e4f60aa55` in `$FWDLOOP_CONFIG_HOME/.env` (0600) only, NOT in the shell env.
mini-panel children get the merged env (`keysForDoor`, as `server.js:581` `loadEnv`), like the real resumer. After draft -> sign -> run-to-park, the whole scratch
tree (draft dir, flows/runs, logs, `runs.jsonl`, books, audit) is grepped; counts per file:

| row | would FAIL if | counts |
|---|---|---|
| c1 fakes that do not echo | canary anywhere but the keys file | `cfg/.env=1`, nothing else |
| c2a draft + run fakes that ECHO `process.env.DEEPSEEK_API_KEY` to stdout and stderr | no canary in either child log | `drafts/d1.log=2`, `logs/run.log=2` (stdout+stderr), `cfg/.env=1`. The merged env DOES put the key in the child's `process.env`, and the raw log stores an echo verbatim (same as M4d (a)) |
| c2b ... any other file | canary in draft dir, audit, books, runs.jsonl, state, spend | none: every other file has 0 |
| c3 panel does NOT merge the keys file | canary in a child log | draft log `PROVIDER-ECHO key=undefined`; hits `cfg/.env=1` only (the CLI loads the file itself; the key is in the child's env only if the panel merges it) |
| c4a model puts the key in a step goal | canary beside the keys file | dropped: the drafter overwrites goals with the signed line; draft signs; `cfg/.env=1` only |
| c4b model puts the key in `emits` (not machine-set) | canary in the draft dir or log | red draft; `declaration.rejected.json` and `log.json` written, 0 canary (scrubbed); `cfg/.env=1` only |
| **c5 FAIL** a run model step that QUOTES the key in its artifact | canary in a run dir/book | `artifacts/{resume-text,jd-text,resume-summary}.json=1` each, `ask.json=3`, `asks/<id>.json=3`, `log.json=6`, `state.json=2`; `audit.jsonl=0`, `runs.jsonl=0` |

c5 is an honest FAIL of scope (c) "never appears in ... a book". Reading: there is no scrub on the run side. `scrub`/`sweepForSecrets` are used only by `src/authoring.js`
(draft) and `src/panel/resume.js` (resume log slice); `src/runner.js`/`src/model-step.js` write model artifacts, `ask.json` evidence, `log.json` and `state.json` raw.
It is only reachable if a model outputs a key it was never given (the key is not in any prompt; the provider reads it from env) or a provider error body echoes it; the run books then
hold it and the panel's Runs/Inbox would show `ask.json` evidence on the page. The scope's wording "or a book" is therefore stronger than what the code does.
Decision for hamr: either add a run-side sweep (a new job for M4e or earlier), or narrow the claim to "the key is never given to a model and never written by fwdloop itself".

## What this means for the M4e build
1. (a) holds: the hash-bound sign plus a typed-name gate in front of `signDraft` signs nothing on any mismatch. No change needed to `signDraft`.
2. (b) holds for running/parked runs. For drafts, scope item 12 ("a dead draft child is read as stopped") needs a decision: write a pid/state file into the draft dir (child, first thing), or read the runs.jsonl hold row. Today the dir alone cannot tell stopped from running.
3. (c) holds for the children's own logs only in the "does not echo" case; an echoing child puts the raw key in its log (log dir perms are the only guard) and a quoting model step puts it in run books (c5, FAIL).
4. New: the send folder must be inside the install dir (`src/runner.js:344`); the card's Send-to box has no usable meaning for an installed package until that is ruled.
