// F130 runner: builds the memo for every model-step try of the chosen real runs, checks bars 1-6 (+ selftest by breaking each check once). $0, no network.
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadRun, buildMemo, modelTries, HEADING, CAP } from './memo.mjs';

const FLOWS = join(homedir(), '.config/fwdloop/flows');
export const RUNS = ['aging-live-4/runs/run-24', 'm7-walk-2/runs/run-2', 'm7-walk-2/runs/run-6', 'm10b-aging/runs/run-1-rerun-1'];
const OUT = join(fileURLToPath(new URL('.', import.meta.url)), 'out');
const BANNED = [/\$/, /usd/i, /cost/i, /\bms\b/i, /\d\s?ms/i, /second/i, /wallms/i, /minute/i];

/** independent expectation: answers visible to try R, by TIME (answeredAt <= the try's start = at - wallMs), in run order */
function expectedHumanLines(run, R) {
  const startMs = Date.parse(R.at) - (R.wallMs ?? 0);
  const asksSorted = run.humans.map((h) => h.ask).filter(Boolean).sort((a, b) => a.askedAt.localeCompare(b.askedAt));
  const out = [];
  let off = run.parentAnswers.length;
  run.parentAnswers.forEach((p, i) => out.push({ at: Date.parse(p.answer.answeredAt), want: `ask ${i + 1} (after step ${p.order[p.order.indexOf(p.ask.emits) - 1]}): ${p.answer.decision}${p.answer.reason ? ` — user says "${p.answer.reason}"` : ''}` }));
  asksSorted.forEach((ask, i) => {
    const h = run.humans.find((x) => x.ask === ask);
    if (!h.answer) return;
    if (Date.parse(h.answer.answeredAt) > startMs) return;
    const before = run.order[run.order.indexOf(ask.emits) - 1];
    out.push({ at: Date.parse(h.answer.answeredAt), want: `ask ${off + i + 1} (after step ${before}): ${h.answer.decision}${h.answer.reason && h.answer.reason.trim() ? ` — user says "${h.answer.reason.trim()}"` : ''}` });
  });
  return out.sort((a, b) => a.at - b.at).map((x) => x.want);
}

