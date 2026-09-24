// Tests for poc/m2/executor.mjs and poc/m2/gapback.mjs — $0, zero network,
// every model round is a fake injected by the test (never makeProvider/a
// real OpenAI client, per this task's instruction). RED-FIRST: every test
// below was run against a naive/incomplete implementation first and watched
// fail for the stated reason before the implementation in this same commit
// made it pass (see the task report for the exact red lines).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync, writeFileSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildExecutor, EXECUTOR_FIELDS } from './executor.mjs';
import {
  normaliseGap, runGapBackStep, runGapBackBatch, STRIKE_LIMIT, MAX_ATTEMPTS,
} from './gapback.mjs';
import { closeWordsAndSections } from '../m0/shape.mjs';
import { JOB2_SHAPE } from '../m0/job2.mjs';

// ---------------------------------------------------------------------------
// Construction test — negative (vi): the executor's serialised context
// carries no close/shape/cap/strike identifier, and the checker itself can
// fail (it reds on a deliberately leaky executor).
// ---------------------------------------------------------------------------

const FORBIDDEN_SUBSTRINGS = [
  'close', 'shape', 'maxwords', 'sections', 'linesperinvoice', 'mustcarry', 'cap', 'strike', '600',
  'summary of work history', 'professional skills', 'soft skills',
];

// Functions never survive JSON.stringify (a key whose value is a function is
// dropped entirely) — a replacer that stringifies function values to a
// marker first means a smuggled `close` fn is caught the SAME way a
// smuggled `shape` object's own field names/values are: as text in the
// serialised blob, key names included.
function serializeForLeakCheck(context) {
  return JSON.stringify(context, (key, val) => (typeof val === 'function' ? '[FUNCTION]' : val));
}

function findLeak(context) {
  const json = serializeForLeakCheck(context).toLowerCase();
  if (json.includes('[function]')) return { leaked: true, which: 'a function value' };
  for (const word of FORBIDDEN_SUBSTRINGS) {
    if (json.includes(word.toLowerCase())) return { leaked: true, which: word };
  }
  return { leaked: false, which: null };
}

const CLEAN_READS = { resumeText: 'Amr Hassan, ten years of engineering.', jdText: 'Looking for a senior engineer.' };
const CLEAN_GOAL = 'Write a short summary comparing the two documents below.';

test('buildExecutor context leaks no close/shape/cap/strike identifier (negative vi)', () => {
  const context = buildExecutor({ goal: CLEAN_GOAL, reads: CLEAN_READS, gap: null });
  const leak = findLeak(context);
  assert.equal(leak.leaked, false, `unexpected leak: ${leak.which}`);
});

test('findLeak itself reds on a deliberately leaky executor (proves the checker can fail)', () => {
  function buildLeakyExecutor(opts) {
    const base = buildExecutor({ goal: opts.goal, reads: opts.reads, gap: opts.gap ?? null });
    // Smuggle the close function and the real shape object in as EXTRA
    // fields on the returned context — never through buildExecutor's own
    // parameter list (which would throw), exactly the "close passed as a
    // field" case the ladder's negative (vi) names.
    return {
      ...base,
      close: (text) => closeWordsAndSections(text, JOB2_SHAPE),
      shape: JOB2_SHAPE,
    };
  }
  const leakyContext = buildLeakyExecutor({ goal: CLEAN_GOAL, reads: CLEAN_READS });
  const leak = findLeak(leakyContext);
  assert.equal(leak.leaked, true, 'the leak checker must catch a smuggled close/shape field, but it did not');
});

test('buildExecutor throws naming the field when close is passed directly', () => {
  assert.throws(
    () => buildExecutor({
      goal: CLEAN_GOAL, primitives: [], reads: CLEAN_READS, close: () => {},
    }),
    /executor: unknown field "close"/,
  );
});

test('buildExecutor throws naming any other unknown field', () => {
  assert.throws(
    () => buildExecutor({
      goal: CLEAN_GOAL, reads: CLEAN_READS, cap: 5,
    }),
    /executor: unknown field "cap"/,
  );
});

test('buildExecutor accepts exactly the four documented fields, nothing more', () => {
  assert.deepEqual(EXECUTOR_FIELDS, ['goal', 'primitives', 'reads', 'gap']);
  assert.doesNotThrow(() => buildExecutor({
    goal: CLEAN_GOAL, primitives: ['readDocx'], reads: CLEAN_READS, gap: 'some gap',
  }));
});

