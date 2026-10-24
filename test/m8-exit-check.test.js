// M8 exit checker (scripts/m8-exit-check.mjs): on a $0 world made by the REAL runner (fake model step, job2 fixture, scratch config home): run-1 has a step red then
// fixed on a retry, run-2 (same workflow) is handed the ledger's block at its draft and at its retry. A good world passes every check; each fact then broken
// in turn must make its own check FAIL (and the exit code 1). Never reads or writes ~/.config/fwdloop or flows/: every dir is mkdtemp, cleaned up.
import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { readFileSync, writeFileSync, rmSync, cpSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { runFlow } from '../src/runner.js';
import { hintsForRun, placeSpecOf, readLedger, writeLedger } from '../src/learnstore.js';
import { writeLearningsRecord } from '../src/flowmodel.js';
import { sandboxSend } from './send-sandbox.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SCRIPT = path.join(HERE, '..', 'scripts', 'm8-exit-check.mjs');
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CATALOGUE = (() => { const l = loadCatalogue(); assert.equal(l.ok, true); return l.primitives; })();
const dirs = [];
const tmp = (p) => { const d = mkdtempSync(path.join(tmpdir(), `fwdloop-m8exit-${p}-`)); dirs.push(d); return d; };
after(() => { for (const d of dirs) rmSync(d, { recursive: true, force: true }); delete process.env.FWDLOOP_CONFIG_HOME; });

const GOOD = '## summary of work history blurb\nworked places.\n## professional skills\nskills.\n## soft skills\nsoft skills.';
const LONG = `## summary of work history blurb\n${'word '.repeat(700)}`;

/** a model step whose summary step is too long on try 1 and fine after: red, then fixed on the retry */
const modelStep = async (ctx, _t, meta) => {
  if (ctx.goal.includes('resume .docx')) return { ok: true, costUsd: 0.001, artifact: { text: 'resume text', done: true } };
  if (ctx.goal.includes('job description markdown')) return { ok: true, costUsd: 0.001, artifact: { text: 'jd text', done: true } };
  return { ok: true, costUsd: 0.001, artifact: { text: meta.attempt === 1 ? LONG : GOOD, done: true } };
};

function sign(root, name) {
  const w = writeFlow({ root, name, proseText: sandboxSend(fixture('job2-with-sources.signed.txt')), declaration: JSON.parse(fixture('job2.m1.declaration.json')), signedBy: 'hamr', signedAt: '2026-09-25T12:00:00Z', catalogue: CATALOGUE });
  assert.equal(w.ok, true);
}

/** one world: run-1 (ON, empty ledger), run-2 (ON, handed run-1's block), run-3 (a second flow, learningHints OFF: the negative) */
let world = null;
async function build() {
  if (world) return world;
  const home = tmp('home');
  const root = tmp('root');
  const src = tmp('src');
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: true }));
  process.env.FWDLOOP_CONFIG_HOME = home;
  writeFileSync(path.join(src, 'resume.docx'), 'Resume text goes here.');
  writeFileSync(path.join(src, 'jd.md'), 'JD text goes here.');
  const sources = [{ id: 'resume', path: path.join(src, 'resume.docx') }, { id: 'jd', path: path.join(src, 'jd.md') }];
  const base = { root, catalogue: CATALOGUE, modelStep, askStep: async () => ({ decision: 'accept' }), sendStep: async () => ({ ok: true, bytes: 1 }), primitives: {}, businessDate: '2026-06-01', sources };
  sign(root, 'job2');
  const r1 = await runFlow({ ...base, name: 'job2', runId: 'run-1' });
  assert.equal(r1.outcome, 'complete', r1.red);
  // run-2's draft: the block the ledger gives (the drafter's own call), kept as the draft's record in the flow folder; the runner's first run takes it
  const block = hintsForRun({ home, spec: placeSpecOf('job2', sources[0].path), specHash: null });
  assert.ok(block, 'run-1 left a readable note');
  writeLearningsRecord(path.join(root, 'job2'), block);
  const r2 = await runFlow({ ...base, name: 'job2', runId: 'run-2' });
  assert.equal(r2.outcome, 'complete', r2.red);
  // the negative: the same job under another name, learningHints OFF
  writeFileSync(path.join(home, 'config.json'), JSON.stringify({ learningHints: false }));
  sign(root, 'job3');
  const r3 = await runFlow({ ...base, name: 'job3', runId: 'run-1' });
  assert.equal(r3.outcome, 'complete', r3.red);
  world = { home, root };
  return world;
}

