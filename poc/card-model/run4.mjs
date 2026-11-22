// F242 ($0, no AI, no key, no panel). usage: node poc/card-model/run4.mjs [--today | --candidate]
// --today     the bars applied to TODAY's card rows (log.json checkCard.rows) and to today's Job tab reader (listPartRows)
// --candidate the bars applied to poc/card-model/reader4.mjs (M19 am6 to am9). F239's to F241's harnesses are untouched.
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
import { cardOfPlan, ledgerRowsOf, readLedger, expectedParts } from './reader4.mjs';
// the flat rows of the candidate (checked rows, then the Not checked list); `ledger` is turned into the draft's own ledger rows (am8 item 1)
const rowsOf = ({ ledger = [], ...o }) => { const c = cardOfPlan({ ...o, log: ledger.map((x) => ({ kind: 'ledger', phase: 'final', key: x.key, rowKind: 'fact', words: x.words, state: 'not-checked' })) }); return [...c.rows, ...c.notChecked]; };

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/.drafts')];
const MODE = process.argv.includes('--candidate') ? 'candidate' : 'today';
const LVAR = true; // F241 (l): the key below must be held by NO signed row (asserted)
const EX = Number(process.env.EX || 3);
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const walk = (p, dep, out) => {
  if (dep > 4) return;
  let es; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
  if (es.some((e) => e.name === 'declaration.json')) out.push(p);
  for (const e of es) if (e.isDirectory() && e.name !== 'pages') walk(path.join(p, e.name), dep + 1, out);
};
let sheetCsv = [];
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
const N = { nc: 0, n1ok: 0, n1bad: 0, n1extra: 0, oW: { n: 0, bad: 0, ex: [] }, oT: { n: 0, bad: 0, ex: [] }, pAmong: 0, pOwn: 0, pOrderBad: 0, q: { rows: 0, bad: 0, nofloor: 0 }, t: { n: 0, ok: 0 } };
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
    try { rows = rowsOf({ declaration: decl, lines: jl, csvRoles: csv, kept, ledger }); } catch (x) { T.thrown++; err.push(`${dir.slice(-45)}: ${x.message}`); continue; }
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
  // F241 (n1) (o) (p) (q)
  const ncSigned = decl.checkList.filter((r) => r.state === 'not-checked' && r.kind !== 'sheet' && r.kind !== 'ticket');
  N.nc += ncSigned.length;
  const cardNC = today.filter((r) => ncSigned.some((s) => s.key === r.key));
  const logLedger = (J(`${dir}/log.json`)?.log ?? []).filter((x) => isRec(x) && x.kind === 'ledger');
  const gotLedger = MODE === 'candidate' ? ledgerRowsOf(decl, jl, Object.fromEntries(ledger.map((x) => [x.key, x.words]))) : logLedger;
  for (const s of ncSigned) { const n = gotLedger.filter((x) => x.key === s.key && x.kind === 'ledger' && x.phase === 'final' && x.rowKind === s.kind && x.state === 'not-checked' && Array.isArray(x.words)).length; if (n === 1) N.n1ok++; else N.n1bad++; }
  N.n1extra += gotLedger.filter((x) => !ncSigned.some((s) => s.key === x.key)).length;
  const ruleOf = (s) => rulesOfLine(lineWordsOf(jl, s.line))[s.rule - 1];
  const tailOf = (k) => k.split('.').slice(2).join('.');
  const wantRule = (s) => { const t = ruleOf(s); return t !== undefined ? `line ${s.line}: "${t}" — ${s.reason}` : `line ${s.line}: rule ${s.rule} — ${s.reason}`; };
  const wantWith = (s) => (s.kind === 'rule' && Number.isInteger(s.rule) ? wantRule(s) : `${s.kind} "${(ledger.find((x) => x.key === s.key)?.words ?? [tailOf(s.key)]).join('", "')}"`);
  const wantTail = (s) => (s.kind === 'rule' && Number.isInteger(s.rule) ? wantRule(s) : `${s.kind} "${tailOf(s.key)}"`);
  for (const s of ncSigned.filter((x) => x.kind === 'rule')) { N.t.n++; const g = gotLedger.find((x) => x.key === s.key); if (g && Array.isArray(g.words) && g.words.length === 1 && g.words[0] === ruleOf(s)) N.t.ok++; }
  const candC = MODE === 'candidate' ? cardOfPlan({ declaration: decl, lines: jl, csvRoles: csv, kept, log: gotLedger }) : null;
  const candT = MODE === 'candidate' ? cardOfPlan({ declaration: decl, lines: jl, csvRoles: csv, kept, log: [] }) : null;
  const named1 = (k) => (candC ? candC.notChecked : cardNC).find((r) => r.key === k)?.text;
  const named2 = (k) => (candT ? candT.notChecked : cardNC).find((r) => r.key === k)?.text;
  for (const s of ncSigned) {
    N.oW.n++; if (named1(s.key) !== wantWith(s)) { N.oW.bad++; if (N.oW.ex.length < EX) N.oW.ex.push(`${dir.slice(-30)} ${s.key}: got ${named1(s.key)} | want ${wantWith(s)}`); }
    N.oT.n++; if (named2(s.key) !== wantTail(s)) { N.oT.bad++; if (N.oT.ex.length < EX) N.oT.ex.push(`${dir.slice(-30)} ${s.key}: got ${named2(s.key)} | want ${wantTail(s)}`); }
  }
  if (candC) { N.pAmong += candC.rows.filter((r) => r.state === 'not-checked' && ncSigned.some((s) => s.key === r.key)).length; N.pOwn += candC.notChecked.length; if (candC.notChecked.map((r) => r.key).join('|') !== ncSigned.map((r) => r.key).join('|')) N.pOrderBad++; }
  else { N.pAmong += cardNC.length; }
  for (const t of rows.filter((r) => /\.ticket\./.test(r.key))) { N.q.rows++; const fi = rows.findIndex((r) => r.line === t.line && /\$floor$/.test(r.key)); if (fi === -1) N.q.nofloor++; else if (rows.indexOf(t) > fi) N.q.bad++; }
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
    const rows = MODE === 'candidate' ? rowsOf({ declaration: decl, lines: jl }).filter((r) => r.line === st.fromLine && /:shape:/.test(r.part)).map((r) => r.text) : listPartRows(decl, st).map((r) => r.text);
    for (const f of fields) if (rows.some((t) => t.startsWith(`${f.name} ·`))) G.real.shown++;
  }
}
{
  const src = dirs.find((d) => /d-00mwp4ftwv-b5f0/.test(d)); const decl = JSON.parse(fs.readFileSync(`${src}/declaration.json`, 'utf8'));
  let pick = null; for (const d of dirs) { const x = J(`${d}/declaration.json`); const p = (x?.steps ?? []).map((s) => s.close?.picked?.[0]).find(Boolean); if (p) { pick = p; break; } }
  const st = decl.steps.find((s) => isRec(s.close?.itemShape)); st.close.picked = [pick];
  decl.checkList.push({ line: st.fromLine, key: `L${st.fromLine}.~9`, from: 'agent', by: 'agent', kind: 'rule', state: 'built', rule: 9, part: { line: st.fromLine, part: 1 } });
  const jl = parseSignedText(fs.readFileSync(`${src}/prose.txt`, 'utf8')).lines;
  const rows = MODE === 'candidate' ? rowsOf({ declaration: decl, lines: jl }).filter((r) => /:pick:/.test(r.part)) : listPartRows(decl, st).filter((r) => r.text.startsWith(plainWords(pick)));
  G.synth.tag = rows[0]?.by ?? null; G.synth.n = rows.length;
}
// (n2) last row per key wins; (o3) (o4) (r) (s) SYNTHETIC rows on copies
let N2 = null; const SY = {};
if (MODE === 'candidate') {
  const m = readLedger([{ kind: 'ledger', phase: 'final', key: 'L2.fact.a', rowKind: 'fact', words: ['A'], state: 'not-checked' }, { kind: 'ledger', phase: 'final', key: 'L2.fact.z', rowKind: 'fact', words: ['Z'], state: 'not-checked' }, { kind: 'ledger', phase: 'final', key: 'L2.fact.a', rowKind: 'fact', words: ['B'], state: 'not-checked' }]);
  N2 = { a: m.get('L2.fact.a')?.words?.[0], z: m.get('L2.fact.z')?.words?.[0], size: m.size };
  const src = dirs.find((d) => /d-00mwpctg7p-29f9/.test(d)); const base = JSON.parse(fs.readFileSync(`${src}/declaration.json`, 'utf8'));
  const jl0 = parseSignedText(fs.readFileSync(`${src}/prose.txt`, 'utf8')).lines;
  const free = (decl, k) => { if (decl.checkList.some((r) => r.key === k)) throw new Error(`F242 setup: synthetic key ${k} is held by a signed row`); };
  const withRows = (rowsToAdd) => { const decl = JSON.parse(JSON.stringify(base)); for (const r of rowsToAdd) { free(decl, r.key); decl.checkList.push({ from: 'look', by: 'agent', state: 'not-checked', reason: 'x', ...r }); } return decl; };
  if (jl0.find((l) => l.n === 2) && rulesOfLine(jl0.find((l) => l.n === 2))[8] !== undefined) throw new Error('F242 setup: line 2 has a 9th rule');
  if (base.checkList.some((r) => r.line === 9)) throw new Error('F242 setup: line 9 is held');
  const run = (rowsToAdd) => cardOfPlan({ declaration: withRows(rowsToAdd), lines: jl0 });
  const c1 = run([{ line: 2, key: 'L2.prose.1', kind: 'prose' }, { line: 2, key: 'L2.stage.1', kind: 'stage' }, { line: 2, key: 'L2.~9', kind: 'rule', rule: 9, by: 'you', from: 'rule' }]);
  const nm = (c, k) => c.notChecked.find((r) => r.key === k)?.text;
  SY.prose = nm(c1, 'L2.prose.1'); SY.stage = nm(c1, 'L2.stage.1'); SY.rule9 = nm(c1, 'L2.~9');
  const c2 = run([{ line: 9, key: 'L9.$cited', kind: 'cited' }, { line: 9, key: 'L9.$numbers', kind: 'numbers' }, { line: 9, key: 'L9.$note', kind: 'note' }, { line: 9, key: 'L9.$floor', kind: 'floor' }, { line: 2, key: 'L2.$cited', kind: 'cited' }]);
  SY.cited = nm(c2, 'L9.$cited'); SY.numbers = nm(c2, 'L9.$numbers'); SY.note = nm(c2, 'L9.$note');
  SY.floorIn = c2.notChecked.some((r) => r.key === 'L9.$floor'); SY.factCitedIn = c2.notChecked.some((r) => r.key === 'L2.$cited');
  // (s1) a real sheet row flipped to not-checked
  let sheetKey = null; let sheetDecl = null; let sheetJl = [];
  for (const d of dirs) { const x = J(`${d}/declaration.json`); const sr = (x?.checkList ?? []).find((r) => r.kind === 'sheet' && r.state === 'built'); if (sr) { x.checkList.find((r) => r === sr).state = 'not-checked'; sheetKey = sr.key; sheetDecl = x; const p = parseSignedText(fs.readFileSync(`${d}/prose.txt`, 'utf8')); sheetJl = p.ok ? p.lines : []; sheetCsv = p.ok ? csvRolesOf(p.arbiter) : []; break; } }
  const cs = cardOfPlan({ declaration: sheetDecl, lines: sheetJl, csvRoles: sheetCsv });
  SY.sheetIn = cs.notChecked.find((r) => r.key === sheetKey)?.text; SY.sheetInRows = cs.rows.some((r) => r.key === sheetKey); SY.sheetKey = sheetKey;
}
// (l) synthetic Not checked name
let L = null;
if (MODE === 'candidate') {
  const src = dirs.find((d) => /d-00mwpctg7p-29f9/.test(d)); const decl = JSON.parse(fs.readFileSync(`${src}/declaration.json`, 'utf8'));
  if (decl.checkList.some((r) => r.key === 'L2.phrase.new york')) throw new Error('F241 (l) setup: the synthetic key is held by a signed row');
  decl.checkList.push({ line: 2, key: LVAR ? 'L2.phrase.new york' : 'L2.phrase.chicago ord', from: 'look', by: 'agent', kind: 'phrase', state: 'not-checked', reason: 'x' });
  const jl = parseSignedText(fs.readFileSync(`${src}/prose.txt`, 'utf8')).lines;
  const find = (ledger) => rowsOf({ declaration: decl, lines: jl, ledger }).find((r) => r.key === (LVAR ? 'L2.phrase.new york' : 'L2.phrase.chicago ord'))?.text;
  L = { withLedger: find([{ key: LVAR ? 'L2.phrase.new york' : 'L2.phrase.chicago ord', words: [LVAR ? 'New York' : 'Chicago ORD'] }]), without: find([]) };
}
const verdict = (ok) => (ok ? 'PASS' : 'FAIL');
say(`F242 mode=${MODE}  drafts=${T.drafts}; rows under test=${T.rows}`);
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
const T2 = MODE === 'candidate';
say(`(n1) signed Not checked rows=${N.nc}; with exactly one ledger row (key, rowKind, final, not-checked, words list)=${N.n1ok}; without=${N.n1bad}; ledger rows naming no Not checked row=${N.n1extra}; source=${T2 ? 'candidate ledgerRowsOf (words SYNTHETIC)' : 'saved log.json ledger rows'}  -> ${verdict(N.n1bad === 0 && N.n1extra === 0 && N.nc === 15 && N.n1ok === 15)}`);
say(T2 ? `(n2) SYNTHETIC log, same key twice (A then B): reads ${N2.a} (want B); other key ${N2.z} (want Z); keys ${N2.size} (want 2)  -> ${verdict(N2.a === 'B' && N2.z === 'Z' && N2.size === 2)}` : '(n2) not measurable on today\'s card (no reader)  -> n/a');
say(`(o1) names with the SYNTHETIC ledger: rows=${N.oW.n}; differ=${N.oW.bad}  -> ${verdict(N.oW.bad === 0 && N.oW.n === 15)}`); for (const x of N.oW.ex) say(`   ${x}`);
say(`(o2) names with an EMPTY ledger (key-tail fallback): rows=${N.oT.n}; differ=${N.oT.bad}  -> ${verdict(N.oT.bad === 0 && N.oT.n === 15)}`); for (const x of N.oT.ex) say(`   ${x}`);
say(T2 ? `(o3) SYNTHETIC prose row: ${SY.prose}; stage row: ${SY.stage} (want line 2: x for both)  -> ${verdict(SY.prose === 'line 2: x' && SY.stage === 'line 2: x')}` : '(o3) not measurable on today\'s card  -> n/a');
say(T2 ? `(o4) SYNTHETIC rule with no rule text: ${SY.rule9} (want line 2: rule 9 — x)  -> ${verdict(SY.rule9 === 'line 2: rule 9 — x')}` : '(o4) not measurable on today\'s card  -> n/a');
say(T2 ? `(r) SYNTHETIC cited: ${SY.cited}; numbers: ${SY.numbers}; note: ${SY.note}  -> ${verdict(SY.cited === 'every claim quotes its input' && SY.numbers === 'every number matches a quote' && SY.note === 'the note')}` : '(r) not measurable on today\'s card  -> n/a');
say(T2 ? `(s1) SYNTHETIC not-checked sheet row ${SY.sheetKey}: in the list as ${SY.sheetIn}; among the rows=${SY.sheetInRows}; (s2) not-checked floor in the list=${SY.floorIn}; (s3) not-checked cited on a fact line in the list=${SY.factCitedIn}  -> ${verdict(typeof SY.sheetIn === 'string' && SY.sheetIn.startsWith('sheet "') && !SY.sheetInRows && !SY.floorIn && !SY.factCitedIn)}` : '(s) not measurable on today\'s card  -> n/a');
say(`(t) a rule's ledger words: rule rows=${N.t.n}; saved as exactly [the rule's text]=${N.t.ok}  -> ${verdict(N.t.n === 7 && N.t.ok === 7)}`);
say(`(p) Not checked rows among a line's rows=${N.pAmong}; in their own list=${N.pOwn}; drafts whose list is out of the signed order=${N.pOrderBad}  -> ${verdict(N.pAmong === 0 && N.pOwn === 15 && N.pOrderBad === 0)}`);
say(`(q) Tickets rows=${N.q.rows}; after their line's floor=${N.q.bad}; with no floor row to compare=${N.q.nofloor}  -> ${verdict(N.q.rows === 2 && N.q.bad === 0)}   (place by signed part: NOT MEASURED, open point)`);
fs.writeFileSync(path.join(REPO, `.claude/scratch/card-model/RESULT4-${MODE}.txt`), `${lines.join('\n')}\n`);
