// A tiny fake MCP server for the M12 piece 1 tests (stdio, newline JSON-RPC). No network. Behaviour comes from the env its .mcp.json entry sets:
//   FAKE_TOOLS  JSON list of {name, annotations?}   (default: issue_read + list_issues, both readOnlyHint true)
//   FAKE_REPLY  'ok' (default) | 'device' (GitHub's device-login text) | 'empty' | 'error'
//   FAKE_CALLS  a file path; each tools/call appends one JSON line {name, arguments}
import { appendFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const tools = JSON.parse(process.env.FAKE_TOOLS ?? JSON.stringify([
  { name: 'issue_read', annotations: { readOnlyHint: true } }, { name: 'list_issues', annotations: { readOnlyHint: true } },
]));
const reply = process.env.FAKE_REPLY ?? 'ok';
const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } });
  if (m.method === 'tools/list') return send(m.id, { tools: tools.map((t) => ({ ...t, inputSchema: { type: 'object', properties: {} } })) });
  if (m.method === 'tools/call') {
    if (process.env.FAKE_CALLS) appendFileSync(process.env.FAKE_CALLS, `${JSON.stringify({ name: m.params.name, arguments: m.params.arguments })}\n`);
    if (reply === 'device') return send(m.id, { content: [{ type: 'text', text: 'Visit https://github.com/login/device and enter the code AAAA-BBBB to authorize the GitHub MCP Server.\n\nAfter authorizing, retry your request.' }] });
    if (reply === 'empty') return send(m.id, { content: [] });
    if (reply === 'error') return send(m.id, { isError: true, content: [{ type: 'text', text: 'Could not resolve to a Repository\nsecond line' }] });
    return send(m.id, { content: [{ type: 'text', text: `{"number":${m.params.arguments.issue_number},"title":"Crash on tap","state":"open","body":"Tap the back arrow","labels":[{"name":"P2"}]}` }] });
  }
  return undefined;
});
