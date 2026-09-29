// F48 round 4 (redesign, docs/logs/FINDINGS.md): round 3's fix for a
// symlinked artifact file introduced a NEW gap — `readArtifact` returned
// `undefined` for BOTH "never written" and "read refused" (symlink escape /
// outside the run dir / unparseable JSON), so a swapped or deleted accepted
// artifact reached the send slot as `undefined`, got `?? null`-ed by
// src/send.js, and shipped as a recorded-green 4-byte `null` to the signed
// destination.
//
// This suite proves the redesign closes that gap: a custom job2-shaped flow
// with an extra ORDINARY step wedged between the signed ask (line 4) and the
// signed send (now line 6) gives the test a real hook — that intervening
// step's fake modelStep runs strictly AFTER the ask's artifact is accepted
// and written to disk, and strictly BEFORE the send step ever reads it — to
// tamper with the accepted artifact exactly "after accept, before send",
// using only the public runFlow API (no reach into runner.js internals).
//
// Every send target below is a fake `sendStep` spy, never `sendViaPrimitive`
// — nothing here writes to a real destination directory (never flows/,
// never any real send target).

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  writeFileSync, symlinkSync, unlinkSync, existsSync, readFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import {
  runFlow, resumeRun, makeParkingAskStep,
} from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { readAudit } from '../src/books.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const catalogueLoaded = loadCatalogue();
assert.equal(catalogueLoaded.ok, true, catalogueLoaded.ok ? '' : catalogueLoaded.reds.join('\n'));
const CATALOGUE = catalogueLoaded.primitives;

const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-27T12:00:00Z';
const BUSINESS_DATE = '2026-06-01';

function tmpRoot(prefix) {
  return mkdtempSync(path.join(tmpdir(), `fwdloop-f48r4-${prefix}-`));
}

// ---------------------------------------------------------------------------
// A job2-shaped flow (same steps 1-4 as test/fixtures/job2.m1.declaration.json
// / job2-with-sources.signed.txt) with one extra ORDINARY softgreen step (new
// line 5, "do a quick pass afterward") wedged between the signed ask (line 4)
// and the signed send (moved to line 6). The extra step reads nothing and
// emits an artifact irrelevant to the send — it exists purely to give the
// test a real modelStep invocation strictly between "ask accepted, artifact
// written" and "send reads that artifact".
// ---------------------------------------------------------------------------

const PROSE = [
  '1. Read my resume,',
  '2. and read the JD to compare it against,',
  '3. write me a summary resume: how it matches the JD, with a summary of work history blurb, professional skills, soft skills, 3 sections all under 600 words, 200ish each,',
  '   guardrail: 3 sections, all under 600 words',
  '4. ask: check it with me,',
  '   guardrail: nothing goes out before I accept',
  '5. do a quick pass afterward,',
  '   guardrail: nothing needed, silent green',
  '6. and once I accept, write it out.',
  '',
  'Arbiter guardrails (belong to no line; human-signed, tighten-only — never authored or claimed by the drafter):',
  'guardrail: cap $0.25 per run',
  'guardrail: send at line 6 to file:poc/m0/out',
  'guardrail: source resume = file:/home/hamr/Documents/resumes/Amr Hassan - Resume.docx',
  'guardrail: source jd = file:/home/hamr/Documents/resumes/jd-anthropic-applied-ai-architect.md',
].join('\n');

const DECLARATION = {
  guardrailClasses: { 3: 'softgreen', 4: 'hitl', 5: 'softgreen' },
  unjudgeable: {},
  refused: [],
  inputFacts: { resume: [], jd: ['Responsibilities', 'Qualifications', 'About the role'] },
  steps: [
    {
      goal: 'Read the resume .docx and expose its full text as an artifact.', primitives: ['readDocx'], reads: [], emits: 'resume-text', fromLine: 1, close: { class: 'hitl' },
    },
    {
      goal: 'Read the job description markdown file and expose its full text as an artifact.', primitives: ['read'], reads: [], emits: 'jd-text', fromLine: 2, close: { class: 'hitl' },
    },
    {
      goal: 'Draft the summary resume comparing the resume against the JD, in three sections (work-history blurb, professional skills, soft skills), each ~200 words and the whole under 600 words.',
      primitives: ['read'],
      reads: ['resume-text', 'jd-text'],
      emits: 'resume-summary',
      fromLine: 3,
      close: { class: 'softgreen', shape: { sections: ['summary of work history blurb', 'professional skills', 'soft skills'], maxWords: 600 } },
    },
    {
      goal: 'Show the drafted summary resume to the human and pause until they accept it; nothing is written out before that acceptance.', primitives: [], reads: ['resume-summary'], emits: 'resume-summary-approved', fromLine: 4, close: { class: 'hitl' },
    },
    {
      goal: 'Do a quick pass afterward to double-check nothing changed.', primitives: [], reads: [], emits: 'post-accept-check', fromLine: 5, close: { class: 'softgreen', shape: {} },
    },
    {
      goal: 'Write the human-accepted summary resume out to a file.', primitives: ['write'], reads: ['resume-summary', 'resume-summary-approved'], emits: 'resume-summary-output', fromLine: 6, close: { class: 'hitl' },
    },
  ],
};

