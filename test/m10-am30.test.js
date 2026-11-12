// M10 am30 (docs/wiki/the-module-ladder.md, last block): Drop it shows only on a question about one of the person's `~` rules. A question about the job line itself
// (a sheet column question, `ruleNo: null`) shows Agree and the box; a drop on it is refused at the door and nothing reaches the drafter.
// $0: the real panel door and the real `fwdloop draft` child (fake provider, fake page), no key, no network. Each test can fail (see the commit for the forced reds).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'm10-map');
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const JOB = ['Read my resume,', '~ under $150', '~ not a red-eye', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~ nothing goes out before I accept'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settleOn = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
async function askWorld() {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
  const id = (await w.post('/api/author/draft', w.card({ flowName: 'job2', job: JOB, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
  const s = await settleOn(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  return { w, id, s };
}
/** the question as a sheet column question stores it: about the job line, no `~` rule */
const noRule = (w, id) => {
  const f = path.join(w.dir(id), 'draft', 'questions.json');
  const j = JSON.parse(readFileSync(f, 'utf8'));
  j.questions[0].ruleNo = null;
  writeFileSync(f, JSON.stringify(j));
};
const files = (w, id) => ({ answer: existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), redraft: existsSync(path.join(w.dir(id), 'redraft-1.json')), card: existsSync(path.join(w.dir(id), 'card-1.json')) });

test('the state the panel polls: a question about a ~ rule drops, a question with no rule does not', async () => {
  const { w, id, s } = await askWorld();
  assert.equal(s.questions[0].drops, true);
  noRule(w, id);
  assert.equal((await state(w, id)).questions[0].drops, false);
});

test('the door: a drop on a question with no ~ rule is refused 400, nothing written, no redraft started', async () => {
  const { w, id } = await askWorld();
  noRule(w, id);
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'drop' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json().refused, 'bad-choice');
  assert.deepEqual(files(w, id), { answer: false, redraft: false, card: false });
  const words = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'drop it', choice: 'rule' });
  assert.equal(words.status, 202, 'the words are a rule of their own on a reading ask, never a drop');
});

test('the door: Agree on the no-rule question still goes through', async () => {
  const { w, id } = await askWorld();
  noRule(w, id);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
});

test('a drop on a question tied to a ~ rule reaches the drafter as a <line>.<rule> pair', async () => {
  const { w, id } = await askWorld();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'drop' })).status, 202);
  const red = JSON.parse(readFileSync(path.join(w.dir(id), 'redraft-1.json'), 'utf8'));
  assert.equal(red.left.length, 1);
  assert.ok(Number.isInteger(red.left[0].line) && Number.isInteger(red.left[0].rule), JSON.stringify(red.left));
  const g = await settleOn(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
});

test('the page shows Drop it from the polled `drops`, not from the ask words', () => {
  const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
  const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
  const view = (q) => new Function(`${cutFn(CHAT, 'questionViewFor', '    ')}\nreturn questionViewFor;`)()({
    draftId: 'd', phase: 'questions-open', openK: 1, total: 1, questions: [{ k: 1, line: 2, lineText: 'x', answered: false, source: 'look', ask: 'reading', proposes: true, question: 'Q', shown: 'S', ...q }],
  });
  assert.deepEqual([view({ drops: true }).agree, view({ drops: true }).drop], [true, true]);
  assert.deepEqual([view({ drops: false }).agree, view({ drops: false }).drop], [true, false], 'Agree and the box, no Drop it');
});
