// Test helper (never imported by src/): a headless chromium driven over the DevTools protocol, so a test can click the real panel.
// `launchChrome()` resolves null when no chromium is installed (the caller skips). `close()` kills the process by PID.
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../tmp-track.mjs';

const BINS = ['/usr/bin/chromium-browser', '/usr/bin/chromium', '/usr/bin/google-chrome'];

export async function launchChrome() {
  const bin = BINS.find((b) => existsSync(b));
  if (!bin) return null;
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-cdp-'));
  const child = spawn(bin, ['--headless=new', '--no-sandbox', '--disable-gpu', '--remote-debugging-port=0', `--user-data-dir=${dir}`, 'about:blank'], { stdio: 'ignore' });
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
      await new Promise((r) => setTimeout(r, 800));
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
