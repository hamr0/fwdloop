// poc/m4b/answer-door.test.mjs — M4b POC tests. $0: the resume child runs
// bin/fwdloop with its test-only fake model step (NODE_ENV=test +
// FWDLOOP_TEST_MODEL_STEP); no provider, no network, no real key.
// Every guard test is proven able to fail by running this same file against a
// mutated scratch copy of the door (see README.md for the captured red lines):
//   DOOR=./_scratch-<name>.mjs node --test poc/m4b/

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync, readdirSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { writeFlow } from '../../src/flow.js';
import { loadCatalogue } from '../../src/catalogue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..', '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(REPO, 'test', 'fixtures', 'cli-fake-model-step.mjs');
const SCRATCH = '/tmp/claude-1000/-home-hamr-PycharmProjects-fwdloop/ade266d3-29e6-47ee-94a5-03d856fcfac0/scratchpad/m4b';
mkdirSync(SCRATCH, { recursive: true });
const DOOR_FILE = process.env.DOOR ?? './answer-door.mjs';
const { createAnswerDoor } = await import(DOOR_FILE);
const SENTINEL = 'sk-test-SENTINEL-m4b-0001';
process.env.DEEPSEEK_API_KEY = SENTINEL; // the "server's own env"

const fixture = (n) => readFileSync(path.join(REPO, 'test', 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const childEnv = () => ({
  PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE, DEEPSEEK_API_KEY: SENTINEL,
});
const tmp = (p) => mkdtempSync(path.join(SCRATCH, `${p}-`));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, ms = 10000, step = 10) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error('waitFor timed out');
    await sleep(step); // eslint-disable-line no-await-in-loop
  }
}

