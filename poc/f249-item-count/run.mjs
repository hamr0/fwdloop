// F249 ($0, no AI, no key, no panel, no node --test). Pre-registered in docs/logs/FINDINGS.md before this file. NOT the product.
// usage: node poc/f249-item-count/make-candidate.mjs [--off]; node poc/f249-item-count/run.mjs --today | --off | --candidate
//   --today     today's src (A, and the data E compares against)
//   --off       the candidate copy with the new branch switched off (F: the must-fail arm)
//   --candidate the patched COPY of src (B, C, D, E, F). Reads RESULT-today.json and RESULT-off.json from .claude/scratch/f249.
// Plans are rebuilt through the real path (rebuildBlock -> assembleFromBlock) from mkdtemp COPIES of test/fixtures/m19-am10 and the saved draft folders; the walk's log.json is read only.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..', '..');
const MODE = process.argv.includes('--candidate') ? 'candidate' : process.argv.includes('--off') ? 'off' : 'today';
const OUT = path.join(REPO, '.claude/scratch/f249'); fs.mkdirSync(OUT, { recursive: true });
const srcRoot = MODE === 'today' ? path.join(REPO, 'src') : path.join(OUT, MODE === 'off' ? 'cand-off' : 'cand', 'src');
const imp = (f) => import(pathToFileURL(path.join(srcRoot, f)).href);
const L = (f) => import(pathToFileURL(path.join(MODE === 'candidate' ? path.join(OUT, 'loop-cand') : path.join(HERE, '..', 'f246-loop-shape-run', 'loop', 'src'), f)).href);
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const S = (o) => JSON.stringify(o);
const out = { mode: MODE, bars: {}, notes: {} };
const bar = (k, verdict, detail) => { out.bars[k] = { verdict, detail }; console.log(`${k}: ${verdict} ${JSON.stringify(detail).slice(0, 1800)}`); };

// the loop copy for C2: today = the F246 copy as it is; candidate = a patched COPY (count gap lands on the rule row that holds the count), scratch only
if (MODE === 'candidate') {
  const dst = path.join(OUT, 'loop-cand'); fs.rmSync(dst, { recursive: true, force: true });
  fs.cpSync(path.join(HERE, '..', 'f246-loop-shape-run', 'loop', 'src'), dst, { recursive: true });
  // dist copy of package.json for ESM resolution is not needed (the files import each other by relative path and bareguard by name, found above the repo)
  const f = path.join(dst, 'rowresults.js'); let t = fs.readFileSync(f, 'utf8');
  const was = "      if (raw === null) { if (defaults.length === 0) unclaimed.push(plain()); else for (const r of defaults) hit(r, plain()); continue; }";
  const now = "      if (raw === null) {\n        // F249 (loop-side change, measured as C2b): a count gap lands on the `[you]` rule rows that point at the shape part and are no field's rule (the rule that holds the count)\n        const fr = new Set((shape?.fields ?? []).map((x) => x.rule));\n        const cr = /\\.count|count-(under|over)/.test(String(g.kind)) || g.kind === 'count-under' || g.kind === 'count-over' ? rows.filter((r) => r.kind === 'rule' && Array.isArray(shape?.rules) && shape.rules.includes(r.rule) && !fr.has(r.rule)) : [];\n        if (cr.length) { for (const r of cr) hit(r, plain()); continue; }\n        if (defaults.length === 0) unclaimed.push(plain()); else for (const r of defaults) hit(r, plain()); continue;\n      }";
  if (t.split(was).length !== 2) throw new Error('loop rowresults anchor not found once');
  fs.writeFileSync(f, t.replace(was, () => now));
}

