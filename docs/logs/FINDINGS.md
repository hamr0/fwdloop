# fwdloop — findings

No papering over. Every friction point — with the bare suite, with the flow spec (a "can't
express" is a finding, not a workaround), or with the module ladder (a rung that cannot meet
its exit stops the ladder; the stop is a result) — is logged here, grounded in source
(file:line), in a run (`audit.jsonl` row / `spine.jsonl` seq), or in a command whose output
was seen. "Works as intended" is also a finding. A guessed number is a bug with a confident
voice: every figure here was measured, or it says it was not.

Numbering starts at F1 in this repo. bareloop's F1–F137 are a closed record at
`../bareloop/docs/logs/FINDINGS.md` — cite them as `bareloop F<n>`, never renumber.

Shape of an entry: `## F<n> — <one-line claim>`, then **Date**, **Status**, **Class**,
**Grounded in**, then the evidence, then a **Verdict** line. Findings that flip a PRD
assumption are a spec change: update `docs/product/PRD.md` and say so in the entry.

## F1 — the PRD's "name is taken on npm" line was stale; the registry was checked at the moment of use, the name was free, and it is now reserved

**Date:** 2026-09-08 · **Status:** closed · **Class:** doc drift caught by an external check ·
**Grounded in:** `npm view fwdloop` → `E404 'fwdloop@*' is not in this registry` at
2026-09-08T11:43Z; `npm view fwdloop time` after hamr's publish → `created
2026-09-08T11:50:00Z`, `0.0.1`; `docs/product/PRD.md` §9 (v0.4) "fwdloop is TAKEN on npm
(jaltez, 2026-03, a Pi dev CLI)".

The handoff stash and PRD §9 disagreed: the stash said the name was checked free before the
repo existed; §9 said taken and listed three alternates. Neither was trusted — the registry
was queried directly and returned 404. hamr published 0.0.1 (4-file placeholder: README,
LICENSE, NOTICE, package.json — same shape as bareloop's 2026-07-10 reservation) from his
machine because his npm 2FA is `auth-and-writes`, which blocks an unattended publish on an
OTP. From here releases go through `.github/workflows/publish.yml` (OIDC trusted publishing,
manual dispatch; trusted publisher configured by hamr the same day).

**Verdict:** a documented fact about an external system is a claim, not a fact, until it is
re-checked at the moment it is acted on. PRD §9 item (1) and §9b item (1) are closed by this
finding and should be struck at the next PRD revision. Cost of leaving them: a future session
picks an alternate name from the list.

## F2 — synthetic.new passes tool calls through and reports usage on GLM-5.2 and Kimi-K3; M0's provider question is closed at $0

**Date:** 2026-09-08 · **Status:** closed · **Class:** provider smoke test, subscription ($0
marginal) · **Grounded in:** two `curl` calls to
`https://api.synthetic.new/openai/v1/chat/completions` with one tool (`emit_figure`,
`tool_choice: required`) and the prompt "Sheet cell G2 holds 4200 for Northwind Trading";
`/openai/v1/models` listing the same minute.

The two things only a run could answer (provider research §4), answered:

| model id sent | model id returned | finish | tool call | usage |
|---|---|---|---|---|
| `hf:zai-org/GLM-5.2` | `zai-org/GLM-5.2` | `tool_calls` | `emit_figure {"value":4200,"cell":"G2","asStated":"4200"}` | prompt 204 · completion 67 (39 reasoning) |
| `hf:moonshotai/Kimi-K3` | `moonshotai/Kimi-K3` | `tool_calls` | `emit_figure {"asStated":"4200","cell":"G2","value":4200}` | prompt 241 · completion 159 (81 reasoning) |

Both emitted the artifact as a tool call with the schema's three fields, none invented.
Both carried a usage block, so bare-agent will price the round from caller rates
(`rateSource:'caller'`) rather than mark it `unpriced`. `prompt_tokens_details` is `null`
(no cache tiers) — bare-agent's `u?.prompt_tokens_details?.cached_tokens || 0` reads that as
zero cached, which is correct here. `reasoning_tokens` is reported as a top-level usage field
and is included in `completion_tokens`; nothing in the suite reads it, so reasoning cost is
priced at the output rate, which is right.

Two notes for the audit row: (1) the **returned model id drops the `hf:` prefix** — the
signed flow pins `hf:zai-org/GLM-5.2`, the response says `zai-org/GLM-5.2`; the runner must
compare on the suffix or the audit will show a mismatch on every row; (2) billing is
**usage-based** (prepaid balance, recharged as needed — hamr, 2026-09-08: "it's usage based,
we will see if this works or the monthly based on how many times we recharge"), so each round
is priced at the model's public list rate and the $5 cap is real money — unknown is never 0.

**Verdict:** synthetic.new is M0's provider, one key, two labs (GLM-5.2 primary, Kimi-K3
second, §11 P10). No upstream ask: bare-agent's `OpenAI` provider with `baseUrl` fits as-is.
The watch-list items in `docs/product/UPSTREAM-ASKS.md` for tool-call pass-through and
DeepSeek's cached-token field are moot for M0 and stay as watches. Key lives in `pass` at
`amr/synthetic_api` and reaches the process only as `SYNTHETIC_API_KEY` in the environment
(hard line: never the tree).

