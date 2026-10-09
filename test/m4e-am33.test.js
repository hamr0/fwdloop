// M4e amendment 33: bareguard 0.21.2's forgiving heading match accepts ONE leading list marker on a '#' line.
// Goes through fwdloop's own softgreen close (closeSoftgreen -> buildSoftgreenRubric -> checkStep). Synthetic text only.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { closeSoftgreen } from '../src/closers.js';

const SHAPE = { maxWords: 600, sections: ['How it matches the JD', 'Work history', 'Skills'], wordsPerSection: 180 };
const body = (n) => Array.from({ length: n }, (_, i) => `word${i}`).join(' ');
const doc = (heads, extra = '') => ({ text: heads.map((h) => `${h}\n${body(150)}\n`).join('\n') + extra });

test('numbered # headings match their sections (green)', async () => {
  const v = await closeSoftgreen(doc(['## 1. How It Matches the JD', '## 2. Work History', '## 3. Skills']), SHAPE);
  assert.equal(v.verdict, 'green', v.red);
});

test('plain # headings still green (unchanged)', async () => {
  const v = await closeSoftgreen(doc(['## How it matches the JD', '## Work history', '## Skills']), SHAPE);
  assert.equal(v.verdict, 'green', v.red);
});

test('a bare numbered line (no #) is never stripped: red', async () => {
  const v = await closeSoftgreen(doc(['## 1. How It Matches the JD', '1. Work History', '## 3. Skills']), SHAPE);
  assert.equal(v.verdict, 'red');
  assert.match(v.red, /Work history/);
});

test('"## 2024 results" is not a section: Work history stays missing', async () => {
  const v = await closeSoftgreen(doc(['## 1. How It Matches the JD', '## 2024 results', '## 3. Skills']), SHAPE);
  assert.equal(v.verdict, 'red');
  assert.match(v.red, /Work history/);
});
