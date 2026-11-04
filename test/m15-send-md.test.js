// M15 items 3 and 4 + am1 (docs/wiki/the-module-ladder.md): the send writes the accepted answer as plain text, bound to the accepted artifact's hash,
// and returns the sha256 of the file it wrote.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, test } from 'node:test';

import { renderSentMd, sendViaPrimitive } from '../src/send.js';
import { serializeArtifact, sha256Hex } from '../src/ask.js';

let base;
let dest;
let ctx;
let savedHome;
before(() => {
  base = mkdtempSync(join(tmpdir(), 'fwdloop-m15-'));
  savedHome = process.env.FWDLOOP_CONFIG_HOME;
  process.env.FWDLOOP_CONFIG_HOME = join(base, 'cfg');
  dest = join(base, 'dest');
  const runDir = join(base, 'flows', 'f', 'runs', 'r1');
  for (const d of [join(base, 'cfg'), runDir, dest]) mkdirSync(d, { recursive: true });
  ctx = { root: join(base, 'flows'), runDir };
});
after(() => {
  if (savedHome === undefined) delete process.env.FWDLOOP_CONFIG_HOME; else process.env.FWDLOOP_CONFIG_HOME = savedHome;
  rmSync(base, { recursive: true, force: true });
});
const sendOf = (name, content, sha = sha256Hex(serializeArtifact(content))) => sendViaPrimitive(`file:${dest}`, name, content, sha, ctx);

const FLIGHTS = {
  results: [
    { quote: 'Q1 words', values: { price: '$120', airline: 'Acme', departure: '08:00' } },
    { quote: 'Q2 words', values: { price: '$99', airline: 'Bolt', departure: '09:30' } },
  ],
};

test('{text} alone: the file is the text exactly, no JSON, no check marks', async () => {
  const text = '- one\n- two\n\n  "quoted" {braces} ok';
  const r = await sendOf('p-1.md', { text });
  assert.equal(r.ok, true, r.red);
  assert.equal(readFileSync(join(dest, 'p-1.md'), 'utf8'), text);
  assert.equal(r.sha256, createHash('sha256').update(text).digest('hex'), 'the sha256 is of the .md bytes, not the JSON');
});

test('another flat object: one name: value line per field, in order', () => {
  assert.equal(renderSentMd({ text: 'hi', count: 3, ok: true }), 'Text: hi\nCount: 3\nOk: true');
});

test('am1+am2: a list of results is one "## Result k" block per result, values in order, then the quote as a last line', async () => {
  const r = await sendOf('f-1.md', FLIGHTS);
  assert.equal(r.ok, true, r.red);
  const got = readFileSync(join(dest, 'f-1.md'), 'utf8');
  assert.equal(got, '## Result 1\nPrice: $120\nAirline: Acme\nDeparture: 08:00\nfrom the page: "Q1 words"\n\n## Result 2\nPrice: $99\nAirline: Bolt\nDeparture: 09:30\nfrom the page: "Q2 words"');
  assert.ok(!/[{}[\]✓✗]/.test(got));
});

// --- M15 am2: names as words, the quote written ---
const EXPENSES = { expenseRows: { rows: [3, 6, 9] }, expenseCount: { value: 17 }, expenseTotal: { value: 12719.59 } };

test('am2 (1): nested names become words, a last name of value or rows is left out', () => {
  assert.equal(renderSentMd(EXPENSES), 'Expense rows: 3, 6, 9\nExpense count: 17\nExpense total: 12719.59');
  assert.equal(renderSentMd({ ID: 'x', user_name: 'a', 'first-seen': 'b', ticketID: { value: 1 } }), 'Id: x\nUser name: a\nFirst seen: b\nTicket id: 1');
});

test('am2 (2): each result block ends with from the page: "<quote>" byte for byte', () => {
  const quote = 'From 39 US dollars.\nSelect "flight" {x} \\ ✓';
  const got = renderSentMd({ results: [{ quote, values: { price: 39 } }, { quote: 'two', values: { price: 40 } }] });
  assert.equal(got, `## Result 1\nPrice: 39\nfrom the page: "${quote}"\n\n## Result 2\nPrice: 40\nfrom the page: "two"`);
});

