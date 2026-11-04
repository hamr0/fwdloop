// F130 (M14 POC a): throwaway memo renderer. READS ONLY a run folder; writes nothing into it. Never imported by src.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename, dirname } from 'node:path';

export const HEADING = 'What has happened so far in this run (written by code from the run\'s own record):';
export const CAP = 4000;

const rj = (p) => JSON.parse(readFileSync(p, 'utf8'));
const FAIL_OK = new Set(['green', 'hitl']);

/** @returns every fact the memo needs, from the run's existing files, plus a list of missing facts */
export function loadRun(runDir) {
  const missing = [];
  const rows = readFileSync(join(runDir, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l, idx) => ({ ...JSON.parse(l), idx }));
  const decl = rj(join(runDir, 'job', 'declaration.json'));
  const order = decl.steps.map((s) => s.emits);
  const files = readdirSync(runDir);
  const asks = {};
  if (existsSync(join(runDir, 'asks'))) for (const f of readdirSync(join(runDir, 'asks'))) { const a = rj(join(runDir, 'asks', f)); asks[a.askId] = a; }
  const answers = files.filter((f) => /^answer\..*\.consumed\.json$/.test(f)).map((f) => rj(join(runDir, f)));
  let lineage = []; // [{ask, answer, ownRun}] in order
  // a rerun: its own folder name `run-N-rerun-M` is the ONLY link to the parent run that holds the human's rerun reason
  const m = /^(.*)-rerun-\d+$/.exec(basename(runDir));
  const parentAnswers = [];
  if (m) {
    const pdir = join(dirname(runDir), m[1]);
    missing.push({ fact: 'the rerun reason and which ask it answered', neededIn: 'this run\'s own files (run.json / state.json / audit row): only the parent folder name in the path links to it', foundVia: pdir });
    if (existsSync(pdir)) {
      const pasks = {};
      for (const f of readdirSync(join(pdir, 'asks'))) { const a = rj(join(pdir, 'asks', f)); pasks[a.askId] = a; }
      const pdecl = rj(join(pdir, 'job', 'declaration.json'));
      for (const f of readdirSync(pdir).filter((x) => /^answer\..*\.consumed\.json$/.test(x))) {
        const a = rj(join(pdir, f));
        if (a.decision === 'rerun') parentAnswers.push({ answer: a, ask: pasks[a.askId], order: pdecl.steps.map((s) => s.emits), parent: true });
      }
    }
  }
  // pair each ask (by askedAt) with its k-th `paused` row of the ask step, then the next non-paused row of that step = the decision row
  const askList = Object.values(asks).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  const perStep = {};
  const humans = [];
  for (const ask of askList) {
    const k = perStep[ask.emits] = (perStep[ask.emits] ?? 0) + 1;
    const paused = rows.filter((r) => r.step === ask.emits && r.verdict === 'paused')[k - 1];
    const answer = answers.find((a) => a.askId === ask.askId);
    if (!answer) { humans.push({ ask, answer: null, decisionIdx: null, unanswered: true }); continue; }
    const dec = paused ? rows.find((r) => r.idx > paused.idx && r.step === ask.emits && r.verdict !== 'paused') : null;
    humans.push({ ask, answer, decisionIdx: dec ? dec.idx : null, decision: dec ?? null, order });
  }
  return { runDir, rows, order, humans, parentAnswers, missing, decl };
}

function stepBefore(order, emits) { const i = order.indexOf(emits); return i > 0 ? order[i - 1] : null; }
const cleanReason = (r) => (typeof r === 'string' ? r.replace(/[\r\n]+/g, ' ').trim() : '');
const fold = (items, key) => { const out = []; const seen = new Map(); for (const it of items) { const k = key(it); if (seen.has(k)) seen.get(k).n += 1; else { const o = { ...it, n: 1 }; seen.set(k, o); out.push(o); } } return out; };

