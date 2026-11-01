// F119: appends one line per start of this MCP server process to F119_STARTS, then becomes the repo's fake stdio server.
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.F119_STARTS, `${JSON.stringify({ pid: process.pid, at: Date.now() })}\n`);
await import(process.env.F119_FAKE);
