#!/usr/bin/env node
// poc/m3/loop.mjs — the 20-loop driver for the M3 POC (docs/wiki/
// the-module-ladder.md, "M3 — scope, exit, negative — SIGNED", "POC first").
// $0 only. Every run happens under a mkdtempSync temp dir, cleaned up after.
//
// Usage:
//   node poc/m3/loop.mjs                       — the honest run (bar: 20/20)
//   node poc/m3/loop.mjs --broken=<variant>     — proves the bar CAN fail
//     variants: rerun-from-start | no-lock | no-input-check
//
// Loops 1-5   : two resumers race at once — exactly one must proceed.
// Loops 6-10  : a frozen input is edited while parked — resume must refuse.
// Loops 11-20 : plain park/answer/resume; loops 11, 12, 13 reject once
//               (redo + re-park) before the final accept.

import { spawn, spawnSync } from 'node:child_process';
import {
  mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { runFlow, readArtifact } from '../../src/runner.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(HERE, '..', '..');
const PARK = join(HERE, 'park.mjs');
const FIXTURES = join(REPO_ROOT, 'test', 'fixtures');

const brokenFlagArg = process.argv.find((a) => a.startsWith('--broken='));
const BROKEN = brokenFlagArg ? brokenFlagArg.split('=')[1] : undefined;

const catalogueLoaded = loadCatalogue();
if (!catalogueLoaded.ok) {
  process.stderr.write(`catalogue failed to load: ${catalogueLoaded.reds.join('; ')}\n`);
  process.exit(1);
}
const CATALOGUE = catalogueLoaded.primitives;
const SIGNED_BY = 'hamr';
const SIGNED_AT = '2026-09-24T12:00:00Z';
const BUSINESS_DATE = '2026-06-01';

function fixture(name) { return readFileSync(join(FIXTURES, name), 'utf8'); }
function fixtureJson(name) { return JSON.parse(fixture(name)); }

function writeJob2FlowAt(root, name) {
  const result = writeFlow({
    root,
    name,
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: fixtureJson('job2.m1.declaration.json'),
    signedBy: SIGNED_BY,
    signedAt: SIGNED_AT,
    catalogue: CATALOGUE,
  });
  if (!result.ok) throw new Error(`writeJob2Flow(${name}) failed: ${result.reds.join('; ')}`);
  return result;
}

function writeSources(dir) {
  mkdirSync(dir, { recursive: true });
  const resume = join(dir, 'resume.docx');
  const jd = join(dir, 'jd.md');
  writeFileSync(resume, 'Resume text goes here.');
  writeFileSync(jd, 'JD text goes here.');
  return { resume, jd };
}

// ---------------------------------------------------------------------------
// The in-process reference run — same canned artifacts as park.mjs's
// fakeModelStep, run through the REAL runFlow with an immediate accept, so
// "did the parked/resumed run finish with the same artifacts?" has ground
// truth to compare against.
// ---------------------------------------------------------------------------

async function computeReferenceArtifacts(tmpRoot) {
  const refRoot = join(tmpRoot, 'flows-ref');
  writeJob2FlowAt(refRoot, 'job2-ref');
  const { resume, jd } = writeSources(join(tmpRoot, 'sources-ref'));

  const modelStep = async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
    }
    throw new Error(`unexpected job2 goal: ${ctx.goal}`);
  };
  const ACCEPT_ASK = async () => ({ decision: 'accept' });
  const NOOP_SEND = async (target, filename, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });

  const result = await runFlow({
    root: refRoot,
    name: 'job2-ref',
    runId: 'run-1',
    sources: [{ id: 'resume', path: resume }, { id: 'jd', path: jd }],
    catalogue: CATALOGUE,
    modelStep,
    askStep: ACCEPT_ASK,
    sendStep: NOOP_SEND,
    primitives: {},
    businessDate: BUSINESS_DATE,
  });
  if (result.outcome !== 'complete') throw new Error(`reference run did not complete: ${result.red}`);
  return result.artifacts;
}

