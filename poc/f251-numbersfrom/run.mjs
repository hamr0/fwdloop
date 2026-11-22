// F251 harness ($0, no AI, no key). usage: node poc/f251-numbersfrom/run.mjs --today | --candidate | --nodrop | --built     (writes .claude/scratch/f251-numbersfrom/RESULT-<mode>.json)
//                                        node poc/f251-numbersfrom/run.mjs --compare <modeA> <modeB>   (bars a, b, d read from two RESULT files; written only to stdout)
// Pre-registered in docs/logs/FINDINGS.md "F251 PRE-REGISTRATION". Every plan folder is COPIED to a mkdtemp root first; the sources are read only.
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const OUT = path.join(REPO, '.claude/scratch/f251-numbersfrom');
const S = (o) => JSON.stringify(o);
const MODES = { today: path.join(REPO, 'src'), built: path.join(REPO, 'src'), candidate: path.join(OUT, 'candidate/src'), nodrop: path.join(OUT, 'candidate-nodrop/src') };
const RED_DRAFT = path.join(OUT, 'draft-copy/draft');

if (process.argv.includes('--compare')) {
  const [a, b] = process.argv.slice(process.argv.indexOf('--compare') + 1);
  const A = JSON.parse(fs.readFileSync(path.join(OUT, `RESULT-${a}.json`), 'utf8')); const B = JSON.parse(fs.readFileSync(path.join(OUT, `RESULT-${b}.json`), 'utf8'));
  const rep = { a: a, b: b, bars: {} };
  // (d) the off arm (A) reds on the F251 draft; (a) B on it
  const ra = A.red, rb = B.red;
  rep.bars.d = { verdict: ra.validateOk === false && /numbersFrom: line 1 is not a line that checks quotes/.test(ra.validateText ?? '') ? 'PASS' : 'FAIL', off: { validateOk: ra.validateOk, text: ra.validateText } };
  const row1 = (rb.rows ?? []).find((r) => r.key === 'L1.phrase.research notes');
  rep.bars.a = { verdict: rb.ok && rb.validateOk === true && rb.step2NumbersFrom === null && row1 && row1.state === 'not-checked' && row1.reason === B.noGuardrailWords && rb.line1FactPart === false ? 'PASS' : 'FAIL', validateOk: rb.validateOk, step2NumbersFrom: rb.step2NumbersFrom, row: row1, line1FactPart: rb.line1FactPart, offLine1FactPart: ra.line1FactPart };
  const ids = [...new Set([...Object.keys(A.plans), ...Object.keys(B.plans)])].sort();
  const c = { found: ids.length, rebuilt: 0, refusedAsBefore: 0, refusedDiffers: [], identical: 0, differ: [], cardDiffer: [], onlyOneSide: [] };
  for (const id of ids) {
    const x = A.plans[id], y = B.plans[id];
    if (!x || !y) { c.onlyOneSide.push(id); continue; }
    if (x.refused !== undefined || y.refused !== undefined) { if (x.refused === y.refused) c.refusedAsBefore++; else c.refusedDiffers.push(id); continue; }
    c.rebuilt++;
    if (x.core === y.core) c.identical++; else c.differ.push(id);
    if (x.card !== y.card) c.cardDiffer.push(id);
  }
  // (a)'s own draft is also found under its real id (the sources, read only): both ids are draft (a), not "another draft" (the first run counted the second id as another: letter FAIL, recorded in FINDINGS)
  const isA = (id) => id === 'F251-red-draft' || id.includes('d-00mwrki7k4-04b0');
  const others = c.differ.filter((id) => !isA(id));
  rep.bars.b = { verdict: others.length === 0 && c.refusedDiffers.length === 0 && c.onlyOneSide.length === 0 ? 'PASS' : 'FAIL', ...c, cardDifferExcludingA: c.cardDiffer.filter((id) => !isA(id)).length, differAreOnlyA: c.differ.every(isA) };
  console.log(JSON.stringify(rep, null, 1));
  process.exit(0);
}

const MODE = ['today', 'candidate', 'nodrop', 'built'].find((m) => process.argv.includes(`--${m}`));
if (!MODE) { console.log('usage: --today | --candidate | --nodrop | --built | --compare a b'); process.exit(2); }
const srcRoot = MODES[MODE];
const imp = (f) => import(pathToFileURL(path.join(srcRoot, f)).href);
const { rebuildBlock } = await imp('planrebuild.js');
const { assembleFromBlock, NO_GUARDRAIL_WORDS } = await imp('blockassemble.js');
const { validateDeclaration } = await imp('declaration.js');
const { loadCatalogue } = await imp('catalogue.js');
const { WIRED_VERBS } = await imp('primitives.js');
const { csvRolesOf } = await imp('sheetblock.js');
const { docRolesOf } = await imp('drafter.js');
const { cardOfBlock } = await imp('cardlist.js');
const { withSheetRows } = await imp('sheetrows.js');
const { withTicketRows } = await imp('ticketrows.js');
const cat = loadCatalogue();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'f251h-'));
let seq = 0;
const exists = (p) => fs.existsSync(p);

