// Tests for src/ask.js — M2 piece 2. Real filesystem, temp directories,
// short timeouts/poll intervals so the suite stays fast; never a fixed
// sleep-then-assert — every wait polls the condition itself.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdtempSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { makeFileAskStep, answerAsk, readAskEvidence } from '../src/ask.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const fixtureJson = (name) => JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'ask-shapes', name), 'utf8'));

function tmpRunDir() {
  return mkdtempSync(path.join(tmpdir(), 'fwdloop-ask-'));
}

test('writes ask.json with the question and evidence, then resolves once answer.json appears', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000 });
  const promise = askStep({ question: 'accept this draft?', evidence: { text: 'draft body' }, runDir });

  // Poll for ask.json to exist before answering — never a fixed sleep.
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  assert.ok(existsSync(askPath));
  const askJson = JSON.parse(readFileSync(askPath, 'utf8'));
  assert.equal(askJson.question, 'accept this draft?');
  assert.deepEqual(askJson.evidence, { text: 'draft body' });

  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: new Date().toISOString() }));
  const result = await promise;
  assert.equal(result.decision, 'accept');
});

test('consume-once: the answer file is renamed away after being read, never left for a second read to find', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: '2026-09-24T12:00:05.000Z' }));
  await promise;
  assert.equal(existsSync(path.join(runDir, 'answer.json')), false, 'answer.json must be consumed (renamed away)');
  assert.equal(existsSync(path.join(runDir, 'answer.2026-09-24T12-00-00-000Z.consumed.json')), true);
});

test('a stale answer (answeredAt before this ask\'s askedAt) is quarantined and never applied — the ask keeps waiting', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }

  // A stale answer arrives (answeredAt predates this ask's askedAt) —
  // simulates a redraft mid-flight racing an answer from the PRIOR ask.
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: '2026-09-24T11:59:00.000Z' }));

  // Poll: the stale file should get quarantined (answer.stale.1.json appears) while the promise
  // is still pending — proves the stale answer was NOT applied.
  const staleDeadline = Date.now() + 2000;
  while (!existsSync(path.join(runDir, 'answer.stale.1.json')) && Date.now() < staleDeadline) {
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.ok(existsSync(path.join(runDir, 'answer.stale.1.json')), 'stale answer must be quarantined');

  let settled = false;
  promise.then(() => { settled = true; });
  await new Promise((r) => setTimeout(r, 100));
  assert.equal(settled, false, 'the ask must still be waiting — a stale answer never resolves it');

  const auditRows = readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(auditRows.some((r) => r.verdict === 'stale-answer-ignored'));

  // Now the REAL (fresh) answer arrives and the ask resolves.
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'accept', answeredAt: '2026-09-24T12:00:10.000Z' }));
  const result = await promise;
  assert.equal(result.decision, 'accept');
});

test('PROOF the stale check can fail: a genuinely fresh answer (answeredAt after askedAt) is applied immediately, not quarantined', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'reject', reason: 'too long', answeredAt: '2026-09-24T12:00:01.000Z' }));
  const result = await promise;
  assert.equal(result.decision, 'reject');
  assert.equal(result.reason, 'too long');
  assert.equal(existsSync(path.join(runDir, 'answer.stale.1.json')), false);
});

test('timeout: no answer.json within timeoutMs resolves { decision: "timeout" }, never throws, never hangs', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 150 });
  const result = await askStep({ question: 'q', evidence: null, runDir });
  assert.equal(result.decision, 'timeout');
});

test('a rerun/reject decision with no reason is returned as-is — refusing an empty reason is runner.js\'s job, not ask.js\'s', async () => {
  const runDir = tmpRunDir();
  const askStep = makeFileAskStep({ pollMs: 20, timeoutMs: 5000, clock: () => '2026-09-24T12:00:00.000Z' });
  const promise = askStep({ question: 'q', evidence: null, runDir });
  const askPath = path.join(runDir, 'ask.json');
  const deadline = Date.now() + 2000;
  while (!existsSync(askPath) && Date.now() < deadline) { await new Promise((r) => setTimeout(r, 10)); }
  writeFileSync(path.join(runDir, 'answer.json'), JSON.stringify({ decision: 'rerun', answeredAt: '2026-09-24T12:00:01.000Z' }));
  const result = await promise;
  assert.equal(result.decision, 'rerun');
  assert.equal(result.reason, undefined);
});

// ---------------------------------------------------------------------------
// A present-but-unparseable ask.json "expiresAt" (Date.parse -> NaN) must
// never read as "not expired" — `NaN > x` and `x > NaN` are both false, so
// the naive comparison would silently treat garbage as open forever.
// answerAsk must refuse, naming the askId and the bad value.
// ---------------------------------------------------------------------------
test('answerAsk refuses a garbage (unparseable) expiresAt, naming the askId and the bad value, never treating it as not-expired', () => {
  const runDir = tmpRunDir();
  writeFileSync(path.join(runDir, 'ask.json'), JSON.stringify({
    askId: 'ask-1', question: 'q', evidence: null, askedAt: '2026-09-24T12:00:00.000Z', expiresAt: 'not-a-real-date',
  }));

  const result = answerAsk({ runDir, askId: 'ask-1', decision: 'accept' });
  assert.equal(result.ok, false);
  assert.match(result.red, /askId "ask-1" has an unparseable expiresAt "not-a-real-date"/);
  assert.equal(existsSync(path.join(runDir, 'answer.json')), false, 'a refused answerAsk must never write answer.json');
});