const { rebuildBlock } = await imp('planrebuild.js');
const { assembleFromBlock } = await imp('blockassemble.js');
const { validateDeclaration } = await imp('declaration.js');
const { loadCatalogue } = await imp('catalogue.js');
const { WIRED_VERBS } = await imp('primitives.js');
const { csvRolesOf } = await imp('sheetblock.js');
const { docRolesOf } = await imp('drafter.js');
const { cardOfBlock, cardOfPlanBlock } = await imp('cardlist.js');
const { withSheetRows, withSheetCard } = await imp('sheetrows.js');
const { withTicketRows } = await imp('ticketrows.js');
const { cardOfPlan } = await imp('checkrows.js');
const { closeByClass } = await imp('closers.js');
const { closeRecords } = await imp('try-checks.js');
const { plainWords } = await imp('checkwords.js');
const cat = loadCatalogue();

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f249-'));
let seq = 0;
const FX = path.join(REPO, 'test/fixtures/m19-am10');
const WALK = path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/research-walk-am10');

/** build the plan of a plan folder (a copy) through the real path; `edit` may change prose.txt first */
function build(srcDir, { edit = null, fixture = false } = {}) {
  const root = path.join(tmp, `p${++seq}`); fs.mkdirSync(root);
  const planDir = path.join(root, 'plan'); fs.cpSync(srcDir, planDir, { recursive: true });
  if (fixture) {
    for (const f of ['prose.txt', 'target.json']) { const p = path.join(planDir, f); fs.writeFileSync(p, fs.readFileSync(p, 'utf8').replaceAll('__ROOT__', root)); }
    fs.copyFileSync(path.join(FX, 'research-notes.md'), path.join(root, 'research-notes.md'));
  }
  if (edit) { const p = path.join(planDir, 'prose.txt'); fs.writeFileSync(p, edit(fs.readFileSync(p, 'utf8'))); }
  const b = rebuildBlock({ planDir, asks: true });
  if (!b.ok) return { ok: false, say: b.say };
  const roles = csvRolesOf(b.parsed.arbiter);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((a) => a.line)), sheetRoles: roles });
  const ws = withSheetRows({ declaration: built.declaration, lines: b.lines, csvRoles: roles });
  const wt = withTicketRows({ declaration: ws.declaration, lines: b.lines });
  const decl = wt.declaration;
  const validate = validateDeclaration(decl, { arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true, pageWords: { texts: b.texts, look: null, docs: docRolesOf(b.parsed.arbiter.sources) } });
  const c0 = withSheetCard(cardOfBlock(b.block), ws.sheet);
  const card = cardOfPlanBlock(b.block, wt.tickets.card.length ? withSheetCard(c0, { card: wt.tickets.card }) : c0, { declaration: decl, lines: b.lines, csvRoles: roles, log: Array.isArray(b.log?.log) ? b.log.log : [] });
  return { ok: true, b, decl, validate, card, planCard: cardOfPlan({ declaration: decl, lines: b.lines, csvRoles: roles }) };
}
const withRule4 = (text) => (p) => { if (!p.includes('exactly 4 list items')) throw new Error('rule 4 words not in prose'); return p.replace('exactly 4 list items', text); };
const hasItemShape = (decl) => (decl.steps ?? []).some((s) => isRec(s.close) && isRec(s.close.itemShape));
const step2Of = (decl) => decl.steps.find((s) => s.fromLine === 2);
const row = (decl, key) => (decl.checkList ?? []).find((r) => r.key === key);

