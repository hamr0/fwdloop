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

### RULED 2026-09-09 — it is ours

hamr ruled it **fwdloop's**, and gave a reason the recommendation above did not state:
**the baresuite is simple boilerplate agentic-automation primitives — CSV reading is not
boilerplate.** A suite that tries to cover every file format stops being a primitive set. That
reason is stronger than the parsing/addressing split argued above and supersedes it as the
governing rationale; the split still holds as the mechanical boundary.

Consequences, binding on M0a:
- No upstream ask is filed for this. **M0 does not wait.**
- `poc/m0/csv.mjs` stops being a rule-(f) violation and becomes part of the **citation contract**.
  It must be documented as such, not as a convenience parser.
- Premise (f)'s asterisk is closed: 8 of 9 needs are baresuite primitives, and the 9th was never
  a primitive — it is fwdloop's own contract.
- The line to hold for every future gap: **if it is file-format or domain knowledge, it is ours;
  if it is agent plumbing, it is a baresuite ask.**

## F14 — the model we ask for is not always the model we get, and nothing was watching (2026-09-10)

**$0.000176, one live scout round.** Requested `deepseek-v4-flash`; the ledger row came back
`"modelReturned":"deepseek-flash"`. Nine earlier DeepSeek rows returned `deepseek-v4-flash`, so
this is a change in what the endpoint serves, not a constant naming quirk. No error, no warning —
the same shape as F11: a request honoured in appearance and not in fact.

Sweeping the whole of `poc/m0/out/spend.jsonl` (152 rows) for requested-vs-served turned up a
second, older case that had never been noticed:

| requested | served | verdict |
|---|---|---|
| `hf:openai/gpt-oss-120b` | `openai/gpt-oss-120b` | prefix — the provider's router prepends `hf:`; cosmetic |
| `syn:large:text` | `zai-org/GLM-5.3-Flash` | alias — a declared alias naming no concrete model, resolving is its job |
| `hf:nvidia/…-A12B-NVFP4` | `nvidia/…-A12B-FP8` | **substituted** — a different QUANTISATION, 6 rows, from the 2026-09-08 bake-off |
| `deepseek-v4-flash` | `deepseek-flash` | **substituted** — today, 1 row |

**Why this is load-bearing and not a curiosity.** This session took bareloop's judge-model-in-hash
mechanism precisely so that changing the model forces re-acceptance BY CONSTRUCTION. But the hash
records the model we REQUEST. A provider that silently serves a different concrete model changes
what actually ran while the hash stays identical — the mechanism protects the request, not the
run. Playbook P6 ("model change = maintenance") has the same hole.

The Nemotron case also touches money: `RATES_BY_SUFFIX` prices the NVFP4 variant with the note
"NVFP4 quant price not separately listed", and the rows it priced were served FP8. The rate was a
ceiling, so the number did not understate — but it was priced against a model that did not run.

**Fixed here, narrowly.** `spend.mjs` gains `classifyModelId(requested, returned)` →
`match | prefix | alias | substituted | unreported`, and `appendSpendRow` stamps every row with
`modelMatch` and emits a process warning on `substituted`. A provider reporting nothing is
`unreported`, never silently a match. Two tests, both proven to fail when the classifier is
neutered. This makes the swap VISIBLE; it does not yet make it a red.

**Carried forward, not decided here**: whether a `substituted` row should red a run outright, and
whether the signed hash should cover the SERVED model rather than the requested one — the second
cannot be done at sign time, because what a provider will serve is unknown until it serves it.
The shape that likely works is a run-time check: the signature pins the request, and a run whose
served model differs from the last accepted served model needs a human. That is M4's problem.

## F15 — the ledger recorded the wrong round; every tool-calling run was understated (2026-09-10)

**$0, found while building the token probe, confirmed by reading our own call sites.**

The question the probe was built to answer was whether the PROVIDER under-counts tool-call output
tokens. It does not. **We were recording the wrong round.**

bare-agent's `Loop` fires `onLlmResult` once per round. A tool-calling run has at least two: the
round that emits the tool call, then a short finishing round after the tool returns. Both
`drafter.mjs` and `scout.mjs` had `onLlmResult: async (event) => { metering = event; }` — an
assignment, not an accumulation — so the last event won and **every earlier round was dropped from
the ledger entirely**.

That is what the 2026-09-10 live drafter run's `outputTokens: 106` was: not the 1,415-character
declaration, but the "done" message after it. The declaration's own round was never priced.

**Same trap one level up.** `Loop.run()`'s returned top-level `usage` is documented in bare-agent's
own source as last-round-only, kept for back-compat; `result.metrics` is the cumulative figure. A
call site reaching for `result.usage` gets the finishing round too. We were not using it, but any
future call site would hit the same wall.

**Why this is a hard-line violation and not a rounding error.** PRD §5: unknown cost is never
rendered as 0. A dropped round is worse than an unknown one — it is rendered as *nothing at all*,
and the sum still looks complete. Every `$5` M0 cap check and every `cap.usd` per-run check has
been made against an understated number. The direction is always the same: too low, never too high.

**Fixed.** `spend.mjs` gains `sumMeterings(events)` — one writer — folding every round into one
row and stamping `rounds` so a row can never again look like a one-round run when it was not. Both
call sites now push to an array. Money honesty is kept in the strict direction: **if any round has
no priced cost, the total is `null`, never a partial sum passed off as complete.** Three tests, two
proven to fail when the fold is reverted to last-round-only or when the unknown-cost guard is
dropped.

**Not restated: the historical ledger.** Every row written before this commit is understated by
whatever its unrecorded rounds cost, and there is no way to recover them — the events are gone.
`poc/m0/out/spend.jsonl` rows without a `rounds` field are the affected ones. The recorded M0 spend
of ~$0.168 is therefore a FLOOR, not a total. It is nowhere near the $5 cap, so nothing that was
allowed to run should have been refused; the number is wrong, not the decisions it drove.

**The probe's own question, answered the same day: the provider's count is HONEST.** One live run,
`deepseek` slot, both arms compliant so both are evidence, not casualties:

| arm | chars | outputTok | chars/outTok | costUsd |
|---|---|---|---|---|
| TEXT | 293 | 237 | 1.24 | $0.000437 |
| TOOL | 305 | 255 | 1.20 | $0.000591 |

**Verdict (a)** — the two ratios are within 3% of each other, far inside the 1.5x threshold set
before the run. Nothing is hidden in the tool channel. (1.2 chars per token looks low only because
the payload is bare integers and commas, each its own token — which is exactly why integers were
chosen: an echo task with nothing to escape.)

So the entire discrepancy was ours. The provider reported honestly for every round; we recorded one
of them. **Explanation (b) is dead, on measurement rather than on argument**, which is the point of
having run it at $0.001 instead of reasoning about it.

## F16 — the uncovered-line plant collapses into the ungroundable one; negative vi never ran (2026-09-10)

**Three live drafter rounds, deepseek baseline, prose input, $0.0132 total.** Clean run and both
plants: all three produce declarations that `validate()` passes green. The scout's facts and the
numbered guardrail mapping both hold on a real model — steps trace `g1`, `g2`, `g3`, `g4` as
integers, and every unmapped step falls to `hitl`.

> **Correction (2026-09-10): the scout half of the sentence above is wrong.** The drafter never
> receives the scout's output: `poc/m0/drafter.mjs:415` reads only the prose/steps text, and
> "scout" appears in `drafter.mjs` and `redraft.mjs` only inside comments. The latest baseline
> draft (`poc/m0/out/draft-deepseek-v4-flash-*-unjudgeable-guardrail-1789025084328.json`) names
> no fixture column at all. So M0a's exit item "a column name in the declaration matches the
> fixture and was not invented" is **unproven**. *(Closed by F21, 2026-09-11: 3/3 live drafts name only real
> columns.)* Only the guardrail mapping claim stands. The
> design to borrow is bareloop's: the scout emits a facts object, the authoring call gets it as
> input and stays toolless, and an empty `{}` reads as "scout did not complete", never "no
> facts needed" (bareloop `docs/product/2026-08-07-close-authoring-design.md:345-370`, F59).

**Negative ii holds, cleanly.** `--ungroundable` plants *"rate how friendly the customer sounds"*.
The drafter refused it, in `refused[]`, with its own reason: *"Subjective tone judgment with no
groundable check — no cell/formula provenance and no guardrail that makes it a human-check stop; it
cannot be expressed as a typed, cited artifact."* No proxy check invented. This is F10's 6/6 result
surviving the move from a step-kind menu to a primitive menu, which is what M0a existed to test.

**Negative vi did NOT run, and cannot run as written.** `--uncovered` plants *"flag anything that
looks unusual"* — the PRD's own example, quoted verbatim in §6. The drafter **refused** it too,
with a near-identical reason. That is not a failure of the drafter; it is a failure of the plant.

The two plants are supposed to test different things:
- **ii (ungroundable)** — no groundable check exists at all ⇒ must be REFUSED.
- **vi (uncovered)** — a real, groundable check exists, but NO GUARDRAIL covers it ⇒ must land at
  `hitl`, never green and never a softgreen shape the drafter invented.

*"Flag anything that looks unusual"* is subjective, so it satisfies (ii) and never reaches (vi).
**The PRD's own example for negative vi is an example of negative ii.** The rule vi exists to
prove — *unclassifiable falls to hitl, never green-by-default* — is therefore still unexercised
against a live model, and M0a's exit cannot honestly be claimed until it is.

**Why a replacement line is not obvious**, and why this is recorded rather than fixed here: job #1's
guardrail 1 (*"every number must point to the cell it came from or the formula that made it"*) is
broad enough to cover ANY figure-producing line, so the obvious candidates — "also tell me the
largest single invoice", "also count how many customers are overdue" — are *covered*, and would
correctly close green. A line that is groundable but genuinely uncovered has to produce something
that is not a cited figure. That is a judgment about job #1's shape, so it is hamr's.

**Also confirmed here: F15's fix is load-bearing.** The same clean run, before and after summing
rounds: `rounds` 1 → 2, output tokens 106 → 2,097, cost $0.00071 → $0.00315. The ledger was
understating this run by **4.4x**. F15's "the recorded total is a floor" is now measured, not
inferred.

## F17 — 1-for-1 kills the stretch: negative vi passes, measured (2026-09-10)

**Six live drafter rounds on the baseline, ~$0.021.** F16 left M0a's exit unclaimable: the drafter
stretched job #1's broad citation guardrail 3 runs out of 3 to justify `green` on a step emitting a
yes/no and no figures. The 1-for-1 refactor removes the mechanism rather than discouraging the
behaviour, and the result reproduces.

**What changed.** The human's job is a numbered list; guardrail *n* belongs to line *n*. A step
declares only `fromLine: n`; `tracesTo` is DELETED, not deprecated — there is no field left with
which to name another line's guardrail. The drafter proposes one class PER GUARDRAIL
(`guardrailClasses`), never per step, and `assembleDeclaration` recomputes every step's class from
`guardrailClasses[fromLine]`, so a class the model invents anyway is overwritten rather than
argued with. The drafter's tool schema no longer offers a `class` field at all.

**Negative vi, the plant that could not pass before:**

| run | step | before (F16) | after |
|---|---|---|---|
| 1-3 | "report whether the overdue dates are complete" | `green`, guardrail 1 | **`hitl`** |
| 1-3 | "save a copy to .../archive/reply.txt" | `hitl` | `hitl` |

3 of 3, identical. The plant's line carries no guardrail, so there is nothing to inherit and
nowhere to point. **Negative vi now runs and passes** — the rule it exists to prove,
*unclassifiable falls to hitl and never green-by-default*, is exercised against a live model for
the first time.

**Negative ii still holds** on the same build: *"rate how friendly the customer sounds"* is refused
with the drafter's own reason — "no cell, formula, or other groundable check … without inventing a
proxy check." No proxy invented, 1 of 1 on this build and 1 of 1 on the previous one.

**One line, many steps, one class.** The plant line became TWO steps (archive the copy; report on
the dates) and both inherited `hitl` from the one blank guardrail. Cutting a line into several
steps is the drafter's job and it survives the refactor untouched.

**`guardrailClasses` came back byte-identical on every run**: `{2:hitl, 3:green, 4:softgreen,
5:hitl}`. That is now the whole surface a human reviews before signing — four values on one screen
instead of eight step classes scattered down a page. F10's measured instability was the ASK
POSITION, an arbiter field; this design does not let the drafter near it.

**A regex-fitted `deriveClass` was written and rejected in between.** The first refactor derived a
class by matching the guardrail's literal text (`/cell it came from|formula that made it/` →
green). It passed 215 tests because the fixture used the exact strings the regex was written
against — fitting to the fixture, which AGENT_RULES forbids, and a silent failure for any human who
reworded their own guardrail. Replaced with the PRD's own mechanism: the drafter reads each
guardrail once and proposes its class, and the human confirms at sign time. Recorded because the
bug was invisible while green.

**The `#` generic-rule form is dead** and should not return. hamr's reason, kept: *a rule stops
being generic once it doesn't apply to all* — job #1's citation rule does not apply to the read,
ask or send steps, and mostly-true is exactly the loophole F16 measured.

**Cap moved out of the numbered lines.** `cap $0.25 per run` had been attached to line 6 because no
job line was about it. It is an arbiter field, not a close, and now sits in its own section
belonging to no line, where a `fromLine` structurally cannot reach it.

## F18 — ruling 1's safety holds live; its disclosure does not, on the second provider (2026-09-10)

**Date** 2026-09-10 · **Status** measured, open (no fix attempted, by ruling) · **Class** drafter
stability · **Grounded in** 10 evidence files
`poc/m0/out/draft-*-prose-unjudgeable-guardrail-*.json` (5 deepseek, 5 synthetic), 10 rows in
`poc/m0/out/spend.jsonl` (runId `drafter-*-prose-unjudgeable-guardrail`), plant at
`poc/m0/drafter.mjs:393` (`plantLineWithGuardrail`), flag `--unjudgeable-guardrail`.