// ---------------------------------------------------------------------------
// F47 fix (docs/logs/FINDINGS.md F47, M4a ladder item 1): readAskEvidence()
// is the ONE shared reader for ask.json's "evidence" field, across every
// real shape found on disk. Fixtures below are copies of REAL ask.json
// files (flows/job2-live-1/runs/{run-1,m3-live-2,m3-live-1}, personal
// contact details redacted) — flows/ itself is gitignored, so tests never
// reference it directly (CI only sees tracked files).
//
// PROOF each of these can fail: before this fix, bin/fwdloop's
// artifactText(evidence.artifact) read `evidence.artifact` directly with no
// normalisation. Reverting src/ask.js's readAskEvidence() to `return {
// draft: evidence?.artifact ? { text: evidence.artifact.text } : null,
// unjudged: [] }` (the pre-fix M3-only shape) makes the M2-shape test below
// fail with:
//   AssertionError: expected null to not equal null (draft was null for the
//   M2 fixture, which HAS evidence.text on disk)
// — the exact F47 bug: real evidence present, draft wrongly reported empty
// (and bin/fwdloop's old artifactText(undefined) would print the literal
// string "undefined" for it). Restore the fix afterward.
// ---------------------------------------------------------------------------

test('readAskEvidence: M3 shape (evidence.artifact.text + evidence.unjudged[]) — real ask.json', () => {
  const ask = fixtureJson('m3-shape.ask.json');
  const { draft, unjudged, why } = readAskEvidence(ask);
  assert.equal(why, undefined);
  assert.ok(draft, 'draft must not be null — this ask.json has evidence.artifact.text on disk');
  assert.equal(typeof draft.text, 'string');
  assert.match(draft.text, /Summary of Work History Blurb/);
  assert.ok(Array.isArray(unjudged) && unjudged.length > 0, 'this real ask.json carries unjudged pre-ask artifacts');
  for (const item of unjudged) {
    assert.equal(typeof item.step, 'string');
    assert.equal(typeof item.text, 'string');
  }
  // hamr review #9 (2026-09-27): the fixture's own unjudged entries name a
  // real `emits` id (e.g. "resume-text") distinct from `step` (which — the
  // fixture's own field name notwithstanding — carries the step's GOAL
  // prose, not an id). The earlier version of this reader silently dropped
  // `emits`, which is exactly why the panel's Inbox mislabelled by goal.
  assert.deepEqual(unjudged.map((u) => u.emits), ['resume-text', 'jd-text']);
  assert.ok(unjudged.every((u) => u.step !== u.emits), 'sanity: this fixture\'s "step" text is the goal prose, never equal to its emits id');
});

test('readAskEvidence: an unjudged entry with no "emits" field omits it honestly, never guesses one', () => {
  const ask = {
    evidence: {
      artifact: { text: 'the draft' },
      unjudged: [{ step: 'a pre-M4 fixture with no emits id at all', artifact: { text: 'fine' } }],
    },
  };
  const { unjudged } = readAskEvidence(ask);
  assert.equal(unjudged.length, 1);
  assert.equal('emits' in unjudged[0], false, 'no emits key at all — never a guessed/blank value standing in for it');
  assert.equal(unjudged[0].step, 'a pre-M4 fixture with no emits id at all');
});

test('readAskEvidence: M2 shape (evidence.text/evidence.lines, no "unjudged" concept) — real ask.json — the F47 GAP case', () => {
  const ask = fixtureJson('m2-shape.ask.json');
  const { draft, unjudged, why } = readAskEvidence(ask);
  assert.equal(why, undefined);
  assert.ok(draft, 'draft must not be null — this M2-era ask.json has evidence.text on disk (the F47 bug reported this as empty/"undefined")');
  assert.equal(typeof draft.text, 'string');
  assert.match(draft.text, /work history blurb/i);
  assert.notEqual(draft.text, 'undefined', 'must never be the literal string "undefined" (F47)');
  assert.deepEqual(unjudged, [], 'M2-era evidence has no "unjudged" concept at all');
});

test('readAskEvidence: no "evidence" key at all (pre-F45 legacy park) — real ask.json', () => {
  const ask = fixtureJson('none-shape.ask.json');
  assert.equal('evidence' in ask, false, 'fixture sanity: this real ask.json really has no evidence key');
  const { draft, unjudged, why } = readAskEvidence(ask);
  assert.equal(draft, null);
  assert.deepEqual(unjudged, []);
  assert.equal(typeof why, 'string');
  assert.match(why, /pre-F45/);
});

test('readAskEvidence: an unrecognised evidence shape is a named "why", never a crash, never an invented value', () => {
  const { draft, unjudged, why } = readAskEvidence({ question: 'q', evidence: { somethingElse: 42 } });
  assert.equal(draft, null);
  assert.deepEqual(unjudged, []);
  assert.equal(typeof why, 'string');
  assert.match(why, /unrecognised shape/);
});

test('readAskEvidence: evidence.unjudged with a malformed entry drops that entry rather than showing a blank row, and never crashes', () => {
  const ask = {
    evidence: {
      artifact: { text: 'the draft' },
      unjudged: [
        { step: 'ok-step', artifact: { text: 'fine' } },
        { artifact: { text: 'no step name' } },
        { step: 'no-text' },
        null,
      ],
    },
  };
  const { draft, unjudged } = readAskEvidence(ask);
  assert.equal(draft.text, 'the draft');
  assert.deepEqual(unjudged, [{ step: 'ok-step', text: 'fine' }]);
});
