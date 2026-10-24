// M8 am6: `fwdloop learn seed --root <flows>` seeds the ledger from every ended run already recorded. REAL in-process runs on job2's fixture
// (fake modelStep) write the run folders under a temp root; the seed then reads them into a SEPARATE scratch ledger home. Temp roots only.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { readHistory } from '../src/books.js';
import { loadCatalogue } from '../src/catalogue.js';
import { answerAsk } from '../src/ask.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { readLedger, seedLedger, hintsForRun } from '../src/learnstore.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8am6-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const BAD = '## summary of work history blurb\nworked places.';
const DAY = 86400000;
const NOW = Date.now();
const iso = (ms) => new Date(ms).toISOString();
const T1 = iso(NOW - 10 * DAY); const T2 = iso(NOW - 9 * DAY); const T3 = iso(NOW - 8 * DAY);
const T_OLD = iso(NOW - 100 * DAY); const T_OLD2 = iso(NOW - 99 * DAY); const T_WG = iso(NOW - 2 * 3600000); const T_NEW = iso(NOW - 3600000);

function modelStepFor(plan) {
  let n = 0;
  return async (ctx) => {
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    if (ctx.goal.includes('Draft the summary resume')) {
      n += 1;
      const p = plan(n);
      if (p === 'transport') return { ok: false, transport: true, costUsd: 0.001, red: 'socket hang up' };
      return { ok: true, costUsd: 0.001, artifact: { text: p === 'red' ? BAD : GOOD, done: true } };
    }
    throw new Error(`unexpected goal: ${ctx.goal}`);
  };
}

/** one root with every run the tests need, made once; the run-time ledger goes to a throwaway home, never the seed's */
let built = null;
async function world() {
  if (built) return built;
  process.env.FWDLOOP_CONFIG_HOME = tmp('runtime-home');
  const root = tmp('root');
  const src = tmp('src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  const mk = (name) => {
    const w = writeFlow({
      root, name, proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE,
    });
    assert.equal(w.ok, true);
  };
  const args = (name, runId, at, modelStep) => ({
    root, name, runId, catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', askStep: makeParkingAskStep(), clock: () => at, sources,
  });
  for (const n of ['wa', 'wb', 'wc', 'wd', 'we', 'wf', 'wg']) mk(n);
  // created OUT of end-time order on purpose: the seed must sort by the run's own end time
  assert.equal((await runFlow(args('wa', 'run-2', T3, modelStepFor(() => 'red')))).outcome, 'struck-out');
  assert.equal((await runFlow(args('wf', 'run-1', T_NEW, modelStepFor(() => 'red')))).outcome, 'struck-out');
  assert.equal((await runFlow(args('wa', 'run-1', T1, modelStepFor(() => 'red')))).outcome, 'struck-out');
  assert.equal((await runFlow(args('we', 'run-1', T_OLD, modelStepFor(() => 'red')))).outcome, 'struck-out');
  assert.equal((await runFlow(args('we', 'run-2', T_OLD2, modelStepFor(() => 'red')))).outcome, 'struck-out');
  // FIXED: red then good, parks at its ask, accepted, resumed to the end at T2
  const fixedModel = modelStepFor((n) => (n === 1 ? 'red' : 'good'));
  const p = await runFlow(args('wb', 'run-1', T2, fixedModel));
  assert.equal(p.outcome, 'paused', p.red);
  assert.equal(answerAsk({ runDir: path.join(root, 'wb', 'runs', 'run-1'), askId: p.askId, decision: 'accept', clock: () => T2 }).ok, true);
  assert.equal((await resumeRun(args('wb', 'run-1', T2, fixedModel))).outcome, 'complete');
  // still waiting at its ask
  assert.equal((await runFlow(args('wc', 'run-1', T2, modelStepFor((n) => (n === 1 ? 'red' : 'good'))))).outcome, 'paused');
  // noise: the provider broke
  assert.equal((await runFlow(args('wd', 'run-1', T2, modelStepFor((n) => (n === 1 ? 'red' : 'transport'))))).outcome, 'provider-red');
  // unreadable: a run whose log.json is garbage, then a good run after it in the same job
  assert.equal((await runFlow(args('wg', 'run-1', T_WG, modelStepFor(() => 'red')))).outcome, 'struck-out');
  writeFileSync(path.join(root, 'wg', 'runs', 'run-1', 'log.json'), '{ not json');
  assert.equal((await runFlow(args('wg', 'run-2', T_WG, modelStepFor(() => 'red')))).outcome, 'struck-out');
  delete process.env.FWDLOOP_CONFIG_HOME;
  built = { root };
  return built;
}
const seedHome = () => tmp('seed-home');
const hashOf = (root, name) => readHistory(path.join(root, name)).at(-1).signatureHash;

