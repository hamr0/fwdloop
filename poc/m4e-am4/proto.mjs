// M4e am4/am5 POC ($0, fake providers). Aimed at the three riskiest assumptions of items 4/6 + amendment 5:
//   p1 a cap-halted run continues as the SAME run id under a new human-signed cap version
//   p2 a stop file read after step k closes ends the run `stopped` (step k booked, no step k+1)
//   p3 a per-run signed-values record decides destination / cap / ask wait for THAT run only
// The runner is exercised for real: src/ is COPIED to poc/m4e-am4/.proto/src and patched by exact string anchors
// (each anchor must match exactly once, else the POC aborts): foldFromStep exported, the stop seam after a closed
// model step, and an overlay hook that reads the per-run values after readFlow. Nothing in src/ is touched.
// Run: node poc/m4e-am4/proto.mjs      (prints PASS/FAIL per row; exit 1 on any FAIL)
import {
  cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..', '..');
const PROTO = join(HERE, '.proto');
const SCRATCH = mkdtempSync(join(tmpdir(), 'fwdloop-m4e-am4-poc-'));
process.env.HOME = join(SCRATCH, 'home'); // never the real home (checkSendDestination reads configDoorHome)
mkdirSync(process.env.HOME, { recursive: true });
delete process.env.FWDLOOP_CONFIG_HOME;

// ---- patched copy of src/ ------------------------------------------------------------------------------------------
rmSync(PROTO, { recursive: true, force: true });
cpSync(join(REPO, 'src'), join(PROTO, 'src'), { recursive: true });
const rp = join(PROTO, 'src', 'runner.js');
let code = readFileSync(rp, 'utf8');
function patch(anchor, replacement) {
  const n = code.split(anchor).length - 1;
  if (n !== 1) throw new Error(`POC patch anchor matched ${n} times (need exactly 1): ${anchor.slice(0, 60)}`);
  code = code.replace(anchor, () => replacement);
}
patch('async function foldFromStep({', 'export async function foldFromStep({');
patch(
  "      runUnjudged.push({ step: step.goal ?? null, emits: step.emits, artifact: stepResult.artifact });\n    }\n",
  "      runUnjudged.push({ step: step.goal ?? null, emits: step.emits, artifact: stepResult.artifact });\n    }\n"
  + "    if (i < steps.length - 1 && existsSync(join(runDir, 'stop.request'))) {\n"
  + "      unlinkSync(join(runDir, 'stop.request'));\n"
  + "      return haltRun({ flowDir, runDir, runId, capUsd, startedAt: runStartedAt, now, nowMs, signatureHash, spent, priorSpendComplete: spendComplete.value, attempts: attemptsLog, artifacts, outcome: 'stopped', red: `stopped by you after step ${i + 1}` });\n"
  + '    }\n',
);
patch(
  '  const { arbiter, declaration, signature } = read;\n  const capUsd = arbiter.capUsd;',
  '  const { declaration, signature } = read;\n  const arbiter = globalThis.__overlay ? globalThis.__overlay(read.arbiter, runIdCheck.runDir) : read.arbiter;\n  const capUsd = arbiter.capUsd;',
);
patch(
  '    const { declaration, arbiter, signature } = read;\n',
  '    const { declaration, signature } = read;\n    const arbiter = globalThis.__overlay ? globalThis.__overlay(read.arbiter, runDir) : read.arbiter;\n',
);
if (!/import \{[^}]*unlinkSync/.test(code)) throw new Error('runner imports no unlinkSync');
writeFileSync(rp, code);
const R = await import(pathToFileURL(rp).href);
const { writeFlow, readFlow } = await import(pathToFileURL(join(PROTO, 'src', 'flow.js')).href);
const { loadCatalogue } = await import(pathToFileURL(join(PROTO, 'src', 'catalogue.js')).href);
const { answerAsk } = await import(pathToFileURL(join(PROTO, 'src', 'ask.js')).href);
const { sendViaPrimitive } = await import(pathToFileURL(join(PROTO, 'src', 'send.js')).href);
const { appendAudit } = await import(pathToFileURL(join(PROTO, 'src', 'books.js')).href);
const CAT = loadCatalogue().primitives;

// ---- harness -------------------------------------------------------------------------------------------------------
let fails = 0;
const row = (id, ok, msg) => { if (!ok) fails += 1; console.log(`${ok ? 'PASS' : 'FAIL'} ${id}: ${msg}`); };
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const fx = (n) => readFileSync(join(REPO, 'test', 'fixtures', n), 'utf8');
const lines = (p) => readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));

