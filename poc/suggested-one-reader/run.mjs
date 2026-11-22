// F244 harness (M19 am6 item 4, pre-registered in docs/logs/FINDINGS.md before this file). NOT the product. $0: no AI, no key, no panel, no node --test.
// usage: node poc/suggested-one-reader/run.mjs --today | --candidate   (candidate = make-candidate.mjs output, a patched COPY of src). Draft folders are copied to mkdtemp folders (read only) and removed after.
// --today writes RESULT-today.json (per draft data, P0, D1); --candidate writes RESULT-candidate.json and compares with the today file (A B C D E).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const MODE = process.argv.includes('--candidate') ? 'candidate' : 'today';
const srcRoot = MODE === 'candidate' ? path.join(REPO, '.claude/scratch/suggested-one-reader/cand/src') : path.join(REPO, 'src');
const OUT = path.join(REPO, '.claude/scratch/suggested-one-reader');
fs.mkdirSync(OUT, { recursive: true });
const imp = (f) => import(pathToFileURL(path.join(srcRoot, f)).href);
const { rebuildBlock } = await imp('planrebuild.js');
const { assembleFromBlock } = await imp('blockassemble.js');
const { cardOfBlock, cardOfPlanBlock } = await imp('cardlist.js');
const { renderCard } = await imp('checkblock.js');
const { buildReadout, NOT_CHECKED_FILE } = await imp('authoring.js');
const { withSheetRows, withSheetCard } = await imp('sheetrows.js');
const { withTicketRows } = await imp('ticketrows.js');
const { csvRolesOf } = await imp('sheetblock.js');

const roots = [path.join(os.homedir(), '.config/fwdloop/flows/.drafts'), path.join(REPO, '.claude/scratch/m19-walk-YBSm/flows/.drafts')];
const J = (p) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; } };
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const S = (o) => JSON.stringify(o);
const walk = (p, dep, out) => {
  if (dep > 4) return;
  let es; try { es = fs.readdirSync(p, { withFileTypes: true }); } catch { return; }
  if (es.some((e) => e.name === 'declaration.json')) out.push(p);
  for (const e of es) if (e.isDirectory() && e.name !== 'pages') walk(path.join(p, e.name), dep + 1, out);
};
const dirs = []; for (const r of roots) walk(r, 0, dirs);
const COPIES = ['grown', 'oneOf', 'after'];
const strip = (rows) => rows.map((r) => { const c = { ...r }; for (const k of COPIES) delete c[k]; return c; });

