# Upstream asks — bare suite gaps found while building fwdloop

hamr, 2026-09-08: "we will utilize baresuite and anything that is wrong/missing with
primitives will be upstream asks, don't handroll what we can use, we use this as a validation
for our libraries too and we wait until they deliver."

This is a **fix queue, not a log** (same rule as bareloop's): a gap in bare-agent / bareguard /
litectx is fixed at the repo that owns the primitive and consumed here by version bump —
never a local shim, never a copy of the primitive into this tree. Only **upstream-gap reds**
(primitive missing or broken) land here. Waiting on an entry is a legitimate state for a
module; the wait is recorded in `docs/logs/FINDINGS.md`.

Format per entry: **which package · what's missing/broken · the run/finding that surfaced
it · the fix (upstream commit/PR) · the version fwdloop consumed.**

## Queue

- **bare-agent · four asks from fwdloop + bareloop, consolidated in
  [`2026-09-08-bare-agent-asks.md`](2026-09-08-bare-agent-asks.md)** (hamr's word via barelo,
  2026-09-08): (1) `generate()` never settles on a body cut after headers — bareloop BA-25,
  reproduced on 0.41.1 by fwdloop at $0; (2) `max_tokens` rejected by GPT-5 models — bareloop
  BA-24; (3) silent `stopReason: length` — fwdloop F4, bareloop corroborates; (4) no
  `tool_choice` — fwdloop, nice-to-have. Fix: bare-agent 0.42.0 (main 8ee93e9). Consumed: **0.42.0** on `m0-poc`, harness verified. (1) does not
  block M0's paid runs today but blocks any unattended rerun (M5+).

- **bare-agent · a silently dropped output cap is not detected.** `legacyMaxTokens` (BA-24,
  delivered in 0.42.0) lets a caller choose the request key, but nothing tells a caller the key
  was **ignored**. Proven by a run, not suspected: F11 A/B'd `deepseek-v4-flash` with
  `maxTokens: 64` — with the 0.42.0 default (`max_completion_tokens`) it returned **783 output
  tokens, `stopReason: 'end_turn'`, no error and no warning**; with `legacyMaxTokens: true`,
  exactly 64 and `stopReason: 'max_tokens'`. DeepSeek accepts the request and drops the parameter.
  Every DeepSeek round in F10 therefore ran with **no enforced output ceiling** — a money guardrail
  that silently did not exist, which is the one failure class the money doctrine says must never be
  silent (unknown is never rendered as 0; a cap that is not enforced is worse than no cap, because
  the caller believes it holds). **The detection is deterministic and cheap:** a cap was requested,
  `outputTokens` exceeds it, and `stopReason` is not `max_tokens` ⇒ the cap was dropped — warn
  once per Loop, the same shape as the existing truncation warning. *Does not block:* fwdloop's own
  fix is applied (`legacyMaxTokens` is a property of the `deepseek` slot in
  `poc/m0/provider.mjs`, tested). It matters for the **next** provider that does this quietly, and
  F12 has now made that flag load-bearing on the default path. Surfaced by F11, 2026-09-09.

## Watch list (not asks — becomes one only when a run proves it)

- **bare-agent · `response_format` / JSON-schema pass-through in the OpenAI provider.** The
  designed path is tool-call-as-output (context.md:987). Becomes an ask only if a model
  returns the typed artifact as text instead of a tool call >1 in 10 on the citation schema.
- ~~**bare-agent · DeepSeek prompt-cache tokens are read as zero**~~ — **RETRACTED 2026-09-09,
  same day as filed.** Measured with a repeated prefix: DeepSeek populates BOTH
  `prompt_cache_hit_tokens` and `prompt_tokens_details.cached_tokens`, and they agree (4,352 of
  4,361). bare-agent reads the latter and prices it correctly. The original claim came from a
  cold call where every cache field reads 0 — absence of a value mistaken for absence of a
  field. No ask. See F9.