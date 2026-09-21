// Tests for src/signed-text.js — M1 piece 1 (docs/wiki/the-module-ladder.md,
// "M1 — scope, exit, negative — SIGNED"). Written red-first: the first
// assertions below (the real-fixture parses) failed against an empty
// src/signed-text.js with
//   "Cannot find module '.../src/signed-text.js'"
// then, once parseSignedText existed but returned nothing typed, with
//   AssertionError [ERR_ASSERTION]: ok !== true
// before the grammar was implemented.

import assert from 'node:assert/strict';
import { test, describe } from 'node:test';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { parseSignedText, ARBITER_FIELDS } from '../src/signed-text.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

// ---------------------------------------------------------------------------
// Real signed texts parse green
// ---------------------------------------------------------------------------

describe('real fixtures parse green', () => {
  test('job1.signed.txt (verbatim poc/m0/prose.txt)', () => {
    const result = parseSignedText(fixture('job1.signed.txt'));
    assert.equal(result.ok, true);
    assert.deepEqual(result.arbiter, {
      capUsd: 0.25,
      asks: [{ line: 5, ttlMs: 30 * 60000 }],
      redoCap: 3,
      sends: [{ line: 6, target: { kind: 'file', path: 'poc/m0/out' } }],
      skills: ['core'],
      sources: [],
      roundBudgetMs: 120000,
    });
    assert.deepEqual(
      result.lines.map((l) => l.n),
      [1, 2, 3, 4, 5, 6],
    );
    assert.equal(result.lines[5].guardrail, '');
    assert.equal(result.lines[1].guardrail, 'if more than one customer matches, ask me, do not pick');
  });

  test('job2.signed.txt (verbatim poc/m0/job2.prose.txt)', () => {
    const result = parseSignedText(fixture('job2.signed.txt'));
    assert.equal(result.ok, true);
    assert.deepEqual(result.arbiter, {
      capUsd: 0.25,
      asks: [{ line: 4, ttlMs: 30 * 60000 }],
      redoCap: 3,
      sends: [{ line: 5, target: { kind: 'file', path: 'poc/m0/out' } }],
      skills: ['core'],
      sources: [],
      roundBudgetMs: 120000,
    });
    assert.deepEqual(
      result.lines.map((l) => l.n),
      [1, 2, 3, 4, 5],
    );
  });

  test('job2-with-sources.signed.txt (job2 + two source lines, hamr\'s own paths)', () => {
    const result = parseSignedText(fixture('job2-with-sources.signed.txt'));
    assert.equal(result.ok, true);
    assert.deepEqual(result.arbiter, {
      capUsd: 0.25,
      asks: [{ line: 4, ttlMs: 30 * 60000 }],
      redoCap: 3,
      sends: [{ line: 5, target: { kind: 'file', path: 'poc/m0/out' } }],
      skills: ['core'],
      sources: [
        { role: 'resume', kind: 'file', path: '/home/hamr/Documents/resumes/Amr Hassan - Resume.docx' },
        { role: 'jd', kind: 'file', path: '/home/hamr/Documents/resumes/jd-anthropic-applied-ai-architect.md' },
      ],
      roundBudgetMs: 120000,
    });
  });

  test('frozen output — result, arbiter, lines, and their entries cannot be mutated', () => {
    const result = parseSignedText(fixture('job1.signed.txt'));
    assert.throws(() => { result.arbiter.capUsd = 999; }, TypeError);
    assert.throws(() => { result.lines[0].text = 'tampered'; }, TypeError);
    assert.throws(() => { result.arbiter.asks.push({ line: 1, ttlMs: 1 }); }, TypeError);
  });
});

// ---------------------------------------------------------------------------
// THE MUTATION SUITE — every arbiter field, every corruption, named reds
// ---------------------------------------------------------------------------
//
// Base document below is the PROOF control: five numbered lines and one
// arbiter line per field, all valid. Each mutation case swaps exactly ONE
// arbiter line for a corrupted variant (or adds/removes one), re-parses,
// and asserts the result is red AND that the red names the field. Because
// every other line stays exactly as in the green control, the corrupted
// line is the only thing that could have flipped the verdict — the same
// "revert it alone, see red, restore" discipline as a regression test.

