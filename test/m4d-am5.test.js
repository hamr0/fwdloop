// M4d amendment 5 (docs/wiki/the-module-ladder.md, "M4d amendment 5"): Settings > Providers is the ONLY place for
// models and prices. $0, no network. Every test builds its own config home under a tracked mkdtemp dir.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, readdirSync, statSync, writeFileSync, mkdirSync, existsSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { keysFilePath } from '../src/keysfile.js';
import { configPath, modelsProblem } from '../src/config.js';
import {
  resolveUsableModel, ceilingCostUsd, draftCallOptions, makeProvider, effectiveModels, spendRowCost, CEILING_INPUT_TOKENS, CEILING_OUTPUT_TOKENS,
} from '../src/provider.js';
import { draft } from '../src/drafter.js';
import { job2Fixture } from './drafter-fixture.mjs';
import { createSettings } from '../src/panel/settings.js';
import { capFloorFor } from '../src/panel/authorcard.js';
import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = path.join(HERE, '..', 'src');
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4dam5-${p}-`));
const KEY = 'canary-key-m4d-am5-0123456789abcdef';

const LINE = { model: 'my-model', use: true, inPerM: 2, outPerM: 8 };
const cfg = (models, extra = {}) => ({ models: { deepseek: models }, ...extra });

// ---------------------------------------------------------------- item 1: nothing in code ----
/** Every file under a dir (the tree itself is tracked source; node_modules is not under src). */
function walk(dir) {
  const out = [];
  for (const n of readdirSync(dir)) {
    const p = path.join(dir, n);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else out.push(p);
  }
  return out;
}
/** A line with its comments taken off: whole-line `//`, `*` and `/*` comments, and a trailing `// ...` outside a string. */
function codeOf(line) {
  const t = line.trim();
  if (t.startsWith('//') || t.startsWith('*') || t.startsWith('/*')) return '';
  return line.replace(/\s\/\/\s.*$/, '');
}
// A model id (a vendor's name for a model) or a per-1K/per-1M price literal. A slot's name (`deepseek`) and its env var
// (`DEEPSEEK_API_KEY`) and address are not models; the grep must not flag them.
const HIDDEN = [
  /deepseek-(flash|v\d|chat|reasoner|pro)/i, /qwen/i, /\bGLM\b/, /glm-\d/i, /kimi/i, /gpt-oss/i, /nemotron/i, /\bsyn:(large|small)/, /\bhf:/,
  /\b0\.000\d+\b/, /RATES_BY_SUFFIX/, /CEILING_TABLE_USD/, /defaultModel/, /OPENAI_DRAFT_OFF_OPTIONS/,
];

test('am5 item 1: a grep of src/ and bin/ finds no model name, price literal or default model', () => {
  const files = [...walk(SRC), BIN].filter((f) => /\.(js|mjs|html|json)$/.test(f) || f === BIN);
  const hits = [];
  for (const f of files) {
    readFileSync(f, 'utf8').split('\n').forEach((l, i) => {
      const code = codeOf(l);
      for (const re of HIDDEN) if (re.test(code)) hits.push(`${path.relative(SRC, f)}:${i + 1} ${re} :: ${code.trim().slice(0, 100)}`);
    });
  }
  assert.deepEqual(hits, []);
});

// ---------------------------------------------------------------- item 2: one function decides usable ----
test('am5 item 2: a model is usable only when ticked with both prices; the sentence names it', () => {
  const ok = resolveUsableModel('deepseek', { config: cfg([LINE]) });
  assert.equal(ok.ok, true);
  assert.equal(ok.model, 'my-model');
  assert.equal(ok.slot, 'deepseek');
  assert.deepEqual([ok.prices.perM.inPerM, ok.prices.perM.outPerM], [2, 8]);
  assert.equal(ok.prices.source.in, 'model');
  assert.equal(ok.thinkingOff, 'cant');
  // asked for by name, not ticked
  const unticked = resolveUsableModel('deepseek', { config: cfg([{ ...LINE, use: false }]), model: 'my-model' });
  assert.deepEqual([unticked.ok, unticked.say], [false, 'Tick my-model in Settings > Providers with both prices first.']);
  // asked for by name, not listed at all
  const unlisted = resolveUsableModel('deepseek', { config: cfg([LINE]), model: 'other' });
  assert.equal(unlisted.say, 'Tick other in Settings > Providers with both prices first.');
});

test('am5 interim rule: no model asked for -> exactly one ticked model of the slot, else refused', () => {
  const none = resolveUsableModel('deepseek', { config: {} });
  assert.equal(none.ok, false);
  assert.match(none.say, /^Tick a model in Settings > Providers/);
  const noneTicked = resolveUsableModel('deepseek', { config: cfg([{ model: 'a', use: false }]) });
  assert.match(noneTicked.say, /^Tick a model in Settings > Providers/);
  const two = resolveUsableModel('deepseek', { config: cfg([LINE, { model: 'b', use: true, inPerM: 1, outPerM: 1 }]) });
  assert.equal(two.ok, false);
  assert.match(two.say, /more than one model is ticked/i);
  // 0 / 0 typed is a chosen price, still usable
  const zero = resolveUsableModel('deepseek', { config: cfg([{ model: 'local', use: true, inPerM: 0, outPerM: 0 }]) });
  assert.equal(zero.ok, true);
});