// ---------------------------------------------------------------- plans (A, B, D)
const plans = {};
for (const [name, text] of [['exact4', 'exactly 4 list items'], ['atleast3', 'at least 3 list items'], ['atmost5', 'at most 5 list items'], ['atmost0', 'at most 0 list items']]) {
  try { plans[name] = build(FX, { edit: name === 'exact4' ? null : withRule4(text), fixture: true }); } catch (e) { plans[name] = { ok: false, say: String(e.message) }; }
}
const sig = (p) => {
  if (!p.ok) return { refused: p.say };
  const st = step2Of(p.decl);
  return { class: st.close.class, itemShape: st.close.itemShape ? { minItems: st.close.itemShape.minItems ?? null, maxItems: st.close.itemShape.maxItems ?? null, fields: st.close.itemShape.fields.map((f) => f.name) } : null, picked: st.close.picked ?? null, pickedLines: p.decl.pickedLines ?? null, shapeKey: st.close.shape ?? null,
    row4: row(p.decl, 'L2.~4') ?? null, defaultRow: row(p.decl, 'L2.$shape') ?? null, validate: p.validate.ok ? 'ok' : p.validate.reds.map(String).slice(0, 3),
    cardRow4: (p.planCard.rows ?? []).filter((r) => r.line === 2 && r.key === 'L2.~4').map((r) => ({ key: r.key, by: r.by, kind: r.kind, part: r.part, text: r.text })),
    cardRows: (p.planCard.rows ?? []).filter((r) => r.line === 2).map((r) => `${r.key}|${r.by}|${r.part}|${r.text}`) };
};
out.notes.plans = Object.fromEntries(Object.entries(plans).map(([k, p]) => [k, sig(p)]));
const s4 = out.notes.plans.exact4;

// ---------------------------------------------------------------- answers
const log = J(path.join(WALK, 'runs/run-2/log.json'));
const real = (log?.attempts ?? []).filter((a) => a.step === 'research_items').map((a) => ({ attempt: a.attempt, answer: a.modelOutput }));
out.notes.realAttempts = real.map((r) => ({ attempt: r.attempt, results: r.answer?.results?.length, textListLines: (String(r.answer?.text).match(/^\s*(?:\d+\.|-)\s/gm) ?? []).length }));
const item = (i, o = {}) => ({ title: ['Battery recycling study', 'Warehouse robotics survey', 'Tariff impact review', 'Solar permit timelines', 'Fifth study', 'Sixth study'][i], status: ['in progress', 'closed', 'finished', 'finished', 'closed', 'closed'][i], summary: `Short summary ${i + 1}.`, ...o });
const items = (n) => Array.from({ length: n }, (_x, i) => item(i));
const prose = 'Four items were found (1) battery (2) warehouse (3) tariff (4) solar.';
const ans = (n, text = prose) => ({ results: items(n), text, done: true });
const listText = (n) => items(n).map((i) => `- ${i.title}`).join('\n');

