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
