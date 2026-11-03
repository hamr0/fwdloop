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
  assert.equal(renderSentMd({ text: 'hi', count: 3, ok: true }), 'text: hi\ncount: 3\nok: true');
});

test('am1: a list of results is one "## Result k" block per result, values in order, quote not written', async () => {
  const r = await sendOf('f-1.md', FLIGHTS);
  assert.equal(r.ok, true, r.red);
  const got = readFileSync(join(dest, 'f-1.md'), 'utf8');
  assert.equal(got, '## Result 1\nprice: $120\nairline: Acme\ndeparture: 08:00\n\n## Result 2\nprice: $99\nairline: Bolt\ndeparture: 09:30');
  assert.ok(!got.includes('Q1 words') && !/[{}[\]✓✗]/.test(got));
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
