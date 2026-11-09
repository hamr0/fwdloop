// M10 am16 through the panel's real HTTP door and the real `fwdloop draft` child (fake provider, $0): a shape guardrail draws a proposal ask; "agree" picks the check, and the
// redraft's plan carries exactly it; every question and answer is in the draft log, the Audit and the signed job. Own words and "drop it" leave the rule Not checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { signDraft } from '../src/authoring.js';
import { parseJobBox } from '../src/panel/authorcard.js';
import { readSetup } from '../src/setup.js';
import { getDraftBlock } from '../src/panel/data.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ exactly 3 bullets');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settle = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
async function asked(suggest = SUGGEST) {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: suggest } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  const s = await settle(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  return { w, id, s };
}
const greenAfter = async (w, id) => { const g = await settle(w, id, ['green', 'red', 'stopped']); await childGone(w, id); return g; };

test('the draft stops with one proposal ask in item 4\'s words; nothing is signable; no plan was drafted', async () => {
  const { s } = await asked();
  assert.equal(s.phase, 'questions-open', JSON.stringify(s));
  assert.equal(s.total, 1);
  assert.equal(s.questions[0].source, 'look');
  assert.match(s.questions[0].question, /^Line 3, guardrail "exactly 3 bullets": I propose exactly 3 list items\./);
});

test('agree: the plan carries exactly the picked check; the `~` line is in the card, the signed job; the answer row has the proposal and the rule; the Audit shows both', async () => {
  const { w, id } = await asked();
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'agree' })).status, 202);
  const g = await greenAfter(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  const decl = JSON.parse(readFileSync(path.join(w.dir(id), 'draft-1', 'declaration.json'), 'utf8'));
  assert.deepEqual(decl.steps.find((x) => x.fromLine === 3).close, { class: 'softgreen', shape: { picked: [{ rule: 'listItems', value: 3 }] } });
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  assert.deepEqual(parseJobBox(card.job).steps[2].guardrails, ['exactly 3 bullets', 'exactly 3 list items']);
  const row = JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8'));
  assert.deepEqual([row.source, row.ask, row.line, row.proposal, row.rule], ['look', 'check', 3, 'exactly 3 list items', 'exactly 3 list items']);
  assert.ok(g.checked[2].sentences.includes('You picked: exactly 3 list items. [you picked]'), JSON.stringify(g.checked[2]));
  const signed = signDraft({ dir: path.join(w.dir(id), 'draft-1'), approve: g.hash, signedBy: 'tester', env: {}, sessionDir: w.dir(id) });
  assert.equal(signed.ok, true, JSON.stringify(signed));
  // 3. the signed job: the agreed words are a new ~ line (the confirmation)
  assert.match(readFileSync(path.join(signed.flowDir, 'prose.txt'), 'utf8'), /guardrail: exactly 3 bullets; exactly 3 list items\n/);
  // 2. the Audit: the setup record carries the row, the Draft block shows `you were asked` / `you said`
  const human = readSetup(signed.flowDir).rows.filter((r) => r.kind === 'human');
  assert.deepEqual(human.map((r) => [r.ask, r.line, r.answer, r.proposal, r.rule]), [['check', 3, 'agree', 'exactly 3 list items', 'exactly 3 list items']]);
  const shown = getDraftBlock(signed.flowDir, signed.flowDir).rows.filter((r) => /^you were asked: /.test(r.action));
  assert.equal(shown.length, 1);
  assert.match(shown[0].action, /^you were asked: Line 3, guardrail "exactly 3 bullets": I propose exactly 3 list items\./);
  assert.equal(shown[0].gap, 'you said: agree [you picked]');
});

test('own words: a `~` line word for word, no check, Not checked with its reason; drop it: no line, Not checked as the person chose', async () => {
  const own = await asked();
  assert.equal((await own.w.post(`/api/author/${own.id}/answer`, { k: 1, answer: 'three short bullets' })).status, 202);
  const g1 = await greenAfter(own.w, own.id);
  assert.equal(g1.phase, 'green', JSON.stringify(g1.reds ?? g1));
  const d1 = JSON.parse(readFileSync(path.join(own.w.dir(own.id), 'draft-1', 'declaration.json'), 'utf8'));
  assert.deepEqual(d1.steps.find((x) => x.fromLine === 3).close, { class: 'hitl' });
  assert.ok(g1.notChecked.items.some((x) => x.includes('"exactly 3 bullets"') && x.includes('Your own words are on the line')), JSON.stringify(g1.notChecked));
  const drop = await asked();
  assert.equal((await drop.w.post(`/api/author/${drop.id}/answer`, { k: 1, answer: 'Drop it.' })).status, 202);
  const g2 = await greenAfter(drop.w, drop.id);
  assert.equal(g2.phase, 'green', JSON.stringify(g2.reds ?? g2));
  assert.ok(g2.notChecked.items.includes('not checked · "exactly 3 bullets" — You chose to leave it Not checked.'), JSON.stringify(g2.notChecked));
  const card = JSON.parse(readFileSync(path.join(drop.w.dir(drop.id), 'card-1.json'), 'utf8'));
  assert.deepEqual(parseJobBox(card.job).steps[2].guardrails, ['exactly 3 bullets'], 'drop it adds no line');
});

test('nothing kept: "I can\'t check this. Your own words, or Not checked?"', async () => {
  const { s } = await asked('{"checks":[]}');
  assert.equal(s.phase, 'questions-open');
  assert.match(s.questions[0].question, /^Line 3, guardrail "exactly 3 bullets": I can't check this\. Your own words, or Not checked\?/);
});
