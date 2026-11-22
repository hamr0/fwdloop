// F240 ($0, no AI, no key, no panel). usage: node poc/card-model/run2.mjs [--today | --candidate]
// --today     the bars applied to TODAY's card rows (log.json checkCard.rows) and to today's Job tab reader (listPartRows)
// --candidate the bars applied to poc/card-model/reader2.mjs (M19 am6 + am7 words). F239's run.mjs/reader.mjs are untouched.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../../src/signed-text.js';
import { csvRolesOf, rulesOfLine } from '../../src/sheetblock.js';
import { ASK_LINE_REASON } from '../../src/blockassemble.js';
import { listPartRows } from '../../src/checked.js';
import { shapeFieldText } from '../../src/shaperows.js';
import { plainWords } from '../../src/checkwords.js';
import { KEPT_WORDS } from '../../src/pickrecord.js';
import { checkRowsOfPlan, expectedParts } from './reader2.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/.drafts')];
const MODE = process.argv.includes('--candidate') ? 'candidate' : 'today';
const LVAR = process.argv.includes('--l-variant'); // labelled variant AFTER the run: the pre-registered synthetic key collided with a real row
const EX = Number(process.env.EX || 3);
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const walk = (p, dep, out) => {
  if (dep > 4) return;
  let es; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
  if (es.some((e) => e.name === 'declaration.json')) out.push(p);
  for (const e of es) if (e.isDirectory() && e.name !== 'pages') walk(path.join(p, e.name), dep + 1, out);
};
const lines = []; const say = (s = '') => { lines.push(s); console.log(s); };
const dirs = []; for (const r of roots) walk(r, 0, dirs);
const FOUR = /d-00mwgdao99-8d69|d-00mwgkehsy-079b|d-00mwp92sxl-2c84|d-00mwpctg7p-29f9/;
const SHAPE_DRAFTS = /d-00mwp4ftwv-b5f0|d-00mwp6t8r8-f4a8/;
const is5 = (r) => r.reason === ASK_LINE_REASON || /\.sheet\.|\.ticket\./.test(r.key); // item-5 rows WITHOUT shape rows (am7 item 1 changes those: bar i)
const isShapeRow = (r, partId) => /:shape:/.test(partId ?? '') || r.kind === 'shape' || /\.shape\.|\$shape/.test(r.key);
// the order rank of a built row by the part it names (am7 item 4), written here, not read from the reader
const rankOf = (partId, key) => (/\.sheet\./.test(key) ? 0 : /:fact:/.test(partId ?? '') ? 1 : /:count$/.test(partId ?? '') ? 2 : /:shape:/.test(partId ?? '') ? 3 : /:pick:/.test(partId ?? '') ? 4 : /:numbers$/.test(partId ?? '') ? 5 : /\$floor$/.test(key) ? 6 : null);

const T = { drafts: 0, thrown: 0, rows: 0, keptRows: 0 };
const B = { b: { n: 0, ok: 0, ex: [] }, c: { parts: 0, none: 0, many: 0, orphan: 0 }, d: { rows: 0, differ: 0, nosigned: 0 }, e: { items: 0, differ: 0, candOnly: 0, ex: [] }, ord: { lines: 0, bad: 0, ex: [] }, h: { parts: 0, bad: 0, ex: [] },
  i: { rows: 0, bad: 0, ex: [] }, j: { rows: 0, bad: 0, ex: [] }, k: { rows: 0, bad: 0, ex: [] }, l: { rows: 0, bad: 0 }, m: { rows: 0, bad: 0 } };
