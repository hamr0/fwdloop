// borrowed-from: bareloop src/mcpsources.js@v0.61.0 (fc56e1f3)
// borrowed-from: fwdloop src/mcp-sources.js@6cdc01e (CONFIG-LOOKUP core only: no routes, no UI, no `check tools` - the Settings > MCP tab and its routes come in R3)
// Where bareloop's MCP servers come from, decided in ONE place. Sources, in order: the 4 places bare-agent reads, then the paths the person added
// (config.json `mcpPaths`, absolute, in the order added). A project folder's `.mcp.json` is never read: every path here is explicit, bare-agent's default
// discovery is never called. bare-agent's `discoverServers` is called once PER PATH (it merges silently and keeps no file of origin); the merge, "first
// wins" and the shadow mark are done here. A server with no `command` (a remote one) is listed and marked `remote`: it is never started. This file only
// READS config files and returns names, flags and file paths; a command, its args and its env are never copied out of `discoverServers`' result.
import { discoverServers } from 'bare-agent/mcp';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { readConfig } from './config.js';

export { mcpPathProblem } from './config.js';

/** the 4 places bare-agent reads, in its order (absolute) @returns {string[]} */
export const DEFAULT_MCP_PLACES = (home = homedir()) => {
  const h = home;
  return [join(h, '.mcp.json'), join(h, '.claude', 'mcp_servers.json'), join(h, '.config', 'Claude', 'claude_desktop_config.json'), join(h, '.cursor', 'mcp.json')];
};

/** a path as the person sees it: the home folder written `~` @param {string} p @param {string} [home] the person's home folder (tests inject a fixture one) */
export const showMcpPath = (p, home = homedir()) => { const h = home; return p === h ? '~' : p.startsWith(`${h}/`) ? `~${p.slice(h.length)}` : p; };

/** a typed path with a leading `~` or `~/` written out (the config stores absolute paths only) @param {string} p @param {string} [home] */
export const expandMcpPath = (p, home = homedir()) => (p === '~' ? home : p.startsWith('~/') ? join(home, p.slice(2)) : p);

/**
 * The added paths in config.json; none when the file is missing, and a plain-words `problem` when it cannot be read (never papered over).
 * @param {string} [home] the config home (tests); undefined = `~/.config/bareloop`
 * @returns {{ paths: string[], problem: string|null }}
 */
export function addedMcpPaths(home) {
  const r = readConfig(home === undefined ? {} : { home });
  if (r.problem) return { paths: [], problem: 'Your settings file (config.json) cannot be read, so added MCP paths are not used.' };
  return { paths: Array.isArray(r.config.mcpPaths) ? /** @type {string[]} */ (r.config.mcpPaths) : [], problem: null };
}

/**
 * Every place, in order, with the servers found in it.
 * `status`: 'found' (a readable file), 'missing' (no file) or 'not-json' (a file that is not JSON; bare-agent skips it silently).
 * A server: `{name, remote, shadowedBy}`; `shadowedBy` is the shown path of the earlier place that has the same name (the earlier one wins), or null.
 * @param {{ home?: string, mcpHome?: string }} [o] `home` the config home (tests); `mcpHome` the person's home folder the four places live under
 *   (tests inject a fixture one so discovery never reads the real `~`; undefined = `os.homedir()`)
 * @returns {{ places: Array<{ path: string, file: string, added: boolean, status: 'found'|'missing'|'not-json', servers: Array<{name: string, remote: boolean, shadowedBy: string|null}> }>, problem: string|null }}
 */
export function mcpSources(o = {}) {
  const added = addedMcpPaths(o.home);
  const typed = [...DEFAULT_MCP_PLACES(o.mcpHome).map((p) => ({ path: showMcpPath(p, o.mcpHome), file: p, added: false })), ...added.paths.map((p) => ({ path: showMcpPath(p, o.mcpHome), file: p, added: true }))];
  /** @type {Map<string, string>} */
  const first = new Map();
  const places = typed.map(({ path, file, added: isAdded }) => {
    if (!existsSync(file)) return { path, file, added: isAdded, status: /** @type {const} */ ('missing'), servers: [] };
    try { JSON.parse(readFileSync(file, 'utf8')); } catch { return { path, file, added: isAdded, status: /** @type {const} */ ('not-json'), servers: [] }; }
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
 * Every place bareloop starts an MCP from takes its config file from here.
 * @param {string} server @param {{ home?: string, mcpHome?: string }} [o]
 * @returns {{ file: string, remote: boolean } | null}
 */
export function mcpConfigFor(server, o = {}) {
  for (const p of mcpSources(o).places) {
    const s = p.servers.find((x) => x.name === server);
    if (s) return { file: p.file, remote: s.remote };
  }
  return null;
}
