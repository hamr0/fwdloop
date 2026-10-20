// M10 piece 3: asks decided by CODE from the page look (signed item 4, am1, am2, am5). The two question texts are bareloop's, verbatim (am5 item 1).
// $0, no model, no network. The look comes from the real F71 fixtures through the real rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { lookAtPage } from '../src/pagelook.js';
import {
  askableFromLook, isAgree, isDropIt, DROP_IT, readingOfQuestion, tooManyAsksText, MAX_LOOK_ASKS, ruleWords,
} from '../src/pageask.js';
import { PAGE, raw, JOB } from './fixtures/m10-map/load.mjs';

const lookOf = async (n) => (await lookAtPage({ label: 'flights', text: PAGE, jobLines: JOB, callModel: async () => ({ text: raw(n) }) })).look;
const READ_Q = 'Your line 1 says "not a red-eye". I read it as: departure time between 05:00 and 23:59. Agree? Answer "agree", or type your own reading (your answer is added as a new ~ rule on line 1).';

test('T1: a reading the person did not write is a reading ask, in bareloop\'s exact words', async () => {
  const asks = askableFromLook(await lookOf(3), JOB);
  assert.equal(asks.length, 1, JSON.stringify(asks));
  assert.deepEqual([asks[0].ask, asks[0].line, asks[0].rule, asks[0].source, asks[0].ruleText], ['reading', 1, 2, 'look', 'not a red-eye']);
  assert.equal(asks[0].question, READ_Q);
  assert.equal(asks[0].reading, 'departure time between 05:00 and 23:59');
  assert.equal(readingOfQuestion(asks[0].question), asks[0].reading, 'the Result tab reads the reading back from the one spelling');
  assert.equal(readingOfQuestion('Which words count?'), null);
});

test('a limit the person wrote ("under $150") and a page word that carries the rule ("nonstop") are not asked', async () => {
  const asks = askableFromLook(await lookOf(3), JOB);
  assert.ok(!asks.some((a) => a.ruleText === 'under $150' || a.ruleText === 'nonstop'));
});

test('T2: a rule no kept fact carries is a can\'t-check ask, in bareloop\'s exact words', () => {
  const jobLines = [{ n: 1, text: 'List 3 flights', rule: 'under $150; pays well' }];
  const look = { facts: [{ line: 1, forRule: 1, name: 'price', shape: 'money', words: ['From'], currency: ['$'] }], dropped: [] };
  const asks = askableFromLook(look, jobLines);
  assert.equal(asks.length, 1);
  assert.deepEqual([asks[0].ask, asks[0].rule], ['cant-check', 2]);
  assert.equal(asks[0].question, 'Your line 1 says "pays well". I can\'t check this on the page. Drop it? Answer "drop it", or type how to check it (your answer is added as a new ~ rule on line 1).');
  assert.equal(asks[0].reading, undefined);
});

test('readings come first, then can\'t-checks, each in line order; one ask per rule text on a line', () => {
  const jobLines = [{ n: 1, text: 'a', rule: 'cheap; cheap; nice' }, { n: 2, text: 'b', rule: 'not late' }];
  const read = (line, rule) => ({ line, forRule: rule, name: 'time', shape: 'time', words: ['Leaves'], reading: { op: 'lt', value: '22:00' } });
  const asks = askableFromLook({ facts: [read(2, 1)], dropped: [] }, jobLines);
  assert.deepEqual(asks.map((a) => [a.ask, a.line, a.ruleText]), [['reading', 2, 'not late'], ['cant-check', 1, 'cheap'], ['cant-check', 1, 'nice']]);
});

test('the answer words: agree / yes take the reading, "drop it" drops; anything else is the person\'s own words', () => {
  for (const t of ['agree', 'Agree.', ' YES ', 'yes!']) assert.equal(isAgree(t), true, t);
  for (const t of ['no', 'agreed', 'between 6 and 9', '']) assert.equal(isAgree(t), false, t);
  assert.equal(DROP_IT, 'drop it');
  for (const t of ['drop it', 'Drop it.', ' DROP IT']) assert.equal(isDropIt(t), true, t);
  assert.equal(isDropIt('drop it please'), false);
});

test('ruleWords says a rule in plain words from the fact\'s own forms', () => {
  assert.equal(ruleWords({ shape: 'time', rule: { op: 'between', lo: '05:00', hi: '21:59' } }), 'between 05:00 and 21:59');
  assert.equal(ruleWords({ shape: 'money', unit: ['US dollars'], rule: { op: 'lt', value: 450 } }), 'under 450 US dollars');
  assert.equal(ruleWords({ shape: 'money', currency: ['$'], rule: { op: 'gte', value: 9 } }), 'at least $9');
});

test('more than the cap: the stop words list EVERY rule with code\'s reading, bareloop\'s text', () => {
  assert.equal(MAX_LOOK_ASKS, 3);
  const asks = [
    { line: 1, ruleText: 'not a red-eye', reading: 'departure time between 05:00 and 23:59' },
    { line: 1, ruleText: 'pays well' }, { line: 2, ruleText: 'nice' }, { line: 2, ruleText: 'fine' },
  ];
  assert.equal(tooManyAsksText(asks), 'Your job has 4 rules I can\'t check or had to guess. Please rewrite it so each one says what to look for. My readings: line 1 "not a red-eye" → departure time between 05:00 and 23:59; line 1 "pays well" → I can\'t check this on the page; line 2 "nice" → I can\'t check this on the page; line 2 "fine" → I can\'t check this on the page.');
});

// must fail (signed): an ask from the model choosing. The ask function reads the look's facts and the job lines, and nothing a model could add.
test('the ask function reads no model output field: only a look fact\'s own keys and the job line', () => {
  const src = readFileSync(fileURLToPath(new URL('../src/pageask.js', import.meta.url)), 'utf8');
  const body = src.slice(src.indexOf('export function askableFromLook'), src.indexOf('/** @param {import(\'./pagerules.js\').Reading} r @returns {unknown[]} the bounds'));
  const props = new Set([...body.matchAll(/\b(?:f|x|l|look|tied|said)\.([A-Za-z_]+)/g)].map((m) => m[1]));
  const allowed = new Set(['facts', 'line', 'forRule', 'n', 'reading', 'shape', 'name', 'unit', 'currency', 'text', 'rules', 'rule', 'length', 'find']);
  assert.deepEqual([...props].filter((p) => !allowed.has(p)), [], 'a field outside the look fact\'s own keys is read');
});

test('a model-written field on a fact or a look (ask, askUser, questions, needsAsk) never makes an ask', async () => {
  const look = await lookOf(3);
  const noisy = { ...look, questions: [{ line: 1, question: 'x' }], facts: look.facts.map((f) => ({ ...f, ask: true, askUser: true, needsAsk: true, question: 'ask me' })) };
  assert.deepEqual(askableFromLook(noisy, JOB).map((a) => a.question), [READ_Q]);
  const quiet = { facts: look.facts.map((f) => ({ ...f, reading: undefined })), dropped: [] };
  assert.ok(askableFromLook(quiet, JOB).every((a) => a.ask === 'cant-check' || a.ask === 'reading'));
  assert.equal(askableFromLook(quiet, JOB).filter((a) => a.ask === 'reading').length, 0, 'no reading, no reading ask: the model\'s "should ask" flag is not a trigger');
});