const BASE_JOB = [
  '1. Step one.',
  '2. Step two.',
  '3. Step three, this is the ask point.',
  '   guardrail: check it before moving on',
  '4. Step four, this is the send point.',
  '5. Step five.',
].join('\n');

const BASE_ARBITER = {
  capUsd: 'guardrail: cap $0.25 per run',
  asks: 'guardrail: ask at line 3 ttl 45m',
  redoCap: 'guardrail: redo cap 2',
  sends: 'guardrail: send at line 4 to file:out/result.txt',
  skills: 'guardrail: skills core, custom',
  sources: 'guardrail: source resume = file:/tmp/resume.docx',
  roundBudgetMs: 'guardrail: round budget 90s',
};

const BASE_EXPECTED_ARBITER = {
  capUsd: 0.25,
  asks: [{ line: 3, ttlMs: 45 * 60000 }],
  redoCap: 2,
  sends: [{ line: 4, target: { kind: 'file', path: 'out/result.txt' } }],
  skills: ['core', 'custom'],
  sources: [{ role: 'resume', kind: 'file', path: '/tmp/resume.docx' }],
  roundBudgetMs: 90000,
};

const HEADING = 'Arbiter guardrails (belong to no line; human-signed, tighten-only):';

/** Build the full signed text from the base job + an ordered list of
 *  arbiter guardrail lines (each the full "guardrail: ..." text). */
function buildText(arbiterLines) {
  return [BASE_JOB, '', HEADING, ...arbiterLines].join('\n');
}

const BASE_ARBITER_ORDER = ['capUsd', 'asks', 'redoCap', 'sends', 'skills', 'sources', 'roundBudgetMs'];
const BASE_TEXT = buildText(BASE_ARBITER_ORDER.map((k) => BASE_ARBITER[k]));

test('PROOF — the unmutated base control parses green with the expected arbiter', () => {
  const result = parseSignedText(BASE_TEXT);
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  assert.deepEqual(result.arbiter, BASE_EXPECTED_ARBITER);
});

/** Replace the named field's line with `replacement` (a full "guardrail: .."
 *  string, or `null` to delete it), leaving every other base line intact. */
function withMutation(field, replacement) {
  const lines = BASE_ARBITER_ORDER
    .filter((k) => k !== field || replacement !== null)
    .map((k) => (k === field ? replacement : BASE_ARBITER[k]));
  return buildText(lines);
}

/** Replace the named field's line with TWO copies of `line` (duplicate). */
function withDuplicate(field, line) {
  const lines = [];
  for (const k of BASE_ARBITER_ORDER) {
    if (k === field) {
      lines.push(BASE_ARBITER[k], line);
    } else {
      lines.push(BASE_ARBITER[k]);
    }
  }
  return lines;
}

const covered = new Set();

/** Register and run one corruption case: assert red, and that some red
 *  names the field (`field "capUsd"` etc. — the exact phrasing the parser
 *  uses throughout src/signed-text.js). */
function mutationCase(field, name, text) {
  covered.add(field);
  test(`mutation: ${field} — ${name}`, () => {
    const result = parseSignedText(text);
    assert.equal(result.ok, false, `expected a red for ${field}/${name}, got green`);
    const needle = `field "${field}"`;
    assert.ok(
      result.reds.some((r) => r.includes(needle)),
      `expected a red naming ${needle}, got:\n${result.reds.join('\n')}`,
    );
  });
}

