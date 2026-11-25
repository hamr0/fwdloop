// F256 $0 count (read only): saved drafts, rows on job lines with no `~`. usage: node count.mjs <repoRoot> <dir>...
import fs from 'node:fs';
import path from 'node:path';
const [root, ...dirs] = process.argv.slice(2);
const { parseSignedText } = await import(path.join(root, 'src/signed-text.js'));
const found = new Set();
const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name); if (e.isDirectory()) walk(p); else if (e.name === 'declaration.json' && (p.includes('/.drafts/') || (process.env.INCLUDE_SIGNED === '1' && !p.includes('/runs/')))) found.add(fs.realpathSync(p)); } };
for (const d of dirs) if (fs.existsSync(d)) walk(d);
const tally = { drafts: found.size, withCheckList: 0, parsed: 0, unparsed: 0, draftsWithNoTildeLine: 0, byWorld: { hasTilde: { drafts: 0, noTildeLines: 0 }, noTilde: { drafts: 0, noTildeLines: 0 } }, bang: {}, dollar: {}, forcedNoGuardrail: 0, dropped: 0, draftsWithForced: new Set(), draftsWithDropped: new Set(), draftsWithBangBuilt: 0 };
const bump = (o, k) => { o[k] = (o[k] ?? 0) + 1; };
for (const f of found) {
  let d; try { d = JSON.parse(fs.readFileSync(f, 'utf8')); } catch { continue; }
  if (!Array.isArray(d.checkList)) continue;
  tally.withCheckList++;
  const prosePath = path.join(path.dirname(f), '..', 'prose.txt');
  const p2 = fs.existsSync(path.join(path.dirname(f), 'prose.txt')) ? path.join(path.dirname(f), 'prose.txt') : prosePath;
  let parsed; try { parsed = parseSignedText(fs.readFileSync(p2, 'utf8')); } catch { parsed = { ok: false }; }
  if (!parsed.ok) { tally.unparsed++; continue; }
  tally.parsed++;
  const asks = new Set(parsed.arbiter.asks.map((a) => a.line));
  const sends = new Set((parsed.arbiter.sends ?? []).map((s) => s.line));
  const anyTilde = parsed.lines.some((l) => l.guardrail);
  const noTilde = parsed.lines.filter((l) => !l.guardrail && !asks.has(l.n) && !sends.has(l.n)).map((l) => l.n);
  const w = anyTilde ? tally.byWorld.hasTilde : tally.byWorld.noTilde;
  w.drafts++; w.noTildeLines += noTilde.length;
  if (noTilde.length) tally.draftsWithNoTildeLine++;
  let built = false;
  for (const r of d.checkList) {
    if (!noTilde.includes(r.line) || r.kind === 'floor') continue;
    const bucket = r.by === 'agent' ? tally.bang : r.by === 'default' ? tally.dollar : null;
    if (!bucket) continue;
    bump(bucket, `${r.kind}:${r.state}`);
    if (r.by === 'agent' && r.state === 'built') built = true;
    if (r.state === 'not-checked' && /no guardrail of yours/.test(r.reason ?? '')) { tally.forcedNoGuardrail++; tally.draftsWithForced.add(f); }
    if (r.state === 'dropped') { tally.dropped++; tally.draftsWithDropped.add(f); }
  }
  if (built) tally.draftsWithBangBuilt++;
}
tally.draftsWithForced = tally.draftsWithForced.size; tally.draftsWithDropped = tally.draftsWithDropped.size;
console.log(JSON.stringify(tally, null, 1));
