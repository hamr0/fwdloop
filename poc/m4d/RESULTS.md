# M4d first POC results (2026-10-05)

## (a) Key from a file vs the panel resume child's log ($0)

Script: `poc/m4d/canary-scrub.mjs` (real `createResumer` + `scripts/panel-fixtures/panel-resume-echo-key.mjs`).
The scrubber (`src/panel/resume.js:123`) reads `env` = `opts.env` (default `process.env`), the SAME object the child is spawned with
(`:105-107`). So a key merged into `opts.env` is scrubbed too. **Hypothesis (scrubber looks at process.env) FAILED: no leak.**

| case | canary in raw child log (while alive) | canary in `rec.refusal` (the quoted text) | `[redacted-key]` markers in refusal |
|---|---|---|---|
| control: canary in process.env, opts.env omitted | 2 | 0 | 2 |
| file-loaded: canary only in opts.env (not process.env) | 2 | 0 | 2 |

Notes: the RAW log file always holds the echoed key (a misbehaving child writes it; 2 = stdout + stderr). The scrub protects only
the text quoted into the refusal/HTTP/books. Protection of the file itself is: log dir 0700, deleted on exit 0 (existing tests).
M4d risk is therefore a WIRING one, not a scrub bug: the merged env must be the single object used for both the spawn and the
scrub keys. If M4d merges file keys into the child at spawn but leaves `env` (scrub list) as the unmerged one, the leak would
appear (cannot happen via createResumer's API today because it has one `env`; the merge must go into that option).

### Call sites a file-loaded key must reach (reads `process.env`/`envVar`, or scrubs keys)
- `src/provider.js:312` `makeProvider`: `const apiKey = process.env[slot.envVar]` — reads process.env directly, no env param.
- `src/provider.js:309` `makeProvider`: `checkKeyPreflight(slotName)` — called with NO env arg (defaults `process.env`, :269).
- `src/provider.js:269-272` `checkKeyPreflight(slotName, env = process.env)`.
- `src/model-step.js:251` calls `makeProvider(slot, ...)` (run/resume model steps) — inherits the two above.
- `bin/fwdloop:96` `checkKeyPreflight(MODEL_SLOT)` — process.env only; red message there.
- `src/authoring.js:184-186` draft: `PROVIDER_SLOTS[slot].envVar`, `checkKeyPreflight(slot, env)` with `env = process.env` default (:166); scrub list.
- `src/authoring.js:288` sign/approve: `keys = ...env[p.envVar]` scrub list (`env = process.env` default :282).
- `src/authoring.js:192,222-243` `scrub(..., secrets)` of draft output/log.json (secrets built from :184 env).
- `src/panel/resume.js:89` `env = process.env` default; `:105-107` spawn env; `:123` scrub key list.
- `src/panel/server.js:138,161` `env = process.env` (token loader / server env) — what the panel hands the resumer.
- `src/authoring.js:65` `scrub()` itself (literal, skips secrets < 8 chars).
- Not key-related but `process.env` readers: `bin/fwdloop:88-89,571-572` (NODE_ENV=test hooks).
- `src/drafter.js` does not read env; it gets its provider from `makeProvider` (DRAFT_PROVIDER_OPTIONS).
Gap to note: `makeProvider`/`checkKeyPreflight` inside it take no env, so a merged env cannot reach them except by mutating
`process.env` or adding an env parameter (an M4d design decision).

## (b) Booked cost vs DeepSeek's published price (paid, tiny)

Script: `poc/m4d/cache-price.mjs` (fwdloop `makeProvider('deepseek')`, bare-agent `Loop` with `rates` {in:0.0003,out:0.0012} and
`onLlmResult`, same prompt twice, maxTokens 32). Raw usage captured by wrapping the provider's `_normalizeUsage` (verbatim `data.usage`).
Published peak per 1M: miss $0.30, hit $0.006, out $1.20 (off-peak half).

Raw DeepSeek usage carries BOTH `prompt_cache_hit_tokens`/`prompt_cache_miss_tokens` AND
`prompt_tokens_details.cached_tokens` (equal). bare-agent's openai provider maps from `prompt_tokens_details.cached_tokens`:
`inputTokens = prompt_tokens - cached`, `cacheReadTokens = cached`.

**Double count: NO.** mapped inputTokens (225) EXCLUDES the hit tokens (2816); 225 + 2816 = prompt_tokens 3041.

Run 1 (cold cache), usage captured from the metering event (raw capture added in run 2):
| call | mapped in / cacheRead / out | booked $ | real peak $ | real off-peak $ |
|---|---|---|---|---|
| 1 (all miss) | 3041 / 0 / 32 | 0.000951 | 0.000951 | 0.000475 |
| 2 (hit) | 225 / 2816 / 22 | 0.000178 | 0.000111 | 0.000055 |

Run 2 (cache already warm, both calls hit):
| call | raw prompt / hit / miss / completion | mapped in / cacheRead / out | booked $ | real peak $ | real off-peak $ |
|---|---|---|---|---|---|
| 1 | 3041 / 2816 / 225 / 24 | 225 / 2816 / 24 | 0.000181 | 0.000113 | 0.000057 |
| 2 | 3041 / 2816 / 225 / 16 | 225 / 2816 / 16 | 0.000171 | 0.000104 | 0.000052 |

Prediction confirmed: cache hits are booked at 0.0003 * 0.1 * 1000 = **$0.03/M vs real $0.006/M (5x over)**. Event `rateSource` is
`caller` (rates were supplied), `costUsd` correct for miss and output. Effect on a real bill: cached tokens over-booked 5x; with
~93% of input cached (as here) the whole call is booked ~1.6x real at peak (0.000178 vs 0.000111), ~3.2x vs off-peak.
Fix shape (not done): pass `cacheReadMult: 0.02` (= 0.006/0.30) in the `deepseek-flash` rate row, or a `cachedIn` field in the page price.
Spend: run 1 booked $0.001129, run 2 booked $0.000352; total booked $0.00148 (real a little lower); cap was < $0.01.
