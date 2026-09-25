// M2 piece 2 (docs/wiki/the-module-ladder.md, "M2 — scope, exit, negative —
// SIGNED", scope item 6): the file-checkpoint ask, in-process. Writes
// `ask.json` (question + evidence + askedAt + attempt) into the run dir and
// polls for `answer.json` (`{ decision: accept|reject|rerun, reason?,
// answeredAt }`). Consumed exactly once (renamed away on read); a stale
// answer — `answeredAt` older than THIS ask's `askedAt` — is quarantined
// (renamed to `answer.stale.<n>.json`, audited `stale-answer-ignored`) and
// never applied; a timeout returns `{ decision: 'timeout' }`, which
// `src/runner.js` must treat as a halt (a pause spends nothing).
//
// borrowed-from: fwdloop poc/m0/runner.mjs@76a3607 (`checkpointAsk`'s file
// protocol: `ask.json` out / poll `answer.json`, and the "ASK OPEN" stderr
// line so a human watching knows a run is waiting on them) and
// fwdloop poc/m0/answer.mjs@76a3607 (the answer file's own shape). Rewritten
// off bare-agent's `Checkpoint` (M0's dependency) onto a plain poll loop —
// M2's signed scope (item 6) calls for "M0's file checkpoint, in-process",
// not a second Checkpoint instance layered on top of the same file protocol.

