// borrowed-from: bareloop src/ticketrepo.js@v0.61.0 (fc56e1f3)
// MCP + tickets piece 1a (ITEM33-BUILD addendum 2026-11-02, "Piece 1a"): a ticket for a deterministic (code-repo) job.
// The ticket is NOT a tracked repo file and must never reach the person's repo, so it lives OUTSIDE the tracked tree: a frozen file in the run's worktree under
// `.bareloop-input/<label>.txt`, hidden by git's PRIVATE exclude (the common dir's info/exclude, as installed `node_modules` is). The worker reads it (it sits inside
// readScope), cannot write it (no signed write fence can contain a folder that is not in the job's listing; see the gate test), and the close never reads or names it.
// This file: the $0 proof of the Inputs line, and the run-start freeze.
import { discoverServers } from 'bare-agent/mcp';
import { execFileSync } from 'node:child_process';
import { lstatSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseTicketList } from './ticketshape.js';
import { configForServer, remoteRefusal, readCall } from './ticketmcp.js';
import { readTicket, prRecordOfTicket } from './ticket.js';
import { hideTicketInput, TICKET_INPUT_DIR } from './worktree.js';

export { TICKET_INPUT_DIR };

/** the file a ticket line freezes to, relative to the worktree: the label made file-safe, the way a rubric input is named @param {string} label @returns {string} */
export function ticketInputRel(label) {
  const stem = label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'ticket';
  return `${TICKET_INPUT_DIR}/${stem}.txt`;
}

/**
 * The $0 proof of a repo job's ticket line: the job's server is named in the person's MCP config (a file is read; nothing is started), it is not a remote one,
 * and the read tool is among the tools the job signed: `issue_read` for an issues address, `pull_request_read` for a pulls address. The address itself parsed already.
 * @param {{server: string, tools: string[]}} mcp @param {{configPath?: string}} [deps] test seam @param {'issue'|'pull'} [kind]
 * @returns {{ok: true}|{ok: false, error: string}}
 */
export function proveTicketLine(mcp, deps = {}, kind = 'issue') {
  const { file, remote } = configForServer(mcp.server, deps.configPath);
  if (!discoverServers([file]).has(mcp.server)) return { ok: false, error: `${mcp.server} is not in ~/.mcp.json` };
  if (remote) return { ok: false, error: remoteRefusal(mcp.server) };
  const { tool, what } = readCall(kind, '', '', 1);
  if (!mcp.tools.includes(tool)) return { ok: false, error: `${tool}, the tool that reads ${what}, is not among the tools this job signed` };
  return { ok: true };
}

/**
 * The ONE ticket line of a repo job's Inputs: a line 2+ whose value is a GitHub issues or pulls address.
 * @param {{n: number, label: string, value: string}[]} inputs
 * @returns {{ok: true, line: {n: number, label: string, value: string}}|{ok: false, error: string}}
 */
export function repoTicketLine(inputs) {
  const lines = inputs.slice(1).filter((l) => parseTicketList(l.value).ok);
  if (lines.length === 0) return { ok: false, error: 'This job reads a ticket, but none of its Inputs (after the repo) is the issues or pulls page of a GitHub repository (owner/repo/issues or owner/repo/pulls).' };
  if (lines.length > 1) return { ok: false, error: 'This job reads one ticket, but more than one of its Inputs is a GitHub issues or pulls address.' };
  return { ok: true, line: lines[0] };
}

/**
 * @typedef {object} RepoTicketRecord what the spine's `job-start` keeps of a repo job's ticket: metadata only, never the text
 * @property {string} label @property {string} file the frozen file, relative to the worktree @property {string} url @property {number} number @property {string} title
 * @property {'open'|'closed'|'unknown'} state @property {'mcp'|'page'} source @property {string} sha256 of the masked bytes @property {number} bytes
 * @property {number} masked how many secret shapes were masked (a count, never the values)
 * @property {{server: string, exposed: string[], missing: Array<{server: string, tool: string}>, calls: Array<Record<string, any>>}|null} mcp
 */

