// M10 am2 item 4 / am4 item 3: the Result tab says "(you confirmed)" on a fact whose limit the person AGREED to, derived from the setup record's human rows
// (bareloop's confirmedFactNames, server.js@2959217): an `agree` answer to a look question on that line, whose reading is a signed ~ rule of the line word for word.
// Nothing is guessed: no record, an own-words answer, another line, or a reading no longer in the signed rule confirms nothing.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { world } from './m10-am4-world.mjs';
import { putCited } from './line-checks-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'm10-result', 'result-mvfphtwl.json'), 'utf8'));
const READING = 'departure time between 05:00 and 21:59';
const QUESTION = (line) => `Your line ${line} says "not a red-eye". I read it as: ${READING}. Agree? Answer "agree", or type your own reading (your answer is added as a new ~ rule on line ${line}).`;
const human = (over = {}) => ({
  kind: 'human', n: 1, at: '2026-10-20T10:00:00.000Z', source: 'look', ask: 'reading', question: QUESTION(3), answer: 'agree', line: 3, ruleNo: 2, ruleText: 'not a red-eye', proposal: READING, rule: READING, ...over,
});
const withReading = (p) => p.replace('guardrail: 3 sections, all under 600 words', `guardrail: 3 sections, all under 600 words; ${READING}`);

async function scene(rows, { prose = withReading } = {}) {
  const URL1 = GOLDEN.pages[0];
  const w = await world({ mode: 'park', prose: (p) => prose(p.replace(/guardrail: source jd = file:\S+/, `guardrail: source jd = page:${URL1}`)) });
  const rec = { lines: GOLDEN.lines.map((l) => ({ n: 3, source: 'jd', passed: l.passed, facts: l.facts, rows: l.rows, notChecked: [] })) };
  putCited(w.runDir, rec);
  if (rows !== null) writeFileSync(path.join(w.root, 'job2', 'setup.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  const l3 = (await w.get('/api/runs/job2/run-1/result')).body.lines.find((l) => l.n === 3);
  return l3.facts.filter((f) => f.note === '(you confirmed)').map((f) => f.name);
}

test('an agreed reading that is a signed ~ rule word for word confirms its fact', async () => {
  assert.deepEqual(await scene([human()]), ['departure time']);
});

// must fail (signed): the Result tab says "(you confirmed)" for a fact nobody agreed to
test('nothing is confirmed without a setup record, for own words, for another line, for an unsigned reading, for a different question', async () => {
  assert.deepEqual(await scene(null), [], 'no setup record: nothing is guessed');
  assert.deepEqual(await scene([human({ answer: 'leaves after 7', rule: 'leaves after 7' })]), [], 'own words are not an agreed reading');
  assert.deepEqual(await scene([human({ line: 1, question: QUESTION(1) })]), [], 'another line');
  assert.deepEqual(await scene([human()], { prose: (p) => p }), [], 'the reading is not a signed ~ rule of the line');
  assert.deepEqual(await scene([human({ question: 'Which words count?', proposal: READING })]), [], 'not a reading ask');
  assert.deepEqual(await scene([human({ source: 'try-3' })]), [], 'not a look question');
});

test('yes, Agree. and agree! count as agree; a fact the proposal does not name stays unconfirmed', async () => {
  for (const a of ['yes', 'Agree.', 'agree!']) assert.deepEqual(await scene([human({ answer: a })]), ['departure time'], a);
  assert.deepEqual(await scene([human({ proposal: 'luggage under 20', question: QUESTION(3).replace(READING, 'luggage under 20') })], { prose: (p) => withReading(p).replace(READING, 'luggage under 20') }), [], 'no fact called luggage');
});