/** the memo for the model row at `rowIdx`; null when nothing has happened yet */
export function buildMemo(run, rowIdx, { cap = CAP } = {}) {
  const R = run.rows[rowIdx] ?? { step: null, idx: rowIdx }; // rowIdx === rows.length: a virtual next try after the whole record
  const before = run.rows.filter((r) => r.idx < rowIdx);
  // ---- human lines, in run order (parent run's rerun answers first)
  const human = [];
  let n = 0;
  for (const p of run.parentAnswers) {
    n += 1;
    human.push({ n, text: line(n, p.order, p.ask.emits, p.answer) });
  }
  for (const h of run.humans) {
    if (!h.answer || h.decisionIdx === null || h.decisionIdx >= rowIdx) { if (h.answer || h.unanswered) n += 1; continue; }
    n += 1;
    human.push({ n, text: line(n, h.order, h.ask.emits, h.answer) });
  }
  // ---- work lines
  const modelRows = before.filter((r) => r.model !== null && r.model !== undefined);
  const ordinal = (r) => run.rows.filter((x) => x.idx <= r.idx && x.step === r.step && x.model != null).length;
  const mk = (r, kind, withGap) => ({ kind, rowIdx: r.idx, step: r.step, ord: ordinal(r), verdict: r.verdict, gap: withGap && r.gap ? String(r.gap).replace(/\s+/g, ' ') : null });
  const last = modelRows.length ? modelRows[modelRows.length - 1] : null;
  const retryGap = last && last.step === R.step && !FAIL_OK.has(last.verdict); // the retry gets this failure as its gap (item 6)
  const lastObj = last ? mk(last, 'last', !retryGap) : null;
  const sameStep = modelRows.filter((r) => r.step === R.step && r !== last).map((r) => mk(r, 'try', true));
  const failures = modelRows.filter((r) => r.step !== R.step && r !== last && !FAIL_OK.has(r.verdict)).map((r) => mk(r, 'fail', true));
  const foldKey = (o) => `${o.step}|${o.verdict}|${o.gap}`;
  const tries = fold(sameStep, foldKey);
  const fails = fold(failures, foldKey);
  const render = (o) => {
    const base = o.kind === 'last' ? `last try: step ${o.step} try ${o.ord} — result: ${o.verdict}` : o.kind === 'try' ? `earlier try: step ${o.step} try ${o.ord} — result: ${o.verdict}` : `earlier failure: step ${o.step} try ${o.ord} — result: ${o.verdict}`;
    return base + (o.gap ? ` — ${o.gap}` : '') + (o.n > 1 ? ` (x${o.n})` : '');
  };
  if (human.length === 0 && !lastObj) return null;
  let work = [...(lastObj ? [lastObj] : []), ...tries, ...fails];
  const cutLog = [];
  const text = () => [HEADING, ...human.map((h) => h.text), ...work.map(render)].join('\n');
  // cut order: oldest earlier-tries first, then oldest failures, then (last resort, reported) the last-try line; heading + human lines never
  while (text().length > cap) {
    const t = work.find((w) => w.kind === 'try') ?? work.find((w) => w.kind === 'fail') ?? work.find((w) => w.kind === 'last');
    if (!t) break;
    work = work.filter((w) => w !== t);
    cutLog.push(`${t.kind}:${t.step}#${t.ord}`);
  }
  const out = text();
  return { text: out, human, work, cutLog, overCap: out.length > cap, chars: out.length };
}

function line(n, order, emits, a) {
  const x = stepBefore(order, emits);
  const r = cleanReason(a.reason);
  return `ask ${n} (after step ${x ?? 'the start'}): ${a.decision}${r ? ` — user says "${r}"` : ''}`;
}

/** every model-step try of a run (row index) */
export const modelTries = (run) => [...run.rows.filter((r) => r.model != null).map((r) => r.idx), run.rows.length]; // + the virtual try after the record
