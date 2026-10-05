// M4c-fix amendment 2 (h): the human's "Remove the old lock" — POST /api/remove-lock. $0: the CLI's fake model step.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, rmSync, symlinkSync, lstatSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { answerAsk } from '../src/ask.js';
import { createPanelServer } from '../src/panel/server.js';
import { removeOldLock } from '../src/panel/lock.js';
import { getRunAudit, getRunAsks } from '../src/panel/data.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { spawnHolder } from './fixtures/lock-holder.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const CAT = loadCatalogue().primitives;
const PAGE = readFileSync(path.join(REPO, 'src', 'panel', 'index.html'), 'utf8');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-rmlock-${p}-`));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE, DEEPSEEK_API_KEY: 'sk-test-rmlock-0001' };
const ROOTS = [];
const HANDLES = [];
const HOLDERS = [];
after(async () => {
  for (const h of HOLDERS) { try { await h.kill(); } catch { /* gone */ } }
  await Promise.all(HANDLES.map((h) => h.close()));
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

/** job2 parked at its ask, the human's answer SAVED (accept), nothing resumed yet. */
function savedAnswerRun(tag) {
  const root = tmp(tag);
  ROOTS.push(root);
  assert.equal(writeFlow({
    root, name: 'job2', proseText: fixture('job2-with-sources.signed.txt'), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CAT,
  }).ok, true);
  const src = tmp(`${tag}-src`);
  ROOTS.push(src);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const r = spawnSync(process.execPath, [BIN, 'run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1'], { env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(r.status, 0, r.stderr);
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const askId = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')).askId;
  assert.equal(answerAsk({ runDir, askId, decision: 'accept' }).ok, true);
  return {
    root, runDir, askId, flow: 'job2', runId: 'run-1', lock: path.join(runDir, 'resume.lock'),
  };
}
const history = (root) => {
  const p = path.join(root, 'job2', 'history.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const auditRows = (runDir) => readFileSync(path.join(runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const removedRows = (runDir) => auditRows(runDir).filter((r) => r.verdict === 'lock-removed');

function rq(port, {
  method = 'GET', url = '/', headers = {}, body,
} = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const h = { host: `127.0.0.1:${port}`, ...headers };
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    const r = http.request({
      host: '127.0.0.1', port, method, path: url, headers: h, agent: false,
    }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => { const text = Buffer.concat(ch).toString('utf8'); resolve({ status: res.statusCode, json() { try { return JSON.parse(text); } catch { return null; } } }); });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
async function serve(run) {
  const logDir = tmp('logs');
  ROOTS.push(logDir);
  const h = remember(await createPanelServer({ port: 0, root: run.root, resume: { env, logDir } }));
  HANDLES.push(h);
  const own = { origin: `http://127.0.0.1:${h.port}`, ...cookieHeader(h.port, h.token), 'content-type': 'application/json' };
  return { port: h.port, own, post: (headers = own, body = { flow: run.flow, runId: run.runId }) => rq(h.port, { method: 'POST', url: '/api/remove-lock', headers, body }) };
}

test('(h) route: gated like the other POSTs; an empty lock is removed, ONE audit row is written, and the run continues to [✓] passed', async () => {
  const run = savedAnswerRun('route');
  writeFileSync(run.lock, '');
  const s = await serve(run);
  assert.equal((await s.post({ ...s.own, cookie: '' })).status, 403, 'no cookie');
  assert.equal((await s.post({ ...s.own, origin: 'http://evil.example.com' })).status, 403, 'foreign origin');
  assert.equal((await s.post(s.own, { flow: run.flow })).status, 400, 'no run named');
  assert.equal(existsSync(run.lock), true, 'refused requests removed nothing');
  assert.deepEqual(removedRows(run.runDir), []);
  const before = auditRows(run.runDir).length;
  const ok = await s.post();
  assert.equal(ok.status, 202, JSON.stringify(ok.json()));
  assert.equal(ok.json().lockRemoved, true);
  const rows = removedRows(run.runDir);
  assert.equal(rows.length, 1, 'exactly one lock-removed row');
  const row = rows[0];
  assert.equal(row.usd, 0);
  assert.equal(row.spendComplete, true);
  assert.equal(row.model, null);
  assert.match(row.gap, /^removed by human via panel at \d{4}-\d\d-\d\dT/);
  assert.ok(row.gap.endsWith(row.at), 'the gap names the same time as `at`');
  assert.equal(auditRows(run.runDir).filter((r) => r.verdict === 'lock-removed').length + before - 1 <= auditRows(run.runDir).length, true);
  for (let i = 0; i < 400 && !history(run.root).some((x) => x.runId === run.runId); i += 1) await sleep(50); // eslint-disable-line no-await-in-loop
  assert.equal(history(run.root).find((x) => x.runId === run.runId)?.outcome, 'complete', 'the run continued to the end');
  // the Audit tab serves the row
  const served = getRunAudit({ root: run.root, flow: run.flow, runId: run.runId, catalogue: CAT }).rows.filter((r) => r.verdict === 'lock-removed');
  assert.equal(served.length, 1);
});

test('(h) route: a lock WITH a recorded holder is refused by name and left alone; no lock is refused; no audit row either time', async () => {
  const run = savedAnswerRun('holder');
  const holder = await spawnHolder(tmp('holder'));
  HOLDERS.push(holder);
  writeFileSync(run.lock, holder.lockText);
  const s = await serve(run);
  const r = await s.post();
  assert.equal(r.status, 409);
  assert.equal(r.json().refused, 'lock-has-holder');
  assert.equal(readFileSync(run.lock, 'utf8'), holder.lockText, 'the live holder\'s lock is untouched');
  rmSync(run.lock);
  const none = await s.post();
  assert.equal(none.status, 409);
  assert.equal(none.json().refused, 'no-lock');
  assert.deepEqual(removedRows(run.runDir), []);
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), true, 'the saved answer was not touched');
});

