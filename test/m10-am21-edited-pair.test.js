// M10 am21: when the person edits an agreed proposal's added `~` line, the one ask is about THEIR words; `agree` / own words replace the old pick and its line
// (the old line never comes back); the edited line is never left Not checked unasked; no two checks of one rule sit on one line.
// Pure parts first (the real matching, answer and settle code), then the panel's real HTTP door with the real `fwdloop draft` child (fake provider, $0).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { applyAnswers, cardFields, cardToProse } from '../src/panel/authorcard.js';
import { parseSignedText } from '../src/signed-text.js';
import { scopedRules, rowsFromAnswer, checkAsks, settleRules } from '../src/checkpick.js';
import { matchRecord } from '../src/pickrecord.js';
import { ruleOfAnswer } from '../src/pageask.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();

const RECORD = [{ lineWords: 'write a short note', occurrence: 0, ruleText: 'under 80 words', added: 'at most 80 words', check: { rule: 'maxWords', value: 80 }, own: false, left: false }];
const jobOf = (...rules) => ['Write a short note', ...rules.map((r) => `~ ${r}`), 'Ask 1h: check it with me', 'Write it out'].join('\n');
const parse = (job) => {
  const p = parseSignedText(cardToProse(cardFields({ flowName: 'am21', job, destination: '/tmp/am21-out', inputs: '', capUsd: 0.6, askWait: '1h', provider: 'DEEPSEEK_API_KEY', model: 'deepseek-flash' })));
  assert.ok(p.ok, JSON.stringify(p));
  return { lines: p.lines, rules: scopedRules(p.lines, p.arbiter) };
};
const asksOf = (job, sug) => {
  const { lines, rules } = parse(job);
  const m = matchRecord(RECORD, lines, rules);
  return { m, asks: checkAsks(rowsFromAnswer(m.askRules, { checks: m.askRules.map((r) => ({ line: r.line, guardrail: r.rule, ...sug })) })) };
};
const answer = (ask, typed) => {
  const q = { source: 'look', ask: ask.ask, ruleNo: ask.rule, ruleText: ask.ruleText, proposal: ask.reading ?? null, ...(ask.check ? { check: ask.check } : {}), ...(ask.pairRule === undefined ? {} : { pairRule: ask.pairRule }) };
  return { line: ask.line, answer: typed, ...ruleOfAnswer(q, typed), ruleNo: q.ruleNo, ruleText: q.ruleText, ask: q.ask, ...(q.pairRule === undefined ? {} : { pairRule: q.pairRule }) };
};

test('an edited added line is the one ask, about the edited words', () => {
  const { asks } = asksOf(jobOf('under 80 words', 'at most 60 words'), { rule: 'maxWords', value: 60 });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].ruleText, 'at most 60 words');
  assert.match(asks[0].question, /^Line 1, guardrail "at most 60 words": I propose at most 60 words\./);
  assert.equal(asks[0].pairRule, 1);
});

test('control: the added line unchanged asks nothing; a deleted added line asks the source with no pairRule', () => {
  assert.equal(asksOf(jobOf('under 80 words', 'at most 80 words'), { rule: 'maxWords', value: 80 }).asks.length, 0);
  const { asks } = asksOf(jobOf('under 80 words'), { rule: 'maxWords', value: 80 });
  assert.equal(asks.length, 1);
  assert.equal(asks[0].ruleText, 'under 80 words');
  assert.equal(asks[0].pairRule, undefined);
});

test('agree replaces the edited line and the old line never comes back; the plan checks 60 only, once', () => {
  const job = jobOf('under 80 words', 'at most 60 words');
  const { asks } = asksOf(job, { rule: 'maxWords', value: 60 });
  const done = applyAnswers(job, [answer(asks[0], 'agree')]);
  assert.equal(done.added, 1);
  assert.deepEqual(done.job.split('\n').filter((l) => l.startsWith('~')), ['~ under 80 words', '~ at most 60 words']);
  const s = settleRules(parse(done.job).rules, done.picks, done.left);
  assert.deepEqual(s.checks.get(1), [{ rule: 'maxWords', value: 60 }]);
  assert.deepEqual(s.notes, []);
});

test('agree on words that differ from the proposal replaces the edited line (no second line of the same rule)', () => {
  const job = jobOf('under 80 words', 'no more than 60 words');
  const { asks } = asksOf(job, { rule: 'maxWords', value: 60 });
  const done = applyAnswers(job, [answer(asks[0], 'agree')]);
  assert.deepEqual(done.job.split('\n').filter((l) => l.startsWith('~')), ['~ under 80 words', '~ at most 60 words']);
  assert.equal(settleRules(parse(done.job).rules, done.picks, done.left).checks.get(1).length, 1);
});

test('own words replace the edited line; drop it leaves the line and both rules Not checked', () => {
  const job = jobOf('under 80 words', 'at most 60 words');
  const { asks } = asksOf(job, { rule: 'maxWords', value: 60 });
  const own = applyAnswers(job, [answer(asks[0], 'keep it very short')]);
  assert.deepEqual(own.job.split('\n').filter((l) => l.startsWith('~')), ['~ under 80 words', '~ keep it very short']);
  assert.equal(own.picks[0].check, null);
  const drop = applyAnswers(job, [answer(asks[0], 'drop it')]);
  assert.equal(drop.job, job);
  assert.deepEqual(drop.left, [{ line: 1, rule: 2 }, { line: 1, rule: 1 }]);
  const s = settleRules(parse(drop.job).rules, drop.picks, drop.left);
  assert.deepEqual(s.notes.map((n) => n.reason), ['person-left', 'person-left']);
});

// ---- the panel's real door --------------------------------------------------------------------------------------------------------------
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ under 80 words');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'maxWords', value: 80 }, { line: 3, guardrail: 2, rule: 'maxWords', value: 60 }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settle = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
const settled = async (w, id) => { const g = await settle(w, id, ['questions-open', 'green', 'red', 'stopped']); await childGone(w, id); return g; };
const closeOn3 = (w, id, plan) => JSON.parse(readFileSync(path.join(w.dir(id), plan, 'declaration.json'), 'utf8')).steps.find((x) => x.fromLine === 3).close;

test('panel: agree, edit the added line in a Revise, one ask about the edited words, agree: 60 only', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  assert.equal((await settled(w, id)).phase, 'questions-open');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
  assert.equal((await settled(w, id)).phase, 'green');
  const card1 = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.ok(card1.job.includes('~ at most 80 words'), card1.job);
  assert.equal((await w.post(`/api/author/${id}/revise`, { ...card1, job: card1.job.replace('~ at most 80 words', '~ at most 60 words') })).status, 202);
  const s = await settled(w, id);
  assert.equal(s.phase, 'questions-open', JSON.stringify(s.reds ?? s));
  assert.equal(s.questions.length, 1, JSON.stringify(s.questions));
  assert.match(s.questions[0].question, /^Line 3, guardrail "at most 60 words": I propose at most 60 words\./);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
  const g = await settled(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  const card2 = JSON.parse(readFileSync(path.join(w.dir(id), 'card-2.json'), 'utf8'));
  assert.deepEqual(card2.job.split('\n').filter((l) => /words$/.test(l) && l.startsWith('~')), ['~ under 80 words', '~ at most 60 words']);
  assert.deepEqual(closeOn3(w, id, 'draft-3'), { class: 'softgreen', shape: { picked: [{ rule: 'maxWords', value: 60 }] } });
});
