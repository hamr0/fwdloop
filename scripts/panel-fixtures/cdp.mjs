// Test helper (never imported by src/): a headless chromium driven over the DevTools protocol, so a test can click the real panel.
// `launchChrome()` resolves null when no chromium is installed (the caller skips). `close()` kills the process by PID.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../tmp-track.mjs';

const BINS = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };

/** Pids whose command line carries this exact --user-data-dir (so only OUR chromium is ever killed, never a reused pid). */
function chromiumsOf(dir) {
  const out = [];
  let pids = [];
  try { pids = readdirSync('/proc').filter((n) => /^\d+$/.test(n)); } catch { return out; }
  for (const n of pids) {
    // chromium rewrites its own title, so the args may be space- not NUL-separated: match the flag with a boundary after it.
    try { if ((readFileSync(`/proc/${n}/cmdline`, 'utf8') + '\0').match(/--user-data-dir=([^\0 ]*)/)?.[1] === dir) out.push(Number(n)); } catch { /* gone */ }
  }
  return out;
}

/**
 * Remove profile dirs (and the chromium on them) whose owner process is dead: a killed or crashed test/walk never ran its cleanup.
 * A dir with a live owner is never touched. A dir with no owner file is a pre-sweep leftover or a launch in progress: removed only
 * once it is older than `graceMs` AND no chromium still runs on it (its owner is unknown, so it may be live). Returns the dirs removed.
 */
export function sweepOrphans(root = tmpdir(), graceMs = 120000) {
  const removed = [];
  for (const name of readdirSync(root)) {
    if (!name.startsWith('fwdloop-cdp-')) continue;
    const dir = path.join(root, name);
    try {
      let owner = 0;
      try { owner = Number(readFileSync(path.join(dir, 'owner.pid'), 'utf8').trim()); } catch { /* none */ }
      if (owner ? alive(owner) : Date.now() - statSync(dir).mtimeMs < graceMs) continue;
      const pids = chromiumsOf(dir);
      if (!owner && pids.length) continue;
      for (const pid of pids) { try { process.kill(pid, 'SIGKILL'); } catch { /* gone */ } }
      rmSync(dir, { recursive: true, force: true });
      removed.push(dir);
    } catch { /* best effort */ }
  }
  return removed;
}

export async function launchChrome() {
  const bin = BINS.find((b) => existsSync(b));
  if (!bin) return null;
  sweepOrphans();
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-cdp-'));
  writeFileSync(path.join(dir, 'owner.pid'), String(process.pid));
  const child = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
  process.on('exit', () => { try { child.kill('SIGKILL'); } catch { /* gone */ } });
  const portFile = path.join(dir, 'DevToolsActivePort');
  let port = 0;
  for (let i = 0; i < 100 && !port; i += 1) {
    await new Promise((r) => setTimeout(r, 100));
    if (existsSync(portFile)) port = Number(readFileSync(portFile, 'utf8').split('\n')[0]);
  }
  if (!port) { child.kill('SIGKILL'); return null; }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
  const ws = new WebSocket(list.webSocketDebuggerUrl);
  await new Promise((r) => ws.addEventListener('open', r));
  let id = 0;
  const pend = new Map();
  ws.addEventListener('message', (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) pend.get(d.id)(d.result ?? d.error); });
  const send = (method, params = {}) => new Promise((r) => { id += 1; pend.set(id, r); ws.send(JSON.stringify({ id, method, params })); });
  return {
    send,
    /** Evaluate an expression in the page; the value comes back by value (promises are awaited). */
    ev: async (expr) => (await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })).result?.value,
    /** @param {string} url @param {number} width */
    async open(url, width = 1280) {
      await send('Emulation.setDeviceMetricsOverride', { width, height: 900, deviceScaleFactor: 1, mobile: width < 600 });
      await send('Page.navigate', { url });
      // Wait for the real event, not a fixed sleep: the document is this url's and fully loaded (its inline script has attached the
      // click listeners). Under load 800 ms is not enough and an early click is silently lost. Generous deadline; callers assert after.
      await this.waitFor(`location.href.startsWith(${JSON.stringify(url.split('#')[0])}) && document.readyState === 'complete'`, 30000);
    },
    async waitFor(expr, ms = 8000) {
      const end = Date.now() + ms;
      for (;;) {
        if (await this.ev(expr)) return true;
        if (Date.now() > end) return false;
        await new Promise((r) => setTimeout(r, 100));
      }
    },
    async screenshot(file) {
      const s = await send('Page.captureScreenshot', { format: 'png' });
      (await import('node:fs')).writeFileSync(file, Buffer.from(s.data, 'base64'));
    },
    close() { try { ws.close(); } catch { /* gone */ } child.kill('SIGKILL'); },
  };
}
