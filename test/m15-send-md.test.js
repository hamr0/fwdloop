// M15 items 3 and 4, changed by am3 (docs/wiki/the-module-ladder.md): the send writes the accepted body as ONE report (`<job>-YYYY-MM-DD.md`, title, Passed line, body), bound to the accepted artifact's hash,
// never over a taken name, and returns the sha256 of the file it wrote.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, before, test } from 'node:test';

import { sendViaPrimitive } from '../src/send.js';
import { renderReportBody } from '../src/report.js';
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
const FLIGHTS = {
  results: [
    { quote: 'Q1 words', values: { price: '$120', airline: 'Acme', departure: '08:00' } },
    { quote: 'Q2 words', values: { price: '$99', airline: 'Bolt', departure: '09:30' } },
  ],
};
const NOW = new Date(2026, 10, 18, 12);
const sendOf = (content, body, sha = sha256Hex(serializeArtifact(content)), extra = {}) => sendViaPrimitive(`file:${dest}`, 'job', content, sha, { ...ctx, report: { runNo: 4, now: NOW, body, ...extra } });

test('the file is title, Passed line and the accepted body, byte for byte; the sha256 is of the file; the hash binds the {text: body} artifact', async () => {
  const body = '## 1. A line\n\n### The AI\'s answer (not checked — you judge it at Accept)\n- one\n- two\n\n  "quoted" {braces} ok';
  const r = await sendOf({ text: body }, body);
  assert.equal(r.ok, true, r.red);
  assert.equal(r.name, 'job-2026-11-18.md');
  const bytes = readFileSync(join(dest, r.name));
  assert.equal(bytes.toString('utf8'), `# job — run-4\nPassed · 18 Nov 2026\n\n${body}\n`);
  assert.equal(r.sha256, createHash('sha256').update(bytes).digest('hex'), 'the sha256 is of the file written');
  assert.notEqual(r.sha256, sha256Hex(serializeArtifact({ text: body })), 'the title and the Passed line are not bound');
  assert.equal(r.taken, null);
});

test('M15 am3 item 1: the same day again is -2, then -3; a taken file is never overwritten and the note names the first choice', async () => {
  const dir2 = join(base, 'dest2');
  mkdirSync(dir2);
  const go = (body) => sendViaPrimitive(`file:${dir2}`, 'job', { text: body }, sha256Hex(serializeArtifact({ text: body })), { ...ctx, report: { runNo: 1, now: NOW, body } });
  const a = await go('first');
  const firstBytes = readFileSync(a.path);
  const b = await go('second');
  const c = await go('third');
  assert.deepEqual([a.name, b.name, c.name], ['job-2026-11-18.md', 'job-2026-11-18-2.md', 'job-2026-11-18-3.md']);
  assert.deepEqual([a.taken, b.taken, c.taken], [null, 'job-2026-11-18.md', 'job-2026-11-18.md']);
  assert.deepEqual(readFileSync(a.path), firstBytes, 'the first file is untouched');
  assert.match(readFileSync(c.path, 'utf8'), /third\n$/);
});

test('M15 am3 item 1: a taken name that is a dangling symlink is not written through', async () => {
  const dir3 = join(base, 'dest3');
  mkdirSync(dir3);
  symlinkSync(join(base, 'elsewhere.md'), join(dir3, 'job-2026-11-18.md'));
  const r = await sendViaPrimitive(`file:${dir3}`, 'job', { text: 'x' }, sha256Hex(serializeArtifact({ text: 'x' })), { ...ctx, report: { runNo: null, now: NOW, body: 'x' } });
  assert.equal(r.ok, true, r.red);
  assert.equal(r.name, 'job-2026-11-18-2.md');
  assert.equal(existsSync(join(base, 'elsewhere.md')), false);
});

test('M15 am3 item 6: the report is written only from a send with a body; a send with none is refused and writes nothing', async () => {
  const dir4 = join(base, 'dest4');
  mkdirSync(dir4);
  const r = await sendViaPrimitive(`file:${dir4}`, 'job', { text: 'x' }, sha256Hex(serializeArtifact({ text: 'x' })), ctx);
  assert.equal(r.ok, false);
  assert.match(r.red, /no report body/);
  assert.deepEqual(readdirSync(dir4), []);
});

