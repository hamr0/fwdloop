// F116 step 0, $0: which word does litectx recall return something for? Prints lengths and the first 300 chars of a result (litectx content, not a secret).
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMCPBridge } from 'bare-agent/mcp';
const b = await createMCPBridge({ configPaths: [join(homedir(), '.claude.json')], timeout: 15000, callTimeout: 20000, confirmServer: () => true, allow: { litectx: ['recall'] } });
try {
  const t = b.tools.find((x) => x.name === 'litectx_recall');
  console.log('tool', t.name, 'params', JSON.stringify(t.parameters));
  for (const q of ['fwdloop', 'bareguard', 'test', 'f111b', 'litectx', 'memory']) {
    const r = await t.execute({ query: q });
    const s = typeof r === 'string' ? r : JSON.stringify(r);
    console.log(q, 'len', s.length, s.slice(0, 300).replace(/\n/g, ' '));
  }
} finally { await b.close(); }
