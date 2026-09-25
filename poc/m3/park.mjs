#!/usr/bin/env node
// poc/m3/park.mjs — M3 POC harness (docs/wiki/the-module-ladder.md, "M3 —
// scope, exit, negative — SIGNED"). Proves or kills the assumption: "a run
// can die at the ask and come back exactly as it was."
//
// $0 only: fake model steps, no provider, no network, no key. Reuses src/
// pieces (readFlow, freezeInputs, writeArtifact, readArtifact, appendAudit)
// instead of re-inventing them — src/ itself is untouched. This is a
// throwaway harness around job #2's fixture flow, not a real resume design;
// it does NOT wire through a modified runFlow (not required by the brief).
//
// Three verbs, each a separate OS process when driven by poc/m3/loop.mjs:
//   run    <flags>            — runs job #2's fixture up to its signed ask,
//                                writes ask.json + state.json, EXITS.
//   answer <runDir> <askId> accept|reject "<reason>"
//                                — writes answer.json once.
//   resume <runDir> [--broken=<variant>]
//                                — takes an exclusive lock, re-verifies,
//                                consumes the answer once, continues.
//
// --broken=<variant> (park.mjs's own proof the bar CAN fail, AGENT_RULES
// "the test must be able to fail"):
//   rerun-from-start — resume ignores stepIndex, re-runs every pre-ask step.
//   no-lock          — resume skips the exclusive lock entirely, and sleeps
//                       50ms right after the (skipped) lock point to widen
//                       the race window on purpose — ONLY in this variant.
//   no-input-check   — resume skips the frozen-input sha256 re-check.

import {
  existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync,
  renameSync, openSync, closeSync, unlinkSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { readFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';
import {
  freezeInputs, writeArtifact, readArtifact,
} from '../../src/runner.js';
import { appendAudit } from '../../src/books.js';

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

class ParkError extends Error {}

function fail(cmd, msg) {
  throw new ParkError(`${cmd}: ${msg}`);
}

function camel(key) {
  return key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
}

function parseFlags(args) {
  const out = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a.startsWith('--')) {
      const key = camel(a.slice(2));
      const next = args[i + 1];
      if (next !== undefined && !next.startsWith('--')) {
        out[key] = next;
        i += 1;
      } else {
        out[key] = true;
      }
    }
  }
  return out;
}

function loadCatalogueOrThrow(cmd) {
  const loaded = loadCatalogue();
  if (!loaded.ok) fail(cmd, `catalogue failed to load: ${loaded.reds.join('; ')}`);
  return loaded.primitives;
}

// ---------------------------------------------------------------------------
// job #2's canned model steps — one call per step, keyed by `emits` (the
// same canned artifacts test/runner.test.js's job2 fake modelStep produces,
// keyed there by ctx.goal substring instead; same output either way). Every
// call appends one line to `calls.log` in the run dir so a call count
// survives process death.
// ---------------------------------------------------------------------------

// NB: `done` is stripped here (never stored) to match src/runner.js's own
// `stripDoneBlocker` — the real runFlow's artifacts on disk never carry it
// either, and loop.mjs compares byte-for-byte against a real runFlow
// reference run.
async function fakeModelStep(step, runDir) {
  appendFileSync(join(runDir, 'calls.log'), `${step.emits}\n`);
  switch (step.emits) {
    case 'resume-text':
      return { artifact: { text: 'resume text' } };
    case 'jd-text':
      return { artifact: { text: 'jd text' } };
    case 'resume-summary': {
      const text = '## summary of work history blurb\nworked places.\n'
        + '## professional skills\nskills.\n'
        + '## soft skills\nsoft skills.';
      return { artifact: { text } };
    }
    default:
      throw new Error(`fakeModelStep: no canned output for step "${step.emits}"`);
  }
}

// ---------------------------------------------------------------------------
// run — up to the signed ask, then exit.
// ---------------------------------------------------------------------------

