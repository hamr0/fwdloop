// M20 F269 Q1+Q2: $0 cross-tab parity and leg-scope read of a flows-root COPY.
// usage: HOME=<scratch home> node poc/m20-f269/parity.harness.mjs <rootCopy> <out.json>
// Calls the panel getters like poc/m20-p1/snapshot.harness.mjs (pinned now), then compares what two tabs say
// about the same run fact. Read-only: it reads the copy's run files and writes only <out.json>.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { listFlowNames, listRunIds } from '../../src/flow.js';
import { listRuns, getRunDetail, getRunAudit, getRunResult, getRunAsks } from '../../src/panel/data.js';
import { loadCatalogue } from '../../src/catalogue.js';

const [rootArg, outArg] = process.argv.slice(2);
if (!rootArg || !outArg) { console.error('usage: parity.harness.mjs <rootCopy> <out.json>'); process.exit(2); }
const root = resolve(rootArg);
if (/\/\.config\/fwdloop\/flows\/?$/.test(root)) { console.error('refusing: real root'); process.exit(2); }
const now = () => 1795000000000;
const catalogue = loadCatalogue().primitives;
const resumeAttempt = () => null;
const startingRun = () => false;
const triggerRead = () => null;
const jl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return { __bad: l }; } }) : []);
const usd4 = (n) => `$${n.toFixed(4)}`;
const W = { complete: 'passed', skipped: 'skipped', 'cap-halt': 'stopped' };

const list = listRuns({ root, catalogue, resumeAttempt, startingRun, now });
const L = new Map(list.map((r) => [`${r.flow}/${r.runId}`, r]));
const finds = []; // {run, fact, a:[tab,val], b:[tab,val], note}
const add = (run, fact, a, b, note = '') => finds.push({ run, fact, a, b, note });
const emptyRows = []; const info = []; let runs = 0; const multi = [];

