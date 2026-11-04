// M10 am17 + am18: a Revise keeps the check picks of the draft it revises; a pick follows its line's words, not its number. Fake provider, $0.
// Each test is a signed Must-fail-when / Done-when case; see the "Built after signing" note under M10 am18 for the red proof of each.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { writeFileSync, rmSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { cardFields, cardToProse } from '../src/panel/authorcard.js';
import { draft } from '../src/drafter.js';
import { KEPT_WORDS } from '../src/pickrecord.js';
import { RATES, MODEL, fakeProvider, toolReply } from './drafter-fixture.mjs';

const HEAD = ['Write 3 lines about my garden from the notes', 'Ask 1h: check it with me', 'List 3 jobs for this week from the notes'];
const NOTE = ['Write a short closing note to my neighbour'];
const TAIL = ['Ask 1h: check it with me', 'Write it out'];
// the card after both asks were answered: each agree wrote its `~` line under its source guardrail
const ANSWERED = [...HEAD, '~ exactly 3 bullets', '~ exactly 3 list items', 'Ask 1h: check it with me', ...NOTE, '~ under 80 words', '~ at most 80 words', ...TAIL];
const PICKS = [{ line: 3, rule: 1, check: { rule: 'listItems', value: 3 }, added: 'exactly 3 list items' }, { line: 5, rule: 1, check: { rule: 'maxWords', value: 80 }, added: 'at most 80 words' }];

function prose(t, lines) {
  const home = mkdtempSync(path.join(tmpdir(), 'fwdloop-am17-'));
  const out = path.join(home, 'out');
  mkdirSync(out);
  const notes = path.join(home, 'notes.md');
  writeFileSync(notes, '# Notes\n- a\n');
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return cardToProse(cardFields({ flowName: 'garden', job: lines.join('\n'), inputs: `notes: ${notes}`, destination: out, capUsd: '5', askWait: '1h', provider: 'x', model: 'y' }));
}
const suggest = (checks) => ({ text: '', toolCalls: [{ id: 's1', name: 'suggest_checks', arguments: { checks } }], usage: { inputTokens: 900, outputTokens: 100 }, stopReason: 'tool_calls', model: MODEL });
const plan = () => toolReply({ steps: [], guardrailClasses: {}, unjudgeable: {}, refused: [] });

/** the record the draft after the answers hands on (what a real answer-redraft writes) */
async function recordAfterAnswers(t, picks = PICKS, left = []) {
  let rec = null;
  await draft({ proseText: prose(t, ANSWERED), provider: fakeProvider([plan(), plan(), plan()]), rates: RATES, modelId: MODEL, offerQuestions: false, checkPicks: picks, leftRules: left, onPickRecord: (r) => { rec = r; } });
  assert.ok(rec, 'a record was handed on');
  return rec;
}
/** a Revise of `lines` carrying `entries`: what it asks, whether it called the suggestion, and the record it hands on */
async function revise(t, lines, entries) {
  const p = fakeProvider([suggest([]), plan(), plan(), plan()]);
  let rec = null;
  const r = await draft({ proseText: prose(t, lines), provider: p, rates: RATES, modelId: MODEL, carriedPicks: entries, onPickRecord: (x) => { rec = x; } });
  return { r, p, rec, asked: (r.questions ?? []).map((q) => [q.line, q.ruleText]), suggested: p.calls.some((c) => c.tools[0] === 'suggest_checks'), keptLines: (rec?.kept ?? []).map((k) => k.line) };
}

test('record: per pick words only, no line or rule number stored', async (t) => {
  const rec = await recordAfterAnswers(t);
  assert.deepEqual(rec.picks.map((e) => Object.keys(e).sort()), [['added', 'check', 'left', 'lineWords', 'occurrence', 'own', 'ruleText'], ['added', 'check', 'left', 'lineWords', 'occurrence', 'own', 'ruleText']]);
  assert.equal(rec.picks[0].lineWords, 'list 3 jobs for this week from the notes');
});

test('am17 (2) done-when: a Revise that changes nothing about the guardrails asks nothing, makes no suggestion call, keeps both picks', async (t) => {
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ANSWERED, rec.picks);
  assert.deepEqual(x.asked, []);
  assert.equal(x.suggested, false);
  assert.deepEqual(x.keptLines, [3, 5]);
  assert.notEqual(x.r.stop, 'look-asks');
});

test('am17 (3) a guardrail whose words changed is suggested and asked; the other keeps its pick; the changed one keeps no old check', async (t) => {
  const rec = await recordAfterAnswers(t);
  const lines = ANSWERED.map((l) => (l === '~ under 80 words' ? '~ under 60 words' : l));
  const x = await revise(t, lines, rec.picks);
  assert.equal(x.suggested, true);
  assert.deepEqual(x.asked.map((a) => a[0]), [5]);
  assert.deepEqual(x.keptLines, [3]);
  assert.equal(x.r.stop, 'look-asks');
});