describe('mutation suite', () => {
  // --- capUsd ---------------------------------------------------------
  mutationCase('capUsd', 'removed (required field missing)', withMutation('capUsd', null));
  mutationCase('capUsd', 'retyped number->word', withMutation('capUsd', 'guardrail: cap $abc per run'));
  mutationCase('capUsd', 'negative', withMutation('capUsd', 'guardrail: cap $-1 per run'));
  mutationCase('capUsd', 'zero', withMutation('capUsd', 'guardrail: cap $0 per run'));
  mutationCase('capUsd', 'missing unit words', withMutation('capUsd', 'guardrail: cap $5'));
  mutationCase('capUsd', 'duplicated', buildText(withDuplicate('capUsd', 'guardrail: cap $0.10 per run')));

  // --- asks -------------------------------------------------------------
  mutationCase('asks', 'ttl unit wrong', withMutation('asks', 'guardrail: ask at line 3 ttl 45x'));
  mutationCase('asks', 'line number decimal', withMutation('asks', 'guardrail: ask at line 3.5'));
  mutationCase('asks', 'line number negative', withMutation('asks', 'guardrail: ask at line -1'));
  mutationCase('asks', 'line points at a missing line', withMutation('asks', 'guardrail: ask at line 99'));
  mutationCase('asks', 'duplicated', buildText(withDuplicate('asks', 'guardrail: ask at line 3')));

  // --- redoCap ------------------------------------------------------------
  mutationCase('redoCap', 'retyped int->decimal', withMutation('redoCap', 'guardrail: redo cap 1.5'));
  mutationCase('redoCap', 'negative', withMutation('redoCap', 'guardrail: redo cap -1'));
  mutationCase('redoCap', 'zero (out of range)', withMutation('redoCap', 'guardrail: redo cap 0'));
  mutationCase('redoCap', 'out of range (4)', withMutation('redoCap', 'guardrail: redo cap 4'));
  mutationCase('redoCap', 'duplicated', buildText(withDuplicate('redoCap', 'guardrail: redo cap 1')));

  // --- sends --------------------------------------------------------------
  mutationCase('sends', 'target kind swapped (url: instead of file:)', withMutation('sends', 'guardrail: send at line 4 to url:https://example.com'));
  mutationCase('sends', 'line points at a missing line', withMutation('sends', 'guardrail: send at line 99 to file:out/result.txt'));
  mutationCase('sends', 'duplicated', buildText(withDuplicate('sends', 'guardrail: send at line 4 to file:out/other.txt')));
  mutationCase('sends', 'empty path', withMutation('sends', 'guardrail: send at line 4 to file:'));
  mutationCase('sends', 'send before any ask', withMutation('sends', 'guardrail: send at line 2 to file:out/result.txt'));

  // --- skills ---------------------------------------------------------------
  mutationCase('skills', 'name uppercase', withMutation('skills', 'guardrail: skills Core'));
  mutationCase('skills', 'name starts with digit', withMutation('skills', 'guardrail: skills 1core'));
  mutationCase('skills', 'malformed (no names)', withMutation('skills', 'guardrail: skills'));
  mutationCase('skills', 'duplicated', buildText(withDuplicate('skills', 'guardrail: skills ops')));

  // --- sources --------------------------------------------------------------
  mutationCase('sources', 'kind swapped (url: instead of file:)', withMutation('sources', 'guardrail: source resume = url:https://example.com/resume'));
  mutationCase('sources', 'duplicated role', buildText(withDuplicate('sources', 'guardrail: source resume = file:/tmp/other.docx')));
  mutationCase('sources', 'comma-joined second source', withMutation('sources', 'guardrail: source resume = file:/tmp/a.docx, source jd = file:/tmp/b.md'));
  mutationCase('sources', 'semicolon-joined second source', withMutation('sources', 'guardrail: source resume = file:/tmp/a.docx; source jd = file:/tmp/b.md'));
  mutationCase('sources', 'empty path', withMutation('sources', 'guardrail: source resume = file:'));
  mutationCase('sources', 'malformed (missing "=")', withMutation('sources', 'guardrail: source resume file:/tmp/a.docx'));

  // --- roundBudgetMs ----------------------------------------------------------
  mutationCase('roundBudgetMs', 'unit wrong', withMutation('roundBudgetMs', 'guardrail: round budget 90x'));
  mutationCase('roundBudgetMs', 'retyped int->decimal', withMutation('roundBudgetMs', 'guardrail: round budget 1.5m'));
  mutationCase('roundBudgetMs', 'duplicated', buildText(withDuplicate('roundBudgetMs', 'guardrail: round budget 30s')));

  test('the suite mutates every field the grammar defines (ARBITER_FIELDS)', () => {
    assert.deepEqual([...covered].sort(), [...ARBITER_FIELDS].sort());
  });
});

// ---------------------------------------------------------------------------
// Part 1a — send path is everything after "file:" to end of line, trimmed
// (same rule as source), so a path containing a space parses.
// ---------------------------------------------------------------------------