// ---------------------------------------------------------------- graders
const notesMd = fs.readFileSync(path.join(WALK, 'runs/run-2/inputs/notes.md'), 'utf8');
const { runStage } = await L('kinds.js');
const { runStage: runStageRaw } = await import(pathToFileURL(path.join(HERE, '..', 'f246-loop-shape-run', 'loop', 'src', 'kinds.js')).href);
const crypto = await import('node:crypto');
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');
/** C1: fwd's own closer, and the rows fwd's own Audit record puts the verdict on */
async function c1(p, answer) {
  const st = step2Of(p.decl);
  const v = await closeByClass(st, answer, { reads: {}, businessDate: '2026-11-21' });
  let recs = null; try { recs = closeRecords(st, answer, v, p.decl.checkList).map((r) => ({ n: r.n, ok: r.ok, by: r.by ?? null, part: r.part ?? null, text: r.text, result: r.result })); } catch (e) { recs = `threw ${e.message}`; }
  return { verdict: v.verdict, red: v.red ?? null, gaps: (v.shapeGaps ?? []).map((g) => `${g.kind}${g.measured !== undefined ? `:${g.measured}/${g.limit}` : ''}`), records: recs };
}
/** C2: the F246 copied loop rubric over the stage params and list of the SIGNED declaration */
function stageOf(p) {
  const st = step2Of(p.decl); const list = (p.decl.checkList ?? []).filter((r) => r.line === 2);
  const shapeIdx = 0;
  const shapeRules = list.filter((r) => r.kind === 'rule' && isRec(r.part) && r.part.part === shapeIdx).map((r) => r.rule);
  const parts = [];
  if (st.close.itemShape) parts.push({ class: 'shape', text: 'the items of line 2', fields: st.close.itemShape.fields.map((f) => ({ name: f.name, spec: f.spec, rule: f.rule })), ...(Number.isInteger(st.close.itemShape.minItems) ? { minItems: st.close.itemShape.minItems } : {}), ...(Number.isInteger(st.close.itemShape.maxItems) ? { maxItems: st.close.itemShape.maxItems } : {}), rules: shapeRules });
  (st.close.picked ?? []).forEach((c, i) => { const { rule, ...f } = c; parts.push({ text: plainWords(c), class: 'countable', check: rule, ...f, rules: list.filter((r) => r.kind === 'rule' && isRec(r.part) && r.part.part === parts.length).map((r) => r.rule) }); });
  return { params: { step: 2, parts }, list };
}
let gn = 0;
async function c2(p, answer, run = runStage) {
  const { params, list } = stageOf(p);
  const wd = path.join(tmp, `g${++gn}`); const tree = path.join(wd, 'tree');
  fs.mkdirSync(path.join(tree, 'input'), { recursive: true }); fs.mkdirSync(path.join(tree, 'output/steps'), { recursive: true });
  fs.writeFileSync(path.join(tree, 'input/notes.md'), notesMd);
  fs.writeFileSync(path.join(wd, 'source.json'), JSON.stringify({ inputs: [{ label: 'notes', rel: 'input/notes.md', sha256: sha(notesMd) }] }));
  fs.writeFileSync(path.join(tree, 'output/steps/2.json'), JSON.stringify(answer));
  const r = await run({ name: 'line-2', kind: 'rubric-step', params }, { workdir: tree, gapKeep: '', gapCap: 40, list });
  const d = r.detail ?? {};
  return { verdict: r.verdict, gapLines: r.gapLines, failedRows: (d.rows ?? []).filter((x) => x.result !== 'passed').map((x) => `${x.key}:${x.result}`), passedRows: (d.rows ?? []).filter((x) => x.result === 'passed').map((x) => x.key), unclaimed: d.unclaimed ?? [] };
}
const both = async (p, answer) => ({ c1: await c1(p, answer), c2: await c2(p, answer), c2raw: MODE === 'today' ? undefined : await c2(p, answer, runStageRaw) });

// ---------------------------------------------------------------- measure C on the exact-4 plan
const P = plans.exact4;
if (P.ok) {
  const cases = {};
  real.forEach((r, i) => { cases[`real${i + 1}`] = r.answer; });
  cases.good4prose = ans(4); cases.good4list = ans(4, listText(4)); cases.items5 = ans(5); cases.items3 = ans(3); cases.items5list = ans(5, listText(5)); cases.items3list = ans(3, listText(3));
  cases.noTitle = (() => { const a = ans(4); delete a.results[1].title; return a; })();
  cases.statusOpen = (() => { const a = ans(4); a.results[1].status = 'open'; return a; })();
  cases.summary200 = (() => { const a = ans(4); a.results[1].summary = 'x'.repeat(200); return a; })();
  out.notes.C = {};
  for (const [k, a] of Object.entries(cases)) { try { out.notes.C[k] = await both(P, a); } catch (e) { out.notes.C[k] = { threw: String(e.stack ?? e).split('\n').slice(0, 3).join(' | ') }; } }
}

// ---------------------------------------------------------------- D: the other directions, graded at the boundary
const Dres = {};
for (const [name, lo, hi, okAt, redAt] of [['atleast3', 3, null, [3, 4], [2]], ['atmost5', null, 5, [4, 5], [6]]]) {
  const p = plans[name]; if (!p.ok) { Dres[name] = { refused: p.say }; continue; }
  const g = {};
  for (const n of [...okAt, ...redAt]) { const a = await both(p, ans(n)); g[n] = { c1: a.c1.verdict, c2: a.c2.verdict, c2failed: a.c2.failedRows, c1gaps: a.c1.gaps }; }
  Dres[name] = { sig: out.notes.plans[name], g, okAt, redAt };
}
out.notes.D = Dres;

