// F222 harness: fwd's real fetchPageText with a recording wrapper around barebrowse 0.30.0's real connect.
import { connect } from 'barebrowse';
import { fetchPageText } from '../../src/pagefetch.js';

const PAGES = {
  N: 'https://en.wikipedia.org/wiki/Amsterdam',
  B1: 'https://www.walmart.com/search?q=laptop',
  B2: 'https://www.target.com/s?searchTerm=laptop',
  I: 'https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/iframe',
};
const MARKER = /\[BOT CHALLENGE DETECTED[\] ]/;
const out = {};
for (const [k, url] of Object.entries(PAGES)) {
  const rec = { url, snapshots: 0 };
  const wrapped = async (opts) => {
    const page = await connect(opts);
    const orig = page.snapshot.bind(page);
    // record only; the page's behaviour is unchanged (same args, same return)
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
console.log(JSON.stringify(out, null, 2));
