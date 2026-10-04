// M4c-fix amendment 2 (a): an expired ask's Inbox row says why, the same line its Ask tab draws.
// Run red with the Inbox `why` line in listStops taken out.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { getRunAsks, listStops } from '../src/panel/data.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const LOADED = loadCatalogue();
const CAT = LOADED.primitives;
const page = readFileSync(path.join(REPO, 'src', 'panel', 'index.html'), 'utf8');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE, DEEPSEEK_API_KEY: 'test-key-not-real' };
const WAIT = 1_800_000;
const ROOTS = [];
after(() => { for (const r of ROOTS) rmSync(r, { recursive: true, force: true }); });
const cliRaw = (args) => spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 30_000 });

function fnSrc(name) {
  const start = page.indexOf(`function ${name}(`);
  assert.ok(start !== -1, `function ${name} not found`);
  return page.slice(start, page.indexOf('\n  }', start) + 4);
}

/** job2 with the given run ids parked at the ask. */
function parked(tag, runIds) {
  const root = mkdtempSync(path.join(tmpdir(), `fwdloop-walk3-${tag}-`));
  ROOTS.push(root);
  const w = writeFlow({
    root, name: 'job2', proseText: fixture('job2-with-sources.signed.txt'), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true);
  const src = mkdtempSync(path.join(tmpdir(), `fwdloop-walk3-${tag}-src-`));
  ROOTS.push(src);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const askIds = {};
  for (const runId of runIds) {
    const r = cliRaw(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', runId]);
    assert.equal(r.status, 0, r.stderr);
    askIds[runId] = /askId=(\S+)/.exec(r.stdout)[1];
  }
  return { root, askIds, runDir: (id) => path.join(root, 'job2', 'runs', id) };
}
function expire(world, runId) {
  const runDir = world.runDir(runId);
  const askedAt = new Date(Date.now() - 2 * 3600_000).toISOString();
  const expiresAt = new Date(Date.now() - 2 * 3600_000 + WAIT).toISOString();
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${world.askIds[runId]}.json`), path.join(runDir, 'state.json')]) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = expiresAt;
    if ('askedAt' in j) j.askedAt = askedAt;
    writeFileSync(f, JSON.stringify(j));
  }
}

const stopOf = (w, id) => listStops({ root: w.root }).find((r) => r.runId === id);

test('an expired ask still open to Reopen: its Inbox row says why, the same line as its Ask tab', () => {
  const w = parked('x', ['run-expired', 'run-expired-late', 'run-ended-expired']);
  expire(w, 'run-expired');
  expire(w, 'run-expired-late');
  writeFileSync(path.join(w.runDir('run-expired-late'), 'answer.json'), JSON.stringify({ askId: w.askIds['run-expired-late'], decision: 'accept', answeredAt: new Date().toISOString() }));
  expire(w, 'run-ended-expired');
  writeFileSync(path.join(w.runDir('run-ended-expired'), 'answer.json'), JSON.stringify({ askId: w.askIds['run-ended-expired'], decision: 'accept', answeredAt: new Date().toISOString() }));
  assert.match(cliRaw(['resume', 'run-ended-expired', '--flow', 'job2', '--root', w.root]).stderr, /ask-expired/);
  const tabLine = (id) => getRunAsks({ root: w.root, flow: 'job2', runId: id, catalogue: CAT }).asks[0].reopen.why;
  assert.equal(stopOf(w, 'run-expired').why, 'Nobody answered in time.');
  assert.equal(stopOf(w, 'run-expired-late').why, 'Your answer came after the deadline.');
  assert.equal(stopOf(w, 'run-expired').why, tabLine('run-expired'));
  assert.equal(stopOf(w, 'run-expired-late').why, tabLine('run-expired-late'));
  // the run that ENDED expired keeps its line
  assert.equal(stopOf(w, 'run-ended-expired').why, 'Your answer came after the deadline.');
  assert.equal(stopOf(w, 'run-ended-expired').status, 'expired');
});

test('an open, waiting ask gets no why', () => {
  const w = parked('y', ['run-open']);
  assert.equal(stopOf(w, 'run-open').why, undefined);
});
