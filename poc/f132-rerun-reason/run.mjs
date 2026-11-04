// F132 (M14 am1 item 1 POC): throwaway. Drives the REAL runner (unpatched src/, and patched COPIES of src/ in a scratch dir
// inside this folder so node_modules resolves). The main tree is never patched. $0: scripted fake model step, no network.
import assert from 'node:assert/strict';
import {
  cpSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, readdirSync, rmSync, statSync,
} from 'node:fs';
import { join, dirname, relative } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..');
const FIX = join(REPO, 'test', 'fixtures');
const scratch = mkdtempSync(join(HERE, '.scratch-'));
const results = [];
const bar = (n, name, pass, detail) => { results.push({ bar: n, name, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  bar ${n}: ${name}${detail ? ` — ${detail}` : ''}`); };

function patchedCopy(variant) {
  const d = join(scratch, variant);
  mkdirSync(d);
  cpSync(join(REPO, 'src'), join(d, 'src'), { recursive: true });
  cpSync(join(REPO, 'package.json'), join(d, 'package.json'));
  if (variant === 'plain') return d;
  const sub = (file, from, to) => {
    const p = join(d, 'src', file); const t = readFileSync(p, 'utf8');
    assert.equal(t.split(from).length - 1, 1, `patch anchor must match once: ${file}: ${from}`);
    writeFileSync(p, t.replace(from, () => to));
  };
  if (variant !== 'nopass') sub('runner.js', '        initialGap: reason,\n      });', "        initialGap: reason,\n        rerunOf: { decision: 'rerun', words: reason, afterStep: state.stepIndex },\n      });");
  sub('runner.js', 'ceilingUsd, initialGap, fetchPage,\n  // M4d am33', 'ceilingUsd, initialGap, rerunOf, fetchPage,\n  // M4d am33');
  sub('runner.js', 'thinking: thinkingBox, inputs: /** @type {any[]} */ (frozen.manifest) });', 'thinking: thinkingBox, inputs: /** @type {any[]} */ (frozen.manifest), rerunOf });');
  sub('runfile.js', 'export function writeRunStart(runDir, { model, thinking, inputs }) {', 'export function writeRunStart(runDir, { model, thinking, inputs, rerunOf }) {\n  globalThis.__f132?.(runDir, rerunOf);');
  sub('runfile.js', '    ...(model ? { model: { slot: model.slot, model: model.model } } : {}), thinking, inputs,\n',
    `    ...(model ? { model: { slot: model.slot, model: model.model } } : {}), thinking, inputs,\n    ...(rerunOf && ${variant === 'dropwrite' ? 'false' : 'true'} ? { rerun: rerunOf } : {}),\n`);
  return d;
}

const NOOP_SEND = async (t, f, content) => ({ ok: true, bytes: JSON.stringify(content ?? {}).length });
function fakeModel() {
  return async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) return { ok: true, costUsd: 0.001, artifact: { text: '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.', done: true } };
    throw new Error(`unexpected goal: ${ctx.goal}`);
  };
}
// ask/answer file names carry a random uuid per run; the comparator masks it (first run compared raw names: red on that alone, recorded in F132)
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
const walk = (dir, base = dir) => readdirSync(dir).flatMap((n) => { const p = join(dir, n); return statSync(p).isDirectory() ? walk(p, base) : [relative(base, p).replace(UUID, '<uuid>')]; }).sort();

/** park run-1 at its ask, answer rerun "wrong answer", resume; return the rerun's folder and what the hook saw */
async function scenario(variant) {
  const d = patchedCopy(variant);
  const m = (f) => import(pathToFileURL(join(d, 'src', f)).href);
  const [{ writeFlow }, { loadCatalogue }, run, { answerAsk }] = await Promise.all([m('flow.js'), m('catalogue.js'), m('runner.js'), m('ask.js')]);
  const cat = loadCatalogue().primitives;
  const root = join(scratch, `root-${variant}`); mkdirSync(root);
  const sendDir = join(scratch, `send-${variant}`); mkdirSync(sendDir);
  const srcDir = join(scratch, `src-${variant}`); mkdirSync(srcDir);
  writeFileSync(join(srcDir, 'resume.docx'), 'Resume text goes here.'); writeFileSync(join(srcDir, 'jd.md'), 'JD text goes here.');
  const w = writeFlow({
    root, name: 'job2', proseText: readFileSync(join(FIX, 'job2-with-sources.signed.txt'), 'utf8').replaceAll('file:poc/m0/out', `file:${sendDir}`),
    declaration: JSON.parse(readFileSync(join(FIX, 'job2.m1.declaration.json'), 'utf8')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: cat,
  });
  assert.equal(w.ok, true, w.ok ? '' : w.reds.join('\n'));
  const seen = [];
  globalThis.__f132 = (runDir, fact) => seen.push({ run: runDir.split('/').pop(), fact });
  const base = { root, name: 'job2', catalogue: cat, modelStep: fakeModel(), sendStep: NOOP_SEND, primitives: {}, businessDate: '2026-06-01' };
  const parked = await run.runFlow({ ...base, runId: 'run-1', askStep: run.makeParkingAskStep(), sources: [{ id: 'resume', path: join(srcDir, 'resume.docx') }, { id: 'jd', path: join(srcDir, 'jd.md') }] });
  assert.equal(parked.outcome, 'paused', parked.red);
  const a = answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'rerun', reason: 'wrong answer' });
  assert.equal(a.ok, true);
  const res = await run.resumeRun({ ...base, runId: 'run-1' });
  assert.equal(res.outcome, 'rerun', res.red);
  assert.equal(res.newRun.outcome, 'paused', res.newRun.red);
  const newDir = join(root, 'job2', 'runs', 'run-1-rerun-1');
  const runJson = () => readFileSync(join(newDir, 'run.json'), 'utf8');
  const before = runJson(); const files = walk(newDir);
  // bar 3: answer the rerun's own ask `accept`, resume it
  const ask2 = JSON.parse(readFileSync(join(newDir, 'ask.json'), 'utf8'));
  const a2 = answerAsk({ runDir: newDir, askId: res.newRun.askId ?? ask2.askId, decision: 'accept' });
  assert.equal(a2.ok, true, a2.ok ? '' : a2.red);
  const r2 = await run.resumeRun({ ...base, runId: 'run-1-rerun-1' });
  return { before, after: runJson(), filesAtPark: files, filesAfter: walk(newDir), resumeOutcome: r2.outcome, seen: seen.filter((s) => s.run === 'run-1-rerun-1'), seenAll: seen.length };
}

const FACT = { decision: 'rerun', words: 'wrong answer', afterStep: 3 };
const sha = (s) => createHash('sha256').update(s).digest('hex');
let out = {};
try {
  const plain = await scenario('plain');
  const full = await scenario('full');
  const nopass = await scenario('nopass');
  const dropwrite = await scenario('dropwrite');
  out = { plain, full, nopass, dropwrite };

  const j = (s) => JSON.parse(s);
  bar(1, 'writeRunStart is handed the fact for the new run (patched copy)', full.seen.length === 1 && JSON.stringify(full.seen[0].fact) === JSON.stringify(FACT), JSON.stringify(full.seen));
  const jf = j(full.before); const jp = j(plain.before);
  const { rerun, ...rest } = jf;
  bar('2a', 'new run folder file names identical to the unpatched rerun', JSON.stringify(full.filesAtPark) === JSON.stringify(plain.filesAtPark), `${full.filesAtPark.length} vs ${plain.filesAtPark.length} files`);
  // the frozen manifest holds a mkdtemp path per variant; compare shape by dropping it
  const strip = (o) => JSON.stringify({ ...o, inputs: o.inputs.map((e) => ({ id: e.id, sha256: e.sha256, bytes: e.bytes })) });
  bar('2b', 'run.json differs from the unpatched one only by the `rerun` key', JSON.stringify(rerun) === JSON.stringify(FACT) && strip(rest) === strip(jp) && !Object.hasOwn(jp, 'rerun'), `keys patched=${Object.keys(jf)} plain=${Object.keys(jp)}`);
  bar(3, 'after the rerun\'s own park, answer and resume: run.json byte-identical and still holds the fact', full.resumeOutcome !== 'refused' && full.before === full.after && JSON.stringify(j(full.after).rerun) === JSON.stringify(FACT), `resume outcome ${full.resumeOutcome}; sha ${sha(full.after).slice(0, 12)}; files after ${full.filesAfter.length}`);
  bar('4a', 'no pass-through from resumeRun: hook does NOT see the fact (bar 1 red)', !(nopass.seen.length === 1 && JSON.stringify(nopass.seen[0].fact) === JSON.stringify(FACT)), JSON.stringify(nopass.seen));
  bar('4b', 'writeRunStart drops it: file lacks the fact (bar 2b/3 red) while the hook still saw it', dropwrite.seen.length === 1 && JSON.stringify(dropwrite.seen[0].fact) === JSON.stringify(FACT) && j(dropwrite.before).rerun === undefined && j(dropwrite.after).rerun === undefined, `file keys ${Object.keys(j(dropwrite.before))}`);
  bar('4c', 'unpatched src: no `rerun` key in the rerun\'s run.json', !Object.hasOwn(jp, 'rerun'), '');
  bar('4d', 'unpatched src and copies resumed the rerun the same way', plain.resumeOutcome === full.resumeOutcome, `${plain.resumeOutcome} / ${full.resumeOutcome}`);
} finally {
  delete globalThis.__f132;
  rmSync(scratch, { recursive: true, force: true });
}
writeFileSync(join(HERE, 'out', 'results.json'), `${JSON.stringify({ results, out }, null, 1)}\n`);
console.log(results.every((r) => r.pass) ? 'ALL PASS' : 'SOME FAIL');
