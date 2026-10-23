// F79 POC adapter: fwdloop run records -> the event list bareloop's buildCards reads. ONE adapter; map, never invent.
// Reads flows/<wf>/runs/<run>/{log.json,audit.jsonl,checks.jsonl,job/*,inputs.json}. flows/ is real PII: nothing read here is committed.
import fs from 'node:fs';
import path from 'node:path';

const rd = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null);
const jl = (f) => (rd(f) ?? '').split('\n').filter(Boolean).map((l) => JSON.parse(l));

/** Unified -U1 line diff (LCS). 4 KB cap like bareloop's attempt-diff. Returns '' when identical. */
export function unifiedDiff(a, b, ctx = 1) {
  const A = a === '' ? [] : a.split('\n'), B = b.split('\n');
  const n = A.length, m = B.length;
  const L = Array.from({ length: n + 1 }, () => new Int32Array(m + 1));
  for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
  const ops = []; // [' '|'-'|'+', line]
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { ops.push([' ', A[i]]); i += 1; j += 1; } else if (L[i + 1][j] >= L[i][j + 1]) { ops.push(['-', A[i]]); i += 1; } else { ops.push(['+', B[j]]); j += 1; }
  }
  while (i < n) { ops.push(['-', A[i]]); i += 1; }
  while (j < m) { ops.push(['+', B[j]]); j += 1; }
  const keep = ops.map(() => false);
  ops.forEach((o, k) => { if (o[0] !== ' ') for (let d = -ctx; d <= ctx; d += 1) if (ops[k + d]) keep[k + d] = true; });
  const out = [];
  let k = 0, ai = 1, bi = 1; const pos = ops.map((o) => { const p = [ai, bi]; if (o[0] !== '+') ai += 1; if (o[0] !== '-') bi += 1; return p; });
  while (k < ops.length) {
    if (!keep[k]) { k += 1; continue; }
    let e = k; while (e < ops.length && keep[e]) e += 1;
    const seg = ops.slice(k, e);
    out.push(`@@ -${pos[k][0]},${seg.filter((o) => o[0] !== '+').length} +${pos[k][1]},${seg.filter((o) => o[0] !== '-').length} @@`);
    for (const [c, t] of seg) out.push(c + t);
    k = e;
  }
  return out.join('\n');
}

/** All runs with attempts, as {wf, run, at, events, spec, model, specHash, raw}. */
export function loadRuns(flowsRoot) {
  const runs = [];
  for (const wf of fs.readdirSync(flowsRoot)) {
    if (wf.startsWith('.')) continue;
    const rdir = path.join(flowsRoot, wf, 'runs');
    if (!fs.existsSync(rdir)) continue;
    for (const run of fs.readdirSync(rdir)) {
      const d = path.join(rdir, run);
      const logT = rd(path.join(d, 'log.json'));
      if (!logT) continue;
      const log = JSON.parse(logT);
      const audit = jl(path.join(d, 'audit.jsonl'));
      const checks = jl(path.join(d, 'checks.jsonl'));
      const prose = rd(path.join(d, 'job', 'prose.txt')) ?? '';
      const decl = JSON.parse(rd(path.join(d, 'job', 'declaration.json')) ?? '{"steps":[]}');
      const inputs = JSON.parse(rd(path.join(d, 'inputs.json')) ?? '[]');
      const state = JSON.parse(rd(path.join(d, 'state.json')) ?? '{}');
      runs.push({ wf, run, d, log, audit, checks, prose, decl, inputs, state });
    }
  }
  return runs.map(toRecord).filter(Boolean).sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
}

// audit.jsonl rows that are a step's TRY with a verdict on its output. Left out (not a red/green close on output):
// null-attempt rows (stop-asked, ask-reopened), verdicts paused/stopped/cap-halt (a pause, a human stop, a funding halt),
// and a human redo (class hitl + verdict red: bareloop makes no card for a human redo, Q1).
const isTry = (r) => Number.isInteger(r.attempt) && ['green', 'hitl', 'softgreen', 'red', 'not-done'].includes(r.verdict) && !(r.class === 'hitl' && r.verdict === 'red');

function toRecord({ wf, run, d, log, audit, checks, prose, decl, inputs, state }) {
  const rows = audit.filter(isTry);
  if (!rows.length) return null;
  const outBy = new Map((log.attempts || []).map((a) => [`${a.step}#${a.attempt}`, a.modelOutput]));
  const lastAt = audit.at(-1)?.at ?? '1970-01-01T00:00:00.000Z';
  const model = audit.find((r) => typeof r.model === 'string')?.model ?? null;
  const stepMeta = new Map((decl.steps || []).map((s) => [s.emits, s]));
  const failText = new Map(); // check name -> the failing check's own text (checks.jsonl), if any
  const events = [];
  let seq = 0; let ts = audit[0]?.at ?? lastAt;
  const push = (e) => events.push({ seq: (seq += 1), ts, ...e });
  const goal = prose.split(/\n\s*\n/)[0].trim();
  push({ type: 'job-start', job: wf, goal, model });
  push({ type: 'plan-accepted', plan: { steps: (decl.steps || []).map((s) => ({ id: s.emits, action: s.goal })) } });
  const prevOut = new Map();
  for (const a of rows) {
    ts = a.at ?? ts;
    const meta = stepMeta.get(a.step);
    const name = `${a.step} (line ${meta?.fromLine ?? '?'}, ${a.class})`;
    push({ type: 'step-start', step: a.step });
    push({ type: 'iteration-start' });
    const mo = outBy.get(`${a.step}#${a.attempt}`);
    const hasFile = fs.existsSync(path.join(d, 'artifacts', `${a.step}.json`));
    let diff = '';
    if (mo !== undefined) { const after = JSON.stringify(mo, null, 2); diff = unifiedDiff(prevOut.has(a.step) ? prevOut.get(a.step) : '', after); prevOut.set(a.step, after); }
    if (hasFile) push({ type: 'attempt-diff', files: [{ path: `artifacts/${a.step}.json`, diff: diff.slice(0, 4096), truncated: diff.length > 4096 }], binary: [], truncated: false });
    const red = (a.verdict === 'red' || a.verdict === 'not-done') && typeof a.gap === 'string' && a.gap !== '';
    if (red) {
      const ck = checks.find((c) => c.step === a.step && c.try === a.attempt);
      const f = ck?.checks?.find((x) => !x.ok);
      if (f && !failText.has(name)) failText.set(name, String(f.text));
      push({ type: 'exit-eval', step: a.step, results: [{ type: name, pass: false, detail: a.gap }] }); // gap verbatim, no wrapper line
    } else {
      push({ type: 'exit-eval', step: a.step, results: [{ type: name, pass: true }] });
    }
  }
  ts = lastAt;
  push({ type: 'job-end', outcome: log.outcome === 'complete' ? 'green' : String(log.outcome) });
  const src = inputs[0]?.source;
  return { wf, run, at: lastAt, events, model, failText, specHash: state.signatureHash ?? null, spec: { job: wf, inputs: src ? [{ value: src }] : [] }, outcome: log.outcome, nTries: rows.length };
}
