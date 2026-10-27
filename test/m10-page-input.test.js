// M10 item 1 - a web page as an input. Local http server + fake barebrowse connect: no internet, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchPageText, CONNECT_OPTIONS, barebrowseNewEnough, MIN_PAGE_CHARS, pageContentChars,
} from '../src/pagefetch.js';
import { startPageServer, fakeConnect, pageText } from './fixtures/m10-page-server.mjs';

// timeoutMs is the whole-fetch deadline: generous here so a loaded machine can't fire it in the success-path tests; only the deadline test sets a short one
const FAST = { idleMs: 5, idleTimeoutMs: 40, timeoutMs: 10000, closeWaitMs: 50 };

test('a normal page comes back as its text, read once, browser closed, with the private options', async () => {
  const srv = await startPageServer({ '/ok': { body: pageText() } });
  try {
    const fc = fakeConnect();
    const r = await fetchPageText(`${srv.base}/ok`, { connect: fc.connect, ...FAST });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.text, pageText());
    assert.deepEqual(fc.calls.connect, [{ incognito: true, blockPrivateNetwork: true }]);
    assert.equal(fc.calls.goto.length, 1);
    assert.equal(fc.calls.closed, 1);
  } finally { await srv.close(); }
});

test('an empty page stops with a plain reason, and nothing is asked of a model', async () => {
  const srv = await startPageServer({ '/empty': { body: '' }, '/tiny': { body: 'Loading...' } });
  try {
    const e = await fetchPageText(`${srv.base}/empty`, { connect: fakeConnect().connect, ...FAST });
    assert.equal(e.ok, false);
    assert.match(!e.ok ? e.error : '', /no text/);
    const t = await fetchPageText(`${srv.base}/tiny`, { connect: fakeConnect().connect, ...FAST });
    assert.match(!t.ok ? t.error : '', new RegExp(`only 10 characters.*less than ${MIN_PAGE_CHARS}`));
  } finally { await srv.close(); }
});

test('a page that never goes quiet is read as it stands at the cap (bareloop): real content is kept, near-empty stops with the reason', async () => {
  const srv = await startPageServer({ '/busy': { body: pageText() }, '/busy-empty': { body: 'Loading...' } });
  try {
    const fc = fakeConnect({ idle: 'reject' });
    const r = await fetchPageText(`${srv.base}/busy`, { connect: fc.connect, ...FAST });
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.text, pageText());
    assert.equal(fc.calls.snapshot, 1);
    assert.equal(fc.calls.closed, 1);
    const e = await fetchPageText(`${srv.base}/busy-empty`, { connect: fakeConnect({ idle: 'reject' }).connect, ...FAST });
    assert.equal(e.ok, false);
    assert.match(!e.ok ? e.error : '', /only 10 characters/);
  } finally { await srv.close(); }
});

test('a browser that never answers is cut by our own deadline', async () => {
  const srv = await startPageServer({ '/busy': { body: pageText() } });
  try {
    const t0 = Date.now();
    const r = await fetchPageText(`${srv.base}/busy`, { connect: fakeConnect({ idle: 'hang' }).connect, ...FAST, timeoutMs: 80 });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /no answer inside/);
    assert.ok(Date.now() - t0 < 2000);
  } finally { await srv.close(); }
});

test('a site that blocks us is recorded as it is, read once, never worked around', async () => {
  const srv = await startPageServer({
    '/bot': { body: `${pageText()}\n[BOT CHALLENGE DETECTED]\n` },
    '/denied': { status: 403, body: 'Access denied' },
  });
  try {
    const fc = fakeConnect();
    const r = await fetchPageText(`${srv.base}/bot`, { connect: fc.connect, ...FAST });
    assert.equal(r.ok, false);
    assert.match(!r.ok ? r.error : '', /bot challenge/);
    assert.equal(fc.calls.connect.length, 1, 'one try, no retry');
    assert.equal(fc.calls.goto.length, 1);
    const fd = fakeConnect();
    const d = await fetchPageText(`${srv.base}/denied`, { connect: fd.connect, ...FAST });
    assert.equal(d.ok, false);
    assert.equal(fd.calls.connect.length, 1);
  } finally { await srv.close(); }
});

