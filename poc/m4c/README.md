# M4c POC — pid liveness across real start shapes ($0)

NOT shipped, NOT imported by `src/`. Targets M4c scope item 2, the riskiest assumption: the panel can tell from
`/proc` that a recorded pid is alive AND is fwdloop, for every way fwdloop really starts, and never reads a recycled pid as running.

Run: `node poc/m4c/probe.mjs` (spawns real processes under the scratchpad, ports 4830-4839, kills them all, exits 1 on any mismatch).
`LIVENESS=<path>` swaps the rule under test (used for the red proof).

## Rule chosen (`liveness.mjs`, `isFwdloopAlive(pid)` returns `true | false | null`)
1. `process.kill(pid,0)`: ESRCH -> false; EPERM -> exists, keep going.
2. Read `/proc/<pid>/cmdline`: ENOENT on a Linux with /proc -> false (died between the calls); any other read failure (no /proc, EACCES) -> `null` = "cannot tell", so the build falls back to the signed 10-minute rule. Never a silent true.
3. Empty cmdline -> false. This is what a zombie looks like.
4. `basename(argv0) === 'fwdloop'` -> true (direct exec).
5. Else argv0 basename starts with `node` AND the **script** (first non-`-` arg) has basename `fwdloop` -> true.

Why not bareloop's rule verbatim: its `rest.some(basename(a) in names)` matches ANY arg. The panel's own resume spawn passes
`--root <dir>`; any root whose last segment is `fwdloop` (this repo's dir is named that) makes `node other.js --root .../fwdloop` read as fwdloop.
Case 6e fails under bareloop's rule (shown below). Only the script position is trusted. Cost of the tightening: `node --require x bin/fwdloop`
(a node flag with a value) is not recognised; no start shape in this repo does that.

## Real output
(`note` column = the actual /proc cmdline, `␀` = NUL; trimmed to 150 chars per line here only)

```
case                                                  expected  got      verdict
1 node bin/fwdloop panel                              true      true     ok   /usr/bin/node-22 ␀ /home/hamr/PycharmProjects/fwdloop/bin/fwdloop ␀ pane
2 ./bin/fwdloop (shebang)                             true      true     ok   node ␀ /home/hamr/PycharmProjects/fwdloop/bin/fwdloop ␀ panel ␀ --root ␀
3 spawn(execPath,[bin,resume..]) stopped              true      true     ok   /usr/bin/node-22 ␀ /home/hamr/PycharmProjects/fwdloop/bin/fwdloop ␀ resu
4 node_modules/.bin/fwdloop symlink                   true      true     ok   node ␀ /tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/a95578bd-64f1
5 SIGKILL case 1 -> flips within 2000 ms              true      true     ok   flipped after 0.2 ms (child not yet reaped by us? node reaps on its own 
6a node -e (not fwdloop)                              false     false    ok   /usr/bin/node-22 ␀ -e ␀ setTimeout(()=>{},8000)
6b sleep 8 (not fwdloop)                              false     false    ok   sleep ␀ 8
6c node .../fwdloop-panel-logs-x/other.js             false     false    ok   /usr/bin/node-22 ␀ /tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/a
6d node <repo>/poc/m4c/hold.js (repo dir is fwdloop)  false     false    ok   /usr/bin/node-22 ␀ /home/hamr/PycharmProjects/fwdloop/poc/m4c/hold.js
6e node other.js --root .../fwdloop (arg basename)    false     false    ok   /usr/bin/node-22 ␀ /tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/a
7 zombie (stat state Z)                               false     false    ok   cmdline=""
8 nonexistent pid                                     false     false    ok   
8b pid 0 / NaN                                        false     false    ok   
9 cost, 200 calls mixed                               -         18.9 us/call  ok   

all match
```

Notes:
- Case 2 (shebang, `#!/usr/bin/env node`): cmdline is `node <abs path to bin/fwdloop> ...`; argv0 is plain `node`. Case 1/3: argv0 is `/usr/bin/node-22` (process.execPath here), so the test is `startsWith('node')` on the basename, not `=== 'node'`.
- Case 4 (npm-style symlink): cmdline keeps the SYMLINK path (`.../node_modules/.bin/fwdloop`), not the resolved target. Basename is still `fwdloop`. A wrapper that renames the bin would break this; npm's `.bin` shims on Linux are symlinks.
- Case 1 pid is `child.pid` of a direct `node` spawn, which IS the node process. In the build the process records its own `process.pid`, the same number.
- Case 3: a `resume` with a bad runId exits too fast to observe, so the child is frozen with SIGSTOP right after spawn (cmdline is fixed at exec; a stopped process still exists). The shape is exactly `spawn(process.execPath, [bin,'resume',...])` from `src/panel/resume.js`.
- Case 5: SIGKILL to "not alive" in single-digit ms (3.1 ms). The kernel drops /proc/<pid>/cmdline to empty (zombie) or removes it the instant the process dies, so the 2 s refresh tick is not at risk. Note the flip here includes the zombie phase: in the build the panel is not the parent of a CLI-started run, so a zombie can persist until its parent reaps; rule step 3 makes that read false too (case 7).
- Case 7: Node reaps its own children, so a Node-spawned child never stays a zombie. The zombie is made by `sh -c 'true & echo $!; sleep 6'`: `true` exits, `sh` never waits, `/proc/<pid>/stat` state is `Z`. Not moot; covered.
- Kill condition: did NOT fire. One rule accepts 1-4 and rejects 6a-6e; case 5 flips in ~3 ms, far under 2 s.

## Cost
About 19-30 us per call (200 calls, mix of two live, one non-fwdloop live, one dead pid; two runs: 29.3 us, 18.9 us). A refresh over 100 runs is ~3 ms.

## The probe can fail (red proofs, loosened copies NOT committed)
Loosened rule = `return cmdline.includes("fwdloop")`:
```
6c node .../fwdloop-panel-logs-x/other.js             false     true     RED   /usr/bin/node-22 ␀ /tmp/claude-
6d node <repo>/poc/m4c/hold.js (repo dir is fwdloop)  false     true     RED   /usr/bin/node-22 ␀ /home/hamr/P
6e node other.js --root .../fwdloop (arg basename)    false     true     RED   /usr/bin/node-22 ␀ /tmp/claude-
3 MISMATCH: 6c node .../fwdloop-panel-logs-x/other.js; 6d node <repo>/poc/m4c/hold.js (repo dir is fwdloop); 6
```
bareloop's verbatim `rest.some(...)` shape goes red on exactly case 6e:
```
6e node other.js --root .../fwdloop (arg basename)    false     true     RED   /usr/bin/node-22 ␀ /tmp/claude-
1 MISMATCH: 6e node other.js --root .../fwdloop (arg basename)
```

## What the build must carry over
- One function, tri-state `true | false | null`; `null` means fall back to the 10-minute books-changed rule. Do not collapse null to true (bareloop does).
- Match the script position, not any arg; test names `fwdloop` only.
- Empty cmdline = dead (zombie). ENOENT = dead. EPERM alone = exists, then decided by cmdline.
- The spawned process records its own `process.pid` before its first step; symlink path, shebang and `process.execPath` shapes all read as fwdloop.
- Not proven here: pid-row writing itself, and recycled pid that happens to be another fwdloop (e.g. a different run's process): that reads alive; the row is per run so the panel would show `[▶]` for a dead run whose pid got reused by a different fwdloop process. Rare; record as known gap for the build's negative list.

## Amendment 2 POC — can a kill -9'd resumer be resumed again? ($0) — RESULT: NO for a consumed answer
`node poc/m4c/stuck-probe.mjs [scratch]` (real `fwdloop resume` with the hang model step, real `kill -9` after rename-to-consume).
After the kill, on disk: `answer.<askId>.consumed.json` (no `answer.json`), an EMPTY `resume.lock` (0 bytes), state.json unchanged
(still parked: stepIndex 3, same askId), pids.jsonl = run row + resume row (resume pid dead), audit tail = the redo's hitl `red` row (gap = the reason).
Second `fwdloop resume`: with the lock -> "locked by another resumer"; with the lock removed by hand -> "resume: no answer yet for run" (resumeRun reads only
`answer.json`; the consumed file is never read back). So clearing the lock alone (d) does NOT unstick case 2; it needs a re-consume of a consumed answer,
a new answer-file shape, or a state.json change. Kill condition of the brief fired: recovery of case 2 is NOT built.
Case 1 (killed between lock and rename) keeps `answer.json`, so clearing the lock is enough there (not probed live; follows from the code: resumeRun reads answer.json after the lock).
