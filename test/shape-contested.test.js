// borrowed-from: bareloop tests/shape-contested.test.js@v0.61.0 (fc56e1f3) -- body unedited except the last three lines of the first test (the built shape part in closeView: it waits for S5, the shape part in the close, not built yet); imports point at fwd's files
// Contested rule (hamr 2026-11-19, live run mwndngl5, session smwndm6b9w6ee): the look tied a "Notes:" fact to "line 1 rule 3" AND listed that same rule under "cannot". Real page-map and shape-map answers and the
// tracker text are copied under tests/fixtures/shape-contested/ ($0, no provider). The contested rule must stay a shape candidate and take the real shape field (maxChars); rules 1 and 2 are unchanged.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CheckBlock } from '../src/checkblock.js';
import { buildShapes } from '../src/shapebuild.js';
import { parseMapAnswer } from '../src/pagemap.js';
import { applyPageRules } from '../src/pagerules.js';

const D = new URL('./fixtures/shape-contested/', import.meta.url);
const read = (/** @type {string} */ f) => readFileSync(new URL(f, D), 'utf8');
const TEXT = read('research-tracker.txt');
const LINES = [{ n: 1, text: 'List every research item in the tracker, one entry each', rules: ['each item has a title', 'status is one of in progress, closed, finished', 'summary is under 200 characters'] }];
const NR = { max: 128, forbidden: ['.', ':', '[', ']'], reserved: null };

function draft(/** @type {any} */ mutate = (m) => m) {
  const parsed = /** @type {any} */ (parseMapAnswer(read('page-map.raw.json')));
  assert.equal(parsed.ok, true);
  const mapping = mutate(parsed.mapping);
  const kept = applyPageRules(TEXT, mapping, LINES);
  const b = new CheckBlock({ texts: { tracker: TEXT }, labels: ['tracker'], asks: false, split: true });
  b.fromJob(LINES);
  b.setGuards(['changed-from-seed'], ['output/']);
  b.addLook(kept.facts.map((/** @type {any} */ f) => ({ ...f, source: 'tracker' })), kept.dropped);
  b.reconcile();
  return b;
}

test('the real look names rule 3 in a fact AND in "cannot": rule 3 is a shape candidate, and takes the real shape-map field with maxChars', () => {
  const b = draft();
  const cands = b.shapeCandidates().map((x) => x.rule);
  assert.ok(cands.includes(3), `rule 3 is contested, so it must be a shape candidate; candidates were [${cands}]`);
  const sug = JSON.parse(read('shape-map.raw.json')).shapes[0];
  b.setShape(buildShapes({ lines: LINES, labels: ['tracker'], suggestions: [sug], nameRules: NR }));
  b.reconcile();
  const r3 = b.rows.find((r) => r.key === 'L1.~3');
  assert.equal(r3?.can?.how, 'shape');
});

test('rules 1 and 2 are unchanged: rule 2 keeps its status-words truth check (not a candidate), rule 1 stays a candidate', () => {
  const cands = draft().shapeCandidates().map((x) => x.rule);
  assert.ok(!cands.includes(2));
  assert.ok(cands.includes(1));
  assert.equal(draft().rows.find((r) => r.key === 'L1.~2')?.can?.how, 'fact');
});

test('a "cannot" naming only the whole line contests no rule: rule 3 with no rule-3 cannot keeps its fact check', () => {
  const b = draft((/** @type {any} */ m) => ({ ...m, cannot: m.cannot.filter((/** @type {any} */ c) => c.from !== 'line 1 rule 3') }));
  assert.ok(!b.shapeCandidates().some((x) => x.rule === 3));
  assert.equal(b.rows.find((r) => r.key === 'L1.~3')?.can?.how, 'fact');
});
