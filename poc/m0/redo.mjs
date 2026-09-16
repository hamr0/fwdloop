// The redo edge at an `ask` — Amendment A to M0b (SIGNED by hamr, 2026-09-12;
// docs/wiki/the-module-ladder.md ~84-97). Today `checkpointAsk`
// (poc/m0/runner.mjs) reds on a `rerun` decision naming it out of scope;
// this module is the piece that WOULD handle it, standing alone with
// injected `attempt`/`ask`/`close` functions so it can be tested without the
// real Checkpoint/CLI plumbing. Wiring this into a job-2 fold (calling the
// real `checkpointAsk` and `mechanical.ask`) is later work — out of THIS
// module's scope, same as Amendment A was out of runner.mjs's brief.
//
// Amendment A, verbatim rules this module encodes:
//   - Cap: 3 redos per ask. The 4th REJECTION halts the run and names the
//     step. Human-signed, tighten-only, inexpressible to the drafter (same
//     class as the spend cap) — `redoCap` is therefore a parameter the
//     CALLER supplies from signed data, never read from any declaration
//     inside this module, and is asserted to be an integer in [1,3];
//     anything else (including a caller asking for MORE redos, e.g. 4) is
//     refused as a red naming the cap — tighten-only, never loosen.
//   - Reason required: a rejection with no reason (empty or whitespace-only
//     text) is REFUSED at the ask — the run does not advance and does not
//     redo. It re-asks for the SAME attempt. A machine close-red is NOT a
//     rejection and burns no redo (Amendment A only covers a human's
//     rejection at the ask; a red close never reaches the ask at all).
//   - Every attempt recorded: each attempt's artifact, its rejection reason,
//     and its cost land in audit.jsonl, one row per attempt, each carrying
//     `parent` (the attempt it redoes, or null for attempt 1) — never an
//     overwrite of a prior row.
//
// Readings chosen where Amendment A's text was silent (stated here, not
// asked, per this task's instruction):
//   1. "The 4th rejection halts... names the step" — read literally: the
//      cap counts REJECTIONS, not attempts. 3 redos means attempts 1-4 can
//      run (attempt 1, then up to 3 redos = attempts 2-4); the 4th
//      rejection (i.e. rejecting attempt 4) is what halts. This module
//      therefore allows attempts up to `redoCap + 1` and halts on the
//      (redoCap + 1)th rejection, naming both the step and the rejection
//      count ("... after 4 rejections").
//   2. The halt-causing (redoCap+1)th rejection IS recorded as a final
//      audit row before the halt row — Amendment A says "every attempt is
//      recorded" with no carve-out for the one that trips the cap, and a
//      halt with no record of what triggered it would be exactly the kind
//      of silent-attenuator gap the project's other rules forbid.
//   3. `costUsd: null` (unknown) is never coerced to 0 when summing — the
//      running total tracks a separate `costUnknown` flag once any attempt
//      reports an unknown cost, per the project's "unknown cost is never
//      rendered as 0" rule.

import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

function appendAudit(auditPath, row) {
  mkdirSync(join(auditPath, '..'), { recursive: true });
  appendFileSync(auditPath, `${JSON.stringify(row)}\n`);
}

/**
 * @param {object} opts
 * @param {string} opts.runDir
 * @param {string} opts.stepName
 * @param {(n: number, reason: string|null) => Promise<{ok:true, artifactPath:string, costUsd:number|null}|{ok:false, red:string}>} opts.attempt
 * @param {(n: number, artifactPath: string) => Promise<{decision:string, text:string|null}>} opts.ask
 * @param {(artifactPath: string) => {verdict:string, red?:string}} opts.close
 * @param {number} [opts.redoCap]
 * @param {string} opts.auditPath
 * @returns {Promise<{ok:true, artifactPath:string, attempts:number, costUsd:number, costUnknown:boolean}|{ok:false, red:string}>}
 */
export async function askWithRedo({
  runDir, stepName, attempt, ask, close, redoCap = 3, auditPath,
}) {
  if (!Number.isInteger(redoCap) || redoCap < 1 || redoCap > 3) {
    return { ok: false, red: `redo cap ${redoCap} is invalid at step ${stepName} — must be an integer 1..3 (tighten-only)` };
  }

  let n = 1;
  let reason = null;
  let parent = null;
  let totalCost = 0;
  let costUnknown = false;
  let rejections = 0;

  // The (redoCap+1)th REJECTION halts the run — see reading (1) above: up
  // to redoCap redos are attempts 2..(redoCap+1), so the halt-causing
  // rejection is the one on attempt (redoCap + 1).
  const maxAttempts = redoCap + 1;

  for (;;) {
    // eslint-disable-next-line no-await-in-loop
    const result = await attempt(n, reason);
    if (!result.ok) {
      return { ok: false, red: `step ${stepName} attempt ${n}: ${result.red}` };
    }
    const { artifactPath, costUsd } = result;
    if (costUsd === null || costUsd === undefined) {
      costUnknown = true;
    } else {
      totalCost += costUsd;
    }

    const shape = close(artifactPath);
    if (shape.verdict !== 'green') {
      // A machine red is not a rejection and burns no redo — the run ends
      // red without ever reaching the ask.
      return { ok: false, red: `step ${stepName} attempt ${n}: close ${shape.verdict} — ${shape.red}` };
    }

    // A reason-less rejection re-asks for the SAME attempt without calling
    // `attempt` again — inner loop so a refusal never re-runs the step.
    let answer;
    for (;;) {
      // eslint-disable-next-line no-await-in-loop
      answer = await ask(n, artifactPath);

      if (answer.decision !== 'rerun') break;
      const rejectReason = typeof answer.text === 'string' ? answer.text.trim() : '';
      if (rejectReason.length > 0) break;

      appendAudit(auditPath, {
        kind: 'refused', why: 'reason required', attempt: n, stepName, at: new Date().toISOString(), runDir,
      });
      // eslint-disable-next-line no-continue
      continue;
    }

    if (answer.decision === 'accept') {
      appendAudit(auditPath, {
        kind: 'attempt', attempt: n, parent, artifactPath, costUsd, reason, decision: 'accept', stepName, at: new Date().toISOString(), runDir,
      });
      return {
        ok: true, artifactPath, attempts: n, costUsd: totalCost, costUnknown,
      };
    }

    if (answer.decision === 'rerun') {
      const rejectReason = answer.text.trim();
      rejections += 1;
      appendAudit(auditPath, {
        kind: 'attempt', attempt: n, parent, artifactPath, costUsd, reason: rejectReason, decision: 'rerun', stepName, at: new Date().toISOString(), runDir,
      });

      if (n >= maxAttempts) {
        appendAudit(auditPath, {
          kind: 'halt', stepName, attempts: n, rejections, at: new Date().toISOString(), runDir,
        });
        return { ok: false, red: `redo cap ${redoCap} reached at step ${stepName} after ${rejections} rejections` };
      }

      parent = n;
      reason = rejectReason;
      n += 1;
      // eslint-disable-next-line no-continue
      continue;
    }

    return { ok: false, red: `step ${stepName} attempt ${n}: unrecognised ask decision "${answer.decision}"` };
  }
}
