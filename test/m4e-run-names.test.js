// M4e amendment 3 item 2 (docs/wiki/the-module-ladder.md "M4e", amendment 3, negatives (b) (c)): run names `run-<n>` per flow, claimed by
// creating the run folder exclusively; the CLI default and the panel door use the one function. $0: the test model step, scratch dirs.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow, claimRunId, nextRunId } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { sandboxSend } from './send-sandbox.js';
import {
  killChildrenAfter, until, world,
} from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const FAKE = path.join(HERE, 'fixtures', 'cli-fake-model-step.mjs');
const FLOW_MOD = path.join(HERE, '..', 'src', 'flow.js');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CATALOGUE = loadCatalogue().primitives;
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-names-${p}-`));
const kids = [];
after(() => { for (const k of kids) { try { k.kill('SIGKILL'); } catch { /* gone */ } } });

function makeFlow(root, name = 'job2') {
  const r = writeFlow({
    root, name, proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-30T12:00:00Z', catalogue: CATALOGUE,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('\n'));
}
const runsOf = (root, flow) => (existsSync(path.join(root, flow, 'runs')) ? readdirSync(path.join(root, flow, 'runs')).sort() : []);

/** One child process that claims a run name and prints it. */
const claimInChild = (flowDir) => new Promise((resolve) => {
  const c = spawn(process.execPath, ['-e', `import(${JSON.stringify(FLOW_MOD)}).then((m) => process.stdout.write(JSON.stringify(m.claimRunId(${JSON.stringify(flowDir)}))))`], { stdio: ['ignore', 'pipe', 'inherit'] });
  kids.push(c);
  let out = '';
  c.stdout.on('data', (b) => { out += b; });
  c.on('exit', () => resolve(JSON.parse(out)));
});

test('(b) claim: runs started together get different names, the next start gets the next number, another flow starts again at run-1', async () => {
  const root = tmp('claim');
  const dir = path.join(root, 'flowa');
  const got = await Promise.all(Array.from({ length: 8 }, () => claimInChild(dir)));
  assert.ok(got.every((g) => g.ok), JSON.stringify(got));
  assert.deepEqual(got.map((g) => g.runId).sort(), ['run-1', 'run-2', 'run-3', 'run-4', 'run-5', 'run-6', 'run-7', 'run-8'], 'eight claims at once, eight names');
  assert.equal(claimRunId(dir).runId, 'run-9');
  assert.equal(nextRunId(dir), 'run-10', 'a look claims nothing');
  assert.equal(runsOf(root, 'flowa').length, 9);
  assert.equal(claimRunId(path.join(root, 'flowb')).runId, 'run-1');
  // runs already made keep their ids; a gap or a hand-named run does not reuse or rename anything
  mkdirSync(path.join(dir, 'runs', 'run-20'));
  mkdirSync(path.join(dir, 'runs', 'r1'));
  assert.equal(claimRunId(dir).runId, 'run-21');
  assert.ok(existsSync(path.join(dir, 'runs', 'r1')));
});

test('(b) the CLI with no --run-id names the same way: run-1, then run-2; a typed id is left alone', async () => {
  const root = tmp('cli');
  makeFlow(root);
  const src = tmp('cli-src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const args = ['run', 'job2', '--root', root, '--source', `resume=${path.join(src, 'resume.docx')}`, '--source', `jd=${path.join(src, 'jd.md')}`];
  const go = (extra) => new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, ...args, ...extra], { env: { PATH: process.env.PATH ?? '', NODE_ENV: 'test', FWDLOOP_TEST_MODEL_STEP: FAKE }, stdio: ['ignore', 'pipe', 'pipe'] });
    kids.push(c);
    let err = '';
    c.stderr.on('data', (b) => { err += b; });
    c.on('exit', (code) => resolve({ code, err }));
  });
  assert.equal((await go([])).code, 0);
  assert.equal((await go([])).code, 0);
  assert.deepEqual(runsOf(root, 'job2'), ['run-1', 'run-2']);
  assert.equal((await go(['--run-id', 'typed-1'])).code, 0);
  assert.deepEqual(runsOf(root, 'job2'), ['run-1', 'run-2', 'typed-1']);
  // (c) a typed id that already holds a run is refused, nothing touched; a bad one is refused by the CLI's own check
  const again = await go(['--run-id', 'run-1']);
  assert.notEqual(again.code, 0);
  assert.match(again.err, /already exists/);
  assert.notEqual((await go(['--run-id', '../x'])).code, 0);
  assert.deepEqual(runsOf(root, 'job2'), ['run-1', 'run-2', 'typed-1']);
});

test('(c) a refused CLI start leaves no empty claimed run folder behind', async () => {
  const root = tmp('refused');
  makeFlow(root);
  // no key and no test model step: the CLI refuses before the run starts
  const r = await new Promise((resolve) => {
    const c = spawn(process.execPath, [BIN, 'run', 'job2', '--root', root, '--source', `resume=${HERE}/send-sandbox.js`, '--source', `jd=${HERE}/send-sandbox.js`], { env: { PATH: process.env.PATH ?? '', HOME: tmp('home') }, stdio: 'ignore' });
    kids.push(c);
    c.on('exit', (code) => resolve(code));
  });
  assert.notEqual(r, 0);
  assert.deepEqual(runsOf(root, 'job2'), [], 'the claimed folder was removed again');
});

test('the panel: /api/author/flows offers the next name; Run with no id claims it; the next start gets the next number; a typed id is checked as before', async () => {
  const w = await world();
  await w.signedFlow();
  const flows = (await w.get('/api/author/flows')).json();
  assert.equal(flows.flows[0].nextRunId, 'run-1');
  const body = (over = {}) => ({ flow: 'job2', inputs: w.inputs(), runId: '', ...over });
  const r1 = await w.post('/api/author/run', body());
  assert.equal(r1.status, 202, r1.text);
  assert.equal(r1.json().runId, 'run-1');
  await until(async () => (await w.get(`/api/author/start/${r1.json().startId}`)).json()?.phase === 'started');
  assert.equal((await w.get('/api/author/flows')).json().flows[0].nextRunId, 'run-2');
  const r2 = await w.post('/api/author/run', body());
  assert.equal(r2.status, 202, r2.text);
  assert.equal(r2.json().runId, 'run-2');
  // (c) a typed id that exists, or is malformed, is refused with its box named, $0
  for (const runId of ['run-1', '../x']) {
    // eslint-disable-next-line no-await-in-loop
    const bad = await w.post('/api/author/run', body({ runId }));
    assert.equal(bad.status, 400, bad.text);
    assert.equal(bad.json().refusals[0].field, 'runId');
  }
});
