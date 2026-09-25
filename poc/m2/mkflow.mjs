#!/usr/bin/env node
// M2 piece 2 driver (NOT shipped — poc/ is excluded from the package):
// writes a signed job #2 flow from test/fixtures/job2.m1.* via `writeFlow`
// (src/'s one writer), substituting the two `source resume = file:...` /
// `source jd = file:...` lines with the real files the caller names, so a
// live run can freeze REAL bytes instead of the fixture's placeholder
// paths under someone else's home directory.
//
// Usage:
//   node poc/m2/mkflow.mjs --job job2 --root <flowsRoot> --name <name> \
//     --resume <path-to-docx> --jd <path-to-md>

import { readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { writeFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(HERE, '..', '..');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const value = argv[i + 1];
      out[key] = value;
      i += 1;
    }
  }
  return out;
}

function substituteSourceLine(proseText, role, absolutePath) {
  const linePattern = new RegExp(`^guardrail: source ${role} = file:.*$`, 'm');
  if (!linePattern.test(proseText)) {
    throw new Error(`mkflow: prose has no "guardrail: source ${role} = file:..." line to substitute`);
  }
  return proseText.replace(linePattern, `guardrail: source ${role} = file:${absolutePath}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const job = args.job ?? 'job2';
  if (job !== 'job2') {
    throw new Error(`mkflow: only "job2" is wired today, got "${job}"`);
  }
  for (const required of ['root', 'name', 'resume', 'jd']) {
    if (!args[required]) throw new Error(`mkflow: --${required} is required`);
  }

  const root = resolve(args.root);
  const resumePath = resolve(args.resume);
  const jdPath = resolve(args.jd);

  const fixturesDir = join(REPO_ROOT, 'test', 'fixtures');
  let proseText = readFileSync(join(fixturesDir, 'job2-with-sources.signed.txt'), 'utf8');
  proseText = substituteSourceLine(proseText, 'resume', resumePath);
  proseText = substituteSourceLine(proseText, 'jd', jdPath);
  const declaration = JSON.parse(readFileSync(join(fixturesDir, 'job2.m1.declaration.json'), 'utf8'));

  const loaded = loadCatalogue();
  if (!loaded.ok) throw new Error(`mkflow: catalogue is invalid — ${loaded.reds.join('; ')}`);

  const result = writeFlow({
    root,
    name: args.name,
    proseText,
    declaration,
    signedBy: 'hamr',
    signedAt: new Date().toISOString(),
    catalogue: loaded.primitives,
  });

  if (!result.ok) {
    process.stderr.write(`mkflow: refused — ${result.reds.join('; ')}\n`);
    process.exit(1);
  }
  process.stdout.write(`mkflow: wrote ${result.dir}\n`);
}

main().catch((err) => {
  process.stderr.write(`mkflow: ${err.message}\n`);
  process.exit(1);
});
