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

## Watch list (not asks — becomes one only when a run proves it)

- **bare-agent · `response_format` / JSON-schema pass-through in the OpenAI provider.** The
  designed path is tool-call-as-output (context.md:987). Becomes an ask only if a model
  returns the typed artifact as text instead of a tool call >1 in 10 on the citation schema.
- **bare-agent · DeepSeek prompt-cache tokens are read as zero** (`src/provider-openai.js:172`,
  0.42.0). Was a watch-list item; **promoted to an ask 2026-09-09 by measurement (F9)**. The
  provider reads `u?.prompt_tokens_details?.cached_tokens`; DeepSeek reports caching as
  top-level `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`, so `cacheReadTokens` is
  always 0 and every cached token prices at the full input rate. DeepSeek's cache hits cost an
  order of magnitude less than misses, so the audit row overstates spend — a money-honesty
  defect. Ask: fall back to `prompt_cache_hit_tokens` when `prompt_tokens_details` is absent
  (no model-name sniffing; both are plain fields on the OpenAI-shaped response). Fix:
  *(pending)*. Consumed: *(pending)*.