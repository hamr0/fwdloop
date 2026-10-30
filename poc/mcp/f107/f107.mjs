// F107: barebrowse feat/mcp-tiers-site-lock through the M12 bridge. $0, NO model calls. See docs/logs/FINDINGS.md F107 pre-registration.
import { createMCPBridge } from 'bare-agent/mcp';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileSync, mkdirSync } from 'node:fs';
import { spawn } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const SCRATCH = process.env.F107_SCRATCH;
const SERVER = join(SCRATCH, 'bb027', 'mcp-server.js');
const out = join(here, 'out');
mkdirSync(out, { recursive: true });
const ISSUE = 'https://codeberg.org/forgejo/forgejo/issues/1';
const ALL = ['browse','goto','snapshot','readable','click','type','press','scroll','back','forward','drag','upload','pdf','reload','screenshot','wait_for','tabs','select','hover','switch_engine','capabilities','eval','assess'];
const text = (r) => typeof r === 'string' ? r : JSON.stringify(r);
const save = (n, v) => writeFileSync(join(out, n), typeof v === 'string' ? v : JSON.stringify(v, null, 2));
const first = (s) => String(s ?? '').split('\n')[0];

let n = 0;
function cfg(env) {
  const p = join(SCRATCH, `mcp-f107-${++n}.json`);
  writeFileSync(p, JSON.stringify({ mcpServers: { barebrowse: { command: 'node', args: [SERVER], env: { BAREBROWSE_MODE: 'headless', BAREBROWSE_IDLE_MINUTES: '3', ...env } } } }, null, 2));
  return p;
}
const open = (env, allow) => createMCPBridge({ configPaths: [cfg(env)], timeout: 60000, callTimeout: 90000, confirmServer: () => true, allow: { barebrowse: allow } });
const R = { env: { TIER_R: { BAREBROWSE_TIER: 'r', BAREBROWSE_ALLOW: 'codeberg.org,*.codeberg.org' } } };
const E = R.env.TIER_R;

// raw stdio client (no bridge), for what the server itself answers
function raw(env, calls) {
  return new Promise((resolve) => {
    const p = spawn('node', [SERVER], { env: { ...process.env, BAREBROWSE_MODE: 'headless', BAREBROWSE_IDLE_MINUTES: '3', ...env }, stdio: ['pipe', 'pipe', 'pipe'] });
    let buf = '', err = ''; const msgs = [];
    p.stdout.on('data', (d) => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i); buf = buf.slice(i + 1); try { msgs.push(JSON.parse(l)); } catch {} } });
    p.stderr.on('data', (d) => { err += d; });
    const send = (o) => p.stdin.write(JSON.stringify(o) + '\n');
    p.on('exit', (code) => resolve({ exit: code, stderr: err.slice(0, 500), msgs }));
    send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'f107', version: '0' } } });
    setTimeout(() => {
      send({ jsonrpc: '2.0', method: 'notifications/initialized' });
      send({ jsonrpc: '2.0', id: 2, method: 'tools/list' });
      calls.forEach((c, i) => send({ jsonrpc: '2.0', id: 10 + i, method: 'tools/call', params: c }));
    }, 800);
    setTimeout(() => { p.kill(); }, 6000);
  });
}

