// M4b piece 2 (docs/wiki/the-module-ladder.md, "M4b — inputs" scope 3; "M4b
// amendment 1" scope 1-2, negatives (vii),(viii)): after an answer the panel
// starts the resume as a detached process, checks from the BOOKS that it took
// over, retries only the lock refusal, and says a stuck answer by name. $0: the
// resume child is the real `bin/fwdloop` with its test-only fake model step
// (NODE_ENV=test + FWDLOOP_TEST_MODEL_STEP) — no provider, no network, no key.
// Every assert reads the books (answer/consumed markers, ask.json, asks/,
// history.jsonl) or the panel's own HTTP data, never the child's output.

import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { createPanelServer } from '../src/panel/server.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.join(HERE, '..');
const BIN = path.join(REPO, 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const SERVE = path.join(REPO, 'scripts', 'panel-fixtures', 'panel-serve.mjs');
const REFUSE_BIN = path.join(REPO, 'scripts', 'panel-fixtures', 'panel-resume-refuse.mjs');
const SENTINEL = 'sk-test-SENTINEL-m4b-0002';
const CAT = loadCatalogue().primitives;
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-${p}-`));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

/** The env the panel server "has": fake model step + the sentinel key. */
const serverEnv = () => ({
  PATH: process.env.PATH, NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE, DEEPSEEK_API_KEY: SENTINEL,
});

async function waitFor(fn, ms = 15000, step = 15) {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`waitFor timed out after ${ms} ms: ${fn}`);
    await sleep(step); // eslint-disable-line no-await-in-loop
  }
}

/** Every run root / log dir / server this file makes, for the `after` cleanup. */
const ROOTS = [];
const LOGDIRS = [];
const HANDLES = [];
const SERVER_PROCS = [];

/** A real parked job #2 run, built through the CLI at $0 (fake model step). */
function parkRun(runId = 'run-1') {
  const root = tmp('pr-root');
  const src = tmp('pr-src');
  ROOTS.push(root);
  const w = writeFlow({
    root,
    name: 'job2',
    proseText: fixture('job2-with-sources.signed.txt'),
    declaration: JSON.parse(fixture('job2.m1.declaration.json')),
    signedBy: 'hamr',
    signedAt: '2026-09-25T12:00:00Z',
    catalogue: CAT,
  });
  assert.equal(w.ok, true);
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const out = spawnSync(process.execPath, [BIN, 'run', 'job2', '--root', root,
    '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`, '--run-id', runId],
  { env: serverEnv(), encoding: 'utf8' });
  assert.equal(out.status, 0, out.stderr);
  const runDir = path.join(root, 'job2', 'runs', runId);
  return {
    root, runDir, runId, flow: 'job2', askId: JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')).askId,
  };
}
const askOf = (runDir) => { try { return JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')); } catch { return null; } };
const history = (root) => {
  const p = path.join(root, 'job2', 'history.jsonl');
  return existsSync(p) ? readFileSync(p, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
};
const consumedMarkers = (runDir) => readdirSync(runDir).filter((f) => /^answer\..*\.consumed\.json$/.test(f));
const lockPath = (run) => path.join(run.runDir, 'resume.lock');

/** Start a panel server in this process; `resume` overrides only what a test must (window, bin). */
async function start(run, resume = {}) {
  const logDir = tmp('pr-logs');
  LOGDIRS.push(logDir);
  const h = await createPanelServer({
    port: 0, root: run.root, resume: { env: serverEnv(), logDir, ...resume },
  });
  HANDLES.push(h);
  return { ...h, logDir };
}

/** Raw request (fetch cannot set Host/Origin). Records every response seen. */
const SEEN = [];
function rq(port, {
  method = 'GET', url = '/', headers = {}, body,
} = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const h = { host: `127.0.0.1:${port}`, ...headers };
    if (data !== undefined) h['content-length'] = Buffer.byteLength(data);
    const r = http.request({
      host: '127.0.0.1', port, method, path: url, headers: h, agent: false,
    }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        SEEN.push(`${url}\n${JSON.stringify(res.headers)}\n${text}`);
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
async function pageToken(port) {
  const page = await rq(port, { url: '/' });
  assert.equal(page.status, 200);
  const m = /var TOKEN = "([0-9a-f]{64})";/.exec(page.text);
  assert.ok(m, 'served page must carry the token in `var TOKEN`');
  return m[1];
}
const good = (port, token) => ({ origin: `http://127.0.0.1:${port}`, 'x-fwdloop-token': token, 'content-type': 'application/json' });
const answer = (port, token, run, decision, reason, extra = {}) => rq(port, {
  method: 'POST',
  url: '/api/answer',
  headers: good(port, token),
  body: {
    flow: run.flow, runId: run.runId, askId: run.askId, decision, ...(reason ? { reason } : {}), ...extra,
  },
});
const resumePost = (port, token, run, headers = good(port, token)) => rq(port, {
  method: 'POST', url: '/api/resume', headers, body: { flow: run.flow, runId: run.runId },
});
const runData = async (port, run) => (await rq(port, { url: `/api/runs/${run.flow}/${run.runId}` })).json();
/** The resume for the answer to `prevAskId` has fully finished: consumed, a new ask parked (or complete), lock gone. */
const settled = (run, prevAskId = run.askId) => waitFor(() => {
  const a = askOf(run.runDir);
  const moved = (a && a.askId !== prevAskId) || history(run.root).length > 0;
  return existsSync(path.join(run.runDir, `answer.${prevAskId}.consumed.json`)) && moved && !existsSync(lockPath(run));
});
/** Poll the run's HTTP data until `pred` holds (async-safe, unlike `waitFor`). */
async function pollData(port, run, pred, ms = 10000) {
  const t0 = Date.now();
  for (;;) {
    const d = await runData(port, run);
    if (pred(d)) return d;
    if (Date.now() - t0 > ms) throw new Error(`run data never satisfied ${pred}; last: ${JSON.stringify(d.resume)}`);
    await sleep(30); // eslint-disable-line no-await-in-loop
  }
}
const reparked = async (run, prevAskId = run.askId) => {
  await settled(run, prevAskId);
  return askOf(run.runDir);
};

/** Is any `fwdloop resume` child for one of THIS file's roots still alive? */
function liveResumes() {
  const r = spawnSync('pgrep', ['-fa', 'fwdloop resume'], { encoding: 'utf8' });
  return (r.stdout || '').split('\n').filter((l) => l && ROOTS.some((root) => l.includes(root)));
}

after(async () => {
  for (const p of SERVER_PROCS) { try { process.kill(-p, 'SIGKILL'); } catch { /* already gone */ } }
  await Promise.all(HANDLES.map((h) => h.close()));
  // no leaked processes: every resume child started for this file's roots has exited
  await waitFor(() => liveResumes().length === 0, 8000).catch(() => {});
  assert.deepEqual(liveResumes(), [], 'no `fwdloop resume` child may outlive this file');
});

// ---------------------------------------------------------------------------
test('happy path: reject replies before the resume finishes, run re-parks at a NEW ask; accept with that askId completes the run', async () => {
  const run = parkRun();
  const { port } = await start(run);
  const token = await pageToken(port);

  const t0 = Date.now();
  const r1 = await answer(port, token, run, 'reject', 'tighten the skills section');
  const respMs = Date.now() - t0;
  assert.equal(r1.status, 202, r1.text);
  assert.equal(r1.json().resume, 'started', 'the reply says started, never done');
  // the reply landed BEFORE the resume did its work: the old ask is still the open one
  assert.equal(askOf(run.runDir).askId, run.askId, 'the reply must not wait for the resume');
  assert.equal(history(run.root).length, 0);

  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId);
  assert.ok(existsSync(path.join(run.runDir, `answer.${run.askId}.consumed.json`)));

  const r2 = await answer(port, token, { ...run, askId: a2.askId }, 'accept');
  assert.equal(r2.status, 202, r2.text);
  await waitFor(() => history(run.root).length === 1);
  assert.equal(history(run.root)[0].outcome, 'complete');
  assert.equal(consumedMarkers(run.runDir).length, 2);
  const data = await runData(port, run);
  assert.equal(data.glyph, '[✓]');
  console.log(`# MEASURE happy: reply=${respMs}ms, reject->re-park+accept->complete=${Date.now() - t0}ms`);
});

test('detached: the panel server process is SIGKILLed right after the reply; the resume still completes', async () => {
  const run = parkRun();
  const logDir = tmp('pr-srvlogs');
  LOGDIRS.push(logDir);
  const srv = spawn(process.execPath, [SERVE], {
    detached: true,
    stdio: ['ignore', 'pipe', 'inherit'],
    env: { ...serverEnv(), PANEL_ROOT: run.root, PANEL_LOGDIR: logDir },
  });
  SERVER_PROCS.push(srv.pid);
  const { port } = JSON.parse(await new Promise((res) => { srv.stdout.once('data', (d) => res(String(d))); }));
  const token = await pageToken(port);
  const r = await answer(port, token, run, 'reject', 'redo it');
  assert.equal(r.status, 202, r.text);
  process.kill(-srv.pid, 'SIGKILL'); // the whole panel process group, now
  await waitFor(() => { try { process.kill(srv.pid, 0); return false; } catch { return true; } }, 3000);
  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId, 'the resume must outlive the killed panel');
  assert.equal(consumedMarkers(run.runDir).length, 1);
});

test('exactly one: 10 concurrent valid identical POSTs — one accepted, nine refused by the library, one resume applied', async () => {
  const run = parkRun();
  const { port } = await start(run);
  const token = await pageToken(port);
  const rs = await Promise.all(Array.from({ length: 10 }, () => answer(port, token, run, 'reject', 'same answer')));
  const ok = rs.filter((r) => r.status === 202);
  assert.equal(ok.length, 1, `accepted: ${rs.map((r) => r.status)}`);
  for (const r of rs.filter((x) => x.status !== 202)) {
    assert.equal(r.json().refused, 'library');
    assert.match(r.json().red, /already answered/);
  }
  await settled(run);
  await sleep(300); // a second resume, if one existed, would have parked again by now
  assert.equal(readdirSync(path.join(run.runDir, 'asks')).length, 2, 'the original ask + exactly one re-park');
  assert.equal(consumedMarkers(run.runDir).length, 1);
});

test('(vii) lock held when the answer arrives, released inside the retry window: the run resumes, one resume applied, answer consumed once, more than one try', async () => {
  const run = parkRun();
  const { port } = await start(run, { windowMs: 2000, maxTries: 5 });
  const token = await pageToken(port);
  writeFileSync(lockPath(run), ''); // a resumer is "in flight"
  const r = await answer(port, token, run, 'reject', 'redo while locked');
  assert.equal(r.status, 202, r.text);
  await sleep(700); // tries at 0 and ~400 ms are refused by the lock
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), true, 'still unconsumed while locked');
  assert.equal(consumedMarkers(run.runDir).length, 0);
  unlinkSync(lockPath(run)); // released inside the window

  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId);
  assert.equal(consumedMarkers(run.runDir).length, 1, 'answer consumed once');
  assert.equal(readdirSync(path.join(run.runDir, 'asks')).length, 2, 'one resume applied: original + one re-park');
  const data = await runData(port, run);
  assert.equal(data.resume.state, 'took-over');
  assert.ok(data.resume.tries > 1, `the attempt record must show more than one try, got ${data.resume.tries}`);
});

