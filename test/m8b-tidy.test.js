// M8b piece 5: `fwdloop tidy --root <flows>` moves old run folders to the new shape (run.json, diary.jsonl, line-checks.json) and removes the old files.
// $0, mkdtemp fixtures written in the OLD shape by hand, the real readers on the result, the real CLI for the command.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import {
  readFileSync, writeFileSync, rmSync, readdirSync, mkdirSync, lstatSync, utimesSync, symlinkSync, existsSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { tidyRoot, tidyRun } from '../src/tidy.js';
import { readRunModel } from '../src/flowmodel.js';
import { readRunInputs, readRunThinking } from '../src/runfile.js';
import { readCalls, readTools, readChecks } from '../src/diary.js';
import { readLineSection } from '../src/line-checks.js';
import { procStartOf } from '../src/liveness.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const BIN = path.join(HERE, '..', 'bin', 'fwdloop');
const dirs = [];
const tmp = () => { const d = mkdtempSync(path.join(tmpdir(), 'fwdloop-m8b-tidy-')); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); });
const NOT_ALIVE = () => null;
const jl = (rows) => rows.map((r) => `${JSON.stringify(r)}\n`).join('');
const SLOT = 'DEEPSEEK_API_KEY';

const INPUTS = [{ id: 'resume', source: '/x/r.md', frozen: '/x/runs/run-1/inputs/resume.md', sha256: 'ab', bytes: 3 }];
const CALLS = [
  { step: 's', try: 1, round: 1, at: '2026-10-20T10:00:01.000Z', model: 'm', costUsd: 0.1, tokens: { in: 1, out: 2, cache: 0 }, ms: 5, stopReason: 'tool_calls', thinking: { asked: 'off', status: null } },
  { step: 's', try: 1, round: 2, at: '2026-10-20T10:00:03.000Z', model: 'm', costUsd: 0.1, tokens: null, ms: 5, stopReason: 'stop', thinking: { asked: 'off', status: null } },
];
const TOOLS = [{ step: 's', try: 1, round: 1, at: '2026-10-20T10:00:02.000Z', tool: 'read', path: 'inputs/r.md', decision: 'allow', rule: null }];
const CHECKS = [{ step: 's', try: 1, at: '2026-10-20T10:00:04.000Z', lastRound: 2, checks: [{ n: 1, text: 'x', ok: true, result: null, source: 'every step' }], output: null }];
const CITED = { lines: [{ n: 3, source: 'jd', passed: true, facts: [], rows: null, notChecked: [] }] };
const SHEET = { lines: [{ n: 2, try: 1, passed: true, tables: [], checks: [], claims: {}, results: [], red: null }] };

