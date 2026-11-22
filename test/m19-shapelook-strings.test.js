// M19 S2: the shape look's prompt strings are the tag's, byte for byte (M19 section 3.1, "Must fail when: the shape prompt ... differs from the tag").
// test/fixtures/m19-shapelook-tag.json holds the tag's text of src/shapelook.js (v0.61.0, fc56e1f3) from the SHAPE_CALL_LABEL doc line through parseShapeAnswer, and the look's failure words; no bareloop checkout is read.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lookAtShape, SHAPE_SYSTEM, shapeLookPrompt, shapeMenuLines } from '../src/shapelook.js';

const fx = JSON.parse(readFileSync(new URL('./fixtures/m19-shapelook-tag.json', import.meta.url), 'utf8'));
const mine = readFileSync(new URL('../src/shapelook.js', import.meta.url), 'utf8');

test('SHAPE_SYSTEM, shapeMenuLines, shapeLookPrompt and the constants are the tag\'s text, byte for byte', () => {
  assert.ok(fx.core.includes('export const SHAPE_SYSTEM') && fx.core.includes('export function shapeLookPrompt') && fx.core.includes('export function parseShapeAnswer'));
  assert.ok(mine.includes(fx.core), 'src/shapelook.js holds the tag\'s text from SHAPE_CALL_LABEL through parseShapeAnswer unchanged');
  assert.equal(SHAPE_SYSTEM, 'You map a person\'s job to the SHAPE of an answer: a list of items, each item with named fields. You never grade and never invent bounds: a bound is only what the person wrote. Reply with JSON only.');
  assert.ok(shapeMenuLines().length > 0 && shapeLookPrompt({ jobLines: [{ n: 1, text: 'x', rules: ['a'] }], lineNums: [1], texts: { t: 'y' } }).includes('THE JOB (each ~ rule applies to the line above it):'));
});

test('the look\'s failure words are the tag\'s: the cap, the failed call, the unreadable answer twice (the swap of "about the page")', async () => {
  assert.ok(mine.includes(fx.capReason), 'the cap reason');
  assert.ok(mine.includes(fx.failedReason + '${redactSecrets(String(r.error))}'), 'the failed-call reason');
  const job = [{ n: 1, text: 'x', rules: ['a'] }];
  const bad = await lookAtShape({ texts: { t: 'y' }, jobLines: job, lineNums: [1], callModel: async () => ({ text: 'no' }) });
  assert.deepEqual([bad.ok, bad.reason, bad.attempts], [false, fx.unreadable, 2]);
  const capped = await lookAtShape({ texts: { t: 'y' }, jobLines: job, lineNums: [1], ceilingUsd: 0.5, callModel: async () => ({ error: 'the draft budget is spent', budget: true }) });
  assert.equal(capped.reason, "the AI's look at the shape of the answer was not made: the $0.5 ceiling was already spent");
  const failed = await lookAtShape({ texts: { t: 'y' }, jobLines: job, lineNums: [1], callModel: async () => ({ error: 'boom' }) });
  assert.equal(failed.reason, 'the call about the shape of the answer failed: boom');
});