test('(viii) lock held past the retry window: API says "answer saved, resume not started" + the refusal verbatim, never success; POST /api/resume later applies that answer exactly once', async () => {
  const run = parkRun();
  const { port } = await start(run, { windowMs: 1000, maxTries: 5 });
  const token = await pageToken(port);
  writeFileSync(lockPath(run), '');
  const r = await answer(port, token, run, 'reject', 'redo, but locked');
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json().resume, 'started');

  const stuck = await pollData(port, run, (d) => d.resume && d.resume.state === 'not-started');
  assert.equal(stuck.resume.label, 'answer saved, resume not started');
  assert.match(stuck.label, /^answer saved, resume not started$/, 'the glyph label says it too, never "answered"');
  assert.equal(stuck.resume.tries, 5, 'all five tries were used');
  assert.match(stuck.resume.reason, /^fwdloop: refused — resume: run "run-1" is locked by another resumer \(/, 'the resume\'s own refusal, verbatim');
  assert.ok(stuck.resume.reason.includes(lockPath(run)));
  assert.notEqual(stuck.glyph, '[✓]');
  assert.match(stuck.stopReasonWhy, /answer saved, resume not started/);
  const list = (await rq(port, { url: '/api/runs' })).json().rows.find((x) => x.runId === run.runId);
  assert.equal(list.label, 'answer saved, resume not started');
  // the answer is still on disk, unconsumed, and nothing re-parked
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), true);
  assert.equal(consumedMarkers(run.runDir).length, 0);
  assert.equal(askOf(run.runDir).askId, run.askId);

  // release the lock; "try the resume again" starts a resume and applies the SAME answer
  unlinkSync(lockPath(run));
  const again = await resumePost(port, token, run);
  assert.equal(again.status, 202, again.text);
  assert.equal(again.json().askId, run.askId);
  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId);
  assert.equal(consumedMarkers(run.runDir).length, 1, 'that same answer applied exactly once');
  assert.equal(readdirSync(path.join(run.runDir, 'asks')).length, 2);
  assert.equal((await runData(port, run)).resume.state, 'took-over');
});

