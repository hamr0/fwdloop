// M4d amendment 29 (signed 2026-10-18) items 1 and 3: the run's model-call diary and tool-call diary. $0: fake providers only.
// Must fail when (signed): a model call or tool call has no row; a denied call is missing; an unknown cost shows $0; the model can read a diary;
// a secret, file content or model text is in one.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { makeLiveModelStep } from '../src/model-step.js';
import { resolvePrimitives } from '../src/primitives.js';
import { loadCatalogue } from '../src/catalogue.js';
import {
  DIARY_FILES, diaryPaths, readCalls, readTools, nextRound,
} from '../src/diary.js';

const CAT = (() => { const c = loadCatalogue(); assert.equal(c.ok, true); return c.primitives; })();
const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-am29-${p}-`));
const CTX = { goal: 'g', primitives: [], reads: {}, gap: null };
const MODEL_WORDS = 'ZEBRA-MODEL-WORDS-9x';
const FILE_WORDS = 'GIRAFFE-FILE-CONTENT-7q';

/** A run folder with a text input and a csv input, the step's real tools over it, and a fake provider that plays `script` call by call. */
function setup(script, { rates = { in: 0.001, out: 0.002 } } = {}) {
  const runDir = tmp('run');
  mkdirSync(path.join(runDir, 'inputs'), { recursive: true });
  const note = path.join(runDir, 'inputs', 'note.md');
  const cells = path.join(runDir, 'inputs', 'cells.csv');
  writeFileSync(note, `${FILE_WORDS}\n`);
  writeFileSync(cells, 'a,b\n1,2\n');
  const { tools, reds } = resolvePrimitives(CAT, ['read', 'grep', 'addressCells', 'readDocx', 'get'], { runDir, inputs: [{ id: 'note', frozen: note }, { id: 'cells', frozen: cells }] });
  assert.deepEqual(reds, []);
  // plays `script` call by call; once it is used up it answers like a model that emits its artifact and then stops, again and again
  let n = 0;
  let emitNext = true;
  const provider = {
    generate: async () => {
      const r = script[n];
      n += 1;
      if (r) return r;
      const out = emitNext ? emit() : stop();
      emitNext = !emitNext;
      return out;
    },
  };
  const step = makeLiveModelStep({ spendPath: path.join(runDir, 'spend.jsonl'), provider, rates, modelId: 'deepseek-flash' });
  return { runDir, tools, step };
}
const call = (toolCalls, extra = {}) => ({
  text: MODEL_WORDS, toolCalls, usage: { inputTokens: 100, outputTokens: 50, cacheReadTokens: 7 }, stopReason: 'tool_calls', model: 'deepseek-flash', thinkingStatus: 'applied', ...extra,
});
const stop = () => ({ text: '', toolCalls: [], usage: { inputTokens: 10, outputTokens: 5 }, stopReason: 'stop', model: 'deepseek-flash', thinkingStatus: 'applied' });
const emit = (extra) => call([{ id: 'e', name: 'emit_artifact', arguments: { text: MODEL_WORDS, done: true } }], extra);

test('A1: every model call and every tool call gets its own row, with the guard decision (allow, deny + rule, no check, not granted)', async () => {
  const { runDir, tools, step } = setup([
    call([
      { id: 't1', name: 'read', arguments: { path: 'inputs/note.md' } },
      { id: 't2', name: 'read', arguments: { path: 'calls.jsonl' } },
      { id: 't3', name: 'addressCells', arguments: { role: 'cells' } },
      { id: 't4', name: 'nonesuch', arguments: { path: 'x' } },
    ]),
    emit(),
    stop(),
  ]);
  const r = await step(CTX, tools, { class: 'softgreen', attempt: 1, step: 'summary', thinkingMode: 'on' });
  assert.equal(r.ok, true);
  const calls = readCalls(runDir);
  assert.equal(calls.length, 3, 'three model calls, three rows');
  assert.deepEqual(calls.map((c) => [c.step, c.try, c.round]), [['summary', 1, 1], ['summary', 1, 2], ['summary', 1, 3]]);
  assert.deepEqual(calls[0].tokens, { in: 100, out: 50, cache: 7 });
  assert.equal(typeof calls[0].costUsd, 'number');
  assert.equal(calls[0].stopReason, 'tool_calls');
  assert.deepEqual(calls[0].thinking, { asked: 'on', status: 'applied' });
  const rows = readTools(runDir);
  // the name that was never offered is written the moment its call is metered, ahead of the calls that ran
  assert.deepEqual(rows.map((t) => [t.tool, t.decision, t.rule, t.round, t.step, t.try]), [
    ['nonesuch', 'deny', 'not granted', 1, 'summary', 1],
    ['read', 'allow', null, 1, 'summary', 1],
    ['read', 'deny', 'fs.deny', 1, 'summary', 1],
    ['addressCells', 'no check', null, 1, 'summary', 1],
  ]);
  assert.equal(rows[1].path, 'inputs/note.md');
  assert.equal(rows[3].path, 'cells');
});

test('A2: an unpriced call (the provider reported no usage) keeps costUsd null in its row, never 0', async () => {
  const { runDir, tools, step } = setup([emit({ usage: null }), stop()]);
  const r = await step(CTX, tools, { class: 'softgreen', attempt: 1, step: 's', thinkingMode: 'off' });
  assert.equal(r.costUsd, null, 'the try itself is unpriced too');
  const [row] = readCalls(runDir);
  assert.strictEqual(row.costUsd, null);
  assert.strictEqual(row.tokens, null);
  assert.notEqual(readCalls(runDir)[1].costUsd, null, 'a priced call beside it keeps its number');
});

test('A3: rounds count from 1 in EACH step and carry on across that step\'s tries', async () => {
  const { runDir, tools, step } = setup([]);
  await step(CTX, tools, { class: 'softgreen', attempt: 1, step: 'one' });
  await step(CTX, tools, { class: 'softgreen', attempt: 2, step: 'one' });
  await step(CTX, tools, { class: 'softgreen', attempt: 1, step: 'two' });
  // each step run is two model calls: the one that emits the artifact, then the one that stops
  assert.deepEqual(readCalls(runDir).map((c) => [c.step, c.try, c.round]), [['one', 1, 1], ['one', 1, 2], ['one', 2, 3], ['one', 2, 4], ['two', 1, 1], ['two', 1, 2]]);
  assert.equal(nextRound(runDir, 'one'), 5);
  assert.equal(nextRound(runDir, 'never'), 1);
});

test('A4: no model text, no file content in any diary; a secret in a path is masked', async () => {
  const key = 'sk-abcdefghijklmnopqrstuvwxyz012345';
  const { runDir, tools, step } = setup([call([{ id: 't1', name: 'read', arguments: { path: 'inputs/note.md' } }, { id: 't2', name: 'read', arguments: { path: `no/${key}.md` } }]), emit(), stop()]);
  await step(CTX, tools, { class: 'softgreen', attempt: 1, step: 's' });
  for (const file of diaryPaths(runDir)) {
    let text = '';
    try { text = readFileSync(file, 'utf8'); } catch { /* a diary this run did not need */ }
    assert.ok(!text.includes(MODEL_WORDS), `${path.basename(file)} holds model text`);
    assert.ok(!text.includes(FILE_WORDS), `${path.basename(file)} holds file content`);
    assert.ok(!text.includes(key), `${path.basename(file)} holds a secret`);
  }
  const rows = readTools(runDir);
  assert.equal(rows.length, 2);
  assert.match(rows[1].path, /^no\/.*\.md$/);
  assert.ok(!rows[1].path.includes('abcdefghijklmnop'));
});

test('A5: the model can read none of the diaries - by read, by grep on the file, by grep over the run folder, by get', async () => {
  const { runDir, tools, step } = setup([call([{ id: 't1', name: 'read', arguments: { path: 'inputs/note.md' } }]), emit(), stop()]);
  await step(CTX, tools, { class: 'softgreen', attempt: 1, step: 's' });
  writeFileSync(path.join(runDir, DIARY_FILES.checks), `{"marker":"${MODEL_WORDS}-checks"}\n`);
  const word = /"step":"s"|marker/;
  for (const file of diaryPaths(runDir)) {
    const name = path.basename(file);
    await assert.rejects(() => tools.read.execute({ path: name }), /fs\.deny/, `read ${name}`);
    await assert.rejects(() => tools.read.execute({ path: file }), /fs\.deny/, `read ${name} by absolute path`);
    await assert.rejects(() => tools.grep.execute({ path: name, pattern: 'step|marker' }), /fs\.deny/, `grep ${name}`);
    await assert.rejects(() => tools.get.execute({ path: name, startLine: 0, endLine: 1 }), /fs\.deny/, `get ${name}`);
  }
  for (const where of [runDir, '.']) {
    const found = await tools.grep.execute({ path: where, pattern: word.source });
    assert.ok(Array.isArray(found.hits));
    for (const h of found.hits) assert.ok(!diaryPaths(runDir).includes(path.resolve(h.file)), `a grep over the folder leaked ${h.file}`);
  }
  // sanity: the same grep does reach a file that is not a diary
  const ok = await tools.grep.execute({ path: '.', pattern: FILE_WORDS });
  assert.ok(ok.hits.some((h) => h.file.endsWith('note.md')));
});

test('A5b: a big diary cannot eat the grep cap - the diaries are left out before the cap, not after', async () => {
  const runDir = tmp('cap');
  mkdirSync(path.join(runDir, 'out'), { recursive: true });
  writeFileSync(path.join(runDir, 'out', 'a.md'), 'the step is here\n');
  writeFileSync(path.join(runDir, DIARY_FILES.calls), '{"step":"s"}\n'.repeat(3000));
  const { tools, reds } = resolvePrimitives(CAT, ['grep'], { runDir, inputs: [] });
  assert.deepEqual(reds, []);
  const found = await tools.grep.execute({ path: '.', pattern: 'step' });
  assert.deepEqual(found.hits.map((h) => path.relative(runDir, h.file)), [path.join('out', 'a.md')]);
  assert.equal(found.truncated, false);
  assert.equal(found.fileCount, 1);
});
