// The 409 flake of test/m16-p4-walk.test.js (root cause, 2026-11-14): the draft child writes its result and its questions, THEN exits. In that window the phase read `questions-open` (the files say a question is
// waiting) while `POST /answer` refused 409 `draft-live` (the child is still alive), so a client that answered the moment the page showed the question got a refusal. The phase is now `drafting` while the child is
// alive, so what the reader says is what the writer takes. Injected timing, no sleeps, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createAuthor } from '../src/panel/author.js';

const ID = 'd-0000000001-abcd';
function askingDraft() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16win-'));
  const dir = path.join(root, '.drafts', ID);
  mkdirSync(path.join(dir, 'draft'), { recursive: true });
  writeFileSync(path.join(dir, 'card.json'), JSON.stringify({ flowName: 'job2', job: 'Read my resume' }));
  // a first plan that ended red and asked one question: the child has written both files
  writeFileSync(path.join(dir, 'draft', 'log.json'), JSON.stringify({ ok: false, reds: [] }));
  writeFileSync(path.join(dir, 'draft', 'questions.json'), JSON.stringify({ questions: [{ line: 1, question: 'Which resume?' }] }));
  return root;
}
const authorOf = (root, alive) => createAuthor({ root, skipMonthly: true, loadEnv: () => ({ ok: true, env: {}, refusal: null }), childRunning: () => alive.now });

test('while the draft child is still alive a written question is not offered: the phase is drafting, never questions-open (break: derive questions-open from the files alone)', () => {
  const alive = { now: true };
  const author = authorOf(askingDraft(), alive);
  const early = author.get(ID);
  assert.equal(early.body.phase, 'drafting', JSON.stringify(early.body.phase));
  // what the reader does not offer the writer refuses, with the same cause
  const refused = author.answer(ID, { k: 1, answer: 'the Rust one', choice: 'rule' });
  assert.equal(refused.status, 409);
  // the child exits: the same files now read questions-open, and the answer is taken
  alive.now = false;
  const late = author.get(ID);
  assert.equal(late.body.phase, 'questions-open');
  assert.equal(late.body.openK, 1);
});

test('the phase never says questions-open for an answer the door would refuse as draft-live', () => {
  for (const now of [true, false]) {
    const author = authorOf(askingDraft(), { now });
    const phase = author.get(ID).body.phase;
    const r = author.answer(ID, { k: 1, answer: 'the Rust one', choice: 'rule' });
    if (phase === 'questions-open') assert.notEqual(r.body.refused, 'draft-live', 'offered, so not refused as live');
    else assert.equal(r.status, 409);
  }
});