async function cmdRun(flags) {
  const {
    flowRoot, flowName, runDir, resumeSource, jdSource, runId = 'run-1',
  } = flags;
  if (!flowRoot || !flowName || !runDir || !resumeSource || !jdSource) {
    fail('run', 'usage: run --flow-root <dir> --flow-name <name> --run-dir <dir> --resume-source <path> --jd-source <path>');
  }

  const catalogue = loadCatalogueOrThrow('run');
  const read = readFlow({ root: flowRoot, name: flowName, catalogue });
  if (!read.ok) fail('run', `flow read failed: ${read.reds.join('; ')}`);
  const { declaration, signature, arbiter } = read;

  mkdirSync(runDir, { recursive: true });
  const frozen = freezeInputs(runDir, [
    { id: 'resume', path: resumeSource },
    { id: 'jd', path: jdSource },
  ]);
  if (!frozen.ok) fail('run', `freeze failed: ${frozen.red}`);

  const askLines = new Map((arbiter.asks ?? []).map((a) => [a.line, a]));
  const steps = declaration.steps;

  for (let i = 0; i < steps.length; i += 1) {
    const step = steps[i];

    if (askLines.has(step.fromLine)) {
      // --- park: write ask.json + state.json, audit "paused", EXIT. ---
      const askSlot = askLines.get(step.fromLine);
      const askId = randomUUID();
      const askedAt = new Date().toISOString();
      const ttlMs = askSlot.ttlMs;
      const expiresAt = new Date(Date.now() + ttlMs).toISOString();

      writeFileSync(join(runDir, 'ask.json'), JSON.stringify({
        askId, question: askSlot.question ?? step.goal, askedAt, expiresAt,
      }, null, 2));
      appendFileSync(join(runDir, 'askWrites.log'), `${askId}\n`);

      const state = {
        runId,
        flow: { root: flowRoot, name: flowName },
        signatureHash: signature.flow,
        inputsManifest: frozen.manifest,
        stepIndex: i,
        askId,
        expiresAt,
        spent: 0,
        redone: 0,
      };
      writeFileSync(join(runDir, 'state.json'), JSON.stringify(state, null, 2));

      appendAudit(runDir, {
        step: step.goal, attempt: 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      });

      // The process EXITS — no polling, no lingering handle.
      process.exit(0);
    }

    // ordinary pre-ask step
    // eslint-disable-next-line no-await-in-loop
    const result = await fakeModelStep(step, runDir);
    writeArtifact(runDir, step.emits, result.artifact);
  }

  fail('run', 'reached end of declaration.steps with no signed ask — job #2 fixture assumption violated');
}

// ---------------------------------------------------------------------------
// answer — writes answer.json exactly once.
// ---------------------------------------------------------------------------

