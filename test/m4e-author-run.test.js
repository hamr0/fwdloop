// M4e piece 2b, items 3-5 (docs/wiki/the-module-ladder.md, "M4e", scope 5-9; negatives (ii) (iii) (iv) (v) (vi) (vii) (viii) (ix)
// (x) (xi)): the Run-a-signed-flow door and the ONE run-start path, over real HTTP against the real `bin/fwdloop run` child with
// the test model step. $0, no network, scratch HOME/config home, every child killed and every dir removed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';

import { checkSendDestination } from '../src/runner.js';
import { chmodSentence } from '../src/keysfile.js';
import { spendSummary, REFUSAL_SENTENCE } from '../src/monthly.js';
import { runLiveness } from '../src/liveness.js';
import {
  CANARY, GATED_STEP, HERE, killChildrenAfter, rq, until, world,
} from './m4e-world.mjs';

killChildrenAfter();

const startPhase = (w, startId, phases) => until(async () => {
  const j = (await w.get(`/api/author/start/${startId}`)).json();
  return phases.includes(j?.phase) ? j : null;
});
const runDirOf = (w, flow, runId) => path.join(w.root, flow, 'runs', runId);
const runBody = (w, over = {}) => ({ flow: 'job2', inputs: w.inputs(), runId: 'r1', ...over });
/** Wait until a started run reads `state` (working / parked / ended). */
const stateOf = (w, startId, state) => until(async () => {
  const j = (await w.get(`/api/author/start/${startId}`)).json();
  return j?.phase === 'started' && j.state === state ? j : null;
});

test('(ii) the run door is the SAME gated door: no/foreign Origin, wrong method -> refused, nothing created', async () => {
  const w = await world();
  await w.signedFlow();
  const body = runBody(w);
  for (const [c, want] of [[{ headers: { origin: null } }, 403], [{ headers: { origin: 'http://evil.example' } }, 403], [{ headers: { host: 'evil.example' } }, 403]]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await rq(w.h.port, { method: 'POST', url: '/api/author/run', body, ...c })).status, want, JSON.stringify(c));
  }
  assert.equal((await rq(w.h.port, { url: '/api/author/run' })).status, 404, 'a GET of the POST door is not a door');
  assert.equal((await rq(w.h.port, { url: '/api/author/flows', headers: { host: 'evil.example' } })).status, 403);
  assert.equal((await rq(w.h.port, { url: '/api/author/start/s-0000000000-0000', headers: { host: 'evil.example' } })).status, 403);
  assert.deepEqual(w.starts(), [], 'no start folder was created by any refusal');
  assert.equal(existsSync(runDirOf(w, 'job2', 'r1')), false);
});

test('(iii)(iv)(v)(x) refusals over HTTP name the box, spend $0 and create nothing — no start folder, no run dir, no ledger row', async () => {
  const w = await world();
  await w.signedFlow();
  mkdirSync(path.join(w.root, 'bare')); // a folder with no signature is not a flow
  mkdirSync(runDirOf(w, 'job2', 'taken'));
  const ledger = () => (existsSync(path.join(w.home, 'runs.jsonl')) ? readFileSync(path.join(w.home, 'runs.jsonl'), 'utf8') : '');
  const ledgerBefore = ledger();
  const ok = w.inputs();
  const link = path.join(w.inDir, 'dangling.md');
  symlinkSync(path.join(w.inDir, 'nowhere.md'), link);
  const cases = [
    [{ inputs: [{ role: 'resume', path: w.inDir }, ok[1]] }, 'inputs.0'], // a folder
    [{ inputs: [{ role: 'resume', path: path.join(w.inDir, 'missing.md') }, ok[1]] }, 'inputs.0'],
    [{ inputs: [{ role: 'resume', path: link }, ok[1]] }, 'inputs.0'], // a broken symlink
    [{ inputs: [ok[0]] }, 'inputs'], // jd missing: a declared role without a path
    [{ inputs: [...ok, { role: 'extra', path: ok[0].path }] }, 'inputs.2'], // an undeclared role
    [{ inputs: [ok[0], { role: 'resume', path: ok[1].path }] }, 'inputs.1'], // a role twice
    [{ runId: 'taken' }, 'runId'], [{ runId: '../x' }, 'runId'], [{ runId: 'a/b' }, 'runId'],
    [{ flow: 'bare' }, 'flow'], [{ flow: 'nope' }, 'flow'], [{ flow: '../job2' }, 'flow'], [{ flow: '.drafts' }, 'flow'],
  ];
  for (const [over, field] of cases) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/run', runBody(w, over));
    assert.equal(r.status, 400, `${JSON.stringify(over)} -> ${r.text}`);
    assert.ok(r.json().refusals.some((x) => x.field === field && x.say.length > 10), `${JSON.stringify(over)} -> ${r.text}`);
  }
  assert.deepEqual(w.starts(), []);
  assert.deepEqual(readdirSync(path.join(w.root, 'job2', 'runs')), ['taken']);
  assert.equal(ledger(), ledgerBefore, 'no hold row: nothing reached the money door');
});

