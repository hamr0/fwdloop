// M4e amendments 24, 25, 26 — drafter questions (try 3 only) and Checked / Not checked. $0: a fake provider, no key, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  draft, QUESTIONS_PROMPT, NOTCHECKED_PROMPT, normalizeQuestions, linesNamedByReds, buildRoundSchema,
} from '../src/drafter.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const NUMBERISH = /\d|\b(one|two|three|four|five|six|seven|eight|nine|ten|couple|few|several|pair|dozen|single|once|twice|max|maximum|at most|up to|limit)\b/i;

/** A fake provider that also records the tool schema each call was offered. */
function recProvider(replies) {
  const p = fakeProvider(replies);
  const inner = p.generate.bind(p);
  p.schemas = [];
  p.generate = async (messages, tools, options) => {
    p.schemas.push(JSON.parse(JSON.stringify(tools[0].parameters)));
    return inner(messages, tools, options);
  };
  return p;
}
/** Fails the validator; its red names steps[2] = job line 3. */
const bad = (extra = {}) => { const a = validArgs(); a.steps[2].primitives = ['stash']; return { ...a, ...extra }; };
const run = (provider, extra = {}) => draft({
  proseText: job2Fixture().prose, provider, rates: RATES, modelId: MODEL, ...extra,
});

test('A1: tries 1 and 2 never carry a questions property; try 3 does; notChecked is offered on every try', async () => {
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply(validArgs())]);
  await run(p);
  assert.equal(p.calls.length, 3);
  for (const i of [0, 1]) {
    assert.equal(p.schemas[i].properties.questions, undefined, `try ${i + 1} has no way to ask`);
    assert.ok(p.schemas[i].properties.notChecked, `try ${i + 1} offers notChecked`);
  }
  assert.ok(p.schemas[2].properties.questions && p.schemas[2].properties.notChecked);
  assert.ok(!p.schemas[2].required.includes('questions') && !p.schemas[2].required.includes('notChecked'));
  for (const c of p.calls.slice(0, 2)) assert.ok(!c.messages.some((m) => String(m.content).includes(QUESTIONS_PROMPT)), 'no asking line before try 3');
  assert.ok(p.calls[2].messages.at(-1).content.endsWith(QUESTIONS_PROMPT));
});

test('A2: a draft that passes try 1 or try 2 never opens questions', async () => {
  const p1 = recProvider([toolReply(validArgs())]);
  const r1 = await run(p1);
  assert.equal(p1.calls.length, 1);
  assert.deepEqual(r1.questions, []);
  const p2 = recProvider([toolReply(bad()), toolReply(validArgs())]);
  const r2 = await run(p2);
  assert.equal(p2.calls.length, 2);
  assert.equal(p2.schemas[1].properties.questions, undefined);
  assert.deepEqual(r2.questions, []);
});

test('A3: a question sent when it was not offered is a stray-key red, not a silent pass', async () => {
  const p = recProvider([toolReply({ ...validArgs(), questions: [{ line: 3, question: 'how long?' }] }), toolReply(validArgs())]);
  const r = await run(p);
  assert.equal(r.revisions, 1, 'try 1 was refused for the stray key');
  assert.match(p.calls[1].messages.at(-1).content, /questions/);
  assert.deepEqual(r.questions, []);
});

test('A4: try 3 keeps a question on a line try 2 failed on; drops a missing line, a line not failed on, a third; every drop is logged with its reason', async () => {
  const qs = [
    { line: 3, question: 'What does "all under 600 words" cover?' },
    { line: 9, question: 'a line that does not exist' },
    { line: 1, question: 'a line try 2 did not fail on' },
    { question: 'no line' },
    { line: 3, question: 'second kept' },
    { line: 3, question: 'a third question' },
  ];
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply({ ...validArgs(), questions: qs })]);
  const r = await run(p);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(r.questions, [{ line: 3, question: 'What does "all under 600 words" cover?' }, { line: 3, question: 'second kept' }]);
  assert.deepEqual(r.droppedQuestions.map((d) => d.reason), [
    "line 9 is not a line try 2's checks failed on", "line 1 is not a line try 2's checks failed on", 'no line', 'third question']);
  const logged = r.log.at(-1).droppedQuestions;
  assert.equal(logged.length, 4, 'the draft log carries every drop');
  assert.ok(logged.every((d) => typeof d.reason === 'string' && d.reason !== ''));
  assert.equal(r.declaration.questions, undefined, 'questions are stripped before validateDeclaration');
});

