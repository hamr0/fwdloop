import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeByClass, closeSoftgreen,
} from '../src/closers.js';

test('closeSoftgreen: reports EVERY failing check, not just the first (F38)', async () => {
  const text = 'one two three\n## Wrong Heading\nfour';
  const verdict = await closeSoftgreen({ text }, { maxWords: 2, sections: ['summary', 'skills'] });
  assert.equal(verdict.verdict, 'red');
  assert.equal(verdict.reds.length, 3);
});

test('closeSoftgreen: every mustCarry string must appear in each block', async () => {
  const text = 'INV-1 due 2026-05-15 amount 150\nINV-2 due 2026-05-20 amount 50.50';
  const { reds } = await closeSoftgreen({ text }, { linesPerInvoice: 1, mustCarry: ['Invoice #', 'Due date', 'Amount'] });
  assert.ok(reds.length > 0);
  assert.match(reds[0], /Invoice #/);
});

test('closeSoftgreen: a softgreen artifact must be {text: string}', async () => {
  const verdict = await closeSoftgreen({ nope: 1 }, { maxWords: 10 });
  assert.equal(verdict.verdict, 'unparseable');
});

test('closeByClass: hitl renders no mechanical judgment', async () => {
  const verdict = await closeByClass({ close: { class: 'hitl' } }, { text: 'x' }, { reads: {}, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'hitl');
});

test('closeByClass: an unknown class is a crash, never a silent pass', async () => {
  const verdict = await closeByClass({ close: { class: 'bogus' } }, {}, { reads: {}, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'crash');
});

test('closeSoftgreen: an extra key (e.g. lines) is red by name, even when the text is fine', async () => {
  const v = await closeSoftgreen({ text: 'hello', lines: ['the real answer'] }, { maxWords: 10 });
  assert.equal(v.verdict, 'red');
  assert.match(v.red, /"lines"/);
  assert.equal((await closeSoftgreen({ text: 'hello' }, { maxWords: 10 })).verdict, 'green');
});

// M10b piece 5 (item 8): the cell cite retired. A green step with neither close.cited nor close.sheet never closes green (a job signed that way is refused at start).
test('closeByClass: a green step with no close.sheet or close.cited is a crash, never a silent pass', async () => {
  const verdict = await closeByClass({ close: { class: 'green' } }, { fields: { t: { value: 1, cite: 'aging!E2' } } }, { reads: {}, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'crash');
  assert.match(verdict.red, /retired cell cite/);
});
