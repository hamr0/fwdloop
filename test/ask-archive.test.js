// Tests for Amendment M4a-1 — SIGNED by hamr 2026-09-27 ("sign m4a1")
// (docs/wiki/the-module-ladder.md, "M4a" section): every park writes a
// PERMANENT copy of the ask into `asks/<askId>.json`, write-once (a second
// write for the same askId is refused, first file stays byte-identical),
// never deleted by resume/answer-consumption/rerun, and a reader
// (`listArchivedAsks`) pairs each archived ask with its answer by askId,
// never by position. Every run happens at $0 against a fake modelStep/
// sendStep — no provider, no key, no network. Fake data only — never real
// names/emails/phones, never `flows/` (gitignored).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk, writeAskArchive, listArchivedAsks } from '../src/ask.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const fixtureJson = (name) => JSON.parse(fixture(name));

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-25T12:00:00Z';
const BUSINESS_DATE = '2026-06-01';
const NOOP_SEND = async (target, filename, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-${prefix}-`));
}

function writeTempFile(dir, name, text) {
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
}

// Fake data only (F# rule): a fake résumé/JD pair, never real names/emails.
function writeSources(srcDir) {
  const resume = writeTempFile(srcDir, 'resume.docx', 'Fake Candidate resume text goes here.');
  const jd = writeTempFile(srcDir, 'jd.md', 'Fake JD text goes here.');
  return [{ id: 'resume', path: resume }, { id: 'jd', path: jd }];
}

function job2Prose({ askMark = 'ask:' } = {}) {
  const base = fixture('job2-with-sources.signed.txt');
  assert.ok(base.includes('4. ask: check it with me,'), 'fixture line 4 must still read "ask: check it with me,"');
  return base.replace('4. ask: check it with me,', `4. ${askMark} check it with me,`);
}

function writeJob2Flow(root, { name = 'job2', askMark } = {}) {
  const result = writeFlow({
    root,
    name,
    proseText: job2Prose({ askMark }),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

function makeJob2ModelStep() {
  const calls = { 'resume-text': 0, 'jd-text': 0, 'resume-summary': 0 };
  const fn = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) {
      calls['resume-text'] += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    }
    if (ctx.goal.includes('job description markdown')) {
      calls['jd-text'] += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    }
    if (ctx.goal.includes('Draft the summary resume')) {
      calls['resume-summary'] += 1;
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected job2 goal: ${ctx.goal}`);
  };
  return { fn, calls };
}

function baseRunArgs({
  root, name = 'job2', runId = 'run-1', modelStep, askStep, clock, nowMs,
}) {
  return {
    root,
    name,
    runId,
    catalogue: CATALOGUE,
    modelStep,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
    ...(askStep ? { askStep } : {}),
    ...(clock ? { clock } : {}),
    ...(nowMs ? { nowMs } : {}),
  };
}

// ---------------------------------------------------------------------------
// (a) A second write for the same askId is refused and the first file on
// disk is left byte-identical — write-once as a MECHANISM (exclusive
// create), not a check-then-write race.
// ---------------------------------------------------------------------------

test('M4a-1 (a): writeAskArchive is write-once — a second write for the same askId is refused, first file unchanged', () => {
  const runDir = tmpRoot('archive-once');
  mkdirSync(runDir, { recursive: true });

  const first = writeAskArchive({
    runDir, askId: 'ask-1', question: 'q1', askedAt: '2026-09-27T00:00:00.000Z', expiresAt: '2026-09-27T01:00:00.000Z', evidence: { artifact: { text: 'draft v1' }, unjudged: [] },
  });
  assert.equal(first.ok, true, first.ok ? '' : first.red);

  const archivePath = path.join(runDir, 'asks', 'ask-1.json');
  assert.equal(existsSync(archivePath), true);
  const before = readFileSync(archivePath, 'utf8');

  const second = writeAskArchive({
    runDir, askId: 'ask-1', question: 'DIFFERENT question, must not land', askedAt: '2026-09-27T02:00:00.000Z', expiresAt: '2026-09-27T03:00:00.000Z', evidence: { artifact: { text: 'draft v2 — must not overwrite' }, unjudged: [] },
  });
  assert.equal(second.ok, false, 'a second write for the same askId must be refused');
  assert.match(second.red, /ask-1\.json/, 'the red must name the file');

  const after = readFileSync(archivePath, 'utf8');
  assert.equal(after, before, 'the first archived file must be byte-identical after a refused second write');
});

// ---------------------------------------------------------------------------
// (b) resume + answer consumption leave every asks/*.json in place — nothing
// deletes an archived ask, not resume, not consuming its answer, and a
// reject's re-park never touches the FIRST askId's archive.
// ---------------------------------------------------------------------------

