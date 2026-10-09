// M4e amendment 2 items 1-2 and negatives (a) (b) (c) (e): the pure parsers behind the job box and the inputs box.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseJobBox, jobFileLines, parseInputLines, isAskWait } from '../src/panel/authorcard.js';

const lines = (text, wait = '1h') => jobFileLines(parseJobBox(text).steps, wait);

test('(a) one line is one step: numbers in order, the ~ lines under a step ONE guardrail (joined by "; "), Ask: with the default wait, Ask 2h: with its own', () => {
  const box = [
    'Read my resume',
    '~keep it under 600 words',
    '~no tables',
    'Ask: is this right?',
    '~nothing goes out before I accept',
    'ASK 2h: second look',
    'ask 15M: third look',
    'Write it out',
  ].join('\n');
  assert.deepEqual(lines(box, '1h'), [
    '1. Read my resume',
    '   guardrail: keep it under 600 words; no tables',
    '2. ask 1h: is this right?',
    '   guardrail: nothing goes out before I accept',
    '3. ask 2h: second look',
    '4. ask 15m: third look',
    '5. Write it out',
  ]);
  assert.deepEqual(lines('Ask: q', '30m'), ['1. ask 30m: q'], 'the card\'s wait is written out, whatever it is');
});

test('(b) a ~ line before the first step is refused by its line; empty lines are never steps', () => {
  const r = parseJobBox('\n~too early\nstep one');
  assert.equal(r.refusals.length, 1);
  assert.equal(r.refusals[0].line, 2);
  assert.match(r.refusals[0].say, /Line 2 .*no step is above it/);
  const blank = parseJobBox('\n\nonly step\n   \n\t\n~its guardrail\n\n');
  assert.deepEqual(blank.refusals, []);
  assert.equal(blank.steps.length, 1);
  assert.deepEqual(blank.steps[0].guardrails, ['its guardrail']);
  assert.deepEqual(parseJobBox('').steps, []);
});

test('an ask that is not Ask: or Ask <n>m|h:, an ask with no question, a bare ~ are refused by line', () => {
  for (const [text, re] of [
    ['Ask my boss', /not an ask/], ['ask 30s: q', /not an ask/], ['ask 2d: q', /not an ask/], ['Ask:', /no question/], ['Ask 0h: q', /above 0/],
    ['step\n~', /only a ~/],
  ]) {
    const r = parseJobBox(text);
    assert.equal(r.refusals.length, 1, text);
    assert.match(r.refusals[0].say, re, text);
  }
  assert.equal(parseJobBox('say hello\nAsking is fine').refusals.length, 0, 'prose that merely starts with "ask" letters is a step');
});

test('(e) the ask wait is a whole number above 0 with m or h, nothing else', () => {
  for (const ok of ['1h', '30m', '2H', '90M']) assert.equal(isAskWait(ok), true, ok);
  for (const bad of ['', '1', 'h', '0h', '0m', '1d', '30s', '1.5h', '-1h', '1 h', ' 1h', 'abc']) assert.equal(isAskWait(bad), false, JSON.stringify(bad));
});

test('(c) inputs: one name: path per line, split at the first colon, blank lines skipped, numbered as shown; no colon is flagged', () => {
  const rows = parseInputLines('resume: /a/b.md\n\n jd :/c: d.md \nno colon here');
  assert.deepEqual(rows, [
    { line: 1, role: 'resume', path: '/a/b.md' },
    { line: 2, role: 'jd', path: '/c: d.md' },
    { line: 3, role: 'no colon here', path: '', noColon: true },
  ]);
  assert.deepEqual(parseInputLines(''), []);
});
