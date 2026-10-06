// M4e amendment 5 (docs/wiki/the-module-ladder.md): Run a signed flow is a NEW run of the same flow; Inputs, Destination, Cap $ and each
// ask's wait are open; a Destination, Cap $ or wait different from the flow's signed value needs the human's two clicks (a hash of those
// values) and is written once into the run's own folder; the next plain Run starts from the flow's own values. Negatives (a)-(e).
// $0: the real `bin/fwdloop` children with the test model step over real HTTP; scratch config home; everything removed, every child killed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { homedir } from 'node:os';
import path from 'node:path';

import { answerAsk } from '../src/ask.js';
import { pickRunValues } from '../src/runvalues.js';
import {
  HERE, killChildrenAfter, rq, until, world,
} from './m4e-world.mjs';

killChildrenAfter();
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const sha = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const jsonl = (p) => readFileSync(p, 'utf8').trim().split('\n').map((l) => JSON.parse(l));

/** Wait for a started run to be parked at its ask; returns { runDir, ask }. */
async function parked(w, flow, runId) {
  const runDir = path.join(w.root, flow, 'runs', runId);
  await until(async () => (await w.get(`/api/runs/${flow}/${runId}`)).json()?.glyph === '[·]');
  return { runDir, ask: JSON.parse(readFileSync(path.join(runDir, 'ask.json'), 'utf8')) };
}
/** Accept the parked ask and let the resume finish the run (real `fwdloop resume`, the world's own env). */
function acceptAndFinish(w, flow, runId, runDir, ask) {
  assert.equal(answerAsk({ runDir, askId: ask.askId, decision: 'accept' }).ok, true);
  const r = spawnSync(process.execPath, [BIN, 'resume', runId, '--flow', flow, '--root', w.root], { env: { ...w.env, HOME: w.work }, encoding: 'utf8', timeout: 60_000 });
  assert.equal(r.status, 0, r.stderr);
}
const second = (w) => { const d = path.join(w.work, 'out2'); mkdirSync(d); return d; };

test('(a) Run with new input files only starts with ONE click as run-<n+1>; the flow\'s signed files are unchanged and the run has no signed-values file', async () => {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  const files = ['prose.txt', 'signature.json', 'declaration.json'].map((f) => sha(path.join(flowDir, f)));
  const r1 = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs() })).json();
  assert.equal(r1.runId, 'run-1');
  await parked(w, 'job2', 'run-1');
  writeFileSync(path.join(w.inDir, 'resume2.md'), '# R2\n');
  const next = (await w.post('/api/author/run', { flow: 'job2', inputs: [{ role: 'resume', path: path.join(w.inDir, 'resume2.md') }, w.inputs()[1]] })).json();
  assert.equal(next.ok, true);
  assert.equal(next.runId, 'run-2', 'a plain Run needs no hash and is named run-<n+1>');
  await parked(w, 'job2', 'run-2');
  assert.equal(JSON.parse(readFileSync(path.join(flowDir, 'runs', 'run-2', 'inputs.json'), 'utf8')).find((m) => m.id === 'resume').source, path.join(w.inDir, 'resume2.md'));
  assert.deepEqual(readdirSync(path.join(flowDir, 'runs', 'run-2')).filter((n) => /^signed-values/.test(n)), []);
  assert.deepEqual(['prose.txt', 'signature.json', 'declaration.json'].map((f) => sha(path.join(flowDir, f))), files);
  // a plain Run that spells out the flow's own values (same destination, cap, wait) is still a plain Run
  const own = (await w.get('/api/author/flows')).json().flows[0];
  const same = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), destination: own.values.destination, capUsd: String(own.values.capUsd), askWaits: own.values.askWaits });
  assert.equal(same.status, 202, same.text);
});

