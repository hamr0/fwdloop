// M8 item 5a loose end: ONE function decides the place. The run-end notes (a path as the run was given it) and the drafter's hints (the path as typed in the prose)
// must name the same file as the same place, or climbing "this place" breaks. $0, scratch homes (mkdtemp, cleaned up).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { mkdirSync, writeFileSync, rmSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { learnAtRunEnd, readLedger, hintsForRun, resolvePlace, writeLedger } from '../src/learnstore.js';
import { emptyLedger, countLedger, HINT_HEADER } from '../src/learn.js';
import { cardsOf } from './m8-learn-fixtures.js';

const NOW = new Date();
const GAP = '640 words, limit 600; no line is exactly the heading "Work History"';
const jl = (/** @type {any[]} */ rows) => `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`;
const tryRow = (/** @type {any} */ o) => ({ step: 's1', attempt: 1, class: 'softgreen', verdict: 'red', gap: null, usd: 0.001, spendComplete: true, model: 'deepseek-flash', at: NOW.toISOString(), ...o });
const scratch = (/** @type {any} */ t, /** @type {string} */ p) => { const d = mkdtempSync(join(tmpdir(), `fwdloop-m8-place-${p}-`)); t.after(() => rmSync(d, { recursive: true, force: true })); return d; };

/** a finished run (FIXED note on s1) whose run.json names `source` */
function runWith(/** @type {any} */ t, /** @type {string} */ source) {
  const dir = join(scratch(t, 'run'), 'run-1');
  mkdirSync(join(dir, 'job'), { recursive: true });
  mkdirSync(join(dir, 'artifacts'));
  writeFileSync(join(dir, 'audit.jsonl'), jl([tryRow({ gap: GAP }), tryRow({ attempt: 2, verdict: 'softgreen' })]));
  writeFileSync(join(dir, 'log.json'), JSON.stringify({ runId: 'run-1', outcome: 'complete', attempts: [{ step: 's1', attempt: 1, modelOutput: { text: 'long' } }, { step: 's1', attempt: 2, modelOutput: { text: 'short' } }], artifacts: {} }));
  writeFileSync(join(dir, 'diary.jsonl'), jl([{ kind: 'checks', step: 's1', try: 1, checks: [{ n: 1, text: 'at most 600 words', ok: false }] }]));
  writeFileSync(join(dir, 'job', 'prose.txt'), 'Write a short summary.\n\nMore.');
  writeFileSync(join(dir, 'job', 'declaration.json'), JSON.stringify({ steps: [{ emits: 's1', goal: 'summarise', fromLine: 3 }] }));
  writeFileSync(join(dir, 'run.json'), JSON.stringify({ inputs: [{ id: 'resume', source }] }));
  writeFileSync(join(dir, 'artifacts', 's1.json'), '{}');
  return dir;
}

test('the same file is the same place whether the prose says ~/x or the run was given /home/.../x', (t) => {
  assert.equal(resolvePlace('~/in/a.csv'), join(homedir(), 'in/a.csv'), 'a leading ~ is the home folder, not <cwd>/~');
  assert.equal(resolvePlace('~/in/./a.csv'), resolvePlace(join(homedir(), 'in', 'a.csv')));
  const h = scratch(t, 'cfg');
  learnAtRunEnd({ home: h, workflow: 'aging-1', runId: 'run-1', runDir: runWith(t, join(homedir(), 'in/a.csv')), specHash: null, now: NOW });
  const { ledger } = readLedger(h);
  assert.equal(ledger.rows[0].place, join(homedir(), 'in/a.csv'), 'the run-end place');
  // the draft side: two sibling rows of OTHER jobs on that place climb to a hint for a new job whose prose says `~/in/a.csv`
  writeFileSync(join(h, 'config.json'), JSON.stringify({ learningHints: true }));
  const built = cardsOf('ms2c0ls7');
  const mk = (/** @type {string} */ wf) => countLedger(emptyLedger(), { runid: 'r0', cards: built.cards, workflow: wf, place: join(homedir(), 'in/a.csv'), specHash: null, trust: 'deterministic', now: NOW }).rows[0];
  writeLedger({ ...emptyLedger(), rows: [mk('wf1'), mk('wf2'), mk('wf3')].map((r, i) => ({ ...r, id: `row${i}`, lastSeen: NOW.toISOString() })) }, h);
  const got = hintsForRun({ home: h, spec: { job: 'brand-new', inputs: [{ value: '~/in/a.csv' }] }, specHash: null, now: NOW });
  assert.ok(got && got.text.startsWith(HINT_HEADER) && /\[this place, seen/.test(got.text), 'the prose path climbs to the place the run recorded');
});

test('a trailing slash and a dot segment are one place', () => {
  assert.equal(resolvePlace('/a/b/'), resolvePlace('/a/./b'));
});
