# M4e amendment 7 item 8 (Stop between turns and tries) — POC result, 2026-10-06

$0, fake provider, no key. `node poc/m4e-am7/proto.mjs` — 9 / 9 PASS (each row would FAIL if its clause were false).

**Finding: bare-agent 0.49.0's Loop already has the seam. No upstream ask.** `new Loop({ assemble })` runs before EVERY
`provider.generate` (round 0 included, tool turns included); a thrown `HaltError` is a clean return
(`error: 'halt:<rule>'`, transcript sealed, never a throw), and the previous call's `onLlmResult` has already fired, so the
in-flight call stays metered. A new try is a new `Loop` (modelStep builds one per round), so the same hook sits before a try's
first call.

| row | would FAIL if | measured |
|---|---|---|
| p1.a-d | a call started after the stop, or the in-flight call were lost | stop during call 1: provider called once, clean `halt:stop-requested`, 1 metering event, cost priced |
| p2 | the hook broke a normal run | no stop: runs through, artifact captured |
| p3.a-c | the emit turn were lost | stop during the emit turn: 2 calls, artifact survives, loop reports the stop (caller prefers the captured artifact) |
| p4 | a pending stop let a new try call the model | 0 calls, 0 metered |

What the POC does not cover (the build's tests do): the runner-side half — booking the cut try's spend as an audit row, Resume
re-entering the step as a new try with its tries counted.
