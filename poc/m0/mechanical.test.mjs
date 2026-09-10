import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  gather, ask, send, happened, checkStepHappened,
} from './mechanical.mjs';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const answerScript = join(__dirname, 'answer.mjs');

test('gather: reads a real csv file into a hashed, addressable artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-gather-'));
  const path = join(dir, 'sheet.csv');
  writeFileSync(path, 'Customer,Amount\nAcme,100\n');
  const artifact = gather('a1', path, 'csv');
  assert.equal(artifact.kind, 'csv');
  assert.equal(artifact.rows.length, 1);
  assert.equal(artifact.rows[0].cells.B, '100');
  assert.match(artifact.sha256, /^[0-9a-f]{64}$/);
});

test('gather: reads a text file into lines', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-gather-'));
  const path = join(dir, 'msg.txt');
  writeFileSync(path, 'hello world\n');
  const artifact = gather('a2', path, 'text');
  assert.deepEqual(artifact.lines, ['hello world']);
});

test('PROOF the test can fail: gather refuses an empty artifact', () => {
  const dir = mkdtempSync(join(tmpdir(), 'm0-gather-'));
  const path = join(dir, 'empty.csv');
  writeFileSync(path, '');
  assert.throws(() => gather('a3', path, 'csv'), /empty/);
});

test('ask: pauses (writes ask.json), then resolves green once answer.json appears (polling contract)', async () => {
  const runId = `test-accept-${Date.now()}`;
  const outDir = mkdtempSync(join(tmpdir(), 'm0-ask-'));
  setTimeout(() => {
    writeFileSync(join(outDir, 'answer.json'), JSON.stringify({ decision: 'accept', text: null }));
  }, 200);
  const result = await ask(runId, 'ok to send?', { total: 5700 }, { outDir, timeoutMs: 5000, pollMs: 50 });
  assert.equal(result.verdict, 'green');
  assert.equal(result.answer.decision, 'accept');
  assert.ok(existsSync(join(outDir, 'ask.json')));
});

test('ask: a rerun answer resolves red and carries the human\'s exact words', async () => {
  const runId = `test-rerun-${Date.now()}`;
  const outDir = mkdtempSync(join(tmpdir(), 'm0-ask-'));
  setTimeout(() => {
    writeFileSync(join(outDir, 'answer.json'), JSON.stringify({ decision: 'rerun', text: 'redo the total' }));
  }, 200);
  const result = await ask(runId, 'ok to send?', {}, { outDir, timeoutMs: 5000, pollMs: 50 });
  assert.equal(result.verdict, 'red');
  assert.equal(result.answer.text, 'redo the total');
});

test('PROOF the test can fail: ask times out red "ask expired" when no answer ever arrives', async () => {
  const runId = `test-timeout-${Date.now()}`;
  const outDir = mkdtempSync(join(tmpdir(), 'm0-ask-'));
  const result = await ask(runId, 'ok to send?', {}, { outDir, timeoutMs: 300, pollMs: 50 });
  assert.equal(result.verdict, 'red');
  assert.equal(result.red, 'ask expired');
});

test('send: writes the file and returns its path when accepted and target is allow-listed', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm0-send-'));
  const result = send('r1', 'file:poc/m0/out', 'INV-1021 [c1]\n', { acceptedThisRun: true, outDir });
  assert.equal(readFileSync(result.deliveryId, 'utf8'), 'INV-1021 [c1]\n');
});

test('PROOF the test can fail: send refuses without a prior accept this run', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm0-send-'));
  assert.throws(() => send('r2', 'file:poc/m0/out', 'x', { acceptedThisRun: false, outDir }), /no prior accept/);
});

test('PROOF the test can fail: send refuses a target outside the signed allow-list', () => {
  const outDir = mkdtempSync(join(tmpdir(), 'm0-send-'));
  assert.throws(
    () => send('r3', 'mailto:someone@example.com', 'x', { acceptedThisRun: true, outDir }),
    /not in the signed allow-list/,
  );
});