test('am17 (3) a deleted guardrail takes its pick with it: no ask, no check, not in the next record', async (t) => {
  const rec = await recordAfterAnswers(t);
  const lines = ANSWERED.filter((l) => l !== '~ under 80 words' && l !== '~ at most 80 words');
  const x = await revise(t, lines, rec.picks);
  assert.deepEqual(x.asked, []);
  assert.deepEqual(x.keptLines, [3]);
  assert.equal(x.rec.picks.length, 1);
});

test('am17 (4) a kept pick never counts toward am1\'s 3: three kept "I can\'t check this" picks plus one new one still asks', async (t) => {
  const job = ['Write the first part', '~ tone is warm; reads kindly; no jargon', 'Ask 1h: check it', 'Write it out'];
  const own = ['tone is warm', 'reads kindly', 'no jargon'].map((ruleText) => ({ lineWords: 'write the first part', occurrence: 0, ruleText, added: null, check: null, own: true, left: false }));
  const four = ['Write the first part', '~ tone is warm; reads kindly; no jargon; sounds human', 'Ask 1h: check it', 'Write it out'];
  const x = await revise(t, four, own);
  assert.equal(x.r.stop, 'look-asks', JSON.stringify(x.r.reds));
  assert.deepEqual(x.asked, [[1, 'sounds human']]);
  // and without the record the same card is the 4-ask stop of am1
  const none = await revise(t, four, []);
  assert.equal(none.r.stop, 'look-asks-too-many');
  void job;
});

test('am17 (5) the model never sees a pick: no message or tool schema of any call carries the carried words', async (t) => {
  const rec = await recordAfterAnswers(t);
  const sentinel = rec.picks.map((e) => ({ ...e, added: 'ZZSENTINELZZ' }));
  const x = await revise(t, ANSWERED.map((l) => (l === '~ under 80 words' ? '~ under 60 words' : l)), sentinel);
  assert.doesNotMatch(JSON.stringify(x.p.calls), /ZZSENTINELZZ/);
});

test('am18 (2) done-when: a line added at the top asks nothing; every pick shows on its line\'s new number', async (t) => {
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ['Say hello first', ...ANSWERED], rec.picks);
  assert.deepEqual(x.asked, []);
  assert.equal(x.suggested, false);
  assert.deepEqual(x.keptLines, [4, 6]);
});

test('am18 (2) a pick lands on its own line when two blocks are swapped', async (t) => {
  const rec = await recordAfterAnswers(t);
  const swapped = [HEAD[0], HEAD[1], ...NOTE, '~ under 80 words', '~ at most 80 words', 'Ask 1h: check it with me', HEAD[2], '~ exactly 3 bullets', '~ exactly 3 list items', ...TAIL];
  const x = await revise(t, swapped, rec.picks);
  assert.deepEqual(x.asked, []);
  assert.deepEqual(x.rec.kept.map((k) => [k.line, k.check.rule]).sort((m, n) => m[0] - n[0]), [[3, 'maxWords'], [5, 'listItems']]);
});

test('am18 (3) a line whose own words changed is new: its guardrails are asked, the other line keeps its pick', async (t) => {
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ANSWERED.map((l) => l.replace('List 3 jobs for this week', 'List 4 chores for next week')), rec.picks);
  assert.ok(x.asked.length > 0 && x.asked.every((a) => a[0] === 3), JSON.stringify(x.asked));
  assert.deepEqual(x.keptLines, [5]);
});

test('am18 (3) two lines with the same words are matched in their order', async (t) => {
  const NL = 'Write a short closing note to my neighbour';
  const lines = [NL, '~ under 80 words', '~ at most 80 words', 'Ask 1h: check it with me', NL, '~ under 80 words', 'Ask 1h: check it with me', 'Write it out'];
  const entries = [
    { lineWords: NL.toLowerCase(), occurrence: 0, ruleText: 'under 80 words', added: 'at most 80 words', check: { rule: 'maxWords', value: 80 }, own: false, left: false },
    { lineWords: NL.toLowerCase(), occurrence: 1, ruleText: 'under 80 words', added: null, check: null, own: false, left: true },
  ];
  const x = await revise(t, lines, entries);
  assert.deepEqual(x.asked, []);
  assert.deepEqual(x.keptLines, [1, 3]);
  assert.equal(x.rec.kept[0].check.rule, 'maxWords');
  assert.equal(x.rec.kept[1].check, null);
});