test('buildExecutor puts the gap sentence in only when gap is non-null', () => {
  const withoutGap = buildExecutor({ goal: CLEAN_GOAL, reads: CLEAN_READS, gap: null });
  assert.equal(withoutGap.systemPrompt.includes('refused for this reason'), false);
  const withGap = buildExecutor({ goal: CLEAN_GOAL, reads: CLEAN_READS, gap: 'missing section heading "soft skills"' });
  assert.match(withGap.systemPrompt, /refused for this reason: missing section heading "soft skills"\. Fix exactly that\./);
});

test('buildExecutor never names the shape headings/word cap in its own framing text', () => {
  const context = buildExecutor({ goal: CLEAN_GOAL, reads: CLEAN_READS, gap: null });
  assert.doesNotMatch(context.toolDescription.toLowerCase(), /section|word|cap/);
});

// ---------------------------------------------------------------------------
// normaliseGap
// ---------------------------------------------------------------------------

test('normaliseGap collapses digit runs so two word-count gaps of different sizes match', () => {
  assert.equal(normaliseGap('612 words, limit 600'), normaliseGap('613 words, limit 600'));
});

test('normaliseGap keeps two different section gaps distinct', () => {
  assert.notEqual(
    normaliseGap('missing section heading "soft skills"'),
    normaliseGap('missing section heading "professional skills"'),
  );
});

test('normaliseGap is case- and whitespace-insensitive', () => {
  assert.equal(normaliseGap('  Missing   Section  '), normaliseGap('missing section'));
});

// ---------------------------------------------------------------------------
// runGapBackStep — the loop, real closer, fake modelStep.
// ---------------------------------------------------------------------------

const SECTIONS = JOB2_SHAPE.sections; // ['summary of work history', 'professional skills', 'soft skills']

function textWithSections(headings, extraWords = 0) {
  const filler = extraWords > 0 ? ` ${'word '.repeat(extraWords).trim()}` : '';
  return headings.map((h) => `${h}\nSome content here.${filler}`).join('\n\n');
}

const realClose = (text) => closeWordsAndSections(text, JOB2_SHAPE);

test('a step that heals on attempt 2 given only the gap: verdict green, healed, 2 attempts', async () => {
  let call = 0;
  const modelStep = async () => {
    call += 1;
    if (call === 1) {
      // Missing the third heading — a real close-red.
      return { ok: true, text: textWithSections([SECTIONS[0], SECTIONS[1]]), costUsd: 0.01 };
    }
    return { ok: true, text: textWithSections(SECTIONS), costUsd: 0.01 };
  };
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'green');
  assert.equal(result.healed, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].verdict, 'red');
  assert.equal(result.attempts[1].verdict, 'green');
  assert.equal(result.costUsd, 0.02);
});

test('green on attempt 1 is not "healed"', async () => {
  const modelStep = async () => ({ ok: true, text: textWithSections(SECTIONS), costUsd: 0.01 });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'green');
  assert.equal(result.healed, false);
  assert.equal(result.attempts.length, 1);
});

test('the same wrong gap twice strikes out at the second strike (attempt 3, 3 attempts total)', async () => {
  const modelStep = async () => ({ ok: true, text: textWithSections([SECTIONS[0], SECTIONS[1]]), costUsd: 0.01 });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'struck-out');
  assert.equal(result.attempts.length, 3);
  assert.equal(result.attempts[0].strike, false); // first time this gap is seen
  assert.equal(result.attempts[1].strike, true); // strike 1 (repeat)
  assert.equal(result.attempts[2].strike, true); // strike 2 -> struck out
});

test('F38: a close reporting two reds joined carries the WHOLE joined string into attempt 2\'s system prompt', async () => {
  const joinedRed = '601 words, limit 600; no line is exactly the heading "soft skills" '
    + '(a heading is a line that is only that text, optionally after #)';
  const fakeClose = () => ({ verdict: 'red', red: joinedRed });
  const contexts = [];
  const modelStep = async (executorContext) => {
    contexts.push(executorContext);
    return { ok: true, text: 'anything', costUsd: 0.01 };
  };
  await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: fakeClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(contexts.length >= 2, true);
  assert.match(contexts[1].systemPrompt, /601 words, limit 600/);
  assert.match(contexts[1].systemPrompt, /no line is exactly the heading "soft skills"/);
});

