// The Tickets drafter's prompt says it MUST add a ticketFilter for a priority/label guardrail; the tool schema's description must not say "optional" (F151).
// $0: pure functions, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ticketFactsLines, ticketSchemaParts } from '../src/ticket-draft.js';

test('ticketFilter schema description says required, not optional', () => {
  const d = ticketSchemaParts({ flowType: 'tickets', tools: ['issue_read'] }).top.ticketFilter.description;
  assert.doesNotMatch(d, /optional|suggest only/i);
  assert.match(d, /required/i);
});

test('prompt and schema agree: the prompt says MUST add a top-level ticketFilter', () => {
  const lines = ticketFactsLines('issues');
  assert.ok(lines.some((l) => l.includes('MUST add a top-level "ticketFilter"')));
});
