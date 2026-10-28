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
  [`2026-09-08-bare-agent-asks.md`](../logs/2026-09-08-bare-agent-asks.md)** (hamr's word via barelo,
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

- **barebrowse · link URLs and load status on a page read** (asked 2026-10-27, asked, POC first,
  unsigned). Two asks: (a) link lines in the page read carry their absolute URL (href); (b) after a
  load, the final URL and the HTTP status. *Use:* the tickets-as-input idea (PRD, "Next, not
  scheduled: tickets as an input and a trigger") must tell new tickets from seen ones and open them
  (needs (a)), and tell a broken list page from an empty one and spot an expired login (needs (b)).
  *Declined workaround:* page JS through the escape hatch — that is a site-shaped scraper inside
  fwdloop. *barebrowse's own answer (0.25.0):* link lines have no hrefs or stable ids; `goto()`
  rejects only on a load timeout; there is no login-state signal; `consent:false` covers
  never-click. Does not block anything built today.

- **bare-agent · an in-memory allow-list for the MCP bridge** (asked 2026-10-27 from F85; shape
  agreed with the bare-agent session the same day; waits on hamr's OK to build, then bare-agent
  POCs on the real github-mcp-server; opt-in minor, 0.53.0). One option,
  `createMCPBridge({ configPaths, allow: { github: ['list_issues','issue_read'] }, confirmServer, callTimeout })`:
  - in memory only: never reads or writes `.mcp-bridge.json`, no TTL/refresh; the server command
    comes only from configPaths discovery; only servers named in `allow` are spawned;
  - exposed = signed ∩ what the server lists; anything else is absent (a server update cannot
    widen it);
  - `bridge.denied = []` and no Restricted section in `systemContext`: the model is never told
    other tools exist;
  - a signed tool the server does not list is returned in `bridge.missing = [{server, tool}]` (a
    field, not a throw); fwdloop refuses the job at preflight at $0, naming it;
  - a listed-but-not-allowed name via `mcp_invoke` throws ToolError "<name> is not on this run's
    allowed list", context `{denied:true, server, tool}`; a truly unknown name keeps
    `unknown tool`;
  - no stdout in allow mode (the connect `console.log` is skipped; stderr warnings stay;
    `confirmServer` passed by us removes the unvetted-spawn warning);
  - every mode: a tools/call timeout throws ToolError with context
    `{timeout:true, server, tool, timeoutMs}`, and the server's stderr tail moves out of the
    message into `context.stderr` (a model-facing string never carries raw server stderr).
    `callTimeout` already exists (default 120000 ms). Limit: on timeout the bridge stops waiting
    but does not cancel the call on the server.
  - without `allow`, behaviour is byte-identical to today.
  - *Status 2026-10-27: the "waits on hamr's OK" above is stale. `allow` shipped in bare-agent 0.53.0; annotations, `listServerTools` and pagination in 0.54.0; spawn errors and no args in logs in 0.54.1, validated by the F88 reruns.*

  *Why:* F85 (docs/logs/FINDINGS.md) on 0.52.0: new tools are merged in as allow on refresh/TTL
  (exposed 1 → 3); denied tools are still named with descriptions to the model; denied and unknown
  give the same refusal; the allow list lives in a file the bridge rewrites, and the main connect
  spawns the command/args/env read from that cache file (found by the bare-agent session: whoever
  can write the file chooses what runs). *fwdloop's use:* bulk mode (`bridge.tools`) plus bareguard
  `tools.allowlist` by tool name as a second lock (works today).

- **bareguard · a rubric rule "any of these words, on word edges"** (asked 2026-10-28, asked,
  waiting). A NEW rule on a text field: passes when any signed phrase appears on word edges,
  case-insensitive; when none is found, a typed gap naming the phrases, distinct from
  missing-field and wrong-type. `mustCarry`, `carries()` and the presence decide `{phrases}` stay
  unchanged, so no signed spec moves. *Why:* F98 (2026-10-28): `mustCarry` is a case-insensitive
  substring (`hang` matched change/unchanged/changing: 3 of 10 false runs on real tickets) and
  all-of (one rubric per keyword was needed). Used by the M12 ticket keyword guardrail; hamr's
  ruling: a keyword miss is a listed skip with "Run it anyway". *Who:* hamr chose option A,
  2026-10-28; sent to the `guard` session the same day. guard had replied earlier that day: not
  planned, no branch (main d111db8 = 0.27.0), and changing `mustCarry` itself would tighten signed
  specs, so a new rule was chosen. *Status:* blocks only M12's keyword guardrail; the labels part
  does not wait. fwdloop validates with pre-registered POCs on guard's branch before release and on
  the installed package after.

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