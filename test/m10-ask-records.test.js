// M10 am2 item 4 / item 6: every question and answer is in the three places - the draft log (the answer file), the Audit (the setup record's rows under the
// drafting step) and the signed job (the new ~ line). Through the panel's real door and the real draft child; $0. Forced reds are named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { signDraft } from '../src/authoring.js';
import { readSetup } from '../src/setup.js';
import { getDraftBlock } from '../src/panel/data.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { raw } from './fixtures/m10-map/load.mjs';

killChildrenAfter();
const FIX = path.join(path.dirname(fileURLToPath(import.meta.url)), 'fixtures', 'm10-map');
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR+on+2026-11-18+one+way&hl=en&curr=USD';
const RULES = ['under $150', 'not a red-eye', 'nonstop', 'pays well'];
const JOB = ['Read my resume,', ...RULES.map((r) => `~ ${r}`), 'and read the JD to compare it against,', 'write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,', '~ 3 sections, all under 600 words', 'Ask 30m: check it with me,', '~ nothing goes out before I accept', 'and once I accept, write it out.'].join('\n');
const MAP = JSON.stringify({ facts: [...JSON.parse(raw(3)).facts, { name: 'sections', from: 'line 3 rule 1', shape: 'phrase', words: ['Select flight'] }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});

async function signedWithAnswers(answers) {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_MAP: MAP, FWDLOOP_TEST_DRAFT_PAGE: path.join(FIX, 'page-ams-lhr.txt') } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB, inputs: `${w.card().inputs}\nflights: ${ADDRESS}` }))).json().draftId;
  await until(async () => (await state(w, id))?.phase === 'questions-open');
  await childGone(w, id);
  for (let k = 1; k <= answers.length; k += 1) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post(`/api/author/${id}/answer`, { k, answer: answers[k - 1] });
    assert.ok(r.status === 200 || r.status === 202, r.text);
  }
  const g = await until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  await childGone(w, id);
  const signed = signDraft({ dir: path.join(w.dir(id), 'draft-1'), approve: g.hash, signedBy: 'tester', env: {}, sessionDir: w.dir(id) });
  assert.equal(signed.ok, true, JSON.stringify(signed));
  return { w, id, signed };
}

test('all three places: draft log row, Audit rows under the drafting step, and the signed job', async () => {
  const { w, id, signed } = await signedWithAnswers(['agree', 'Drop it.']);
  // 1. the draft log: one row per question and answer, proposal and rule as their own fields
  const rows = [1, 2].map((k) => JSON.parse(readFileSync(path.join(w.dir(id), 'draft', `answer-${k}.json`), 'utf8')));
  assert.deepEqual(rows.map((r) => [r.source, r.line, r.answer, r.proposal, r.rule]), [
    ['look', 1, 'agree', 'departure time between 05:00 and 23:59', 'departure time between 05:00 and 23:59'],
    ['look', 1, 'Drop it.', null, null]]);
  assert.ok(rows.every((r) => typeof r.at === 'string' && r.question.startsWith('Your line 1 says')));
  // 2. the Audit: the setup record carries the rows, the Draft block shows them as you were asked / you said
  const setup = readSetup(signed.flowDir);
  const human = setup.rows.filter((r) => r.kind === 'human');
  assert.equal(human.length, 2);
  assert.deepEqual(human.map((r) => [r.source, r.line, r.answer, r.proposal, r.rule, r.ask]), [
    ['look', 1, 'agree', 'departure time between 05:00 and 23:59', 'departure time between 05:00 and 23:59', 'reading'],
    ['look', 1, 'Drop it.', null, null, 'cant-check']]);
  assert.equal(human[0].question, rows[0].question);
  const kinds = setup.rows.map((r) => r.kind);
  assert.ok(kinds.indexOf('human') > kinds.indexOf('draft') && kinds.lastIndexOf('human') < kinds.indexOf('redraft'), `under the drafting step: ${kinds.join(',')}`);
  const block = getDraftBlock(signed.flowDir, signed.flowDir);
  const shown = block.rows.filter((r) => /^you were asked: /.test(r.action));
  assert.equal(shown.length, 2);
  assert.equal(shown[0].action, `you were asked: ${rows[0].question}`);
  assert.equal(shown[0].gap, 'you said: agree');
  assert.equal(shown[1].gap, 'you said: Drop it.');
  assert.ok(shown.every((r) => r.step === 'drafting' && r.action !== 'human'));
  // 3. the signed job: the agreed reading is a new ~ line (the dropped rule adds none)
  const prose = readFileSync(path.join(signed.flowDir, 'prose.txt'), 'utf8');
  assert.match(prose, /guardrail: under \$150; not a red-eye; nonstop; pays well; departure time between 05:00 and 23:59\n/);
});

test('a flow with no look question has no human row (the Audit of every older flow is unchanged)', async () => {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  assert.equal(readSetup(flowDir).rows.some((r) => r.kind === 'human'), false);
});