test('M4a-1 (b): park -> reject -> resume re-parks under a NEW askId -> accept -> complete; every asks/*.json survives untouched', async () => {
  const root = tmpRoot('archive-reject-resume');
  writeJob2Flow(root, { askMark: 'ask 2s:' });
  const srcDir = tmpRoot('archive-reject-resume-src');
  const { fn: modelStep } = makeJob2ModelStep();

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  const askId1 = parked.askId;
  const archive1 = path.join(parked.runDir, 'asks', `${askId1}.json`);
  assert.equal(existsSync(archive1), true, 'the first park must write its archive');
  const archive1Before = readFileSync(archive1, 'utf8');

  const rej = answerAsk({
    runDir: parked.runDir, askId: askId1, decision: 'reject', reason: 'tighten the skills section',
  });
  assert.equal(rej.ok, true, rej.ok ? '' : rej.red);

  const afterReject = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(afterReject.outcome, 'paused', afterReject.red);
  const askId2 = afterReject.askId;
  assert.notEqual(askId2, askId1);
  const archive2 = path.join(parked.runDir, 'asks', `${askId2}.json`);
  assert.equal(existsSync(archive2), true, 'the re-park must write a SECOND archive under the new askId');

  // Resume must never touch the first askId's archive.
  assert.equal(readFileSync(archive1, 'utf8'), archive1Before, 'resume must leave the first archive byte-identical');

  const acc = answerAsk({ runDir: parked.runDir, askId: askId2, decision: 'accept' });
  assert.equal(acc.ok, true, acc.ok ? '' : acc.red);

  const done = await resumeRun(baseRunArgs({ root, modelStep }));
  assert.equal(done.outcome, 'complete', done.red);

  // Answer consumption (both askId1's reject and askId2's accept) and the
  // final resume must leave BOTH archived asks in place.
  assert.equal(existsSync(archive1), true, 'archive 1 must survive answer consumption and resume');
  assert.equal(existsSync(archive2), true, 'archive 2 must survive answer consumption and resume');
  const asksDirEntries = readdirSync(path.join(parked.runDir, 'asks')).sort();
  assert.deepEqual(asksDirEntries, [`${askId1}.json`, `${askId2}.json`].sort());
});

// ---------------------------------------------------------------------------
// (c) listArchivedAsks pairs each archived ask with its answer by askId,
// never by position/order.
// ---------------------------------------------------------------------------

test('M4a-1 (c): listArchivedAsks pairs each archived ask with its answer by askId, not by position', async () => {
  const root = tmpRoot('archive-reader');
  writeJob2Flow(root, { askMark: 'ask 2s:' });
  const srcDir = tmpRoot('archive-reader-src');
  const { fn: modelStep } = makeJob2ModelStep();

  const parked = await runFlow({
    ...baseRunArgs({ root, modelStep, askStep: makeParkingAskStep() }),
    sources: writeSources(srcDir),
  });
  const askId1 = parked.askId;
  answerAsk({
    runDir: parked.runDir, askId: askId1, decision: 'reject', reason: 'tighten the skills section',
  });
  const afterReject = await resumeRun(baseRunArgs({ root, modelStep }));
  const askId2 = afterReject.askId;
  answerAsk({ runDir: parked.runDir, askId: askId2, decision: 'accept' });
  await resumeRun(baseRunArgs({ root, modelStep }));

  const result = listArchivedAsks(parked.runDir);
  assert.equal(result.archived, true, result.archived ? '' : result.why);

  // Deliberately look up by id, not by the array's position — proves the
  // pairing is by askId, never by order the files happened to be read in.
  const byId = Object.fromEntries(result.asks.map((a) => [a.askId, a]));
  assert.equal(byId[askId1].answer.status, 'rejected');
  assert.equal(byId[askId1].answer.reason, 'tighten the skills section');
  assert.equal(byId[askId2].answer.status, 'accepted');
  assert.equal(result.asks.length, 2);

  // Prove the pairing is genuinely by askId: an archived entry whose id
  // matches NEITHER consumed-answer file must show as open/unanswered, even
  // when other consumed answers exist in the same run dir (a positional
  // pairing would wrongly borrow one of them).
  const archiveDir = path.join(parked.runDir, 'asks');
  writeFileSync(path.join(archiveDir, 'ask-orphan.json'), JSON.stringify({
    askId: 'ask-orphan', question: 'orphaned ask, no answer file for it', askedAt: '2099-01-01T00:00:00.000Z', expiresAt: '2099-01-01T01:00:00.000Z', evidence: { artifact: { text: 'orphan draft' }, unjudged: [] },
  }, null, 2));
  const result2 = listArchivedAsks(parked.runDir);
  const byId2 = Object.fromEntries(result2.asks.map((a) => [a.askId, a]));
  assert.equal(byId2['ask-orphan'].answer.status, 'unanswered');
  assert.equal(byId2[askId1].answer.status, 'rejected', 'the orphan must not steal askId1\'s answer');
  assert.equal(byId2[askId2].answer.status, 'accepted', 'the orphan must not steal askId2\'s answer');
});

// ---------------------------------------------------------------------------
// Pre-M4a-1: a run with no asks/ dir at all shows a named why, never an
// invented entry.
// ---------------------------------------------------------------------------

test('M4a-1: a run dir with no asks/ directory reads as "draft not kept (before M4a-1)", never an invented entry', () => {
  const runDir = tmpRoot('pre-m4a1');
  mkdirSync(runDir, { recursive: true });
  // A pre-M4a-1 run dir has ask.json but no asks/ subdirectory at all.
  writeFileSync(path.join(runDir, 'ask.json'), JSON.stringify({
    askId: 'old-ask', question: 'an old ask, parked before M4a-1', askedAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-09-01T01:00:00.000Z',
  }, null, 2));

  const result = listArchivedAsks(runDir);
  assert.equal(result.archived, false);
  assert.equal(result.why, 'draft not kept (before M4a-1)');
});
