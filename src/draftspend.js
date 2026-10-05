// borrowed-from: bareloop src/draftspend.js@524a244 (writeDraftSpend: one file per draft folder, rewritten atomically
// after EVERY metered call; the money readers count it).
// M4e piece 2a, item 7 (docs/wiki/the-module-ladder.md, "M4e", scope 13): drafting spend that is booked per call.
//
// Before this, `draftToDir` booked ONE `spend.jsonl` row after the whole draft returned, so a draft killed
// mid-way (Abandon, a SIGKILL, a panel host reboot) booked nothing for the rounds already paid for. Now the
// drafter reports every call (`onBook`, src/drafter.js) and `draftToDir` rewrites `<draft dir>/draft-spend.json`
// from it: written BEFORE each provider call as "one call in flight" (unknown cost = one ceiling, never $0),
// rewritten AFTER it with the metered floor.
//
// ONE rule for what a draft dir costs (`readDirSpendRows`, the only reader, called by src/monthly.js): the final
// `spend.jsonl` row, once the draft finished, is the whole truth and SUPERSEDES this file; before that, this file
// is the dir's one spend row. So a finished draft is counted once, never as both. The run that follows a sign has
// its own dir and its own books — it never carries this spend (counted once, as scope 13 says).
//
// The record is shaped like a spend row, so `spendRowCost` (src/provider.js, the one cost rule) prices it:
//   { kind:'draft-live', provider, model, price, tokens, costUsd (metered floor, null when unpriced), rounds, calls,
//     spendComplete (false while a call is in flight or any call is unmetered/unpriced), inFlight, at, startedAt, updatedAt }
import { renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { readFileInside } from './flow.js';
import { readSpendRows } from './provider.js';

export const DRAFT_SPEND_FILE = 'draft-spend.json';

/**
 * (Re)write `<dir>/draft-spend.json` atomically (tmp + rename), so a reader never sees a torn file.
 * @param {string} dir the draft dir
 * @param {Record<string, any>} rec
 */
export function writeDraftSpend(dir, rec) {
  const file = join(dir, DRAFT_SPEND_FILE);
  const tmp = `${file}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(rec, null, 2)}\n`, { mode: 0o600 });
  renameSync(tmp, file);
}

/**
 * The draft dir's live spend record as a spend row, or null when the file is not there. A file that is there but
 * cannot be read is unknown spend: one unmetered call (priced at the ceiling), never $0 and never skipped.
 * @param {string} dir
 * @returns {Record<string, any>|null}
 */
export function readDraftSpend(dir) {
  const r = readFileInside(dir, DRAFT_SPEND_FILE);
  if (!r.ok) return r.missing ? null : unknownRow();
  try {
    const j = JSON.parse(r.text);
    if (!j || typeof j !== 'object' || Array.isArray(j)) return unknownRow();
    return j;
  } catch { return unknownRow(); }
}

const unknownRow = () => ({
  kind: 'draft-live', model: null, costUsd: null, rounds: 0, calls: 1, spendComplete: false, inFlight: false,
});

/**
 * Every spend row of one run/draft dir: its `spend.jsonl` rows; and, only when there are none, the draft dir's
 * `draft-spend.json` record (see the file header: a finished draft's spend.jsonl supersedes it).
 * @param {string} dir
 * @returns {Record<string, any>[]}
 */
export function readDirSpendRows(dir) {
  const rows = readSpendRows(join(dir, 'spend.jsonl'));
  if (rows.length > 0) return rows;
  const live = readDraftSpend(dir);
  return live ? [live] : [];
}