test('a panel that restarted has no attempt record: a stuck answer still says so, with an honest reason, never blank', async () => {
  const run = parkRun();
  const first = await start(run, { windowMs: 1000, maxTries: 5 });
  const token1 = await pageToken(first.port);
  writeFileSync(lockPath(run), '');
  assert.equal((await answer(first.port, token1, run, 'reject', 'x')).status, 202);
  await sleep(1500);
  await first.close();
  const second = await start(run); // a new panel process' worth of state: empty
  const d = await runData(second.port, run);
  assert.equal(d.resume.state, 'not-started');
  assert.equal(d.label, 'answer saved, resume not started');
  assert.match(d.resume.reason, /reason unknown: the panel restarted/);
  unlinkSync(lockPath(run));
  const token2 = await pageToken(second.port);
  assert.equal((await resumePost(second.port, token2, run)).status, 202);
  assert.notEqual((await reparked(run)).askId, run.askId);
});

test('a non-lock refusal is not retried: one spawn, the refusal shown verbatim', async () => {
  const run = parkRun();
  const countFile = path.join(tmp('pr-count'), 'spawns.txt');
  const { port } = await start(run, {
    windowMs: 1000, maxTries: 5, bin: REFUSE_BIN, env: { ...serverEnv(), SPAWN_COUNT_FILE: countFile },
  });
  const token = await pageToken(port);
  const lines = () => (existsSync(countFile) ? readFileSync(countFile, 'utf8').split('\n').filter(Boolean) : []);
  assert.equal((await answer(port, token, run, 'reject', 'redo')).status, 202);
  let d = await pollData(port, run, (x) => x.resume && x.resume.state === 'not-started');
  await sleep(600); // with a 200 ms slot a retry would have happened by now
  assert.equal(lines().length, 1, `spawned ${lines().length} times; a non-lock refusal must not be retried`);
  d = await runData(port, run);
  assert.equal(d.resume.tries, 1);
  assert.equal(d.resume.reason, 'fwdloop: refused — resume: signature mismatch for run "run-1" — the flow changed while parked');
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), true);
});

