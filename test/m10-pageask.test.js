// M17 am4 (A1): the page-look ask function is gone (the list asks, src/blockasks.js); what stays here is the answer words, ruleWords and the cap text.
// M10 piece 3: asks decided by CODE from the page look (signed item 4, am1, am2, am5). The two question texts are bareloop's, verbatim (am5 item 1).
// $0, no model, no network. The look comes from the real F71 fixtures through the real rules.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  AGREE_WORDS, isAgree, stripAgreeLead, ruleOfAnswer, isDropIt, DROP_IT, readingOfQuestion, tooManyAsksText, MAX_LOOK_ASKS, ruleWords,
} from '../src/pageask.js';

const READ_Q = 'Your line 1 says "not a red-eye". I read it as: departure time between 05:00 and 23:59. Agree? Answer "agree", or type your own reading (your answer replaces that ~ rule on line 1).';

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

// borrowed-from: bareloop tests/part5b-reading.test.js@v0.49.0 (F240 stripAgreeLead, d51a367), adapted: ruleOfAnswer is fwdloop's one place
test('F240 stripAgreeLead: only a comma or colon right after yes/agree drops the lead; hyphen, dash, bare space, bare, mid-sentence stay whole', () => {
  assert.equal(stripAgreeLead('yes, check it as departure between 05:00 and 21:59'), 'check it as departure between 05:00 and 21:59');
  assert.equal(stripAgreeLead('Yes, Departs by 7am'), 'Departs by 7am');
  assert.equal(stripAgreeLead('AGREE: departs by 7am'), 'departs by 7am');
  assert.equal(stripAgreeLead('Yes,drop it'), 'drop it');
  for (const a of ['yes', 'Yes', 'agree', 'yes.', 'agree!', 'yes,', 'say yes to a window seat', 'yesterday it left at 7am', 'agreed, departs by 7am', 'yes departs by 7am', 'yes under 300', 'agree with the shown price', 'yes or no questions only', 'yes-no questions only', 'agree-ment on price', 'yes - departs by 7am', 'yes \u2014 the outbound', 'yes\u2013the outbound', 'yesterday, the price']) assert.equal(stripAgreeLead(a), a, a);
});

test('every AGREE_WORDS word is both an agree answer and a lead stripAgreeLead drops (the literal regex stays in step with the list)', () => {
  for (const w of AGREE_WORDS) {
    assert.equal(isAgree(w), true, w);
    assert.equal(stripAgreeLead(`${w}, departs by 7am`), 'departs by 7am', w);
    assert.equal(stripAgreeLead(`${w.toUpperCase()}: departs by 7am`), 'departs by 7am', w);
  }
});

test('F240 ruleOfAnswer: a typed "yes, under 300" on a look ask signs "under 300"; a non-look answer is never stripped', () => {
  const look = { source: 'look', ask: 'cant-check' };
  assert.equal(ruleOfAnswer(look, 'yes, under 300').rule, 'under 300');
  assert.equal(ruleOfAnswer(look, 'agree: nonstop').rule, 'nonstop');
  assert.equal(ruleOfAnswer(look, 'yes-no questions only').rule, 'yes-no questions only');
  assert.equal(ruleOfAnswer(look, 'yes under 300').rule, 'yes under 300');
  assert.equal(ruleOfAnswer(look, 'yes,').rule, 'yes,');
  assert.equal(ruleOfAnswer({ source: 'job' }, 'yes, under 300').rule, 'yes, under 300');
});

test('readingOfQuestion reads the reading back from the one spelling of a reading question', () => {
  assert.equal(readingOfQuestion(READ_Q), 'departure time between 05:00 and 23:59');
  assert.equal(readingOfQuestion('Which words count?'), null);
});
