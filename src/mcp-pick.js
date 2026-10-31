// M13 piece 4 (hamr ruling R1, 2026-10-31): the ONE place that decides the tools a job gets from its MCP. A job with an MCP gets ALL the tools of that MCP's newest OK line in
// `mcp-checks.jsonl` (src/mcp-checks.js), set by code: never chosen by the drafter, never reviewed by the person, and no server is ever started here (a server starts only on
// a press of `check tools`). A tool the server gains later is not in the job (signed item 3). Read-only; writes nothing.
import { newestOkMcpTools } from './mcp-checks.js';
import { mcpSources, mcpConfigFor } from './mcp-sources.js';
import { configDoorHome, configHome } from './config.js';
import { remoteRefusal } from './ticket-mcp.js';

/** the one refusal for an MCP nobody has checked (or whose check never succeeded) */
export const NEVER_CHECKED_SAY = 'press check tools in Settings > MCP first';

/**
 * @param {string} server @param {string|undefined|null} home the config home (a test seam; undefined or null = there is none, so the answer is "never checked")
 * @returns {{ ok: true, server: string, tools: string[] } | { ok: false, say: string }}
 */
export function mcpPickFor(server, home) {
  if (typeof home !== 'string') return { ok: false, say: NEVER_CHECKED_SAY };
  const place = mcpSources({ home }).places.find((p) => p.servers.some((s) => s.name === server));
  if (!place) return { ok: false, say: `${server} is not in any MCP config (Settings > MCP lists the ones found)` };
  if (mcpConfigFor(server, { home })?.remote) return { ok: false, say: remoteRefusal(server) };
  const tools = newestOkMcpTools(home, server, place.path);
  return tools === null ? { ok: false, say: NEVER_CHECKED_SAY } : { ok: true, server, tools };
}

/** `mcpPickFor` at the config home this process uses (a test process with no `FWDLOOP_CONFIG_HOME` has none) @param {string} server */
export function mcpPickHere(server) {
  const door = configDoorHome();
  return mcpPickFor(server, door.skip ? undefined : configHome(door.home));
}
