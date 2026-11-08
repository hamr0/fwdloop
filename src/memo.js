// M14 items 1-6 (docs/wiki/the-module-ladder.md, "M14 — memory improvements", and "M14 amendment 1" item 2): the carry memo, "what happened so far in this run".
// Plain code, no AI, built fresh before each model try from the run's OWN files only: audit.jsonl (the tries and how each ended), the consumed answers and
// `asks/<id>.json` (the human's words, by `listArchivedAsks`), `job/declaration.json` (step order) and `run.json`'s `rerun` section. It writes nothing: the exact
// text a try was handed is kept by that try's audit row (`memoText`, runner.js `makeAuditRow`), so no new run-folder file. Pure over those files, so it survives a
// pause, a resume and a restart. It never carries money or time (no cost, no duration); gap texts are the closer's own words, kept as they are (cut at GAP_CHARS).
import { readAudit } from './books.js';
import { readFileInside } from './flow.js';
import { listArchivedAsks, DECISION_STATUS } from './ask.js';
import { readRunRecord } from './runfile.js';
import {
  foldCards, nameOf, errorKinds, flaggedTokens, quoteLines,
} from './learn.js';

/** M14 am1 item 2: the memo's fixed words */
export const MEMO_HEADING = 'What happened so far in this run (written by code, from the record)';
export const MEMO_CUT_NOTE = '(older lines cut to fit)';
/** M14 item 5 */
export const MEMO_CAP = 4000;
/** one gap text is cut here (with an ellipsis), so a single long red cannot eat the whole cap */
const GAP_CHARS = 300;

/** a try that closed well; every other verdict of a model try is a failure the memo names */
const WELL = new Set(['green', 'hitl']);
const DECISION_OF = Object.fromEntries(Object.entries(DECISION_STATUS).map(([k, v]) => [v, k]));

const oneLine = (/** @type {unknown} */ t) => (typeof t === 'string' ? t.replace(/\s+/g, ' ').trim() : '');
const cutGap = (/** @type {string} */ g) => (g.length > GAP_CHARS ? `${g.slice(0, GAP_CHARS)}…` : g);
const says = (/** @type {string} */ words) => (words === '' ? '' : ` — user says "${words}"`);

/** step names in the job's own order, from the run's copy of the job (`[]` when it cannot be read) @param {string} runDir @returns {string[]} */
function stepOrder(runDir) {
  const r = readFileInside(runDir, 'job/declaration.json');
  if (!r.ok) return [];
  try {
    const steps = JSON.parse(r.text)?.steps;
    return Array.isArray(steps) ? steps.map((s) => s?.emits).filter((e) => typeof e === 'string') : [];
  } catch { return []; }
}

/** the human lines: the rerun line first (this run began as a rerun), then one per answered ask in the order they were asked (N counts every ask of this run) @param {string} runDir @param {string[]} order @returns {string[]} */
function humanLines(runDir, order) {
  /** @type {string[]} */
  const lines = [];
  const rec = readRunRecord(runDir);
  const rr = rec.ok ? rec.rec.rerun : null;
  if (rr && typeof rr === 'object' && rr.decision === 'rerun' && typeof rr.words === 'string') lines.push(`rerun${says(oneLine(rr.words))}`);
  const listed = listArchivedAsks(runDir);
  if (!listed.archived) return lines;
  const asks = [...listed.asks].sort((a, b) => String(a.askedAt ?? '').localeCompare(String(b.askedAt ?? '')));
  asks.forEach((ask, i) => {
    const decision = DECISION_OF[ask.answer.status];
    if (!decision) return;
    const at = order.indexOf(ask.emits ?? '');
    const after = at > 0 ? order[at - 1] : 'the start';
    lines.push(`ask ${i + 1} (after step ${after}): ${decision}${says(oneLine(ask.answer.reason))}`);
  });
  return lines;
}