/** Build a real parked job2 run at $0 via the CLI (fake model step). */
function parkRun(runId = 'run-1') {
  const root = tmp('root'); const src = tmp('src');
  const r = writeFlow({
    root, name: 'job2', proseText: fixture('job2-with-sources.signed.txt'),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CAT,
  });
  assert.equal(r.ok, true);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const out = spawnSync(process.execPath, [BIN, 'run', 'job2', '--root', root,
    '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', runId],
  { env: childEnv(), encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const runDir = path.join(root, 'job2', 'runs', runId);
  return { root, runDir, runId, flow: 'job2', askId: JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')).askId };
}
const askOf = (runDir) => { try { return JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')); } catch { return null; } };
const history = (root) => {
  const p = path.join(root, 'job2', 'history.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};

/** Raw http request (fetch forbids setting Host/Origin). Records everything. */
const SEEN = [];
function rq(port, { method = 'GET', url = '/', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { host: `127.0.0.1:${port}`, ...headers };
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    const r = http.request({
      host: '127.0.0.1', port, method, path: url, headers: h, agent: false,
    }, (res) => {
      const ch = []; res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        const out = { status: res.statusCode, headers: res.headers, text, json() { try { return JSON.parse(text); } catch { return null; } } };
        SEEN.push(`${JSON.stringify(res.headers)}\n${text}`);
        resolve(out);
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}
/** What a browser does: GET / and read the token out of the page. */
async function pageToken(door) {
  const page = await rq(door.port, { url: '/' });
  assert.equal(page.status, 200);
  const m = /name="fwdloop-token" content="([0-9a-f]+)"/.exec(page.text);
  assert.ok(m, 'served page must carry the token');
  return m[1];
}
const good = (door, token) => ({ origin: `http://127.0.0.1:${door.port}`, 'x-fwdloop-token': token, 'content-type': 'application/json' });
const answerBody = (run, verdict, reason, extra = {}) => ({ flow: run.flow, runId: run.runId, verdict, reason, ...extra });
const noAnswerOnDisk = (runDir) => {
  assert.equal(existsSync(path.join(runDir, 'answer.json')), false, 'answer.json must not exist');
  assert.deepEqual(readdirSync(runDir).filter((f) => f.startsWith('answer.')), []);
};
async function start(run, extra = {}) {
  return createAnswerDoor({ root: run.root, logDir: tmp('logs'), env: childEnv(), ...extra });
}
const settled = async (run, door, n = door.spawned.length) => waitFor(() => !existsSync(path.join(run.runDir, 'resume.lock')) && door.spawned.length >= n);

// ---------------------------------------------------------------------------
test('(i) POST without token / foreign Origin / foreign Host is refused by name and writes no answer', async () => {
  const run = parkRun(); const door = await start(run);
  const token = await pageToken(door);
  const body = answerBody(run, 'reject', 'too long');

  const noTok = await rq(door.port, { method: 'POST', url: '/api/answer', headers: { origin: door.origin, 'content-type': 'application/json' }, body });
  assert.equal(noTok.status, 403); assert.equal(noTok.json().refused, 'token-missing-or-wrong');
  const wrongTok = await rq(door.port, { method: 'POST', url: '/api/answer', headers: { ...good(door, 'f'.repeat(64)) }, body });
  assert.equal(wrongTok.json().refused, 'token-missing-or-wrong');
  const badOrigin = await rq(door.port, { method: 'POST', url: '/api/answer', headers: { ...good(door, token), origin: 'http://evil.example.com' }, body });
  assert.equal(badOrigin.status, 403); assert.equal(badOrigin.json().refused, 'origin-not-own');
  const noOrigin = await rq(door.port, { method: 'POST', url: '/api/answer', headers: { 'x-fwdloop-token': token }, body });
  assert.equal(noOrigin.json().refused, 'origin-not-own');
  const badHost = await rq(door.port, { method: 'POST', url: '/api/answer', headers: { ...good(door, token), host: 'evil.example.com' }, body });
  assert.equal(badHost.status, 403); assert.equal(badHost.json().refused, 'host-not-own-address');
  const put = await rq(door.port, { method: 'PUT', url: '/api/answer', headers: good(door, token), body });
  assert.equal(put.status, 405);
  const getAns = await rq(door.port, { method: 'GET', url: '/api/answer', headers: good(door, token) });
  assert.notEqual(getAns.status, 202);

  noAnswerOnDisk(run.runDir);
  assert.equal(door.spawned.length, 0, 'no resume may start from a refused POST');
  await door.close();
});

test('(iv) GET with a foreign Host is refused, never 200 — every route', async () => {
  const run = parkRun(); const door = await start(run);
  for (const url of ['/', '/api/runs', '/api/inbox', `/api/runs/${run.flow}/${run.runId}`]) {
    const r = await rq(door.port, { url, headers: { host: 'evil.example.com' } });
    assert.notEqual(r.status, 200, `GET ${url} with Host evil.example.com`);
    assert.equal(r.status, 403); assert.equal(r.json().refused, 'host-not-own-address');
  }
  // rebinding shape: right name, wrong port
  const wrongPort = await rq(door.port, { url: '/api/runs', headers: { host: '127.0.0.1:1' } });
  assert.equal(wrongPort.status, 403);
  // and a good Host still works (the gate is not just refusing everything)
  assert.equal((await rq(door.port, { url: '/api/runs' })).status, 200);
  assert.equal((await rq(door.port, { url: '/api/runs', headers: { host: `localhost:${door.port}` } })).status, 200);
  await door.close();
});

test('(ii) library refusals surface by name, never as success, and start no resume', async () => {
  const run = parkRun(); const door = await start(run);
  const token = await pageToken(door); const h = good(door, token);

  const blank = await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'reject', '   ') });
  assert.notEqual(blank.status, 202); assert.equal(blank.json().ok, false);
  assert.match(blank.json().red, /answerAsk: askId "\S+" needs a non-blank reason to reject/);
  const unknown = await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'accept', undefined, { askId: 'nope' }) });
  assert.match(unknown.json().red, /answerAsk: askId "nope" is unknown/);
  const badDecision = await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'maybe') });
  assert.match(badDecision.json().red, /unrecognised decision "maybe"/);
  noAnswerOnDisk(run.runDir);
  assert.equal(door.spawned.length, 0);

  // second answer to an already-answered ask (askId pinned to the first ask)
  const first = await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'reject', 'first', { askId: run.askId }) });
  assert.equal(first.status, 202);
  const second = await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'accept', undefined, { askId: run.askId }) });
  assert.notEqual(second.status, 202);
  assert.match(second.json().red, /already answered/);
  assert.equal(door.spawned.length, 1);
  await settled(run, door);
  await door.close();

  // expired ask
  const run2 = parkRun('run-2'); const door2 = await start(run2);
  const t2 = await pageToken(door2);
  const ask = askOf(run2.runDir); ask.expiresAt = '2020-01-01T00:00:00.000Z';
  writeFileSync(path.join(run2.runDir, 'ask.json'), JSON.stringify(ask));
  const exp = await rq(door2.port, { method: 'POST', url: '/api/answer', headers: good(door2, t2), body: answerBody(run2, 'accept') });
  assert.notEqual(exp.status, 202); assert.match(exp.json().red, /expired at 2020-01-01/);
  noAnswerOnDisk(run2.runDir); assert.equal(door2.spawned.length, 0);
  await door2.close();
});

