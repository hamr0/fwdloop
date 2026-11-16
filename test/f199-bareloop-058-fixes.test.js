// borrowed-from: bareloop tests/checkblock-*.test.js@v0.58.0 (the live failure mwi76vh8: "be friendly" signed as must-say "Select flight"), written fresh against fwd's real CheckBlock
// F199 (docs/logs/FINDINGS.md): real CheckBlock on the product path (`split: true`), no mock. Each test must fail without its own fix.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CheckBlock, REASON } from '../src/checkblock.js';

const TEXT = 'Flights\nSelect flight\nNonstop 120 euros\nSelect flight\nNonstop 140 euros\nSelect flight\nNonstop 150 euros\n';
const fact = (/** @type {any} */ extra = {}) => ({ line: 2, name: 'friendly', shape: 'phrase', source: 'p', words: ['Select flight'], ...extra });
const make = (/** @type {string[]} */ rules, /** @type {any[]} */ facts, /** @type {any[]} */ edits = []) => {
  const b = new CheckBlock({ texts: { p: TEXT }, labels: ['p'], asks: false, split: true });
  b.fromJob([{ n: 1, text: 'Read the page', rules: [] }, { n: 2, text: 'list 3 flights', rules }]);
  b.addLook(facts, []);
  if (edits.length) b.applyDelta({ label: 'ai', edits });
  b.reconcile();
  return b;
};

test('fix 2: a phrase is job-derived only by its own words, never by the name the AI gave it', () => {
  const b = make(['be friendly'], [fact()]);
  const row = b.rows.find((r) => r.key === 'L2.fact.friendly');
  assert.equal(row?.derived, false);
  assert.equal(row?.held, true);
});

test('fix 4: a count whose fact is only Suggested says so', () => {
  const b = make([], [fact()], [{ op: 'add', line: 2, kind: 'count', min: 3 }]);
  const count = b.rows.find((r) => r.kind === 'count');
  assert.equal(count?.state, 'not-checked');
  assert.equal(count?.reason, 'a result count needs a fact to count; add the suggested fact on this line to count its results');
  assert.equal(count?.reason, REASON.countNeedsSuggested);
});
