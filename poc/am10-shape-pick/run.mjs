// F243 harness (M19 am10, pre-registered in docs/logs/FINDINGS.md before this file). NOT the product. $0: no AI, no key, no panel, no node --test.
// usage: node poc/am10-shape-pick/run.mjs --today | --candidate   (candidate = `make-candidate.mjs` output, a patched copy of src)
// Real path: `rebuildBlock` (src/planrebuild.js), then `assembleFromBlock` + `validateDeclaration` exactly as planrebuild.js `assembleAgain` calls them (that function is not exported).
import { cpSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, '../..');
const mode = process.argv.includes('--candidate') ? 'candidate' : 'today';
const srcRoot = mode === 'candidate' ? path.join(repo, '.claude/scratch/am10-cand/src') : path.join(repo, 'src');
const imp = (f) => import(pathToFileURL(path.join(srcRoot, f)).href);
const { rebuildBlock } = await imp('planrebuild.js');
const { assembleFromBlock } = await imp('blockassemble.js');
const { validateDeclaration } = await imp('declaration.js');
const { loadCatalogue } = await imp('catalogue.js');
const { WIRED_VERBS } = await imp('primitives.js');
const { csvRolesOf } = await imp('sheetblock.js');
const { docRolesOf } = await imp('drafter.js');
const { closeByClass } = await imp('closers.js');
const { sha256Text } = await imp('citedcheck.js');

const DRAFT = path.join(repo, '.claude/scratch/m19-walk-YBSm/flows/.drafts/d-00mwqi4sd7-86fe/draft-1');
const work = mkdtempSync(path.join(tmpdir(), 'am10-'));
const planDir = path.join(work, 'plan');
mkdirSync(planDir);
for (const f of ['prose.txt', 'log.json', 'picks-record.json', 'target.json', 'not-checked.json']) copyFileSync(path.join(DRAFT, f), path.join(planDir, f));
copyFileSync(path.join(DRAFT, 'declaration.rejected.json'), path.join(planDir, 'declaration.json'));
const saved = JSON.parse(readFileSync(path.join(planDir, 'declaration.json'), 'utf8'));

const results = []; // {bar, ok, note}
const bar = (name, ok, note = '') => { results.push({ bar: name, ok: ok === true ? 'PASS' : ok === false ? 'FAIL' : ok, note }); };
const J = (o) => JSON.stringify(o);
const clone = (o) => JSON.parse(JSON.stringify(o));
const cat = loadCatalogue();

const b = rebuildBlock({ planDir, asks: true });
if (!b.ok) { console.log(`REBUILD FAILED: ${b.say}`); process.exit(1); }
const assemble = (decl) => assembleFromBlock({ declaration: decl, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((a) => a.line)), sheetRoles: csvRolesOf(b.parsed.arbiter) });
const validate = (decl, extra = {}) => validateDeclaration(decl, {
  arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true,
  pageWords: { texts: b.texts, look: null, docs: docRolesOf(b.parsed.arbiter.sources) }, ...extra,
});
// as assembleAgain: take the saved plan's list and pickedLines out first, the assembly writes them again
const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
const built = assemble(rest);
const step2 = built.declaration.steps.find((s) => s.fromLine === 2);

