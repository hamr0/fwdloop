// M10 piece 3 through the panel's real HTTP door and the real `fwdloop draft` child (fake provider, fake page fetch, $0, no internet): the look's asks stop
// the draft before any drafting round, the answers (bareloop's words) land as `~` lines in the card, the prose, the signed job, the plan and the hash,
// and every question and answer is in the draft log, the Audit and the signed job. Each forced red is named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signDraft, readQuestions } from '../src/authoring.js';
import { parseJobBox } from '../src/panel/authorcard.js';
import { isFwdloopAlive } from '../src/liveness.js';
import {
  killChildrenAfter, until, world, HERE,
} from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm10-map');
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
// the fake drafter's plan is the five-line BOX_JOB shape: the page rules sit on line 1; line 3's own guardrail is served by a page phrase in the map ('results returned') (so it is not asked)
const jobOf = (rules) => ['Read my resume,', ...rules.map((r) => `~ ${r}`), 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ 3 sections, all under 600 words', 'Ask 30m: check it with me,', '~ nothing goes out before I accept', 'and once I accept, write it out.'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['results returned'] }] });
const READ_RULES = ['under $150', 'not a red-eye', 'nonstop'];
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
  return { w, id, s, card };
}
const greenAfter = async (w, id) => { const g = await until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; }); await childGone(w, id); return g; };

test('the draft stops before any drafting round with the look\'s question open; nothing is signable; the question is bareloop\'s words', async () => {
  const { w, id, s } = await askWorld();
  assert.equal(s.phase, 'questions-open', JSON.stringify(s));
  assert.equal(s.total, 1, JSON.stringify(s.questions));
  assert.equal(s.questions[0].line, 1);
  assert.equal(s.questions[0].question, 'Your line 1 says "not a red-eye". I read it as: departure time between 05:00 and 23:59. Agree? Answer "agree", or type your own reading (your answer is added as a new ~ rule on line 1).');
  const planDir = path.join(w.dir(id), 'draft');
  assert.equal(existsSync(path.join(planDir, 'declaration.json')), false, 'no plan was drafted');
  assert.equal(existsSync(path.join(planDir, 'spec.hash')), false);
  assert.ok(existsSync(path.join(planDir, 'page-look.json')));
  const q = readQuestions(planDir).questions[0];
  assert.deepEqual([q.source, q.ask, q.ruleNo, q.ruleText, q.proposal], ['look', 'reading', 2, 'not a red-eye', 'departure time between 05:00 and 23:59']);
  const sp = await w.post(`/api/author/${id}/sign-prepare`, {});
  assert.equal(sp.json().refused, 'question-open');
});

test('a blank answer to a look question gets bareloop\'s sentence and leaves it open; a multi-line answer is folded into one line, not refused', async () => {
  const { w, id } = await askWorld();
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer: '   ' });
  assert.equal(r.status, 400);
  assert.equal(r.json().say, 'An answer is needed here — there is no skip. Type it in the box below and press Send.');
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false);
  const ok = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'between 06:00\n  and 22:00' });
  assert.equal(ok.status, 202, ok.text);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8')).answer, 'between 06:00 and 22:00');
  await greenAfter(w, id);
});

test('agree: the code\'s reading becomes a new ~ line under the job line, the original rule stays; the signed job and the approved plan carry it; the draft log row has proposal and rule as own fields', async () => {
  const { w, id } = await askWorld();
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'Agree.' });
  assert.equal(r.status, 202, r.text);
  const g = await greenAfter(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.deepEqual(parseJobBox(card.job).steps[0].guardrails, [...READ_RULES, 'departure time between 05:00 and 23:59']);
  const row = JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8'));
  assert.deepEqual(
    [row.source, row.ask, row.line, row.answer, row.proposal, row.rule, typeof row.at, row.question.startsWith('Your line 1 says')],
    ['look', 'reading', 1, 'Agree.', 'departure time between 05:00 and 23:59', 'departure time between 05:00 and 23:59', 'string', true],
  );
  const signed = signDraft({ dir: path.join(w.dir(id), 'draft-1'), approve: g.hash, signedBy: 'tester', env: {} });
  assert.equal(signed.ok, true, JSON.stringify(signed));
  const prose = readFileSync(path.join(signed.flowDir, 'prose.txt'), 'utf8');
  assert.match(prose, /guardrail: under \$150; not a red-eye; nonstop; departure time between 05:00 and 23:59\n/);
  const readout = readFileSync(path.join(w.dir(id), 'draft-1', 'readout.txt'), 'utf8');
  assert.match(readout, /departure time between 05:00 and 23:59/, 'the approved plan shows the new rule');
});

test('own words are taken word for word as the new ~ line', async () => {
  const { w, id } = await askWorld();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'leaves after 7 in the morning' })).status, 202);
  await greenAfter(w, id);
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.deepEqual(parseJobBox(card.job).steps[0].guardrails.at(-1), 'leaves after 7 in the morning');
  const row = JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8'));
  assert.equal(row.rule, 'leaves after 7 in the morning');
  assert.equal(row.proposal, 'departure time between 05:00 and 23:59');
});

test('drop it (a can\'t-check ask): no ~ line is added; the rule is Not checked with the signed words on the plan, and the row says so', async () => {
  const { w, id, s } = await askWorld([...READ_RULES, 'pays well']);
  assert.equal(s.total, 2);
  assert.equal(s.questions[1].question, 'Your line 1 says "pays well". I can\'t check this on the page. Drop it? Answer "drop it", or type how to check it (your answer is added as a new ~ rule on line 1).');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'agree' })).status, 200);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 2, answer: 'Drop it.' })).status, 202);
  const g = await greenAfter(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.deepEqual(parseJobBox(card.job).steps[0].guardrails, [...READ_RULES, 'pays well', 'departure time between 05:00 and 23:59'], 'only the agreed reading was added');
  assert.ok(g.notChecked.items.includes('line 1: "pays well" — You chose to leave it Not checked.'), JSON.stringify(g.notChecked));
  const row2 = JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-2.json'), 'utf8'));
  assert.deepEqual([row2.source, row2.ask, row2.proposal, row2.rule, row2.answer], ['look', 'cant-check', null, null, 'Drop it.']);
  assert.equal(JSON.parse(readFileSync(path.join(w.dir(id), 'redraft-1.json'), 'utf8')).left[0].rule, 4);
});

// must fail (signed): more than 3 asks before drafting; it must stop instead
test('more than 3 asks: nothing is asked, the draft is a stop with the rewrite list and Spent so far, no plan', async () => {
  const { w, id, s } = await askWorld([...READ_RULES, 'pays well', 'looks nice', 'feels right']);
  assert.equal(s.phase, 'red', JSON.stringify(s));
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'questions.json')), false);
  assert.match(s.reds.join(' '), /^Your job has 4 rules I can't check or had to guess\. Please rewrite it so each one says what to look for\. My readings: line 1 "not a red-eye" → departure time between 05:00 and 23:59; .* Spent so far: \$0\.\d{4}\.$/);
});