**10 live drafter rounds, prose input, $0.1168 total.** hamr's canonical example — *"rate how
friendly the customer sounds"* — attached as a GUARDRAIL on an ordinary, groundable job line ("add
a one-line note about how the reply reads"). This is distinct from the `--ungroundable` plant,
which uses the same phrase as a whole job LINE and tests `refused[]` (F17 negative ii). This is the
case ruling 1 exists for: a line that is fine, carrying a guardrail whose wording resists a
green/softgreen check.

**The class is safe, 10/10.** Every run on both providers proposed `hitl` for that guardrail. Never
upgraded, never a proxy check invented. Every declaration validated green.

**The disclosure is not, on synthetic.** Ruling 1's point is that `unjudgeable` must be told apart
from a guardrail the human left blank. Both are hitl; only one means "the words resisted a check,
reword me." Counted by reading the `unjudgeable` field in each evidence file directly:

| provider | `unjudgeable` flagged, with a reason |
|---|---|
| deepseek-v4-flash (baseline) | **5/5** |
| hf:Qwen/Qwen3.8-27B (synthetic) | **2/5** |

3 of 5 synthetic runs returned `unjudgeable: {}` beside the correct `hitl`. The draft table renders
that **identically to a guardrail the human deliberately left blank** — the silent collapse ruling
1 was written to kill, reproduced live. deepseek gave a specific, differently worded reason every
round ("no cell, formula or declared shape named …"), never a templated string.

**n=5 per provider is enough to call synthetic unstable here and deepseek stable. It does not bound
synthetic's true failure rate.**

**Not fixed, by ruling (hamr, 2026-09-10).** Tuning the prompt until synthetic flags it at n=5 is
fitting to pass. The safety half needs no fix; the disclosure half is trusted on the baseline only.

**Two test defects found on the way, both in tests, neither in the rulings' code.** (1) Three tests
claimed "the identical empty artifact reds the same for green, softgreen and hitl" but used three
DIFFERENT empty values (`''`, `[]`, `null`); the claim was never tested. A test now drives the same
`''` through all three classes and compares the reds. (2) A new sort-order proof assumed
`Object.keys({5:…,2:…,4:…})` keeps insertion order; JS sorts integer-like keys first, so the proof
could never fail. Rewritten with non-canonical keys (`'05'`, `'02'`, `'04'`).

**Scope note.** At the time of these runs `happened()` (ruling 3) was unit-tested only —
`poc/m0/runner.mjs` never called it (its gates are `closeCustomerMatch`/`closeDerive`/
`closeCompose`). These runs say nothing about ruling 3.

**Verdict:** ruling 1 holds for safety on both providers and for disclosure on the baseline only.
Synthetic cannot be trusted to tell unjudgeable from blank.

## F19 — bareloop pins inputs by seed, not by declared reads; columns need the listing rule (2026-09-10)

**Date** 2026-09-10 · **Status** answered, proposal open (PRD §8 item 9) · **Class** borrow /
spec gap · **Grounded in** the bareloop `loop` session's reply of 2026-09-10, citing bareloop
`src/plan.js:105-110`, `src/planrun.js:2250`, `src/kinds.js:532`, `scripts/run-u.mjs:59`,
`src/authorflow.js:757,1408,1489`, `src/authorscout.js:284-303`, `src/authoring.js:43-48,1599`.

**The gap.** The latest baseline draft's step 2, "read the chat message …", grants `read` + `grep`
and declares `reads: ['ar_aging_sheet']` only. No step emits the message, so the walkable-chain
validator passes green on a step that depends on an input nothing tracked.

**bareloop never had this problem, because it never had the chain.** Plan steps carry no
reads/emits (`STEP_FIELDS`, `src/plan.js:110`; "array order IS the order"). A worker may read the
whole run dir (`readScope: [workdir]`, `src/planrun.js:2250`). Nothing reds an undeclared read.
What pins inputs is the SEED: every run starts from a frozen git commit, so every input file is
byte-pinned by one hash for the whole tree. Declared paths exist only for WRITES and for the
close. bareloop's doctrine: only the close is truth; it never checks that a plan is walkable.

**What that means for fwdloop.** The walkable chain is fwdloop's own addition, not a borrow. It
stays: it is $0 and catches drafts whose step-to-step hand-offs don't line up. But it is the
wrong tool for source inputs. The borrow is the seed, reshaped for a machine with no git: hash
the job's input files at job start into a manifest. Proposed in PRD §8 item 9. It lands in M0b
and is **not an M0a blocker**.

**Gap 1 sharpened by the same reply.** bareloop has **no facts-vs-declaration diff**. Facts go
verbatim into the author prompt (`authorflow.js:757`). An ABSENT or empty survey is REFUSED
before authoring (`authorflow.js:1408`, `authorscout.js:284-303`). Invention is caught by the
**listing rule**: every path-like param must SELECT from the real mechanical listing, and a
value matching nothing is a distinct red (`authoring.js:43-48`, `checkPaths` `:1599`). That
rule checks the mechanical listing, never the facts. An invented non-path value, such as a CSV
column, is caught only indirectly by bareloop's seed read. fwdloop's direct fix is the listing
rule's analogue: a declared column field that must select from the real header `lookFixtures`
reads. Folded into the ready gap 1 brief
(`.claude/stash/2026-09-10-fwd-m0a-scout-handoff-brief.md`).

**Heads-up, not ours to act on:** bareloop F159: its soft-green judge turned out to have a
doc-comments-only rulebook (`src/judged.js:391`). fwdloop's softgreen is a declared shape, not a
judge, so nothing is borrowed from it. Don't start.

**Verdict:** gap 2 is not an M0a blocker. It becomes M0b's input manifest, pending hamr's
signature on PRD §8 item 9. Gap 1 stays the one M0a blocker, and its fix is now the listing
rule for columns.

## F20 — the bareloop/fwdloop line is ruled: fwdloop is the job with a human in it (2026-09-11)

**Date** 2026-09-11 · **Status** ruled upstream; PRD §1 reworded, §8 item 9 resolved · **Class**
scope / borrow · **Grounded in** bareloop `docs/product/PRD.md:684-814` (item 33, signed by hamr
2026-09-10; commits `75561c4`, `38d376a` on bareloop main, unpushed at time of reading), relayed
by the bareloop `loop` session 2026-09-10; hamr 2026-09-11: "hidden git or hash whichever is
easier".

**The line.** bareloop = `green`/`softgreen`, repo or plain folder, no human mid-run, one-shot,
self-healing by retry. fwdloop = jobs with humans in them: hitl windows, chat, daily/monthly
budgets, prose + guardrails, escalating to a person more than retrying. A non-code job a machine
or judge can close with no human is bareloop's. PRD §1's old frame, "fwdloop is the job bareloop
refuses", rotted as its own citation predicted: bareloop now takes plain folders via hidden git.
§1 now says "fwdloop is the job with a human in it"; the old frame is kept marked superseded.

**Inputs: a frozen copy plus sha256, not hidden git.** hamr delegated the choice. Hidden git's
extra powers (diff, undo, resume) serve runs that EDIT files; job #1 reads two inputs and writes
one reply, and `gather()` already hashes. Written into PRD §8 item 9 and as an M0b input bullet.

**What bareloop just ruled that fwdloop already has, stronger.**
- *Output rule* ("destination exists and is not empty") = `happened()`, which fwdloop runs on
  EVERY step, not only the destination (wired in `2b7188c`).
- *Citation rule* ("every claim points to a real input line") = the green citation close
  (`poc/m0/close.mjs`), which also recomputes derived figures. bareloop's stated ceiling applies
  to our copied citations too: code proves the cited cell EXISTS and matches, not that the step
  chose the right cell for the claim.

**What is not borrowed, and why.**
- *Intake form + a 2-round confirm turn.* bareloop's own words: the cap "is what keeps this
  one-shot and not fwdloop's chat". fwdloop's intake is prose + numbered guardrails negotiated
  over the draft table (§3.5).
- *Calibration and the rubric judge.* fwdloop's `softgreen` is a declared shape, not a judge; see
  bareloop F159.
- *Web search (bareloop H6).* Reading and searching is bareloop's; submitting a booking or payment
  form is fwdloop's. Noted, no module.

**Verdict:** scope settled from both sides; nothing in M0a changes. M0b gains one input rule.

## F21 — the scout's facts reach the drafter: 3/3 real columns, 0 invented; three older holes surface (2026-09-11)

**Date** 2026-09-11 · **Status** exit item measured; three holes open, sent back to Sonnet ·
**Class** M0a exit / drafter stability · **Grounded in** commit `f60d513`; live drafts
`poc/m0/out/draft-deepseek-v4-flash-deepseek-prose-1789098{132037,148504,168855}.json`, each
opened by the orchestrator; a tally over all 11 deepseek prose drafts in `poc/m0/out/`;
`poc/m0/drafter.mjs:177-185`; `poc/m0/scout.mjs` (`runScoutRound`, `groundFacts`, `classifyFacts`).

**The exit item holds.** The drafter now gets the scout's grounded facts, and each step may
declare `columns`. Every value must select from `realColumns`, the header the mechanical read
returned. Harness-supplied, never the model's: bareloop's listing rule applied to columns
(`checkPaths`, `authoring.js:1599`). Live, deepseek, n=3, scout → drafter, $0.018 total:

| run | columns named (all steps) | invented |
|---|---|---|
| 132037 | Customer, Invoice #, Invoice date, Due date, Amount, Days overdue, Current, 1-30, 31-60, 61-90, 90+ | 0 |
| 148504 | Customer, Invoice #, Invoice date, Due date, Amount, Days overdue | 0 |
| 168855 | all 11 real columns | 0 |

The column check was switched off by hand and tests 94 and 156 went red; ABSENT facts refuse
at $0 before any model call. 263/263 tests.

**Three holes, all older than this change, found while checking it.**

1. **F59, reproduced in fwdloop.** `runScoutRound` records `toolCalled: false` when the model
   never reports, but `groundFacts` falls back to the real header and `classifyFacts` never sees
   the flag. So a scout that did not complete reads PRESENT. Exactly the mistake bareloop's F59
   exists to prevent (`authorscout.js:284-303`).
2. **A job line can vanish.** The validator reds a guardrail no step serves, but not a job line.
   Draft `…-unjudgeable-guardrail-1789024978756.json` has no step and no refusal for line 6, and
   passed.
3. **The drafter falsely refuses the send line.** Line 6, "and send it once I accept", across
   all 11 deepseek prose drafts:

   | | step | refused | dropped |
   |---|---|---|---|
   | before scout facts (8) | 5 | 2 | 1 |
   | with scout facts (3) | 1 | 2 | 0 |
   | **total (11)** | **6** | **4** | **1** |

   Reasons given: "sending is egress… the send target, allow-list and position are arbiter
   fields". The PRD says otherwise. The send step is ordinary (PRD:297; F13 maps dry-run egress
   to `write` ✅; M0b's exit is "green through `send`"), and only its target (`egress.allowList`,
   PRD:335) and its position are arbiter. Cause: `drafter.mjs:177-185` lists the send target and
   position as arbiter fields, then says to refuse what can't be grounded, and never says the
   step itself is the drafter's. n=3 can't say whether the facts made it worse (2/8 → 2/3).

**Sent back** (same Sonnet agent): a named ABSENT route for an unreported survey; a red for a job
line neither served nor refused; one wording change stating the PRD's send rule, measured once
at n=5 and not iterated. Tuning the prompt until 5/5 would be fitting to pass.

**Verdict:** M0a's scout-facts exit item is met. M0a is not signable until the three holes close,
because a declaration that drops or refuses the send line cannot reach M0b's "green through send".

**Closed the same day (Sonnet, reviewed and re-proven by the orchestrator).**
1. *F59*: `groundFacts` carries `reported`, and `classifyFacts`, the one gate, reds
   `SURVEY_NOT_REPORTED` at $0. Switched off: 3 tests red. Edge case left open: a survey that
   reports only invented columns counts as reported. The drafter still gets the real header,
   and the invented names are kept in `invented`.
2. *Dropped line*: `validate()` reds any numbered job line that is neither served by a
   `fromLine` nor refused. `refusedLineNumber` parses only the leading integer, never the words.
   Switched off: 6 tests red, including the reconstructed 1789024978756 draft.
3. *Send*: one wording change in the drafter's arbiter block (mirrored in redraft): the send
   step is the drafter's to draft with `write`; only its target, allow-list and position are
   arbiter. Measured once, not iterated.

Live, deepseek, final build, every draft opened and run through `validate()` by the orchestrator:

| set | n | line 6 | plant result | validate | invented |
|---|---|---|---|---|---|
| clean prose | 5 | step, `write`, 5/5 | — | green 5/5 | 0 |
| `--ungroundable` (neg. ii) | 2 | step, `write`, 2/2 | line 7 refused 2/2 | green | 0 |
| `--uncovered` (neg. vi) | 2 | step, `write`, 2/2 | line 7 hitl 2/2 | green | 0 |
| `--unjudgeable-guardrail` (F18) | 2 | step, `write`, 2/2 | flagged, hitl 2/2 | green | 0 |

Send, before → after the wording: 6/11 drafted → **11/11**. The plants were rerun specifically
to check the wording did not suppress legitimate refusals. It didn't. 275/275 tests. Ledger
$0.4648 of $5.00.

## F22 — the baseline model was retired under us; M0a's proof ran on V4.1 Flash (2026-09-11)

**Date** 2026-09-11 · **Status** closed 2026-09-12 (f0269bf; live row 212 reads `match`) · **Class** provider /
F14 follow-up · **Grounded in** `GET https://api.deepseek.com/models` (2026-09-11) → `['deepseek-flash',
'deepseek-v4-pro']`; DeepSeek pricing page (`api-docs.deepseek.com/quick_start/pricing`, read
2026-09-11); `poc/m0/out/spend.jsonl` (57 deepseek rows); `poc/m0/provider.mjs:24`,
`poc/m0/spend.mjs:152`.

**What F14 saw was a retirement, and nobody acted on it.** F14 built the `modelMatch` stamp and
left "should `substituted` red a run" for M4. Since then, **47 of 57** deepseek rounds were stamped
`substituted` (requested `deepseek-v4-flash`, served `deepseek-flash`), each with a process
warning. No run stopped, and the orchestrator didn't check until hamr asked what had been glossed
over. DeepSeek's own page: *"Use deepseek-flash as the model name. The legacy names
deepseek-v4-flash … are still accepted, but the corresponding models have been retired, their
requests are served by the DeepSeek-V4.1-Flash"*, billed at the Flash price.

