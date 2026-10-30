// F96 helper: argument schema of the issue tools via the bridge (no secrets).
import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os';
const b = await createMCPBridge({ configPaths: [homedir() + '/.mcp.json'], timeout: 90000, callTimeout: 90000, allow: { github: ['issue_read', 'list_issues'] } });
console.log(Object.keys(b.tools[0]));
for (const t of b.tools) console.log(t.name, JSON.stringify(t.parameters || t.inputSchema).slice(0, 1800));
await b.close();
