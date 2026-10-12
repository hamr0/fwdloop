// M4d amendment 21 item 4: ONE isKeyName (the `…_KEY` rule hamr chose). A slot named like GROQ_TOKEN is refused at every gate, by name of the rule, so a key the run
// could use is never one the log scrubber does not know. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isKeyName as fromKeys } from '../src/keysfile.js';
import {
  isKeyName as fromProvider, resolveSlot, checkKeyPreflight, makeProvider,
} from '../src/provider.js';
import { readModelRecord } from '../src/flowmodel.js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

const RULE = /a key name is written like DEEPSEEK_API_KEY \(capitals, ending in _KEY\)/;

test('there is one rule: provider.js and keysfile.js export the very same function', () => {
  assert.equal(fromProvider, fromKeys);
  assert.equal(fromProvider('GROQ_TOKEN'), false);
  assert.equal(fromProvider('DEEPSEEK_API_KEY'), true);
});

test('a slot like GROQ_TOKEN is refused at preflight and at resolve, with the rule named', () => {
  const pre = checkKeyPreflight('GROQ_TOKEN', { GROQ_TOKEN: 'x' });
  assert.equal(pre.ok, false);
  assert.match(pre.message, /^key: unknown provider "GROQ_TOKEN"/);
  assert.match(pre.message, RULE);
  assert.throws(() => resolveSlot('GROQ_TOKEN'), (e) => RULE.test(e.message) && /GROQ_TOKEN/.test(e.message));
  assert.throws(() => makeProvider('GROQ_TOKEN', { model: 'm', env: { GROQ_TOKEN: 'x' } }), (e) => RULE.test(e.message));
});

test('a flow\'s recorded model naming such a slot is not a record (never read as a usable model)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am21-4-'));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, 'model.json'), JSON.stringify({ slot: 'GROQ_TOKEN', model: 'x' }));
  assert.equal(readModelRecord(dir), null);
  writeFileSync(path.join(dir, 'model.json'), JSON.stringify({ slot: 'GROQ_API_KEY', model: 'x' }));
  assert.deepEqual(readModelRecord(dir), { slot: 'GROQ_API_KEY', model: 'x' });
});
