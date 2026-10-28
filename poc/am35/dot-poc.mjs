// M4d am35 POC ($0): on the REAL panel, does the page's 10 s Inbox read fail when node is dead, and succeed again after a restart?
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { launchChrome } from '../../scripts/panel-fixtures/cdp.mjs';

const PORT = 4791;
const home = mkdtempSync(path.join(tmpdir(), 'fwd-am35-'));
const root = path.join(home, 'flows'); mkdirSync(root);
const bin = new URL('../../bin/fwdloop', import.meta.url).pathname;
const startPanel = () => spawn(process.execPath, [bin, 'panel', '--root', root, '--port', String(PORT)], { env: { ...process.env, HOME: home }, stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const up = async () => { for (let i = 0; i < 50; i++) { try { await fetch(`http://127.0.0.1:${PORT}/api/inbox`); return true; } catch { await sleep(200); } } return false; };

let panel = startPanel();
const chrome = await launchChrome();
const out = {};
try {
  out.panelUp = await up();
  await chrome.open(`http://127.0.0.1:${PORT}/`, 1280);
  await chrome.ev(`(function(){ window.__log = []; var real = window.fetch; window.fetch = function(u){ var p = real.apply(this, arguments);
    if(String(u) === "/api/inbox") p.then(function(r){ __log.push({t: Date.now(), ok: true, status: r.status}); }, function(e){ __log.push({t: Date.now(), ok: false, err: String(e)}); });
    return p; }; return true; })()`);
  await sleep(11000);
  out.whileUp = await chrome.ev('JSON.stringify(__log.slice(-1))');
  const killedAt = Date.now(); panel.kill('SIGKILL'); await sleep(11000);
  out.afterKill = JSON.parse(await chrome.ev('JSON.stringify(__log.filter(function(x){ return x.t > ' + killedAt + '; }))'));
  out.firstFailMsAfterKill = (out.afterKill.find((x) => !x.ok) || {}).t - killedAt;
  panel = startPanel(); out.restarted = await up(); const backAt = Date.now(); await sleep(11000);
  out.afterRestart = JSON.parse(await chrome.ev('JSON.stringify(__log.filter(function(x){ return x.t > ' + backAt + '; }))'));
  out.tickStillRunning = out.afterRestart.length > 0;
} finally {
  try { panel.kill('SIGKILL'); } catch {}
  await chrome.close(); rmSync(home, { recursive: true, force: true });
}
console.log(JSON.stringify(out, null, 1));
const pass = out.panelUp && out.afterKill.some((x) => !x.ok) && out.firstFailMsAfterKill <= 10500 && out.afterRestart.some((x) => x.ok);
console.log(pass ? 'POC PASS' : 'POC FAIL'); process.exit(pass ? 0 : 1);
