// M4e amendment 15 item 5: the validator reds a write-class grant on a softgreen step; the drafter must be TOLD the rule.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draft } from '../src/drafter.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

const RULE = /softgreen[^\n]*never granted `?write`?, `?edit`?/i;

test('the request the provider receives tells the model a softgreen step is never granted write/edit', async () => {
  const p = fakeProvider([toolReply(validArgs())]);
  await draft({ proseText: job2Fixture().prose, provider: p, rates: RATES, modelId: MODEL });
  const system = p.calls[0].messages.find((m) => m.role === 'system').content;
  assert.match(system, RULE, 'the system prompt carries the rule');
  assert.match(system, /only the send step[^\n]*writes files out/i);
  const menuLine = (verb) => system.split('\n').find((l) => l.startsWith(`- ${verb}:`));
  assert.match(menuLine('write'), /never granted to a step whose check reads its reply/i);
});
