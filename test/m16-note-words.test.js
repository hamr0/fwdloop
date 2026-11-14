// M16 P4c: a Not-checked note for a row that has no rule text (a `$` numbers row left with no fact line before it, after an Add then a Drop of a fact) says what the card's own row says,
// never the row's key (`L5.$numbers`). The words come from renderCard (src/checkblock.js CARD_T); no new wording.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { newJobBlock } from '../src/blocklines.js';
import { renderCard, CARD_T } from '../src/checkblock.js';
import { assembleFromBlock } from '../src/blockassemble.js';

const NOTES = 'Tomatoes by the fence. Raised bed by the fence needs soil.';
const jobLines = [
  { n: 1, text: 'Write 3 lines about my garden from the notes', rules: [] },
  { n: 2, text: 'List 3 jobs for this week from the notes', rules: [] },
  { n: 3, text: 'Write a short closing note to my neighbour', rules: [] },
];
const lines = jobLines.map((l) => ({ n: l.n, guardrail: '' }));
const decl = {
  steps: jobLines.map((l) => ({ primitives: ['read'], reads: [], emits: `o${l.n}`, fromLine: l.n, close: { class: 'hitl' } })),
  guardrailClasses: {}, unjudgeable: {}, refused: [],
};

test('Add then Drop of a fact: the numbers row left behind is told in the card\'s words, with no `L<n>.` key in any note', () => {
  const block = newJobBlock({ texts: { notes: NOTES }, jobLines });
  block.applyDelta({ label: 'pre:ledger-suggest', pre: true, edits: [{ op: 'add', kind: 'phrase', line: 2, name: 'raised bed', words: ['Raised bed by the fence'], source: 'notes' }] });
  block.reconcile();
  const key = 'L2.phrase.raised bed by the fence';
  const added = block.rowChoice(key, 'add');
  assert.equal(added.ok, true, JSON.stringify([added, block.rows.map((r) => [r.key, r.state, r.reason])]));
  assert.ok(block.rows.some((r) => r.kind === 'numbers' && r.state === 'built'), 'the numbers tie exists while the fact is on');
  assert.equal(block.rowChoice(key, 'drop').ok, true);
  const out = assembleFromBlock({ declaration: decl, block, lines, lineSet: new Set([1, 2, 3]) });
  const numbers = block.rows.find((r) => r.kind === 'numbers');
  assert.equal(numbers?.state, 'not-checked', 'the stale row is what the walk saw (bareloop keeps it)');
  const cardWords = renderCard([numbers]).at(0).text.slice(2);
  assert.ok(cardWords.startsWith(CARD_T.numbers), cardWords);
  const note = out.notChecked.find((n) => /number/.test(n));
  assert.ok(note, JSON.stringify(out.notChecked));
  assert.ok(note.includes(cardWords), `the note does not use the card's words: ${note}`);
  for (const n of out.notChecked) assert.ok(!/\bL\d+\./.test(n), `a raw row key reached a note: ${n}`);
  assert.ok(Object.hasOwn(out.notCheckedBy, note), 'its tag is kept under the same line');
});