test('happy path at $0: reject returns before the resume finishes, re-parks; accept completes — asserted from the books', async () => {
  const run = parkRun(); const door = await start(run);
  const token = await pageToken(door); const h = good(door, token);

  const t0 = Date.now();
  const r1 = await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'reject', 'tighten the skills section') });
  const respMs = Date.now() - t0;
  assert.equal(r1.status, 202);
  // the response came back BEFORE the resume did its work: the old ask is still the open one
  assert.equal(askOf(run.runDir).askId, run.askId, 'resume must not have re-parked yet when the response lands');
  const a2 = await waitFor(() => { const a = askOf(run.runDir); return a && a.askId !== run.askId ? a : null; });
  const reparkMs = Date.now() - t0;
  assert.notEqual(a2.askId, run.askId);
  assert.equal(history(run.root).length, 0, 'not complete yet');

  await settled(run, door);
  const r2 = await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'accept') });
  assert.equal(r2.status, 202); assert.equal(r2.json().askId, a2.askId);
  await waitFor(() => history(run.root).length === 1);
  const doneMs = Date.now() - t0;
  const rows = history(run.root);
  assert.equal(rows.length, 1); assert.equal(rows[0].outcome, 'complete');
  assert.ok(existsSync(path.join(run.runDir, `answer.${run.askId}.consumed.json`)));
  assert.ok(existsSync(path.join(run.runDir, `answer.${a2.askId}.consumed.json`)));
  assert.equal(door.spawned.length, 2);
  console.log(`# MEASURE happy: response=${respMs}ms re-park=${reparkMs}ms complete=${doneMs}ms`);
  await door.close();
});

test('detached: the server process group is SIGKILLed right after the response; the resume still completes', async () => {
  const run = parkRun(); const logs = tmp('srvlogs');
  const srv = spawn(process.execPath, [path.join(HERE, 'serve.mjs')], {
    detached: true, stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...childEnv(), DOOR_MODULE: DOOR_FILE, DOOR_ROOT: run.root, DOOR_LOGDIR: logs },
  });
  const line = await new Promise((res) => srv.stdout.once('data', (d) => res(String(d))));
  const { port } = JSON.parse(line);
  const token = await pageToken({ port });
  const t0 = Date.now();
  const r = await rq(port, { method: 'POST', url: '/api/answer', headers: good({ port }, token), body: answerBody(run, 'reject', 'redo') });
  const respMs = Date.now() - t0;
  assert.equal(r.status, 202);
  process.kill(-srv.pid, 'SIGKILL'); // whole server group, now
  await waitFor(() => { try { process.kill(srv.pid, 0); return false; } catch { return true; } }, 2000);
  const a2 = await waitFor(() => { const a = askOf(run.runDir); return a && a.askId !== run.askId ? a : null; }, 10000).catch(() => null);
  const afterMs = Date.now() - t0;
  console.log(`# MEASURE detached: POST response=${respMs}ms; server dead; resume ${a2 ? `re-parked ${afterMs}ms after POST` : 'NEVER re-parked'}`);
  assert.ok(a2, 'resume must outlive the killed server');
  await waitFor(() => !existsSync(path.join(run.runDir, 'resume.lock')));
});

test('exactly one resume: 10 concurrent identical valid POSTs', async () => {
  const run = parkRun(); const door = await start(run);
  const token = await pageToken(door); const h = good(door, token);
  const rs = await Promise.all(Array.from({ length: 10 }, () => rq(door.port, {
    method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'reject', 'same answer', { askId: run.askId }),
  })));
  const ok = rs.filter((r) => r.status === 202);
  assert.equal(ok.length, 1, `accepted: ${rs.map((r) => r.status)}`);
  for (const r of rs.filter((x) => x.status !== 202)) assert.match(r.json().red, /already answered/);
  assert.equal(door.spawned.length, 1, 'exactly one resume spawned');
  await settled(run, door); await sleep(300);
  const asks = readdirSync(path.join(run.runDir, 'asks'));
  assert.equal(asks.length, 2, `original + exactly one re-park, got ${asks}`);
  const consumed = readdirSync(run.runDir).filter((f) => /^answer\..*\.consumed\.json$/.test(f));
  assert.equal(consumed.length, 1);
  await door.close();
});

