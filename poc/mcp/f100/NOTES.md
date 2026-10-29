# F100 notes (scratch reader + $0 checks + draft; before hamr's sign)
Scratch: /tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/4bec273e-ed6e-489e-af3a-f8155c50cf10/scratchpad/f100/s (git archive HEAD + scratch.diff).
Form chosen: `guardrail: source issue = ticket:https://github.com/flutter/flutter/issues/100047` (F92's ticket kind, address = the issue URL; the reader parses owner/repo/number and calls MCP issue_read instead of fetching the page).
Change: F92's parser/facts/read-role edits, plus new src/ticket-mcp.js (bridge, allow {github:[issue_read]}, explicit ~/.mcp.json) and freezePage taking the MCP reader for ticket roles. Each MCP call logged to <runDir>/mcp-calls.jsonl (exposed tools, missing, the call) = the C6/C7 record (scratch-only extra file).
$0 checks (2026-10-29): issue flutter#100047 state=open, updated 2026-08-17, body 2837 chars, labels c: crash, p: material_ui, package, P2, team-design, triaged-design. Bridge exposed [github_issue_read], missing []. list_issues via mcp_invoke refused: ToolError `mcp_invoke: "github_list_issues" is not on this run's allowed list`.
Body sentence for C2: "Tap the back arrow and the `show bottom sheet` button at the same time".
Scratch tests (declaration, input-facts, m10-am3 page/run-door, m10-am11, signed-text): 279 pass, 0 fail.
Note: first bridge start showed a one-off GitHub device-login text instead of data; the immediate retry worked (no change made).
Draft (1 call, deepseek-flash, thinking off, 1 round, no retry): ok, reds [], cost $0.0025128 (spend.jsonl row = draft-spend.json). Step 1 reads `issue`, grants read only; plan reads the ticket; asks line 3 ttl 30m; hash abfeb5c2162acc1c558813f71304424fe9a46a0380fc28dd008dd08d5a14df92. No token pattern in draft folder.
