// F115 (a), $0, no model call. Names and counts only; never prints env, commands, keys.
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createMCPBridge, listServerTools } from 'bare-agent/mcp';
import { findUnusedMcpTool } from '../../../src/canrun.js';
import { readTicketMcp, firstLine } from '../../../src/ticket-mcp.js';

const cfg = join(homedir(), '.claude.json');
const server = 'litectx';
const tools = await listServerTools({ server, configPaths: [cfg], confirmServer: () => true, timeout: 15000 });
console.log('litectx tools:', tools.map((t) => `${t.name}:${t.annotations?.readOnlyHint ?? 'absent'}`).join(','));

const decl = { mcp: { server, tools: ['recall'] }, steps: [{ goal: 'g', mcpTools: ['recall'] }] };
console.log('(a1) findUnusedMcpTool (preflight):', JSON.stringify(findUnusedMcpTool(decl)));

const r = await readTicketMcp({ listUrl: 'https://github.com/o/r/issues', number: 1, mcp: decl.mcp, configPath: cfg, timeoutMs: 15000 });
console.log('(a2) readTicketMcp with the generic job tools:', JSON.stringify(r));
const r2 = await readTicketMcp({ listUrl: 'https://github.com/o/r/issues', number: 1, mcp: { server, tools: ['issue_read', 'recall'] }, configPath: cfg, timeoutMs: 15000 });
console.log('(a3) readTicketMcp with issue_read listed:', JSON.stringify(r2));

// (a4) the same loop as src/ticket-mcp.js:40-42 on the bridge of tools [recall]
let bridge;
try {
  bridge = await createMCPBridge({ configPaths: [cfg], timeout: 15000, callTimeout: 15000, confirmServer: () => true, allow: { [server]: ['recall'] } });
  const prefix = `${server}_`;
  for (const t of bridge.tools) if (t.annotations?.readOnlyHint !== true) { console.log('(a4) gate text:', `${server} does not mark ${t.name.slice(prefix.length)} read-only (readOnlyHint is not true)`); break; }
} catch (e) { console.log('(a4) bridge error:', firstLine(e)); } finally { try { await bridge?.close(); } catch {} }
