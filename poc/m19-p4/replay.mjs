// M19 P4 (F225): fwd's real applyPageRules vs a copy patched with bareloop v0.61.0's contested change, over every saved page look.
// usage: node poc/m19-p4/replay.mjs <dir of copied drafts>
import fs from 'node:fs';
import path from 'node:path';
import { applyPageRules, tieOf } from '../../src/pagerules.js';
import { dedupeMap } from '../../src/pagelook.js';
import { parseSignedText } from '../../src/signed-text.js';
import { applyPageRules as patched } from './pagerules-v061.js';

const root = process.argv[2];
const looks = [];
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const q = path.join(d, e.name); if (e.isDirectory()) walk(q); else if (e.name === 'page-look.json') looks.push(q); } };
walk(root);
looks.sort();
let pages = 0, noProse = 0, noPage = 0, pairs = 0, noPairPages = 0, noPairSame = 0, cannotPages = 0;
const out = [];
for (const f of looks) {
  const dir = path.dirname(f);
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  for (const pg of j.pages || []) {
    pages += 1;
    const pp = path.join(dir, 'prose.txt');
    if (!fs.existsSync(pp)) { noProse += 1; continue; }
    const tp = path.join(dir, 'pages', pg.frozen);
    if (!fs.existsSync(tp)) { noPage += 1; continue; }
    const parsed = parseSignedText(fs.readFileSync(pp, 'utf8'));
    if (!parsed.ok) { noProse += 1; continue; }
    const jobLines = parsed.lines.map((l) => ({ n: l.n, text: l.text, ...(l.guardrail ? { rule: l.guardrail } : {}) }));
    const text = fs.readFileSync(tp, 'utf8');
    const map = dedupeMap(pg.mapping);
    const a = applyPageRules(text, map, jobLines);
    const b = patched(text, map, jobLines);
    const cannot = Array.isArray(map.cannot) ? map.cannot : [];
    if (cannot.length) cannotPages += 1;
    const cset = new Set(cannot.map((c) => tieOf(c.from, jobLines)).filter((t) => t.rule !== undefined).map((t) => `${t.line}:${t.rule}`));
    const pairFacts = (map.facts || []).filter((x) => { const t = tieOf(x.from, jobLines); return t.rule !== undefined && cset.has(`${t.line}:${t.rule}`); });
    const same = JSON.stringify(a.facts) === JSON.stringify(b.facts);
    const label = path.relative(root, dir);
    if (pairFacts.length) {
      pairs += pairFacts.length;
      out.push(`PAIR ${label} role=${pg.role}: ${pairFacts.length} fact(s) tied to a cannot rule: ${pairFacts.map((x) => `"${x.name}" from "${x.from}"`).join('; ')}`);
      out.push(`  kept today: ${a.facts.length}; kept patched: ${b.facts.length}; identical=${same}`);
      const key = (x) => `${x.line}|${x.name}|forRule=${x.forRule ?? '-'}`;
      const ak = new Set(a.facts.map(key)), bk = new Set(b.facts.map(key));
      out.push(`  only today: ${[...ak].filter((x) => !bk.has(x)).join(' ; ') || '-'}`);
      out.push(`  only patched: ${[...bk].filter((x) => !ak.has(x)).join(' ; ') || '-'}`);
      out.push(`  dropped today ${a.dropped.length}, patched ${b.dropped.length}`);
    } else {
      noPairPages += 1;
      if (same && JSON.stringify(a.dropped) === JSON.stringify(b.dropped)) noPairSame += 1; else out.push(`NO-PAIR DIFF ${label} role=${pg.role}`);
    }
  }
}
out.push(`page-look.json files read: ${looks.length}; saved pages: ${pages}; skipped (no prose ${noProse}, no frozen page ${noPage}); replayed: ${pages - noProse - noPage}`);
out.push(`pages with a cannot list: ${cannotPages}; pairs (facts tied to a cannot rule): ${pairs}`);
out.push(`no-pair pages: ${noPairPages}; identical kept facts and drops on no-pair pages: ${noPairSame}/${noPairPages}`);
console.log(out.join('\n'));
