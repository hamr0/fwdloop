// F131: books + file names + badCalls/cutOff for run folders. Reads only. usage: node compare.mjs <root> <flow> <runId>...
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
const [root, flow, ...ids] = process.argv.slice(2);
const jl = (p) => (existsSync(p) ? readFileSync(p, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : []);
const walk = (d, pre = '') => readdirSync(d).flatMap((n) => (statSync(join(d, n)).isDirectory() ? walk(join(d, n), `${pre}${n}/`) : [`${pre}${n}`]));
const norm = (f) => f.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, '<uuid>').replace(/-[0-9a-f]{16}\.json$/, '-<hash>.json');
const out = {};
for (const id of ids) {
  const dir = join(root, flow, 'runs', id);
  const audit = jl(join(dir, 'audit.jsonl'));
  const spend = jl(join(dir, 'spend.jsonl'));
  const hist = jl(join(root, flow, 'history.jsonl')).filter((h) => h.runId === id);
  const auditUsd = audit.reduce((s, r) => s + (typeof r.usd === 'number' ? r.usd : 0), 0);
  const spendUsd = spend.reduce((s, r) => s + (typeof r.costUsd === 'number' ? r.costUsd : 0), 0);
  const histUsd = hist.length ? hist[hist.length - 1].spentUsd : null;
  const files = walk(dir).filter((f) => !f.startsWith('inputs/') && !f.startsWith('job/')).map(norm).sort();
  const text = walk(dir).filter((f) => /\.(jsonl?|txt)$/.test(f)).map((f) => [f, readFileSync(join(dir, f), 'utf8')]);
  const hit = (re) => text.filter(([, t]) => re.test(t)).map(([f]) => f);
  const unpriced = audit.filter((r) => r.spendComplete === false).length + spend.filter((r) => r.costUsd == null).length;
  out[id] = {
    rows: audit.length, auditUsd, spendRounds: spend.length, spendUsd, histUsd, histRows: hist.length,
    balanced: histUsd !== null && Math.abs(auditUsd - histUsd) < 1e-9 && Math.abs(spendUsd - histUsd) < 1e-9, unpriced,
    outcome: hist.length ? hist[hist.length - 1].outcome : null, files,
    badCalls: hit(/"badCalls"\s*:\s*\[\s*\{/), cutOff: hit(/"cutOff"\s*:\s*(?!null|false)/), stopReasons: [...new Set(text.flatMap(([, t]) => [...t.matchAll(/"stopReason":"([^"]+)"/g)].map((m) => m[1])))],
    verdicts: audit.map((r) => `${r.step}#${r.attempt}:${r.verdict}`),
  };
}
if (ids.length === 2) {
  const [a, b] = ids;
  out.sameFileNames = JSON.stringify(out[a].files) === JSON.stringify(out[b].files);
  out.onlyIn = { [a]: out[a].files.filter((f) => !out[b].files.includes(f)), [b]: out[b].files.filter((f) => !out[a].files.includes(f)) };
}
console.log(JSON.stringify(out, null, 1));
