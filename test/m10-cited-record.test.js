// M10 piece 4: the writer of the cited section of <run>/line-checks.json and the shape the Result tab's reader (readCitedChecks) takes. $0, real saved page.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readFileSync, rmSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { checkCited } from '../src/citedcheck.js';
import { citedLineOf, writeCitedLine } from '../src/cited-record.js';
import { readCitedChecks } from '../src/panel/result.js';
import { flightsPart, goodRows, PAGE } from './fixtures/m10-map/cited-help.mjs';

const tmp = () => mkdtempSync(join(tmpdir(), 'fwdloop-m10-cited-'));

async function green() {
  const part = flightsPart();
  const results = goodRows(PAGE).slice(0, 3);
  const check = await checkCited({ part, text: PAGE, results });
  return { part, results, check };
}

test('a green line is read back by the Result tab\'s reader: facts, one row per result, a cell per fact, a proof that is real spans', async () => {
  const { part, results, check } = await green();
  assert.equal(check.verdict, 'green');
  const dir = tmp();
  try {
    writeCitedLine(dir, citedLineOf({ n: 1, part, results, check }));
    const got = readCitedChecks(dir);
    assert.equal(got.present, true);
    assert.equal(got.ok, true, got.red);
    const [line] = got.lines;
    assert.equal(line.n, 1);
    assert.equal(line.source, 'flights');
    assert.equal(line.passed, true);
    assert.deepEqual(line.facts.map((f) => [f.name, f.kind]), [['origin airport', 'phrase'], ['destination airport', 'phrase'], ['price', 'value'], ['departure time', 'value'], ['nonstop', 'phrase']]);
    assert.equal(line.facts[2].sentence, 'fact · price — money in US dollars, under 150 US dollars, after "From", quoted from "flights"');
    assert.equal(line.rows.length, 3);
    for (const [k, row] of line.rows.entries()) {
      assert.equal(row.n, k + 1);
      assert.equal(row.quote, results[k].quote, 'the quote is the result\'s own, word for word');
      assert.equal(row.cells.length, line.facts.length);
      assert.ok(row.proof && row.proof.marks.length > 0, 'the reader keeps a proof only when every mark is a real span');
    }
    // phrase cells are the signed words, a money cell is the amount as the quote writes it, a time is the value
    assert.deepEqual(line.rows[0].cells.slice(0, 2), ['Leaves Amsterdam Airport Schiphol', 'arrives at Heathrow Airport']);
    assert.equal(line.rows[0].cells[2], `${results[0].values.price} US dollars`);
    assert.equal(line.rows[0].cells[3], results[0].values['departure time']);
    assert.equal(line.rows[0].cells[4], 'Nonstop');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('a red line keeps the rows the check judged (M10 am9 item 1), passed is false (no tick), and the reader takes it', async () => {
  const part = flightsPart();
  const results = goodRows(PAGE).slice(0, 2);
  const check = await checkCited({ part, text: PAGE, results });
  assert.equal(check.verdict, 'red');
  const dir = tmp();
  try {
    writeCitedLine(dir, citedLineOf({ n: 1, part, results, check }));
    const got = readCitedChecks(dir);
    assert.equal(got.ok, true, got.red);
    assert.equal(got.lines[0].passed, false);
    assert.equal(got.lines[0].rows.length, 2, 'the judged results stay, so a red run shows what the check read');
    assert.equal(got.lines[0].rows[0].quote, results[0].quote);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the writer keeps one line per job line: a second try replaces its own line and leaves the others', async () => {
  const { part, results, check } = await green();
  const dir = tmp();
  try {
    writeCitedLine(dir, citedLineOf({ n: 2, part, results, check }));
    writeCitedLine(dir, citedLineOf({ n: 1, part, results, check: { ...check, verdict: 'red', gapLines: ['x'] } }));
    writeCitedLine(dir, citedLineOf({ n: 1, part, results, check }));
    const got = readCitedChecks(dir);
    assert.deepEqual(got.lines.map((l) => [l.n, l.passed]), [[1, true], [2, true]]);
    assert.ok(JSON.parse(readFileSync(join(dir, 'line-checks.json'), 'utf8')).cited.lines.length === 2);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('the record carries what a separate checker needs and nothing the page cannot show: the frozen text\'s sha256, the signed facts, the count, each result\'s values', async () => {
  const { part, results, check } = await green();
  const line = citedLineOf({ n: 1, part, results, check });
  assert.equal(line.check.sha256, check.sha256);
  assert.deepEqual(line.check.count, { min: 3, max: 3 });
  assert.deepEqual(line.check.facts.find((f) => f.name === 'price').rule, { op: 'lt', value: 150 });
  assert.deepEqual(line.rows[1].values, results[1].values);
});

test('a stopped check writes a red line with its fault as Not checked, never a passed line', async () => {
  const part = { source: 'flights', facts: [{ name: 'price', shape: 'money' }] };
  const check = await checkCited({ part, text: PAGE, results: [] });
  assert.equal(check.verdict, 'stopped');
  const line = citedLineOf({ n: 1, part: flightsPart(), results: [], check });
  assert.equal(line.passed, false);
  assert.equal(line.rows, null);
  assert.ok(line.notChecked.some((t) => t.includes('money needs a unit or a currency')), JSON.stringify(line.notChecked));
});

test('a proof is kept only when the evidence is about THIS quote; another quote\'s evidence leaves the plain quote', async () => {
  const { part, results, check } = await green();
  const stale = { ...check, evidence: check.evidence.map((e) => (e.claim === 1 ? { ...e, text: `${e.text} (another try)` } : e)) };
  const line = citedLineOf({ n: 1, part, results, check: stale });
  assert.ok(line.rows[0].proof);
  assert.equal(line.rows[1].proof, undefined);
  assert.ok(line.rows[2].proof);
});
