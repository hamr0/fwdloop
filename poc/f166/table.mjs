// F166 table (POC, NOT the product). $0, read-only. usage: node table.mjs <f165 scratch dir>
// Per draft: phase, kept look facts on line 2 (page-look.json look.facts), per drafter round line-2 class + reds, final close of line 2 (declaration.json).
import fs from 'node:fs';
const root = process.argv[2];
const rs = fs.readFileSync(`${root}/results.jsonl`, 'utf8').trim().split('\n').map(JSON.parse);
for (const r of rs) {
  const base = `${root}/flows/.drafts/${r.draftId}`;
  const p = fs.existsSync(`${base}/draft-1`) ? 'draft-1' : 'draft';
  const L = JSON.parse(fs.readFileSync(`${base}/${p}/log.json`, 'utf8'));
  const pl = JSON.parse(fs.readFileSync(`${base}/${p}/page-look.json`, 'utf8'));
  const kept = (pl.look?.facts ?? []).filter((f) => f.line === 2).map((f) => `${f.name}${f.forRule ? '#' + f.forRule : ''}`).join(',');
  const rounds = L.log.filter((x) => x.args).map((x) => {
    const a = x.args; const st = (a.steps ?? []).find((s) => s.fromLine === 2);
    return `${x.kind}[${st ? st.close.class + (st.close.cited ? '+cited' : '') : a.guardrailClasses?.[2] ?? '-'}]${(x.reds ?? []).length ? ' RED:' + x.reds.map((t) => t.slice(0, 60)).join('|') : ''}`;
  });
  const structure = L.log.filter((x) => String(x.outcome ?? '').startsWith('structure')).length;
  let fin = '-';
  try { const d = JSON.parse(fs.readFileSync(`${base}/${p}/declaration.json`, 'utf8')); const s = d.steps.find((x) => x.fromLine === 2); fin = s.close.class + (s.close.cited ? '+cited' : '') + (s.close.picked ? '+picked' : '') + (s.close.shape ? '+shape' : ''); } catch { /* none */ }
  console.log([r.flowName, p, `kept[${kept}]`, `rounds ${rounds.join(' > ')}`, `structureErr=${structure}`, `final=${fin}`].join(' | '));
}
