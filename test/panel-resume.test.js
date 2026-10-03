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
  existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync,
} from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { createPanelServer } from '../src/panel/server.js';
import { TOKENS, remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { listStops } from '../src/panel/data.js';
import { spawnHolder } from './fixtures/lock-holder.mjs';

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
/** A live resumer "in flight": a real fwdloop-named process that holds resume.lock (M4c amendment 2 (d)). */
const HOLDERS = [];
async function holdLock(run) {
  const h = await spawnHolder(tmp('holder'));
  HOLDERS.push(h);
  writeFileSync(lockPath(run), h.lockText);
  return h;
}
after(async () => { for (const h of HOLDERS) { try { await h.kill(); } catch { /* gone */ } } });

/** Start a panel server in this process; `resume` overrides only what a test must (window, bin). */
async function start(run, resume = {}) {
  const logDir = tmp('pr-logs');
  LOGDIRS.push(logDir);
  const h = remember(await createPanelServer({
    port: 0, root: run.root, resume: { env: serverEnv(), logDir, ...resume },
  }));
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
    const h = { host: `127.0.0.1:${port}`, ...cookieHeader(port), ...headers };
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
  const t = TOKENS.get(port);
  assert.ok(t, 'start() must remember the panel');
  return t;
}
const good = (port, token) => ({ origin: `http://127.0.0.1:${port}`, ...cookieHeader(port, token), 'content-type': 'application/json' });
const answer = (port, token, run, decision, reason, extra = {}) => rq(port, {
  method: 'POST',
  url: '/api/answer',
  headers: good(port, token),
  body: {
    flow: run.flow, runId: run.runId, askId: run.askId, decision, ...(reason ? { reason } : {}), ...extra,
  },
});
/** Answer, waiting out "already-resuming": the previous resume child has re-parked but not yet exited (M4c-fix item 1). */
const answerIdle = async (port, token, run, decision, reason, extra = {}) => {
  for (let i = 0; i < 200; i += 1) {
    const r = await answer(port, token, run, decision, reason, extra);
    if (r.json()?.refused !== 'already-resuming') return r;
    await sleep(25);
  }
  throw new Error('still already-resuming after 5 s');
};
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
  const r1 = await answer(port, token, run, 'redo', 'tighten the skills section');
  const respMs = Date.now() - t0;
  assert.equal(r1.status, 202, r1.text);
  assert.equal(r1.json().resume, 'started', 'the reply says started, never done');
  // the reply landed BEFORE the resume did its work: the old ask is still the open one
  assert.equal(askOf(run.runDir).askId, run.askId, 'the reply must not wait for the resume');
  assert.equal(history(run.root).length, 0);

  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId);
  assert.ok(existsSync(path.join(run.runDir, `answer.${run.askId}.consumed.json`)));
  // M4b amendment 3 (xii, panel half): the consumed answer says redo, and the step before the ask was redone with the reason
  assert.equal(JSON.parse(readFileSync(path.join(run.runDir, `answer.${run.askId}.consumed.json`), 'utf8')).decision, 'redo');
  const auditRows = readFileSync(path.join(run.runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.ok(auditRows.some((r) => r.class === 'hitl' && r.verdict === 'red' && r.gap === 'tighten the skills section'));
  assert.ok(auditRows.filter((r) => r.step === 'resume-summary' && r.class !== 'hitl' && r.verdict === 'green').length >= 2, 'the step before the ask ran again');

  const r2 = await answerIdle(port, token, { ...run, askId: a2.askId }, 'accept');
  assert.equal(r2.status, 202, r2.text);
  await waitFor(() => history(run.root).length === 1);
  assert.equal(history(run.root)[0].outcome, 'complete');
  assert.equal(consumedMarkers(run.runDir).length, 2);
  const data = await runData(port, run);
  assert.equal(data.glyph, '[✓]');
  console.log(`# MEASURE happy: reply=${respMs}ms, reject->re-park+accept->complete=${Date.now() - t0}ms`);
});

