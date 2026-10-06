// M4e piece 2a, items 3-6 (docs/wiki/the-module-ladder.md, "M4e", scope 5-7, 11-12; negatives (ii) (iii) (iv) (v) (vi)
// (vii) (viii) (ix) (xii) (xiv)-backend (xvi) (xvii)): the panel's DRAFT door, driven over real HTTP against the real
// `bin/fwdloop draft` child with the test draft provider. $0, no network. Scratch HOME / FWDLOOP_CONFIG_HOME per world,
// removed at exit; every child a test starts is killed by `after`.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { createPanelServer } from '../src/panel/server.js';
import { keysForDoor, keysFilePath, chmodSentence } from '../src/keysfile.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { spendSummary } from '../src/monthly.js';
import { parseSignedText } from '../src/signed-text.js';
import { REFUSAL_SENTENCE } from '../src/monthly.js';
import { remember, cookieHeader } from '../scripts/panel-fixtures/panel-auth.mjs';
import { job2Fixture } from './drafter-fixture.mjs';
import { BOX_JOB, BOX_JOB_FILE, inputsText } from './m4e-box-fixture.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FAKE_DRAFT = path.join(HERE, 'fixtures', 'cli-fake-draft-provider.mjs');
const CANARY = 'sk-canary-M4E-piece2a-7f3a9c1d2b8e4f60aa55';
const JOB = BOX_JOB;
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-ar-${p}-`));
const sleep = (ms) => new Promise((r) => { setTimeout(r, ms); });

const HANDLES = [];
const ROOTS = [];
after(async () => {
  for (const root of ROOTS) { // kill every draft child a test left running
    const dd = path.join(root, '.drafts');
    if (!existsSync(dd)) continue;
    for (const id of readdirSync(dd)) {
      try {
        const pid = JSON.parse(readFileSync(path.join(dd, id, 'pid.json'), 'utf8'));
        if (isFwdloopAlive(pid.pid, pid.procStart) === true) process.kill(-pid.pid, 'SIGKILL');
      } catch { /* none */ }
    }
  }
  await Promise.all(HANDLES.map((h) => h.close()));
});

function rq(port, {
  method = 'GET', url = '/', headers = {}, body,
} = {}) {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : (typeof body === 'string' ? body : JSON.stringify(body));
    const hd = { host: `127.0.0.1:${port}`, ...cookieHeader(port), ...headers };
    if (method === 'POST' && hd.origin === undefined) hd.origin = `http://127.0.0.1:${port}`;
    if (hd.origin === null) delete hd.origin;
    if (hd.cookie === null) delete hd.cookie;
    if (data !== undefined) hd['content-length'] = Buffer.byteLength(data);
    const r = http.request({ host: '127.0.0.1', port, method, path: url, headers: hd, agent: false }, (res) => {
      const ch = [];
      res.on('data', (c) => ch.push(c));
      res.on('end', () => {
        const text = Buffer.concat(ch).toString('utf8');
        resolve({ status: res.statusCode, text, json() { try { return JSON.parse(text); } catch { return null; } } });
      });
    });
    r.on('error', reject);
    if (data !== undefined) r.write(data);
    r.end();
  });
}

