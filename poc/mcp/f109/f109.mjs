// F109: what env an MCP process receives from createMCPBridge. Prints NAMES and yes/no only.
import { createMCPBridge } from 'bare-agent/mcp';
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const server = join(dirname(fileURLToPath(import.meta.url)), 'server.mjs');
const tmp = mkdtempSync(join(tmpdir(), 'f109-'));
const REAL = { PATH: process.env.PATH, HOME: process.env.HOME };

async function run(label, { cutParent = false, wrapEnvI = false }) {
  const out = join(tmp, label + '.names.json');
  const own = { F109_OWN: 'own', F109_OUT_FILE: out };
  let def;
  if (wrapEnvI) def = { command: 'env', args: ['-i', `PATH=${REAL.PATH}`, `HOME=${REAL.HOME}`, `F109_OWN=own`, `F109_OUT_FILE=${out}`, process.execPath, server] };
  else def = { command: process.execPath, args: [server], env: own };
  const cfg = join(tmp, label + '.json');
  writeFileSync(cfg, JSON.stringify({ mcpServers: { f109: def } }));
  const saved = { ...process.env };
  process.env.DEEPSEEK_API_KEY = 'sk-canary-f109-deepseek';
  process.env.FIREWORKS_API_KEY = 'sk-canary-f109-fireworks';
  process.env.F109_PLAIN = 'x';
  if (cutParent) { for (const k of Object.keys(process.env)) if (k !== 'PATH' && k !== 'HOME') delete process.env[k]; }
  let bridge, names = null, err = null;
  try {
    bridge = await createMCPBridge({ configPaths: [cfg], timeout: 15000, callTimeout: 15000, confirmServer: () => true, allow: { f109: ['env_names'] } });
    err = bridge.errors?.[0] ? 'bridge error' : null;
    try { names = JSON.parse(readFileSync(out, 'utf8')); } catch {}
    console.log(`[${label}] tools exposed: ${bridge.tools.map((t) => t.name).join(',') || '(none)'}; bridge errors: ${bridge.errors?.length || 0}`);
  } finally {
    try { await bridge?.close(); } catch {}
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  if (!names) { console.log(`[${label}] child wrote no names (did not start) ${err || ''}`); return null; }
  const has = (n) => names.includes(n);
  console.log(`[${label}] DEEPSEEK_API_KEY reached child: ${has('DEEPSEEK_API_KEY')}; FIREWORKS_API_KEY: ${has('FIREWORKS_API_KEY')}; F109_PLAIN: ${has('F109_PLAIN')}; F109_OWN: ${has('F109_OWN')}; PATH: ${has('PATH')}; HOME: ${has('HOME')}`);
  console.log(`[${label}] ${names.length} names: ${names.join(' ')}`);
  return names;
}

const a = await run('plain', {});
const b = await run('parent-env-cut', { cutParent: true });
const c = await run('env-i-wrapper', { wrapEnvI: true });
console.log('SUMMARY ' + JSON.stringify({ leakDeepseek: !!a?.includes('DEEPSEEK_API_KEY'), leakFireworks: !!a?.includes('FIREWORKS_API_KEY'), own: !!a?.includes('F109_OWN'), cutStarts: !!b, cutLeak: !!b?.includes('DEEPSEEK_API_KEY'), wrapStarts: !!c, wrapLeak: !!(c?.includes('DEEPSEEK_API_KEY') || c?.includes('FIREWORKS_API_KEY')) }));
rmSync(tmp, { recursive: true, force: true });
