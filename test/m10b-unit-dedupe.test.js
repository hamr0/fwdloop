// M10b item 1: bareguard 0.26.0 refuses a money unit list with two entries equal after whitespace normalization; fwdloop never builds one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRubric } from 'bareguard';
import { factsOfLook, buildCitedSpec } from '../src/citedcheck.js';

test('a unit listed twice with different spacing is one unit in the signed fact', () => {
  const [f] = factsOfLook({ name: 'price', shape: 'money', words: ['From'], unit: ['US dollars', 'US  dollars ', 'euros'] });
  assert.deepEqual(f.unit, ['US dollars', 'euros']);
});

test('the raw doubled list is what bareguard 0.26.0 refuses; the built fact signs', () => {
  const part = (unit) => ({ source: 'page', facts: [{ name: 'price', shape: 'money', anchor: 'From', unit }] });
  const sha = 'a'.repeat(64);
  assert.throws(() => createRubric(buildCitedSpec(part(['US dollars', 'US  dollars']), sha)), /duplicates/);
  const [f] = factsOfLook({ name: 'price', shape: 'money', words: ['From'], unit: ['US dollars', 'US  dollars'] });
  assert.doesNotThrow(() => createRubric(buildCitedSpec(part(f.unit), sha)));
});
