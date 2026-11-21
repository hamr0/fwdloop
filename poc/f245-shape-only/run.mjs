// F245 ($0, no AI, no key, no panel). usage: node poc/f245-shape-only/run.mjs [--today | --candidate]
// --today      src as it is. --candidate  the patched COPY .claude/scratch/f245/cand/src (poc/f245-shape-only/make-candidate.mjs).
// The signed flow is COPIED to a mkdtemp folder (the original is never written); a modelStep that throws proves no provider call is possible.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODE = process.argv.includes('--candidate') ? 'candidate' : 'today';
const SRC = MODE === 'candidate' ? path.join(REPO, '.claude/scratch/f245/cand/src') : path.join(REPO, 'src');
const imp = (f) => import(pathToFileURL(path.join(SRC, f)).href);
const { readFlow } = await imp('flow.js');
const { loadCatalogue } = await imp('catalogue.js');
const { canFlowRun, findUnbuildableCheckStep } = await imp('canrun.js');
const { runFlow } = await imp('runner.js');
const { closeByClass } = await imp('closers.js');
const { checkedLines } = await imp('checked.js');

const FLOW = path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/research-walk-am10');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f245-'));
const root = path.join(tmp, 'flows');
fs.mkdirSync(root);
fs.cpSync(FLOW, path.join(root, 'research-walk-am10'), { recursive: true });
const cat = loadCatalogue();
const catalogue = cat.primitives;
const out = { mode: MODE, bars: {} };
const bar = (k, pass, detail) => { out.bars[k] = { pass, detail }; console.log(`${k}: ${pass ? 'PASS' : 'FAIL'}`, JSON.stringify(detail)); };
try {
  const read = readFlow({ root, name: 'research-walk-am10', catalogue });
  if (!read.ok) throw new Error(`readFlow red: ${read.reds}`);
  const decl = read.declaration;
  const step = decl.steps.find((s) => s.fromLine === 2);

  // (A)/(D) preflight, three gates
  const unb = findUnbuildableCheckStep(decl);
  const can = canFlowRun(read);
  let modelCalled = false;
  const run = await runFlow({ root, name: 'research-walk-am10', runId: 'run-9', sources: [], catalogue, businessDate: '2026-11-21',
    modelStep: async () => { modelCalled = true; throw new Error('F245: a provider call is not allowed'); },
    askStep: async () => { throw new Error('F245 no ask'); }, sendStep: async () => { throw new Error('F245 no send'); } }).catch((e) => ({ outcome: 'threw', red: String(e.message) }));
  const live = "This flow will not run: Line 2's check cannot cite cells any more. Draft it again to run it.";
  const refusedToday = unb?.step?.fromLine === 2 && can.ok === false && can.red === live && run.outcome === 'preflight-red' && run.red === live && !modelCalled;
  const passedCand = unb === null && can.ok === true && run.outcome !== 'preflight-red' && run.red !== live;
  bar(MODE === 'today' ? 'A' : 'D-preflight', MODE === 'today' ? refusedToday : passedCand, { unbuildableLine: unb?.step?.fromLine ?? null, canOk: can.ok, canRed: can.red ?? null, runOutcome: run.outcome, runRed: run.red ?? null, modelCalled });

  // (B) the close, real signed step, hand-made answers
  const item = (i, o = {}) => ({ title: `Study ${i}`, status: 'closed', summary: `Summary ${i}`, ...o });
  const text = (n) => Array.from({ length: n }, (_, i) => `${i + 1}. Study ${i + 1}`).join('\n');
  const ans = (items, n = items.length) => ({ results: items, text: text(n), done: true });
  const four = [1, 2, 3, 4].map((i) => item(i));
  const cases = [
    ['B0 good', ans(four), 'green', null],
    ['B1 missing title', ans([item(1), item(2, { title: undefined }), item(3), item(4)]), 'red', /title/i],
    ['B2 status open', ans([item(1), item(2, { status: 'open' }), item(3), item(4)]), 'red', /status/i],
    ['B3 summary 200 chars', ans([item(1), item(2, { summary: 'x'.repeat(200) }), item(3), item(4)]), 'red', /summary/i],
    ['B4 five items', ans([1, 2, 3, 4, 5].map((i) => item(i))), 'red', /5|five|item/i],
    ['B5 three items', ans([1, 2, 3].map((i) => item(i))), 'red', /3|three|item/i],
  ];
  const bres = [];
  for (const [name, artifact, want, re] of cases) {
    const v = await closeByClass(step, artifact, { reads: {}, businessDate: '2026-11-21' });
    const ok = v.verdict === want && (re === null || re.test(String(v.red)));
    bres.push({ name, ok, verdict: v.verdict, red: v.red, reds: v.reds });
  }
  bar('B' + (MODE === 'candidate' ? '-unchanged' : ''), bres.every((r) => r.ok), bres);

  // (C) negatives: a real retired cite, and picked alone
  const retired = { ...step, close: { class: 'green' } };
  const pickedOnly = { ...step, close: { class: 'green', picked: step.close.picked } };
  const fdecl = (s) => ({ ...decl, steps: decl.steps.map((x) => (x.fromLine === 2 ? s : x)) });
  const uR = findUnbuildableCheckStep(fdecl(retired));
  const uP = findUnbuildableCheckStep(fdecl(pickedOnly));
  const cR = await closeByClass(retired, { results: [] }, { reads: {}, businessDate: '2026-11-21' });
  const cP = await closeByClass(pickedOnly, { text: text(4) }, { reads: {}, businessDate: '2026-11-21' });
  bar('C', uR?.step?.fromLine === 2, { retiredRefusedLine: uR?.step?.fromLine ?? null, closeVerdict: cR.verdict });
  bar('C2', uP?.step?.fromLine === 2 && cP.verdict === 'crash', { pickedOnlyRefusedLine: uP?.step?.fromLine ?? null, closeVerdict: cP.verdict, closeRed: cP.red });

  // (E) the lead
  const lines = checkedLines(decl, { hasAsk: false, askLines: [], lines: [] });
  const l2 = lines.find((l) => l.line === 2);
  const lead = l2.sentences.find((s) => /Every figure must cite its source cell/.test(s)) ?? null;
  bar('E', MODE === 'today' ? lead !== null : lead === null && !l2.sentences.some((s) => /cell/i.test(s)), { sentences: l2.sentences });
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
fs.mkdirSync(path.join(REPO, '.claude/scratch/f245'), { recursive: true });
fs.writeFileSync(path.join(REPO, `.claude/scratch/f245/RESULT-${MODE}.json`), JSON.stringify(out, null, 1));
