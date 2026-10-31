// M13 piece 3 (hamr 2026-10-31): the log of `check tools` presses, `mcp-checks.jsonl` beside config.json. APPEND-ONLY: each press appends one line, nothing is ever rewritten
// or removed. A line is `{server, path, at, ok, tools:[{name, hint}]}` or `{server, path, at, ok:false, error}`. The page shows the newest line per path and server.
// A torn or foreign line is skipped when reading, so a half-written last line never hides the earlier ones.
import { appendFileSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { configHome } from './config.js';

export const MCP_CHECKS_FILE = 'mcp-checks.jsonl';

/** @param {string|undefined} home the config home */
export const mcpChecksFile = (home) => join(configHome(home), MCP_CHECKS_FILE);

/** append ONE line; throws when it cannot be written @param {string|undefined} home @param {Record<string, any>} entry */
export function appendMcpCheck(home, entry) {
  mkdirSync(configHome(home), { recursive: true, mode: 0o700 });
  appendFileSync(mcpChecksFile(home), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
}

/** the newest line per `path\tserver` @param {string|undefined} home @returns {Map<string, any>} */
export function newestMcpChecks(home) {
  const out = new Map();
  let text = '';
  try { text = readFileSync(mcpChecksFile(home), 'utf8'); } catch { return out; }
  for (const line of text.split('\n')) {
    let r;
    try { r = JSON.parse(line); } catch { continue; }
    if (typeof r?.server !== 'string' || typeof r?.path !== 'string' || typeof r?.at !== 'string') continue;
    out.set(`${r.path}\t${r.server}`, r);
  }
  return out;
}
