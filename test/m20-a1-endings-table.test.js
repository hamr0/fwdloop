// M20 am1 item 1: the ONE table of endings lives in src/books.js (`ENDINGS`). No other src file spells a Set, an array or a chain of 2+ ending words;
// they ask the table's helpers. Allow-list entries are lists that are NOT endings, each with its reason.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  ENDINGS, isGoodEnding, isFailedEnding, isNoiseEnding, isBlockedEnding, isOpenEnding, isResumableEnding, isNotRunEnd, endingWord,
} from '../src/books.js';

const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'src');

/** file (relative to src) -> why a list of words in it is not a list of endings */
export const ALLOW = {
  'books.js': 'the table itself',
  'declaration.js': 'the guardrail close classes (green, softgreen, hitl): what a step is checked as, not how it ended',
  'drafter.js': 'the guardrail close classes, same list as declaration.js',
  'closers.js': 'the closers\' own result words (green, red, ...) from a check, before any row is written; the run reads them through the table',
};

/** per statement, not per file (the shape of the a3 guards' allowed entries): a statement spelled verbatim in its file is blanked out before the scan; an entry found nowhere fails the guard */
export const ALLOW_STATEMENTS = [
  { file: 'panel/author.js', snippet: "export const NOT_GREEN_PHASES = Object.freeze(['red', 'stopped']);", why: 'draft phases (how a draft ended), not run endings' },
];

/** the text of `rel` with its allowed statements blanked out; pushes a stale entry into `stale` @param {string} rel @param {string} text @param {string[]} stale @param {typeof ALLOW_STATEMENTS} allowed */
export function withoutAllowed(rel, text, stale, allowed = ALLOW_STATEMENTS) {
  for (const a of allowed) {
    if (a.file !== rel) continue;
    if (!text.includes(a.snippet)) stale.push(`stale allow-list statement (not found verbatim): ${a.file}: ${a.snippet}`);
    else text = text.split(a.snippet).join('');
  }
  return text;
}

function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (n.endsWith('.js')) out.push(p);
  }
  return out;
}
const stripComments = (s) => s.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' ')).replace(/(^|[^:'"`])\/\/[^\n]*/g, '$1');

/** the lines of `text` that spell a list of 2+ ending words: a bracket of quoted words, or a chain of outcome/verdict comparisons */
export function listsOfEndings(text, words = Object.keys(ENDINGS)) {
  const code = stripComments(text);
  const hits = [];
  const known = new Set(words);
  for (const m of code.matchAll(/\[([^\[\]]*)\]/g)) {
    const quoted = [...m[1].matchAll(/'([a-z-]+)'/g)].map((x) => x[1]).filter((w) => known.has(w));
    if (new Set(quoted).size >= 2) hits.push(m[0].slice(0, 80));
  }
  for (const line of code.split('\n')) {
    const cmp = [...line.matchAll(/(?:outcome|verdict)\s*[!=]==?\s*'([a-z-]+)'/g)].map((x) => x[1]).filter((w) => known.has(w));
    if (new Set(cmp).size >= 2) hits.push(line.trim().slice(0, 80));
  }
  return hits;
}

test('no src file outside books.js (and the allow-list) spells a list of 2+ ending words', () => {
  const bad = [];
  const seen = new Set();
  for (const f of walk(SRC)) {
    const rel = path.relative(SRC, f);
    seen.add(rel);
    if (Object.hasOwn(ALLOW, rel)) continue;
    for (const h of listsOfEndings(withoutAllowed(rel, readFileSync(f, 'utf8'), bad))) bad.push(`${rel}: ${h}`);
  }
  for (const a of ALLOW_STATEMENTS) if (!seen.has(a.file)) bad.push(`stale allow-list statement (file gone): ${a.file}`);
  assert.deepEqual(bad, [], 'a list of ending words outside the table in src/books.js');
});

test('the guard can fail: it sees a Set, an array and a chain of ending words', () => {
  assert.equal(listsOfEndings("const A = new Set(['green', 'hitl']);").length, 1);
  assert.equal(listsOfEndings("if (['complete', 'stopped'].includes(o)) {}").length, 1);
  assert.equal(listsOfEndings("if (r.verdict === 'paused' || r.verdict === 'refused') {}").length, 1);
  assert.equal(listsOfEndings("// ['green', 'hitl'] in a comment\nconst x = 1;").length, 0);
  assert.equal(listsOfEndings("if (r.verdict === 'green') {}").length, 0);
});

test('the per-statement allow can fail: a second list in the file, or a changed statement, is reported', () => {
  const [a] = ALLOW_STATEMENTS;
  const stale = [];
  assert.equal(listsOfEndings(withoutAllowed(a.file, a.snippet, stale)).length, 0);
  assert.deepEqual(stale, []);
  assert.equal(listsOfEndings(withoutAllowed(a.file, `${a.snippet}\nconst X = ['red', 'stopped'];`, stale)).length, 1, 'a second bracket is still seen');
  withoutAllowed(a.file, "export const NOT_GREEN_PHASES = Object.freeze(['red']);", stale);
  assert.equal(stale.length, 1, 'a changed statement is stale');
});

test('the table says what each ending means (the old lists, word for word)', () => {
  const pick = (f) => Object.keys(ENDINGS).filter((w) => f(w));
  assert.deepEqual(pick(isResumableEnding), ['stopped', 'cap-halt']);
  assert.deepEqual(pick(isNotRunEnd), ['skipped', 'stop-failed', 'paused']);
  assert.deepEqual(pick(isNoiseEnding), ['provider-red', 'close-casualty']);
  assert.deepEqual(pick(isBlockedEnding).sort(), ['ask-expired', 'ask-timeout', 'cap-halt', 'close-casualty', 'not-done', 'pricing-red', 'provider-red', 'red', 'refused']);
  assert.deepEqual(pick(isGoodEnding), ['complete', 'green', 'hitl']);
  assert.deepEqual(pick((w) => !isFailedEnding(w)), ['complete', 'skipped', 'stopped', 'cap-halt', 'rerun', 'ask-expired']);
  assert.deepEqual(pick(isOpenEnding), ['stopped', 'ask-expired', 'ask-timeout', 'refused', 'paused', 'ask-reopened', 'lock-removed', 'stop-asked', 'stop-not-honoured']);
  assert.equal(isFailedEnding('never-heard-of-it'), true, 'a word the table does not know is a failure');
  assert.equal(isGoodEnding('constructor'), false);
  assert.deepEqual(['complete', 'stopped', 'cap-halt', 'ask-expired', 'skipped', 'red', 'rerun'].map(endingWord), ['passed', 'stopped', 'stopped', 'expired', 'skipped', 'failed', null]);
});