test('(x) only flows whose readFlow passes are listed; a tampered or unsigned flow is not listed and a POST naming it is refused', async () => {
  const w = await world();
  const a = await w.signedFlow({ flowName: 'good' });
  w.seedPassed('good');
  await w.signedFlow({ flowName: 'tampered' });
  mkdirSync(path.join(w.root, 'unsigned', 'runs'), { recursive: true });
  writeFileSync(path.join(w.root, 'unsigned', 'prose.txt'), 'x');
  writeFileSync(path.join(w.root, 'tampered', 'prose.txt'), `${readFileSync(path.join(w.root, 'tampered', 'prose.txt'), 'utf8')}\n7. and one more thing.\n`);
  const list = (await w.get('/api/author/flows')).json();
  assert.deepEqual(list.flows.map((f) => f.flow), ['good'], '.drafts and .starts are never flows either');
  assert.equal(list.flows[0].capUsd, 0.25);
  assert.deepEqual(list.flows[0].roles.sort(), ['jd', 'resume']);
  assert.deepEqual(list.flows[0].lastSources, { resume: '', jd: '' }, 'blank when the flow never ran');
  assert.equal(list.flows[0].lastRunId, null);
  assert.equal(list.leftThisMonth.say, 'no monthly limit set');
  for (const flow of ['tampered', 'unsigned']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/run', runBody(w, { flow }));
    assert.equal(r.status, 400, flow);
    assert.equal(r.json().refused, 'flow');
  }
  assert.deepEqual(w.starts(), []);
  assert.ok(existsSync(a.flowDir));
});

test('(5)(8) a run starts as ONE detached CLI child: start folder with start.json, child.log 0600 and pid.json; starting/started from files; the frozen inputs match; parks at its ask; the list then shows the last run\'s paths and left this month', async () => {
  const w = await world({ limit: 5 });
  await w.signedFlow();
  w.seedPassed('job2');
  const r = await w.post('/api/author/run', runBody(w));
  assert.equal(r.status, 202, r.text);
  const { startId, runId } = r.json();
  assert.equal(runId, 'r1');
  const dir = path.join(w.root, '.starts', startId);
  for (const f of ['start.json', 'child.log', 'pid.json']) assert.ok(existsSync(path.join(dir, f)), f);
  assert.equal(statSync(path.join(dir, 'child.log')).mode & 0o777, 0o600);
  const st = JSON.parse(readFileSync(path.join(dir, 'start.json'), 'utf8'));
  assert.deepEqual([st.kind, st.flow, st.runId], ['run', 'job2', 'r1']);
  const parked = await stateOf(w, startId, 'parked');
  assert.deepEqual([parked.phase, parked.flow, parked.runId], ['started', 'job2', 'r1']);
  const rd = runDirOf(w, 'job2', 'r1');
  assert.ok(existsSync(path.join(rd, 'ask.json')));
  assert.notEqual(runLiveness(rd), 'running');
  assert.equal(readFileSync(path.join(rd, 'inputs', 'resume.md'), 'utf8'), '# R\n');
  const list = (await w.get('/api/author/flows')).json();
  assert.deepEqual(list.flows[0].lastSources, { resume: path.join(w.inDir, 'resume.md'), jd: path.join(w.inDir, 'jd.md') });
  assert.equal(list.flows[0].lastRunId, 'r1');
  assert.match(list.flows[0].leftThisMonth.say, /left this month/);
  assert.equal(list.flows[0].leftThisMonth.limitUsd, 5);
  assert.equal((await w.get('/api/author/start/s-0000000000-0000')).status, 404);
  assert.equal((await w.get('/api/author/start/nope')).status, 404);
});

