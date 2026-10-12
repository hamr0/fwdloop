// M4d amendment 4: thinking on means no forced tool; off keeps the forced tool. $0: fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draft } from '../src/drafter.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply, textReply,
} from './drafter-fixture.mjs';

const run = (provider, extra = {}) => draft({ proseText: job2Fixture().prose, provider, rates: RATES, modelId: MODEL, ...extra });

test('am4: thinking off forces the tool, as before', async () => {
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await run(p, { draftThinking: 'off' });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(p.calls[0].options.toolChoice, { name: 'emit_declaration' });
});

test('am4: thinking on sends no toolChoice at all', async () => {
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await run(p, { draftThinking: 'on' });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal('toolChoice' in p.calls[0].options, false);
});

test('am4: thinking on, plain text on round 1, tool call on round 2 -> the structure retry carries it', async () => {
  const p = fakeProvider([textReply('Here is my plan in prose.'), toolReply(validArgs())]);
  const r = await run(p, { draftThinking: 'on' });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(p.calls.length, 2);
  assert.equal(r.structureRetries, 1);
  assert.equal(r.log[1].kind, 'structure-retry');
  assert.equal('toolChoice' in p.calls[1].options, false);
});
