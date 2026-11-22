// F235 / M19 am4 ($0, no AI): rebuild the readout of every saved plan folder with one source tree. usage: node snap.mjs <repo> <draftsDir> <out.json>
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
const [repo, drafts, out] = process.argv.slice(2);
const imp = (f) => import(pathToFileURL(path.join(repo, 'src', f)).href);
const { buildReadout } = await imp('authoring.js');
const { parseSignedText } = await imp('signed-text.js');
const { notCheckedView } = await imp('checked.js');
const { cardLinesOf } = await imp('checklistsign.js');
const rj = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const res = [];
for (const d of fs.readdirSync(drafts).sort()) {
  const dd = path.join(drafts, d);
  if (!fs.statSync(dd).isDirectory()) continue;
  for (const p of fs.readdirSync(dd).filter((x) => /^draft(-\d+)?$/.test(x)).sort()) {
    const f = path.join(dd, p);
    const id = `${path.basename(path.dirname(drafts))}:${d}/${p}`;
    const declaration = rj(`${f}/declaration.json`);
    const target = rj(`${f}/target.json`);
    const log = rj(`${f}/log.json`);
    let prose = null; try { prose = fs.readFileSync(`${f}/prose.txt`, 'utf8'); } catch { /* skipped below */ }
    if (!declaration || !target || !log || prose === null) { res.push({ id, skipped: 'files' }); continue; }
    const parsed = parseSignedText(prose);
    if (!parsed.ok) { res.push({ id, skipped: 'prose' }); continue; }
    const nc = rj(`${f}/not-checked.json`);
    const card = log.checkCard ?? null;
    const row = { id, cardList: Boolean(card) && cardLinesOf(declaration).size > 0, cardLines: [...cardLinesOf(declaration)], jobLines: parsed.lines.map((l) => l.n), card, nc: { items: notCheckedView(nc?.notChecked, declaration).items, by: nc?.by ?? {} } };
    try {
      row.readout = buildReadout({ declaration, arbiter: parsed.arbiter, lines: parsed.lines, name: target.name, modelId: log.modelId, costUsd: log.costUsd ?? null, rounds: log.rounds ?? 0, spendComplete: log.spendComplete !== false, root: target.root,
        notChecked: Array.isArray(nc?.notChecked) ? nc.notChecked : [], notCheckedBy: row.nc.by, suggested: card?.suggested ?? [], ...(card ? { checkCard: card } : {}) });
    } catch (e) { row.threw = String(e?.message ?? e).slice(0, 200); }
    res.push(row);
  }
}
fs.writeFileSync(out, JSON.stringify(res));
