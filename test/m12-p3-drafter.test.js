// M12 piece 3 (item 4): the drafter is told the ticket role exists and may SUGGEST `mcp`/`mcpTools` (issue_read) and a `ticketFilter`; a human signs, code decides.
// $0: the fake provider of test/drafter-fixture.mjs, no network, no MCP server. Written red-first.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { draft, buildDeclarationSchema } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';
import { ticketFactsLines, isTicketListUrl, ticketReds } from '../src/ticket-draft.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

const PROSE = `1. Read the ticket and say what is broken,
   guardrail: priority P1 or P2 only
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source issues = page:https://github.com/flutter/flutter/issues
`;
const args = (over = {}) => ({
  steps: [
    { primitives: ['read'], reads: ['issues'], emits: 'ticket_note', fromLine: 1, close: { class: 'hitl' }, mcpTools: ['issue_read'] },
    { primitives: [], reads: ['ticket_note'], emits: 'ask_check', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['ask_check'], emits: 'written', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'hitl', 2: 'hitl' },
  unjudgeable: {},
  refused: [],
  mcp: { server: 'github', tools: ['issue_read'] },
  ticketFilter: { priority: ['P1', 'P2'] },
  ...over,
});
const run = (provider, extra = {}) => draft({
  proseText: PROSE, provider, rates: RATES, modelId: MODEL, mcpServers: ['github'], fetchPage: async () => { throw new Error('a ticket list was fetched at draft'); }, ...extra,
});

test('the drafter is told the ticket role exists (F90c line, word for word) and what it may suggest; nothing is fetched', async () => {
  const p = fakeProvider([toolReply(args())]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const system = p.calls[0].messages[0].content;
  assert.ok(system.includes('- issues: one ticket\'s text (a signed input, already frozen at run start; read it by listing "issues" in a step\'s reads, do not fetch it)'));
  for (const line of ticketFactsLines('issues', ['github'])) assert.ok(system.includes(line), line);
  assert.deepEqual(r.declaration.mcp, { server: 'github', tools: ['issue_read'] });
  assert.deepEqual(r.declaration.ticketFilter, { priority: ['P1', 'P2'] });
  assert.deepEqual(r.declaration.steps[0].mcpTools, ['issue_read']);
});

test('the forced tool offers mcp, ticketFilter and mcpTools only for a job with a ticket role; the server is an enum of the person\'s own', async () => {
  const p = fakeProvider([toolReply(args())]);
  await run(p, { mcpServers: ['github', 'tracker'] });
  const schema = p.calls[0].schemas[0];
  assert.deepEqual(schema.properties.mcp.properties.server.enum, ['github', 'tracker']);
  assert.deepEqual(schema.properties.mcp.properties.tools.items.enum, ['issue_read']);
  assert.deepEqual(schema.properties.ticketFilter.properties.priority.items.enum, ['P0', 'P1', 'P2', 'P3']);
  assert.ok(schema.properties.steps.items.properties.mcpTools);
  const plain = buildDeclarationSchema(wiredMenu(['core']));
  assert.equal(plain.properties.mcp, undefined);
  assert.equal(plain.properties.ticketFilter, undefined);
  assert.equal(plain.properties.steps.items.properties.mcpTools, undefined);
});

test('a ticket job with no MCP server in ~/.mcp.json is refused at $0, before any provider call', async () => {
  const p = fakeProvider([toolReply(args())]);
  const r = await run(p, { mcpServers: [] });
  assert.equal(r.ok, false);
  assert.equal(p.calls.length, 0);
  assert.match(r.reds[0], /issues.*MCP server.*~\/\.mcp\.json/);
});

test('a draft that skips the tool is fed back as a red and fixed on the next round', async () => {
  const bad = args({ mcp: undefined });
  delete bad.mcp;
  const p = fakeProvider([toolReply(bad), toolReply(args())]);
  const r = await run(p);
  assert.equal(r.ok, true);
  assert.equal(r.revisions, 1);
  assert.match(p.calls[1].messages.at(-1).content, /lists no "mcp" server/);
});

test('a server the person\'s config does not have is a red naming it', () => {
  const reds = ticketReds(args({ mcp: { server: 'jira', tools: ['issue_read'] } }), [{ role: 'issues' }], ['github']);
  assert.match(reds[0], /"jira" is not a server in your ~\/\.mcp\.json \(github\)/);
});

test('isTicketListUrl: only a GitHub issues list; any other page stays a page', () => {
  assert.equal(isTicketListUrl('https://github.com/flutter/flutter/issues'), true);
  assert.equal(isTicketListUrl('https://github.com/flutter/flutter/issues/'), true);
  assert.equal(isTicketListUrl('https://github.com/flutter/flutter/issues/5'), false);
  assert.equal(isTicketListUrl('https://example.com/issues'), false);
});

test('ticketWatch: the drafter is told it exists, the tool offers only state and labels, and a suggestion comes through', async () => {
  const p = fakeProvider([toolReply(args({ ticketWatch: ['state'] }))]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.declaration.ticketWatch, ['state']);
  assert.deepEqual(p.calls[0].schemas[0].properties.ticketWatch.items.enum, ['state', 'labels']);
  assert.match(p.calls[0].messages[0].content, /"ticketWatch"/);
});