## F3 — bare-agent 0.41.1 talks to synthetic.new; metering row is authoritative (2026-09-08)

`poc/probe-synthetic.mjs` (branch `m0-poc`): `OpenAI` provider with `baseUrl`, one tool
`emit_figure`, caller `rates`. One call per model, both exit 0:

| model | tool call | usage in/out/cacheRead | cost USD | rateSource | wall ms |
|---|---|---|---|---|---|
| hf:zai-org/GLM-5.2 | `{value:4200, cell:"E2", asStated:"4200"}` | 98 / 27 / 192 | 0.00012972 | caller | 6973 |
| hf:moonshotai/Kimi-K3 | same | 193 / 63 / 192 | 0.00028482 | caller | 35778 (one 503, retried once) |

Cost and usage come from `new Loop({ onLlmResult })` — payload `{ model, provider, usage,
costUsd, pricing, rateSource, durationMs, kind:'turn' }`, usage normalised to
`{ inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens }` (no reasoning field on
the OpenAI provider; reasoning is inside output, priced at the output rate). Suffix match on
the returned model id holds (F2 note 1).

Two surprises, neither blocks M0, both logged in `docs/product/UPSTREAM-ASKS.md` watch list:
(1) `loop.run()` returns `toolCalls: []` on every path — the tool's own `execute()` closure is
the only place the args land; (2) `loop.run()` returns no `model` field; the resolved model
is only on the `onLlmResult` payload. The runner reads both from the side channel.

Kimi-K3 threw one HTTP 503 on first attempt: the "one retry on transport-class failure" rung
of the self-heal ladder (PRD §3.6) is exercised on day one.

## F4 — "GLM answers in prose" was a token cap: thinking spends the output budget (2026-09-08)

M0 drafter (`poc/m0/drafter.mjs`): GLM-5.2 came back with **no tool call and empty text**
5/5 times. First read: the model ignores the tool, and bare-agent's OpenAI provider never
sends `tool_choice` (`src/provider-openai.js:72`, verified) so nothing forces it. Filed as an
upstream ask for about an hour, then **retracted** by measurement:

| cap (maxTokens) | outputTokens | finish | tool call |
|---|---|---|---|
| 600 (raw, ×2, forced and unforced) | 600 | length | no |
| 1500 / 4000 (drafter) | 1500 / 4000 exactly | length | no |
| 4000 (raw, unforced, ×2) | 2069 / 1295 | tool_calls | **yes** |
| 4000 (raw, forced `tool_choice`) | 4000 / 2575 | length / tool_calls | no / yes |
| 16000 (drafter) | 615 | tool_calls | **yes**, clean 7-step declaration, $0.0022 |

GLM-5.2 reasons before answering and the reasoning is billed as completion tokens; with the
1.1k-token drafter prompt it sometimes reasons past 4000. A cut round has empty `content`,
no `tool_calls`, `finish_reason: length` — which looks exactly like "the model refused the
tool" unless you read the stop reason. Forcing `tool_choice` does not help (the cut happens
in thinking) and is not needed (unforced calls landed every time it finished). Reasoning
length is nondeterministic (615 vs >4000 on the same prompt).

Rulings for M0: `maxTokens` 16000 on every model round; a round whose `stopReason` is
`length` is a **red named "truncated"**, never "no tool call"; cost of a wasted long think
is bounded by the cap (16k × $0.0022/1k ≈ $0.035). bare-agent surfaces `stopReason` on the
result, so this is a caller discipline, not an upstream gap; the `tool_choice` pass-through
stays on the watch list (nice to have, not load-bearing). Diagnostic spend ≈ $0.05.

## F5 — M0 verdict: GO. Grounded structured output is mechanically checkable (2026-09-08)

Full record: `docs/logs/2026-09-08-m0-run.md` (branch `m0-poc`). Pre-registered in PRD §2/§7;
rules fixed before the first run; no close rule widened to turn a red green.

| plant | GLM-5.2 | Kimi-K3 |
|---|---|---|
| (a) wrong derived total | red `total_owed 5850 ≠ sum(E2,E3) = 5700` | same |
| (b) wrong copied cell | not reached (provider 524, then socket timeout) | red `c1 4300 ≠ cell E2 = 4200` |
| (c) two Northwinds | landed at `ask`, no pick | landed at `ask`, no pick |
| (d) clean | green through `send`, accept from another process | green |
| ungroundable step at draft | refused with reason | refused with reason |

Plants caught 7/7 reached (one cell not reached, provider variance only, same model call
green on (a) and (d)). False reds after fixes: 0/2 clean runs. Three false reds found and
fixed along the way, each with a regression test: a cited ISO date miscounted as a bare
number (close bug, not a rule change), a retry that poisoned its own spend guard, and two
prompt gaps on the compose step (fixed as prompts, not by loosening the close).

