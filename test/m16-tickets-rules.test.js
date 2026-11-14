// M16 item 4 / Must-fail "a sheet or Tickets job changes": a Tickets job's ticket guardrails ("priority P1 only", "run a ticket again when its state changes") are
// the declaration's own ticketFilter / ticketWatch. They are never rows of the check list: no "can't check" ask, no Not checked note. Stub providers, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draft } from '../src/drafter.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { callOf, router } from './m16-drafter-fixture.mjs';

const PROSE = `1. Read the ticket
2. Write a one-paragraph triage note: a summary of the ticket and a suggested next step
   guardrail: priority P1 only; run a ticket again when its state changes; at most 3 words
3. ask 1h: check the note with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.5 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source issues = page:https://github.com/hamr0/hol-guard/issues
`;
const TICKET = { flowType: 'tickets', mcpServers: ['github'], mcp: { ok: true, server: 'github', tools: ['issue_read', 'list_issues'] }, fetchPage: async () => { throw new Error('a ticket list was fetched at draft'); } };
const mk = () => router({ suggest_checks: callOf('suggest_checks', { checks: [] }), submit_edits: callOf('submit_edits', { edits: [] }) });

test('Tickets: the filter and watch guardrails are not asked as "can\'t check"; a count guardrail on the same line still is asked as before', async () => {
  const r = await draft({ proseText: PROSE, provider: mk(), rates: RATES, modelId: MODEL, checkList: true, offerQuestions: true, ...TICKET });
  assert.equal(r.stop, 'look-asks', r.reds.join('|'));
  const asked = r.questions.map((/** @type {any} */ q) => [q.line, q.ruleNo, q.ruleText]);
  assert.ok(!r.questions.some((/** @type {any} */ q) => q.ask === 'cant-check'), `a ticket guardrail was asked as "can't check": ${JSON.stringify(asked)}`);
  assert.deepEqual(r.questions.map((/** @type {any} */ q) => [q.ruleNo, q.ask]), [[3, 'check']], 'only the count guardrail (rule 3, its own number) is asked');
});

test('Tickets: after the count ask is answered, the card has no Not checked note for the filter or watch guardrails, and the list has no row for them', async () => {
  const decl = {
    steps: [
      { primitives: ['read'], reads: ['issues'], emits: 'ticket_text', fromLine: 1, close: { class: 'hitl' } },
      { primitives: ['read'], reads: ['ticket_text'], emits: 'triage_note', fromLine: 2, close: { class: 'hitl' } },
      { primitives: [], reads: ['triage_note'], emits: 'note_check', fromLine: 3, close: { class: 'hitl' } },
      { primitives: ['write'], reads: ['note_check'], emits: 'written', fromLine: 4, close: { class: 'hitl' } },
    ],
    guardrailClasses: { 2: 'softgreen' }, unjudgeable: {}, refused: [], ticketFilter: { priority: ['P1'] }, ticketWatch: ['state'],
  };
  const p = router({ suggest_checks: callOf('suggest_checks', { checks: [] }), submit_edits: callOf('submit_edits', { edits: [] }), emit_declaration: callOf('emit_declaration', decl) });
  const r = await draft({ proseText: PROSE, provider: p, rates: RATES, modelId: MODEL, checkList: true, offerQuestions: false, ...TICKET });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.declaration.ticketFilter, { priority: ['P1'] });
  assert.deepEqual(r.declaration.ticketWatch, ['state']);
  const text = JSON.stringify([r.notChecked, r.checkRows]);
  assert.ok(!/priority P1 only|state changes/.test(text), `a ticket guardrail is on the list or in Not checked: ${text}`);
});