async function cmdAnswer(rest) {
  const [runDir, askId, decision, reason] = rest;
  if (!runDir || !askId || !decision) {
    fail('answer', 'usage: answer <runDir> <askId> accept|reject "<reason>"');
  }
  if (decision !== 'accept' && decision !== 'reject') {
    fail('answer', `unrecognised decision "${decision}"`);
  }

  const askPath = join(runDir, 'ask.json');
  if (!existsSync(askPath)) fail('answer', `no open ask for run ${runDir}`);
  const ask = JSON.parse(readFileSync(askPath, 'utf8'));
  if (ask.askId !== askId) fail('answer', `askId "${askId}" is unknown for run ${runDir}`);
  if (Date.now() > Date.parse(ask.expiresAt)) {
    fail('answer', `askId "${askId}" expired at ${ask.expiresAt} for run ${runDir}`);
  }

  const answerPath = join(runDir, 'answer.json');
  if (existsSync(answerPath)) fail('answer', `askId "${askId}" already answered for run ${runDir}`);
  if (existsSync(join(runDir, `answer.${askId}.consumed.json`))) {
    fail('answer', `askId "${askId}" already answered for run ${runDir}`);
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if (decision === 'reject' && trimmedReason.length === 0) {
    fail('answer', `askId "${askId}" needs a non-blank reason to reject`);
  }

  writeFileSync(answerPath, JSON.stringify({
    askId, decision, reason: trimmedReason.length > 0 ? trimmedReason : undefined, answeredAt: new Date().toISOString(),
  }, null, 2));
}

// ---------------------------------------------------------------------------
// resume — exclusive lock, re-verify, consume answer once, continue.
// ---------------------------------------------------------------------------

async function cmdResume(rest) {
  const runDir = rest[0];
  if (!runDir) fail('resume', 'usage: resume <runDir> [--broken=<variant>]');
  const brokenArg = rest.find((a) => a.startsWith('--broken='));
  const broken = brokenArg ? brokenArg.split('=')[1] : undefined;

  let haveLock = false;
  let lockFd = null;
  const lockPath = join(runDir, 'resume.lock');

  try {
    if (broken !== 'no-lock') {
      try {
        lockFd = openSync(lockPath, 'wx');
        haveLock = true;
      } catch (err) {
        if (err.code === 'EEXIST') fail('resume', `run ${runDir} is locked by another resumer`);
        throw err;
      }
    }

    const statePath = join(runDir, 'state.json');
    if (!existsSync(statePath)) fail('resume', `no parked state for run ${runDir}`);
    const state = JSON.parse(readFileSync(statePath, 'utf8'));

    const catalogue = loadCatalogueOrThrow('resume');
    const read = readFlow({ root: state.flow.root, name: state.flow.name, catalogue });
    if (!read.ok) fail('resume', `flow re-read failed for run ${runDir}: ${read.reds.join('; ')}`);

    if (read.signature.flow !== state.signatureHash) {
      fail('resume', `signature mismatch for run ${runDir} — flow changed while parked`);
    }

    if (broken !== 'no-input-check') {
      for (const entry of state.inputsManifest) {
        if (!existsSync(entry.frozen)) fail('resume', `frozen input "${entry.id}" missing for run ${runDir}`);
        const sha = sha256File(entry.frozen);
        if (sha !== entry.sha256) fail('resume', `frozen input "${entry.id}" changed while parked for run ${runDir}`);
      }
    }

    const { declaration } = read;
    const steps = declaration.steps;

    if (broken === 'rerun-from-start') {
      // BROKEN ON PURPOSE: ignores stepIndex, re-runs every pre-ask step —
      // this is exactly the fault the module ladder's "kills the module"
      // clause describes.
      for (let i = 0; i < state.stepIndex; i += 1) {
        // eslint-disable-next-line no-await-in-loop
        const result = await fakeModelStep(steps[i], runDir);
        writeArtifact(runDir, steps[i].emits, result.artifact, { overwrite: true });
      }
    } else {
      // honest: every earlier step's artifact must already be on disk —
      // never re-run it.
      for (let i = 0; i < state.stepIndex; i += 1) {
        if (readArtifact(runDir, steps[i].emits) === undefined) {
          fail('resume', `artifact "${steps[i].emits}" missing for run ${runDir} — cannot resume`);
        }
      }
    }

    const answerPath = join(runDir, 'answer.json');
    if (!existsSync(answerPath)) fail('resume', `no answer yet for run ${runDir}`);
    const answer = JSON.parse(readFileSync(answerPath, 'utf8'));
    if (answer.askId !== state.askId) {
      fail('resume', `answer askId "${answer.askId}" does not match open askId "${state.askId}" for run ${runDir}`);
    }
    const consumedPath = join(runDir, `answer.${answer.askId}.consumed.json`);

    if (broken === 'no-lock') {
      // BROKEN ON PURPOSE (no-lock): the ONE thing a resumer must do
      // atomically — decide, then commit that decision, as a single step —
      // is deliberately split apart here: read the decision, sleep (widening
      // the window on purpose, ONLY in this variant), THEN act on it, and
      // only consume (rename) the answer file at the very end, best-effort.
      // The honest path below does it the other way around: consume FIRST
      // (an atomic rename is itself a one-winner gate, on top of the lock),
      // so acting on an already-consumed answer is structurally impossible.
      await sleep(50);
    } else {
      renameSync(answerPath, consumedPath);
    }

    if (Date.now() > Date.parse(state.expiresAt)) {
      appendAudit(runDir, {
        step: null, attempt: null, class: null, verdict: 'ask-expired', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      });
      writeFileSync(join(runDir, 'outcome.json'), JSON.stringify({ outcome: 'ask-expired' }, null, 2));
      return;
    }

    const askStep = steps[state.stepIndex];

    if (answer.decision === 'accept') {
      const priorId = askStep.reads[0];
      const priorArtifact = readArtifact(runDir, priorId);
      writeArtifact(runDir, askStep.emits, priorArtifact);
      appendAudit(runDir, {
        step: askStep.goal, attempt: state.redone + 1, class: 'hitl', verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      });

      for (let i = state.stepIndex + 1; i < steps.length; i += 1) {
        const step = steps[i];
        const readsFromAsk = (step.reads ?? []).filter((id) => id === askStep.emits);
        const content = readsFromAsk.length === 1
          ? readArtifact(runDir, readsFromAsk[0])
          : readArtifact(runDir, (step.reads ?? [])[0]);

        const sentDir = join(runDir, 'sent');
        mkdirSync(sentDir, { recursive: true });
        writeFileSync(join(sentDir, `${step.emits}.json`), JSON.stringify(content, null, 2));
        writeArtifact(runDir, step.emits, content);
        appendAudit(runDir, {
          step: step.goal, attempt: 1, class: 'hitl', verdict: 'green', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
        });
      }

      writeFileSync(join(runDir, 'outcome.json'), JSON.stringify({ outcome: 'complete' }, null, 2));
      if (broken === 'no-lock') {
        // Consume only now, having already acted — the corruption this
        // variant demonstrates already happened above if a second racer
        // got here too; this rename is best-effort and may already be gone.
        try { renameSync(answerPath, consumedPath); } catch { /* raced away */ }
      }
    } else if (answer.decision === 'reject') {
      const reason = answer.reason;
      const redone = (state.redone ?? 0) + 1;
      const priorId = askStep.reads[0];
      const priorStepIndex = steps.findIndex((s) => s.emits === priorId);
      const priorStep = steps[priorStepIndex];

      const result = await fakeModelStep(priorStep, runDir);
      writeArtifact(runDir, priorId, result.artifact, { overwrite: true });
      appendAudit(runDir, {
        step: priorStep.goal, attempt: redone, class: null, verdict: 'red', gap: reason, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      });

      // re-park under a NEW askId — the old askId is dead, never reused.
      const askSlot = { question: askStep.goal, ttlMs: 30 * 60 * 1000 };
      const newAskId = randomUUID();
      const askedAt = new Date().toISOString();
      const expiresAt = new Date(Date.now() + askSlot.ttlMs).toISOString();
      writeFileSync(join(runDir, 'ask.json'), JSON.stringify({
        askId: newAskId, question: askSlot.question, askedAt, expiresAt,
      }, null, 2));
      appendFileSync(join(runDir, 'askWrites.log'), `${newAskId}\n`);

      const newState = {
        ...state, askId: newAskId, expiresAt, redone,
      };
      writeFileSync(join(runDir, 'state.json'), JSON.stringify(newState, null, 2));
      appendAudit(runDir, {
        step: askStep.goal, attempt: redone + 1, class: 'hitl', verdict: 'paused', gap: null, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
      });
    } else {
      fail('resume', `unrecognised decision "${answer.decision}" for run ${runDir}`);
    }
  } finally {
    if (haveLock) {
      try { closeSync(lockFd); } catch { /* already closed */ }
      try { unlinkSync(lockPath); } catch { /* already gone */ }
    }
  }
}

// ---------------------------------------------------------------------------

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === 'run') await cmdRun(parseFlags(rest));
    else if (cmd === 'answer') await cmdAnswer(rest);
    else if (cmd === 'resume') await cmdResume(rest);
    else fail('park', `unknown command "${cmd}" — expected run|answer|resume`);
  } catch (err) {
    process.stderr.write(`${err.message}\n`);
    process.exitCode = 1;
  }
}

main();
