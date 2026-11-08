// M14 items 1-6 and amendment 1 item 2 (docs/wiki/the-module-ladder.md): `buildMemo` writes "what happened so far in this run" by plain code from the run's own
// files. The fixture is the shape of a real run with two asks (m7-walk-2 run-6: a redo "try again", then a blank accept), scrubbed: no document text, no PII. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { buildMemo, MEMO_HEADING, MEMO_CUT_NOTE } from '../src/memo.js';

const STEPS = ['resume_parked', 'jd_parked', 'summary_resume', 'ask_acceptance', 'summary_resume_final'];

/** a model try row; `usd` and `wallMs` are set to values the memo must never show */
const mrow = (step, attempt, verdict, gap = null) => ({
  step, attempt, class: 'softgreen', verdict, gap, usd: 0.123456, spendComplete: true, wallMs: 987654, model: 'm-1', modelMatch: true, strike: false, at: '2026-10-18T18:50:00.000Z', tokens: { inputTokens: 1, outputTokens: 1, cacheReadTokens: 0 }, tools: {}, refused: [],
});
const nrow = (step, attempt, verdict, gap = null) => ({ ...mrow(step, attempt, verdict, gap), model: null, modelMatch: null, tokens: null, tools: null, usd: 0 });

/** a run folder: audit.jsonl, job/declaration.json, asks/<id>.json, answer.<id>.consumed.json, run.json */
function makeRun({ rows = [], asks = [], rerun = null, steps = STEPS }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-m14-memo-'));
  mkdirSync(path.join(dir, 'job'));
  mkdirSync(path.join(dir, 'asks'));
  writeFileSync(path.join(dir, 'job', 'declaration.json'), JSON.stringify({ steps: steps.map((e) => ({ emits: e })) }));
  writeFileSync(path.join(dir, 'audit.jsonl'), rows.map((r) => `${JSON.stringify(r)}\n`).join(''));
  writeFileSync(path.join(dir, 'run.json'), JSON.stringify({ thinking: false, inputs: [], ...(rerun ? { rerun } : {}) }));
  for (const a of asks) {
    writeFileSync(path.join(dir, 'asks', `${a.id}.json`), JSON.stringify({ askId: a.id, question: 'check it with me', askedAt: a.askedAt, expiresAt: '2099-01-01T00:00:00.000Z', evidence: {}, emits: a.emits }));
    if (a.decision) writeFileSync(path.join(dir, `answer.${a.id}.consumed.json`), JSON.stringify({ askId: a.id, decision: a.decision, answeredAt: a.askedAt, ...(a.reason !== undefined ? { reason: a.reason } : {}) }));
  }
  return dir;
}

/** the real run-6 shape: summary_resume goes red, green, a human redo "try again", three reds and a green, then a blank accept */
const RUN6_ROWS = [
  mrow('resume_parked', 1, 'hitl'), mrow('jd_parked', 1, 'hitl'),
  mrow('summary_resume', 1, 'red', '1394 words, limit 600'), mrow('summary_resume', 2, 'green'),
  nrow('ask_acceptance', 1, 'paused'), nrow('ask_acceptance', 1, 'red', 'try again'),
  mrow('summary_resume', 2, 'red', '1551 words, limit 600'), mrow('summary_resume', 3, 'red', 'no line is exactly the heading "Work History"'),
  mrow('summary_resume', 4, 'red', '1889 words, limit 700'), mrow('summary_resume', 5, 'green'),
  nrow('ask_acceptance', 2, 'paused'), nrow('ask_acceptance', 2, 'green'),
];
const RUN6_ASKS = [
  { id: 'a1', askedAt: '2026-10-18T18:52:34.173Z', emits: 'ask_acceptance', decision: 'redo', reason: 'try again' },
  { id: 'a2', askedAt: '2026-10-18T18:54:00.000Z', emits: 'ask_acceptance', decision: 'accept' },
];

test('nothing has happened yet: an empty memo (a run with no asks and no tries, and no record at all)', () => {
  assert.equal(buildMemo(makeRun({}), { step: 'resume_parked' }), '');
  assert.equal(buildMemo(null, { step: 'resume_parked' }), '');
});

test('a real-run-shaped record: the first try of a later step carries both human lines, in order, and the heading words', () => {
  const memo = buildMemo(makeRun({ rows: RUN6_ROWS, asks: RUN6_ASKS }), { step: 'summary_resume_final' });
  const lines = memo.split('\n');
  assert.equal(lines[0], 'What happened so far in this run (written by code, from the record)');
  assert.equal(lines[0], MEMO_HEADING);
  assert.equal(lines[1], 'ask 1 (after step summary_resume): redo — user says "try again"');
  assert.equal(lines[2], 'ask 2 (after step summary_resume): accept', 'a blank answer adds no "user says" part');
  assert.equal(lines[3], 'last try: step summary_resume try 6 — result: green', 'the step\'s sixth try (its audit row says attempt 5: it restarted after the redo)');
});