// --- the forms of M15 am1/am2, now written by the report (src/report.js) as bullets under "Checked by code" ---
const FLIGHTS_BODY = (art) => renderReportBody([{ n: 2, kind: 'work', text: 'Flights', artifact: art, checks: [] }], {});

test('am1+am2 in the report: a list of results is one "#### Result k" block per result, values in order, then the quote as a last line', () => {
  const got = FLIGHTS_BODY(FLIGHTS);
  assert.equal(got, '## 2. Flights\n\n### Checked by code\n#### Result 1\n- Price: $120\n- Airline: Acme\n- Departure: 08:00\n\nfrom the page: "Q1 words"\n\n#### Result 2\n- Price: $99\n- Airline: Bolt\n- Departure: 09:30\n\nfrom the page: "Q2 words"');
  assert.ok(!/[{}[\]✓✗]/.test(got));
});

test('am2 (1) in the report: nested names become words, a last name of value or rows is left out', () => {
  const art = (values) => FLIGHTS_BODY({ results: [{ quote: 'q', values }] });
  assert.match(art({ expenseRows: { rows: [3, 6, 9] }, expenseTotal: { value: 12719.59 } }), /- Expense rows: 3, 6, 9\n- Expense total: 12719.59/);
  assert.match(art({ ID: 'x', user_name: 'a', 'first-seen': 'b', ticketID: { value: 1 } }), /- Id: x\n- User name: a\n- First seen: b\n- Ticket id: 1/);
});

test('am2 (2) in the report: each result ends with from the page: "<quote>" byte for byte', () => {
  const quote = 'From 39 US dollars.\nSelect "flight" {x} \\ ✓';
  const got = FLIGHTS_BODY({ results: [{ quote, values: { price: 39 } }] });
  assert.ok(got.includes(`from the page: "${quote}"`));
});

test('am2 (3) in the report: two lines with the same words both keep the a.b form, judged per block', () => {
  const got = FLIGHTS_BODY({ results: [{ quote: 'q', values: { a: { value: 1 }, A: 2 } }, { quote: 'q', values: { a: { value: 1 } } }] });
  assert.match(got, /#### Result 1\n- a\.value: 1\n- A: 2\n\nfrom the page: "q"\n\n#### Result 2\n- A: 1\n/);
});

test('am2 (5) in the report: every value is present, in order, none changed', () => {
  const values = { price: 5, seatMap: { rows: [1, 2] }, tags: ['a', 'b'], deepOne: { x: 'y', ok: true }, gone: null };
  const got = FLIGHTS_BODY({ results: [{ quote: 'q1', values }] }).split('\n').filter((l) => l.startsWith('- ')).map((l) => l.replace(/^[^:]*: ?/, ''));
  assert.deepEqual(got, ['5', '1, 2', 'a, b', 'y', 'true', '']);
});

test('the hash binding stays: a changed accepted artifact is refused and nothing is written', async () => {
  const r = await sendOf({ text: 'changed' }, 'changed', sha256Hex(serializeArtifact({ text: 'what was accepted' })));
  assert.equal(r.ok, false);
  assert.match(r.red, /changed after it was accepted/);
  assert.equal(readdirSync(dest).length, 1, 'only the first test\'s file is there: nothing was written by this send');
});

// --- through the real run: the send row records the .md's sha256; the Result tab's saved file is the .md (item 4, item 5) ---
const { world } = await import('./m10-am4-world.mjs');
const { readFileSync: rf, writeFileSync: wf } = await import('node:fs');

test('a real run: the file is <job>-YYYY-MM-DD.md, the green send row holds its name and sha256, and /result lists it', async () => {
  const w = await world({ mode: 'green' });
  const name = readdirSync(dirname(w.delivered)).find((f) => /^job2-\d{4}-\d{2}-\d{2}\.md$/.test(f));
  assert.equal(w.delivered, join(dirname(w.delivered), name));
  const bytes = rf(w.delivered);
  assert.ok(!bytes.toString('utf8').trimStart().startsWith('{'), 'plain text, not JSON');
  const rows = rf(join(w.runDir, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const sendRow = rows.find((r) => r.step === 'resume-summary-output' && r.verdict === 'green');
  assert.equal(sendRow.sentSha256, createHash('sha256').update(bytes).digest('hex'));
  assert.equal(sendRow.sentName, name);
  assert.equal('sentTaken' in sendRow, false, 'a free first name has no taken note');
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
  assert.equal(d[0].note, null);
});