/** a run folder in the OLD shape, with other files that must not be touched; `skip` names files left out */
function oldRun(root, flow = 'job', runId = 'run-1', skip = []) {
  const dir = path.join(root, flow, 'runs', runId);
  mkdirSync(path.join(dir, 'job'), { recursive: true });
  mkdirSync(path.join(dir, 'artifacts'), { recursive: true });
  const put = (name, text) => { if (!skip.includes(name)) writeFileSync(path.join(dir, name), text); };
  put('run-model.json', `${JSON.stringify({ slot: SLOT, model: 'm1' }, null, 2)}\n`);
  put('thinking.json', `${JSON.stringify({ thinking: true })}\n`);
  put('inputs.json', JSON.stringify(INPUTS, null, 2));
  put('calls.jsonl', jl(CALLS));
  put('tools.jsonl', jl(TOOLS));
  put('checks.jsonl', jl(CHECKS));
  put('cited-checks.json', `${JSON.stringify(CITED, null, 2)}\n`);
  put('sheet-checks.json', `${JSON.stringify(SHEET, null, 2)}\n`);
  writeFileSync(path.join(dir, 'audit.jsonl'), jl([{ step: 's', verdict: 'green' }]));
  writeFileSync(path.join(dir, 'log.json'), '{"outcome":"complete"}');
  writeFileSync(path.join(dir, 'artifacts', 's.json'), '{}');
  return dir;
}
/** every file under a folder -> sha256 of its bytes */
function treeHash(dir, rel = '') {
  const out = {};
  for (const e of readdirSync(path.join(dir, rel), { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (e.isDirectory()) Object.assign(out, treeHash(dir, r));
    else out[r] = createHash('sha256').update(readFileSync(path.join(dir, r))).digest('hex');
  }
  return out;
}
const OLD_NAMES = ['run-model.json', 'thinking.json', 'inputs.json', 'calls.jsonl', 'tools.jsonl', 'checks.jsonl', 'cited-checks.json', 'sheet-checks.json'];

test('a run is moved: the real readers give the old answers on the new files, the eight old files are gone, nothing else is touched', () => {
  const root = tmp();
  const dir = oldRun(root);
  const before = treeHash(dir);
  const r = tidyRoot({ root, isAlive: NOT_ALIVE });
  assert.deepEqual([r.moved, r.tidy, r.skipped, r.failed], [['job/run-1'], [], [], []]);
  assert.deepEqual(readdirSync(dir).sort(), ['artifacts', 'audit.jsonl', 'diary.jsonl', 'job', 'line-checks.json', 'log.json', 'run.json']);
  assert.deepEqual(readRunModel(dir), { slot: SLOT, model: 'm1' });
  assert.equal(readRunThinking(dir), true);
  assert.deepEqual(readRunInputs(dir), { ok: true, entries: INPUTS });
  assert.deepEqual(readCalls(dir).map(({ kind, ...x }) => x), CALLS);
  assert.deepEqual(readTools(dir).map(({ kind, ...x }) => x), TOOLS);
  assert.deepEqual(readChecks(dir).map(({ kind, ...x }) => x), CHECKS);
  assert.deepEqual(readLineSection(dir, 'cited'), { ok: true, lines: CITED.lines });
  assert.deepEqual(readLineSection(dir, 'sheet'), { ok: true, lines: SHEET.lines });
  for (const f of ['audit.jsonl', 'log.json', 'artifacts/s.json']) assert.equal(treeHash(dir)[f], before[f], `${f} untouched`);
});

test('the diary keeps each old file\'s order and interleaves the three by each row\'s own at; a tie goes calls, tools, checks', () => {
  const root = tmp();
  const dir = oldRun(root);
  tidyRoot({ root, isAlive: NOT_ALIVE });
  const rows = readFileSync(path.join(dir, 'diary.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(rows.map((r) => [r.kind, r.at.slice(17, 19)]), [['call', '01'], ['tool', '02'], ['call', '03'], ['checks', '04']]);
  const t = tmp();
  const d2 = oldRun(t);
  const same = '2026-10-20T10:00:00.000Z';
  writeFileSync(path.join(d2, 'calls.jsonl'), jl([{ ...CALLS[0], at: same, round: 1 }]));
  writeFileSync(path.join(d2, 'tools.jsonl'), jl([{ ...TOOLS[0], at: same }]));
  writeFileSync(path.join(d2, 'checks.jsonl'), jl([{ ...CHECKS[0], at: same }, { ...CHECKS[0], at: undefined, try: 2 }]));
  tidyRoot({ root: t, isAlive: NOT_ALIVE });
  const tied = readFileSync(path.join(d2, 'diary.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(tied.map((r) => r.kind), ['call', 'tool', 'checks', 'checks'], 'a tie: calls, tools, checks; a row with no at follows the row before it');
});

test('a second tidy changes nothing: the tree is byte for byte the same and the run is reported already tidy', () => {
  const root = tmp();
  const dir = oldRun(root);
  tidyRoot({ root, isAlive: NOT_ALIVE });
  const once = treeHash(dir);
  const r = tidyRoot({ root, isAlive: NOT_ALIVE });
  assert.deepEqual([r.moved, r.tidy], [[], ['job/run-1']]);
  assert.deepEqual(treeHash(dir), once);
});

test('a run with only some of the old files (before the thinking record, no model, no checks) moves with only those sections', () => {
  const root = tmp();
  const dir = oldRun(root, 'job', 'run-1', ['thinking.json', 'run-model.json', 'checks.jsonl', 'tools.jsonl', 'cited-checks.json', 'sheet-checks.json']);
  assert.equal(tidyRoot({ root, isAlive: NOT_ALIVE }).moved.length, 1);
  assert.equal(readRunThinking(dir), null, 'no thinking section: a run from before the box record reads null');
  assert.equal(readRunModel(dir), null);
  assert.deepEqual(readRunInputs(dir), { ok: true, entries: INPUTS });
  assert.deepEqual(readTools(dir), []);
  assert.equal(readLineSection(dir, 'cited').ok, false);
  assert.equal(existsSync(path.join(dir, 'line-checks.json')), false, 'no sections, no file');
  const bare = oldRun(root, 'job', 'run-2', OLD_NAMES);
  assert.deepEqual(tidyRun(bare, NOT_ALIVE), { status: 'tidy' });
  assert.equal(existsSync(path.join(bare, 'run.json')), false, 'nothing old, nothing made');
});

test('the new files keep the modified time of the old file they replace (the Run card finds the newest run by it)', () => {
  const root = tmp();
  const dir = oldRun(root);
  const when = new Date('2026-09-01T08:00:00Z');
  for (const f of ['inputs.json', 'thinking.json', 'run-model.json', 'calls.jsonl', 'tools.jsonl', 'checks.jsonl', 'cited-checks.json', 'sheet-checks.json']) utimesSync(path.join(dir, f), when, when);
  tidyRoot({ root, isAlive: NOT_ALIVE });
  for (const f of ['run.json', 'diary.jsonl', 'line-checks.json']) assert.equal(Math.floor(lstatSync(path.join(dir, f)).mtimeMs / 1000), when.getTime() / 1000, f);
});

test('a run whose process is alive is skipped and named, untouched; the others still move', () => {
  const root = tmp();
  const busy = oldRun(root, 'job', 'run-1');
  const idle = oldRun(root, 'job', 'run-2');
  const before = treeHash(busy);
  const r = tidyRoot({ root, isAlive: (d) => (d === busy ? 'its process is alive' : null) });
  assert.deepEqual(r.skipped, [{ run: 'job/run-1', why: 'its process is alive' }]);
  assert.deepEqual(r.moved, ['job/run-2']);
  assert.deepEqual(treeHash(busy), before);
  assert.equal(existsSync(path.join(idle, 'run.json')), true);
});

test('the real alive rule: a live resume lock or a run with no pid row and fresh books is skipped; an old quiet run moves', () => {
  const root = tmp();
  const locked = oldRun(root, 'job', 'run-1');
  writeFileSync(path.join(locked, 'resume.lock'), JSON.stringify({ pid: process.pid, procStart: procStartOf('self') }));   // this very process holds it: alive by definition
  const fresh = oldRun(root, 'job', 'run-2');
  writeFileSync(path.join(fresh, 'state.json'), '{}');                       // changed just now, no pid row
  const quiet = oldRun(root, 'job', 'run-3');
  const old = new Date(Date.now() - 3600_000);
  writeFileSync(path.join(quiet, 'state.json'), '{}');
  for (const f of ['state.json', 'audit.jsonl', 'log.json']) utimesSync(path.join(quiet, f), old, old);
  const r = tidyRoot({ root });
  const byRun = Object.fromEntries(r.skipped.map((s) => [s.run, s.why]));
  assert.match(byRun['job/run-1'], /a resume of it is running/);
  assert.match(byRun['job/run-2'], /books changed in the last 10 minutes/);
  assert.deepEqual(r.moved.filter((x) => x === 'job/run-3'), ['job/run-3']);
});

test('a run it cannot move is named with why and left exactly as it is: invalid inputs, a symlinked old file, a cited record with no lines', () => {
  const root = tmp();
  const a = oldRun(root, 'job', 'run-1');
  writeFileSync(path.join(a, 'inputs.json'), '{nope');
  const b = oldRun(root, 'job', 'run-2');
  rmSync(path.join(b, 'calls.jsonl'));
  symlinkSync(path.join(a, 'audit.jsonl'), path.join(b, 'calls.jsonl'));
  const c = oldRun(root, 'job', 'run-3');
  writeFileSync(path.join(c, 'cited-checks.json'), '{"lines": "x"}');
  const good = oldRun(root, 'job', 'run-4');
  const snap = [a, b, c].map((d) => JSON.stringify(readdirSync(d).sort()) + JSON.stringify(readdirSync(d).filter((f) => lstatSync(path.join(d, f)).isFile()).map((f) => readFileSync(path.join(d, f), 'utf8'))));
  const r = tidyRoot({ root, isAlive: NOT_ALIVE });
  assert.deepEqual(r.failed.map((f) => f.run), ['job/run-1', 'job/run-2', 'job/run-3']);
  assert.match(r.failed[0].why, /inputs\.json is not valid JSON/);
  assert.match(r.failed[1].why, /calls\.jsonl.*symlink/);
  assert.match(r.failed[2].why, /cited-checks\.json has no list of "lines"/);
  assert.deepEqual([a, b, c].map((d) => JSON.stringify(readdirSync(d).sort()) + JSON.stringify(readdirSync(d).filter((f) => lstatSync(path.join(d, f)).isFile()).map((f) => readFileSync(path.join(d, f), 'utf8')))), snap, 'no new file kept, no old file removed');
  assert.deepEqual(r.moved, ['job/run-4']);
  assert.equal(existsSync(path.join(good, 'inputs.json')), false);
});

test('a run left half-moved by a crash is finished; a new file that disagrees with its old file is a refusal, nothing removed', () => {
  const root = tmp();
  const half = oldRun(root, 'job', 'run-1');
  writeFileSync(path.join(half, 'run.json'), JSON.stringify({ model: { slot: SLOT, model: 'm1' }, thinking: true, inputs: INPUTS }));   // run.json was made, the old files were not removed
  rmSync(path.join(half, 'inputs.json'));                                                                                                // and one old file was already gone
  const odd = oldRun(root, 'job', 'run-2');
  writeFileSync(path.join(odd, 'run.json'), JSON.stringify({ model: { slot: SLOT, model: 'm1' }, thinking: false, inputs: INPUTS }));
  const r = tidyRoot({ root, isAlive: NOT_ALIVE });
  assert.deepEqual(r.moved, ['job/run-1']);
  assert.deepEqual(readRunInputs(half), { ok: true, entries: INPUTS });
  assert.equal(readCalls(half).length, 2);
  assert.equal(existsSync(path.join(half, 'thinking.json')), false);
  assert.deepEqual(r.failed.map((f) => f.run), ['job/run-2']);
  assert.match(r.failed[0].why, /run\.json and thinking\.json disagree/);
  assert.equal(existsSync(path.join(odd, 'thinking.json')), true, 'nothing removed');
  assert.equal(existsSync(path.join(odd, 'diary.jsonl')), false, 'nothing kept');
});

test('a torn last line in an old diary is not carried (the readers skipped it); every readable row is', () => {
  const root = tmp();
  const dir = oldRun(root);
  writeFileSync(path.join(dir, 'calls.jsonl'), `${jl(CALLS)}{"step":"s","ro`);
  tidyRoot({ root, isAlive: NOT_ALIVE });
  assert.deepEqual(readCalls(dir).map(({ kind, ...x }) => x), CALLS);
});

test('CLI: fwdloop tidy --root moves, says which runs it moved, skipped or could not move, and a second run says nothing was left to move; --root is required', () => {
  const root = tmp();
  oldRun(root, 'job', 'run-1');
  const bad = oldRun(root, 'job', 'run-2');
  writeFileSync(path.join(bad, 'inputs.json'), '{nope');
  const old = new Date(Date.now() - 3600_000);   // the real alive rule skips a run whose books changed in the last 10 minutes and has no pid row
  for (const d of [path.join(root, 'job', 'runs', 'run-1'), bad]) for (const f of ['audit.jsonl', 'log.json']) utimesSync(path.join(d, f), old, old);
  const run = (args) => spawnSync(process.execPath, [BIN, 'tidy', ...args], { encoding: 'utf8', timeout: 60_000 });
  const first = run(['--root', root]);
  assert.equal(first.status, 1, 'a run that cannot be moved makes the exit non-zero');
  assert.match(first.stdout, /^moved: job\/run-1$/m);
  assert.match(first.stdout, /^cannot move: job\/run-2 — inputs\.json is not valid JSON \(left as it is\)$/m);
  assert.match(first.stdout, /^tidy: 2 runs: moved 1, already tidy 0, skipped 0, cannot move 1$/m);
  const second = run(['--root', root]);
  assert.match(second.stdout, /^tidy: 2 runs: moved 0, already tidy 1, skipped 0, cannot move 1$/m);
  const none = run([]);
  assert.notEqual(none.status, 0);
  assert.match(none.stderr, /--root/);
});
