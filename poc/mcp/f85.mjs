// F85 POC: bareagent's createMCPBridge on the official GitHub MCP server, read-only. $0, no model calls.
// Token only from the launching env (GITHUB_PERSONAL_ACCESS_TOKEN); never written anywhere.
// Run: GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" node poc/mcp/f85.mjs
import { createMCPBridge } from 'bare-agent/mcp';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.F85_OUT || join(here, 'results-f85-1.json');
const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
if (!TOKEN) { console.error('no token in env'); process.exit(2); }
const RUN = 'f85-' + randomBytes(4).toString('hex');
const dir = mkdtempSync(join(tmpdir(), 'f85-'));
const bridgePath = join(dir, 'bridge.json');
const cfgPath = join(dir, 'mcp.json');
writeFileSync(cfgPath, JSON.stringify({ mcpServers: { github: {
  command: 'docker',
  args: ['run', '-i', '--rm', '--name', RUN, '--label', 'f85run=' + RUN,
    '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server', 'stdio', '--read-only'],
} } }));

// capture the bridge's own console output so it can be scanned for the token
const captured = [];
for (const m of ['log', 'warn']) { const o = console[m]; console[m] = (...a) => { captured.push(a.map(x => typeof x === 'string' ? x : JSON.stringify(x)).join(' ')); }; void o; }

const dockerPs = () => execFileSync('docker', ['ps', '-a', '--filter', 'label=f85run=' + RUN, '--format', '{{.ID}} {{.Names}}'], { encoding: 'utf8', timeout: 20000 }).trim();
const procsLeft = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter(l => l.includes('f85run=' + RUN) && !l.includes('ps -eo')).length;
const errShape = (e) => ({ name: e?.name, message: String(e?.message).slice(0, 300), contextKeys: e?.context ? Object.keys(e.context) : [] });
const R = { run: RUN, bridge: 'bare-agent/mcp createMCPBridge', P: {} };
const dl = setTimeout(() => { try { execFileSync('docker', ['rm', '-f', RUN], { timeout: 20000 }); } catch {} rmSync(dir, { recursive: true, force: true }); console.error('F85 deadline 240s'); process.exit(3); }, 240000);

