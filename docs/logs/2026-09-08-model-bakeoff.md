# Model bake-off — M0 baseline selection (2026-09-08)

Continuation of the M0 go/no-go POC (`docs/product/PRD.md` §11 P10: "the model is chosen
last, by the suite"). Branch `m0-poc`. hamr's ruling that triggered this: "if glm is flaky,
why don't you keep trying other models and settle on what works and measure against? we
can't keep changing models just because you can, we need to achieve a baseline." This is
not a re-litigation of F2–F5 (GLM-5.2/Kimi-K3 both proved the grounding mechanism works,
2026-09-08 M0 run) — it is the baseline-selection step the PRD always intended: pick ONE
model on evidence, and record the numbers everything later is measured against.

## Method

- **Identical job for every model, no per-model prompt tuning.** Every candidate ran the
  exact same three model rounds `poc/m0/runner.mjs` already uses for the CLEAN run (plant
  d): `derive1` (customer match) → `derive2` (invoices/total/earliest-due/overdue-count) →
  `compose` (the reply) — same system prompts, same tool schemas, same citation grammar,
  same fixtures (`fixtures/ar-aging.csv` + `fixtures/message.txt`), `businessDate`
  `2026-06-01`, `maxTokens` 16000, `timeoutMs` 300000 per round. The `ask`/`send` steps ran
  too (they're mechanical, zero LLM calls, cheaper to leave wired into `runDeclaration`
  than to fork it) but are not part of what's measured — the final "ok to send?" ask was
  pre-answered with `accept` before each run started so the run never blocks on a human.
- **N = 3 runs per model, sequential** (synthetic.new allows 1 concurrent request per
  model). Flakiness is the thing being measured; one success proves nothing.
- **New file, `poc/m0/bakeoff.mjs`**, drives `runDeclaration` (imported unmodified from
  `runner.mjs` — no change to the runner's logic, prompts, or close rules) across the 9
  live candidates from `GET /openai/v1/models` on synthetic.new (checked same day; the two
  `:vision` aliases skipped, no vision in this job): `hf:zai-org/GLM-5.2`,
  `hf:zai-org/GLM-5.3-Flash`, `hf:zai-org/GLM-4.7-Flash`, `hf:moonshotai/Kimi-K3`,
  `hf:Qwen/Qwen3.8-27B`, `hf:openai/gpt-oss-120b`,
  `hf:nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4`, `syn:large:text`, `syn:small:text`.
  Per-run metrics are read back from `poc/m0/out/spend.jsonl` (the same authoritative
  ledger the runner already writes, diffed by run) — not asserted separately.
- **Abort rule**: running total (spend.jsonl, including the estimated ceiling row from
  Task 0) > $2 aborts the sweep. Never triggered — total after all 27 runs + 3 plant
  confirmations: **$0.131940894** (`estimatedPortion` unchanged at $0.036526, the one
  pre-existing ceiling row from before this bake-off), 0.03% of the $2 threshold and 2.6%
  of the $5 global cap.
- **A close red from a genuine model mistake counts against that model, not as a bug** —
  none of the runner/close code changed during this bake-off. A model that cannot produce
  a valid tool call at all (`StopAndReportError`, "finished twice with no tool call") is
  reported as `stop-and-report`, a legitimate result, not coached into passing.

## Rates — which are published, which are ceilings

`poc/m0/spend.mjs`'s `RATES_BY_SUFFIX` (all USD/1K tokens):

| model | in | out | source |
|---|---|---|---|
| zai-org/GLM-5.2 | 0.0006 | 0.0022 | published (existing, synthetic.new pricing page) |
| moonshotai/Kimi-K3 | 0.0006 | 0.0025 | published (existing, synthetic.new pricing page) |
| zai-org/GLM-5.3-Flash | 0.00015 | 0.0005 | published (Zhipu list price, $0.15/$0.50 per 1M) |
| zai-org/GLM-4.7-Flash | 0.00006 | 0.0004 | published (Zhipu list price, $0.06/$0.40 per 1M) |
| Qwen/Qwen3.8-27B | 0.00015 | 0.002 | published (OpenRouter list, $0.15/$2.00 per 1M) |
| openai/gpt-oss-120b | 0.00003 | 0.00017 | published (OpenRouter list, $0.03/$0.17 per 1M) |
| nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4 | 0.000085 | 0.0004 | published (OpenRouter list, $0.085/$0.40 per 1M; base variant, NVFP4 quant not separately listed) |
| syn:large:text | 0.0006 | 0.0025 | **ceiling** — no published per-token rate found for this synthetic.new alias (synthetic.new itself is subscription-priced, not per-token); ceilinged at the highest rate already in the table (Kimi-K3's) |
| syn:small:text | 0.0006 | 0.0025 | **ceiling** — same, no published rate found |

Real synthetic.new billing is subscription-flat per their own pricing page (confirmed live
this session), so every `$` figure below is a **list-rate ceiling estimate**, same
methodology as the existing GLM-5.2/Kimi-K3 rows (F2) — comparable across models, not a
claim about what synthetic.new actually billed.

## Bake-off table (N=3 each, plant d / clean run only)

| Model | Green | Provider errors | Truncations | `stop-and-report` | Mean $/run | Median $/run | Mean wall/run | Median wall/run | Tool called 1st try |
|---|---|---|---|---|---|---|---|---|---|
| **openai/gpt-oss-120b** | **3/3** | 0 | 0 | 0 | **$0.000175** | $0.000186 | **22,995 ms** | 23,248 ms | 9/9 |
| Qwen/Qwen3.8-27B | 3/3 | 0 | 0 | 0 | $0.001789 | $0.001865 | 30,510 ms | 29,661 ms | 9/9 |
| zai-org/GLM-5.2 | 3/3 | 0 | 0 | 0 | $0.004191 | $0.003439 | 103,260 ms | 107,403 ms | 9/9 |
| zai-org/GLM-5.3-Flash | 2/3 | 0 | 0 | 0 | $0.000707 | $0.000756 | 63,208 ms | 76,691 ms | 7/7 |
| moonshotai/Kimi-K3 | 2/3 | 0 | 0 | 0 | $0.002028 | $0.001835 | 35,348 ms | 30,401 ms | 8/8 |
| syn:large:text | 1/3 | 0 | 0 | 0 | $0.002406 | $0.002929 | 47,776 ms | 43,817 ms | 6/6 |
| zai-org/GLM-4.7-Flash | 1/3 | 0 | 0 | 0 | $0.000273 | $0.000226 | 35,286 ms | 26,410 ms | 7/7 |
| nvidia/NVIDIA-Nemotron-3-Super-120B-A12B-NVFP4 | 1/3 | 0 | 0 | 2 | $0.000718 | $0.000470 | 32,555 ms | 30,919 ms | 6/6 |
| syn:small:text | 0/3 | 0 | 0 | 2 | $0.000719 | $0.000363 | 21,771 ms | 20,889 ms | 4/4 |

`stop-and-report` = a FINISHED round with no tool call twice in a row on the same step
(runner.mjs's `StopAndReportError`) — the model could not produce the citation tool call at
all, a legitimate result per the brief, not coached into passing. Zero provider-side errors
(502/503/524/ETIMEDOUT) and zero truncations (`stopReason: 'max_tokens'`) across all 81
model rounds — a contrast with the original M0 run, where GLM-5.2 hit two genuine
524/ETIMEDOUT failures on `derive2` (F2/F5). Every red reported above is a genuine
close/grounding failure — the exact string is in `poc/m0/out/bakeoff-results.json`.

Notable failure strings (the systematic pattern, not per-model quirks): three of the four
weakest models (`GLM-4.7-Flash`, `syn:large:text`, `syn:small:text`) failed the SAME way —
`daysBetween` computed with the sign flipped (`8 ≠ daysBetween(...) = -8`), i.e. the model
subtracted `businessDate - dueDate` instead of `dueDate - businessDate` (or vice versa) for
an overdue invoice. Neither model in the top 3 (gpt-oss-120b, Qwen3.8-27B, GLM-5.2) ever
made this mistake in 9 rounds each. This reads as a genuine reasoning-capability cliff on a
specific arithmetic direction, not noise — worth carrying forward as a known failure
signature if a smaller/cheaper model is ever reconsidered.

## Plant confirmation — the winner (gpt-oss-120b)

Best completion record was a 3-way tie at 3/3 (GLM-5.2, Qwen3.8-27B, gpt-oss-120b), all
with 0 provider errors — tie-break fell to wall time, then $, both won by gpt-oss-120b.
Ran plants (a)/(b)/(c) against it exactly as `runner.mjs` already does (same fixtures,
same close, same prompts):

| plant | outcome | exact red / result |
|---|---|---|
| (a) wrong-total | 🟢 red, caught first try | `total_owed 5850 ≠ sum(E2,E3) = 5700` |
| (b) wrong-cell | 🟢 red, caught first try | `c1 4300 ≠ cell E2 = 4200` |
| (c) ambiguous | 🟢 red, correct landing | `derive1` green, correctly cited both `Northwind Trading` and `Northwind Supplies`, routed to `ask`; `ask expired` is the PASS outcome (nobody answers plant (c) by design) |

3/3 plants caught, all first try, no retries, no provider errors — matches the shape of
the exact GLM-5.2/Kimi-K3 plant runs in the original M0 session (F5,
`docs/logs/2026-09-08-m0-run.md`). The winner did not fail any plant; no finding to report
here beyond "it passed."

## RULING

**Baseline model: `hf:openai/gpt-oss-120b`.** Best completion record (3/3, tied with
GLM-5.2 and Qwen3.8-27B), zero provider errors, zero truncations, tool called on the first
try every round (9/9), cheapest ($0.000175 mean/run — list-rate ceiling, not a subscription
bill) and fastest (22,995 ms mean/run) of the three 3/3 finishers, and it caught all three
plants clean on the first confirmation pass.

**Second model (PRD §11 P10's two-provider rule): `hf:Qwen/Qwen3.8-27B`.** Also 3/3, zero
provider errors, next-best on the same tie-break ordering (30,510 ms mean/run,
$0.001789 mean/run), and a different lab (Alibaba, vs. gpt-oss-120b's OpenAI-open-weight
lineage) — genuine provider diversity, not two SKUs of the same underlying model.

**Numbers that become the M0 baseline everything later is measured against** (plant-d
clean run, gpt-oss-120b, N=3):
- **Completion rate: 3/3 (100%)**
- **$/run: $0.000175 mean, $0.000186 median** (list-rate ceiling; real synthetic.new
  billing is subscription-flat, so this is a comparability figure, not a bill)
- **Wall/run: 22,995 ms mean, 23,248 ms median**
- Provider errors: 0/9 rounds. Truncations: 0/9 rounds. Tool called first try: 9/9 rounds.

GLM-5.2, the prior "primary" from the research-doc ruling (F2), is demoted to a
third-choice fallback here: it matched the top two on completion rate but cost **~24x**
more and ran **~4.5x** slower per run than the new baseline for the identical job — reason
enough on its own to not keep it as primary once measured against alternatives, independent
of its earlier flakiness (F5's two provider 524/ETIMEDOUT failures, not reproduced by any
model in this session).

## Anything surprising

- **Zero provider-side failures across 81 model rounds and 9 models**, in sharp contrast to
  the original M0 session where GLM-5.2 hit two consecutive genuine transport failures on
  the exact same step shape (F5). Either synthetic.new's reliability varies day to day, or
  the earlier failures really were GLM-5.2/`derive2`-specific — this bake-off can't
  distinguish those without more days of data, but it's evidence the 300s `timeoutMs` bound
  added after F5 was never exercised this session.
- **The most expensive, slowest model (GLM-5.2) was not the most reliable one** — it tied
  for best completion rate but lost badly on both cost and latency once a real comparison
  set existed. hamr's instinct ("if glm is flaky... settle on what works and measure
  against") was right to distrust a single research-doc ruling; the bake-off shows GLM-5.2
  wasn't even flaky this time, it was just expensive.
- **The daysBetween sign-flip failure mode** (see table notes) recurred identically across
  three unrelated models/labs (Zhipu's Flash tier, and both `syn:` generic aliases) — a
  shared blind spot in how weaker/smaller models resolve "days overdue" direction from the
  prompt's businessDate-implicit phrasing, not a fluke.
- **The two smallest models were the ONLY ones to produce `stop-and-report`** (Nemotron and
  `syn:small:text`, 2/3 each) rather than a close-caught red — i.e., they couldn't reliably
  produce the tool call shape at all, a more basic failure than a wrong number. `syn:small:text`
  never went green once in 3 runs (0/3).
- **`syn:large:text` and `syn:small:text` are genuinely un-priced by synthetic.new itself**
  (subscription billing, confirmed live on their pricing page this session) — every dollar
  figure for those two rows in this report is a ceiling estimate borrowed from Kimi-K3's
  rate, not a real cost signal. If either alias is ever reconsidered, get a real quote first.

## Files

- `/home/hamr/PycharmProjects/fwdloop/poc/m0/bakeoff.mjs` — the bake-off driver (new; imports
  `runDeclaration` from `runner.mjs` unmodified)
- `/home/hamr/PycharmProjects/fwdloop/poc/m0/spend.mjs` — extended rate table (Task 0 + Task 1)
- `/home/hamr/PycharmProjects/fwdloop/poc/m0/out/spend.jsonl` — full ledger, including this
  session's 27 bake-off runs + 3 winner-plant-confirmation runs (tracked in git)
- `/home/hamr/PycharmProjects/fwdloop/poc/m0/out/bakeoff-results.json` — per-run structured
  results (gitignored; the table above is derived from it)
- `/home/hamr/PycharmProjects/fwdloop/docs/logs/2026-09-08-model-bakeoff.md` — this file