const data = {}; // key = dir basename path tail
const skipped = [];
const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'f244-'));
try {
  for (const dir of dirs) {
    const decl0 = J(`${dir}/declaration.json`); const log0 = J(`${dir}/log.json`);
    if (!decl0 || !Array.isArray(decl0.checkList) || !Array.isArray(log0?.checkCard?.rows)) continue;
    const id = dir.split('/').slice(-3).join('/');
    const planDir = path.join(tmpRoot, String(Object.keys(data).length + skipped.length));
    fs.cpSync(dir, planDir, { recursive: true });
    const d = { id, savedSuggested: S(log0.checkCard.suggested ?? []) };
    try {
      const b = rebuildBlock({ planDir, asks: true });
      if (!b.ok) { skipped.push(`${id}: rebuild refused: ${b.say}`); continue; }
      const roles = csvRolesOf(b.parsed.arbiter);
      const askLines = new Set(b.parsed.arbiter.asks.map((a) => a.line));
      const { checkList: _c, pickedLines: _p, ...rest } = b.declaration;
      const built = assembleFromBlock({ declaration: rest, block: b.block, lines: b.lines, lineSet: b.lineSet, askLines, sheetRoles: roles });
      const ws = withSheetRows({ declaration: built.declaration, lines: b.lines, csvRoles: roles });
      const wt = withTicketRows({ declaration: ws.declaration, lines: b.lines });
      const decl = wt.declaration;
      const nc = J(path.join(planDir, NOT_CHECKED_FILE)) ?? {};
      const notChecked = Array.isArray(nc.notChecked) ? nc.notChecked.filter((x) => typeof x === 'string') : [];
      const notCheckedBy = isRec(nc.by) ? nc.by : {};
      // every surface, computed from the block as it is now
      const surfaces = () => {
        const sug = cardOfBlock(b.block).suggested;
        const c0 = withSheetCard(cardOfBlock(b.block), ws.sheet);
        const card = cardOfPlanBlock(b.block, wt.tickets.card.length ? withSheetCard(c0, { card: wt.tickets.card }) : c0, { declaration: decl, lines: b.lines, csvRoles: roles, log: Array.isArray(b.log?.log) ? b.log.log : [] });
        const ro = (checkCard) => { try { return buildReadout({ declaration: decl, arbiter: b.parsed.arbiter, lines: b.lines, name: 'f244', modelId: b.log?.modelId, costUsd: b.log?.costUsd ?? null, rounds: b.log?.rounds ?? 0, spendComplete: b.log?.spendComplete !== false, root: undefined, notChecked, notCheckedBy, suggested: card.suggested, checkCard }); } catch (x) { return `THROWN ${x.message}`; } };
        return { sug: S(sug), card: S(card), roNoCard: ro(null), roCard: ro(card) };
      };
      Object.assign(d, surfaces());
      d.rowsWithCopy = b.block.rows.filter((r) => COPIES.some((k) => r[k] !== undefined)).length;
      d.copyKinds = [...new Set(b.block.rows.flatMap((r) => COPIES.filter((k) => r[k] !== undefined)))];
      d.nSuggested = JSON.parse(d.sug).length;
      // (B) strip the three copies from copies of every row (offer untouched), recompute
      const orig = b.block.rows; b.block.rows = strip(orig);
      try { const s = surfaces(); d.stripSame = s.sug === d.sug && s.card === d.card && s.roNoCard === d.roNoCard && s.roCard === d.roCard; d.stripRenderCard = S(renderCard(b.block.rows)); } finally { b.block.rows = orig; }
      // (D) plant wrong copy words on every row; renderCard text and the surfaces
      const before = S(renderCard(orig)); const saved = orig.map((r) => COPIES.map((k) => r[k]));
      for (const r of orig) { r.grown = ['PLANTED']; r.oneOf = ['PLANTED']; r.after = [99]; }
      try { const s = surfaces(); d.plantRenderChanged = S(renderCard(orig)) !== before; d.plantSurfacesSame = s.sug === d.sug && s.card === d.card && s.roNoCard === d.roNoCard && s.roCard === d.roCard; }
      finally { orig.forEach((r, i) => { COPIES.forEach((k, j) => { if (saved[i][j] === undefined) delete r[k]; else r[k] = saved[i][j]; }); }); }
      d.hasCopyReadable = orig.some((r) => ['fact', 'phrase', 'numbers'].includes(r.kind));
      // the rows renderCard actually draws and that read a copy (it skips floor, suggested, dropped and hidden rows)
      d.drawnReadable = orig.some((r) => ['fact', 'phrase', 'numbers'].includes(r.kind) && r.kind !== 'floor' && r.state !== 'suggested' && r.state !== 'dropped' && !r.hidden);
      // (D3) plant a wrong word in a Suggested row's offer.text
      const sr = orig.find((r) => r.state === 'suggested' && r.offer?.text);
      if (sr) { const was = sr.offer; sr.offer = { ...was, text: 'PLANTED' }; try { d.plantOfferChanged = cardOfBlock(b.block).suggested.some((x) => x.text === 'PLANTED'); } finally { sr.offer = was; } }
      d.restoredSame = surfaces().sug === d.sug;
      d.renderCardPlain = before;
    } catch (x) { d.thrown = String(x.stack ?? x).split('\n').slice(0, 3).join(' | '); }
    data[id] = d;
  }
} finally { fs.rmSync(tmpRoot, { recursive: true, force: true }); }