test('A5: no number appears in the prompt, the added line or the questions schema', async () => {
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply(validArgs())]);
  await run(p);
  assert.doesNotMatch(QUESTIONS_PROMPT, NUMBERISH);
  assert.doesNotMatch(NOTCHECKED_PROMPT, NUMBERISH);
  assert.doesNotMatch(JSON.stringify(p.schemas[2].properties.questions), NUMBERISH);
  assert.doesNotMatch(JSON.stringify(p.schemas[2].properties.notChecked), NUMBERISH);
  const base = p.calls[0].messages[0].content;
  assert.ok(p.calls[2].messages[0].content.startsWith(base), 'the system prompt is the same on every try');
});

test('A6: notChecked is stripped before validation, comes from the round that produced the plan, and blanks are dropped', async () => {
  const p = recProvider([toolReply(bad({ notChecked: ['from try one'] })), toolReply(validArgs()) ]);
  const r1 = await run(p);
  assert.equal(r1.ok, true, JSON.stringify(r1.reds));
  assert.deepEqual(r1.notChecked, [], 'try 2 sent none: the plan\'s notChecked is try 2\'s, not try 1\'s');
  assert.equal(r1.declaration.notChecked, undefined);
  const p2 = recProvider([toolReply({ ...validArgs(), notChecked: ['tone', '  ', 7, ' wording '] })]);
  const r2 = await run(p2);
  assert.deepEqual(r2.notChecked, ['tone', 'wording']);
  assert.ok(p2.calls[0].messages[0].content.includes(NOTCHECKED_PROMPT));
});

test('A7: offerQuestions:false (the redraft after an answer) never offers questions, even on try 3', async () => {
  const p = recProvider([toolReply(bad()), toolReply(bad()), toolReply({ ...validArgs(), questions: [{ line: 3, question: 'x' }] })]);
  const r = await run(p, { offerQuestions: false });
  assert.equal(p.schemas[2].properties.questions, undefined);
  assert.ok(!p.calls[2].messages.at(-1).content.includes(QUESTIONS_PROMPT));
  assert.equal(r.ok, false, 'the stray questions key reds');
  assert.deepEqual(r.questions, []);
});

test('A8: normalizeQuestions and linesNamedByReds', () => {
  assert.equal(normalizeQuestions([{ line: 1, question: 'x' }], []).kept.length, 0, 'no failed line means nothing may be asked');
  assert.equal(normalizeQuestions([{ line: 1, question: '  ' }], [1]).dropped[0].reason, 'blank question');
  const decl = { steps: [{ fromLine: 1 }, { fromLine: 3 }] };
  assert.deepEqual(linesNamedByReds(['declaration: ask at line 4 has no step', 'declaration: steps[1].primitives bad'], decl, [1, 2, 3, 4]), [3, 4]);
  assert.ok(buildRoundSchema([{ verb: 'read' }], { questions: true }).properties.questions);
});

// ---- Piece 2: draft files and state (the panel's real HTTP door against the real `fwdloop draft` child, $0) --------------------------------
// eslint-disable-next-line import/first
import { spawnSync } from 'node:child_process';
// eslint-disable-next-line import/first
import { existsSync, readFileSync } from 'node:fs';
// eslint-disable-next-line import/first
import path from 'node:path';
// eslint-disable-next-line import/first
import { isFwdloopAlive } from '../src/liveness.js';
// eslint-disable-next-line import/first
import { signDraft, specHash, OPEN_QUESTION_SAY, readQuestions } from '../src/authoring.js';
// eslint-disable-next-line import/first
import { appendAnswersToJob, parseJobBox } from '../src/panel/authorcard.js';
// eslint-disable-next-line import/first
import { buildSetupRows } from '../src/setup.js';
// eslint-disable-next-line import/first
import {
  JOB, HERE, killChildrenAfter, until, world, tmp,
} from './m4e-world.mjs';

killChildrenAfter();
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const QJOB = JOB.replace('Read my resume,', 'Read my resume QMARK,');
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settleOn = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
const Q12 = JSON.stringify([{ line: 1, question: 'Which resume do you mean?' }, { line: 2, question: 'Which part of the JD matters most?' }]);
async function askingWorld(extraEnv = {}) {
  const offeredLog = path.join(tmp('offered'), 'offered.log');
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_OFFERED_LOG: offeredLog, ...extraEnv } });
  const id = (await w.post('/api/author/draft', w.card({ job: QJOB }))).json().draftId;
  const s = await settleOn(w, id, ['questions-open', 'green', 'red', 'stopped']);
  await childGone(w, id);
  const offered = () => (existsSync(offeredLog) ? readFileSync(offeredLog, 'utf8').split('\n').filter(Boolean) : []);
  return { w, id, s, offered };
}

