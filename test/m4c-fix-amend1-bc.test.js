// M4c-fix amendment 1 (b) reopen an expired ask (human only) and (c) a run ended by expiry reads [!], never [✗].
// $0: the CLI's fake model step. Each test names its item and was run red with that item's src change taken out.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, readdirSync, rmSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { reopenAsk, effectiveExpiresAt, answerAsk } from '../src/ask.js';
import { createPanelServer } from '../src/panel/server.js';
import { computeGlyph, getRunAsks, listRuns } from '../src/panel/data.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const CAT = loadCatalogue().primitives;
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am1bc-${p}-`));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });
const env = { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE, DEEPSEEK_API_KEY: 'sk-test-am1bc-0001' };
const WAIT = 1_800_000;
const ROOTS = [];
const HANDLES = [];
after(async () => {
  await Promise.all(HANDLES.map((h) => h.close()));
  for (const r of ROOTS) rmSync(r, { recursive: true, force: true });
});

function cliRaw(args) { return spawnSync(process.execPath, [BIN, ...args], { env, encoding: 'utf8', timeout: 30_000 }); }

/** job2 parked at its ask, then the ask's window moved into the past (a 30 min signed wait that ended ~2 h ago). */
function expiredRun(tag) {
  const root = tmp(tag);
  ROOTS.push(root);
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true);
  const src = tmp(`${tag}-src`);
  ROOTS.push(src);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const r = cliRaw(['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', 'run-1']);
  assert.equal(r.status, 0, r.stderr);
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  const askId = JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')).askId;
  const t0 = Date.now() - 2 * 3600_000;
  const askedAt = new Date(t0).toISOString();
  const expiresAt = new Date(t0 + WAIT).toISOString();
  for (const f of [path.join(runDir, 'ask.json'), path.join(runDir, 'asks', `${askId}.json`), path.join(runDir, 'state.json')]) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    j.expiresAt = expiresAt;
    if ('askedAt' in j) j.askedAt = askedAt;
    writeFileSync(f, JSON.stringify(j));
  }
  return {
    root, runDir, askId, flow: 'job2', runId: 'run-1',
  };
}
const history = (root) => {
  const p = path.join(root, 'job2', 'history.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const reopens = (runDir) => readdirSync(runDir).filter((f) => /^reopen\..*\.json$/.test(f));

// ---- (b) library ----------------------------------------------------------------------------------
test('amendment 1 (b): reopenAsk opens a fresh window of the signed length on the same ask, writes a write-once record, rewrites nothing', () => {
  const run = expiredRun('lib');
  const before = ['ask.json', 'state.json', path.join('asks', `${run.askId}.json`)].map((f) => readFileSync(path.join(run.runDir, f), 'utf8'));
  // before the reopen the ask is expired: an answer is refused
  assert.match(answerAsk({ runDir: run.runDir, askId: run.askId, decision: 'accept' }).red, /expired at/);
  const t0 = Date.now();
  const r = reopenAsk({ runDir: run.runDir, askId: run.askId, by: 'human via panel' });
  assert.equal(r.ok, true, r.red);
  assert.ok(Math.abs(Date.parse(r.expiresAt) - (t0 + WAIT)) < 5_000, 'the same signed length, starting now');
  const names = reopens(run.runDir);
  assert.deepEqual(names, [`reopen.${run.askId}.1.json`]);
  const rec = JSON.parse(readFileSync(path.join(run.runDir, names[0]), 'utf8'));
  assert.equal(rec.by, 'human via panel');
  assert.equal(rec.expiresAt, r.expiresAt);
  assert.equal(typeof rec.at, 'string');
  assert.equal(effectiveExpiresAt(run.runDir, run.askId, 'x'), r.expiresAt);
  // nothing existing rewritten
  const after1 = ['ask.json', 'state.json', path.join('asks', `${run.askId}.json`)].map((f) => readFileSync(path.join(run.runDir, f), 'utf8'));
  assert.deepEqual(after1, before);
  // the answer buttons are back: an answer is now taken
  assert.equal(answerAsk({ runDir: run.runDir, askId: run.askId, decision: 'accept' }).ok, true);
  // a window that is open cannot be reopened again
  const again = reopenAsk({ runDir: run.runDir, askId: run.askId, by: 'human via panel' });
  assert.equal(again.ok, false);
  assert.match(again.red, /has not expired|already answered/);
  assert.equal(reopens(run.runDir).length, 1);
});

test('amendment 1 (b): a late saved answer is moved aside as a write-once record on reopen; a refused reopen leaves everything alone', () => {
  const run = expiredRun('late');
  // bad calls are refused by name and write nothing
  assert.match(reopenAsk({ runDir: run.runDir, askId: 'nope', by: 'x' }).red, /unknown/);
  assert.match(reopenAsk({ runDir: run.runDir, askId: run.askId, by: '' }).red, /"by"/);
  writeFileSync(path.join(run.runDir, 'answer.json'), JSON.stringify({ askId: run.askId, decision: 'accept', answeredAt: new Date().toISOString() }));
  const r = reopenAsk({ runDir: run.runDir, askId: run.askId, by: 'human via panel' });
  assert.equal(r.ok, true, r.red);
  assert.equal(r.setAside, `answer.${run.askId}.late.1.json`);
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), false);
  assert.ok(existsSync(path.join(run.runDir, r.setAside)), 'kept as a record, never deleted');
});

test('amendment 1 (b): an answer saved in time is resumed, not reopened', () => {
  const run = expiredRun('ontime');
  writeFileSync(path.join(run.runDir, 'answer.json'), JSON.stringify({ askId: run.askId, decision: 'accept', answeredAt: new Date(Date.now() - 2 * 3600_000 + 60_000).toISOString() }));
  const r = reopenAsk({ runDir: run.runDir, askId: run.askId, by: 'human via panel' });
  assert.equal(r.ok, false);
  assert.match(r.red, /saved in time/);
  assert.deepEqual(reopens(run.runDir), []);
});

test('amendment 1 (b): only the panel route can reopen — no runner, agent, CLI or resume path references reopenAsk', () => {
  const found = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(js|mjs)$/.test(e.name) && /reopenAsk/.test(readFileSync(p, 'utf8'))) found.push(path.relative(REPO, p));
    }
  };
  walk(path.join(REPO, 'src'));
  assert.deepEqual(found.sort(), ['src/ask.js', 'src/panel/server.js']);
  assert.doesNotMatch(readFileSync(BIN, 'utf8'), /reopenAsk/);
});

// ---- (b) panel ------------------------------------------------------------------------------------
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

test('amendment 1 (b): POST /api/reopen — gated like the other POSTs, one click reopens, the answer is taken and the resume accepts it inside the reopened window', async () => {
  const run = expiredRun('panel');
  const logDir = tmp('panel-logs');
  ROOTS.push(logDir);
  const h = remember(await createPanelServer({ port: 0, root: run.root, resume: { env, logDir } }));
  HANDLES.push(h);
  const { port, token } = h;
  const own = { origin: `http://127.0.0.1:${port}`, ...cookieHeader(port, token), 'content-type': 'application/json' };
  const body = {
    flow: run.flow, runId: run.runId, askId: run.askId,
  };
  // the panel offers it: expired, the signed wait, no resume button
  const tab = getRunAsks({ root: run.root, flow: run.flow, runId: run.runId, catalogue: CAT });
  const ask = tab.asks.find((a) => a.askId === run.askId);
  assert.deepEqual(ask.reopen, { waitMs: WAIT, late: false, why: 'Nobody answered in time.' });
  assert.equal(ask.open, false);
  // gates
  assert.equal((await rq(port, { method: 'POST', url: '/api/reopen', headers: { ...own, origin: 'http://evil.example.com' }, body })).status, 403);
  assert.equal((await rq(port, { method: 'POST', url: '/api/reopen', headers: own, body: { ...body, askId: '' } })).status, 400);
  assert.deepEqual(reopens(run.runDir), [], 'a refused request wrote nothing');
  // one click
  const ok = await rq(port, {
    method: 'POST', url: '/api/reopen', headers: own, body,
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json()));
  assert.equal(ok.json().ok, true);
  assert.equal(reopens(run.runDir).length, 1);
  const tab2 = getRunAsks({ root: run.root, flow: run.flow, runId: run.runId, catalogue: CAT });
  const ask2 = tab2.asks.find((a) => a.askId === run.askId);
  assert.equal(ask2.open, true);
  assert.equal(ask2.reopen, null);
  assert.equal(Date.parse(ask2.expiresAt) > Date.now(), true, 'a fresh deadline');
  // a second click: refused, still one record
  const second = await rq(port, {
    method: 'POST', url: '/api/reopen', headers: own, body,
  });
  assert.equal(second.status, 409);
  assert.equal(reopens(run.runDir).length, 1);
  // answer: its saved time is after the ORIGINAL deadline but inside the reopened window; the resume takes it
  const ans = await rq(port, {
    method: 'POST', url: '/api/answer', headers: own, body: { ...body, decision: 'accept' },
  });
  assert.equal(ans.status, 202, JSON.stringify(ans.json()));
  for (let i = 0; i < 400 && !history(run.root).some((x) => x.runId === run.runId); i += 1) await sleep(50); // eslint-disable-line no-await-in-loop
  for (let i = 0; i < 200 && existsSync(path.join(run.runDir, 'resume.lock')); i += 1) await sleep(50); // eslint-disable-line no-await-in-loop
  const row = history(run.root).find((x) => x.runId === run.runId);
  assert.ok(row, 'the resume finished the run');
  assert.equal(row.outcome, 'complete', `the answer was on time against the reopened deadline: ${JSON.stringify(row)}`);
  // an ended run cannot be reopened
  assert.equal((await rq(port, { method: 'POST', url: '/api/reopen', headers: own, body })).status, 409);
});

