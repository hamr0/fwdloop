// M4d piece 4 (docs/wiki/the-module-ladder.md, "M4d", scope items 2-3; negatives (i) (ii) (ix) (xi) (xiii) (xiv) and the
// page half of (xv)). $0, no network: `fetch` is injected, and every test's config home is a tracked mkdtemp dir (the
// real ~/.config/fwdloop is never touched). Each test goes red with its one src change taken out.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import http from 'node:http';
import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { createPanelServer } from '../src/panel/server.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { keysFilePath } from '../src/keysfile.js';
import { configPath } from '../src/config.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE = readFileSync(path.join(HERE, '..', 'src', 'panel', 'index.html'), 'utf8');
const CANARY = 'canary-key-m4d-p4-9f8e7d6c5b4a39281706';
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4d4-${p}-`));

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));

/** A config home with a 0600 keys file holding the canary, plus a recording fake fetch. */
async function setup({ keys = `DEEPSEEK_API_KEY=${CANARY}\n`, config, fetchImpl } = {}) {
  const home = path.join(tmp('home'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  if (keys !== null) writeFileSync(keysFilePath(home), keys, { mode: 0o600 });
  if (config !== undefined) writeFileSync(configPath(home), typeof config === 'string' ? config : JSON.stringify(config));
  const calls = [];
  const fake = fetchImpl ?? (async (url, opts) => ({ ok: true, status: 200, json: async () => ({ data: [] }), url, opts }));
  const root = tmp('root');
  const h = remember(await createPanelServer({
    port: 0, root, settings: { home, env: {}, fetch: async (url, opts) => { calls.push({ url: String(url), method: opts?.method, headers: opts?.headers }); return fake(url, opts); } },
  }));
  HANDLES.push(h);
  return { h, home, root, calls };
}

function rq(port, {
  method = 'GET', url = '/', headers = {}, body,
} = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const hd = { host: `127.0.0.1:${port}`, ...cookieHeader(port), ...headers };
    if (method === 'POST' && hd.origin === undefined) hd.origin = `http://127.0.0.1:${port}`;
    if (hd.origin === null) delete hd.origin;
    if (data !== undefined) hd['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: hd, agent: false }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        resolve({ status: res.statusCode, text, json() { try { return JSON.parse(text); } catch { return null; } } });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
const post = (port, url, body, headers) => rq(port, { method: 'POST', url, body, headers });

/** Every file under `dir` with its bytes — a before/after snapshot. */
function snapshot(dir) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d).sort()) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else out[path.relative(dir, f)] = readFileSync(f, 'utf8');
    }
  };
  walk(dir);
  return out;
}

// ---- (i) / (ii) the canary key --------------------------------------------------------------------------------------
test('(i)(ii) a canary key in the keys file is in no settings response and not on the page; a keys-writing POST is refused and the file is byte-identical', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 5 } });
  const keysBefore = readFileSync(keysFilePath(home), 'utf8');
  const bodies = [];
  for (const [method, url, body] of [
    ['GET', '/api/settings/providers'], ['GET', '/api/settings/money'], ['GET', '/api/settings/balance?slot=deepseek'],
    ['POST', '/api/settings/test', { slot: 'deepseek' }], ['POST', '/api/settings/test', { slot: 'synthetic' }],
    ['POST', '/api/settings/price', { slot: 'deepseek', inPerM: 0.5 }], ['POST', '/api/settings/money', { monthlyLimitUsd: 7 }],
    ['POST', '/api/settings/keys', { DEEPSEEK_API_KEY: 'x' }], ['POST', '/api/settings/keys', { name: 'DEEPSEEK_API_KEY', value: CANARY }],
    ['POST', '/api/settings/providers', { slot: 'deepseek' }], ['PUT', '/api/settings/keys', {}],
  ]) {
    const r = await rq(h.port, { method, url, body });
    bodies.push(r.text);
  }
  const page = await rq(h.port, { url: '/' });
  assert.equal(page.status, 200);
  for (const t of [...bodies, page.text]) assert.ok(!t.includes(CANARY), 'the canary key is in no response body or page');
  // the status is shown by name only
  const prov = (await rq(h.port, { url: '/api/settings/providers' })).json();
  assert.equal(prov.rows.find((r) => r.slot === 'deepseek').keyStatus, 'set in file');
  assert.equal(prov.rows.find((r) => r.slot === 'synthetic').keyStatus, 'not set');
  for (const url of ['/api/settings/keys', '/api/settings/keys/DEEPSEEK_API_KEY', '/api/settings/reload', '/api/settings/']) {
    const r = await post(h.port, url, { value: 'x' });
    assert.equal(r.status, 404, url);
    assert.equal(r.json().ok, false);
    assert.match(r.json().say, /typed into your keys file by hand/);
  }
  assert.equal(readFileSync(keysFilePath(home), 'utf8'), keysBefore, 'the keys file is byte-identical');
});