test('re-parked ask (reject -> new ask): glyph says waiting on you and the inbox shows the NEW ask open, despite the old ask\'s consumed marker', async () => {
  const run = parkRun();
  const { port } = await start(run);
  const token = await pageToken(port);
  assert.equal((await answer(port, token, run, 'redo', 'redo it')).status, 202);
  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId);
  assert.ok(existsSync(path.join(run.runDir, `answer.${run.askId}.consumed.json`)), 'the OLD ask keeps its consumed marker');
  const data = await runData(port, run);
  assert.equal(data.glyph, '[·]');
  assert.match(data.label, /waiting on you/, `label was: ${data.label}`);
  assert.match(data.stopReasonWhy ?? '', /^waiting on you:/, `stop reason was: ${data.stopReasonWhy}`);
  const inbox = (await rq(port, { url: '/api/inbox' })).json();
  const rows = inbox.rows.filter((r) => r.runId === run.runId);
  const open = rows.filter((r) => r.open);
  assert.equal(open.length, 1, JSON.stringify(rows));
  assert.equal(open[0].askId, a2.askId);
});

test('inbox: open ask counts as waiting; saved-unconsumed answer does NOT and is labelled in words; consumed closes it', () => {
  const run = parkRun();
  const mine = () => listStops({ root: run.root }).filter((r) => r.runId === run.runId);
  const before = mine();
  assert.equal(before.length, 1);
  assert.equal(before[0].open, true);
  assert.equal(before[0].waiting, true, 'unanswered ask waits on the human');
  assert.equal(before[0].resume, null);
  assert.equal(typeof before[0].timeLeftMs, 'number');

  // the human answered (answer.json saved) but nothing consumed it yet
  writeFileSync(path.join(run.runDir, 'answer.json'), JSON.stringify({ askId: run.askId, decision: 'accept' }));
  const saved = mine();
  assert.equal(saved.length, 1);
  assert.equal(saved[0].waiting, false, 'an answered ask is not waiting on the human');
  assert.equal(saved[0].timeLeftMs, null, 'no countdown for an answer that was already given');
  assert.equal(saved[0].resume.label, 'answer saved, resume not started');
  const withAttempt = listStops({
    root: run.root, resumeAttempt: () => ({ state: 'in-flight', askId: run.askId, tries: 1, maxTries: 3 }),
  }).filter((r) => r.runId === run.runId);
  assert.equal(withAttempt[0].resume.label, 'answer saved, resume starting');
  assert.equal(withAttempt[0].waiting, false);

  // consumed: the answer file is renamed away
  renameSync(path.join(run.runDir, 'answer.json'), path.join(run.runDir, `answer.${run.askId}.consumed.json`));
  const after = mine();
  assert.ok(after.every((r) => r.waiting === false), JSON.stringify(after));
  assert.ok(after.every((r) => r.resume === null));
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
  const { port, token } = JSON.parse(await new Promise((res) => { srv.stdout.once('data', (d) => res(String(d))); }));
  TOKENS.set(port, token);
  const r = await answer(port, token, run, 'redo', 'redo it');
  assert.equal(r.status, 202, r.text);
  process.kill(-srv.pid, 'SIGKILL'); // the whole panel process group, now
  await waitFor(() => { try { process.kill(srv.pid, 0); return false; } catch { return true; } }, 3000);
  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId, 'the resume must outlive the killed panel');
  assert.equal(consumedMarkers(run.runDir).length, 1);
});

test('exactly one: 10 concurrent valid identical POSTs — one accepted, nine refused (already-resuming or by the library), one resume applied', async () => {
  const run = parkRun();
  const { port } = await start(run);
  const token = await pageToken(port);
  const rs = await Promise.all(Array.from({ length: 10 }, () => answer(port, token, run, 'redo', 'same answer')));
  const ok = rs.filter((r) => r.status === 202);
  assert.equal(ok.length, 1, `accepted: ${rs.map((r) => r.status)}`);
  for (const r of rs.filter((x) => x.status !== 202)) {
    // while the one accepted resume is alive: refused "already-resuming" (M4c-fix item 1); once it has exited: the library's "already answered"
    assert.equal(r.status, 409);
    assert.ok(['already-resuming', 'library'].includes(r.json().refused), r.text);
    if (r.json().refused === 'library') assert.match(r.json().red, /already answered/);
  }
  await settled(run);
  await sleep(300); // a second resume, if one existed, would have parked again by now
  assert.equal(readdirSync(path.join(run.runDir, 'asks')).length, 2, 'the original ask + exactly one re-park');
  assert.equal(consumedMarkers(run.runDir).length, 1);
});

