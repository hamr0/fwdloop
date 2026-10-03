// M4c-fix group B (docs/wiki/the-module-ladder.md, "M4c-fix", items 8-17, negatives vi, ix, xi). $0: the CLI's
// fake model step. Each test below names its item and was run red with that item's src change taken out.

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  readFileSync, writeFileSync, readdirSync, existsSync, renameSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { listArchivedAsks } from '../src/ask.js';
import { getRunAsks } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');

const loaded = loadCatalogue();
assert.equal(loaded.ok, true);
const CATALOGUE = loaded.primitives;

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4cfixb-${p}-`));
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE };
function cliRaw(args) {
  return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 20_000 });
}
function cli(args) {
  const r = cliRaw(args);
  assert.equal(r.status, 0, `fwdloop ${args.join(' ')}: ${r.stderr || r.stdout}`);
  return r.stdout;
}

/** job2 via the real CLI, parked once at its ask. */
function parkedJob2(tag) {
  const root = tmp(tag);
  const w = writeFlow({
    root, name: 'job2', proseText: fixture('job2-with-sources.signed.txt'), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const out = cli(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1']);
  return { root, runDir: path.join(root, 'job2', 'runs', 'run-1'), askId: /askId=(\S+)/.exec(out)[1] };
}

// ---- item 9, negative (vi) ----------------------------------------------------------------------
test('item 9 (vi): an answer.json that is null, a number, a string or an array is refused by name, never a crash, and stays on disk', () => {
  const { root, runDir } = parkedJob2('i9');
  for (const body of ['null', '5', '"x"', '[]']) {
    writeFileSync(path.join(runDir, 'answer.json'), body);
    const r = cliRaw(['resume', 'run-1', '--flow', 'job2', '--root', root]);
    assert.notEqual(r.status, 0, body);
    assert.match(r.stderr, /answer\.json for run "run-1" is not a JSON object/, `${body}: ${r.stderr}`);
    assert.doesNotMatch(r.stderr, /TypeError|at \w+ \(/, `${body}: no crash trace`);
    assert.equal(readFileSync(path.join(runDir, 'answer.json'), 'utf8'), body, 'the refused file is left as it was');
  }
});

// ---- item 12 ------------------------------------------------------------------------------------
test('item 12: a consumed answer whose decision is "constructor" / "toString" reads as unrecognised, in ask.js and in the panel', () => {
  const { root, runDir, askId } = parkedJob2('i12');
  cli(['answer', askId, 'redo', 'why', '--root', root]);
  cli(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  const consumed = path.join(runDir, `answer.${askId}.consumed.json`);
  assert.ok(existsSync(consumed));
  for (const word of ['constructor', 'toString', '__proto__']) {
    const body = JSON.parse(readFileSync(consumed, 'utf8'));
    writeFileSync(consumed, JSON.stringify({ ...body, decision: word }));
    const archived = listArchivedAsks(runDir);
    const row = archived.asks.find((a) => a.askId === askId);
    assert.equal(row.answer.status, `unrecognised: ${word}`, word);
  }
  // the panel's pre-M4a-1 path: no asks/ archive, only the consumed marker
  renameSync(path.join(runDir, 'asks'), path.join(runDir, 'asks-gone'));
  writeFileSync(consumed, JSON.stringify({ ...JSON.parse(readFileSync(consumed, 'utf8')), decision: 'constructor' }));
  const rows = getRunAsks({ root, flow: 'job2', runId: 'run-1', catalogue: CATALOGUE }).asks;
  const legacy = rows.find((a) => a.askId === askId);
  assert.equal(legacy.status, 'unrecognised: constructor');
});

// ---- item 14 ------------------------------------------------------------------------------------
test('item 14: a run parked through a symlinked --root (state.json holds the link path) resumes by the real root; a different root is still refused', async () => {
  const { root, runDir, askId } = parkedJob2('i14');
  const { symlinkSync } = await import('node:fs');
  const link = path.join(tmp('i14-link'), 'root-link');
  symlinkSync(root, link);
  const statePath = path.join(runDir, 'state.json');
  const state = JSON.parse(readFileSync(statePath, 'utf8'));
  assert.equal(state.flow.root, root);
  writeFileSync(statePath, JSON.stringify({ ...state, flow: { ...state.flow, root: link } }));
  cli(['answer', askId, 'accept', '--root', root]);
  const r = cliRaw(['resume', 'run-1', '--flow', 'job2', '--root', root]);
  assert.equal(r.status, 0, r.stderr || r.stdout);
  assert.match(r.stdout, /complete: spentUsd=/);
  // a genuinely different root is still refused by name
  const other = tmp('i14-other');
  const { runDir: runDir2, askId: askId2 } = parkedJob2('i14b');
  cli(['answer', askId2, 'accept', '--root', path.dirname(path.dirname(path.dirname(runDir2)))]);
  const st2 = JSON.parse(readFileSync(path.join(runDir2, 'state.json'), 'utf8'));
  writeFileSync(path.join(runDir2, 'state.json'), JSON.stringify({ ...st2, flow: { ...st2.flow, root: other } }));
  const r2 = cliRaw(['resume', 'run-1', '--flow', 'job2', '--root', path.dirname(path.dirname(path.dirname(runDir2)))]);
  assert.notEqual(r2.status, 0);
  assert.match(r2.stderr, /was parked against flow/);
});
