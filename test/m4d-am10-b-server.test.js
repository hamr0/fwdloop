// M4d amendment 10 piece C: the server hands the page the draft's step list (state.stepList, built by draftStepList from log.json + the
// declaration); the readout and plan hash do not change (item 5). $0, fake draft provider, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { world, killChildrenAfter, until } from './m4e-world.mjs';
import { specHash } from '../src/authoring.js';

killChildrenAfter();
const finish = async (w, over = {}) => {
  const id = (await w.post('/api/author/draft', w.card(over))).json().draftId;
  const j = await until(async () => { const v = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(v?.phase) ? v : null; });
  return { id, j };
};
const lines = (l) => l.map((s) => `${s.id}:${s.status}`);

test('C1: a green draft carries its list: thinking, inputs, drafted, plan checks, rubrics (line 3 is shape-checked); no tries', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'applied' } });
  const { j } = await finish(w);
  assert.equal(j.phase, 'green');
  assert.deepEqual(lines(j.stepList), ['thinking:done', 'inputs:done', 'drafted:done', 'checks:done', 'rubrics:done']);
  assert.equal(j.stepList[0].label, 'thinking off');
  assert.equal(j.stepList[1].label, 'inputs · resume: 1 heading · jd: 1 heading');
  assert.equal(j.stepList.at(-1).label, 'rubrics · line 3');
  assert.ok(j.stepList.every((s) => s.details.length === 0));
});

test('C2: ignored thinking: the thinking line fails with am7\'s words; the old thinkingSay field is gone from the view', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'ignored' } });
  const { j } = await finish(w);
  assert.deepEqual([j.stepList[0].status, j.stepList[0].label], ['failed', 'thinking on (the model thought anyway)']);
  assert.equal(Object.hasOwn(j, 'thinkingSay'), false);
});

test('C3: a refused (red) draft carries drafted + a failed plan-checks line with ONE plain reason and a Fix line when it has one; no raw text, no try lines', async () => {
  const w = await world({ mode: 'bad' });
  const { j } = await finish(w);
  assert.equal(j.phase, 'red');
  const checks = j.stepList.find((s) => s.id === 'checks');
  assert.equal(checks.status, 'failed');
  assert.equal(checks.label, 'plan checks · A step uses a tool that is not available for this job');
  assert.ok(j.stepList.every((s) => s.details.length === 0 && s.reds === undefined && !s.id.startsWith('try')));
  assert.ok(!JSON.stringify(j.stepList).includes('declaration:'));
});

test('C4: a draft that passed after refused tries says "fixed by the AI after 2 tries" on the plan-checks line, and has no try lines; a clean one says plain "plan checks"', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_RETRY: '2' } });
  const { j } = await finish(w);
  assert.equal(j.phase, 'green');
  assert.equal(j.stepList.find((s) => s.id === 'checks').label, 'plan checks · fixed by the AI after 2 tries');
  assert.ok(!j.stepList.some((s) => s.id.startsWith('try')));
  const clean = await finish(await world());
  assert.equal(clean.j.stepList.find((s) => s.id === 'checks').label, 'plan checks');
});

test('C5: item 5 - the readout and the plan hash are exactly the files on disk, the hash recomputes from the five hashed files, and the list words are not in the readout', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'ignored', FWDLOOP_TEST_DRAFT_RETRY: '1' } });
  const { id, j } = await finish(w);
  const d = path.join(w.dir(id), 'draft');
  const rd = (f) => readFileSync(path.join(d, f), 'utf8');
  assert.equal(j.readout, rd('readout.txt'));
  assert.equal(j.hash, rd('spec.hash').trim());
  const h = specHash({
    proseText: rd('prose.txt'), declarationText: rd('declaration.json'), inputFactsText: rd('input-facts.json'), readoutText: rd('readout.txt'), targetText: rd('target.json'),
  });
  assert.equal(h.hash, j.hash);
  assert.doesNotMatch(rd('readout.txt'), /thinking|try 2 of 3|rubrics|plan checks/i);
  // the input list lives in log.json only
  assert.doesNotMatch(rd('declaration.json') + rd('input-facts.json'), /\b\d+ headings?\b/);
});