/** A world: flows root, config home (0700) with a keys file holding the CANARY (0600), inputs, a destination, a panel on port 0. */
async function world({ limit, mode, keysMode = 0o600 } = {}) {
  const work = tmp('w');
  const root = path.join(work, 'flows');
  const inDir = path.join(work, 'in');
  const outDir = path.join(work, 'out');
  const home = path.join(work, 'cfg', 'fwdloop');
  for (const d of [root, inDir, outDir]) mkdirSync(d);
  mkdirSync(home, { recursive: true, mode: 0o700 });
  writeFileSync(keysFilePath(home), `DEEPSEEK_API_KEY=${CANARY}\n`, { mode: keysMode });
  chmodSync(keysFilePath(home), keysMode);
  if (limit !== undefined) writeFileSync(path.join(home, 'config.json'), JSON.stringify({ monthlyLimitUsd: limit }));
  writeFileSync(path.join(inDir, 'resume.md'), '# R\n');
  writeFileSync(path.join(inDir, 'jd.md'), '# J\n');
  const env = {
    PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home, FWDLOOP_TEST_DRAFT_PROVIDER: FAKE_DRAFT, ...(mode ? { FWDLOOP_TEST_DRAFT_MODE: mode } : {}),
  };
  const open = async () => {
    const h = remember(await createPanelServer({
      port: 0, root, settings: { home, env: {} }, author: { loadEnv: () => keysForDoor({ env, keysHome: home }) },
    }));
    HANDLES.push(h);
    return h;
  };
  ROOTS.push(root);
  const h = await open();
  const card = (over = {}) => ({
    flowName: 'job2', job: JOB, capUsd: '0.25', askWait: '1h', destination: outDir,
    inputs: inputsText([['resume', path.join(inDir, 'resume.md')], ['jd', path.join(inDir, 'jd.md')]]), ...over,
  });
  const post = (url, body, headers) => rq(h.port, { method: 'POST', url, body, headers });
  const get = (url, headers) => rq(h.port, { url, headers });
  return {
    work, root, inDir, outDir, home, env, h, open, card, post, get, drafts: () => (existsSync(path.join(root, '.drafts')) ? readdirSync(path.join(root, '.drafts')) : []),
    dir: (id) => path.join(root, '.drafts', id),
  };
}

async function until(fn, ms = 20000) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn(); // eslint-disable-line no-await-in-loop
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error(`until timed out: ${fn}`);
    await sleep(25); // eslint-disable-line no-await-in-loop
  }
}
const phaseOf = (w, id, phases) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return phases.includes(j?.phase) ? j : null; });

test('(ii) the draft door is the SAME gated door: no/foreign Origin, foreign Host, wrong method -> refused, nothing created', async () => {
  const w = await world();
  const body = w.card();
  const cases = [
    [{ headers: { origin: null } }, 403], [{ headers: { origin: 'http://evil.example' } }, 403], [{ headers: { host: 'evil.example' } }, 403],
  ];
  for (const [c, want] of cases) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await rq(w.h.port, { method: 'POST', url: '/api/author/draft', body, ...c })).status, want, JSON.stringify(c));
  }
  assert.equal((await rq(w.h.port, { url: '/api/author/draft' })).status, 404, 'a GET of the POST door is not a door');
  assert.equal((await w.post('/api/author/nope', {})).status, 404);
  assert.equal((await w.post('/api/author/draft', 'not json')).status, 400);
  const big = await w.post('/api/author/draft', { ...body, job: 'x'.repeat(70 * 1024) });
  assert.equal(big.status, 413);
  assert.deepEqual(w.drafts(), [], 'no draft folder was created by any refusal');
});

test('(3,5) a valid card -> 202 {draftId}; the draft folder holds card.json, prose.txt, child.log (0600), pid.json and the CLI output; the plan reads green with its hash; .drafts is no flow', async () => {
  const w = await world();
  const r = await w.post('/api/author/draft', w.card());
  assert.equal(r.status, 202, r.text);
  const { draftId } = r.json();
  const dir = w.dir(draftId);
  const j = await phaseOf(w, draftId, ['green', 'red', 'stopped']);
  assert.equal(j.phase, 'green', JSON.stringify(j));
  assert.equal(j.hash, readFileSync(path.join(dir, 'draft', 'spec.hash'), 'utf8').trim());
  assert.match(j.readout, /job2/);
  assert.deepEqual(j.card, {
    flowName: 'job2', job: JOB, capUsd: 0.25, askWait: '1h', destination: w.outDir, inputs: w.card().inputs,
  }, 'the card is returned as typed');
  for (const f of ['card.json', 'prose.txt', 'child.log', 'pid.json']) assert.ok(existsSync(path.join(dir, f)), f);
  assert.equal(statSync(path.join(dir, 'child.log')).mode & 0o777, 0o600);
  const pid = JSON.parse(readFileSync(path.join(dir, 'pid.json'), 'utf8'));
  assert.ok(Number.isInteger(pid.pid) && typeof pid.procStart === 'string');
  assert.equal(JSON.parse(readFileSync(path.join(dir, 'card.json'), 'utf8')).flowName, 'job2');
  assert.equal(parseSignedText(readFileSync(path.join(dir, 'prose.txt'), 'utf8')).ok, true);
  assert.ok(readFileSync(path.join(dir, 'prose.txt'), 'utf8').startsWith(`${BOX_JOB_FILE}\n\nArbiter guardrails`), 'the job box became exactly the job file');
  // a dot-name is never a flow: the panel's own lists do not show .drafts
  const runs = (await w.get('/api/runs')).json();
  assert.deepEqual(runs.rows, []);
  assert.equal((await w.get('/api/author/not-an-id')).status, 404);
});