export function evaluate(runs, memoFn = buildMemo, opts = {}) {
  const bars = { b1: [], b2: [], b3: [], b4: [], b5: [], b6: [] };
  const samples = [];
  for (const run of runs) {
    for (const h of run.humans) { // decision row must agree with the answer file (else a fact is missing)
      if (h.unanswered) continue;
      const okv = h.decision && ((h.answer.decision === 'accept' && h.decision.verdict === 'green') || (h.answer.decision !== 'accept' && h.decision.verdict === 'red' && h.decision.gap === h.answer.reason));
      if (!okv) bars.b6.push(`${run.runDir}: answer ${h.answer.askId} has no matching decision row in audit.jsonl`);
    }
    for (const m of run.missing) bars.b6.push(`${run.runDir}: ${m.fact} - needed in ${m.neededIn}`);
    for (const idx of modelTries(run)) {
      const R = run.rows[idx] ?? { step: '(virtual next try)', at: '9999-01-01T00:00:00Z', wallMs: 0 };
      const memo = memoFn(run, idx, opts);
      const lines = memo ? memo.text.split('\n') : [];
      const humanLines = lines.filter((l) => /^ask \d+ \(after step /.test(l));
      const want = expectedHumanLines(run, R);
      // bar 1: exact list, in order
      if (JSON.stringify(humanLines) !== JSON.stringify(want)) bars.b1.push(`${run.runDir} row ${idx} (${R.step}): got ${JSON.stringify(humanLines)} want ${JSON.stringify(want)}`);
      // bar 2: a "user says" line only for a non-blank reason
      const wantSays = want.filter((l) => l.includes('user says')).length;
      if (humanLines.filter((l) => l.includes('user says')).length !== wantSays) bars.b2.push(`${run.runDir} row ${idx}: user-says count mismatch`);
      for (const l of humanLines) if (/: (accept|redo|rerun)$/.test(l) === l.includes('user says')) bars.b2.push(`${run.runDir} row ${idx}: line shape ${l}`);
      // bar 3: each work line's result == the audit row's verdict, found by step + ordinal in a FRESH read of audit.jsonl
      for (const l of lines) {
        const mm = /^(?:last try|earlier try|earlier failure): step (\S+) try (\d+) — result: (\S+)/.exec(l);
        if (!mm) continue;
        const rowsOf = run.rows.filter((r) => r.step === mm[1] && r.model != null);
        const r = rowsOf[Number(mm[2]) - 1];
        if (!r || r.verdict !== mm[3] || r.idx >= idx) bars.b3.push(`${run.runDir} row ${idx}: "${l}" vs audit ${r ? r.verdict : 'none'}`);
      }
      // bar 4
      if (memo) for (const re of BANNED) if (re.test(memo.text)) bars.b4.push(`${run.runDir} row ${idx}: ${re} in memo`);
      // bar 5: cap
      if (memo && memo.chars > CAP) bars.b5.push(`${run.runDir} row ${idx}: ${memo.chars} chars`);
      if (memo && memo.text.split('\n')[0] !== HEADING) bars.b5.push(`${run.runDir} row ${idx}: heading missing`);
      samples.push({ run: run.runDir, row: idx, step: R.step, attempt: R.attempt, chars: memo ? memo.chars : 0, memo: memo ? memo.text : null });
    }
  }
  return { bars, samples };
}

/** bar 5 forced cut: tiny cap on every try; human lines + heading intact, cut order tries -> failures -> last, oldest first */
export function forcedCut(runs, cap, memoFn = buildMemo) {
  const fails = []; let cutsSeen = 0; const kindsSeen = new Set();
  for (const run of runs) for (const idx of modelTries(run)) {
    const full = memoFn(run, idx, { cap: CAP });
    const small = memoFn(run, idx, { cap });
    if (!full || !small) continue;
    const fl = full.text.split('\n'); const sl = small.text.split('\n');
    const keep = (a) => a.filter((l) => l === HEADING || /^ask \d+ \(after step /.test(l));
    if (JSON.stringify(keep(fl)) !== JSON.stringify(keep(sl))) fails.push(`${run.runDir} row ${idx}: heading/human lines changed by the cut`);
    if (small.cutLog.length) {
      cutsSeen += 1;
      const order = small.cutLog.map((c) => c.split(':')[0]);
      const rank = { try: 0, fail: 1, last: 2 };
      for (let i = 1; i < order.length; i++) if (rank[order[i]] < rank[order[i - 1]]) fails.push(`${run.runDir} row ${idx}: cut order ${order.join(',')}`);
      order.forEach((o) => kindsSeen.add(o));
      // oldest first within a kind: the removed lines' rowIdx ascend, i.e. what survives of that kind is newer than what was cut
      for (const kind of ['try', 'fail']) {
        const gone = fl.filter((l) => !sl.includes(l) && l.startsWith(kind === 'try' ? 'earlier try' : 'earlier failure'));
        const left = sl.filter((l) => l.startsWith(kind === 'try' ? 'earlier try' : 'earlier failure'));
        if (gone.length && left.length) { const pos = (l) => fl.indexOf(l); if (Math.max(...gone.map(pos)) > Math.min(...left.map(pos))) fails.push(`${run.runDir} row ${idx}: a newer ${kind} line was cut before an older one`); }
      }
    }
  }
  return { fails, cutsSeen, kindsSeen: [...kindsSeen] };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const runs = RUNS.map((r) => loadRun(join(FLOWS, r)));
  const real = evaluate(runs);
  const cut = forcedCut(runs, 330);
  const cut2 = forcedCut(runs, 120);
  // ---- selftest: break each check once, see red; the real code is the restore
  const breaks = {
    'b1 drop a human line': (run, idx, o) => { const m = buildMemo(run, idx, o); if (!m) return m; const ls = m.text.split('\n'); const i = ls.findIndex((l) => /^ask \d+/.test(l)); if (i > 0) ls.splice(i, 1); return { ...m, text: ls.join('\n') }; },
    'b1 swap human order': (run, idx, o) => { const m = buildMemo(run, idx, o); if (!m) return m; const ls = m.text.split('\n'); const a = ls.map((l, i) => (/^ask \d+/.test(l) ? i : -1)).filter((i) => i >= 0); if (a.length > 1) [ls[a[0]], ls[a[1]]] = [ls[a[1]], ls[a[0]]]; return { ...m, text: ls.join('\n') }; },
    'b2 blank gets a user-says': (run, idx, o) => { const m = buildMemo(run, idx, o); return m && { ...m, text: m.text.replace(/(: accept)$/m, '$1 — user says "x"') }; },
    'b3 wrong verdict': (run, idx, o) => { const m = buildMemo(run, idx, o); return m && { ...m, text: m.text.replace(/result: red/, 'result: green') }; },
    'b4 money in memo': (run, idx, o) => { const m = buildMemo(run, idx, o); return m && { ...m, text: `${m.text}\nspent $0.01` }; },
    'b5 cap ignored': (run, idx, o) => { const m = buildMemo(run, idx, o); return m && { ...m, chars: 9999 }; },
  };
  const selftest = {};
  for (const [k, fn] of Object.entries(breaks)) { const e = evaluate(runs, fn); const key = k.slice(0, 2); selftest[k] = e.bars[key].length > 0 ? 'RED (check can fail)' : 'STILL GREEN (check is blind)'; }
  // forced-cut breaks: a cut that eats a human line; a cut that cuts failures before tries
  const eatHuman = (run, idx, o) => { const m = buildMemo(run, idx, o); if (!m || o.cap === CAP || o.cap === undefined) return m; const ls = m.text.split('\n'); const i = ls.findIndex((l) => /^ask \d+/.test(l)); if (i > 0) ls.splice(i, 1); return { ...m, text: ls.join('\n') }; };
  selftest['b5 cut eats a human line'] = forcedCut(runs, 330, eatHuman).fails.length ? 'RED (check can fail)' : 'STILL GREEN (check is blind)';
  const wrongOrder = (run, idx, o) => { const m = buildMemo(run, idx, o); if (!m) return m; return { ...m, cutLog: [...m.cutLog].reverse() }; };
  selftest['b5 wrong cut order'] = forcedCut(runs, 120, wrongOrder).fails.length ? 'RED (check can fail)' : 'STILL GREEN (check is blind)';
  const summary = {
    bars: Object.fromEntries(Object.entries(real.bars).map(([k, v]) => [k, { pass: v.length === 0, failures: v }])),
    forcedCut330: cut, forcedCut120: cut2, selftest,
    triesChecked: real.samples.length, memosNonNull: real.samples.filter((s) => s.memo).length, maxChars: Math.max(...real.samples.map((s) => s.chars)),
  };
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ summary, samples: real.samples }, null, 1));
  console.log(JSON.stringify(summary, null, 1));
}