test('(i) the 1A refusal is shown as a plain sentence in the keys strip data, and a refused file marks every row "refused"', async () => {
  const { h, home } = await setup();
  chmodSync(keysFilePath(home), 0o644);
  const prov = (await rq(h.port, { url: '/api/settings/providers' })).json();
  assert.match(prov.keysFile.refusal, /can be read by other users\. Run: chmod 600/);
  assert.ok(prov.rows.every((r) => r.keyStatus === 'refused'));
  assert.ok(!JSON.stringify(prov).includes(CANARY));
  const t = (await post(h.port, '/api/settings/test', { slot: 'deepseek' })).json();
  assert.equal(t.ok, false);
  assert.match(t.why, /chmod 600/);
  chmodSync(keysFilePath(home), 0o600);
  const again = (await rq(h.port, { url: '/api/settings/providers' })).json();
  assert.equal(again.keysFile.refusal, null, 'Reload keys = ask again; the file is re-read each call');
});

// ---- (ix) Test and Balance -------------------------------------------------------------------------------------------
test('(ix) Test and Balance GET only the models / balance URLs with the key in the header only; no completion, no spend row', async () => {
  const fetchImpl = async (url) => (String(url).endsWith('/user/balance')
    ? { ok: true, status: 200, json: async () => ({ balance_infos: [{ currency: 'USD', total_balance: '12.34' }] }) }
    : { ok: true, status: 200, json: async () => ({ data: [{ id: 'deepseek-flash' }] }) });
  const { h, home, root, calls } = await setup({ fetchImpl });
  const homeBefore = snapshot(home);
  const rootBefore = snapshot(root);
  const t = (await post(h.port, '/api/settings/test', { slot: 'deepseek' })).json();
  assert.equal(t.ok, true);
  assert.ok(Number.isInteger(t.ms) && t.ms >= 0);
  const b = (await rq(h.port, { url: '/api/settings/balance?slot=deepseek' })).json();
  assert.deepEqual(b, { ok: true, balances: [{ currency: 'USD', total: '12.34' }] });
  assert.deepEqual(calls.map((c) => [c.method, c.url]), [['GET', 'https://api.deepseek.com/models'], ['GET', 'https://api.deepseek.com/user/balance']]);
  for (const c of calls) {
    assert.doesNotMatch(c.url, /completion|chat|messages/);
    assert.equal(c.headers.Authorization, `Bearer ${CANARY}`, 'the key travels in the header only');
    assert.ok(!c.url.includes(CANARY));
  }
  assert.deepEqual(snapshot(home), homeBefore, 'no file under the config home changed (no spend row, no hold)');
  assert.deepEqual(snapshot(root), rootBefore, 'no file under the root changed');
  assert.ok(!existsSync(path.join(home, 'runs.jsonl')));
  // synthetic Test: its own models URL; a provider without a balance call says so
  await post(h.port, '/api/settings/test', { slot: 'synthetic' });
  assert.equal(calls.length, 2, 'a slot with no key never reaches the network');
  assert.deepEqual((await rq(h.port, { url: '/api/settings/balance?slot=synthetic' })).json(), { ok: false, why: 'Not offered by this provider.' });
  assert.equal(calls.length, 2);
});