for (const flow of listFlowNames(root)) {
  for (const runId of listRunIds(`${root}/${flow}`)) {
    runs += 1;
    const k = `${flow}/${runId}`; const dir = `${root}/${flow}/runs/${runId}`;
    const args = { root, flow, runId, catalogue, resumeAttempt, now };
    const det = getRunDetail({ ...args, startingRun, triggerRead });
    const aud = getRunAudit({ ...args, scheduleRead: triggerRead, startingRun });
    const res = getRunResult(args);
    const ask = getRunAsks(args);
    const lst = L.get(k);
    const pids = jl(`${dir}/pids.jsonl`); const legs = pids.map((p) => p.leg);
    const hist = jl(`${root}/${flow}/history.jsonl`).filter((h) => h.runId === runId);
    const audRows = jl(`${dir}/audit.jsonl`); const diary = jl(`${dir}/diary.jsonl`);
    const isMulti = legs.length > 1; if (isMulti) multi.push({ run: k, legs: legs.join('>') });
    // A. how it ended, and the money total across tabs
    if (!lst) add(k, 'in Runs list', ['Runs list', 'absent'], ['getRunDetail', det && det.word]);
    else if (det) {
      if (lst.word !== det.word) add(k, 'end word', ['Runs list', lst.word], ['Run tab', det.word]);
      if (lst.glyph !== det.glyph) add(k, 'end glyph', ['Runs list', lst.glyph], ['Run tab', det.glyph]);
      if (lst.spend !== det.spend) add(k, 'money total', ['Runs list spend', lst.spend], ['Run tab spend', det.spend]);
      const rs = det.summary && det.summary.ended && det.summary.ended.reason;
      if (det.word && rs && !rs.includes(det.word)) add(k, 'end word in summary line', ['Run tab word', det.word], ['Run tab summary.ended.reason', rs]);
      if (det.word && !rs && ['passed', 'failed', 'stopped', 'skipped'].includes(det.word)) add(k, 'summary line present', ['Run tab word', det.word], ['Run tab summary.ended', String(rs)]);
    }
    if (hist[0] && det) {
      const h = hist[hist.length - 1];
      const hw = W[h.outcome] || (h.outcome && /not-done|struck-out|attempt-fallback/.test(h.outcome) ? 'failed' : h.outcome);
      if (hw !== det.word) add(k, 'end word vs history', ['history.jsonl outcome', h.outcome], ['Run tab word', det.word], 'outcome->word map is mine');
      const wantSpend = h.spendComplete === false ? `at least ${usd4(h.spentUsd)}` : usd4(h.spentUsd);
      if (typeof h.spentUsd === 'number' && det.spend !== wantSpend) add(k, 'money total vs history', ['history.jsonl spentUsd/spendComplete', `${wantSpend}`], ['Run tab spend', det.spend]);
      if (hist.length > 1) add(k, 'history rows', ['history.jsonl', `${hist.length} rows`], ['Run tab', 'one'], `outcomes ${hist.map((x) => x.outcome)}`);
    }
    if (aud && det && !aud.empty) {
      const sum = audRows.reduce((s, r) => s + (r.usd || 0), 0);
      const grp = aud.groups.reduce((s, g) => s + (g.rows || []).reduce((t, r) => t + (r.usd || 0), 0), 0);
      if (det.spend && det.spend.startsWith('$') && usd4(sum) !== det.spend) add(k, 'money total vs audit sum', ['audit.jsonl sum', usd4(sum)], ['Run tab spend', det.spend]);
      if (Math.abs(sum - grp) > 1e-9) add(k, 'audit groups vs audit file', ['Audit groups sum', usd4(grp)], ['audit.jsonl sum', usd4(sum)]);
    }
    // C/D. per step
    if (det && det.steps && aud) {
      for (const [i, s] of det.steps.entries()) {
        const g = (aud.groups || []).find((x) => x.step === s.emits);
        const rows = audRows.filter((r) => r.step === s.emits);
        if (!g) { if (rows.length) add(k, `step ${s.emits} has audit rows`, ['Run tab', `groupState ${s.groupState}`], ['audit.jsonl', `${rows.length} rows, no Audit group`]); continue; }
        if (s.groupState !== g.state) add(k, `step ${i + 1} ${s.emits} state`, ['Run tab groupState', s.groupState], ['Audit group state', g.state]);
        if (s.tryCount !== g.tryCount) add(k, `step ${i + 1} ${s.emits} tries`, ['Run tab tryCount', s.tryCount], ['Audit group tryCount', g.tryCount]);
        const maxA = rows.reduce((m, r) => Math.max(m, r.attempt), 0);
        if (g.tryCount !== maxA) add(k, `step ${i + 1} ${s.emits} tries vs file`, ['Audit tryCount', g.tryCount], ['audit.jsonl max attempt', maxA], `legs ${legs.join('>')}`);
        if (JSON.stringify(s.tryMarks) !== JSON.stringify(g.tryMarks)) add(k, `step ${i + 1} ${s.emits} tryMarks`, ['Run tab', JSON.stringify(s.tryMarks)], ['Audit', JSON.stringify(g.tryMarks)]);
        const last = rows[rows.length - 1];
        { const ln = res && res.lines.find((x) => x.text === s.goal); if (ln && ln.checks && !ln.checks.length && diary.some((d) => d.kind === 'checks' && d.step === s.emits && d.checks.some((c) => !c.ok))) emptyRows.push(`${k} ${s.emits} (${ln.kind}, passed=${ln.passed})`); }
        const line = res && res.lines.find((x) => x.text === s.goal);
        const dch = diary.filter((d) => d.kind === 'checks' && d.step === s.emits);
        const lastDch = dch[dch.length - 1];
        const diaryAllOk = lastDch ? lastDch.checks.every((c) => c.ok) : null;
        if (last && lastDch) {
          const red = ['red', 'not-done'].includes(last.verdict);
          if (diaryAllOk && red) add(k, `step ${i + 1} ${s.emits} passed?`, ['diary last checks row', 'all ok'], ['audit last verdict', last.verdict], `try ${lastDch.try} vs attempt ${last.attempt}`);
          if (!diaryAllOk && !red) add(k, `step ${i + 1} ${s.emits} passed?`, ['diary last checks row', 'a check not ok'], ['audit last verdict', last.verdict], `try ${lastDch.try} vs attempt ${last.attempt}`);
        }
        if (line && line.checks && line.checks.length && lastDch) {
          const lok = line.checks.every((c) => c.ok);
          if (lok !== diaryAllOk) add(k, `step ${i + 1} ${s.emits} checks`, ['Result row checks all ok', lok], ['diary last checks row all ok', diaryAllOk]);
        }
        if (line && last && line.checks && line.checks.length && line.checks.every((c) => c.ok) && ['red', 'not-done'].includes(last.verdict)) add(k, `step ${i + 1} ${s.emits} passed?`, ['Result row', 'every check ok'], ['Audit last verdict', 'red']);
        if (line && last && line.checks && line.checks.some((c) => !c.ok) && !['red', 'not-done'].includes(last.verdict)) add(k, `step ${i + 1} ${s.emits} passed?`, ['Result row', 'a check not ok'], ['Audit last verdict', last.verdict]);
      }
    }
    // Q2: what each multi-leg run shows
    if (isMulti && det) {
      const lastLeg = pids[pids.length - 1];
      info.push({
        run: k, legs: legs.join('>'), lastLegAt: lastLeg.startedAt, word: det.word, outcome: det.outcome, stopReason: det.stopReason, stopReasonWhy: det.stopReasonWhy,
        summary: det.summary && det.summary.ended, spend: det.spend, rowsAll: audRows.length, rowsInLastLeg: audRows.filter((r) => r.at >= lastLeg.startedAt).length,
        steps: (det.steps || []).map((s) => `${s.emits}:${s.groupState}/${s.tryCount}`).join(' | '),
        asks: ((ask && ask.asks) || []).map((a) => `${a.status}@${a.emits}`).join(','),
        reopen: det.reopen, lstLine: lst && lst.line, resume: det.resume, gap: res && res.gap, histOutcomes: hist.map((h) => h.outcome),
        files: ['halt.json', 'ask.json', 'stop.json'].filter((f) => existsSync(`${dir}/${f}`)),
      });
    }
  }
}
writeFileSync(outArg, `${JSON.stringify({ runs, multi: multi.length, finds, emptyRows, info }, null, 1)}\n`);
console.log(`runs=${runs} multiLeg=${multi.length} finds=${finds.length}`);