test('(b) a new destination + higher cap + different ask wait: Sign & run — no hash / a stale hash sign and start nothing; two clicks start it; it USES the new values; the next plain Run uses the flow\'s own again', async () => {
  const w = await world({ limit: 5 });
  const { flowDir } = await w.signedFlow();
  const out2 = second(w);
  const flowFiles = ['prose.txt', 'signature.json', 'declaration.json'].map((f) => sha(path.join(flowDir, f)));
  const own = (await w.get('/api/author/flows')).json().flows[0];
  assert.equal(own.values.destination, w.outDir);
  assert.equal(own.values.capUsd, 0.25);
  const changed = { flow: 'job2', inputs: w.inputs(), destination: out2, capUsd: '0.40', askWaits: { 4: '2h' } };
  const runs = () => readdirSync(path.join(flowDir, 'runs'));
  const startsBefore = w.starts().length;
  // click 1 (run-prepare) writes nothing and says a signature is needed
  const prep = (await w.post('/api/author/run-prepare', changed)).json();
  assert.equal(prep.needsSign, true);
  assert.match(prep.hash, /^[0-9a-f]{64}$/);
  assert.deepEqual(runs(), []);
  // one click (no hash) and a stale hash start nothing and create nothing
  const none = await w.post('/api/author/run', changed);
  assert.equal(none.status, 409);
  assert.equal(none.json().refused, 'needs-sign');
  const stale = await w.post('/api/author/run', { ...changed, capUsd: '0.41', hash: prep.hash });
  assert.equal(stale.status, 409);
  assert.equal(stale.json().refused, 'stale-hash');
  const wrong = await w.post('/api/author/run', { ...changed, hash: 'f'.repeat(64) });
  assert.equal(wrong.status, 409);
  assert.equal((await rq(w.h.port, { method: 'POST', url: '/api/author/run', body: { ...changed, hash: prep.hash }, headers: { origin: 'http://evil.example' } })).status, 403);
  assert.deepEqual(runs(), [], 'no run folder');
  assert.equal(w.starts().length, startsBefore, 'no start folder');
  // click 2
  const go = await w.post('/api/author/run', { ...changed, hash: prep.hash });
  assert.equal(go.status, 202, go.text);
  const { runId } = go.json();
  assert.equal(runId, 'run-1');
  const { runDir, ask } = await parked(w, 'job2', runId);
  // the signed values are in the run's own folder, written once, and are what the run uses
  const picked = pickRunValues(runDir);
  assert.equal(picked.ok && picked.version, 0);
  assert.deepEqual(picked.record.values, { capUsd: 0.4, destination: out2, askWaits: { 4: '2h' } });
  assert.equal(picked.record.hash, prep.hash);
  assert.equal(Date.parse(ask.expiresAt) - Date.parse(ask.askedAt), 2 * 3600_000, 'the wait is the run\'s 2h, not the flow\'s 30m');
  assert.equal((await w.get('/api/runs/job2/run-1')).json().capUsd, 0.4, 'the Run tab shows the cap in force');
  assert.equal((await w.get('/api/runs/job2/run-1/job')).json().sends[0].target, out2, 'the Job tab shows the destination in force');
  acceptAndFinish(w, 'job2', 'run-1', runDir, ask);
  assert.deepEqual(readdirSync(out2), ['job2-run-1-resume-summary-output.json'], 'the send lands in the NEW folder');
  assert.deepEqual(readdirSync(w.outDir), [], 'and not in the flow\'s own');
  assert.equal(jsonl(path.join(flowDir, 'history.jsonl')).find((h) => h.runId === 'run-1').capUsd, 0.4, 'the cap in force is the run\'s');
  // the next plain Run starts again from the flow's signed values
  const plain = (await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs() })).json();
  assert.equal(plain.runId, 'run-2');
  const p2 = await parked(w, 'job2', 'run-2');
  assert.equal(Date.parse(p2.ask.expiresAt) - Date.parse(p2.ask.askedAt), 30 * 60_000);
  acceptAndFinish(w, 'job2', 'run-2', p2.runDir, p2.ask);
  assert.deepEqual(readdirSync(w.outDir), ['job2-run-2-resume-summary-output.json'], 'back in the flow\'s own folder');
  assert.deepEqual(readdirSync(out2), ['job2-run-1-resume-summary-output.json']);
  assert.deepEqual(['prose.txt', 'signature.json', 'declaration.json'].map((f) => sha(path.join(flowDir, f))), flowFiles, 'the flow\'s signed files never changed');
  assert.equal(jsonl(path.join(flowDir, 'history.jsonl')).find((h) => h.runId === 'run-2').capUsd, 0.25);
  assert.equal(runs().sort().join(), 'run-1,run-2');
  assert.equal(existsSync(path.join(p2.runDir, 'signed-values.json')), false);
});

