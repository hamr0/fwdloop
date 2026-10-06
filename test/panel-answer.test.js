// M4b piece 1 (docs/wiki/the-module-ladder.md, "M4b — inputs" scope 1-2,
// negatives (i),(ii),(iv); "M4b amendment 1" scope 3, negatives (v),(vi)):
// the gated `POST /api/answer` and the Host check on every route. $0: real
// listening server on port 0, parked runs built in-process with a fake model
// step (same shape as test/park-resume.test.js) — no provider, no key.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  readFileSync, writeFileSync, existsSync, readdirSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { createPanelServer } from '../src/panel/server.js';
import { TOKENS, remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CATALOGUE = loadCatalogue().primitives;
/** A stand-in for bin/fwdloop that exits at once: these tests check the answer door, not the resume (test/panel-resume.test.js). */
const NOOP_RESUME_BIN = path.join(HERE, '..', 'scripts', 'panel-fixtures', 'panel-resume-noop.mjs');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-${p}-`));

const modelStep = async (ctx) => {
  if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
  if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
  if (ctx.goal.includes('Draft the summary resume')) {
    return {
      ok: true,
      costUsd: 0.001,
      artifact: { text: '## summary of work history blurb\nx.\n## professional skills\nx.\n## soft skills\nx.', done: true },
    };
  }
  throw new Error(`unexpected goal: ${ctx.goal}`);
};

/** A real parked job #2 run. `parkTime` (optional) pins the clock (for expiry). */
async function parkRun({ parkTime } = {}) {
  const root = tmp('pa-root');
  const src = tmp('pa-src');
  const w = writeFlow({
    root,
    name: 'job2',
    proseText: sandboxSend(fixture('job2-with-sources.signed.txt')),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr',
    signedAt: '2026-09-25T12:00:00Z',
    catalogue: CATALOGUE,
  });
  assert.equal(w.ok, true);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const args = {
    root,
    name: 'job2',
    runId: 'run-1',
    catalogue: CATALOGUE,
    modelStep,
    sendStep: async () => ({ ok: true, bytes: 1 }),
    primitives: {},
    businessDate: '2026-06-01',
    askStep: makeParkingAskStep(),
    ...(parkTime ? { clock: () => parkTime } : {}),
    sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }],
  };
  const parked = await runFlow(args);
  assert.equal(parked.outcome, 'paused', parked.red);
  return {
    root, runDir: parked.runDir, runId: 'run-1', flow: 'job2', askId: parked.askId, args,
  };
}

const HANDLES = [];
after(() => Promise.all(HANDLES.map((h) => h.close())));
async function start(root) {
  const h = remember(await createPanelServer({ port: 0, root, resume: { bin: NOOP_RESUME_BIN, logDir: tmp('pa-logs') } }));
  HANDLES.push(h);
  return h;
}

/** Raw request (fetch cannot set Host/Origin). Records every response seen. */
function rq(port, {
  method = 'GET', url = '/', headers = {}, body,
} = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { host: `127.0.0.1:${port}`, ...cookieHeader(port), ...headers };
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    const r = http.request({
      host: '127.0.0.1', port, method, path: url, headers: h, agent: false,
    }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        resolve({
          status: res.statusCode, headers: res.headers, text, json() { try { return JSON.parse(text); } catch { return null; } },
        });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

/** The token a real browser holds after opening the printed link (the page itself carries none). */
async function pageToken(port) {
  const t = TOKENS.get(port);
  assert.ok(t, 'start() must remember the panel');
  return t;
}
const good = (port, token) => ({ origin: `http://127.0.0.1:${port}`, ...cookieHeader(port, token), 'content-type': 'application/json' });
const post = (port, headers, body) => rq(port, {
  method: 'POST', url: '/api/answer', headers, body,
});
/** Post, waiting out "already-resuming" (the previous answer's resume child has not exited yet; M4c-fix item 1). */
const postIdle = async (port, headers, body) => {
  for (let i = 0; i < 200; i += 1) {
    const r = await post(port, headers, body);
    if (r.json()?.refused !== 'already-resuming') return r;
    await new Promise((res) => { setTimeout(res, 25); });
  }
  throw new Error('still already-resuming after 5 s');
};
const noAnswerOnDisk = (runDir) => assert.deepEqual(readdirSync(runDir).filter((f) => f.startsWith('answer.')), [], 'no answer*.json may exist');
const askOf = (runDir) => JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8'));

// ---------------------------------------------------------------------------
test('(i) POST with a foreign Origin / no Origin / foreign Host is refused by name, writes no answer', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  const token = await pageToken(port);
  const body = {
    flow: run.flow, runId: run.runId, askId: run.askId, decision: 'redo', reason: 'too long',
  };

  const badOrigin = await post(port, { ...good(port, token), origin: 'http://evil.example.com' }, body);
  assert.equal(badOrigin.status, 403);
  assert.equal(badOrigin.json().refused, 'origin-not-own');
  const noOrigin = await post(port, { ...cookieHeader(port, token) }, body);
  assert.equal(noOrigin.status, 403);
  assert.equal(noOrigin.json().refused, 'origin-not-own');
  const badHost = await post(port, { ...good(port, token), host: 'evil.example.com' }, body);
  assert.equal(badHost.status, 403);
  assert.equal(badHost.json().refused, 'host-not-own-address');

  noAnswerOnDisk(run.runDir);
  assert.ok(askOf(run.runDir), 'the ask is still open');
});