test('tries are labelled by their count within the step, never the audit attempt (it restarts after a redo), and each result is the audit row verdict', () => {
  const rows = [mrow('summary_resume', 1, 'red', 'alpha'), mrow('summary_resume', 2, 'green'), nrow('ask_acceptance', 1, 'paused'), nrow('ask_acceptance', 1, 'red', 'redo words'),
    mrow('summary_resume', 2, 'red', 'bravo'), mrow('summary_resume', 3, 'red', 'charlie'), mrow('summary_resume', 4, 'green')];
  const memo = buildMemo(makeRun({ rows, asks: [RUN6_ASKS[0]] }), { step: 'summary_resume' });
  assert.deepEqual(memo.split('\n').slice(2), [
    'last try: step summary_resume try 5 — result: green',
    'earlier try: step summary_resume try 1 — result: red — alpha',
    'earlier try: step summary_resume try 2 — result: green',
    'earlier try: step summary_resume try 3 — result: red — bravo',
    'earlier try: step summary_resume try 4 — result: red — charlie',
  ]);
});

test('a run with no asks has no human lines; a blank answer adds nothing but its own line', () => {
  const memo = buildMemo(makeRun({ rows: [mrow('resume_parked', 1, 'hitl')] }), { step: 'jd_parked' });
  assert.equal(memo, `${MEMO_HEADING}\nlast try: step resume_parked try 1 — result: done, for you to check at the Ask`);
  assert.ok(!/ask \d/.test(memo) && !/user says/.test(memo));
  const blank = buildMemo(makeRun({ rows: RUN6_ROWS, asks: [{ ...RUN6_ASKS[0], reason: '' }, RUN6_ASKS[1]] }), { step: 'summary_resume_final' });
  assert.match(blank, /^ask 1 \(after step summary_resume\): redo$/m);
});

test('an unanswered ask adds no line and the next ask keeps its number', () => {
  const memo = buildMemo(makeRun({ rows: RUN6_ROWS, asks: [{ ...RUN6_ASKS[0], decision: undefined }, RUN6_ASKS[1]] }), { step: 'summary_resume_final' });
  assert.ok(!/redo/.test(memo));
  assert.match(memo, /^ask 2 \(after step summary_resume\): accept$/m);
});

test('a rerun: its first line is the rerun line, before any ask line, read from run.json', () => {
  const dir = makeRun({ rows: [], asks: [], rerun: { decision: 'rerun', words: 'wrong answer', afterStep: 'summary_resume' } });
  assert.equal(buildMemo(dir, { step: 'resume_parked' }), `${MEMO_HEADING}\nrerun — user says "wrong answer"`);
  const both = buildMemo(makeRun({ rows: RUN6_ROWS, asks: RUN6_ASKS, rerun: { decision: 'rerun', words: 'wrong answer', afterStep: 'summary_resume' } }), { step: 'summary_resume_final' }).split('\n');
  assert.equal(both[1], 'rerun — user says "wrong answer"');
  assert.match(both[2], /^ask 1 /);
});

test('the memo never shows money or time', () => {
  const memo = buildMemo(makeRun({ rows: RUN6_ROWS, asks: RUN6_ASKS }), { step: 'summary_resume' });
  for (const bad of ['0.123456', '987654', '$', 'usd', 'cost']) assert.ok(!memo.toLowerCase().includes(bad), `memo shows "${bad}"`);
});

test('item 6: the newest failure keeps its words out of the memo when the retry gets them as its gap, and keeps them for a later step', () => {
  const rows = [mrow('summary_resume', 1, 'red', 'too long: 1394 words')];
  const retry = buildMemo(makeRun({ rows }), { step: 'summary_resume' });
  assert.equal(retry.split('\n')[1], 'last try: step summary_resume try 1 — result: red');
  assert.ok(!retry.includes('1394'));
  const later = buildMemo(makeRun({ rows }), { step: 'jd_parked' });
  assert.match(later, /last try: step summary_resume try 1 — result: red — too long: 1394 words/);
});