test('B1: tries 1 and 2 of the real child asked nothing, try 3 asked two; the draft is questions-open, questions.json is in the plan folder, a reload keeps it open', async () => {
  const { w, id, s, offered } = await askingWorld();
  assert.equal(s.phase, 'questions-open', JSON.stringify(s));
  assert.deepEqual(offered(), ['not-offered', 'not-offered', 'offered']);
  assert.equal(s.total, 2);
  assert.equal(s.openK, 1);
  assert.deepEqual(s.questions.map((q) => [q.k, q.line, q.answered]), [[1, 3, false], [2, 3, false]]);
  assert.match(s.questions[0].lineText, /^write me a summary resume/);
  const planDir = path.join(w.dir(id), 'draft');
  assert.equal(readQuestions(planDir).open.length, 2);
  assert.ok(existsSync(path.join(planDir, 'questions.json')) && existsSync(path.join(planDir, 'not-checked.json')));
  assert.equal(s.hash, undefined, 'nothing is signable while a question is open');
  const again = await state(w, id);
  assert.equal(again.phase, 'questions-open', 'a reload keeps the question open');
  const live = (await w.get('/api/author/live')).json();
  assert.equal(live.draft.phase, 'questions-open');
});

test('B2: a blank answer is refused and the question stays open; no answer file; no way to skip', async () => {
  const { w, id } = await askingWorld();
  for (const answer of ['', '   ', '\n', undefined, 7]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer });
    assert.equal(r.status, 400, JSON.stringify(answer));
    assert.equal(r.json().refused, 'blank-answer');
    assert.match(r.json().say, /can't be skipped/);
  }
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false);
  assert.equal((await state(w, id)).openK, 1);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'two\nlines' })).json().refused, 'one-line');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: `has a key ${'sk-canary-M4E-piece2b-3c9d1e7a5b2f4860bb77'}` })).json().refused, 'key');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 2, answer: 'out of order' })).json().refused, 'stale-question');
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-2.json')), false);
});

test('B3: sign is refused while a question is open at the page sign route, at signDraft, and at the CLI (which says: answer in the panel)', async () => {
  const { w, id } = await askingWorld();
  const planDir = path.join(w.dir(id), 'draft');
  const hash = readFileSync(path.join(planDir, 'spec.hash'), 'utf8').trim();
  assert.ok(hash.length > 10, 'the first plan is green on disk; only the open question stops the sign');
  for (const url of ['sign-prepare', 'sign']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post(`/api/author/${id}/${url}`, { hash });
    assert.equal(r.status, 409, url);
    assert.equal(r.json().refused, 'question-open');
  }
  const flows = () => existsSync(path.join(w.root, 'job2'));
  assert.equal(flows(), false);
  const direct = signDraft({ dir: planDir, approve: hash, signedBy: 'tester', env: {} });
  assert.equal(direct.ok, false);
  assert.match(direct.reds.join(' '), /still open/);
  assert.equal(flows(), false, 'signDraft wrote no flow');
  const cli = spawnSync(process.execPath, [BIN, 'sign', planDir, '--approve', hash], { env: { ...w.env }, encoding: 'utf8' });
  assert.notEqual(cli.status, 0);
  assert.match(cli.stderr, /Answer it in the panel/);
  assert.equal(flows(), false);
  // all three read the one check
  assert.ok(direct.reds[0].includes(OPEN_QUESTION_SAY));
  // revise is not a way round an open question
  const rev = await w.post(`/api/author/${id}/revise`, w.card({ job: QJOB }));
  assert.equal(rev.status, 409);
  assert.equal(rev.json().refused, 'question-open');
});

