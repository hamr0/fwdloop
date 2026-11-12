// M4d am39: a drafting answer with an extra `}` at the end is fixed by code, and used only when the plan checker finds no unknown key. $0, fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draft } from '../src/drafter.js';
import { repairTrailingBraces } from '../src/jsonbrace.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

const OBJ = '{"a":1,"b":{"c":[1,2]}}';

test('the rule repairs one }, }} and "} \\n", dropping only the trailing characters', () => {
  for (const [tail, dropped] of [['}', '}'], ['}}', '}}'], [' } \n', ' } \n'], ['}\n}', '}\n}']]) {
    const r = repairTrailingBraces(OBJ + tail);
    assert.ok(r, JSON.stringify(tail));
    assert.deepEqual(r.value, JSON.parse(OBJ));
    assert.equal(r.dropped, dropped);
    assert.equal((OBJ + tail).slice(0, (OBJ + tail).length - r.dropped.length), OBJ, 'only the trailing characters are gone');
  }
});

test('the rule gives null for anything else', () => {
  for (const t of [`${OBJ}]`, `${OBJ} thanks`, `${OBJ}}x`, '{"a":1,"b":{"c":[1,2]}', `${OBJ}${OBJ}`, '[1,2]}', '', OBJ, 'x}']) {
    assert.equal(repairTrailingBraces(t), null, JSON.stringify(t));
  }
  assert.equal(repairTrailingBraces(undefined), null);
});

const malformed = (rawArguments) => ({
  text: '', toolCalls: [], usage: { inputTokens: 1000, outputTokens: 80 }, stopReason: 'tool_use', model: MODEL,
  malformedToolCall: { name: 'emit_declaration', rawArguments, error: 'Unexpected non-whitespace character after JSON at position 99' },
});
const run = (provider) => draft({ proseText: job2Fixture().prose, provider, rates: RATES, modelId: MODEL });
const RETRY_WORDS = (why) => `Your last reply was not a usable tool call (${why}). Call emit_declaration now with a complete, valid JSON declaration.`;
const WHY = "the tool call's arguments were not valid JSON (Unexpected non-whitespace character after JSON at position 99)";

test('(a) a valid plan plus one } goes green with no structure retry and the repair is logged', async () => {
  const raw = `${JSON.stringify(validArgs())}}`;
  const p = fakeProvider([malformed(raw)]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.structureRetries, 0);
  assert.equal(p.calls.length, 1, 'no extra round');
  assert.equal(r.rounds, 1);
  assert.deepEqual(r.log[0].braceRepair, { dropped: '}', used: true });
  assert.equal(r.log[0].rawArguments, raw, 'the raw text is still kept');
  assert.equal(r.log[0].outcome, 'valid');
});

test('(b)+(c) a repaired answer with an unknown key is not used: today\'s structure retry, same words, logged used:false', async () => {
  const raw = `${JSON.stringify({ ...validArgs(), 5: 'escaped' })}}`;
  const p = fakeProvider([malformed(raw), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.structureRetries, 1);
  assert.equal(p.calls.length, 2);
  assert.deepEqual(r.log[0].braceRepair, { dropped: '}', used: false });
  assert.equal(r.log[0].rawArguments, raw);
  assert.equal(r.log[0].outcome, `structure: ${WHY}`);
  assert.deepEqual(r.log.map((e) => e.kind), ['first', 'structure-retry']);
  assert.equal(p.calls[1].messages.at(-1).content, RETRY_WORDS(WHY));
  assert.equal(r.log[0].retention, undefined);
});

test('an unknown-key repair that goes on failing keeps the structure cap, then stops as structure', async () => {
  const raw = `${JSON.stringify({ ...validArgs(), 5: 'escaped' })}}`;
  const p = fakeProvider([malformed(raw)]);
  const r = await run(p);
  assert.equal(r.ok, false);
  assert.equal(r.stop, 'structure');
  assert.equal(r.reds[0], WHY);
});

test('any other validator red on a repaired answer goes back as a normal revision', async () => {
  const bad = validArgs();
  bad.steps[2].primitives = ['forget'];
  const p = fakeProvider([malformed(`${JSON.stringify(bad)}}`), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.structureRetries, 0);
  assert.equal(r.revisions, 1);
  assert.deepEqual(r.log[0].braceRepair, { dropped: '}', used: true });
  assert.match(p.calls[1].messages.at(-1).content, /"forget"/);
});

test('trailing junk that is not } is never repaired: today\'s structure retry', async () => {
  const p = fakeProvider([malformed(`${JSON.stringify(validArgs())}]`), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.structureRetries, 1);
  assert.equal(r.log[0].braceRepair, undefined);
});