test('(h) the check is made at the moment of removal: a holder that appeared since the page was drawn is refused (library level)', async () => {
  const run = savedAnswerRun('recheck');
  writeFileSync(run.lock, '');
  // the page saw an empty lock; before the click a real resumer took it
  const holder = await spawnHolder(tmp('holder2'));
  HOLDERS.push(holder);
  writeFileSync(run.lock, holder.lockText);
  const r = removeOldLock({ root: run.root, runDir: run.runDir });
  assert.equal(r.ok, false);
  assert.equal(r.refused, 'lock-has-holder');
  assert.equal(existsSync(run.lock), true);
  assert.deepEqual(removedRows(run.runDir), []);
});

test('(h) a symlinked lock is removed as the link only — its target is never followed or touched; a run dir outside --root is refused', () => {
  const run = savedAnswerRun('symlink');
  const outside = path.join(tmp('outside'), 'precious');
  ROOTS.push(path.dirname(outside));
  writeFileSync(outside, 'keep me');
  symlinkSync(outside, run.lock);
  const r = removeOldLock({ root: run.root, runDir: run.runDir });
  assert.equal(r.ok, true);
  assert.equal(existsSync(outside), true);
  assert.equal(readFileSync(outside, 'utf8'), 'keep me');
  assert.throws(() => lstatSync(run.lock));
  // a different root: the run dir is not inside it
  writeFileSync(run.lock, '');
  const elsewhere = tmp('elsewhere');
  ROOTS.push(elsewhere);
  const bad = removeOldLock({ root: elsewhere, runDir: run.runDir });
  assert.equal(bad.ok, false);
  assert.equal(bad.refused, 'lock-outside-run');
  assert.equal(existsSync(run.lock), true);
});

test('(h) a second click while the resume is alive is refused in plain words and writes no second row', async () => {
  const run = savedAnswerRun('busy');
  writeFileSync(run.lock, '');
  const s = await serve(run);
  const first = await s.post();
  assert.equal(first.status, 202, JSON.stringify(first.json()));
  const second = await s.post();
  assert.equal(second.status, 409);
  assert.equal(second.json().refused, 'already-resuming');
  assert.equal(removedRows(run.runDir).length, 1);
  for (let i = 0; i < 400 && !history(run.root).some((x) => x.runId === run.runId); i += 1) await sleep(50); // eslint-disable-line no-await-in-loop
});

test('a reopen while a resume of that run is alive is refused 409 already-resuming (reopenRoute\'s own busy check)', async () => {
  const run = savedAnswerRun('reopen-busy');
  writeFileSync(run.lock, '');
  const s = await serve(run);
  const first = await s.post();
  assert.equal(first.status, 202, JSON.stringify(first.json()));
  const reopen = await rq(s.port, { method: 'POST', url: '/api/reopen', headers: s.own, body: { flow: run.flow, runId: run.runId, askId: run.askId } });
  assert.equal(reopen.status, 409);
  assert.equal(reopen.json().refused, 'already-resuming', JSON.stringify(reopen.json()));
  for (let i = 0; i < 400 && !history(run.root).some((x) => x.runId === run.runId); i += 1) await sleep(50); // eslint-disable-line no-await-in-loop
});

test('(h) only the panel route can remove a lock — no runner, agent, CLI or resume path references the remover', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(e.name) && /removeOldLock/.test(readFileSync(p, 'utf8'))) found.push(path.relative(REPO, p));
    }
  };
  walk(path.join(REPO, 'src'));
  assert.deepEqual(found.sort(), ['src/panel/lock.js', 'src/panel/server.js']);
  assert.doesNotMatch(readFileSync(BIN, 'utf8'), /removeOldLock|remove-lock/);
});

test('(h) the page: "Remove the old lock" only for a lock with no holder, one confirm with the exact words, cancel sends nothing; no by-hand line or path', () => {
  assert.match(PAGE, /var REMOVE_LOCK_CONFIRM = "Only do this if nothing else is working on this run\. Remove it\?";/);
  assert.match(PAGE, /if\(!window\.confirm\(REMOVE_LOCK_CONFIRM\)\) return;\s*say\(/, 'cancel returns before anything is sent');
  assert.match(PAGE, /makeButton\("Remove the old lock", "btn-remove-lock"/);
  assert.match(PAGE, /postJSON\("\/api\/remove-lock"/);
  assert.doesNotMatch(PAGE, /Remove this file by hand/);
  assert.match(PAGE, /"lock-has-holder": "Something is working on this run now/);
  assert.match(PAGE, /verdict === "lock-removed"\) return "old lock removed by you"/);
  // a lock-removed row is neutral, like ask-reopened: no pass/fail glyph
  assert.match(PAGE, /verdict === "ask-reopened" \|\| verdict === "lock-removed"\) return null;/);
  // the stuck run with a lockless-holder asks for this button; a plain stuck run asks for Continue
  const run = savedAnswerRun('ask-tab');
  writeFileSync(run.lock, '');
  const tab = getRunAsks({ root: run.root, flow: run.flow, runId: run.runId, catalogue: CAT });
  assert.ok(tab.resume.lockPath, 'the data says the lock has no holder');
  rmSync(run.lock);
  assert.equal(getRunAsks({ root: run.root, flow: run.flow, runId: run.runId, catalogue: CAT }).resume.lockPath, undefined);
});