test('every other method stays 405 (PUT/DELETE on /api/answer, POST elsewhere)', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  const token = await pageToken(port);
  for (const [method, url] of [['PUT', '/api/answer'], ['DELETE', '/api/answer'], ['POST', '/api/runs'], ['POST', '/']]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await rq(port, {
      method, url, headers: good(port, token), body: {},
    });
    assert.equal(r.status, 405, `${method} ${url}`);
  }
  noAnswerOnDisk(run.runDir);
});

test('body refused by name: not JSON, oversized', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  const token = await pageToken(port);
  const bad = await post(port, good(port, token), '{not json');
  assert.equal(bad.status, 400);
  assert.equal(bad.json().refused, 'body-not-json');
  const big = await post(port, good(port, token), JSON.stringify({ reason: 'x'.repeat(20000) }));
  assert.equal(big.status, 413);
  assert.equal(big.json().refused, 'body-too-large');
  noAnswerOnDisk(run.runDir);
});

test('path safety: a path-escape flow or runId is refused by name, writes nothing', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  const token = await pageToken(port);
  const base = { askId: run.askId, decision: 'accept' };
  const f = await post(port, good(port, token), { ...base, flow: '../job2', runId: run.runId });
  assert.equal(f.status, 400);
  assert.equal(f.json().refused, 'bad-flow');
  const r = await post(port, good(port, token), { ...base, flow: run.flow, runId: '../../job2' });
  assert.equal(r.status, 400);
  assert.equal(r.json().refused, 'bad-runId');
  noAnswerOnDisk(run.runDir);
});

// ---------------------------------------------------------------------------
test('(iv) GET with a foreign Host is refused on / , an /api/ list route and a run-detail route; own Host and localhost:<port> are 200', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  for (const url of ['/', '/api/runs', '/api/inbox', `/api/runs/${run.flow}/${run.runId}`]) {
    // eslint-disable-next-line no-await-in-loop
    const evil = await rq(port, { url, headers: { host: 'evil.example.com' } });
    assert.equal(evil.status, 403, `foreign Host on ${url}`);
    assert.equal(evil.json().refused, 'host-not-own-address');
    // eslint-disable-next-line no-await-in-loop
    const evilPort = await rq(port, { url, headers: { host: `evil.example.com:${port}` } });
    assert.equal(evilPort.status, 403, `foreign Host:port on ${url}`);
    // eslint-disable-next-line no-await-in-loop
    const own = await rq(port, { url });
    assert.equal(own.status, 200, `own Host on ${url}`);
    // eslint-disable-next-line no-await-in-loop
    const local = await rq(port, { url, headers: { host: `localhost:${port}` } });
    assert.equal(local.status, 200, `localhost:<port> on ${url}`);
  }
  const head = await rq(port, { method: 'HEAD', url: '/', headers: { host: 'evil.example.com' } });
  assert.equal(head.status, 403);
  const wrongPort = await rq(port, { url: '/api/runs', headers: { host: `127.0.0.1:${port + 1}` } });
  assert.equal(wrongPort.status, 403, 'right name, wrong port is not our address');
});