test('(vi) two run POSTs together for one flow start exactly one child (the second is refused while the first is still starting)', async () => {
  for (let i = 0; i < 3; i += 1) {
    const w = await world(); // eslint-disable-line no-await-in-loop
    await w.signedFlow(); // eslint-disable-line no-await-in-loop
    // same run id AND different run ids: either way one start folder, one 202
    const rs = await Promise.all([w.post('/api/author/run', runBody(w, { runId: 'a1' })), w.post('/api/author/run', runBody(w, { runId: i % 2 ? 'a1' : 'a2' }))]); // eslint-disable-line no-await-in-loop
    assert.deepEqual(rs.map((r) => r.status).sort(), [202, 409].sort(), rs.map((r) => r.text).join(' | '));
    assert.equal(rs.find((r) => r.status === 409).json().refused, 'start-live');
    assert.equal(w.starts().length, 1, 'one start folder');
    const only = rs.find((r) => r.status === 202).json();
    await stateOf(w, only.startId, 'parked'); // eslint-disable-line no-await-in-loop
    assert.deepEqual(readdirSync(path.join(w.root, 'job2', 'runs')), [only.runId], 'one run dir');
  }
});

test('(vii) over the monthly limit the child refuses at $0: the start reads refused with the signed sentence; no run dir, nothing booked', async () => {
  const w = await world();
  await w.signedFlow(); // drafted with no limit set; the limit is lowered afterwards, below the flow's $0.25 cap
  writeFileSync(path.join(w.home, 'config.json'), JSON.stringify({ monthlyLimitUsd: 0.00001 }));
  const before = spendSummary({ home: w.home }).total.usd;
  const r = await w.post('/api/author/run', runBody(w));
  assert.equal(r.status, 202);
  const j = await startPhase(w, r.json().startId, ['refused', 'started']);
  assert.equal(j.phase, 'refused');
  assert.ok(j.say.includes('Nothing spent. Raise the monthly limit in Settings, or wait for next month.'), j.say);
  assert.ok(j.say.includes(REFUSAL_SENTENCE));
  assert.equal(existsSync(runDirOf(w, 'job2', 'r1')), false, 'no run dir');
  assert.equal(spendSummary({ home: w.home }).total.usd, before, 'the refused run booked nothing');
});

test('(viii) a keys file other users can read refuses the run at the door with the chmod sentence; nothing is created', async () => {
  const w = await world({ keysMode: 0o640 });
  const r = await w.post('/api/author/run', runBody(w));
  assert.equal(r.status, 409);
  assert.equal(r.json().refused, 'keys-file');
  assert.equal(r.json().say, chmodSentence(w.home));
  assert.deepEqual(w.starts(), []);
  assert.ok(!r.text.includes(CANARY));
});