/** run the script; returns {code, lines: {'1a': 'PASS ...'}} */
function check(w, extra = []) {
  const args = [SCRIPT, '--root', w.root, '--flow', 'job2', '--runs', 'run-1,run-2', '--home', w.home, '--negative', 'job3/run-1', ...extra];
  let out; let code = 0;
  try { out = execFileSync(process.execPath, args, { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'pipe'] }); } catch (e) { code = e.status; out = String(e.stdout ?? ''); if (code === 2 || code === null) throw new Error(`cannot check: ${e.stderr}`); }
  const lines = {};
  for (const l of out.split('\n')) { const m = /^(PASS|FAIL) (\d[a-z]?|books run-\d)[ :]/.exec(l); if (m) lines[m[2] === 'books run-1' ? 'b1' : m[2] === 'books run-2' ? 'b2' : m[2]] = l; }
  return { code, lines };
}
const verdicts = (r) => Object.fromEntries(Object.entries(r.lines).map(([k, v]) => [k, v.slice(0, 4)]));

/** edit a file for the length of fn, then put it back */
async function broken(file, edit, fn) {
  const was = readFileSync(file, 'utf8');
  writeFileSync(file, edit(was));
  try { return await fn(); } finally { writeFileSync(file, was); }
}
const rows = (s) => s.split('\n').filter(Boolean).map((l) => JSON.parse(l));
const jsonl = (rs) => `${rs.map((r) => JSON.stringify(r)).join('\n')}\n`;

const ALL = ['1a', '1b', '2', '3a', '3b', '4', '5', 'b1', 'b2', '6'];

test('a good world: every check PASSes and the exit code is 0', async () => {
  const w = await build();
  const r = check(w);
  assert.deepEqual(Object.keys(r.lines).sort(), [...ALL].sort());
  assert.deepEqual(Object.values(verdicts(r)).filter((v) => v !== 'PASS'), [], JSON.stringify(r.lines, null, 1));
  assert.equal(r.code, 0);
  assert.match(r.lines['3b'], /tier B/);
});

test('3b tier A: with run-2 not yet counted the text must be byte-equal to renderHints over the ledger', async () => {
  const w = await build();
  const file = path.join(w.home, 'learn', 'ledger.json');
  const was = readFileSync(file, 'utf8');
  try {
    const L = readLedger(w.home).ledger;
    const rows2 = L.rows.map((r) => ({ ...r, count: r.count - (r.runIds.includes('job2/run-2') ? 1 : 0), runIds: r.runIds.filter((x) => x !== 'job2/run-2') })).filter((r) => r.runIds.length);
    const health = { ...L.health }; delete health['job2/run-2'];
    writeLedger({ ...L, rows: rows2, health }, w.home);
    const r = check(w);
    assert.match(r.lines['3b'], /tier A/);
    assert.equal(r.lines['3b'].slice(0, 4), 'PASS', r.lines['3b']);
    // ... and one character off in the record is no longer equal
    const rec = path.join(w.root, 'job2', 'runs', 'run-2', 'learnings.json');
    const r2 = await broken(rec, (s) => { const j = JSON.parse(s); j.text = j.text.replace('seen 1 time', 'seen 2 time'); return JSON.stringify(j); }, async () => check(w));
    assert.equal(r2.lines['3b'].slice(0, 4), 'FAIL', r2.lines['3b']);
    assert.equal(r2.code, 1);
  } finally { writeFileSync(file, was); }
});

test('break each fact: no FIXED in run-1 -> 1a FAILs', async () => {
  const w = await build();
  const f = path.join(w.root, 'job2', 'runs', 'run-1', 'audit.jsonl');
  const r = await broken(f, (s) => jsonl(rows(s).map((x) => (x.verdict === 'red' || x.verdict === 'not-done' ? { ...x, verdict: 'green' } : x))), async () => check(w));
  assert.equal(r.lines['1a'].slice(0, 4), 'FAIL', r.lines['1a']);
  assert.equal(r.code, 1);
});

test('break each fact: run-1 not ended (no history row) -> 1b FAILs', async () => {
  const w = await build();
  const f = path.join(w.root, 'job2', 'history.jsonl');
  const r = await broken(f, (s) => jsonl(rows(s).filter((x) => x.runId !== 'run-1')), async () => check(w));
  assert.equal(r.lines['1b'].slice(0, 4), 'FAIL', r.lines['1b']);
});

test('break each fact: the ledger misses run-1 -> 2 FAILs', async () => {
  const w = await build();
  const f = path.join(w.home, 'learn', 'ledger.json');
  const r = await broken(f, (s) => { const L = JSON.parse(s); L.rows = L.rows.map((x) => ({ ...x, runIds: x.runIds.filter((i) => i !== 'job2/run-1') })); return JSON.stringify(L); }, async () => check(w));
  assert.equal(r.lines['2'].slice(0, 4), 'FAIL', r.lines['2']);
  assert.equal(r.code, 1);
});

