// The mechanical (no-model) step kinds: `gather`, `ask`, `send`. PRD §5 kind
// table — gather/ask/send have no LLM in the loop at all, so this file is
// tested with node --test and zero network calls.
//
// borrowed-from: bareloop src/kinds.js@c661d3d (runHumanConfirms, ~line 1606) —
// the pause/answer shape: a pause costs nothing and renders no verdict; the
// checkpoint stores the door taken + exact words, never the question.

import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { parseCsv } from './csv.mjs';
import { hashFile } from './close.mjs';

/** `gather`: read a file into a typed, hashed artifact. Effect check: non-empty, source hash recorded. */
export function gather(id, path, kind) {
  const sha256 = hashFile(path);
  if (kind === 'csv') {
    const text = readFileSync(path, 'utf8');
    const { header, rows } = parseCsv(text);
    if (rows.length === 0) throw new Error(`gather ${id}: artifact is empty (${path})`);
    return { id, kind: 'csv', path, sha256, header, rows };
  }
  if (kind === 'text') {
    const text = readFileSync(path, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (lines.length === 0) throw new Error(`gather ${id}: artifact is empty (${path})`);
    return { id, kind: 'text', path, sha256, lines };
  }
  throw new Error(`gather ${id}: unknown kind "${kind}"`);
}

const ASK_TIMEOUT_MS = 120_000;
const ASK_POLL_MS = 500;

/**
 * `ask`: write ask.json, then poll for answer.json written by a SEPARATE
 * process (poc/m0/answer.mjs). Timeout -> red "ask expired". Consumes no
 * allowance, spends nothing while paused (PRD §5 "Ask").
 */
export async function ask(runId, question, evidence, opts = {}) {
  const outDir = opts.outDir ?? join(process.cwd(), 'poc', 'm0', 'out', runId);
  const timeoutMs = opts.timeoutMs ?? ASK_TIMEOUT_MS;
  const pollMs = opts.pollMs ?? ASK_POLL_MS;
  mkdirSync(outDir, { recursive: true });
  const askPath = join(outDir, 'ask.json');
  const answerPath = join(outDir, 'answer.json');
  writeFileSync(askPath, JSON.stringify({ question, evidence, askedAt: new Date().toISOString() }, null, 2));

  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (existsSync(answerPath)) {
      const answer = JSON.parse(readFileSync(answerPath, 'utf8'));
      return { verdict: answer.decision === 'accept' ? 'green' : 'red', answer };
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return { verdict: 'red', red: 'ask expired', answer: null };
}

const ALLOWED_TARGETS = ['file:poc/m0/out'];

/**
 * `send`: egress. Requires a prior accept THIS run and a target inside the
 * signed allow-list (PRD §5: "target ∈ signed allow-list; prior `ask` accept
 * this run"). Writes the file and returns its path as the delivery id.
 */
export function send(runId, target, content, { acceptedThisRun, outDir } = {}) {
  if (!acceptedThisRun) throw new Error('send: no prior accept in this run');
  if (!ALLOWED_TARGETS.includes(target)) throw new Error(`send: target "${target}" is not in the signed allow-list (${ALLOWED_TARGETS.join(',')})`);
  const dir = outDir ?? join(process.cwd(), 'poc', 'm0', 'out', runId);
  mkdirSync(dir, { recursive: true });
  const deliveryPath = join(dir, 'sent.txt');
  writeFileSync(deliveryPath, content);
  return { deliveryId: deliveryPath };
}
