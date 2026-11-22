// F246 ($0, no AI, no key, no panel, no node --test). usage: node poc/f246-loop-shape-run/run.mjs
// Runs loop v0.61.0's rubric-step run side (copied whole into loop/src/, see copy-loop.mjs) over fwd's signed research-walk-am10 line 2 and run-2's real answers.
// Boundary stubs (the harness, never a copied line): the stage params of line 2 (written from fwd's signed itemShape + picked), closeDecl.list (fwd's own checkList rows), and the
// files loop's source door writes (source.json, tree/input/notes.md, tree/output/steps/2.json).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const imp = (p) => import(pathToFileURL(p).href);
const L = (f) => imp(path.join(HERE, 'loop', 'src', f));
const S = (f) => imp(path.join(REPO, 'src', f));
const OUT = path.join(REPO, '.claude/scratch/f246'); fs.mkdirSync(OUT, { recursive: true });
const out = { bars: {}, notes: {} };
const bar = (k, verdict, detail) => { out.bars[k] = { verdict, detail }; console.log(`${k}: ${verdict}`, JSON.stringify(detail)); };
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

// ---- self-check: the copy is the tag
const chk = execFileSync('node', [path.join(HERE, 'copy-loop.mjs'), '--check'], { encoding: 'utf8', timeout: 60000 }).trim();
out.notes.copyCheck = JSON.parse(chk);
if (out.notes.copyCheck.differ !== 0) { console.log('COPY DIFFERS, VOID'); process.exit(2); }

const { readFlow } = await S('flow.js');
const { loadCatalogue } = await S('catalogue.js');
const { canFlowRun, findUnbuildableCheckStep } = await S('canrun.js');
const { checkedLines } = await S('checked.js');
const catalogue = loadCatalogue().primitives;

// ---- (P) the rescan, taken before
function flowDirs() {
  const found = [];
  const walk = (d, depth) => {
    if (depth > 9) return;
    let ents; try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch { return; }
    const names = new Set(ents.map((e) => e.name));
    if (names.has('declaration.json') && names.has('signature.json')) found.push(d);
    for (const e of ents) if (e.isDirectory() && !['runs', 'node_modules', '.git', 'signed'].includes(e.name)) walk(path.join(d, e.name), depth + 1);
  };
  walk(path.join(REPO, 'test/fixtures'), 0); walk(path.join(REPO, '.claude/scratch'), 0);
  return found.sort();
}
function treeStat(d) { let n = 0, m = 0; const w = (x) => { for (const e of fs.readdirSync(x, { withFileTypes: true })) { const p = path.join(x, e.name); if (e.isDirectory()) w(p); else { n++; m = Math.max(m, fs.statSync(p).mtimeMs); } } }; try { w(d); } catch { /* */ } return { n, m }; }
function rescan() {
  return flowDirs().map((d) => {
    const row = { dir: path.relative(REPO, d), files: ['declaration.json', 'signature.json', 'prose.txt'].map((f) => { try { return sha(fs.readFileSync(path.join(d, f))); } catch { return null; } }), tree: treeStat(d) };
    try {
      const r = readFlow({ root: path.dirname(d), name: path.basename(d), catalogue });
      if (!r.ok) return { ...row, ok: false, reds: JSON.stringify(r.reds ?? r.red ?? null) };
      const unb = findUnbuildableCheckStep(r.declaration); const can = canFlowRun(r);
      let lines = null; try { lines = checkedLines(r.declaration); } catch (e) { lines = `threw ${e.message}`; }
      return { ...row, ok: true, unb: unb ? unb.say : null, can: can.ok ? true : can.red, lines: sha(JSON.stringify(lines)) };
    } catch (e) { return { ...row, ok: 'threw', why: String(e.message).slice(0, 120) }; }
  });
}
const before = rescan();

