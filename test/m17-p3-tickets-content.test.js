// M17 item 2(b) (D1): a Tickets content rule ("mention the reporter's name") is never hidden: it is a row of the list and, with no check, one Not checked row. The filter and watch rules stay
// as they are (not rows) until the filter/watch ruling. Stub providers, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ticketLeaveOut } from '../src/blockdraft.js';
import { draft } from '../src/drafter.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { callOf, router } from './m16-drafter-fixture.mjs';

test('ticketLeaveOut hides only the filter and watch rules, never a content rule', () => {
  const out = ticketLeaveOut('tickets', [{ n: 2, rules: ['priority P1 only', "mention the reporter's name", 'at most 3 words', 'run a ticket again when its state changes'] }], []);
  assert.deepEqual(out, [{ line: 2, rule: 1 }, { line: 2, rule: 4 }]);
});

const PROSE = `1. Read the ticket
2. Write a one-paragraph triage note
   guardrail: priority P1 only; mention the reporter's name; run a ticket again when its state changes
3. ask 1h: check the note with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):
guardrail: cap $0.5 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source issues = page:https://github.com/hamr0/hol-guard/issues
`;
const TICKET = { flowType: 'tickets', mcpServers: ['github'], mcp: { ok: true, server: 'github', tools: ['issue_read', 'list_issues'] }, fetchPage: async () => { throw new Error('a ticket list was fetched at draft'); } };

test('Tickets draft: the content rule is on the list and in Not checked once; the filter and watch rules are not', async () => {
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
  const text = JSON.stringify([r.notChecked, r.checkRows]);
  assert.equal(JSON.stringify(r.notChecked).split("mention the reporter's name").length - 1, 1, `Not checked must name the content rule once: ${JSON.stringify(r.notChecked)}`);
  const rows = r.checkRows.filter((/** @type {any} */ x) => x.rowKind === 'rule');
  assert.deepEqual(rows.map((/** @type {any} */ x) => [x.words[0], x.state]), [["mention the reporter's name", 'not-checked']], `the list's rule rows: ${JSON.stringify(rows)}`);
  assert.ok(!/priority P1 only|state changes/.test(text), `a filter or watch rule is on the list: ${text}`);
});