test('(ix) Test says why in plain sentences: no key, refused key, timeout-shaped, unreachable — never a code or the key', async () => {
  const modes = {
    refused: async () => ({ ok: false, status: 401, json: async () => ({}) }),
    error: async () => ({ ok: false, status: 503, json: async () => ({}) }),
    down: async () => { throw new TypeError(`fetch failed ${CANARY}`); },
    abort: async (url, opts) => new Promise((_, rej) => { opts.signal.addEventListener('abort', () => rej(Object.assign(new Error('x'), { name: 'AbortError' }))); }),
  };
  const run = async (mode) => { const { h } = await setup({ fetchImpl: modes[mode] }); return (await post(h.port, '/api/settings/test', { slot: 'deepseek' })).json(); };
  assert.equal((await run('refused')).why, 'The provider refused the key.');
  assert.equal((await run('error')).why, 'The provider answered with an error.');
  const down = await run('down');
  assert.equal(down.why, 'Could not reach the provider.');
  assert.ok(!JSON.stringify(down).includes(CANARY));
  const nokey = await setup({ keys: '# nothing\n' });
  assert.deepEqual((await post(nokey.h.port, '/api/settings/test', { slot: 'deepseek' })).json(), { ok: false, why: 'No key set for this provider.' });
  assert.deepEqual((await post(nokey.h.port, '/api/settings/test', { slot: 'nope' })).json().ok, false);
  // the 4 s deadline: an unanswered fetch is abandoned (checked with a short real wait on a fake that honours the abort signal)
  const t0 = Date.now();
  const slow = await run('abort');
  assert.equal(slow.why, 'The provider did not answer in 4 seconds.');
  assert.ok(Date.now() - t0 >= 3900 && Date.now() - t0 < 6000, `answered after ${Date.now() - t0} ms`);
});

// ---- (xi) price and limit validation ---------------------------------------------------------------------------------
test('(xi) a bad price (0, -1, text, NaN, a mix) is refused naming the field and NOTHING is saved; null clears; a valid one saves', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 9, prices: { deepseek: { inPerM: 0.4 } } } });
  const file = configPath(home);
  const before = readFileSync(file, 'utf8');
  const bad = [
    [{ slot: 'deepseek', inPerM: 0 }, /Input price/], [{ slot: 'deepseek', outPerM: -1 }, /Output price/],
    [{ slot: 'deepseek', cachedInPerM: 'abc' }, /Cached input price/], [{ slot: 'deepseek', inPerM: '0.5' }, /Input price/],
    [{ slot: 'deepseek', inPerM: 1, outPerM: 0 }, /Output price/], [{ slot: 'deepseek', inPerM: 1, cachedInPerM: -0.1, outPerM: 2 }, /Cached input price/],
    [{ slot: 'deepseek', inPerM: [1] }, /Input price/], [{ slot: 'deepseek' }, /Nothing to save/], [{ slot: 'nope', inPerM: 1 }, /not known/],
  ];
  for (const [body, re] of bad) {
    const r = await post(h.port, '/api/settings/price', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json().say, re);
    assert.equal(readFileSync(file, 'utf8'), before, `config.json unchanged after ${JSON.stringify(body)}`);
  }
  const nan = await post(h.port, '/api/settings/price', '{"slot":"deepseek","inPerM":NaN}');
  assert.equal(nan.status, 400);
  assert.equal(readFileSync(file, 'utf8'), before);
  const inf = await post(h.port, '/api/settings/price', '{"slot":"deepseek","inPerM":1e999}'); // parses to Infinity
  assert.equal(inf.status, 400);
  assert.equal(readFileSync(file, 'utf8'), before);
  const ok = await post(h.port, '/api/settings/price', { slot: 'deepseek', outPerM: 1.5, cachedInPerM: 0.01 });
  assert.equal(ok.json().ok, true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).prices.deepseek, { inPerM: 0.4, outPerM: 1.5, cachedInPerM: 0.01 });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).monthlyLimitUsd, 9, 'other settings are kept');
  const prov = (await rq(h.port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === 'deepseek');
  assert.deepEqual(prov.price.outPerM, { value: 1.5, source: 'settings' });
  await post(h.port, '/api/settings/price', { slot: 'deepseek', inPerM: null, cachedInPerM: null, outPerM: null });
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).prices, undefined, 'null clears back to the table default');
  const back = (await rq(h.port, { url: '/api/settings/providers' })).json().rows.find((r) => r.slot === 'deepseek');
  assert.equal(back.price.inPerM.source, 'table');
  assert.equal(back.price.cachedInPerM.value, 0.006);
});

