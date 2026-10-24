// M8 amendment 3 (signed 2026-10-23): a NEVER FIXED note is kept; the too-thin drop applies to FIXED cards only.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { emptyLedger, countLedger, renderHints } from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';

const DAY = 86_400_000;

test('M8 am3: a thin NEVER FIXED card (kind other, no fix files) is kept and the hint says "got stuck here, never fixed"', () => {
  const b = cardsOf('mties136', { audit: [] });
  const c = b.cards.find((x) => x.kind === 'NEVER_FIXED');
  assert.ok(c, 'the thin NEVER FIXED card is carried');
  assert.deepEqual([c.kinds, c.fixTouched], [['other'], []]);
  const ctx = { workflow: c.job, place: null, specHash: null, now: new Date(new Date(c.at).getTime() + DAY) };
  const L = countLedger(emptyLedger(), { runid: c.runid, cards: b.cards, workflow: c.job, place: null, specHash: null, trust: 'deterministic', now: ctx.now });
  assert.equal(L.rows.length, 1, 'it folds into the ledger');
  const r = renderHints(L, ctx);
  assert.ok(r.text.includes('got stuck here, never fixed'), r.text);
  assert.ok(r.text.includes(c.check), r.text);
});

test('M8 am3: a thin FIXED card is still dropped and counted in `thin` (and only it)', () => {
  const b = cardsOf('mties136', { audit: [] });
  assert.equal(b.cards.filter((x) => x.kind === 'FIXED').length, 0, 'the FIXED tree-changed card has no fix files: dropped');
  assert.equal(b.thin, 1, 'one thin FIXED card; the NEVER FIXED one is not in the count');
});
