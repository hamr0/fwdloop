// M8 am7 wiring, through the REAL runner paths (not runStepRalph alone): a redo at an ask and a rerun answered through `resumeRun` hand the redone step's new try / the rerun's first try the drafter's block. $0: fake model step, job2's fixture, scratch config home (mkdtemp, cleaned up).
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow, resumeRun, makeParkingAskStep } from '../src/runner.js';
import { answerAsk } from '../src/ask.js';
import { readAudit } from '../src/books.js';
import { hintsForRun, writeLedger, placeSpecOf } from '../src/learnstore.js';
import { emptyLedger, countLedger } from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (name) => readFileSync(path.join(HERE, 'fixtures', name), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8am8w-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const NOW = new Date();

/** a job2 world with learningHints ON and one job2 row; every model call is recorded: which step, what block it was handed, what thinking it asked */
function world() {
  const home = tmp('home');
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: true }));
  const L = countLedger(emptyLedger(), { runid: 'r0', cards: cardsOf('ms2c0ls7').cards, workflow: 'job2', place: null, specHash: null, trust: 'deterministic', now: NOW });
  writeLedger({ ...L, rows: L.rows.map((r) => ({ ...r, lastSeen: NOW.toISOString() })) }, home);
  process.env.FWDLOOP_CONFIG_HOME = home;
  const root = tmp('root');
  const w = writeFlow({ root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE });
  assert.equal(w.ok, true);
  const src = tmp('src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  /** @type {{step: string|null, attempt: number, hints: string|null, thinking: string}[]} */
  const calls = [];
  const modelStep = async (ctx, _tools, meta) => {
    calls.push({ step: meta.step, attempt: meta.attempt, hints: ctx.hints, thinking: meta.thinkingMode });
    if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
    if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
    return { ok: true, costUsd: 0.001, artifact: { text: GOOD, done: true } };
  };
  const base = { root, name: 'job2', catalogue: CATALOGUE, modelStep, sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01' };
  const block = hintsForRun({ home, spec: placeSpecOf('job2', sources[0].path), specHash: null, now: new Date() });
  assert.ok(block && block.text.length > 0, 'the drafter\'s block exists');
  return { home, root, sources, calls, base, block, runDir: path.join(root, 'job2', 'runs', 'run-1') };
}

test('a redo at an ask (the real runFlow path): the redone step\'s new try gets the drafter\'s block and thinks on; no earlier try does', async () => {
  const w = world();
  let asked = 0;
  const askStep = async () => { asked += 1; return asked === 1 ? { decision: 'redo', reason: 'make it shorter' } : { decision: 'accept' }; };
  const r = await runFlow({ ...w.base, runId: 'run-1', sources: w.sources, askStep });
  assert.equal(r.outcome, 'complete', r.red);
  const redoCalls = w.calls.filter((c) => c.hints !== null);
  assert.equal(redoCalls.length, 1, `exactly the redo try was handed a block: ${JSON.stringify(w.calls)}`);
  assert.equal(redoCalls[0].hints, w.block.text, 'the drafter\'s block, whole');
  assert.equal(redoCalls[0].thinking, 'on');
  assert.ok(redoCalls[0].attempt >= 2, 'numbered after the first try');
  assert.ok(w.calls.filter((c) => c.hints === null).every((c) => c.thinking === 'off'), 'every other try thinks off');
  const rec = readAudit(w.runDir).filter((x) => Object.hasOwn(x, 'hints'));
  assert.deepEqual(rec.map((x) => [x.attempt, x.hintsText]), [[redoCalls[0].attempt, w.block.text]], 'the audit row of the redo try carries the exact text');
});

test('a rerun answered through resumeRun: the new run\'s first step\'s first try starts from the reason and is handed the block; thinking follows the decider (off); no other first try gets it', async () => {
  const w = world();
  const parked = await runFlow({ ...w.base, runId: 'run-1', sources: w.sources, askStep: makeParkingAskStep() });
  assert.equal(parked.outcome, 'paused', parked.red);
  assert.ok(w.calls.every((c) => c.hints === null && c.thinking === 'off'), 'the first run: no block, thinking off');
  const before = w.calls.length;
  assert.equal(answerAsk({ runDir: parked.runDir, askId: parked.askId, decision: 'rerun', reason: 'start over' }).ok, true);
  const r = await resumeRun({ ...w.base, runId: 'run-1' });
  assert.equal(r.outcome, 'rerun', r.red);
  const rerunCalls = w.calls.slice(before);
  assert.ok(rerunCalls.length >= 3, `the rerun ran every step: ${JSON.stringify(rerunCalls)}`);
  assert.equal(rerunCalls[0].hints, w.block.text, 'the rerun\'s first try: the drafter\'s block, whole');
  assert.equal(rerunCalls[0].thinking, 'off', 'thinking on that try follows stepThinkingMode: a first try is off');
  for (const c of rerunCalls.slice(1)) {
    assert.equal(c.hints, null, `step ${c.step} try ${c.attempt}: a plain first try gets no block`);
    assert.equal(c.thinking, 'off', `step ${c.step} try ${c.attempt}: thinks off`);
  }
});