test('(xi) the monthly limit: 0, negative, text refused and nothing saved; empty/null clears; a number saves', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 5 } });
  const file = configPath(home);
  const before = readFileSync(file, 'utf8');
  for (const body of [{ monthlyLimitUsd: 0 }, { monthlyLimitUsd: -3 }, { monthlyLimitUsd: 'abc' }, { monthlyLimitUsd: '5' }, {}, { other: 1 }]) {
    const r = await post(h.port, '/api/settings/money', body);
    assert.equal(r.status, 400, JSON.stringify(body));
    assert.match(r.json().say, /Nothing was saved/);
    assert.equal(readFileSync(file, 'utf8'), before);
  }
  assert.equal((await post(h.port, '/api/settings/money', '{"monthlyLimitUsd":NaN}')).status, 400);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal((await post(h.port, '/api/settings/money', { monthlyLimitUsd: 12.5 })).json().monthlyLimitUsd, 12.5);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).monthlyLimitUsd, 12.5);
  assert.equal((await rq(h.port, { url: '/api/settings/money' })).json().monthlyLimitUsd, 12.5);
  assert.equal((await post(h.port, '/api/settings/money', { monthlyLimitUsd: '' })).json().monthlyLimitUsd, null);
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).monthlyLimitUsd, undefined);
  assert.equal((await rq(h.port, { url: '/api/settings/money' })).json().monthlyLimitUsd, null);
});

test('a broken config.json is a plain sentence on GET and a refusal on POST — never "no limit", never a path', async () => {
  const { h, home } = await setup({ config: '{ not json' });
  const m = (await rq(h.port, { url: '/api/settings/money' })).json();
  assert.match(m.configProblem, /cannot be read/);
  assert.ok(!m.configProblem.includes(home), 'no path in the sentence');
  const p = (await rq(h.port, { url: '/api/settings/providers' })).json();
  assert.match(p.configProblem, /cannot be read/);
  const r = await post(h.port, '/api/settings/money', { monthlyLimitUsd: 3 });
  assert.equal(r.status, 400);
  assert.match(r.json().say, /Nothing was saved/);
  assert.equal(readFileSync(configPath(home), 'utf8'), '{ not json');
});

// ---- (xiii) unknown cost ---------------------------------------------------------------------------------------------
test('(xiii) money route: an unknown-cost spend row gives atLeast true (never 0), the breakdown too, and the page renders the ≥ prefix', async () => {
  const { h, home } = await setup();
  const runDir = tmp('rundir');
  writeFileSync(path.join(runDir, 'spend.jsonl'), `${JSON.stringify({
    provider: 'deepseek', costUsd: null, spendComplete: false, calls: 1, rounds: 0, price: { inPerM: 1, cachedInPerM: 0.1, outPerM: 4 }, at: new Date().toISOString(),
  })}\n`);
  writeFileSync(path.join(home, 'runs.jsonl'), `${JSON.stringify({ kind: 'hold', holdId: 'h1', what: 'run', flow: 'f', runId: 'r', runDir, pid: 1, holdUsd: 1, spentAtHold: 0, at: new Date().toISOString() })}\n`);
  const m = (await rq(h.port, { url: '/api/settings/money' })).json();
  assert.equal(m.month.atLeast, true);
  assert.equal(m.total.atLeast, true);
  assert.ok(m.month.usd > 0, 'priced at its ceiling, never 0');
  assert.equal(m.byProvider.deepseek.month.atLeast, true);
  assert.equal(m.preM4dRunsNotCounted, true);
  const fmt = new Function(`${fnSrc('fmtUsd')}\nreturn fmtUsd;`)();
  assert.equal(fmt(m.month.usd, m.month.atLeast), `≥$${m.month.usd.toFixed(4)}`);
  assert.equal(fmt(0.5, false), '$0.5000');
  assert.equal(fmt(undefined, true), 'unknown', 'a missing figure is never rendered as $0');
  const mins = new Function(`${fnSrc('fmtMinutes')}\nreturn fmtMinutes;`)();
  assert.equal(mins(2, true), '≥2.0 min');
  assert.equal(mins(null, true), 'not recorded');
  // the page paints every money figure and the breakdown through fmtUsd/fmtMinutes with the server's atLeast flags
  assert.match(PAGE, /fmtUsd\(m\.usd, m\.atLeast\)/);
  assert.match(PAGE, /fmtUsd\(t\.usd, t\.atLeast\)/);
  assert.match(PAGE, /fmtUsd\(p\.month\.usd, p\.month\.atLeast\)/);
  assert.match(PAGE, /fmtUsd\(p\.total\.usd, p\.total\.atLeast\)/);
});

