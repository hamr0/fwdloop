// F112 stub: answers initialize, never answers tools/list.
import { createInterface } from 'node:readline';
const rl = createInterface({ input: process.stdin });
rl.on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.method === 'initialize') process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: m.id, result: { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '0' } } }) + '\n');
});
setInterval(() => {}, 1e6);
