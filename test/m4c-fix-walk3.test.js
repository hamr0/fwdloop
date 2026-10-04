// hamr's 2026-10-03/04 panel walk, issue by issue. $0: the CLI's fake model step, the real data readers, and the
// page's own functions cut out by name. Each test names its issue and was run red with that issue's src change taken out.

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

// ---- issue 1: a run ended by expiry --------------------------------------------------------------------
test('issue 1: a run ended because its ask expired reads expired in the Ask tab and the Inbox — never "accepted" — and offers no door', () => {
  const w = parked('i1', ['run-ended-expired', 'run-done']);
  // control: a run that really completed on an accepted answer keeps the word "accepted"
  assert.equal(cliRaw(['answer', w.askIds['run-done'], 'accept', '--root', w.root]).status, 0);
  assert.equal(cliRaw(['resume', 'run-done', '--flow', 'job2', '--root', w.root]).status, 0);
  // the late answer: saved after the deadline, then the terminal resume ends the run `ask-expired`
  expire(w, 'run-ended-expired');
  writeFileSync(path.join(w.runDir('run-ended-expired'), 'answer.json'), JSON.stringify({ askId: w.askIds['run-ended-expired'], decision: 'accept', answeredAt: new Date().toISOString() }));
  assert.match(cliRaw(['resume', 'run-ended-expired', '--flow', 'job2', '--root', w.root]).stderr, /ask-expired/);

  const asks = getRunAsks({ root: w.root, flow: 'job2', runId: 'run-ended-expired', catalogue: CAT });
  const a = asks.asks[0];
  assert.equal(a.status, 'expired');
  assert.equal(a.why, 'Your answer came after the deadline.');
  assert.equal(a.open, false);
  assert.equal(a.reopen, null, 'an ended run is never offered a reopen');
  assert.equal(asks.blocks[0].answers[0].decision, 'expired', 'the answers-so-far line does not say accept for a refused answer');
  const stop = listStops({ root: w.root }).find((r) => r.runId === 'run-ended-expired');
  assert.equal(stop.status, 'expired');
  assert.equal(stop.section, 3);
  assert.equal(stop.waiting, false);
  assert.equal(listStops({ root: w.root }).find((r) => r.runId === 'run-done').status, 'accepted');
});

test('issue 1: every Ask block names its flow and run; an ended ask gets no answer door from the page', () => {
  const meta = new Function(`${fnSrc('blockMetaText')} return blockMetaText;`)();
  const text = meta({
    stepName: 'resume-summary-approved', stepLine: 4, draftNo: 1, current: { askedAt: null, waiting: false, open: false, status: 'expired' },
  }, { flow: 'job2', runId: 'run-ended-expired' });
  assert.match(text, /^job2 \(run-ended-expired\) · /);
  const controls = new Function('pending', `${fnSrc('answerControls')} return answerControls;`)()(
    { askId: 'a1', open: false, reopen: null, status: 'expired' }, null, null);
  assert.equal(controls.kind, 'none');
});
