// M4e amendment 7 items 6-7, the server side (docs/wiki/the-module-ladder.md, negative (d)): the Signed flow list holds only flows with a passed
// run that `canFlowRun` (the one function shared with preflight) accepts; each flow carries its track record and its passed runs' values; the
// Run-again door opens ANY run of a signed flow and says why a flow will not run, in preflight's own words. $0, scratch dirs, no network.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadCatalogue } from '../src/catalogue.js';
import { writeFlow } from '../src/flow.js';
import { valuesHash } from '../src/runvalues.js';
import { killChildrenAfter, world, HERE } from './m4e-world.mjs';
import { sandboxSend } from './send-sandbox.js';

killChildrenAfter();

const list = async (w) => (await w.get('/api/author/flows')).json();
const again = async (w, flow, runId) => (await w.get(`/api/author/run-again?flow=${encodeURIComponent(flow)}&runId=${encodeURIComponent(runId)}`));

/** A signed flow whose "resume-summary" step grants `compress` (no wired implementation) — the live `job2-live-1` case. */
function unwiredFlow(root, name) {
  const fx = (n) => path.join(HERE, 'fixtures', n);
  const declaration = JSON.parse(readFileSync(fx('job2.m1.declaration.json'), 'utf8'));
  declaration.steps.find((s) => s.emits === 'resume-summary').primitives = ['compress'];
  const cat = loadCatalogue();
  const r = writeFlow({
    root, name, proseText: sandboxSend(readFileSync(fx('job2-with-sources.signed.txt'), 'utf8')), declaration, signedBy: 'hamr', signedAt: '2026-09-24T12:00:00Z', catalogue: cat.primitives,
  });
  assert.equal(r.ok, true, r.ok ? '' : r.reds.join('; '));
}

test('(d) a flow with an unwired verb or no passed run is not listed; one with a passed run is, with its track record', async () => {
  const w = await world();
  await w.signedFlow({ flowName: 'good' });
  await w.signedFlow({ flowName: 'never-passed' });
  unwiredFlow(w.root, 'unwired');
  w.seedPassed('good', 'run-1');
  w.seedPassed('good', 'run-2', { outcome: 'ask-expired', spentUsd: 0.04, wallMs: 30_000 });
  w.seedPassed('unwired', 'run-1');
  w.seedPassed('never-passed', 'run-1', { outcome: 'cap-halt' });
  const l = await list(w);
  assert.deepEqual(l.flows.map((f) => f.flow), ['good'], 'unwired (preflight would refuse) and never-passed are not listed');
  const f = l.flows[0];
  assert.deepEqual(f.runs.map((r) => r.runId), ['run-1'], 'only the passed run is offered by name');
  assert.deepEqual(f.runs[0].values, f.values, 'a run with no signed values of its own ran with the flow\'s own');
  assert.equal(f.stats.steps, f.jobLines.filter((l) => !l.ask).length, 'steps (the ask line is not one) and asks are counted from the signed declaration');
  assert.equal(f.stats.asks, 1);
  assert.deepEqual([f.stats.green, f.stats.notGreen], [1, 1]);
  assert.ok(Math.abs(f.stats.avgSpendUsd - 0.03) < 1e-9 && f.stats.avgWallMs === 60_000);
});

test('(d) unknown cost and time are never 0: an unpriced or untimed run is left out of the averages, and with none exact they are null', async () => {
  const w = await world();
  await w.signedFlow();
  w.seedPassed('job2', 'run-1', { spendComplete: false, spentUsd: 0.01, wallMs: null });
  const f = (await list(w)).flows[0];
  assert.equal(f.stats.avgSpendUsd, null);
  assert.equal(f.stats.avgWallMs, null);
  assert.equal(f.stats.green, 1);
});

