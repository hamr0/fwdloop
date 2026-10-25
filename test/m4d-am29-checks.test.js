// M4d amendment 29 (signed 2026-10-18) item 2: each try saves its checks (numbered, ✓/✗, result, source) and the output it judged. $0: fake model steps.
// Must fail when (signed): a check that ran is not listed; a check names the wrong job line; a secret, file content or model text is in the record.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';

import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow } from '../src/runner.js';
import { serializeArtifact } from '../src/ask.js';
import { readChecks } from '../src/diary.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = (() => { const c = loadCatalogue(); assert.equal(c.ok, true); return c.primitives; })();
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am29c-${p}-`));
const SECRET_WORDS = 'QUOKKA-MODEL-TEXT-31';

/** job2: line 3 is a softgreen step (3 named sections, at most 600 words); lines 1, 2 and 5 are plain steps; line 4 is the ask. */
async function runJob2(modelStep) {
  const root = tmp('root');
  const w = writeFlow({
    root, name: 'job2', proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-24T12:00:00Z', catalogue: CAT,
  });
  assert.equal(w.ok, true);
  const src = tmp('src');
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text.');
  const result = await runFlow({
    root, name: 'job2', runId: 'run-1', sources: [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }], catalogue: CAT, modelStep, askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01',
  });
  const runDir = path.join(root, 'job2', 'runs', 'run-1');
  return { result, runDir, rows: readChecks(runDir) };
}

const SECTIONS = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft.';
const good = { text: `${SECTIONS}\n${SECRET_WORDS}`, done: true };
const reply = (artifact) => ({ ok: true, costUsd: 0.001, artifact });
const plain = (ctx) => (/resume \.docx|job description markdown/.test(ctx.goal) ? reply({ text: 'x', done: true }) : null);

test('B1: a failed try then a passed one: every check listed, numbered, with ✓/✗, result and source; the first try shows what failed', async () => {
  let n = 0;
  const { result, rows } = await runJob2(async (ctx) => {
    const p = plain(ctx);
    if (p) return p;
    n += 1;
    return reply(n === 1 ? { text: `## summary of work history blurb\n${'word '.repeat(700)}`, done: true } : good);
  });
  assert.equal(result.outcome, 'complete', result.red);
  const mine = rows.filter((r) => r.step === 'resume-summary');
  assert.deepEqual(mine.map((r) => r.try), [1, 2]);
  const t1 = mine[0].checks;
  assert.deepEqual(t1.map((c) => c.n), [1, 2, 3, 4, 5], 'happened, done, then the close checks in the rubric order: keys, words, sections');
  assert.deepEqual(t1.map((c) => c.ok), [true, true, true, false, false]);
  assert.match(t1[0].result, /^\d+(\.\d)? (B|KB)$/);
  assert.equal(t1[3].result, '705 words', 'bareguard counts the 5 heading words and the 700 others; "##" is not a word');
  assert.match(t1[4].result, /no line is exactly the heading/);
  assert.deepEqual(t1.map((c) => c.source), ['every step', 'every step', 'line 3 ~', 'line 3 ~', 'line 3 ~']);
  assert.ok(t1.every((c) => typeof c.text === 'string' && c.text.length > 0));
  assert.ok(mine[1].checks.every((c) => c.ok));
  assert.match(mine[1].checks[3].result, /^\d+ words$/, 'a check that passed lists its count too');
});

test('B2: the output judged is the file name, size and sha256 of the exact bytes saved when the step closes - never its content', async () => {
  const { rows, runDir } = await runJob2(async (ctx) => plain(ctx) ?? reply(good));
  const rec = rows.find((r) => r.step === 'resume-summary');
  const bytes = serializeArtifact({ text: good.text });
  assert.deepEqual(rec.output, { file: 'artifacts/resume-summary.json', bytes: Buffer.byteLength(bytes), sha256: createHash('sha256').update(bytes).digest('hex') });
  assert.equal(readFileSync(path.join(runDir, rec.output.file), 'utf8'), bytes, 'the file on disk is those bytes');
  assert.ok(!readFileSync(path.join(runDir, 'diary.jsonl'), 'utf8').includes(SECRET_WORDS), 'no model text in the record');
});

test('B3: a plain read step lists exactly the two checks every step has, both from "every step"', async () => {
  const { rows } = await runJob2(async (ctx) => plain(ctx) ?? reply(good));
  const rec = rows.find((r) => r.step === 'resume-text');
  assert.deepEqual(rec.checks.map((c) => [c.n, c.ok, c.source]), [[1, true, 'every step'], [2, true, 'every step']]);
});

test('B4: the model said done: false - only the done check ran, and it is the only one listed; no output was judged', async () => {
  const { rows } = await runJob2(async (ctx) => plain(ctx) ?? reply({ text: 'x', done: false, blocker: 'no data' }));
  const rec = rows.find((r) => r.step === 'resume-summary');
  assert.deepEqual(rec.checks.map((c) => [c.n, c.ok, c.result]), [[2, false, 'it said done: false']]);
  assert.equal(rec.output, null);
  assert.ok(!JSON.stringify(rec).includes('no data'), 'the blocker is model text and is not saved');
});

test('B5: a close that could not judge (unparseable) is listed as a failed check that could not run, with that outcome as its result', async () => {
  const { rows } = await runJob2(async (ctx) => plain(ctx) ?? reply({ fields: { a: { value: 1, cite: 'x' } }, done: true }));
  const rec = rows.find((r) => r.step === 'resume-summary');
  assert.deepEqual(rec.checks.filter((c) => c.n >= 3).map((c) => [c.ok, c.result, c.source]), [[false, 'unparseable', 'line 3 ~']]);
});

test('B6: a try with no answer from the model (a provider failure) ran no checks and saves none', async () => {
  const { rows } = await runJob2(async (ctx) => plain(ctx) ?? { ok: false, red: 'provider-red: boom', costUsd: 0 });
  assert.equal(rows.filter((r) => r.step === 'resume-summary').length, 0);
});
