// F248 (PAID unless --dry; see docs/logs/FINDINGS.md "F248 PRE-REGISTRATION", written before this file).
// usage: node poc/f248-rules-told/run.mjs --dry                      ($0: prompts of A and B for sample 1, grader self-check, price check; no key, no provider)
//        DEEPSEEK_API_KEY=<exported by hamr> node poc/f248-rules-told/run.mjs --tag <new-tag>
// A = today's line-2 step through the real src/model-step.js; B = the same call, only `goal` written the way loop's rubricGoal shows a job line with its rules
// (bareloop src/rubricstep.js:190-202 @ v0.61.0: "n. <line text>" then "   rule: <~ rules>"). Graded by the F246 copied loop rubric. Nothing under src/ changes.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const imp = (p) => import(pathToFileURL(p).href);
const L = (f) => imp(path.join(REPO, 'poc/f246-loop-shape-run/loop/src', f));
const S = (f) => imp(path.join(REPO, 'src', f));
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

const argv = process.argv.slice(2);
const DRY = argv.includes('--dry');
const tagAt = argv.indexOf('--tag');
const TAG = tagAt >= 0 ? argv[tagAt + 1] : null;
const N = 8;
const CAP_USD = 0.10;
const SLOT = 'DEEPSEEK_API_KEY';
const MODEL = 'deepseek-flash';
const OUT = path.join(REPO, '.claude/scratch/f248');
const RESULT = TAG ? path.join(OUT, `RESULT-${TAG}.json`) : null;
if (!DRY) {
  if (!TAG || !/^[A-Za-z0-9._-]+$/.test(TAG)) { console.error('refused: pass --tag <new-tag> (letters, digits, . _ -)'); process.exit(2); }
  if (fs.existsSync(RESULT)) { console.error(`refused: ${path.relative(REPO, RESULT)} exists; a consumed tag is never overwritten, use a new tag`); process.exit(2); }
}

// ---- the signed job, read only
const FLOW = path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/research-walk-am10');
const RUN2 = path.join(FLOW, 'runs/run-2');
const decl = JSON.parse(fs.readFileSync(path.join(FLOW, 'declaration.json'), 'utf8'));
const step2 = decl.steps.find((s) => s.fromLine === 2);
const prose = fs.readFileSync(path.join(FLOW, 'prose.txt'), 'utf8').split('\n');
const l2 = prose.findIndex((x) => /^2\.\s/.test(x));
const ruleLine = prose[l2 + 1] ?? '';
if (!/^\s+guardrail:\s/.test(ruleLine)) throw new Error('line 2 has no guardrail line under it in prose.txt');
const RULES = ruleLine.replace(/^\s+guardrail:\s*/, '').trim();
const LINE_TEXT = prose[l2].replace(/^2\.\s*/, '').trim();
if (LINE_TEXT !== step2.goal) throw new Error(`prose line 2 "${LINE_TEXT}" is not the signed goal "${step2.goal}"`);
const GOAL_A = step2.goal;
const GOAL_B = `2. ${LINE_TEXT}\n   rule: ${RULES}`;

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f248-'));
const cleanup = () => { try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* */ } };
process.on('exit', cleanup);

