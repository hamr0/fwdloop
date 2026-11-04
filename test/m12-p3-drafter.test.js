// M12 piece 3 (item 4), rewritten for M13 piece 4: the drafter is told the flow type, that the ticket is already frozen, and the MCP's tool names; it may SUGGEST a `ticketFilter`
// and a step's `mcpTools`; the job's `flowType` and `mcp` block are set by code (R1: every tool of the newest OK check). A human signs, code decides.
// $0: the fake provider of test/drafter-fixture.mjs, no network, no MCP server. Written red-first.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { draft, buildDeclarationSchema } from '../src/drafter.js';
import { wiredMenu } from '../src/primitives.js';
import { ticketFactsLines, mcpFactsLines, isTicketListUrl, ticketReds } from '../src/ticket-draft.js';
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
const TOOLS = ['issue_read', 'list_issues', 'create_issue'];
const PICK = { ok: true, server: 'github', tools: TOOLS };
const args = (over = {}) => Object.fromEntries(Object.entries({
  steps: [
    { primitives: ['read'], reads: ['issues'], emits: 'ticket_note', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['ticket_note'], emits: 'ask_check', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['ask_check'], emits: 'written', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'hitl', 2: 'hitl' },
  unjudgeable: {},
  refused: [],
  ticketFilter: { priority: ['P1', 'P2'] },
  ...over,
}).filter(([, v]) => v !== undefined));
const run = (provider, extra = {}) => draft({
  proseText: PROSE, provider, rates: RATES, modelId: MODEL, offerQuestions: false, mcpServers: ['github'], flowType: 'tickets', mcp: PICK, fetchPage: async () => { throw new Error('a ticket list was fetched at draft'); }, ...extra,
});

test('Tickets: the drafter is told the flow type, that the ticket is frozen, the F90c line word for word, and what it may suggest; nothing is fetched', async () => {
  const p = fakeProvider([toolReply(args())]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const system = p.calls[0].messages[0].content;
  assert.ok(system.includes('- issues: one ticket\'s text (a signed input, already frozen at run start; read it by listing "issues" in a step\'s reads, do not fetch it)'));
  for (const line of ticketFactsLines('issues')) assert.ok(system.includes(line), line);
  assert.match(system, /Flow type: Tickets\. The ticket is already frozen under "issues"/);
  assert.match(system, /A step lists a tool in "mcpTools" ONLY if that step calls the tool live/);
  assert.ok(system.includes('A step that reads "issues" still lists "read" in its primitives'));
  assert.deepEqual(r.declaration.ticketFilter, { priority: ['P1', 'P2'] });
});

test('the job\'s flowType and mcp block are set by code: every tool of the pick, whatever the model sent', async () => {
  const p = fakeProvider([toolReply(args({ flowType: 'plain', mcp: { server: 'evil', tools: ['x'] } }))]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.declaration.flowType, 'tickets');
  assert.deepEqual(r.declaration.mcp, { server: 'github', tools: TOOLS });
});

test('the forced tool offers no mcp block and no flowType; mcpTools is an enum of the pick\'s tools; ticketFilter and ticketWatch only for Tickets', async () => {
  const p = fakeProvider([toolReply(args())]);
  await run(p);
  const schema = p.calls[0].schemas[0];
  assert.equal(schema.properties.mcp, undefined);
  assert.equal(schema.properties.flowType, undefined);
  assert.deepEqual(schema.properties.steps.items.properties.mcpTools.items.enum, TOOLS);
  assert.deepEqual(schema.properties.ticketFilter.properties.priority.items.enum, ['P0', 'P1', 'P2', 'P3']);
  const g = buildDeclarationSchema(wiredMenu(['core']), { ticket: { flowType: 'mcp', tools: TOOLS } });
  assert.equal(g.properties.ticketFilter, undefined);
  assert.equal(g.properties.ticketWatch, undefined);
  assert.ok(g.properties.steps.items.properties.mcpTools);
  const plain = buildDeclarationSchema(wiredMenu(['core']));
  assert.equal(plain.properties.mcp, undefined);
  assert.equal(plain.properties.ticketFilter, undefined);
  assert.equal(plain.properties.steps.items.properties.mcpTools, undefined);
});

test('MCP (generic): told the server and every tool name; a draft where no step calls a tool is fed back and fixed on the next round', async () => {
  const none = args({ ticketFilter: undefined, steps: [{ ...args().steps[0], reads: [] }, ...args().steps.slice(1)] });
  const good = args({ ticketFilter: undefined, steps: [{ ...args().steps[0], reads: [], mcpTools: ['list_issues'] }, ...args().steps.slice(1)] });
  const p = fakeProvider([toolReply(none), toolReply(good)]);
  const r = await run(p, { flowType: 'mcp', proseText: PROSE.replace('\nguardrail: source issues = page:https://github.com/flutter/flutter/issues', '') });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.revisions, 1);
  assert.equal(r.declaration.flowType, 'mcp');
  const system = p.calls[0].messages[0].content;
  for (const line of mcpFactsLines('github', TOOLS)) assert.ok(system.includes(line), line);
  assert.ok(system.includes(TOOLS.join(', ')));
  assert.match(p.calls[1].messages.at(-1).content, /MCP job \(server "github"\) has no step that calls one of its tools/);
});

test('plain: nothing about MCP is told or offered, and the declaration says flowType plain with no mcp block', async () => {
  const p = fakeProvider([toolReply(args({ ticketFilter: undefined, steps: [{ ...args().steps[0], reads: [] }, ...args().steps.slice(1)] }))]);
  const r = await draft({ proseText: PROSE.replace('\nguardrail: source issues = page:https://github.com/flutter/flutter/issues', ''), provider: p, rates: RATES, modelId: MODEL, offerQuestions: false });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.declaration.flowType, 'plain');
  assert.equal(r.declaration.mcp, undefined);
  assert.equal(p.calls[0].schemas[0].properties.steps.items.properties.mcpTools, undefined);
});

test('$0 refusals before any provider call: never checked, no ticket list for Tickets, a server that cannot start', async () => {
  for (const [extra, want] of [
    [{ mcp: { ok: false, say: 'press check tools in Settings > MCP first' } }, /^press check tools in Settings > MCP first$/],
    [{ mcp: null }, /press check tools in Settings > MCP first/],
    [{ proseText: PROSE.replace('\nguardrail: source issues = page:https://github.com/flutter/flutter/issues', '') }, /Tickets needs the ticket list address as an Inputs line/],
    [{ mcpServers: [] }, /"github" is not a server fwdloop can start/],
  ]) {
    const p = fakeProvider([toolReply(args())]);
    // eslint-disable-next-line no-await-in-loop
    const r = await run(p, extra);
    assert.equal(r.ok, false);
    assert.equal(p.calls.length, 0);
    assert.match(r.reds[0], want);
  }
});

test('ticketReds: plain has nothing to check; the other flow types name the cause', () => {
  assert.deepEqual(ticketReds({ flowType: 'plain', ticketSources: [], pick: null, servers: [] }), []);
  assert.deepEqual(ticketReds({ flowType: 'mcp', ticketSources: [], pick: PICK, servers: ['github'] }), []);
  assert.match(ticketReds({ flowType: 'mcp', ticketSources: [], pick: PICK, servers: ['other'] })[0], /"github" is not a server fwdloop can start \(other\)/);
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