test('amendment 1 (b): a reopen is recorded in the run\'s audit book (who, when, ask, both deadlines, cost 0), the Audit endpoint returns it, books still sum', async () => {
  const run = expiredRun('audit');
  const h = remember(await createPanelServer({ port: 0, root: run.root }));
  HANDLES.push(h);
  const { port, token } = h;
  const own = { origin: `http://127.0.0.1:${port}`, ...cookieHeader(port, token), 'content-type': 'application/json' };
  const auditPath = path.join(run.runDir, 'audit.jsonl');
  const readRows = () => readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
  const before = readRows();
  const sumBefore = before.reduce((a, r) => a + r.usd, 0);
  const prev = JSON.parse(readFileSync(path.join(run.runDir, 'ask.json'), 'utf8')).expiresAt;
  const ok = await rq(port, {
    method: 'POST', url: '/api/reopen', headers: own, body: { flow: run.flow, runId: run.runId, askId: run.askId },
  });
  assert.equal(ok.status, 200, JSON.stringify(ok.json()));
  const after1 = readRows();
  assert.equal(after1.length, before.length + 1, 'exactly one new audit row');
  const row = after1[after1.length - 1];
  assert.equal(row.verdict, 'ask-reopened');
  assert.equal(row.usd, 0);
  assert.equal(row.spendComplete, true);
  assert.equal(row.model, null);
  assert.match(row.gap, /human via panel/);
  assert.ok(row.gap.includes(run.askId) && row.gap.includes(prev) && row.gap.includes(ok.json().expiresAt), row.gap);
  assert.equal(Number.isNaN(Date.parse(row.at)), false);
  assert.equal(after1.reduce((a, r) => a + r.usd, 0), sumBefore, 'a cost-0 row leaves the book total unchanged');
  const aud = await rq(port, { url: `/api/runs/${run.flow}/${run.runId}/audit`, headers: own });
  assert.equal(aud.status, 200);
  const served = aud.json().rows.filter((r) => r.verdict === 'ask-reopened');
  assert.equal(served.length, 1);
  assert.equal(served[0].at, row.at);
  // a refused second click adds no row
  await rq(port, { method: 'POST', url: '/api/reopen', headers: own, body: { flow: run.flow, runId: run.runId, askId: run.askId } });
  assert.equal(readRows().length, before.length + 1);
});