// ---------------------------------------------------------------- E: every saved draft folder the F244 harness reads, plus the fixture
const roots = [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/.drafts')];
const walk = (p, dep, acc) => { if (dep > 4) return; let es; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; } if (es.some((e) => e.name === 'declaration.json')) acc.push(p); for (const e of es) if (e.isDirectory() && e.name !== 'pages') walk(path.join(p, e.name), dep + 1, acc); };
const dirs = []; for (const r of roots) walk(r, 0, dirs);
const Edata = {}; const Eskipped = [];
for (const dir of [...dirs, FX]) {
  const id = dir === FX ? 'fixture/m19-am10' : dir.split('/').slice(-3).join('/');
  const decl0 = J(`${dir}/declaration.json`);
  if (!decl0) continue;
  try {
    const p = build(dir, { fixture: dir === FX });
    if (!p.ok) { Eskipped.push(`${id}: ${p.say}`); continue; }
    Edata[id] = { shape: hasItemShape(p.decl), decl: S(p.decl), card: S(p.card), planCard: S(p.planCard), valid: p.validate.ok };
  } catch (e) { Eskipped.push(`${id}: threw ${String(e.message).slice(0, 80)}`); }
}
// a text-only line with "exactly 3 bullets": the fixture's prose with line 2's field rules removed, rebuilt through the same path
try {
  const p = build(FX, { fixture: true, edit: (t) => t.replace(/guardrail: each item has a title;.*exactly 4 list items/, 'guardrail: exactly 3 bullets') });
  out.notes.textOnly = p.ok ? { hasItemShape: hasItemShape(p.decl), picked: step2Of(p.decl).close.picked ?? null, shape: step2Of(p.decl).close.shape ?? null, class: step2Of(p.decl).close.class, cls: p.decl.guardrailClasses, row: (p.decl.checkList ?? []).filter((r) => r.line === 2).map((r) => `${r.key}:${r.from}:${r.state}`) } : { refused: p.say };
} catch (e) { out.notes.textOnly = { threw: String(e.message) }; }
out.E = { drafts: Object.keys(Edata).length, skipped: Eskipped, data: Edata };
fs.rmSync(tmp, { recursive: true, force: true });

