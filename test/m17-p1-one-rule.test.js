// M17 am1 (a)(b), piece P1: one rule in, one rule out. An answer REPLACES the rule it was asked about, never adds a `~` rule beside it; a Revise asks nothing about it;
// a rule is told once in Not checked. Fake provider, $0. The job is the m14-walk-5 garden job of the live flow walk-m16-m14 (test/fixtures/m16-block/m14-walk-5; its notes are generic, no PII).
// Each test names the signed Done-when / Must-fail-when line it covers.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, cardToProse, applyAnswers, parseJobBox } from '../src/panel/authorcard.js';
import { draft } from '../src/drafter.js';
import { ruleOfAnswer } from '../src/pageask.js';
import { CheckBlock } from '../src/checkblock.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

// card 0 of walk-m16-m14: line 3 `~ exactly 3 bullets`, line 5 `~ under 80 words`
const CARD0 = [
  'Write 3 lines about my garden from the notes', 'Ask 1h: check it with me', 'List 3 jobs for this week from the notes', '~ exactly 3 bullets', 'Ask 1h: check it with me',
  'Write a short closing note to my neighbour', '~ under 80 words', 'Ask 1h: check it with me', 'Write it out',
].join('\n');
const tildesPerLine = (/** @type {string} */ job) => parseJobBox(job).steps.map((s) => s.guardrails.length);

function proseOf(t, job) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-m17p1-'));
  const out = path.join(home, 'out');
  mkdirSync(out);
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, '# Notes\n- weed the beds\n- water the pots\n');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return cardToProse(cardFields({ flowName: 'garden', job, inputs: `notes: ${notes}`, destination: out, capUsd: '5', askWait: '1h', provider: 'x', model: 'y' }));
}
const suggest = (checks) => ({ text: '', toolCalls: [{ id: 's1', name: 'suggest_checks', arguments: { checks } }], usage: { inputTokens: 900, outputTokens: 100 }, stopReason: 'tool_calls', model: MODEL });
const plan = () => toolReply({ steps: [], guardrailClasses: {}, unjudgeable: {}, refused: [] });
const SUGGESTED = [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }, { line: 5, guardrail: 1, rule: 'maxWords', value: 80 }];

/** the first draft of CARD0 with questions on: the asks the panel would show (what the live walk showed on lines 3 and 5) */
async function firstDraft(t) {
  const p = fakeProvider([suggest(SUGGESTED), plan(), plan(), plan()]);
  const r = await draft({ proseText: proseOf(t, CARD0), provider: p, rates: RATES, modelId: MODEL });
  return r.questions ?? [];
}
/** an Agree to every question, in the shape src/panel/author.js builds `all` */
const agreeAll = (/** @type {any[]} */ qs) => qs.map((q) => ({ line: q.line, question: q.question, answer: 'agree', ...ruleOfAnswer({ ...q, source: 'look' }, 'agree', 'agree'), ruleNo: q.ruleNo, ruleText: q.ruleText, ask: q.ask, proposal: q.proposal }));

test('walk-m16-m14 done-when: an Agree leaves ONE rule on line 3 (and line 5), in the same place, with the proposal\'s words', async (t) => {
  const qs = await firstDraft(t);
  assert.deepEqual(qs.map((q) => [q.line, q.ruleText]), [[3, 'exactly 3 bullets'], [5, 'under 80 words']], 'the two asks the live walk showed');
  const grown = applyAnswers(CARD0, agreeAll(qs));
  assert.deepEqual(tildesPerLine(grown.job), tildesPerLine(CARD0), 'the same number of ~ rules on every line');
  assert.equal(grown.job, CARD0.replace('~ exactly 3 bullets', '~ exactly 3 list items').replace('~ under 80 words', '~ at most 80 words'));
  assert.equal(grown.added, 2);
  assert.ok(grown.picks.every((p) => !('added' in p)), 'a pick carries no added words: its rule IS the answer');
});