test('an address with a password, a secret shape, or not http is refused before any browser starts', async () => {
  const fc = fakeConnect();
  for (const u of ['http://user:pw@127.0.0.1/x', 'https://x.test/?k=sk-abcdefghijklmnopqrstuvwxyz', 'file:///etc/passwd', 'nope']) {
    const r = await fetchPageText(u, { connect: fc.connect, ...FAST });
    assert.equal(r.ok, false, u);
  }
  assert.equal(fc.calls.connect.length, 0);
});

test('barebrowse older than 0.26.0 is refused (it would drop incognito and the private-network guard in silence, or give goto no status)', () => {
  assert.equal(barebrowseNewEnough('0.5.9'), false);
  assert.equal(barebrowseNewEnough('0.20.9'), false);
  assert.equal(barebrowseNewEnough('0.21.0'), false);
  assert.equal(barebrowseNewEnough('0.24.0'), false);
  assert.equal(barebrowseNewEnough('0.24.1'), false);
  assert.equal(barebrowseNewEnough('0.25.9'), false);
  assert.equal(barebrowseNewEnough('0.26.0'), true);
  assert.equal(barebrowseNewEnough('0.26.1'), true);
  assert.equal(barebrowseNewEnough('1.0.0'), true);
});

test('pageContentChars counts a 50000-character line of "[a=[a=..." (no closing bracket) in linear time, and still drops a real tag', () => {
  const t0 = performance.now();
  assert.equal(pageContentChars('[a='.repeat(16666)), 49998);
  assert.equal(pageContentChars('- text [ref=12] more'), 'text more'.length);
  assert.ok(performance.now() - t0 < 1000, `took ${performance.now() - t0} ms`);
});

// M10 am13 - the status comes from goto's typed result, never from the page text
/** @param {() => Promise<any>} gotoFn */
function connectWithGoto(gotoFn) {
  return async () => ({
    goto: gotoFn,
    waitForNetworkIdle: async () => {},
    snapshot: async () => pageText(),
    close: async () => {},
  });
}
const U = 'https://example.test/x';

test('M10 am13: an error status refuses the page by name, whatever its text says', async () => {
  for (const status of [404, 500, 301, 199, 300]) {
    const r = await fetchPageText(U, { connect: connectWithGoto(async () => ({ url: U, status })), ...FAST });
    assert.deepEqual(r, { ok: false, error: `${U} came back as an error page (HTTP ${status}), so there is nothing to read` });
  }
});

test('M10 am13: a 2xx status passes through to the existing floors', async () => {
  const r = await fetchPageText(U, { connect: connectWithGoto(async () => ({ url: U, status: 200 })), ...FAST });
  assert.equal(r.ok, true);
  const t = await fetchPageText(U, { connect: async () => ({ goto: async () => ({ url: U, status: 204 }), waitForNetworkIdle: async () => {}, snapshot: async () => 'Loading...', close: async () => {} }), ...FAST });
  assert.match(!t.ok ? t.error : '', /only 10 characters/);
});

test('M10 am13: no usable status (undefined, status 0, not an object) refuses with the no-status words', async () => {
  const words = `${U} did not say whether it loaded (no HTTP status), so it is not read`;
  for (const res of [undefined, null, 'ok', { url: U, status: 0 }, { url: U }, { url: U, status: NaN }, { url: U, status: '200' }]) {
    const r = await fetchPageText(U, { connect: connectWithGoto(async () => res), ...FAST });
    assert.deepEqual(r, { ok: false, error: words }, JSON.stringify(res));
  }
});

test('M10 am13: the status is decided before the page is read', async () => {
  let snaps = 0;
  const r = await fetchPageText(U, { connect: async () => ({ goto: async () => ({ url: U, status: 404 }), waitForNetworkIdle: async () => {}, snapshot: async () => { snaps += 1; return pageText(); }, close: async () => {} }), ...FAST });
  assert.equal(r.ok, false);
  assert.equal(snaps, 0);
});
