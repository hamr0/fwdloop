// Live bug 2026-11-14 (flow walk-m16-m14): a run-again re-draft asked about every rule of `~ exactly 3 bullets; exactly 3 list items`; each Agree (reading "exactly 3 list items")
// appended another copy to the line, so the job was no longer the signed one and signing refused it. Bareloop fixed this as F318 (0291e910, v0.56.0): an Agree to words the line already
// holds adds no copy. $0: the redraft child is a stub script, no provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftToDir, signDraft } from '../src/authoring.js';
import { jobKeyOfCard } from '../src/jobkey.js';
import { RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';
import { createAuthor } from '../src/panel/author.js';
import { appendAnswersToJob, applyAnswers, cardToProse } from '../src/panel/authorcard.js';
import { tickedConfig } from './m4e-world.mjs';

const ID = 'd-0000000001-abcd';
const JOB = 'Read my resume\n~ exactly 3 bullets; exactly 3 list items';
const READING = 'exactly 3 list items';
const ask = (ruleNo, ruleText) => ({ line: 1, question: `About "${ruleText}"`, source: 'look', ask: 'check', ruleNo, ruleText, proposal: READING, check: { rule: 'exactlyListItems', n: 3 } });

function runAgainDraft() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16as-'));
  mkdirSync(path.join(root, 'job2'), { recursive: true });
  const dir = path.join(root, '.drafts', ID);
  mkdirSync(path.join(dir, 'draft'), { recursive: true });
  const home = path.join(root, 'cfg');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(path.join(home, 'config.json'), JSON.stringify(tickedConfig()));
  const out = path.join(root, 'out');
  mkdirSync(out);
  writeFileSync(path.join(dir, 'card.json'), JSON.stringify({ flowName: 'job2', job: JOB, capUsd: '0.25', askWait: '1h', destination: out, provider: 'DEEPSEEK_API_KEY', model: 'fake-ticked' }));
  writeFileSync(path.join(dir, 'run-of.json'), JSON.stringify({ flow: 'job2', fromRun: 'run-1' }));
  writeFileSync(path.join(dir, 'draft', 'log.json'), JSON.stringify({ ok: false, reds: [] }));
  writeFileSync(path.join(dir, 'draft', 'questions.json'), JSON.stringify({ questions: [ask(1, 'exactly 3 bullets'), ask(2, 'exactly 3 list items')] }));
  const stub = path.join(root, 'stub-bin.mjs');
  writeFileSync(stub, '// stub redraft child: does nothing, calls no provider\n');
  const author = createAuthor({ root, home, bin: stub, skipMonthly: true, loadEnv: () => ({ ok: true, env: { DEEPSEEK_API_KEY: 'sk-test-not-a-real-key-0000' }, refusal: null, keyNames: ['DEEPSEEK_API_KEY'] }), childRunning: () => false });
  return { dir, author };
}

test('a run-again draft whose Agree gives words already on the line grows no copy of them, and the redraft starts (break: drop the same-words guard in appendAnswersToJob)', () => {
  const { dir, author } = runAgainDraft();
  assert.equal(author.answer(ID, { k: 1, choice: 'agree' }).status, 200);
  const r = author.answer(ID, { k: 2, choice: 'agree' });
  assert.equal(r.status, 202, JSON.stringify(r.body));
  const grown = JSON.parse(readFileSync(path.join(dir, 'card-1.json'), 'utf8')).job;
  assert.equal(grown, JOB, 'the job text is the signed job text, no third copy');
});

test('appendAnswersToJob: new words still add a line (am2 item 3); words already on the line, alone or one part of a `; ` line, add nothing and still count', () => {
  assert.equal(appendAnswersToJob(JOB, [{ line: 1, answer: 'exactly 5 words' }]).job, `${JOB}\n~ exactly 5 words`);
  for (const answer of ['exactly 3 list items', 'exactly 3 bullets', 'Exactly 3 LIST items.', '  exactly   3 list items ']) {
    const r = appendAnswersToJob(JOB, [{ line: 1, answer }]);
    assert.equal(r.job, JOB, answer);
    assert.equal(r.added, 1, 'taken: the line already says it');
  }
  assert.equal(appendAnswersToJob(JOB, [{ line: 1, answer: 'exactly 3 list' }]).job, `${JOB}\n~ exactly 3 list`, 'a prefix of a rule is not the rule');
  assert.equal(appendAnswersToJob(JOB, [{ line: 1, answer: 'x' }, { line: 1, answer: 'x' }]).job, `${JOB}\n~ x`, 'twice in one batch is one rule');
});

test('applyAnswers: two Agrees to the words of the line\'s own rules leave the job text alone', () => {
  const all = [{ line: 1, rule: 'exactly 3 bullets', left: false }, { line: 1, rule: READING, left: false }];
  assert.equal(applyAnswers(JOB, all).job, JOB);
});

// ---- the sign side: with the job text unchanged, the re-drafted plan signs as a run of the same workflow ----
const CARD = { flowName: 'job2', job: JOB, capUsd: '0.25', askWait: '1h', destination: '/tmp/out' };
const AGREES = [{ line: 1, rule: 'exactly 3 bullets', left: false }, { line: 1, rule: READING, left: false }];

test('the job key (what sign-as-run compares) is the signed one after the Agrees, and was NOT before the fix (the old grown text)', () => {
  assert.equal(jobKeyOfCard(applyAnswers(JOB, AGREES).job), jobKeyOfCard(JOB));
  assert.equal(cardToProse({ ...CARD, job: applyAnswers(JOB, AGREES).job }), cardToProse(CARD), 'the prose the redraft is given is the signed job\'s prose');
  assert.notEqual(jobKeyOfCard(`${JOB}; ${READING}`), jobKeyOfCard(JOB), 'the live bug: a third copy is a different job');
});

test('a run-again re-draft whose answers changed nothing signs as a run of the same flow; a grown guardrail is refused "not the job of"', async () => {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16sr-'));
  const root = path.join(work, 'flows');
  const guard = 'at most 600 words; at most 600 words'; // a single `; ` guardrail, as the live line was
  const draftInto = async (tag, g) => {
    const fx = job2Fixture();
    const proseFile = path.join(work, `${tag}.prose.txt`);
    writeFileSync(proseFile, fx.proseG.replace('3 sections, all under 600 words', g));
    const dir = path.join(work, tag);
    const r = await draftToDir({ proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {}, noQuestions: true });
    assert.equal(r.ok, true, JSON.stringify(r));
    return { dir, hash: r.hash };
  };
  const v1 = await draftInto('d1', guard);
  assert.equal(signDraft({ dir: v1.dir, approve: v1.hash, signedBy: 'alice' }).ok, true);
  const same = await draftInto('d2', guard);
  const ok = signDraft({ dir: same.dir, approve: same.hash, signedBy: 'alice', asRunOf: { flow: 'job2' } });
  assert.equal(ok.ok, true, JSON.stringify(ok.reds));
  assert.equal(ok.runId, 'run-1');
  const grown = await draftInto('d3', `${guard}; at most 600 words`);
  const bad = signDraft({ dir: grown.dir, approve: grown.hash, signedBy: 'alice', asRunOf: { flow: 'job2' } });
  assert.equal(bad.ok, false);
  assert.match(bad.reds.join('\n'), /not the job of "job2"/);
});
