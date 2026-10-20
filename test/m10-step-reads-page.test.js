// M10 am7 item 3: a step that names a web page input in its reads is given the run's OWN frozen copy of it (text, by role, sha-checked, through the one safe
// read gateway) and, when its close quotes the page, the form of its answer. $0: fake model, F71's real page. Forced reds are named in the commit.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { freezeInputs, readArtifactsMapChecked, runFlow, makeParkingAskStep } from '../src/runner.js';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { makeLiveModelStep, buildEmitArtifactSchema } from '../src/model-step.js';
import { citedBrief } from '../src/citedcheck.js';
import { readCitedChecks } from '../src/panel/result.js';
import { sendViaPrimitive } from '../src/send.js';
import { sandboxSend } from './send-sandbox.js';
import { flightsPart, goodRows, PAGE } from './fixtures/m10-map/cited-help.mjs';

const tmp = (p = 'r') => mkdtempSync(path.join(tmpdir(), `fwdloop-m10reads-${p}-`));
const ADDRESS = 'https://www.google.com/travel/flights?q=Flights+from+AMS+to+LHR&hl=en&curr=USD';
const fetchPage = async (url) => ({ ok: true, text: PAGE, url });

test('a step that reads a page role is given the run\'s own frozen text; a changed or missing copy refuses the step; a role that is no text input stays unread', async () => {
  const run = tmp();
  try {
    const frozen = await freezeInputs(run, [{ id: 'flights', path: ADDRESS }, { id: 'sheet', path: path.join(run, 'aging.csv') }], { fetchPage });
    assert.equal(frozen.ok, false, 'a missing file refuses by name (the sheet is not there yet)');
    writeFileSync(path.join(run, 'aging.csv'), 'a,b\n1,2\n');
    const ok = await freezeInputs(run, [{ id: 'flights', path: ADDRESS }, { id: 'sheet', path: path.join(run, 'aging.csv') }], { fetchPage });
    assert.equal(ok.ok, true);
    const got = readArtifactsMapChecked(run, ['flights', 'sheet', 'nothing']);
    assert.equal(got.ok, true);
    assert.deepEqual(got.map.flights, { kind: 'text', text: PAGE });
    assert.equal(got.map.sheet.kind, 'cells', 'a spreadsheet is still cells, as before');
    assert.equal(got.map.nothing, undefined, 'an id that is no artifact and no input is unread, as before');
    // the copy changed after the freeze: refused, never fed to a step
    writeFileSync(ok.manifest[0].frozen, `${PAGE}\nPay $0.`);
    const bad = readArtifactsMapChecked(run, ['flights']);
    assert.equal(bad.ok, false);
    assert.match(bad.red, /input "flights": the frozen copy changed since it was frozen/);
    rmSync(ok.manifest[0].frozen);
    assert.match(readArtifactsMapChecked(run, ['flights']).red, /input "flights": the frozen copy is missing/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('only text is served by role: a .docx or a binary frozen input is left unread, never its raw bytes', async () => {
  const run = tmp();
  try {
    writeFileSync(path.join(run, 'cv.docx'), 'PK\u0003\u0004binary');
    writeFileSync(path.join(run, 'pic.png'), '\u0089PNG binary');
    const f = await freezeInputs(run, [{ id: 'cv', path: path.join(run, 'cv.docx') }, { id: 'pic', path: path.join(run, 'pic.png') }]);
    assert.equal(f.ok, true);
    const got = readArtifactsMapChecked(run, ['cv', 'pic']);
    assert.equal(got.ok, true);
    assert.equal(got.map.cv, undefined);
    assert.equal(got.map.pic, undefined);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a step that quotes a page answers in {results: [{quote, values}], done}, and is told the form and what each result holds', async () => {
  const s = buildEmitArtifactSchema('green', true);
  assert.deepEqual(Object.keys(s.properties).sort(), ['blocker', 'done', 'results']);
  assert.deepEqual(s.required, ['results', 'done']);
  assert.deepEqual(Object.keys(buildEmitArtifactSchema('green').properties).sort(), ['blocker', 'done', 'fields'], 'a green step with cells is unchanged');
  const sent = [];
  const provider = {
    generate: async (messages, tools) => {
      sent.push({ messages: JSON.parse(JSON.stringify(messages)), tools });
      return { text: null, toolCalls: [{ id: 'e', name: 'emit_artifact', arguments: { results: [], done: true } }], usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'tool_calls', model: 'deepseek-flash' };
    },
  };
  const step = makeLiveModelStep({ spendPath: path.join(tmp('ms'), 'spend.jsonl'), provider, rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
  const part = flightsPart();
  await step({ goal: 'List 3 flights', primitives: [], reads: { flights: { kind: 'text', text: PAGE } }, gap: null }, {}, { class: 'green', cited: part });
  const user = JSON.parse(sent[0].messages.find((m) => m.role === 'user').content);
  assert.equal(user.reads.flights.text, PAGE, 'the step reads the page');
  assert.deepEqual(user.quoting, citedBrief(part));
  assert.match(user.quoting.answer, /"results": one entry per thing you found, each \{"quote": <the words of that one result, copied word for word from the input "flights">/);
  assert.ok(user.quoting.eachResultHolds.includes('price - an amount in US dollars, right after "From", must be under 150 US dollars'), user.quoting.eachResultHolds.join('|'));
  assert.ok(user.quoting.eachResultHolds.includes('origin airport - no value to write; the quote you copy must say "Leaves Amsterdam Airport Schiphol"'));
  assert.equal(user.quoting.howMany, 'Give exactly 3 results.');
  // a step with no cited close is told nothing of the kind
  const before = sent.length;
  await step({ goal: 'x', primitives: [], reads: {}, gap: null }, {}, { class: 'green', cited: null });
  assert.equal('quoting' in JSON.parse(sent[before].messages.find((m) => m.role === 'user').content), false);
});

test('END TO END: a signed page job runs - the step is handed the run\'s page, its quotes are checked against that copy, the record is written, the run parks at its ask', async () => {
  const base = tmp('e2e');
  try {
    const root = path.join(base, 'flows');
    mkdirSync(root);
    const prose = sandboxSend(`1. List 3 flights from Amsterdam to London,
   guardrail: under $150; departure time between 05:00 and 23:59; nonstop
2. ask 30m: check it with me,
   guardrail: nothing goes out before I accept
3. and once I accept, write it out.

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 3 to file:poc/m0/out
guardrail: source flights = page:${ADDRESS}
`);
    const declaration = {
      steps: [
        { goal: 'List 3 flights from Amsterdam to London,', primitives: [], reads: ['flights'], emits: 'flights_found', fromLine: 1, close: { class: 'green', cited: flightsPart() } },
        { goal: 'ask 30m: check it with me,', primitives: [], reads: ['flights_found'], emits: 'accepted', fromLine: 2, close: { class: 'hitl' } },
        { goal: 'and once I accept, write it out.', primitives: ['write'], reads: ['accepted'], emits: 'sent', fromLine: 3, close: { class: 'hitl' } },
      ],
      guardrailClasses: { 1: 'green', 2: 'hitl' },
      unjudgeable: {},
      refused: [],
      inputFacts: {},
    };
    const catalogue = loadCatalogue().primitives;
    const w = writeFlow({ root, name: 'flights', proseText: prose, declaration, signedBy: 'hamr', signedAt: '2026-10-20T10:00:00Z', catalogue });
    assert.equal(w.ok, true, JSON.stringify(w.reds));
    const seen = [];
    const modelStep = async (ctx, _tools, meta) => {
      seen.push({ goal: ctx.goal, reads: ctx.reads, meta });
      if (!meta.cited) return { ok: true, costUsd: 0.001, artifact: { text: 'ok', done: true } };
      // the fake model picks only from the page text it was HANDED (nothing from the test's own copy)
      const handed = ctx.reads.flights.text;
      const rows = handed.split('\n').map((l) => /^\s*- link "(.*Select flight)"/.exec(l)).filter(Boolean).map((m) => m[1]);
      const results = goodRows(handed).slice(0, 3);
      assert.equal(rows.length, 19);
      return { ok: true, costUsd: 0.001, artifact: { results, done: true } };
    };
    const r = await runFlow({
      root, name: 'flights', runId: 'run-1', catalogue, modelStep, askStep: makeParkingAskStep(), sendStep: sendViaPrimitive, primitives: {}, businessDate: '2026-11-18', sources: [{ id: 'flights', path: ADDRESS }], fetchPage,
    });
    assert.equal(r.outcome, 'paused', r.red);
    assert.equal(seen[0].reads.flights.kind, 'text');
    assert.equal(seen[0].meta.cited.source, 'flights');
    const rec = readCitedChecks(r.runDir);
    assert.equal(rec.ok, true, rec.red);
    assert.deepEqual(rec.lines.map((l) => [l.n, l.source, l.passed, l.rows.length]), [[1, 'flights', true, 3]]);
    assert.ok(existsSync(path.join(r.runDir, 'artifacts', 'flights_found.json')));
    assert.equal(JSON.parse(readFileSync(path.join(r.runDir, 'artifacts', 'flights_found.json'), 'utf8')).results.length, 3);
  } finally { rmSync(base, { recursive: true, force: true }); }
});