test('B4: answering every question drafts again with a fresh child that never asks; each answer is a verbatim ~ line in the card, the prose, the signed text and the hash; it uses no revise', async () => {
  const { w, id, offered } = await askingWorld({ FWDLOOP_TEST_DRAFT_REDSTEP: '0,1', FWDLOOP_TEST_DRAFT_QUESTIONS: Q12 });
  const a1 = 'ANSMARK use the resume in my inputs, not an old one';
  const a2 = 'Count every word except the headings';
  const r1 = await w.post(`/api/author/${id}/answer`, { k: 1, answer: a1 });
  assert.equal(r1.status, 200, r1.text);
  const mid = await state(w, id);
  assert.equal(mid.phase, 'questions-open');
  assert.equal(mid.openK, 2, 'one at a time');
  assert.deepEqual(JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'answer-1.json'), 'utf8')).answer, a1);
  const r2 = await w.post(`/api/author/${id}/answer`, { k: 2, answer: a2 });
  assert.equal(r2.status, 202, r2.text);
  const g = await until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  assert.deepEqual(offered().slice(3), ['not-offered'], 'the redraft asked nothing (one call, no questions property)');
  assert.equal(g.revisesLeft, 2, 'an answer redraft is not a revise');
  assert.equal(g.revises[0].kind, 'answers');
  // the card: each answer a ~ line under line 3, after that line's own ~ line, word for word
  const card = JSON.parse(readFileSync(path.join(w.dir(id), 'card-1.json'), 'utf8'));
  const steps = parseJobBox(card.job).steps;
  assert.deepEqual([steps[0].guardrails, steps[1].guardrails, steps[2].guardrails], [[a1], [a2], ['3 sections, all under 600 words']]);
  assert.equal(steps.length, 5);
  // the prose, then the signed flow, carry them; the goal is still the line verbatim
  const prose = readFileSync(path.join(w.dir(id), 'prose-1.txt'), 'utf8');
  assert.ok(prose.includes(`1. Read my resume QMARK,\n   guardrail: ${a1}\n2. and read the JD to compare it against,\n   guardrail: ${a2}\n3. `));
  assert.equal(readFileSync(path.join(w.dir(id), 'draft-1', 'prose.txt'), 'utf8'), prose);
  const decl = JSON.parse(readFileSync(path.join(w.dir(id), 'draft-1', 'declaration.json'), 'utf8'));
  assert.equal(decl.steps[0].goal, 'Read my resume QMARK,', 'the step goal is the signed line, not the answer');
  // under "Your answers", with the line each belongs to
  assert.deepEqual(g.answers.map((a) => [a.line, a.answer]), [[1, a1], [2, a2]]);
  assert.match(g.answers[1].lineText, /^and read the JD/);
  // in the hash: the same plan without the answer lines hashes differently
  const parts = (dir) => ['prose.txt', 'declaration.json', 'input-facts.json', 'readout.txt', 'target.json'].map((f) => readFileSync(path.join(dir, f), 'utf8'));
  const [proseText, declarationText, inputFactsText, readoutText, targetText] = parts(path.join(w.dir(id), 'draft-1'));
  const hashWith = specHash({ proseText, declarationText, inputFactsText, readoutText, targetText });
  const hashWithout = specHash({ proseText: proseText.replace(`   guardrail: ${a1}\n`, ''), declarationText, inputFactsText, readoutText, targetText });
  assert.equal(hashWith.hash, g.hash);
  assert.notEqual(hashWith.hash, hashWithout.hash);
  // signing the redraft puts the answers in the signed prose
  const signed = signDraft({ dir: path.join(w.dir(id), 'draft-1'), approve: g.hash, signedBy: 'tester', env: {} });
  assert.equal(signed.ok, true, JSON.stringify(signed));
  assert.ok(readFileSync(path.join(signed.flowDir, 'prose.txt'), 'utf8').includes(`guardrail: ${a1}`));
  // booked as an answer redraft, not a revise
  const rows = buildSetupRows({
    sessionDir: w.dir(id), planDir: path.join(w.dir(id), 'draft-1'), hash: g.hash, signedBy: 't', signedAt: new Date().toISOString(),
  }).map((r) => r.kind);
  assert.ok(rows.includes('redraft') && !rows.includes('revise'), rows.join(','));
  // the first plan's folder can no longer be signed (its answers are in the newer plan)
  const old = signDraft({ dir: path.join(w.dir(id), 'draft'), approve: readFileSync(path.join(w.dir(id), 'draft', 'spec.hash'), 'utf8').trim(), signedBy: 'tester', env: {} });
  assert.equal(old.ok, false);
});