try {
  // ---- the input: line 1's real output, through the real reader
  const runDir = path.join(tmp, 'run');
  fs.mkdirSync(path.join(runDir, 'artifacts'), { recursive: true });
  fs.copyFileSync(path.join(RUN2, 'artifacts/research_notes_content.json'), path.join(runDir, 'artifacts/research_notes_content.json'));
  const { readArtifactsMapChecked, buildExecutorContext, findForbiddenInContext } = await S('runner.js');
  const rm = readArtifactsMapChecked(runDir, step2.reads);
  if (!rm.ok) throw new Error(`reads: ${rm.red}`);
  const readsMap = rm.map;

  // ---- the grader: F246's copied loop rubric, variant NC; the stage params as F246 wrote them from fwd's signed line 2
  const notesMd = fs.readFileSync(path.join(RUN2, 'inputs/notes.md'), 'utf8');
  const fields = step2.close.itemShape.fields;
  const shapePart = { class: 'shape', text: 'each item has a title; each item has a status; each item has a summary', fields: fields.map((f) => ({ name: f.name, spec: f.spec, rule: f.rule })), rules: [1, 2, 3] };
  const pickPart = { text: 'exactly 4 list items', class: 'countable', check: 'listItems', value: 4 };
  const params = { step: 2, parts: [shapePart, pickPart] };
  const list = decl.checkList.filter((r) => r.line === 2);
  const { runStage } = await L('kinds.js');
  let gn = 0;
  async function grade(answer) {
    const wd = path.join(tmp, `grade${++gn}`); const tree = path.join(wd, 'tree');
    fs.mkdirSync(path.join(tree, 'input'), { recursive: true }); fs.mkdirSync(path.join(tree, 'output/steps'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'input/notes.md'), notesMd);
    fs.writeFileSync(path.join(wd, 'source.json'), JSON.stringify({ inputs: [{ label: 'notes', rel: 'input/notes.md', sha256: sha(notesMd) }] }));
    fs.writeFileSync(path.join(tree, 'output/steps/2.json'), JSON.stringify(answer));
    const r = await runStage({ name: 'line-2', kind: 'rubric-step', params }, { workdir: tree, gapKeep: '', gapCap: 40, list });
    const d = r.detail ?? {};
    const rows = Object.fromEntries((d.rows ?? []).map((x) => [x.key, x.result]));
    return { verdict: r.verdict, gapLines: r.gapLines ?? [], rows, failedRows: Object.keys(rows).filter((k) => rows[k] === 'failed'), unclaimed: d.unclaimed ?? [] };
  }

  // ---- harness must-fail, before any call: the real first answer is red on L2.~4, a hand-made good answer is green
  const log = JSON.parse(fs.readFileSync(path.join(RUN2, 'log.json'), 'utf8'));
  const realFirst = log.attempts.find((a) => a.step === 'research_items' && a.attempt === 1).modelOutput;
  const four = [['Battery recycling study', 'in progress'], ['Warehouse robotics survey', 'closed'], ['Tariff impact review', 'finished'], ['Solar permit timelines', 'finished']]
    .map(([title, status], i) => ({ title, status, summary: `Short summary ${i + 1}.` }));
  const good = { results: four, text: four.map((i) => `- ${i.title}`).join('\n'), done: true };
  const gReal = await grade(realFirst);
  const gGood = await grade(good);
  const selfOk = gReal.verdict === 'red' && gReal.rows['L2.~4'] === 'failed' && gGood.verdict === 'green';
  console.log('grader self-check:', selfOk ? 'OK' : 'BROKEN', JSON.stringify({ realFirst: { v: gReal.verdict, failed: gReal.failedRows }, good: { v: gGood.verdict } }));
  if (!selfOk) { console.error('refused: the grader cannot tell the real red from a hand-made green'); process.exit(3); }

  // ---- model, price: refused at $0 when unpriced
  const { resolveUsableModel, makeProvider, readPriceConfig } = await S('provider.js');
  const { stepThinkingMode } = await S('thinking.js');
  const { makeLiveModelStep } = await S('model-step.js');
  const usable = resolveUsableModel(SLOT, { config: readPriceConfig(), model: MODEL });
  if (!usable.ok) { console.error(`refused at $0: ${usable.say}`); process.exit(4); }
  const rates = usable.rates;
  console.log(`model ${usable.model} priced: in ${usable.prices.perM.inPerM}/M, out ${usable.prices.perM.outPerM}/M`);

  // stepMeta exactly as src/runner.js:1050 builds it for this step, try 1, thinking box off
  const stepMeta = Object.freeze({
    class: step2.close?.class ?? null,
    cited: step2.close?.class === 'green' && step2.close.cited ? step2.close.cited : null,
    sheet: step2.close?.class === 'green' && Array.isArray(step2.close.sheet) ? step2.close.sheet : null,
    withText: step2.close?.class === 'green' && Array.isArray(step2.close.picked) && step2.close.picked.length > 0,
    picked: step2.close?.class === 'green' && Array.isArray(step2.close.picked) ? step2.close.picked : null,
    attempt: 1,
    itemShape: step2.close?.itemShape && typeof step2.close.itemShape === 'object' ? step2.close.itemShape : null,
    line: step2.fromLine ?? null,
    step: step2?.emits ?? step2?.goal ?? null,
    thinkingMode: stepThinkingMode({ boxOn: false, attempt: 1 }),
  });
  const ctxOf = (goal) => buildExecutorContext({ goal, primitives: step2.primitives ?? [], reads: readsMap, gap: null, hints: null, memo: null });
  const ctxA = ctxOf(GOAL_A); const ctxB = ctxOf(GOAL_B);
  console.log('context scan A:', findForbiddenInContext(ctxA) ?? 'clean', '| B:', findForbiddenInContext(ctxB) ?? 'clean');

  // ---- the exact prompts, captured through the real model step with a recording provider (no network)
  async function capture(ctx) {
    const seen = [];
    const fake = { generate: async (messages) => { seen.push(JSON.parse(JSON.stringify(messages))); return { text: null, toolCalls: [{ id: 't1', name: 'emit_artifact', arguments: { text: '', done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: MODEL }; } };
    const ms = makeLiveModelStep({ spendPath: path.join(tmp, `cap-${Math.random().toString(36).slice(2)}.jsonl`), provider: fake, rates, modelId: MODEL });
    await ms(ctx, {}, stepMeta);
    return seen[0];
  }
  const pA = await capture(ctxA); const pB = await capture(ctxB);
  const txt = (m) => m.map((x) => `[${x.role}]\n${x.content}`).join('\n');
  const userA = JSON.stringify(JSON.parse(pA[1].content), null, 2); const userB = JSON.stringify(JSON.parse(pB[1].content), null, 2);

  if (DRY) {
    console.log('\n===== PROMPT A (sample 1, exact) =====\n' + `[system]\n${pA[0].content}\n[user, pretty-printed JSON of the one message]\n${userA}`);
    console.log('\n===== PROMPT B (sample 1, exact) =====\n' + `[system]\n${pB[0].content}\n[user, pretty-printed JSON of the one message]\n${userB}`);
    const aL = userA.split('\n'); const bL = userB.split('\n');
    const aSet = new Set(aL);
    console.log('\n===== lines in B not in A =====');
    for (const x of bL) if (!aSet.has(x)) console.log(`+ ${x}`);
    console.log('===== lines in A not in B =====');
    const bSet = new Set(bL);
    for (const x of aL) if (!bSet.has(x)) console.log(`- ${x}`);
    const same = JSON.stringify(pA[0]) === JSON.stringify(pB[0]);
    console.log(`system message identical: ${same}`);
    console.log(`\nDRY done, $0, no provider call, no key read. Paid command: DEEPSEEK_API_KEY=<exported> node poc/f248-rules-told/run.mjs --tag <new-tag>`);
    process.exit(0);
  }

  // ---- paid batch
  const makeProv = () => makeProvider(SLOT, { model: MODEL, env: process.env }); // key preflight: refuses an empty key at $0 before any call
  try { makeProv(); } catch (e) { console.error(`refused at $0: ${String(e.message).replace(/\s+/g, ' ')}`); process.exit(5); }
  fs.mkdirSync(OUT, { recursive: true });
  const spendPath = path.join(tmp, 'run', 'spend.jsonl');
  const modelStep = makeLiveModelStep({ slot: SLOT, model: MODEL, spendPath, env: process.env });
  const holdOf = (ctx) => {
    const promptChars = JSON.stringify(ctx).length + 400;
    return 3 * ((promptChars / 3 / 1000) * rates.in + (1500 / 1000) * rates.out);
  };
  let spent = 0; let stopped = null;
  const samples = [];
  for (let i = 1; i <= N && !stopped; i += 1) {
    for (const [arm, ctx] of [['A', ctxA], ['B', ctxB]]) {
      if (spent + holdOf(ctx) > CAP_USD) { stopped = `cap: spent ${spent.toFixed(4)} + hold ${holdOf(ctx).toFixed(4)} > ${CAP_USD}`; break; }
      const t0 = Date.now();
      const r = await modelStep(ctx, {}, stepMeta);
      const wallMs = Date.now() - t0;
      const cost = typeof r.costUsd === 'number' ? r.costUsd : null;
      const row = { arm, sample: i, ok: r.ok === true, red: r.ok === true ? null : String(r.red ?? 'no answer'), costUsd: cost, rounds: r.rounds ?? null, savedBy: r.savedBy ?? null, wallMs, answer: r.ok === true ? r.artifact : null };
      if (cost === null) { samples.push({ ...row, green: false, grade: null }); stopped = `unknown cost on ${arm}${i}: batch stopped, never counted as $0`; break; }
      spent += cost;
      if (r.ok === true && r.artifact && typeof r.artifact === 'object') {
        const g = await grade(r.artifact);
        samples.push({ ...row, green: g.verdict === 'green', done: r.artifact.done ?? null, grade: g });
      } else samples.push({ ...row, green: false, grade: null });
      console.log(`${arm}${i}: ${samples[samples.length - 1].green ? 'GREEN' : 'red'} $${cost.toFixed(4)}${samples[samples.length - 1].grade ? ` failed=${samples[samples.length - 1].grade.failedRows.join(',') || '-'} unclaimed=${samples[samples.length - 1].grade.unclaimed.length}` : ` (${row.red})`}`);
    }
  }
  const sum = (arm) => {
    const s = samples.filter((x) => x.arm === arm);
    const reds = {};
    for (const x of s) {
      if (x.green) continue;
      const keys = x.grade ? [...x.grade.failedRows, ...(x.grade.unclaimed.length ? ['unclaimed'] : [])] : ['no-answer'];
      for (const k of (keys.length ? keys : ['red-no-row'])) reds[k] = (reds[k] ?? 0) + 1;
    }
    return { samples: s.length, green: s.filter((x) => x.green).length, redsByRow: reds, costUsd: s.reduce((a, x) => a + (x.costUsd ?? 0), 0), meanWallMs: s.length ? Math.round(s.reduce((a, x) => a + x.wallMs, 0) / s.length) : null };
  };
  const A = sum('A'); const B = sum('B');
  const complete = A.samples === N && B.samples === N && stopped === null;
  const verdict = !complete ? 'INCOMPLETE (batch stopped: not a pass)' : (B.green >= 6 && B.green > A.green ? 'PASS' : 'FAIL');
  const result = { tag: TAG, at: new Date().toISOString(), model: MODEL, slot: SLOT, n: N, capUsd: CAP_USD, spentUsd: spent, stopped, bars: 'B green >= 6/8 AND B green > A green', A, B, verdict, goalA: GOAL_A, goalB: GOAL_B, samples };
  fs.writeFileSync(RESULT, JSON.stringify(result, null, 2), { flag: 'wx' });
  console.log(`\nA green ${A.green}/${A.samples} reds ${JSON.stringify(A.redsByRow)} | B green ${B.green}/${B.samples} reds ${JSON.stringify(B.redsByRow)} | spent $${spent.toFixed(4)} | verdict ${verdict}\nwritten ${path.relative(REPO, RESULT)}`);
} finally {
  cleanup();
}
