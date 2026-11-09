// A priority label is bounded on both sides: `p2p`, `p3rf` are not P2 / P3 (fix-ledger: src/ticket-labels.js PRIORITY_LABEL). Written red-first.
import assert from 'node:assert/strict';
import { test, describe } from 'node:test';

import { priorityOf, decideTicket } from '../src/ticket-labels.js';

describe('priorityOf: text glued to the digit is no priority', () => {
  const cases = [
    [['p2p'], 'none'],
    [['p3rf'], 'none'],
    [['P1x'], 'none'],
    [['priority: p1x'], 'unsure'], // names priority but not on the scale: off-scale, goes to a human
    [['P1'], 'P1'],
    [['priority/P1'], 'P1'],
    [['Priority: P1'], 'P1'],
    [['P1 - urgent'], 'P1'],
    [['P1-urgent'], 'P1'],
    [['p1-foo'], 'P1'], // a dash after the digit is a separator (signed: `priority : P2-High` reads P2)
    [['p1_urgent'], 'P1'],
    [['P12'], 'none'],
  ];
  for (const [labels, want] of cases) test(`${JSON.stringify(labels)} -> ${want}`, () => assert.equal(priorityOf(labels), want));
});

test('decideTicket: a p2p label is not "priority P2"', () => {
  const r = decideTicket({ text: '{"labels":["p2p"],"state":"open"}', filter: { priority: ['P1'] } });
  assert.deepEqual(r, { outcome: 'skip', reason: 'no P1 label' });
});