// ---------------------------------------------------------------- bars (candidate evaluates; today and off just record)
const sum = (o) => ({ A: undefined, ...o });
const c = out.notes.C ?? {};
const pass = (b) => (b ? 'PASS' : 'FAIL');
if (MODE === 'today') {
  const a = s4.picked && s4.picked[0]?.rule === 'listItems' && s4.picked[0].value === 4 && Array.isArray(s4.pickedLines) && s4.pickedLines[0] === 2 && s4.itemShape && s4.itemShape.minItems === null && s4.itemShape.maxItems === null && s4.row4?.from === 'pick' && s4.row4?.part?.part === 1;
  bar('A', a ? 'PASS' : 'INCONCLUSIVE', { picked: s4.picked, pickedLines: s4.pickedLines, itemShape: s4.itemShape, row4: s4.row4, validate: s4.validate });
  bar('C-today-real', 'REPORTED', Object.fromEntries(['real1', 'real2', 'real3', 'good4prose', 'good4list', 'items5list', 'items3list'].map((k) => [k, { c1: c[k]?.c1?.verdict, c1gaps: c[k]?.c1?.gaps, c2: c[k]?.c2?.verdict, c2failed: c[k]?.c2?.failedRows }])));
} else {
  const T = JSON.parse(fs.readFileSync(path.join(OUT, 'RESULT-today.json'), 'utf8'));
  const OFFR = MODE === 'candidate' ? J(path.join(OUT, 'RESULT-off.json')) : null;
  const bOk = s4.itemShape && s4.itemShape.minItems === 4 && s4.itemShape.maxItems === 4 && ['title', 'status', 'summary'].every((n) => s4.itemShape.fields.includes(n)) && s4.picked === null && s4.pickedLines === null && s4.shapeKey === null
    && s4.row4 && s4.row4.by === 'you' && s4.row4.kind === 'rule' && s4.row4.part?.part === 0 && s4.row4.state === 'built' && s4.defaultRow === null && s4.validate === 'ok'
    && s4.cardRow4.length === 1 && s4.cardRow4[0].by === 'you' && s4.cardRow4[0].key === 'L2.~4' && /^L2:shape:/.test(s4.cardRow4[0].part) && /4 items/.test(s4.cardRow4[0].text) && !s4.cardRows.some((x) => /pick|\$shape/.test(x));
  bar('B', pass(bOk), { sig: { itemShape: s4.itemShape, picked: s4.picked, pickedLines: s4.pickedLines, row4: s4.row4, defaultRow: s4.defaultRow, validate: s4.validate }, cardRow4: s4.cardRow4, cardRows: s4.cardRows });
  const realGreen = ['real1', 'real2', 'real3'].every((k) => c[k]?.c1?.verdict === 'green') && ['real1', 'real2', 'real3'].every((k) => c[k]?.c2?.verdict === 'green');
  const red = (k, half) => c[k]?.[half]?.verdict === 'red';
  const onRow4 = (k) => (c[k]?.c2?.failedRows ?? []).length === 1 && c[k].c2.failedRows[0] === 'L2.~4:failed' && (c[k].c2.unclaimed ?? []).length === 0;
  const fieldOnly = (k, key) => (c[k]?.c2?.failedRows ?? []).length === 1 && c[k].c2.failedRows[0] === `${key}:failed`;
  const c1real = ['real1', 'real2', 'real3'].map((k) => c[k]?.c1?.verdict);
  const c1counts = ['items5', 'items3'].every((k) => red(k, 'c1'));
  const c1row = ['items5', 'items3'].map((k) => (c[k]?.c1?.records ?? []).filter((r) => r.ok === false).map((r) => `${r.by}:${r.part}:${r.text}`));
  // C1 on the letter: verdicts AND "the red on L2.~4's row" (a failing record of the close, tagged `you`, for the count cases; a bad item reds only its own field row: a failing record tagged `you` and none other)
  const verdictOk = c1real.every((v) => v === 'green') && c1counts && ['noTitle', 'statusOpen', 'summary200'].every((k) => red(k, 'c1'));
  const youFails = (k) => (c[k]?.c1?.records ?? []).filter((r) => r.ok === false && r.by === 'you');
  const rowOk = ['items5', 'items3'].every((k) => youFails(k).length === 1) && ['noTitle', 'statusOpen', 'summary200'].every((k) => youFails(k).length === 1);
  bar('C1', pass(verdictOk && rowOk), { verdictClause: verdictOk ? 'PASS' : 'FAIL', rowClause: rowOk ? 'PASS' : 'FAIL (the close record names no rule row: its red is the generic row)', real: c1real, items5: c.items5?.c1, items3: c.items3?.c1, noTitle: c.noTitle?.c1, statusOpen: c.statusOpen?.c1 });
  const c2of = (key) => {
    const g = (k) => c[k]?.[key];
    const onRow4 = (k) => (g(k)?.failedRows ?? []).length === 1 && g(k).failedRows[0] === 'L2.~4:failed' && (g(k).unclaimed ?? []).length === 0;
    const only = (k, row) => (g(k)?.failedRows ?? []).length === 1 && g(k).failedRows[0] === `${row}:failed`;
    return { verdictClause: ['real1', 'real2', 'real3'].every((k) => g(k)?.verdict === 'green') && ['items5', 'items3', 'noTitle', 'statusOpen', 'summary200'].every((k) => g(k)?.verdict === 'red'),
      rowClause: ['items5', 'items3'].every(onRow4) && only('noTitle', 'L2.~1') && only('statusOpen', 'L2.~2') && only('summary200', 'L2.~3'),
      detail: { real: ['real1', 'real2', 'real3'].map((k) => ({ k, v: g(k)?.verdict, failed: g(k)?.failedRows })), items5: g('items5'), items3: g('items3'), bad: ['noTitle', 'statusOpen', 'summary200'].map((k) => ({ k, v: g(k)?.verdict, failed: g(k)?.failedRows })) } };
  };
  if (MODE === 'candidate') {
    const lt = c2of('c2raw'); const pt = c2of('c2');
    bar('C2', pass(lt.verdictClause && lt.rowClause), { loopCopy: 'the F246 copy AS IS (the letter of C2)', verdictClause: lt.verdictClause ? 'PASS' : 'FAIL', rowClause: lt.rowClause ? 'PASS' : 'FAIL', ...lt.detail });
    bar('C2b', pass(pt.verdictClause && pt.rowClause), { loopCopy: 'the F246 copy + a patched COPY of rowresults.js (a count gap lands on the rule row that holds the count): the minimal loop-side change; NOT pre-registered as the grader, reported beside C2', verdictClause: pt.verdictClause ? 'PASS' : 'FAIL', rowClause: pt.rowClause ? 'PASS' : 'FAIL', ...pt.detail });
  } else { const lt = c2of('c2'); bar('C2-' + MODE, pass(lt.verdictClause && lt.rowClause), { loopCopy: 'the F246 copy as is, over the ' + MODE + ' plan', verdictClause: lt.verdictClause, rowClause: lt.rowClause, ...lt.detail }); }
  bar('C2raw', 'REPORTED', { loopCopy: 'the F246 copy UNPATCHED over the candidate signed plan', real: ['real1', 'real2', 'real3'].map((k) => ({ k, v: c[k]?.c2raw?.verdict })), items5: c.items5?.c2raw, items3: c.items3?.c2raw, bad: ['noTitle', 'statusOpen', 'summary200'].map((k) => ({ k, failed: c[k]?.c2raw?.failedRows })) });
  // D
  const D = out.notes.D; const dOk = (n, ok, rd) => D[n] && D[n].g && ok.every((k) => D[n].g[k].c1 === 'green' && D[n].g[k].c2 === 'green') && rd.every((k) => D[n].g[k].c1 === 'red' && D[n].g[k].c2 === 'red');
  const dsig = D.atleast3?.sig; const dsig2 = D.atmost5?.sig;
  const dFine = dsig && dsig.itemShape?.minItems === 3 && dsig.itemShape?.maxItems === null && dsig.picked === null && dsig2 && dsig2.itemShape?.maxItems === 5 && dsig2.itemShape?.minItems === null && dsig2.picked === null;
  bar('D', pass(dFine && dOk('atleast3', [3, 4], [2]) && dOk('atmost5', [4, 5], [6])), { atleast3: D.atleast3, atmost5: D.atmost5, atmost0: out.notes.plans.atmost0 });
  // E
  const e = out.E; const te = T.E; const rows = { drafts: Object.keys(e.data).length, todayDrafts: Object.keys(te.data).length, refusedBoth: e.skipped.length === te.skipped.length ? e.skipped.length : `today ${te.skipped.length} vs ${e.skipped.length}`, noItemFields: { n: 0, identical: 0, differ: [] }, itemFields: { n: 0, identical: 0, differ: [] }, onlyOneSide: [] };
  for (const id of new Set([...Object.keys(e.data), ...Object.keys(te.data)])) {
    const a = te.data[id]; const b = e.data[id];
    if (!a || !b) { rows.onlyOneSide.push(id); continue; }
    const grp = b.shape || a.shape ? rows.itemFields : rows.noItemFields; grp.n++;
    if (a.decl === b.decl && a.card === b.card && a.planCard === b.planCard) grp.identical++; else grp.differ.push(id);
  }
  // a plan whose line has item fields and a signed listItems/min/max pick today is the plans the fix is FOR; those must differ, and only those
  const picksOfItem = (id) => { const d = JSON.parse(te.data[id].decl); return d.steps.some((s) => isRec(s.close?.itemShape) && (s.close.picked ?? []).some((x) => /ListItems$|^listItems$/.test(x.rule))); };
  const mustDiffer = rows.itemFields.differ.every((id) => picksOfItem(id));
  const itemNoCount = Object.keys(te.data).filter((id) => te.data[id].shape && !picksOfItem(id));
  const itemNoCountIdentical = itemNoCount.every((id) => te.data[id].decl === e.data[id].decl && te.data[id].card === e.data[id].card && te.data[id].planCard === e.data[id].planCard);
  const textListItems = Object.keys(te.data).filter((id) => !te.data[id].shape && JSON.parse(te.data[id].decl).steps.some((s) => (s.close?.picked ?? s.close?.shape?.picked ?? []).some((x) => x.rule === 'listItems')));
  const textKeeps = textListItems.length > 0 && textListItems.every((id) => te.data[id].decl === e.data[id].decl);
  bar('E', pass(rows.noItemFields.differ.length === 0 && rows.noItemFields.n > 0 && rows.onlyOneSide.length === 0 && mustDiffer && itemNoCountIdentical && textKeeps), { ...rows, itemFieldPlansThatDiffer: rows.itemFields.differ, allDifferingHoldACountRuleToday: mustDiffer, itemPlansWithNoCountRule: itemNoCount.length, identical: itemNoCountIdentical, textOnlyLinesWithListItemsPick: textListItems.length, keptThemUnchanged: textKeeps, handMadeBulletsVariant: { today: out.notes.textOnly, note: 'the hand-made "exactly 3 bullets" variant signed hitl with the rule Not checked on BOTH sides (identical); the clause is carried by the real drafts above' } });
  // F: the off copy must FAIL B and C in the same run
  if (MODE === 'candidate') {
    const O = OFFR; if (!O) bar('F', 'INCONCLUSIVE', { why: 'RESULT-off.json missing: run --off first' });
    else {
      const o4 = O.notes.plans.exact4; const oc = O.notes.C ?? {};
      const bOff = o4.itemShape && o4.itemShape.minItems === 4 && o4.picked === null;
      const cOff = ['items5', 'items3'].every((k) => oc[k]?.c2?.verdict === 'red' && (oc[k].c2.failedRows ?? []).join() === 'L2.~4:failed') && ['real1', 'real2', 'real3'].every((k) => oc[k]?.c2?.verdict === 'green');
      const goodNotRed = oc.good4list?.c2?.verdict === 'green' && c.good4list?.c1?.verdict === 'green';
      bar('F', pass(!bOff && !cOff && goodNotRed), { offBFailsAsExpected: !bOff, offCFailsAsExpected: !cOff, offPlan: { picked: o4.picked, itemShape: o4.itemShape }, offReal: ['real1', 'real2', 'real3'].map((k) => ({ k, c1: oc[k]?.c1?.verdict, c2: oc[k]?.c2?.verdict, failed: oc[k]?.c2?.failedRows })), goodListGreen: goodNotRed });
    }
  }
}
// the sanity of the harness itself (every mode): a good 4-item answer must not red on the count; 5 and 3 must (on the plan this mode built)
if (c.good4prose) {
  const g = c.good4prose.c1.verdict; const g5 = c.items5?.c1?.verdict; const g3 = c.items3?.c1?.verdict;
  out.notes.harnessSanity = { good4prose_c1: g, items5_c1: g5, items3_c1: g3, good4list_c1: c.good4list?.c1?.verdict, items5list_c1: c.items5list?.c1?.verdict, items3list_c1: c.items3list?.c1?.verdict };
}
console.log('sanity', S(out.notes.harnessSanity));
fs.writeFileSync(path.join(OUT, `RESULT-${MODE}.json`), JSON.stringify(out, null, 1));
console.log(`wrote .claude/scratch/f249/RESULT-${MODE}.json (E: ${Object.keys(Edata).length} plans, ${Eskipped.length} skipped)`);