Money: clean run $0.003–0.006 end to end vs the $12.50/day human-cost assumption. Session
spend ≈ $0.16 of the $5 cap. Wall per clean run 1–3 min; GLM reasoning rounds are slow
(30–90 s) and one round ran 51 min into a socket timeout before a 300 s bound was added.

Three things M0 could not prove, carried as spec questions (not silently fixed):
1. `earliest_due` is copied, not recomputed — the closed grammar has no date-aware `min`.
2. `count` verifies the count of what the model included, not that it included the right
   set — no filter primitive.
3. The runner is a hand-wired fold for job #1's shape, not a declaration interpreter (M2).

Open money item: one spend row is `costUsd: null` (raw `read ETIMEDOUT` on a GLM round).
By rule it blocks further spend until a human reconciles it against the synthetic.new
dashboard. Transport failures after the request left the machine are **unknown, never 0**;
the POC's "pre-response failure = $0" shortcut is retired for M2.

Provider: synthetic.new is usable but flaky on long GLM rounds (two 524s, one dead socket
in 8 runs); Kimi-K3 finished every round first try. Both stay; the flow's one-retry ladder
and a per-round timeout are load-bearing, not nice-to-have.

## F6 — synthetic.new cuts any single request at ~250s; steps must be sized under it (2026-09-08)

Jointly established with the bareloop session (barelo), two independent jobs, same gateway:

| | bareloop | fwdloop |
|---|---|---|
| slowest request that succeeded | 104s | 102s |
| request cut with HTTP 524 | 252s | 251s, 252s |

Neither project observed anything in the 104–251s band. It is a fixed origin timeout at the
gateway, **not** a token or job-length effect: fwdloop's 524s carried a 4000-token output cap
while bareloop had a 9,182-output-token round succeed under the wall. fwdloop's third failure
(`read ETIMEDOUT` at 3045s) was the same cut with no `timeoutMs` bound to catch it; rounds are
now bounded at 300s.

**Streaming does not rescue it** (fwdloop, measured after the above): a `stream: true` request
to GLM-5.2 returned its first byte at 92s and delivered 3,951 chunks before the socket was
killed at **231s** — bytes were flowing continuously right up to the cut. So the cliff is a
hard ceiling on how long one connection may live, not an idle timeout. That also rules out a
model swap as a fix: every model on this gateway shares the wall.

**Retrying a 524 is not a fix** — it re-sends a four-minute request into the same wall and pays
twice.

**Correction (same day, from barelo).** This finding first recorded, on barelo's word, that
bareloop "lives past the cliff by construction" because its drafting pass is one big request.
barelo then read its own archive — 233 runs, 9,548 worker rounds on Anthropic — and withdrew
it: draft rounds median 34.1s, p95 76.7s, max 107.4s over 130 observations, and 8 of 9,548
rounds (0.08%) exceed 240s, none of them drafts. bareloop already satisfies the step-sizing
rule. **The real variable is model generation speed, not step shape:** GLM-5.2 through this
gateway emits ~50–95 output tokens/sec, so the same request that a faster model answers in
seconds runs it into the wall. fwdloop published the original claim without measuring it —
a peer's mechanism accepted as a fact. Recorded here rather than quietly edited out.

**fwdloop's exposure is different and the rule is a spec rule, not a provider verdict.** Our
steps are small: median round 31s, max 102s, and the 9-model bake-off ran 81 rounds with zero
provider errors. So:

> **A step whose model round can exceed ~2 minutes is a spec bug.** It is split at draft time,
> not retried at run time. This is a step-sizing constraint on the drafter, carried to M1.

The budget that rule spends is `output tokens needed × the model's tokens/sec`, so a faster
model raises how much work fits in one step. At GLM-5.2's ~50–95 tok/s the wall lands near
15–20k output tokens; fwdloop's steps ask for a few hundred. Both projects pass it today;
it is a tripwire to watch, not a redesign.

GLM-5.2 stays usable for fwdloop's job shape; it loses the baseline slot on results and speed
(F7), not on this.

### JOINT VERDICT on synthetic.new (agreed with the bareloop session, 2026-09-08)

hamr asked for one verdict where the two sessions appeared to disagree. We did not: the same
finding had two headlines. Agreed text, four points:

1. **synthetic.new's gateway caps how long ONE request may live at ~240–250s.** Jointly
   measured (bareloop 104s fine / 252s cut; fwdloop 102s fine / 251s+252s cut; empty 104–251s
   band on both sides). It is a hard connection-lifetime cap, not an idle timeout — fwdloop's
   streaming test settles the mechanism (first byte 92s, 3,951 chunks still arriving when the
   socket died at 231s). Retrying a 524 re-sends the same doomed request and pays twice.
