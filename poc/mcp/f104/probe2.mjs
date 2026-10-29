import { createMCPBridge } from 'bare-agent/mcp';
import { homedir } from 'node:os';
const b = await createMCPBridge({ configPaths: [homedir() + '/.mcp.json'], timeout: 90000, callTimeout: 90000, confirmServer: () => true, allow: { github: ['list_issues'] } });
const t = b.tools.find((x) => x.name === 'github_list_issues');
const r = await t.execute({ owner: 'microsoft', repo: 'vscode', orderBy: 'CREATED_AT', direction: 'DESC', perPage: 2, fields: ['number','state','labels','updated_at','comments','title'] });
console.log(JSON.stringify(r).slice(0, 1200));
await b.close(); process.exit(0);