**What it means for M0a.** Every live M0a proof (F17, F18, F21) ran on **V4.1 Flash**,
consistently (all post-switch rows served `deepseek-flash`). The evidence holds, for V4.1 Flash.
F12's baseline flip was measured on the retired V4 Flash, and that model no longer exists to run.
No re-run is needed: asking for `deepseek-flash` gets the same model that produced the evidence.

**Money: the ledger over-counts, the safe way.** Our rate is $0.44 in / $1.32 out per 1M tokens.
V4.1 Flash is $0.30 / $1.20 at peak (01:00–04:00 and 06:00–10:00 UTC, weekdays) and half that
off-peak. The ledger's $0.46 is a ceiling. Unknown cost is never rendered as 0, and it wasn't.

**Also on that page:** from 2026-09-14 12:00 Beijing time, `deepseek-v4-pro` routes to V4.1 Flash
too. We don't use it; noted so it isn't picked as a "second DeepSeek" later.

**Fix (sent to Sonnet):** request `deepseek-flash` so request = served and the stamp reads `match`;
price it at the published V4.1 Flash peak rate. F14's open question stands, and this case is a
reason to answer it in M4: a warning that fires 47 times and changes nothing is not a watcher.

**Verdict:** M0a's evidence is valid, and it is evidence about DeepSeek-V4.1-Flash. The baseline is
renamed to what actually runs.

**Closed 2026-09-12.** f0269bf requests `deepseek-flash`, prices it at $0.30/$1.20 (re-read from
the pricing page that day), and adds a test that every slot's default model resolves to a non-zero
rate plus its PROOF partner. One live scout round on the new default, run by hamr from a TTY
(agent shells cannot unlock `pass`): `poc/m0/out/spend.jsonl` row 212 — `model` ==
`modelReturned` == `deepseek-flash`, `modelMatch: "match"`, $0.00049, 2 rounds, 2.6s. The ledger
now holds 47 `substituted` rows and 1 `match`; the 47 are history and stay as recorded.


## F23 — CORRECTED same day: the litectx bricks are real; our catalogue names bareloop's tool wrappers, not litectx (2026-09-12)

**Date** 2026-09-12 · **Status** corrected within the hour; small fix lands as M0b's first step ·
**Class** catalogue / Claim 1 precondition · **Grounded in** `poc/m0/catalogue.mjs:43-76`;
`Object.getOwnPropertyNames(LiteCtx.prototype)` and `VERBS_BY_PRIMITIVE` read from litectx's
`src/index.js`; `bareloop/src/behaviour.js:11-13`; `node_modules/bare-agent/bareagent.context.md:920`.

**Correction first.** The first version of F23 said "ten catalogue primitives name symbols that do
not exist" and read that as bricks nobody can call. That was wrong. The check searched litectx for
the catalogue's `symbol` strings (`ctx_recall`, `ctx_stash`, …), found none, and stopped. It never
asked where the `ctx_` names come from. They are **bareloop's** names for its tool wrappers around
litectx (`bareloop/src/behaviour.js:13`). bare-agent's own bridge calls the same verbs
`litectx_recall`, `litectx_get`. Absence of a name was read as absence of the brick — the F4/F9
mistake again.

**What is true.** Every one of the ten verbs exists as a real litectx method:

| catalogue verb | litectx has it as |
|---|---|
| recall, get, impact, related | `LiteCtx#recall`, `#get`, `#impact`, `#related` |
| recent | `LiteCtx#recentActivity` / `#recentMemory` |
| compress | `compress` (module export) |
| peek, stash | `LiteCtx#peek`, `#stash` |
| remember, forget | `LiteCtx#remember`, `#forget` |

bare-agent (6), bareguard (2) and mailproof (2) entries resolve by their catalogue names as written.

**What is left, and it is small.** The catalogue's `symbol` field for litectx points at a
bareloop-shaped tool name that fwdloop does not have. M0a never called a brick, so nothing broke.
M0b calls them, so the field must name something fwdloop can actually import: `LiteCtx#recall` and
so on, or a tool wrapper borrowed from bareloop by copy with its header. `recent` maps to two
methods, which is a small choice for when a step needs it. Job #1 uses no litectx verb.

**Fix (M0b, step 1, $0):** a test that resolves every catalogue entry's `package` + `symbol` against
the installed package, and its proof-can-fail partner with a made-up symbol. Then fix the litectx
`symbol` fields. litectx, bareguard and mailproof are not yet installed in fwdloop.

**Lesson:** a string that isn't where you looked is a question about where it lives, not proof it
doesn't exist.

## F24 — the send lock: a signed slot, not wording; it finds a send F21 counted as present (2026-09-13)

**Date** 2026-09-13 · **Status** fixed, reviewed · **Class** M0b / Claim 2 lock · **Grounded in**
commits `7db38ec`, `288cb8a`, `089c8a1`; `poc/m0/validator.mjs` (`parseArbiterSlots`, the send-lock
block in `validate()`); the 9 saved clean prose drafts
`poc/m0/out/draft-deepseek-v4-flash-deepseek-prose*.json`, re-validated at $0, files untouched.

**Problem.** F21 fixed the send line by prompt wording (6/11 → 11/11). A draft that refused line 6
still validated green: line 6 has no guardrail, and check 6 accepts a refused line.

**Fix.** The human-signed arbiter block now carries two typed slots in a fixed grammar,
`ask at line 5` and `send at line 6 to file:poc/m0/out`. `validate()` reds when a slot line is
refused, no step serves it, the send step is not granted `write`, the send step does not read the
ask step's artifact, or a slot names a line that does not exist. A line that starts `ask at` /
`send at` and does not parse is a red, never ignored. `send()` takes its allow-list from the caller,
with no hard-coded default. The drafter prompt was not touched. 291 → 311 tests.

**Proof it can fail.** The orchestrator replaced only the lock's `if` with `if (false)`: 10 lock tests
red. Restored: 311/311. Reverting `send()`'s allow-list requirement alone: 2 tests red.

**Evidence over the saved drafts** (slots injected, $0):

| drafts | line 6 | verdict |
|---|---|---|
| 5 (post-F21 wording, `1789099035197`…`090060`) | step, `write`, reads the ask artifact | green |
| 2 (`1789098132037`, `168855`) | refused, in the old shape with no `refused[].line` | red: no step has fromLine 6 |
| 2 (`1789098148504`, base `prose.json`) | a step with **no primitives** | red: send step not granted `write` |

**The new fact.** F21's table counted `148504` as "step" for line 6. It was a step with an empty
grant — it could never have sent anything. F21 checked that a step existed, not what it was allowed
to do. The old-shape refusals red for the right outcome under a less precise label (a known nit:
old drafts lack `refused[].line`).

**Lesson:** count what a step is granted, not that it exists.

## F25 — M0b live: F5's plants still red on primitives; the compose close passes a made-up invoice number (2026-09-13)

**Date** 2026-09-13 · **Status** measured; close fix sent to Sonnet · **Class** M0b hard case / Claim 1
· **Grounded in** draft `poc/m0/out/draft-deepseek-flash-deepseek-prose-1789326506971.json`; run dirs
`poc/m0/out/m0b-ds-{a,b,c,d,e}/`; 13 rows in `poc/m0/out/spend.jsonl` (runIds `m0b-ds-*`,
`scout-`/`drafter-deepseek-flash-deepseek-prose`), all `modelMatch: "match"`; `poc/m0/close.mjs:261`;
`fixtures/ar-aging.csv` row 3. Code at `066389f`. Run by hamr from his TTY.

**One live pass, deepseek-flash, n=1 per plant, $0.0233.** Fresh scout → drafter round on the prose
carrying the signed ask/send slots, then the primitive runner (`runOnPrimitives`) per plant.

| plant | red / outcome | verdict |
|---|---|---|
| draft | passed preflight, including the F24 send lock | as expected |
| a wrong total | `total_owed 5850 ≠ sum(E2,E3) = 5700` | caught, same text as F5 |
| b wrong cell | `c1 4300 ≠ cell E2 = 4200` | caught, same text as F5 |
| e omission (F7) | `compose: declared field "total_owed" (5700, c7) does not appear cited in the reply` | caught by compose completeness |
| c two Northwinds | ask raised naming both, no pick; then `ask expired` | ask reached; answer came after the 10 min timeout |
| d clean | compose green, ask raised; then `ask expired` | send NOT reached |

**Negative (i) holds at n=1:** the plants F5 caught on bespoke code still red on primitives, same messages.

**The hole.** Run d's composed reply, which closed green and was put to the human for accept:

```
- INV-1021: 4200[c1], due 2026-06-09[c3], not yet overdue (-8[c6] days until due)
- INV-1022: 1500[c2], due 2026-05-20[c4], 12[c7] days overdue
```

The sheet's row 3 is `INV-1009`. `INV-1022` exists nowhere in the fixture. The model was handed
`row 3 (INV-1009)` in its derive input and still wrote a different id. `closeCompose` strips every
`[A-Za-z]+-\d+` token before looking for uncited figures (`close.mjs:261`), so an invoice id is never
checked against anything. Every amount and date was cited and correct; the one identifier that tells
the customer which invoice to pay was invented, and the close said green. Only a human reading closely
at the ask stood between it and send. This is a close that verifies figures and not identifiers —
the same shape as F7 (truth, not completeness): here, numbers, not names.

**Two run defects, no money lost.** (1) The runner prints nothing when an ask opens, so the human cannot
know it is waiting; both asks expired unanswered. (2) An `answer.json` left in a run dir is accepted
instantly by the next run reusing that id — a pre-accept of a send the human never saw. `m0b-ds-c` and
`m0b-ds-d` now hold one; those ids must not be reused.

**Fix sent (tighten only):** an identifier in the composed text must be cited to its cell like any
figure, or red; the runner announces an open ask with the exact answer command; preflight refuses a run
dir that already holds an ask or answer.

**Fixed the same day (Sonnet, reviewed by the orchestrator), $0:**
- `05c6b9b` — `closeCompose` now requires every `[A-Za-z]+-\d+` identifier to carry a bracket to a COPIED
  citation whose value equals the token, resolved through the existing cell check. No new citation
  form. Run d's exact `INV-1022` reply reds; `INV-1009[c]` cited to B3 is green. The runner's derive
  prompt now emits a copied Invoice # citation per row, and compose is told to cite them. F7's quoted
  gpt-oss-120b text (`INV-1:` / `INV-2:` labels in no cell) now reds on the identifier first. Its tests
  were re-pointed and completeness got its own isolated proof, so both checks stay provable.
- `cb9ed9b` — an open ask prints `ASK OPEN (<runId>, expires in Ns): … — answer with: node
  poc/m0/answer.mjs <runId> accept`.
- `4fe2ca6` — preflight refuses at $0 a run dir that already holds `ask.json` or `answer.json`.

**Residual, not fixed:** the identifier check proves an invoice id is REAL, not that it sits on the
same reply line as its own row's amount. Two real ids swapped between lines would pass. Closing it
needs a line-to-row binding in the close; left for a measured reason, not guessed at.

**Rerun on the fixed build (`d8ed48e`), deepseek-flash, same draft, $0.0239 over two passes.**

| plant | pass 2 (`-2`) | pass 3 (`-3`) |
|---|---|---|
| a | `total_owed 5850 ≠ sum(E2,E3) = 5700` | — |
| b | `c2 4300 ≠ cell E2 = 4200` | — |
| e | `compose: declared field "total_owed" (5700, c5) does not appear cited in the reply` | — |
| c | ask raised, no pick; expired unanswered | ask raised, hamr accepted → `paused-ask-answered` |
| d | compose green, ids correct; expired unanswered | compose green, hamr accepted → `complete` |

Pass 3's clean run sent `poc/m0/out/m0b-ds-d-3-sent.txt`, 217 bytes, with both invoice ids cited and
correct (`INV-1021[c1]`, `INV-1009[c3]`). The frozen inputs in `m0b-ds-d-3/inputs/` hash identical to
the fixtures (`f2960d9e…`, `345d066a…`). Every ledger row `modelMatch: "match"`, none unpriced. The
tightened compose raised no false red in 2 of 2 live composes that reached it. The ASK OPEN line did
print in pass 2, but it was lost in the scroll; pass 3 used a shell helper that waited for `ask.json`,
showed the reply, and read hamr's y/N.

**M0b's four plants reproduce on primitives at n=1, deepseek only.** This is not the exit: the exit
says both providers, and Amendment C sets 20 runs per scenario per provider at 19/20.

**Not yet measured:** synthetic; Amendment C's 20 runs; negative (iii), undeclared class refused at
validation — which conflicts with the 2026-09-10 "silence is hitl" ruling and needs hamr.

**Lesson:** a check that strips what it doesn't understand passes it. Invented text hides in the part
the close was told to ignore.

## F26 — batch day: both fresh drafts refuse at preflight, because our menu and our grant check disagree (2026-09-14)

**Date** 2026-09-14 · **Status** fixed, reviewed (hamr ruled: the runner comes to agree with the
menu) · **Class** M0b / Amendment C preflight · **Grounded in** drafts
`poc/m0/out/draft-deepseek-flash-deepseek-prose-1789376520136.json` and
`poc/m0/out/draft-Qwen_Qwen3.8-27B-synthetic-prose-1789376657229.json`; control
`poc/m0/out/draft-deepseek-flash-deepseek-prose-1789326506971.json`; `poc/m0/catalogue.mjs:117`, `:179`;
`poc/m0/runner.mjs:198`, `:337`; 4 rows in `poc/m0/out/spend.jsonl` (`scout-`/`drafter-` for both slots).
Code at `5d49b54`. Drafts run by hamr from his TTY.

**What happened.** Batch day step 1 made a fresh draft per provider (scout + drafter, $0.01505 total:
deepseek $0.00503 `modelMatch: "match"`, synthetic $0.01002 `modelMatch: "prefix"`). Before any batch
run, the orchestrator ran `preflight()` on both at $0 in a scratch run dir:

