// M17 am8: the Audit's Draft group says what was decided (agreed / you wrote / dropped), never the question that quotes a replaced rule's old words.
// Through the real path: the panel's answer door -> the draft's answer files -> the signed setup record -> getDraftBlock. $0 (fake provider). A box-answered
// drafter question and a record written before am8 keep `you were asked` / `you said`.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { signDraft } from '../src/authoring.js';
import { readSetup, writeSetup } from '../src/setup.js';
import { getDraftBlock } from '../src/panel/data.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ exactly 3 bullets');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }] });
const OLD = 'exactly 3 bullets';
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
/** the whole path: draft, answer the one question with `body`, green, sign, then the Audit's rows for the answered question */
async function auditAfter(body) {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST } });
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  await until(async () => (await state(w, id))?.phase === 'questions-open');
  await childGone(w, id);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, ...body })).status, 202);
  const g = await until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  await childGone(w, id);
  const signed = signDraft({ dir: path.join(w.dir(id), 'draft-1'), approve: g.hash, signedBy: 'tester', env: {}, sessionDir: w.dir(id) });
  assert.equal(signed.ok, true, JSON.stringify(signed));
  const human = readSetup(signed.flowDir).rows.filter((r) => r.kind === 'human');
  const shown = getDraftBlock(signed.flowDir, signed.flowDir).rows.filter((r) => r.step === 'drafting' && r.action !== 'human' && /^(agreed|you wrote|dropped|you were asked)/.test(r.action));
  return { human, shown };
}

test('Agree: the row reads `agreed — <the signed rule>`; the question and the replaced rule\'s words are not shown', async () => {
  const { human, shown } = await auditAfter({ choice: 'agree' });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].action, 'agreed — exactly 3 list items');
  assert.ok(!JSON.stringify(shown[0]).includes(OLD) && !JSON.stringify(shown[0]).includes('you were asked'), JSON.stringify(shown[0]));
  assert.deepEqual([human[0].choice, human[0].words], ['agree', 'exactly 3 list items']);
});

test('a typed new rule: `you wrote — <your words>`, no question', async () => {
  const { human, shown } = await auditAfter({ choice: 'rule', answer: 'three short bullets' });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].action, 'you wrote — three short bullets');
  assert.ok(!JSON.stringify(shown[0]).includes(OLD) && !JSON.stringify(shown[0]).includes('you were asked'), JSON.stringify(shown[0]));
  assert.deepEqual([human[0].choice, human[0].words], ['rule', 'three short bullets']);
});

test('Drop it: `dropped — Not checked`, no question, no old words', async () => {
  const { human, shown } = await auditAfter({ choice: 'drop' });
  assert.equal(shown.length, 1);
  assert.equal(shown[0].action, 'dropped — Not checked');
  assert.ok(!JSON.stringify(shown[0]).includes(OLD) && !JSON.stringify(shown[0]).includes('you were asked'), JSON.stringify(shown[0]));
  assert.equal(human[0].choice, 'drop');
  assert.equal('words' in human[0], false);
});

/** a plan folder with the given questions and answer files, written as the door writes them (or older, without `choice`) */
function record(questions, answerFiles) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m17am8-'));
  const sessionDir = path.join(root, 'session');
  const planDir = path.join(sessionDir, 'draft');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(path.join(sessionDir, 'card.json'), JSON.stringify({ job: 'x' }));
  writeFileSync(path.join(planDir, 'questions.json'), JSON.stringify({ questions }));
  answerFiles.forEach((a, i) => writeFileSync(path.join(planDir, `answer-${i + 1}.json`), JSON.stringify({ at: '2026-11-16T10:00:00.000Z', ...a })));
  const flowDir = path.join(root, 'flow');
  mkdirSync(flowDir);
  assert.equal(writeSetup({ flowDir, sessionDir, planDir, hash: 'h'.repeat(64), signedBy: 't', signedAt: '2026-11-16T11:00:00.000Z' }).ok, true);
  return { root, flowDir };
}
const LOOK = { line: 1, question: 'Your line 1 says exactly 3 bullets. Is that right?', source: 'look', ask: 'reading', ruleNo: 1, ruleText: 'exactly 3 bullets', proposal: 'exactly 3 list items' };

test('a drafter question answered in the box keeps `you were asked` / `you said`', () => {
  const s = record([{ line: 2, question: 'Which folder should it write to?' }], [{ answer: '~/out', choice: 'rule' }]);
  try {
    const shown = getDraftBlock(s.flowDir, s.flowDir).rows.filter((r) => /^you were asked: /.test(r.action));
    assert.equal(shown.length, 1);
    assert.equal(shown[0].action, 'you were asked: Which folder should it write to?');
    assert.equal(shown[0].gap, 'you said: ~/out');
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('a record written before am8 (no choice, no words) keeps today\'s words', () => {
  const s = record([LOOK], [{ answer: 'agree', rule: 'exactly 3 list items' }]);
  try {
    const shown = getDraftBlock(s.flowDir, s.flowDir).rows.filter((r) => /^you were asked: /.test(r.action));
    assert.equal(shown.length, 1);
    assert.match(shown[0].action, /^you were asked: Your line 1 says exactly 3 bullets/);
    assert.match(shown[0].gap, /^you said: agree/);
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});