test('earlier steps\' failures are listed; a repeated failure folds into one line ending (x3)', () => {
  const rows = [mrow('summary_resume', 1, 'red', '1394 words, limit 600'), mrow('summary_resume', 2, 'red', '1394 words, limit 600'), mrow('summary_resume', 3, 'red', '1394 words, limit 600'), mrow('summary_resume', 4, 'green'), mrow('resume_parked', 1, 'hitl')];
  const memo = buildMemo(makeRun({ rows }), { step: 'jd_parked' });
  const fails = memo.split('\n').filter((l) => l.startsWith('earlier failure'));
  assert.deepEqual(fails, ['earlier failure: step summary_resume try 1 — result: red — 1394 words, limit 600 (x3)']);
  // the same fold applies to the earlier tries of this step
  const same = buildMemo(makeRun({ rows: [mrow('summary_resume', 1, 'red', '1394 words, limit 600'), mrow('summary_resume', 2, 'red', '1394 words, limit 600'), mrow('summary_resume', 3, 'red', '1394 words, limit 600'), mrow('summary_resume', 4, 'green')] }), { step: 'summary_resume' });
  assert.deepEqual(same.split('\n').filter((l) => l.startsWith('earlier try')), ['earlier try: step summary_resume try 1 — result: red — 1394 words, limit 600 (x3)']);
  // two different failures do not fold
  const diff = buildMemo(makeRun({ rows: [mrow('summary_resume', 1, 'red', 'no line is exactly the heading "Skills"'), mrow('summary_resume', 2, 'red', 'a number that is not in the source file'), mrow('resume_parked', 1, 'hitl')] }), { step: 'jd_parked' });
  assert.equal(diff.split('\n').filter((l) => l.startsWith('earlier failure')).length, 2);
  assert.ok(!/\(x\d\)/.test(diff));
});

test('the cap: oldest tries are cut first, then oldest failures; heading, human lines and the last try stay; the cut is said', () => {
  const rows = [
    mrow('a_step', 1, 'red', 'alpha failure text one'), mrow('a_step', 2, 'green'),
    mrow('b_step', 1, 'red', 'bravo kind apart words'), mrow('b_step', 2, 'red', 'charlie other thing entirely'), mrow('b_step', 3, 'red', 'delta something else again'), mrow('b_step', 4, 'red', 'echo last gap'),
  ];
  const run = makeRun({ rows, asks: [{ id: 'a1', askedAt: '2026-10-18T18:52:34.173Z', emits: 'ask_acceptance', decision: 'redo', reason: 'try again' }], steps: ['a_step', 'b_step', 'ask_acceptance'] });
  const full = buildMemo(run, { step: 'b_step' });
  assert.ok(!full.includes(MEMO_CUT_NOTE));
  const fullLines = full.split('\n');
  const human = fullLines.filter((l) => l.startsWith('ask '));
  const tries = fullLines.filter((l) => l.startsWith('earlier try'));
  assert.equal(tries.length, 3);
  assert.match(fullLines.find((l) => l.startsWith('earlier failure')), /step a_step try 1/);
  // room for the heading, the human line, the last line, the cut note and exactly the two newest earlier tries
  const failLine = fullLines.find((l) => l.startsWith('earlier failure'));
  const keep = [fullLines[0], ...human, fullLines.find((l) => l.startsWith('last try')), tries[1], tries[2], failLine, MEMO_CUT_NOTE];
  const cap = keep.join('\n').length;
  const cut = buildMemo(run, { step: 'b_step', cap });
  assert.deepEqual(cut.split('\n'), keep, 'the oldest try went first');
  assert.ok(cut.length <= cap);
  // a tiny cap: every try and failure goes, the heading, human lines and last try never do
  const tiny = buildMemo(run, { step: 'b_step', cap: 10 }).split('\n');
  assert.deepEqual(tiny, [fullLines[0], ...human, fullLines.find((l) => l.startsWith('last try')), MEMO_CUT_NOTE]);
  // failures go after the tries are all gone, oldest first
  const noTries = buildMemo(run, { step: 'a_step', cap: 10 }).split('\n');
  assert.ok(!noTries.some((l) => l.startsWith('earlier')), 'with a tiny cap no earlier line stays');
  const f = buildMemo(run, { step: 'zzz' }).split('\n').filter((l) => l.startsWith('earlier failure'));
  assert.equal(f.length, 4, 'for a different step every earlier red is a failure line');
  const capF = [MEMO_HEADING, ...human, buildMemo(run, { step: 'zzz' }).split('\n').find((l) => l.startsWith('last try')), f[2], f[3], MEMO_CUT_NOTE].join('\n').length;
  const cutF = buildMemo(run, { step: 'zzz', cap: capF }).split('\n').filter((l) => l.startsWith('earlier failure'));
  assert.deepEqual(cutF, [f[2], f[3]], 'the oldest failures go first');
});