function writeTestFlow(root, name = 'job2r4') {
  const result = writeFlow({
    root, name, proseText: PROSE, declaration: DECLARATION, signedBy: SIGNED_BY, signedAt: SIGNED_AT, catalogue: CATALOGUE,
  });
  assert.equal(result.ok, true, result.ok ? '' : result.reds.join('\n'));
  return result;
}

function writeTempDocxLike(dir, name, text) {
  const p = path.join(dir, name);
  writeFileSync(p, text);
  return p;
}

const ACCEPT_ASK = async () => ({ decision: 'accept' });

/** Builds the fake modelStep for this flow. `onQuickPass` runs synchronously
 *  during the intervening step's own modelStep call — strictly after the
 *  ask's accepted artifact is on disk, strictly before the send step reads
 *  it back. `quickPassCalls` counts how many times it fires (used by the
 *  resume-gate test to prove a refused resume never re-ran any step). */
function makeModelStep({ onQuickPass = () => {} } = {}) {
  let quickPassCalls = 0;
  const fn = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    if (ctx.goal.includes('quick pass afterward')) {
      quickPassCalls += 1;
      onQuickPass();
      return { ok: true, costUsd: 0.001, artifact: { text: 'checked', done: true } };
    }
    throw new Error(`unexpected goal in test fake: ${ctx.goal}`);
  };
  return { fn, calls: () => quickPassCalls };
}

const FLOW_NAME = 'job2r4';

function flowDirOf(root) {
  return path.join(root, FLOW_NAME);
}

function runDirOf(root, runId) {
  return path.join(flowDirOf(root), 'runs', runId);
}

function artifactPath(root, runId, id) {
  return path.join(runDirOf(root, runId), 'artifacts', `${id}.json`);
}

function outsideSecret(prefix) {
  const dir = tmpRoot(`${prefix}-outside`);
  const target = path.join(dir, 'secret.txt');
  writeFileSync(target, JSON.stringify({ leaked: true }));
  return target;
}