test('POST /api/resume: refused by name with no saved answer, and with no token / foreign Origin / foreign Host; it cannot answer', async () => {
  const run = parkRun();
  const countFile = path.join(tmp('pr-count'), 'spawns.txt');
  const { port } = await start(run, { bin: REFUSE_BIN, env: { ...serverEnv(), SPAWN_COUNT_FILE: countFile } });
  const token = await pageToken(port);
  const body = { flow: run.flow, runId: run.runId };

  const none = await resumePost(port, token, run);
  assert.equal(none.status, 409);
  assert.equal(none.json().refused, 'no-saved-answer');
  // it takes no decision: a decision in the body does not answer anything
  const sneaky = await rq(port, {
    method: 'POST', url: '/api/resume', headers: good(port, token), body: { ...body, askId: run.askId, decision: 'accept' },
  });
  assert.equal(sneaky.json().refused, 'no-saved-answer');
  assert.deepEqual(readdirSync(run.runDir).filter((f) => f.startsWith('answer.')), [], '/api/resume must never write an answer');

  const noTok = await resumePost(port, token, run, { origin: `http://127.0.0.1:${port}`, 'content-type': 'application/json' });
  assert.equal(noTok.status, 403);
  assert.equal(noTok.json().refused, 'token-missing-or-wrong');
  const badOrigin = await resumePost(port, token, run, { ...good(port, token), origin: 'http://evil.example.com' });
  assert.equal(badOrigin.json().refused, 'origin-not-own');
  const badHost = await resumePost(port, token, run, { ...good(port, token), host: 'evil.example.com' });
  assert.equal(badHost.status, 403);
  assert.equal(badHost.json().refused, 'host-not-own-address');
  const badFlow = await rq(port, {
    method: 'POST', url: '/api/resume', headers: good(port, token), body: { flow: '../x', runId: run.runId },
  });
  assert.equal(badFlow.json().refused, 'bad-flow');
  assert.equal(existsSync(countFile), false, 'none of these may start a resume process');
});

