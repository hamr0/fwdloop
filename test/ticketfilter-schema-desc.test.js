// M17 am6: the Tickets filter is suggested through the row-edit turn's `ticketFilter` property; its description says required (F151), never optional, and the declaration prompt no longer tells the drafter to add a top-level one.
// $0: pure functions, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { ticketFactsLines, ticketSchemaParts } from '../src/ticket-draft.js';
import { rowEditChannel } from '../src/rowedit.js';

test('the row-edit ticketFilter description says required, not optional', () => {
  const d = rowEditChannel(true).tool({ calls: [] }).parameters.properties.ticketFilter.description;
  assert.doesNotMatch(d, /optional|suggest only/i);
  assert.match(d, /required/i);
});

test('the declaration offers no top-level filter or watch and the prompt does not ask for one', () => {
  assert.deepEqual(ticketSchemaParts({ flowType: 'tickets', tools: ['issue_read'] }).top, {});
  assert.ok(!ticketFactsLines('issues').some((l) => /ticketFilter|ticketWatch/.test(l)));
});
