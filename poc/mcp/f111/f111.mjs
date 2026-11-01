// F111: bare-agent passEnv. Names and booleans only. Run: F111_SCRATCH=<dir with node_modules/bare-agent> node f111.mjs
import { createRequire } from 'node:module';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';

const req = createRequire(join(process.env.F111_SCRATCH, 'x.js'));
const { createMCPBridge, listServerTools } = req('bare-agent/mcp');
const { ValidationError } = req('bare-agent');
const here = dirname(fileURLToPath(import.meta.url));
const server = join(here, 'server.mjs');
const marker = join(here, 'marker.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'f111-'));
const sha = (v) => createHash('sha256').update(v).digest('hex');
const CAN = ['DEEPSEEK_API_KEY', 'FIREWORKS_API_KEY'];
process.env.DEEPSEEK_API_KEY = 'sk-canary-f111-deepseek';
process.env.FIREWORKS_API_KEY = 'sk-canary-f111-fireworks';
process.env.F111_SECRET = 'secret-f111-resolved';
process.env.F111_CLASH = 'parent-f111-clash';
const results = {};
const rec = (k, ok, note) => { results[k] = ok; console.log(`(${k}) ${ok ? 'PASS' : 'FAIL'} ${note}`); };

function cfgFor(label, def) {
  const p = join(tmp, label + '.json');
  writeFileSync(p, JSON.stringify({ mcpServers: { f111: def } }));
  return p;
}
function ownDef(label, extra = {}) {
  const out = join(tmp, label + '.out.json');
  return { out, def: { command: process.execPath, args: [server], env: { F111_OUT_FILE: out, F111_OWN: 'own', F111_RESOLVED: '${F111_SECRET}', F111_CLASH: 'own-f111-clash', ...extra } } };
}
const readOut = (o) => { try { return JSON.parse(readFileSync(o, 'utf8')); } catch { return null; } };
async function viaBridge(label, passEnv) {
  const { out, def } = ownDef(label);
  const opts = { configPaths: [cfgFor(label, def)], timeout: 15000, callTimeout: 15000, confirmServer: () => true, allow: { f111: ['env_names'] } };
  if (passEnv !== undefined) opts.passEnv = passEnv;
  const b = await createMCPBridge(opts);
  try { await b.close(); } catch {}
  return readOut(out);
}
const has = (r, n) => !!r?.names.includes(n);

// a
const A = await viaBridge('a', undefined);
rec('a', !!A && CAN.every((n) => has(A, n)) && has(A, 'F111_SECRET') && has(A, 'F111_OWN'), `canaries reached child: ${CAN.map((n) => has(A, n))}; F111_SECRET: ${has(A, 'F111_SECRET')}; own: ${has(A, 'F111_OWN')}`);
// b, c, d
const B = await viaBridge('b', ['PATH', 'HOME']);
rec('b', !!B && CAN.every((n) => !has(B, n)) && has(B, 'PATH') && has(B, 'HOME') && has(B, 'F111_OWN') && has(B, 'F111_OUT_FILE'), `canaries: ${CAN.map((n) => has(B, n))}; PATH ${has(B, 'PATH')}; HOME ${has(B, 'HOME')}; own ${has(B, 'F111_OWN')}; names (${B?.names.length}): ${B?.names.join(' ')}`);
rec('c', !!B && has(B, 'F111_RESOLVED') && !has(B, 'F111_SECRET') && B.resolved === sha(process.env.F111_SECRET), `F111_RESOLVED present ${has(B, 'F111_RESOLVED')}; value equals expected ${B?.resolved === sha(process.env.F111_SECRET)}; F111_SECRET itself in child ${has(B, 'F111_SECRET')}`);
const D = await viaBridge('d', ['PATH', 'HOME', 'F111_CLASH']);
rec('d', !!D && has(D, 'F111_CLASH') && D.clash === sha('own-f111-clash') && D.clash !== sha(process.env.F111_CLASH), `child clash equals own ${D?.clash === sha('own-f111-clash')}; equals parent ${D?.clash === sha(process.env.F111_CLASH)}`);
// e
const E = await viaBridge('e', []);
const eExpected = ['F111_CLASH', 'F111_OUT_FILE', 'F111_OWN', 'F111_RESOLVED'];
const eNames = E?.names ?? [];
const eExtra = eNames.filter((n) => !eExpected.includes(n));
rec('e', !!E && eExpected.every((n) => eNames.includes(n)) && !has(E, 'PATH') && !has(E, 'HOME') && CAN.every((n) => !has(E, n)), `child names (${eNames.length}): ${eNames.join(' ')}; extra beyond own: ${eExtra.join(' ') || '(none)'}`);
// f
let fAll = true;
const bads = [['PATH', 'PATH'], ['empty-string entry', ['']], ['number entry', [1]], ['object', {}]];
for (const [label, bad] of bads) {
  const mk = join(tmp, 'marker-' + label.replace(/\W/g, '_'));
  const cfg = cfgFor('f', { command: process.execPath, args: [marker], env: { F111_MARKER: mk } });
  let thrown = null, thrownL = null;
  try { await createMCPBridge({ configPaths: [cfg], timeout: 5000, confirmServer: () => true, passEnv: bad }); } catch (e) { thrown = e; }
  try { await listServerTools({ server: 'f111', configPaths: [cfg], timeout: 5000, confirmServer: () => true, passEnv: bad }); } catch (e) { thrownL = e; }
  await new Promise((r) => setTimeout(r, 800));
  const ok = thrown instanceof ValidationError && thrownL instanceof ValidationError && !existsSync(mk);
  if (!ok) fAll = false;
  console.log(`   f[${label}] bridge ValidationError ${thrown instanceof ValidationError} (${thrown?.constructor?.name}); list ValidationError ${thrownL instanceof ValidationError}; marker exists ${existsSync(mk)}`);
}
rec('f', fAll, 'all four bad shapes (bridge and listServerTools)');
// g
{
  const { out, def } = ownDef('g');
  const tools = await listServerTools({ server: 'f111', configPaths: [cfgFor('g', def)], timeout: 15000, confirmServer: () => true, passEnv: ['PATH', 'HOME'] });
  const G = readOut(out);
  rec('g', !!G && CAN.every((n) => !has(G, n)) && has(G, 'PATH') && has(G, 'F111_OWN') && tools.length === 1, `canaries: ${CAN.map((n) => has(G, n))}; PATH ${has(G, 'PATH')}; own ${has(G, 'F111_OWN')}; tools ${tools.length}`);
}

// h: measurement. Remove canaries/test vars from the parent first? No: keep them, they prove the cut.
console.log('--- (h) measurement ---');
const EXTRA = ['TMPDIR', 'LANG', 'USER', 'XDG_RUNTIME_DIR', 'NODE_OPTIONS', 'npm_config_cache'];
async function tryList(cfgPath, passEnv) {
  try { const t = await listServerTools({ server: 'f111', configPaths: [cfgPath], timeout: 60000, confirmServer: () => true, passEnv }); return { ok: true, n: t.length }; }
  catch (e) { return { ok: false, n: 0, err: e?.constructor?.name + (e?.context?.code ? ':' + e.context.code : '') }; }
}
async function measure(label, def) {
  const cfg = cfgFor('h-' + label, def);
  const base = ['PATH', 'HOME'];
  let r = await tryList(cfg, base);
  const row = { label, base: r.ok ? 'started' : 'failed ' + r.err, tools: r.n, needs: [] };
  if (!r.ok) {
    const present = EXTRA.filter((n) => n in process.env);
    let single = null;
    for (const n of present) { const x = await tryList(cfg, [...base, n]); if (x.ok) { single = n; row.tools = x.n; break; } }
    if (single) row.needs = [single];
    else {
      const all = await tryList(cfg, [...base, ...present]);
      if (all.ok) {
        let cur = [...present]; row.tools = all.n;
        for (const n of [...cur]) { const t = cur.filter((m) => m !== n); const x = await tryList(cfg, [...base, ...t]); if (x.ok) cur = t; }
        row.needs = cur;
      } else row.needs = ['(not fixed by any of the candidates) ' + all.err];
    }
  }
  console.log(`(h) ${label}: with PATH+HOME ${row.base}; tools ${row.tools}; extra names needed: ${row.needs.join(',') || '(none)'}`);
  return row;
}
const cj = JSON.parse(readFileSync(join(homedir(), '.claude.json'), 'utf8')).mcpServers || {};
const table = [];
for (const name of ['barebrowse', 'litectx', 'baremobile']) {
  if (!cj[name]) { console.log(`(h) ${name}: not in ~/.claude.json`); continue; }
  table.push(await measure(name, cj[name]));
}
// stand-in for an sh-wrapped server (own env uses a $VAR reference expanded by sh, node found via PATH)
{
  const out = join(tmp, 'sh.out.json');
  const def = { command: 'sh', args: ['-c', 'exec node "$F111_SERVER"'], env: { F111_SERVER: server, F111_OUT_FILE: out, F111_OWN: 'own' } };
  const row = await measure('sh-wrapped-test', { ...def });
  const o = readOut(out);
  console.log(`(h) sh-wrapped-test child names (${o?.names.length}): ${o?.names.join(' ')}`);
  table.push(row);
}
console.log('H_TABLE ' + JSON.stringify(table));
rmSync(tmp, { recursive: true, force: true });
const pass = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].every((k) => results[k]);
console.log('RESULTS ' + JSON.stringify(results));
process.exit(pass ? 0 : 1);
