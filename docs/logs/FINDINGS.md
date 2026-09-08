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

## F4 — bare-agent OpenAI provider cannot force a tool call; GLM-5.2 answers the drafter in prose (2026-09-08)

M0 drafter (`poc/m0/drafter.mjs`, branch `m0-poc`): GLM-5.2 returned prose describing the
declaration instead of calling `emit_declaration` on **5 of 5** attempts, including a
minimal two-message prompt with a trivial schema and a system line saying any non-tool
answer is a failure. Kimi-K3 could not be compared: two consecutive provider errors (502,
503), beyond the one-retry ladder.

Cause, verified in `node_modules/bare-agent/src/provider-openai.js:72-83` (0.41.1): the
request body carries `tools` but never `tool_choice`, so the API default `auto` applies and
the model is free to answer in text. F2's raw-curl smoke test set
`tool_choice: {type:'function', function:{name}}` and got clean tool calls from both models,
so the API supports forcing it; the wrapper does not expose it. This is the watch-list item
"tool-call-as-output" turning into an ask: without a forced tool call, "structured output =
tool call with JSON schema" is a hope, not a contract.

Not patched locally (hamr's rule: upstream asks, wait for delivery). Queued in
`docs/product/UPSTREAM-ASKS.md`. Closes and mechanical steps are built and tested with no
model (35 `node --test` cases, every red path shown failing first); the runner, plants and
run log wait on the fix. Spend so far ≈ $0.016.