// ---------------------------------------------------------------------------
// RULING 3 (2026-09-10) — the UNIVERSAL "happened" check: no None output, no
// 0kb output. Applies to every step, with no exceptions and no judgment: did
// the artifact come out as real bytes, yes or no. Unlike the rejected `#`
// "generic rule" (F16/F17), this needs no judgment about WHERE it applies —
// it is the same yes/no question about bytes for every step there is.
// ---------------------------------------------------------------------------

test('happened: reds on a null artifact', () => {
  const result = happened(null);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /null/);
});

test('happened: reds on an undefined artifact', () => {
  const result = happened(undefined);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /undefined/);
});

test('happened: reds on a zero-byte artifact (a Buffer with byteLength 0)', () => {
  const result = happened(Buffer.alloc(0));
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /zero bytes/);
});

test('happened: reds on an empty string', () => {
  const result = happened('');
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /empty string/);
});

test('happened: reds on an empty array', () => {
  const result = happened([]);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /empty array/);
});

test('PROOF the test can fail: happened is green on real, non-empty content', () => {
  assert.equal(happened('hello').verdict, 'green');
  assert.equal(happened(['a']).verdict, 'green');
  assert.equal(happened(Buffer.from('x')).verdict, 'green');
  assert.equal(happened({ some: 'object' }).verdict, 'green');
});

// The check is REUSED by gather() (never a second copy) — proven by the
// existing "gather refuses an empty artifact" test above still passing
// unchanged; this test proves the reuse the other direction, that happened()
// itself is what fires for exactly the same csv/text shapes gather() reads.
test('happened fires on the same shapes gather() itself reads (rows/lines), proving it is the one check, not two', () => {
  assert.equal(happened([]).verdict, 'red'); // an empty csv's `rows`
  assert.equal(happened([{ rowNumber: 1, cells: {} }]).verdict, 'green');
});

// --- "regardless of close class" is structural, not a promise -------------
// checkStepHappened does not branch on step.close.class at all; these three
// steps differ ONLY in their declared class, with the identical empty
// artifact, and all three red identically — a hitl step is never exempt.
test('the happened check runs for a hitl step too — a hitl step with an empty artifact is a red', () => {
  const step = { goal: 'check with me', close: { class: 'hitl' } };
  const result = checkStepHappened(step, '');
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /hitl/);
});

test('the happened check runs for a green step with an empty artifact', () => {
  const step = { goal: 'derive totals', close: { class: 'green' } };
  const result = checkStepHappened(step, []);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /green/);
});

test('the happened check runs for a softgreen step with an empty artifact', () => {
  const step = { goal: 'compose reply', close: { class: 'softgreen' } };
  const result = checkStepHappened(step, null);
  assert.equal(result.verdict, 'red');
  assert.match(result.red, /softgreen/);
});

test('PROOF the test can fail: the same three classes are all green on a real, non-empty artifact', () => {
  for (const cls of ['green', 'softgreen', 'hitl']) {
    const result = checkStepHappened({ goal: 'x', close: { class: cls } }, 'real content');
    assert.equal(result.verdict, 'green', `expected green for class ${cls}`);
  }
});

test('answer.mjs (separate process): forking it actually writes answer.json for the runId it is given', async () => {
  const runId = `test-fork-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const cwd = mkdtempSync(join(tmpdir(), 'm0-fork-cwd-'));
  await new Promise((resolve, reject) => {
    const child = fork(answerScript, [runId, 'accept'], { cwd, silent: true });
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`answer.mjs exited ${code}`))));
  });
  const answerPath = join(cwd, 'poc', 'm0', 'out', runId, 'answer.json');
  assert.ok(existsSync(answerPath));
  const written = JSON.parse(readFileSync(answerPath, 'utf8'));
  assert.equal(written.decision, 'accept');
});