/**
 * Fold repeated failures into one line each, by the learnings fold rule (`foldCards`: same check, an agreeing error kind, 60% token overlap), here with the step and
 * verdict as the "job" so only the same step failing the same way folds. Returns the groups in first-seen order.
 * @template {{step: string, verdict: string, gap: string}} T @param {T[]} items @returns {T[][]}
 */
function foldRepeats(items) {
  const cards = items.map((it) => {
    const quote = quoteLines(it.gap).join('\n');
    return { it, job: `${it.step}|${it.verdict}`, check: nameOf(it.gap), kinds: errorKinds(quote).kinds, tokens: flaggedTokens(quote) };
  });
  // `foldCards` only reads job, check, kinds and tokens of a card
  return foldCards(/** @type {any} */ (cards)).map((g) => g.map((c) => /** @type {any} */ (c).it));
}

/**
 * The memo for the try about to run, as text; `''` when nothing has happened yet in this run (no human line, no earlier try).
 * @param {string|null} runDir the run's folder (null = no record = nothing happened)
 * @param {{step: string|null, cap?: number}} o `step` = the step the try belongs to (names its earlier tries and tells a retry from a later step's first try)
 * @returns {string}
 */
export function buildMemo(runDir, { step, cap = MEMO_CAP }) {
  if (typeof runDir !== 'string') return '';
  const order = stepOrder(runDir);
  const human = humanLines(runDir, order);
  // the model tries so far, in file order; a try is labelled by its count within its step (the audit `attempt` restarts after a redo, F130)
  /** @type {Map<string, number>} */
  const seen = new Map();
  const tries = readAudit(runDir)
    .filter((r) => r && r.model != null && typeof r.step === 'string' && r.verdict !== 'stopped')
    .map((r) => {
      const n = (seen.get(r.step) ?? 0) + 1;
      seen.set(r.step, n);
      return { step: /** @type {string} */ (r.step), n, verdict: String(r.verdict), gap: oneLine(r.gap) };
    });
  if (human.length === 0 && tries.length === 0) return '';

  const last = tries.at(-1) ?? null;
  // item 6: the newest failure's words are left out when the retry (the same step, straight after a failure) already gets them as its gap
  const retryGetsGap = last !== null && last.step === step && !WELL.has(last.verdict);
  const earlier = tries.slice(0, -1);
  const sameStep = earlier.filter((t) => t.step === step);
  const failures = earlier.filter((t) => t.step !== step && !WELL.has(t.verdict));
  const label = (/** @type {{step: string, n: number, verdict: string, gap: string}} */ t) => `step ${t.step} try ${t.n} — result: ${t.verdict}`;
  const gapOf = (/** @type {{gap: string}} */ t) => (t.gap === '' ? '' : ` — ${cutGap(t.gap)}`);
  const foldLine = (/** @type {string} */ kind, /** @type {any[]} */ g) => ({ kind, text: `${kind}: ${label(g[0])}${gapOf(g[0])}${g.length > 1 ? ` (x${g.length})` : ''}` });

  const lastLine = last === null ? [] : [{ kind: 'last', text: `last try: ${label(last)}${retryGetsGap ? '' : gapOf(last)}` }];
  const tryLines = foldRepeats(sameStep).map((g) => foldLine('earlier try', g));
  const failLines = foldRepeats(failures).map((g) => foldLine('earlier failure', g));
  let work = [...lastLine, ...tryLines, ...failLines];
  let cut = false;
  const text = () => [MEMO_HEADING, ...human, ...work.map((w) => w.text), ...(cut ? [MEMO_CUT_NOTE] : [])].join('\n');
  // item 5: oldest tries first, then oldest failures; the heading, the human lines and the last-try line stay
  while (text().length > cap) {
    const drop = work.find((w) => w.kind === 'earlier try') ?? work.find((w) => w.kind === 'earlier failure');
    if (!drop) break;
    work = work.filter((w) => w !== drop);
    cut = true;
  }
  return text();
}
