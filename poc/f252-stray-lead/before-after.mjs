// F252 $0 proof: for every saved draft (declaration.json + prose.txt, read only) compare the card's lead per step, before (old src dir) and after (this tree).
// usage: node before-after.mjs <old-repo-root> <new-repo-root> <dir>...  (each dir is searched for declaration.json files)
import fs from 'node:fs';
import path from 'node:path';
const [oldRoot, newRoot, ...dirs] = process.argv.slice(2);
const old = await import(path.join(oldRoot, 'src/checked.js'));
const cur = await import(path.join(newRoot, 'src/checked.js'));
const { parseSignedText } = await import(path.join(newRoot, 'src/signed-text.js'));
const found = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'declaration.json' && d.includes('/.drafts/') && fs.existsSync(path.join(d, 'prose.txt'))) found.push(d); } };
for (const d of dirs) if (fs.existsSync(d)) walk(d);
let identical = 0, changed = 0, bad = 0, strayLines = 0, sentencesDiff = 0;
for (const d of found) {
  let decl; try { decl = JSON.parse(fs.readFileSync(path.join(d, 'declaration.json'), 'utf8')); } catch { continue; }
  if (!Array.isArray(decl.steps)) continue;
  const parsed = parseSignedText(fs.readFileSync(path.join(d, 'prose.txt'), 'utf8'));
  const opts = parsed.ok ? { askLines: parsed.arbiter.asks.map((x) => x.line), lines: parsed.lines } : { hasAsk: true };
  const a = old.checkedLines(decl, opts), b = cur.checkedLines(decl, opts);
  // the page's lead rule: old = sentences[0] when any; new = lead when a string
  const oldLeads = a.map((c) => (c.sentences.length ? c.sentences[0] : null));
  const newLeads = b.map((c) => (typeof c.lead === 'string' ? c.lead : null));
  if (JSON.stringify(a.map((c) => c.sentences)) !== JSON.stringify(b.map((c) => c.sentences))) sentencesDiff += 1;
  let diff = false;
  oldLeads.forEach((o, i) => {
    if (o === newLeads[i]) return;
    const st = decl.steps[i], c = b[i];
    const allowed = st?.close?.class === 'green' && st.close.itemShape && !st.close.cited && !st.close.sheet && newLeads[i] === null && o === c.sentences[0];
    if (!allowed) { bad += 1; console.log('UNEXPECTED', d, 'step', i + 1, JSON.stringify({ o, n: newLeads[i] })); } else strayLines += 1;
    diff = true;
  });
  if (diff) changed += 1; else identical += 1;
}
console.log(JSON.stringify({ drafts: found.length, identical, changedOnlyStray: changed, strayLines, unexpected: bad, sentencesArrayDiffers: sentencesDiff }));
