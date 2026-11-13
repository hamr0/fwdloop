// M16 item 1 + am3 (3), P5: place rules at run start. A changelog-version fact is read, by code, from the run's OWN frozen copy of the input before any provider call and
// bound in memory as the fact's phrase; the value rides run.json (no new run-folder file); a resume reads it back. $0, fake provider. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { rmSync, mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { loadCatalogue } from '../src/catalogue.js';
import { makeLiveModelStep } from '../src/model-step.js';
import { runFlow, resumeRun, makeParkingAskStep, stepsWithRecordedPlaces } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { readAudit } from '../src/books.js';
import { sendViaPrimitive } from '../src/send.js';
import { sandboxSend } from './send-sandbox.js';
import { NO_PLACE_RECORD_WORDS } from '../src/placerule.js';

const RULE = { kind: 'headingBetween', prefix: '## [', end: ']', shape: 'semver', skip: ['Unreleased'] };
const LOG = (v) => `# Changelog\n\n## [Unreleased]\n\n## [${v}] - 2026-11-04\n\n- one\n\n## [0.54.1] - 2026-11-01\n`;
const PROSE = `1. Read the newest release heading of the changelog,
   guardrail: the heading names the newest release
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source log = file:CHANGELOG.md
`;
const declOf = () => ({
  steps: [
    { goal: 'Read the newest release heading of the changelog,', primitives: [], reads: ['log'], emits: 'release', fromLine: 1, close: { class: 'green', cited: { source: 'log', facts: [{ name: 'version', shape: 'phrase', phrase: '0.50.0', place: RULE }], count: { min: 1, max: 1 } } } },
    { goal: 'ask 30m: check it with me,', primitives: [], reads: ['release'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
    { goal: 'and once I accept, write it out.', primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 1: 'green', 2: 'hitl' }, unjudgeable: {}, refused: [], inputFacts: {},
});
const lsAll = (dir) => readdirSync(dir, { recursive: true }).map((f) => String(f).replace(/[0-9a-f]{8}-[0-9a-f-]{27}/, '<ask-id>')).sort();

/** a signed flow + the input file in a scratch dir; `calls` counts provider calls */
function setup(t, { logText, quoteVersion }) {
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16place-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'flows');
  mkdirSync(root);
  const input = path.join(base, 'CHANGELOG.md');
  writeFileSync(input, logText);
  const catalogue = loadCatalogue().primitives;
  const w = writeFlow({ root, name: 'rel', proseText: sandboxSend(PROSE), declaration: declOf(), signedBy: 'hamr', signedAt: '2026-11-13T10:00:00Z', catalogue });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  const calls = { n: 0 };
  const provider = {
    generate: async () => {
      calls.n += 1;
      const rows = [{ quote: `## [${quoteVersion}] - 2026-11-04`, values: {} }];
      return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { results: rows, done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
    },
  };
  const modelStep = makeLiveModelStep({ spendPath: path.join(base, 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  const go = () => runFlow({ root, name: 'rel', runId: 'run-1', catalogue, modelStep, askStep: makeParkingAskStep(), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-18', sources: [{ id: 'log', path: input }] });
  return { base, root, input, catalogue, calls, go, runDir: path.join(root, 'rel', 'runs', 'run-1'), modelStep };
}

test('(P5) a changelog-version fact reads the run\'s own frozen copy: the signed words (0.50.0) are replaced by 0.55.0 and the quote of 0.55.0 passes; no provider call before the read', async (t) => {
  const s = setup(t, { logText: LOG('0.55.0'), quoteVersion: '0.55.0' });
  const out = await s.go();
  assert.notEqual(out.outcome, 'preflight-red', JSON.stringify(out));
  const tries = readAudit(s.runDir).filter((a) => a.step === 'release');
  assert.ok(tries.length > 0 && tries.every((a) => a.verdict !== 'red'), JSON.stringify(tries.map((a) => [a.verdict, a.gap]))); // break: skip the bind and the signed 0.50.0 is not in the quote, so a try reds
  const rec = JSON.parse(readFileSync(path.join(s.runDir, 'run.json'), 'utf8'));
  assert.equal(rec.placeRules.rows[0].value, '0.55.0');
  assert.equal(rec.placeRules.rows[0].found, true);
});

test('(P5) a heading that does not match the rule stops preflight-red at $0 with the plain reason, no provider call, no run.json', async (t) => {
  const s = setup(t, { logText: '# Changelog\n\n## Version 3 notes\n', quoteVersion: '0.55.0' });
  const out = await s.go();
  assert.equal(out.outcome, 'preflight-red', JSON.stringify(out)); // break: drop the stop and the run goes on to call the provider
  assert.match(out.red, /^version: not found \(/);
  assert.match(out.red, /The run did not start\. Nothing spent\.$/);
  assert.equal(s.calls.n, 0, 'no provider call');
  assert.equal(lsAll(s.runDir).includes('run.json'), false);
});

test('(P5) the run folder gains no new file: only run.json carries the value (files listed with and without the place fact)', async (t) => {
  const s = setup(t, { logText: LOG('0.55.0'), quoteVersion: '0.55.0' });
  await s.go();
  const withPlace = lsAll(s.runDir);
  // the same job without a place rule, on a fresh scratch: the same files must appear
  const base = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16place-plain-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const root = path.join(base, 'flows');
  mkdirSync(root);
  writeFileSync(path.join(base, 'CHANGELOG.md'), LOG('0.55.0'));
  const d = declOf();
  d.steps[0].close.cited.facts = [{ name: 'version', shape: 'phrase', phrase: '0.55.0' }];
  assert.equal(writeFlow({ root, name: 'rel', proseText: sandboxSend(PROSE), declaration: d, signedBy: 'hamr', signedAt: '2026-11-13T10:00:00Z', catalogue: s.catalogue }).ok, true);
  await runFlow({ root, name: 'rel', runId: 'run-1', catalogue: s.catalogue, modelStep: s.modelStep, askStep: makeParkingAskStep(), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-18', sources: [{ id: 'log', path: path.join(base, 'CHANGELOG.md') }] });
  assert.deepEqual(withPlace, lsAll(path.join(root, 'rel', 'runs', 'run-1')), 'break: write the value to its own file and this lists one more');
});

test('(P5) a resume reads the recorded value back from run.json and binds it; a missing record is the plain no-record words', async (t) => {
  const s = setup(t, { logText: LOG('0.55.0'), quoteVersion: '0.55.0' });
  await s.go();
  const steps = declOf().steps;
  const got = stepsWithRecordedPlaces(s.runDir, steps);
  assert.equal(got.ok, true);
  assert.equal(got.steps[0].close.cited.facts[0].phrase, '0.55.0'); // break: bind nothing and it stays the signed 0.50.0
  assert.equal(steps[0].close.cited.facts[0].phrase, '0.50.0', 'the signed steps are not touched');
  const rec = path.join(s.runDir, 'run.json');
  const j = JSON.parse(readFileSync(rec, 'utf8'));
  delete j.placeRules;
  writeFileSync(rec, JSON.stringify(j));
  const none = stepsWithRecordedPlaces(s.runDir, steps);
  assert.deepEqual(none, { ok: false, words: NO_PLACE_RECORD_WORDS });
  assert.deepEqual(stepsWithRecordedPlaces(s.runDir, [{ emits: 'x', close: { class: 'hitl' } }]).ok, true, 'a job with no place fact needs no record');
  void resumeRun;
});
