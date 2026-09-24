import { test } from 'node:test';
import assert from 'node:assert/strict';
import { closeWordsAndSections } from './shape.mjs';

const SECTIONS = ['Story of experience', 'Technical skills', 'Soft skills'];

/**
 * Builds a three-section document. Heading lines contribute fixed word
 * counts ("Story of experience" = 3, "Technical skills" = 2,
 * "Soft skills" = 2 -> 7 heading words total), so total word count =
 * 7 + sum(fillerCounts).
 */
function buildDoc(fillerCounts, { headings = SECTIONS } = {}) {
  const filler = (n) => Array(n).fill('w').join(' ');
  return headings.map((h, i) => `# ${h}\n${filler(fillerCounts[i])}`).join('\n');
}

test('exactly 600 words (boundary) is green', () => {
  const doc = buildDoc([200, 200, 193]); // 7 heading words + 593 filler = 600
  const result = closeWordsAndSections(doc, { maxWords: 600, sections: SECTIONS });
  assert.deepEqual(result, { verdict: 'green', reds: [] });
});

test('PROOF the test can fail: 601 words (one over boundary) is red naming the count and limit', () => {
  const doc = buildDoc([200, 200, 194]); // 7 + 594 = 601
  const result = closeWordsAndSections(doc, { maxWords: 600, sections: SECTIONS });
  assert.equal(result.verdict, 'red');
  assert.equal(result.red, '601 words, limit 600');
  assert.deepEqual(result.reds, ['601 words, limit 600']);
});

test('missing a declared section heading is red naming the form of a heading (F38)', () => {
  const doc = buildDoc([10, 10, 10], { headings: ['Story of experience', 'Technical skills'] })
    + '\n# Soft skills is not written here\nfiller';
  const result = closeWordsAndSections(doc, { maxWords: 1000, sections: SECTIONS });
  assert.equal(result.verdict, 'red');
  assert.equal(
    result.red,
    'no line is exactly the heading "Soft skills" (a heading is a line that is only that text, optionally after #)',
  );
});

test('F38 fix: over the word limit AND missing a heading reports BOTH failing checks, words first', () => {
  const filler = (n) => Array(n).fill('w').join(' ');
  // "Story of experience" (3) + 300 filler + "Technical skills" (2) + 300
  // filler = 605, plus the non-matching third line below -> well over 600,
  // and the third declared heading never appears as its own line.
  const doc = `# Story of experience\n${filler(300)}\n`
    + `# Technical skills\n${filler(300)}\n`
    + '# Soft skills is not written here\nfiller';
  const result = closeWordsAndSections(doc, { maxWords: 600, sections: SECTIONS });
  assert.equal(result.verdict, 'red');
  assert.equal(result.reds.length, 2);
  assert.equal(result.reds[0], '612 words, limit 600');
  assert.equal(
    result.reds[1],
    'no line is exactly the heading "Soft skills" (a heading is a line that is only that text, optionally after #)',
  );
  assert.equal(result.red, `${result.reds[0]}; ${result.reds[1]}`);
});

test('F38 fix: missing two headings reports two heading sentences', () => {
  const doc = buildDoc([10, 10, 10], { headings: ['Story of experience'] });
  const result = closeWordsAndSections(doc, { maxWords: 1000, sections: SECTIONS });
  assert.equal(result.verdict, 'red');
  assert.equal(result.reds.length, 2);
  assert.equal(
    result.reds[0],
    'no line is exactly the heading "Technical skills" (a heading is a line that is only that text, optionally after #)',
  );
  assert.equal(
    result.reds[1],
    'no line is exactly the heading "Soft skills" (a heading is a line that is only that text, optionally after #)',
  );
  assert.equal(result.red, `${result.reds[0]}; ${result.reds[1]}`);
});

test('sections present but out of order is red naming the out-of-order heading', () => {
  const doc = buildDoc([10, 10, 10], { headings: ['Technical skills', 'Story of experience', 'Soft skills'] });
  const result = closeWordsAndSections(doc, { maxWords: 1000, sections: SECTIONS });
  assert.equal(result.verdict, 'red');
  // Declared order is [Story, Technical, Soft]; actual is [Technical, Story,
  // Soft]. "Story of experience" consumes the pointer past index 1, so the
  // NEXT declared heading, "Technical skills", is the one found earlier
  // (already passed) — that is the one the check names as out of order.
  assert.equal(result.red, 'section heading "Technical skills" is out of order');
});

test('PROOF the test can fail: a heading phrase inside a sentence does not count as the heading line', () => {
  const doc = '# Story of experience\nfiller words here\n'
    + '# Technical skills\nfiller words here\n'
    + 'This paragraph casually mentions soft skills but is not a heading line.\n';
  const result = closeWordsAndSections(doc, { maxWords: 1000, sections: SECTIONS });
  assert.equal(result.verdict, 'red');
  assert.equal(
    result.red,
    'no line is exactly the heading "Soft skills" (a heading is a line that is only that text, optionally after #)',
  );
});

test('a heading line matches case-insensitively and with optional trailing colon', () => {
  const doc = '# STORY OF EXPERIENCE:\nfiller\n# technical skills\nfiller\n# Soft Skills\nfiller\n';
  const result = closeWordsAndSections(doc, { maxWords: 1000, sections: SECTIONS });
  assert.deepEqual(result, { verdict: 'green', reds: [] });
});

test('non-string input is unparseable, not red', () => {
  assert.equal(closeWordsAndSections(42, { maxWords: 10, sections: [] }).verdict, 'unparseable');
  assert.equal(closeWordsAndSections(null, { maxWords: 10, sections: [] }).verdict, 'unparseable');
  assert.equal(closeWordsAndSections(undefined, { maxWords: 10, sections: [] }).verdict, 'unparseable');
  const { red } = closeWordsAndSections(null, { maxWords: 10, sections: [] });
  assert.equal(red, 'expected string text, got null');
});
