// M19 S3 (shape rows in the one check block): setShape on a fixture gives [you] / [agent] / [default] rows, a Drop is kept for a Revise (`shapeDropped` in the picks record, no new file), a block with no shape is what it was.
// The tests of bareloop v0.61.0 (tests/shape-rows.test.js, tests/shape-combined.test.js) are not taken here: they need pieces of S5 and S6 that are not built (the shape part in rubricStepShapeReds, buildStepSpec, lineBriefs, gradeStep, cardOfClose and the `$prose` row).
// So this file asserts the rows and the Drop record only, never the built shape part (S5 built it: the step validator takes the shape part).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CheckBlock, REASON } from '../src/checkblock.js';
import { buildShapes } from '../src/shapebuild.js';
import { readShapeDropped, RECORD_FILE } from '../src/pickrecord.js';

const NR = { max: 128, forbidden: ['.', ':', '[', ']'], reserved: null };
const TEXT = 'Resume of Ada. Skills: python, sql. Resume of Alan. Skills: logic.';
const LINES = [
  { n: 1, text: 'Write one summary per page for the airline', rules: ['the blurb is under 60 words', 'matching words is a list of at most 5 words', 'the candidate has a name'] },
  { n: 2, text: 'Find the lowest price', rules: [] },
];
const f = (/** @type {any} */ o) => ({ required: true, bounds: {}, fromRule: null, ...o });
const SUGGEST = {
  line: 1,
  fields: [
    f({ name: 'blurb', kind: 'text', bounds: { maxWords: 59 }, fromRule: 1 }),
    f({ name: 'matching', kind: 'list', bounds: { of: 'text', maxEntries: 5 }, fromRule: 2 }),
    f({ name: 'name', kind: 'text', bounds: { minChars: 1 }, fromRule: 3 }),
  ],
  extraFields: [f({ name: 'airline', kind: 'text', required: false }), f({ name: 'duration', kind: 'text', required: false })],
  itemCountFrom: ['page'],
};
const mk = () => {
  const b = new CheckBlock({ texts: { page: TEXT }, labels: ['page'], asks: false, split: true });
  b.fromJob(LINES);
  b.setGuards(['changed-from-seed'], ['output/']);
  b.reconcile();
  return b;
};
const shaped = (/** @type {CheckBlock} */ b) => { b.setShape(buildShapes({ lines: LINES.filter((l) => l.rules.length > 0), labels: ['page'], suggestions: [SUGGEST], nameRules: NR })); return b; };
const row = (/** @type {CheckBlock} */ b, /** @type {string} */ key) => b.rows.find((r) => r.key === key);

test('setShape gives a [you] row per rule that took a field, an [agent] row per extra field (a word of the job: on; none: Suggested) and one [default] row for the item count', () => {
  const b = shaped(mk());
  assert.equal(b.isShapeLine(1), true);
  assert.equal(b.isShapeLine(2), false);
  assert.deepEqual(b.rows.filter((r) => r.kind === 'rule').map((r) => [r.key, r.by, r.can?.how]), [['L1.~1', 'you', 'shape'], ['L1.~2', 'you', 'shape'], ['L1.~3', 'you', 'shape']]);
  const air = row(b, 'L1.shape.airline');
  assert.deepEqual([air?.by, air?.from, air?.kind, air?.held], ['agent', 'agent', 'shape', false], 'a word of the job line: on');
  const dur = row(b, 'L1.shape.duration');
  assert.deepEqual([dur?.by, dur?.state, dur?.reason, dur?.held], ['agent', 'suggested', REASON.suggested, true], 'no word of the job: Suggested');
  const def = row(b, 'L1.$shape');
  assert.deepEqual([def?.by, def?.from, def?.kind], ['default', 'default', 'shape'], 'the item count the person\'s words gave');
  assert.deepEqual(b.suggestedView().map((s) => s.key), ['L1.shape.duration']);
});

test('a block with no shape set is what it was: no shape row, no shape line, no candidate left over from nothing', () => {
  const b = mk();
  assert.equal(b.rows.some((r) => r.kind === 'shape'), false);
  assert.equal(b.isShapeLine(1), false);
  assert.equal(b.shapeDroppedRecord().length, 0);
  assert.deepEqual(b.shapeCandidates().map((c) => c.rule), [1, 2, 3], 'the rules no truth check took are the only ones the shape look would be asked about');
});

test('Drop and Add on an [agent] field and Drop of a rule\'s own field cost no AI; the record keeps them by the line\'s words, and a Revise (a new block on the same job) carries them', () => {
  const b = shaped(mk());
  // S5: the line's shape part is built (the step validator takes it), so an [agent] field is on the card and its Drop is taken
  assert.deepEqual(b.rowChoice('L1.shape.airline', 'drop'), { ok: true });
  assert.equal(row(b, 'L1.shape.airline')?.state, 'suggested');
  assert.deepEqual(b.rowChoice('L1.~1', 'drop'), { ok: true });
  assert.equal(row(b, 'L1.~1')?.reason, REASON.dropped);
  assert.deepEqual(b.droppedRulesView().map((x) => x.key), ['L1.~1']);
  const rec = b.shapeDroppedRecord();
  assert.deepEqual(rec, [
    { lineWords: 'write one summary per page for the airline', occurrence: 0, name: 'airline' },
    { lineWords: 'write one summary per page for the airline', occurrence: 0, rule: 1 },
  ]);
  const b2 = mk();
  b2.carryShapeDropped(JSON.parse(JSON.stringify(rec)));
  shaped(b2);
  assert.equal(row(b2, 'L1.shape.airline')?.choice, 'drop', 'the same field is still dropped after a Revise');
  assert.equal(row(b2, 'L1.~1')?.reason, REASON.dropped, 'the same rule is still dropped');
  assert.equal(row(b2, 'L1.~2')?.can?.how, 'shape');
  assert.deepEqual(b2.shapeDroppedRecord(), rec);
  // Add back undoes a rule's Drop; a Drop that is not there is refused in the tag's words
  assert.deepEqual(b2.rowChoice('L1.~1', 'add'), { ok: true });
  assert.equal(row(b2, 'L1.~1')?.can?.how, 'shape');
  assert.deepEqual(b2.rowChoice('L1.~1', 'add'), { ok: false, why: 'that check is already on the card' });
  assert.equal(b2.shapeDroppedRecord().some((d) => d.rule === 1), false);
});

test('the Drop record round-trips through the picks record file beside the sheet\'s (no new file); a malformed entry is not read', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwd-m19-s3-'));
  try {
    const file = path.join(dir, RECORD_FILE);
    writeFileSync(file, JSON.stringify({ picks: [], shapeDropped: [{ lineWords: 'a b', occurrence: 0, name: 'x' }, { lineWords: 'a b', occurrence: 1, rule: 2 }, { lineWords: 'a b', occurrence: 'no', name: 'y' }, { lineWords: 'a b', occurrence: 0 }, null] }));
    assert.deepEqual(readShapeDropped(file), [{ lineWords: 'a b', occurrence: 0, name: 'x' }, { lineWords: 'a b', occurrence: 1, rule: 2 }]);
    writeFileSync(file, JSON.stringify({ picks: [] }));
    assert.equal(readShapeDropped(file), null, 'no shapeDropped is no record');
    assert.equal(readShapeDropped(path.join(dir, 'missing.json')), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
