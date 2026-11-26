// M19 amendment 3 (docs/wiki/the-module-ladder.md, last block): copy loop, no can't-check ask. A `~` rule code cannot check, with no tied fact and no count proposal, is Not checked with
// NO question (bareloop v0.61.0 src/checkblock.js matchRule / matchCountRule), so the shape look can take it. The reading ask and the count-check ask stay.
// F234 (docs/logs/FINDINGS.md). $0: the block, the real drafter with the fake provider, and the real panel door with the real `fwdloop draft` child. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CheckBlock } from '../src/checkblock.js';
import { REASON } from '../src/reasons.js';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { settle, childGone, state, readJsonIn, JOB as TRACKER_JOB, RAW_OWNER } from './m19-s9-world.mjs';
import { writeFileSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

killChildrenAfter();
const FX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'shape-contested');

// must fail (M19 am3): a draft asks "I can't check this" about a `~` rule. Red when src/checkblock.js matchRule or matchCountRule sets `ask: 'cant-check'` again.
test('(1) a rule code cannot check, asked or not: with asks on there is no open question and the rule is Not checked with code\'s reason', () => {
  for (const asks of [true, false]) {
    const b = new CheckBlock({ texts: { f: 'x y z' }, labels: ['f'], asks });
    b.fromJob([{ n: 1, text: 'Say it', rules: ['be nice', 'sounds human'] }]); b.reconcile();
    assert.deepEqual(b.open, [], `asks ${asks}: nothing is asked`);
    const rules = b.rows.filter((r) => r.kind === 'rule');
    assert.equal(rules.length, 2);
    assert.ok(rules.every((r) => r.can?.ok === false && r.can.ask === undefined && r.can.why === REASON.noPick), JSON.stringify(rules.map((r) => r.can)));
    assert.deepEqual(b.shapeCandidates().map((c) => c.rule), [1, 2], 'and so the shape look may take both');
  }
});

// red when matchCountRule's last branch sets `ask: 'cant-check'` again (a count-scope rule with no proposal and no obvious check)
test('(1b) a countable rule with no count proposal is Not checked with no question either', () => {
  const b = new CheckBlock({ texts: { f: 'x' }, labels: ['f'], asks: true, countScope: () => true });
  b.fromJob([{ n: 1, text: 'Summarise it', rules: ['two or three bullets', 'a few bullets'] }]); b.reconcile();
  assert.deepEqual(b.open.filter((q) => q.ask === 'cant-check'), []);
  assert.deepEqual(b.rows.filter((r) => r.kind === 'rule').map((r) => [r.can?.ask, r.can?.why]), [[undefined, REASON.noPick], [undefined, REASON.noPick]]);
});

// the asks that stay (am3 "The reading ask and the count-check ask stay"): red if the change took either away
test('(3) the reading ask and the count-check ask are unchanged', () => {
  const b = new CheckBlock({ texts: { f: 'x' }, labels: ['f'], asks: true });
  b.fromJob([{ n: 1, text: 'Summarise it', rules: ['exactly 3 bullets', 'under 80 words', 'be nice'] }]); b.reconcile();
  const kinds = b.open.map((q) => [q.ruleText, q.ask]).sort();
  assert.deepEqual(kinds, [['exactly 3 bullets', 'check'], ['under 80 words', 'check']], 'a count proposal is still asked; "be nice" is not');
  const q = b.open.find((x) => x.ruleText === 'under 80 words');
  assert.equal(q?.proposal != null, true);
});

test('(2) the research-tracker job: its three `~` rules are shape candidates on the FIRST draft (no can\'t-check ask), the shape look runs, and the draft ends with shape rows', async () => {
  const w = await world({ extraEnv: {} });
  w.env.FWDLOOP_TEST_DRAFT_SHAPE = RAW_OWNER;
  writeFileSync(path.join(w.inDir, 'tracker.txt'), readFileSync(path.join(FX, 'research-tracker.txt'), 'utf8'));
  const id = (await w.post('/api/author/draft', w.card({ job: TRACKER_JOB }))).json().draftId;
  const g = await settle(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', `no can't-check question stops it: ${JSON.stringify(g.questions ?? g.reds ?? g)}`);
  assert.equal((await state(w, id)).total ?? 0, 0);
  const log = readJsonIn(w, id, 'draft/log.json');
  assert.ok(log.log.some((e) => e.kind === 'shape-map'), `the shape look ran: ${JSON.stringify(log.log.map((e) => e.kind))}`);
  const close = readJsonIn(w, id, 'draft/declaration.json').steps.find((x) => x.fromLine === 3).close;
  assert.deepEqual(close.itemShape.fields.map((x) => x.rule), [1, 2, 3], 'the draft ends with shape rows for all three `~` rules');
});