test('am2 (3): two lines with the same words both keep today\'s form, judged per block', () => {
  assert.equal(renderSentMd({ rows: { value: 1, rows: 2 }, other: 3 }), 'rows.value: 1\nrows.rows: 2\nOther: 3');
  assert.equal(renderSentMd({ expenseTotal: 1, expense_total: 2 }), 'expenseTotal: 1\nexpense_total: 2');
  const got = renderSentMd({ results: [{ quote: 'q', values: { a: { value: 1 }, A: 2 } }, { quote: 'q', values: { a: { value: 1 } } }] });
  assert.equal(got, '## Result 1\na.value: 1\nA: 2\nfrom the page: "q"\n\n## Result 2\nA: 1\nfrom the page: "q"');
});

test('am2 (4): a {text}-only artifact is byte-identical to today', () => {
  for (const text of ['', 'a\nb', '{"x":1} ✓ expenseTotal.value: 1']) assert.equal(renderSentMd({ text }), text);
});

test('am2 (5): every value is present, in order, none changed', () => {
  const content = { totals: { value: 12.5 }, tags: ['a', 'b'], nested: { deepOne: { x: 'y', ok: true }, gone: null }, list: [{ n: 1 }, { n: 2 }],
    results: [{ quote: 'q1', values: { price: 5, seatMap: { rows: [1, 2] } } }] };
  const got = renderSentMd(content).split('\n');
  const want = [];
  const walk = (v) => {
    if (v === null || v === undefined) want.push('');
    else if (Array.isArray(v) && v.every((x) => x === null || typeof x !== 'object')) want.push(v.join(', '));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (typeof v === 'object') Object.values(v).forEach(walk);
    else want.push(String(v));
  };
  for (const [k, v] of Object.entries(content)) {
    if (k === 'results') v.forEach((r) => { Object.values(r.values).forEach(walk); want.push(`"${r.quote}"`); }); else walk(v);
  }
  const vals = got.filter((l) => !l.startsWith('## ') && l !== '').map((l) => l.replace(/^[^:]*: ?/, ''));
  assert.deepEqual(vals, want);
});

test('the hash binding stays: a changed accepted artifact is refused and nothing is written', async () => {
  const r = await sendOf('c-1.md', { text: 'changed' }, sha256Hex(serializeArtifact({ text: 'what was accepted' })));
  assert.equal(r.ok, false);
  assert.match(r.red, /changed after it was accepted/);
  assert.throws(() => readFileSync(join(dest, 'c-1.md')));
});

// --- through the real run: the send row records the .md's sha256; the Result tab's saved file is the .md (item 4, item 5) ---
const { world } = await import('./m10-am4-world.mjs');
const { readFileSync: rf, writeFileSync: wf } = await import('node:fs');

test('a real run: the file is <flow>-<run>-<name>.md, the green send row holds its sha256, and /result lists it', async () => {
  const w = await world({ mode: 'green' });
  const name = 'job2-run-1-resume-summary-output.md';
  const bytes = rf(w.delivered);
  assert.ok(!bytes.toString('utf8').trimStart().startsWith('{'), 'plain text, not JSON');
  const rows = rf(join(w.runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sendRow = rows.find((r) => r.step === 'resume-summary-output' && r.verdict === 'green');
  assert.equal(sendRow.sentSha256, createHash('sha256').update(bytes).digest('hex'));
  const d = (await w.get('/api/runs/job2/run-1/result')).body.delivered;
  assert.equal(d.length, 1);
  assert.equal(d[0].name, name);
  assert.equal(d[0].state, 'ok');
  // the accepted JSON stays in the run folder, unchanged
  assert.ok(JSON.parse(rf(join(w.runDir, 'artifacts', 'resume-summary-output.json'), 'utf8')));
});

test('a run sent before M15 (no sentSha256 on its row) shows its old .json file, never the .md', async () => {
  const w = await world({ mode: 'green' });
  const f = join(w.runDir, 'audit.jsonl');
  const kept = rf(f, 'utf8').trim().split('\n').map((l) => JSON.parse(l)).map((r) => { delete r.sentSha256; return JSON.stringify(r); });
  wf(f, `${kept.join('\n')}\n`);
  const d = (await w.get('/api/runs/job2/run-1/result')).body.delivered;
  assert.equal(d[0].name, 'job2-run-1-resume-summary-output.json');
});
