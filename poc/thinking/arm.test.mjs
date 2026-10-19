// POC test (run: node --test poc/thinking/arm.test.mjs). Fails if the arm mapping is wrong, at the pure function AND at the provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { thinkingModeFor } from './arm.mjs';
import { makeEngine } from './make-engine.mjs';
import { runBaseFor, jobSources } from './batch.mjs';
import { median, summarize, f69Verdict, f70Verdict } from './score.mjs';

test('arm mapping: today sends nothing, on always on, retry off then on', () => {
  for (const a of [1, 2, 3]) assert.equal(thinkingModeFor('today', a), undefined);
  for (const a of [1, 2, 3]) assert.equal(thinkingModeFor('on', a), 'on');
  assert.equal(thinkingModeFor('retry', 1), 'off');
  assert.equal(thinkingModeFor('retry', 2), 'on');
  assert.equal(thinkingModeFor('retry', 3), 'on');
  assert.throws(() => thinkingModeFor('nope', 1));
});

test('engine copy: thinkingMode (or none) reaches provider.generate, per arm and attempt', async () => {
  const { engine } = makeEngine();
  const dir = mkdtempSync(join(tmpdir(), 'poc-thinking-'));
  try {
    const { makeFakeProvider } = await import('./fake-step.mjs');
    const { makeLiveModelStep } = await import(join(engine, 'src', 'model-step.js'));
    const want = { today: [null, null], on: ['on', 'on'], retry: ['off', 'on'] };
    for (const [arm, expected] of Object.entries(want)) {
      process.env.FWDLOOP_POC_ARM = arm;
      const calls = join(dir, `${arm}.jsonl`);
      process.env.FWDLOOP_POC_CALLS = calls;
      const step = makeLiveModelStep({ spendPath: join(dir, `${arm}-spend.jsonl`), provider: makeFakeProvider(), rates: { in: 0.001, out: 0.002 }, modelId: 'deepseek-flash' });
      for (const attempt of [1, 2]) await step({ goal: 'g', reads: {}, gap: null, primitives: [] }, {}, { class: 'hitl', attempt, stepId: 's' });
      const rows = readFileSync(calls, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
      const byAttempt = [1, 2].map((a) => rows.find((r) => r.attempt === a).modeSent);
      assert.deepEqual(byAttempt, expected, arm);
      if (arm === 'today') assert.ok(rows.every((r) => r.hasKey === false), 'today must send no thinkingMode key at all');
    }
  } finally { delete process.env.FWDLOOP_POC_ARM; delete process.env.FWDLOOP_POC_CALLS; rmSync(dir, { recursive: true, force: true }); }
});

const row = (job, arm, pass, costUsd, wallMs) => ({ job, arm, pass, costUsd, wallMs, turns: 4 });
test('F69 verdict follows the written win rule', () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([1, null]), null);
  const J = ['a', 'b'];
  const mk = (rows) => f69Verdict(summarize(rows), J).verdict;
  const base = [row('a', 'on', true, 2, 20), row('b', 'on', true, 2, 20)];
  assert.equal(mk([...base, row('a', 'retry', true, 1, 10), row('b', 'retry', true, 3, 30)]), 'BUILD');
  assert.equal(mk([...base, row('a', 'retry', false, 1, 10), row('b', 'retry', true, 1, 10)]), 'NO BUILD'); // fewer passes on one job
  assert.equal(mk([...base, row('a', 'retry', true, 2, 20), row('b', 'retry', true, 3, 30)]), 'NO BUILD'); // not faster or cheaper anywhere
  assert.equal(mk([...base, row('a', 'retry', true, null, 10), row('b', 'retry', true, 1, 10)]), 'INCOMPLETE');
});

test('run numbers start above existing sends in the destination (read only)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poc-sends-'));
  try {
    assert.equal(runBaseFor('aging-live-4', [dir]), 1000); // empty
    for (const f of ['aging-live-4-run-1001-x.json', 'aging-live-4-run-1203-x.json', 'other-run-5000-x.json', 'aging-live-4-run-7-x.json']) writeFileSync(join(dir, f), '{}');
    const base = runBaseFor('aging-live-4', [dir]);
    assert.ok(base + 1 > 1203, `first id ${base + 1} must clear run-1203`);
    assert.equal(base, 1300);
    assert.equal(runBaseFor('aging-live-4', [join(dir, 'missing')]), 1000);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('F70 verdict compares retry against today on m7-walk-2', () => {
  const mk = (rows) => f70Verdict(summarize(rows)).verdict;
  const J = 'm7-walk-2';
  const today = [row(J, 'today', true, 2, 20), row(J, 'today', true, 2, 20)];
  assert.equal(mk([...today, row(J, 'retry', true, 1, 30), row(J, 'retry', true, 1, 30)]), 'BUILD'); // cheaper only
  assert.equal(mk([...today, row(J, 'retry', true, 3, 10), row(J, 'retry', true, 3, 10)]), 'BUILD'); // faster only
  assert.equal(mk([...today, row(J, 'retry', true, 1, 10), row(J, 'retry', false, 1, 10)]), 'NO BUILD'); // fewer passes
  assert.equal(mk([...today, row(J, 'retry', true, 2, 20), row(J, 'retry', true, 2, 20)]), 'NO BUILD'); // ties are not lower
  assert.equal(mk([...today, row(J, 'retry', true, null, 10), row(J, 'retry', true, 1, 10)]), 'INCOMPLETE');
  assert.equal(mk(today), 'INCOMPLETE'); // a batch with no retry rows
  assert.equal(mk([row(J, 'on', true, 1, 1), row(J, 'retry', true, 1, 1)]), 'INCOMPLETE'); // `on` is not `today`
});

test('--inputs-from picks that run\'s frozen inputs, default is the latest run', () => {
  const dir = mkdtempSync(join(tmpdir(), 'poc-inputs-'));
  try {
    for (const [run, files] of [['run-1', ['resume.docx', 'jd.md']], ['run-3', ['resume.csv', 'jd.md']]]) {
      mkdirSync(join(dir, 'j', 'runs', run, 'inputs'), { recursive: true });
      for (const f of files) writeFileSync(join(dir, 'j', 'runs', run, 'inputs', f), 'x');
      writeFileSync(join(dir, 'j', 'runs', run, 'inputs.json'), JSON.stringify(files.map((f) => ({ id: f.split('.')[0], frozen: `/x/${f}` }))));
    }
    const names = (s) => s.map((x) => `${x.role}:${basename(x.path)}`).sort();
    assert.deepEqual(names(jobSources(dir, 'j', 'run-1')), ['jd:jd.md', 'resume:resume.docx']);
    assert.deepEqual(names(jobSources(dir, 'j')), ['jd:jd.md', 'resume:resume.csv']);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
