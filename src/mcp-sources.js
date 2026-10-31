// M13 piece 3 (docs/wiki/the-module-ladder.md, M13 scope items 1 and 2): the ONE place that decides where fwdloop's MCP servers come from.
// Sources, in order: the 4 places bare-agent reads, then the paths the person added on Settings > MCP (config.json `mcpPaths`, in the order added).
// A project folder's `.mcp.json` is never read: every path here is explicit, bare-agent's default discovery is never called (F108 c).
// bare-agent's `discoverServers` is called once PER PATH (it merges silently and keeps no file of origin, F108 a); the merge, "first wins" and the shadow mark are done here.
// A server with no `command` (a remote one) is listed and marked `remote`: it is never started. This file only READS the config files and
// returns names, flags and file paths; a command, its args and its env are never copied out of `discoverServers`' result.
import { discoverServers } from 'bare-agent/mcp';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig, configDoorHome, ConfigError } from './config.js';

export { mcpPathProblem } from './config.js';

/** the 4 places bare-agent reads, in its order (absolute) */
export const DEFAULT_MCP_PLACES = () => {
  const h = homedir();
  return [join(h, '.mcp.json'), join(h, '.claude', 'mcp_servers.json'), join(h, '.config', 'Claude', 'claude_desktop_config.json'), join(h, '.cursor', 'mcp.json')];
};

/** a typed path as a real one: `~/` is the home folder @param {string} p */
export const expandMcpPath = (p) => (p === '~' ? homedir() : p.startsWith('~/') ? join(homedir(), p.slice(2)) : p);

/** a path as the page shows it: the home folder written `~` @param {string} p */
export const showMcpPath = (p) => { const h = homedir(); return p === h ? '~' : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p; };

/** the added paths in config.json (typed form); none under a test process with no config home, or when config.json is broken (the page says so) @param {string} [home] */
export function addedMcpPaths(home) {
  let h = home;
  if (h === undefined) { const door = configDoorHome(); if (door.skip) return { paths: [], problem: null }; h = door.home; }
  try {
    const c = readConfig({ home: h });
    return { paths: Array.isArray(c.mcpPaths) ? /** @type {string[]} */ (c.mcpPaths) : [], problem: null };
  } catch (e) {
    if (!(e instanceof ConfigError)) throw e;
    return { paths: [], problem: 'Your settings file (config.json) cannot be read, so added paths are not shown.' };
  }
}

/**
 * Every place, in order, with the servers found in it.
 * `status`: 'found' (a readable file), 'missing' (no file) or 'unreadable' (a file that is not JSON; bare-agent skips it silently).
 * A server: `{name, remote, shadowedBy}`; `shadowedBy` is the shown path of the earlier place that has the same name (the earlier one wins), or null.
 * @param {{ home?: string }} [o] `home` the config home (tests); undefined = the door's
 * @returns {{ places: Array<{ path: string, file: string, added: boolean, status: 'found'|'missing'|'unreadable', servers: Array<{name: string, remote: boolean, shadowedBy: string|null}> }>, problem: string|null }}
 */
export function mcpSources(o = {}) {
  const added = addedMcpPaths(o.home);
  const typed = [...DEFAULT_MCP_PLACES().map((p) => ({ path: showMcpPath(p), added: false })), ...added.paths.map((p) => ({ path: p, added: true }))];
  /** @type {Map<string, string>} */
  const first = new Map();
  const places = typed.map(({ path, added: isAdded }) => {
    const file = expandMcpPath(path);
    if (!existsSync(file)) return { path, file, added: isAdded, status: /** @type {const} */ ('missing'), servers: [] };
    try { JSON.parse(readFileSync(file, 'utf8')); } catch { return { path, file, added: isAdded, status: /** @type {const} */ ('unreadable'), servers: [] }; }
    const found = discoverServers([file]);
    const servers = [...found].map(([name, def]) => {
      const shadowedBy = first.get(name) ?? null;
      if (shadowedBy === null) first.set(name, path);
      return { name, remote: typeof def?.command !== 'string' || def.command === '', shadowedBy };
    });
    return { path, file, added: isAdded, status: /** @type {const} */ ('found'), servers };
  });
  return { places, problem: added.problem };
}

/**
 * The file that holds the WINNING `server` (the first place in the list that has the name), whether it is remote, or null when no place has it.
 * Every place fwdloop starts an MCP from takes its config file from here.
 * @param {string} server @param {{ home?: string }} [o]
 * @returns {{ file: string, remote: boolean } | null}
 */
export function mcpConfigFor(server, o = {}) {
  for (const p of mcpSources(o).places) {
    const s = p.servers.find((x) => x.name === server);
    if (s) return { file: p.file, remote: s.remote };
  }
  return null;
}

/** the names of the servers that can be started (winners only, remote left out) @param {{ home?: string }} [o] @returns {string[]} */
export function startableMcpServers(o = {}) {
  return mcpSources(o).places.flatMap((p) => p.servers.filter((s) => !s.remote && s.shadowedBy === null).map((s) => s.name));
}