import {
  existsSync, mkdirSync, readFileSync, renameSync, writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { appendAudit } from './books.js';

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function safeStamp(iso) {
  return String(iso).replace(/[^0-9A-Za-z]/g, '-');
}

/**
 * @param {{ timeoutMs?: number, pollMs?: number, clock?: () => string, writeLine?: (line:string) => void }} [opts]
 * @returns {(opts:{question:string, evidence:unknown, runDir:string, ttlMs?: number}) => Promise<{decision:string, reason?:string}>}
 */
export function makeFileAskStep({
  timeoutMs = 120_000,
  pollMs = 500,
  clock = () => new Date().toISOString(),
  writeLine = (line) => { process.stderr.write(`${line}\n`); },
} = {}) {
  let attemptCounter = 0;

  return async function fileAskStep({
    question, evidence, runDir, ttlMs,
  }) {
    attemptCounter += 1;
    const attempt = attemptCounter;

    // M3 scope item 1 (fixes F43): a signed `ttlMs` threaded in by the
    // runner always governs — this constructor's own `timeoutMs` is only
    // ever the fallback for a DIRECT call that carries no signed ttl (e.g.
    // this module's own unit tests). No code default overrides a signed
    // value.
    const effectiveTimeoutMs = typeof ttlMs === 'number' ? ttlMs : timeoutMs;

    mkdirSync(runDir, { recursive: true });
    const askPath = join(runDir, 'ask.json');
    const answerPath = join(runDir, 'answer.json');
    const askedAt = clock();
    const askId = randomUUID();
    const expiresAt = new Date(Date.parse(askedAt) + effectiveTimeoutMs).toISOString();

    writeFileSync(askPath, JSON.stringify({
      askId, question, evidence, askedAt, expiresAt, attempt,
    }, null, 2));
    writeLine(`ASK OPEN (expires in ${Math.round(effectiveTimeoutMs / 1000)}s): ${question} — answer by writing ${answerPath}`);

    const deadline = Date.now() + effectiveTimeoutMs;
    let staleCount = 0;

    for (;;) {
      if (existsSync(answerPath)) {
        let raw = null;
        try { raw = readFileSync(answerPath, 'utf8'); } catch { raw = null; }
        let parsed = null;
        if (raw !== null) { try { parsed = JSON.parse(raw); } catch { parsed = null; } }

        if (parsed) {
          const { answeredAt } = parsed;
          const isStale = typeof answeredAt === 'string' && typeof askedAt === 'string' && answeredAt < askedAt;
          if (isStale) {
            staleCount += 1;
            let staleName = join(runDir, `answer.stale.${staleCount}.json`);
            while (existsSync(staleName)) { staleCount += 1; staleName = join(runDir, `answer.stale.${staleCount}.json`); }
            renameSync(answerPath, staleName);
            appendAudit(runDir, {
              step: 'ask', attempt, class: null, verdict: 'stale-answer-ignored', gap: `answeredAt ${answeredAt} predates this ask's askedAt ${askedAt}`, usd: 0, spendComplete: true, wallMs: 0, model: null, modelMatch: null, strike: false,
            });
            // Keep polling — a stale file quarantined does not mean THIS
            // ask has been answered.
          } else {
            renameSync(answerPath, join(runDir, `answer.${safeStamp(askedAt)}.consumed.json`));
            return { decision: parsed.decision, reason: parsed.reason };
          }
        }
      }

      if (Date.now() >= deadline) {
        return { decision: 'timeout' };
      }
      // eslint-disable-next-line no-await-in-loop
      await sleep(pollMs);
    }
  };
}

// ---------------------------------------------------------------------------
// M3 piece 1 (docs/wiki/the-module-ladder.md, "M3 — scope, exit, negative —
// SIGNED", scope item 3, the function only — the CLI is piece 2): a separate
// process's half of the park protocol. Writes `answer.json` exactly once,
// refusing (never throwing) a blank reason on reject/rerun, an unknown
// askId, an expired askId, or a second answer to an already-answered ask —
// each by name, so an answer for ask A can never be consumed by ask B.
// ---------------------------------------------------------------------------

/**
 * @param {{ runDir: string, askId: string, decision: 'accept'|'reject'|'rerun', reason?: string, clock?: () => string }} opts
 * @returns {{ ok: true } | { ok: false, red: string }}
 */
export function answerAsk({
  runDir, askId, decision, reason, clock,
}) {
  const now = typeof clock === 'function' ? clock : () => new Date().toISOString();

  if (typeof runDir !== 'string' || runDir.length === 0) {
    return { ok: false, red: 'answerAsk: "runDir" must be a non-empty string' };
  }
  if (typeof askId !== 'string' || askId.length === 0) {
    return { ok: false, red: 'answerAsk: "askId" must be a non-empty string' };
  }
  if (decision !== 'accept' && decision !== 'reject' && decision !== 'rerun') {
    return { ok: false, red: `answerAsk: unrecognised decision "${decision}"` };
  }

  const askPath = join(runDir, 'ask.json');
  if (!existsSync(askPath)) {
    return { ok: false, red: `answerAsk: no open ask for run ${runDir}` };
  }
  let ask;
  try {
    ask = JSON.parse(readFileSync(askPath, 'utf8'));
  } catch (err) {
    return { ok: false, red: `answerAsk: ask.json for run ${runDir} is not valid JSON — ${err.message}` };
  }
  if (ask.askId !== askId) {
    return { ok: false, red: `answerAsk: askId "${askId}" is unknown for run ${runDir}` };
  }

  const nowIso = now();
  if (Date.parse(nowIso) > Date.parse(ask.expiresAt)) {
    return { ok: false, red: `answerAsk: askId "${askId}" expired at ${ask.expiresAt} for run ${runDir}` };
  }

  const answerPath = join(runDir, 'answer.json');
  // A consumed marker survives long after the run has moved on (or ended) —
  // it must still refuse a second answer naming the SAME askId, never only
  // while answer.json happens to still be sitting there.
  if (existsSync(join(runDir, `answer.${askId}.consumed.json`))) {
    return { ok: false, red: `answerAsk: askId "${askId}" already answered for run ${runDir}` };
  }

  const trimmedReason = typeof reason === 'string' ? reason.trim() : '';
  if ((decision === 'reject' || decision === 'rerun') && trimmedReason.length === 0) {
    return { ok: false, red: `answerAsk: askId "${askId}" needs a non-blank reason to ${decision}` };
  }

  const payload = { askId, decision, answeredAt: nowIso };
  if (trimmedReason.length > 0) payload.reason = trimmedReason;
  // Orchestrator review fix (5): a plain `existsSync` check followed by a
  // separate `writeFileSync` is a check-then-act race — two concurrent
  // answers can both pass the check before either writes, and the second
  // silently overwrites the first. `{ flag: 'wx' }` makes the write itself
  // the exclusive gate (fails EEXIST if the file already exists), so there
  // is no window between "is it answered" and "answer it" for a second
  // caller to land in.
  try {
    writeFileSync(answerPath, JSON.stringify(payload, null, 2), { flag: 'wx' });
  } catch (err) {
    if (err.code === 'EEXIST') {
      return { ok: false, red: `answerAsk: askId "${askId}" already answered for run ${runDir}` };
    }
    return { ok: false, red: `answerAsk: could not write ${answerPath} — ${err.message}` };
  }
  return { ok: true };
}
