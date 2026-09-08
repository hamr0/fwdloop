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

*(empty — nothing has been exercised yet; M0 has not run)*

## Watch list (not asks — becomes one only when a run proves it)

- **bare-agent · `response_format` / JSON-schema pass-through in the OpenAI provider.** The
  designed path is tool-call-as-output (context.md:987). Becomes an ask only if a model
  returns the typed artifact as text instead of a tool call >1 in 10 on the citation schema.
- **bare-agent · DeepSeek cached-token field name.** If DeepSeek reports cache hits outside
  `prompt_tokens_details.cached_tokens`, cached tokens price at the full input rate and the
  audit row under-reports `cacheReadTokens`. Measure on the first paid round.
