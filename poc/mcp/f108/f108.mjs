// F108: MCP discovery over the M13 places. Prints NAMES only, never a command/arg/env value.
import { discoverServers } from 'bare-agent/mcp';
import { existsSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const H = homedir();
const PLACES = [
  join(H, '.mcp.json'), join(H, '.claude', 'mcp_servers.json'),
  join(H, '.config', 'Claude', 'claude_desktop_config.json'), join(H, '.cursor', 'mcp.json'),
  join(H, '.claude.json'),
];
const show = (p) => p.replace(H, '~');
const res = {};

// (a) per file
console.log('(a) per file');
for (const p of PLACES) {
  if (!existsSync(p)) { console.log(`  ${show(p)}: MISSING`); continue; }
  try {
    const m = discoverServers([p]);
    console.log(`  ${show(p)}: ${m.size} [${[...m.keys()].join(', ')}]`);
  } catch (e) { console.log(`  ${show(p)}: THREW ${e.constructor.name}`); res.aThrew = true; }
}
let all;
try { all = discoverServers(PLACES); console.log(`  all 5 in order: ${all.size} [${[...all.keys()].join(', ')}]`); }
catch (e) { res.aThrew = true; console.log('  all-5 call THREW'); }
res.a = !res.aThrew && all && all.size > 0;

// (b) remote vs startable: field names only
console.log('(b) per server: field NAMES, startable?');
for (const [n, d] of all) {
  console.log(`  ${n}: fields=[${Object.keys(d).join(',')}] hasCommand=${typeof d.command === 'string' && d.command !== ''}`);
}

// temp area for (c)(d)(e)
const tmp = mkdtempSync(join(tmpdir(), 'f108-'));
const marker = join(tmp, 'CANARY-RAN');
const projDir = join(tmp, 'proj'); execFileSync('mkdir', [projDir]);
writeFileSync(join(projDir, '.mcp.json'), JSON.stringify({ mcpServers: { 'f108-canary': { command: 'node', args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`] } } }));

// (c)
const origWarn = console.warn; let warned = false; console.warn = () => { warned = true; };
const cwd0 = process.cwd(); process.chdir(projDir);
const noPaths = discoverServers();
const withPaths = discoverServers(PLACES);
process.chdir(cwd0); console.warn = origWarn;
console.log(`(c) default discovery lists f108-canary: ${noPaths.has('f108-canary')} (bare-agent skip warning emitted: ${warned}); explicit paths lists it: ${withPaths.has('f108-canary')}`);
res.c = !noPaths.has('f108-canary') && !withPaths.has('f108-canary');

// (d) duplicate name in two temp files
const f1 = join(tmp, 'one.json'), f2 = join(tmp, 'two.json');
writeFileSync(f1, JSON.stringify({ mcpServers: { dup: { command: 'node', args: ['FIRST'] } } }));
writeFileSync(f2, JSON.stringify({ mcpServers: { dup: { command: 'node', args: ['SECOND'] } } }));
let warnD = false; console.warn = () => { warnD = true; };
const dm = discoverServers([f1, f2]); console.warn = origWarn;
const kept = dm.get('dup').args[0];
console.log(`(d) duplicate kept: ${kept}; warning emitted by bare-agent: ${warnD}`);
res.d = kept === 'FIRST';

// (e) nothing starts: planted startable canary in an explicit file
const f3 = join(tmp, 'three.json');
writeFileSync(f3, JSON.stringify({ mcpServers: { c2: { command: 'node', args: ['-e', `require('fs').writeFileSync(${JSON.stringify(marker)},'ran')`] } } }));
discoverServers([f3, ...PLACES]);
await new Promise((r) => setTimeout(r, 1500));
let kids = '';
try { kids = execFileSync('ps', ['--ppid', String(process.pid), '-o', 'comm=']).toString().split('\n').map((x) => x.trim()).filter((x) => x && x !== 'ps').join(','); } catch { kids = ''; }
console.log(`(e) canary file written: ${existsSync(marker)}; child processes: ${kids ? 'yes' : 'none'}`);
res.e = !existsSync(marker) && !kids;

console.log('(f) this script prints names, field names and yes/no only');
console.log('SUMMARY ' + JSON.stringify(res));
rmSync(tmp, { recursive: true, force: true });