test('(c) a refused destination, a too-small cap, a cap over the month, a malformed wait: refused at $0 with the box named, nothing written, no run folder', async () => {
  const w = await world({ limit: 0.3 });
  const { flowDir } = await w.signedFlow();
  const base = { flow: 'job2', inputs: w.inputs() };
  const file = path.join(w.work, 'afile'); writeFileSync(file, 'x');
  const cases = [
    [{ destination: path.join(w.work, 'missing') }, 'destination', /not an existing folder/],
    [{ destination: file }, 'destination', /not an existing folder|is not a/],
    [{ destination: flowDir }, 'destination', /flow folder|flow root|refused/],
    [{ destination: w.root }, 'destination', /flow root/],
    [{ destination: path.join(w.root, '.drafts') }, 'destination', /drafts|not an existing folder/],
    [{ destination: path.join(homedir(), '.config', 'fwdloop') }, 'destination', /config folder|not an existing folder/], // (the panel in this process reads the real config door; the refusal is the same function the card uses)
    [{ capUsd: '0.02' }, 'capUsd', /needs at least \$0\.05 per run/],
    [{ capUsd: '0' }, 'capUsd', /above 0/],
    [{ capUsd: 'lots' }, 'capUsd', /above 0/],
    [{ capUsd: '9' }, 'capUsd', /left|month/i],
    [{ askWaits: { 4: 'soon' } }, 'askWaits.4', /whole number with s, m or h/],
    [{ askWaits: { 4: '0m' } }, 'askWaits.4', /whole number with s, m or h/],
    [{ askWaits: { 4: '1.5h' } }, 'askWaits.4', /whole number with s, m or h/],
    [{ askWaits: { 9: '1h' } }, 'askWaits.9', /no ask on line 9/],
  ];
  const startsBefore = w.starts().length;
  for (const [over, field, say] of cases) {
    for (const url of ['/api/author/run-prepare', '/api/author/run']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await w.post(url, { ...base, ...over });
      assert.equal(r.status, 400, `${url} ${JSON.stringify(over)} -> ${r.text}`);
      const hit = r.json().refusals.find((x) => x.field === field);
      assert.ok(hit, `${field} named: ${r.text}`);
      assert.match(hit.say, say);
    }
  }
  assert.deepEqual(readdirSync(path.join(flowDir, 'runs')), [], 'no run folder');
  assert.equal(w.starts().length, startsBefore);
  // accepted forms: seconds, minutes, hours (the signed text's own grammar)
  for (const wait of ['45s', '90m', '3h']) {
    // eslint-disable-next-line no-await-in-loop
    const r = await w.post('/api/author/run-prepare', { ...base, askWaits: { 4: wait } });
    assert.equal(r.status, 200, `${wait}: ${r.text}`);
    assert.equal(r.json().needsSign, true);
  }
});

test('(d) a POST that changes a job line, an ask\'s words or the steps through Run is refused and starts nothing', async () => {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  const startsBefore = w.starts().length;
  for (const extra of [{ job: 'Do something else' }, { askWords: 'new question' }, { steps: [] }, { lines: ['x'] }, { flowName: 'other' }, { askWait: '1h' }]) {
    for (const url of ['/api/author/run-prepare', '/api/author/run']) {
      // eslint-disable-next-line no-await-in-loop
      const r = await w.post(url, { flow: 'job2', inputs: w.inputs(), ...extra });
      assert.equal(r.status, 400, `${url} ${JSON.stringify(extra)}`);
      assert.equal(r.json().refused, 'not-a-run');
      assert.match(r.json().say, /new flow/);
    }
  }
  assert.deepEqual(readdirSync(path.join(flowDir, 'runs')), []);
  assert.equal(w.starts().length, startsBefore);
});

test('(e)+form facts: the flows list carries what the form dims and what it opens (job lines with their ask and wait, the destination, the cap floor)', async () => {
  const w = await world();
  await w.signedFlow();
  const f = (await w.get('/api/author/flows')).json().flows[0];
  assert.equal(f.hasSend, true);
  assert.deepEqual(f.values, { capUsd: 0.25, destination: w.outDir, askWaits: { 4: '30m' } });
  assert.equal(f.jobLines.length, 5);
  assert.equal(f.jobLines[3].ask.wait, '30m');
  assert.equal(f.jobLines[0].ask, null);
  assert.equal(f.capFloorUsd, 0.05);
  assert.match(f.floorText, /needs at least \$0\.05 per run/);
});