2. **The budget that cap spends is `output tokens the round needs ÷ model tokens-per-sec`.**
   So it is a model-speed constraint, not a step-shape one. bareloop's archive settled that:
   draft rounds median 34.1s, p95 76.7s, max 107.4s over 130 observations; 8 of 9,548 rounds
   exceed 240s, none of them drafts.
3. **GLM-5.2 through this gateway runs ~50–95 output tok/s, which is what puts it at the wall.
   That is a verdict on one model, not on synthetic.new.** barelo's own note: their evidence
   covered exactly one model on that gateway, and n=1 model is not a provider verdict.
4. **synthetic.new is usable, provided `output tokens the round needs ÷ model tok/sec` stays
   well under the cap — a bar each project computes from its own round shape, not a single
   model whitelist.** (barelo's amendment, taken: fwdloop's 88 zero-error rounds are strong
   evidence for fwdloop's ~31s round shape and do not transfer unchanged to a project whose
   rounds ask for thousands of output tokens.)
5. **Timing is necessary but not sufficient: the model must also be capable of the project's
   own authoring artifact, a separate threshold.** (barelo's second amendment, taken, and their
   evidence is decisive — Kimi-K3 died at 104s, comfortably fast, and still failed bareloop's
   plan validation twice running: draft 1 omitted `exit` on every step, draft 2 used absolute
   paths and `..` segments.)

**bareloop's controlled comparison (F146), which revises rather than confirms the above:** same
job, same signed spec, same patient, same $5/30-min ceiling, four models. 0 of 3 synthetic
models cleared their bar; gpt-5-mini on OpenAI did. Crucially **only one of the three failures
is the cliff** — GLM-5.2 hit it; Qwen3.8-27B died on an unexplained HTTP 400 at ~25k
accumulated context (136s); Kimi-K3 failed on plan capability (104s). So the honest suite-level
statement is narrower and worse than "GLM is slow": no model tested there could author a
bareloop plan. It does not touch fwdloop's bake-off, and it explains why — fwdloop's steps ask
for a few hundred output tokens against no comparable schema.

fwdloop's own bar under point 4: baseline Qwen3.8-27B, median round 11s against a ~250s cap —
roughly 20× headroom. See F7.

Filed jointly as bareloop **F144** (bareloop main `700e64f`). The 524 question is closed on
both sides for the same measured reason. Ledgers deliberately NOT pooled: bareloop's 9,548
rounds are one provider and one model family, fwdloop's are a 9-model bake-off — a merged
median would read as a fact about model latency while actually being a fact about whichever
population dominates the count. The useful comparison, if wanted later, is segmented:
fwdloop's per-model tokens/sec against bareloop's per-phase distribution, populations named.

## F7 — a green can be minted by OMISSION; baseline model is Qwen3.8-27B (2026-09-08)

Full record: `docs/logs/2026-09-08-model-bakeoff.md`. 9 models × 3 runs of the clean job,
identical prompts, no per-model tuning, 27 runs for $0.13.

**The hole.** `hf:openai/gpt-oss-120b` scored 3/3 green by sending:

```
INV-1: 4200[c_amt1] due 2026-06-09[c_due1]
INV-2: 1500[c_amt2] due 2026-05-20[c_due2]
```

Every citation resolved, every value matched the sheet, no uncited number — and the reply
carries no total, no earliest due, no overdue count, all three declared fields of the prior
step and all three named in hamr's own step 3. **The close verified truth and never
completeness.** A model won by doing less. This is the minted-green class PRD §2 exists to
prevent, found by reading the sent text, not by reading the scoreboard.

**The fix** (`closeCompose`, +7 tests, 59 total): every field the prior derive step declared
must appear in the composed text, cited — by its id or by a citation resolving to the identical
value (a model may legitimately re-cite the same figure under a new id, as Qwen did). Red names
the field: `compose: declared field "total_owed" (5700, c7) does not appear cited in the reply`.
Additional gate; nothing existing was loosened. Re-run confirms: gpt-oss-120b red, Qwen and
GLM-5.2 unchanged at 3/3 — they were never exploiting the hole.

