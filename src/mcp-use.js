// M13 piece 3 (docs/wiki/the-module-ladder.md, M13 scope item 2 "Use counts come from what runs already record"; FINDINGS F113): how often each MCP server's tools were used,
// read from what runs already keep. No new run-folder file, nothing is written.
//   - a ticket read: `run.json` `inputs[].mcp.calls` (server + tool; the file holds no time, so `last` is the file's mtime);
//   - a step's tool call: a `kind:"tool"` row of `diary.jsonl` whose tool is `<server>_<tool>` (M13 piece 2); `decision:"deny"` is a denied call, counted apart and not as a use.
// A torn or unreadable file is skipped, row by row (its rows go missing from the count; it never breaks the page).
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const safeDir = (/** @type {string} */ p) => { try { return readdirSync(p); } catch { return []; } };

/**
 * @param {string} root the jobs folder (`<root>/<flow>/runs/run-<n>/`)
 * @param {string[]} servers the server names to count for; a step tool row belongs to the LONGEST name that prefixes it with `_`
 * @returns {Map<string, { calls: number, runs: number, last: string|null, denied: number, tools: Map<string, number> }>}
 */
export function countMcpUse(root, servers) {
  const byLength = [...servers].sort((a, b) => b.length - a.length);
  /** @type {Map<string, { calls: number, runSet: Set<string>, last: string, denied: number, tools: Map<string, number> }>} */
  const acc = new Map(servers.map((s) => [s, { calls: 0, runSet: new Set(), last: '', denied: 0, tools: new Map() }]));
  const use = (/** @type {string} */ server, /** @type {string} */ tool, /** @type {string} */ run, /** @type {string} */ at, /** @type {boolean} */ denied) => {
    const a = acc.get(server);
    if (!a) return;
    if (denied) { a.denied++; return; }
    a.calls++; a.runSet.add(run); a.tools.set(tool, (a.tools.get(tool) ?? 0) + 1);
    if (at && at > a.last) a.last = at;
  };
  for (const flow of safeDir(root)) {
    for (const name of safeDir(join(root, flow, 'runs'))) {
      if (!name.startsWith('run-')) continue;
      const dir = join(root, flow, 'runs', name);
      const key = `${flow}/${name}`;
      try {
        const j = JSON.parse(readFileSync(join(dir, 'run.json'), 'utf8'));
        const mtime = statSync(join(dir, 'run.json')).mtime.toISOString();
        for (const i of Array.isArray(j?.inputs) ? j.inputs : []) {
          const m = i?.mcp;
          if (!m || typeof m.server !== 'string') continue;
          for (const c of Array.isArray(m.calls) ? m.calls : []) if (typeof c?.tool === 'string') use(m.server, c.tool, key, mtime, false);
        }
      } catch { /* no run.json, or torn: nothing counted from it */ }
      let text;
      try { text = readFileSync(join(dir, 'diary.jsonl'), 'utf8'); } catch { continue; }
      for (const line of text.split('\n')) {
        if (!line.includes('"kind":"tool"')) continue;
        let r;
        try { r = JSON.parse(line); } catch { continue; }
        if (r?.kind !== 'tool' || typeof r.tool !== 'string') continue;
        const server = byLength.find((s) => r.tool.startsWith(`${s}_`) && r.tool.length > s.length + 1);
        if (server) use(server, r.tool.slice(server.length + 1), key, typeof r.at === 'string' ? r.at : '', r.decision === 'deny');
      }
    }
  }
  return new Map([...acc].map(([s, a]) => [s, { calls: a.calls, runs: a.runSet.size, last: a.last || null, denied: a.denied, tools: a.tools }]));
}
