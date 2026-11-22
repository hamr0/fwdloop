// borrowed-from: bareloop tests/shape-words.test.js@v0.61.0 (fc56e1f3) -- bodies unedited, imports point at fwd. NOT taken (they read the tag's step file path `output/steps/N.json` and its nonEmpty gap, which fwd's step, answering through emit_artifact, does not have): 'the whole-field gaps: missing, not-a-list, count-under, count-over, too-many' and 'a non-itemShape gap keeps the sentence it always had'. fwd's own words for the whole-field gaps (file `the answer`) are in test/m19-s5-shape-step.test.js.
// Shape jobs (itemShape), clause 7 "Words": the plain sentence of a bareguard itemShape gap. The gap strings are written here from bareguard's documented red grammar
// (`#<i>:<path>:<reason>`, 0-based item; docs/product/rubric-rules.md at bareguard f712769), never from a live bareguard (the pinned 0.36 has no itemShape): $0.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { plainStepGap } from '../src/rubricstep.js';
import { plainShapeItem, itemFieldOf, parseShapeItem, shapeGapCount } from '../src/shapewords.js';

const gap = (/** @type {any} */ o) => ({ id: 'p1-shape', check: 'itemShape', field: 'results', ...o });
const words = (/** @type {any} */ g) => plainStepGap(2, 'empty', g, null);

test('an item red says item N (1-based), the field and the numbers, never a raw code', () => {
  assert.equal(words(gap({ kind: 'item-shape', items: ['#1:summary:too-long:chars:201>200'] })), 'line 2: item 2: "summary" is too long (201 characters, at most 200)');
  assert.equal(plainShapeItem('#0:blurb:too-long:words:75>60'), 'item 1: "blurb" is too long (75 words, at most 60)');
  assert.equal(plainShapeItem('#0:title:too-short:chars:0<1'), 'item 1: "title" is too short (0 characters, at least 1)');
  assert.equal(plainShapeItem('#2:status:not-one-of'), 'item 3: "status" is not one of the allowed values');
  assert.equal(plainShapeItem('#0:price:bad-money'), 'item 1: "price" is not a money amount as written');
  assert.equal(plainShapeItem('#0:nonstop:wrong-value'), 'item 1: "nonstop" does not have the value the job asks for');
  assert.equal(plainShapeItem('#0:nonstop:wrong-type'), 'item 1: "nonstop" is not the kind of value the job asks for');
  assert.equal(plainShapeItem('#4:link:missing'), 'item 5: "link" is missing');
  assert.equal(plainShapeItem('#0:price:over'), 'item 1: "price" is above the highest value allowed');
  assert.equal(plainShapeItem('#0:departure:bad-time'), 'item 1: "departure" is not a time as written');
});

test('list entries, nested paths, unknown fields and whole-item reds', () => {
  assert.equal(plainShapeItem('#1:tags[2]:too-long:chars:52>40'), 'item 2: "tags, entry 3" is too long (52 characters, at most 40)');
  assert.equal(plainShapeItem('#1:tags[0]:duplicate'), 'item 2: "tags, entry 1" repeats an earlier entry');
  assert.equal(plainShapeItem('#0:tags:count-over:7>5'), 'item 1: "tags" has 7 entries, at most 5 are allowed');
  assert.equal(plainShapeItem('#0:tags:count-under:0<1'), 'item 1: "tags" has 0 entries, at least 1 are required');
  assert.equal(plainShapeItem('#0:unknown-field:color'), 'item 1 has a field "color" that the job does not ask for');
  assert.equal(plainShapeItem('#3:item-not-object'), 'item 4 is not an object with named fields');
  assert.equal(plainShapeItem('#3:unreadable'), 'item 4 could not be read');
  assert.equal(plainShapeItem('#0:address.city:missing'), 'item 1: "address.city" is missing');
});

test('a reason the table does not know is kept in its raw words, never dropped', () => {
  assert.equal(plainShapeItem('#0:x:brand-new-reason'), 'item 1: "x" brand-new-reason');
  assert.equal(plainShapeItem('not an item red'), 'not an item red');
});

test('several item reds are one line each; a cut list says how many more', () => {
  const out = words(gap({ kind: 'item-shape', items: ['#0:title:missing', '#1:title:missing'], itemsTotal: 5 }));
  assert.deepEqual(out.split('\n'), ['line 2: item 1: "title" is missing', 'line 2: item 2: "title" is missing', 'line 2: and 3 more problem(s) in the items']);
});

test('redCount: each item red counts one, a whole-field gap one', () => {
  assert.equal(shapeGapCount(gap({ kind: 'item-shape', items: ['#0:a:missing', '#1:a:missing'] })), 2);
  assert.equal(shapeGapCount(gap({ kind: 'item-shape', items: ['#0:a:missing'], itemsTotal: 40 })), 40);
  assert.equal(shapeGapCount(gap({ kind: 'count-under', measured: 1, limit: 2 })), 1);
});

test('itemFieldOf: the signed field a red names (a list entry and a nested path name their top field)', () => {
  assert.equal(itemFieldOf('#1:tags[2]:duplicate'), 'tags');
  assert.equal(itemFieldOf('#1:address.city:missing'), 'address');
  assert.equal(itemFieldOf('#1:summary:too-long:chars:9>8'), 'summary');
  assert.equal(itemFieldOf('#1:item-not-object'), null);
  assert.equal(itemFieldOf('#1:unknown-field:a:b'), null);
  assert.deepEqual(parseShapeItem('#1:unknown-field:a:b'), { i: 1, path: null, reason: 'unknown-field:a:b' });
});

test('shapeItemOfPlain reads our own sentences back: every reason goes both ways', async () => {
  const { shapeItemOfPlain } = await import('../src/shapewords.js');
  const reds = [
    '#1:summary:too-long:chars:201>200', '#0:blurb:too-long:words:75>60', '#0:title:too-short:chars:0<1', '#0:title:too-short:words:1<3', '#2:status:not-one-of', '#0:price:bad-money', '#0:price:bad-number', '#0:d:bad-date',
    '#0:t:bad-time', '#0:u:bad-url', '#0:nonstop:wrong-value', '#0:nonstop:wrong-type', '#4:link:missing', '#0:price:over', '#0:price:under', '#1:tags[2]:too-long:chars:52>40', '#1:tags[0]:duplicate',
    '#0:tags:count-over:7>5', '#0:tags:count-under:0<1', '#0:tags:too-many:10001>10000', '#0:tags:not-a-list', '#0:tags:unreadable', '#0:unknown-field:color', '#3:item-not-object', '#3:unreadable', '#0:address.city:missing',
  ];
  for (const r of reds) assert.equal(shapeItemOfPlain(plainShapeItem(r)), r, r);
  assert.equal(shapeItemOfPlain('line 1: something else'), null);
});