**Caveat on the disqualification, stated rather than buried:** the compose step's prompt never
explicitly asks for total/earliest/count (that instruction lives in the earlier derive2 context,
a separate step per §5's fresh-context rule). gpt-oss-120b did what it was literally told;
Qwen and GLM-5.2 inferred the rest. So this is partly a prompt gap (carried to M1) and not
purely a model verdict. The close is right either way — an incomplete reply is incomplete
whoever's fault it is — but a re-test with an explicit prompt is one run if the ruling is ever
challenged.

**Unaided model failures the close caught** — no plants involved, which is stronger evidence
for §2 than the plants themselves:

| model | what it got wrong |
|---|---|
| GLM-4.7-Flash, syn:large:text | `daysBetween` sign flip: said 8, answer is −8 (not yet due) |
| syn:small:text | said 11 days overdue, answer is 12 |
| GLM-5.3-Flash, syn:large:text | cited 2 customers where the sheet has 1 |
| Kimi-K3 | citation pointing at artifact `"undefined"` |
| gpt-oss-120b | omitted every declared field |

Date arithmetic is the recurring weak spot across cheap models — two distinct failures, both
`daysBetween`.

**RULING. Baseline: `hf:Qwen/Qwen3.8-27B`. Second (§11 P10's two-provider rule): `hf:zai-org/GLM-5.2`.**
Baseline numbers everything later is measured against:

| | Qwen3.8-27B | GLM-5.2 |
|---|---|---|
| complete runs | 3/3 | 3/3 |
| provider errors | 0 | 0 |
| mean $/run | $0.0017 | $0.0037 |
| mean wall/run | 43s | 162s |
| context | 262k | 524k |

Qwen wins on results first (3/3 with every declared field present in all three replies) and on
wall second (~4× faster, and F6's ~250s per-request cliff makes speed a reliability property,
not a nicety). GLM-5.2 stays as the second provider. gpt-oss-120b is disqualified, not kept as
a cheap fallback: it is the model the fix targets. **No more model shopping** — a change of
baseline needs a measured reason recorded here.

## F8 — Qwen and Kimi handle 120k input tokens fine; bareloop's HTTP 400 is not context size (2026-09-08)

bareloop's F146 left an unexplained HTTP 400 from `hf:Qwen/Qwen3.8-27B` at ~25k accumulated
context, well inside its 262k window. Since Qwen is fwdloop's baseline model (F7), fwdloop
probed it directly — raw requests, growing single-turn prompts, one tool:

| model | prompt tokens | status | tool called | wall |
|---|---|---|---|---|
| Qwen3.8-27B | 10,329 | 200 | yes | 4.1s |
| Qwen3.8-27B | 30,329 | 200 | yes | 6.5s |
| Qwen3.8-27B | 60,329 | 200 | yes | 9.3s |
| Qwen3.8-27B | **120,329** | 200 | yes | 14.6s |
| Kimi-K3 | 120,188 | 200 | yes | 11.8s |

Both models answer cleanly at **120k input tokens**, ~5× the size at which bareloop's 400
fired, with the tool call intact and wall time growing linearly and gently. **Raw context size
is disconfirmed as the cause.** The 400 belongs to the SHAPE of an accumulated multi-turn
transcript — assistant turns carrying `tool_calls`, tool-result messages, empty content fields
— not to its size.

**Why this matters to fwdloop and why it is structural, not luck:** PRD §5 runs each step in a
fresh context carrying only the goal line plus prior compact artifacts, never prior
transcripts. fwdloop therefore never builds the accumulating multi-turn transcript that the 400
attaches to. The baseline holds; the protection is a design property, not a model property, and
it should be treated as load-bearing rather than incidental if the runner is ever tempted to
carry a conversation across steps.

**Related gap, ours as much as bareloop's:** neither project sets bare-agent's
`exposeErrorBody`, so a provider HTTP error arrives as a bare status with the vendor's
explanation discarded — which is precisely why the 400 is still unexplained. Not a free fix (an
error body can echo auth material and must route through a scrub first), so it is recorded here
as a real diagnostic gap rather than built: **fwdloop's runner should set `exposeErrorBody` and
scrub, carried to M2.**

## F9 — DeepSeek direct API has no ~250s cliff; it is fwdloop's first genuinely independent second provider (2026-09-09)

Key at `pass amr/deepseek_api` → `DEEPSEEK_API_KEY` (env only). Base `https://api.deepseek.com`,
OpenAI-shaped. Balance $5.00 topped up. Models: `deepseek-v4-flash`, `deepseek-v4-pro`,
`deepseek-v4-flash-vision-exp`.

**Same probe as F2/F3, both models clean:**

| model | tool call | in/out tok | reasoning tok | wall | tok/sec |
|---|---|---|---|---|---|
| deepseek-v4-flash | `{value:4200, cell:"E2", asStated:"4200"}` | 437 / 169 | 87 | 2.0s | 86 |
| deepseek-v4-pro | same | 437 / 245 | 163 | 3.5s | 70 |

**No cliff — the headline.** Three long calls, each a single non-streamed request:

| output tokens | wall | status | ended because |
|---|---|---|---|
| 12,109 | 202s | 200 | model stopped naturally |
| 12,725 | 246s | 200 | model stopped naturally |
| **32,000** | **296s** | **200** | **our `max_tokens`, not a gateway cut** |

296 seconds with a complete response body. synthetic.new kills a connection at ~250s
regardless of streaming (F6). **DeepSeek does not have that wall**, which makes it the escape
hatch F6 said we would need for any step that genuinely cannot be split. Note the generation
rate (52–108 tok/s) is comparable to GLM-5.2's — DeepSeek does not win on speed, it wins by not
being behind that gateway.

**Why this matters beyond long calls.** PRD §11 P10 wants two providers. fwdloop's current
pair (Qwen3.8-27B + GLM-5.2, F7) are both on synthetic.new — one gateway, one key, one failure
mode. That is two models, not two providers, and a synthetic outage takes both. DeepSeek is a
different company, different infrastructure, separate key and balance. **Recommendation:
baseline stays Qwen3.8-27B (F7, unchanged — it wins on fwdloop's short steps); the P10 second
provider becomes DeepSeek rather than GLM-5.2**, so the pair actually survives losing either
one.

**Prompt caching works and bare-agent reads it correctly — an ask filed here and RETRACTED the
same hour.** The first version of this finding claimed DeepSeek reports caching only as
top-level `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`, which bare-agent does not
read. That was wrong, and it was wrong for a lazy reason: the probe that produced it was a
COLD call, where every cache field is 0, and absence of a value was read as absence of a field.

Measured properly — same 4,361-token prefix sent twice:

| call | prompt | `prompt_cache_hit_tokens` | `prompt_tokens_details.cached_tokens` |
|---|---|---|---|
| cold | 4,361 | 0 | 0 |
| repeat | 4,361 | **4,352** | **4,352** |

DeepSeek populates **both** shapes and they agree. bare-agent 0.42.0 reads
`prompt_tokens_details.cached_tokens` (`src/provider-openai.js:172`), so it prices DeepSeek's
cache correctly with no change. **No upstream ask.** The watch-list entry is closed as
disconfirmed rather than promoted.

For contrast, synthetic.new returns `prompt_tokens_details: None` — no prompt caching exposed
there at all, so nothing is mispriced, there is simply no discount to record.

99.8% of a repeated prefix came back cached on the second call. That matters for fwdloop's
shape: every step re-sends a stable system prompt, so a cached prefix is the normal case, not
the exception.

## F10 — the prose turn holds; the drafter's instability is exactly where it must not be (2026-09-09)

**The probe.** `poc/m0/drafter.mjs` had only ever been fed `poc/m0/steps.txt` — an already-cut
step list. The product promise is *"describe a flow"*, and `2026-09-08-prd-gaps-review.md` §1
rules the input may be prose **or** steps. The prose leg had never run. New `poc/m0/prose.txt`
says the same job in one paragraph with the guardrails still stated as guardrails; new
`poc/m0/provider.mjs` is one writer for provider+rates+key so the same drafter can face either
provider. 18 rounds: 2 providers × 3 inputs (prose, steps as control, prose+ungroundable) × 3.
Total spend ≈ **$0.018**; M0 cap now $0.167 of $5.00, zero null-cost rows.

**Everything that was supposed to hold, held.**

| measure | Qwen3.8-27B (synthetic) | deepseek-v4-flash |
|---|---|---|
| valid declaration via tool call | 9/9 | 9/9 |
| provider reds | 0 | 0 |
| ungroundable line refused, no proxy check invented | **3/3** | **3/3** |
| arbiter-field leak ($ cap, TTL, trigger, send target, egress) | 0/9 | 0/9 |
| step count, prose | 7, 7, 9 | 11, 8, 8 |
| step count, steps.txt (control) | 8, 8, 7 | 7, 8, 7 |
| $ per draft, median | 0.00080 | 0.00052 |
| wall, median | 33s | 55s |

Refusal reasons were the right shape every time and named the reason, not a substitute — e.g.
*"subjective tone rating has no verifiable ground truth; cannot be expressed as a typed, cited
artifact."* **No run invented a proxy check.** That is the F87/F104 failure mode this probe was
built to hunt, tested at draft time where no citation close exists to catch it, and it did not
appear in 6/6 attempts across two providers.

**Prose is not harder than steps.** The control is the point: step counts on prose (7–11) sit in
the same band as step counts on the already-cut list (7–8). Prose loses no grounding and invents
no steps. F81's grain worry (many small self-graded steps) did not materialise — nothing came
back with a long tail of substeps.

**The real finding is where the wobble is.** Neither provider is stable, and both are unstable in
the *same* place: whether an `ask` step is emitted for the ambiguous-customer case. Runs that
emitted it are 8–9 steps; runs that folded ambiguity into the `derive` are 7. Both readings are
defensible from the prose — the guardrail says *"if more than one customer matches, ask me, do
not pick"*, which states that a stop exists without fixing where.

That is an **ask's position**, and PRD §5 makes an ask's position an arbiter field: human-authored,
inexpressible to the drafter. Today the drafter is told not to *move* an ask, but nothing stops it
deciding whether one *exists*. Two runs of the same prose therefore produce flows with a different
number of human stops. **The leak is not in what the drafter emits; it is in what the schema lets
it decide.** M1's grammar must make ask positions declared slots the drafter fills, never steps it
may add or omit — and the human diff must show a missing ask as a change, not as an absence.

**Baseline ruling: Qwen3.8-27B stays.** Ranked rule, applied after the runs: correctness first
(tie, both perfect), then provider reds (tie, 0–0), then stability (Qwen's step-count spread is 2
vs DeepSeek's 3, and DeepSeek produced the single 11-step outlier), then cost, then wall — where
they split, DeepSeek cheaper, Qwen faster. Tie above the money line, so the incumbent keeps the
slot (F7 unchanged). **DeepSeek v4-flash is confirmed as the second provider** (F9) on measured
evidence rather than the long-call argument alone: 9/9 clean, 0 reds, and materially cheaper.
DeepSeek's cache discount was deliberately excluded as a tiebreaker — these rounds are cold, so
it would flatter a workload that is not this one.

**Not proven here.** The drafter is one-shot: it never asks a clarifying question when the prose
has a hole (hamr, 2026-09-09: that is part of the flow, parked until the loop exists). And the
drafted declarations were not executed — `poc/m0/runner.mjs` is still a hand-wired fold for job
#1's shape and still constructs its own provider inline, so it cannot yet run an arbitrary
declaration on either slot. Feeding a drafted declaration through the runner against plants
(a)–(d) is the next measurement, and it is the one that closes the front half to the back half.

## F11 — DeepSeek ignores `max_completion_tokens`; our output cap was theatre (2026-09-09)

Raised by the bareloop session (their F149) and **reproduced here on fwdloop's own path** before
being accepted. bare-agent 0.42.0 sends `max_completion_tokens` by default (`provider-openai.js`
BA-24 — GPT-5 models 400 on the legacy key) and exposes `legacyMaxTokens` for compat servers.
A/B on `deepseek-v4-flash`, identical prompt, `maxTokens: 64`:

| `legacyMaxTokens` | output tokens | stopReason |
|---|---|---|
| `false` (bare-agent default) | **783** | `end_turn` |
| `true` | **64** | `max_tokens` |

DeepSeek accepts the request and silently drops the parameter — no error, no warning. Every
DeepSeek round in F10 therefore ran with **no enforced output ceiling**. It cost us nothing (the
drafter's answers are short and the $5 cap held at $0.167), but an unbounded output cap on a
provider is a money guardrail that does not exist. **Fixed:** `legacyMaxTokens` is now a property
of the slot in `poc/m0/provider.mjs` — `true` for `deepseek`, `false` for `synthetic` — so the key
is chosen once, by the one writer, and never by a call site. Test added and proven to fail when
either expectation is flipped (66/66 suite green).

**Their other finding does not apply to us, and we checked rather than assumed.** bareloop's F147:
`Loop.run()` prepends `system` and returns that transcript, so re-feeding the returned `msgs` into
a second `Loop` built with the same `system` yields `system system user …`, which vLLM-class
backends (synthetic fronts them) reject with `400 System message must be at the beginning`. That
was the real cause of the HTTP 400 F8 could not explain — it was never context size and never
transcript size; it was two system messages.

fwdloop is **immune by construction, not by luck**: `grep` over `poc/` finds no reuse of a returned
`msgs`/`messages` array anywhere. Every call site builds a fresh `messages` literal —
`drafter.mjs:129`, `runner.mjs:146` (fresh context per step is the design, PRD §7 M2), and
`probe-synthetic.mjs:84`. There is exactly one `loop.run` per constructed `Loop`. **This becomes a
live risk the moment a step is retried, a conversation is continued, or the drafter gains the
follow-up-question turn** (parked, hamr 2026-09-09) — all three re-feed a transcript. The rule to
carry into M1/M2: *strip a leading `system` before continuing any transcript, or never continue one.*

## F12 — baseline flipped to deepseek-v4-flash; the reason was measured and F10 set it aside (2026-09-09)

**Ruled by hamr, 2026-09-09.** Baseline for every experiment is now **`deepseek-v4-flash`**
(DeepSeek direct); **`hf:Qwen/Qwen3.8-27B`** on synthetic.new becomes the second provider. This
supersedes F7's and F10's baseline, and it satisfies F7's standing rule that a baseline change
needs a measured reason filed here.

**The reason F10 excluded, and why excluding it was right then and wrong now.** F10 ranked the two
providers and kept the incumbent on a tie, explicitly refusing to let DeepSeek's cache discount
break it: *"these rounds are cold, so it would flatter a workload that is not this one."* That was
correct for 18 single-round drafts. It is not correct for fwdloop's actual shape. A run is a fold
over steps, each step re-sending the same standing instructions with a fresh context — so a
**repeated prefix is the normal case, not the exception**. F9 measured it: the same 4,361-token
prefix came back **4,352 tokens cached (99.8%)** on the repeat, at roughly a tenth of the input
price. synthetic returns `prompt_tokens_details: None` — no prompt caching exposed at all, so there
is nothing to discount there, ever.

**Second measured reason: no ~250s cliff.** synthetic cuts any single request at ~250s regardless
of streaming (F6), which forces every step to be sized under that wall and makes a genuinely long
step unrunnable. DeepSeek returned a complete 32,000-token response at **296s**, ending on our own
`max_tokens` and not a gateway cut (F9).

**Stated against the flip, so it is not a one-sided record.** F10's ranked rule put DeepSeek
slightly behind on stability (step-count spread 3 vs 2, including the only 11-step outlier) and on
wall (55s vs 33s median). Neither is a correctness signal: correctness was 9/9 both, refusal of the
ungroundable line 3/3 both, provider-reds 0 both. Both sat below the money line in the ranking.

**Operational note carried forward.** DeepSeek silently ignores `max_completion_tokens` and honours
only legacy `max_tokens` (F11). The output cap is real only because `legacyMaxTokens: true` is a
property of the `deepseek` slot in `poc/m0/provider.mjs`. Promoting DeepSeek to baseline makes that
flag load-bearing rather than incidental — the test asserting it (`provider.test.mjs`) is now
guarding the default path, not a secondary one.

**What would flip it back:** a correctness or provider-red gap in either direction, or the
warm-cache advantage failing to appear on a real multi-step run. Both are measurable in M0b, whose
per-step table will show `cacheReadTokens` on every round.

## F13 — the primitive catalogue exists upstream; job #1 needs one thing baresuite does not have (2026-09-09)

M0a step 1, $0, no API calls. Premise (f) — *"the agent has a lib of primitives that should cover
all its needs"* — gets its first mechanical test.

**The catalogue shape does not need inventing; two upstream projects already have it.**
- `bareloop src/tools.js:93` — `TOOL_BY_VERB`, 14 verbs in four components, every verb mapped to an
  **existing implementation** (menu-is-inventory).
- `litectx src/contextgraph.js:38` — the CE taxonomy **already exported as data**:
  `PRIMITIVES = ["Write","Select","Compress","Isolate"]`, `VERBS_BY_PRIMITIVE`
  (`Write: remember/forget/write-gate · Select: recall/impact · Compress:
  assemble/compress/summaryWindow · Isolate: stash/peek/evict/scope`), and a flat `PRIMITIVE`
  lookup. It also records `SUBSTRATE` (`index/get/related/getNode`) as *"recorded, but not a CE
  primitive"* — the same distinction fwdloop needs between a primitive and its plumbing.

fwdloop's catalogue is these two shapes plus one component neither has: **`io`**, because
bareloop's steps never send anything and litectx's never leave the store.

**What is installed vs what exists.** `package.json` declares only `bare-agent@^0.42.0`;
`barebrowse` and `baremobile` are present transitively. On disk: bareagent 0.42.0, bareguard
0.15.0, litectx 0.32.0, barebrowse 0.20.0, baremobile 0.11.2, mailproof 1.3.3, beeperbox (no
package.json — Docker-shaped, not a library). Nothing was `npm install`ed for this finding.

**Job #1 mapped against what is really exported:**

| job #1 needs | primitive that covers it | verdict |
|---|---|---|
| read the message text | `bare-agent/tools` → `shell_read` | ✅ |
| read the AR sheet as **addressable cells** | — | ❌ **gap, see below** |
| match a customer, derive figures | model round + fwdloop's own close | ✅ (ours by design) |
| pause for a human | `bare-agent` → `Checkpoint` | ✅ |
| write the reply out (dry-run egress) | `shell_write` | ✅ |
| real mail egress (M9) | `mailproof` → `create`, `sendmail` | ✅ |
| fence fs/net/secrets/budget per step | `bareguard` → `Gate`, `redact`; `bare-agent` → `wireGate` | ✅ |
| memory across runs | `litectx` → `LiteCtx`, `remember`, `recall`, `stash` | ✅ |

**The one gap: nothing turns a file into a typed tabular artifact with stable cell addresses.**
`shell_read` returns bytes. fwdloop's citation contract is built on addressing — `{row: 2, col:
"Amount", cell: "E2"}` — and today `poc/m0/csv.mjs` is a **handroll**, which rule (f) forbids.

**This is a judgment call, not a ruling, and it is hamr's** (recorded, not decided here):
- *It is a primitive:* "read a sheet into a typed artifact" is a `gather`, and gather is a
  primitive class. If every consumer handrolls CSV parsing that is real duplication → upstream ask,
  and **M0 waits**, which is what rule (f) says happens.
- *It is ours:* `shell_read` already does the I/O; what is missing is only **parsing**, and the
  *addressing scheme* is fwdloop's own citation contract, not a shared concern. The CE primitives
  are Write/Select/Compress/Isolate — a CSV reader is none of them.

**Recommendation: it is ours, narrowly.** The split that holds: reading bytes is a primitive
(`shell_read`, have it); *deciding a citation resolves* is fwdloop's close (ours); and the thin
layer between them — bytes → rows with a stable address — is part of the citation contract, so it
lives with the close. Filing it as an ask would block M0 on a 60-line parser to earn a definition.
**If hamr rules the other way, M0 stops and the ask is filed** — the wait is a legitimate state.

**Premise (f) survives its first test with one asterisk.** Eight of nine needs are covered by an
existing, exported implementation. Nothing had to be invented and nothing had to be patched.