// ---------------------------------------------------------------------------
test('(ii) the library\'s refusals come back by name, non-2xx, never as success: blank reason, second answer, expired ask', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  const token = await pageToken(port);
  const b = (extra) => ({
    flow: run.flow, runId: run.runId, askId: run.askId, ...extra,
  });

  const blank = await post(port, good(port, token), b({ decision: 'redo', reason: '   ' }));
  assert.equal(blank.status, 409);
  assert.equal(blank.json().refused, 'library');
  assert.match(blank.json().red, /needs a non-blank reason to redo/);
  assert.notEqual(blank.json().ok, true);
  noAnswerOnDisk(run.runDir);

  const first = await post(port, good(port, token), b({ decision: 'accept' }));
  assert.equal(first.status, 202);
  assert.equal(first.json().ok, true);
  assert.equal(first.json().resume, 'started', 'the reply says the resume was started, never that it is done');
  assert.ok(existsSync(path.join(run.runDir, 'answer.json')));
  // a second answer: the library refuses while answer.json is still there or once consumed
  const second = await postIdle(port, good(port, token), b({ decision: 'redo', reason: 'changed my mind' }));
  assert.notEqual(second.status, 202);
  assert.equal(second.json().refused, 'library');
  assert.match(second.json().red, /already answered|answer/);

  // expired: park under a long-past clock
  const old = await parkRun({ parkTime: '2000-01-01T00:00:00.000Z' });
  const p2 = (await start(old.root)).port;
  const t2 = await pageToken(p2);
  const exp = await post(p2, good(p2, t2), {
    flow: old.flow, runId: old.runId, askId: old.askId, decision: 'accept',
  });
  assert.equal(exp.status, 409);
  assert.equal(exp.json().refused, 'library');
  assert.match(exp.json().red, /expired at/);
  noAnswerOnDisk(old.runDir);
});

// ---------------------------------------------------------------------------
test('(v) an answer with no askId (missing, empty, non-string) is refused by name and nothing is written', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  const token = await pageToken(port);
  const base = {
    flow: run.flow, runId: run.runId, decision: 'accept',
  };
  for (const extra of [{}, { askId: '' }, { askId: 7 }, { askId: null }]) {
    // eslint-disable-next-line no-await-in-loop
    const r = await post(port, good(port, token), { ...base, ...extra });
    assert.equal(r.status, 400, JSON.stringify(extra));
    assert.equal(r.json().refused, 'askid-required');
  }
  noAnswerOnDisk(run.runDir);
  assert.equal(askOf(run.runDir).askId, run.askId, 'the open ask is untouched');
});

test('(vi) after a re-park, the previous ask\'s askId is refused by name and the new ask is still unanswered', async () => {
  const run = await parkRun();
  const { port } = await start(run.root);
  const token = await pageToken(port);
  const common = { flow: run.flow, runId: run.runId };

  const rej = await post(port, good(port, token), {
    ...common, askId: run.askId, decision: 'redo', reason: 'tighten it',
  });
  assert.equal(rej.status, 202, rej.text);
  // the panel's resume here is the injected no-op (see NOOP_RESUME_BIN) — re-park via the runner, $0
  const re = await resumeRun({
    root: run.root,
    name: run.flow,
    runId: run.runId,
    catalogue: CATALOGUE,
    modelStep,
    sendStep: run.args.sendStep,
    primitives: {},
    businessDate: '2026-06-01',
  });
  assert.equal(re.outcome, 'paused', re.red);
  assert.notEqual(re.askId, run.askId);
  assert.equal(askOf(run.runDir).askId, re.askId);

  const stale = await postIdle(port, good(port, token), { ...common, askId: run.askId, decision: 'accept' });
  assert.equal(stale.status, 409);
  assert.equal(stale.json().refused, 'library');
  assert.match(stale.json().red, new RegExp(`askId "${run.askId}" (is unknown|already answered)`));
  assert.deepEqual(
    readdirSync(run.runDir).filter((f) => f.startsWith('answer.')),
    [`answer.${run.askId}.consumed.json`],
    'only the OLD ask\'s consumed marker exists; nothing was written for the new ask',
  );
  assert.equal(askOf(run.runDir).askId, re.askId, 'the new ask is still open');
});

