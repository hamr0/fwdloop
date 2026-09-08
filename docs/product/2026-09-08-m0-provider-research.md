# M0 provider research — GLM, DeepSeek, Qwen, Kimi, MiniMax, synthetic.new

**Status: research note, 2026-09-08, on hamr's asks ("can we use glm?", "research glm, deepseek,
other chinese models and which is best fit for the job", "synthetic.new could but it has weird
api shape"). Prices are the vendors' published per-million-token rates as read today via
third-party summaries; treat them as ±one revision and re-read at the moment of use (F1).
The fit criteria come first, because they decide more than price does.**

## 1. What "fit for the job" means for M0

The job is: read a small CSV and a one-line message, emit a **typed artifact** with citations
and formulas (PRD §5), do it in a fresh context per step, under a $5 total cap, on two
providers. So the model must, in this order:

1. **Speak OpenAI's chat-completions dialect at a custom base URL.** bare-agent's `OpenAI`
   provider takes `baseUrl` (bareagent.context.md:825) and normalises usage including
   `prompt_tokens_details.cached_tokens` (provider-openai.js:127-139). Anything that fits this
   needs **no upstream ask**. Anything with its own shape would be a new provider in
   bare-agent — an ask, and a wait.
2. **Report usage in the response.** bare-agent prices a round from usage × caller rates
   (`new Loop({ rates: { in, out, cacheReadMult } })`, rateSource `'caller'`, loop.js:55-59);
   no usage block → the round is honestly `unpriced` and the cap goes blind (BA-24). A provider
   that omits usage is unusable under the money rules, whatever it costs.
3. **Call tools reliably.** bare-agent has **no `response_format` pass-through** (grep of
   provider-openai.js and loop.js: none); its documented path for structured output is
   "tools with JSON Schema enforcing structure" (bareagent.context.md:987). So a step's typed
   artifact is emitted as a **tool call** whose input schema *is* the citation schema. This is
   the suite's designed path, not a workaround — and it makes tool-calling quality the
   load-bearing model property for M0.
4. **Be cheap enough to run four plants × two providers × a few rounds under $5**, with a
   free or near-free tier for the $0 iterations before the paid fire.

Data residency is not an M0 criterion (the fixture is a public template), but it is a v1 one:
**the model provider is an egress destination** — customer data leaves the machine in every
prompt. It belongs on the signed allow-list like any other destination (PRD §10), and the
`local-only` guardrail (§11 P7) is how a flow refuses cloud providers entirely.

## 2. The candidates against those criteria

| provider / model | OpenAI-compat base URL | usage + cached tokens | tools | $ in / out per 1M | free tier | fit |
|---|---|---|---|---|---|---|
| **z.ai GLM-5.3** | `https://api.z.ai/api/paas/v4` | yes (cached $0.26) | yes | 1.40 / 4.40 | GLM-4.7-Flash and GLM-4.5-Flash are **free** | **primary** |
| z.ai GLM-5.3-Flash | same | yes | yes | 0.075 / 0.25 (promo) | — | cheap paid tier of the same family |
| **DeepSeek V4 Flash** | `https://api.deepseek.com` | yes (cache-hit $0.014) | yes (V4; V3-era docs called it unstable — measure) | 0.44 / 1.32 peak, half off-peak | none | **second provider** |
| DeepSeek V4 Pro | same | yes | yes | 1.32 / 3.96 peak | none | not needed for M0 |
| Qwen3.5 Flash / Plus (Model Studio, Singapore) | DashScope compatible-mode | yes | yes | 0.10 / 0.40 · 0.40 / 2.40 | free quota on international | viable third; tiered above 256K |
| Kimi K2.5 / K2.6 (Moonshot) | `https://api.moonshot.ai/v1` | yes | yes | 0.60 / 3.00 · 0.95 / 4.00 | none | viable; pricier than GLM-5.3-Flash for no M0 gain |
| MiniMax M2 / M3 | OpenAI-compatible | yes (cache read $0.06) | yes | 0.26–0.30 / 1.02–1.20 | — | viable; nothing distinguishes it for this job |
| synthetic.new (HF open models) | `https://api.synthetic.new/openai/v1` (also `/anthropic`) | per vendor docs, OpenAI shape | per model | flat subscription or per-token | subscription | **usable after all** — the weird part is the alias routing (`syn:large:text` resolves to "the latest recommended model"), which breaks P6: the model id must be pinned in the signed flow. Use only with a concrete model id, never an alias |