const err = [];
const lineWordsOf = (jl, n) => jl.find((l) => l.n === n);
const expectedTexts = (decl, jl, kept) => {
  // independent expected words and tags per part id
  const out = new Map();
  for (const st of decl.steps ?? []) {
    const line = st.fromLine; const close = st.close ?? {};
    if (isRec(close.itemShape)) for (const f of close.itemShape.fields ?? []) out.set(`L${line}:shape:${f.name}`, { text: shapeFieldText({ name: f.name, spec: f.spec, rule: f.rule }, rulesOfLine(lineWordsOf(jl, line))), tagYou: Number.isInteger(f.rule) && f.row !== 'agent' });
    const picked = Array.isArray(close.picked) ? close.picked : Array.isArray(close.shape?.picked) ? close.shape.picked : [];
    let idx = (isRec(close.cited) ? 1 : 0) + (isRec(close.itemShape) ? 1 : 0);
    for (const c of picked) { out.set(`L${line}:pick:${idx}`, { text: `${plainWords(c)}${kept.some((k) => k.line === line && isRec(k.check) && plainWords(k.check) === plainWords(c)) ? ` · ${KEPT_WORDS}` : ''}` }); idx++; }
    if (Array.isArray(close.numbersFrom) && close.numbersFrom.length) out.set(`L${line}:numbers`, { text: `every number in the text is in a quote checked on line ${close.numbersFrom.join(', ')}`, by: 'default' });
  }
  return out;
};
for (const dir of dirs) {
  const decl = J(`${dir}/declaration.json`);
  if (!decl || !Array.isArray(decl.checkList)) continue;
  const card = J(`${dir}/log.json`)?.checkCard;
  if (!card || !Array.isArray(card.rows)) continue;
  T.drafts++;
  let prose; try { prose = fs.readFileSync(`${dir}/prose.txt`, 'utf8'); } catch { prose = null; }
  const parsed = prose ? parseSignedText(prose) : null;
  const jl = parsed?.ok ? parsed.lines : [];
  const csv = parsed?.ok ? csvRolesOf(parsed.arbiter) : [];
  const kept = (J(`${dir}/picks-record.json`)?.kept ?? []).filter((k) => isRec(k) && Number.isInteger(k.line));
  const today = card.rows;
  const ledger = today.filter((r) => r.state === 'not-checked' && /^(fact|phrase) "/.test(r.text)).map((r) => ({ key: r.key, words: [r.text.match(/"([^"]*)"/)[1]] }));
  const exp = expectedParts({ declaration: decl });
  const keyToPart = new Map(); for (const p of exp) for (const k of p.keys) keyToPart.set(k, p.id);
  let rows;
  if (MODE === 'candidate') {
    try { rows = checkRowsOfPlan({ declaration: decl, lines: jl, csvRoles: csv, kept, ledger }); } catch (x) { T.thrown++; err.push(`${dir.slice(-45)}: ${x.message}`); continue; }
  } else rows = today.map((r) => ({ ...r, part: keyToPart.get(r.key) ?? null }));
  T.rows += rows.length;
  const et = expectedTexts(decl, jl, kept);
  // (c)
  for (const p of exp) { B.c.parts++; const n = rows.filter((r) => r.part === p.id).length; if (n === 0) B.c.none++; else if (n > 1) B.c.many++; }
  const ids = new Set(exp.map((p) => p.id)); for (const r of rows) if (!r.part || !ids.has(r.part)) B.c.orphan++;
  // (d)
  const signed = new Map(decl.checkList.map((r) => [r.key, r]));
  for (const r of rows) { B.d.rows++; const s = signed.get(r.key); if (!s) B.d.nosigned++; else if (s.by !== r.by) B.d.differ++; }
  // (e)
  const mine = new Map(rows.map((r) => [r.key, r])); const theirs = new Map(today.map((r) => [r.key, r]));
  const fmt = (r) => `${r.line}|${r.by}|${r.state}|${r.text}|${r.reason ?? ''}`;
  for (const r of today.filter((x) => is5(x) && !isShapeRow(x, keyToPart.get(x.key)))) { B.e.items++; const m = mine.get(r.key); if (!m || fmt(m) !== fmt(r)) { B.e.differ++; if (B.e.ex.length < EX) B.e.ex.push(`${dir.slice(-35)} ${r.key}: today [${r.by}] ${r.text} | cand ${m ? `[${m.by}] ${m.text}` : '(no row)'}`); } }
  for (const r of rows.filter((x) => is5(x) && !isShapeRow(x, x.part))) if (!theirs.has(r.key)) B.e.candOnly++;
  // order (a)
  const byLine = new Map(); for (const r of rows) { if (r.state !== 'built') continue; const rk = rankOf(r.part, r.key); if (rk === null) continue; if (!byLine.has(r.line)) byLine.set(r.line, []); byLine.get(r.line).push({ rk, key: r.key }); }
  for (const [ln, xs] of byLine) { B.ord.lines++; if (xs.some((x, i) => i > 0 && x.rk < xs[i - 1].rk)) { B.ord.bad++; if (B.ord.ex.length < EX) B.ord.ex.push(`${dir.slice(-35)} line ${ln}: ${xs.map((x) => x.key).join(' , ')}`); } }
  // (b)
  if (FOUR.test(dir)) for (const r of today) {
    const p = exp.find((q) => q.keys.includes(r.key) && /:fact:/.test(q.id)); if (!p || /\.~\d+$/.test(r.key)) continue;
    const fact = (decl.steps.flatMap((s) => s.close?.cited?.facts ?? [])).find((x) => x.name === p.id.split(':fact:')[1]); if (!fact || fact.shape !== 'phrase') continue;
    const sw = fact.anyOf ?? (fact.phrase !== undefined ? [fact.phrase] : []);
    const tw = r.text.includes(' with ') ? [...r.text.split(/ with /)[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
    if (JSON.stringify([...sw].sort()) === JSON.stringify([...tw].sort())) continue;
    B.b.n++; const m = rows.find((x) => x.part === p.id) ?? mine.get(r.key); if (m && sw.every((w) => m.text.includes(w))) B.b.ok++; else if (B.b.ex.length < EX) B.b.ex.push(`${dir.slice(-30)} ${r.key}: ${m?.text}`);
  }
  // (h) two rules / rows, one part
  for (const p of exp) if (p.keys.length > 1) {
    B.h.parts++;
    const sr = p.keys.map((k) => signed.get(k)); const first = sr.find((x) => x.by === 'you') ?? sr[0];
    const here = rows.filter((r) => r.part === p.id || p.keys.includes(r.key));
    const okRow = here.length === 1 && here[0].key === first.key && here[0].by === first.by;
    if (!okRow) { B.h.bad++; if (B.h.ex.length < EX) B.h.ex.push(`${dir.slice(-35)} ${p.id}: signed keys ${p.keys.join(',')}; rows shown ${here.map((r) => r.key).join(',') || 'none'}`); }
  }
  // (i) shape, (j) picks, (k) numbers
  for (const r of rows) {
    const part = r.part ?? '';
    if (/:shape:/.test(part)) { B.i.rows++; const e = et.get(part); if (!e || r.text !== e.text || (r.by === 'you') !== e.tagYou) { B.i.bad++; if (B.i.ex.length < EX) B.i.ex.push(`${dir.slice(-30)} ${r.key}: [${r.by}] ${r.text} | want ${e?.text}`); } }
    if (/:pick:/.test(part) && r.text.includes(KEPT_WORDS)) T.keptRows++;
    if (/:pick:/.test(part)) { B.j.rows++; const e = et.get(part); if (!e || r.text !== e.text || /\(you agreed/.test(r.text) || r.text.endsWith('.')) { B.j.bad++; if (B.j.ex.length < EX) B.j.ex.push(`${dir.slice(-30)} ${r.key}: ${r.text} | want ${e?.text}`); } }
    if (/:numbers$/.test(part)) { B.k.rows++; const e = et.get(part); if (!e || r.text !== e.text || r.by !== 'default') { B.k.bad++; if (B.k.ex.length < EX) B.k.ex.push(`${dir.slice(-30)} ${r.key}: [${r.by}] ${r.text} | want ${e?.text}`); } }
    if (/\.ticket\./.test(r.key)) { B.m.rows++; if (!signed.has(r.key)) B.m.bad++; }
    if (r.state === 'not-checked' && /^(fact|phrase) "/.test(today.find((x) => x.key === r.key)?.text ?? '')) { B.l.rows++; if (r.text !== today.find((x) => x.key === r.key).text) B.l.bad++; }
  }
}
// (g) the Job tab reader on the shape drafts, and the synthetic
const G = { real: { fields: 0, shown: 0 }, synth: { bad: 0, tag: null, want: 'agent' } };
for (const dir of dirs.filter((d) => SHAPE_DRAFTS.test(d))) {
  const decl = J(`${dir}/declaration.json`); if (!decl?.checkList) continue;
  const prose = fs.readFileSync(`${dir}/prose.txt`, 'utf8'); const parsed = parseSignedText(prose); const jl = parsed.ok ? parsed.lines : [];
  for (const st of decl.steps.filter((s) => isRec(s.close?.itemShape))) {
    const fields = st.close.itemShape.fields; G.real.fields += fields.length;
    const rows = MODE === 'candidate' ? checkRowsOfPlan({ declaration: decl, lines: jl }).filter((r) => r.line === st.fromLine && /:shape:/.test(r.part)).map((r) => r.text) : listPartRows(decl, st).map((r) => r.text);
    for (const f of fields) if (rows.some((t) => t.startsWith(`${f.name} ·`))) G.real.shown++;
  }
}
{
  const src = dirs.find((d) => /d-00mwp4ftwv-b5f0/.test(d)); const decl = JSON.parse(fs.readFileSync(`${src}/declaration.json`, 'utf8'));
  let pick = null; for (const d of dirs) { const x = J(`${d}/declaration.json`); const p = (x?.steps ?? []).map((s) => s.close?.picked?.[0]).find(Boolean); if (p) { pick = p; break; } }
  const st = decl.steps.find((s) => isRec(s.close?.itemShape)); st.close.picked = [pick];
  decl.checkList.push({ line: st.fromLine, key: `L${st.fromLine}.~9`, from: 'agent', by: 'agent', kind: 'rule', state: 'built', rule: 9, part: { line: st.fromLine, part: 1 } });
  const jl = parseSignedText(fs.readFileSync(`${src}/prose.txt`, 'utf8')).lines;
  const rows = MODE === 'candidate' ? checkRowsOfPlan({ declaration: decl, lines: jl }).filter((r) => /:pick:/.test(r.part)) : listPartRows(decl, st).filter((r) => r.text.startsWith(plainWords(pick)));
  G.synth.tag = rows[0]?.by ?? null; G.synth.n = rows.length;
}
// (l) synthetic Not checked name
let L = null;
if (MODE === 'candidate') {
  const src = dirs.find((d) => /d-00mwpctg7p-29f9/.test(d)); const decl = JSON.parse(fs.readFileSync(`${src}/declaration.json`, 'utf8'));
  decl.checkList.push({ line: 2, key: LVAR ? 'L2.phrase.new york' : 'L2.phrase.chicago ord', from: 'look', by: 'agent', kind: 'phrase', state: 'not-checked', reason: 'x' });
  const jl = parseSignedText(fs.readFileSync(`${src}/prose.txt`, 'utf8')).lines;
  const find = (ledger) => checkRowsOfPlan({ declaration: decl, lines: jl, ledger }).find((r) => r.key === (LVAR ? 'L2.phrase.new york' : 'L2.phrase.chicago ord'))?.text;
  L = { withLedger: find([{ key: LVAR ? 'L2.phrase.new york' : 'L2.phrase.chicago ord', words: [LVAR ? 'New York' : 'Chicago ORD'] }]), without: find([]) };
}
const verdict = (ok) => (ok ? 'PASS' : 'FAIL');
say(`F240 mode=${MODE}  drafts=${T.drafts}; rows under test=${T.rows}`);
say(`(b) F238 drifting rows=${B.b.n}; show the signed phrase=${B.b.ok}  -> ${verdict(B.b.n === 10 && B.b.ok === 10)}`); for (const x of B.b.ex) say(`   ${x}`);
say(`(c) parts=${B.c.parts}; no row=${B.c.none}; more than one row=${B.c.many}; rows naming no part=${B.c.orphan}  -> ${verdict(B.c.none + B.c.many + B.c.orphan === 0)}`);
say(`(d) rows=${B.d.rows}; tag differs=${B.d.differ}; no signed row=${B.d.nosigned}  -> ${verdict(B.d.differ + B.d.nosigned === 0)}`);
say(`(e) item-5 rows (no shape) of today's card=${B.e.items}; differ=${B.e.differ}; candidate-only=${B.e.candOnly}  -> ${verdict(B.e.differ + B.e.candOnly === 0)}`); for (const x of B.e.ex) say(`   ${x}`);
say(`(f) thrown=${T.thrown}  -> ${verdict(T.thrown === 0)}`); for (const x of err) say(`   ${x}`);
say(`(a-order) lines with ranked rows=${B.ord.lines}; out of order=${B.ord.bad}  -> ${verdict(B.ord.bad === 0)}`); for (const x of B.ord.ex) say(`   ${x}`);
say(`(g1) real shape drafts: field rows=${G.real.fields}; drawn by ${MODE === 'candidate' ? 'the candidate' : "today's listPartRows"}=${G.real.shown}  -> ${verdict(G.real.shown === G.real.fields && G.real.fields > 0)}`);
say(`(g2) SYNTHETIC: a pick after the shape part, signed [agent]; its tag by ${MODE === 'candidate' ? 'the candidate' : "today's listPartRows"} = ${G.synth.tag} (want agent)  -> ${verdict(G.synth.tag === 'agent')}`);
say(`(h) parts with several signed rows=${B.h.parts}; not one row from the first [you] row=${B.h.bad}  -> ${verdict(B.h.bad === 0)}`); for (const x of B.h.ex) say(`   ${x}`);
say(`(i) shape rows=${B.i.rows}; not shapeRowsOf's words/tag=${B.i.bad}  -> ${verdict(B.i.bad === 0 && B.i.rows > 0)}`); for (const x of B.i.ex) say(`   ${x}`);
say(`(j) pick rows=${B.j.rows}; violations=${B.j.bad}  -> ${verdict(B.j.bad === 0 && B.j.rows > 0)}`); for (const x of B.j.ex) say(`   ${x}`);
say(`(k) numbers rows=${B.k.rows}; violations=${B.k.bad}  -> ${verdict(B.k.bad === 0 && B.k.rows > 0)}`); for (const x of B.k.ex) say(`   ${x}`);
say(L ? `(l) real Not checked fact/phrase rows=${B.l.rows}; differ from the saved words=${B.l.bad}; SYNTHETIC with ledger: ${L.withLedger}; without: ${L.without}  -> ${verdict(B.l.bad === 0 && L.withLedger === (LVAR ? 'phrase "New York"' : 'phrase "Chicago ORD"') && L.without === (LVAR ? 'phrase "new york"' : 'phrase "chicago ord"'))}` : '(l) not measurable on today\'s card (no reader, no ledger)  -> n/a');
say(`(info) pick rows carrying ' · ${KEPT_WORDS}'=${T.keptRows}`);
say(`(m) Tickets rows=${B.m.rows}; with no signed ticket row=${B.m.bad}  -> ${verdict(B.m.bad === 0)}`);
fs.writeFileSync(path.join(REPO, `.claude/scratch/card-model/RESULT2-${MODE}${LVAR ? '-lvariant' : ''}.txt`), `${lines.join('\n')}\n`);