test('am5 item 2: no code default model - a slot with no saved model and no lines has nothing to tick', () => {
  assert.deepEqual(effectiveModels('deepseek', {}).lines, []);
  // the old migration still turns a saved name + old prices into ONE ticked line
  const mig = effectiveModels('deepseek', { providers: { deepseek: { model: 'saved' } }, prices: { deepseek: { inPerM: 1, outPerM: 2 } } });
  assert.deepEqual(mig.lines, [{ model: 'saved', use: true, inPerM: 1, outPerM: 2 }]);
});

test('am5 item 2: makeProvider refuses an unusable model by name, at $0, before any call', () => {
  const home = tmp('mp');
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath(home), JSON.stringify(cfg([{ model: 'x', use: false }])));
  assert.throws(() => makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: home, model: 'x' }), /^Error: Tick x in Settings > Providers with both prices first\.$/);
  assert.throws(() => makeProvider('deepseek', { env: { DEEPSEEK_API_KEY: KEY }, configHome: home }), /Tick a model in Settings > Providers/);
});

test('am5 item 2: the drafter refuses an unusable model at $0 with the sentence (no provider built)', async () => {
  const home = tmp('dr');
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath(home), JSON.stringify({}));
  const saved = { c: process.env.FWDLOOP_CONFIG_HOME, n: process.env.NODE_ENV };
  process.env.FWDLOOP_CONFIG_HOME = home;
  process.env.NODE_ENV = 'test';
  try {
    const r = await draft({ proseText: job2Fixture().prose, env: { DEEPSEEK_API_KEY: KEY } });
    assert.equal(r.ok, false);
    assert.equal(r.calls, 0);
    assert.match(r.reds.join(' '), /Tick a model in Settings > Providers/);
  } finally {
    for (const [k, v] of [['FWDLOOP_CONFIG_HOME', saved.c], ['NODE_ENV', saved.n]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ---------------------------------------------------------------- item 3: thinking off per line ----
test('am5 item 3: thinkingOff is a field on the model line: cant (default) or disabled, nothing else', () => {
  assert.equal(modelsProblem([{ ...LINE, thinkingOff: 'disabled' }]), null);
  assert.equal(modelsProblem([{ ...LINE, thinkingOff: 'cant' }]), null);
  assert.match(modelsProblem([{ ...LINE, thinkingOff: 'yes' }]), /thinking/i);
});

test('am5 item 3: draftCallOptions reads the line, not a code list', () => {
  assert.deepEqual(draftCallOptions({ shape: 'openai-api', thinkingOff: 'disabled' }, 'off'), { thinking: { type: 'disabled' } });
  assert.deepEqual(draftCallOptions({ shape: 'openai-api', thinkingOff: 'cant' }, 'off'), {});
  assert.deepEqual(draftCallOptions({ shape: 'openai-api', thinkingOff: 'disabled' }, 'on'), {});
  // a model name alone decides nothing any more
  assert.deepEqual(draftCallOptions({ shape: 'openai-api', model: 'anything' }, 'off'), {});
});

function settingsWorld(config) {
  const home = path.join(tmp('st'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), `DEEPSEEK_API_KEY=${KEY}\n`, { mode: 0o600 });
  writeFileSync(configPath(home), JSON.stringify(config));
  return { home, s: createSettings({ home, env: {} }) };
}
const get = (s) => s.handle({ method: 'GET', pathname: '/api/settings/providers', query: new URLSearchParams(), body: null });

test('am5 item 3: the Settings route saves thinkingOff on the line and the box reads it', async () => {
  const { s } = settingsWorld(cfg([LINE]));
  let r = await get(s);
  assert.equal(r.body.rows.find((x) => x.slot === 'deepseek').models[0].thinkingOff, 'cant');
  assert.deepEqual([r.body.draftThinking.canChange, r.body.draftThinking.model], [false, 'my-model']);
  const save = await s.handle({ method: 'POST', pathname: '/api/settings/model', query: new URLSearchParams(), body: { slot: 'deepseek', model: 'my-model', thinkingOff: 'disabled' } });
  assert.equal(save.body.ok, true, JSON.stringify(save.body));
  r = await get(s);
  assert.equal(r.body.rows.find((x) => x.slot === 'deepseek').models[0].thinkingOff, 'disabled');
  assert.equal(r.body.draftThinking.canChange, true);
  const bad = await s.handle({ method: 'POST', pathname: '/api/settings/model', query: new URLSearchParams(), body: { slot: 'deepseek', model: 'my-model', thinkingOff: 'nope' } });
  assert.equal(bad.body.ok, false);
});

test('am5 item 3: the Thinking box says "can\'t change this" when the drafting line says cant, and the page offers the choice', () => {
  const page = readFileSync(path.join(SRC, 'panel', 'index.html'), 'utf8');
  assert.match(page, /data-mf="thinkingOff"/);
  assert.match(page, /send thinking: disabled/);
});

// ---------------------------------------------------------------- item 4: the hold from Settings prices ----
test('am5 item 4: the hold is the ticked line\'s own price times the token bounds', () => {
  const u = resolveUsableModel('deepseek', { config: cfg([LINE]) });
  const want = (CEILING_INPUT_TOKENS / 1e6) * 2 + (CEILING_OUTPUT_TOKENS / 1e6) * 8;
  assert.ok(Math.abs(ceilingCostUsd(u.rates) - want) < 1e-12);
  // a free local model holds 0 because its price IS 0, typed
  const z = resolveUsableModel('deepseek', { config: cfg([{ model: 'local', use: true, inPerM: 0, outPerM: 0 }]) });
  assert.equal(ceilingCostUsd(z.rates), 0);
});

test('am5 item 4: a row booked before keeps its booked cost; one that recorded source table/ceiling still reads', () => {
  assert.deepEqual(spendRowCost({ costUsd: 0.0123, price: { inPerM: 1, outPerM: 2, source: { in: 'table', out: 'ceiling' } } }), { usd: 0.0123, complete: true });
  // a null cost at its OWN recorded price: floor of one ceiling at that price
  const r = spendRowCost({ costUsd: null, price: { inPerM: 1, outPerM: 2, source: { in: 'table', out: 'table' } } });
  assert.equal(r.complete, false);
  assert.ok(Math.abs(r.usd - ((CEILING_INPUT_TOKENS / 1e6) + (CEILING_OUTPUT_TOKENS / 1e6) * 2)) < 1e-12);
});

test('am5 item 6: an unknown-cost row with NO recorded price is never complete and never silently priced from code', () => {
  const r = spendRowCost({ costUsd: null, model: 'deepseek-flash' });
  assert.equal(r.complete, false); // renders "at least", not a clean figure
});

test('am5 item 4: the cap floor is the ticked model\'s hold, 0 only when nothing is ticked', () => {
  const home = tmp('floor');
  mkdirSync(home, { recursive: true });
  writeFileSync(configPath(home), JSON.stringify(cfg([LINE])));
  const saved = { c: process.env.FWDLOOP_CONFIG_HOME, n: process.env.NODE_ENV };
  process.env.FWDLOOP_CONFIG_HOME = home;
  process.env.NODE_ENV = 'test';
  try {
    const want = (CEILING_INPUT_TOKENS / 1e6) * 2 + (CEILING_OUTPUT_TOKENS / 1e6) * 8;
    assert.ok(Math.abs(capFloorFor(true) - want) < 1e-12);
    assert.equal(capFloorFor(false), 0);
  } finally {
    for (const [k, v] of [['FWDLOOP_CONFIG_HOME', saved.c], ['NODE_ENV', saved.n]]) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
  }
});

// ---------------------------------------------------------------- item 5: fresh install ----
function cli(args, home, extraEnv = {}) {
  return spawnSync(process.execPath, [BIN, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, DEEPSEEK_API_KEY: KEY, ...extraEnv },
    timeout: 60000,
  });
}

test('am5 item 5: a fresh install, nothing ticked - `draft` says "Tick a model in Settings > Providers", spends nothing, writes nothing', () => {
  const home = path.join(tmp('fresh'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const work = tmp('freshwork');
  const prose = path.join(work, 'p.txt');
  writeFileSync(prose, 'x');
  const out = path.join(work, 'd');
  const r = cli(['draft', prose, '--out', out, '--root', path.join(work, 'flows'), '--name', 'x'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Tick a model in Settings > Providers/);
  assert.equal(readdirSync(work).includes('d'), false, 'no draft dir claimed');
  assert.equal(readdirSync(home).filter((n) => /runs|spend/.test(n)).length, 0, 'no ledger row written');
});

test('am5 item 5: `run` on a fresh install is refused by name at $0, before a run folder or a ledger row exists', () => {
  const home = path.join(tmp('freshrun'), 'fwdloop');
  mkdirSync(home, { recursive: true, mode: 0o700 });
  const root = tmp('rroot');
  const cat = loadCatalogue();
  const written = writeFlow({
    root,
    name: 'job2',
    proseText: sandboxSend(readFileSync(path.join(HERE, 'fixtures', 'job2-with-sources.signed.txt'), 'utf8')),
    declaration: JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'job2.m1.declaration.json'), 'utf8')),
    signedBy: 'hamr',
    signedAt: '2026-09-25T12:00:00Z',
    catalogue: cat.primitives,
  });
  assert.equal(written.ok, true, written.ok ? '' : written.reds.join('\n'));
  const src = tmp('rsrc');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const r = cli(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1'], home);
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /Tick a model in Settings > Providers/);
  assert.equal(existsSync(path.join(root, 'job2', 'runs', 'run-1')), false, 'no run folder');
  assert.equal(readdirSync(home).filter((n) => /runs|spend/.test(n)).length, 0, 'no ledger row');
});
