// M12 piece 3 (docs/wiki/the-module-ladder.md, "M12 scope (restart)" item 4): what the DRAFTER is told about a ticket role, and what it may suggest.
// A ticket role is a signed page input (`source <role> = page:<address>`) whose address is a GitHub issues list: it is never fetched at draft (one ticket is read
// per run through the job's MCP tools). The drafter may SUGGEST the job's `mcp`/`mcpTools` (issue_read), and MUST add a `ticketFilter` (priority / label names) when a guardrail names a priority or a label; a human
// signs it and code decides at run. The first facts line is F90c's, the line that made the drafter read a ticket role at all (FINDINGS F90c, F92).
import { discoverServers } from 'bare-agent/mcp';
import { startableMcpServers } from './mcp-sources.js';
import { LIST_URL } from './ticket-shape.js';

/** the one tool the first slice reads a ticket with */
export const TICKET_TOOL = 'issue_read';

/** is this signed input address a GitHub issues list (a ticket role), not a page to fetch? @param {unknown} url */
export const isTicketListUrl = (url) => LIST_URL.test(String(url).trim());

/** the signed page sources that are ticket roles @param {Array<{kind?: string, role: string, path: string}>} sources */
export const ticketSourcesOf = (sources) => (sources ?? []).filter((s) => s.kind === 'page' && isTicketListUrl(s.path));

/** the startable server names across the MCP sources (src/mcp-sources.js), or in one explicit file (what the drafter may name); none when the file is missing or unreadable @param {string} [configPath] @returns {string[]} */
export function userMcpServers(configPath) {
  try { return configPath ? [...discoverServers([configPath]).keys()] : startableMcpServers(); } catch { return []; }
}

/**
 * The lines under "Inputs" for one ticket role (M13 piece 4: flow type Tickets). The first is F90c's, word for word. The ticket is already frozen under its role and the job's own
 * tools (`issue_read` to read it, `list_issues` to look for new ones) belong to the job, so no step needs them; a step lists a tool only if it calls it live.
 * @param {string} role @returns {string[]}
 */
export function ticketFactsLines(role) {
  return [
    `- ${role}: one ticket's text (a signed input, already frozen at run start; read it by listing "${role}" in a step's reads, do not fetch it)`,
    `  A step that reads "${role}" still lists "read" in its primitives: the ticket is frozen, but reading it is a grant.`,
    `  Flow type: Tickets. The ticket is already frozen under "${role}" by the job's own tools ("${TICKET_TOOL}" reads it, "${LOOK_TOOL}" looks for new ones); no step needs them. A step lists a tool in "mcpTools" ONLY if that step calls the tool live; leave "mcpTools" out of every other step. The job's server and tool list are set by the program, not by you.`,
    '  When a guardrail names a priority or a label (for example "priority P1 only", "only tickets with priority P1 count", "only issues labelled bug"), you MUST add a top-level "ticketFilter": {"priority": [P0 to P3 values], "labels": [label names]} for it; leave it out only when no guardrail names a priority or a label, and such a guardrail stays hitl. A human signs it and code decides at run; never invent a label.',
    '  You may SUGGEST a top-level "ticketWatch": ["state", "labels"] (one or both) ONLY for a guardrail that says to run a ticket again when its state or its labels change. Any other thing to watch cannot be put there: leave it out and it stays hitl.',
  ];
}

/** the lines for a generic MCP job: the server, its tool names (so the drafter can grant them to steps), and the rule that a step lists a tool only if it calls it live @param {string} server @param {string[]} tools @returns {string[]} */
export function mcpFactsLines(server, tools) {
  return [
    `- Flow type: MCP (generic). The job's MCP server is "${server}" and its tools are: ${tools.join(', ')}. The job's server and tool list are set by the program, not by you.`,
    '  A step lists a tool in "mcpTools" ONLY if that step calls the tool live, using the exact tool name above; at least one step must list at least one tool. Leave "mcpTools" out of every other step.',
  ];
}

/** the one tool a Tickets job looks for new tickets with (src/panel/authortrigger.js) */
export const LOOK_TOOL = 'list_issues';

/**
 * The schema parts a job with an MCP adds (M13 piece 4): per-step `mcpTools` (an enum of the job's tool names) for MCP (generic) and Tickets, and for Tickets the top-level
 * `ticketFilter` and `ticketWatch`. The job's own `mcp` block and `flowType` are NOT offered: code sets them.
 * @param {{flowType: 'mcp'|'tickets', tools: string[]}} o
 */
export function ticketSchemaParts({ flowType, tools }) {
  const step = { mcpTools: { type: 'array', items: { type: 'string', enum: tools }, description: 'the MCP tools this step calls LIVE (exact names); omit on every step that calls none' } };
  if (flowType !== 'tickets') return { top: {}, step };
  return {
    top: {
      ticketFilter: {
        type: 'object',
        properties: {
          priority: { type: 'array', items: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, description: 'priorities a ticket must have; only when a guardrail names them' },
          labels: { type: 'array', items: { type: 'string' }, description: 'label names, one of which a ticket must carry; only when a guardrail names them' },
        },
        additionalProperties: false,
        description: 'required when a guardrail names a priority or a label: put those values here; leave it out only when no guardrail names one',
      },
      ticketWatch: { type: 'array', items: { type: 'string', enum: ['state', 'labels'] }, description: 'optional: suggest only for a guardrail that says to run a ticket again when its state or its labels change' },
    },
    step,
  };
}

/**
 * M13 piece 4: the $0 refusals before any provider call. Tickets needs a ticket-list Inputs line; MCP (generic) and Tickets need a server that is startable and a tool list from a
 * check (`pick`, src/mcp-pick.js: `{ok, server, tools}` or `{ok:false, say}`).
 * @param {{flowType: string, ticketSources: Array<{role: string}>, pick: any, servers: string[]}} o @returns {string[]}
 */
export function ticketReds({ flowType, ticketSources, pick, servers }) {
  if (flowType === 'plain') return [];
  if (flowType === 'tickets' && ticketSources.length === 0) return ['Tickets needs the ticket list address as an Inputs line (for example issues: https://github.com/owner/repo/issues)'];
  if (!pick || pick.ok !== true) return [String(pick?.say ?? 'press check tools in Settings > MCP first')];
  if (!servers.includes(pick.server)) return [`the MCP "${pick.server}" is not a server fwdloop can start (${servers.join(', ') || 'none found'})`];
  return [];
}
