// M16 P3 S1-S3 at the drafter (docs/wiki/the-module-ladder.md, "M16"): with `checkList: true` the draft builds the check block over the job's STEP lines after the page and sheet looks,
// the one suggest call becomes `pick` pre-edits of the block, the block's asks are merged with the sheet's and the look's under one cap, and the person's answers ride the redraft.
// Stub providers that answer by tool name, $0, no network. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft, hideCounts } from '../src/drafter.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { rd, callOf, router, walkProse } from './m16-drafter-fixture.mjs';

const SUGGEST_BOTH = callOf('suggest_checks', { checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }, { line: 5, guardrail: 1, rule: 'maxWords', value: 80 }] });
const run = (/** @type {any} */ provider, /** @type {string} */ proseText, /** @type {any} */ extra = {}) => draft({ proseText, provider, rates: RATES, modelId: MODEL, checkList: true, ...extra });

test('(S1+S2) m14-walk-5: the block is built over the step lines only and the suggest reply is its pick pre-edit, asked as a proposal', async (t) => {
  const p = router({ suggest_checks: SUGGEST_BOTH });
  const r = await run(p, walkProse(t));
  assert.equal(r.stop, 'look-asks');
  assert.deepEqual(p.names(), ['suggest_checks'], 'one paid call before the asks');
  // rows exist for the step lines 1, 3, 5 and for no ask (2, 4, 6) or send (7) line
  assert.deepEqual([...new Set(r.checkRows.map((/** @type {any} */ x) => x.line))].sort(), [1, 3, 5]);
  assert.ok(r.checkRows.some((/** @type {any} */ x) => x.key === 'L3.~1' && x.rowKind === 'rule'));
  assert.ok(!r.checkRows.some((/** @type {any} */ x) => x.rowKind === 'cited'), 'am1: no cited default');
  // the pick pre-edit reached the block: the asks are the block's proposals (code's words), not a "can't check"
  assert.deepEqual(r.questions.map((/** @type {any} */ q) => [q.line, q.ask, q.ruleNo, q.proposal, q.check]), [[3, 'check', 1, 'exactly 3 list items', { rule: 'listItems', value: 3 }], [5, 'check', 1, 'at most 80 words', { rule: 'maxWords', value: 80 }]]);
  assert.match(r.questions[0].question, /^Line 3, guardrail "exactly 3 bullets": I propose exactly 3 list items\./);
  assert.equal(r.log[0].kind, 'check-suggest');
  assert.equal(p.calls[0].options.thinkingMode, 'off');
  assert.deepEqual(p.calls[0].options.toolChoice, { name: 'suggest_checks' });
  assert.ok(r.costUsd > 0 && r.spendComplete === true && r.rounds === r.calls, 'every round is metered');
});

test('(S1) off by default: the same job drafts as before (no block rows, the asks are the old path\'s)', async (t) => {
  const p = router({ suggest_checks: SUGGEST_BOTH });
  const r = await draft({ proseText: walkProse(t), provider: p, rates: RATES, modelId: MODEL });
  assert.equal(r.stop, 'look-asks');
  assert.equal(r.checkRows, undefined);
  assert.deepEqual(r.questions.map((/** @type {any} */ q) => [q.line, q.ask]), [[3, 'check'], [5, 'check']]);
});

test('(S1) hideCounts: the lines the block takes show their count rules to the page look; every other line is hidden as before', () => {
  const lines = [{ n: 1, text: 'a', rule: 'under $150; exactly 3 bullets' }, { n: 2, text: 'b', rule: 'under 80 words' }];
  assert.deepEqual(hideCounts(lines).seenLines.map((l) => l.rule), ['under $150', undefined]);
  const shown = hideCounts(lines, new Set([1]));
  assert.deepEqual(shown.seenLines.map((l) => l.rule), ['under $150; exactly 3 bullets', undefined]);
  assert.equal(shown.toOriginal({ line: 1, forRule: 2 }).forRule, 2, 'a shown line keeps its own rule numbers');
});

test('(S3) the asks are capped: four rules code cannot check stop at $0 with the rewrite list; three are asked', async (t) => {
  const job = (rules) => ['Write the first part', `~ ${rules}`, 'Ask: check it', 'Write it out'].join('\n');
  const four = ['tone is warm', 'reads kindly', 'no jargon', 'sounds human'].join('; ');
  const proseOf = (job4) => {
    const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16d-'));
    mkdirSync(path.join(home, 'out'));
    t.after(() => rmSync(home, { recursive: true, force: true }));
    return `1. ${job4[0]}\n   guardrail: ${job4[1]}\n2. ask 1h: ${job4[2]}\n3. write it out\n\nArbiter guardrails (belong to no line; human-signed, tighten-only):\nguardrail: cap $0.5 per run\nguardrail: send at line 3 to file:${path.join(home, 'out')}\n`;
  };
  const p4 = router({ suggest_checks: callOf('suggest_checks', { checks: [] }) });
  const r4 = await run(p4, proseOf(['Write the first part', four, 'check it']));
  assert.equal(r4.stop, 'look-asks-too-many');
  assert.match(r4.reds[0], /^Your job has 4 rules I can't check or had to guess\./);
  assert.deepEqual(r4.questions, []);
  const p3 = router({ suggest_checks: callOf('suggest_checks', { checks: [] }) });
  const r3 = await run(p3, proseOf(['Write the first part', 'tone is warm; reads kindly; no jargon', 'check it']));
  assert.equal(r3.stop, 'look-asks');
  assert.deepEqual(r3.questions.map((/** @type {any} */ q) => q.ask), ['no-check', 'no-check', 'no-check']);
  assert.match(r3.questions[0].question, /^Line 1, guardrail "tone is warm": I can't check this\. Your own words, or Not checked\?/);
});