test('B5: a question about line 9 in a 5-line job and a third question are dropped and logged; if none is kept the draft is just green', async () => {
  const qs = [
    { line: 9, question: 'about a line that is not there' },
    { line: 3, question: 'kept one' }, { line: 3, question: 'kept two' }, { line: 3, question: 'a third' },
  ];
  const { w, id, s } = await askingWorld({ FWDLOOP_TEST_DRAFT_QUESTIONS: JSON.stringify(qs) });
  assert.equal(s.total, 2);
  assert.deepEqual(s.questions.map((q) => q.question), ['kept one', 'kept two']);
  const log = JSON.parse(readFileSync(path.join(w.dir(id), 'draft', 'log.json'), 'utf8'));
  const dropped = log.log.flatMap((e) => e.droppedQuestions ?? []);
  assert.deepEqual(dropped.map((d) => d.reason), ["line 9 is not a line try 2's checks failed on", 'third question']);
  const none = await askingWorld({ FWDLOOP_TEST_DRAFT_QUESTIONS: JSON.stringify([{ line: 9, question: 'x' }]) });
  assert.equal(none.s.phase, 'green', 'every question dropped: nothing to answer');
  assert.equal(existsSync(path.join(none.w.dir(none.id), 'draft', 'questions.json')), false);
});

test('B5b: an answer about a line that already has a guardrail is accepted (no guardrail-clash) and joins after it', async () => {
  const { w, id, s } = await askingWorld();
  assert.equal(s.phase, 'questions-open');
  const r = await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'a perfectly good answer' });
  assert.notEqual(r.json().refused, 'guardrail-clash', r.text);
  assert.equal(r.status, 200, r.text);
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), true);
});

test('B6: appendAnswersToJob puts an answer under its own line after that line\'s ~ lines, leaves the rest alone, and counts what it added', () => {
  const job = 'one\n~g1\n\ntwo\nthree\n~g3';
  const r = appendAnswersToJob(job, [{ line: 1, answer: 'a' }, { line: 3, answer: 'b' }, { line: 1, answer: 'c' }, { line: 9, answer: 'z' }]);
  assert.equal(r.job, 'one\n~g1\n~ a\n~ c\n\ntwo\nthree\n~g3\n~ b');
  assert.equal(r.added, 3);
  assert.equal(appendAnswersToJob('one', []).job, 'one');
});

// ---- Piece 3: Checked (built by code from typed closes) / Not checked (the drafter's own reading, labelled) ----------------------------------
// eslint-disable-next-line import/first
import { checkedLines, notCheckedBlock, NOT_CHECKED_LABEL } from '../src/checked.js';

test('C1: Checked lists only what a typed check really checks, per step, in plain sentences', () => {
  const lines = checkedLines({
    steps: [
      { fromLine: 1, goal: 'g1', close: { class: 'green' } },
      { fromLine: 2, goal: 'g2', close: { class: 'softgreen', shape: { sections: ['Fit', 'Skills'], wordsPerSection: 200, maxWords: 600 } } },
      { fromLine: 3, goal: 'g3', close: { class: 'softgreen', shape: { linesPerInvoice: 3, mustCarry: ['date', 'total'] } } },
      { fromLine: 4, goal: 'g4', close: { class: 'hitl' } },
    ],
  });
  assert.equal(lines.length, 4);
  assert.match(lines[0].sentences.join(' '), /cite its source cell.*recomputes/);
  assert.deepEqual(lines[1].sentences, [
    'The reply is checked as plain text only.', 'The whole output is under 600 words.', 'These section headings are there, in this order: Fit, Skills.', 'Each of those sections is about 200 words.']);
  assert.deepEqual(lines[2].sentences, ['The reply is checked as plain text only.', 'The output comes in blocks of 3 lines.', 'Every block carries: date, total.']);
  assert.deepEqual(lines[3].sentences, ['No machine check of the content: you check it at the ask.']);
  assert.deepEqual(checkedLines({ steps: [{ close: { class: 'hitl' } }] }, { hasAsk: false })[0].sentences, ['No machine check of the content; the machine checks only that the step happened.'], 'no ask in the job: it never says you check it at the ask');
  // a softgreen with only sections says nothing about words, lines or tone
  const only = checkedLines({ steps: [{ close: { class: 'softgreen', shape: { sections: ['A'] } } }] })[0].sentences.join(' ');
  assert.doesNotMatch(only, /words|lines|tone|carries/);
});

