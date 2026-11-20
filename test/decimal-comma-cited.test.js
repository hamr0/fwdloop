// F228 dell-1: a page that writes prices with a decimal comma ("1.058,47 €", fact `decimal: ","`) must be green in fwd's own fact check (src/citedcheck.js checkCited, the as-written second pass
// borrowed from bareloop v0.61.0). The answer, page and part are the tag's tests/fixtures/shape-combined/dell-1.* saved under test/fixtures/decimal-comma/. No itemShape: the fact check alone.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { closeByClass } from '../src/closers.js';

const dir = new URL('./fixtures/decimal-comma/', import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, dir), 'utf8');

async function grade(/** @type {(a: any) => void} */ mutate = () => {}) {
  const c = JSON.parse(read('dell-1.part.json'));
  const input = read('dell-1.input.txt');
  const answer = JSON.parse(read('dell-1.answer.json'));
  answer.done = true; answer.blocker = null;
  mutate(answer);
  const cited = { source: c.part.source, facts: c.part.facts, ...(c.part.count ? { count: c.part.count } : {}) };
  const step = { fromLine: 1, close: { class: 'green', cited } };
  const source = { ok: true, text: input, sha256: createHash('sha256').update(input).digest('hex') };
  return closeByClass(step, answer, { reads: {}, businessDate: '2026-11-20', source });
}

test('the real F228 dell-1 answer (decimal-comma prices) is green through closeByClass', async () => {
  const v = await grade();
  assert.equal(v.verdict, 'green', String(v.red));
});

test('a made-up quote on the same page is still red', async () => {
  const v = await grade((a) => { a.results[0].quote = 'this sentence is not anywhere on the saved page'; });
  assert.equal(v.verdict, 'red');
  assert.match(String(v.red), /not found word for word/);
});
