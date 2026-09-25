#!/usr/bin/env node
// M2 piece 2 driver (NOT shipped — poc/ is excluded from the package):
// runs an already-signed flow through `runFlow` with the LIVE pieces
// (`makeLiveModelStep`, `makeFileAskStep`, `sendViaPrimitive`) against a
// real provider slot. Refuses an existing run dir (never silently reuses
// one). Prints one line per audit row as it lands (polling audit.jsonl —
// `runFlow` has no callback seam today, and tailing its own append-only
// book is simpler than adding one) and the final history row.
//
// Usage:
//   node poc/m2/live.mjs --flow <name> --root <flowsRoot> --run-id <id> \
//     --slot deepseek [--model <id>] [--ask-timeout 600000]

import {
  existsSync, readFileSync, mkdirSync,
} from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { readFlow, checkFlowName } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';
import { runFlow, checkFreshRunDir } from '../../src/runner.js';
import { makeLiveModelStep } from '../../src/model-step.js';
import { makeFileAskStep } from '../../src/ask.js';
import { sendViaPrimitive } from '../../src/send.js';
import { resolvePrimitives } from '../../src/primitives.js';
import { checkKeyPreflight } from '../../src/provider.js';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      out[argv[i].slice(2)] = argv[i + 1];
      i += 1;
    }
  }
  return out;
}

async function tailAuditRows(runDir, isDone) {
  let printed = 0;
  const auditPath = join(runDir, 'audit.jsonl');
  while (!isDone.value) {
    if (existsSync(auditPath)) {
      const lines = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
      for (let i = printed; i < lines.length; i += 1) {
        process.stdout.write(`audit: ${lines[i]}\n`);
      }
      printed = lines.length;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => { setTimeout(r, 250); });
  }
  // Final drain after the run settles, in case rows landed between the last
  // poll and completion.
  if (existsSync(auditPath)) {
    const lines = readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean);
    for (let i = printed; i < lines.length; i += 1) {
      process.stdout.write(`audit: ${lines[i]}\n`);
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  for (const required of ['flow', 'root', 'run-id', 'slot']) {
    if (!args[required]) throw new Error(`live: --${required} is required`);
  }

  const root = resolve(args.root);
  const name = args.flow;
  const runId = args['run-id'];
  const slot = args.slot;
  const model = args.model;
  const askTimeoutMs = args['ask-timeout'] ? Number(args['ask-timeout']) : 600_000;

  const nameCheck = checkFlowName(name);
  if (!nameCheck.ok) throw new Error(nameCheck.red);

  const keyCheck = checkKeyPreflight(slot);
  if (!keyCheck.ok) throw new Error(keyCheck.message);

  const loaded = loadCatalogue();
  if (!loaded.ok) throw new Error(`live: catalogue is invalid — ${loaded.reds.join('; ')}`);
  const catalogue = loaded.primitives;

  const read = readFlow({ root, name, catalogue });
  if (!read.ok) throw new Error(`live: flow refused — ${read.reds.join('; ')}`);
  const { arbiter, declaration } = read;

  const runDir = join(root, name, 'runs', runId);
  const fresh = checkFreshRunDir(runDir);
  if (!fresh.ok) throw new Error(fresh.red);
  if (existsSync(runDir)) throw new Error(`live: run dir "${runDir}" already exists — use a new --run-id`);

  const sources = (arbiter.sources ?? []).map((s) => ({ id: s.role, path: s.path }));
  for (const src of sources) {
    if (!existsSync(src.path)) throw new Error(`live: source "${src.id}" is unreadable at ${src.path}`);
  }

  // Predict the frozen paths `runFlow`'s own `freezeInputs` will write to —
  // deterministic (`<runDir>/inputs/<id><ext>`), so the primitives map can
  // be built once, before `runFlow` itself freezes anything.
  mkdirSync(join(runDir, 'inputs'), { recursive: true });
  const predictedInputs = sources.map((s) => ({ id: s.id, frozen: join(runDir, 'inputs', `${s.id}${extname(s.path)}`) }));

  const allVerbs = [...new Set(declaration.steps.flatMap((s) => s.primitives ?? []))];
  const { tools: primitives, reds: primitiveReds } = resolvePrimitives(catalogue, allVerbs, { runDir, inputs: predictedInputs });
  for (const red of primitiveReds) process.stderr.write(`live: ${red}\n`);

  const spendPath = join(runDir, 'spend.jsonl');
  const modelStep = makeLiveModelStep({ slot, model, spendPath });
  const askStep = makeFileAskStep({
    timeoutMs: askTimeoutMs,
    writeLine: (line) => process.stdout.write(`${line}\n`),
  });
  const sendStep = sendViaPrimitive;

  const isDone = { value: false };
  const tailPromise = tailAuditRows(runDir, isDone);

  const result = await runFlow({
    root,
    name,
    runId,
    sources,
    catalogue,
    modelStep,
    askStep,
    sendStep,
    primitives,
    businessDate: new Date().toISOString().slice(0, 10),
  });
  isDone.value = true;
  await tailPromise;

  const historyPath = join(root, name, 'history.jsonl');
  if (existsSync(historyPath)) {
    const lines = readFileSync(historyPath, 'utf8').trim().split('\n').filter(Boolean);
    process.stdout.write(`history: ${lines[lines.length - 1]}\n`);
  }

  process.stdout.write(`live: outcome=${result.outcome}${result.red ? ` red=${JSON.stringify(result.red)}` : ''}\n`);
  if (result.outcome !== 'complete') process.exitCode = 1;
}

main().catch((err) => {
  process.stderr.write(`live: ${err.message}\n`);
  process.exit(1);
});
