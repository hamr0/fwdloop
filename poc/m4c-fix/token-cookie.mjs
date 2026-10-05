// POC m4c-fix item 2: token file + printed link + HttpOnly SameSite=Strict cookie, against the REAL
// `bin/fwdloop panel` and a REAL headless chromium. Exit 1 on any mismatch.
// Riskiest assumption: link ?t= -> cookie -> redirect -> page loads -> the page's own POSTs still
// pass the gates with NO x-fwdloop-token header (the cookie replaces it; Origin check stays).
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync, statSync, readFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const tmp = mkdtempSync(join(tmpdir(), 'm4cfix-poc-'));
const root = join(tmp, 'root'); mkdirSync(root);
const xdg = join(tmp, 'xdg'); mkdirSync(xdg, { mode: 0o700 });
const PORT = 4851;
const rows = [];
const add = (name, ok, note = '') => rows.push({ name, ok, note });
const kids = [];

let link = null;
try {
  const panel = spawn(process.execPath, [join(repo, 'bin', 'fwdloop'), 'panel', '--root', root, '--port', String(PORT)], {
    env: { ...process.env, XDG_RUNTIME_DIR: xdg }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  kids.push(panel);
  let out = '';
  panel.stdout.on('data', (c) => { out += c; });
  panel.stderr.on('data', (c) => { out += c; });
  for (let i = 0; i < 100 && !link; i += 1) { await sleep(50); link = /http:\/\/127\.0\.0\.1:\d+\/\?t=[0-9a-f]+/.exec(out)?.[0] ?? null; }
  add('panel prints a ?t= link', link !== null, out.trim().replace(/t=[0-9a-f]+/, 't=<hidden>'));
  if (!link) throw new Error('no link');
  const tokenFile = join(xdg, 'fwdloop', `panel-${PORT}.token`);
  let mode = null; let fileTok = null;
  try { mode = (statSync(tokenFile).mode & 0o777).toString(8); fileTok = readFileSync(tokenFile, 'utf8').trim(); } catch { /* red below */ }
  add('token file mode 0600', mode === '600', `mode=${mode}`);
  add('token file dir mode 0700', (statSync(join(xdg, 'fwdloop')).mode & 0o777) === 0o700);
  const token = link.split('t=')[1];
  add('file token == link token', fileTok === token);

  const noCookie = await fetch(`http://127.0.0.1:${PORT}/`);
  const body = await noCookie.text();
  add('curl / without cookie -> 403, no token in body', noCookie.status === 403 && !body.includes(token), `status=${noCookie.status}`);
  const wrong = await fetch(`http://127.0.0.1:${PORT}/?t=${'0'.repeat(64)}`, { redirect: 'manual' });
  add('wrong ?t= -> 403, no cookie', wrong.status === 403 && !wrong.headers.get('set-cookie'), `status=${wrong.status}`);
  const good = await fetch(link, { redirect: 'manual' });
  const sc = good.headers.get('set-cookie') ?? '';
  add('good link -> 302 to / with HttpOnly; SameSite=Strict cookie', good.status === 302 && good.headers.get('location') === '/' && /HttpOnly/i.test(sc) && /SameSite=Strict/i.test(sc), `status=${good.status} loc=${good.headers.get('location')}`);

  // real browser
  const dbg = 9300 + Math.floor(Math.random() * 500);
  const ud = join(tmp, 'chrome');
  const chrome = spawn('chromium-browser', ['--headless=new', '--no-sandbox', '--disable-gpu', `--remote-debugging-port=${dbg}`, `--user-data-dir=${ud}`, 'about:blank'], { stdio: 'ignore' });
  kids.push(chrome);
  let tabs = null;
  for (let i = 0; i < 100 && !tabs; i += 1) { await sleep(100); try { tabs = await (await fetch(`http://127.0.0.1:${dbg}/json`)).json(); } catch { /* wait */ } }
  const ws = new WebSocket(tabs.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await new Promise((r) => { ws.onopen = r; });
  let id = 0; const pend = new Map();
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
  const cdp = (method, params = {}) => new Promise((r) => { id += 1; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  const ev = async (expr) => (await cdp('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true })).result.result.value;
  await cdp('Page.enable');
  await cdp('Page.navigate', { url: link });
  await sleep(2500);
  const state = JSON.parse(await ev('JSON.stringify({path: location.pathname, search: location.search, cookie: document.cookie, hasTok: document.documentElement.outerHTML.includes("' + token + '"), title: document.title, bodyLen: document.body.innerText.length})'));
  add('browser lands on / with no ?t=', state.path === '/' && state.search === '', JSON.stringify(state));
  add('cookie is HttpOnly (invisible to page JS)', state.cookie === '');
  add('served page carries no token', state.hasTok === false);
  add('page rendered', state.bodyLen > 20, `title=${state.title}`);
  const r1 = JSON.parse(await ev(`fetch('/api/runs').then(async r=>JSON.stringify({s:r.status}))`));
  add('page GET /api/runs with cookie -> 200', r1.s === 200, JSON.stringify(r1));
  const r2 = JSON.parse(await ev(`fetch('/api/answer',{method:'POST',headers:{'content-type':'application/json'},body:'{}'}).then(async r=>JSON.stringify({s:r.status,b:await r.json()}))`));
  add('page POST /api/answer (no token header) passes gates -> 400 askid-required', r2.s === 400 && r2.b.refused === 'askid-required', JSON.stringify(r2));
  const r3 = await fetch(`http://127.0.0.1:${PORT}/api/answer`, { method: 'POST', headers: { origin: `http://127.0.0.1:${PORT}`, 'content-type': 'application/json' }, body: '{}' });
  add('same POST without cookie -> 403', r3.status === 403, `status=${r3.status}`);
  ws.close();
} catch (e) {
  add('poc crashed', false, String(e.stack ?? e));
} finally {
  for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } }
  await sleep(300);
  rmSync(tmp, { recursive: true, force: true });
}
for (const r of rows) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.note ? `  — ${r.note}` : ''}`);
process.exit(rows.every((r) => r.ok) ? 0 : 1);
