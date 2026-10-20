// src/pagebits.js countPhrase is bareloop's whole-word counter rewritten without `new RegExp(` (this repo bans it in src/, test/signed-text.test.js).
// It must count exactly what bareloop's regex version counts: checked against that regex, kept here as the oracle.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { countPhrase, squash } from '../src/pagebits.js';

const loose = (t) => squash(t).replace(/[*_`]/g, '').trim().toLowerCase();
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function oracle(source, words) {
  const w = loose(words);
  if (w === '') return 0;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${esc(w)}(?=$|[^\\p{L}\\p{N}])`, 'gu');
  let n = 0;
  for (const _m of loose(source).matchAll(re)) n += 1;
  return n;
}

test('countPhrase counts whole words exactly as the regex it replaces', () => {
  const sources = [
    'SFO is not found inside sfocus, but SFO and sfo and (SFO) are', 'a a a', 'aa a aa', ':: ::', 'x:x', 'Nonstop\nNonstop flight  nonstop', '',
    '  From 144 US dollars\n From 150 US dollars', 'Flight 7, Flight 77, Flight 7.', '😀 ok 😀ok ok😀', 'ß straße STRASSE', '*bold* `code` _under_',
    'Departure time: 5:00 PM  Departure time: 6:00 PM', 'one-way one way one_way',
  ];
  const words = ['SFO', 'a', 'aa', ':', 'x', 'Nonstop', 'US dollars', 'Flight 7', '7', 'ok', '😀', 'ß', 'bold', 'code', 'Departure time:', 'one way', 'zzz', ' ', ''];
  for (const s of sources) for (const w of words) assert.equal(countPhrase(s, w), oracle(s, w), JSON.stringify([s, w]));
});
