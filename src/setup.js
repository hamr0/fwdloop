// M4e amendment 6 item 4 (docs/wiki/the-module-ladder.md, "M4e", "Amendment 6"): the SETUP record. At sign, the draft folder's own
// record (the card, each draft and change with its model, cost and verdict, each note in the human's words, and the sign) is copied once
// into the flow folder as `setup.jsonl`. It sits outside the three signed files (`FLOW_FILES`), so `readFlow` and the signature never see
// it. ONE writer (`writeSetup`, called from `signDraft`, which the CLI and the panel both use) and ONE reader (`readSetup`).
//
// What each row throws away: a draft/change row keeps model, cost, calls, time, verdict, plan hash and its first red, NOT the plan itself (the signed
// declaration is the plan) nor the model's tokens/rounds; a card row keeps the card's own typed fields; a note keeps its text verbatim.
// Third outcomes: a draft with no result is `stopped`; a cost nobody booked is `null` (shown "unknown", never $0).
import { lstatSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scrub } from './authoring.js';
import { readDraftSpend } from './draftspend.js';
import { readFileInside, readdirInside } from './flow.js';
import { readSpendRows } from './provider.js';

export const SETUP_FILE = 'setup.jsonl';
const NOTE_RE = /^note-(\d+)\.txt$/;

const readJson = (dir, rel) => {
  const r = readFileInside(dir, rel);
  if (!r.ok) return null;
  try { return JSON.parse(r.text); } catch { return null; }
};
const mtimeIso = (dir, rel) => {
  try { return lstatSync(join(dir, rel)).mtime.toISOString(); } catch { return null; }
};

/** One plan folder's row: model, cost, verdict (green / red / stopped), plan hash, first red. @param {string} sessionDir @param {string} rel `draft` or `draft-<n>` */
function planRow(sessionDir, rel, kind, n) {
  const hashFile = readFileInside(sessionDir, `${rel}/spec.hash`);
  const hash = hashFile.ok && hashFile.text.trim() !== '' ? hashFile.text.trim() : null;
  const log = readJson(sessionDir, `${rel}/log.json`);
  const leak = readFileInside(sessionDir, `${rel}/scrub-leak.red`);
  const spent = readSpendRows(join(sessionDir, rel, 'spend.jsonl')).filter((r) => r && r.kind === 'draft').pop() ?? readDraftSpend(join(sessionDir, rel));
  let verdict = 'stopped';
  /** @type {string|null} */
  let gap = 'no result was recorded';
  if (hash) { verdict = 'green'; gap = null; } else if (leak.ok || (log && log.ok === false)) {
    verdict = 'red';
    const reds = Array.isArray(log?.reds) ? log.reds.map(String) : [];
    if (leak.ok) reds.push(leak.text.trim());
    gap = reds.join('; ') || 'the plan did not pass the checks';
  }
  return {
    kind, n, at: typeof spent?.at === 'string' ? spent.at : null, model: spent?.model ?? log?.modelId ?? null,
    costUsd: typeof spent?.costUsd === 'number' ? spent.costUsd : null, spendComplete: spent ? spent.spendComplete !== false && typeof spent.costUsd === 'number' : false,
    // calls and time as the draft booked them; null = not recorded (never 0)
    calls: Number.isInteger(spent?.calls) ? spent.calls : null, wallMs: typeof spent?.wallMs === 'number' ? spent.wallMs : null,
    verdict, hash, gap,
  };
}

/**
 * The rows of a draft's record, oldest first. `sessionDir` is the panel's draft folder (card.json, draft/, note-<n>.txt, draft-<n>/); a CLI
 * draft has none, so its record is its one plan folder (`planDir`, read as `draft`) plus the sign.
 * @param {{ sessionDir?: string, planDir: string, hash: string, signedBy: string, signedAt: string, flowHash?: string }} a
 */
export function buildSetupRows({
  sessionDir, planDir, hash, signedBy, signedAt, flowHash,
}) {
  const rows = [];
  if (sessionDir) {
    const card = readJson(sessionDir, 'card.json');
    if (card) rows.push({ kind: 'card', n: 0, at: mtimeIso(sessionDir, 'card.json'), card });
    rows.push(planRow(sessionDir, 'draft', 'draft', 0));
    const notes = readdirInside(sessionDir, '.').map((f) => NOTE_RE.exec(f)?.[1]).filter((x) => x !== undefined).map(Number).sort((a, b) => a - b);
    for (const n of notes) {
      const t = readFileInside(sessionDir, `note-${n}.txt`);
      rows.push({
        kind: 'note', n, at: mtimeIso(sessionDir, `note-${n}.txt`), text: t.ok ? t.text.replace(/\n$/, '') : '',
      });
      rows.push(planRow(sessionDir, `draft-${n}`, 'change', n));
    }
  } else {
    const r = planRow(planDir, '.', 'draft', 0);
    rows.push(r);
  }
  rows.push({
    kind: 'sign', n: 0, at: signedAt, signedBy, hash, flowHash: flowHash ?? null,
  });
  return rows;
}

/**
 * Write `<flowDir>/setup.jsonl` ONCE ('wx': a second write is refused, never merged or replaced), mode 0600, every row scrubbed of the
 * given key values. Never throws.
 * @param {{ flowDir: string, secrets?: string[] } & Parameters<typeof buildSetupRows>[0]} a
 * @returns {{ ok: true, file: string, rows: number } | { ok: false, red: string }}
 */
export function writeSetup({ flowDir, secrets = [], ...rest }) {
  const file = join(flowDir, SETUP_FILE);
  try {
    const rows = buildSetupRows(rest);
    const text = rows.map((r) => scrub(JSON.stringify(r), secrets)).join('\n');
    writeFileSync(file, `${text}\n`, { flag: 'wx', mode: 0o600 });
    return { ok: true, file, rows: rows.length };
  } catch (err) {
    return { ok: false, red: err.code === 'EEXIST' ? `setup: ${SETUP_FILE} already exists — never overwritten` : `setup: could not write ${SETUP_FILE} (${err.code ?? err.message})` };
  }
}

/**
 * The flow's setup rows, through the one safe gateway. `present:false` = a flow signed before amendment 6 (or a file that cannot be read).
 * @param {string} flowDir
 * @returns {{ present: false } | { present: true, rows: any[], unreadable: number }}
 */
export function readSetup(flowDir) {
  const r = readFileInside(flowDir, SETUP_FILE);
  if (!r.ok) return { present: false };
  const rows = [];
  let unreadable = 0;
  for (const line of r.text.split('\n')) {
    if (line.trim() === '') continue;
    try { const row = JSON.parse(line); if (row && typeof row === 'object' && typeof row.kind === 'string') rows.push(row); else unreadable += 1; } catch { unreadable += 1; }
  }
  return { present: true, rows, unreadable };
}
