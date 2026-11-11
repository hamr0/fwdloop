// M14 am3: every answered question a plan asked gets a human row in the Audit Draft group, whoever raised it; a page-look row never changes.
// mkdtemp fixtures through writeSetup and getDraftBlock; $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { writeSetup, readSetup } from '../src/setup.js';
import { getDraftBlock } from '../src/panel/data.js';

const LOOK = {
  line: 1, question: 'Your line 1 says X. Is that right?', source: 'look', ask: 'reading', ruleNo: 1, ruleText: 'under $150', proposal: 'price under 150',
};
const DRAFTER = { line: 2, question: 'Which folder should it write to?' };

/** a session dir with one plan folder `draft` holding the given questions and answers (null = unanswered), and optionally a kept pick */
function session(questions, answers, kept) {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m14am3-'));
  const sessionDir = path.join(root, 'session');
  const planDir = path.join(sessionDir, 'draft');
  mkdirSync(planDir, { recursive: true });
  writeFileSync(path.join(sessionDir, 'card.json'), JSON.stringify({ job: 'x' }));
  writeFileSync(path.join(planDir, 'questions.json'), JSON.stringify({ questions }));
  answers.forEach((a, i) => { if (a !== null) writeFileSync(path.join(planDir, `answer-${i + 1}.json`), JSON.stringify({ answer: a, at: '2026-11-11T10:00:00.000Z' })); });
  if (kept) writeFileSync(path.join(planDir, 'picks-record.json'), JSON.stringify({ kept }));
  const flowDir = path.join(root, 'flow');
  mkdirSync(flowDir);
  const w = writeSetup({ flowDir, sessionDir, planDir, hash: 'h'.repeat(64), signedBy: 't', signedAt: '2026-11-11T11:00:00.000Z' });
  assert.equal(w.ok, true, JSON.stringify(w));
  return { root, flowDir, rows: readSetup(flowDir).rows };
}

test('an answered drafter question gets one human row, shown as you were asked / you said with no picked label', () => {
  const s = session([DRAFTER], ['~/out']);
  try {
    const human = s.rows.filter((r) => r.kind === 'human');
    assert.equal(human.length, 1);
    assert.deepEqual(human[0], { kind: 'human', n: 1, at: '2026-11-11T10:00:00.000Z', question: DRAFTER.question, answer: '~/out', line: 2 });
    const kinds = s.rows.map((r) => r.kind);
    assert.equal(kinds.indexOf('human'), kinds.indexOf('draft') + 1);
    const shown = getDraftBlock(s.flowDir, s.flowDir).rows.filter((r) => /^you were asked: /.test(r.action));
    assert.equal(shown.length, 1);
    assert.equal(shown[0].action, `you were asked: ${DRAFTER.question}`);
    assert.equal(shown[0].gap, 'you said: ~/out');
  } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('an unanswered drafter question leaves no row', () => {
  const s = session([DRAFTER], [null]);
  try { assert.equal(s.rows.some((r) => r.kind === 'human'), false); } finally { rmSync(s.root, { recursive: true, force: true }); }
});

test('a page-look row and a kept row are unchanged when a drafter question is answered beside them', () => {
  const kept = [{ line: 1, rule: 2, ruleText: 'nonstop', added: null, check: null }];
  const withD = session([LOOK, DRAFTER], ['agree', 'x'], kept);
  const without = session([LOOK], ['agree'], kept);
  try {
    const look = (rows) => rows.filter((r) => r.kind === 'human' && r.source === 'look');
    assert.equal(look(without.rows).length, 2);
    assert.equal(JSON.stringify(look(withD.rows)), JSON.stringify(look(without.rows)));
    assert.equal(withD.rows.filter((r) => r.kind === 'human').length, 3);
    assert.deepEqual(look(withD.rows).map((r) => r.n), [1, 2]);
  } finally { rmSync(withD.root, { recursive: true, force: true }); rmSync(without.root, { recursive: true, force: true }); }
});
