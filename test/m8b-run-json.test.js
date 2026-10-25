// M8b piece 1: `run.json`, the run's start record. Written ONCE (exclusive create) by the run when it starts, three sections: model, thinking, inputs.
// The three readers read only it; the old names (run-model.json, thinking.json, inputs.json) are not read. $0, in-process, mkdtemp.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, readdirSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { readRunModel } from '../src/flowmodel.js';
import {
  RUN_FILE, writeRunStart, readRunThinking, readRunInputs,
} from '../src/runfile.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, makeParkingAskStep } from '../src/runner.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8b-runjson-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const SLOT = 'DEEPSEEK_API_KEY';
const ENTRY = { id: 'resume', source: '/x/r.md', frozen: '/x/runs/run-1/inputs/resume.md', sha256: 'ab', bytes: 3 };

test('run.json is written once, with model, thinking and inputs; a second write throws and changes nothing', () => {
  const dir = tmp('once');
  assert.equal(RUN_FILE, 'run.json');
  writeRunStart(dir, { model: { slot: SLOT, model: 'm1' }, thinking: true, inputs: [ENTRY] });
  assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')), { model: { slot: SLOT, model: 'm1' }, thinking: true, inputs: [ENTRY] });
  assert.throws(() => writeRunStart(dir, { model: { slot: SLOT, model: 'm2' }, thinking: false, inputs: [] }), /EEXIST/);
  assert.deepEqual(readRunModel(dir), { slot: SLOT, model: 'm1' }, 'never overwritten');
  assert.deepEqual(readdirSync(dir), ['run.json'], 'one file, none of the three old names');
});

test('the three readers read the sections of run.json', () => {
  const dir = tmp('read');
  assert.equal(readRunModel(dir), null);
  assert.equal(readRunThinking(dir), null);
  assert.deepEqual(readRunInputs(dir), { ok: false, code: 'missing', red: 'no run.json' });
  writeRunStart(dir, { model: { slot: SLOT, model: 'm1' }, thinking: false, inputs: [ENTRY] });
  assert.deepEqual(readRunModel(dir), { slot: SLOT, model: 'm1' });
  assert.equal(readRunThinking(dir), false, 'a recorded box OFF reads false, not null');
  assert.deepEqual(readRunInputs(dir), { ok: true, entries: [ENTRY] });
});

test('a start with no model leaves the model section out; a record with no thinking section reads null (a run from before am25)', () => {
  const dir = tmp('nomodel');
  writeRunStart(dir, { model: null, thinking: true, inputs: [] });
  assert.equal('model' in JSON.parse(readFileSync(path.join(dir, 'run.json'), 'utf8')), false);
  assert.equal(readRunModel(dir), null);
  assert.equal(readRunThinking(dir), true);
  const old = tmp('oldrun');
  writeFileSync(path.join(old, 'run.json'), JSON.stringify({ inputs: [ENTRY] }));
  assert.equal(readRunThinking(old), null);
  assert.deepEqual(readRunInputs(old), { ok: true, entries: [ENTRY] });
  const noInputs = tmp('noinputs');
  writeFileSync(path.join(noInputs, 'run.json'), JSON.stringify({ thinking: false }));
  assert.equal(readRunInputs(noInputs).ok, false);
  assert.equal(/** @type {any} */ (readRunInputs(noInputs)).code, 'missing', 'no inputs section = this run froze none');
});

test('an unusable record reads as none (model), box off (thinking) and invalid (inputs); a symlinked run.json is unreadable, never followed', () => {
  const dir = tmp('bad');
  writeFileSync(path.join(dir, 'run.json'), '{not json');
  assert.equal(readRunModel(dir), null);
  assert.equal(readRunThinking(dir), false);
  assert.equal(/** @type {any} */ (readRunInputs(dir)).code, 'invalid');
  const odd = tmp('odd');
  writeFileSync(path.join(odd, 'run.json'), JSON.stringify({ model: { slot: 'not a key name', model: 'x' }, inputs: 'nope' }));
  assert.equal(readRunModel(odd), null);
  assert.equal(/** @type {any} */ (readRunInputs(odd)).code, 'invalid', 'inputs that is not a list');
  const link = tmp('link');
  const outside = tmp('outside');
  writeFileSync(path.join(outside, 'x.json'), JSON.stringify({ inputs: [ENTRY] }));
  symlinkSync(path.join(outside, 'x.json'), path.join(link, 'run.json'));
  assert.equal(/** @type {any} */ (readRunInputs(link)).code, 'unreadable');
});

test('the old names are not read any more', () => {
  const dir = tmp('old');
  writeFileSync(path.join(dir, 'run-model.json'), JSON.stringify({ slot: SLOT, model: 'm1' }));
  writeFileSync(path.join(dir, 'thinking.json'), JSON.stringify({ thinking: true }));
  writeFileSync(path.join(dir, 'inputs.json'), JSON.stringify([ENTRY]));
  assert.equal(readRunModel(dir), null);
  assert.equal(readRunThinking(dir), null);
  assert.equal(readRunInputs(dir).ok, false);
});

test('a run leaves run.json with all three sections and none of the three old names (in-process runFlow)', async () => {
  const load = loadCatalogue(); assert.equal(load.ok, true);
  const root = tmp('root');
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(readFileSync(path.join(HERE, 'fixtures', 'job2-with-sources.signed.txt'), 'utf8')), declaration: JSON.parse(readFileSync(path.join(HERE, 'fixtures', 'job2.m1.declaration.json'), 'utf8')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: load.primitives,
  });
  assert.equal(w.ok, true);
  const src = tmp('src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const r = await runFlow({
    root, name: 'job2', runId: 'run-1', catalogue: load.primitives, runModel: { slot: SLOT, model: 'fake' }, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', askStep: makeParkingAskStep(),
    modelStep: async () => ({ ok: true, costUsd: 0.001, artifact: { text: 'x', done: true } }), sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  });
  assert.notEqual(r.outcome, 'refused', r.red);
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const names = readdirSync(runDir);
  assert.ok(names.includes('run.json'), names.join());
  for (const old of ['run-model.json', 'thinking.json', 'inputs.json']) assert.ok(!names.includes(old), `${old} must not be written`);
  const rec = JSON.parse(readFileSync(path.join(runDir, 'run.json'), 'utf8'));
  assert.deepEqual(rec.model, { slot: SLOT, model: 'fake' });
  assert.equal(rec.thinking, false);
  assert.deepEqual(rec.inputs.map((e) => e.id), ['resume', 'jd']);
  assert.ok(rec.inputs.every((e) => typeof e.sha256 === 'string' && e.sha256.length === 64));
});
