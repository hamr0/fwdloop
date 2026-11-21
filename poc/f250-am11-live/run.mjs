// F250 (PAID unless --dry; see docs/logs/FINDINGS.md "F250 PRE-REGISTRATION", written before this file). NOT the product. Nothing under src/ changes.
// needs the F249 candidate: node poc/f249-item-count/make-candidate.mjs, then node poc/f249-item-count/run.mjs --candidate (builds .claude/scratch/f249/loop-cand)
// usage: node poc/f250-am11-live/run.mjs --dry                         ($0: the brief, both graders' self-check, price check; no key, no provider)
//        DEEPSEEK_API_KEY=<exported by the caller> node poc/f250-am11-live/run.mjs --tag <new-tag>
// One arm: line 2 of the research job through the CANDIDATE's real model step (cand/src), signed close = the candidate's plan (itemShape min 4 / max 4, no pick). Graded by G1 (candidate closeByClass) and G2 (loop copy + C2b).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const CAND = path.join(REPO, '.claude/scratch/f249/cand/src');
const LOOPC = path.join(REPO, '.claude/scratch/f249/loop-cand');
for (const p of [CAND, path.join(LOOPC, 'rowresults.js')]) if (!fs.existsSync(p)) { console.error(`refused: ${path.relative(REPO, p)} is missing; build the F249 candidate first (see the header)`); process.exit(2); }
const imp = (p) => import(pathToFileURL(p).href);
const S = (f) => imp(path.join(CAND, f));
const L = (f) => imp(path.join(LOOPC, f));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const tagAt = argv.indexOf('--tag');
const TAG = tagAt >= 0 ? argv[tagAt + 1] : null;
const N = 4;
const CAP_USD = 0.05;
const SLOT = 'DEEPSEEK_API_KEY';
const MODEL = 'deepseek-flash';
const OUT = path.join(REPO, '.claude/scratch/f250');
const RESULT = TAG ? path.join(OUT, `RESULT-${TAG}.json`) : null;
if (!DRY) {
  if (!TAG || !/^[A-Za-z0-9._-]+$/.test(TAG)) { console.error('refused: pass --tag <new-tag> (letters, digits, . _ -)'); process.exit(2); }
  if (fs.existsSync(RESULT)) { console.error(`refused: ${path.relative(REPO, RESULT)} exists; a consumed tag is never overwritten, use a new tag`); process.exit(2); }
}

const FX = path.join(REPO, 'test/fixtures/m19-am10');
const WALK = path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/research-walk-am10');
const RUN2 = path.join(WALK, 'runs/run-2');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f250-'));
const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } };
process.on('exit', cleanup);