test('(iii)(iv)(v) refusals over HTTP name the box, spend $0 and create nothing — no draft folder, no child, no ledger row', async () => {
  const w = await world();
  mkdirSync(path.join(w.root, 'taken'));
  const cases = [
    [{ flowName: 'taken' }, 'flowName'], [{ flowName: '../x' }, 'flowName'], [{ flowName: 'a/b' }, 'flowName'],
    [{ inputs: `resume: ${w.inDir}` }, 'inputs'],
    [{ inputs: `resume: ${path.join(w.inDir, 'missing.md')}` }, 'inputs'],
    [{ inputs: `: ${path.join(w.inDir, 'resume.md')}` }, 'inputs'], [{ inputs: 'no colon' }, 'inputs'],
    [{ job: '~early\nstep' }, 'job'], [{ askWait: '30s' }, 'askWait'],
    [{ capUsd: '0' }, 'capUsd'], [{ destination: w.root }, 'destination'],
  ];
  for (const [over, field] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/draft', w.card(over));
    assert.equal(r.status, 400, JSON.stringify(over));
    assert.equal(r.json().refused, 'card');
    assert.ok(r.json().refusals.some((x) => x.field === field && x.say.length > 10), `${JSON.stringify(over)} -> ${r.text}`);
  }
  assert.deepEqual(w.drafts(), []);
  assert.equal(existsSync(path.join(w.home, 'runs.jsonl')), false, 'no hold row: nothing reached the money door');
});

test('(vi) two POSTs together for one flow start exactly one child; a second flow name is refused too while one is live', async () => {
  for (let i = 0; i < 3; i += 1) {
    const w = await world({ mode: 'hang' }); // eslint-disable-line no-await-in-loop
    const rs = await Promise.all([w.post('/api/author/draft', w.card()), w.post('/api/author/draft', w.card())]); // eslint-disable-line no-await-in-loop
    assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409], rs.map((r) => r.text).join(' | '));
    assert.equal(rs.find((r) => r.status === 409).json().refused, 'draft-live');
    assert.equal(w.drafts().length, 1, 'one draft folder');
    assert.equal(readdirSync(w.dir(w.drafts()[0])).includes('pid.json'), true);
    const other = await w.post('/api/author/draft', w.card({ flowName: 'another' })); // eslint-disable-line no-await-in-loop
    assert.equal(other.status, 409, 'one live draft blocks any new draft');
    assert.equal(w.drafts().length, 1);
  }
});

test('(vii) over the monthly limit the child refuses at $0: the draft reads stopped with the signed sentence; nothing booked, no draft output', async () => {
  const w = await world({ limit: 0.00001 });
  const r = await w.post('/api/author/draft', w.card());
  assert.equal(r.status, 202);
  const j = await phaseOf(w, r.json().draftId, ['stopped', 'green']);
  assert.equal(j.phase, 'stopped');
  assert.ok(j.say.includes(REFUSAL_SENTENCE), j.say);
  assert.ok(!existsSync(path.join(w.dir(r.json().draftId), 'draft')), 'no draft output');
  assert.equal(spendSummary({ home: w.home }).total.usd, 0);
});

