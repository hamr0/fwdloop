// F118 fake stdio MCP server. At start writes process.cwd() to $F118_OUT_FILE; tool `where` returns it. Exits on stdin close.
import { writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
writeFileSync(process.env.F118_OUT_FILE, JSON.stringify({ cwd: process.cwd(), canary: 'F118_CANARY' in process.env }));
const send = (o) => process.stdout.write(JSON.stringify(o) + '\n');
const rl = createInterface({ input: process.stdin });
rl.on('close', () => process.exit(0));
rl.on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') send({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'f118', version: '0' } } });
  else if (m.method === 'tools/list') send({ jsonrpc: '2.0', id: m.id, result: { tools: [{ name: 'where', description: 'cwd', inputSchema: { type: 'object', properties: {} }, annotations: { readOnlyHint: true } }] } });
  else send({ jsonrpc: '2.0', id: m.id, result: { content: [{ type: 'text', text: 'CWD=' + process.cwd() + ';CANARY=' + ('F118_CANARY' in process.env) }] } });
});