describe('send path parsing (M1 review correction a)', () => {
  test('a send path containing a space parses, trimmed', () => {
    const text = buildText([
      ...BASE_ARBITER_ORDER.filter((k) => k !== 'sends').map((k) => BASE_ARBITER[k]),
      'guardrail: send at line 4 to file:out/my result.txt',
    ]);
    const result = parseSignedText(text);
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
    assert.deepEqual(result.arbiter.sends, [
      { line: 4, target: { kind: 'file', path: 'out/my result.txt' } },
    ]);
  });

  test('a send path with leading/trailing space around the content is trimmed', () => {
    const text = buildText([
      ...BASE_ARBITER_ORDER.filter((k) => k !== 'sends').map((k) => BASE_ARBITER[k]),
      'guardrail: send at line 4 to file:  out/result.txt  ',
    ]);
    const result = parseSignedText(text);
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
    assert.deepEqual(result.arbiter.sends, [
      { line: 4, target: { kind: 'file', path: 'out/result.txt' } },
    ]);
  });

  test('an empty send path is still a red', () => {
    const text = buildText([
      ...BASE_ARBITER_ORDER.filter((k) => k !== 'sends').map((k) => BASE_ARBITER[k]),
      'guardrail: send at line 4 to file:',
    ]);
    const result = parseSignedText(text);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /field "sends" has an empty path/.test(r)));
  });

  test('an empty send path with trailing spaces is still a red', () => {
    const text = buildText([
      ...BASE_ARBITER_ORDER.filter((k) => k !== 'sends').map((k) => BASE_ARBITER[k]),
      'guardrail: send at line 4 to file:   ',
    ]);
    const result = parseSignedText(text);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /field "sends" has an empty path/.test(r)));
  });
});

// ---------------------------------------------------------------------------
// Part 1b — "one source per line" reds only on a real second source clause,
// never on a path that merely contains "," or ";".
// ---------------------------------------------------------------------------

describe('source path comma/semicolon false-positive (M1 review correction b)', () => {
  test('a source path containing a comma is accepted as one source', () => {
    const text = buildText([
      ...BASE_ARBITER_ORDER.filter((k) => k !== 'sources').map((k) => BASE_ARBITER[k]),
      'guardrail: source resume = file:/tmp/a,b; c.docx',
    ]);
    const result = parseSignedText(text);
    assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
    assert.deepEqual(result.arbiter.sources, [
      { role: 'resume', kind: 'file', path: '/tmp/a,b; c.docx' },
    ]);
  });

  test('a genuine second "source x =" clause after the first file: is still a red naming "one source per line"', () => {
    const text = buildText([
      ...BASE_ARBITER_ORDER.filter((k) => k !== 'sources').map((k) => BASE_ARBITER[k]),
      'guardrail: source a = file:/x; source b = file:/y',
    ]);
    const result = parseSignedText(text);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /one source per line/.test(r)));
  });
});

// ---------------------------------------------------------------------------
// Unknown keyword / grammar reds
// ---------------------------------------------------------------------------

test('unrecognised arbiter keyword is a red naming the line and the grammar', () => {
  const text = buildText([...BASE_ARBITER_ORDER.map((k) => BASE_ARBITER[k]), 'guardrail: trigger on friday']);
  const result = parseSignedText(text);
  assert.equal(result.ok, false);
  assert.ok(result.reds.some((r) => /is not in the grammar/.test(r)));
});

// ---------------------------------------------------------------------------
// 1-for-1 rule, numbering, non-string / empty, CRLF
// ---------------------------------------------------------------------------

test('a second guardrail under the same line is a red', () => {
  const text = [
    '1. Do the thing.',
    '   guardrail: first rule',
    '   guardrail: second rule',
    '',
    HEADING,
    'guardrail: cap $1.00 per run',
  ].join('\n');
  const result = parseSignedText(text);
  assert.equal(result.ok, false);
  assert.ok(result.reds.some((r) => /second "guardrail:"/.test(r)));
});

test('an orphan guardrail (no numbered line above it) is a red', () => {
  const text = [
    '   guardrail: orphaned',
    '1. Do the thing.',
    '',
    HEADING,
    'guardrail: cap $1.00 per run',
  ].join('\n');
  const result = parseSignedText(text);
  assert.equal(result.ok, false);
  assert.ok(result.reds.some((r) => /has no numbered line above it/.test(r)));
});