const open = (o = {}) => createMCPBridge({ bridgePath, configPaths: [cfgPath], timeout: 60000, callTimeout: 60000, ...o });
const byName = (b, n) => b.tools.find(t => t.name === n);
let bridge;
try {
  // ---- P1 + P2 + P3 control (all allowed, first run: discovery writes bridge.json)
  bridge = await open();
  const names = bridge.tools.map(t => t.name);
  R.P.P1 = { connected: bridge.servers, errors: bridge.errors, toolCount: names.length,
    has_list_issues: names.includes('github_list_issues'), has_get_issue: names.includes('github_get_issue'),
    verdict: bridge.servers.includes('github') && names.includes('github_list_issues') && names.includes('github_get_issue') ? 'PASS' : 'FAIL' };
  const li = byName(bridge, 'github_list_issues');
  R.P.listIssuesSchema = { props: Object.keys(li.parameters.properties || {}), stateEnum: li.parameters.properties?.state?.enum || null };
  const stateVal = (li.parameters.properties?.state?.enum || []).find(v => /^open$/i.test(v)) || 'open';
  const raw = await li.execute({ owner: 'nodejs', repo: 'node', state: stateVal, perPage: 5 });
  let parsed; try { parsed = JSON.parse(raw); } catch { parsed = null; }
  const arr = Array.isArray(parsed) ? parsed : (parsed?.issues || []);
  const first = arr[0] || {};
  R.P.P2 = { rawType: typeof raw, topKeys: parsed && !Array.isArray(parsed) ? Object.keys(parsed) : 'array', count: arr.length,
    firstKeys: Object.keys(first), fields: arr.map(i => ({ number: i.number, title: String(i.title).slice(0, 60), html_url: i.html_url, url: i.url })),
    verdict: arr.length > 0 && arr.every(i => i.number && i.title && (i.html_url || i.url)) ? (arr.every(i => i.html_url) ? 'PASS' : 'GAP: url present, html_url absent') : 'FAIL' };
  // P3 control: get_me allowed -> succeeds
  const gm = byName(bridge, 'github_get_me');
  let ctrl;
  try { const r = await gm.execute({}); ctrl = { ok: true, type: typeof r, len: String(r).length }; } catch (e) { ctrl = { ok: false, err: errShape(e) }; }
  const cfg0 = JSON.parse(readFileSync(bridgePath, 'utf8'));
  R.P.P6_cfgKeys = Object.keys(cfg0.servers.github);
  R.P.P4_firstRunAllAllow = Object.values(cfg0.servers.github.tools).every(v => v === 'allow');
  await bridge.close(); bridge = null;

  // ---- P3: distil to list_issues + get_issue, reopen without refresh
  const cfg1 = JSON.parse(readFileSync(bridgePath, 'utf8'));
  for (const t of Object.keys(cfg1.servers.github.tools)) cfg1.servers.github.tools[t] = ['list_issues', 'get_issue'].includes(t) ? 'allow' : 'deny';
  writeFileSync(bridgePath, JSON.stringify(cfg1, null, 2));
  bridge = await open();
  const names2 = bridge.tools.map(t => t.name);
  const meta = Object.fromEntries(bridge.metaTools.map(t => [t.name, t]));
  let refusal, directRefusal = null;
  try { await meta.mcp_invoke.execute({ name: 'github_get_me', args: {} }); refusal = { refused: false }; } catch (e) { refusal = { refused: true, ...errShape(e) }; }
  let typo; try { await meta.mcp_invoke.execute({ name: 'github_nonexistent_zzz', args: {} }); typo = { refused: false }; } catch (e) { typo = { refused: true, ...errShape(e) }; }
  directRefusal = { inBulkTools: names2.includes('github_get_me') };
  const stillWorks = await byName(bridge, 'github_list_issues').execute({ owner: 'nodejs', repo: 'node', state: stateVal, perPage: 1 }).then(() => true, () => false);
  R.P.P3 = { controlAllowedGetMe: ctrl, allowedAfterDistil: names2, mcpInvokeDeniedGetMe: refusal, mcpInvokeNonexistentForComparison: typo,
    sameMessageShapeAsUnknownTool: refusal.refused && typo.refused ? refusal.message.replace('github_get_me', 'X') === typo.message.replace('github_nonexistent_zzz', 'X') : null,
    directRefusal, listIssuesStillWorks: stillWorks,
    mechanism: 'bridge omits non-allow tools from bridge.tools; mcp_invoke throws ToolError unknown tool',
    verdict: ctrl.ok && refusal.refused && !directRefusal.inBulkTools && stillWorks ? 'PASS (by omission; denied reads as unknown)' : 'FAIL' };

  // ---- P5: surface
  const disc = await meta.mcp_discover.execute({});
  R.P.P5 = { metaTools: bridge.metaTools.map(t => t.name), discoverCount: disc.count, discoverNames: disc.tools.map(t => t.name),
    deniedHiddenFromDiscover: !disc.tools.some(t => t.name === 'github_get_me'),
    deniedArray: { count: bridge.denied.length, sample: bridge.denied.slice(0, 2).map(d => `${d.server}_${d.tool}`) },
    systemContextNamesDenied: bridge.systemContext.includes('github_get_me'), systemContextHead: bridge.systemContext.split('\n').slice(0, 3).join(' | ').slice(0, 300),
    verdict: !disc.tools.some(t => t.name === 'github_get_me') ? 'PASS for mcp_discover; GAP if systemContext/denied (names + descriptions) is shown to the model' : 'FAIL' };
  await bridge.close(); bridge = null;

  // ---- P4: tool absent from existing config. (a) warm, no refresh; (b) refresh:true merges
  const cfg2 = JSON.parse(readFileSync(bridgePath, 'utf8'));
  delete cfg2.servers.github.tools.get_me; delete cfg2.servers.github.tools.search_repositories;
  writeFileSync(bridgePath, JSON.stringify(cfg2, null, 2));
  bridge = await open();
  const warmNames = bridge.tools.map(t => t.name);
  const warmDenied = bridge.denied.map(d => d.tool);
  const cfgWarm = JSON.parse(readFileSync(bridgePath, 'utf8')).servers.github.tools;
  await bridge.close(); bridge = null;
  bridge = await open({ refresh: true });
  const refreshNames = bridge.tools.map(t => t.name);
  const cfgRef = JSON.parse(readFileSync(bridgePath, 'utf8')).servers.github.tools;
  await bridge.close(); bridge = null;
  R.P.P4 = { warmNoRefresh: { absentToolsExposed: warmNames.filter(n => /get_me|search_repositories$/.test(n)), listedAsDenied: warmDenied.filter(t => ['get_me', 'search_repositories'].includes(t)), cfgGetMe: cfgWarm.get_me ?? null },
    afterRefreshTrue: { cfgGetMe: cfgRef.get_me ?? null, cfgSearchRepositories: cfgRef.search_repositories ?? null, getMeExposed: refreshNames.includes('github_get_me'), exposedCount: refreshNames.length },
    verdict: cfgRef.get_me === 'allow' ? 'GAP: a tool the config did not know is merged as allow on refresh (in a warm config without refresh it is simply absent)' : (cfgRef.get_me === 'deny' ? 'PASS' : 'FAIL') };

  // ---- P6 / P7
  await new Promise(r => setTimeout(r, 2500));
  R.P.P7 = { containersLeft: dockerPs(), processesLeft: procsLeft() };
  R.P.P7.verdict = R.P.P7.containersLeft === '' && R.P.P7.processesLeft === 0 ? 'PASS (mkdtemp removal checked after write)' : 'FAIL';
} catch (e) {
  R.fatal = errShape(e);
} finally {
  try { if (bridge) await bridge.close(); } catch {}
  clearTimeout(dl);
}
R.consoleLines = captured.length;
// P6: token scan in memory only
const scan = (s) => s.includes(TOKEN);
const files = existsSync(dir) ? readdirSync(dir) : [];
const inFiles = files.filter(f => scan(readFileSync(join(dir, f), 'utf8')));
const resultStr = JSON.stringify(R);
R.P.P6 = { filesScanned: files, tokenInFiles: inFiles, tokenInConsoleCapture: captured.some(scan), tokenInResultObject: scan(resultStr),
  configHasEnvKey: R.P.P6_cfgKeys?.includes('env') ?? null };
R.P.P6.verdict = !inFiles.length && !R.P.P6.tokenInConsoleCapture && !R.P.P6.tokenInResultObject && !R.P.P6.configHasEnvKey ? 'PASS' : 'FAIL';
delete R.P.P6_cfgKeys;
rmSync(dir, { recursive: true, force: true });
R.P.P7.mkdtempRemoved = !existsSync(dir);
try { R.P.P7.containersLeft = dockerPs(); } catch {}
const out = JSON.stringify(R, null, 2);
if (scan(out)) { console.error('TOKEN IN RESULT, refusing to write'); process.exit(4); }
writeFileSync(OUT, out + '\n', { flag: 'wx' });
process.stdout.write(out + '\n');
