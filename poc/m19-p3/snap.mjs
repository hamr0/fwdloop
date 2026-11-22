// F232 / M19 P3 helper: `node snap.mjs <repoRoot> <flowsRoot> <outFile>`. Reads every job folder under flowsRoot through the readers a screen uses, with the `src/` of <repoRoot>
// (the baseline worktree or HEAD), and writes one JSON object keyed by the folder's path. The reader logic is copied from test/m19-block-snapshot.mjs `signedReaders` / `flowSnapshot` / `flowDirs`
// (that file is not in the baseline tree). $0, no AI, no key; read-only on flowsRoot.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const [repo, root, out] = process.argv.slice(2);
if (!repo || !root || !out) { console.error('usage: snap.mjs <repoRoot> <flowsRoot> <outFile>'); process.exit(2); }
const imp = (f) => import(pathToFileURL(path.join(repo, 'src', f)).href);
const { parseSignedText } = await imp('signed-text.js');
const { csvRolesOf } = await imp('sheetblock.js');
const { checkedLines, notCheckedView } = await imp('checked.js');
const { auditChecksOf } = await imp('auditchecks.js');
const { withSheetRows } = await imp('sheetrows.js');
const { checkListReds, listLinesOf, cardLinesOf } = await imp('checklistsign.js');

const plain = (x) => JSON.parse(JSON.stringify(x ?? null));
const isRec = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
// a tmp path, a hash and a time are not part of what a screen shows (the same scrub as the repo's guard)
function scrub(v) {
  if (typeof v === 'string') return v.replace(/fwdloop-[a-z0-9]+-[A-Za-z0-9]{6}/g, '<TMP>').replace(/\b[0-9a-f]{64}\b/g, '<SHA>');
  if (Array.isArray(v)) return v.map(scrub);
  if (isRec(v)) { const o = {}; for (const [k, x] of Object.entries(v)) { if (k === 'at' || k === 'hash') continue; o[k] = scrub(x); } return o; }
  return v;
}
function signedReaders({ prose, declaration, notChecked }) {
  const p = parseSignedText(prose);
  if (!p.ok) return { unreadable: plain(p.reds) };
  const csvRoles = csvRolesOf(p.arbiter);
  const askLines = p.arbiter.asks.map((a) => a.line);
  const items = Array.isArray(notChecked?.notChecked) ? notChecked.notChecked : Array.isArray(notChecked?.items) ? notChecked.items : [];
  const t = (f) => { try { return plain(f()); } catch (e) { return { threw: String(e?.message ?? e).slice(0, 200) }; } };
  return {
    list: t(() => ({ onList: [...listLinesOf(declaration)].sort(), card: [...cardLinesOf(declaration)].sort(), reds: checkListReds(declaration) })),
    checked: t(() => checkedLines(declaration, { askLines, lines: p.lines, csvRoles })),
    audit: t(() => auditChecksOf(declaration, [], { items, by: notChecked?.by ?? {} }, { lines: p.lines, csvRoles })),
    sheetCard: t(() => { const s = withSheetRows({ declaration, lines: p.lines, csvRoles }); return { card: s.sheet.card, signed: s.sheet.signed }; }),
    notChecked: t(() => notCheckedView(items, declaration)),
    closes: t(() => (declaration.steps ?? []).map((s) => [s.fromLine, s.close])),
    checkList: declaration.checkList ?? null,
  };
}
function flowSnapshot(dir) {
  const pick = (f) => [path.join(dir, 'signed', f), path.join(dir, f)].find((x) => fs.existsSync(x));
  const pf = pick('prose.txt'); const df = pick('declaration.json');
  if (!pf || !df) return { skipped: 'no prose or declaration' };
  let declaration;
  try { declaration = JSON.parse(fs.readFileSync(df, 'utf8')); } catch { return { skipped: 'declaration unreadable' }; }
  let notChecked = null;
  for (const f of ['signature.json', 'signed/signature.json']) {
    try { const s = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')); if (isRec(s.notChecked)) notChecked = s.notChecked; } catch { /* none */ }
  }
  return signedReaders({ prose: fs.readFileSync(pf, 'utf8'), declaration, notChecked });
}
function flowDirs(r) {
  const o = [];
  const walk = (d, depth) => {
    if (fs.existsSync(path.join(d, 'prose.txt')) && fs.existsSync(path.join(d, 'declaration.json'))) o.push(d);
    if (depth >= 5) return;
    for (const e of fs.readdirSync(d, { withFileTypes: true })) if (e.isDirectory() && e.name !== 'node_modules' && e.name !== 'inputs' && e.name !== 'artifacts') walk(path.join(d, e.name), depth + 1);
  };
  walk(r, 0);
  return o.sort();
}
const snap = {};
for (const d of flowDirs(root)) snap[path.relative(root, d) || '.'] = scrub(flowSnapshot(d));
fs.writeFileSync(out, `${JSON.stringify(snap, null, 1)}\n`);
console.log(`${Object.keys(snap).length} job folders read with ${repo}`);