test('an empty artifact strikes; two in a row strikes out at attempt 2', async () => {
  const modelStep = async () => ({ ok: true, text: '', costUsd: 0.01 });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'struck-out');
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].red, 'empty artifact');
  assert.equal(result.attempts[0].strike, true);
  assert.equal(result.attempts[1].strike, true);
});

test('alternating between two different wrong gaps hits attempt-fallback at 4, never loops forever', async () => {
  let call = 0;
  const modelStep = async () => {
    call += 1;
    if (call % 2 === 1) {
      // Missing heading gap — identical text every odd call.
      return { ok: true, text: textWithSections([SECTIONS[0], SECTIONS[1]]), costUsd: 0.01 };
    }
    // Word-overflow gap — a different digit count each even call, but the
    // same NORMALISED shape ("# words, limit #").
    return { ok: true, text: textWithSections(SECTIONS, 650 + call), costUsd: 0.01 };
  };
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'attempt-fallback');
  assert.equal(result.attempts.length, 4);
});

test('a null costUsd stops the run as pricing-red, never coerced to 0, spendComplete false', async () => {
  const modelStep = async () => ({ ok: true, text: 'anything', costUsd: null });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'pricing-red');
  assert.equal(result.spendComplete, false);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].costUsd, null);
  assert.notEqual(result.attempts[0].costUsd, 0);
});

test('a model-round failure stops the run as model-red', async () => {
  const modelStep = async () => ({ ok: false, red: 'provider-red: fetch failed' });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'model-red');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].red, 'provider-red: fetch failed');
  assert.equal(result.costUsd, 0);
});

test('a closer that renders no judgment is a casualty, never a red and never a strike', async () => {
  const modelStep = async () => ({ ok: true, text: '123', costUsd: 0.01 });
  const unparseableClose = () => ({ verdict: 'unparseable', red: 'expected string text, got number' });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: unparseableClose, modelStep, strikeLimit: 2, maxAttempts: 4,
  });
  assert.equal(result.verdict, 'close-casualty');
  assert.equal(result.casualty, 'unparseable');
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].strike, false);
});

test('onAttempt is called once per attempt with the same row that lands in attempts[]', async () => {
  const seen = [];
  const modelStep = async () => ({ ok: true, text: textWithSections(SECTIONS), costUsd: 0.01 });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, onAttempt: (row) => seen.push(row),
  });
  assert.equal(seen.length, 1);
  assert.deepEqual(seen[0], result.attempts[0]);
});

test('the signed constants are STRIKE_LIMIT=2, MAX_ATTEMPTS=4 and the loop uses them by default', async () => {
  assert.equal(STRIKE_LIMIT, 2);
  assert.equal(MAX_ATTEMPTS, 4);
  const modelStep = async () => ({ ok: true, text: textWithSections([SECTIONS[0], SECTIONS[1]]), costUsd: 0.01 });
  const result = await runGapBackStep({
    goal: CLEAN_GOAL, reads: CLEAN_READS, close: realClose, modelStep, // no strikeLimit/maxAttempts override
  });
  assert.equal(result.verdict, 'struck-out');
  assert.equal(result.attempts.length, 3);
});

// ---------------------------------------------------------------------------
// runGapBackBatch — refuses an existing tag at $0, never constructs a
// provider first.
// ---------------------------------------------------------------------------

test('runGapBackBatch refuses an existing tag jsonl at $0, before touching any provider', async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm2-gapback-'));
  const tag = 'existing-tag';
  writeFileSync(join(outDir, `gapback-${tag}.jsonl`), '{"already":"here"}\n');

  const modelStepFactory = () => {
    throw new Error('modelStepFactory must never be called when the tag already has evidence');
  };

  await assert.rejects(
    () => runGapBackBatch({
      n: 1,
      tag,
      slot: 'deepseek',
      outDir,
      resumePath: join(outDir, 'does-not-exist.docx'),
      jdPath: join(outDir, 'does-not-exist.md'),
      modelStepFactory,
    }),
    /gapback: .*gapback-existing-tag\.jsonl already exists — refusing to overwrite/,
  );
  // The existing file must be untouched (never overwritten) and no new spend file created.
  assert.equal(existsSync(join(outDir, 'spend.jsonl')), false);
});
