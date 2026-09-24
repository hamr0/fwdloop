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

import { appendAudit } from './books.js';

function sleep(ms) {
  return new Promise((resolve) => { setTimeout(resolve, ms); });
}

function safeStamp(iso) {
  return String(iso).replace(/[^0-9A-Za-z]/g, '-');
}

/**
 * @param {{ timeoutMs?: number, pollMs?: number, clock?: () => string, writeLine?: (line:string) => void }} [opts]
 * @returns {(opts:{question:string, evidence:unknown, runDir:string}) => Promise<{decision:string, reason?:string}>}
 */
export function makeFileAskStep({
  timeoutMs = 120_000,
  pollMs = 500,
  clock = () => new Date().toISOString(),
  writeLine = (line) => { process.stderr.write(`${line}\n`); },
} = {}) {
  let attemptCounter = 0;

  return async function fileAskStep({ question, evidence, runDir }) {
    attemptCounter += 1;
    const attempt = attemptCounter;

    mkdirSync(runDir, { recursive: true });
    const askPath = join(runDir, 'ask.json');
    const answerPath = join(runDir, 'answer.json');
    const askedAt = clock();

    writeFileSync(askPath, JSON.stringify({
      question, evidence, askedAt, attempt,
    }, null, 2));
    writeLine(`ASK OPEN (expires in ${Math.round(timeoutMs / 1000)}s): ${question} — answer by writing ${answerPath}`);

    const deadline = Date.now() + timeoutMs;
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