// ---------------------------------------------------------------------------
// Process helpers.
// ---------------------------------------------------------------------------

function spawnPark(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [PARK, ...args]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.on('close', (code) => resolve({
      code, stdout, stderr, child,
    }));
  });
}

function runSync(args) {
  return spawnSync(process.execPath, [PARK, ...args], { encoding: 'utf8' });
}

function callCounts(runDir) {
  const p = join(runDir, 'calls.log');
  if (!existsSync(p)) return {};
  const lines = readFileSync(p, 'utf8').split('\n').filter(Boolean);
  const counts = {};
  for (const line of lines) counts[line] = (counts[line] ?? 0) + 1;
  return counts;
}

function askWriteIds(runDir) {
  const p = join(runDir, 'askWrites.log');
  if (!existsSync(p)) return [];
  return readFileSync(p, 'utf8').split('\n').filter(Boolean);
}

function assertNoDuplicates(list, label) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item)) throw new Error(`${label}: "${item}" appears more than once`);
    seen.add(item);
  }
}

function assertArtifactsMatchReference(runDir, reference, emitsList) {
  for (const emits of emitsList) {
    const actual = readArtifact(runDir, emits);
    const expected = reference[emits];
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(`artifact "${emits}" does not match the reference run — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
    }
  }
}

const EMITS_ORDER = ['resume-text', 'jd-text', 'resume-summary', 'resume-summary-approved', 'resume-summary-output'];

// ---------------------------------------------------------------------------
// One loop.
// ---------------------------------------------------------------------------

async function runLoop(i, { tmpRoot, reference }) {
  const flowsRoot = join(tmpRoot, 'flows');
  const flowName = `job2-loop-${i}`;
  writeJob2FlowAt(flowsRoot, flowName);
  const { resume, jd } = writeSources(join(tmpRoot, `sources-${i}`));
  const runDir = join(flowsRoot, flowName, 'runs', 'run-1');

  const resumeFlag = BROKEN ? [`--broken=${BROKEN}`] : [];

  // --- start the run as a real child process; it parks and exits itself. ---
  const runResult = await spawnPark([
    'run', '--flow-root', flowsRoot, '--flow-name', flowName, '--run-dir', runDir,
    '--resume-source', resume, '--jd-source', jd,
  ]);
  if (runResult.code !== 0) throw new Error(`run child exited ${runResult.code}: ${runResult.stderr.trim()}`);

  // --- SIGKILL whatever is left; assert there is nothing to kill. ---
  const killed = runResult.child.kill('SIGKILL');
  if (killed) throw new Error('run child was still alive after it should have parked and exited on its own');

  if (!existsSync(join(runDir, 'ask.json'))) throw new Error('run child exited without writing ask.json');
  const preAskCalls = callCounts(runDir);
  for (const emits of ['resume-text', 'jd-text', 'resume-summary']) {
    if (preAskCalls[emits] !== 1) throw new Error(`pre-ask step "${emits}" called ${preAskCalls[emits] ?? 0} times, expected 1`);
  }

  const isRace = i >= 1 && i <= 5;
  const isTamper = i >= 6 && i <= 10;
  const doesRejectFirst = i === 11 || i === 12 || i === 13;

  if (isTamper) {
    const inputsManifest = JSON.parse(readFileSync(join(runDir, 'inputs.json'), 'utf8'));
    const tamperId = i % 2 === 0 ? 'jd' : 'resume';
    const entry = inputsManifest.find((e) => e.id === tamperId);
    appendFileSync(entry.frozen, '\nTAMPERED WHILE PARKED\n');

    const { askId } = JSON.parse(readFileSync(join(runDir, 'ask.json'), 'utf8'));
    const answer = runSync(['answer', runDir, askId, 'accept']);
    if (answer.status !== 0) throw new Error(`answer failed unexpectedly: ${answer.stderr}`);

    const resumeResult = runSync(['resume', runDir, ...resumeFlag]);
    if (BROKEN === 'no-input-check') {
      if (resumeResult.status !== 0) {
        return { pass: false, reason: `expected --broken=no-input-check to WRONGLY succeed on a tampered input, but resume refused: ${resumeResult.stderr.trim()}` };
      }
      return { pass: false, reason: `--broken=no-input-check let a tampered input ("${tamperId}") through resume undetected — the fault it is meant to demonstrate` };
    }
    if (resumeResult.status === 0) {
      return { pass: false, reason: `resume should have refused the tampered input "${tamperId}" but exited 0` };
    }
    if (!resumeResult.stderr.includes(tamperId) || !resumeResult.stderr.includes('changed while parked')) {
      return { pass: false, reason: `resume refused but did not name the tampered input "${tamperId}": ${resumeResult.stderr.trim()}` };
    }
    if (existsSync(join(runDir, 'sent'))) {
      return { pass: false, reason: 'resume refused the tampered input but a "sent" dir still exists' };
    }
    return { pass: true, reason: `tampered input "${tamperId}" refused by name, $0, nothing sent` };
  }

  if (isRace) {
    const { askId } = JSON.parse(readFileSync(join(runDir, 'ask.json'), 'utf8'));
    const answer = runSync(['answer', runDir, askId, 'accept']);
    if (answer.status !== 0) throw new Error(`answer failed unexpectedly: ${answer.stderr}`);

    // Two resumers spawned at the same moment, no await between.
    const p1 = spawnPark(['resume', runDir, ...resumeFlag]);
    const p2 = spawnPark(['resume', runDir, ...resumeFlag]);
    const [r1, r2] = await Promise.all([p1, p2]);
    const successes = [r1, r2].filter((r) => r.code === 0);
    const failures = [r1, r2].filter((r) => r.code !== 0);

    if (BROKEN === 'no-lock') {
      if (successes.length === 1 && failures.length === 1) {
        return { pass: true, reason: '--broken=no-lock happened not to race this time (inherently racy — reported honestly)' };
      }
      return { pass: false, reason: `--broken=no-lock: race not resolved to exactly one winner (successes=${successes.length}, failures=${failures.length}) — the fault it is meant to demonstrate` };
    }

    if (successes.length !== 1) {
      return { pass: false, reason: `expected exactly one resumer to proceed, got ${successes.length} successes (r1=${r1.code}/${r1.stderr.trim()}, r2=${r2.code}/${r2.stderr.trim()})` };
    }
    // The loser either lost the O_EXCL lock race outright ("locked by
    // another resumer") or won the lock a beat AFTER the winner already
    // finished and released it, then found nothing left to do ("no answer
    // yet" / already-consumed) — both name the run and both refuse without
    // ever re-running a step or re-consuming the answer, so both count as
    // the loser correctly refusing.
    if (!failures[0].stderr.includes(runDir)) {
      return { pass: false, reason: `the losing resumer did not refuse naming the run: ${failures[0].stderr.trim()}` };
    }
  } else if (doesRejectFirst) {
    const { askId } = JSON.parse(readFileSync(join(runDir, 'ask.json'), 'utf8'));
    const reject = runSync(['answer', runDir, askId, 'reject', 'not quite right, redo the draft']);
    if (reject.status !== 0) throw new Error(`reject answer failed: ${reject.stderr}`);
    const resumeReject = runSync(['resume', runDir, ...resumeFlag]);
    if (resumeReject.status !== 0) {
      return { pass: false, reason: `resume after reject failed: ${resumeReject.stderr.trim()}` };
    }
    if (!existsSync(join(runDir, 'ask.json'))) {
      return { pass: false, reason: 're-park after reject did not write a new ask.json' };
    }
    const secondAsk = JSON.parse(readFileSync(join(runDir, 'ask.json'), 'utf8'));
    if (secondAsk.askId === askId) {
      return { pass: false, reason: 're-park after reject reused the SAME askId' };
    }
    const accept = runSync(['answer', runDir, secondAsk.askId, 'accept']);
    if (accept.status !== 0) throw new Error(`accept after redo failed: ${accept.stderr}`);
    const resumeAccept = runSync(['resume', runDir, ...resumeFlag]);
    if (BROKEN === undefined && resumeAccept.status !== 0) {
      return { pass: false, reason: `final resume after redo+accept failed: ${resumeAccept.stderr.trim()}` };
    }
    if (BROKEN && resumeAccept.status !== 0) {
      return { pass: false, reason: `--broken=${BROKEN}: final resume after redo+accept failed: ${resumeAccept.stderr.trim()}` };
    }
  } else {
    const { askId } = JSON.parse(readFileSync(join(runDir, 'ask.json'), 'utf8'));
    const answer = runSync(['answer', runDir, askId, 'accept']);
    if (answer.status !== 0) throw new Error(`answer failed unexpectedly: ${answer.stderr}`);
    const resumeResult = runSync(['resume', runDir, ...resumeFlag]);
    if (resumeResult.status !== 0) {
      return { pass: false, reason: `resume failed: ${resumeResult.stderr.trim()}` };
    }
  }

  // --- shared post-conditions for every non-tamper loop that should have
  // reached completion. ---
  try {
    assertNoDuplicates(askWriteIds(runDir), 'ask.json write');

    const finalCalls = callCounts(runDir);
    const expectedDrafted = doesRejectFirst ? 2 : 1;
    if (finalCalls['resume-summary'] !== expectedDrafted) {
      throw new Error(`"resume-summary" step called ${finalCalls['resume-summary']} times, expected ${expectedDrafted}`);
    }
    if (finalCalls['resume-text'] !== 1) throw new Error(`"resume-text" step called ${finalCalls['resume-text']} times, expected 1`);
    if (finalCalls['jd-text'] !== 1) throw new Error(`"jd-text" step called ${finalCalls['jd-text']} times, expected 1`);

    const outcomePath = join(runDir, 'outcome.json');
    if (!existsSync(outcomePath)) throw new Error('no outcome.json — run did not reach completion');
    const outcome = JSON.parse(readFileSync(outcomePath, 'utf8'));
    if (outcome.outcome !== 'complete') throw new Error(`outcome was "${outcome.outcome}", expected "complete"`);

    assertArtifactsMatchReference(runDir, reference, EMITS_ORDER);
  } catch (err) {
    if (BROKEN === 'rerun-from-start') {
      return { pass: false, reason: `--broken=rerun-from-start: ${err.message} — the fault it is meant to demonstrate` };
    }
    throw err;
  }

  if (BROKEN === 'rerun-from-start') {
    return { pass: false, reason: '--broken=rerun-from-start: expected a call-count violation but none was observed' };
  }

  return { pass: true, reason: 'pre-ask steps once each, ask.json once, answer consumed once, artifacts match reference' };
}

// ---------------------------------------------------------------------------

async function main() {
  const tmpRoot = mkdtempSync(join(tmpdir(), 'fwdloop-m3poc-'));
  let passCount = 0;
  try {
    const reference = await computeReferenceArtifacts(tmpRoot);

    for (let i = 1; i <= 20; i += 1) {
      let result;
      try {
        // eslint-disable-next-line no-await-in-loop
        result = await runLoop(i, { tmpRoot, reference });
      } catch (err) {
        result = { pass: false, reason: err.message };
      }
      if (result.pass) passCount += 1;
      process.stdout.write(`loop ${String(i).padStart(2, '0')}: ${result.pass ? 'PASS' : 'FAIL'} — ${result.reason}\n`);
    }
  } finally {
    rmSync(tmpRoot, { recursive: true, force: true });
  }

  const label = BROKEN ? `M3 POC (broken=${BROKEN})` : 'M3 POC';
  process.stdout.write(`${label}: ${passCount}/20\n`);
  process.exitCode = passCount === 20 ? 0 : 1;
}

main();
