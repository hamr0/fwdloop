// M12 piece 1b/1c (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 1-3, 11): read ONE ticket through the user's own MCP server, nothing else.
// The tool source is the user's `~/.mcp.json` (an explicit path; a repo's .mcp.json is never read). The bridge starts ONLY the server the job names, with
// `allow` = exactly the job's tools, so any other tool does not exist for the run. M13 item 3: a hint (`readOnlyHint`) is info only; no tool is refused for lacking one.
// Every refusal names its real cause (F101), at $0; none ever reads as empty content (F103). Proven by F100 (a ticket as a frozen input), F101, F103.
// Borrowed shape: fwdloop poc/mcp/f100/scratch.diff (`src/ticket-mcp.js`), re-shaped: job-typed tools, explicit config, the three causes kept apart.
import { createMCPBridge, discoverServers } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactSecrets } from './redact.js';
import { parseTicketList, isTicketNumber, TICKET_NUMBER_WORDS } from './ticket-shape.js';
import { mcpConfigFor } from './mcp-sources.js';

/** M13 item 9.5: the only parent env names an MCP gets (plus its own settings); the one list for every place fwdloop starts an MCP, so no provider key reaches it */
export const MCP_PASS_ENV = ['PATH', 'HOME'];

/** M13 design point 11 (F118): the one start option set for every place fwdloop starts an MCP: no provider key (passEnv) and the home folder as the start folder (bare-agent bridge `cwd`; no `~` expansion, so the real path) */
export const mcpStartOpts = () => ({ passEnv: MCP_PASS_ENV, cwd: homedir() });

/** the refusal for a failed bridge start: a bad home folder (bare-agent throws ValidationError before any spawn) says so plainly, any other cause keeps its own first line */
export const startRefusal = (/** @type {string} */ server, /** @type {any} */ e) => `${server} did not start: ${e?.name === 'ValidationError' ? `the home folder could not be used (${firstLine(e)})` : firstLine(e)}`;

/** the user's own `~/.mcp.json`: the config a caller that names no place falls back to (a server found nowhere then reads "not in ~/.mcp.json") */
export const USER_MCP_CONFIG = () => join(homedir(), '.mcp.json');

/**
 * M13 piece 3: the config file a server starts from. An explicit path (a test seam) wins; otherwise the file of the WINNING place for `server` (src/mcp-sources.js,
 * the one decider), or `~/.mcp.json` when no place has it. `remote` true = the winner has no start command (listed, not usable).
 * @param {string} server @param {string} [explicit] @returns {{ file: string, remote: boolean }}
 */
export function configForServer(server, explicit) {
  if (explicit) return { file: explicit, remote: false };
  return mcpConfigFor(server) ?? { file: USER_MCP_CONFIG(), remote: false };
}

/** the refusal for a remote server (no start command), at $0 @param {string} server */
export const remoteRefusal = (server) => `${server} is a remote server, not supported yet`;

/** the first line of a message, secrets redacted, clipped: all a refusal ever shows of a server's own error */
export const firstLine = (e) => redactSecrets(String(e?.message ?? e ?? '')).split('\n').find((l) => l.trim() !== '')?.trim().slice(0, 200) ?? 'no message';

/** GitHub's MCP server answers a request with this text, not data, when it has no usable login (F100, F103: seen with a cold `pass` cache) */
export const isDeviceLogin = (text) => text.includes('github.com/login/device');

/**
 * Read ticket `number` of the list at `listUrl` with the job's `issue_read`.
 * @param {{listUrl: string, number: number, mcp: {server: string, tools: string[]}, configPath?: string, timeoutMs?: number}} o
 * @returns {Promise<{ok: true, text: string, url: string, record: {server: string, exposed: string[], missing: Array<{server: string, tool: string}>, calls: Array<{tool: string, owner: string, repo: string, issue_number: number}>}} | {ok: false, error: string}>}
 *   `record` is what the run keeps (in its `run.json` input entry): what the server exposed and lacked, and each call made.
 */
export async function readTicketMcp({ listUrl, number, mcp, configPath: explicitConfig, timeoutMs = 90000 }) {
  const list = parseTicketList(listUrl);
  if (!list.ok) return list;
  if (!isTicketNumber(number)) return { ok: false, error: `ticket number ${JSON.stringify(number)} is not ${TICKET_NUMBER_WORDS}` };
  const { owner, repo } = list;
  const { server, tools } = mcp;
  // M13 piece 4: the frozen read starts the server with issue_read alone, whatever else the job lists (the job lists every tool of its server)
  if (!tools.includes('issue_read')) return { ok: false, error: `the job does not list issue_read, the tool that reads a ticket` };
  const { file: configPath, remote } = configForServer(server, explicitConfig);
  if (!discoverServers([configPath]).has(server)) return { ok: false, error: `${server} is not in ~/.mcp.json` };
  if (remote) return { ok: false, error: remoteRefusal(server) };
  let bridge;
  try {
    bridge = await createMCPBridge({ configPaths: [configPath], ...mcpStartOpts(), timeout: timeoutMs, callTimeout: timeoutMs, confirmServer: () => true, allow: { [server]: ['issue_read'] } });
    const failed = bridge.errors.find((e) => e.server === server);
    if (failed) return { ok: false, error: `${server} did not start: ${firstLine(failed.error)}` };
    const lacking = bridge.missing?.[0];
    if (lacking) return { ok: false, error: `${server} does not offer ${lacking.tool}` };
    const prefix = `${server}_`;
    const tool = bridge.tools.find((t) => t.name === `${prefix}issue_read`);
    if (!tool) return { ok: false, error: `${server} does not offer issue_read` };
    const call = { tool: 'issue_read', owner, repo, issue_number: number };
    const record = { server, exposed: bridge.tools.map((t) => t.name), missing: bridge.missing ?? [], calls: [call] };
    const url = list.ticketUrl(number);
    let reply;
    try {
      reply = await tool.execute({ method: 'get', owner, repo, issue_number: number });
    } catch (e) {
      return { ok: false, error: `${server}: issue_read failed: ${firstLine(e)}` };
    }
    const text = typeof reply === 'string' ? reply : (Array.isArray(reply) ? reply : []).map((c) => c?.text ?? '').join('');
    if (isDeviceLogin(text)) return { ok: false, error: 'GitHub token unavailable — the server asked for a login (is pass locked?)' };
    if (text.trim() === '') return { ok: false, error: `${server}: issue_read returned nothing for ${url}` };
    return { ok: true, text, url, record };
  } catch (e) {
    return { ok: false, error: startRefusal(server, e) };
  } finally {
    try { await bridge?.close(); } catch { /* already closed */ }
  }
}