async function runToSendGate(root, { onQuickPass, captureSend } = {}) {
  writeTestFlow(root);
  const srcDir = tmpRoot('sources');
  const resume = writeTempDocxLike(srcDir, 'resume.docx', 'Resume text goes here.');
  const jd = writeTempDocxLike(srcDir, 'jd.md', 'JD text goes here.');
  const { fn: modelStep, calls } = makeModelStep({ onQuickPass });

  const result = await runFlow({
    root,
    name: 'job2r4',
    runId: 'run-1',
    sources: [{ id: 'resume', path: resume }, { id: 'jd', path: jd }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: captureSend,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });
  return { result, quickPassCalls: calls };
}

// ---------------------------------------------------------------------------
// Sanity: the untouched flow completes and ships the real accepted content.
// ---------------------------------------------------------------------------

test('F48 r4 sanity: the intervening step does not break a normal accept -> send run', async () => {
  const root = tmpRoot('sanity');
  let sentContent = null;
  let sendCalls = 0;
  const captureSend = async (target, filename, content) => {
    sendCalls += 1;
    sentContent = content;
    return { ok: true, bytes: JSON.stringify(content ?? {}).length };
  };

  const { result, quickPassCalls } = await runToSendGate(root, { captureSend });

  assert.equal(result.outcome, 'complete', result.red);
  assert.equal(quickPassCalls(), 1);
  assert.equal(sendCalls, 1);
  assert.deepEqual(sentContent, result.artifacts['resume-summary-approved']);
});

// ---------------------------------------------------------------------------
// The three send-slot tamper scenarios (M4a redesign spec): after accept,
// before send, the accepted artifact is (1) deleted, (2) swapped for a
// symlink outside the run dir, (3) replaced with invalid JSON. In every
// case: the run halts red naming the artifact, the fake send is NEVER
// called (so nothing would reach a real destination), and audit.jsonl has
// no green send row.
// ---------------------------------------------------------------------------

for (const scenario of ['deleted', 'symlinked-outside', 'invalid-json']) {
  test(`F48 r4: send slot halts red when the accepted artifact is ${scenario} between accept and send`, async () => {
    const root = tmpRoot(scenario);
    let sendCalls = 0;
    const captureSend = async (target, filename, content) => {
      sendCalls += 1;
      return { ok: true, bytes: JSON.stringify(content ?? {}).length };
    };

    const tamper = () => {
      const p = artifactPath(root, 'run-1', 'resume-summary-approved');
      assert.ok(existsSync(p), `expected the accepted artifact to already be on disk at ${p}`);
      if (scenario === 'deleted') {
        unlinkSync(p);
      } else if (scenario === 'symlinked-outside') {
        const target = outsideSecret(scenario);
        unlinkSync(p);
        symlinkSync(target, p);
      } else if (scenario === 'invalid-json') {
        writeFileSync(p, '{ not valid json');
      }
    };

    const { result } = await runToSendGate(root, { onQuickPass: tamper, captureSend });

    assert.notEqual(result.outcome, 'complete', 'a tampered accepted artifact must never let the run complete');
    assert.match(result.red, /send:.*resume-summary-approved/, `expected the halt to name the artifact, got: ${result.red}`);
    assert.equal(sendCalls, 0, 'sendStep must never be called once the accepted artifact read is refused');

    const runDir = runDirOf(root, 'run-1');
    const auditRows = readAudit(runDir);
    const sendRows = auditRows.filter((row) => row.step?.goal?.includes('Write the human-accepted'));
    assert.equal(sendRows.length, 0, `no send-step audit row (green or otherwise) may exist — got ${JSON.stringify(sendRows)}`);
  });
}

// ---------------------------------------------------------------------------
// The resume-time "was this step already done" gate: a symlinked EARLIER
// artifact (the draft, already written before the ask ever parked) must
// refuse the resume by name, never silently treat the refused read as
// "not done yet" and re-run the step (which could re-spend money or
// re-park a human ask).
// ---------------------------------------------------------------------------

test('F48 r4: resume refuses by name on a symlinked earlier artifact, never silently re-runs it', async () => {
  const root = tmpRoot('resume-gate');
  writeTestFlow(root);
  const srcDir = tmpRoot('resume-gate-sources');
  const resume = writeTempDocxLike(srcDir, 'resume.docx', 'Resume text goes here.');
  const jd = writeTempDocxLike(srcDir, 'jd.md', 'JD text goes here.');

  let draftCalls = 0;
  let quickPassCalls = 0;
  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      draftCalls += 1;
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    if (ctx.goal.includes('quick pass afterward')) {
      quickPassCalls += 1;
      return { ok: true, costUsd: 0.001, artifact: { text: 'checked', done: true } };
    }
    throw new Error(`unexpected goal in test fake: ${ctx.goal}`);
  };

  const runId = 'run-1';
  const parked = await runFlow({
    root,
    name: 'job2r4',
    runId,
    sources: [{ id: 'resume', path: resume }, { id: 'jd', path: jd }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: makeParkingAskStep(),
    sendStep: async () => ({ ok: true, bytes: 1 }),
    primitives: {},
    businessDate: BUSINESS_DATE,
  });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.ok(parked.askId);
  assert.equal(draftCalls, 1);

  const auditRowsBefore = readAudit(parked.runDir).length;

  // The draft artifact (an EARLIER step than the parked ask, at
  // state.stepIndex - 1) is already on disk — swap it for a symlink to an
  // outside secret. `resumeRun`'s "was this step already done" gate must
  // refuse this by name BEFORE the answer is even consumed.
  const draftPath = artifactPath(root, runId, 'resume-summary');
  assert.ok(existsSync(draftPath));
  const outside = outsideSecret('resume-gate');
  unlinkSync(draftPath);
  symlinkSync(outside, draftPath);

  const ans = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'accept' });
  assert.equal(ans.ok, true, ans.ok ? '' : ans.red);

  const resumed = await resumeRun({
    root,
    name: 'job2r4',
    runId,
    catalogue: CATALOGUE,
    modelStep,
    sendStep: async () => ({ ok: true, bytes: 1 }),
    primitives: {},
    businessDate: BUSINESS_DATE,
  });

  assert.equal(resumed.outcome, 'refused', 'a symlinked earlier artifact must refuse the resume, never silently redo it');
  assert.match(resumed.red, /resume-summary/, `expected the refusal to name "resume-summary", got: ${resumed.red}`);
  assert.match(resumed.red, /refusing rather than treating a refused read as "not done"/, `expected the "never redo a refused read" reasoning in the refusal, got: ${resumed.red}`);

  // No new model call at all (neither a re-run of the draft nor an
  // advance into the intervening step) and no new audit row — the refusal
  // happens before any step runs again.
  assert.equal(draftCalls, 1, 'the draft step must not be re-run just because its artifact read was refused');
  assert.equal(quickPassCalls, 0, 'the fold must never advance past the refused gate');
  assert.equal(readAudit(parked.runDir).length, auditRowsBefore, 'a refused resume writes no new audit row');
});
