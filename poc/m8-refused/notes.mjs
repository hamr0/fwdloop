// F80 POC (m8-refused) — the three jobs and their refused-plan notes. NOT the product; nothing here ships.
// borrowed-from: scratchpad extra.mjs (the "drafter's refused plans" part only) over src/learn.js (v0.46.0 copy + B1).
//
// A job = the job lines before the "Arbiter guardrails" block of a recorded draft's prose. Notes are keyed by that text
// (the per-draft spec hash is ignored). A note = a round of an EARLIER draft of the same job that the validator refused:
//   - draft ok and some round was refused  -> FIXED card, said = the reds of the LAST refused round
//   - draft failed                         -> NEVER FIXED card, said = the draft's final reds
// Noise (structure / JSON-parse / "not readable" lines) is dropped. Then countLedger -> renderHints (the M8 hint format).

import fs from 'node:fs';
import path from 'node:path';
import { emptyLedger, countLedger, renderHints, cleanText, flaggedTokens } from './learn-poc.mjs';

export const DRAFTS_ROOT = path.resolve(import.meta.dirname, '../../flows/.drafts');
/** The cap line every POC draft carries (not in the drafter's prompt; the drafter's budget = this less what was spent). */
export const POC_CAP_USD = 0.25;

/** The three jobs (hamr's pick). `from` = the recorded draft dir whose prose.txt is the job + inputs, as that session had them. */
export const JOB_PICKS = [
  { id: 'aging', from: 'd-00mv5ciofj-e416' },
  { id: 'm7-walk-2', from: 'd-00mv54iebr-5ec3' },
  { id: 'am29-walk-2', from: 'd-00mv2588dx-22eb' },
];

const NOISE = /not valid JSON|was not readable twice|no tool call|truncated/;
const rd = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
export const jobTextOf = (prose) => prose.split('\nArbiter guardrails')[0].trim();

/** The recorded prose with only its cap line set to the POC cap (the cap is not part of the job and not in the prompt). */
export function withPocCap(prose, capUsd = POC_CAP_USD) {
  const out = prose.replace(/^guardrail: cap \$[0-9.]+ per run$/m, `guardrail: cap $${capUsd} per run`);
  if (out === prose && !prose.includes(`cap $${capUsd} per run`)) throw new Error('notes: no cap line to set');
  return out;
}

/** Every recorded draft (dir, draft folder name, prose, log) whose job text equals `jobText`. */
export function draftsOfJob(jobText, root = DRAFTS_ROOT) {
  const found = [];
  for (const d of fs.readdirSync(root)) {
    const sd = path.join(root, d);
    for (const f of fs.readdirSync(sd)) {
      const m = /^prose(-\d+)?\.txt$/.exec(f);
      if (!m) continue;
      const dn = m[1] ? `draft${m[1]}` : 'draft';
      const lf = path.join(sd, dn, 'log.json');
      const log = rd(lf);
      if (!log) continue;
      if (jobTextOf(fs.readFileSync(path.join(sd, f), 'utf8')) !== jobText) continue;
      found.push({ d, dn, log, at: fs.statSync(lf).mtime.toISOString() });
    }
  }
  return found;
}

/** Cards from the recorded drafts of one job (same shape the F79 reference makes). Returns [{runid, at, card}] */
export function cardsOfJob(jobText, job, root = DRAFTS_ROOT) {
  const mk = (o) => ({
    id: o.id, runid: o.runid, at: o.at, date: o.at.slice(0, 10), job, model: 'deepseek-flash', check: 'the drafted plan', kind: o.kind, endText: o.endText,
    goal: '', stepId: 'the drafted plan', stepAction: null, meaning: null, said: o.said.map((s) => cleanText(s)), saidMore: 0, kinds: ['other'], files: [], symbol: null,
    tokens: flaggedTokens(o.said.join('\n')), nextCheck: null, ended: 'red', fixTouched: [], whatChanged: null, specHash: null, src: 'draft',
  });
  const out = [];
  for (const { d, dn, log, at } of draftsOfJob(jobText, root)) {
    const runid = `${d}/${dn}`;
    const redRounds = (log.log || []).filter((r) => Array.isArray(r.reds) && r.reds.length).map((r) => r.reds.filter((x) => !NOISE.test(x))).filter((x) => x.length);
    const finalReds = (log.reds || []).filter((x) => !NOISE.test(typeof x === 'string' ? x : JSON.stringify(x))).map((x) => (typeof x === 'string' ? x : JSON.stringify(x)));
    if (log.ok && redRounds.length) out.push(mk({ id: `${runid}:fixed`, runid, at, kind: 'FIXED', endText: 'refused by the plan check; fixed in a later round of the same draft', said: redRounds.at(-1) }));
    if (!log.ok && finalReds.length) out.push(mk({ id: `${runid}:stuck`, runid, at, kind: 'NEVER_FIXED', endText: 'refused by the plan check; the draft failed', said: finalReds }));
  }
  return out;
}

/** The hint block for a job, from its earlier refused drafts. { text, ids, cards } — text '' when nothing was refused. */
export function hintsForJob(jobText, job, { root = DRAFTS_ROOT, now = new Date('2026-10-23T12:00:00Z') } = {}) {
  const cards = cardsOfJob(jobText, job, root).sort((a, b) => a.at.localeCompare(b.at));
  let ledger = emptyLedger();
  for (const c of cards) ledger = countLedger(ledger, { runid: c.runid, cards: [c], workflow: job, place: null, specHash: null, trust: 'deterministic', now: new Date(c.at) });
  const h = renderHints(ledger, { workflow: job, place: null, specHash: null, now });
  return { ...h, cards: cards.length, rows: ledger.rows.length };
}

/** The jobs the batch runs: [{id, proseText (cap set), hint}]. */
export function loadJobs(root = DRAFTS_ROOT, picks = JOB_PICKS) {
  return picks.map(({ id, from }) => {
    const prose = fs.readFileSync(path.join(root, from, 'prose.txt'), 'utf8');
    const h = hintsForJob(jobTextOf(prose), id, { root });
    return { id, proseText: withPocCap(prose), hint: h.text, hintInfo: { hints: h.ids.length, chars: h.text.length, cards: h.cards, rows: h.rows, earlierDrafts: draftsOfJob(jobTextOf(prose), root).length } };
  });
}

if (import.meta.url === `file://${process.argv[1]}`) {
  for (const j of loadJobs()) process.stdout.write(`===== ${j.id} ${JSON.stringify(j.hintInfo)}\n${j.hint || '(no hint)'}\n`);
}