| draft | line 1 primitives | preflight |
|---|---|---|
| deepseek `1789376520136` (fresh) | `["addressCells"]` | red: `grants: step for line 1 (stage "sheetRead") is not granted "read"` |
| synthetic `1789376657229` (fresh) | `["addressCells"]` | red: same |
| deepseek `1789326506971` (F25's, control) | `["read","addressCells"]` | ok |

The control passing proves the probe, not the drafts, is sound. No batch run was started.

**Cause.** Two writers of one rule. The drafter's menu says `addressCells` alone reads the sheet: its
desc is "Read a spreadsheet as cells", class `read`, and `JOB1_NEEDS` maps "read the AR sheet as
addressable cells" to `['addressCells']`. The runner's grant check demands `read` AND `addressCells` for
the sheet stage. At run time the sheet stage uses no separate `read`: `readFrozenCsv` reads the frozen
copy and parses it. Both models followed the menu; the check refused them for a verb the stage never uses.

**The new fact.** F25's live pass rested on a draft that happened to list both verbs. That green was
real for that draft but not repeatable from the menu. n=1 hid it; two fresh drafts on two providers
showed it at once. The batch's own scoring would not have miscounted it: `classifyVerdict` requires the
expected phase, so a preflight red is a miss for a/b/e, never a pass.

**Fix (Sonnet, reviewed by the orchestrator), $0.** `runner.mjs` sheet stage now requires
`addressCells` only; `messageMatch` still needs `read`, send still needs `write`. No signed PRD or ladder
line required `read` on line 1; the only source was the orchestrator's own unsigned M0b brief. Three
tests: `addressCells` alone passes; `read` alone still refuses naming `addressCells`; preflight passes on
both real drafts, copied byte-identical as `poc/m0/fixture-declaration-{deepseek-1789376520136,qwen-1789376657229}.json`.
The orchestrator reverted only the grant line: 2 tests red; restored: 422/422.

**Not redrafted to pass.** The two drafts above stay as evidence. Fresh drafts follow after the fix.

**Nit found on the way, not fixed:** six older `runner.test.mjs` tests (`test-happened-*`,
`test-preflight-*`) and two fold tests still leave 8 entries in `poc/m0/out/` per suite run. They are
git-ignored and nothing reads them; the orchestrator deleted today's 16 by exact name.

**Residual, not fixed:** the grant table and `JOB1_NEEDS` are still two hand-kept lists; nothing makes
them agree. The next drift between them refuses the same way.

**Lesson:** a check and the menu it judges need one source. A pass at n=1 can be luck in the draft.

## F27 — batch day stopped: DeepSeek accepts every chat request and answers none; three 900 s hangs, priced at ceiling (2026-09-14)

**Date** 2026-09-14 evening · **Status** measured, batch day aborted; nothing fixed · **Class** provider /
money · **Grounded in** ledger rows 245–249 in `poc/m0/out/spend.jsonl` (`m0b-deepseek-a-2026-09-14-1`,
`m0b-deepseek-c-2026-09-14b-1`, `probe-ds-old-a-2026-09-14`, `probe-ds-curl-{1,2}-2026-09-14`); bar files
`poc/m0/out/batch-*-2026-09-14*.json`; `node_modules/bare-agent/src/provider-openai.js:128`;
`poc/m0/runner.mjs` `makeProvider(..., { timeoutMs: 300_000 })`. DeepSeek status page read 22:00 CEST:
"everything is running smoothly". Balance endpoint: $9.26, unchanged through the evening (hamr).

**What happened, in order.**
1. Terminal 1's four c/d batches crashed in 0.2 s each: the shell had no API keys (the `export` lines
   were in another window). $0, no ledger row; the batch reported `crashed` and `$unknown`, correct.
   Cost: the tags `2026-09-14` for c/d are consumed (a bar file with results is never overwritten).
2. Terminal 2 (keys present) ran `deepseek a` run 1: the first model round (messageMatch) returned after
   900.4 s with a body bare-agent could not read (`Cannot read properties of undefined (reading '0')` —
   `data.choices[0]`, the body is not logged). Row 245 `costUsd: null`, `rounds: 0`.
3. That one null row locked every following batch at preflight on both slots (`cap: spend tally has an
   unpriced round`), 0.2 s each, $0 — the F5 rule doing its job.
4. hamr's c retry (`2026-09-14b`) hung the same way, 901.1 s. Row 246.
5. hamr checked the DeepSeek dashboard: no usage, balance not moving. He ruled ceiling pricing per the
   2026-09-08 precedent (`221d918`): 4000 in + 16000 out at peak = $0.0204 a row. Rows 245–246 repriced,
   `rateSource: "ceiling"`, `reconciled` note. Lock lifted.
6. Orchestrator probe from its own shell (pass is readable there; keys never printed): F25's known-good
   draft, plant a → the same 900.7 s hang. Row 247, ceiling. So it is not today's draft.
7. Two direct `curl` calls, 90 s limit: `"Say hi"`, `max_tokens 5`, no tools → HTTP 200 headers, 1 byte of
   body, then nothing for 90 s. Same with one tool declared. Rows 248–249 at ceiling ($0.00001, $0.00008).
   `GET /models` and `GET /user/balance` answered in under a second.

**The fact.** `api.deepseek.com/chat/completions` accepted every request tonight, sent 200 headers, and
never sent a body; the CloudFront edge in front of it closed each at ~900 s (its origin ceiling) with a
non-chat body. This is independent of draft, plant, tool use, and prompt size. It is not on the status
page. The scout and drafter rounds at 21:2x on the same key worked in 16–19 s.

**Why it cost 15 minutes a try and not 5.** `makeProvider` sets bare-agent's BA-18 *idle* timeout to
300 s; that timer resets on any socket byte, and the edge kept the socket alive. bare-agent 0.42.0 also
has a BA-19 *deadline* (`deadlineMs`, total wall) that we leave disabled. Not changed tonight.

**Batch day result: none.** 0 of 200 runs happened. Spend today $0.0764 (drafts $0.0150, hangs at ceiling
$0.0614). The same-day rule means synthetic was not run alone.

**Open, for the next batch day (a new tag, e.g. `2026-09-15`):**
- DONE the same night (`dd96d87`, Sonnet, reviewed): `LIVE_PROVIDER_OPTIONS = { timeoutMs: 300_000,
  deadlineMs: 240_000 }` on the one live call; proven against a local server that sends 200 + one byte
  and never ends (rejects `EDEADLINE`, `retryable: false`, not retried, one null row). The first
  revert-proof test accepted `deadlineMs: 0` — which bare-agent treats as OFF — and was tightened to
  `> 0`; 422 → 429 tests. scout/drafter/redraft still call `makeProvider` with no timeout at all;
- when `choices` is missing, keep the body's first ~300 bytes in the red so a hang and a 4xx-in-200 can
  be told apart — that is an upstream bare-agent ask (`provider-openai.js:128`), not ours;
- the 22 leftover `batch-*`/`m0b-*-2026-09-14*` entries in `poc/m0/out/` are evidence of the aborted day
  and stay; the next day's tag must differ.

**Lesson:** a green status page and a live balance endpoint prove the door is open, not that anyone is
home. Probe the paid path with the smallest possible call before spending a batch on it.

## F28 — Amendment C, batch day 2026-09-15: 200 runs on two providers; 7 of 10 cells meet 19/20; a malformed tool call was our red, not the provider's (2026-09-15)

**Date** 2026-09-15 · **Status** measured; F28 fix landed (`b51c2c6`); M0b exit NOT claimed · **Class** M0b /
Amendment C · **Grounded in** the ten counting bar files `poc/m0/out/batch-{deepseek,synthetic}-{a,b,c,d,e}-2026-09-15*.json`
(tags below), 520 ledger rows 252–771 in `poc/m0/out/spend.jsonl` (515 `match`/`prefix`, 5 `unreported` = the
killed/malformed rounds, 0 `substituted`), the captured body in the orchestrator's scratch `bad-json.log`, and
bareloop's independent F179/F180 (same error, same day, their run `mu2bjmed`). Drafts reused from 2026-09-14
(hamr: "reuse"). c/d accepts: all 80 typed by hamr from his TTY (`answeredBy: "human-tty"`), per the 2026-09-13
ruling. a/b/e run by the orchestrator from its own shell (pass is readable there; no key printed or written).

**Result — pass / 20, bar 19/20:**

| plant | deepseek-flash | Qwen3.8-27B (synthetic) | what the non-passes were |
|---|---|---|---|
| a wrong total | **20** ✅ (15e) | 18 ✗ (15c) | Qwen ×2: red at derive on a *different* slip — the model's days-until-due (8, 0) ≠ −8 |
| b wrong cell | **20** ✅ (15e) | **20** ✅ (15c) | — |
| e omitted total | **20** ✅ (15d) | 18 ✗ (15c) | Qwen: 1 days-until-due slip; 1 `bracket [c1] does not resolve to a citation` |
| c two Northwinds | **20** ✅ (15c) | **19** ✅ (15c) | Qwen: 1 human-rejected (an empty Enter — the batch counts anything but `y` as no) |
| d clean, accept, send | 17 ✗ (15c) | 15 ✗ (15d) | deepseek: 1 `count_overdue … not cited`, 2 days-until-due slips (8, −9). Qwen: 4 `total_owed … not cited`, 1 days slip |

Cost of the ten counting cells $1.34; whole day $1.68 (ledger $0.589 → $2.273, incl. 5 ceiling rows $0.10 and
the aborted cells). Per run: deepseek $0.0010–0.0058, Qwen $0.0022–0.0139. Wall: deepseek 8–25 s, Qwen 18–52 s.
The 2026-09-13 stash guessed ≈$1.20 and ~1 min/run; both within 2×. Against the $12.50/day human cost, a full
job-#1 run (plant d) is $0.006–0.014.

**Three things the day found.**

