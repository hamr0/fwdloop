// F86 POC: bare-agent 0.53.0 createMCPBridge({ allow }) on the official GitHub MCP server, read-only. $0, no model calls.
// Token only from the launching env (GITHUB_PERSONAL_ACCESS_TOKEN); never written anywhere.
// Run: GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" node poc/mcp/f86.mjs
import { createMCPBridge } from 'bare-agent/mcp';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.F86_OUT || join(here, 'results-f86-1.json');
const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
if (!TOKEN) { console.error('no token in env'); process.exit(2); }
const RUN = 'f86-' + randomBytes(4).toString('hex');
const dir = mkdtempSync(join(tmpdir(), 'f86-'));
let seq = 0;
const cfgFor = () => {
  const p = join(dir, `mcp-${++seq}.json`);
  writeFileSync(p, JSON.stringify({ mcpServers: { github: {
    command: 'docker',
    args: ['run', '-i', '--rm', '--name', `${RUN}-${seq}`, '--label', 'f86run=' + RUN,
      '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server', 'stdio', '--read-only'],
  } } }));
  return p;
};

// stdout / stderr capture only while `watch` is true (during createMCPBridge/close); stderr always kept for the token scan
let watch = false; const stdoutDuring = []; const stderrAll = [];
const so = process.stdout.write.bind(process.stdout), se = process.stderr.write.bind(process.stderr);
process.stdout.write = (c, ...a) => { if (watch) { stdoutDuring.push(String(c)); return true; } return so(c, ...a); };
process.stderr.write = (c, ...a) => { stderrAll.push(String(c)); return true; };

const dockerPs = () => execFileSync('docker', ['ps', '-a', '--filter', 'label=f86run=' + RUN, '--format', '{{.ID}} {{.Names}}'], { encoding: 'utf8', timeout: 20000 }).trim();
const procsLeft = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter(l => l.includes('f86run=' + RUN) && !l.includes('ps -eo')).length;
const errShape = (e) => ({ name: e?.name, message: String(e?.message).slice(0, 300), contextKeys: e?.context ? Object.keys(e.context) : [] });
const R = { run: RUN, bridge: 'bare-agent/mcp createMCPBridge({allow})', V: {} };
const dl = setTimeout(() => { try { execFileSync('docker', ['ps', '-aq', '--filter', 'label=f86run=' + RUN]).toString().split('\n').filter(Boolean).forEach(id => execFileSync('docker', ['rm', '-f', id], { timeout: 20000 })); } catch {} rmSync(dir, { recursive: true, force: true }); se('F86 deadline 240s\n'); process.exit(3); }, 240000);

const open = async (allow, o = {}) => { watch = true; try { return await createMCPBridge({ configPaths: [cfgFor()], timeout: 60000, callTimeout: 60000, allow, ...o }); } finally { watch = false; } };
const close = async (b) => { watch = true; try { await b.close(); } finally { watch = false; } };
const names = (b) => b.tools.map(t => t.name).sort();
const byName = (b, n) => b.tools.find(t => t.name === n);
const parse = (raw) => { try { const p = JSON.parse(raw); return Array.isArray(p) ? p : (p.issues || []); } catch { return []; } };
const ISS = { owner: 'nodejs', repo: 'node', state: 'OPEN', perPage: 5 };

// V5 baseline: .mcp-bridge.json locations
const probe = [join(process.cwd(), '.mcp-bridge.json'), join(dir, '.mcp-bridge.json'), join(homedir(), '.mcp-bridge.json'), join(here, '.mcp-bridge.json')];
const stat = (p) => existsSync(p) ? statSync(p).mtimeMs : null;
const before = probe.map(stat);