Notes:
- z.ai has two base URLs for two key types: general API keys use `/api/paas/v4`; "Coding
  Plan" keys use `/api/coding/paas/v4`. A general key on the coding URL 404s
  ([layer3labs](https://www.layer3labs.io/guides/z-ai-api)). The Anthropic-shaped endpoint
  (`/api/anthropic`) exists but is not needed — the OpenAI provider is the suite's path.
- DeepSeek retired the `deepseek-chat` / `deepseek-reasoner` aliases on 2026-07-24; the ids are
  `deepseek-v4-flash` and `deepseek-v4-pro` ([deepseek.ai/pricing](https://deepseek.ai/pricing)).
  Off-peak pricing is time-of-day dependent — the audit row records `rateSource:'caller'` with
  the rate we passed, so the run must pass the rate for the hour it runs in, or the peak rate
  as a ceiling (a ceiling is honest; a floor is not).
- Qwen's Beijing endpoint is 60–70% cheaper but stores data in China and has no free quota
  ([benchlm](https://benchlm.ai/alibaba/api-pricing)); residency again.

## 3. Recommendation

- **Primary: GLM-5.3** — hamr's ask, and it clears every criterion with no upstream ask.
- **Second provider (P10): DeepSeek V4 Flash** — different lab, different tool-calling
  implementation, a third of GLM-5.3's price, so the two-provider run costs ~1.3× a
  single-provider run rather than 2×. If its tool calling proves flaky on the citation schema,
  that is a finding about DeepSeek, not about the schema, and Qwen3.5 Flash is the substitute.
- **$0 iterations: GLM-4.7-Flash (free)** for every dry run of the runner, the close, the
  plants, and the resume path, before a single paid round. Free is a *known* $0 rate
  (`rates: { in: 0, out: 0 }`, rateSource `'caller'`) — priced, not unpriced.
- **Rates come from the caller**, as the adapter is designed: fwdloop's provider factory
  holds a small `{ provider, model } → { in, out, cacheReadMult }` table, filled from the
  vendor price page, and passes it to `new Loop({ rates })`. No handrolled pricing; bare-agent
  meters, bareguard caps.

**Budget sketch (peak rates, ceiling):** a step round is roughly 2K in / 1K out. Four plants ×
~4 steps × 2 rounds = 32 rounds/provider. GLM-5.3: 32 × (2K × 1.40 + 1K × 4.40) / 1M ≈ $0.23.
DeepSeek V4 Flash ≈ $0.07. Drafting rounds are longer; call the whole M0 **≤ $1 measured**,
leaving $4 of the cap for reruns. This is a sketch, not a measurement — M0's audit rows
replace it.

## 4. What might become an upstream ask (watch list, not asks yet)

- **`response_format` / JSON-schema pass-through in the OpenAI provider.** Not needed if
  tool-call-as-output holds. If a model emits the artifact as text instead of calling the
  tool more than once in ten, that is the ask.
- **DeepSeek's usage field names.** Older DeepSeek responses carried `prompt_cache_hit_tokens`
  rather than `prompt_tokens_details.cached_tokens`. If cached tokens are not read, they are
  priced at the full input rate — an over-estimate (honest as a ceiling, but the audit would
  say `cacheReadTokens: 0` when it was not). Measure on the first paid round.

Sources: [z.ai pricing](https://docs.z.ai/guides/overview/pricing), [z.ai two base URLs](https://www.layer3labs.io/guides/z-ai-api),
[DeepSeek pricing](https://deepseek.ai/pricing), [DeepSeek Sep-2026 rates](https://benchlm.ai/deepseek/api-pricing),
[Qwen Model Studio pricing](https://benchlm.ai/alibaba/api-pricing), [Kimi pricing](https://benchlm.ai/moonshot/api-pricing),
[Kimi K2.5 on OpenRouter](https://openrouter.ai/moonshotai/kimi-k2.5), [MiniMax pricing](https://costbench.com/software/llm-api-providers/minimax-api/),
[synthetic.new API overview](https://dev.synthetic.new/docs/api/overview), [synthetic.new models](https://dev.synthetic.new/docs/api/models).