function mkWorld(tag, askMark = 'ask 30m:') {
  const d = join(SCRATCH, tag);
  const out = { root: join(d, 'flows'), src: join(d, 'src'), destA: join(d, 'destA'), destB: join(d, 'destB') };
  for (const p of Object.values(out)) mkdirSync(p, { recursive: true });
  writeFileSync(join(out.src, 'resume.docx'), 'Resume text.');
  writeFileSync(join(out.src, 'jd.md'), 'JD text.');
  const prose = fx('job2-with-sources.signed.txt').replaceAll('file:poc/m0/out', `file:${out.destA}`).replace('4. ask: check it with me,', `4. ${askMark} check it with me,`);
  const w = writeFlow({
    root: out.root, name: 'flow', proseText: prose, declaration: JSON.parse(fx('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T00:00:00Z', catalogue: CAT,
  });
  if (!w.ok) throw new Error(w.reds.join('; '));
  out.sources = [{ id: 'resume', path: join(out.src, 'resume.docx') }, { id: 'jd', path: join(out.src, 'jd.md') }];
  out.flowDir = join(out.root, 'flow');
  return out;
}

function makeStep(onCall) {
  const calls = { 'resume-text': 0, 'jd-text': 0, 'resume-summary': 0 };
  const fn = async (ctx) => {
    let key; let text;
    if (ctx.goal.includes('resume .docx')) { key = 'resume-text'; text = 'resume text'; } else if (ctx.goal.includes('job description markdown')) { key = 'jd-text'; text = 'jd text'; } else {
      key = 'resume-summary';
      text = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
    }
    calls[key] += 1;
    if (onCall) await onCall(key, calls);
    return { ok: true, costUsd: 0.001, artifact: { text, done: true } };
  };
  return { fn, calls };
}
const baseArgs = (w, modelStep, runId, extra = {}) => ({
  root: w.root, name: 'flow', runId, catalogue: CAT, modelStep, sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-06-01', ceilingUsd: 0.01, askStep: R.makeParkingAskStep(), ...extra,
});

/** The prototype of `continueRun`: re-enter the SAME fold at the first step with no artifact, accumulators rebuilt from the run's own books. */
async function continueProto(w, runId, modelStep, newCap) {
  const runDir = join(w.flowDir, 'runs', runId);
  const read = readFlow({ root: w.root, name: 'flow', catalogue: CAT });
  const { declaration, arbiter, signature } = read;
  const steps = declaration.steps;
  let i0 = 0;
  while (i0 < steps.length && R.readArtifactResult(runDir, steps[i0].emits).ok) i0 += 1;
  const rows = lines(join(runDir, 'audit.jsonl')).filter((r) => r.verdict !== 'cap-halt');
  const spent = { value: rows.reduce((a, r) => a + r.usd, 0) };
  const spendComplete = { value: rows.every((r) => r.spendComplete !== false) };
  const artifacts = {};
  for (let i = 0; i < i0; i += 1) artifacts[steps[i].emits] = R.readArtifact(runDir, steps[i].emits);
  const auditRows = [];
  const attemptsLog = [];
  const recordAudit = (r, mo) => { auditRows.push(r); appendAudit(runDir, r); if (r.spendComplete === false) spendComplete.value = false; if (mo !== undefined) attemptsLog.push({ step: r.step, attempt: r.attempt, verdict: r.verdict, modelOutput: mo }); };
  const askLines = new Map((arbiter.asks ?? []).map((a) => [a.line, a]));
  const sendLines = new Map((arbiter.sends ?? []).map((s) => [s.line, s]));
  const askStepEmits = new Set(steps.filter((s) => askLines.has(s.fromLine)).map((s) => s.emits));
  const manifest = JSON.parse(readFileSync(join(runDir, 'inputs.json'), 'utf8'));
  return R.foldFromStep({
    i0, steps, askLines, sendLines, askStepEmits, runDir, flowDir: w.flowDir, runId, flowRoot: w.root, flowName: 'flow', signatureHash: signature.flow, inputsManifest: manifest,
    capUsd: newCap, redoCap: arbiter.redoCap ?? 3, effectiveCeilingUsd: 0.01, primitives: {}, businessDate: '2026-06-01', modelStep, askStep: R.makeParkingAskStep(), sendStep: sendViaPrimitive,
    now: () => new Date().toISOString(), startedAt: Date.now(), runStartedAt: Date.now(), nowMs: Date.now, spent, spendComplete, artifacts, acceptedThisRun: false,
    acceptedAskEmitsThisRun: new Map(), unjudgedSinceLastAsk: [], recordAudit, attemptsLog,
  });
}

// ---- p1: cap-halt -> continue under a new signed cap ---------------------------------------------------------------
{
  const w = mkWorld('p1');
  const { fn, calls } = makeStep();
  globalThis.__overlay = (arb) => ({ ...arb, capUsd: 0.0105 }); // the run signed a cap that funds step 1 only (ceiling 0.01)
  const r1 = await R.runFlow({ ...baseArgs(w, fn, 'run-1'), sources: w.sources });
  const runDir = join(w.flowDir, 'runs', 'run-1');
  row('p1.a', r1.outcome === 'cap-halt', `run 1 cap-halts at step 2 (outcome=${r1.outcome}); steps called: ${JSON.stringify(calls)}`);
  const before = {
    prose: sha(join(w.flowDir, 'prose.txt')), sig: sha(join(w.flowDir, 'signature.json')), art1: sha(join(runDir, 'artifacts', 'resume-text.json')), auditPrefix: readFileSync(join(runDir, 'audit.jsonl'), 'utf8'),
  };
  // control: continuing under the SAME cap halts again at the same step (so the new cap is what moves it, and the test can fail)
  const rc = await continueProto(w, 'run-1', fn, 0.0105);
  row('p1.control', rc.outcome === 'cap-halt' && calls['resume-text'] === 1 && calls['jd-text'] === 0, `same cap -> halts again at the same step (outcome=${rc.outcome}); step 1 still called once; the cut step called ${calls['jd-text']}x (never funded)`);
  // the human signs a new version: write-once record next to the old one
  const v1 = join(runDir, 'signed-values-r1.json');
  writeFileSync(v1, JSON.stringify({ version: 1, capUsd: 0.25 }), { flag: 'wx' });
  let second = 'wrote';
  try { writeFileSync(v1, '{}', { flag: 'wx' }); } catch (e) { second = e.code; }
  row('p1.wx', second === 'EEXIST', `a second write of the same version is refused (${second})`);
  const r2 = await continueProto(w, 'run-1', fn, 0.25);
  row('p1.b', r2.outcome === 'paused', `continued under cap 0.25 -> runs to the signed ask (outcome=${r2.outcome}${r2.red ? `: ${r2.red}` : ''})`);
  row('p1.c', calls['resume-text'] === 1 && calls['jd-text'] === 1 && calls['resume-summary'] === 1, `step 1 NOT re-run (1 call in total); the cut step entered once, the rest once: ${JSON.stringify(calls)}`);
  const rowsNow = lines(join(runDir, 'audit.jsonl'));
  const paid = rowsNow.filter((r) => r.verdict !== 'cap-halt').reduce((a, r) => a + r.usd, 0);
  row('p1.d', Math.abs(r2.spentUsd - paid) < 1e-9 && Math.abs(r2.spentUsd - 0.003) < 1e-9, `spend so far counts: paused at $${r2.spentUsd}, audit sum $${paid.toFixed(4)} (3 model rounds of $0.001)`);
  row('p1.e', existsSync(join(runDir, 'state.json')) && JSON.parse(readFileSync(join(runDir, 'state.json'), 'utf8')).spent === r2.spentUsd, 'the park after the continue carries the carried-over spend in state.json');
  row('p1.f', sha(join(w.flowDir, 'prose.txt')) === before.prose && sha(join(w.flowDir, 'signature.json')) === before.sig, 'flow prose.txt and signature.json byte-identical');
  row('p1.g', sha(join(runDir, 'artifacts', 'resume-text.json')) === before.art1 && readFileSync(join(runDir, 'audit.jsonl'), 'utf8').startsWith(before.auditPrefix), 'step 1 artifact byte-identical; audit.jsonl only appended');
  const hist = lines(join(w.flowDir, 'history.jsonl')).filter((r) => r.runId === 'run-1').map((r) => r.outcome);
  row('p1.h', hist[0] === 'cap-halt' && hist.length === 2, `history is append-only: ${JSON.stringify(hist)} (a reader must take the LAST row, today the first: data.js find())`);
}

// ---- p2: stop file read at the seam --------------------------------------------------------------------------------
{
  const w = mkWorld('p2');
  const runDir = join(w.flowDir, 'runs', 'run-1');
  globalThis.__overlay = null;
  const { fn, calls } = makeStep(async (key) => { if (key === 'jd-text') writeFileSync(join(runDir, 'stop.request'), 'x'); }); // the click lands DURING step 2
  const r = await R.runFlow({ ...baseArgs(w, fn, 'run-1'), sources: w.sources });
  const audit = lines(join(runDir, 'audit.jsonl'));
  const hist = lines(join(w.flowDir, 'history.jsonl'));
  row('p2.a', r.outcome === 'stopped', `outcome=${r.outcome} (${r.red})`);
  row('p2.b', existsSync(join(runDir, 'artifacts', 'jd-text.json')) && audit.some((x) => x.step === 'jd-text' && (x.verdict === 'green' || x.verdict === 'hitl')), 'step 2 (the one running when the stop came) closed: artifact + green audit row written');
  row('p2.c', calls['resume-summary'] === 0 && !existsSync(join(runDir, 'artifacts', 'resume-summary.json')), `no step 3 started (calls ${JSON.stringify(calls)})`);
  row('p2.d', hist.at(-1).outcome === 'stopped' && Math.abs(hist.at(-1).spentUsd - 0.002) < 1e-9 && !existsSync(join(runDir, 'stop.request')), `history row stopped, spent $${hist.at(-1).spentUsd} = steps 1+2 booked; stop file consumed`);
  // control: no stop file -> the same flow runs on to the ask (so the stop is what ended it)
  const w2 = mkWorld('p2c');
  const { fn: fn2, calls: c2 } = makeStep();
  const r2 = await R.runFlow({ ...baseArgs(w2, fn2, 'run-1'), sources: w2.sources });
  row('p2.control', r2.outcome === 'paused' && c2['resume-summary'] === 1, `without the stop file the run goes on (outcome=${r2.outcome}, step 3 called ${c2['resume-summary']}x)`);
}

// ---- p3: per-run signed values ------------------------------------------------------------------------------------
{
  const w = mkWorld('p3');
  const overlayFile = (runDir) => { const f = join(runDir, 'signed-values.json'); return existsSync(f) ? JSON.parse(readFileSync(f, 'utf8')) : null; };
  globalThis.__overlay = (arb, runDir) => {
    const v = overlayFile(runDir);
    if (!v) return arb;
    return {
      ...arb, capUsd: v.capUsd,
      sends: arb.sends.map((s) => ({ ...s, target: { ...s.target, path: v.destination } })),
      asks: arb.asks.map((a) => ({ ...a, ttlMs: v.askWaitMs })),
    };
  };
  const flowFiles = ['prose.txt', 'signature.json', 'declaration.json'].map((f) => sha(join(w.flowDir, f)));
  const { fn } = makeStep();
  const accept = async (runId) => {
    const runDir = join(w.flowDir, 'runs', runId);
    const ask = JSON.parse(readFileSync(join(runDir, 'ask.json'), 'utf8'));
    answerAsk({ runDir, askId: ask.askId, decision: 'accept' });
    return { ask, res: await R.resumeRun(baseArgs(w, fn, runId)) };
  };
  // run-1: plain -> flow's own values
  const p1 = await R.runFlow({ ...baseArgs(w, fn, 'run-1'), sources: w.sources });
  const a1 = JSON.parse(readFileSync(join(w.flowDir, 'runs', 'run-1', 'ask.json'), 'utf8'));
  const t1 = Date.parse(a1.expiresAt) - Date.parse(a1.askedAt);
  const d1 = await accept('run-1');
  row('p3.a', p1.outcome === 'paused' && t1 === 30 * 60_000 && d1.res.outcome === 'complete' && readdirSync(w.destA).length === 1 && readdirSync(w.destB).length === 0, `plain run: wait ${t1 / 60000}m, send lands in destA (${readdirSync(w.destA)}), destB empty`);
  // run-2: values record written once into the run folder BEFORE start
  const runDir2 = join(w.flowDir, 'runs', 'run-2');
  mkdirSync(runDir2, { recursive: true });
  writeFileSync(join(runDir2, 'signed-values.json'), JSON.stringify({ capUsd: 0.07, destination: w.destB, askWaitMs: 2 * 3600_000 }), { flag: 'wx' });
  const p2 = await R.runFlow({ ...baseArgs(w, fn, 'run-2'), sources: w.sources });
  const a2 = JSON.parse(readFileSync(join(runDir2, 'ask.json'), 'utf8'));
  const t2 = Date.parse(a2.expiresAt) - Date.parse(a2.askedAt);
  const s2 = JSON.parse(readFileSync(join(runDir2, 'state.json'), 'utf8'));
  const d2 = await accept('run-2');
  const hist2 = lines(join(w.flowDir, 'history.jsonl')).filter((r) => r.runId === 'run-2').at(-1);
  row('p3.b', p2.outcome === 'paused' && t2 === 2 * 3600_000, `values run: ask wait is the run's 2h (got ${t2 / 3600000}h)`);
  row('p3.c', d2.res.outcome === 'complete' && readdirSync(w.destB).length === 1 && readdirSync(w.destA).length === 1, `values run: send lands in the NEW folder (destB=${readdirSync(w.destB)}), destA untouched (${readdirSync(w.destA).length} file)`);
  row('p3.d', hist2.capUsd === 0.07, `values run: the cap in force (history capUsd) is the run's 0.07, not the flow's 0.25 (got ${hist2.capUsd})`);
  // run-3: next plain run is back to the flow's values
  const p3 = await R.runFlow({ ...baseArgs(w, fn, 'run-3'), sources: w.sources });
  const a3 = JSON.parse(readFileSync(join(w.flowDir, 'runs', 'run-3', 'ask.json'), 'utf8'));
  const d3 = await accept('run-3');
  row('p3.e', p3.outcome === 'paused' && Date.parse(a3.expiresAt) - Date.parse(a3.askedAt) === 30 * 60_000 && d3.res.outcome === 'complete' && readdirSync(w.destA).length === 2 && readdirSync(w.destB).length === 1, `next plain run: back to 30m and destA (${readdirSync(w.destA).length} files in A, ${readdirSync(w.destB).length} in B)`);
  row('p3.f', ['prose.txt', 'signature.json', 'declaration.json'].every((f, i) => sha(join(w.flowDir, f)) === flowFiles[i]), 'flow prose.txt / signature.json / declaration.json byte-identical after all three runs');
  // invariant: the executor context never carries the cap or the values (the overlay lives in the runner only)
  const ctxSeen = [];
  const spy = async (ctx) => { ctxSeen.push(JSON.stringify(ctx)); return fn(ctx); };
  const w4 = mkWorld('p3i');
  mkdirSync(join(w4.flowDir, 'runs', 'run-1'), { recursive: true });
  writeFileSync(join(w4.flowDir, 'runs', 'run-1', 'signed-values.json'), JSON.stringify({ capUsd: 0.07, destination: w4.destB, askWaitMs: 7_200_000 }));
  await R.runFlow({ ...baseArgs(w4, spy, 'run-1'), sources: w4.sources });
  row('p3.inv', ctxSeen.length === 3 && ctxSeen.every((c) => !/0\.07|capUsd|destB|7200000|close/.test(c)), 'the executor context never carries the cap, the destination, the wait or a close (3 contexts scanned)');
}

rmSync(PROTO, { recursive: true, force: true });
rmSync(SCRATCH, { recursive: true, force: true });
console.log(fails === 0 ? '\nALL PASS' : `\n${fails} FAIL`);
process.exit(fails === 0 ? 0 : 1);