/** one plan folder (a copy) through the real path */
function build(srcDir) {
  const root = path.join(tmp, `p${++seq}`); fs.mkdirSync(root);
  const planDir = path.join(root, 'plan'); fs.cpSync(srcDir, planDir, { recursive: true });
  if (!exists(path.join(planDir, 'declaration.json')) && exists(path.join(planDir, 'declaration.rejected.json'))) fs.copyFileSync(path.join(planDir, 'declaration.rejected.json'), path.join(planDir, 'declaration.json'));
  const b = rebuildBlock({ planDir, asks: true });
  if (!b.ok) return { refused: String(b.say) };
  const roles = csvRolesOf(b.parsed.arbiter);
  const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
  const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines: new Set(b.parsed.arbiter.asks.map((a) => a.line)), sheetRoles: roles });
  const ws = withSheetRows({ declaration: built.declaration, lines: b.lines, csvRoles: roles });
  const wt = withTicketRows({ declaration: ws.declaration, lines: b.lines });
  const decl = wt.declaration;
  const v = validateDeclaration(decl, { arbiter: b.parsed.arbiter, lines: b.lines, catalogue: cat.primitives, wired: WIRED_VERBS, verbatimGoals: true, fitJobLine: true, pageWords: { texts: b.texts, look: null, docs: docRolesOf(b.parsed.arbiter.sources) } });
  const rows = (decl.checkList ?? []).map((r) => ({ key: r.key, state: r.state, reason: r.reason ?? null }));
  const rec = b.block.reconcile();
  const line1FactPart = rec.map.some((m) => m.line === 1 && rec.parts[m.part]?.class === 'fact');
  let card = null; try { card = S(cardOfBlock(b.block)); } catch (e) { card = `threw ${String(e.message).slice(0, 80)}`; }
  const core = S({ decl, rows, notChecked: built.notChecked, notCheckedBy: built.notCheckedBy, validate: v.ok ? 'ok' : v.reds.map(String) }).replaceAll(root, '<ROOT>');
  const s2 = decl.steps?.find((s) => s.fromLine === 2);
  return { core, card: card.replaceAll(root, '<ROOT>'), rows, line1FactPart, validateOk: v.ok === true, validateText: v.ok ? 'ok' : v.reds.map(String).join(' | '), step2NumbersFrom: s2?.close?.numbersFrom ?? null, ok: true };
}

const walk = (p, dep, acc) => { if (dep > 6) return; let es; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; } if (es.some((e) => e.name === 'declaration.json' || e.name === 'declaration.rejected.json')) acc.push(p); for (const e of es) if (e.isDirectory() && e.name !== 'pages' && e.name !== 'node_modules' && !e.isSymbolicLink()) walk(path.join(p, e.name), dep + 1, acc); };
const roots = [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(REPO, '.claude/scratch'), path.join(REPO, 'test/fixtures')];
const dirs = []; for (const r of roots) walk(r, 0, dirs);
const redReal = fs.realpathSync(RED_DRAFT);
const seen = new Set();
const plans = {};
for (const dir of dirs) {
  const real = fs.realpathSync(dir);
  if (real === redReal || real.startsWith(redReal + path.sep) || seen.has(real)) continue;
  // the candidate folders hold only src/: a plan folder under the harness's own scratch (the copies of the red draft) is not another draft
  if (real.startsWith(path.join(OUT) + path.sep)) continue;
  seen.add(real);
  const id = path.relative(os.homedir(), dir);
  try { plans[id] = build(dir); } catch (e) { plans[id] = { refused: `threw ${String(e?.message ?? e).slice(0, 100)}` }; }
}
const red = build(RED_DRAFT);
plans['F251-red-draft'] = red;
fs.rmSync(tmp, { recursive: true, force: true });
const out = { mode: MODE, noGuardrailWords: NO_GUARDRAIL_WORDS, red: { ...red, core: undefined, card: undefined }, plans };
fs.writeFileSync(path.join(OUT, `RESULT-${MODE}.json`), JSON.stringify(out, null, 1));
const refused = Object.values(plans).filter((p) => p.refused !== undefined).length;
console.log(`wrote RESULT-${MODE}.json: ${Object.keys(plans).length} plans (${refused} refused); red draft: validateOk=${red.validateOk} step2NumbersFrom=${S(red.step2NumbersFrom)} line1FactPart=${red.line1FactPart}\n  ${red.validateText ?? red.refused}`);
