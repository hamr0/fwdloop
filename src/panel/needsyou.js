// M11 amendment 11 item 3: the human's "Remove from Needs you". The ONE writer of the removal marker; the reading, the episode key and the 7-day rule are `data.js`'s
// (`getRunNeeds`, `needsYouOf`), so the runs list, this route and the Audit can never disagree. It changes nothing else about the run.
// The marker is written like the refused-start dismiss (`cleared.json`, authorstart.js): 0600, once (`wx`), the run folder realpathed at use time.

import { realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { getRunNeeds, needsRemovedFile } from './data.js';

/**
 * Write the marker for the episode the card is in now. Refused unless the run is in Needs you with a removable tag (`Reopen` or `Resume`, never `Answer`) right now.
 * @param {{root: string, flow: string, runId: string, catalogue: any, nowMs?: number, at?: string, resumeAttempt?: (flow: string, runId: string) => any}} o
 * @returns {{ok: true}|{ok: false, refused: 'no-such-run'|'not-in-needs-you', say: string}}
 */
export function removeFromNeedsYou({
  root, flow, runId, catalogue, nowMs = Date.now(), at = new Date(nowMs).toISOString(), resumeAttempt,
}) {
  const n = getRunNeeds({
    root, flow, runId, catalogue, nowMs, resumeAttempt,
  });
  if (n === null) return { ok: false, refused: 'no-such-run', say: 'there is no such run' };
  if (!n.removable || n.key === null) return { ok: false, refused: 'not-in-needs-you', say: 'this run is not in Needs you with a card that can be removed' };
  try {
    writeFileSync(join(realpathSync(n.runDir), needsRemovedFile(n.key)), `${JSON.stringify({ key: n.key, at })}\n`, { mode: 0o600, flag: 'wx' });
  } catch (e) {
    if (/** @type {any} */ (e)?.code !== 'EEXIST') throw e;
  }
  return { ok: true };
}
