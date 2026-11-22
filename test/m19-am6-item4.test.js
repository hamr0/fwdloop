// M19 am6 item 4 (docs/wiki/the-module-ladder.md): the word copies `grown`, `oneOf`, `after` are removed once nothing reads them (F244). Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildReadout } from '../src/authoring.js';
import { CheckBlock } from '../src/checkblock.js';

const arbiter = { capUsd: 0.3, sources: [], asks: [], sends: [] };
const lines = [{ n: 1, text: 'Find the heading.' }, { n: 2, text: 'Write a note about it.' }];

test('the readout of a plan with no saved card tells the numbers row in the signed am7 words (break: numbersWords in src/checkrows.js is read there)', () => {
  const declaration = {
    inputFacts: {}, refused: [],
    steps: [
      { fromLine: 1, goal: lines[0].text, primitives: ['read'], reads: [], emits: 'o1', close: { class: 'hitl' } },
      { fromLine: 2, goal: lines[1].text, primitives: ['read'], reads: [], emits: 'o2', close: { class: 'hitl', numbersFrom: [1] } },
    ],
    checkList: [{ key: 'L2.$numbers', line: 2, kind: 'numbers', state: 'built', by: 'default' }],
  };
  const t = buildReadout({ declaration, arbiter, lines, name: 'j', modelId: 'm', costUsd: 0, rounds: 1, spendComplete: true });
  assert.ok(t.includes('every number in the text is in a quote checked on line 1'), t);
  assert.ok(!t.includes('checked quote of line'), 'the old words are gone');
});

test('no block row holds `grown`, `oneOf` or `after` after buildLine (break: buildLine writes the copies)', () => {
  const TEXT = '## [0.54.1] - 2026-11-04\n### Fixed\n- one\n- two\n';
  const b = new CheckBlock({ texts: { Changelog: TEXT }, labels: ['Changelog'], asks: true });
  // F251: line 1 has a ~ rule of the person's, so its look facts are signable and the numbers tie on line 2 exists
  b.fromJob([{ n: 1, text: 'Find the heading', rule: 'must name the heading', rules: ['must name the heading'] }, { n: 2, text: 'Summarise it', rules: [] }]);
  b.addLook([
    { line: 1, name: 'release heading', shape: 'phrase', source: 'Changelog', words: ['### Fixed'] },
    { line: 1, name: 'place', shape: 'phrase', source: 'Changelog', words: ['## [0.54.1]'], phrases: ['## [0.54.1]', '### Fixed'] },
  ], []);
  b.reconcile();
  assert.ok(b.rows.some((r) => r.kind === 'numbers'), 'the fixture has a numbers row (so the test can fail)');
  for (const r of b.rows) for (const k of ['grown', 'oneOf', 'after']) assert.ok(!(k in r) || r[k] === undefined, `${r.key} holds ${k}`);
});
