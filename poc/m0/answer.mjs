#!/usr/bin/env node
// Runs as a SEPARATE process from the runner, per the M0 brief: writes
// answer.json for a paused `ask`. Usage:
//   node poc/m0/answer.mjs <runId> accept|rerun "<words>"

import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [, , runId, decision, text] = process.argv;

if (!runId || !['accept', 'rerun'].includes(decision)) {
  console.error('usage: node poc/m0/answer.mjs <runId> accept|rerun "<words>"');
  process.exit(1);
}
if (decision === 'rerun' && !text) {
  console.error('rerun requires the human\'s words: node poc/m0/answer.mjs <runId> rerun "<words>"');
  process.exit(1);
}

const outDir = join(process.cwd(), 'poc', 'm0', 'out', runId);
mkdirSync(outDir, { recursive: true });
const answerPath = join(outDir, 'answer.json');
writeFileSync(answerPath, JSON.stringify({ decision, text: text ?? null, answeredAt: new Date().toISOString() }, null, 2));
console.log(`wrote ${answerPath}`);