test('MEASURE in-flight: answer while resume.lock is held (simulated) and the natural race at re-park', async () => {
  // (a) lock held by an in-flight resumer: the answer is accepted, the child is refused by the lock.
  const run = parkRun(); const door = await start(run);
  const token = await pageToken(door);
  writeFileSync(path.join(run.runDir, 'resume.lock'), '');
  const r = await rq(door.port, { method: 'POST', url: '/api/answer', headers: good(door, token), body: answerBody(run, 'reject', 'x') });
  await sleep(1500);
  const log = readFileSync(door.spawned[0].logPath, 'utf8');
  const a = {
    status: r.status, answerStillOnDisk: existsSync(path.join(run.runDir, 'answer.json')),
    childSaid: /locked by another resumer/.test(log), reparked: askOf(run.runDir).askId !== run.askId,
  };
  console.log(`# MEASURE lock-held: ${JSON.stringify(a)}`);
  assert.equal(a.status, 202); // door reports "started" — it does not know the child refused
  assert.equal(a.childSaid, true);
  assert.equal(a.answerStillOnDisk, true);
  assert.equal(a.reparked, false);
  await door.close();

  // (b) natural race: accept POSTed the instant a new ask.json appears, while the parking resume still holds its lock.
  let raced = 0; let hits = 0; const N = 15;
  for (let i = 0; i < N; i += 1) {
    const run2 = parkRun(`race-${i}`); const d = await start(run2); const t = await pageToken(d);
    await rq(d.port, { method: 'POST', url: '/api/answer', headers: good(d, t), body: answerBody(run2, 'reject', 'again') });
    await waitFor(() => { const k = askOf(run2.runDir); return k && k.askId !== run2.askId; }, 10000, 1); // eslint-disable-line no-await-in-loop
    const lockAtSeen = existsSync(path.join(run2.runDir, 'resume.lock'));
    const r2 = await rq(d.port, { method: 'POST', url: '/api/answer', headers: good(d, t), body: answerBody(run2, 'accept') }); // eslint-disable-line no-await-in-loop
    if (lockAtSeen) raced += 1;
    await sleep(700); // eslint-disable-line no-await-in-loop
    const stuck = existsSync(path.join(run2.runDir, 'answer.json')) && history(run2.root).length === 0;
    if (r2.status === 202 && stuck) hits += 1;
    await d.close(); // eslint-disable-line no-await-in-loop
  }
  console.log(`# MEASURE natural-race: ${N} trials, lock still present when new ask first seen: ${raced}, answer stranded (accepted, never resumed): ${hits}`);
});

test('key hygiene: the sentinel key never appears in any response, book file, or resume log', async () => {
  const run = parkRun(); const door = await start(run);
  const token = await pageToken(door); const h = good(door, token);
  SEEN.length = 0;
  await rq(door.port, { url: '/' });
  await rq(door.port, { url: '/api/runs' });
  await rq(door.port, { url: '/api/inbox' });
  await rq(door.port, { url: `/api/runs/${run.flow}/${run.runId}` });
  await rq(door.port, { url: `/api/runs/${run.flow}/${run.runId}/audit` });
  await rq(door.port, { url: `/api/runs/${run.flow}/${run.runId}/asks` });
  await rq(door.port, { url: '/api/runs/%2e%2e/x' });
  await rq(door.port, { url: '/nope', headers: { host: 'evil.example.com' } });
  await rq(door.port, { method: 'POST', url: '/api/answer', headers: { origin: door.origin }, body: answerBody(run, 'accept') });
  await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: '{not json' });
  await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'reject', '') });
  await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'reject', 'more') });
  const a2 = await waitFor(() => { const a = askOf(run.runDir); return a && a.askId !== run.askId ? a : null; });
  await settled(run, door);
  await rq(door.port, { method: 'POST', url: '/api/answer', headers: h, body: answerBody(run, 'accept') });
  await waitFor(() => history(run.root).length === 1);
  assert.notEqual(a2.askId, run.askId);
  await rq(door.port, { url: `/api/runs/${run.flow}/${run.runId}` });

  assert.ok(SEEN.length >= 12);
  for (const s of SEEN) assert.equal(s.includes(SENTINEL), false, 'sentinel in an HTTP response');
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const files = [...walk(run.root), ...door.spawned.map((s) => s.logPath)];
  let logBytes = 0;
  for (const f of files) {
    const t = readFileSync(f);
    if (f.endsWith('.log')) logBytes += t.length;
    assert.equal(t.includes(SENTINEL), false, `sentinel in ${f}`);
  }
  console.log(`# MEASURE hygiene: ${SEEN.length} responses, ${files.length} files (incl. ${door.spawned.length} resume logs, ${logBytes} bytes) scanned, 0 sentinel hits`);
  await door.close();
});