test('(ix) the canary reaches no reply, start.json, run book or quoted log; a CLI that quotes the key is scrubbed on the page while the raw child.log holds it (control)', async () => {
  const replies = [];
  const keep = (x) => { replies.push(x.text); return x; };
  const w = await world();
  await w.signedFlow();
  // (a) a CLI that prints the key and dies before any run dir: the page's quote of the log is scrubbed
  const echoPanel = await w.open({ bin: path.join(HERE, 'fixtures', 'm4e-echo', 'fwdloop') });
  const e = keep(await rq(echoPanel.port, { method: 'POST', url: '/api/author/run', body: runBody(w, { runId: 'e1' }) }));
  assert.equal(e.status, 202);
  const eid = e.json().startId;
  const refused = await until(async () => {
    const j = keep(await rq(echoPanel.port, { url: `/api/author/start/${eid}` })).json();
    return j?.phase === 'refused' ? j : null;
  });
  assert.ok(refused.say.includes('boom, upstream said key=[redacted-key]'), refused.say);
  assert.ok(refused.say.endsWith('Nothing spent.'), refused.say);
  assert.ok(readFileSync(path.join(w.root, '.starts', eid, 'child.log'), 'utf8').includes(CANARY), 'control: the RAW log holds the key');
  // (b) a real run with a quiet step: the key is in no file of the flows root, no reply, and not in runs.jsonl
  const r = keep(await w.post('/api/author/run', runBody(w, { runId: 'q1' })));
  assert.equal(r.status, 202);
  await stateOf(w, r.json().startId, 'parked');
  keep(await w.get(`/api/author/start/${r.json().startId}`));
  keep(await w.get('/api/author/flows'));
  const walk = (d, out = []) => { for (const f of readdirSync(d)) { const p = path.join(d, f); if (statSync(p).isDirectory()) walk(p, out); else out.push(p); } return out; };
  for (const f of walk(w.root)) {
    if (f === path.join(w.root, '.starts', eid, 'child.log')) continue; // the control above
    assert.ok(!readFileSync(f, 'utf8').includes(CANARY), `${f} carries the key`);
  }
  assert.ok(!readFileSync(path.join(w.home, 'runs.jsonl'), 'utf8').includes(CANARY));
  for (const t of replies) assert.ok(!t.includes(CANARY), 'a reply carried the key');
});

test('(xi) kill the panel while a run is working: a NEW panel over the same root reads the start as working from files, then parked once the run reaches its ask', async () => {
  const w = await world({ step: GATED_STEP });
  await w.signedFlow();
  const r = await w.post('/api/author/run', runBody(w));
  const { startId } = r.json();
  const working = await stateOf(w, startId, 'working');
  assert.equal(working.phase, 'started');
  await w.h.close(); // the panel is gone; the detached child must not be
  const second = await w.open();
  const view = (await rq(second.port, { url: `/api/author/start/${startId}` })).json();
  assert.deepEqual([view.phase, view.state], ['started', 'working']);
  assert.equal(existsSync(path.join(runDirOf(w, 'job2', 'r1'), 'ask.json')), false, 'not at its ask yet');
  writeFileSync(w.gate, 'go'); // release the step: the run goes on to its ask
  const parked = await until(async () => {
    const j = (await rq(second.port, { url: `/api/author/start/${startId}` })).json();
    return j?.state === 'parked' ? j : null;
  });
  assert.equal(parked.phase, 'started');
});

test('the panel\'s own .starts folder is never a flow and never a send destination (the SAME rule as .drafts), at the folder and below it', async () => {
  const w = await world();
  await w.signedFlow();
  const r = await w.post('/api/author/run', runBody(w));
  const sd = path.join(w.root, '.starts');
  assert.ok(existsSync(sd));
  for (const target of [sd, path.join(sd, r.json().startId)]) {
    const d = checkSendDestination(`file:${target}`, { root: w.root });
    assert.equal(d.ok, false, target);
    assert.match(d.red, /the panel starts folder/);
  }
  const drafts = checkSendDestination(`file:${path.join(w.root, '.drafts')}`, { root: w.root });
  assert.match(drafts.red, /the panel drafts folder/);
  // a card whose destination is .starts is refused by name at the card too
  const c = await w.post('/api/author/draft', w.card({ flowName: 'viastarts', destination: sd }));
  assert.equal(c.status, 400);
  assert.ok(c.json().refusals.some((x) => x.field === 'destination' && /starts folder/.test(x.say)), c.text);
});
