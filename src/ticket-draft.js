// M12 piece 3 (docs/wiki/the-module-ladder.md, "M12 scope (restart)" item 4): what the DRAFTER is told about a ticket role, and what it may suggest.
// A ticket role is a signed page input (`source <role> = page:<address>`) whose address is a GitHub issues list: it is never fetched at draft (one ticket is read
// per run through the job's MCP tools). The drafter may SUGGEST the job's `mcp`/`mcpTools` (issue_read) and a `ticketFilter` (priority / label names); a human
// signs it and code decides at run. The first facts line is F90c's, the line that made the drafter read a ticket role at all (FINDINGS F90c, F92).
import { discoverServers } from 'bare-agent/mcp';
import { LIST_URL, USER_MCP_CONFIG } from './ticket-mcp.js';

/** the one tool the first slice reads a ticket with */
export const TICKET_TOOL = 'issue_read';

/** is this signed input address a GitHub issues list (a ticket role), not a page to fetch? @param {unknown} url */
export const isTicketListUrl = (url) => LIST_URL.test(String(url).trim());

/** the signed page sources that are ticket roles @param {Array<{kind?: string, role: string, path: string}>} sources */
export const ticketSourcesOf = (sources) => (sources ?? []).filter((s) => s.kind === 'page' && isTicketListUrl(s.path));

/** the server names in the user's own `~/.mcp.json` (what the drafter may name); none when the file is missing or unreadable @param {string} [configPath] @returns {string[]} */
export function userMcpServers(configPath = USER_MCP_CONFIG()) {
  try { return [...discoverServers([configPath]).keys()]; } catch { return []; }
}

/**
 * The lines under "Inputs" for one ticket role. The first is F90c's, word for word; the rest tell the drafter the two optional fields it may suggest.
 * @param {string} role @param {string[]} servers @returns {string[]}
 */
export function ticketFactsLines(role, servers) {
  return [
    `- ${role}: one ticket's text (a signed input, already frozen at run start; read it by listing "${role}" in a step's reads, do not fetch it)`,
    `  The ticket is read through the job's MCP tool "${TICKET_TOOL}" (read-only). Declare the top-level "mcp": {"server": one of ${servers.join(', ')}, "tools": ["${TICKET_TOOL}"]} and put "${TICKET_TOOL}" in "mcpTools" of the step that reads "${role}"; no other step gets it.`,
    '  You may SUGGEST a top-level "ticketFilter": {"priority": [P0 to P3 values], "labels": [label names]} ONLY for a guardrail that names a priority or a label (for example "priority P2 only", "only issues labelled bug"); leave it out for any other guardrail, which stays hitl. A human signs it and code decides at run; never invent a label.',
    '  You may SUGGEST a top-level "ticketWatch": ["state", "labels"] (one or both) ONLY for a guardrail that says to run a ticket again when its state or its labels change. Any other thing to watch cannot be put there: leave it out and it stays hitl.',
  ];
}

/** the schema parts a job with a ticket role adds: top-level `mcp` and `ticketFilter`, per-step `mcpTools` @param {string[]} servers */
export function ticketSchemaParts(servers) {
  return {
    top: {
      mcp: {
        type: 'object',
        properties: { server: { type: 'string', enum: servers }, tools: { type: 'array', items: { type: 'string', enum: [TICKET_TOOL] } } },
        required: ['server', 'tools'],
        additionalProperties: false,
        description: `the MCP server (from the person's ~/.mcp.json) and the tools the job uses: ["${TICKET_TOOL}"]`,
      },
      ticketFilter: {
        type: 'object',
        properties: {
          priority: { type: 'array', items: { type: 'string', enum: ['P0', 'P1', 'P2', 'P3'] }, description: 'priorities a ticket must have; only when a guardrail names them' },
          labels: { type: 'array', items: { type: 'string' }, description: 'label names, one of which a ticket must carry; only when a guardrail names them' },
        },
        additionalProperties: false,
        description: 'optional: suggest only for a guardrail that names a priority or a label',
      },
      ticketWatch: { type: 'array', items: { type: 'string', enum: ['state', 'labels'] }, description: 'optional: suggest only for a guardrail that says to run a ticket again when its state or its labels change' },
    },
    step: { mcpTools: { type: 'array', items: { type: 'string', enum: [TICKET_TOOL] }, description: `["${TICKET_TOOL}"] on the step that reads the ticket; omit on every other step` } },
  };
}

/**
 * Reds a draft with a ticket role must not pass with: no `mcp`, a server the person's config does not have, or no step that reads the ticket and holds the tool.
 * @param {Record<string, any>} declaration @param {Array<{role: string}>} ticketSources @param {string[]} servers @returns {string[]}
 */
export function ticketReds(declaration, ticketSources, servers) {
  const reds = [];
  const roles = ticketSources.map((s) => s.role);
  if (!declaration.mcp) return [`declaration: the job reads the ticket input "${roles[0]}" but lists no "mcp" server and tools`];
  if (!servers.includes(declaration.mcp.server)) reds.push(`declaration: mcp.server "${declaration.mcp.server}" is not a server in your ~/.mcp.json (${servers.join(', ')})`);
  const reader = (declaration.steps ?? []).some((st) => (st.mcpTools ?? []).includes(TICKET_TOOL) && (st.reads ?? []).some((r) => roles.includes(r)));
  if (!reader) reds.push(`declaration: no step reads "${roles[0]}" and lists "${TICKET_TOOL}" in mcpTools`);
  return reds;
}
