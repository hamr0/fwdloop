// F118: bare-agent bridge-level cwd. Run: F118_NEW=<scratch with branch tarball> F118_OLD=<scratch with 0.56.0 from npm> node f118.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, realpathSync, readdirSync, mkdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const load = (dir) => { const r = createRequire(join(dir, 'x.js')); return { ...r('bare-agent/mcp'), ValidationError: r('bare-agent').ValidationError }; };
const NEW = load(process.env.F118_NEW);
const OLD = load(process.env.F118_OLD);
const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, 'server.mjs');
const tmp = realpathSync(mkdtempSync(join(tmpdir(), 'f118-')));
const mk = (n) => { const d = join(tmp, n); mkdirSync(d); return realpathSync(d); };
const A = mk('A'), B = mk('B'), C = mk('C');
process.chdir(C);
process.env.F118_CANARY = 'canary';
const results = {};
const rec = (k, ok, note) => { results[k] = ok; console.log(`(${k}) ${ok ? 'PASS' : 'FAIL'} ${note}`); };

const alive = (p) => { try { process.kill(p, 0); return true; } catch { return false; } };
const descendants = () => {
  const rows = execFileSync('ps', ['-e', '-o', 'pid=,ppid=']).toString().trim().split('\n').map((l) => l.trim().split(/\s+/).map(Number));
  const kids = new Map(); for (const [p, pp] of rows) { (kids.get(pp) ?? kids.set(pp, []).get(pp)).push(p); }
  const out = []; const st = [process.pid];
  while (st.length) { for (const k of kids.get(st.pop()) ?? []) { out.push(k); st.push(k); } }
  return out;
};
const seen = new Set();
const poll = setInterval(() => { try { for (const p of descendants()) seen.add(p); } catch {} }, 100);

let n = 0;
const fakeDef = (extra = {}) => { const out = join(tmp, `out${++n}.json`); return { out, def: { command: process.execPath, args: [server], env: { F118_OUT_FILE: out }, ...extra } }; };
const cfgFile = (servers) => { const p = join(tmp, `cfg${++n}.json`); writeFileSync(p, JSON.stringify({ mcpServers: servers })); return p; };
const rp = (p) => { try { return realpathSync(p); } catch { return null; } };
const readOut = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return null; } };
const mkOpts = (cfgPath, extra) => ({ configPaths: [cfgPath], timeout: 20000, callTimeout: 20000, confirmServer: () => true, ...extra });
const nm = (d) => (d === A ? 'A' : d === B ? 'B' : d === C ? 'C (parent cwd)' : d);

