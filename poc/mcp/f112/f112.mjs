// F112: check tools on a real MCP via bare-agent listServerTools. Prints names, counts, times, error class only.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoverServers, listServerTools } from 'bare-agent/mcp';

const ex = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function descendants() {
  const { stdout } = await ex('ps', ['-e', '-o', 'pid=,ppid=,comm=']);
  const kids = new Map();
  for (const l of stdout.trim().split('\n')) { const [a, b, comm] = l.trim().split(/\s+/); const p = Number(a), pp = Number(b); if (comm === 'ps') continue; (kids.get(pp) ?? kids.set(pp, []).get(pp)).push(p); }
  const out = new Set(); const q = [process.pid];
  while (q.length) for (const c of kids.get(q.shift()) ?? []) if (!out.has(c)) { out.add(c); q.push(c); }
  return out;
}
const alive = (pid) => { try { process.kill(pid, 0); return true; } catch { return false; } };

// run fn while polling descendants; return {res|err, ms, seen, left}
async function watched(fn) {
  const seen = new Set(); let stop = false;
  const base = await descendants(); // the ps child of the poller itself is excluded below by checking comm via base
  const poll = (async () => { while (!stop) { try { for (const p of await descendants()) if (!base.has(p)) seen.add(p); } catch {} await sleep(25); } })();
  const t0 = performance.now(); let res, err;
  try { res = await fn(); } catch (e) { err = e; }
  const ms = Math.round(performance.now() - t0);
  stop = true; await poll;
  const real = [...seen].filter(alive); // seen pids still alive now (ps pollers die fast; recheck)
  await sleep(2000);
  const left = [...seen].filter(alive);
  const nowKids = [...await descendants()].filter((p) => !base.has(p));
  return { res, err, ms, seen: seen.size, left: left.length, leftNow: nowKids.length, aliveAtEnd: real.length };
}

const cfg = join(homedir(), '.claude.json');
const verdict = {};
const names = [...discoverServers([cfg]).keys()];
console.log('servers in config (names):', names.join(','));

for (const server of ['litectx', 'barebrowse']) {
  const runs = [];
  for (const label of ['cold', 'warm']) {
    const r = await watched(() => listServerTools({ server, configPaths: [cfg], confirmServer: () => true }));
    const tools = r.res ?? [];
    const cnt = { total: tools.length, true: 0, false: 0, absent: 0 };
    for (const t of tools) { const h = t.annotations?.readOnlyHint; if (h === true) cnt.true++; else if (h === false) cnt.false++; else cnt.absent++; }
    runs.push({ label, ms: r.ms, err: r.err ? r.err.constructor.name : null, cnt, named: tools.every((t) => typeof t.name === 'string' && t.name), seen: r.seen, left: r.left, leftNow: r.leftNow });
    if (label === 'cold') console.log(server, 'tool names:', tools.map((t) => t.name).join(','));
  }
  console.log(server, JSON.stringify(runs));
}

const tmp = mkdtempSync(join(tmpdir(), 'f112-'));
try {
  // (d) command does not exist
  const dcfg = join(tmp, 'd.json');
  writeFileSync(dcfg, JSON.stringify({ mcpServers: { ghost: { command: '/nonexistent/f112-no-such-command', args: [] } } }));
  const d = await watched(() => listServerTools({ server: 'ghost', configPaths: [dcfg], confirmServer: () => true, timeout: 5000 }));
  console.log('(d)', JSON.stringify({ ms: d.ms, rejected: !!d.err, cls: d.err?.constructor.name, namesServer: /ghost/.test(d.err?.message ?? ''), msg: String(d.err?.message ?? '').split('\n')[0].slice(0, 200), left: d.left, leftNow: d.leftNow }));
  // (e) stub never answers tools/list
  const ecfg = join(tmp, 'e.json');
  writeFileSync(ecfg, JSON.stringify({ mcpServers: { stubby: { command: process.execPath, args: [join(here, 'stub.mjs')] } } }));
  const e = await watched(() => listServerTools({ server: 'stubby', configPaths: [ecfg], confirmServer: () => true, timeout: 2000 }));
  console.log('(e)', JSON.stringify({ ms: e.ms, rejected: !!e.err, cls: e.err?.constructor.name, timeoutCtx: e.err?.context?.timeout === true, timedOutMsg: /timed out/.test(e.err?.message ?? ''), bound: e.err?.context?.bound ?? null, seen: e.seen, left: e.left, leftNow: e.leftNow, msg: String(e.err?.message ?? '').split('\n')[0].slice(0, 200) }));
} finally { rmSync(tmp, { recursive: true, force: true }); }
