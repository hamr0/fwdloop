// F111 tiny stdio MCP server. At start writes env NAMES (sorted) and sha256 of two named values to $F111_OUT_FILE. Never values.
import { writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createInterface } from 'node:readline';
const h = (v) => (v === undefined ? null : createHash('sha256').update(v).digest('hex'));
writeFileSync(process.env.F111_OUT_FILE, JSON.stringify({ names: Object.keys(process.env).sort(), resolved: h(process.env.F111_RESOLVED), clash: h(process.env.F111_CLASH) }));
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
createInterface({ input: process.stdin }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'f111', version: '0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'env_names', description: 'env names', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } });
  else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'ok' }] } });
});