test('a duplicate line number is a red', () => {
  const text = [
    '1. First.',
    '1. Also first.',
    '',
    HEADING,
    'guardrail: cap $1.00 per run',
  ].join('\n');
  const result = parseSignedText(text);
  assert.equal(result.ok, false);
  assert.ok(result.reds.some((r) => /not increasing/.test(r)));
});

test('a decreasing line number is a red', () => {
  const text = [
    '2. Second.',
    '1. First, out of order.',
    '',
    HEADING,
    'guardrail: cap $1.00 per run',
  ].join('\n');
  const result = parseSignedText(text);
  assert.equal(result.ok, false);
  assert.ok(result.reds.some((r) => /not increasing/.test(r)));
});

test('numbering may start above 1', () => {
  const text = [
    '5. First numbered line, starting at 5.',
    '6. Second.',
    '',
    HEADING,
    'guardrail: cap $1.00 per run',
  ].join('\n');
  const result = parseSignedText(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.lines.map((l) => l.n), [5, 6]);
});

test('a missing "Arbiter guardrails" heading is a red', () => {
  const text = ['1. Do the thing.'].join('\n');
  const result = parseSignedText(text);
  assert.equal(result.ok, false);
  assert.ok(result.reds.some((r) => /missing "Arbiter guardrails" heading/.test(r)));
});

test('non-string input is a red, never a throw', () => {
  for (const bad of [undefined, null, 42, {}, [], true]) {
    const result = parseSignedText(bad);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /input must be a string/.test(r)));
  }
});

test('empty string is a red, never a throw', () => {
  const result = parseSignedText('');
  assert.equal(result.ok, false);
  assert.ok(result.reds.length > 0);
});

test('CRLF input parses identically to the equivalent LF input', () => {
  const lf = fixture('job1.signed.txt');
  const crlf = lf.replace(/\n/g, '\r\n');
  const lfResult = parseSignedText(lf);
  const crlfResult = parseSignedText(crlf);
  assert.equal(lfResult.ok, true);
  assert.equal(crlfResult.ok, true);
  assert.deepEqual(crlfResult.arbiter, lfResult.arbiter);
  assert.deepEqual(crlfResult.lines, lfResult.lines);
});

// ---------------------------------------------------------------------------
// ReDoS / "patterns are literal or typed, never user regex"
// ---------------------------------------------------------------------------

describe('ReDoS resistance', () => {
  const EVIL = '(a+)+$';
  const LONG_EVIL_LINE = `${'a'.repeat(50000)}!`;

  test('an evil pattern planted in a guardrail parses (as literal text) in < 50ms', () => {
    const text = [
      `1. Step one. ${EVIL}`,
      `   guardrail: ${LONG_EVIL_LINE}`,
      '2. Step two.',
      '',
      HEADING,
      'guardrail: cap $1.00 per run',
    ].join('\n');
    const start = performance.now();
    const result = parseSignedText(text);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `expected < 50ms, took ${elapsed}ms`);
    assert.equal(result.ok, true);
    assert.equal(result.lines[0].guardrail, LONG_EVIL_LINE);
  });

  test('an evil pattern planted as an arbiter line is treated as a grammar red, in < 50ms', () => {
    const text = [
      '1. Step one.',
      '',
      HEADING,
      'guardrail: cap $1.00 per run',
      `guardrail: ${EVIL} ${LONG_EVIL_LINE}`,
    ].join('\n');
    const start = performance.now();
    const result = parseSignedText(text);
    const elapsed = performance.now() - start;
    assert.ok(elapsed < 50, `expected < 50ms, took ${elapsed}ms`);
    assert.equal(result.ok, false);
    assert.ok(result.reds.some((r) => /is not in the grammar/.test(r)));
  });

  test('no `new RegExp(` anywhere in src/', () => {
    const srcDir = path.join(HERE, '..', 'src');
    const files = listJsFiles(srcDir);
    assert.ok(files.length > 0, 'expected to find .js files under src/');
    for (const file of files) {
      const contents = readFileSync(file, 'utf8');
      assert.ok(!contents.includes('new RegExp('), `${file} builds a RegExp dynamically`);
    }
  });
});

function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (entry.endsWith('.js')) out.push(full);
  }
  return out;
}