// ---- the flow, copied
const FLOW = path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/research-walk-am10');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f246-'));
let exitCode = 0;
try {
  const root = path.join(tmp, 'flows'); fs.mkdirSync(root);
  fs.cpSync(FLOW, path.join(root, 'research-walk-am10'), { recursive: true });
  const read = readFlow({ root, name: 'research-walk-am10', catalogue });
  if (!read.ok) throw new Error('readFlow red');
  const decl = read.declaration;
  const step2 = decl.steps.find((s) => s.fromLine === 2);
  const notesMd = fs.readFileSync(path.join(FLOW, 'runs/run-2/inputs/notes.md'), 'utf8');
  const log = JSON.parse(fs.readFileSync(path.join(FLOW, 'runs/run-2/log.json'), 'utf8'));
  const real = log.attempts.filter((a) => a.step === 'research_items').map((a) => ({ attempt: a.attempt, answer: a.modelOutput }));
  out.notes.realAttempts = real.map((r) => ({ attempt: r.attempt, keys: Object.keys(r.answer), results: r.answer.results?.length, listLinesInText: (String(r.answer.text).match(/^\s*(?:\d+\.|-)\s/gm) ?? []).length }));

  // ---- Q1: labels, defaults, reads
  const { CheckBlock } = await S('checkblock.js');
  const bd = (labels, cited) => { const b = new CheckBlock({ texts: Object.fromEntries(labels.map((l) => [l, 'x'])), labels, cited }); const parts = [], rows = []; b.buildDefaults({ n: 2 }, parts, rows, new Set()); const r = b.rowsOn(2, 'cited')[0]; return { labels, cited, parts: parts.map((p) => ({ check: p.check, source: p.source, text: p.text })), citedRow: r ? { key: r.key, state: r.state, reason: r.reason } : null }; };
  const q1b = { one: bd(['notes'], true), two: bd(['a', 'b'], true), zero: bd([], true), oneCitedFalse: bd(['notes'], false) };
  const diff = execFileSync('bash', ['-c', `diff <(sed -n 765,778p ${HERE}/loop/src/checkblock.js 2>/dev/null; true) /dev/null | head -0; git -C /home/hamr/PycharmProjects/bareloop show v0.61.0:src/checkblock.js | sed -n 765,775p > ${tmp}/l.txt; sed -n 801,811p ${REPO}/src/checkblock.js > ${tmp}/f.txt; diff ${tmp}/l.txt ${tmp}/f.txt; true`], { encoding: 'utf8', timeout: 20000 });
  const { buildEmitArtifactSchema } = await S('model-step.js');
  const sch = (cited) => { const s = buildEmitArtifactSchema('green', cited, null, true, true); return { props: Object.keys(s.properties ?? {}), required: s.required }; };
  const fixture = JSON.parse(fs.readFileSync(path.join(REPO, 'test/fixtures/m10-ask-cited-run/flow/declaration.json'), 'utf8'));
  const norm = (s) => s.toLowerCase().replace(/[\s*_]+/g, ' ').trim();
  const nN = norm(notesMd);
  const l1 = JSON.parse(fs.readFileSync(path.join(FLOW, 'runs/run-2/artifacts/research_notes_content.json'), 'utf8'));
  const l1text = String(l1.text ?? l1.artifact?.text ?? JSON.stringify(l1));
  const sentences = l1text.split(/(?<=[.;:])\s+|\n+/).map((x) => x.trim()).filter((x) => x.length > 15);
  const summaries = real.flatMap((r) => (r.answer.results ?? []).map((i) => i.summary));
  const q1c = {
    line2: { reads: step2.reads, primitives: step2.primitives, close: Object.keys(step2.close) },
    m10CitedFixtureLine2: { reads: fixture.steps[1].reads, primitives: fixture.steps[1].primitives },
    inputs: Object.keys(decl.inputFacts ?? {}),
    schemaListNoCited: sch(false), schemaListWithCited: sch(true),
    quotableFromNotes: { summariesChecked: summaries.length, summariesFoundWordForWord: summaries.filter((s) => nN.includes(norm(s))).length, line1SentencesChecked: sentences.length, line1SentencesFoundWordForWord: sentences.filter((s) => nN.includes(norm(s))).length },
  };
  out.notes.Q1 = { b: q1b, buildDefaultsDiffLoopVsFwd: diff, c: q1c };
  console.log('Q1', JSON.stringify(out.notes.Q1));
  const m1 = q1b.one.parts.length === 1 && q1b.one.parts[0].check === 'cited' && q1b.one.parts[0].source === 'notes' && q1b.one.citedRow.state === 'built';
  const m2 = q1b.two.parts.length === 0 && q1b.two.citedRow.state === 'not-checked' && /input/i.test(String(q1b.two.citedRow.reason));
  bar('M1', m1 ? 'PASS' : 'FAIL', { at: 'buildDefaults (block), not a full sign', one: q1b.one });
  bar('M2', m2 ? 'PASS' : 'FAIL', { at: 'buildDefaults (block), not a full sign', two: q1b.two });

  // ---- stage params of line 2 (boundary stub)
  const fields = step2.close.itemShape.fields;
  const shapePart = { class: 'shape', text: 'each item has a title; each item has a status; each item has a summary', fields: fields.map((f) => ({ name: f.name, spec: f.spec, rule: f.rule })), rules: [1, 2, 3] };
  const pickPart = { text: 'exactly 4 list items', class: 'countable', check: 'listItems', value: 4 };
  const citedPart = { text: 'every claim is backed by a quote copied from "notes"', class: 'countable', check: 'cited', source: 'notes' };
  const paramsNC = { step: 2, parts: [shapePart, pickPart] };
  const paramsC = { step: 2, parts: [shapePart, pickPart, citedPart] };
  const listNC = decl.checkList.filter((r) => r.line === 2);
  const listC = [...listNC, { line: 2, key: 'L2.$cited', kind: 'cited', by: 'default', from: 'default', state: 'built', part: { line: 2, part: 2 } }];
  const listShape = [...listNC, { line: 2, key: 'L2.$shape', kind: 'shape', by: 'default', from: 'default', state: 'built' }];
  out.notes.listRowsLine2 = listNC.map((r) => `${r.key}:${r.kind}:${r.state}`);

  const { runStage, STOP_FAULTS } = await L('kinds.js');
  let n = 0;
  async function grade(params, list, answer, { withNotes = true } = {}) {
    const wd = path.join(tmp, `run${++n}`); const tree = path.join(wd, 'tree');
    fs.mkdirSync(path.join(tree, 'input'), { recursive: true }); fs.mkdirSync(path.join(tree, 'output/steps'), { recursive: true });
    fs.writeFileSync(path.join(tree, 'input/notes.md'), notesMd);
    fs.writeFileSync(path.join(wd, 'source.json'), JSON.stringify({ inputs: [{ label: 'notes', rel: 'input/notes.md', sha256: sha(notesMd) }] }));
    if (answer !== undefined) fs.writeFileSync(path.join(tree, 'output/steps/2.json'), typeof answer === 'string' ? answer : JSON.stringify(answer));
    const r = await runStage({ name: 'line-2', kind: 'rubric-step', params }, { workdir: tree, gapKeep: '', gapCap: 40, list });
    const d = r.detail ?? {};
    return { verdict: r.verdict, gapLines: r.gapLines, rows: Object.fromEntries((d.rows ?? []).map((x) => [x.key, x.result])), why: Object.fromEntries((d.rows ?? []).filter((x) => x.why).map((x) => [x.key, x.why])), unclaimed: d.unclaimed ?? [], items: d.items ?? [], stop: r.verdict === 'stopped' ? r : undefined };
  }
  const item = (i, o = {}) => ({ title: ['Battery recycling study', 'Warehouse robotics survey', 'Tariff impact review', 'Solar permit timelines'][i], status: ['in progress', 'closed', 'finished', 'finished'][i], summary: `Short summary ${i + 1}.`, ...o });
  const four = [0, 1, 2, 3].map((i) => item(i));
  const listText = four.map((i) => `- ${i.title}`).join('\n');
  const cites = { notes: [
    { claim: 'The battery recycling study is still in progress', quote: 'We are still working through this one.' },
    { claim: 'The warehouse robotics survey was closed', quote: 'This was closed last week after the sponsor cancelled the budget.' },
    { claim: 'The tariff impact review was finished', quote: 'We finished this review in October.' },
    { claim: 'The solar permit work is finished', quote: 'This work is finished and filed.' }] };
  const good = { results: four, text: listText, done: true };
  const goodC = { ...good, cites };
  const rowsOf = (g, keys) => keys.map((k) => g.rows[k]);
  const FIELD_ROWS = ['L2.~1', 'L2.~2', 'L2.~3'];

  // ---- (R1) real answers
  const r1 = [];
  for (const r of real) {
    const nc = await grade(paramsNC, listNC, r.answer); const c = await grade(paramsC, listC, r.answer);
    r1.push({ attempt: r.attempt, nc, c });
  }
  const r1pass = r1.every((x) => {
    const nc = x.nc;
    const ok1 = nc.verdict === 'red' && nc.gapLines.length === 1 && /"text" has 0 list items, exactly 4 are required/.test(nc.gapLines[0]) && nc.rows['L2.~4'] === 'failed' && FIELD_ROWS.every((k) => nc.rows[k] === 'passed') && nc.rows['L2.$floor'] === 'passed' && nc.unclaimed.length === 0;
    const c = x.c; const ok2 = c.verdict === 'red' && c.rows['L2.~4'] === 'failed' && c.rows['L2.$cited'] === 'failed' && FIELD_ROWS.every((k) => c.rows[k] === 'passed');
    return ok1 && ok2;
  });
  bar('R1', r1pass ? 'PASS' : 'FAIL', r1.map((x) => ({ attempt: x.attempt, nc: { v: x.nc.verdict, gap: x.nc.gapLines, rows: x.nc.rows, unclaimed: x.nc.unclaimed }, c: { v: x.c.verdict, gap: x.c.gapLines, rows: x.c.rows, why: x.c.why['L2.$cited'] } })));

  // ---- (R2) hand-made good answers
  const g2 = await grade(paramsNC, listNC, good); const g2c = await grade(paramsC, listC, goodC);
  const allPassed = (g, keys) => keys.every((k) => g.rows[k] === 'passed');
  bar('R2', g2.verdict === 'green' && allPassed(g2, ['L2.~1', 'L2.~2', 'L2.~3', 'L2.~4', 'L2.$floor']) && g2c.verdict === 'green' && allPassed(g2c, ['L2.~1', 'L2.~2', 'L2.~3', 'L2.~4', 'L2.$floor', 'L2.$cited']) ? 'PASS' : 'FAIL',
    { nc: { v: g2.verdict, gap: g2.gapLines, rows: g2.rows }, c: { v: g2c.verdict, gap: g2c.gapLines, rows: g2c.rows } });

  // ---- (R3) one bad item at a time
  const bads = [
    ['no title', 'L2.~1', (a) => { const x = structuredClone(a); delete x.results[1].title; return x; }],
    ['status open', 'L2.~2', (a) => { const x = structuredClone(a); x.results[1].status = 'open'; return x; }],
    ['200-char summary', 'L2.~3', (a) => { const x = structuredClone(a); x.results[1].summary = 'x'.repeat(200); return x; }],
  ];
  const r3 = [];
  for (const [name, key, mk] of bads) {
    const g = await grade(paramsNC, listNC, mk(good));
    const others = ['L2.~1', 'L2.~2', 'L2.~3', 'L2.~4', 'L2.$floor'].filter((k) => k !== key);
    r3.push({ name, key, ok: g.verdict === 'red' && g.rows[key] === 'failed' && others.every((k) => g.rows[k] === 'passed') && g.unclaimed.length === 0 && g.items.length >= 1, v: g.verdict, rows: g.rows, why: g.why[key], items: g.items, unclaimed: g.unclaimed, gap: g.gapLines });
  }
  bar('R3', r3.every((x) => x.ok) ? 'PASS' : 'FAIL', r3);

  // ---- (R4) whole-field reds
  const r4 = {};
  for (const [name, ans] of [['results absent', { text: listText, done: true }], ['results a string', { results: 'four items', text: listText, done: true }]]) {
    r4[name] = { a_fwdList: await grade(paramsNC, listNC, ans), b_stubShapeRow: await grade(paramsNC, listShape, ans) };
  }
  const brief = (g) => ({ v: g.verdict, gap: g.gapLines, failed: Object.entries(g.rows).filter(([, v]) => v !== 'passed'), unclaimed: g.unclaimed });
  bar('R4', 'REPORTED', Object.fromEntries(Object.entries(r4).map(([k, v]) => [k, { a_fwdList: brief(v.a_fwdList), b_stubShapeRow: brief(v.b_stubShapeRow) }])));

  // ---- (R5) item-field rows shown
  bar('R5', ['L2.~1', 'L2.~2', 'L2.~3'].every((k) => g2.rows[k] === 'passed') ? 'PASS' : 'FAIL', { goodRows: g2.rows });

  // ---- harness must-fail: R1 cannot be red on a good answer (checked via R2 green above); R3 flips a row against R2's green
  bar('HARNESS', g2.verdict === 'green' && r3.every((x) => g2.rows[x.key] === 'passed' && x.rows[x.key] === 'failed') ? 'PASS' : 'INCONCLUSIVE', { goodVerdict: g2.verdict });

  // ---- (B) the brief
  const { lineBriefs, rubricGoal } = await L('rubricstep.js');
  const closeDecl = { stages: [{ name: 'line-2', kind: 'rubric-step', params: paramsNC }], picks: [{ line: 2, part: pickPart }] };
  const lb = lineBriefs(closeDecl).find((b) => b.line === 2)?.text ?? '';
  const rule = 'each item has a title; each item has a status: in progress, closed or finished; each item has a summary under 200 characters; exactly 4 list items';
  const goal = rubricGoal({ jobLines: [{ n: 1, text: 'Read the research notes.', rule: '' }, { n: 2, text: 'List every research item.', rule }, { n: 3, text: 'Check it with me.', rule: '' }, { n: 4, text: 'Write it out.', rule: '' }], files: [{ label: 'notes', rel: 'input/notes.md' }], closeDecl });
  const countSentence = 'Your "text" must have exactly 4 list items';
  const { shapeLineBrief } = await S('rubricstep.js');
  const fwdBrief = shapeLineBrief(2, step2.close.itemShape, true);
  const bPass = lb.includes(countSentence) && lb.includes('TEXT line AND a LIST line');
  bar('B', bPass ? 'PASS' : 'FAIL', { lineBriefHasCountSentence: lb.includes(countSentence), lineBriefHasTextAndList: lb.includes('TEXT line AND a LIST line'), goalHasCountSentence: goal.includes(countSentence), goalHasRuleWords: goal.includes('exactly 4 list items'), lineBrief: lb, fwdShapeLineBriefHasCountSentence: fwdBrief.includes(countSentence), fwdShapeLineBriefHasTextAndList: fwdBrief.includes('TEXT line AND a LIST line') });

  // ---- M7, M8, M9 on today's src
  const unb = findUnbuildableCheckStep(decl);
  bar('M7', unb === null ? 'PASS' : 'FAIL', { today: unb ? unb.say : null, expected: 'FAIL today (the live bug)' });
  const decl8 = structuredClone(decl); decl8.steps.find((s) => s.fromLine === 2).close = { class: 'green' };
  const unb8 = findUnbuildableCheckStep(decl8);
  bar('M8', unb8 && unb8.step.fromLine === 2 ? 'PASS' : 'FAIL', { today: unb8 ? unb8.say : null });
  const lines = checkedLines(decl);
  const flat = JSON.stringify(lines);
  bar('M9', /Every figure must cite its source cell/.test(flat) ? 'FAIL' : 'PASS', { leadShown: /Every figure must cite its source cell/.test(flat), expected: 'FAIL today (F245 E)' });
  const premiseHeld = out.bars.M7.verdict === 'FAIL' && out.bars.M9.verdict === 'FAIL';
  if (!premiseHeld) out.bars.PREMISE = { verdict: 'INCONCLUSIVE', detail: 'M7 or M9 passed today: the live premise is not reproduced' };
} catch (e) { out.threw = String(e.stack ?? e); console.log('THREW', out.threw); exitCode = 1; } finally { fs.rmSync(tmp, { recursive: true, force: true }); }

// ---- (P) after
const after = rescan();
const same = JSON.stringify(before) === JSON.stringify(after);
let gitSrc = '';
try { gitSrc = execFileSync('git', ['-C', REPO, 'status', '--porcelain', '--', 'src'], { encoding: 'utf8' }) + execFileSync('git', ['-C', REPO, 'diff', '--stat', 'HEAD', '--', 'src'], { encoding: 'utf8' }); } catch (e) { gitSrc = `git failed ${e.message}`; }
bar('P', same && gitSrc.trim() === '' ? 'PASS' : 'FAIL', { flows: before.length, refused: before.filter((r) => r.ok !== true).length, changed: before.map((b, i) => (JSON.stringify(b) !== JSON.stringify(after[i]) ? b.dir : null)).filter(Boolean), srcDirty: gitSrc.trim() });
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
fs.writeFileSync(path.join(OUT, `RESULT-${stamp}.json`), JSON.stringify(out, null, 1));
console.log('wrote', `.claude/scratch/f246/RESULT-${stamp}.json`);
process.exit(exitCode);
