// A tiny fake MCP server for the M13 start-folder tests (stdio, newline JSON-RPC). At start it writes its own working folder to $CWD_OUT.
// `node --test` runs every .mjs under test/; without CWD_OUT it exits at once. It exits when stdin closes (readline ends, nothing else keeps it alive).
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

if (!process.env.CWD_OUT) process.exit(0);
writeFileSync(process.env.CWD_OUT, process.cwd());
const send = (id, result) => process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
const ro = { readOnlyHint: true };
createInterface({ input: process.stdin }).on('line', (line) => {
  const m = JSON.parse(line);
  if (m.method === 'initialize') return send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'fake', version: '0' } });
  if (m.method === 'tools/list') return send(m.id, { tools: ['issue_read', 'list_issues'].map((name) => ({ name, annotations: ro, inputSchema: { type: 'object', properties: {} } })) });
  if (m.method === 'tools/call') return send(m.id, { content: [{ type: 'text', text: '{}' }] });
  return undefined;
});
