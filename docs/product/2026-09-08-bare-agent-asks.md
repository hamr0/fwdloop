# bare-agent asks — consolidated filing (fwdloop + bareloop), 2026-09-08

Carried by the fwdloop session on hamr's word (relayed by the bareloop session "barelo",
2026-09-08: "you carry ALL the bare-agent asks from both sessions into one consolidated
filing"). One document, four asks, each naming the session that found it and the evidence.
Facts verbatim from the finding sessions; nothing softened. Target: bare-agent 0.41.1
(`~/PycharmProjects/bareagent`, npm `bare-agent`), Node v22.22.2.

Order is by severity as we see it: a silent non-settle first, a hard 400 second, two
observability gaps last.

## ASK 1 — `generate()` never settles when the response body is cut after headers (bareloop BA-25; corroborated by fwdloop on 0.41.1)

**Found by:** barelo (bareloop main @ ccda624, `docs/product/UPSTREAM-ASKS.md` BA-25,
`docs/logs/FINDINGS.md` F140). **Re-run by fwdloop** against bare-agent 0.41.1 with the same
harness, 2026-09-08, identical results.

**Where:** `_request` in BOTH `src/provider-openai.js` (~155–205) and
`src/provider-anthropic.js` (~300–345) wires only `res.on('data')`, `res.on('end')`, and
`req.on('error')`. Nothing on `res 'aborted'`, `res 'close'`, `res 'error'`.

**$0 repro:** `~/PycharmProjects/bareloop-patients/spines-poc-openai/harness-drop.mjs` — a
local http server that answers one request per case. Results (bareloop on 0.39.0; fwdloop
on 0.41.1, `T=2000` idle timeout):

| case | outcome |
|---|---|
| destroy-before-headers | REJECTED `socket hang up` |
| headers + partial body + socket destroy | **never settles** — process drains, `Warning: Detected unsettled top-level await`, exit 13 (exit 0 when the await is not top-level) |
| headers + partial body + end before content-length | **never settles** — same |
| headers then silence | REJECTED after idle timeout (BA-18 works here) |
| 524 empty body / 200 empty body | REJECTED `Invalid JSON response` |
| chunked end without body | REJECTED `Parse Error` |

The BA-18 idle timeout does not rescue the two non-settling cases: the socket is already
dead, so no "inactivity" clock fires. Verified with `timeoutMs 2000` on both versions.

**Live footprint (barelo):** once through synthetic.new (Cloudflare-fronted), GLM-5.2, run
`n3spffeh` — spine stopped mid-draft, no job-end record, no error, no stack. A second run got
an honest HTTP 524 instead. The class matters because a run that ends with no outcome
cannot be retried by any rule that keys off an error.

**Ask:** reject on `res 'aborted'`, on `res 'close'` without a prior `'end'`, and on
`res 'error'`, as a transport-class `ProviderError` (so a one-retry ladder can see it).
Both providers. No new option.

## ASK 2 — OpenAI provider sends `max_tokens`; GPT-5 models reject it (bareloop BA-24)

**Found by:** barelo (bareloop BA-24, F139; evidence
`~/PycharmProjects/bareloop-patients/spines-poc-openai/probe-openai-2.mjs`,
`poc-openai-2.log`). **fwdloop verified the source line** (`src/provider-openai.js:76`,
0.41.1: `...(options.maxTokens && { max_tokens: options.maxTokens })`); the live rejection
is barelo's measurement, fwdloop has no OpenAI key to re-run it.

**Fact (barelo, verified live):** every current OpenAI GPT-5 model rejects the request:
`Unsupported parameter: 'max_tokens' is not supported with this model. Use
'max_completion_tokens' instead.` Seen on `gpt-5-mini` and `gpt-5.4-mini`;
`gpt-4.1-mini` / `gpt-4.1` accept the legacy key. Unchanged in 0.41.1.

**Ask:** send `max_completion_tokens` by default; keep a constructor option (e.g.
`legacyMaxTokens: true`) for OpenAI-compatible servers that only know `max_tokens`. No
model-name sniffing. (fwdloop note: synthetic.new accepts `max_tokens` today; fwdloop would
set the legacy flag if the default flips.)

## ASK 3 — Loop does not surface `stopReason: 'length'`; a cut reasoning round reads as a refusal (fwdloop F4; corroborated by bareloop)

**Found by:** fwdloop (`docs/logs/FINDINGS.md` F4, branch `m0-poc`). GLM-5.2 on
synthetic.new, bare-agent 0.41.1: with `maxTokens` 1500 / 4000 the round returned empty
text, no tool call, `outputTokens` exactly equal to the cap, `finish_reason: length` —
the model's reasoning is billed as completion tokens and was cut mid-think. With
`maxTokens` 16000 the same prompt returned a clean tool call (615 output tokens). Forcing
`tool_choice` did not help. For about an hour this was misfiled as "the model refuses the
tool"; the only signal that it was a truncation was `stopReason` on the result, which
nothing in Loop shouts about.

**Corroboration (barelo, verbatim):** sonnet-5 adaptive thinking did the same (empty text at
`stop=max_tokens`), worked around with `output_config effort:'low'`; bareloop's own spine
round record carries no `stopReason` field at all, so the class is invisible after the fact
on bareloop's side too (that part is bareloop's to fix, not bare-agent's — context only).

**Ask:** make a `length`/`max_tokens` stop loud — a `loop:truncated` stream event and/or a
`console.warn` once per Loop, and carry `stopReason` on the `onLlmResult` metering payload
so the audit row records it without reading the awaited result. (Related, not blocking:
`loop.run()` returns `toolCalls: []` on every path and no `model` field — F3.)

## ASK 4 — OpenAI provider never sends `tool_choice` (fwdloop, watch-list grade)

**Found by:** fwdloop (F4). `src/provider-openai.js:72–83` builds `tools` but never
`tool_choice`, so the API default `auto` applies. **Not load-bearing for fwdloop**: unforced
tool calls landed on every round that finished (F2, F3, F4 table), and forcing did not
change the truncation outcome. Filed as nice-to-have: accept `options.toolChoice`
(`'auto' | 'required' | { name }`) in `generate()` and pass it through. Becomes a real ask
only if a finished round (`stopReason` ≠ `length`) returns text instead of the tool >1 in 10.

## Status

| ask | severity | repro | filed with bareagent |
|---|---|---|---|
| 1 non-settle on cut body | blocks any unattended run | harness-drop.mjs ($0, 2 cases) | pending |
| 2 `max_tokens` on GPT-5 | hard 400 on every GPT-5 call | probe-openai-2.mjs (needs OpenAI key) | pending |
| 3 silent truncation | misdiagnosis class, cost | fwdloop drafter, cap 4000 vs 16000 | pending |
| 4 `tool_choice` | nice-to-have | — | pending |

Consumed-version column lands here when a release ships. bareloop's BA-24/BA-25 point at
this file with a "carried by fwdloop" note (barelo owns that edit).
