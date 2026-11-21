// borrowed-from: bareloop src/ticketmcp.js@v0.61.0 (fc56e1f3)
// borrowed-from: fwdloop src/ticket-mcp.js@9650320 (adapted: redactSecrets from src/validate.js, the one inventory; server lookup from src/mcpsources.js)
// Read ONE ticket through the person's own MCP server, nothing else (bareloop MCP+tickets piece 1, ITEM33-BUILD addendum 2026-11-02).
// The tool source is the user's `~/.mcp.json` (an explicit path; a repo's .mcp.json is never read). The bridge starts ONLY the server the job names, with
// `allow` = exactly the job's tools, so any other tool does not exist for the run. M13 item 3: a hint (`readOnlyHint`) is info only; no tool is refused for lacking one.
// Every refusal names its real cause (F101), at $0; none ever reads as empty content (F103). Proven by F100 (a ticket as a frozen input), F101, F103.
// Borrowed shape: fwdloop poc/mcp/f100/scratch.diff (`src/ticket-mcp.js`), re-shaped: job-typed tools, explicit config, the three causes kept apart.
import { createMCPBridge, discoverServers } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactSecrets } from './validate.js';
import { parseTicketList, isTicketNumber, TICKET_NUMBER_WORDS } from './ticketshape.js';
import { mcpConfigFor } from './mcpsources.js';

/** M13 item 9.5: the only parent env names an MCP gets (plus its own settings); the one list for every place bareloop starts an MCP, so no provider key reaches it */
export const MCP_PASS_ENV = ['PATH', 'HOME'];

/** how long a bridge waits to start and for one call (ms): the one number for the ticket read and a plan step's bridge */
export const MCP_TIMEOUT_MS = 90000;

/** the name bare-agent's bridge gives a server's tool: `<server>_<tool>` (the one spelling: the ticket read, a step's worker menu, the gate allowlist) @param {string} server @param {string} tool */
export const mcpToolName = (server, tool) => `${server}_${tool}`;

/** M13 design point 11 (F118): the one start option set for every place bareloop starts an MCP: no provider key (passEnv) and the home folder as the start folder (bare-agent bridge `cwd`; no `~` expansion, so the real path) */
export const mcpStartOpts = () => ({ passEnv: MCP_PASS_ENV, cwd: homedir() });

/** the refusal for a failed bridge start: a bad home folder (bare-agent throws ValidationError before any spawn) says so plainly, any other cause keeps its own first line */
export const startRefusal = (/** @type {string} */ server, /** @type {any} */ e) => `${server} did not start: ${e?.name === 'ValidationError' ? `the home folder could not be used (${firstLine(e)})` : firstLine(e)}`;

/** the user's own `~/.mcp.json`: the config a caller that finds the server in no place falls back to (a server found nowhere then reads "not in ~/.mcp.json") */
export const USER_MCP_CONFIG = () => join(homedir(), '.mcp.json');

/**
 * M13 piece 3: the config file a server starts from. An explicit path (a test seam) wins; otherwise the file of the WINNING place for `server` (src/mcp-sources.js,
 * the one decider), or `~/.mcp.json` when no place has it. `remote` true = the winner has no start command (listed, not usable).
 * @param {string} server @param {string} [explicit] @param {string} [home] the config home (tests) @returns {{ file: string, remote: boolean }}
 */
export function configForServer(server, explicit, home) {
  if (explicit) return { file: explicit, remote: false };
  return mcpConfigFor(server, home === undefined ? {} : { home }) ?? { file: USER_MCP_CONFIG(), remote: false };
}

/** the refusal for a remote server (no start command), at $0 @param {string} server */
export const remoteRefusal = (server) => `${server} is a remote server, not supported yet`;

/** the first line of a message, secrets redacted, clipped: all a refusal ever shows of a server's own error */
export const firstLine = (e) => redactSecrets(String(e?.message ?? e ?? '')).split('\n').find((l) => l.trim() !== '')?.trim().slice(0, 200) ?? 'no message';

/** GitHub's MCP server answers a request with this text, not data, when it has no usable login (F100, F103: seen with a cold `pass` cache) */
export const isDeviceLogin = (text) => text.includes('github.com/login/device');

