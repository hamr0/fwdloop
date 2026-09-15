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

// --- THE UNIVERSAL "HAPPENED" CHECK (RULED 2026-09-10, Ruling 3) ----------
//
// PRD §4: "Every step also carries a mechanical happened check, always, on
// top of its class — the artifact exists and is non-empty ... Never 'it
// ran'." This is the ONE rule with no exceptions and no judgment: does the
// step's own artifact exist as BYTES — not null/undefined, not zero bytes,
// not an empty string/array. It applies to every step, green, softgreen and
// hitl alike, because "did anything come out" is a yes/no question about
// bytes, never a question about what the words mean.
//
// This is deliberately UNLIKE the rejected `#` "generic rule" (F16/F17): the
// `#` rule needed a JUDGMENT call about WHERE it applied (it covered most
// steps — read/ask/send were exempt — and "mostly true" was exactly the
// loophole a live drafter walked through 3 runs out of 3). `happened()`
// needs no such judgment: it is the same check, unconditionally, for every
// step there is, and it reads no meaning from anyone's words — only bytes.
// That is why this generic rule is allowed to exist and the other one was
// rejected outright.
//
// One writer for this concept: `gather()` below REUSES it (replacing its
// own former inline emptiness checks) rather than carrying a second,
// drifting copy.
export function happened(artifact) {
  if (artifact === null) return { verdict: 'red', red: 'happened: artifact is null' };
  if (artifact === undefined) return { verdict: 'red', red: 'happened: artifact is undefined' };
  if (typeof artifact === 'string') {
    return artifact.length === 0
      ? { verdict: 'red', red: 'happened: artifact is an empty string' }
      : { verdict: 'green', red: null };
  }
  if (Array.isArray(artifact)) {
    return artifact.length === 0
      ? { verdict: 'red', red: 'happened: artifact is an empty array' }
      : { verdict: 'green', red: null };
  }
  if (Buffer.isBuffer(artifact) || (artifact && typeof artifact === 'object' && typeof artifact.byteLength === 'number')) {
    return artifact.byteLength === 0
      ? { verdict: 'red', red: 'happened: artifact is zero bytes' }
      : { verdict: 'green', red: null };
  }
  return { verdict: 'green', red: null };
}

/**
 * `happened()`, wrapped to make the "regardless of close class" rule
 * structural rather than a promise in a comment: this function does not
 * even ACCEPT a branch on `closeClass` — it is here only to LABEL the red
 * with the step and its declared class, so a test (or a caller) can prove
 * that a green, a softgreen and a hitl step with the same empty artifact
 * all red identically. A hitl step is never exempted: a human accepting an
 * empty artifact is still an empty artifact.
 */
export function checkStepHappened(step, artifact) {
  const result = happened(artifact);
  if (result.verdict === 'red') {
    const label = step?.goal ? `"${step.goal}"` : (step?.emits ?? 'step');
    const cls = step?.close?.class ?? 'hitl';
    return { verdict: 'red', red: `happened: ${label} (${cls}) produced nothing — ${result.red.replace(/^happened: /, '')}` };
  }
  return { verdict: 'green', red: null };
}

/** `gather`: read a file into a typed, hashed artifact. Effect check: non-empty (via `happened()`), source hash recorded. */
export function gather(id, path, kind) {
  const sha256 = hashFile(path);
  if (kind === 'csv') {
    const text = readFileSync(path, 'utf8');
    const { header, rows } = parseCsv(text);
    if (happened(rows).verdict === 'red') throw new Error(`gather ${id}: artifact is empty (${path})`);
    return { id, kind: 'csv', path, sha256, header, rows };
  }
  if (kind === 'text') {
    const text = readFileSync(path, 'utf8');
    const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
    if (happened(lines).verdict === 'red') throw new Error(`gather ${id}: artifact is empty (${path})`);
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

/**
 * `send`: egress. Requires a prior accept THIS run and a target inside the
 * signed allow-list (PRD §5: "target ∈ signed allow-list; prior `ask` accept
 * this run"). Writes the file and returns its path as the delivery id.
 *
 * `allowedTargets` is NOT hard-coded here any more (M0b Part 1, send-lock
 * finding): the allow-list is a human-signed arbiter field that lives in the
 * declaration's guardrails text (`guardrail: send at line N to <target>`,
 * validator.mjs's `parseArbiterSlots`) — ONE writer for that data. Every
 * caller (the runner, in production; a test, standing in for the parsed
 * declaration) must pass the signed target(s) explicitly; there is no
 * fallback default, so a caller that forgets to wire it refuses loudly
 * rather than silently falling back to a second, drifting copy of the list.
 */
export function send(runId, target, content, { acceptedThisRun, outDir, allowedTargets } = {}) {
  if (!acceptedThisRun) throw new Error('send: no prior accept in this run');
  if (!Array.isArray(allowedTargets) || allowedTargets.length === 0) {
    throw new Error('send: allowedTargets must be a non-empty array — the allow-list is signed data parsed '
      + 'from the declaration (validator.mjs parseArbiterSlots), never a hard-coded default here');
  }
  if (!allowedTargets.includes(target)) throw new Error(`send: target "${target}" is not in the signed allow-list (${allowedTargets.join(',')})`);
  const dir = outDir ?? join(process.cwd(), 'poc', 'm0', 'out', runId);
  mkdirSync(dir, { recursive: true });
  const deliveryPath = join(dir, 'sent.txt');
  writeFileSync(deliveryPath, content);
  return { deliveryId: deliveryPath };
}