test('C2: Checked is built from typed fields only: model prose, an unknown shape key and extra step text never appear in it', () => {
  const hostile = {
    steps: [{
      fromLine: 1, goal: 'g', note: 'tone is checked and the facts are verified', close: { class: 'softgreen', shape: { sections: ['A'], toneIsFriendly: true, comment: 'every claim verified' } },
    }],
    checked: ['everything is verified'],
  };
  const text = JSON.stringify(checkedLines(hostile));
  assert.doesNotMatch(text, /tone|verified|friendly|every claim/);
});

test('C3: Not checked always carries its label, with or without items; blanks and non-strings are dropped', () => {
  assert.equal(NOT_CHECKED_LABEL, "the drafter's own reading, not a guarantee");
  for (const raw of [undefined, null, [], 'x', 7]) assert.deepEqual(notCheckedBlock(raw), { label: NOT_CHECKED_LABEL, items: [] });
  assert.deepEqual(notCheckedBlock([' tone ', '', 3, 'wording']), { label: NOT_CHECKED_LABEL, items: ['tone', 'wording'] });
});

test('C4: a green plan carries Checked and Not checked (labelled) in its state and at sign-prepare; neither is in the readout, the plan folder\'s hash parts, or the hash', async () => {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_NOTCHECKED: JSON.stringify(['whether the tone suits the role']) } });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await settleOn(w, id, ['green', 'red', 'stopped', 'questions-open']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  assert.equal(g.notChecked.label, NOT_CHECKED_LABEL);
  assert.deepEqual(g.notChecked.items, ['whether the tone suits the role']);
  assert.equal(g.checked.length, 5, 'one entry per step');
  assert.ok(g.checked.every((c) => c.sentences.length > 0));
  assert.equal(g.checked[2].class, 'softgreen');
  assert.match(g.checked[2].sentences.join(' '), /under 600 words/);
  const sp = (await w.post(`/api/author/${id}/sign-prepare`, {})).json();
  assert.equal(sp.ok, true);
  assert.deepEqual(sp.notChecked, g.notChecked);
  assert.deepEqual(sp.checked, g.checked);
  assert.deepEqual(sp.answers, []);
  const dir = path.join(w.dir(id), 'draft');
  const readout = readFileSync(path.join(dir, 'readout.txt'), 'utf8');
  assert.doesNotMatch(readout, /tone suits|Not checked|Checked/);
  const declText = readFileSync(path.join(dir, 'declaration.json'), 'utf8');
  assert.doesNotMatch(declText, /tone suits|notChecked/, 'stripped before the declaration is written');
  const h = specHash({
    proseText: readFileSync(path.join(dir, 'prose.txt'), 'utf8'), declarationText: declText, inputFactsText: readFileSync(path.join(dir, 'input-facts.json'), 'utf8'), readoutText: readout, targetText: readFileSync(path.join(dir, 'target.json'), 'utf8'),
  });
  assert.equal(h.hash, g.hash, 'the hash is the five signed parts only');
  // a plan whose drafter listed nothing still shows the label
  const w2 = await world();
  const id2 = (await w2.post('/api/author/draft', w2.card())).json().draftId;
  const g2 = await settleOn(w2, id2, ['green', 'red', 'stopped']);
  assert.deepEqual(g2.notChecked, { label: NOT_CHECKED_LABEL, items: [] });
});

// ---- Piece 4: the panel page (source-level like test/m4e-revise-page.test.js; the real browser walk is separate) -----------------------------
// eslint-disable-next-line import/first
import { rq } from './m4e-world.mjs';

const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
function fnSrc(name) {
  const start = CHAT.indexOf(`    function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in the Chat block`);
  return CHAT.slice(start, CHAT.indexOf('\n    }\n', start) + 7);
}
const load = (name, prelude = '') => new Function(`${prelude}\n${fnSrc(name)}\nreturn ${name};`)();
const openState = { draftId: 'd-1', phase: 'questions-open', openK: 1, total: 2, questions: [
  { k: 1, line: 3, lineText: 'write me a summary resume', question: 'What does "3 sections" mean?', answered: false },
  { k: 2, line: 3, lineText: 'write me a summary resume', question: 'Which words count?', answered: false }] };

test('P1: the question view says "A question the plan raised (k of n)", one at a time; no question open means no view', () => {
  const v = load('questionViewFor')(openState);
  assert.equal(v.head, 'A question the plan raised (1 of 2)');
  assert.equal(v.line, 'About job line 3: write me a summary resume');
  assert.equal(v.question, 'What does "3 sections" mean?');
  assert.equal(load('questionViewFor')({ ...openState, openK: 2 }).head, 'A question the plan raised (2 of 2)');
  for (const st of [null, { ...openState, phase: 'green' }, { ...openState, phase: 'redrafting' }, { ...openState, questions: [] }]) assert.equal(load('questionViewFor')(st), null);
});