test('(viii) a keys file other users can read refuses the draft at the door with the chmod sentence; nothing is created', async () => {
  const w = await world({ keysMode: 0o640 });
  const r = await w.post('/api/author/draft', w.card());
  assert.equal(r.status, 409);
  assert.equal(r.json().refused, 'keys-file');
  assert.equal(r.json().say, chmodSentence(w.home));
  assert.deepEqual(w.drafts(), []);
  assert.ok(!r.text.includes(CANARY));
});

/** Every file under `dir` (recursive) -> its text, optionally skipping names. */
function filesUnder(dir, skip = []) {
  const out = {};
  const walk = (d) => {
    for (const n of readdirSync(d)) {
      const f = path.join(d, n);
      if (statSync(f).isDirectory()) walk(f);
      else if (!skip.includes(n)) out[f] = readFileSync(f, 'utf8');
    }
  };
  walk(dir);
  return out;
}

test('(ix) the canary in the keys file reaches no reply, card.json, draft output or quoted log — and the raw child.log DOES hold it (control: the scrub is what hides it)', async () => {
  const replies = [];
  const keep = (r) => { replies.push(r.text); return r; };
  // a child that echoes the key to its log and dies: the page's quote of the log must be scrubbed
  const w = await world({ mode: 'echo-key-die' });
  const r = keep(await w.post('/api/author/draft', w.card()));
  const id = r.json().draftId;
  const j = await phaseOf(w, id, ['stopped', 'green', 'red']);
  keep(await w.get(`/api/author/${id}`));
  keep(await w.get('/api/author/live'));
  assert.equal(j.phase, 'stopped');
  assert.ok(j.say.includes('PROVIDER-ECHO'), 'the log is quoted');
  assert.ok(j.say.includes('[redacted-key]'), j.say);
  assert.ok(readFileSync(path.join(w.dir(id), 'child.log'), 'utf8').includes(CANARY), 'control: the RAW log holds the key');
  // a provider error that carries the key: a red whose text is scrubbed
  const w2 = await world({ mode: 'echo-key-red' });
  const r2 = keep(await w2.post('/api/author/draft', w2.card()));
  const id2 = r2.json().draftId;
  const j2 = await phaseOf(w2, id2, ['red', 'stopped', 'green']);
  keep(await w2.get(`/api/author/${id2}`));
  assert.equal(j2.phase, 'red');
  assert.ok(j2.reds.some((x) => x.includes('upstream rejected key')), JSON.stringify(j2.reds));
  // a green draft too
  const w3 = await world();
  const id3 = keep(await w3.post('/api/author/draft', w3.card())).json().draftId;
  await phaseOf(w3, id3, ['green']);
  keep(await w3.get(`/api/author/${id3}`));
  for (const text of replies) assert.ok(!text.includes(CANARY), 'a reply carried the key');
  for (const [wd, id_] of [[w, id], [w2, id2], [w3, id3]]) {
    const files = filesUnder(wd.dir(id_), ['child.log']);
    for (const [f, text] of Object.entries(files)) assert.ok(!text.includes(CANARY), `${f} carries the key`);
    assert.ok(!readFileSync(path.join(wd.dir(id_), 'card.json'), 'utf8').includes(CANARY));
  }
  // a key typed into the card is refused at the door and never written
  const typed = await w3.post('/api/author/draft', w3.card({ flowName: 'typed', job: `${JOB}\n~use ${CANARY}` }));
  assert.equal(typed.status, 400);
  assert.ok(!typed.text.includes(CANARY));
  assert.equal(w3.drafts().length, 1);
});