test('(d) Run again opens ANY run (a failed one too) with that run\'s own values and inputs; a run with signed values of its own shows those', async () => {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  w.seedPassed('job2', 'run-1', { outcome: 'failed' });
  const rd = path.join(flowDir, 'runs', 'run-1');
  const flow = (await list(w)).flows;
  assert.deepEqual(flow, [], 'a flow whose only run failed is not in the list ...');
  const ok = await again(w, 'job2', 'run-1');   // ... but Run again still reaches it
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json().flow.flow, 'job2');
  assert.equal(ok.json().pick.runId, 'run-1');
  assert.equal(ok.json().pick.values.capUsd, 0.25);
  // that run's own signed values (cap 0.40, wait 2h) are what Run again fills in
  const sig = JSON.parse(readFileSync(path.join(flowDir, 'signature.json'), 'utf8')).flow;
  const own = ok.json().flow.values;
  const values = { capUsd: 0.4, destination: own.destination, askWaits: Object.fromEntries(Object.keys(own.askWaits).map((k) => [k, '2h'])) };
  writeFileSync(path.join(rd, 'signed-values.json'), JSON.stringify({
    flow: 'job2', flowSignatureHash: sig, version: 0, values, hash: valuesHash({
      flow: 'job2', flowSignatureHash: sig, runId: null, version: 0, values,
    }), signedBy: 't', at: '2026-10-06T10:00:00.000Z',
  }));
  mkdirSync(path.join(rd, 'inputs'), { recursive: true });
  writeFileSync(path.join(rd, 'inputs.json'), JSON.stringify([{ id: 'resume', source: '/x/r.md' }, { id: 'jd', source: '/x/j.md' }]));
  const again2 = (await again(w, 'job2', 'run-1')).json();
  assert.equal(again2.pick.values.capUsd, 0.4);
  assert.deepEqual(Object.values(again2.pick.values.askWaits), ['2h']);
  assert.deepEqual(again2.pick.sources, { resume: '/x/r.md', jd: '/x/j.md' });
});

test('(d) Run again on a flow the run\'s preflight would refuse says why in preflight\'s own words; a missing run or flow is refused; nothing starts', async () => {
  const w = await world();
  await w.signedFlow();
  unwiredFlow(w.root, 'job2-live-1');
  w.seedPassed('job2-live-1', 'run-2', { outcome: 'preflight-red' });
  w.seedPassed('job2', 'run-1');
  const r = await again(w, 'job2-live-1', 'run-2');
  assert.equal(r.status, 409, r.text);
  assert.match(r.json().say, /step "resume-summary" \(line 3\) grants verb "compress", which has no wired implementation/);
  for (const [flow, run, status] of [['job2', 'run-9', 404], ['nope', 'run-1', 404], ['job2', '../x', 400], ['', '', 400]]) {
    // eslint-disable-next-line no-await-in-loop
    assert.equal((await again(w, flow, run)).status, status, `${flow}/${run}`);
  }
  assert.deepEqual(w.starts(), []);
});

test('(d) with nothing picked no run starts: a Run POST with no flow is refused and creates nothing', async () => {
  const w = await world();
  await w.signedFlow();
  w.seedPassed('job2', 'run-1');
  const r = await w.post('/api/author/run', { flow: '', inputs: w.inputs(), runId: '' });
  assert.equal(r.status, 400);
  assert.equal(r.json().refused, 'flow');
  assert.deepEqual(w.starts(), []);
});

test('M4e am7 item 7: runner.js holds no verb decider of its own — it imports findUnwiredVerbStep/unwiredRed from canrun.js; canrun.js does not import runner.js', () => {
  const runner = readFileSync(path.join(HERE, '..', 'src', 'runner.js'), 'utf8');
  const canrun = readFileSync(path.join(HERE, '..', 'src', 'canrun.js'), 'utf8');
  assert.doesNotMatch(runner, /function findUnwiredVerbStep/, 'runner.js must not define its own findUnwiredVerbStep');
  assert.doesNotMatch(runner, /which has no wired implementation/, 'runner.js must not carry its own red wording');
  assert.doesNotMatch(runner, /WIRED_VERBS/, 'runner.js must not carry its own verb list');
  assert.match(runner, /import \{[^}]*findUnwiredVerbStep[^}]*\} from '\.\/canrun\.js'/);
  assert.match(runner, /import \{[^}]*unwiredRed[^}]*\} from '\.\/canrun\.js'/);
  assert.doesNotMatch(canrun, /from '\.\/runner\.js'/, 'no import cycle');
});
