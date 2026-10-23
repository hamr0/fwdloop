// F81 POC (m8-step) — the jobs and their step-failure notes (M8 am2 shape). NOT the product; nothing here ships.
// borrowed-from: main-session scratch review-ours.mjs (reads every real run through poc/learn/adapter.mjs, builds cards, folds them, renders the hint block).
//
// A note = a step of an EARLIER real run of the same workflow whose check went red (FIXED if it passed later in that run, NEVER FIXED otherwise).
// The block handed to arm B's drafter is exactly renderHints(...).text of poc/m8-step/learn-ours.mjs: no editing, no extra words.

import fs from 'node:fs';
import path from 'node:path';
import { loadRuns } from '../learn/adapter.mjs';
import * as L from './learn-ours.mjs';

export const FLOWS_ROOT = path.resolve(import.meta.dirname, '../../flows');
/** Hard cap line every POC sample carries (per run; also the draft's own budget). The harness sets it per sample, see run.mjs. */
export const JOB_CAP_USD = 0.1;
/** The two jobs (see F81 for why these and not am29-walk-2). */
export const JOB_IDS = ['m7-walk-2', 'm10b-expenses'];
export const NOW = new Date('2026-10-23T12:00:00Z');

/** The recorded prose with only its cap line set (the cap is not part of the job text; the line's own words stay). */
export function withCap(prose, capUsd) {
  const out = prose.replace(/^guardrail: cap \$[0-9.]+ per run$/m, `guardrail: cap $${capUsd} per run`);
  if (out === prose && !prose.includes(`cap $${capUsd} per run`)) throw new Error('notes: no cap line to set');
  return out;
}

/** hint blocks for every workflow: { [workflow]: { text, ids } }, built across ALL real runs (as the reference does), rendered per workflow. */
export function hintBlocks(flowsRoot = FLOWS_ROOT, now = NOW) {
  const runs = loadRuns(flowsRoot);
  let ledger = L.emptyLedger();
  for (const r of runs) {
    const b = L.buildCards({ runid: `${r.wf}/${r.run}`, events: r.events, spec: r.spec, model: r.model, questions: r.failText });
    ledger = L.countLedger(ledger, { runid: `${r.wf}/${r.run}`, cards: b.cards, workflow: r.wf, place: L.placeOf(r.spec), specHash: r.specHash, trust: 'deterministic', now: new Date(r.at) });
  }
  const out = {};
  for (const w of [...new Set(ledger.rows.map((x) => x.workflow))]) {
    const lastHash = ledger.rows.filter((x) => x.workflow === w).at(-1).specHash;
    const h = L.renderHints(ledger, { workflow: w, place: null, specHash: lastHash, now });
    out[w] = { text: h.text, hints: h.ids.length };
  }
  return out;
}

/** The jobs the batch runs: [{id, proseText (recorded cap), hint, hintInfo}]. */
export function loadJobs(flowsRoot = FLOWS_ROOT, ids = JOB_IDS) {
  const blocks = hintBlocks(flowsRoot);
  return ids.map((id) => {
    const b = blocks[id];
    if (!b || !b.text) throw new Error(`notes: job ${id} has no hint block`);
    return { id, proseText: fs.readFileSync(path.join(flowsRoot, id, 'prose.txt'), 'utf8'), hint: b.text, hintInfo: { hints: b.hints, chars: b.text.length } };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const j of loadJobs()) process.stdout.write(`===== ${j.id} ${JSON.stringify(j.hintInfo)}\n${j.hint}\n`);
}
