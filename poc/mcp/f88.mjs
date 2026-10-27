// F88 POC: bare-agent 0.54.0 annotations, listServerTools, tools/list pagination. $0, no model calls.
// Real server: official GitHub MCP server (docker, NOT --read-only; listing + read-only calls only).
// Token only from the launching env (GITHUB_PERSONAL_ACCESS_TOKEN); never written anywhere.
// Run: GITHUB_PERSONAL_ACCESS_TOKEN="$(gh auth token)" timeout 300 node poc/mcp/f88.mjs
import { createMCPBridge, listServerTools } from 'bare-agent/mcp';
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, rmSync, existsSync, statSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const here = dirname(fileURLToPath(import.meta.url));
const OUT = process.env.F88_OUT || join(here, 'results-f88-1.json');
const TOKEN = process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '';
if (!TOKEN) { console.error('no token in env'); process.exit(2); }
const RUN = 'f88-' + randomBytes(4).toString('hex');
const dir = mkdtempSync(join(tmpdir(), 'f88-'));
const MARK = 'f88stub-' + RUN;

// stub MCP server (stdio, newline-delimited JSON-RPC)
const stubPath = join(dir, 'stub.mjs');
writeFileSync(stubPath, `
import { appendFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
const [mode, countFile, markerFile] = process.argv.slice(2);
if (markerFile) writeFileSync(markerFile, 'started');
if (mode === 'exit') process.exit(1);
const send = (id, result) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id, result }) + '\\n');
const T = { alpha: { name: 'alpha', description: 'a', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  beta: { name: 'beta', description: 'b', inputSchema: { type: 'object' } },
  gamma: { name: 'gamma', description: 'g', inputSchema: { type: 'object' }, annotations: [] } };
let n = 0;
createInterface({ input: process.stdin }).on('line', (l) => {
  let m; try { m = JSON.parse(l); } catch { return; }
  if (m.id === undefined) return;
  if (m.method === 'initialize') return send(m.id, { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'stub', version: '1' } });
  if (m.method === 'tools/list') {
    n++; appendFileSync(countFile, 'x');
    if (mode === 'silent') return;
    const c = m.params && m.params.cursor;
    if (mode === 'three') { const i = c ? Number(c.slice(1)) : 0; const names = ['alpha', 'beta', 'gamma']; return send(m.id, { tools: [T[names[i]]], ...(i < 2 && { nextCursor: 'c' + (i + 1) }) }); }
    if (mode === 'loop') return send(m.id, { tools: [T.alpha], nextCursor: 'same' });
    if (mode === 'endless') return send(m.id, { tools: [{ ...T.alpha, name: 'alpha' + n }], nextCursor: 'e' + n });
  }
  send(m.id, {});
});
`);

let seq = 0;
const ghCfg = () => { const p = join(dir, `gh-${++seq}.json`); writeFileSync(p, JSON.stringify({ mcpServers: { github: { command: 'docker',
  args: ['run', '-i', '--rm', '--name', `${RUN}-${seq}`, '--label', 'f88run=' + RUN, '-e', 'GITHUB_PERSONAL_ACCESS_TOKEN', 'ghcr.io/github/github-mcp-server', 'stdio'] } } })); return p; };
const stubCfg = (mode, tag) => { const p = join(dir, `stub-${++seq}.json`); const count = join(dir, `count-${tag}`); const marker = join(dir, `marker-${tag}`);
  writeFileSync(p, JSON.stringify({ mcpServers: { stub: { command: process.execPath, args: [stubPath, mode, count, marker, MARK] } } })); return { p, count, marker }; };
const cnt = (f) => existsSync(f) ? readFileSync(f, 'utf8').length : 0;