try {
  // ---- the candidate's signed plan, rebuilt through the real path (as F249 build())
  const { rebuildBlock } = await S('planrebuild.js');
  const { assembleFromBlock } = await S('blockassemble.js');
  const { csvRolesOf } = await S('sheetblock.js');
  const { withSheetRows } = await S('sheetrows.js');
  const { withTicketRows } = await S('ticketrows.js');
  const root = path.join(tmp, 'plan-root'); fs.mkdirSync(root);
  const planDir = path.join(root, 'plan'); fs.cpSync(FX, planDir, { recursive: true });
  for (const f of ['prose.txt', 'target.json']) { const p = path.join(planDir, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('__ROOT__', root)); }
  fs.copyFileSync(path.join(FX, 'research-notes.md'), path.join(root, 'research-notes.md'));
  const b = rebuildBlock({ planDir, asks: true });
  if (!b.ok) throw new Error(`rebuild: ${b.say}`);
  const roles = csvRolesOf(b.parsed.arbiter);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((a) => a.line)), sheetRoles: roles });
  const ws = withSheetRows({ declaration: built.declaration, lines: b.lines, csvRoles: roles });
  const decl = withTicketRows({ declaration: ws.declaration, lines: b.lines }).declaration;
  const step2 = decl.steps.find((s) => s.fromLine === 2);
  const is = step2.close?.itemShape;
  if (!is || is.minItems !== 4 || is.maxItems !== 4 || step2.close.picked || decl.pickedLines) throw new Error(`the candidate plan is not the signed close of F250: ${JSON.stringify({ is, picked: step2.close?.picked ?? null, pickedLines: decl.pickedLines ?? null })}`);
  console.log('signed close of line 2:', JSON.stringify({ class: step2.close.class, itemShape: { fields: is.fields.map((f) => f.name), minItems: is.minItems, maxItems: is.maxItems }, picked: null }));

  // ---- graders: G1 = candidate closer, G2 = loop copy with C2b
  const { closeByClass } = await S('closers.js');
  const g1 = async (answer) => {
    const v = await closeByClass(step2, answer, { reads: {}, businessDate: '2026-11-21' });
    return { verdict: v.verdict, red: v.red ?? null, gaps: (v.shapeGaps ?? []).map((g) => `${g.kind}${g.measured !== undefined ? `:${g.measured}/${g.limit}` : ''}`) };
  };
  const notesMd = fs.readFileSync(path.join(RUN2, 'inputs/notes.md'), 'utf8');
  const list = (decl.checkList ?? []).filter((r) => r.line === 2);
  const shapeRules = list.filter((r) => r.kind === 'rule' && isRec(r.part) && r.part.part === 0).map((r) => r.rule);
  const params = { step: 2, parts: [{ class: 'shape', text: 'the items of line 2', fields: is.fields.map((f) => ({ name: f.name, spec: f.spec, rule: f.rule })), minItems: is.minItems, maxItems: is.maxItems, rules: shapeRules }] };
  const { runStage } = await L('kinds.js');
  let gn = 0;
  const g2 = async (answer) => {
    const wd = path.join(tmp, `grade${++gn}`); const tree = path.join(wd, 'tree');
    fs.mkdirSync(path.join(tree, 'input'), { recursive: true }); fs.mkdirSync(path.join(tree, 'output/steps'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'input/notes.md'), notesMd);
    fs.writeFileSync(path.join(wd, 'source.json'), JSON.stringify({ inputs: [{ label: 'notes', rel: 'input/notes.md', sha256: sha(notesMd) }] }));
    fs.writeFileSync(path.join(tree, 'output/steps/2.json'), JSON.stringify(answer));
    const r = await runStage({ name: 'line-2', kind: 'rubric-step', params }, { workdir: tree, gapKeep: '', gapCap: 40, list });
    const d = r.detail ?? {};
    const rows = (d.rows ?? []).map((x) => `${x.key}:${x.result}`);
    return { verdict: r.verdict, failedRows: (d.rows ?? []).filter((x) => x.result === 'failed').map((x) => x.key), rows, unclaimed: d.unclaimed ?? [] };
  };
  const grade = async (answer) => ({ g1: await g1(answer), g2: await g2(answer) });

  // ---- harness must-fail, before any call: 4 green, 5 and 3 red in both graders
  const mk = (n) => Array.from({ length: n }, (_x, i) => ({ title: ['Battery recycling study', 'Warehouse robotics survey', 'Tariff impact review', 'Solar permit timelines', 'Fifth study'][i], status: ['in progress', 'closed', 'finished', 'finished', 'closed'][i], summary: `Short summary ${i + 1}.` }));
  const ans = (n) => ({ results: mk(n), done: true });
  const c4 = await grade(ans(4)); const c5 = await grade(ans(5)); const c3 = await grade(ans(3));
  const selfOk = c4.g1.verdict === 'green' && c4.g2.verdict === 'green'
    && c5.g1.verdict === 'red' && c5.g1.gaps.some((x) => x.startsWith('count-over')) && c5.g2.verdict === 'red' && c5.g2.failedRows.includes('L2.~4')
    && c3.g1.verdict === 'red' && c3.g1.gaps.some((x) => x.startsWith('count-under')) && c3.g2.verdict === 'red' && c3.g2.failedRows.includes('L2.~4');
  console.log('grader self-check:', selfOk ? 'OK' : 'BROKEN', JSON.stringify({ four: [c4.g1.verdict, c4.g2.verdict], five: [c5.g1.verdict, c5.g1.gaps, c5.g2.verdict, c5.g2.failedRows], three: [c3.g1.verdict, c3.g1.gaps, c3.g2.verdict, c3.g2.failedRows] }));
  if (!selfOk) { console.error('refused: a grader cannot tell 4 items from 5 or 3'); process.exit(3); }

  // ---- the input, through the real reader
  const runDir = path.join(tmp, 'run'); fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
  fs.copyFileSync(path.join(RUN2, 'artifacts/research_notes_content.json'), path.join(runDir, 'artifacts/research_notes_content.json'));
  const { readArtifactsMapChecked, buildExecutorContext, findForbiddenInContext } = await S('runner.js');
  const rm = readArtifactsMapChecked(runDir, step2.reads);
  if (!rm.ok) throw new Error(`reads: ${rm.red}`);

  // ---- model, price: refused at $0 when unpriced
  const { resolveUsableModel, makeProvider, readPriceConfig } = await S('provider.js');
  const { stepThinkingMode } = await S('thinking.js');
  const { makeLiveModelStep } = await S('model-step.js');
  const usable = resolveUsableModel(SLOT, { config: readPriceConfig(), model: MODEL });
  if (!usable.ok) { console.error(`refused at $0: ${usable.say}`); process.exit(4); }
  const rates = usable.rates;
  console.log(`model ${usable.model} priced: in ${usable.prices.perM.inPerM}/M, out ${usable.prices.perM.outPerM}/M`);

  // stepMeta as src/runner.js:1050 builds it for this step, try 1, thinking box off
  const stepMeta = Object.freeze({
    class: step2.close?.class ?? null,
    cited: step2.close?.class === 'green' && step2.close.cited ? step2.close.cited : null,
    sheet: step2.close?.class === 'green' && Array.isArray(step2.close.sheet) ? step2.close.sheet : null,
    withText: step2.close?.class === 'green' && Array.isArray(step2.close.picked) && step2.close.picked.length > 0,
    picked: step2.close?.class === 'green' && Array.isArray(step2.close.picked) ? step2.close.picked : null,
    attempt: 1,
    itemShape: isRec(step2.close?.itemShape) ? step2.close.itemShape : null,
    line: step2.fromLine ?? null,
    step: step2?.emits ?? step2?.goal ?? null,
    thinkingMode: stepThinkingMode({ boxOn: false, attempt: 1 }),
  });
  const ctx = buildExecutorContext({ goal: step2.goal, primitives: step2.primitives ?? [], reads: rm.map, gap: null, hints: null, memo: null });
  console.log('context scan:', findForbiddenInContext(ctx) ?? 'clean');

  // ---- the exact prompt, through the candidate's real model step with a recording provider (no network)
  const seen = [];
  const fake = { generate: async (messages) => { seen.push(JSON.parse(JSON.stringify(messages))); return { text: null, toolCalls: [{ id: 't1', name: 'emit_artifact', arguments: { results: [], done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: MODEL }; } };
  await makeLiveModelStep({ spendPath: path.join(tmp, 'cap.jsonl'), provider: fake, rates, modelId: MODEL })(ctx, {}, stepMeta);
  const user = JSON.parse(seen[0][1].content);
  const brief = user.answering ?? null;
  const countLine = typeof brief === 'string' ? brief.split('\n').find((x) => /exactly 4 item/.test(x)) : null;
  console.log('goal:', JSON.stringify(step2.goal));
  console.log('brief (answering) the worker sees:\n' + brief);
  console.log('count line quoted:', countLine ? JSON.stringify(countLine.trim()) : 'NOT FOUND');
  if (!countLine) { console.error('refused: the candidate brief does not say "exactly 4 items" (a patched copy would be a new tag)'); process.exit(6); }

  if (DRY) {
    console.log('\nDRY done, $0, no provider call, no key read. Paid command: DEEPSEEK_API_KEY=<exported> node poc/f250-am11-live/run.mjs --tag <new-tag>');
    process.exit(0);
  }

  // ---- paid batch
  try { makeProvider(SLOT, { model: MODEL, env: process.env }); } catch (e) { console.error(`refused at $0: ${String(e.message).replace(/\s+/g, ' ')}`); process.exit(5); }
  fs.mkdirSync(OUT, { recursive: true });
  const modelStep = makeLiveModelStep({ slot: SLOT, model: MODEL, spendPath: path.join(runDir, 'spend.jsonl'), env: process.env });
  const hold = 3 * (((JSON.stringify(ctx).length + 400) / 3 / 1000) * rates.in + (1500 / 1000) * rates.out);
  let spent = 0; let stopped = null;
  const samples = [];
  for (let i = 1; i <= N && !stopped; i += 1) {
    if (spent + hold > CAP_USD) { stopped = `cap: spent ${spent.toFixed(4)} + hold ${hold.toFixed(4)} > ${CAP_USD}`; break; }
    const t0 = Date.now();
    const r = await modelStep(ctx, {}, stepMeta);
    const wallMs = Date.now() - t0;
    const cost = typeof r.costUsd === 'number' ? r.costUsd : null;
    const row = { sample: i, ok: r.ok === true, red: r.ok === true ? null : String(r.red ?? 'no answer'), costUsd: cost, rounds: r.rounds ?? null, savedBy: r.savedBy ?? null, wallMs, answer: r.ok === true ? r.artifact : null };
    if (cost === null) { samples.push({ ...row, green: false, grade: null }); stopped = `unknown cost on sample ${i}: batch stopped, never counted as $0`; break; }
    spent += cost;
    if (r.ok === true && isRec(r.artifact)) {
      const g = await grade(r.artifact);
      samples.push({ ...row, green: g.g1.verdict === 'green' && g.g2.verdict === 'green', items: Array.isArray(r.artifact.results) ? r.artifact.results.length : null, grade: g });
    } else samples.push({ ...row, green: false, grade: null });
    const s = samples[samples.length - 1];
    console.log(`S${i}: ${s.green ? 'GREEN' : 'red'} $${cost.toFixed(4)} items=${s.items ?? '-'}${s.grade ? ` G1=${s.grade.g1.verdict}${s.grade.g1.gaps.length ? `(${s.grade.g1.gaps})` : ''} G2=${s.grade.g2.verdict} failed=${s.grade.g2.failedRows.join(',') || '-'}` : ` (${row.red})`}`);
  }
  const green = samples.filter((x) => x.green).length;
  const g1green = samples.filter((x) => x.grade?.g1.verdict === 'green').length;
  const g2green = samples.filter((x) => x.grade?.g2.verdict === 'green').length;
  const complete = samples.length === N && stopped === null;
  const verdict = !complete ? 'INCOMPLETE (batch stopped: not a pass)' : (g1green === N && g2green === N ? 'PASS' : 'FAIL');
  const result = { tag: TAG, at: new Date().toISOString(), model: MODEL, slot: SLOT, n: N, capUsd: CAP_USD, spentUsd: spent, stopped, bars: '4/4 green in G1 AND 4/4 green in G2', green, g1green, g2green, verdict, goal: step2.goal, briefAnswering: brief, samples };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(`\nG1 ${g1green}/${samples.length} G2 ${g2green}/${samples.length} | spent $${spent.toFixed(4)} | verdict ${verdict}\nwritten ${path.relative(REPO, RESULT)}`);
} finally {
  cleanup();
}