// M10 am21 supersedes the first draft of this rule: the one ask is about the EDITED added line's words, not the source guardrail
test('am18 (4) + am21 editing only the added `~` line asks that pick only (one ask, about the edited words; the old check not kept)', async (t) => {
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ANSWERED.map((l) => (l === '~ at most 80 words' ? '~ at most 60 words' : l)), rec.picks);
  assert.equal(x.r.stop, 'look-asks');
  assert.deepEqual(x.asked, [[5, 'at most 60 words']]);
  assert.deepEqual(x.keptLines, [3]);
  assert.equal(x.rec.kept.some((k) => k.check?.value === 80), false);
});

test('am18 (4) editing only the source guardrail asks that pick only: one ask, the added line is not asked on its own', async (t) => {
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ANSWERED.map((l) => (l === '~ under 80 words' ? '~ under 60 words' : l)), rec.picks);
  assert.deepEqual(x.asked, [[5, 'under 60 words']]);
  assert.deepEqual(x.keptLines, [3]);
});

test('am18 (4) a pair with the added line deleted: the source is asked, once', async (t) => {
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ANSWERED.filter((l) => l !== '~ at most 80 words'), rec.picks);
  assert.deepEqual(x.asked, [[5, 'under 80 words']]);
});

test('am18 an earlier `~` rule deleted renumbers the rule; the pick is still carried', async (t) => {
  const before = ['Write a short closing note to my neighbour', '~ plain tone', '~ under 80 words', '~ at most 80 words', 'Ask 1h: check it with me', 'Write it out'];
  const after = before.filter((l) => l !== '~ plain tone');
  const entries = [{ lineWords: before[0].toLowerCase(), occurrence: 0, ruleText: 'under 80 words', added: 'at most 80 words', check: { rule: 'maxWords', value: 80 }, own: false, left: false }];
  const x = await revise(t, after, entries);
  assert.deepEqual(x.asked, []);
  assert.deepEqual(x.rec.kept.map((k) => [k.line, k.rule]), [[1, 1]]);
});

test('am17 (6) a kept pick is marked `kept from last draft` on the plan card row of a Not checked line', async (t) => {
  const own = [{ lineWords: HEAD[2].toLowerCase(), occurrence: 0, ruleText: 'exactly 3 bullets', added: null, check: null, own: true, left: false }];
  const lines = [...HEAD, '~ exactly 3 bullets', 'Ask 1h: check it with me', 'Write it out'];
  const p = fakeProvider([plan(), plan(), plan()]);
  const r = await draft({ proseText: prose(t, lines), provider: p, rates: RATES, modelId: MODEL, carriedPicks: own });
  assert.equal(p.calls.some((c) => c.tools[0] === 'suggest_checks'), false);
  assert.ok((r.notChecked ?? []).some((l) => l.includes(`(${KEPT_WORDS})`)), JSON.stringify(r.notChecked));
  assert.equal(KEPT_WORDS, 'kept from last draft');
});

test('am18 (3)(4) a line whose own words changed, its agreed `~` line and source both still there: ONE folded ask, the old check is not kept', async (t) => {
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ANSWERED.map((l) => l.replace('Write a short closing note to my neighbour', 'Write a short closing note to my cousin')), rec.picks);
  assert.equal(x.r.stop, 'look-asks');
  assert.deepEqual(x.asked, [[5, 'under 80 words']]);
  assert.deepEqual(x.keptLines, [3]);
  assert.equal(x.rec.kept.some((k) => k.check?.value === 80), false);
});

test('am17 (6) a kept pick is a human row of the setup record, the same shape as an answered pick, its answer `kept from last draft`', async (t) => {
  const { mkdirSync: mk, writeFileSync: wf } = await import('node:fs');
  const { buildSetupRows } = await import('../src/setup.js');
  const rec = await recordAfterAnswers(t);
  const x = await revise(t, ANSWERED, rec.picks);
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am17row-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mk(path.join(dir, 'draft')); mk(path.join(dir, 'draft-2'));
  wf(path.join(dir, 'card.json'), '{}');
  wf(path.join(dir, 'card-2.json'), '{}');
  wf(path.join(dir, 'draft-2', 'picks-record.json'), JSON.stringify(x.rec));
  const rows = buildSetupRows({ sessionDir: dir, planDir: path.join(dir, 'draft-2'), hash: 'h', signedBy: 's', signedAt: 'x' }).filter((r) => r.kind === 'human');
  assert.deepEqual(rows.map((r) => [r.line, r.ask, r.answer, r.ruleNo, r.ruleText, r.proposal, r.rule]), [
    [3, 'check', KEPT_WORDS, 1, 'exactly 3 bullets', 'exactly 3 list items', 'exactly 3 list items'],
    [5, 'check', KEPT_WORDS, 1, 'under 80 words', 'at most 80 words', 'at most 80 words'],
  ]);
  assert.match(rows[0].question, /^Line 3, guardrail "exactly 3 bullets": I propose exactly 3 list items\./);
});