let watch = false; const stdoutDuring = []; const stderrAll = [];
const so = process.stdout.write.bind(process.stdout), se = process.stderr.write.bind(process.stderr);
process.stdout.write = (c, ...a) => { if (watch) { stdoutDuring.push(String(c)); return true; } return so(c, ...a); };
process.stderr.write = (c, ...a) => { stderrAll.push(String(c)); return true; };
const W = async (fn) => { watch = true; try { return await fn(); } finally { watch = false; } };
const dockerPs = () => execFileSync('docker', ['ps', '-a', '--filter', 'label=f88run=' + RUN, '--format', '{{.ID}} {{.Names}}'], { encoding: 'utf8', timeout: 20000 }).trim();
const procsLeft = () => execFileSync('ps', ['-eo', 'pid,args'], { encoding: 'utf8' }).split('\n').filter(l => (l.includes('f88run=' + RUN) || l.includes(MARK)) && !l.includes('ps -eo')).length;
const errShape = (e) => ({ name: e?.name, message: String(e?.message).slice(0, 300), context: e?.context ? Object.fromEntries(Object.entries(e.context).filter(([k]) => k !== 'stderr')) : null });
const settle = async (fn, bound = 20000) => { const t0 = Date.now(); let tid; try { const v = await Promise.race([fn(), new Promise((_, r) => { tid = setTimeout(() => r(new Error('HARNESS-BOUND')), bound); })]); return { resolved: true, value: v, ms: Date.now() - t0 }; } catch (e) { return { resolved: false, err: errShape(e), ms: Date.now() - t0 }; } finally { clearTimeout(tid); } };

const uncaught = []; process.on('uncaughtException', (e) => { uncaught.push({ name: e?.name, code: e?.code, message: String(e?.message).slice(0, 200) }); });
const R = { run: RUN, bridge: 'bare-agent/mcp 0.54', P: {} };
const dl = setTimeout(() => { try { execFileSync('docker', ['ps', '-aq', '--filter', 'label=f88run=' + RUN]).toString().split('\n').filter(Boolean).forEach(id => execFileSync('docker', ['rm', '-f', id], { timeout: 20000 })); } catch {} rmSync(dir, { recursive: true, force: true }); se('F88 deadline 240s\n'); process.exit(3); }, 240000);

