# poc/m4b — answer door POC (THROWAWAY, $0)

Riskiest assumption (M4b "Kills M4b"): a panel HTTP answer path can (a) refuse everything that is not a
real click from the served page, (b) hand the answer to `answerAsk` and nothing else, (c) start the resume
as a detached process that outlives the request, once per answer, with no books/arbiter change.

Files: `answer-door.mjs` (server; wraps `src/panel/server.js` `handleRequest` for GETs, adds `POST /api/answer`),
`answer-door.test.mjs` (8 tests), `serve.mjs` (door as its own process, for the detached proof).
No `src/`, `bin/`, `test/` file touched. Run: `node --test poc/m4b/answer-door.test.mjs`
(Node 22 does not accept a directory argument to `--test`.) `npm test` DOES pick it up (yes; 1688/1688 green,
exit 0, suite ~38 s, this file ~30 s of that).

## Verdict
Not killed. (a), (b), (c) all held with no change to books or arbiter. Findings below are real, none is a books/arbiter change.

## Green (3 consecutive full runs, all 8 pass)
(i) no-token / wrong-token / foreign Origin / no Origin / foreign Host POST -> 403 by name, no `answer*.json`, no spawn;
PUT -> 405. (iv) foreign-Host GET on `/`, `/api/runs`, `/api/inbox`, run detail -> 403, wrong port -> 403, good Host and
`localhost:<port>` still 200. (ii) blank reason, unknown askId, bad decision, second answer, expired ask -> library `red`
verbatim, 409, no resume. Happy path, exactly-one, key hygiene, detached: see numbers.

## Measured
- POST response 2-4 ms; old ask still the open one when the response lands (resume not done).
- reject -> new ask parked: 258-374 ms after POST; accept -> run complete (history row `complete`): 537-747 ms total.
- Detached: server process group SIGKILLed right after the 202 (8-12 ms); resume still re-parked 274-412 ms after POST.
- 10 concurrent identical POSTs: exactly 1x 202, 9x "already answered", 1 spawn, 1 consumed marker, `asks/` = original + one re-park.
- Key hygiene: sentinel `sk-test-SENTINEL-m4b-0001` in server env and the child's env; 14 responses (page, API, error bodies, headers)
  and 22 files (books + 2 resume logs, 343 bytes) scanned: 0 hits.
- Natural race at re-park, 15 trials: new `ask.json` first seen while `resume.lock` still present in 11/15; answer stranded 0/15.

## Guard-removed red lines (scratch copy of the door, `DOOR=./_scratch-x.mjs`, scratch files deleted)
- drop token check -> `(i)`: `Expected values to be strictly equal: 202 !== 403`
- drop Origin check -> `(i)`: `202 !== 403`
- drop Host check -> `(i)`: `202 !== 403` AND `(iv)`: `GET / with Host evil.example.com`
- drop "library refusal stops here" (spawn + 202 anyway) -> `(ii)`: `Expected "actual" to be strictly unequal to: 202`; `exactly one`: `accepted: 202 x10, 10 !== 1`
- await the resume (spawnSync) -> `happy`: `resume must not have re-parked yet when the response lands` (also red: (ii), exactly-one)
- `detached: false` -> `detached`: `resume must outlive the killed server`
- leak the env key into the page -> `key hygiene`: `sentinel in an HTTP response`
Caveat: a test stops at its first failing assert, so each (i) mutant proves its own guard only via the first sub-case it hits
(token mutant: no-token case; Origin mutant: foreign-Origin case).

## FINDINGS
1. **Resume in flight / `resume.lock` has no liveness: the door cannot tell a started resume from a refused one.** Simulated
   in-flight lock (`resume.lock` present), then POST: `answerAsk` accepts (`answer.json` written), door answers 202 "resume started",
   the child exits at once with `resume: run "run-1" is locked by another resumer`, `answer.json` stays on disk, nothing re-parks, and
   nothing ever retries. The page would show "answered" forever. The natural window exists (lock still held when the new ask is first
   visible, 11/15) but was never hit (0/15 stranded) only because spawning a node child (~100+ ms) outlasts the lock release. That is luck,
   not a guarantee (slow disk, loaded box, a real model round inside the same lock). Product needs one of: door verifies the child took
   the lock / re-spawns while `answer.json` is unconsumed, or the page treats "answer.json present, no resume" as a visible state. Any
   fix is in the door/runner, not books/arbiter schema; but the "lock has no pid" M4a question is now a concrete hazard, not a nit.
2. **Answering a stale page.** `POST` without `askId` answers whatever ask is currently open. A tab left open across a re-park would
   answer the NEW ask. The door accepts an optional `askId` (and passes it to `answerAsk`, which then refuses by name); the product page
   must always send it, and the door should require it. Not in the signed scope text; flagging.
3. **Serialization is free in one process, so the 10-way test is weaker than it looks.** The door's handler runs answer+spawn synchronously, so
   "exactly one" holds even without the library's `wx`. Multi-process safety rests only on `answerAsk`'s exclusive `wx` write (src, untouched).
   The test is still able to fail (see mutant) but does not prove two doors are safe.
4. **No `src` change needed, but product will need one in `src/panel`.** I injected the token by capturing `handleRequest`'s HTML and splicing a
   `<meta>`; the product should put a placeholder in `src/panel/index.html` and route POST in `server.js` (today any non-GET is 405 before any
   route). That is panel shell, not books/arbiter.
5. **Child failure is invisible to the HTTP caller.** Resume runs after the 202; its refusals (lock, signature mismatch, missing input) land only
   in the child's log file. The page must read the books to show them, per scope item 3 ("shows the run live from the books").
6. The resume child gets the server's env verbatim (per the brief); in this POC tests pass an explicit env (incl. `NODE_ENV=test` +
   fake model step + sentinel key) rather than mutating `process.env` for the child. A real panel would spawn with its real env, so the
   live key reaches the child by design; hygiene above only proves the POC does not echo it.
7. Test scaffolding bugs fixed on the way (mine, not the door's): settling on "lock absent" raced the child's start; a failed assert left a
   listening server holding the runner open (fixed with an `after()` closer). `--test-name-pattern` with a negative lookahead did not skip
   the slow measurement test in mutant runs (so mutant runs took ~2 min each); harmless.

## Not covered (deliberately)
Accept-hash / send-verify (scope item 4, negative iii); the page UI and buttons (scope item 1 design); the page reading the run live;
any live paid run; two-door multi-process race; a real browser (CSRF from a real cross-origin page was modelled with raw headers only).