test('am6: red-then-green and stuck runs of two workflows seed the right rows, oldest end time first, counts piling up across one workflow\'s runs', async () => {
  const { root } = await world();
  const home = seedHome();
  const r = seedLedger({ root, home });
  assert.equal(r.problem, null);
  const L = readLedger(home).ledger;
  // order of folding = order of the runs' own end times, not of creation
  assert.deepEqual(Object.keys(L.health), ['we/run-1', 'we/run-2', 'wa/run-1', 'wb/run-1', 'wd/run-1', 'wa/run-2', 'wg/run-2', 'wf/run-1']);
  const wa = L.rows.find((x) => x.workflow === 'wa');
  assert.deepEqual([wa.count, wa.sample.kind, wa.runIds], [2, 'NEVER_FIXED', ['wa/run-1', 'wa/run-2']]);
  const wb = L.rows.find((x) => x.workflow === 'wb');
  assert.deepEqual([wb.count, wb.sample.kind, wb.runIds], [1, 'FIXED', ['wb/run-1']]);
  assert.equal(L.rows.some((x) => x.workflow === 'wc' || x.workflow === 'wd'), false, 'a waiting run and a noise run make no row');
});

test('am6: each note keeps its run\'s own end time (health line, firstSeen, lastSeen), never today', async () => {
  const { root } = await world();
  const home = seedHome();
  seedLedger({ root, home });
  const L = readLedger(home).ledger;
  assert.equal(L.health['wa/run-1'].at, T1);
  assert.equal(L.health['wa/run-2'].at, T3);
  const wa = L.rows.find((x) => x.workflow === 'wa');
  assert.deepEqual([wa.firstSeen, wa.lastSeen], [T1, T3]);
  assert.equal(L.rows.find((x) => x.workflow === 'wb').lastSeen, T2);
});

test('am6: a run older than 56 days is in the ledger but not handed; a recent one is', async () => {
  const { root } = await world();
  const home = seedHome();
  seedLedger({ root, home });
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: true }));
  const L = readLedger(home).ledger;
  assert.equal(L.rows.some((x) => x.workflow === 'we'), true, 'the old run is in the ledger');
  // every job here reads the same file, so the same mistake climbs to "this place": ask for the block a job at that place is handed
  const place = L.rows.find((x) => x.workflow === 'wa').place;
  const got = hintsForRun({ home, spec: { job: 'wa', inputs: [{ value: place }] }, specHash: hashOf(root, 'wa') });
  const idOf = (name) => L.rows.find((x) => x.workflow === name).id;
  assert.ok(got && got.ids.includes(idOf('wa')), 'a recent row is handed');
  assert.equal(got.ids.includes(idOf('we')), false, 'the 100-day-old row is in the ledger but not handed');
});

test('am6: a second seed adds nothing (the ledger file is not touched)', async () => {
  const { root } = await world();
  const home = seedHome();
  const first = seedLedger({ root, home });
  assert.ok(first.added > 0);
  const file = path.join(home, 'learn', 'ledger.json');
  const before = readFileSync(file, 'utf8');
  const second = seedLedger({ root, home });
  assert.equal(second.added, 0);
  assert.equal(second.skipped['already-in'], 8, 'every run the first seed folded (the noise run included)');
  assert.equal(readFileSync(file, 'utf8'), before);
});

test('am6: a run waiting at an ask and a noise run are skipped and counted; an unreadable run is counted and the seed goes on', async () => {
  const { root } = await world();
  const home = seedHome();
  const r = seedLedger({ root, home });
  assert.deepEqual(r.skipped, { 'already-in': 0, 'still-waiting': 1, 'no-end': 0, unreadable: 1, noise: 1 });
  assert.equal(r.read, 10);
  assert.equal(r.added, 7, 'we x2, wa x2, wb, wg/run-2, wf: one note each');
});

test('am6: a test process with no config home writes nothing', async () => {
  const { root } = await world();
  delete process.env.FWDLOOP_CONFIG_HOME;
  const r = seedLedger({ root });
  assert.equal(r.skippedNoDoor, true);
  assert.equal(r.read, 0);
});

test('am6: the command prints the summary', async () => {
  const { root } = await world();
  const home = seedHome();
  const env = { ...process.env, NODE_ENV: 'test', FWDLOOP_CONFIG_HOME: home };
  delete env.NODE_TEST_CONTEXT;
  const run = () => spawnSync(process.execPath, [BIN, 'learn', 'seed', '--root', root], { env, encoding: 'utf8', timeout: 60000 });
  const a = run();
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, 'runs read: 10\nnotes added: 7\nruns skipped: 3 (already in: 0, still waiting: 1, no end: 0, unreadable: 1, noise: 1)\n');
  const b = run();
  assert.equal(b.stdout, 'runs read: 10\nnotes added: 0\nruns skipped: 10 (already in: 8, still waiting: 1, no end: 0, unreadable: 1, noise: 0)\n');
  assert.equal(existsSync(path.join(home, 'learn', 'ledger.json')), true);
});