const probe = [join(process.cwd(), '.mcp-bridge.json'), join(homedir(), '.mcp-bridge.json'), join(here, '.mcp-bridge.json')];
const stat = (p) => existsSync(p) ? statSync(p).mtimeMs : null;
const before = probe.map(stat);
const dirBefore = null;
const ro = (t) => t.annotations?.readOnlyHint;
const hasKey = (t) => Object.prototype.hasOwnProperty.call(t, 'annotations');
let b;
try {
  // P1
  b = await W(() => createMCPBridge({ configPaths: [ghCfg()], timeout: 60000, callTimeout: 60000, allow: { github: ['list_issues', 'issue_read'] } }));
  const meta = Object.fromEntries(b.metaTools.map(t => [t.name, t]));
  const disc = await meta.mcp_discover.execute({});
  R.P.P1 = { tools: b.tools.map(t => ({ name: t.name, annotations: t.annotations })),
    discover: (disc.tools || []).map(t => ({ name: t.name, annotations: t.annotations })) };
  R.P.P1.verdict = b.tools.length === 2 && b.tools.every(t => ro(t) === true) && R.P.P1.discover.length === 2 && R.P.P1.discover.every(t => t.annotations?.readOnlyHint === true) ? 'PASS' : 'FAIL';
  const p1 = Object.fromEntries(b.tools.map(t => [t.name, ro(t)]));
  await W(() => b.close()); b = null;

  // P2 + P3 + P4(stdout) + P8 part
  const lst = await settle(() => W(() => listServerTools({ configPaths: [ghCfg()], server: 'github', confirmServer: () => true, timeout: 60000 })), 120000);
  if (!lst.resolved) { R.P.P2 = { err: lst.err, verdict: 'FAIL' }; }
  else {
    const L = lst.value; const t = Object.fromEntries(L.map(x => [x.name, x]));
    const T = L.filter(x => ro(x) === true).length, F = L.filter(x => ro(x) === false).length, M = L.filter(x => !hasKey(x) || ro(x) === undefined).length;
    R.P.P2 = { count: L.length, readOnlyTrue: T, readOnlyFalse: F, missing: M, shape: L.every(x => typeof x.name === 'string' && typeof x.description === 'string'),
      issue_read: ro(t.issue_read), list_issues: ro(t.list_issues), issue_write: ro(t.issue_write), add_issue_comment: ro(t.add_issue_comment), ms: lst.ms,
      falseNames: L.filter(x => ro(x) === false).map(x => x.name), namesHead: L.slice(0, 5).map(x => x.name) };
    R.P.P2.verdict = L.length === 46 && T === 27 && F === 19 && M === 0 && R.P.P2.issue_read === true && R.P.P2.list_issues === true && R.P.P2.issue_write === false && R.P.P2.add_issue_comment === false ? 'PASS' : 'FAIL';
    R.P.P3 = { bridge: p1, list: { github_issue_read: ro(t.issue_read), github_list_issues: ro(t.list_issues) },
      verdict: p1.github_issue_read === ro(t.issue_read) && p1.github_list_issues === ro(t.list_issues) ? 'PASS' : 'FAIL' };
  }
  const stdoutAfterList = stdoutDuring.join('').length;

  // P5
  const fails = {};
  fails.unknownServer = await settle(() => listServerTools({ configPaths: [stubCfg('three', 'p5a').p], server: 'nope_f88', timeout: 3000, confirmServer: () => true }));
  const badCmd = join(dir, 'bad.json'); writeFileSync(badCmd, JSON.stringify({ mcpServers: { bad: { command: join(dir, 'no-such-cmd-f88'), args: [] } } }));
  fails.badCommand = await settle(() => listServerTools({ configPaths: [badCmd], server: 'bad', timeout: 3000, confirmServer: () => true }));
  fails.stubExits = await settle(() => listServerTools({ configPaths: [stubCfg('exit', 'p5c').p], server: 'stub', timeout: 3000, confirmServer: () => true }));
  R.P.P5 = Object.fromEntries(Object.entries(fails).map(([k, v]) => [k, { threw: !v.resolved, err: v.err, ms: v.ms, resolvedValue: v.resolved ? v.value : undefined }]));
  R.P.P5.uncaughtExceptions = uncaught.slice();
  R.P.P5.verdict = Object.values(fails).every(v => !v.resolved && v.err.message !== 'HARNESS-BOUND') && !uncaught.length ? 'PASS' : 'FAIL';

  // P6
  const gate = {};
  for (const [k, fn] of [['false', () => false], ['truthyNonTrue', () => 1], ['throws', () => { throw new Error('no'); }]]) {
    const c = stubCfg('three', 'p6' + k); const r = await settle(() => listServerTools({ configPaths: [c.p], server: 'stub', confirmServer: fn, timeout: 3000 }));
    gate[k] = { threw: !r.resolved, err: r.err?.message?.slice(0, 120), markerExists: existsSync(c.marker) };
  }
  const cOk = stubCfg('three', 'p6ok'); const rOk = await settle(() => listServerTools({ configPaths: [cOk.p], server: 'stub', confirmServer: () => true, timeout: 3000 }));
  gate.trueControl = { resolved: rOk.resolved, markerExists: existsSync(cOk.marker) };
  R.P.P6 = { ...gate, verdict: ['false', 'truthyNonTrue', 'throws'].every(k => gate[k].threw && !gate[k].markerExists) && gate.trueControl.resolved && gate.trueControl.markerExists ? 'PASS' : 'FAIL' };

  // P7
  const d1 = await settle(() => listServerTools({ configPaths: [ghCfg()], server: 'github', confirmServer: () => true, timeout: 1 }), 20000);
  const sc = stubCfg('silent', 'p7'); const d2 = await settle(() => listServerTools({ configPaths: [sc.p], server: 'stub', confirmServer: () => true, timeout: 500 }), 5000);
  R.P.P7 = { realTimeout1: { threw: !d1.resolved, ms: d1.ms, err: d1.err }, stubSilent500: { threw: !d2.resolved, ms: d2.ms, err: d2.err, tools_list_requests: cnt(sc.count) } };
  const lbl = (e) => e && (e.name === 'TimeoutError' || /timed out/i.test(e.message));
  R.P.P7.verdict = !d1.resolved && d1.ms < 20000 && lbl(d1.err) && !d2.resolved && d2.ms < 5000 && lbl(d2.err) ? 'PASS' : 'FAIL';
  R.P.P7.note = 'per-round-trip timeout trips first in both cases; the total 4x deadline is not exercised'; R.P.P7.deadlineBoundLabel = { real: d1.err?.context?.bound ?? null, stub: d2.err?.context?.bound ?? null };

  // P9
  const c9 = stubCfg('three', 'p9'); const r9 = await settle(() => W(() => listServerTools({ configPaths: [c9.p], server: 'stub', confirmServer: () => true, timeout: 3000 })));
  const L9 = r9.value || [];
  R.P.P9 = { names: L9.map(x => x.name), alphaAnn: L9[0]?.annotations, betaHasKey: L9[1] ? hasKey(L9[1]) : null, gammaHasKey: L9[2] ? hasKey(L9[2]) : null, requests: cnt(c9.count) };
  R.P.P9.verdict = L9.length === 3 && L9.map(x => x.name).join() === 'alpha,beta,gamma' && L9[0].annotations?.readOnlyHint === true && !hasKey(L9[1]) && !hasKey(L9[2]) && R.P.P9.requests === 3 ? 'PASS' : 'FAIL';

  // P10
  const c10 = stubCfg('three', 'p10');
  const bA = await W(() => createMCPBridge({ configPaths: [c10.p], timeout: 5000, callTimeout: 5000, allow: { stub: ['gamma'] } }));
  const A = { names: bA.tools.map(t => t.name), missing: bA.missing }; await W(() => bA.close());
  const bB = await W(() => createMCPBridge({ configPaths: [stubCfg('three', 'p10b').p], timeout: 5000, callTimeout: 5000, allow: { stub: ['gamma', 'nope'] } }));
  const B = { names: bB.tools.map(t => t.name), missing: bB.missing }; await W(() => bB.close());
  const cwd0 = process.cwd(); process.chdir(dir);
  const bC = await createMCPBridge({ configPaths: [stubCfg('three', 'p10c').p], timeout: 5000, callTimeout: 5000 });
  const C = { names: bC.tools.map(t => t.name).sort(), betaHasKey: hasKey(bC.tools.find(t => t.name === 'stub_beta') || {}), gammaHasKey: hasKey(bC.tools.find(t => t.name === 'stub_gamma') || {}), alphaAnn: bC.tools.find(t => t.name === 'stub_alpha')?.annotations }; await bC.close(); process.chdir(cwd0);
  R.P.P10 = { allowGamma: A, allowGammaNope: B, noAllow: C };
  R.P.P10.verdict = A.names.join() === 'stub_gamma' && A.missing.length === 0 && B.names.join() === 'stub_gamma' && B.missing.length === 1 && B.missing[0].tool === 'nope'
    && C.names.join() === 'stub_alpha,stub_beta,stub_gamma' && !C.betaHasKey && !C.gammaHasKey && C.alphaAnn?.readOnlyHint === true ? 'PASS' : 'FAIL';

  // P11
  const ce = stubCfg('endless', 'p11e'); const re = await settle(() => listServerTools({ configPaths: [ce.p], server: 'stub', confirmServer: () => true, timeout: 20000 }), 60000);
  const cl = stubCfg('loop', 'p11l'); const rl = await settle(() => listServerTools({ configPaths: [cl.p], server: 'stub', confirmServer: () => true, timeout: 5000 }));
  const cb = stubCfg('endless', 'p11b'); let bridgeEndless;
  try { const bE = await W(() => createMCPBridge({ configPaths: [cb.p], timeout: 20000, callTimeout: 5000 })); bridgeEndless = { rejected: false, tools: bE.tools.length, errors: bE.errors }; await W(() => bE.close()); } catch (e) { bridgeEndless = { rejected: true, err: errShape(e) }; }
  R.P.P11 = { endless: { threw: !re.resolved, err: re.err, requests: cnt(ce.count), ms: re.ms }, loop: { threw: !rl.resolved, err: rl.err, requests: cnt(cl.count) }, bridgeEndless: { ...bridgeEndless, requests: cnt(cb.count) } };
  R.P.P11.verdict = !re.resolved && cnt(ce.count) === 100 && /cap/i.test(re.err.message) && !rl.resolved && /repeat/i.test(rl.err.message) && cnt(cl.count) === 2 ? 'PASS' : 'FAIL';

  await new Promise(r => setTimeout(r, 2500));
  // P4
  const after = probe.map(stat);
  const files = readdirSync(dir).filter(f => !/^(gh-|stub-|count-|marker-|bad\.json|stub\.mjs|\.mcp-bridge\.json$)/.test(f));
  R.P.P4 = { probed: probe.map((p, i) => ({ where: ['cwd', 'HOME', 'script dir'][i], before: before[i] !== null, after: after[i] !== null, mtimeChanged: before[i] !== after[i] })), unexpectedFilesInMkdtemp: files, note: 'the no-allow bridge of P10 ran with cwd=mkdtemp and unwatched; its .mcp-bridge.json cache is excluded here by design',
    stdoutBytesDuringListAndBridge: stdoutDuring.join('').length, stdoutBytesDuringRealList: stdoutAfterList };
  R.P.P4.verdict = R.P.P4.probed.every(p => !p.mtimeChanged && p.before === p.after) && !files.length && R.P.P4.stdoutBytesDuringListAndBridge === 0 ? 'PASS' : 'FAIL';
  R.P.P8 = { containersLeft: dockerPs(), processesLeft: procsLeft() };
  R.P.P8.verdict = R.P.P8.containersLeft === '' && R.P.P8.processesLeft === 0 ? 'PASS' : 'FAIL';
} catch (e) {
  R.fatal = errShape(e);
} finally {
  try { if (b) await W(() => b.close()); } catch {}
  clearTimeout(dl);
}
R.stderrBytes = stderrAll.join('').length;
const scan = (s) => s.includes(TOKEN);
const files = existsSync(dir) ? readdirSync(dir) : [];
const inFiles = files.filter(f => scan(readFileSync(join(dir, f), 'utf8')));
R.P.P12 = { filesScanned: files.length, tokenInFiles: inFiles.length, tokenInStdoutCapture: stdoutDuring.some(scan), tokenInStderrCapture: stderrAll.some(scan), tokenInResultObject: scan(JSON.stringify(R)) };
R.P.P12.verdict = !R.P.P12.tokenInFiles && !R.P.P12.tokenInStdoutCapture && !R.P.P12.tokenInStderrCapture && !R.P.P12.tokenInResultObject ? 'PASS' : 'FAIL';
rmSync(dir, { recursive: true, force: true });
R.P.P13 = { mkdtempRemoved: !existsSync(dir), containersLeft: dockerPs(), processesLeft: procsLeft() };
R.P.P13.verdict = R.P.P13.mkdtempRemoved && R.P.P13.containersLeft === '' && R.P.P13.processesLeft === 0 ? 'PASS' : 'FAIL';
const out = JSON.stringify(R, null, 2);
process.stdout.write = so; process.stderr.write = se;
if (scan(out)) { console.error('TOKEN IN RESULT, refusing to write'); process.exit(4); }
writeFileSync(OUT, out + '\n', { flag: 'wx' });
process.stdout.write(out + '\n');
