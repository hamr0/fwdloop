// M8 item 2: notes at run end, by code only, $0, no model call. Fake run folders in mkdtemp (the shapes src/runner.js writes:
// audit.jsonl, log.json, diary.jsonl, job/, artifacts/, run.json); the real ~/.config/fwdloop is never touched.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { learnAtRunEnd, readLedger, eventsOfRun } from '../src/learnstore.js';

const GAP = '640 words, limit 600; no line is exactly the heading "Work History"';
const NOW = new Date('2026-10-23T12:00:00Z');
const jl = (/** @type {any[]} */ rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const tryRow = (/** @type {any} */ o) => ({ step: 's1', attempt: 1, class: 'softgreen', verdict: 'red', gap: null, usd: 0.001, spendComplete: true, model: 'deepseek-flash', at: '2026-10-23T10:00:00.000Z', ...o });

/** @param {any} t @param {{rows: any[], outcome?: string, attempts?: any[], checks?: any[], artifact?: boolean}} o */
function runFolder(t, { rows, outcome = 'complete', attempts = [], checks = [], artifact = true }) {
  const root = mkdtempSync(join(tmpdir(), 'fwdloop-runend-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dir = join(root, 'run-1');
  mkdirSync(join(dir, 'job'), { recursive: true });
  mkdirSync(join(dir, 'artifacts'));
  writeFileSync(join(dir, 'audit.jsonl'), jl(rows));
  writeFileSync(join(dir, 'log.json'), JSON.stringify({ runId: 'run-1', outcome, attempts, artifacts: {} }));
  if (checks.length) writeFileSync(join(dir, 'diary.jsonl'), jl(checks.map((c) => ({ kind: 'checks', ...c }))));
  writeFileSync(join(dir, 'job', 'prose.txt'), 'Write a short resume summary.\n\nMore.');
  writeFileSync(join(dir, 'job', 'declaration.json'), JSON.stringify({ steps: [{ emits: 's1', goal: 'summarise', fromLine: 3 }] }));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ inputs: [{ id: 'resume', source: '/nonexistent/resume.docx' }] }));
  if (artifact) writeFileSync(join(dir, 'artifacts', 's1.json'), '{}');
  return { root, dir };
}
const home = (/** @type {any} */ t) => { const d = mkdtempSync(join(tmpdir(), 'fwdloop-runend-home-')); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

const FIXED_ROWS = [tryRow({ gap: GAP }), tryRow({ attempt: 2, verdict: 'softgreen' })];

test('item 2: a step red then passing in the same run is a FIXED note, its text is the check\'s red line (B1), counted at once for a no-ask run', (t) => {
  const { dir } = runFolder(t, {
    rows: FIXED_ROWS,
    attempts: [{ step: 's1', attempt: 1, modelOutput: { text: 'long' } }, { step: 's1', attempt: 2, modelOutput: { text: 'short' } }],
    checks: [{ step: 's1', try: 1, checks: [{ n: 1, text: 'at most 600 words', ok: false }] }],
  });
  const h = home(t);
  const r = learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: dir, specHash: 'h1', now: NOW });
  assert.deepEqual([r.wrote, r.counted, r.held, r.cards, r.problem], [true, 1, 0, 1, null]);
  const { ledger } = readLedger(h);
  assert.equal(ledger.rows.length, 1);
  const row = ledger.rows[0];
  assert.equal(row.workflow, 'aging-1');
  assert.deepEqual(row.runIds, ['aging-1/run-1']);
  assert.equal(row.sample.kind, 'FIXED');
  assert.ok(row.sample.said.some((/** @type {string} */ l) => l.includes('no line is exactly the heading')), 'It said = the red line');
  assert.equal(row.sample.meaning, 'at most 600 words', 'the failing check\'s own text stands in for bareloop\'s stageQuestionsByName');
  assert.equal(row.sample.whatChanged.files[0].path, 'artifacts/s1.json');
  assert.deepEqual(row.sample.fixTouched, ['artifacts/s1.json']);
});

test('item 2 + am3: red on every try is a NEVER FIXED note and it is kept', (t) => {
  const { dir } = runFolder(t, { rows: [tryRow({ gap: GAP }), tryRow({ attempt: 2, gap: GAP })], outcome: 'red', artifact: false });
  const h = home(t);
  const r = learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: dir, specHash: 'h1', now: NOW });
  assert.equal(r.counted, 1);
  assert.equal(readLedger(h).ledger.rows[0].sample.kind, 'NEVER_FIXED');
});

