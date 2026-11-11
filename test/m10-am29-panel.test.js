// M10 am29: the Draft view's question box. Source-level like test/m4e-am24.test.js (the page's REAL functions in new Function()), plus the state the panel serves.
// $0, no browser here (the browser walk is test/m10-am29-walk.test.js). Each test can fail (see the commit for the forced reds).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { fnSrc as cutFn } from '../scripts/panel-fixtures/fn-src.mjs';
import { panelQuestionText, askableFromLook } from '../src/pageask.js';
import { checkAsks } from '../src/checkpick.js';
import { columnQuestion } from '../src/sheetfind.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CHAT = PAGE.slice(PAGE.indexOf('// ---- Chat tab: describe, draft, sign and run'), PAGE.indexOf('// ---- M4d piece 4: Settings.'));
const fnSrc = (name) => cutFn(CHAT, name, '    ');
const view = (q) => new Function(`${fnSrc('questionViewFor')}\nreturn questionViewFor;`)()({
  draftId: 'd', phase: 'questions-open', openK: 1, total: 1, questions: [{ k: 1, line: 2, lineText: 'x', answered: false, ...q }],
});

const READING = { source: 'look', ask: 'reading', proposes: true, question: 'Q', shown: 'S' };
test('the view: a look question with a proposal offers Agree, Drop it and the box; one without a proposal offers Drop it and the box; a drafter question the box only', () => {
  assert.deepEqual([view(READING).agree, view(READING).drop], [true, true]);
  for (const ask of ['check', 'reading']) assert.equal(view({ ...READING, ask }).agree, true, ask);
  for (const ask of ['no-check', 'cant-check']) assert.deepEqual([view({ ...READING, ask, proposes: false }).agree, view({ ...READING, ask, proposes: false }).drop], [false, true], ask);
  const d = view({ question: 'what do you mean?' });
  assert.deepEqual([d.agree, d.drop, d.question], [false, false, 'what do you mean?']);
});

test('the view shows the question without the CLI\'s answer tail (the server\'s `shown`), and the whole question when there is none', () => {
  assert.match(view(READING).question, /: S$/);
  assert.match(view({ source: 'look', ask: 'reading', proposes: true, question: 'whole one' }).question, /: whole one$/);
});

const READ_Q = { source: 'look', line: 4 };
test('panelQuestionText cuts exactly the known tails of each ask kind and nothing else; the stored text is never changed', () => {
  const reading = askableFromLook({ facts: [{ line: 4, forRule: 1, name: 'price', shape: 'money', unit: ['US dollars'], reading: { op: 'lt', value: 450 } }] }, [{ n: 4, rules: ['under $400'] }]);
  assert.equal(reading[0].ask, 'reading');
  assert.equal(panelQuestionText({ ...READ_Q, question: reading[0].question }), 'Your line 4 says "under $400". I read it as: price under 450 US dollars. Agree?');
  const cant = askableFromLook({ facts: [] }, [{ n: 4, rules: ['pays well'] }]);
  assert.equal(panelQuestionText({ ...READ_Q, question: cant[0].question }), 'Your line 4 says "pays well". I can\'t check this on the page. Drop it?');
  const [prop, none] = checkAsks([{ line: 4, rule: 1, text: 'exactly 3 bullets', check: { rule: 'listItems', value: 3 }, why: null }, { line: 4, rule: 2, text: 'feels right', check: null, why: null }]);
  assert.match(prop.question, /Answer "agree" to use it/);
  assert.equal(panelQuestionText({ ...READ_Q, question: prop.question }), `Line 4, guardrail "exactly 3 bullets": I propose ${prop.reading}.`);
  assert.equal(panelQuestionText({ ...READ_Q, question: none.question }), 'Line 4, guardrail "feels right": I can\'t check this. Your own words, or Not checked?');
  const col = columnQuestion('Price', { column: 'Amount', numbers: 40, rows: 40 }, 4);
  assert.equal(panelQuestionText({ ...READ_Q, question: col }), 'no column \'Price\'; \'Amount\' has numbers in 40 of 40 rows. Use it?');
  assert.ok(col.includes('Answer "agree"'), 'the stored question keeps its words');
  // a question that ends in none of them, or is not a look question, is returned whole
  assert.equal(panelQuestionText({ ...READ_Q, question: 'my own words. Answer "agree"' }), 'my own words. Answer "agree"');
  assert.equal(panelQuestionText({ source: undefined, line: 4, question: col }), col);
  assert.equal(panelQuestionText({ ...READ_Q, line: 5, question: col }), col, 'a tail for another line is not cut');
});

