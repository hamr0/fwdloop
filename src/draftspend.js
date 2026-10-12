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
import { readSpendRows, rowCeilingUsd, spendRowCost, unmeteredCalls } from './provider.js';
import { readdirInside } from './flow.js';

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

const PLAN_DIR_RE = /^draft(?:-\d+)?$/;

/**
 * M4d amendment 16 item 1: what ALL of a job's drafting spent — the one writer of that total. A panel draft's session folder holds one plan
 * folder per draft (`draft/`, `draft-<n>/` for each revise and the redraft after answers); each is read by `readDirSpendRows` and priced by
 * `spendRowCost`, the one cost rule. A round whose cost is not known counts at its WORST CASE (item 5): its own booked price's ceiling, else
 * `ceilingUsd` (Settings prices x the fixed token limits), never $0; `notPriced` counts those rounds and `complete` is false.
 * @param {string} sessionDir the panel's draft folder
 * @param {{ ceilingUsd?: number, exclude?: string }} [o] `exclude` = a plan folder name to leave out (the one being written now)
 * @returns {{ usd: number, notPriced: number, complete: boolean }}
 */
export function draftingSpent(sessionDir, { ceilingUsd = 0, exclude } = {}) {
  let usd = 0;
  let notPriced = 0;
  for (const name of readdirInside(sessionDir, '.')) {
    if (!PLAN_DIR_RE.test(name) || name === exclude) continue;
    for (const row of readDirSpendRows(join(sessionDir, name))) {
      if (row.spendComplete === false) {
        const n = unmeteredCalls(row);
        const per = rowCeilingUsd(row) > 0 ? rowCeilingUsd(row) : ceilingUsd;
        usd += (row.costUsd ?? 0) + n * per;
        notPriced += n;
      } else if (row.costUsd === null || row.costUsd === undefined) {
        usd += rowCeilingUsd(row) > 0 ? rowCeilingUsd(row) : ceilingUsd;
        notPriced += 1;
      } else usd += spendRowCost(row).usd;
    }
  }
  return { usd, notPriced, complete: notPriced === 0 };
}

/** Money to 4 places, trailing zeros kept to 2 (`0.05`, `0.0016`). @param {number} n */
export const usdText = (n) => `$${String(Math.round(n * 1e4) / 1e4).replace(/^(\d+)$/, '$1.00').replace(/^(\d+\.\d)$/, '$10')}`;

/**
 * M4d amendment 16 items 1, 3, 5: the split of the card's Cap $ at Sign & run. `leftUsd` is what the first run may spend, rounded DOWN to 4 places (never
 * more than is left). `line` is the sentence the page shows.
 * @param {number} capUsd @param {{ usd: number, notPriced: number }} spent
 */
export function potSplit(capUsd, spent) {
  const leftUsd = Math.max(0, Math.floor((capUsd - spent.usd) * 1e4 + 1e-6) / 1e4);
  const drafting = spent.notPriced > 0
    ? `drafting spent at most ${usdText(spent.usd)} (${spent.notPriced} round${spent.notPriced === 1 ? '' : 's'} not priced)`
    : `drafting spent ${usdText(spent.usd)}`;
  return { capUsd, spentUsd: spent.usd, notPriced: spent.notPriced, leftUsd, line: `Cap ${usdText(capUsd)} · ${drafting} · this run up to ${usdText(leftUsd)}` };
}
