// A tiny fake MCP server for the M12 piece 3 tests (stdio, newline JSON-RPC). No network. `issue_read` answers with the env FAKE_ISSUE text, as is.
import { createInterface } from 'node:readline';

// `node --test` runs every .mjs under test/ as a test file; without this it would sit on stdin forever. The spawner's .mcp.json env sets FAKE_MCP_SERVER=1.
if (process.env.FAKE_MCP_SERVER !== '1') process.exit(0);

const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } });
  if (m.method === 'tools/list') return send(m.id, { tools: [{ name: 'issue_read', annotations: { readOnlyHint: true }, inputSchema: { type: 'object', properties: {} } }] });
  if (m.method === 'tools/call') return send(m.id, { content: [{ type: 'text', text: process.env.FAKE_ISSUE ?? '{}' }] });
  return undefined;
});
