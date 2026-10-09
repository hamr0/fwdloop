// Several `~` lines under one step are ONE continuous guardrail (hamr ruling 2026-10-09): the card -> job-file path joins them, once.
import assert from 'node:assert/strict';
import { test } from 'node:test';

import { parseJobBox, jobFileLines, appendAnswersToJob } from '../src/panel/authorcard.js';
import { parseSignedText } from '../src/signed-text.js';
import { guardrailWordLimit, guardrailSectionCount } from '../src/declaration.js';

const lines = (text, wait = '1h') => jobFileLines(parseJobBox(text).steps, wait);

test('J1: two ~ lines under one step write exactly ONE guardrail: line, both parts verbatim, in typed order, joined by "; "', () => {
  const out = lines('Write the summary\n~  3 sections \n~under 600 words\nSend it');
  assert.deepEqual(out, ['1. Write the summary', '   guardrail: 3 sections; under 600 words', '2. Send it']);
  assert.equal(out.filter((l) => l.includes('guardrail:')).length, 1);
});

test('J2: the joined job file parses under the strict signed-text parser (no "second guardrail")', () => {
  const text = `${lines('Write the summary\n~3 sections\n~under 600 words\n~no tables').join('\n')}\n`;
  const r = parseSignedText(text);
  assert.ok(!(r.reds ?? []).some((x) => x.includes('second "guardrail:"')), JSON.stringify(r.reds));
});

test('J3: the guardrail readers read the joined text', () => {
  const g = '3 sections; under 600 words';
  assert.equal(guardrailSectionCount(g), 3);
  assert.equal(guardrailWordLimit(g), 600);
  assert.equal(guardrailWordLimit('about 1,000 words; no tables'), 1000);
});

test('J4: an answer is one more ~ line: it becomes the guardrail of a step with none, and joins after an existing one with "; "', () => {
  const r = appendAnswersToJob('one\n~3 sections\ntwo', [{ line: 1, answer: 'under 600 words' }, { line: 2, answer: 'plain tone' }, { line: 1, answer: 'no tables' }]);
  assert.deepEqual(lines(r.job), [
    '1. one', '   guardrail: 3 sections; under 600 words; no tables',
    '2. two', '   guardrail: plain tone',
  ]);
});

test('J5: the answer-clash refusal is gone', async () => {
  const mod = await import('../src/panel/authorcard.js');
  assert.equal(mod.answerClash, undefined);
});