/** Cut `function name(` .. its closing "\n  }" out of the page. */
function fnSrc(name) {
  const start = PAGE.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found in index.html`);
  return PAGE.slice(start, PAGE.indexOf('\n  }', start) + 4);
}

// ---- (xiv) no flow, no cap -------------------------------------------------------------------------------------------
test('(xiv) no settings route reads or writes a flow: a flow dir is byte-identical across every settings POST', async () => {
  const { h, root } = await setup();
  const flow = path.join(root, 'myflow');
  mkdirSync(path.join(flow, 'runs', 'r1'), { recursive: true });
  writeFileSync(path.join(flow, 'declaration.json'), '{"cap":{"maxUsd":0.5}}');
  writeFileSync(path.join(flow, 'runs', 'r1', 'spend.jsonl'), '{"costUsd":0.01}\n');
  const before = snapshot(root);
  for (const [url, body] of [
    ['/api/settings/test', { slot: 'deepseek' }], ['/api/settings/price', { slot: 'deepseek', inPerM: 0.7 }], ['/api/settings/money', { monthlyLimitUsd: 3 }],
    ['/api/settings/price', { slot: 'deepseek', inPerM: 0 }], ['/api/settings/keys', {}], ['/api/settings/flows', { flow: 'myflow', cap: 99 }],
    ['/api/settings/money', { monthlyLimitUsd: 3, flow: 'myflow', maxUsd: 99, cap: 99 }],
  ]) await post(h.port, url, body);
  assert.deepEqual(snapshot(root), before);
  // and the source: the settings module has no flow/cap vocabulary and no fs of its own
  const src = readFileSync(path.join(HERE, '..', 'src', 'panel', 'settings.js'), 'utf8').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(src, /declaration|signature|maxUsd|readFlow|writeFlow|resolveFlowDir|from 'node:fs'/);
});

// ---- gates -----------------------------------------------------------------------------------------------------------
test('gates: settings routes need the cookie and the own Host; a POST needs the own Origin and a small body', async () => {
  const { h, home } = await setup({ config: { monthlyLimitUsd: 5 } });
  const file = configPath(home);
  const before = readFileSync(file, 'utf8');
  for (const url of ['/api/settings/providers', '/api/settings/money', '/api/settings/balance?slot=deepseek']) {
    assert.equal((await rq(h.port, { url, headers: { cookie: '' } })).status, 403, `${url} without the cookie`);
    assert.equal((await rq(h.port, { url, headers: { host: 'evil.example' } })).status, 403, `${url} with a foreign Host`);
  }
  for (const url of ['/api/settings/test', '/api/settings/price', '/api/settings/money', '/api/settings/keys']) {
    const body = { slot: 'deepseek', inPerM: 9, monthlyLimitUsd: 99 };
    assert.equal((await post(h.port, url, body, { cookie: '' })).status, 403, `${url} without the cookie`);
    assert.equal((await post(h.port, url, body, { origin: null })).status, 403, `${url} without Origin`);
    assert.equal((await post(h.port, url, body, { origin: 'http://evil.example' })).status, 403, `${url} with a foreign Origin`);
  }
  const big = await post(h.port, '/api/settings/money', JSON.stringify({ monthlyLimitUsd: 9, pad: 'x'.repeat(9000) }));
  assert.equal(big.status, 413);
  assert.equal((await post(h.port, '/api/settings/money', 'not json')).status, 400);
  assert.equal(readFileSync(file, 'utf8'), before, 'no refused request changed config.json');
  assert.equal((await rq(h.port, { url: '/api/settings/money' })).status, 200, 'with every gate met it is served');
});

test('Settings reads and writes only under the injected config home; with no home under a test process it is switched off', async () => {
  const home = path.join(tmp('only'), 'fwdloop');
  const h = remember(await createPanelServer({ port: 0, root: tmp('r2'), settings: { home, env: {} } }));
  HANDLES.push(h);
  await post(h.port, '/api/settings/money', { monthlyLimitUsd: 4 });
  assert.equal(JSON.parse(readFileSync(configPath(home), 'utf8')).monthlyLimitUsd, 4);
  const saved = process.env.FWDLOOP_CONFIG_HOME;
  delete process.env.FWDLOOP_CONFIG_HOME;
  try {
    const off = remember(await createPanelServer({ port: 0, root: tmp('r3') }));
    HANDLES.push(off);
    const r = await rq(off.port, { url: '/api/settings/money' });
    assert.equal(r.status, 404);
    assert.equal(r.json().refused, 'settings-unavailable');
  } finally { if (saved !== undefined) process.env.FWDLOOP_CONFIG_HOME = saved; }
});

// ---- the page: source-level checks (layout borrowed from bareloop 5a5a811: one table, a money strip) -----------------------
const SETTINGS_VIEW = PAGE.slice(PAGE.indexOf('id="settings-view"'), PAGE.indexOf('id="main-view"'));
const th = (html) => [...html.matchAll(/<th>([^<]*)<\/th>/g)].map((m) => m[1]);

test('page: the Settings button, header, tabs and signed sentences; no per-run cap, no key input, no Save button, no card markup', () => {
  assert.match(PAGE, /data-testid="settings-open">&#9881; Settings</);
  assert.match(PAGE, /id="settings-back"[^>]*>&larr; Back</);
  // header: Back, then the title right beside it, framed by the CSS pips (not pushed right)
  assert.match(SETTINGS_VIEW, /<div class="settings-header">\s*<button[^>]*id="settings-back"[^>]*>&larr; Back<\/button>\s*<h2>Settings<\/h2>/);
  assert.match(PAGE, /\.settings-header\{display:flex;align-items:center;gap:12px;/);
  assert.doesNotMatch(PAGE, /\.settings-header\{[^}]*justify-content:space-between/);
  assert.match(PAGE, /\.settings-header h2::before\{content:"┤ ";/);
  assert.match(PAGE, /\.settings-header h2::after\{content:" ├";/);
  assert.match(PAGE, /id="stab-providers"[^>]*>Providers</);
  assert.match(PAGE, /id="stab-money"[^>]*>Money &amp; limits</);
  // the KEYS strip: legend, the sentence, the path as a code chip, Reload keys on the right
  assert.match(PAGE, /\.keyfile-strip::before\{content:"┤ KEYS ├";/);
  assert.match(PAGE, /\.keyfile-strip code\{[^}]*color:var\(--amber\)/);
  assert.match(SETTINGS_VIEW, /Put <code>NAME=key<\/code> lines in <code id="keys-path"[^>]*>~\/\.config\/fwdloop\/\.env<\/code>, then Reload keys[^<]*keys never reach this page\./);
  assert.match(SETTINGS_VIEW, /<div class="keyfile-strip-actions">\s*<button[^>]*id="reload-keys"[^>]*>Reload keys</);
  // the hint lines
  assert.match(SETTINGS_VIEW, /Test asks the provider for its model list &mdash; it costs nothing\. A price left empty uses the default; a typed price applies from the next model call on\./);
  assert.match(SETTINGS_VIEW, /Limits are yours\. The agent can never change them\. A run whose cap is more than what is left this month does not start\./);
  assert.match(PAGE, /Runs from before Settings existed are not counted here\./);
  assert.match(PAGE, /saved — applies from the next model call/);
  assert.match(PAGE, /not offered by this provider/);
  // only the monthly limit is a static input; the price boxes are built per row; no Save button, no cap, no key input
  assert.deepEqual([...SETTINGS_VIEW.matchAll(/<input[^>]*id="([^"]+)"/g)].map((m) => m[1]), ['ml-money']);
  assert.doesNotMatch(SETTINGS_VIEW.replace(/<!--[\s\S]*?-->/g, ''), /\bcap\b(?! is more)|maxUsd|type="password"|>Save</i);
  assert.doesNotMatch(PAGE, /prov-card|break-card|set-card|set-strip|set-prices|money-grid|limit-save|price-save|set-limit/);
});

test('page: Providers is ONE table, columns in bareloop order then the three signed price columns; Name/shape/URL are show-only', () => {
  const tables = [...SETTINGS_VIEW.matchAll(/<table[\s\S]*?<\/table>/g)].map((m) => m[0]);
  assert.equal(tables.length, 2, 'the provider table and the breakdown table, no cards');
  assert.deepEqual(th(tables[0]), ['Key', 'Name', 'API shape', 'Base URL', 'Test', 'Tokens used', 'Balance', 'In $/1M', 'Cached in $/1M', 'Out $/1M']);
  assert.match(tables[0], /<table class="pv-table"/);
  assert.match(SETTINGS_VIEW, /<div class="table-wrap"[^>]*>\s*<table class="pv-table"/);
  // the row builder: model, shape and URL cells hold plain text, never an input or select (ruling 2A)
  const build = PAGE.slice(PAGE.indexOf('function buildProviderRow('), PAGE.indexOf('var STATUS_WORD'));
  assert.ok(build.includes("'<td data-f=\"model\"></td>'") && build.includes("'<td data-f=\"addr\"></td>'") && build.includes("'<td>' + escapeXml(API_SHAPE) + '</td>'"));
  assert.doesNotMatch(build, /<select|data-f="model"><input|data-f="addr"><input|API_SHAPE\) \+ '<input/);
  // exactly one input source in a row: the price loop (3 fields), saved on change, with a hint line under each
  assert.equal((build.match(/<input/g) || []).length, 1);
  assert.match(build, /PRICE_FIELDS\.map\(function\(f\)/);
  assert.match(PAGE, /var PRICE_FIELDS = \["inPerM", "cachedInPerM", "outPerM"\];/);
  assert.match(PAGE, /pvRows\.addEventListener\("change"/);
  assert.match(build, /class="hint pv-msg"/);
  // the Test cell has one fixed width; the wrap scrolls inside its own box
  assert.match(PAGE, /\.pv-table td\.pv-test-cell\{width:180px;min-width:180px;max-width:180px;\}/);
  assert.match(PAGE, /\.table-wrap\{overflow-x:auto;/);
  // Balance stays a click (signed "read on a click"): the render never calls the balance route
  const paint = PAGE.slice(PAGE.indexOf('function paintProviders('), PAGE.indexOf('pvRows.addEventListener("click"'));
  assert.doesNotMatch(paint, /\/api\/settings\/balance|runBalance/);
});

/** paintMoney run against a tiny fake DOM, with the page's own helpers cut out of index.html. */
function runPaintMoney(d, { activeIsLimit = false } = {}) {
  const el = () => ({ textContent: '', innerHTML: '', value: 'untouched', className: '', _a: {}, getAttribute(k) { return this._a[k] ?? null; }, setAttribute(k, v) { this._a[k] = v; } });
  const els = { 'ml-usd': el(), 'ml-tokens': el(), 'ml-extra': el(), 'ml-msg': el(), 'ml-breakdown': el() };
  const mlLimit = el();
  const document = { getElementById: (id) => els[id], activeElement: activeIsLimit ? mlLimit : null };
  const src = ['escapeXml', 'fmtUsd', 'fmtMinutes', 'tokensText', 'setNote', 'breakMinutes', 'paintMoney'].map(fnSrc).join('\n');
  new Function('document', 'mlLimit', `${src}\npaintMoney(${JSON.stringify(d)});`)(document, mlLimit);
  return { els, mlLimit };
}
const bucket = (usd, tokens, minutes = null, atLeast = false) => ({ usd, atLeast, tokens, modelMinutes: minutes, modelMinutesAtLeast: minutes === null || atLeast });

test('page: the Money tab is a strip plus a breakdown TABLE; plurals; "0 min" only for a period with no spend', () => {
  assert.deepEqual(th(SETTINGS_VIEW.slice(SETTINGS_VIEW.indexOf('provider-breakdown-table'))), ['Provider', '$ month / to date', 'minutes month / to date', 'tokens']);
  assert.match(SETTINGS_VIEW, /<h4[^>]*>Per-provider breakdown<\/h4>\s*<div class="table-wrap">\s*<table data-testid="provider-breakdown-table">/);
  assert.match(SETTINGS_VIEW, /<label>\$ month \/ to date<\/label>/);
  assert.match(SETTINGS_VIEW, /<label>Tokens month \/ to date<\/label>/);
  assert.match(SETTINGS_VIEW, /<label for="ml-money">Monthly money limit \(\$\)<\/label>\s*<input id="ml-money" type="text"[^>]*placeholder="blank = no limit"/);
  assert.match(PAGE, /\.money-strip\{display:grid;grid-template-columns:repeat\(3, 1fr\);/);
  assert.match(PAGE, /@media \(max-width: 899px\)\{\s*\.money-strip\{grid-template-columns:1fr 1fr;\}/);
  const base = {
    month: bucket(0.5, 1200, 2), total: bucket(1.5, 4000, 5), monthlyLimitUsd: 3, undatedRows: 0, preM4dRunsNotCounted: true,
    byProvider: {
      deepseek: { label: 'deepseek', month: bucket(0.5, 1200, 2), total: bucket(1.5, 4000, 5) },
      synthetic: { label: 'synthetic', month: bucket(0, 0), total: bucket(0.2, 100) },
      other: { label: 'other', month: bucket(0.1, 50), total: bucket(0.1, 50) },
    },
  };
  base.byProvider.other.month.usd = 0.1;
  const one = runPaintMoney({ ...base, undatedRows: 1 }).els;
  assert.match(one['ml-extra'].textContent, /1 older spend row has no date; it counts in to date only\./);
  assert.doesNotMatch(one['ml-extra'].textContent, /rows have/);
  assert.match(runPaintMoney({ ...base, undatedRows: 3 }).els['ml-extra'].textContent, /3 older spend rows have no date; they count in to date only\./);
  assert.match(one['ml-extra'].textContent, /Runs from before Settings existed are not counted here\./);
  const rows = one['ml-breakdown'].innerHTML.match(/<tr[\s\S]*?<\/tr>/g);
  assert.equal(rows.length, 3, 'one table row per provider, no cards');
  assert.match(rows[0], /<td>deepseek<\/td><td>\$0\.5000 \/ \$1\.5000<\/td><td>2\.0 min \/ 5\.0 min<\/td><td>4\.0k<\/td>/);
  assert.match(rows[1], /<td>0 min \/ not recorded<\/td>/, 'no spend this month reads 0 min; spend with no minutes to date reads not recorded');
  assert.match(rows[2], /not recorded \/ not recorded/, 'spend but no minutes is "not recorded", never 0 min');
  assert.equal(runPaintMoney(base).els['ml-usd'].textContent, '$0.5000 / $1.5000');
  assert.equal(runPaintMoney(base).els['ml-tokens'].textContent, '1.2k / 4.0k');
  const big = { ...base, month: bucket(0.5, 16800000, 2), total: bucket(1.5, 950, 5) };
  assert.equal(runPaintMoney(big).els['ml-tokens'].textContent, '16.8M / 950', 'bareloop tokensText: M, k and plain branches');
  // an unknown cost reads at-least, never $0; a typed limit box is not overwritten
  const unk = runPaintMoney({ ...base, month: { ...bucket(0.5, 1200, 2), atLeast: true } }).els;
  assert.equal(unk['ml-usd'].textContent, '≥$0.5000 / $1.5000');
  assert.equal(runPaintMoney(base, { activeIsLimit: true }).mlLimit.value, 'untouched');
  assert.equal(runPaintMoney(base).mlLimit.value, '3');
});

test('page: a typed price/limit box survives a repaint, the limit saves on change, and the tick does not touch Settings', () => {
  const js = PAGE.slice(PAGE.indexOf('M4d piece 4: Settings.'), PAGE.indexOf('// theme toggle'));
  assert.match(js, /getAttribute\("data-dirty"\) !== "1"\) inp\.value/);
  assert.match(js, /mlLimit\.getAttribute\("data-dirty"\) !== "1"\) mlLimit\.value/);
  assert.match(js, /mlLimit\.addEventListener\("change"/);
  assert.doesNotMatch(js, /\.cap\b|\bmaxUsd/i);
  assert.doesNotMatch(js.replace(/^\s*\/\/.*$/gm, ''), /\.(innerHTML|value)\s*=[^;]*(\.key\b|apiKey)/);
  assert.match(js, /borrowed-from: bareloop src\/panel\/index\.html@5a5a811/);
  const tick = PAGE.slice(PAGE.indexOf('function pageTick'), PAGE.indexOf('function pageTick') + 2500);
  assert.doesNotMatch(tick, /loadProviders|loadMoney|paintProviders|paintMoney/);
});

test('page: phone rules — wraps scroll in their own box, the strip collapses, inputs are 16px, nothing is wider than its box', () => {
  assert.match(PAGE, /\.settings-view input\[type=text\]\{[^}]*font-size:16px/);
  assert.match(PAGE, /\.keyfile-strip-main\{[^}]*min-width:0;overflow-wrap:anywhere;/);
  assert.match(PAGE, /\.pv-table \.pv-test-result,[^{]*\{white-space:normal;overflow-wrap:anywhere;\}/);
  assert.match(PAGE, /\.table-wrap\{overflow-x:auto;[^}]*max-width:100%;/);
  assert.match(PAGE, /name="viewport"/);
});
