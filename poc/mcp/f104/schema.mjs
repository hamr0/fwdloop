import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os';
const b = await createMCPBridge({ configPaths: [homedir() + '/.mcp.json'], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['list_issues'] } });
const t = b.tools.find((x) => x.name === 'github_list_issues');
console.log(JSON.stringify(t?.parameters ?? t?.inputSchema ?? Object.keys(t || {})));
const r = await t.execute({ owner: 'microsoft', repo: 'vscode', state: 'ALL', orderBy: 'CREATED_AT', direction: 'DESC', perPage: 2 });
console.log(JSON.stringify(r).slice(0, 1500));
await b.close(); process.exit(0);
