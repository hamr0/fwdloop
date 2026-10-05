// M4d piece 2 (docs/wiki/the-module-ladder.md, "M4d", scope item 6 and the price part of item 2; ruling A;
// negatives (x), (xi) back-end, (xii)): one price for every model call. $0, no network — the OpenAI network
// call is replaced by a scripted reply that reports usage (test/fixtures/m4d-fake-openai.mjs); everything
// after it (makeProvider's price lookup, Loop's rates, the booking, the spend row) is the real code.
// Every test builds its own config home under a tracked mkdtemp dir; the real ~/.config/fwdloop is never touched.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  writeFileSync, readFileSync, statSync, mkdirSync, readdirSync, existsSync, appendFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { Loop } from 'bare-agent';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import {
  readConfig, updateConfig, configPath, ConfigError,
} from '../src/config.js';
import {
  resolvePrices, makeProvider, ceilingCostUsd, RATES_BY_SUFFIX, readSpendRows, assertUnderGlobalCap, priceRecord,
} from '../src/provider.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { draft } from '../src/drafter.js';
import { summarizeSpendRows } from '../src/panel/data.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { install } from './fixtures/m4d-fake-openai.mjs';
import { job2Fixture } from './drafter-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const PRELOAD = path.join(HERE, 'fixtures', 'm4d-fake-openai-preload.mjs');
const FAKE_MODEL_STEP = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4dp2-${p}-`));
const KEY = 'test-key-not-a-secret-shape';

// The usage of POC (b)'s real DeepSeek cache-hit round (poc/m4d/RESULTS.md).
const POC_USAGE = { inputTokens: 225, cacheReadTokens: 2816, outputTokens: 22 };
const SET_PRICE = { inPerM: 1.0, cachedInPerM: 0.1, outPerM: 4.0 };
const U = { inputTokens: 100, cacheReadTokens: 1000, outputTokens: 50 };
const COST_TABLE_U = (100 * 0.30 + 1000 * 0.006 + 50 * 1.20) / 1e6; // 9.6e-5: deepseek-flash, code table
const COST_SET_U = (100 * 1.0 + 1000 * 0.1 + 50 * 4.0) / 1e6; // 4e-4: the SET_PRICE above

const newHome = () => path.join(tmp('home'), 'fwdloop');
/** Point the in-process price door at `home` for the duration of `fn` (NODE_ENV=test gate + the seam). */
async function withHome(home, fn) {
  const saved = { NODE_ENV: process.env.NODE_ENV, FWDLOOP_CONFIG_HOME: process.env.FWDLOOP_CONFIG_HOME };
  process.env.NODE_ENV = 'test';
  if (home === undefined) delete process.env.FWDLOOP_CONFIG_HOME; else process.env.FWDLOOP_CONFIG_HOME = home;
  try { return await fn(); } finally {
    for (const [k, v] of Object.entries(saved)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
}
const withFake = async (usage, fn) => { const restore = install(usage); try { return await fn(); } finally { restore(); } };
const spendPathIn = () => path.join(tmp('spend'), 'spend.jsonl');
const CTX = { goal: 'draft a thing', primitives: [], reads: {}, gap: null };
const liveStep = (spendPath) => makeLiveModelStep({ slot: 'deepseek', spendPath, env: { DEEPSEEK_API_KEY: KEY } });
const close = (a, b, eps = 1e-12) => assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);

// ---------------------------------------------------------------------------
// config.js
// ---------------------------------------------------------------------------

test('(xi) config: 0, negative, NaN, Infinity or text in any price field (or the limit) is a ConfigError naming slot+field, and the file is unchanged', () => {
  const home = newHome();
  updateConfig({ prices: { deepseek: { inPerM: 0.5 } }, monthlyLimitUsd: 10 }, { home });
  const before = readFileSync(configPath(home), 'utf8');
  for (const field of ['inPerM', 'cachedInPerM', 'outPerM']) {
    for (const bad of [0, -1, Number.NaN, Infinity, -Infinity, '0.5', '', true, [], {}]) {
      assert.throws(
        () => updateConfig({ prices: { deepseek: { [field]: bad } } }, { home }),
        (e) => e instanceof ConfigError && e.message.includes(`prices.deepseek.${field}`),
        `${field}=${String(bad)}`,
      );
    }
  }
  for (const bad of [0, -5, Number.NaN, Infinity, '9']) {
    assert.throws(() => updateConfig({ monthlyLimitUsd: bad }, { home }), (e) => e instanceof ConfigError && /monthlyLimitUsd/.test(e.message));
  }
  assert.throws(() => updateConfig({ prices: { deepseek: { bogusPerM: 1 } } }, { home }), /not a price field/);
  assert.equal(readFileSync(configPath(home), 'utf8'), before, 'a refusal writes nothing');
  assert.deepEqual(readdirSync(home).filter((f) => f.includes('.tmp')), [], 'no tmp litter');
});

test('config: a valid write is 0600, atomic (tmp + rename, no tmp left), round-trips, merges per slot and per field, null deletes', () => {
  const home = newHome();
  const w = updateConfig({ prices: { deepseek: { inPerM: 0.5, outPerM: 2 } }, monthlyLimitUsd: 12.5 }, { home });
  assert.deepEqual(w, readConfig({ home }));
  assert.equal(statSync(configPath(home)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(home), ['config.json']);
  updateConfig({ prices: { deepseek: { cachedInPerM: 0.05 }, synthetic: { inPerM: 1 } } }, { home });
  assert.deepEqual(readConfig({ home }).prices, { deepseek: { inPerM: 0.5, outPerM: 2, cachedInPerM: 0.05 }, synthetic: { inPerM: 1 } });
  updateConfig({ prices: { deepseek: { inPerM: null }, synthetic: null }, monthlyLimitUsd: null }, { home });
  assert.deepEqual(readConfig({ home }), { prices: { deepseek: { outPerM: 2, cachedInPerM: 0.05 } } });
});

test('config: a secret-shaped string anywhere is refused and nothing is written; a missing file reads {}', () => {
  const home = newHome();
  assert.deepEqual(readConfig({ home }), {});
  assert.equal(existsSync(configPath(home)), false, 'reading never creates the file');
  assert.throws(() => updateConfig({ note: 'sk-abcdefghijklmnopqrstuvwxyz0123' }, { home }), (e) => e instanceof ConfigError && /never holds a key value/.test(e.message) && !e.message.includes('sk-abcdef'));
  assert.throws(() => updateConfig({ other: { 'ghp_abcdefghijklmnopqrstuvwxyz': 1 } }, { home }), /never holds a key value/);
  assert.equal(existsSync(configPath(home)), false);
});

test('config: an unreadable or unparseable file THROWS ConfigError — never {} — on read and on update; an invalid hand-edited price throws too', () => {
  const home = newHome();
  mkdirSync(home, { recursive: true });
  for (const body of ['{not json', '[]', '"x"', 'null']) {
    writeFileSync(configPath(home), body);
    assert.throws(() => readConfig({ home }), ConfigError, body);
    assert.throws(() => updateConfig({ monthlyLimitUsd: 5 }, { home }), ConfigError, body);
    assert.equal(readFileSync(configPath(home), 'utf8'), body, 'the broken file is left as found');
  }
  writeFileSync(configPath(home), JSON.stringify({ prices: { deepseek: { inPerM: 0 } } }));
  assert.throws(() => readConfig({ home }), /prices\.deepseek\.inPerM/, 'a hand-edited 0 never prices a call at $0');
});

// ---------------------------------------------------------------------------
// the one lookup + ruling A
// ---------------------------------------------------------------------------

test('ruling A: deepseek-flash with no config books POC (b)\'s cache-hit round at $0.006/M — 0.000110796, not the 0.1x default', async () => {
  const { rates, source } = resolvePrices('deepseek-flash');
  assert.deepEqual(source, { in: 'table', cachedIn: 'table', out: 'table' });
  const events = [];
  const provider = { generate: async () => ({ text: 'x', toolCalls: [], usage: POC_USAGE, stopReason: 'stop', model: 'deepseek-flash' }) };
  const loop = new Loop({ provider, rates, onLlmResult: async (ev) => { events.push(ev); } });
  await loop.run([{ role: 'user', content: 'hi' }], []);
  close(events[0].costUsd, (225 * 0.30 + 2816 * 0.006 + 22 * 1.20) / 1e6);
  close(events[0].costUsd, 0.000110796); // = (67.5 + 16.896 + 26.4) micro-USD
  // control: the old row (no cacheIn) booked this same round at bare-agent's 0.1x default = $0.000178
  const old = resolvePrices('deepseek-flash', { ratesTable: { 'deepseek-flash': { in: 0.0003, out: 0.0012, source: 'published' } } });
  assert.equal(old.rates.cacheReadMult, undefined);
  assert.equal(old.perM.cachedInPerM, 0.03);
  // the other rows are untouched: no cache field, so they keep the default multiplier
  for (const [k, r] of Object.entries(RATES_BY_SUFFIX)) if (k !== 'deepseek-flash') assert.equal(r.cacheIn, undefined, k);
});

test('lookup: per field Settings wins over the table; a field left unset falls through to the table; sources are named per field', () => {
  const config = { prices: { deepseek: { outPerM: 2.0 } } };
  const p = resolvePrices('deepseek-flash', { slot: 'deepseek', config });
  assert.equal(p.rates.out, 0.002);
  assert.equal(p.rates.in, 0.0003);
  assert.deepEqual(p.source, { in: 'table', cachedIn: 'table', out: 'settings' });
  assert.deepEqual(p.perM, { inPerM: 0.3, cachedInPerM: 0.006, outPerM: 2 });
  const q = resolvePrices('deepseek-flash', { slot: 'deepseek', config: { prices: { deepseek: SET_PRICE } } });
  assert.deepEqual(q.perM, SET_PRICE);
  assert.deepEqual(q.source, { in: 'settings', cachedIn: 'settings', out: 'settings' });
  close(q.rates.cacheReadMult, 0.1);
  // another slot's price does not apply
  assert.deepEqual(resolvePrices('deepseek-flash', { slot: 'synthetic', config: { prices: { deepseek: SET_PRICE } } }).source, { in: 'table', cachedIn: 'table', out: 'table' });
});

test('unknown model + no config: the table\'s HIGHEST entry per field (today\'s rule survives), never 0; makeProvider still refuses an unrated model', () => {
  const p = resolvePrices('totally-unknown-model');
  const maxIn = Math.max(...Object.values(RATES_BY_SUFFIX).map((r) => r.in));
  const maxOut = Math.max(...Object.values(RATES_BY_SUFFIX).map((r) => r.out));
  assert.equal(p.rates.in, maxIn);
  assert.equal(p.rates.out, maxOut);
  assert.deepEqual(p.source, { in: 'ceiling', cachedIn: 'default-multiplier', out: 'ceiling' });
  assert.equal(p.rates.cacheReadMult, undefined, 'no cached price known: bare-agent applies 0.1x to the (highest) input rate');
  assert.ok(p.perM.inPerM > 0 && p.perM.outPerM > 0 && p.perM.cachedInPerM > 0);
  assert.equal(ceilingCostUsd('totally-unknown-model'), 32 * maxIn + 16 * maxOut);
  assert.throws(() => makeProvider('deepseek', { model: 'totally-unknown-model', env: { DEEPSEEK_API_KEY: KEY }, configHome: newHome() }), /no hand-entered rate/);
});

test('ceilingCostUsd follows a config price (the cap check and the booking agree); without one it is the table\'s', async () => {
  const home = newHome();
  const tableCeiling = ceilingCostUsd('deepseek-flash');
  close(tableCeiling, 32 * 0.0003 + 16 * 0.0012);
  updateConfig({ prices: { deepseek: SET_PRICE } }, { home });
  const { prices } = makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: home });
  const withSet = ceilingCostUsd('deepseek-flash', undefined, { prices });
  close(withSet, 32 * 0.001 + 16 * 0.004);
  assert.ok(withSet > tableCeiling);
  // through the drafter: a budget that fits one table ceiling but not one Settings-priced ceiling refuses at $0
  await withHome(home, async () => {
    const fx = job2Fixture();
    const budgetUsd = (tableCeiling + withSet) / 2;
    const r = await withFake(U, () => draft({ proseText: fx.prose, slot: 'deepseek', env: { DEEPSEEK_API_KEY: KEY }, budgetUsd }));
    assert.equal(r.ok, false);
    assert.equal(r.stop, 'pre-flight');
    assert.match(r.reds[0], new RegExp(`minimum budget is \\$${withSet.toFixed(4)}`));
  });
  await withHome(newHome(), async () => {
    const fx = job2Fixture();
    const r = await withFake(U, () => draft({ proseText: fx.prose, slot: 'deepseek', env: { DEEPSEEK_API_KEY: KEY }, budgetUsd: (tableCeiling + withSet) / 2 }));
    assert.equal(r.ok, true, JSON.stringify(r.reds));
  });
});

test('a broken config makes makeProvider THROW by name — it never falls back to the table silently; model step reds "config:", drafter pre-flights "config:"', async () => {
  const home = newHome();
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath(home), '{oops');
  assert.throws(() => makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: home }), ConfigError);
  await withHome(home, async () => {
    const step = liveStep(spendPathIn());
    const res = await step(CTX, {}, { class: 'hitl' });
    assert.equal(res.ok, false);
    assert.match(res.red, /^config: .*not readable JSON/);
    const fx = job2Fixture();
    const d = await draft({ proseText: fx.prose, slot: 'deepseek', env: { DEEPSEEK_API_KEY: KEY } });
    assert.equal(d.ok, false);
    assert.match(d.reds[0], /^config: /);
  });
});

// ---------------------------------------------------------------------------
// booking: model step, drafter, resume; spend rows; forward only
// ---------------------------------------------------------------------------

test('(x) a price set in config is booked from the next call; every earlier row and the run total stay exactly as booked', async () => {
  const home = newHome();
  const spendPath = spendPathIn();
  await withHome(home, async () => {
    await withFake(U, async () => {
      const r1 = await liveStep(spendPath)(CTX, {}, { class: 'hitl' });
      assert.equal(r1.ok, true, r1.red);
      const rows1 = readSpendRows(spendPath);
      assert.equal(rows1.length, 1);
      close(rows1[0].costUsd, 2 * COST_TABLE_U); // two rounds at the table price
      assert.deepEqual(rows1[0].price.source, { in: 'table', cachedIn: 'table', out: 'table' });
      const total1 = assertUnderGlobalCap(spendPath, 1e9);
      close(total1, rows1[0].costUsd);

      updateConfig({ prices: { deepseek: SET_PRICE } }, { home }); // the price changes between two calls
      const r2 = await liveStep(spendPath)(CTX, {}, { class: 'hitl' });
      assert.equal(r2.ok, true, r2.red);
      const rows2 = readSpendRows(spendPath);
      assert.equal(rows2.length, 2);
      assert.deepEqual(rows2[0], rows1[0], 'the earlier row is byte-for-byte what it was');
      close(rows2[1].costUsd, 2 * COST_SET_U);
      assert.deepEqual(rows2[1].price, { ...SET_PRICE, source: { in: 'settings', cachedIn: 'settings', out: 'settings' } });
      close(assertUnderGlobalCap(spendPath, 1e9), rows1[0].costUsd + rows2[1].costUsd, 1e-12); // = old row as booked + new row

      updateConfig({ prices: { deepseek: { inPerM: 9 } } }, { home }); // a later change touches neither
      assert.deepEqual(readSpendRows(spendPath).slice(0, 2), rows2);
    });
  });
});

test('(xii) with a config price set: the model step, the drafter and a CLI resume ALL book the config price — none falls back to the code table', async () => {
  const home = newHome();
  updateConfig({ prices: { deepseek: SET_PRICE } }, { home });
  const want = { ...SET_PRICE, source: { in: 'settings', cachedIn: 'settings', out: 'settings' } };

  // model step
  const spendPath = spendPathIn();
  await withHome(home, () => withFake(U, async () => {
    const r = await liveStep(spendPath)(CTX, {}, { class: 'hitl' });
    assert.equal(r.ok, true, r.red);
  }));
  const [stepRow] = readSpendRows(spendPath);
  assert.deepEqual(stepRow.price, want);
  assert.equal(stepRow.provider, 'deepseek');
  close(stepRow.costUsd, 2 * COST_SET_U);
  assert.notEqual(stepRow.costUsd, 2 * COST_TABLE_U);

  // drafter
  const d = await withHome(home, () => withFake(U, () => draft({ proseText: job2Fixture().prose, slot: 'deepseek', env: { DEEPSEEK_API_KEY: KEY } })));
  assert.equal(d.ok, true, JSON.stringify(d.reds));
  assert.deepEqual(d.price, want);
  close(d.costUsd, COST_SET_U);

  // resume: a real `fwdloop resume` child; its model step is the live one (network call faked by --import)
  const root = tmp('root');
  const src = tmp('src');
  const fx = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
  const w = writeFlow({
    root, name: 'job2', proseText: fx('job2-with-sources.signed.txt'), declaration: JSON.parse(fx('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: loadCatalogue().primitives,
  });
  assert.equal(w.ok, true);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const base = { PATH: process.env.PATH };
  const parked = spawnSync(process.execPath, [BIN, 'run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1'],
    { env: { ...base, NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP }, encoding: 'utf8', timeout: 30000 });
  assert.equal(parked.status, 0, parked.stderr);
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const askId = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')).askId;
  const ans = spawnSync(process.execPath, [BIN, 'answer', askId, 'redo', 'again please', '--root', root], { env: { ...base, NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE_MODEL_STEP }, encoding: 'utf8', timeout: 30000 });
  assert.equal(ans.status, 0, ans.stderr);
  const liveEnv = {
    ...base, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, DEEPSEEK_API_KEY: KEY, M4D_FAKE_USAGE: JSON.stringify(U),
  };
  const res = spawnSync(process.execPath, ['--import', PRELOAD, BIN, 'resume', 'run-1', '--flow', 'job2', '--root', root], { env: liveEnv, encoding: 'utf8', timeout: 60000 });
  assert.ok(!/config:|key:/.test(res.stderr), res.stderr);
  const rows = readSpendRows(path.join(runDir, 'spend.jsonl')).filter((r) => r.provider === 'deepseek');
  assert.ok(rows.length >= 1, `resume booked a live model row: ${res.stderr}${res.stdout}`);
  for (const r of rows) {
    assert.deepEqual(r.price, want);
    close(r.costUsd, r.rounds * COST_SET_U);
  }
});

test('every new spend row carries provider and price (model step and draft row); old rows without them still read, summarize and total', async () => {
  const home = newHome();
  const spendPath = spendPathIn();
  // an OLD row (pre-M4d shape: no provider, no price) already in the book
  mkdirSync(path.dirname(spendPath), { recursive: true });
  const old = { model: 'deepseek-flash', modelReturned: 'deepseek-flash', tokens: { inputTokens: 10, outputTokens: 5 }, costUsd: 0.0001, rounds: 1, wallMs: 5, stopReason: 'stop', modelMatch: 'match' };
  appendFileSync(spendPath, `${JSON.stringify(old)}\n`);
  await withHome(home, () => withFake(U, async () => {
    const r = await liveStep(spendPath)(CTX, {}, { class: 'hitl' });
    assert.equal(r.ok, true, r.red);
  }));
  const rows = readSpendRows(spendPath);
  assert.equal(rows[0].provider, undefined);
  assert.equal(rows[1].provider, 'deepseek');
  assert.deepEqual(Object.keys(rows[1].price).sort(), ['cachedInPerM', 'inPerM', 'outPerM', 'source']);
  assert.equal(summarizeSpendRows(rows).empty, false);
  assert.equal(summarizeSpendRows([old]).rounds, 1);
  close(assertUnderGlobalCap(spendPath, 1e9), 0.0001 + rows[1].costUsd);
  // a null-cost OLD row is repriced at the table ceiling (as before); a null-cost NEW row at its OWN booked price's ceiling
  const nullOld = spendPathIn();
  appendFileSync(nullOld, `${JSON.stringify({ model: 'deepseek-flash', costUsd: null, spendComplete: false, calls: 1, rounds: 0 })}\n`);
  close(assertUnderGlobalCap(nullOld, 1e9), ceilingCostUsd('deepseek-flash'));
  const nullNew = spendPathIn();
  appendFileSync(nullNew, `${JSON.stringify({ model: 'deepseek-flash', costUsd: null, spendComplete: false, calls: 1, rounds: 0, price: { inPerM: 1, cachedInPerM: 0.1, outPerM: 4 } })}\n`);
  close(assertUnderGlobalCap(nullNew, 1e9), 32 * 0.001 + 16 * 0.004);
  // the draft row (authoring.js): provider + price
  const out = tmp('draft');
  const flowsRoot = tmp('flows');
  const { draftToDir } = await import('../src/authoring.js');
  const fx = job2Fixture();
  const proseFile = path.join(out, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const dd = await withHome(home, () => withFake(U, () => draftToDir({
    proseFile, dir: path.join(out, 'd'), root: flowsRoot, name: 'x', env: { DEEPSEEK_API_KEY: KEY },
  })));
  assert.equal(dd.ok, true, JSON.stringify(dd.reds));
  const [drow] = readSpendRows(path.join(out, 'd', 'spend.jsonl'));
  assert.equal(drow.provider, 'deepseek');
  assert.deepEqual(drow.price, priceRecord(resolvePrices('deepseek-flash', { slot: 'deepseek' })));
});