/**
 * The one tool name a PR read uses. Like `issue_read`, it is the only PR tool name hardcoded: the rest of a job's tools come from the server's own list. The limit, said
 * plainly (ITEM33-BUILD piece 1a, PR-verification job): this is GitHub's own server's spelling, measured against the real server 2026-11-04 (`pull_request_read`, method
 * `get`, args owner/repo/pullNumber); a server that spells it differently is not read, and the person's GitHub server must enable the `pull_requests` toolset.
 */
export const PR_READ_TOOL = 'pull_request_read';

/** the tool and the arguments one read of a list's kind makes @param {'issue'|'pull'} kind @param {string} owner @param {string} repo @param {number} number */
export function readCall(kind, owner, repo, number) {
  return kind === 'pull'
    ? { tool: PR_READ_TOOL, args: { method: 'get', owner, repo, pullNumber: number }, what: 'a pull request' }
    : { tool: 'issue_read', args: { method: 'get', owner, repo, issue_number: number }, what: 'a ticket' };
}

/**
 * Read ticket (or pull request) `number` of the list at `listUrl` with the job's `issue_read` (an issues list) or `pull_request_read` (a pulls list).
 * @param {{listUrl: string, number: number, mcp: {server: string, tools: string[]}, configPath?: string, home?: string, timeoutMs?: number}} o
 * @returns {Promise<{ok: true, text: string, url: string, record: {server: string, exposed: string[], missing: Array<{server: string, tool: string}>, calls: Array<Record<string, any>>}} | {ok: false, error: string}>}
 *   `record` is what the run keeps (in its `run.json` input entry): what the server exposed and lacked, and each call made.
 */
export async function readTicketMcp({ listUrl, number, mcp, configPath: explicitConfig, home, timeoutMs = MCP_TIMEOUT_MS }) {
  const list = parseTicketList(listUrl);
  if (!list.ok) return list;
  if (!isTicketNumber(number)) return { ok: false, error: `ticket number ${JSON.stringify(number)} is not ${TICKET_NUMBER_WORDS}` };
  const { owner, repo } = list;
  const { server, tools } = mcp;
  const { tool: toolId, args, what } = readCall(list.kind, owner, repo, number);
  // M13 piece 4: the frozen read starts the server with the one read tool alone, whatever else the job lists (the job lists every tool of its server)
  if (!tools.includes(toolId)) return { ok: false, error: `the job does not list ${toolId}, the tool that reads ${what}` };
  const { file: configPath, remote } = configForServer(server, explicitConfig, home);
  if (!discoverServers([configPath]).has(server)) return { ok: false, error: `${server} is not in ~/.mcp.json` };
  if (remote) return { ok: false, error: remoteRefusal(server) };
  const notOffered = `${server} does not offer ${toolId}${list.kind === 'pull' ? ' (its GitHub server needs the pull_requests toolset enabled)' : ''}`;
  let bridge;
  try {
    bridge = await createMCPBridge({ configPaths: [configPath], ...mcpStartOpts(), timeout: timeoutMs, callTimeout: timeoutMs, confirmServer: () => true, allow: { [server]: [toolId] } });
    const failed = bridge.errors.find((e) => e.server === server);
    if (failed) return { ok: false, error: `${server} did not start: ${firstLine(failed.error)}` };
    const lacking = bridge.missing?.[0];
    if (lacking) return { ok: false, error: notOffered };
    const tool = bridge.tools.find((t) => t.name === mcpToolName(server, toolId));
    if (!tool) return { ok: false, error: notOffered };
    const call = { tool: toolId, owner, repo, ...(list.kind === 'pull' ? { method: 'get', pullNumber: number } : { issue_number: number }) };
    const record = { server, exposed: bridge.tools.map((t) => t.name), missing: bridge.missing ?? [], calls: [call] };
    const url = list.ticketUrl(number);
    let reply;
    try {
      reply = await tool.execute(args);
    } catch (e) {
      return { ok: false, error: `${server}: ${toolId} failed: ${firstLine(e)}` };
    }
    const text = typeof reply === 'string' ? reply : (Array.isArray(reply) ? reply : []).map((c) => c?.text ?? '').join('');
    if (isDeviceLogin(text)) return { ok: false, error: 'GitHub token unavailable — the server asked for a login (is pass locked?)' };
    if (text.trim() === '') return { ok: false, error: `${server}: ${toolId} returned nothing for ${url}` };
    return { ok: true, text, url, record };
  } catch (e) {
    return { ok: false, error: startRefusal(server, e) };
  } finally {
    try { await bridge?.close(); } catch { /* already closed */ }
  }
}