async function viaBridge(lib, extraOpts, defExtra) {
  const { out, def } = fakeDef(defExtra);
  const b = await lib.createMCPBridge(mkOpts(cfgFile({ f118: def }), { allow: { f118: ['where'] }, ...extraOpts }));
  try {
    const r = await b.tools.find((x) => x.name === 'f118_where').execute({});
    const txt = typeof r === 'string' ? r : JSON.stringify(r);
    const mm = txt.match(/CWD=([^;"\\]+);CANARY=(true|false)/);
    return { tool: mm ? { cwd: mm[1], canary: mm[2] === 'true' } : null, marker: readOut(out), raw: txt.slice(0, 120) };
  } finally { await b.close(); }
}
const sameDir = (r, dir) => !!r.tool && !!r.marker && rp(r.tool.cwd) === dir && rp(r.marker.cwd) === dir;

try { const r = await viaBridge(NEW, { cwd: A }); rec('a', sameDir(r, A), `tool cwd = ${nm(rp(r.tool?.cwd))}; marker cwd = ${nm(rp(r.marker?.cwd))}`); }
catch (e) { rec('a', false, `threw ${e?.name}: ${e?.message}`); }
try { const r = await viaBridge(NEW, {}); rec('b', sameDir(r, C), `tool cwd = ${nm(rp(r.tool?.cwd))}; marker cwd = ${nm(rp(r.marker?.cwd))}`); }
catch (e) { rec('b', false, `threw ${e?.name}: ${e?.message}`); }
try { const r = await viaBridge(NEW, { cwd: A }, { cwd: B }); rec('c', sameDir(r, B), `def.cwd=B, bridge cwd=A: tool = ${nm(rp(r.tool?.cwd))}; marker = ${nm(rp(r.marker?.cwd))}`); }
catch (e) { rec('c', false, `threw ${e?.name}: ${e?.message}`); }
try {
  const { out, def } = fakeDef();
  const tools = await NEW.listServerTools({ configPaths: [cfgFile({ f118: def })], server: 'f118', timeout: 20000, cwd: A });
  const m = readOut(out);
  rec('d', !!m && rp(m.cwd) === A, `listServerTools returned ${JSON.stringify(tools).length} chars; marker cwd = ${nm(rp(m?.cwd))}`);
} catch (e) { rec('d', false, `threw ${e?.name}: ${e?.message}`); }
{
  const fileP = join(tmp, 'afile'); writeFileSync(fileP, 'x');
  const bads = [['missing path', join(tmp, 'nope')], ['a file', fileP], ['relative', 'rel/dir'], ['"~"', '~'], ['empty string', ''], ['non-string 42', 42]];
  const eRows = [];
  for (const [label, val] of bads) {
    for (const entry of ['createMCPBridge', 'listServerTools']) {
      const mark = join(tmp, `mark${++n}`);
      const cfg = cfgFile({ f118: { command: process.execPath, args: [join(here, 'marker.mjs')], env: { F118_MARKER: mark } } });
      let err = null;
      try {
        if (entry === 'createMCPBridge') { const b = await NEW.createMCPBridge(mkOpts(cfg, { allow: { f118: ['where'] }, cwd: val })); await b.close(); }
        else await NEW.listServerTools({ configPaths: [cfg], server: 'f118', timeout: 20000, cwd: val });
      } catch (e) { err = e; }
      await new Promise((r) => setTimeout(r, 700));
      const isVE = !!err && (err instanceof NEW.ValidationError) && err.name === 'ValidationError';
      const spawned = existsSync(mark);
      eRows.push({ label, entry, ok: isVE && !spawned, err: err?.name ?? 'none', spawned });
    }
  }
  for (const r of eRows) console.log(`    e: ${r.label} / ${r.entry}: ${r.ok ? 'ok' : 'BAD'} (${r.err}, spawned ${r.spawned})`);
  rec('e', eRows.every((r) => r.ok), `${eRows.filter((r) => r.ok).length}/${eRows.length} cases are ValidationError with no spawn`);
}
try {
  const { out, def } = fakeDef();
  const bp = join(tmp, 'bridge-out.json');
  const b = await NEW.createMCPBridge({ configPaths: [cfgFile({ f118: def })], bridgePath: bp, timeout: 20000, callTimeout: 20000, confirmServer: () => true, cwd: A });
  await b.close();
  const txt = existsSync(bp) ? readFileSync(bp, 'utf8') : null;
  const m = readOut(out);
  rec('f', txt !== null && !txt.includes(A) && rp(m?.cwd) === A, `bridge file written ${txt !== null} (${txt?.length} chars); contains A: ${txt?.includes(A)}; server cwd was A: ${rp(m?.cwd) === A}`);
} catch (e) { rec('f', false, `threw ${e?.name}: ${e?.message}`); }
try { const r = await viaBridge(NEW, { cwd: A, passEnv: ['PATH', 'HOME'] }); rec('g', sameDir(r, A) && r.tool.canary === false && r.marker.canary === false, `cwd A: ${sameDir(r, A)}; canary in child (tool/marker): ${r.tool?.canary}/${r.marker?.canary}`); }
catch (e) { rec('g', false, `threw ${e?.name}: ${e?.message}`); }
try {
  const r = await viaBridge(OLD, { cwd: A });
  rec('h', !sameDir(r, A), `published 0.56.0 with cwd:A: tool cwd = ${nm(rp(r.tool?.cwd))}; marker = ${nm(rp(r.marker?.cwd))}; reports A: ${sameDir(r, A)}`);
} catch (e) { rec('h', false, `0.56.0 threw ${e?.name}: ${e?.message} (no server result to compare; recorded FAIL on the letter)`); }

console.log('--- (i) real servers, cwd = os.homedir(), passEnv [PATH,HOME] ---');
const home = homedir();
const cj = JSON.parse(readFileSync(join(home, '.claude.json'), 'utf8')).mcpServers || {};
const bbBefore = new Set(readdirSync('/tmp').filter((x) => x.startsWith('barebrowse-')));
const homeBefore = new Set(readdirSync(home));
const ghMark = join(tmp, 'github-mark');
const iServers = {};
if (cj.barebrowse) iServers.barebrowse = cj.barebrowse;
if (cj.litectx) iServers.litectx = cj.litectx;
iServers.github = { command: process.execPath, args: [join(here, 'marker.mjs')], env: { F118_MARKER: ghMark } };
try {
  const b = await NEW.createMCPBridge({ configPaths: [cfgFile(iServers)], timeout: 60000, callTimeout: 60000, confirmServer: () => true, allow: { barebrowse: ['browse'], litectx: ['recall'] }, passEnv: ['PATH', 'HOME'], cwd: home });
  console.log('(i) bridge tool names: ' + b.tools.map((t) => t.name).join(', ') + '; missing: ' + JSON.stringify(b.missing ?? null));
  for (const [srv, tool, args] of [['barebrowse', 'browse', { url: 'https://example.com' }], ['litectx', 'recall', { query: 'f118 cwd test' }]]) {
    const t = b.tools.find((x) => x.name === `${srv}_${tool}`);
    if (!t) { console.log(`(i) ${srv}.${tool}: tool absent`); continue; }
    const t0 = Date.now();
    try {
      const r = await t.execute(args);
      const txt = typeof r === 'string' ? r : JSON.stringify(r);
      console.log(`(i) ${srv}.${tool}: returned ${txt.length} chars in ${Date.now() - t0} ms; text: ${JSON.stringify(txt.slice(0, srv === 'litectx' ? 600 : 250))}`);
    } catch (e) { console.log(`(i) ${srv}.${tool}: threw ${e?.name}: ${e?.message} in ${Date.now() - t0} ms`); }
  }
  await b.close();
} catch (e) { console.log(`(i) bridge threw ${e?.name}: ${e?.message}`); }
const homeAfter = readdirSync(home);
console.log(`(i) home top-level before ${homeBefore.size}, after ${homeAfter.length}; created: ${JSON.stringify(homeAfter.filter((x) => !homeBefore.has(x)))}; vanished: ${JSON.stringify([...homeBefore].filter((x) => !homeAfter.includes(x)))}`);
console.log(`(i) github stand-in started: ${existsSync(ghMark)} (expected false)`);

await new Promise((r) => setTimeout(r, 1500));
clearInterval(poll);
const left = descendants().filter(alive);
for (const p of left) { try { process.kill(p, 'SIGKILL'); } catch {} }
rec('j', left.length === 0, `descendants ever seen ${seen.size}; alive 1.5 s after the last close: ${left.length}`);
for (const x of readdirSync('/tmp')) if (x.startsWith('barebrowse-') && !bbBefore.has(x)) { rmSync(join('/tmp', x), { recursive: true, force: true }); console.log('removed /tmp/' + x); }
rmSync(tmp, { recursive: true, force: true });
const pass = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'j'].every((k) => results[k]);
console.log('RESULTS ' + JSON.stringify(results));
process.exit(pass ? 0 : 1);
