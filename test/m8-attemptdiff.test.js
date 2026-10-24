// borrowed-from: bareloop tests/attemptdiff.test.js@v0.46.0 (8b3d815)
// Adaptations: the wiring tests (runPlan, the fix loop) are not copied (no wiring yet, M8); redactSecrets comes from src/redact.js; temp dir names use fwdloop-adiff- (test repos fwdloop-adiffT-); the last test checks both adaptations.
// attempt-diff: what each worker try changed, recorded to the spine only.
// Real git in throwaway repos (neutral identity: CI has no global gitconfig), no mocks of git.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { startAttemptDiff, cutAtLine, ATTEMPT_DIFF_FILE_MAX, ATTEMPT_DIFF_EVENT_MAX } from '../src/attemptdiff.js';

const ENV = {
  ...process.env, GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null',
  GIT_AUTHOR_NAME: 'ad', GIT_AUTHOR_EMAIL: 'ad@test', GIT_COMMITTER_NAME: 'ad', GIT_COMMITTER_EMAIL: 'ad@test',
};
const git = (/** @type {string} */ dir, /** @type {string[]} */ args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', env: ENV });

function repo(t, files = { 'src/a.js': 'one\ntwo\n', 'tests/t.js': 'x\n' }) {
  const dir = mkdtempSync(join(tmpdir(), 'fwdloop-adiffT-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, ['init', '-q', '-b', 'main']);
  for (const [p, c] of Object.entries(files)) { mkdirSync(join(dir, p, '..'), { recursive: true }); writeFileSync(join(dir, p), c); }
  git(dir, ['add', '-A']);
  git(dir, ['commit', '-q', '-m', 'seed']);
  return dir;
}
const state = (/** @type {string} */ d) => ({ head: git(d, ['rev-parse', 'HEAD']), index: git(d, ['ls-files', '-s']), stash: git(d, ['stash', 'list']), status: git(d, ['status', '--porcelain']) });
// a GitHub token shape from the one SECRET_PATTERNS inventory
const TOKEN = `ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`;

test('a try that changes nothing in scope records nothing', async (t) => {
  const d = repo(t);
  const ad = await startAttemptDiff({ workdir: d, fence: [join(d, 'src')] });
  assert.equal(await ad.finish(), null);
  const ad2 = await startAttemptDiff({ workdir: d, fence: [join(d, 'src')] });
  writeFileSync(join(d, 'tests', 't.js'), 'changed outside\n');
  assert.equal(await ad2.finish(), null, 'a change outside the fence is not recorded');
});

test('a unified -U1 diff of the changed in-scope file is recorded; a file outside the fence NEVER appears', async (t) => {
  const d = repo(t);
  const ad = await startAttemptDiff({ workdir: d, fence: [join(d, 'src')] });
  writeFileSync(join(d, 'src', 'a.js'), 'one\nTWO\n');
  writeFileSync(join(d, 'tests', 't.js'), 'SECRET-LOOKING outside\n');
  writeFileSync(join(d, 'src', 'new.js'), 'brand new\n');
  const r = await ad.finish();
  assert.deepEqual(r.files.map((f) => f.path).sort(), ['src/a.js', 'src/new.js']);
  assert.match(r.files.find((f) => f.path === 'src/a.js').diff, /-two\n\+TWO/);
  assert.ok(!JSON.stringify(r).includes('outside'), 'nothing from outside the fence, in any field');
  assert.equal(r.gitError, undefined);
});

test('a secret in a changed file is masked in the event', async (t) => {
  const d = repo(t);
  const ad = await startAttemptDiff({ workdir: d, fence: [join(d, 'src')] });
  writeFileSync(join(d, 'src', 'a.js'), `one\nconst k = "${TOKEN}";\n`);
  const r = await ad.finish();
  const blob = JSON.stringify(r);
  assert.ok(!blob.includes(TOKEN) && !blob.includes(TOKEN.slice(0, 20)), 'the token never reaches the record');
  assert.match(r.files[0].diff, /const k = /, 'the rest of the line is still there');
});

test('cutAtLine: cuts at a line boundary, never mid-line, and counts the cut lines', () => {
  const text = 'aaaa\nbbbb\ncccc\ndddd\n';
  const c = cutAtLine(text, 12);
  assert.deepEqual(c, { text: 'aaaa\nbbbb\n', truncated: true, cutLines: 2 });
  assert.equal(cutAtLine(text, 1000).truncated, false);
  assert.deepEqual(cutAtLine('x'.repeat(50), 10), { text: '', truncated: true, cutLines: 1 }, 'one over-long line is dropped whole, not sliced');
});

test('per-file cap (4 KB) and per-event cap (16 KB) hold, at line boundaries', async (t) => {
  const d = repo(t, { 'src/seed.js': 'x\n' });
  const ad = await startAttemptDiff({ workdir: d, fence: [join(d, 'src')] });
  const body = Array.from({ length: 400 }, (_, i) => `line number ${i} of the new file`).join('\n') + '\n';
  for (let i = 0; i < 8; i++) writeFileSync(join(d, 'src', `big${i}.js`), body);
  const r = await ad.finish();
  assert.equal(r.files.length, 8);
  assert.ok(r.truncated);
  for (const f of r.files) {
    assert.ok(Buffer.byteLength(f.diff) <= ATTEMPT_DIFF_FILE_MAX, 'per-file cap');
    assert.ok(f.diff === '' || f.diff.endsWith('\n'), 'cut at a line end, never mid-line');
    assert.ok(f.truncated && f.cutLines > 0);
  }
  const total = r.files.reduce((n, f) => n + Buffer.byteLength(f.diff), 0);
  assert.ok(total <= ATTEMPT_DIFF_EVENT_MAX, `per-event cap, got ${total}`);
  assert.ok(r.files.some((f) => f.diff === '' && f.truncated), 'files past the event cap are listed with an empty diff');
});

test('a binary file is noted by path only', async (t) => {
  const d = repo(t);
  const ad = await startAttemptDiff({ workdir: d, fence: [join(d, 'src')] });
  writeFileSync(join(d, 'src', 'pic.bin'), Buffer.from([0, 1, 2, 0, 255, 0, 7]));
  writeFileSync(join(d, 'src', 'a.js'), 'one\nthree\n');
  const r = await ad.finish();
  assert.deepEqual(r.binary, ['src/pic.bin']);
  assert.deepEqual(r.files.map((f) => f.path), ['src/a.js']);
});

test('capture leaves HEAD, the index, the stash list and the work tree status exactly as they were; no temp index is left', async (t) => {
  const d = repo(t);
  writeFileSync(join(d, 'src', 'a.js'), 'dirty before\n'); // uncommitted work already present
  git(d, ['add', 'src/a.js']); // staged
  writeFileSync(join(d, 'src', 'extra.js'), 'untracked\n');
  const before = state(d);
  const tmpBefore = readdirSync(tmpdir()).filter((n) => n.startsWith('fwdloop-adiff-') && !n.startsWith('fwdloop-adiffT-')).length;
  const ad = await startAttemptDiff({ workdir: d, fence: [join(d, 'src')] });
  writeFileSync(join(d, 'src', 'a.js'), 'dirty during\n');
  const r = await ad.finish();
  assert.ok(r.files.length === 1);
  const after = state(d);
  assert.equal(after.head, before.head);
  assert.equal(after.index, before.index, 'the real index is untouched');
  assert.equal(after.stash, before.stash);
  assert.equal(after.status, 'MM src/a.js\n?? src/extra.js\n', 'staged edit still staged, worker edit unstaged, untracked still untracked — nothing was added to the real index');
  assert.equal(readdirSync(tmpdir()).filter((n) => n.startsWith('fwdloop-adiff-') && !n.startsWith('fwdloop-adiffT-')).length, tmpBefore, 'temp index dir removed');
});

test('git failure: never throws, the failure is recorded as a field, files is empty', async (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'fwdloop-adiffT-nogit-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  mkdirSync(join(dir, 'src'));
  const ad = await startAttemptDiff({ workdir: dir, fence: [join(dir, 'src')] }); // not a repo
  const r = await ad.finish();
  assert.deepEqual(r.files, []);
  assert.equal(typeof r.gitError, 'string');
  assert.ok(r.gitError.length > 0);
});

test('RUBRIC shape: output/steps/1.json is seen even when the source folder .gitignore lists output/ (plain folder, hidden git)', async (t) => {
  const d = repo(t, { 'input/flights.txt': 'a flight\n', '.gitignore': 'output/\n' });
  const ad = await startAttemptDiff({ workdir: d, fence: [join(d, 'output')] }); // writeScope ['output/'], dir absent at start
  mkdirSync(join(d, 'output', 'steps'), { recursive: true });
  writeFileSync(join(d, 'output', 'steps', '1.json'), JSON.stringify({ results: [{ quote: 'a flight' }] }) + '\n');
  writeFileSync(join(d, 'input', 'flights.txt'), 'tampered\n');
  const r = await ad.finish();
  assert.deepEqual(r.files.map((f) => f.path), ['output/steps/1.json']);
  assert.match(r.files[0].diff, /"quote":"a flight"/);
});

// ── wiring in runPlan ─────────────────────────────────────────────────────────

test('adaptation: the secret mask is the one in src/redact.js, and the temp dir prefix is fwdloop-adiff-', () => {
  const src = readFileSync(new URL('../src/attemptdiff.js', import.meta.url), 'utf8');
  assert.match(src, /import \{ redactSecrets \} from '\.\/redact\.js';/);
  assert.match(src, /'fwdloop-adiff-'/);
  assert.ok(!/validate\.js|bareloop-adiff/.test(src.split('\n').slice(2).join('\n')), 'no bareloop module or prefix left in the code');
});