test('key hygiene: the sentinel key is in 0 HTTP responses, 0 book files and 0 resume logs', async () => {
  const run = parkRun();
  const { port, logDir } = await start(run, { windowMs: 1000, maxTries: 5 });
  const token = await pageToken(port);
  SEEN.length = 0;
  writeFileSync(lockPath(run), '');
  await answer(port, token, run, 'reject', 'hygiene');
  await sleep(1400); // stuck: its log now holds a lock refusal
  for (const url of ['/', '/api/runs', '/api/inbox', `/api/runs/${run.flow}/${run.runId}`, `/api/runs/${run.flow}/${run.runId}/audit`, `/api/runs/${run.flow}/${run.runId}/asks`]) {
    await rq(port, { url }); // eslint-disable-line no-await-in-loop
  }
  await resumePost(port, 'f'.repeat(64), run); // a refusal body too
  unlinkSync(lockPath(run));
  await resumePost(port, token, run);
  const a2 = await reparked(run);
  await answer(port, token, { ...run, askId: a2.askId }, 'accept');
  await waitFor(() => history(run.root).length === 1);
  await rq(port, { url: `/api/runs/${run.flow}/${run.runId}` });

  assert.ok(SEEN.length >= 9);
  for (const s of SEEN) assert.equal(s.includes(SENTINEL), false, `sentinel in an HTTP response: ${s.slice(0, 80)}`);
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const logs = walk(logDir);
  assert.ok(logs.length >= 1, 'a resume log must exist for this check to mean anything');
  assert.ok(logs.some((f) => readFileSync(f, 'utf8').includes('locked by another resumer')), 'the log holds the real refusal');
  for (const f of [...walk(run.root), ...logs]) assert.equal(readFileSync(f).includes(SENTINEL), false, `sentinel in ${f}`);
  console.log(`# MEASURE hygiene: ${SEEN.length} responses, ${walk(run.root).length} book files, ${logs.length} log file(s) scanned, 0 sentinel hits`);
});
