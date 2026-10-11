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
  assert.deepEqual(j.stepList[1].details, ['resume: 1 heading', 'jd: 1 heading']);
  assert.deepEqual(j.stepList.at(-1).details, ['line 3: built']);
});

test('C2: ignored thinking: the thinking line fails with am7\'s words; the old thinkingSay field is gone from the view', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_THINKING_STATUS: 'ignored' } });
  const { j } = await finish(w);
  assert.deepEqual([j.stepList[0].status, j.stepList[0].label], ['failed', 'thinking: you asked off, the model ignored it']);
  assert.equal(Object.hasOwn(j, 'thinkingSay'), false);
});

test('C3: a refused (red) draft carries drafted + plan checks failed with the raw refusals', async () => {
  const w = await world({ mode: 'bad' });
  const { j } = await finish(w);
  assert.equal(j.phase, 'red');
  const checks = j.stepList.find((s) => s.id === 'checks');
  assert.equal(checks.status, 'failed');
  assert.ok(checks.reds.length > 0);
  assert.ok(j.stepList.some((s) => s.id === 'try-2') && j.stepList.some((s) => s.id === 'try-3'));
});

test('C4: a draft with a retry lists try 2 of 3 with the reason; a clean draft lists none', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_RETRY: '1' } });
  const { j } = await finish(w);
  assert.equal(j.phase, 'green');
  const t = j.stepList.find((s) => s.id === 'try-2');
  assert.equal(t.label, 'try 2 of 3');
  assert.ok(t.details.length > 0);
  assert.ok(!j.stepList.some((s) => s.id === 'try-3'));
  const clean = await finish(await world());
  assert.ok(!clean.j.stepList.some((s) => s.id.startsWith('try')));
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