test('(xii) the drafter never writes the cap, destination, ask TTL or input paths: a model that tries is a red draft; a green draft\'s prose carries exactly the card\'s', async () => {
  const w = await world({ mode: 'greedy' });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const j = await phaseOf(w, id, ['red', 'green', 'stopped']);
  assert.equal(j.phase, 'red', 'a drafter that authors those fields is refused, never green');
  assert.ok(j.reds.some((x) => /unknown key "capUsd"/.test(x)), JSON.stringify(j.reds));
  assert.equal(existsSync(path.join(w.dir(id), 'draft', 'spec.hash')), false);
  const g = await world();
  const gid = (await g.post('/api/author/draft', g.card())).json().draftId;
  await phaseOf(g, gid, ['green']);
  const p = parseSignedText(readFileSync(path.join(g.dir(gid), 'draft', 'prose.txt'), 'utf8'));
  assert.equal(p.arbiter.capUsd, 0.25);
  assert.deepEqual(p.arbiter.sends.map((s) => [s.line, s.target.path]), [[5, g.outDir]]);
  assert.deepEqual(p.arbiter.sources.map((s) => s.path).sort(), [path.join(g.inDir, 'jd.md'), path.join(g.inDir, 'resume.md')]);
  assert.equal(p.arbiter.asks[0].ttlMs, 30 * 60000);
  const decl = JSON.parse(readFileSync(path.join(g.dir(gid), 'draft', 'declaration.json'), 'utf8'));
  for (const k of ['capUsd', 'sends', 'asks', 'sources']) assert.ok(!(k in decl), `declaration has no "${k}"`);
});

test('(xiv) a refreshed tab (a NEW panel over the same root) re-attaches: /live reads the draft from files, drafting then green; abandoned or signed = no card', async () => {
  const w = await world({ mode: 'hang' });
  assert.deepEqual((await w.get('/api/author/live')).json(), { ok: true, draft: null, start: null });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const second = await w.open(); // the panel restarted: nothing in memory survives
  const live = (await rq(second.port, { url: '/api/author/live' })).json();
  assert.equal(live.draft.draftId, id);
  assert.equal(live.draft.phase, 'drafting');
  assert.equal(live.draft.card.flowName, 'job2', 'the card comes back, not an empty one');
  assert.equal(live.draft.card.job, JOB);
  // finished unsigned drafts stay on the card until Abandon: use a normal world for green
  const g = await world();
  const gid = (await g.post('/api/author/draft', g.card())).json().draftId;
  await phaseOf(g, gid, ['green']);
  const g2 = await g.open();
  const gl = (await rq(g2.port, { url: '/api/author/live' })).json();
  assert.equal(gl.draft.phase, 'green');
  assert.ok(gl.draft.hash && gl.draft.readout);
  writeFileSync(path.join(g.dir(gid), 'signed.json'), '{"at":"x"}\n'); // what the sign door (piece 2b) will write
  assert.equal((await rq(g2.port, { url: '/api/author/live' })).json().draft, null);
  assert.equal((await g.get(`/api/author/${gid}`)).json().phase, 'signed');
  const a = await w.post(`/api/author/${id}/abandon`, {});
  assert.equal(a.status, 200);
  assert.equal((await rq(second.port, { url: '/api/author/live' })).json().draft, null);
});

test('(xvi) Abandon stops the child by its recorded pid, makes no further model call, keeps the spend booked; it never kills a process that is not ours', async () => {
  const w = await world({ mode: 'hang' });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const dir = w.dir(id);
  const live = path.join(dir, 'draft', 'draft-spend.json');
  const rec = await until(() => { try { const j = JSON.parse(readFileSync(live, 'utf8')); return j.inFlight && j.rounds === 1 ? j : null; } catch { return null; } });
  const pid = JSON.parse(readFileSync(path.join(dir, 'pid.json'), 'utf8'));
  assert.equal(isFwdloopAlive(pid.pid, pid.procStart), true);
  const before = spendSummary({ home: w.home }).total.usd;
  assert.ok(before > 0);
  assert.equal((await rq(w.h.port, { method: 'POST', url: `/api/author/${id}/abandon`, body: {}, headers: { origin: 'http://evil.example' } })).status, 403);
  const a = await w.post(`/api/author/${id}/abandon`, {});
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json().stopped, true);
  assert.equal(isFwdloopAlive(pid.pid, pid.procStart), false, 'the child is gone');
  assert.ok(existsSync(path.join(dir, 'abandoned.json')));
  assert.equal((await w.get(`/api/author/${id}`)).json().phase, 'abandoned');
  await sleep(300);
  assert.deepEqual(JSON.parse(readFileSync(live, 'utf8')), rec, 'no further call was booked after the abandon');
  assert.ok(Math.abs(spendSummary({ home: w.home }).total.usd - before) < 1e-12, 'spend stays booked, unchanged');
  assert.equal((await w.post(`/api/author/${id}/abandon`, {})).status, 409, 'abandoning twice is refused');
  assert.equal((await w.post('/api/author/d-0000000000-0000/abandon', {})).status, 404);
  // a pid.json that names a process that is not fwdloop: Abandon marks the draft, kills nothing
  const sleeper = spawn('sleep', ['30'], { detached: true, stdio: 'ignore' });
  try {
    const w2 = await world({ mode: 'hang' });
    const id2 = (await w2.post('/api/author/draft', w2.card())).json().draftId;
    const real = JSON.parse(readFileSync(path.join(w2.dir(id2), 'pid.json'), 'utf8'));
    process.kill(-real.pid, 'SIGKILL');
    await until(() => isFwdloopAlive(real.pid, real.procStart) === false);
    writeFileSync(path.join(w2.dir(id2), 'pid.json'), JSON.stringify({ pid: sleeper.pid, procStart: null, startedAt: Date.now() }));
    const a2 = await w2.post(`/api/author/${id2}/abandon`, {});
    assert.equal(a2.status, 200);
    assert.equal(a2.json().stopped, false);
    process.kill(sleeper.pid, 0); // still alive: throws if not
  } finally {
    try { process.kill(-sleeper.pid, 'SIGKILL'); } catch { /* gone */ }
  }
});