// ---- (c) ------------------------------------------------------------------------------------------
test('amendment 1 (c): a run ended by expiry reads [!] expired, never [✗]; a never-reopened run stays [!] and spends nothing', () => {
  assert.equal(computeGlyph({
    historyRow: { outcome: 'ask-expired' }, askJson: null, consumedAnswerExists: true, hasStateJson: true,
  }).glyph, '[!]');
  assert.equal(computeGlyph({
    historyRow: { outcome: 'red' }, askJson: null, consumedAnswerExists: true, hasStateJson: true,
  }).glyph, '[✗]', 'control: a real failure still reads failed');
  // never reopened: stays [!], no spend row added by the panel reading it
  const idle = expiredRun('never');
  const rowOf = (root) => listRuns({ root, catalogue: CAT }).find((r) => r.runId === 'run-1');
  assert.equal(rowOf(idle.root).glyph, '[!]');
  assert.deepEqual(history(idle.root), []);
  // ended by the terminal's resume of a late answer: the run reads [!] too
  const run = expiredRun('ended');
  writeFileSync(path.join(run.runDir, 'answer.json'), JSON.stringify({ askId: run.askId, decision: 'accept', answeredAt: new Date().toISOString() }));
  const r = cliRaw(['resume', 'run-1', '--flow', 'job2', '--root', run.root]);
  assert.match(r.stderr, /ask-expired — run cancelled/);
  assert.equal(history(run.root).find((x) => x.runId === 'run-1').outcome, 'ask-expired');
  assert.equal(rowOf(run.root).glyph, '[!]');
});