let b;
try {
  // V1 + V2 + V6
  b = await open({ github: ['list_issues', 'issue_read'] });
  const n1 = names(b);
  R.V.V1 = { names: n1, missing: b.missing, denied: b.denied, errors: b.errors,
    verdict: JSON.stringify(n1) === JSON.stringify(['github_issue_read', 'github_list_issues']) && b.missing.length === 0 && b.denied.length === 0 ? 'PASS' : 'FAIL' };
  const arr = parse(await byName(b, 'github_list_issues').execute(ISS));
  R.V.V2 = { count: arr.length, numbers: arr.map(i => i.number), verdict: arr.length > 0 && arr.every(i => i.number && i.title) ? 'PASS' : 'FAIL' };
  const ctx = b.systemContext;
  const leaked = ['get_me', 'create_issue', 'search_repositories'].filter(t => ctx.includes(t));
  R.V.V6 = { leaked, hasRestricted: /restricted/i.test(ctx), mentionsAllowed: ctx.includes('github_list_issues') && ctx.includes('github_issue_read'), ctxChars: ctx.length,
    ctxHead: ctx.split('\n').slice(0, 6).map(l => l.slice(0, 120)),
    verdict: !leaked.length && !/restricted/i.test(ctx) ? 'PASS' : 'FAIL' };
  const absent = !n1.includes('github_get_me');
  // extra: mcp_invoke on an excluded name
  const meta = Object.fromEntries(b.metaTools.map(t => [t.name, t]));
  let inv; try { await meta.mcp_invoke.execute({ name: 'github_get_me', args: {} }); inv = { refused: false }; } catch (e) { inv = { refused: true, ...errShape(e), denied: e?.context?.denied }; }
  await close(b); b = null;

  // V3 second half: get_me allowed, present, call succeeds
  b = await open({ github: ['list_issues', 'get_me'] });
  const gm = byName(b, 'github_get_me');
  let call; try { const r = await gm.execute({}); call = { ok: true, len: String(r).length }; } catch (e) { call = { ok: false, err: errShape(e) }; }
  R.V.V3 = { absentWithV1Allow: absent, presentWhenAllowed: !!gm, callWhenAllowed: call, mcpInvokeOnExcluded: inv,
    verdict: absent && gm && call.ok ? 'PASS' : 'FAIL' };
  await close(b); b = null;

  // V4
  b = await open({ github: ['list_issues', 'no_such_tool_f86'] });
  const works = await byName(b, 'github_list_issues')?.execute({ ...ISS, perPage: 1 }).then(() => true, () => false);
  R.V.V4 = { missing: b.missing, names: names(b), listIssuesWorks: !!works,
    verdict: b.missing.some(m => m.server === 'github' && m.tool === 'no_such_tool_f86') && works ? 'PASS' : 'FAIL' };
  await close(b); b = null;

  // V7
  b = await open({ github: ['list_issues'] }, { callTimeout: 1 });
  let t7; try { await byName(b, 'github_list_issues').execute(ISS); t7 = { threw: false }; } catch (e) {
    const c = e?.context || {}; const st = typeof c.stderr === 'string' ? c.stderr : '';
    t7 = { threw: true, name: e?.name, message: String(e?.message).slice(0, 200), timeout: c.timeout, server: c.server, tool: c.tool, timeoutMs: c.timeoutMs,
      contextKeys: Object.keys(c), stderrLen: st.length, messageHasStderr: st.length > 0 ? String(e.message).includes(st.trim().slice(0, 40)) : null };
  }
  t7.verdict = t7.threw && t7.name === 'ToolError' && t7.timeout === true && t7.server === 'github' && t7.tool && t7.timeoutMs === 1 && t7.messageHasStderr !== true ? 'PASS' : 'FAIL';
  R.V.V7 = t7;
  await close(b); b = null;

  // V8
  let t8; try { b = await open({ github: [] }); t8 = { threw: false }; } catch (e) { t8 = { threw: true, ...errShape(e) }; }
  t8.verdict = t8.threw && t8.name === 'ValidationError' ? 'PASS' : 'FAIL';
  R.V.V8 = t8;
  if (b) { await close(b); b = null; }

  // V5 / V10 evidence
  await new Promise(r => setTimeout(r, 2500));
  const after = probe.map(stat);
  R.V.V5 = { probed: probe.map((p, i) => ({ where: i === 0 ? 'cwd' : i === 1 ? 'mkdtemp' : i === 2 ? 'HOME' : 'script dir', before: before[i] !== null, after: after[i] !== null, mtimeChanged: before[i] !== after[i] })),
    stdoutBytesDuringBridgeCalls: stdoutDuring.join('').length };
  R.V.V5.verdict = R.V.V5.probed.every(p => p.before === p.after && !p.mtimeChanged) && R.V.V5.stdoutBytesDuringBridgeCalls === 0 ? 'PASS' : 'FAIL';
  R.V.V10 = { containersLeft: dockerPs(), processesLeft: procsLeft() };
  R.V.V10.verdict = R.V.V10.containersLeft === '' && R.V.V10.processesLeft === 0 ? 'PASS (mkdtemp removal checked after write)' : 'FAIL';
} catch (e) {
  R.fatal = errShape(e);
} finally {
  try { if (b) await close(b); } catch {}
  clearTimeout(dl);
}
R.stderrBytes = stderrAll.join('').length;
const scan = (s) => s.includes(TOKEN);
const files = existsSync(dir) ? readdirSync(dir) : [];
const inFiles = files.filter(f => scan(readFileSync(join(dir, f), 'utf8')));
R.V.V9 = { filesScanned: files.length, tokenInFiles: inFiles.length, tokenInStdoutCapture: stdoutDuring.some(scan), tokenInStderrCapture: stderrAll.some(scan), tokenInResultObject: scan(JSON.stringify(R)) };
R.V.V9.verdict = !R.V.V9.tokenInFiles && !R.V.V9.tokenInStdoutCapture && !R.V.V9.tokenInStderrCapture && !R.V.V9.tokenInResultObject ? 'PASS' : 'FAIL';
rmSync(dir, { recursive: true, force: true });
if (R.V.V10) { R.V.V10.mkdtempRemoved = !existsSync(dir); try { R.V.V10.containersLeft = dockerPs(); } catch {} }
const out = JSON.stringify(R, null, 2);
process.stdout.write = so; process.stderr.write = se;
if (scan(out)) { console.error('TOKEN IN RESULT, refusing to write'); process.exit(4); }
writeFileSync(OUT, out + '\n', { flag: 'wx' });
process.stdout.write(out + '\n');
