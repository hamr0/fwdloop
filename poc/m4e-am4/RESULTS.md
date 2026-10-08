# M4e amendment 4 (Stop, Resume, cap re-sign) + amendment 5 (per-run values) — POC results, 2026-10-06

$0, a fake `modelStep`, no provider, no key. Run: `node poc/m4e-am4/proto.mjs` (PASS/FAIL per row, exit 1 on a FAIL).
The runner is run for real: `src/` is copied to `poc/m4e-am4/.proto/src` (removed at the end) and patched at three exact
anchors (each must match exactly once): `foldFromStep` exported, a stop seam after a closed model step, an overlay hook after
`readFlow` that reads a per-run values file. `src/` is not touched. Home is a scratch dir; no config home.

Scorecard: 20 / 20 PASS (after fixing two wrong expectations in the harness itself, listed under "Harness fixes").

| row | would FAIL if | measured |
|---|---|---|
| p1.a | the run did not cap-halt | cap $0.0105, ceiling $0.01: step 1 funded, step 2 cap-halts before its call |
| p1.control | the same cap also let step 2 run | continuing under the SAME cap halts again at the same step (so the new cap is what moves it) |
| p1.wx | a version file could be overwritten | the second `wx` write of `signed-values-r1.json` is EEXIST |
| p1.b | the continue did not reach the ask | under cap $0.25 the same run id runs on to the signed ask and parks |
| p1.c | step 1 ran twice | step 1 called once in total; the cut step entered once; the rest once |
| p1.d | spend so far were dropped | parked at $0.003 = audit sum of 3 rounds (the cap-halt row's `usd: null` is skipped in the sum) |
| p1.e | the next park forgot the carried spend | `state.json.spent` equals the audit sum |
| p1.f | the flow's signed files changed | `prose.txt`, `signature.json` byte-identical |
| p1.g | a record was rewritten | step 1's artifact byte-identical; `audit.jsonl` only appended |
| p2.a-d | the stop were ignored / cut a step / started step 3 | stop file appears DURING step 2: outcome `stopped`; step 2's artifact + green audit row written; step 3 never called; history row `stopped` with $0.002 (steps 1+2); stop file consumed |
| p2.control | the stop were not what ended it | without the file the same flow runs on to the ask and step 3 runs |
| p3.a | a plain run changed | plain run: ask wait 30m, send lands in the flow's folder |
| p3.b-d | the values were not what the run used | run with a values file written once into its folder before start: ask wait 2h, send lands in the NEW folder (flow's folder untouched), cap in force (history `capUsd`) is the run's |
| p3.e | the values leaked into the next run | the next plain run is back to 30m and the flow's folder |
| p3.f | the flow's signed files changed | `prose.txt`, `signature.json`, `declaration.json` byte-identical after three runs |
| p3.inv | the signed invariant were crossed | the executor context (3 scanned) never carries the cap, the destination, the wait or a close |

## What the POC found (these shape the build)

1. **No runner change crosses a signed invariant.** The cap and the send target live only in the runner's arbiter object; an overlay
   applied right after `readFlow` reaches `runFlow`, the fold, the ask park and the send without the executor seeing any of it.
2. **A cap-halted run has no resumable state today** (it writes artifacts + audit + a history row, no `state.json`), and its audit
   carries a `usd: null` row that `sumAuditUsd` refuses. A continue has to skip that one row (it cost nothing) and rebuild
   spend and the spend-complete floor from the books; the build also persists a small halt record for what the books cannot give
   (the unjudged evidence, the start time).
3. **History is append-only and the panel reads the FIRST row for a run** (`data.js` `historyRows.find`). A continued run has two
   rows (`cap-halt` then its later outcome); the reader must take the LAST, and a continue in flight must not show the older row.
4. **The stop seam does not apply after the last step** (the run completes; nothing is left to stop) and a park clears a pending
   stop (a parked run is not running).

## Harness fixes (not findings)

Two expectations in my first draft were wrong: the cut step is never CALLED before the cap-halt (the halt is before the call), so
"called once after the continue" is the right count; and audit rows name a step by its `emits`.
