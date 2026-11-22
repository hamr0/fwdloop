// M19 block (hamr 2026-11-19, F227): F337 `asSeen`, taken from bareloop v0.60.0. Optional on a signed fact part, written by code at signing only; a part with none (every job signed before) is accepted exactly as before. $0, no key.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { asSeenOf } from '../src/pagedry.js';
import { factPartReds } from '../src/citedcheck.js';
import { rubricStepShapeReds } from '../src/rubricstep.js';

const PAGE = 'generic "From 166 US dollars. Nonstop"\ngeneric "Departure time: 10:24 AM."\ngeneric "From 180 US dollars. Stop"\ngeneric "Departure time: 11:00 AM."';
const FACTS = [{ name: 'price', shape: 'money', anchor: 'From', currency: ['US dollars'] }, { name: 'departure', shape: 'time', anchor: 'Departure time:' }];

test('asSeenOf: a label on a sibling line gives the lines down to it; every label on the first line gives null', () => {
  assert.deepEqual(asSeenOf(PAGE, FACTS, 'page'), { input: 'page', lines: ['generic "From 166 US dollars. Nonstop"', 'generic "Departure time: 10:24 AM."'], labels: ['Departure time:'] });
  assert.equal(asSeenOf('From 5 USD Departure time: 10:00', [{ name: 'p', shape: 'money', anchor: 'From', unit: ['USD'] }, { name: 'd', shape: 'time', anchor: 'Departure time:' }], 'page'), null);
  assert.equal(asSeenOf(PAGE, [FACTS[0]], 'page'), null);
});

const part = { source: 'page', facts: [{ name: 'price', shape: 'money', anchor: 'From', currency: '$' }] };
const AS = { input: 'page', lines: ['a', 'b'], labels: ['Departure time:'] };

test('an old fact part with no asSeen is accepted by both readers; a good asSeen too; a bad one is refused', () => {
  assert.deepEqual(factPartReds(part), []);
  assert.deepEqual(factPartReds({ ...part, asSeen: AS }), []);
  assert.ok(factPartReds({ ...part, asSeen: { input: 'page', lines: [], labels: ['x'] } }).length > 0);
  assert.ok(factPartReds({ ...part, asSeen: { ...AS, extra: 1 } }).length > 0);
  const shape = (/** @type {any} */ p) => rubricStepShapeReds({ step: 1, parts: [{ text: 't', class: 'fact', ...p }] }, 'trial');
  assert.deepEqual(shape(part), []);
  assert.deepEqual(shape({ ...part, asSeen: AS }), []);
  assert.ok(shape({ ...part, asSeen: 'x' }).length > 0);
  assert.ok(rubricStepShapeReds({ step: 1, parts: [{ text: 't', class: 'judged', asSeen: AS }] }, 'trial').length > 0, 'only a fact part carries it');
});