const res = { mode: MODE, drafts: Object.keys(data).length, skipped, data };
fs.writeFileSync(path.join(OUT, `RESULT-${MODE}.json`), JSON.stringify(res, null, 1));
const say = (s = '') => console.log(s);
const all = Object.values(data);
say(`mode ${MODE}: ${all.length} drafts read, ${skipped.length} skipped, ${all.filter((d) => d.thrown).length} thrown`);
for (const s of skipped) say(`  skipped ${s}`);
for (const d of all.filter((x) => x.thrown)) say(`  THROWN ${d.id}: ${d.thrown}`);
const ok = all.filter((d) => !d.thrown);
const rowsAll = ok.flatMap((d) => JSON.parse(d.sug));
say(`Suggested rows: ${rowsAll.length} on ${ok.filter((d) => d.nSuggested).length} drafts`);
// P0
const p0 = ok.filter((d) => d.savedSuggested !== d.sug);
say(`(P0) rebuild suggested == saved checkCard.suggested: ${ok.length - p0.length} of ${ok.length} drafts equal${p0.length ? `; differ: ${p0.map((d) => d.id).join(' ; ')}` : ''}`);
const rep = { P0: { equal: ok.length - p0.length, of: ok.length, differ: p0.map((d) => d.id) } };
if (MODE === 'today') {
  const ap = ok.filter((d) => d.hasCopyReadable);
  const d1 = ap.filter((d) => d.plantRenderChanged).length;
  say(`(D1) today: planted copies change renderCard on ${d1} of ${ap.length} drafts with a fact, phrase or numbers row (any state)`);
  const dr = ok.filter((d) => d.drawnReadable); say(`(D1 drawn) today: planted copies change renderCard on ${dr.filter((d) => d.plantRenderChanged).length} of ${dr.length} drafts that have such a row renderCard draws (not suggested, dropped or hidden)`);
  say(`(D1b) today: planted copies leave the surfaces (suggested, card, both readouts) unchanged on ${ok.filter((d) => d.plantSurfacesSame).length} of ${ok.length}`);
  say(`(info) today strip: surfaces unchanged by deleting the copies on ${ok.filter((d) => d.stripSame).length} of ${ok.length}; rows holding a copy: ${ok.reduce((n, d) => n + d.rowsWithCopy, 0)}; copy kinds seen: ${[...new Set(ok.flatMap((d) => d.copyKinds))].join(',') || 'none'}`);
  say(`(info) restore check: ${ok.filter((d) => d.restoredSame).length} of ${ok.length} drafts' suggested list unchanged after the plants`);
  rep.D1 = { changed: d1, of: ap.length };
} else {
  const t = J(path.join(OUT, 'RESULT-today.json'));
  if (!t) { say('no RESULT-today.json: run --today first'); process.exit(1); }
  const T = t.data;
  const same = ok.filter((d) => T[d.id] && !T[d.id].thrown);
  say(`compared on ${same.length} drafts present and unthrown in both runs (today ${t.drafts}, candidate ${all.length})`);
  // (A)
  let nA = 0; const diffA = []; let miss = 0;
  for (const d of same) {
    const a = JSON.parse(T[d.id].sug); const c = JSON.parse(d.sug); nA += a.length;
    if (a.length !== c.length) { miss++; diffA.push(`${d.id}: ${a.length} rows today, ${c.length} candidate`); }
    for (const x of a) { const y = c.find((z) => z.key === x.key); if (!y) diffA.push(`${d.id} ${x.key}: today "${x.text}" -> (no row)`); else if (S(x) !== S(y)) diffA.push(`${d.id} ${x.key}: today ${S(x)} -> candidate ${S(y)}`); }
  }
  say(`(A) Suggested rows compared: ${nA}; differ: ${diffA.length} -> ${diffA.length === 0 ? 'PASS' : 'FAIL'}`); for (const x of diffA) say(`    ${x}`);
  // (B)
  const bBad = same.filter((d) => !d.stripSame); const withCopy = same.reduce((n, d) => n + d.rowsWithCopy, 0);
  say(`(B) candidate: rows holding a copy field ${withCopy} (want 0); drafts where stripping copies changes a surface ${bBad.length} (want 0) -> ${withCopy === 0 && bBad.length === 0 ? 'PASS' : 'FAIL'}`); for (const d of bBad) say(`    ${d.id}`);
  // (C)
  const lineDiff = (a, b) => { const x = a.split('\n'); const y = b.split('\n'); const out = []; const n = Math.max(x.length, y.length); for (let i = 0; i < n; i++) if (x[i] !== y[i]) out.push(`today "${x[i] ?? '(none)'}" -> candidate "${y[i] ?? '(none)'}"`); return out; };
  const c1 = []; const c2 = [];
  for (const d of same) { for (const l of lineDiff(T[d.id].roNoCard, d.roNoCard)) c1.push(`${d.id}: ${l}`); for (const l of lineDiff(T[d.id].roCard, d.roCard)) c2.push(`${d.id}: ${l}`); }
  say(`(C1) unlisted readout (no saved card), lines that differ: ${c1.length} -> ${c1.length === 0 ? 'PASS' : 'FAIL'}`); for (const x of c1) say(`    ${x}`);
  say(`(C2) readout with the saved card, lines that differ: ${c2.length} -> ${c2.length === 0 ? 'PASS' : 'FAIL'}`); for (const x of c2) say(`    ${x}`);
  // (D)
  const ap = same.filter((d) => d.hasCopyReadable); const d1 = ap.filter((d) => T[d.id].plantRenderChanged).length;
  const d2 = same.filter((d) => d.plantSurfacesSame).length; const d3 = same.filter((d) => d.nSuggested > 0); const d3ok = d3.filter((d) => d.plantOfferChanged === true).length;
  const dr = same.filter((d) => d.drawnReadable); const d1d = dr.filter((d) => T[d.id].plantRenderChanged).length;
  say(`(D1) today: planted copies change renderCard on ${d1} of ${ap.length} drafts with a fact, phrase or numbers row of any state (pre-registered wording); on ${d1d} of ${dr.length} drafts whose such row is one renderCard draws`);
  say(`(D2) candidate: surfaces unchanged by planted copies on ${d2} of ${same.length} (want all)`);
  say(`(D3) candidate: a planted Suggested word shows on ${d3ok} of ${d3.length} drafts with Suggested rows (want all)`);
  const dPass = d1d === dr.length && dr.length > 0 && d2 === same.length && d3ok === d3.length && d3.length > 0;
  say(`(D) -> ${dr.length === 0 || d1d !== dr.length ? 'INCONCLUSIVE' : dPass ? 'PASS' : 'FAIL'}`);
  // (E)
  const eBad = same.filter((d) => T[d.id].card !== d.card);
  say(`(E) saved card (rows, notChecked, suggested, restorable) differs on ${eBad.length} of ${same.length} drafts -> ${eBad.length === 0 ? 'PASS' : 'FAIL'}`); for (const d of eBad) say(`    ${d.id}`);
  Object.assign(rep, { A: { rows: nA, differ: diffA }, B: { withCopy, bBad: bBad.length }, C1: c1, C2: c2, D: { d1, of: ap.length, d1drawn: d1d, ofDrawn: dr.length, d2, d3ok, d3: d3.length }, E: eBad.map((d) => d.id) });
}
fs.writeFileSync(path.join(OUT, `REPORT-${MODE}.json`), JSON.stringify(rep, null, 1));