test('P2: there is no Skip; the box has an answer field and a Send button; ids are unique across the page', () => {
  const block = PAGE.slice(PAGE.indexOf('id="chat-question"'), PAGE.indexOf('id="chat-extras"'));
  assert.doesNotMatch(block, /skip/i);
  assert.match(block, /id="chat-q-answer"/);
  assert.match(block, /<button[^>]*id="chat-q-send"[^>]*>Send<\/button>/);
  const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  const dup = ids.filter((x, i) => ids.indexOf(x) !== i);
  assert.deepEqual([...new Set(dup)], [], 'no element id appears twice');
  for (const id of ['chat-question', 'chat-q-head', 'chat-q-line', 'chat-q-text', 'chat-q-answer', 'chat-q-error', 'chat-q-send', 'chat-extras']) assert.equal(ids.filter((x) => x === id).length, 1, id);
  assert.doesNotMatch(CHAT.replace(/^\s*\/\/.*$/gm, ''), /skip/i);
});

test('P3: while a question is open the main button is off, the card is locked, the steps line waits for the answer; a redraft is not counted as a revise', () => {
  const mb = load('mainButtonFor');
  assert.deepEqual(mb({ mode: 'new', session: true, startOk: true, phase: 'questions-open', revisable: true, left: 2 }), { text: 'Sign & run', action: 'none', disabled: true });
  assert.deepEqual(mb({ mode: 'new', session: true, startOk: true, phase: 'redrafting', revisable: true, left: 2 }), { text: 'Sign & run', action: 'none', disabled: true });
  assert.match(fnSrc('cardLocked'), /ph === "questions-open"/);
  const steps = load('stepsFor');
  const s = steps({ ...openState, card: {}, revises: [] }, { model: 'm', starting: false, signClicked: false });
  assert.deepEqual(s.map((x) => `${x.id}:${x.status}:${x.label}`), ['drafted:done:drafted with m', 'question:waiting:waiting for your answer (1 of 2)']);
  const after = steps({ phase: 'green', card: {}, revises: [{ n: 1, kind: 'answers', phase: 'green' }, { n: 2, kind: 'revise', phase: 'green' }] }, { model: 'm', starting: false, signClicked: false });
  assert.deepEqual(after.map((x) => x.label), ['drafted with m', 'drafted again with your answers', 'revise 1', 'waiting for your signature']);
});

test('P4: a poll tick never rewrites an answer being typed; only a NEW question (or none) clears the box', () => {
  const prelude = `var qKey = ""; var questionBox = {hidden: true}; var qHead = {}; var qLine = {}; var qText = {}; var qAnswer = {value: ""}; var qError = {textContent: ""};
    ${fnSrc('questionViewFor')}`;
  const render = new Function(`${prelude}\n${fnSrc('renderQuestion')}\nreturn { render: renderQuestion, a: qAnswer, err: qError, box: questionBox, head: qHead };`)();
  render.render(openState);
  assert.equal(render.box.hidden, false);
  assert.equal(render.head.textContent, 'A question the plan raised (1 of 2)');
  render.a.value = 'half typed answer';
  render.err.textContent = 'Write an answer.';
  for (let i = 0; i < 3; i += 1) render.render(JSON.parse(JSON.stringify(openState))); // three poll ticks
  assert.equal(render.a.value, 'half typed answer', 'unsent input survives the poll');
  assert.equal(render.err.textContent, 'Write an answer.');
  render.render({ ...openState, openK: 2 });
  assert.equal(render.a.value, '', 'the next question starts empty');
  assert.equal(render.head.textContent, 'A question the plan raised (2 of 2)');
  render.render({ phase: 'redrafting' });
  assert.equal(render.box.hidden, true);
  // only these two functions assign the answer box; the poll path (renderActions, renderThread, poll) does not
  for (const name of ['poll', 'renderActions', 'renderThread', 'renderExtras', 'renderMain']) assert.doesNotMatch(fnSrc(name), /qAnswer\.value\s*=/, name);
});