test('(vii) lock held when the answer arrives, released inside the retry window: the run resumes, one resume applied, answer consumed once, more than one try', async () => {
  const run = parkRun();
  // Event-driven, not wall-clock: a generous per-try deadline (windowMs) so CPU load cannot
  // make a slow child start read as "stuck"; the lock is released only once the attempt
  // record shows try 2 (try 1 was refused by the lock), and held until then.
  const { port } = await start(run, { windowMs: 30000, maxTries: 5, slotMs: 400 });
  const token = await pageToken(port);
  const holder = await holdLock(run); // a resumer is "in flight"
  const r = await answer(port, token, run, 'redo', 'redo while locked');
  assert.equal(r.status, 202, r.text);
  await pollData(port, run, (d) => d.resume && d.resume.tries >= 2, 30000);
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), true, 'still unconsumed while locked');
  assert.equal(consumedMarkers(run.runDir).length, 0);
  await holder.kill(); // the holder dies inside the window: the next try clears its lock and resumes

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
  const { port } = await start(run, { windowMs: 30000, maxTries: 5, slotMs: 100 });
  const token = await pageToken(port);
  const holder = await holdLock(run);
  const r = await answer(port, token, run, 'redo', 'redo, but locked');
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json().resume, 'started');

  const stuck = await pollData(port, run, (d) => d.resume && d.resume.state === 'not-started', 30000);
  assert.equal(stuck.resume.label, 'answer saved, resume not started');
  assert.match(stuck.label, /^working on your answer$/, 'a live holder is carrying it on (amendment 2 (e)): [▶], never stuck, never "answered"');
  assert.equal(stuck.glyph, '[▶]');
  assert.equal(stuck.resume.tries, 5, 'all five tries were used');
  assert.match(stuck.resume.reason, /^fwdloop: refused — resume: run "run-1" is locked by another resumer \(pid \d+, /, 'the resume\'s own refusal, verbatim, naming the live holder');
  assert.ok(stuck.resume.reason.includes(lockPath(run)));
  assert.notEqual(stuck.glyph, '[✓]');
  assert.match(stuck.stopReasonWhy, /answer saved, resume not started/);
  const list = (await rq(port, { url: '/api/runs' })).json().rows.find((x) => x.runId === run.runId);
  assert.equal(list.label, 'working on your answer');
  // the answer is still on disk, unconsumed, and nothing re-parked
  assert.equal(existsSync(path.join(run.runDir, 'answer.json')), true);
  assert.equal(consumedMarkers(run.runDir).length, 0);
  assert.equal(askOf(run.runDir).askId, run.askId);

  // release the lock; "try the resume again" starts a resume and applies the SAME answer
  await holder.kill(); // a dead holder's lock is cleared by the resume itself
  const again = await resumePost(port, token, run);
  assert.equal(again.status, 202, again.text);
  assert.equal(again.json().askId, run.askId);
  const a2 = await reparked(run);
  assert.notEqual(a2.askId, run.askId);
  assert.equal(consumedMarkers(run.runDir).length, 1, 'that same answer applied exactly once');
  assert.equal(readdirSync(path.join(run.runDir, 'asks')).length, 2);
  assert.equal((await runData(port, run)).resume.state, 'took-over');
});

