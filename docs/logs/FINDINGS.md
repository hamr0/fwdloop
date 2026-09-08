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
compare on the suffix or the audit will show a mismatch on every row; (2) the subscription is
flat-rate, so each round is priced at the model's public list rate as a **ceiling**, stated
as such — unknown is never 0, and flat is not free.

**Verdict:** synthetic.new is M0's provider, one key, two labs (GLM-5.2 primary, Kimi-K3
second, §11 P10). No upstream ask: bare-agent's `OpenAI` provider with `baseUrl` fits as-is.
The watch-list items in `docs/product/UPSTREAM-ASKS.md` for tool-call pass-through and
DeepSeek's cached-token field are moot for M0 and stay as watches. Key lives in `pass` at
`amr/synthetic_api` and reaches the process only as `SYNTHETIC_API_KEY` in the environment
(hard line: never the tree).