test('(xvii) a draft child killed from outside reads stopped (never drafting), never holds the lock, and a new card can start; a recycled pid (wrong procStart) reads dead too', async () => {
  const w = await world({ mode: 'hang' });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await phaseOf(w, id, ['drafting']);
  assert.equal((await w.post('/api/author/draft', w.card({ flowName: 'blocked' }))).status, 409, 'alive: blocks');
  const pid = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8'));
  process.kill(-pid.pid, 'SIGKILL');
  const j = await phaseOf(w, id, ['stopped']);
  assert.ok(j.say.length > 10);
  assert.equal((await w.get('/api/author/live')).json().draft.phase, 'stopped', 'the card shows it stopped, not an empty card');
  const next = await w.post('/api/author/draft', w.card({ flowName: 'blocked' }));
  assert.equal(next.status, 202, 'a dead draft never blocks a new one');
  // a pid.json whose procStart does not match (a recycled pid) is not "ours alive"
  const id2 = next.json().draftId;
  await phaseOf(w, id2, ['drafting']);
  const p2 = JSON.parse(readFileSync(path.join(w.dir(id2), 'pid.json'), 'utf8'));
  writeFileSync(path.join(w.dir(id2), 'pid.json'), JSON.stringify({ ...p2, procStart: '1' }));
  assert.equal((await w.get(`/api/author/${id2}`)).json().phase, 'stopped');
  process.kill(-p2.pid, 'SIGKILL');
});

test('(ix) belt and braces: even a key that slipped into a draft file is scrubbed from the reply (readout, reds)', async () => {
  const g = await world();
  const gid = (await g.post('/api/author/draft', g.card())).json().draftId;
  await phaseOf(g, gid, ['green']);
  const ro = path.join(g.dir(gid), 'draft', 'readout.txt');
  writeFileSync(ro, `${readFileSync(ro, 'utf8')}\nleaked ${CANARY}\n`);
  const green = await g.get(`/api/author/${gid}`);
  assert.equal(green.json().phase, 'green');
  assert.ok(green.json().readout.includes('[redacted-key]') && !green.text.includes(CANARY));
  const r = await world({ mode: 'greedy' });
  const rid = (await r.post('/api/author/draft', r.card())).json().draftId;
  await phaseOf(r, rid, ['red']);
  const lj = path.join(r.dir(rid), 'draft', 'log.json');
  const log = JSON.parse(readFileSync(lj, 'utf8'));
  log.reds.push(`provider said ${CANARY}`);
  writeFileSync(lj, JSON.stringify(log));
  const red = await r.get(`/api/author/${rid}`);
  assert.ok(red.json().reds.some((x) => x.includes('[redacted-key]')) && !red.text.includes(CANARY));
});
