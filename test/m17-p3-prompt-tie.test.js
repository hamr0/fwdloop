// M17 P3 follow-ups: the row-edit turn of a Tickets job carries bareloop v0.57.0's ticketFilterBlock (the AI is told what to fill); a filter or watch rule the look tied to a fact is a ticket row only (it shows once). $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { draft } from '../src/drafter.js';
import { setUpBlock, ticketLeaveOut } from '../src/blockdraft.js';
import { ticketFilterBlock } from '../src/rowedit.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { callOf, router } from './m16-drafter-fixture.mjs';

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
const DECL = {
  steps: [
    { primitives: ['read'], reads: ['issues'], emits: 'ticket_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['ticket_text'], emits: 'triage_note', fromLine: 2, close: { class: 'hitl' } },
    { primitives: [], reads: ['triage_note'], emits: 'note_check', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['note_check'], emits: 'written', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'softgreen' }, unjudgeable: {}, refused: [],
};

test('the row-edit turn of a Tickets job carries bareloop\'s ticketFilterBlock', async () => {
  const p = router({ suggest_checks: callOf('suggest_checks', { checks: [] }), submit_edits: callOf('submit_edits', { edits: [] }), emit_declaration: callOf('emit_declaration', DECL) });
  await draft({
    proseText: PROSE, rates: RATES, modelId: MODEL, offerQuestions: false, provider: p, flowType: 'tickets', mcpServers: ['github'],
    mcp: { ok: true, server: 'github', tools: ['issue_read', 'list_issues'] }, fetchPage: async () => { throw new Error('fetched'); },
  });
  const sent = p.calls.find((c) => c.name === 'submit_edits');
  assert.ok(sent, 'a row-edit turn was sent');
  assert.ok(sent.messages[sent.messages.length - 1].content.includes(ticketFilterBlock()), 'the row-edit user text lacks the ticket filter block');
  assert.match(ticketFilterBlock(), /you MUST add a top-level "ticketFilter"/);
});

test('the copied block names its bareloop tag', () => {
  assert.match(readFileSync(new URL('../src/rowedit.js', import.meta.url), 'utf8'), /^\/\/ borrowed-from: bareloop src\/ticketfilter\.js@v0\.57\.0 \(c18df406\)/m);
});

test('a filter rule the look tied to a fact is left out of the block too: no block row, so it shows once, as the ticket row', () => {
  const jobLines = [{ n: 2, text: 'Write a note', rules: ['priority P1 only'] }];
  const look = { facts: [{ line: 2, forRule: 1, name: 'priority', shape: 'phrase', words: ['P1'], source: 'issues' }], dropped: [] };
  const block = setUpBlock({ texts: { issues: 'priority P1' }, jobLines, look, kept: { picks: [], left: [], askRules: [] }, fresh: { picks: [], left: [] }, asks: false, countScope: () => false, leaveOut: ticketLeaveOut('tickets', jobLines) });
  assert.deepEqual(block.rows.filter((r) => r.kind === 'rule').length, 0);
});
