import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  closeByClass, closeGreen, closeSoftgreen, closeWordsAndSections, closeLinesAndCarry,
} from '../src/closers.js';

const AGING = {
  kind: 'cells',
  rows: [
    { rowNumber: 2, cells: { A: 'Acme Corp', B: 'INV-1', C: '2026-05-01', D: '2026-05-15', E: '150.00' } },
    { rowNumber: 3, cells: { A: 'Acme Corp', B: 'INV-2', C: '2026-05-05', D: '2026-05-20', E: '50.50' } },
  ],
};

test('closeGreen: a field whose cite resolves to the same value is green', () => {
  const artifact = { fields: { total: { value: 150, cite: 'aging!E2' } } };
  const verdict = closeGreen(artifact, { reads: { aging: AGING }, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'green');
});

test('closeGreen: a field whose stated value disagrees with its cite is red, naming the field', () => {
  const artifact = { fields: { total: { value: 999, cite: 'aging!E2' } } };
  const verdict = closeGreen(artifact, { reads: { aging: AGING }, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'red');
  assert.match(verdict.red, /"total" 999.*aging!E2 = 150/);
});

test('closeGreen: a sum formula over two cell cites resolves correctly', () => {
  const artifact = { fields: { total_owed: { value: 200.5, cite: 'sum(aging!E2,aging!E3)' } } };
  const verdict = closeGreen(artifact, { reads: { aging: AGING }, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'green');
});

test('closeGreen: a field ref (#name) chains to an earlier resolved field', () => {
  const artifact = {
    fields: {
      a: { value: 150, cite: 'aging!E2' },
      b: { value: 50.5, cite: 'aging!E3' },
      total: { value: 200.5, cite: 'sum(#a,#b)' },
    },
  };
  const verdict = closeGreen(artifact, { reads: { aging: AGING }, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'green');
});

test('closeGreen: daysBetween(cite) against businessDate', () => {
  const artifact = { fields: { days_overdue: { value: 17, cite: 'daysBetween(aging!D2)' } } };
  const verdict = closeGreen(artifact, { reads: { aging: AGING }, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'green');
});

test('closeGreen: an artifact with no fields is unparseable, not red', () => {
  const verdict = closeGreen({ fields: {} }, { reads: {}, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'unparseable');
});

test('closeGreen: a non-object artifact is unparseable', () => {
  const verdict = closeGreen('nope', { reads: {}, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'unparseable');
});

test('closeWordsAndSections: reports EVERY failing check, not just the first (F38)', () => {
  const text = 'one two three\n## Wrong Heading\nfour';
  const verdict = closeWordsAndSections(text, { maxWords: 2, sections: ['summary', 'skills'] });
  assert.equal(verdict.verdict, 'red');
  assert.equal(verdict.reds.length, 3);
});

test('closeLinesAndCarry: every mustCarry string must appear in each block', () => {
  const text = 'INV-1 due 2026-05-15 amount 150\nINV-2 due 2026-05-20 amount 50.50';
  const reds = closeLinesAndCarry(text, { linesPerInvoice: 1, mustCarry: ['Invoice #', 'Due date', 'Amount'] });
  assert.ok(reds.length > 0);
  assert.match(reds[0], /Invoice #/);
});

test('closeSoftgreen: a softgreen artifact must be {text: string}', () => {
  const verdict = closeSoftgreen({ nope: 1 }, { maxWords: 10, sections: [] });
  assert.equal(verdict.verdict, 'unparseable');
});

test('closeByClass: hitl renders no mechanical judgment', () => {
  const verdict = closeByClass({ close: { class: 'hitl' } }, { text: 'x' }, { reads: {}, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'hitl');
});

test('closeByClass: an unknown class is a crash, never a silent pass', () => {
  const verdict = closeByClass({ close: { class: 'bogus' } }, {}, { reads: {}, businessDate: '2026-06-01' });
  assert.equal(verdict.verdict, 'crash');
});