test('M4b p3 (iii) panel path: accept through POST /api/answer records the hash; the artifact tampered before the resume -> the real send refuses by name, nothing shipped', async () => {
  const runId = 'p3-panel-tamper';
  const sendDir = path.join(REPO, 'poc', 'm0', 'out');
  const shipped = () => (existsSync(sendDir) ? readdirSync(sendDir).filter((f) => f.startsWith(`${runId}-`)) : []);
  const clean = () => { for (const f of shipped()) unlinkSync(path.join(sendDir, f)); };
  clean();
  try {
    const run = parkRun(runId);
    const priorFile = path.join(run.runDir, 'artifacts', 'resume-summary.json');
    const { port } = await start(run, { windowMs: 30000, maxTries: 2, slotMs: 100 });
    const token = await pageToken(port);
    const holder = await holdLock(run); // hold the lock so the answer is SAVED, not yet applied
    const r = await answer(port, token, run, 'accept');
    assert.equal(r.status, 202, r.text);
    const saved = JSON.parse(readFileSync(path.join(run.runDir, 'answer.json'), 'utf8'));
    assert.equal(saved.artifactSha256, createHash('sha256').update(readFileSync(priorFile)).digest('hex'), 'the panel path records the hash (answerAsk is the only writer)');
    await pollData(port, run, (d) => d.resume && d.resume.state === 'not-started', 30000);

    const before = readFileSync(priorFile, 'utf8');
    const edited = before.replace(/"text": "(.)/, (m, c) => `"text": "${c === 'X' ? 'Y' : 'X'}`);
    assert.notEqual(edited, before);
    writeFileSync(priorFile, edited);
    await holder.kill();
    assert.equal((await resumePost(port, token, run)).status, 202);
    await waitFor(() => history(run.root).length === 1);
    const row = history(run.root)[0];
    assert.equal(row.outcome, 'red');
    assert.ok(typeof row.signatureHash === 'string' && row.signatureHash.length > 0);
    assert.deepEqual(shipped(), [], 'nothing reaches the destination');
    const audit = readFileSync(path.join(run.runDir, 'audit.jsonl'), 'utf8');
    assert.match(audit, /changed after it was accepted/);
  } finally { clean(); }
});

test('resume log: kept with its refusal text while the resume is locked out, deleted once a resume exits 0', async () => {
  const run = parkRun();
  const { port, logDir } = await start(run, { windowMs: 30000, maxTries: 5, slotMs: 100 });
  const token = await pageToken(port);
  const logs = () => readdirSync(logDir).filter((f) => f.endsWith('.log')).map((f) => path.join(logDir, f));
  const holder = await holdLock(run);
  await answer(port, token, run, 'redo', 'redo, but locked');
  await pollData(port, run, (d) => d.resume && d.resume.state === 'not-started', 30000);
  assert.equal(logs().length, 1, 'a refused resume keeps its log');
  assert.match(readFileSync(logs()[0], 'utf8'), /locked by another resumer/);

  await holder.kill();
  await resumePost(port, token, run);
  await reparked(run);
  await waitFor(() => logs().length === 0);
  assert.deepEqual(logs(), [], 'a resume that exited 0 leaves no log');
});

test('a panel that restarted has no attempt record: a stuck answer still says so, with an honest reason, never blank', async () => {
  const run = parkRun();
  const first = await start(run, { windowMs: 30000, maxTries: 5, slotMs: 100 });
  const token1 = await pageToken(first.port);
  const holder = await holdLock(run);
  assert.equal((await answer(first.port, token1, run, 'redo', 'x')).status, 202);
  await pollData(first.port, run, (d) => d.resume && d.resume.state === 'not-started', 30000); // stuck: all tries refused by the lock
  await first.close();
  await holder.kill(); // the holder is gone now: nobody carries the answer on
  const second = await start(run); // a new panel process' worth of state: empty
  const d = await runData(second.port, run);
  assert.equal(d.resume.state, 'not-started');
  assert.equal(d.label, 'stuck — answer saved, click try the resume again');
  assert.equal(d.glyph, '[II]');
  assert.match(d.resume.reason, /reason unknown: the panel restarted/);
  const token2 = await pageToken(second.port);
  assert.equal((await resumePost(second.port, token2, run)).status, 202);
  assert.notEqual((await reparked(run)).askId, run.askId);
});

test('a non-lock refusal is not retried: one spawn, the refusal shown verbatim', async () => {
  const run = parkRun();
  const countFile = path.join(tmp('pr-count'), 'spawns.txt');
  const { port } = await start(run, {
    windowMs: 30000, maxTries: 5, slotMs: 200, bin: REFUSE_BIN, env: { ...serverEnv(), SPAWN_COUNT_FILE: countFile },
  });
  const token = await pageToken(port);
  const lines = () => (existsSync(countFile) ? readFileSync(countFile, 'utf8').split('\n').filter(Boolean) : []);
  assert.equal((await answer(port, token, run, 'redo', 'redo')).status, 202);
  let d = await pollData(port, run, (x) => x.resume && x.resume.state === 'not-started', 30000);
  await sleep(600); // with a 200 ms slot a retry would have happened by now (a negative check: load can only make it pass, never fail)
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

  const noTok = await resumePost(port, token, run, { origin: `http://127.0.0.1:${port}`, cookie: '', 'content-type': 'application/json' });
  assert.equal(noTok.status, 403);
  assert.equal(noTok.json().refused, 'cookie-missing-or-wrong');
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
  const { port, logDir } = await start(run, { windowMs: 30000, maxTries: 5, slotMs: 100 });
  const token = await pageToken(port);
  SEEN.length = 0;
  const holder = await holdLock(run);
  await answer(port, token, run, 'redo', 'hygiene');
  await pollData(port, run, (d) => d.resume && d.resume.state === 'not-started', 30000); // stuck: its log now holds a lock refusal
  const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  const logs = walk(logDir); // a clean resume deletes its log, so this is the one moment the log can be scanned
  const logTexts = logs.map((f) => readFileSync(f, 'utf8'));
  for (const url of ['/', '/api/runs', '/api/inbox', `/api/runs/${run.flow}/${run.runId}`, `/api/runs/${run.flow}/${run.runId}/audit`, `/api/runs/${run.flow}/${run.runId}/asks`]) {
    await rq(port, { url }); // eslint-disable-line no-await-in-loop
  }
  await resumePost(port, 'f'.repeat(64), run); // a refusal body too
  await holder.kill();
  await resumePost(port, token, run);
  const a2 = await reparked(run);
  await answerIdle(port, token, { ...run, askId: a2.askId }, 'accept');
  await waitFor(() => history(run.root).length === 1);
  await rq(port, { url: `/api/runs/${run.flow}/${run.runId}` });

  assert.ok(SEEN.length >= 9);
  for (const s of SEEN) assert.equal(s.includes(SENTINEL), false, `sentinel in an HTTP response: ${s.slice(0, 80)}`);
  assert.ok(logs.length >= 1, 'a resume log must exist for this check to mean anything');
  assert.ok(logTexts.some((t) => t.includes('locked by another resumer')), 'the log holds the real refusal');
  for (const t of logTexts) assert.equal(t.includes(SENTINEL), false, 'sentinel in a resume log');
  for (const f of walk(run.root)) assert.equal(readFileSync(f).includes(SENTINEL), false, `sentinel in ${f}`);
  console.log(`# MEASURE hygiene: ${SEEN.length} responses, ${walk(run.root).length} book files, ${logs.length} log file(s) scanned, 0 sentinel hits`);
});

// --- M4c-fix item 1: one resume at a time per run ---------------------------------------------------
const SLEEP_BIN = path.join(REPO, 'scripts', 'panel-fixtures', 'panel-resume-sleep.mjs');
const spawnCount = (f) => (existsSync(f) ? readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).length : 0);

test('item 1 (i): while a run is resuming, a second Resume and a second Answer get 409 already-resuming and no second process starts; once the child exits, a Resume starts again', async () => {
  const run = parkRun();
  const dir = tmp('one-at-a-time');
  const countFile = path.join(dir, 'spawns');
  const releaseFile = path.join(dir, 'release');
  // a short per-try window: the attempt turns "stuck" (not in-flight) while the child is STILL alive —
  // the case a state-only check misses
  const { port } = await start(run, {
    windowMs: 300, maxTries: 1, bin: SLEEP_BIN, env: { ...serverEnv(), SPAWN_COUNT_FILE: countFile, RELEASE_FILE: releaseFile },
  });
  const token = await pageToken(port);
  try {
    assert.equal((await answer(port, token, run, 'redo', 'tighten it')).status, 202);
    await waitFor(() => spawnCount(countFile) === 1);
    const r1 = await resumePost(port, token, run); // in flight
    assert.equal(r1.status, 409, r1.text);
    assert.equal(r1.json().refused, 'already-resuming');
    await pollData(port, run, (d) => d.resume && d.resume.state === 'not-started', 10000); // window passed, child alive
    const r2 = await resumePost(port, token, run);
    assert.equal(r2.status, 409, r2.text);
    assert.equal(r2.json().refused, 'already-resuming');
    assert.match(r2.json().red, /already resuming/);
    const a2 = await answer(port, token, run, 'accept');
    assert.equal(a2.status, 409, a2.text);
    assert.equal(a2.json().refused, 'already-resuming');
    await sleep(300);
    assert.equal(spawnCount(countFile), 1, 'no second resume process was started');
    assert.equal(existsSync(path.join(run.runDir, 'answer.json')), true, 'the saved answer is untouched by the refused clicks');
    assert.equal(JSON.parse(readFileSync(path.join(run.runDir, 'answer.json'), 'utf8')).decision, 'redo');

    writeFileSync(releaseFile, ''); // the child exits -> the run is free again
    let again = await resumePost(port, token, run);
    for (let i = 0; i < 200 && again.json().refused === 'already-resuming'; i += 1) { await sleep(25); again = await resumePost(port, token, run); }
    assert.equal(again.status, 202, again.text);
    await waitFor(() => spawnCount(countFile) === 2);
  } finally {
    writeFileSync(releaseFile, '');
  }
});
