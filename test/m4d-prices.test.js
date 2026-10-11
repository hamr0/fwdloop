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
  resolveUsableModel, makeProvider, ceilingCostUsd, readSpendRows, assertUnderGlobalCap, priceRecord, spendRowCost,
} from '../src/provider.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { draft } from '../src/drafter.js';
import { summarizeSpendRows } from '../src/panel/data.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { install } from './fixtures/m4d-fake-openai.mjs';
import { job2Fixture } from './drafter-fixture.mjs';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const PRELOAD = path.join(HERE, 'fixtures', 'm4d-fake-openai-preload.mjs');
const FAKE_MODEL_STEP = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4dp2-${p}-`));
const KEY = 'test-key-not-a-secret-shape';

// The usage of POC (b)'s real DeepSeek cache-hit round (poc/m4d/RESULTS.md).
const POC_USAGE = { inputTokens: 225, cacheReadTokens: 2816, outputTokens: 22 };
const SET_PRICE = { inPerM: 1.0, outPerM: 4.0 };
const SET_BOOKED = { ...SET_PRICE, cachedInPerM: 1.0 }; // amendment 2: cached input books at the input rate
const U = { inputTokens: 100, cacheReadTokens: 1000, outputTokens: 50 };
const COST_TABLE_U = (100 * 0.30 + 1000 * 0.30 + 50 * 1.20) / 1e6; // 1.2e-4: deepseek-flash, code table (cached input books at input, amendment 2)
const COST_SET_U = (100 * 1.0 + 1000 * 1.0 + 50 * 4.0) / 1e6; // 1.3e-3: the SET_PRICE above

// M4d am5: there is no code price table; a price is the one typed on a ticked Settings line. TYPED_LINE is the price the
// old table used to carry for this model, now simply typed (so the cost arithmetic below keeps its numbers).
const TYPED_LINE = { model: 'deepseek-flash', use: true, inPerM: 0.3, outPerM: 1.2 };
const newHome = () => path.join(tmp('home'), 'fwdloop');
/** A fresh config home with one ticked line (default: TYPED_LINE). */
const tickedHome = (line = TYPED_LINE) => {
  const home = newHome();
  mkdirSync(home, { recursive: true });
  updateConfig({ models: { deepseek: [line] } }, { home });
  return home;
};
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

test('amendment 2 (b,c): cached input books at the INPUT rate - a saved cachedInPerM is never read', async () => {
  const round = async (prices) => {
    const events = [];
    const provider = { generate: async () => ({ text: 'x', toolCalls: [], usage: POC_USAGE, stopReason: 'stop', model: 'deepseek-flash' }) };
    const loop = new Loop({ provider, rates: prices.rates, onLlmResult: async (ev) => { events.push(ev); } });
    await loop.run([{ role: 'user', content: 'hi' }], []);
    return events[0].costUsd;
  };
  // (b) typed In $0.40/1M with a saved cachedInPerM of 0.04: the 2816 cached tokens book at $0.40/1M
  const b = resolveUsableModel('deepseek', { config: { models: { deepseek: [{ model: 'deepseek-flash', use: true, inPerM: 0.4, outPerM: 1.2 }] }, prices: { deepseek: { cachedInPerM: 0.04 } } } });
  close(await round(b), (225 * 0.4 + 2816 * 0.4 + 22 * 1.20) / 1e6);
  assert.equal(b.prices.perM.cachedInPerM, 0.4);
  assert.equal(b.rates.cacheReadMult, 1);
  // (c) In typed 0.30: the 2816 cached tokens book at 0.30, there is no cache rate anywhere
  const c = resolveUsableModel('deepseek', { config: { models: { deepseek: [TYPED_LINE] } } });
  close(await round(c), (225 * 0.30 + 2816 * 0.30 + 22 * 1.20) / 1e6);
  assert.equal(c.prices.perM.cachedInPerM, 0.3);
  assert.deepEqual(c.prices.source, { in: 'model', cachedIn: 'input', out: 'model' });
});

test('lookup: a ticked model line\'s pair is THE price (am3 items 7, 9; am5 item 1); a half old price is not usable; sources are named', () => {
  // a price is both fields or neither: a legacy half price with a typed name is an unticked line, not usable, never mixed with anything
  const half = resolveUsableModel('deepseek', { config: { providers: { deepseek: { model: 'deepseek-flash' } }, prices: { deepseek: { outPerM: 2.0 } } }, model: 'deepseek-flash' });
  assert.deepEqual([half.ok, half.say], [false, 'Tick deepseek-flash in Settings > Providers with both prices first.']);
  const q = resolveUsableModel('deepseek', { config: { models: { deepseek: [{ model: 'deepseek-flash', use: true, ...SET_PRICE }] } } });
  assert.deepEqual(q.prices.perM, { inPerM: 1, cachedInPerM: 1, outPerM: 4 });
  assert.deepEqual(q.prices.source, { in: 'model', cachedIn: 'input', out: 'model' });
  close(q.rates.cacheReadMult, 1);
  // another slot's list does not apply
  assert.equal(resolveUsableModel('synthetic', { config: { models: { deepseek: [{ model: 'deepseek-flash', use: true, ...SET_PRICE }] } }, model: 'deepseek-flash' }).ok, false);
});

test('no config, or a model nobody ticked: nothing is usable and nothing is priced from code - makeProvider refuses by name (M4d am5 item 1/2; replaces "the table\'s HIGHEST entry")', () => {
  assert.equal(resolveUsableModel('deepseek', {}).ok, false);
  assert.throws(() => makeProvider('deepseek', { model: 'totally-unknown-model', env: { DEEPSEEK_API_KEY: KEY }, configHome: tickedHome() }), /^Error: Tick totally-unknown-model in Settings > Providers with both prices first\.$/);
  assert.throws(() => makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: path.join(tmp('empty'), 'fwdloop') }), /Tick a model in Settings > Providers/);
});

test('ceilingCostUsd follows the ticked line\'s price (the cap check and the booking agree)', async () => {
  const homeA = tickedHome();
  const homeB = tickedHome({ model: 'deepseek-flash', use: true, ...SET_PRICE });
  const lowCeiling = ceilingCostUsd(makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: homeA }).rates);
  close(lowCeiling, 32 * 0.0003 + 16 * 0.0012);
  const { rates, prices } = makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: homeB });
  const withSet = ceilingCostUsd(rates);
  close(withSet, 32 * 0.001 + 16 * 0.004);
  assert.ok(withSet > lowCeiling);
  assert.equal(prices.source.in, 'model');
  // through the drafter: a budget that fits one low ceiling but not one higher-priced ceiling refuses at $0
  await withHome(homeB, async () => {
    const fx = job2Fixture();
    const budgetUsd = (lowCeiling + withSet) / 2;
    const r = await withFake(U, () => draft({ proseText: fx.prose, slot: 'deepseek', env: { DEEPSEEK_API_KEY: KEY }, budgetUsd }));
    assert.equal(r.ok, false);
    assert.equal(r.stop, 'pre-flight');
    assert.match(r.reds[0], new RegExp(`minimum budget is \\$${withSet.toFixed(4)}`));
  });
  await withHome(homeA, async () => {
    const fx = job2Fixture();
    const r = await withFake(U, () => draft({ proseText: fx.prose, slot: 'deepseek', env: { DEEPSEEK_API_KEY: KEY }, budgetUsd: (lowCeiling + withSet) / 2 }));
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
  const home = tickedHome();
  const spendPath = spendPathIn();
  await withHome(home, async () => {
    await withFake(U, async () => {
      const r1 = await liveStep(spendPath)(CTX, {}, { class: 'hitl' });
      assert.equal(r1.ok, true, r1.red);
      const rows1 = readSpendRows(spendPath);
      assert.equal(rows1.length, 1);
      close(rows1[0].costUsd, 2 * COST_TABLE_U); // two rounds at the first typed price
      assert.deepEqual(rows1[0].price.source, { in: 'model', cachedIn: 'input', out: 'model' });
      const total1 = assertUnderGlobalCap(spendPath, 1e9);
      close(total1, rows1[0].costUsd);

      updateConfig({ models: { deepseek: [{ model: 'deepseek-flash', use: true, ...SET_PRICE }] } }, { home }); // the price changes between two calls
      const r2 = await liveStep(spendPath)(CTX, {}, { class: 'hitl' });
      assert.equal(r2.ok, true, r2.red);
      const rows2 = readSpendRows(spendPath);
      assert.equal(rows2.length, 2);
      assert.deepEqual(rows2[0], rows1[0], 'the earlier row is byte-for-byte what it was');
      close(rows2[1].costUsd, 2 * COST_SET_U);
      assert.deepEqual(rows2[1].price, { ...SET_BOOKED, source: { in: 'model', cachedIn: 'input', out: 'model' } });
      close(assertUnderGlobalCap(spendPath, 1e9), rows1[0].costUsd + rows2[1].costUsd, 1e-12); // = old row as booked + new row

      updateConfig({ prices: { deepseek: { inPerM: 9 } } }, { home }); // a later change touches neither
      assert.deepEqual(readSpendRows(spendPath).slice(0, 2), rows2);
    });
  });
});

test('(xii) with a config price set: the model step, the drafter and a CLI resume ALL book the config price — none falls back to the code table', async () => {
  const home = newHome();
  updateConfig({ models: { deepseek: [{ model: 'deepseek-flash', use: true, ...SET_PRICE }] } }, { home });
  const want = { ...SET_BOOKED, source: { in: 'model', cachedIn: 'input', out: 'model' } };

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
    root, name: 'job2', proseText: sandboxSend(fx('job2-with-sources.signed.txt')), declaration: JSON.parse(fx('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: loadCatalogue().primitives,
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
  const home = tickedHome();
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
  // M4d am5 item 6: a null-cost OLD row (no recorded price) can no longer be repriced from a code table: it counts its floor and reads
  // incomplete ("at least"), never as a clean total; a null-cost NEW row is held at its OWN booked price's ceiling
  const nullOld = spendPathIn();
  appendFileSync(nullOld, `${JSON.stringify({ model: 'deepseek-flash', costUsd: null, spendComplete: false, calls: 1, rounds: 0 })}\n`);
  close(assertUnderGlobalCap(nullOld, 1e9), 0);
  assert.equal(spendRowCost(JSON.parse(readFileSync(nullOld, 'utf8'))).complete, false);
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
  assert.deepEqual(drow.price, priceRecord(resolveUsableModel('deepseek', { config: readConfig({ home }) }).prices));
});