// P0
{
  const sv = saved.steps.find((s) => s.fromLine === 2);
  const same = J(step2.close) === J(sv.close) && J(built.declaration.pickedLines) === J(saved.pickedLines) && J(built.declaration.checkList) === J(saved.checkList);
  bar('P0 rebuild reproduces the saved line 2, pickedLines and list', same, same ? '' : `rebuilt close ${J(step2.close)}`);
}
// A1
const verdict = validate(built.declaration);
bar('A1 the rebuilt plan with the agreed pick validates (not red)', verdict.ok === true, verdict.ok ? '' : String(verdict.reds[0]));
// A2
{
  const row = built.declaration.checkList.find((r) => r.key === 'L2.~4');
  const ok = J(step2.close.picked) === J([{ rule: 'listItems', value: 4 }]) && J(built.declaration.pickedLines) === '[2]' && row?.state === 'built';
  bar('A2 the pick is kept (close.picked, pickedLines, row L2.~4 built)', ok, `row state ${row?.state}`);
}
// A3 / A4 closes (synthetic answers)
const ctx = { reads: {}, businessDate: '2026-11-21' };
const item = (t, s = 'closed', m = 'ok') => ({ title: t, status: s, summary: m });
const four = [item('A'), item('B', 'finished'), item('C', 'in progress'), item('D')];
const bullets = (n) => Array.from({ length: n }, (_, i) => `- item ${i + 1}`).join('\n');
const grade = async (art) => { const r = await closeByClass(step2, art, ctx); return { v: r.verdict, red: String(r.red ?? '').replace(/\n/g, ' / ') }; };
{
  const g = await grade({ results: four, text: bullets(4), done: true, blocker: null });
  const r1 = await grade({ results: four, text: bullets(3), done: true, blocker: null });
  const r2 = await grade({ results: [...four.slice(0, 3), item('D', 'weird')], text: bullets(4), done: true, blocker: null });
  const r3 = await grade({ results: [...four.slice(0, 3), item('D', 'weird')], text: bullets(3), done: true, blocker: null });
  const ok = g.v === 'green' && r1.v === 'red' && /4|list item|bullet/i.test(r1.red) && r2.v === 'red' && /status/.test(r2.red) && r3.v === 'red' && /status/.test(r3.red) && /4|list item|bullet/i.test(r3.red);
  bar('A3 green only if every part passes (4 synthetic answers)', ok, J({ g, r1, r2, r3 }));
}
{
  const t = bullets(4);
  const cases = {
    'no text': { results: four, done: true, blocker: null },
    'empty text': { results: four, text: '', done: true, blocker: null },
    'non-string text': { results: four, text: 4, done: true, blocker: null },
    'no results': { text: t, done: true, blocker: null },
    'neither': { done: true, blocker: null },
  };
  const out = {};
  for (const [k, a] of Object.entries(cases)) out[k] = await grade(a);
  const ok = Object.values(out).every((x) => x.v === 'red');
  bar('A4 missing text or results is red (5 synthetic answers)', ok, J(Object.fromEntries(Object.entries(out).map(([k, x]) => [k, x.v]))));
}
// A5 drafter-written count refused
{
  const reasons = {};
  const redOf = (decl) => { const v = validate(decl); return v.ok ? null : v.reds; };
  const mk = (fn) => { const d = clone(built.declaration); fn(d, d.steps.find((s) => s.fromLine === 2)); return d; };
  const a = redOf(mk((d) => { delete d.pickedLines; }));
  const bb = redOf(mk((d) => { d.pickedLines = [3]; }));
  const c = redOf(mk((d, s) => { delete s.close.picked; delete d.pickedLines; s.close.shape = { maxWords: 80 }; }));
  const dd = redOf(mk((d, s) => { delete s.close.picked; delete d.pickedLines; s.close.shape = { picked: [{ rule: 'listItems', value: 4 }] }; }));
  reasons.a = a?.[0]; reasons.b = bb?.[0]; reasons.c = c?.[0]; reasons.d = dd?.[0];
  bar('A5 a count the drafter wrote itself is refused (4 variants)', [a, bb, c, dd].every((x) => x !== null), J(reasons));
}
// a plan whose line 2 holds facts (+ item fields when `items`) and the pick, rows renumbered to the close's part order (fact 0, shape 1, pick 2)
const TAGF = [{ name: 'tag', spec: { kind: 'oneOf', required: true, values: ['a', 'b'] }, rule: 2 }];
function citedPlan({ items, pickedLines = [2] }) {
  const d = clone(built.declaration);
  const s2 = d.steps.find((s) => s.fromLine === 2);
  s2.close = { class: 'green', cited: { source: 'notes', facts: [{ name: 'heading', shape: 'phrase', phrase: '## ' }], count: { min: 4, max: 4 } }, ...(items ? { itemShape: { fields: step2.close.itemShape.fields } } : {}), picked: [{ rule: 'listItems', value: 4 }] };
  s2.reads = ['notes_contents', 'notes'];
  d.pickedLines = pickedLines;
  d.checkList = d.checkList.filter((r) => items || !(r.line === 2 && r.kind === 'rule' && r.rule !== 4)).map((r) => (r.line === 2 && r.part ? { ...r, part: { line: 2, part: r.rule === 4 ? (items ? 2 : 1) : 1 } } : r));
  d.checkList.push({ line: 2, key: 'L2.heading', from: 'look', by: 'agent', kind: 'fact', state: 'built', name: 'heading', part: { line: 2, part: 0 } });
  return d;
}
const outOf = (v) => (v.ok ? 'ok' : v.reds);
// A6 facts + item fields + pick (synthetic, bareloop's fixture copied into fwd's tests)
{
  const fxd = path.join(repo, 'test/fixtures/shape-combined');
  const part = JSON.parse(readFileSync(path.join(fxd, 'flights-3.part.json'), 'utf8'));
  const input = readFileSync(path.join(fxd, 'flights-3.input.txt'), 'utf8');
  const ans = JSON.parse(readFileSync(path.join(fxd, 'flights-3.answer.json'), 'utf8'));
  const { buildShapePart } = await imp('shaperows.js');
  const TAG = buildShapePart({ text: 'the items of line 1', fields: [{ name: 'tag', spec: { kind: 'oneOf', required: true, values: ['a', 'b'] }, rule: 2, by: 'you' }] });
  const cited = { source: part.part.source, facts: part.part.facts, ...(part.part.count ? { count: part.part.count } : {}) };
  const step = { fromLine: 1, close: { class: 'green', cited, itemShape: { fields: TAG.fields }, picked: [{ rule: 'listItems', value: part.part.count?.max ?? 3 }] } };
  const n = part.part.count?.max ?? 3;
  const ctx6 = { reads: {}, businessDate: '2026-11-20', source: { ok: true, text: input, sha256: createHash('sha256').update(input).digest('hex') } };
  const answer = (mut = (x) => x) => { const a = clone(ans); for (const it of a.results) it.tag = 'a'; a.done = true; a.blocker = null; a.text = bullets(n); mut(a); return a; };
  const g = async (a) => (await closeByClass(step, a, ctx6)).verdict;
  const got = {
    good: await g(answer()),
    pickFails: await g(answer((a) => { a.text = bullets(n + 1); })),
    madeUpQuote: await g(answer((a) => { a.results[0].quote = 'this sentence is not anywhere on the saved page'; })),
    itemField: await g(answer((a) => { a.results[0].tag = 'z'; })),
    noText: await g(answer((a) => { delete a.text; })),
  };
  const want = { good: 'green', pickFails: 'red', madeUpQuote: 'red', itemField: 'red', noText: 'red' };
  const closeOk = J(got) === J(want);
  const d = citedPlan({ items: true });
  const v = validate(d);
  bar('A6 facts + item fields + pick: validates and closes (1 + 5 cases)', closeOk && v.ok === true ? true : 'FAIL', `close ${J(got)}; validate ${v.ok ? 'ok' : String(v.reds[0])}`);
  if (!(closeOk && v.ok === true)) results[results.length - 1].ok = 'FAIL';
}
// A7 fact line (cited only), A8 neither: outcomes collected, compared today vs candidate
const groups = { A7: {}, A8: {} };
{
  const page = 'Release notes\n## [1.2.0] - 2026-10-01\nChanged: the exporter now streams rows.\nFixed: a crash on empty input.\n';
  const source = { ok: true, text: page, sha256: sha256Text(page) };
  const cited = { source: 'notes', facts: [{ name: 'heading', shape: 'phrase', phrase: '## ' }], count: { min: 4, max: 4 } };
  const citedPart = { source: 'notes', facts: [{ name: 'heading', shape: 'phrase', phrase: '## [1.2.0] - 2026-10-01' }], count: { min: 1, max: 1 } };
  const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');
  const good = [{ quote: '## [1.2.0] - 2026-10-01', values: {} }];
  const pick = { rule: 'maxWords', value: 80 };
  const fstep = { close: { class: 'green', cited: citedPart, picked: [pick] } };
  const samples = { good: { results: good, text: words(42) }, tooLong: { results: good, text: words(93) }, madeUp: { results: [{ quote: '## [9.9.9] - 2030-01-01', values: {} }], text: words(42) }, noQuote: { results: [], text: words(42) }, noText: { results: good }, emptyText: { results: good, text: '' } };
  for (const [k, a] of Object.entries(samples)) { const r = await closeByClass(fstep, a, { reads: {}, businessDate: '', source }); groups.A7[`close ${k}`] = [r.verdict, String(r.red ?? '')]; }
  const withClose = (fn) => { const d = clone(built.declaration); delete d.pickedLines; const s = d.steps.find((x) => x.fromLine === 2); fn(d, s); return validate(d); };
  const out = (v) => (v.ok ? 'ok' : v.reds);
  groups.A7['validate cited+picked, listed'] = outOf(validate(citedPlan({ items: false })));
  groups.A7['validate cited+picked, not listed'] = outOf(validate(citedPlan({ items: false, pickedLines: [3] })));
  groups.A7['validate cited+drafter shape'] = outOf(withClose((d, s) => { s.close = { class: 'green', cited, shape: { maxWords: 80 } }; s.reads = ['notes_contents', 'notes']; }));
  groups.A8['validate hitl+picked'] = out(withClose((d, s) => { s.close = { class: 'hitl', picked: [{ rule: 'listItems', value: 4 }] }; d.pickedLines = [2]; delete d.guardrailClasses['2']; }));
  groups.A8['validate softgreen+picked'] = out(withClose((d, s) => { s.close = { class: 'softgreen', picked: [{ rule: 'listItems', value: 4 }] }; d.pickedLines = [2]; d.guardrailClasses['2'] = 'softgreen'; }));
  groups.A8['validate itemShape hitl+picked'] = out(withClose((d, s) => { s.close = { class: 'hitl', itemShape: { fields: step2.close.itemShape.fields }, picked: [{ rule: 'listItems', value: 4 }] }; d.pickedLines = [2]; delete d.guardrailClasses['2']; }));
  groups.A8['validate itemShape, no pick'] = out(withClose((d, s) => { delete s.close.picked; }));
  groups.A8['validate softgreen+shape.picked'] = out(withClose((d, s) => { s.close = { class: 'softgreen', shape: { picked: [{ rule: 'listItems', value: 4 }] } }; d.guardrailClasses['2'] = 'softgreen'; }));
  groups.A8['validate the walk plan without line 2 pick'] = out(withClose((d, s) => { delete s.close.picked; }));
}
const outDir = path.join(repo, '.claude/scratch/am10-shape-pick');
mkdirSync(outDir, { recursive: true });
const other = mode === 'candidate' ? 'today' : 'candidate';
let otherGroups = null;
try { otherGroups = JSON.parse(readFileSync(path.join(outDir, `RESULT-${other}.json`), 'utf8')).groups; } catch { /* the other run is not there yet */ }
for (const k of ['A7', 'A8']) {
  if (otherGroups === null) bar(`${k} ${k === 'A7' ? "a fact line's picks" : 'a line with neither'} unchanged`, 'NOT COMPARED', `run the other mode and read RESULT-*.json; outcomes: ${J(groups[k])}`);
  else bar(`${k} ${k === 'A7' ? "a fact line's picks" : 'a line with neither'} unchanged vs ${other}`, J(groups[k]) === J(otherGroups[k]), J(groups[k]) === J(otherGroups[k]) ? '' : `this ${J(groups[k])} vs ${J(otherGroups[k])}`);
}
// A8 extra: the three close.picked cases keep today's sentence
{
  const three = ['validate hitl+picked', 'validate softgreen+picked', 'validate itemShape hitl+picked'].map((k) => groups.A8[k]);
  bar('A8b the three close.picked cases are red with the "checks facts" sentence', three.every((r) => Array.isArray(r) && r.some((x) => /close\.picked is for a step that checks facts/.test(x))), J(three.map((r) => (Array.isArray(r) ? r[0] : r))));
}
writeFileSync(path.join(outDir, `RESULT-${mode}.json`), `${JSON.stringify({ mode, results, groups }, null, 2)}\n`);
for (const r of results) console.log(`${r.ok.padEnd(12)} ${r.bar}${r.note ? `\n             ${r.note.slice(0, 700)}` : ''}`);
rmSync(work, { recursive: true, force: true });
