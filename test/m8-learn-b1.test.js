// M8 piece 1, tests that are ours (not borrowed): B1 on real fwdloop gap lines, and the no-model import closure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { flaggedText, flaggedTokens, cardsMatch, emptyLedger, countLedger } from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';

const GAP = (n) => `${n} words, limit 600; no line is exactly the heading "Work History" (a heading is a line that is only that text, optionally after #)`;
const NOW = new Date('2026-10-23T12:00:00Z');

// A real archived card, its record fields replaced by a fwdloop gap line (the edit is the point of the test).
const [base] = cardsOf('mties136').cards;
const card = (runid, n) => ({
  ...base, id: `${runid}:cv-words:stuck`, runid, job: 'aging-1', check: 'cv-words (line 4, words)', kinds: ['other'],
  said: [GAP(n)], tokens: flaggedTokens(GAP(n)), at: '2026-10-22T10:00:00Z',
});

test('B1: a plain gap line is flagged text (a fwdloop gap line IS the check red line)', () => {
  assert.equal(flaggedText(GAP(1357)), GAP(1357));
  assert.equal(flaggedText('   '), null);
  assert.equal(flaggedText(''), null);
});

test('B1: the 1357-word and the 1889-word red of the same job and check are one lesson, counted twice over two runs', () => {
  const a = card('run-1', 1357);
  const b = card('run-2', 1889);
  assert.ok(a.tokens.length > 0 && b.tokens.length > 0);
  assert.equal(cardsMatch(a, b).match, true);
  let L = emptyLedger();
  L = countLedger(L, { runid: 'run-1', cards: [a], workflow: 'aging-1', place: null, specHash: 'h1', trust: 'deterministic', now: NOW });
  L = countLedger(L, { runid: 'run-2', cards: [b], workflow: 'aging-1', place: null, specHash: 'h1', trust: 'deterministic', now: NOW });
  assert.equal(L.rows.length, 1);
  assert.equal(L.rows[0].count, 2);
});

test('no model: src/learn.js import closure reaches no provider, fetch, http, https or net module', () => {
  const src = dirname(dirname(fileURLToPath(import.meta.url)));
  const seen = new Set();
  const bad = [];
  const BANNED = /^(?:node:)?(?:http|https|net|tls|dgram|http2|child_process)$|fetch|provider|bare-?agent|openai|anthropic/i;
  const walk = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (BANNED.test(spec)) bad.push(`${file} imports ${spec}`);
      if (spec.startsWith('.')) walk(join(dirname(file), spec));
    }
  };
  walk(join(src, 'src', 'learn.js'));
  assert.ok(seen.size >= 2, 'the walk really followed learn.js to redact.js');
  assert.deepEqual([...seen].map((f) => f.slice(src.length + 1)).sort(), ['src/learn.js', 'src/redact.js']);
  assert.deepEqual(bad, []);
});
