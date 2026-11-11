// M10 am29 (docs/wiki/the-module-ladder.md, last block): the panel's answer door takes a typed `choice` (`agree`, `drop`, `rule`) and code reads that, never the words.
// $0: the real panel door and the real `fwdloop draft` child (fake provider, fake page), no key, no network. Each test can fail (see the commit for the forced reds).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseJobBox } from '../src/panel/authorcard.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { ruleOfAnswer } from '../src/pageask.js';
import {
  killChildrenAfter, until, world, JOB, tmp,
} from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm10-map');
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const jobOf = (rules) => ['Read my resume,', ...rules.map((r) => `~ ${r}`), 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~ nothing goes out before I accept'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
const READ_RULES = ['under $150', 'not a red-eye', 'nonstop'];
const PROPOSAL = 'departure time between 05:00 and 23:59';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settleOn = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
async function askWorld(rules = READ_RULES) {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
  const card = w.card({ flowName: 'job2', job: jobOf(rules), inputs: `${w.card().inputs}\nflights: ${ADDRESS}` });
  const id = (await w.post('/api/author/draft', card)).json().draftId;
  const s = await settleOn(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  return { w, id, s };
}
const greenAfter = async (w, id) => { const g = await settleOn(w, id, ['green', 'red', 'stopped']); await childGone(w, id); return g; };
const answerRow = (w, id, k) => JSON.parse(readFileSync(path.join(w.dir(id), 'draft', `answer-${k}.json`), 'utf8'));
const guardrails = (w, id) => parseJobBox(JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8')).job).steps[0].guardrails;

test('the box: "agree, why not" with choice rule is a new ~ rule word for word, never read as agree; the row says rule', async () => {
  const { w, id } = await askWorld();
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'agree, why not', choice: 'rule' });
  assert.equal(r.status, 202, r.text);
  await greenAfter(w, id);
  assert.deepEqual(guardrails(w, id), [...READ_RULES, 'agree, why not']);
  const row = answerRow(w, id, 1);
  assert.deepEqual([row.choice, row.rule, row.answer], ['rule', 'agree, why not', 'agree, why not']);
});

test('the box: a bare "yes" with choice rule is still the person\'s own rule', async () => {
  const { w, id } = await askWorld();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'yes', choice: 'rule' })).status, 202);
  await greenAfter(w, id);
  assert.deepEqual(guardrails(w, id).at(-1), 'yes');
});

test('the Agree button: choice agree takes code\'s proposal; the typed words are not needed; the row says agree', async () => {
  const { w, id } = await askWorld();
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' });
  assert.equal(r.status, 202, r.text);
  await greenAfter(w, id);
  assert.deepEqual(guardrails(w, id), [...READ_RULES, PROPOSAL]);
  const row = answerRow(w, id, 1);
  assert.deepEqual([row.choice, row.rule, row.proposal], ['agree', PROPOSAL, PROPOSAL]);
});

test('the Drop it button on a reading ask: the rule stays in the job, no rule is added, it is Not checked', async () => {
  const { w, id } = await askWorld();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'drop' })).status, 202);
  const g = await greenAfter(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  assert.deepEqual(guardrails(w, id), READ_RULES, 'the rule is still in the job; nothing was added');
  assert.ok(g.notChecked.items.some((x) => x.includes('"not a red-eye"')), JSON.stringify(g.notChecked));
  const row = answerRow(w, id, 1);
  assert.deepEqual([row.choice, row.rule], ['drop', null]);
});

test('Drop it on a cant-check ask leaves the rule Not checked; agree there is refused (nothing proposed)', async () => {
  const { w, id, s } = await askWorld([...READ_RULES, 'pays well']);
  assert.equal(s.total, 2);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 200);
  const bad = await w.post(`/api/author/${id}/answer`, { k: 2, choice: 'agree' });
  assert.equal(bad.status, 400);
  assert.equal(bad.json().refused, 'bad-choice');
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-2.json')), false, 'nothing was saved');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 2, choice: 'drop' })).status, 202);
  const g = await greenAfter(w, id);
  assert.ok(g.notChecked.items.some((x) => x.includes('"pays well"')), JSON.stringify(g.notChecked));
  assert.deepEqual(guardrails(w, id), [...READ_RULES, 'pays well', PROPOSAL]);
});

test('an unknown choice is refused bad-choice and nothing is saved', async () => {
  const { w, id } = await askWorld();
  for (const choice of ['maybe', 'Agree', '', null, 1, 'Drop it']) {
    const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'x', choice });
    assert.equal(r.status, 400, `${JSON.stringify(choice)} ${r.text}`);
    assert.equal(r.json().refused, 'bad-choice');
  }
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false);
});

test('a drafter question (not a look ask) refuses agree and drop; its box answer (choice rule or none) works; blank is still refused', async () => {
  const qjob = JOB.replace('Read my resume,', 'Read my resume QMARK,');
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_OFFERED_LOG: path.join(tmp('am29-off'), 'offered.log') } });
  const id = (await w.post('/api/author/draft', w.card({ job: qjob }))).json().draftId;
  const s = await settleOn(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(s.phase, 'questions-open', JSON.stringify(s));
  assert.equal(s.questions[0].source, undefined, 'a drafter question');
  for (const choice of ['agree', 'drop']) {
    const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'x', choice });
    assert.equal([r.status, r.json().refused].join(), '400,bad-choice', choice);
  }
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: '  ', choice: 'rule' })).json().refused, 'blank-answer');
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false);
  const ok = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'the 2024 one', choice: 'rule' });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(answerRow(w, id, 1).choice, 'rule');
});

test('no choice (the CLI and old answer files) keeps today\'s words: "Agree." takes the proposal and the row carries no choice field', async () => {
  const { w, id } = await askWorld();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'Agree.' })).status, 202);
  await greenAfter(w, id);
  assert.deepEqual(guardrails(w, id), [...READ_RULES, PROPOSAL]);
  assert.equal('choice' in answerRow(w, id, 1), false);
});

test('ruleOfAnswer: a typed choice decides; the words never do', () => {
  const q = { source: 'look', ask: 'reading', proposal: 'p' };
  assert.deepEqual(ruleOfAnswer(q, 'agree', 'rule'), { rule: 'agree', left: false });
  assert.deepEqual(ruleOfAnswer(q, 'yes please', 'rule'), { rule: 'yes please', left: false });
  assert.deepEqual(ruleOfAnswer(q, 'whatever', 'agree'), { rule: 'p', left: false });
  assert.deepEqual(ruleOfAnswer(q, 'drop it', 'rule'), { rule: 'drop it', left: false });
  assert.deepEqual(ruleOfAnswer(q, '', 'drop'), { rule: null, left: true });
  assert.deepEqual(ruleOfAnswer(q, 'agree'), { rule: 'p', left: false }, 'no choice: today\'s words');
});
