// F222b harness: true case of barebrowse 0.30.0 botBlocked, through fwd's real fetchPageText.
import http from 'node:http';
import { connect } from 'barebrowse';
import { fetchPageText } from '../../src/pagefetch.js';

const PORT = 8791;
const CHALLENGE = `<!doctype html><html><head><title>Just a moment...</title></head><body>
<h1>Checking if the site connection is secure</h1>
<p>Enable JavaScript and cookies to continue</p></body></html>`;
const prose = Array.from({ length: 6 }, (_, i) => `<p>Paragraph ${i + 1}. The harbour town keeps a market on Saturdays where growers bring apples, pears and honey, and the baker sells bread from a cart beside the old stone bridge across the river.</p>`).join('\n');
const NORMAL = `<!doctype html><html><head><title>Harbour notes</title></head><body><main><h1>Harbour notes</h1>${prose}</main></body></html>`;
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(req.url === '/normal' ? NORMAL : CHALLENGE);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

const PAGES = {
  R: { url: 'https://nowsecure.nl/', local: false },
  L: { url: `http://127.0.0.1:${PORT}/challenge`, local: true },
  L0: { url: `http://127.0.0.1:${PORT}/normal`, local: true },
};
const MARKER = /\[BOT CHALLENGE DETECTED[\] ]/;
const out = {};
try {
  for (const [k, { url, local }] of Object.entries(PAGES)) {
    const rec = { url, snapshots: 0, privateNetworkBlockDropped: local };
    const wrapped = async (opts) => {
      const page = await connect(local ? { ...opts, blockPrivateNetwork: false } : opts);
      const orig = page.snapshot.bind(page);
      page.snapshot = async (...a) => {
        const t = await orig(...a);
        rec.snapshots++;
        rec.botBlocked = page.botBlocked;
        rec.marker = typeof t === 'string' && MARKER.test(t);
        rec.len = typeof t === 'string' ? t.length : null;
        return t;
      };
      return page;
    };
    const t0 = Date.now();
    const r = await fetchPageText(url, { connect: wrapped });
    rec.ms = Date.now() - t0;
    rec.fwd = r.ok ? { ok: true, len: r.text.length } : { ok: false, error: r.error };
    out[k] = rec;
    console.error(k, JSON.stringify(rec));
  }
} finally {
  await new Promise((r) => server.close(r));
}
console.log(JSON.stringify(out, null, 2));
