// M10 piece 4, Done when: "A separate script checks this, not our own checker." scripts/check-cited-run.mjs re-reads a run's saved page and its result
// record and shares no code with the check the run used. These tests make a real run (the cited step through the runner, F71's saved page), run the script
// on its folder, then damage one thing at a time: the script must say so. The script is also pinned to import nothing of ours.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { freezeInputs, runStepRalph } from '../src/runner.js';
import { flightsPart, flightRows, goodRows, PAGE } from './fixtures/m10-map/cited-help.mjs';

const SCRIPT = new URL('../scripts/check-cited-run.mjs', import.meta.url).pathname;
const tmp = (p) => mkdtempSync(join(tmpdir(), `fwdloop-m10-script-${p}-`));
const sh = (t) => createHash('sha256').update(t, 'utf8').digest('hex');

async function makeRun(results = goodRows(PAGE).slice(0, 3)) {
  const run = tmp('run');
  const frozen = await freezeInputs(run, [{ id: 'flights', path: 'https://example.test/f' }], { fetchPage: async (url) => ({ ok: true, text: PAGE, url }) });
  const out = await runStepRalph({
    step: { goal: 'List 3 flights', primitives: [], reads: ['flights'], emits: 'flight_list', fromLine: 1, close: { class: 'green', cited: flightsPart() } },
    primitivesMap: {}, readsMap: {}, businessDate: '2026-11-18',
    modelStep: async () => ({ ok: true, costUsd: 0.001, artifact: { results, done: true } }),
    spent: { value: 0 }, capUsd: 1, ceilingUsd: 0.01, recordAudit: () => {}, runDir: run,
  });
  return { run, out, frozen: frozen.manifest[0].frozen };
}
const check = (run, extra = []) => spawnSync(process.execPath, [SCRIPT, run, ...extra], { encoding: 'utf8', timeout: 30000 });
const recordPath = (run) => join(run, 'cited-checks.json');
const edit = (run, fn) => { const r = JSON.parse(readFileSync(recordPath(run), 'utf8')); fn(r); writeFileSync(recordPath(run), JSON.stringify(r)); };

test('the script imports nothing of ours and not bareguard: only Node\'s own modules', () => {
  const src = readFileSync(SCRIPT, 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.ok(imports.length > 0);
  for (const i of imports) assert.ok(i.startsWith('node:'), `imports "${i}"`);
  assert.ok(!src.includes('bareguard') || /does not import|nothing from bareguard/.test(src), 'only the header mentions it');
  assert.ok(!/from '\.\.?\/src/.test(src));
});

test('a green run: its quotes are on its own saved page and its values pass the rules - exit 0', async () => {
  const { run, out } = await makeRun();
  try {
    assert.equal(out.ok, true, out.red);
    const r = check(run);
    assert.equal(r.status, 0, r.stdout + r.stderr);
    assert.match(r.stdout, /^ok: 1 line\(s\), 3 result\(s\) checked/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('the saved page is not the bytes that were frozen - exit 1, named', async () => {
  const { run, frozen } = await makeRun();
  try {
    writeFileSync(frozen, `${PAGE}\nPay $0`);
    const r = check(run);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /not the bytes that were frozen/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a quote that is not on the saved page - exit 1', async () => {
  const { run } = await makeRun();
  try {
    edit(run, (r) => { r.lines[0].rows[1].quote = r.lines[0].rows[1].quote.replace('Nonstop flight', 'Nonstop jet'); });
    const r = check(run);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /result 2: the quote is not on the saved page word for word/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a record that names another copy of the page than the run\'s own - exit 1 (the drafting copy)', async () => {
  const { run } = await makeRun();
  try {
    edit(run, (r) => { r.lines[0].check.sha256 = sh('the drafting copy'); });
    const r = check(run);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /not this run's saved copy/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('a value the quote does not write, or one that breaks its rule - exit 1', async () => {
  const { run } = await makeRun();
  try {
    edit(run, (r) => { r.lines[0].rows[0].values.price = '10'; });
    let r = check(run);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /result 1, fact "price": the quote holds \d+, the record says 10/);
  } finally { rmSync(run, { recursive: true, force: true }); }
  const dear = await makeRun();
  try {
    // the third flight swapped, in the record, for a dearer one, its values copied from its own quote
    const pricey = flightRows(PAGE).find((x) => Number(x.values.price) >= 150);
    edit(dear.run, (rec) => { rec.lines[0].rows[2] = { n: 3, quote: pricey.quote, cells: [], values: pricey.values }; });
    const r = check(dear.run);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /result 3, fact "price": the value in the quote \(\d+\) does not pass its rule/);
  } finally { rmSync(dear.run, { recursive: true, force: true }); }
});

test('the wrong number of results - exit 1', async () => {
  const { run } = await makeRun();
  try {
    edit(run, (r) => { r.lines[0].rows.pop(); });
    const r = check(run);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /2 result\(s\) are recorded, at least 3 are required/);
  } finally { rmSync(run, { recursive: true, force: true }); }
});

test('--expect: the rules come from a file you wrote, not from the record the run wrote', async () => {
  const { run } = await makeRun();
  const exp = tmp('exp');
  try {
    const facts = flightsPart().facts.map((f) => (f.name === 'price' ? { ...f, rule: { op: 'lt', value: 100 } } : f));
    writeFileSync(join(exp, 'expect.json'), JSON.stringify({ 1: { facts, count: { min: 3, max: 3 } } }));
    const r = check(run, ['--expect', join(exp, 'expect.json')]);
    assert.equal(r.status, 1, 'the record says under 150; the file says under 100');
    assert.match(r.stdout, /fact "price": the value in the quote \(\d+\) does not pass its rule/);
    writeFileSync(join(exp, 'expect.json'), JSON.stringify({ 1: { facts: flightsPart().facts, count: { min: 3, max: 3 } } }));
    assert.equal(check(run, ['--expect', join(exp, 'expect.json')]).status, 0);
  } finally { rmSync(run, { recursive: true, force: true }); rmSync(exp, { recursive: true, force: true }); }
});

test('a red run (its judged rows kept, passed false) is not ok, and a missing record is exit 2', async () => {
  const { run } = await makeRun(goodRows(PAGE).slice(0, 2));
  try {
    const r = check(run);
    assert.equal(r.status, 1);
    assert.match(r.stdout, /the line did not pass/);
    rmSync(recordPath(run));
    assert.equal(check(run).status, 2);
  } finally { rmSync(run, { recursive: true, force: true }); }
});