1. **The "provider-red" was ours.** Three deepseek stops (`Unexpected non-whitespace character after JSON at
   position 476/476/432`, ~2 s) each wrote a `costUsd: null` row and locked every batch on both slots (F5, correct).
   A `JSON.parse` capture on the fourth showed the MODEL's tool-call `arguments` ending `…"matches": ["c2", "c3"]}}`
   — one trailing brace. bare-agent 0.42.0 throws from `provider-openai.js:131` after the HTTP round succeeded and
   `data.usage` was in hand, so the cost was never unknown; we dropped it. hamr said it first ("deepseek can't be
   the blame every run"). Fix `b51c2c6` (Sonnet, reviewed): `MalformedToolCallTolerantOpenAI` overrides `_request`
   to keep the body and `generate` to turn a SyntaxError-with-tool-calls into a metered no-tool-call round;
   `runModelStepOnPrimitives` retries once (existing class) and reds naming the raw arguments the second time.
   Proven against a local server; 429 → 434 tests. After the fix: 60 deepseek runs, 0 stops, 0 second-time reds.
   Upstream ask sent to bareloop's session; they hit the same throw the same day (position 5734) and will
   corroborate in their UPSTREAM-ASKS.md rather than file a second shape. Before the fix, each stop restarted a
   20-run cell at run 1 — deepseek a reached 11/11 and 3/3 before the two stops; those cells stay on disk (tags
   15, 15b, 15c) and do not count.

2. **Plant d misses the bar on both providers, and every miss is a red on a clean input.** Two shapes:
   - *days-until-due arithmetic* (5 of 8 misses across d and a/e): the model wrote 8, 0 or −9 for a −8; the
     derive close caught it every time. The machine did its job; the bar counts it as a false red because the
     input was clean. Rate ≈ 1 in 13 runs on both models.
   - *`declared field … does not appear cited`* (5 misses, 4 on Qwen): the compose close says the reply lacks a
     bracket for the total. In the 15 Qwen and 17 deepseek passes hamr saw, the total was always cited (`5700[c9]`,
     `[tot]`, `[total]`…). **We cannot see the red replies:** a red run keeps only the red string, not the composed
     text, so whether the model omitted the bracket or the close mis-read a label like `[tot]` is undetermined.
     That is the next measurement, not a guess.
   Neither shape is the F25 identifier hole; no wrong figure reached an accept. Amendment C's 19/20 as written
   counts a correct red on a clean run against the machine. Whether it should is hamr's to rule.

3. **Amendment C's tag discipline held, at a price.** A bar file with any result is never overwritten, so every
   stop (keys missing in a window, the cap lock, a kill) consumed a tag: 30 bar files exist for 10 cells. All stay.

**Also measured:** the deadline fix (`dd96d87`) was never exercised — no hang today. Qwen's `tool_calls` came back
`null`-shaped once (`[c1] does not resolve`); not investigated.

**Not the exit.** Amendment C says 19/20 per scenario per provider. 7 of 10 cells meet it; a, e on Qwen and d on
both do not. Every miss ended in a red and nothing wrong was sent. M0b's sign-off is hamr's.

**Lesson:** when the same red repeats at the same byte position, it is a shape, not weather. Capture the body
before blaming the wire. And a check that cannot show what it refused cannot be told from a bug.

**Addendum, plant d rerun with `log.json` (`958ee66`), same day.** deepseek d (tag 15d) **19/20**, Qwen d (tag
15e) 17/20; $0.44; 40 more human accepts. Every red now carries the reply it refused, so the open question above
is answered: **the compose close was right every time; the model left things out.**

| run | red | what the saved reply shows |
|---|---|---|
| Qwen 15e-17 | `total_owed (5700, c9) … not cited` | the reply has no total at all — two invoice lines, nothing else |
| Qwen 15e-13 | `count_overdue (1, c10) … not cited` | the reply never says how many are overdue |
| Qwen 15e-4 | `bracket [c1] does not resolve` | the model named its citations `inv_1021`, `amt_1021`… then wrote `[c1]`, `[c3]` — brackets to ids it never declared |
| deepseek 15d-1 | `preflight: run dir … already holds ask.json` | not a model red: two batches were started ~60 s apart in the same window (11:15:29 and 11:16:32); the second's child refused the first's run dir at $0 while the first's ask was the one hamr answered. Nothing was sent (`…15d-1-sent.txt` does not exist). Operator double-start; the fresh-run-dir refusal (F25 fix) worked as designed |

So the two shapes stand corrected: (1) the model mis-computes days-until-due ~1 in 13 runs and the derive close
catches it; (2) Qwen omits a declared figure or mis-labels a bracket ~1 in 7 clean composes and the compose close
catches it — the same behaviour plant e is planted to provoke, arriving unplanted. deepseek did neither in this
rerun. **In 240 plant-d runs today nothing incomplete or wrong reached a send.** Amendment C's bar, read literally,
counts each of those correct refusals against the cell; hamr's ruling on that reading is what separates
"7 of 10" from "9 of 10" (Qwen a and e stay short either way on the literal reading; on the "correct red counts"
reading they too are 20/20).

**Nit, not fixed:** a second batch started into a tag whose bar file has no results yet silently coexists with the
first; the bar file should refuse when a run dir for run 1 already exists. Sonnet, small.

**Ruling, 2026-09-15 (hamr, recorded in `docs/wiki/the-module-ladder.md` RULING 3):** M0b's sign-off
logic is *if the LLM fails, the mechanical harness catches it*. A correct red on a clean input is a
catch, not a miss. Recount under that reading: all ten cells 20/20 — every non-pass above was the close
refusing a model slip (days-until-due arithmetic, an omitted figure, a dangling bracket), a preflight
refusal of an operator double-start, or the batch honouring an empty Enter as a rejection. Nothing got
through unrefused; nothing correct was refused.

## F29 — Job #2 built: docx reader, declared-shape close, the Amendment A redo edge; a stale answer replayed one rejection as four (2026-09-15)

**Date** 2026-09-15 · **Status** built and probed live; counting run with hamr pending · **Class** M0b /
Amendment B (job #2) and Amendment A (redo edge) · **Grounded in** branch `job2` commits `6b19b61`
(docx), `a421f5b` (shape + redo), `c4f272e` (fold), `5168f3c` (drafter path), `f423f47` (hamr's
headings), `3ffcd69` (hamr's prose + first real draft), `2fd9043` (stale-answer fix); live probe
`poc/m0/out/job2-probe-2/` and draft `poc/m0/fixture-declaration-job2-deepseek-1789485223087.json`;
ledger rows for both (deepseek-flash, `modelReturned` matches).

**What was built.** Four standalone modules, each proven red before green, then one fold:
`docx.mjs` (stdlib zip + regex; the real resume yields 52 paragraphs / 891 of 904 tag-stripped
words; sha256 pinned in the test), `shape.mjs` (`closeWordsAndSections`: 600 green / 601 red naming
the count; headings must appear in order, mid-sentence mentions don't count), `redo.mjs`
(`askWithRedo`: cap typed 1..3 and >3 refused, reason-less rerun refused and re-asked without a redo,
every attempt in `audit.jsonl` with a parent, the 4th rejection halts naming the step — reading
chosen: attempts 1..4 may run), and `job2.mjs` (own fold, hard-wired to job #2's shape as job #1's
was; generalising the runner is M2). The drafter path (`scoutJob2` $0 facts with body text withheld,
`draftJob2` on the same paid round, unchanged `validate()`) is what makes job #2 Claim-2 evidence:
hamr's prose named no primitive and DeepSeek picked `readDocx / read / compress / checkpoint / write`
for lines 1–5, `guardrailClasses {3: softgreen, 4: hitl}`, refused none, $0.0035. The fold binds by
`fromLine` (0 or 2+ steps on a line refuses, never picks) and checks grants
(`readResume→readDocx`, `readJd→read`, `send→write`; extras allowed as in job #1).

**hamr's words won over the ladder's paraphrase.** His cold description names the sections
"summary of work history blurb, professional skills, soft skills"; Amendment B had written "story of
experience / technical skills / soft skills". `JOB2_SHAPE` now carries his three headings, and the
compose prompt reads the constant (one writer). His raw text is kept verbatim in
`poc/m0/job2.prose.raw.txt`; the numbered split he signed is `poc/m0/job2.prose.txt`. "200ish each"
is guidance the model receives, not a check — a per-section limit would be a new signed check.

**The live probe** (example prose, real inputs, 20 s ask timeout): both inputs frozen with the
ladder's hashes, resume and JD read, 321 words with all three headings → shape green, `ask.json`
written with the artifact path, ask expired → correct red, nothing sent, $0.0035.

**The catch — a stale answer is a repeated human decision.** Review of the real ask step before
the counting run: it polled `<runDir>/answer.json`, and nothing removed that file after it was read.
Under `askWithRedo` the ask is called again for attempt 2 (after a rerun) or for the same attempt
(after a reason-less rerun is refused), so the old file answered instantly. Reproduced through the
real ask step with one human `rerun`: `redo cap 3 reached at step compose after 4 rejections` — one
rejection became four and halted with no human in the loop; the reason-less case would have looped
on refusals. Fix `2fd9043`: an answer is consumed exactly once (`renameSync` to
`answer.attempt<n>.<seq>.consumed.json` the moment it is read), and an answer whose `answeredAt`
predates the ask's `askedAt` is quarantined and logged as `stale-answer-ignored` in `audit.jsonl`.
Proven red by removing the rename (`expected exactly one consumed file per answer, got 0 !== 2`);
the timeout scenario stayed green without the rename because the timestamp check overlaps it — two
defences, reported as such rather than reshaped to force a red. `checkFreshRunDir` (F-era
stale-answer hazard at run *start*) was the same shape one level up; this is the mid-run half.

**Open, hamr's to sign.** §10 in `docs/wiki/playbook-and-open-questions.md`: where sources live in
the signed text (today the destination is in the arbiter block, sources are launch flags).

## F30 — Job #2 counting run with hamr: rejected once, redrafted, accepted; a second answer sent mid-redraft was quarantined live, not replayed (2026-09-15)

**Date** 2026-09-15 · **Status** live n=1 with a human in the loop, green · **Class** M0b /
Amendment A (redo edge) and Amendment B (job #2) · **Grounded in** branch `job2` at `a1805fb`;
run `poc/m0/out/job2-hamr-3/` (`ask.json`, `audit.jsonl`, `answer.attempt1.1.consumed.json`,
`answer.stale.attempt2.2.1789495719937.json`, `answer.attempt2.2.consumed.json`, `result.json`,
`log.json`); sent artifact `poc/m0/out/job2-hamr-3-summary.md`; two ledger rows in
`poc/m0/out/spend.jsonl` (`deepseek-flash`, `modelMatch: match`, `stopReason: end_turn`);
hamr's terminal transcript, kept outside the tree.

**The run.** Launched detached with the signed prose, the first real DeepSeek draft
(`fixture-declaration-job2-deepseek-1789485223087.json`), hamr's resume and the JD, 30 min ask
timeout. Both inputs frozen and pinned (resume `3d6b24a8…`, 463 552 bytes; JD `7eaea1c0…`,
1 885 bytes). Attempt 1: 471 words, three headings in order, shape green, `ask.json` written
at 18:00:51Z with the artifact path.

**What hamr did, from his transcript.** He pasted two of my lines as one: `cat` of attempt 1
and `answer.mjs … rerun "your reason"`. Both ran, so the first rejection carried the literal
placeholder as its reason (18:08:24Z). Ten seconds later he sent the real reason, `rerun "too
long, cut the enterprise paragraph in half"` (18:08:34Z), while the run was already redrafting.
Then `cat` of attempt 2 and `accept`, again as one paste (18:08:42Z, three seconds after the
attempt-2 ask).

**What the harness did.**
- Rejection 1 consumed exactly once: renamed to `answer.attempt1.1.consumed.json`, audit row
  `{attempt 1, parent null, decision rerun, reason "your reason", $0.0047}`. Attempt 2 was
  drafted with the parent's reason (`parent: 1`).
- The second `rerun` was sitting in `answer.json` when attempt 2's ask opened at 18:08:39.935Z.
  Its `answeredAt` (18:08:34.757Z) predated `askedAt`; it was renamed to
  `answer.stale.attempt2.2.…json` and logged as `stale-answer-ignored`, never acted on. This is
  F29's fix `2fd9043` firing on a real human keystroke, not on the reproduction. Without it the
  real reason would have rejected attempt 2 unread and spent a third draft.
- Accept consumed once, attempt 2 (538 words, shape green) copied verbatim to the sent path
  (`diff -q` identical). `result.json`: `outcome green, attempts 2, costUsd 0.0102,
  costUnknown false, bound declaration`. Two paid rounds, both metered, both on the requested
  model.

**What this proves.** The Amendment A redo edge end to end with a human: reject → redraft with the
parent's reason → accept → send, every attempt in the audit with a parent and a price. And the
mid-run stale-answer defence in the wild: a human who answers twice gets the second answer
quarantined, not replayed. n=1; Amendment C's 20-run bar does not apply to a human-in-the-loop
step and no such bar is signed for it.

**What it does not prove.** Attempt 2 is not the draft hamr asked for: the model saw "your
reason", not "cut the enterprise paragraph in half", and came back longer (538 vs 471). The
harness was right and the output is still not his. Cause is my instruction shape — two commands
on adjacent lines invite a single paste — not the ask step. Also: the accept landed three
seconds after the ask, so attempt 2 was accepted unread; fine for a mechanism test, not a
quality signal.

**Open.** (a) `answer.mjs` could refuse a reason that is a known placeholder or under N
words — a new signed check, not added. (b) The stale quarantine is silent to the human: nothing
tells the person their second answer was dropped. Cost of leaving it: a human who meant the
second answer thinks it counted. Report only; the ask's UX surface is unsigned.

**Addendum 2026-09-16 — three trust spots made checks, signed by hamr.** After `/branch-review`
(ready, four ledger items) and `/refactor` (one test added, three left as behaviour changes), hamr
signed: (1) docx uncompressed cap **20 MB**, two layers — declared size refused by name before any
data is touched, and `inflateRawSync` bounded by `maxOutputLength` so a lying header is refused
too; (2) the send target must resolve inside the repo, a `..` that escapes is a red naming the
target; (3) resume and JD are fenced in the compose prompt as INPUT DATA with a one-line
not-an-instruction rule. Ruled **no detector** for "out of norm" input: that would be regex on
prose or an LLM judge, both outside v1 — the human accept is the detector. Each proven red first;
518/518 after. Ledger empty.

## F31 — M1 POC: ask slots kill the F10 wobble, 20/20; the first bar miss was the orchestrator's check, not the model; a default ceiling price always exists (2026-09-21)

**Date** 2026-09-21 · **Status** POC bar met on the baseline provider; M1's build not started ·
**Class** M1 (signed by hamr 2026-09-21 with §6 and §10) · **Grounded in** branch `m1` commits
`be73dad` (slots, drafter option, counting script), `a3cf07f` (key preflight), `e1cca8d` (ceiling
pricing), `92313d7` (check (c) corrected, `--rescore`); result files
`poc/m1/out/slot-batch-{legacy,slot}-2026-09-21c.jsonl`, their `.rescore-2026-09-21.jsonl`, and
`poc/m1/out/slot-batch-slot-2026-09-21d.jsonl`, each with its saved drafts; 61 ledger rows
(`deepseek-flash`, `modelMatch: match` on all 60 paid drafts).

**The mechanism under test.** F10's wobble had a cause a grep could find: `checkpoint` ("pause
for a human") was a primitive in the drafter's menu, so the drafter could grant a pause on any
step, while the runner already inserts the ask mechanically at the signed `ask at line N` with no
grant check. Under the slot grammar (`runDrafter({ slotGrammar, askLines })`) the verb is absent
from the menu and the prompt names the signed slots; `checkAskSlots` then proves, per draft:
(a) exactly one step on each signed ask line, class `hitl`; (b) no step grants `checkpoint`;
(c) no step that is a pause — zero primitives AND `hitl` — sits on an unsigned line.

**Control first — the wobble reproduced on today's model.** 20 drafts of job #1's prose, old
grammar, `deepseek-flash`: the M0 validator passed 20/20; the slot check passed 0/20. 12 drafts
granted two pauses (line 2 and line 5), 8 granted one (line 5). Same prose, same model, a
different number of human stops — and nothing in M0 saw it. $0.047.

**Slot grammar, first batch (tag c): 17/20 on the literal bar, and the miss was mine.** Pause
grants 0/20, exactly one `hitl` step at line 5 in 20/20, 6 steps in 20/20 — the wobble was gone.
The three reds were check (c) as first specified ("zero primitives = a pause"): each was the
line-3 derive step, class `green`, primitives `[]`. That is not a pause — `JOB1_NEEDS` has said
since M0 that "match a customer, derive figures" is fwdloop's own model round (`own: true`), and
a green close is closed by the machine. The correction (a pause is zero primitives AND `hitl`) was
made red-first and the 40 saved drafts re-scored at $0 into new files: slot 20/20, legacy 0/20.
A fourth draft (16) was refused by the M0 validator, by name — its send step did not read the ask
step's artifact — a catch under hamr's 2026-09-15 ruling.

**A re-score is weaker than a run, so it was run again.** The correction also changed one
sentence of the slot prompt, so the saved drafts were not drafted under the final wording. Fresh
batch, final code, tag d: **slot 20/20, validator 20/20**, pause grants 0/20, 6 steps in 20/20,
$0.068. This is the number the M1 exit's POC line rests on; the 17/20 stands in the record as what
the first check measured. Bar set before the run; the check that was changed was the
orchestrator's invention in the brief, not the signed text (signed scope item 3 names only the
slot rule).

**Two launch failures, both ours, both now mechanisms.**
1. The `pass` entry for the DeepSeek key has two lines; the launcher exported both and Node
   refused the header in 6 ms. `checkKeyPreflight` now refuses an unset, empty or
   whitespace-carrying key at $0, naming the variable and never the value, before any ledger write.
2. The script recorded that never-sent round as `costUsd: null`, and one null row locked all
   spend (and failed two job #2 tests that read the live ledger). hamr's ruling, 2026-09-21: **a
   default price always exists and a human can override it; nothing starts at $0 or unknown.**
   `ceilingCostUsd` (one writer, `spend.mjs`) prices any row with no cost at read time — known model
   at its own peak rate, unknown model at the table's highest — marked estimated, counted against
   the cap. The cap lock survives as money (a test proves enough null rows still refuse). The
   override is the hand-entered rate table. The audit row was not edited: the orchestrator's attempt
   to edit it was refused by the permission classifier as audit tampering, correctly, and the
   mechanism made the edit unnecessary. A `$0 for client-side throws` branch written the same hour
   was removed under the same ruling.

**Not yet measured.** The second provider (Qwen) under the slot grammar; job #2's prose under it
(one ask at line 4); a prose with two signed asks; a prose whose ambiguity guardrail is on a line
with no other work. M1's exit also needs the mutation suite, the arbiter-field refusal at every
depth, one grammar for both jobs, and the hash — none started.

**Spend.** $0.18 for 60 paid drafts; ledger total $2.94 of the $5.00 M0 cap, of which $0.065 is
estimated (F27's hangs and today's one repriced row). **M1 has no signed cap of its own** — the
POC ran under M0's. hamr's to sign.

## F32 — M1 slot grammar on the second provider: Qwen 19/20 green, 1 refused by name; the refused draft shows the pause check cannot tell "our own model round, closed by a human" from "an ask" (2026-09-21)

**Run.** `poc/m1/slot-batch.mjs --grammar slot --n 20 --tag 2026-09-21e --slot synthetic`, job #1's
prose, detached, after a $0.0001-scale probe (http 200, 1.7 s, served `Qwen/Qwen3.8-27B`).
20 of 20 called the tool, 20 of 20 stop `tool-called`, no timeouts, no null-cost rows, `modelMatch`
`prefix` on all 20 (requested `hf:Qwen/Qwen3.8-27B`, served `Qwen/Qwen3.8-27B`). Cost $0.2382.

**Literal result.** Validator 20/20 green. Slot check 19/20 green, 1 red, by name:
`slot: step 3 (line 2) is a pause (no primitives, hitl) at an unsigned line` (draft 16, the only
7-step draft; the other 19 have 6 steps). Not re-scored. The signed bar reads "every draft binds
exactly the signed asks … or is refused by name": 19 bound, 1 refused by name, 0 slipped through.

**What draft 16 actually did.** It split line 2 in two: step 2 `["read"]` reads the chat message,
step 3 `[]` "work out which customer the chat message is about". Line 2's guardrail ("if more than
one customer matches, ask me, do not pick") derives `hitl`, so step 3 is zero primitives AND hitl —
the check's definition of a pause. But step 3 is the same kind of step as line 3's derive
(fwdloop's own model round, `own: true`, no catalogue primitive), which F31 ruled is not a pause
when it closes green. Here it closes hitl only because its line's guardrail does. The check has no
field that separates "own round whose output a human verifies" from "stop and ask a human". In the
19 green drafts the model folded the matching into the `read` step, so the question never arose.
DeepSeek never produced this split in 40 slot-grammar drafts.

**Not decided here.** Whether that split is a legitimate draft the check wrongly refuses, or an
extra human stop the check rightly refuses. It is hamr's: the first needs a typed field for an ask
step (a grammar change), the second needs nothing. Nothing was changed to turn the red green.

**Carried.** The batch tool still charges `poc/m0/out/spend.jsonl` (M0's ledger) though M1's own
$5.00 cap was signed on 2026-09-21; ledger reads $3.18 after this run, $0.065 estimated. The audit
file was not edited. Still not measured: job #2's prose and a two-ask prose under the slot grammar
— the batch tool hard-codes job #1's prose path.

**F32 ruling — hamr, 2026-09-21 ("1"): it is a catch, leave it.** Asked whether draft 16 was a catch
or a wrong refusal, with the grammar change (a typed marker for an ask step) as the alternative.
The red stands, the check is unchanged, no field is added. Same footing as the M0b ruling that a
correct red on a clean input is a catch: the signed bar is "binds the signed asks, or is refused by
name", and the draft was refused by name. Known cost, accepted: Qwen earns a redraft about 1 time in
20 on job #1's prose when it splits a hitl line into a read step and an own-round step. The check
still cannot tell an own round closed by a human from an ask; that is recorded, not fixed.

## F33 — M1 slot grammar, the last two unmeasured proses on deepseek-flash: two signed asks 20/20; job #2 19/19 of the drafts that called the tool; the old M0 validator cannot score a two-ask prose (2026-09-21)

**Runs.** Tag `2026-09-21f`, detached, sequential, after a tiny probe (http 200, 1.2 s, served
`deepseek-flash`). First runs on M1's own ledger `poc/m1/out/spend.jsonl` (cap $5.00): 40 rows,
$0.1626, nothing estimated, nothing repriced, `modelMatch` `match` on all 40.

**Two signed asks** (`--job twoask`: job #1's prose plus `ask at line 2`, so asks at 2 and 5).
Slot check **20/20 green**: every draft bound exactly one hitl step to line 2 and one to line 5,
0 checkpoint grants in 20, no pause at an unsigned line. 10 drafts had 6 steps, 10 had 7. $0.1146.
The M0 validator column reads **0/20 green**, all 20 the same red: "the send step (fromLine 6) does
not read …, the artifact emitted by the ask step (fromLine 2)". That is the M0 validator's limit,
not 20 model faults: `parseArbiterSlots` keeps only the LAST `ask at` line it reads (one ask per
flow was M0b's world), so it demands the send read line 2's answer. `src/declaration.js` (piece 3)
already carries the many-ask rule (the send reads at least one earlier signed ask). These 20 drafts
were NOT re-scored under it: they are M0-shaped declarations (`skills`, `guardrails`, `columns`)
and the M1 schema refuses those keys by name; writing a converter to score them would be fitting.
So the two-ask send lock is proven by piece 3's $0 tests only, not on a live draft. Stated, not
hidden.

**Job #2's prose** (`--job job2`, one signed ask at line 4, real resume + JD as shape facts only).
19 of 20 called the tool; of those, slot check **19/19 green**, 5 steps each, 0 checkpoint grants.
Validator 17 green, 2 red — drafts 8 and 15, both real send-lock catches by name ("the send step
(fromLine 5) does not read …, the artifact emitted by the ask step (fromLine 4)"): the model wrote
a send that did not read the human's accept, and the mechanism refused it. Catches, per the M0b
ruling. Draft 1 made **no tool call** (stop `no-tool-call`, $0.0027 — priced, and too cheap to be a
16000-token truncation, but that is an inference). $0.0481.

**Tool gap found.** For the no-tool-call draft the batch saved `null` as `draft-1.json`; what the
model wrote instead was not kept. The standing rule is that a red keeps the model's output, because
without it a right check and a broken one look the same afterwards. Not fixed here; reported.

**Where the POC claim stands.** Slot grammar, asks bound or refused by name, nothing slipped:
deepseek job #1 20/20 (F31), Qwen job #1 19 bound + 1 refused (F32, ruled a catch), deepseek two
asks 20/20, deepseek job #2 19/19 with 1 no-tool-call. Not measured: Qwen on job #2 and on two
asks; a prose whose ambiguity guardrail sits on a line with no other work.

## F34 — M1 slot grammar on Qwen, two asks and job #2: nothing slipped, but the two-ask fixture put an ask on a line that carries work, and the grammar has no honest answer for that (2026-09-21)

**Runs.** Tag `2026-09-21g`, `--slot synthetic`, detached, sequential, after a tiny probe (http 200,
1.6 s, served `Qwen/Qwen3.8-27B`). 40 rows on M1's ledger, `modelMatch` `prefix` on 39, `unreported`
on the 1 provider red. No null-cost rows. Ledger after: $0.8458 of $5.00, $0.0368 estimated.

**Two signed asks** (asks at lines 2 and 5). Slot check 15 green, 4 refused by name, 1 draft with no
declaration (draft 10: stop `unknown`, 180.8 s, $0.0321). 0 checkpoint grants. $0.4302. The M0
validator column is red on all 19 scored drafts for the F33 reason (it knows one ask per flow); not
a model result.
- Drafts 4, 6, 16: `ask at line 2 has 2 steps bound to it — exactly 1 required`. Each bound
  `["read"]` "read the chat message" AND the zero-primitive ask to line 2.
- Draft 12: a zero-primitive hitl "work out which customer" step with `fromLine: null` — F32's case.

**The fixture is the cause of the first three, and it is the orchestrator's.** `twoask.prose.txt`
signs an ask on line 2, which also carries work ("read the chat message and work out which customer
it is about"). Strict 1-for-1 says the read step serves line 2; the slot rule says line 2 takes
exactly one step. Both cannot hold. Qwen bound the read to line 2 (truthful, refused). DeepSeek, all
20 drafts in F33, gave the read step `fromLine: null` — it passes, and the read step no longer says
which human line it serves. So F33's 20/20 on this prose was reached by dropping traceability, not
by the grammar being right; F33's number stands as measured, its reading is corrected here. In jobs
#1 and #2 as hamr wrote them, every signed ask sits on a line of its own ("check it with me"), which
is why this never showed before. Not decided: an ask must be its own line (the parser refuses an
ask on a line with work), or an ask line may carry work (exactly one pause step, others allowed).
hamr's.

**Job #2's prose** (one ask at line 4). 19 of 20 returned a declaration. Slot check 17 green, 2
refused by name (drafts 7 and 14: `step 3 (line 2) is a pause (no primitives, hitl) at an unsigned
line` — a zero-primitive own-round step on a blank-guardrail line, F32's case again, ruled a catch).
Validator 18 green, 1 red by name (draft 9: the ask step has no `emits`). $0.2530.

**A deadline that did not hold.** Draft 8 of job #2: stop `provider-red`, no declaration, **691.4 s**
wall. The standing rule is a 240 s hard total deadline on every provider call (F27). It was priced at
ceiling ($0.0368, the ledger's whole estimated portion), so money is safe, but the bound is not
enforced on this path — `draftJob2` was wired into the batch tool today (355a6a2) and the race
against `DEFAULT_DEADLINE_MS` may cover only `runDrafter`. Not root-caused, not fixed; reported.

**Tool gap, second sighting.** Both no-declaration drafts (two-ask 10, job #2 8) saved `null`; what
the model or the provider returned was not kept (F33 saw the same).

**Where the claim stands, all proses, both providers.** Drafts that slipped an unsigned human stop or
missed a signed one past the checks: 0 of 160. Bound cleanly: deepseek 20/20, 20/20, 19/19; Qwen
19/20, 15/20, 17/19.

**F34 RETRACTION, same day — "a deadline that did not hold" is wrong.** Checked instead of guessed:
the batch tool's race covers both draft paths (`Promise.race` against `timeoutAfter(240 s)` wraps
`draftJob2` and `runDrafter` alike), and the provider is built with `deadlineMs: 240_000`. Draft 8's
error was `read ECONNRESET`. The machine suspended at 18:07:58 and resumed at 18:18:36 (journalctl);
draft 7 was written 18:07:10 and draft 8 at 18:18:41. Timers do not run during a suspend and the
wall clock jumps, so 691 s is 48 s of run, a 638 s sleep, and a reset socket 5 s after resume. The
240 s bound was never exceeded in running time. What stands: the row was priced at ceiling, and a
laptop that sleeps mid-batch costs one ceiling-priced round. What the orchestrator did wrong: wrote
"the bound is not enforced on this path" into a finding before reading the error message on the row.

## F35 — The debrief was right twice: the batch checker never had the stop-only rule, and the ask mark had never been in front of a paid model; both fixed, re-measured 40/40 on deepseek-flash (2026-09-22)

**What the debrief found.** (1) Amendment 3 item 4 (the step on a signed ask line grants no
primitive) was built in `src/declaration.js` (4deca9c) only. The batch tool scores with
`poc/m1/slots.mjs`, which never got it: a stop step granting `["write"]` scored green there. Every
slot number in F31 to F34 came from that checker. (2) The `ask:` mark had never reached a paid
drafter: the three batch proses still carried `guardrail: ask at line N`, the poc parsers read only
that form, and the "no re-measure needed" note under amendment 3 in the ladder rested on
`parseSignedText`, which the batches never call. The two-ask fixture also still signed a stop on a
line that carries work, which amendment 3 forbids.

**Fixed (27647e6).** `checkAskSlots` gained check (a2): a signed ask line's one step with any
primitive reds naming the line, the step and the verbs (red-first: `'green' !== 'red'` on a
`["write"]` stop before the fix). `parseAskSlots` reads the mark on the numbered line and refuses
`ask at line N` by name. M0's `parseArbiterSlots` learned the mark (last mark by line number is the
one ask M0 knows; its legacy form stays for M0's own fixtures; both at once is an error). The three
batch proses now carry the mark; the two-ask fixture is 7 lines with stops on lines 3 and 6 and the
send at 7. The drafter's slot sentence names the mark. A live batch saves the prose it ran against
in its tag directory and `--rescore` prefers it. 1009 tests, typecheck clean.

**$0 rescore of the old evidence under the new checker.** job #1 tags 21c/21d/21e and job #2 tags
21f/21g: 0 stop-only hits; slot greens unchanged (20, 20, 19, 19, 17). Two-ask tags 21f/21g cannot
be rescored honestly against today's fixture (their ask lines were 2 and 5, now 3 and 6, and they
predate the saved prose); the debrief worker's rescore under the old lines found exactly one hit,
Qwen 21g draft 14 (line 2 bound `["read"]`), so F34's two-ask count is 14 bound, not 15. F31 to F33
stand.

**Paid re-measure, tag `2026-09-22a`, `--slot deepseek`, detached, after a warm `pass`.** 40 rows,
`modelMatch` match on all 40, $0.1499, no unknown cost. Ledger $0.9957 of $5.00.
- Job #1 with the mark visible on line 5: slot 20/20, validator 20/20, no-tool-call 0. $0.0671.
- Two asks on their own lines (3 and 6): slot 20/20, validator 20/20. $0.0828. All 20 drafts bind
  the read to line 2 with `fromLine: 2`; lines 3 and 6 carry a zero-primitive hitl step each; no
  `fromLine: null`. The dodge F34 named on the old fixture does not appear once the ask is its own
  line. The M0 validator is green here for the first time on a two-ask prose because it now takes
  the last mark as its one ask, and the send at line 7 reads it.

**What this corrects.** The ladder's "no re-measure" note (2e4d4b9) is withdrawn: the poc drafter
shows the model the line text as written, so the mark IS in the prompt, and that is a new prompt.
It now has its own 40 drafts. The claim stands with a measurement behind it, not an argument.

**Left, named.** `poc/m0/steps.txt` still uses the legacy form (the M0 runner's default fixture,
accepted by the M0 parser; unused by any batch). The two-ask tags 21f/21g stay scored as F33/F34
recorded them, with the one-draft correction above.

## F36 — Three v0.4.0 `change` ledger items ruled by hamr and closed: symlink containment, a signed `close.shape` vocabulary, `readFlow` checks `runs/` (2026-09-23)

**Ruling (hamr, 2026-09-23).** Gap 1 A: real-path containment. Gap 2 A: sign the four shape keys
in use as the v1 vocabulary. Gap 3 A: `readFlow` checks that `runs/` exists, is a directory, and is
not a symlink; it does not read inside (M2). All three shipped on branch `v0.4.1`, red-first, each
revert-proven by stashing the source file alone.

**Gap 1 — `poc/m0/runner.mjs` `checkSendDestination`.** The containment check was `resolve()` plus a
string-prefix compare, which is lexical: a symlink inside the repo pointing outside it passed. Red
before the fix, on a repo-internal symlink to a tmp dir: `Expected values to be strictly equal:
true !== false`. Fix: after the lexical check, `realpathSync` both the target and the repo root and
apply the same compare; escape reds `is a symlink that resolves outside the repo (<real path>)`. A
missing dir still falls to the existing not-writable red. An internal symlink to an internal dir
still passes (positive test added).

**Gap 2 — `src/declaration.js` `close.shape`.** The shape map accepted any key except arbiter words,
so a typo (`maxWord`) checked nothing and the exit's "unknown key added" mutation did not cover that
position. Signed v1 vocabulary, exported as `SHAPE_KEYS`: `maxWords` (positive integer), `sections`
(array of non-empty strings), `linesPerInvoice` (positive integer), `mustCarry` (array of non-empty
strings). Unknown key reds `unknown shape key "<key>" at <path>`; wrong type reds `shape key "<key>"
at <path> must be <expected>`; arbiter keys keep their own red at any depth. Red before the fix was
the missing export itself. Fallout, named: the M1 fixtures had grown their own keys —
`test/fixtures/job1.m1.declaration.json` used `oneLinePerInvoice`/`lineFields` (now
`linesPerInvoice: 1`/`mustCarry`), `job2.m1.declaration.json` used `sectionCount` (derivable from
`sections`) and `wordBudget {total, perSection}` (now `maxWords: 600`; a per-section budget is not
in the signed vocabulary and was dropped, not invented). The `linePerInvoice` typo in two M0 test
fixtures became `linesPerInvoice: 1`; M0's own validator never inspected shape keys, so nothing
there changed behaviour. `poc/m0/fixture-declaration-*.json` and `test/fixtures/job2.declaration.json`
keep the old keys on purpose: one is a paid-run snapshot, the other is hashed as opaque bytes by the
signature tests and never validated.

**Gap 3 — `src/flow.js` `readFlow`.** The writer created an empty `runs/`; the reader never looked.
Red before the fix, with `runs/` deleted, symlinked, or a plain file: `true !== false` on all three.
Fix: `lstatSync` on `runs/` after the three file reads, pushing onto the same reds so they combine:
missing, `is a symlink, refused`, `is not a directory`. Roundtrip test unchanged.

**Numbers.** 1009 → 1022 tests (+13), typecheck clean. The ladder's "Not ruled, carried" paragraph
under M1 is replaced by the ruling. The v0.4.0 ledger's three `change` bullets are closed.

## F37 — The signed shape vocabulary was real code against an untold model: 2 of 60 old paid drafts fit it; once the prompt names the four keys, 40 of 40 do (2026-09-23)

**What the debrief caught.** F36 made `close.shape` a closed vocabulary but nothing told the
drafter. The prompt the model actually sees (`poc/m1/fixtures/default-prompt-golden.txt`, byte-
checked against `poc/m0/drafter.mjs`) said when to emit a shape, never which keys exist. A prior
paid draft showed DeepSeek inventing `oneLinePerInvoice`/`lineFields` unprompted. So the next paid
run would red where it used to pass. The vocabulary was grepped from fixtures, never measured — the
POC the ruling should have had.

**$0 baseline, old drafts rescored with the new `checkShapes` column.** Sixty paid drafts made
under the old prompt: job #1 tag 22a shapeGreen 0/20; job #2 tags 21f 0/20, 21g 2/20. Across the
sixty, 60 distinct invented shape keys — `wordsPerSection` (12), `maxTotalWords` (10),
`sectionCount` (10), `oneLinePerInvoice` (8), `unit` (6), `sectionNames` (5) … and 39 seen once.
Two drafts in sixty landed on the signed words by luck.

**Fix.** `poc/m0/drafter.mjs` builds one sentence from `SHAPE_KEYS` itself (a test asserts every
key appears in the prompt text, so prompt and validator cannot drift) and the tool-schema `shape`
description lists the same keys. Golden regenerated. Two debrief "Later" items fixed alongside:
`sections: []`/`mustCarry: []` red (a shape that checks nothing is not a declared shape);
`readFlow` reds an unreadable `runs/` (`R_OK|X_OK`).

**Paid measure, tag `2026-09-23a`, deepseek-flash, detached after a warm `pass` and a 1 s probe.**
- job #1: n=20, shapeGreen 20/20 (shapedDrafts 20), slot 20/20, validator 19/20. $0.0578.
- job #2: n=20, shapeGreen 20/20 (shapedDrafts 20), slot 20/20, validator 18/20. $0.0501.
- 40 rows, `modelMatch` match on all 40, $0.1079, no unknown cost. Ledger $1.1037 of $5.00.
- The three validator reds are chain reds the earlier tags also showed, none shape: job #1 draft 2
  and job #2 draft 12 have a send step that does not read the ask step's artifact; job #2 draft 4
  drops job line 1 without a refusal. They count as catches (F-ruling of 2026-09-15).

**Ruling this leaves standing.** The four keys are enough for both jobs as drafted today. A fifth
word is a red by name, then hamr's signature — never a widening of the check.

## F38 — M2 gap-back POC, batch a: 6 of 20 healed against a bar of 18. The channel works; the closer's gap was too thin to steer it (2026-09-24)

**Setup (signed M2 POC).** Job #2's compose step; the executor sees the goal (job #2's line 3 verbatim
plus the plant "and a fourth section: certifications."), the resume and JD as data, and, from
attempt 2 on, ONLY the previous close's red string. Close: `closeWordsAndSections` with the real
shape (`maxWords 600`, the three signed headings). `STRIKE_LIMIT 2`, attempt fallback 4. Tag
`2026-09-24a`, `deepseek-flash`, 20 runs, 69 attempts, $0.3249, `modelMatch` match on all 69,
`spendComplete: true`. `poc/m2/gapback.mjs` at `71c0795`.

**Result.** `greenAt1 0, healed 6, greenByAttempt3 6, struckOut 0, fallback 14`. **6/20 against
18/20 — the bar is missed.** Every run redded on attempt 1 (the plant works). Six healed on attempt 2
or 3. Fourteen ran to the attempt fallback.

**What the 14 did — read from the saved texts, not guessed.** The gaps ping-pong:
`689 words, limit 600` → `missing section heading "summary of work history"` → `661 words, limit
600` → `missing …`. Two causes, both in the close's red string:

1. **First-red-wins hides the second failing check.** `closeWordsAndSections` returns on the word
   count before it looks at headings. A text that is both over 600 words and missing a heading is
   told only about the words; the model shortens, is then told only about the heading, expands to
   add it, and is over the words again. The step never hears both complaints at once, so it cannot
   fix both. The signed M2 text (item 3) says the gap is "at most one sentence **per failed
   check**" — plural. The POC's closer did not do that.
2. **The heading gap does not say what a heading is.** The model writes `**2. Work history in
   brief**` or `## Professional Skills & Soft Skills` — bold, numbered, paraphrased, or two
   headings merged on one line. The closer wants a line that IS the heading text (optional leading
   `#`). The gap said `missing section heading "summary of work history"`, which names the text but
   not the form, so the next attempt paraphrases again. Attempts that did put `## Summary of Work
   History` on its own line passed that check (runs 2, 6, 13 — then failed the other).

**Not the model.** In every healed run the model did exactly what the gap said. In the failed runs
it did exactly what the gap said, and the gap said too little.

**What this rules out and what it does not.** It does not show that a gap-only channel cannot heal;
it shows that a gap of one sentence describing one check cannot steer a two-check close. Reporting
every failing check, one sentence each, is inside the signed doctrine (a passed check is still never
mentioned, the field list is still never shown). Accepting `**Heading**` or `2. Heading` as a heading
would be **widening the close to turn red green** and is not done here — it is a separate ruling for
hamr (below).

**Also seen.** With `STRIKE_LIMIT 2` and fallback 4, `struck-out` cannot occur at attempt 4 (fallback
wins the boundary by design), and a strike at attempt 3 needs the same gap on attempts 1, 2 and 3.
With two checks alternating, strikes never accumulate. Reporting all failing checks makes the gap
hash stable across attempts, so strikes will start to bite; worth watching in batch b.

**Next: batch b** — closer reports every failing check (`reds[]`, joined); the heading sentence
states the form ("no line is exactly … — a heading is a line that is only that text, optionally
after #"); same plant, same bar, new tag.

**Batch b (tag `2026-09-24b`, same plant, closer at `5343b4d`).** 20 runs, 46 attempts, $0.2080,
`modelMatch` match on all 46, `spendComplete: true`.
`greenAt1 0, healed 18, greenByAttempt3 17, struckOut 0, fallback 2`.

- 16 runs healed on attempt 2, one on attempt 3, one on attempt 4 (run 17), two ran to the fallback
  (runs 7 and 20). Every attempt-1 red carried all three heading sentences (and the word sentence
  when it applied); every attempt-2 text put the three headings on their own lines.
- The two fallbacks and run 17 are the same shape: headings fixed on attempt 2 but over 600 words;
  shortened on attempt 3 and lost a heading; the gap was complete every time. That is the model
  juggling two constraints, not a thin gap.
- Strikes never fired in either batch: with all checks reported, consecutive gaps differ as the
  failing set changes, so the seen-set never repeats. The fallback at 4 did all the bounding.

**Against the signed bar (18/20 green by attempt 3): 17/20.** Missed by one; 18/20 by attempt 4.
Batch a to batch b: 6 → 18 healed, the whole difference being what the gap says. Nothing passed
that should not have: the two fallbacks halted naming the step and the last gap, under cap. Ruling
on the bar is hamr's (a catch is a catch — the 2026-09-15 rule — or a third batch).

## F39 — First live run of `src/runner.js`: job #2 reached its ask, hamr accepted, the run sent a summary whose first line says the JD was never read (2026-09-24)

**Setup.** Flow `flows/job2-live-1` written from `test/fixtures/job2.m1.*` by `poc/m2/mkflow.mjs`, sources
= the frozen `job2-probe-1` resume and JD, cap $0.25. `poc/m2/live.mjs` → `runFlow` with the live model
step (`deepseek-flash`), file ask, file send. Runner at `ce4f366`.

**What happened, from the books.** Six audit rows, one history row, $0.0118, `modelMatch` match, all priced.
`resume-text` hitl pass-through (8 s). `jd-text` hitl pass-through (12 s). `resume-summary` attempt 1 red
on the headings, attempt 2 green — the gap-back loop healing in the real fold, as F38 measured. ASK OPEN;
hamr wrote an accept, then a reject 8 s later; the accept was consumed and renamed, the run sent to
`file:poc/m0/out`, `outcome: complete`; the reject sits unread in `answer.json`. Consume-once held.

**The sent summary opens: "Note: the job description could not be read (status: blocked)".** The
`jd-text` step was granted `read` — a path-based tool sandboxed to the run dir and its frozen inputs —
but the executor context carries no paths (by design: goal, reads, gap, nothing else). The model tried
`~`, `.`, `/`, `job_description.md`, was refused each time, and emitted an honest artifact: `status:
blocked`, `content: null`, "none of the file's text was invented". Three mechanisms then let that
through:

1. **No way to read a text source by role.** `readDocx` and `addressCells` take a `role` (`resume`,
   `jd`) and list the roles in their description; `read` takes a path the model was never given. The
   JD was frozen (1885 bytes, sha256 in `inputs.json`) and unreachable. Fix: `read`/`grep` accept a
   role and list the roles, same as the other two.
2. **hitl steps not on a signed ask line pass through** once their artifact is non-empty (piece 1's
   stated reading of "hitl: the ask"). The `jd-text` artifact was non-empty — it was a well-formed
   report of failure — so the happened check passed, no close ran, and the fold moved on.
3. **The next ask showed it, and the human accepted.** The ask's evidence was the summary text; its
   first line was the blocked note; hamr accepted without reading. The machine did exactly what it
   was told: a human accept in the same run, a signed destination. This is the failure class fwdloop
   exists for: the step was not done, and the run reported `complete`.

**Also short of the signed scope, found reading the run dir.** No `runs/<id>/artifacts/` — artifacts
lived only inside `log.json` (item 2). `log.json` kept only final artifacts, not attempt 1's red text,
and a halted run would have written `{ runId, outcome, red }` with nothing the model wrote (item 9 and
the 2026-09-15 ruling). Both fixed in the follow-up commit with mechanism 1.

**What the model did right.** It did not invent a JD. It typed `status: blocked` and `content: null`
into its own artifact. A run that reads that field cannot mistake it for done. That is the lever for
the ruling below.

**For hamr to rule (see the ladder, M2 amendment 1).** (a) A step's own typed self-report: the
`emit_artifact` schema for every class carries `done: boolean` and `blocker: string | null`; `done:
false` is a **red naming the step and the blocker**, mechanically, no judge — the model's own word
that it did not do the step is the one thing the machine may take at face value. (b) hitl steps not
on a signed ask line: their artifacts are carried as evidence into the next signed ask (the human
sees every unjudged artifact since the last ask, each labelled by step), instead of passing silently.

## F40 — Second live run of `src/runner.js` after amendment 1: the JD was read by role, both unjudged artifacts reached the ask, two rejects redrafted live, an early accept was quarantined as stale, the third accept sent (2026-09-24)

**Setup.** Same flow as F39 (`flows/job2-live-1`, frozen resume + JD, cap $0.25), runner at `a045b73`
(amendment 1: `done`/`blocker` on every artifact, unjudged hitl artifacts carried into the next ask,
`read`/`grep` by role). `poc/m2/live.mjs --run-id run-2 --slot deepseek --ask-timeout 1800000`,
detached, key loaded in the foreground.

**What happened, from the books.** 14 audit rows, $0.0446, every row priced, `modelMatch` match, no
strikes, `outcome: complete`, sent to `poc/m0/out/run-2-resume-summary-output.json`.

| step | attempts | verdicts | usd |
|---|---|---|---|
| resume-text (hitl) | 1 | hitl | 0.0028 |
| jd-text (hitl) | 1 | hitl | 0.0011 |
| resume-summary, draft 1 | 2 | red (3 headings), green | 0.0122 |
| ask 1 → reject "cut the skills section to three lines" | | red, `unjudgedCount: 2` | 0 |
| resume-summary, redraft 1 | 3 | red (2 headings), red (1 heading), green | 0.0143 |
| ask 2 → same reject again | | red, `unjudgedCount: 2` | 0 |
| resume-summary, redraft 2 | 3 | red (3 headings), red, green | 0.0142 |
| ask 3 → accept written 37 s **before** the ask opened | | `stale-answer-ignored` | 0 |
| ask 3 → fresh accept | | green, `unjudgedCount: 2` | 0 |
| resume-summary-output (send) | 1 | green | 0 |

**F39's three mechanisms, each closed live.**
1. **Read by role.** `artifacts/jd-text.json` holds the real JD: 1882 characters starting "# Applied
   AI Architect, Startups — Anthropic". No path guessing, no `status: blocked`, one round, 4 s.
2. **Unjudged artifacts reach the human.** `ask.json` carries `evidence.unjudged` with both hitl
   artifacts (resume text 7108 chars, JD text 1931 chars) labelled by step goal, beside the summary.
   The audit row for every ask stamps `unjudgedCount: 2`.
3. **A step that did not do its job cannot pass.** Not exercised this run — every step set `done:
   true` — so the `done: false` halt is still proven only by tests (a045b73), not by a live model.

**Consume-once and stale-quarantine, on real keystrokes.** hamr wrote reject, then (four minutes
later, from the previous turn's instructions) reject and accept 7 s apart. Each consumed answer was
renamed `answer.<askedAt>.consumed.json`; the accept that arrived mid-redraft was moved to
`answer.stale.1.json` with the audit row naming both timestamps (`answeredAt 14:40:21 predates askedAt
14:40:58`). A second accept, written into the open ask, was consumed and the run sent. Nothing was
applied twice, nothing early was applied at all.

**What is not proven.** The reject reason was never checked against the redraft — the human
declares softgreen, and hamr accepted without reading the third draft. Whether "three lines" was
honoured is unknown and no mechanism claims it. Also: three of the eight paid attempts were heading
reds (the closer's gap names the exact missing heading; the model still needs 2–4 tries), ~$0.014 per
redraft cycle. Same shape as F38; not a bug, a cost line for M2's exit.

**Cost.** $0.0446 for a run with two human rejects. Human-cost bar is $12.50/day; this is 0.4 % of it.

## F41 — Live plant: an empty JD file; the step said `done: false` and the run halted `not-done` naming the step, nothing sent. Three books findings on the way (2026-09-24)

**Setup.** `flows/job2-plant-notdone`: job #2's signed prose with `source jd` pointing at a 0-byte file
(the frozen copy is 0 bytes, sha256 of empty), the real resume, cap $0.25. Runner at `a045b73`,
`deepseek-flash`, detached, `--ask-timeout 600000`. The question: does amendment 1's `done: false`
halt fire from a live model, not just the test double.

**It fired.** Two audit rows, `outcome: not-done`, no ask opened, no send, `artifacts/` holds only
`resume-text.json`. The JD step's artifact in `log.json`: `done: false`, `blocker: "Reading the frozen
job description (role: "jd") consistently returned no content across repeated and size-capped
attempts … path-based fallbacks were refused as outside the sandbox"`, `cells.jd_text: ""`. The model
did not invent a JD. The runner took its word before any close, halted naming the step and the
blocker verbatim, and the history row says `not-done`. Amendment 1 item 1 is live-proven.

**Three things the books show that the tests did not.**

1. **The halt path drops the signature hash.** `history.jsonl` row: `signatureHash: null`. The
   complete path writes `signature.flow`; `haltRun` hard-codes `null` for every halt, including this
   one, which read and verified the signature first. Item 9 says every history row carries it. A
   halted run must name the flow version it halted on. Bug, one field.
2. **Audit and history disagree by $0.061.** Audit rows sum to $0.0908; history says `spentUsd`
   $0.1519. `spend.jsonl` has three rows: the JD step's first try died `socket hang up` after 4 rounds
   ($0.0612), the item-8 retry then ran 8 rounds to `end_turn` ($0.0880). The retry's cost is on the
   audit row; the fault's floor is only in the total. Money-honest (history is right, nothing dropped)
   but item 9's "one row per attempt" row does not carry the attempt's cost. Fix: the attempt's audit
   `usd` includes the retried fault's floor (or the fault gets its own audit row). Bug, one add.
3. **`read` by role hands a step the raw .docx, and the step ate 400k tokens of zip.** Both spend
   rows show ~200k input tokens per row with a 1–2 kB prompt: the JD step, finding `role: jd` empty,
   read `role: resume` through `read` — which serves any frozen input, and returns the docx's bytes
   as text (verified at $0: 248,730 chars, starts `PK\x03\x04`, truncated at 256 kB). Twelve rounds of
   that is the $0.15, twice run-2's whole job. Nothing is wrong by the rules: the role list is every
   frozen input, `read` has no notion of "this role is a docx". A ruling for hamr: **`read`/`grep`
   offer only text roles; a .docx/.csv role names its own primitive in the refusal** ("role resume is a
   .docx — use readDocx"). Mechanism, not wording. Recommended; not built until ruled.

Also: no round trace exists, so which tool call carried the bytes is inferred from the tokens and the
$0 replay, not read from a book. `log.json` keeps the model's artifact, not its tool calls. Cost line,
not a defect under the 2026-09-15 ruling; noted for M3's inbox design.

**Cost.** $0.152 for the plant. M2 total $0.74 of $5.00.

## F42 — Branch review: the send shipped `reads[0]`, not the accepted artifact (2026-09-24)

**Found by `/branch-review` at `ebffafe`, reproduced, confirmed.** The runner's send picked its content
as the first id in the send step's `reads` that had an artifact on disk. Every read names an earlier
step, so that was always `reads[0]`. A valid declaration whose send reads `['jd-text',
'resume-summary-approved']` signed, ran, reported `complete`, and shipped the JD text. The live runs
(F39–F41) were never exposed: job #2's send reads `resume-summary` first, which holds the same text as
the accepted artifact. No test entered the runner's send branch with a real `arbiter.sends` line.

**Fixed by identity, not position.** The send ships the artifact emitted by the one signed ask step
in its `reads`, and only if that ask was accepted in this run. None, or more than one, halts red
naming the ids before `sendStep` is called. `validateDeclaration` now requires exactly one earlier
ask's `emits` in a send's `reads`. Each new test is red against the old code (content mismatch;
`'complete' !== 'red'`; a two-ask send validating green).

**Also seen.** `validateDeclaration` counts asks earlier by prose line; the runner counts every signed
ask step. A signed ask on a later line but earlier in step order passes the validator and is caught
by the runner's guard. Harmless now; worth one rule when M3 revisits ask placement.

## F43 — The signed ask TTL is parsed and never reaches the ask (2026-09-25)

**Found reading the code for the M3 draft, at `9c6b420`.** `src/signed-text.js` parses `ask 30m:`
into `ttlMs` on each signed ask (default 30m). `src/runner.js:791` calls
`askStep({ question, evidence, runDir })` without it. The wait time is whatever `timeoutMs` the
caller passed to `makeFileAskStep` (`src/ask.js`, default 120 s). So every ask waits the code's
number, not the human's. This breaks a hard line: an ask's TTL is signed by a human, and code
never replaces it. No test covers it: every test sets `timeoutMs` by hand.

**Not fixed here.** It belongs to M3 scope item 1 (the signed TTL governs), because M3 changes how an
ask waits anyway (park and exit instead of an in-process poll). Until then a live run's ask expires at
the caller's `timeoutMs`, whatever the prose says.

## F44 — M3 POC: a run parked at its ask and killed comes back exactly as it was, 20/20 (2026-09-25)

**What ran.** `poc/m3/park.mjs` (park, answer, resume as three separate OS processes) and
`poc/m3/loop.mjs` (the 20-loop driver), on job #2's fixture flow with fake call-counting model
steps, $0. Each loop: `run` parks at the signed ask and exits on its own (a `SIGKILL` afterwards
finds nothing left), `answer` from a second process, `resume` from a third. Final artifacts are
compared to an in-process `runFlow` reference run.

**Result: 20/20**, stable over 6 runs by the worker and 1 by the orchestrator. Loops 1–5 raced two
resumers (exactly one proceeded). Loops 6–10 edited a frozen input while parked (resume refused it by
name, $0, nothing sent). Loops 11–13 rejected once (redo, re-park under a new askId), then accepted.

**The bar can fail**, shown with three deliberately broken resumers:
- `rerun-from-start`: 5/20. Every non-tamper loop is red ("resume-summary" called 2 times, expected 1).
- `no-input-check`: 15/20. Red on exactly loops 6–10.
- `no-lock`: 14–17/20 over 6 runs. At least one of loops 1–5 is red each run (`successes=2`, both
  resumers finished and both sent). It is racy by nature. Loops 11–13 also go red in this variant
  for a side reason (the deferred rename leaves the old answer in place).

**Lesson for the build.** Consuming `answer.json` by atomic `rename()` before acting is a mutex by
itself. With the lock removed, no race showed until the broken variant was changed to act *before*
renaming. The M3 build keeps both mechanisms: the lock (scope item 5) and rename-to-consume before
acting.

**POC shortcuts not to carry into `src/`.** A re-park after `reject` hard-codes a 30-minute TTL
instead of re-reading the signed ask slot (F43's gap again). `rerun` (scope item 7) is not
exercised: it is a separate assumption, and it gets its own test in the build.

**Cost.** $0. M3 $0.00 of $2.00.

## F45 — M3 live exit: job #2 parked, answered from hamr's terminal, resumed twice, sent (2026-09-25)

**What ran.** `bin/fwdloop` at `6599760` on `deepseek-flash`, flow `flows/job2-live-1`, run `m3-live-1`.
Three separate processes, and each one exited on its own:
1. `fwdloop run` read both inputs by role. The compose step went green on attempt 3, and the run
   parked at the signed ask (default 30m TTL). No fwdloop process was left running.
2. hamr, from their own terminal: `fwdloop answer <id> reject "cut the soft skills section to five lines"`.
   `fwdloop resume` redid the compose step (green on its 3rd redo attempt, after two heading reds) and
   re-parked under a new askId with a fresh 30m expiry.
3. hamr: `fwdloop answer <id> accept`. `fwdloop resume` sent to
   `poc/m0/out/m3-live-1-resume-summary-output.json`. Outcome `complete`.

**Checked.** The sent text equals the accepted artifact byte for byte. `spend.jsonl` (8 rows) and
`audit.jsonl` (13 rows) both sum to $0.0307. `history.jsonl` has exactly one row for the run. The
pre-ask read steps ran once. Both answers were consumed once, by askId.

**Not proven.** Whether the reject reason was honoured. The redrafted soft skills section is one
~170-word paragraph, not five lines, and switched to third person. This is a hitl step, so the human
judges it; there is no mechanical check, as ruled.

**Found on the way (not fixed yet):**
1. `fwdloop inbox` lists M2-era runs (`run-1`, `run-2`, whose `ask.json` has no `askId`/`expiresAt`)
   as `[open] NaNs left`. It should never show an ask it cannot answer as open.
2. A parked `ask.json` holds only `askId, question, askedAt, expiresAt`. The draft under review and
   the unjudged evidence live in `state.json`/artifacts. A human answering from `inbox` cannot see
   what they are accepting unless they know where to look. M2's in-process `ask.json` carried
   `evidence`.
3. The history row's `wallMs` is 19: it times only the last process, not the run.

**Cost.** $0.0307. M3 total $0.03 of $2.00.

**Fixed, same day, all three** (each test red before its fix). (1) `inbox` shows an M2-era ask as
`legacy (not answerable)` and a malformed one as `unreadable`, naming the run, never `open`.
(2) A parked `ask.json` carries `evidence` (`{ artifact, unjudged }`, the redrafted artifact on every
re-park), and `fwdloop show <askId>` prints it read-only. (3) History `wallMs` runs from the run's
first start (`state.startedAt`), so a pause counts as elapsed time. A run parked before this fix has
no `startedAt` and falls back to the resuming process's start; that is a wall-time floor, not a money
figure. Suite 1216/1216.

**Fixes proven live, 2026-09-26** (`088163c`, run `m3-live-2`, `deepseek-flash`). `inbox` listed the
new ask `[open] 1800s left` and both M2-era runs as `legacy (not answerable)`. hamr ran
`fwdloop show` from their terminal and read the draft plus both unjudged inputs, labelled by step.
They rejected ("shorter work history blurb"); the re-parked `ask.json` evidence equalled the redrafted
artifact on disk, and the blurb went from about 190 to 157 words. `show` again, then accept, then
sent. The sent text equals the accepted artifact. Both books sum to $0.0184. The one history row has
`wallMs` 970,615 (16.2 min, the run's first start to the send, pauses included), matching the
clock. M3 total $0.05 of $2.00.
