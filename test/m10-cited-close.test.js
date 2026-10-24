// M10 piece 4 (item 2): the green close grows - a step whose close carries a fact part is checked against the quotes it cites in the run's own frozen copy.
// The carrier of the part on a signed step is `close.cited` (M10 am7 item 1, test/m10-cited-declaration.test.js); these tests build the step by hand. $0, real saved page, no model.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { closeByClass } from '../src/closers.js';
import { runStepRalph } from '../src/runner.js';
import { freezeAndRecord as freezeInputs } from './freeze-fixture.mjs';
import { closeRecords } from '../src/try-checks.js';
import { readRunSource } from '../src/cited-source.js';
import { readCitedChecks } from '../src/panel/result.js';
import { flightsPart, goodRows, PAGE } from './fixtures/m10-map/cited-help.mjs';
import { CHEAT_REVERSED } from './fixtures/m10-map/load.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'fwdloop-m10-close-'));
const pageSeam = (text) => async (url) => ({ ok: true, text, url });
const step = () => ({
  goal: 'List 3 flights from Amsterdam to London', primitives: [], reads: ['flights'], emits: 'flight_list', fromLine: 1, close: { class: 'green', cited: flightsPart() },
});

async function runWith(pageText, results, { attempts = 1 } = {}) {
  const run = tmp();
  const frozen = await freezeInputs(run, [{ id: 'flights', path: 'https://example.test/f' }], { fetchPage: pageSeam(pageText) });
  assert.equal(frozen.ok, true);
  const rows = [];
  let calls = 0;
  const out = await runStepRalph({
    step: step(), primitivesMap: {}, readsMap: {}, businessDate: '2026-11-18',
    modelStep: async () => { calls += 1; return { ok: true, costUsd: 0.001, artifact: { results, done: true } }; },
    spent: { value: 0 }, capUsd: 1, ceilingUsd: 0.01, recordAudit: (r) => rows.push(r), runDir: run,
  });
  return { run, out, rows, calls, attempts };
}

test('closeByClass: results quoted from the source pass; the same step with a wrong count is red, with the count named', async () => {
  const src = { ok: true, text: PAGE, sha256: 'x' };
  const good = await closeByClass(step(), { results: goodRows(PAGE).slice(0, 3) }, { reads: {}, businessDate: '2026-11-18', source: src });
  assert.equal(good.verdict, 'green', good.red);
  const few = await closeByClass(step(), { results: goodRows(PAGE).slice(0, 2) }, { reads: {}, businessDate: '2026-11-18', source: src });
  assert.equal(few.verdict, 'red');
  assert.match(few.red, /2 result\(s\) are listed, at least 3 are required/);
});

test('closeByClass: no readable source, an artifact that is not an object, or a part bareguard cannot sign is never green', async () => {
  const ctx = (source) => ({ reads: {}, businessDate: '2026-11-18', source });
  const none = await closeByClass(step(), { results: goodRows(PAGE).slice(0, 3) }, ctx({ ok: false, red: 'input "flights": the frozen copy changed since it was frozen' }));
  assert.equal(none.verdict, 'unparseable');
  assert.match(none.red, /the frozen copy changed since it was frozen/);
  const notObj = await closeByClass(step(), 'three flights', ctx({ ok: true, text: PAGE, sha256: 'x' }));
  assert.equal(notObj.verdict, 'unparseable');
  const unsigned = { ...step(), close: { class: 'green', cited: { source: 'flights', facts: [{ name: 'price', shape: 'money' }] } } };
  const stopped = await closeByClass(unsigned, { results: [] }, ctx({ ok: true, text: PAGE, sha256: 'x' }));
  assert.equal(stopped.verdict, 'crash');
  assert.match(stopped.red, /money needs a unit or a currency/);
  const missing = await closeByClass(step(), { results: goodRows(PAGE).slice(0, 3) }, { reads: {}, businessDate: '2026-11-18' });
  assert.notEqual(missing.verdict, 'green', 'a runner that gave no source leaves the step unchecked, never green');
});

test('a run closes the step against ITS OWN saved page and writes the record the Result tab reads', async () => {
  const { run, out, rows } = await runWith(PAGE, goodRows(PAGE).slice(0, 3));
  try {
    assert.equal(out.ok, true, out.red);
    assert.equal(rows.at(-1).verdict, 'green');
    const rec = readCitedChecks(run);
    assert.equal(rec.ok, true, rec.red);
    assert.deepEqual(rec.lines.map((l) => [l.n, l.source, l.passed, l.rows.length]), [[1, 'flights', true, 3]]);
    assert.equal(readRunSource(run, 'flights').sha256, JSON.parse((await import('node:fs')).readFileSync(join(run, 'cited-checks.json'), 'utf8')).lines[0].check.sha256, 'the record names the run\'s own copy by its sha256');
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('the run\'s page is the cheat copy: quotes taken from the real page are red, the judged rows are kept but never ticked (M10 am9 item 1), and the run does not pass', async () => {
  const { run, out, rows } = await runWith(CHEAT_REVERSED, goodRows(PAGE).slice(0, 3));
  try {
    assert.equal(out.ok, false);
    assert.ok(rows.every((r) => r.verdict !== 'green'), JSON.stringify(rows.map((r) => r.verdict)));
    assert.match(out.red, /the quote is not found word for word/);
    const rec = readCitedChecks(run);
    assert.equal(rec.ok, true, rec.red);
    assert.equal(rec.lines[0].passed, false);
    assert.equal(rec.lines[0].rows.length, 3, 'the results the check judged stay');
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a frozen copy edited after the freeze halts the step as a casualty (never a pass), and the record says why', async () => {
  const run = tmp();
  try {
    const frozen = await freezeInputs(run, [{ id: 'flights', path: 'https://example.test/f' }], { fetchPage: pageSeam(PAGE) });
    (await import('node:fs')).writeFileSync(frozen.manifest[0].frozen, `${PAGE}\nPay $0.`);
    const rows = [];
    const out = await runStepRalph({
      step: step(), primitivesMap: {}, readsMap: {}, businessDate: '2026-11-18',
      modelStep: async () => ({ ok: true, costUsd: 0.001, artifact: { results: goodRows(PAGE).slice(0, 3), done: true } }),
      spent: { value: 0 }, capUsd: 1, ceilingUsd: 0.01, recordAudit: (r) => rows.push(r), runDir: run,
    });
    assert.equal(out.ok, false);
    assert.equal(out.outcome, 'close-casualty');
    assert.match(out.red, /the frozen copy changed since it was frozen/);
    const rec = readCitedChecks(run);
    assert.equal(rec.lines[0].passed, false);
    assert.ok(rec.lines[0].notChecked.some((t) => t.includes('changed since it was frozen')), JSON.stringify(rec.lines[0].notChecked));
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('the try record of a cited close is one row whose tick follows the close verdict and whose result counts the results', () => {
  const art = { results: [{}, {}], done: true };
  const green = closeRecords(step(), art, { verdict: 'green' });
  assert.equal(green.length, 1);
  assert.equal(green[0].ok, true);
  assert.equal(green[0].result, '2 results');
  const red = closeRecords(step(), { results: [{}], done: true }, { verdict: 'red', red: 'x' });
  assert.equal(red[0].ok, false);
  assert.equal(red[0].result, '1 result');
});