const res = {};
// (a) + (b)
{
  const A = await open(E, ALL);
  const tools = A.tools.map((t) => ({ name: t.name, annotations: t.annotations ?? null }));
  const refused = [];
  for (const t of A.tools) if (t.annotations?.readOnlyHint !== true) refused.push(t.name); // exact expression of src/ticket-mcp.js:44
  res.a = { errors: A.errors, missing: A.missing, listed: tools.length, tools, allReadOnlyTrue: tools.length > 0 && tools.every((t) => t.annotations?.readOnlyHint === true) };
  res.b = { refused };
  save('a-tools.json', res.a);
  console.log('A', tools.map((t) => t.name).join(' '), 'errors', A.errors.length, 'missing', JSON.stringify(A.missing), 'allRO', res.a.allReadOnlyTrue, 'b refused', JSON.stringify(refused));
  res.d2 = { clickListed: A.tools.some((t) => t.name === 'barebrowse_click'), clickInMissing: JSON.stringify(A.missing).includes('click') };
  await A.close();
}
// (c) + (d3) + (e1) + (e3)
{
  const B = await open(E, ['browse']);
  const names = B.tools.map((t) => t.name);
  const exec = (nm, a) => B.tools.find((t) => t.name === `barebrowse_${nm}`).execute(a);
  let body = '', err = null;
  try { body = text(await exec('browse', { url: ISSUE, pruneMode: 'data' })); } catch (e) { err = String(e.message).slice(0, 300); }
  save('c-browse-data.txt', body || err);
  res.c = { err, len: body.length, body1: body.includes('set the timeout to 2h'), body2: body.includes('ci.codeberg.org') };
  console.log('C', JSON.stringify(res.c));
  let r1 = '', e1 = null;
  try { r1 = text(await exec('browse', { url: 'https://example.com' })); } catch (e) { e1 = String(e.message).slice(0, 400); }
  save('e1-example.txt', r1 || e1);
  res.e1 = { err: e1, reply: r1.slice(0, 300), namesHost: (e1 || r1).includes('example.com'), gotContent: r1.includes('Example Domain') };
  console.log('E1', JSON.stringify(res.e1));
  await B.close();
  const B2 = await open(E, ['capabilities']);
  let cap = '';
  try { cap = text(await B2.tools[0].execute({})); } catch (e) { cap = 'ERR ' + e.message; }
  save('e3-capabilities.txt', cap);
  await B2.close();
  res.e3 = { hasTier: /"?tier"?\W+r\b|tier\W+r\b/i.test(cap), hasAllow: cap.includes('codeberg.org') && cap.includes('*.codeberg.org') };
  console.log('E3', JSON.stringify(res.e3), cap.slice(0, 400));
  const B3 = await open(E, ['browse']);
  const inv = B3.metaTools?.find((m) => m.name === 'mcp_invoke');
  const tries = {};
  for (const bad of ['goto', 'click']) {
    try { const r = await inv.execute({ name: `barebrowse_${bad}`, args: { url: 'https://codeberg.org/' } }); tries[bad] = { refused: false, reply: text(r).slice(0, 200) }; }
    catch (e) { tries[bad] = { refused: true, denied: e.context?.denied === true, msg: String(e.message).slice(0, 200) }; }
  }
  const n3 = B3.tools.map((t) => t.name);
  res.d3 = { names: n3, exact: n3.length === 1 && n3[0] === 'barebrowse_browse', missing: B3.missing, tries };
  console.log('D3', JSON.stringify(res.d3));
  await B3.close();
}
// (d1) raw at r, and control at rw
{
  const r = await raw({ BAREBROWSE_TIER: 'r' }, [{ name: 'click', arguments: { ref: '1' } }, { name: 'goto', arguments: { url: 'https://codeberg.org/' } }]);
  const list = r.msgs.find((m) => m.id === 2)?.result?.tools?.map((t) => t.name) ?? null;
  const clickReply = r.msgs.find((m) => m.id === 10);
  res.d1 = { list, hasClick: list?.some((x) => ['click','type','press','select','drag','hover','switch_engine','upload','eval'].includes(x)), clickReply };
  const w = await raw({ BAREBROWSE_TIER: 'rw' }, []);
  const wl = w.msgs.find((m) => m.id === 2)?.result?.tools?.map((t) => t.name) ?? null;
  res.d_control = { listsClickAtRw: !!wl?.includes('click'), list: wl };
  save('d-raw.json', { r1: { ...r, msgs: undefined, clickReply, list }, control: res.d_control });
  console.log('D1', JSON.stringify({ hasClick: res.d1.hasClick, clickReply }), 'control', JSON.stringify(res.d_control.listsClickAtRw));
}
// (e2) redirects
for (const [label, host, url] of [['codeberg', 'www.codeberg.org', 'https://www.codeberg.org/'], ['github', 'www.github.com', 'https://www.github.com/']]) {
  const B = await open({ BAREBROWSE_TIER: 'r', BAREBROWSE_ALLOW: host }, ['browse']);
  let rep = '', err = null;
  try { rep = text(await B.tools[0].execute({ url, pruneMode: 'data' })); } catch (e) { err = String(e.message).slice(0, 400); }
  save(`e2-${label}.txt`, rep || err);
  res[`e2_${label}`] = { err, reply: rep.slice(0, 300), refused: !!err, namesTarget: (err || rep).includes(label === 'codeberg' ? 'codeberg.org' : 'github.com') };
  console.log('E2', label, JSON.stringify(res[`e2_${label}`]));
  await B.close();
}
// (f) fail closed
res.f = {};
for (const [label, env] of [['tier-rx', { BAREBROWSE_TIER: 'rx' }], ['allow-scheme', { BAREBROWSE_ALLOW: 'https://codeberg.org' }], ['allow-space', { BAREBROWSE_ALLOW: 'a b' }]]) {
  const B = await open(env, ALL);
  const direct = await raw(env, []);
  res.f[label] = { bridgeErrors: B.errors.map((e) => ({ server: e.server, error: first(e.error) })), bridgeTools: B.tools.map((t) => t.name), directExit: direct.exit, directStderr: first(direct.stderr), directListed: !!direct.msgs.find((m) => m.id === 2) };
  console.log('F', label, JSON.stringify(res.f[label]));
  await B.close();
}
{ // control default
  const B = await open({}, ALL);
  res.f_control = { errors: B.errors, listed: B.tools.length, missing: B.missing };
  console.log('F control', JSON.stringify(res.f_control));
  await B.close();
}
save('result.json', res);
console.log('done');