test('item 2: a human redo (hitl red) and a run with no try make no note', (t) => {
  const redo = runFolder(t, { rows: [tryRow({ class: 'hitl', verdict: 'red', gap: 'redo: make it shorter' }), tryRow({ class: 'hitl', attempt: 2, verdict: 'hitl' })] });
  const h = home(t);
  const r = learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: redo.dir, specHash: 'h1', now: NOW });
  assert.equal(r.cards, 0);
  assert.equal(readLedger(h).ledger.rows.length, 0, 'a redo is not a try, so no red moment');
  const none = runFolder(t, { rows: [tryRow({ attempt: null, verdict: 'paused' })] });
  assert.equal(eventsOfRun(none.dir, 'aging-1'), null);
  const h2 = home(t);
  const r2 = learnAtRunEnd({ home: h2, workflow: 'aging-1', runId: 'run-1', runDir: none.dir, specHash: 'h1', now: NOW });
  assert.deepEqual([r2.wrote, r2.noise], [false, 'no-tries']);
  assert.equal(readLedger(h2).exists, false, 'nothing written for a folder with no try (a refused draft has no run folder at all)');
});

test('am4: every run counts at once (no hold); run ids are per workflow', (t) => {
  const a = runFolder(t, { rows: FIXED_ROWS });
  const b = runFolder(t, { rows: FIXED_ROWS });
  const h = home(t);
  const r = learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: a.dir, specHash: 'h1', now: NOW });
  learnAtRunEnd({ home: h, workflow: 'other-1', runId: 'run-1', runDir: b.dir, specHash: 'h2', now: NOW });
  assert.deepEqual([r.counted, r.held], [1, 0]);
  const L = readLedger(h).ledger;
  assert.equal(L.pending.length, 0);
  assert.deepEqual(L.rows.map((x) => x.workflow).sort(), ['aging-1', 'other-1'], 'same run-1, two workflows, two rows');
});

test('am4 item 3: a provider red or a crashed check ends the run as NOISE: no note, even when an earlier try was red', (t) => {
  for (const [verdict, noise] of [['provider-red', 'provider-red'], ['close-casualty', 'close-crashed']]) {
    const { dir } = runFolder(t, { rows: [tryRow({ gap: GAP }), tryRow({ attempt: 2, verdict, gap: 'x', strike: false })], outcome: verdict });
    const h = home(t);
    const r = learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: dir, specHash: 'h1', now: NOW });
    assert.deepEqual([r.noise, r.cards, r.counted], [noise, 0, 0], verdict);
    const L = readLedger(h).ledger;
    assert.equal(L.rows.length, 0, verdict);
    assert.equal(L.health['aging-1/run-1'].noise, noise, 'the run is recorded as noise');
  }
});

test('am4: a stopped / cap-halted folder (log outcome stopped, cap-halt) is read like any end and counts', (t) => {
  for (const outcome of ['stopped', 'cap-halt']) {
    const { dir } = runFolder(t, { rows: [tryRow({ gap: GAP })], outcome, artifact: false });
    const h = home(t);
    const r = learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: dir, specHash: 'h1', now: NOW });
    assert.equal(r.counted, 1, outcome);
    assert.equal(readLedger(h).ledger.rows[0].sample.kind, 'NEVER_FIXED', outcome);
  }
});

test('no model: src/learnstore.js import closure (the note code) reaches no provider, fetch, http, https or net module', () => {
  const src = dirname(dirname(fileURLToPath(import.meta.url)));
  const seen = new Set();
  const bad = [];
  const BANNED = /^(?:node:)?(?:http|https|net|tls|dgram|http2|child_process)$|fetch|provider|bare-?agent|openai|anthropic/i;
  const walk = (/** @type {string} */ file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:^|\n)\s*(?:import|export)\b[^'"\n]*?from\s+['"]([^'"]+)['"]|import\s*\(\s*['"]([^'"]+)['"]\s*\)|(?:^|\n)\s*import\s+['"]([^'"]+)['"]/g)) {
      const spec = m[1] ?? m[2] ?? m[3];
      if (BANNED.test(spec)) bad.push(`${file.slice(src.length + 1)} imports ${spec}`);
      if (spec.startsWith('.')) walk(join(dirname(file), spec));
    }
  };
  walk(join(src, 'src', 'learnstore.js'));
  assert.ok(seen.size > 5, 'the walk really followed learnstore.js through books/diary/flow');
  // config.js imports ./providershapes.js: a list of shape ids (no imports of its own, test below), the one name the pattern hits
  assert.deepEqual(bad, ['src/config.js imports ./providershapes.js']);
  assert.doesNotMatch(readFileSync(join(src, 'src', 'providershapes.js'), 'utf8'), /^import\b/m, 'providershapes.js imports nothing');
});
