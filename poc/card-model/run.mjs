// F239 ($0, no AI, no key, no panel). usage: node poc/card-model/run.mjs [--today | --candidate] [--shape ruleText]
// --today     the bars applied to TODAY's card rows (log.json checkCard.rows), to record which already fail and why
// --candidate the bars applied to poc/card-model/reader.mjs's rows over the signed plan
// Read only over every draft folder (declaration.json with a checkList) of the two roots; prose.txt gives the job lines.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSignedText } from '../../src/signed-text.js';
import { csvRolesOf } from '../../src/sheetblock.js';
import { ASK_LINE_REASON } from '../../src/blockassemble.js';
import { checkRowsOfPlan, expectedParts } from './reader.mjs';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const roots = [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/.drafts')];
const DIAG = process.argv.includes('--diag-tickets');
const EX = Number(process.env.EX || 3);
const MODE = process.argv.includes('--candidate') ? 'candidate' : 'today';
const SHAPE = process.argv.includes('--shape') ? process.argv[process.argv.indexOf('--shape') + 1] : 'shapeRowsOf';
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const walk = (p, dep, out) => {
  if (dep > 4) return;
  let es; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
  if (es.some((e) => e.name === 'declaration.json')) out.push(p);
  for (const e of es) if (e.isDirectory() && e.name !== 'pages') walk(path.join(p, e.name), dep + 1, out);
};
const kindOf = (r) => (r.state === 'not-checked' ? 'not-checked' : /\$floor$/.test(r.key) ? 'floor' : /\$numbers$/.test(r.key) ? 'numbers' : /\.count\./.test(r.key) ? 'count' : /\.sheet\./.test(r.key) ? 'sheet' : /\.ticket\./.test(r.key) ? 'ticket'
  : r.kind === 'shape' || /\.shape\.|\$shape/.test(r.key) ? 'shape' : /\.fact\./.test(r.key) ? 'fact' : /\.phrase\./.test(r.key) ? 'phrase' : /\.~\d+$/.test(r.key) ? 'rule' : 'other');
const lines = []; const say = (s = '') => { lines.push(s); console.log(s); };
const dirs = []; for (const r of roots) walk(r, 0, dirs);
const T = { drafts: 0, thrown: 0, skipped: 0, noParse: 0, rowsToday: 0, rowsCand: 0 };
const diff = {}; // kind -> {same, words, todayOnly, candOnly, ex: []}
const bump = (k, f) => { diff[k] ??= { same: 0, words: 0, todayOnly: 0, candOnly: 0, ex: [] }; diff[k][f]++; return diff[k]; };
const c = { parts: 0, partsNoRow: 0, partsMany: 0, rowsNoPart: 0 };
const d = { rows: 0, differ: 0, noSigned: 0 };
const e = { items: 0, differ: 0, candOnly: 0, ex: [] };
const b = { drifting: 0, shows: 0, ex: [] };
const err = [];
const FOUR = /d-00mwgdao99-8d69|d-00mwgkehsy-079b|d-00mwp92sxl-2c84|d-00mwpctg7p-29f9/;
const is5 = (r) => r.reason === ASK_LINE_REASON || /\.sheet\.|\.ticket\./.test(r.key) || r.kind === 'shape' || /\.shape\.|\$shape/.test(r.key);
const orderInfo = { drafts: 0, sameOrder: 0 };
for (const dir of dirs) {
  const decl = J(`${dir}/declaration.json`);
  if (!decl || !Array.isArray(decl.checkList)) continue;
  const card = J(`${dir}/log.json`)?.checkCard;
  if (!card || !Array.isArray(card.rows)) { T.skipped++; continue; }
  T.drafts++;
  let prose; try { prose = fs.readFileSync(`${dir}/prose.txt`, 'utf8'); } catch { prose = null; }
  const parsed = prose ? parseSignedText(prose) : null;
  if (!parsed?.ok) { T.noParse++; }
  const jl = parsed?.ok ? parsed.lines : [];
  const csv = parsed?.ok ? csvRolesOf(parsed.arbiter) : [];
  const today = card.rows;
  let cand;
  if (MODE === 'candidate') {
    try { cand = checkRowsOfPlan({ declaration: decl, lines: jl, csvRoles: csv, shapeWords: SHAPE, ticketsSignedOnly: DIAG }); } catch (x) { T.thrown++; err.push(`${dir.slice(-45)}: ${x.message}`); continue; }
  } else {
    cand = null;
  }
  const exp = expectedParts({ declaration: decl });
  const keyToPart = new Map(); for (const p of exp) for (const k of p.keys) keyToPart.set(k, p.id);
  const rows = MODE === 'candidate' ? cand : today.map((r) => ({ ...r, part: keyToPart.get(r.key) ?? null }));
  T.rowsToday += today.length; T.rowsCand += rows.length;
  // (c)
  for (const p of exp) {
    c.parts++;
    const n = rows.filter((r) => r.part === p.id).length;
    if (n === 0) c.partsNoRow++; else if (n > 1) c.partsMany++;
  }
  const ids = new Set(exp.map((p) => p.id));
  for (const r of rows) if (!r.part || !ids.has(r.part)) c.rowsNoPart++;
  // (d)
  const signed = new Map(decl.checkList.map((r) => [r.key, r]));
  for (const r of rows) {
    d.rows++;
    const s = signed.get(r.key);
    if (!s) d.noSigned++; else if (s.by !== r.by) d.differ++;
  }
  // (a) today vs candidate by key (in today mode the two sides are the same rows, nothing to list)
  const mine = new Map(rows.map((r) => [r.key, r]));
  const theirs = new Map(today.map((r) => [r.key, r]));
  const fmt = (r) => `${r.by}|${r.state}|${r.text}|${r.reason ?? ''}`;
  for (const r of today) {
    const m = mine.get(r.key);
    const k = kindOf(r);
    if (!m) { const t = bump(k, 'todayOnly'); if (t.ex.length < EX) t.ex.push(`today-only ${dir.slice(-40)} ${r.key}: ${r.text}`); continue; }
    if (fmt(m) === fmt(r)) bump(k, 'same'); else { const t = bump(k, 'words'); if (t.ex.length < EX) t.ex.push(`${dir.slice(-40)} ${r.key}\n      today : [${r.by}] ${r.text}\n      signed: [${m.by}] ${m.text}`); }
  }
  for (const r of rows) if (!theirs.has(r.key)) { const t = bump(kindOf(r), 'candOnly'); if (t.ex.length < EX) t.ex.push(`cand-only ${dir.slice(-40)} ${r.key}: [${r.by}] ${r.text}`); }
  // order, information only: the keys of each line in order
  orderInfo.drafts++;
  const ord = (xs) => xs.filter((x) => theirs.has(x.key) && mine.has(x.key)).sort((a, b) => a.line - b.line).map((x) => x.key).join('|');
  const stable = (xs) => [...xs].map((x, i) => ({ x, i })).sort((a, b) => a.x.line - b.x.line || a.i - b.i).map((o) => o.x);
  if (ord(stable(rows)) === ord(stable(today))) orderInfo.sameOrder++;
  // (e)
  for (const r of today.filter(is5)) {
    e.items++;
    const m = mine.get(r.key);
    if (!m || fmt(m) !== fmt(r) || m.line !== r.line) { e.differ++; if (e.ex.length < 4) e.ex.push(`${dir.slice(-40)} ${r.key}\n      today: [${r.by}] ${r.text}\n      cand : ${m ? `[${m.by}] ${m.text}` : '(no row)'}`); }
  }
  for (const r of rows.filter(is5)) if (!theirs.has(r.key)) e.candOnly++;
  // (b)
  if (FOUR.test(dir)) {
    for (const r of today) {
      const f = exp.find((p) => p.keys.includes(r.key) && /:fact:|:phrase:/.test(p.id));
      if (!f || /\.~\d+$/.test(r.key)) continue; // F238 (count.mjs) skipped `~` rule rows: a rule row shows the rule's own text, not words
      const fact = (decl.steps.flatMap((s) => s.close?.cited?.facts ?? [])).find((x) => `${x.name}` === f.id.split(':fact:')[1]);
      if (!fact || fact.shape !== 'phrase') continue;
      const signedWords = fact.anyOf ?? (fact.phrase !== undefined ? [fact.phrase] : []);
      const todayWords = r.text.includes(' with ') ? [...r.text.split(/ with /)[1].matchAll(/"([^"]*)"/g)].map((m) => m[1]) : [];
      if (JSON.stringify([...signedWords].sort()) === JSON.stringify([...todayWords].sort())) continue;
      b.drifting++;
      const m = rows.find((x) => x.part === f.id) ?? mine.get(r.key);
      const ok = m && signedWords.every((w) => m.text.includes(w));
      if (ok) b.shows++;
      if (b.ex.length < 10) b.ex.push(`${dir.slice(-30)} ${r.key}\n      today: ${r.text}\n      now  : ${m ? m.text : '(no row)'}  ${ok ? 'SHOWS' : 'NO'}`);
    }
  }
}
say(`F239 mode=${MODE}${MODE === 'candidate' ? ` shape=${SHAPE}${DIAG ? ' DIAGNOSTIC tickets only from a signed row' : ''}` : ''}  drafts with a signed list and a saved card=${T.drafts} (no card, skipped=${T.skipped}; prose unparsed=${T.noParse}); today's card rows=${T.rowsToday}; rows under test=${T.rowsCand}`);
say('');
say('(a) per kind, today vs candidate, matched by key');
for (const [k, v] of Object.entries(diff).sort()) say(`  ${k.padEnd(12)} same=${v.same} words-differ=${v.words} today-only=${v.todayOnly} cand-only=${v.candOnly}`);
for (const [k, v] of Object.entries(diff).sort()) for (const x of v.ex) say(`   [${k}] ${x}`);
say(`  order (info): per-line key order equal on ${orderInfo.sameOrder} of ${orderInfo.drafts} drafts`);
say('');
say(`(b) F238 drifting rows found=${b.drifting}; rows that show the signed phrase=${b.shows}  -> ${b.drifting === 10 && b.shows === 10 ? 'PASS 10 of 10' : `FAIL (${b.shows} of ${b.drifting}; the bar says 10)`}`);
for (const x of b.ex) say(`   ${x}`);
say('');
say(`(c) signed parts=${c.parts}; parts with no row=${c.partsNoRow}; parts with more than one row=${c.partsMany}; rows naming no signed part=${c.rowsNoPart}  -> ${c.partsNoRow + c.partsMany + c.rowsNoPart === 0 ? 'PASS' : 'FAIL'}`);
say(`(d) rows=${d.rows}; tag differs from the signed row's by=${d.differ}; row with no signed row=${d.noSigned}  -> ${d.differ + d.noSigned === 0 ? 'PASS' : 'FAIL'}`);
say(`(e) item-5 rows of today's card=${e.items}; differ in the candidate=${e.differ}; item-5 rows only the candidate has=${e.candOnly}  -> ${e.differ + e.candOnly === 0 ? 'PASS' : 'FAIL'}`);
for (const x of e.ex) say(`   ${x}`);
say(`(f) drafts thrown=${T.thrown}  -> ${T.thrown === 0 ? 'PASS' : 'FAIL'}`);
for (const x of err) say(`   ${x}`);
fs.mkdirSync(path.join(REPO, '.claude/scratch/card-model'), { recursive: true });
fs.writeFileSync(path.join(REPO, `.claude/scratch/card-model/RESULT-${MODE}${MODE === 'candidate' && SHAPE !== 'shapeRowsOf' ? `-${SHAPE}` : ''}${DIAG ? '-diag' : ''}.txt`), `${lines.join('\n')}\n`);