test('break each fact: a held (pending) run-1 -> 2 FAILs', async () => {
  const w = await build();
  const f = path.join(w.home, 'learn', 'ledger.json');
  const r = await broken(f, (s) => { const L = JSON.parse(s); L.pending = [{ runid: 'job2/run-1', at: new Date().toISOString(), workflow: 'job2', place: null, specHash: null, cards: [] }]; return JSON.stringify(L); }, async () => check(w));
  assert.equal(r.lines['2'].slice(0, 4), 'FAIL', r.lines['2']);
});

test('break each fact: learnings.json text changed by one character -> 3b and 5 FAIL', async () => {
  const w = await build();
  const f = path.join(w.root, 'job2', 'runs', 'run-2', 'learnings.json');
  const r = await broken(f, (s) => { const j = JSON.parse(s); j.text = `X${j.text.slice(1)}`; return JSON.stringify(j); }, async () => check(w));
  assert.equal(r.lines['3b'].slice(0, 4), 'FAIL', r.lines['3b']);
  assert.equal(r.lines['5'].slice(0, 4), 'FAIL', r.lines['5']);
  assert.equal(r.code, 1);
});

test('break each fact: learnings.json gone (nothing handed at the draft) -> 3a and 4 FAIL', async () => {
  const w = await build();
  const f = path.join(w.root, 'job2', 'runs', 'run-2', 'learnings.json');
  const r = await broken(f, () => JSON.stringify({ phase: 'draft', text: '', ids: [], chars: 0 }), async () => check(w));
  assert.equal(r.lines['3a'].slice(0, 4), 'FAIL', r.lines['3a']);
  assert.equal(r.lines['4'].slice(0, 4), 'FAIL', r.lines['4']);
});

test('break each fact: a retry row without hintsText -> 5 FAILs', async () => {
  const w = await build();
  const f = path.join(w.root, 'job2', 'runs', 'run-2', 'audit.jsonl');
  const r = await broken(f, (s) => jsonl(rows(s).map((x) => { if (x.attempt >= 2 && Object.hasOwn(x, 'hintsText')) { const { hintsText: _t, ...rest } = x; return rest; } return x; })), async () => check(w));
  assert.equal(r.lines['5'].slice(0, 4), 'FAIL', r.lines['5']);
  assert.equal(r.code, 1);
});

test('break each fact: run-2 has no retry at all -> 5 FAILs', async () => {
  const w = await build();
  const f = path.join(w.root, 'job2', 'runs', 'run-2', 'audit.jsonl');
  const r = await broken(f, (s) => jsonl(rows(s).filter((x) => !(x.attempt >= 2))), async () => check(w));
  assert.equal(r.lines['5'].slice(0, 4), 'FAIL', r.lines['5']);
});

test('break each fact: an OFF run with hints on an audit row -> 6 FAILs; with learnings text -> 6 FAILs', async () => {
  const w = await build();
  const run3 = path.join(w.root, 'job3', 'runs', 'run-1');
  assert.equal(check(w).lines['6'].slice(0, 4), 'PASS');
  const a = await broken(path.join(run3, 'audit.jsonl'), (s) => { const rs = rows(s); rs[0] = { ...rs[0], hints: 1, hintsText: 'x', hintIds: ['a'] }; return jsonl(rs); }, async () => check(w));
  assert.equal(a.lines['6'].slice(0, 4), 'FAIL', a.lines['6']);
  writeFileSync(path.join(run3, 'learnings.json'), JSON.stringify({ phase: 'draft', text: 'Hints', ids: ['a'], chars: 5 }));
  try {
    const b = check(w);
    assert.equal(b.lines['6'].slice(0, 4), 'FAIL', b.lines['6']);
    assert.equal(b.code, 1);
  } finally { rmSync(path.join(run3, 'learnings.json')); }
});

test('break each fact: the books of run-2 do not add up -> b2 FAILs', async () => {
  const w = await build();
  const f = path.join(w.root, 'job2', 'history.jsonl');
  const r = await broken(f, (s) => jsonl(rows(s).map((x) => (x.runId === 'run-2' ? { ...x, spentUsd: x.spentUsd + 0.5 } : x))), async () => check(w));
  assert.equal(r.lines.b2.slice(0, 4), 'FAIL', r.lines.b2);
  assert.equal(r.code, 1);
});

test('the script is read-only and a missing run folder is exit 2, not a verdict', async () => {
  const w = await build();
  let code = 0;
  try { execFileSync(process.execPath, [SCRIPT, '--root', w.root, '--flow', 'job2', '--runs', 'run-1,run-9', '--home', w.home], { encoding: 'utf8', timeout: 60000, stdio: 'pipe' }); } catch (e) { code = e.status; }
  assert.equal(code, 2);
});
