import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gather, ask, send } from './mechanical.mjs';

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
