// M17 am9 item 3 (the door: a typed `column` choice, refused unless one of the question's own tied columns) and am9a (the pick rewrites the rule, the Audit keeps question and answer).
// $0: the real panel door and the real `fwdloop draft` child (fake provider, fake page). The question is made a tie by adding the columns the drafter records (as m10-am30 does for a no-rule question).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIX = path.join(HERE, 'fixtures', 'm10-map');
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const JOB = ['Read my resume,', '~ under $150', '~ not a red-eye', 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ plain words only', 'Ask 30m: check it with me,', '~ nothing goes out before I accept', 'write it out'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
const PICK_SAY = 'This question has a list to choose from: pick one of the columns, or Drop it. Nothing was saved.';
const NOT_OFFERED = 'That choice is not offered for this question. Nothing was saved.';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settleOn = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
async function askWorld(tie = true) {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
  const id = (await w.post('/api/author/draft', w.card({ flowName: 'job2', job: JOB, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
  const s = await settleOn(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  if (tie) {
    const f = path.join(w.dir(id), 'draft', 'questions.json');
    const j = JSON.parse(readFileSync(f, 'utf8'));
    const q = j.questions[0];
    Object.assign(q, { proposal: null, columns: ['Amount', 'Tax'], readings: { Amount: "use the column 'Amount' for 'Price'", Tax: "use the column 'Tax' for 'Price'" } });
    writeFileSync(f, JSON.stringify(j));
  }
  return { w, id, s };
}
const files = (w, id) => ({ answer: existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), redraft: existsSync(path.join(w.dir(id), 'redraft-1.json')), card: existsSync(path.join(w.dir(id), 'card-1.json')) });
const NOTHING = { answer: false, redraft: false, card: false };

test('the state the panel polls: a tie question carries every tied column and offers no Agree', async () => {
  const { w, id } = await askWorld();
  const q = (await state(w, id)).questions[0];
  assert.deepEqual(q.columns, ['Amount', 'Tax']);
  assert.equal(q.proposes, false, 'no Agree on a tie');
  assert.equal(q.drops, true);
});

test('Must fail: a column outside the tied list is saved (refused 400, question open, nothing saved, the signed words)', async () => {
  const { w, id } = await askWorld();
  for (const answer of ['Price', 'amount', '', 'Amount, Tax']) {
    const r = await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'column', answer });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json().say, PICK_SAY);
    assert.deepEqual(files(w, id), NOTHING);
  }
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'column' })).json().say, PICK_SAY, 'no text at all');
});

test('Must fail: a `rule` (own words) or an `agree` answer to a tie is saved', async () => {
  const { w, id } = await askWorld();
  for (const body of [{ choice: 'rule', answer: 'Tax over 500' }, { choice: 'agree' }, { choice: 'rule', answer: 'Amount' }]) {
    const r = await w.post(`/api/author/${id}/answer`, { k: 1, ...body });
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json().say, PICK_SAY);
    assert.deepEqual(files(w, id), NOTHING);
  }
});

test('the door: a `column` on a question with no list is refused with the not-offered words, nothing saved', async () => {
  const { w, id } = await askWorld(false);
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'column', answer: 'Amount' });
  assert.equal(r.status, 400, r.text);
  assert.equal(r.json().say, NOT_OFFERED);
  assert.deepEqual(files(w, id), NOTHING);
});

test('the pick: a tied column is taken (202), the answer file records the choice, the column and the rule it wrote; the redraft carries the rewritten rule', async () => {
  const { w, id } = await askWorld();
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'column', answer: 'Tax' });
  assert.equal(r.status, 202, r.text);
  const a = JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8'));
  assert.equal(a.choice, 'column');
  assert.equal(a.answer, 'Tax');
  assert.equal(a.rule, "use the column 'Tax' for 'Price'");
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  const jobLines = String(card.job).split('\n');
  assert.equal(jobLines.length, JOB.split('\n').length, 'no line added');
  assert.equal(jobLines.filter((l) => l.includes("use the column 'Tax' for 'Price'")).length, 1, 'one rule in');
  await settleOn(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
});

test('Drop it on a tie is taken and leaves the rule Not checked', async () => {
  const { w, id } = await askWorld();
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'drop' });
  assert.equal(r.status, 202, r.text);
  const red = JSON.parse(readFileSync(path.join(w.dir(id), 'redraft-1.json'), 'utf8'));
  assert.equal(red.left.length, 1);
  await settleOn(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
});
