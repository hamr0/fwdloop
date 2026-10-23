// M10 item 1 - a web page as an input. Local http server + fake barebrowse connect: no internet, $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  fetchPageText, CONNECT_OPTIONS, barebrowseNewEnough, MIN_PAGE_CHARS,
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

test('barebrowse older than 0.21.0 is refused (it would drop incognito and the private-network guard in silence)', () => {
  assert.equal(barebrowseNewEnough('0.5.9'), false);
  assert.equal(barebrowseNewEnough('0.20.9'), false);
  assert.equal(barebrowseNewEnough('0.21.0'), true);
  assert.equal(barebrowseNewEnough('0.23.0'), true);
  assert.equal(barebrowseNewEnough('1.0.0'), true);
});
