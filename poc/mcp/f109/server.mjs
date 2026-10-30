// F109 tiny stdio MCP server. At start writes the sorted NAMES of its env variables (no values) to $F109_OUT.
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
writeFileSync(process.env.F109_OUT_FILE, JSON.stringify(Object.keys(process.env).sort()));
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
createInterface({ input: process.stdin }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'f109', version: '0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'env_names', description: 'env names', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } });
  else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ok' }] } });
});
