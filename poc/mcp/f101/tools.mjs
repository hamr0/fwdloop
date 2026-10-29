import { createMCPBridge } from 'bare-agent/mcp';
const b = await createMCPBridge({ configPaths: [process.env.HOME + '/.mcp.json'], timeout: 60000, confirmServer: () => true });
console.log(JSON.stringify(b.tools.map(t => t.name)), JSON.stringify(b.missing));
await b.close();