test('P5: Send posts k and the text to the answer route; a refusal shows the server\'s words in the question box and keeps it open; the wire is the gated POST door', () => {
  const d = fnSrc('doAnswer');
  assert.match(d, /authorPost\("\/api\/author\/" \+ id \+ "\/answer", \{k: lastState\.openK, answer: qAnswer\.value\}\)/);
  assert.match(d, /qError\.textContent = refusalText\(r\)/);
  assert.doesNotMatch(d, /qAnswer\.value = ""[\s\S]*refusalText/, 'a refusal does not clear what was typed');
  assert.match(CHAT, /qSend\.addEventListener\("click", doAnswer\)/);
});

test('P6: Your answers sit under their line; Checked is listed; Not checked always carries its label; none of it shows without a green plan', () => {
  const ex = load('extrasFor');
  const green = {
    phase: 'green', answers: [{ line: 3, lineText: 'write me a summary resume', question: 'q', answer: 'Skills, Fit and History' }],
    checked: [{ step: 1, line: 3, sentences: ['The whole output is under 600 words.'] }, { step: 2, line: null, sentences: ['No machine check of the content: you check it at the ask.'] }],
    notChecked: { label: "the drafter's own reading, not a guarantee", items: ['tone'] },
  };
  const v = ex(green);
  assert.deepEqual(v.blocks.map((b) => b.id), ['chat-answers', 'chat-checked', 'chat-notchecked']);
  assert.deepEqual(v.blocks[0].lines, ['line 3: write me a summary resume\n  > Skills, Fit and History']);
  assert.deepEqual(v.blocks[1].lines, ['line 3: The whole output is under 600 words.', 'step 2: No machine check of the content: you check it at the ask.']);
  assert.equal(v.blocks[2].sub, "the drafter's own reading, not a guarantee");
  assert.deepEqual(v.blocks[2].lines, ['- tone']);
  const none = ex({ ...green, answers: [], notChecked: { label: NOT_CHECKED_LABEL, items: [] } });
  assert.deepEqual(none.blocks.map((b) => b.id), ['chat-checked', 'chat-notchecked'], 'no answers: no Your answers block');
  assert.equal(none.blocks[1].sub, NOT_CHECKED_LABEL);
  assert.deepEqual(none.blocks[1].lines, ['The drafter listed nothing.']);
  assert.equal(ex({ ...green, notChecked: undefined }).blocks[2].sub, "the drafter's own reading, not a guarantee", 'the label survives a missing list');
  for (const st of [null, { ...green, phase: 'red' }, { ...green, phase: 'questions-open' }, { phase: 'green' }]) assert.equal(ex(st), null);
  // the answers and the lists are escaped, never raw html
  assert.match(fnSrc('renderExtras'), /escapeXml\(b\.head\)[\s\S]*b\.lines\.map\(escapeXml\)/);
});

test('P7: the answer route is the same gated POST door as every author door (Host + Origin; no token or cookie, amendment 4 item 8): no / foreign Origin, foreign Host -> refused, nothing written; a GET is not a door', async () => {
  const { w, id } = await askingWorld();
  const body = { k: 1, answer: 'an answer' };
  for (const [c, want] of [[{ headers: { origin: null } }, 403], [{ headers: { origin: 'http://evil.example' } }, 403], [{ headers: { host: 'evil.example' } }, 403]]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await rq(w.h.port, { method: 'POST', url: `/api/author/${id}/answer`, body, ...c });
    assert.equal(r.status, want, JSON.stringify(c));
  }
  assert.equal((await rq(w.h.port, { url: `/api/author/${id}/answer` })).status, 404);
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'answer-1.json')), false);
  assert.equal((await state(w, id)).openK, 1);
});

test('B7: a plan that is still red on try 3 but asked a question is questions-open (no spec.hash, nothing signable); answering it drafts again to a green plan', async () => {
  const { w, id, s } = await askingWorld({ FWDLOOP_TEST_DRAFT_REDSTEP: '0,1', FWDLOOP_TEST_DRAFT_QUESTIONS: Q12, FWDLOOP_TEST_DRAFT_QRED: '1' });
  assert.equal(s.phase, 'questions-open', JSON.stringify(s));
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'spec.hash')), false, 'the red plan has no hash to sign');
  assert.equal((await w.post(`/api/author/${id}/sign`, { hash: 'x' })).json().refused, 'question-open');
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, answer: 'ANSMARK the resume in my inputs' })).status, 200);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 2, answer: 'the part about skills' })).status, 202);
  const g = await until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g));
  assert.equal(g.revisesLeft, 2);
});
