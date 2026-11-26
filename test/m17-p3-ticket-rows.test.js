// M17 am6: the Tickets filter and watch are rows on the list (src/ticketrows.js). The AI suggests the value in the row-edit turn; code proves it with the declaration's own readers and writes the
// declaration's field; a plan with no ticket rows (signed before M17) is not examined. Stub providers, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draft } from '../src/drafter.js';
import { ticketRuleField, proposalReds, ticketRowsOf } from '../src/ticketrows.js';
import { ticketListReds } from '../src/checklistsign.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { callOf, router } from './m16-drafter-fixture.mjs';

test('ticketRuleField: priority or label is the filter, a state or labels change is the watch, a content rule or a count is neither', () => {
  assert.equal(ticketRuleField('priority P1 only'), 'ticketFilter');
  assert.equal(ticketRuleField('only issues labelled bug'), 'ticketFilter');
  assert.equal(ticketRuleField('run a ticket again when its state changes'), 'ticketWatch');
  assert.equal(ticketRuleField("mention the reporter's name"), null);
  assert.equal(ticketRuleField('at most 3 words'), null);
});

test('proposalReds: the declaration\'s own readers judge the value', () => {
  assert.deepEqual(proposalReds('ticketFilter', { priority: ['P1'] }), []);
  assert.ok(proposalReds('ticketFilter', { priority: ['P9'] }).length > 0);
  assert.ok(proposalReds('ticketFilter', { colour: ['red'] }).length > 0);
  assert.deepEqual(proposalReds('ticketWatch', ['state']), []);
  assert.ok(proposalReds('ticketWatch', ['owner']).length > 0);
});

test('a plan with a filter and a list but no ticket rows (signed before M17) is not examined; a plan with ticket rows is held to them', () => {
  const old = { flowType: 'tickets', mcp: {}, ticketFilter: { priority: ['P1'] }, ticketWatch: ['state'], checkList: [{ line: 1, key: 'L1.$floor', kind: 'floor', state: 'built' }] };
  assert.deepEqual(ticketListReds(old), []);
  const row = (field, state) => ({ line: 2, key: `L2.ticket.${field}.1`, kind: 'ticket', field, state, rule: 1, by: 'you', from: 'rule' });
  assert.deepEqual(ticketListReds({ ...old, checkList: [row('ticketFilter', 'built'), row('ticketWatch', 'built')] }), []);
  assert.match(ticketListReds({ ...old, checkList: [row('ticketFilter', 'built')] }).join('|'), /"ticketWatch" is not the check of any rule/);
  assert.match(ticketListReds({ ticketWatch: ['state'], checkList: [row('ticketFilter', 'built')] }).join('|'), /says "ticketFilter".*no "ticketFilter"/);
});

test('ticketRowsOf: a filter rule with no value on the declaration is a Not-checked row with its reason', () => {
  const lines = [{ n: 2, guardrail: "priority P1 only; mention the reporter's name" }];
  const r = ticketRowsOf({ declaration: { flowType: 'tickets' }, lines });
  assert.deepEqual(r.signed.map((x) => [x.field, x.state]), [['ticketFilter', 'not-checked']]);
  assert.equal(r.notChecked.length, 1);
  const ok = ticketRowsOf({ declaration: { flowType: 'tickets', ticketFilter: { priority: ['P1'] } }, lines });
  assert.deepEqual(ok.signed.map((x) => x.state), ['built']);
  assert.match(ok.card[0].text, /ticket filter: priority P1/);
});

const PROSE = `1. Read the ticket
2. Write a one-paragraph triage note
   guardrail: priority P1 only
3. ask 1h: check the note with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.5 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source issues = page:https://github.com/hamr0/hol-guard/issues
`;
const TICKET = { flowType: 'tickets', mcpServers: ['github'], mcp: { ok: true, server: 'github', tools: ['issue_read', 'list_issues'] }, fetchPage: async () => { throw new Error('a ticket list was fetched at draft'); } };
const DECL = {
  steps: [
    { primitives: ['read'], reads: ['issues'], emits: 'ticket_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['ticket_text'], emits: 'triage_note', fromLine: 2, close: { class: 'hitl' } },
    { primitives: [], reads: ['triage_note'], emits: 'note_check', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['note_check'], emits: 'written', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'softgreen' }, unjudgeable: {}, refused: [],
};
const go = (edit) => draft({
  proseText: PROSE, rates: RATES, modelId: MODEL, offerQuestions: false, ...TICKET,
  provider: router({ suggest_checks: callOf('suggest_checks', { checks: [] }), submit_edits: callOf('submit_edits', edit), emit_declaration: callOf('emit_declaration', DECL) }),
});

test('the AI suggests no filter: the declaration has none and the rule is one Not checked row', async () => {
  const r = await go({ edits: [] });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(Object.hasOwn(r.declaration, 'ticketFilter'), false);
  assert.equal(r.notChecked.filter((x) => x.includes('priority P1 only')).length, 1, JSON.stringify(r.notChecked));
});

test('the AI suggests an illegal filter: code refuses it, the declaration has none, the rule is Not checked', async () => {
  const r = await go({ edits: [], ticketFilter: { priority: ['P9'] } });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(Object.hasOwn(r.declaration, 'ticketFilter'), false);
  assert.equal(r.notChecked.filter((x) => x.includes('priority P1 only')).length, 1);
});

test('the AI suggests a filter for a job with no rule that names one: code writes nothing', async () => {
  const r = await draft({
    proseText: PROSE.replace('guardrail: priority P1 only', "guardrail: mention the reporter's name"), rates: RATES, modelId: MODEL, offerQuestions: false, ...TICKET,
    provider: router({ suggest_checks: callOf('suggest_checks', { checks: [] }), submit_edits: callOf('submit_edits', { edits: [], ticketFilter: { priority: ['P1'] } }), emit_declaration: callOf('emit_declaration', DECL) }),
  });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(Object.hasOwn(r.declaration, 'ticketFilter'), false);
});

test('the AI suggests a legal filter: the declaration carries it, as a built row on its rule', async () => {
  const r = await go({ edits: [], ticketFilter: { priority: ['P1'] } });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.declaration.ticketFilter, { priority: ['P1'] });
  assert.deepEqual(r.declaration.checkList.filter((x) => x.kind === 'ticket').map((x) => [x.field, x.state]), [['ticketFilter', 'built']]);
});