test('walk-m16-m14 done-when: and a Revise from the card the Agree left asks nothing about line 3 or 5, and pays no suggestion call', async (t) => {
  const qs = await firstDraft(t);
  const grown = applyAnswers(CARD0, agreeAll(qs));
  // the redraft after the answers hands on the record (what a real answer-redraft writes)
  let rec = null;
  await draft({ proseText: proseOf(t, grown.job), provider: fakeProvider([plan(), plan(), plan()]), rates: RATES, modelId: MODEL, offerQuestions: false, checkPicks: grown.picks, leftRules: grown.left, onPickRecord: (r) => { rec = r; } });
  assert.ok(rec, 'a record was handed on');
  const p = fakeProvider([suggest([]), plan(), plan(), plan()]);
  const r = await draft({ proseText: proseOf(t, grown.job), provider: p, rates: RATES, modelId: MODEL, carriedPicks: /** @type {any} */ (rec).picks });
  assert.deepEqual((r.questions ?? []).filter((q) => q.line === 3 || q.line === 5), []);
  assert.equal(p.calls.some((c) => c.tools[0] === 'suggest_checks'), false, 'the carried picks settle both rules: no suggestion call');
  // and with the record lost (a Reuse, a fresh Revise), the replaced rules are the check as written (`exactly 3 list items`, `at most 80 words`): still nothing asked about them
  const none = await draft({ proseText: proseOf(t, grown.job), provider: fakeProvider([suggest([]), plan(), plan(), plan()]), rates: RATES, modelId: MODEL });
  assert.deepEqual((none.questions ?? []).filter((q) => q.line === 3 || q.line === 5), [], JSON.stringify(none.questions));
});

test('must-fail: an answer adds a ~ rule beside the one it answers (Agree, own words, and a typed rule: each leaves the count per line unchanged)', async (t) => {
  const qs = await firstDraft(t);
  const before = tildesPerLine(CARD0);
  assert.deepEqual(tildesPerLine(applyAnswers(CARD0, agreeAll(qs)).job), before, 'agree');
  const own = qs.map((q) => ({ line: q.line, question: q.question, answer: 'my own words', ...ruleOfAnswer({ ...q, source: 'look' }, 'my own words', 'rule'), ruleNo: q.ruleNo, ruleText: q.ruleText, ask: q.ask, proposal: q.proposal }));
  const grownOwn = applyAnswers(CARD0, own);
  assert.deepEqual(tildesPerLine(grownOwn.job), before, 'own words replace, they do not add');
  assert.ok(grownOwn.job.includes('~ my own words') && !grownOwn.job.includes('exactly 3 bullets'), 'the typed words took the asked rule\'s place');
  // an answer about a rule the job no longer holds is not applied at all (never appended as a stray line)
  const stale = applyAnswers(CARD0, [{ line: 3, rule: 'x', left: false, ask: 'check', ruleNo: 1, ruleText: 'a rule that is not there' }]);
  assert.equal(stale.job, CARD0);
  assert.equal(stale.added, 0, 'the caller sees nothing was applied and refuses');
  // only an answer that is about no rule (a drafter question) still adds a line
  assert.equal(tildesPerLine(applyAnswers(CARD0, [{ line: 3, rule: 'a drafter answer', left: false }]).job)[2], 2);
});

test('must-fail: a rule shows twice in Not checked (every asked rule dropped: each is told once, and the block says it itself)', async (t) => {
  const left = [{ line: 3, rule: 1 }, { line: 5, rule: 1 }];
  const r = await draft({ proseText: proseOf(t, CARD0), provider: fakeProvider([plan(), plan(), plan()]), rates: RATES, modelId: MODEL, offerQuestions: false, leftRules: left });
  const lines = (r.notChecked ?? []).filter((x) => /exactly 3 bullets|under 80 words/.test(x));
  assert.equal(lines.length, 2, JSON.stringify(r.notChecked));
  for (const w of ['exactly 3 bullets', 'under 80 words']) assert.equal(lines.filter((x) => x.includes(w)).length, 1, w);
  // the block itself says each dropped rule (f2812ca0 saysRule), so a second sentence for it is never needed
  const b = new CheckBlock({ texts: { notes: '# Notes' }, labels: ['notes'] });
  b.fromJob([{ n: 3, text: 'List 3 jobs for this week from the notes', rules: ['exactly 3 bullets'] }]);
  b.carry({ left: [{ line: 3, rule: 1 }] });
  b.reconcile();
  assert.equal(b.saysRule(3, 1), true);
  assert.equal(b.saysRule(3, 2), false);
  const rows = (r.checkRows ?? []).filter((x) => x.kind === 'rule' && x.state === 'not-checked');
  assert.equal(new Set(rows.map((x) => `${x.line}.${x.rule}`)).size, rows.length, 'one row per (line, rule)');
});