/**
 * RUN START for a repo job that reads a ticket: read the ticket through the MCP, MASK it (before the sha), and write it to `<workdir>/.bareloop-input/<label>.txt`.
 * The folder is hidden through git's private exclude BEFORE the file exists, so the ticket is never a worker write and never in the final commit; it sits inside the
 * worker's readScope, and no write fence can contain it (a signed writeScope is a subfolder of the tracked listing). Nothing is committed and the seed does not move.
 * A refusal is plain words at $0 ("The run did not start. Nothing spent.") and writes nothing.
 * @param {{workdir: string, inputs: {n: number, label: string, value: string}[], ticket: {number: number, mcp: {server: string, tools: string[]}}}} o
 * A PULLS address reads the pull request the same way (`pull_request_read`) and also returns `pr` = `{url, record, reread}` for piece 12's run-start checkout: `record` is the
 * parsed MASKED reply (its `head.sha` is what the worktree is checked out at), `reread` reads it once more if the PR moved while the run was starting.
 * @returns {Promise<{ok: true, ticketText: string, record: RepoTicketRecord, pr?: {url: string, record: any, reread: () => Promise<any>}}|{ok: false, error: string}>}
 */
export async function freezeRepoTicket({ workdir, inputs, ticket }) {
  const tail = 'The run did not start. Nothing spent.';
  const found = repoTicketLine(inputs);
  if (!found.ok) return { ok: false, error: `${found.error} ${tail}` };
  const { line } = found;
  const fail = (/** @type {string} */ m) => ({ ok: /** @type {const} */ (false), error: `Input "${line.label}": ${m}. ${tail}` });
  const rel = ticketInputRel(line.label);
  // the folder name must be ours: a repo that tracks it (or links it out of the tree) would carry the write elsewhere
  let tracked = '';
  try { tracked = execFileSync('git', ['-C', workdir, 'ls-files', '--', TICKET_INPUT_DIR], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim(); } catch (e) { return fail(`git could not be read in ${workdir}: ${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]}`); }
  const dir = join(workdir, TICKET_INPUT_DIR);
  let st = null;
  try { st = lstatSync(dir); } catch { st = null; }
  if (tracked !== '' || (st !== null && !st.isDirectory())) return fail(`${TICKET_INPUT_DIR} is already in this repository, and bareloop keeps the ticket there - rename it, then start the run again`);
  const kind = /** @type {{kind: 'issue'|'pull'}} */ (parseTicketList(line.value)).kind;
  const proof = proveTicketLine(ticket.mcp, {}, kind);
  if (!proof.ok) return fail(proof.error);
  const t = await readTicket({ mcp: ticket.mcp, listUrl: line.value, number: ticket.number });
  if (!t.ok) return fail(t.error);
  try {
    hideTicketInput(workdir);
    mkdirSync(dir, { recursive: true });
    const file = join(workdir, rel);
    rmSync(file, { force: true }); // a leftover link or file from an earlier run of this worktree is replaced, never written through
    writeFileSync(file, t.ticket.text);
  } catch (e) { return fail(`the ticket could not be written (${String(/** @type {any} */ (e)?.message ?? e).split('\n')[0]})`); }
  const k = t.ticket;
  /** @type {{url: string, record: any, reread: () => Promise<any>}|undefined} */
  const pr = kind === 'pull' ? { url: k.url, record: prRecordOfTicket(k) ?? {}, reread: async () => { const again = await readTicket({ mcp: ticket.mcp, listUrl: line.value, number: ticket.number }); return again.ok ? prRecordOfTicket(again.ticket) : null; } } : undefined;
  return { ok: true, ticketText: k.text, ...(pr === undefined ? {} : { pr }), record: { label: line.label, file: rel, url: k.url, number: /** @type {number} */ (k.number), title: k.title, state: k.state, source: k.source, sha256: k.sha256, bytes: k.bytes, masked: k.masked, mcp: k.record } };
}
