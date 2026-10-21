// M10 piece 5 (item 2, "a quote in a doc") at drafting: the words of a cited fact part over a DOCUMENT are proved on the drafting copy of the document at $0.
// A document has no page-word map, so the label need not be one the map kept - but every word must be in the document, a label as often as the count, a number
// rule must be the person's own, the count must be said. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { citedWordReds } from '../src/citedwords.js';

const TEXT = 'Fees\nThe fee is 45 dollars per month.\nThe fee is 60 dollars per month.\nTerm\nTwelve months.\n';
const JOB = { n: 1, text: 'List 2 fees', rule: 'under 100' };
const part = (facts, count = { min: 2, max: 2 }) => ({ source: 'terms', facts, count });
const run = (p, o = {}) => citedWordReds({ part: p, text: TEXT, line: 1, jobLine: JOB, look: null, doc: true, ...o });

test('a label and a rule that are in the document and in the person\'s words are green, with no page map', () => {
  assert.deepEqual(run(part([{ name: 'fee', shape: 'number', anchor: 'The fee is', rule: { op: 'lt', value: 100 } }])), []);
});

// must fail (signed): a kept word isn't in the source
test('a label or phrase that is not in the document is red; so is one that is rarer than the count', () => {
  const a = run(part([{ name: 'fee', shape: 'number', anchor: 'The cost is' }]));
  assert.ok(a.some((r) => r.code === 'word-missing'), JSON.stringify(a));
  const b = run(part([{ name: 'fee', shape: 'number', anchor: 'The fee is' }], { min: 3, max: 3 }));
  assert.ok(b.some((r) => r.code === 'label-rare' || r.code === 'count-unsigned'), JSON.stringify(b));
  const c = run(part([{ name: 'term', shape: 'phrase', phrase: 'Twelve months' }], { min: 2, max: 2 }));
  assert.ok(c.some((r) => r.code === 'phrase-rare'), JSON.stringify(c));
});

test('a number rule that is not in the person\'s words is still red on a document', () => {
  const r = run(part([{ name: 'fee', shape: 'number', anchor: 'The fee is', rule: { op: 'lt', value: 77 } }]));
  assert.ok(r.some((x) => x.code === 'number-unsigned'), JSON.stringify(r));
});

test('without the doc flag a source with no page map is still refused as unread', () => {
  const r = run(part([{ name: 'fee', shape: 'number', anchor: 'The fee is' }]), { doc: false });
  assert.deepEqual(r.map((x) => x.code), ['unread']);
});
