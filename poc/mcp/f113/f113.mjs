// F113: use counts over run folders. Read-only. Usage: node f113.mjs [flowsRoot]. Prints names and counts only.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

export function count(root) {
  const t0 = performance.now();
  const rows = new Map(); // "server\ttool" -> {calls, runs:Set, last, denied}
  let runDirs = 0, skipped = 0;
  const bump = (server, tool, runKey, at, denied) => {
    const k = `${server}\t${tool}`;
    const r = rows.get(k) ?? rows.set(k, { calls: 0, runs: new Set(), last: '', denied: 0 }).get(k);
    r.calls++; r.runs.add(runKey); if (at && at > r.last) r.last = at; if (denied) r.denied++;
  };
  for (const flow of safeDir(root)) {
    const runsDir = join(root, flow, 'runs');
    for (const run of safeDir(runsDir)) {
      if (!run.startsWith("run-")) continue; // skips .stores
      const dir = join(runsDir, run); const key = `${flow}/${run}`;
      runDirs++;
      // (1) run.json inputs[].mcp.calls
      try {
        const j = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
        const mtime = statSync(join(dir, 'run.json')).mtime.toISOString();
        for (const i of Array.isArray(j.inputs) ? j.inputs : []) {
          const m = i?.mcp; if (!m || typeof m.server !== 'string') continue;
          for (const c of Array.isArray(m.calls) ? m.calls : []) if (typeof c?.tool === 'string') bump(m.server, c.tool, key, mtime, false);
        }
      } catch (e) { if (e.code !== 'ENOENT') { skipped++; if (process.env.F113_DEBUG) console.error('skip run.json', key, e.name); } }
      // (2) diary.jsonl tool rows (a torn line is skipped by line)
      let txt; try { txt = readFileSync(join(dir, 'diary.jsonl'), 'utf8'); } catch { continue; }
      for (const l of txt.split('\n')) {
        if (!l.includes('"kind":"tool"')) continue;
        let r; try { r = JSON.parse(l); } catch { skipped++; if (process.env.F113_DEBUG) console.error('skip diary', key); continue; }
        if (r?.kind === 'tool' && typeof r.tool === 'string') bump('(built-in)', r.tool, key, r.at, r.decision === 'deny');
      }
    }
  }
  const out = [...rows].map(([k, v]) => { const [server, tool] = k.split('\t'); return { server, tool, calls: v.calls, runs: v.runs.size, last: v.last, denied: v.denied }; })
    .sort((a, b) => a.server.localeCompare(b.server) || b.calls - a.calls || a.tool.localeCompare(b.tool));
  return { out, runDirs, skipped, ms: performance.now() - t0 };
}
function safeDir(p) { try { return readdirSync(p); } catch { return []; } }

if (import.meta.url === `file://${process.argv[1]}`) {
  const root = process.argv[2] ?? join(homedir(), '.config', 'fwdloop', 'flows');
  const r = count(root);
  console.log('server\ttool\tcalls\truns\tdenied\tlast');
  for (const x of r.out) console.log(`${x.server}\t${x.tool}\t${x.calls}\t${x.runs}\t${x.denied}\t${x.last}`);
  console.log(JSON.stringify({ runDirs: r.runDirs, skipped: r.skipped, ms: Math.round(r.ms * 10) / 10, msPerRun: Math.round(r.ms / Math.max(1, r.runDirs) * 1000) / 1000 }));
}
