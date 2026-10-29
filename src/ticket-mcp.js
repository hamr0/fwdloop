// M12 piece 1b/1c (docs/wiki/the-module-ladder.md, "M12 scope (restart)" items 1-3, 11): read ONE ticket through the user's own MCP server, nothing else.
// The tool source is the user's `~/.mcp.json` (an explicit path; a repo's .mcp.json is never read). The bridge starts ONLY the server the job names, with
// `allow` = exactly the job's tools, so any other tool does not exist for the run. A tool the server does not mark `readOnlyHint: true` is refused by name.
// Every refusal names its real cause (F101), at $0; none ever reads as empty content (F103). Proven by F100 (a ticket as a frozen input), F101, F103.
// Borrowed shape: fwdloop poc/mcp/f100/scratch.diff (`src/ticket-mcp.js`), re-shaped: job-typed tools, explicit config, the three causes kept apart.
import { createMCPBridge, discoverServers } from 'bare-agent/mcp';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { redactSecrets } from './redact.js';

/** the user's own MCP config, the only source of a tool */
export const USER_MCP_CONFIG = () => join(homedir(), '.mcp.json');

export const LIST_URL = /^https:\/\/github\.com\/([^/\s]+)\/([^/\s]+)\/issues\/?$/;

/** the first line of a message, secrets redacted, clipped: all a refusal ever shows of a server's own error */
export const firstLine = (e) => redactSecrets(String(e?.message ?? e ?? '')).split('\n').find((l) => l.trim() !== '')?.trim().slice(0, 200) ?? 'no message';

/** GitHub's MCP server answers a request with this text, not data, when it has no usable login (F100, F103: seen with a cold `pass` cache) */
export const isDeviceLogin = (text) => text.includes('github.com/login/device');

/**
 * Read ticket `number` of the list at `listUrl` (`https://github.com/<owner>/<repo>/issues`) with the job's `issue_read`.
 * @param {{listUrl: string, number: number, mcp: {server: string, tools: string[]}, configPath?: string, timeoutMs?: number}} o
 * @returns {Promise<{ok: true, text: string, url: string, record: {server: string, exposed: string[], missing: Array<{server: string, tool: string}>, calls: Array<{tool: string, owner: string, repo: string, issue_number: number}>}} | {ok: false, error: string}>}
 *   `record` is what the run keeps (in its `run.json` input entry): what the server exposed and lacked, and each call made.
 */
export async function readTicketMcp({ listUrl, number, mcp, configPath = USER_MCP_CONFIG(), timeoutMs = 90000 }) {
  const m = LIST_URL.exec(String(listUrl).trim());
  if (!m) return { ok: false, error: `${listUrl} is not a GitHub issues address (https://github.com/<owner>/<repo>/issues)` };
  if (!Number.isInteger(number) || number < 1) return { ok: false, error: `ticket number ${JSON.stringify(number)} is not a whole number from 1` };
  const [, owner, repo] = m;
  const { server, tools } = mcp;
  if (!tools.includes('issue_read')) return { ok: false, error: `the job does not list issue_read, the tool that reads a ticket` };
  if (!discoverServers([configPath]).has(server)) return { ok: false, error: `${server} is not in ~/.mcp.json` };
  let bridge;
  try {
    bridge = await createMCPBridge({ configPaths: [configPath], timeout: timeoutMs, callTimeout: timeoutMs, confirmServer: () => true, allow: { [server]: tools } });
    const failed = bridge.errors.find((e) => e.server === server);
    if (failed) return { ok: false, error: `${server} did not start: ${firstLine(failed.error)}` };
    const lacking = bridge.missing?.[0];
    if (lacking) return { ok: false, error: `${server} does not offer ${lacking.tool}` };
    const prefix = `${server}_`;
    for (const t of bridge.tools) {
      if (t.annotations?.readOnlyHint !== true) return { ok: false, error: `${server} does not mark ${t.name.slice(prefix.length)} read-only (readOnlyHint is not true)` };
    }
    const tool = bridge.tools.find((t) => t.name === `${prefix}issue_read`);
    if (!tool) return { ok: false, error: `${server} does not offer issue_read` };
    const call = { tool: 'issue_read', owner, repo, issue_number: number };
    const record = { server, exposed: bridge.tools.map((t) => t.name), missing: bridge.missing ?? [], calls: [call] };
    const url = `https://github.com/${owner}/${repo}/issues/${number}`;
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
    return { ok: false, error: `${server} did not start: ${firstLine(e)}` };
  } finally {
    try { await bridge?.close(); } catch { /* already closed */ }
  }
}