test('the wire: Agree and Drop it post {k, choice} and nothing else; the box\'s button posts {k, answer, choice: "rule"}', async () => {
  const run = async (choice, typed) => {
    /** @type {any[]} */
    const posts = [];
    const el = () => ({ disabled: false, textContent: '', value: typed });
    const make = new Function('authorPost', 'poll', `var qBusy = false; var sessionId = "s"; var lastState = {phase: "questions-open", openK: 3};
      var qSend = this.qSend, qAgree = this.qAgree, qDrop = this.qDrop, qAnswer = this.qAnswer, qError = this.qError, NETWORK_SAY = "n";
      function refusalText(r){ return "x"; }
      ${fnSrc('doAnswer')}\nreturn doAnswer;`);
    const ctx = { qSend: el(), qAgree: el(), qDrop: el(), qAnswer: el(), qError: el() };
    const doAnswer = make.call(ctx, (url, body) => { posts.push([url, body]); return Promise.resolve({ status: 202, body: { ok: true } }); }, () => {});
    doAnswer(choice);
    await new Promise((r) => { setImmediate(r); });
    return posts;
  };
  assert.deepEqual(await run('agree', 'agree, why not'), [['/api/author/s/answer', { k: 3, choice: 'agree' }]]);
  assert.deepEqual(await run('drop', 'typed words'), [['/api/author/s/answer', { k: 3, choice: 'drop' }]]);
  assert.deepEqual(await run('rule', 'agree, why not'), [['/api/author/s/answer', { k: 3, answer: 'agree, why not', choice: 'rule' }]]);
  assert.deepEqual(await run(undefined, 'yes'), [['/api/author/s/answer', { k: 3, answer: 'yes', choice: 'rule' }]], 'Enter in the box is the box\'s button');
});

test('the label "Or type a new rule:" is in the box for every question: never hidden by markup or by the page\'s render', () => {
  assert.doesNotMatch(PAGE.match(/<label[^>]*id="chat-q-or"[^>]*>/)[0], /hidden/);
  assert.doesNotMatch(fnSrc('renderQuestion'), /qOr/);
});

test('the markup: Agree, Drop it, the label "Or type a new rule:" and Send, each once, in the one existing question box', () => {
  const block = PAGE.slice(PAGE.indexOf('id="chat-question"'), PAGE.indexOf('id="chat-extras"'));
  assert.match(block, /<button[^>]*id="chat-q-agree"[^>]*>Agree<\/button>/);
  assert.match(block, /<button[^>]*id="chat-q-drop"[^>]*>Drop it<\/button>/);
  assert.match(block, /<label[^>]*id="chat-q-or"[^>]*>Or type a new rule:<\/label>/);
  assert.match(block, /<button[^>]*id="chat-q-send"[^>]*>Send<\/button>/);
  assert.doesNotMatch(PAGE.slice(PAGE.indexOf('id="chat-question"'), PAGE.indexOf('id="chat-extras"')), /skip/i);
  const ids = [...PAGE.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  for (const id of ['chat-q-choices', 'chat-q-agree', 'chat-q-drop', 'chat-q-or']) assert.equal(ids.filter((x) => x === id).length, 1, id);
});
