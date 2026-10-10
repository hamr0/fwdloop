// M4e amendment 43: say what changed. At sign a write-once copy of the two signed files is kept in signed/; when the files are edited later
// the refusal names the change in plain words (not just the file). Every kind of change has its own test.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync, rmSync, existsSync, readdirSync, symlinkSync, mkdirSync } from 'node:fs';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { writeFlow, readFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const fixture = (n) => readFileSync(path.join(HERE, 'fixtures', n), 'utf8');
const CAT = loadCatalogue().primitives;
const PROSE = fixture('job1.m1.signed.txt');
const DECL = JSON.parse(fixture('job1.m1.declaration.json'));

function signed() {
  const root = mkdtempSync(path.join(tmpdir(), 'fwdloop-am43-'));
  const w = writeFlow({ root, name: 'f', proseText: PROSE, declaration: DECL, signedBy: 'hamr', signedAt: '2026-10-10T12:00:00Z', catalogue: CAT });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  return { root, dir: w.dir };
}
const read = (root) => readFlow({ root, name: 'f', catalogue: CAT });
/** edit prose.txt on disk by replacing `a` with `b`, return the refusal text */
function edit(a, b) {
  const x = signed();
  const p = path.join(x.dir, 'prose.txt');
  assert.ok(PROSE.includes(a), `fixture has "${a}"`);
  writeFileSync(p, PROSE.replace(a, b));
  const r = read(x.root);
  assert.equal(r.ok, false);
  return r.reds.join('\n');
}

test('sign keeps a write-once copy of both signed files; it changes no existing read', () => {
  const x = signed();
  assert.equal(readFileSync(path.join(x.dir, 'signed', 'prose.txt'), 'utf8'), PROSE);
  assert.deepEqual(readdirSync(path.join(x.dir, 'signed')).sort(), ['declaration.json', 'prose.txt']);
  assert.equal(read(x.root).ok, true);
  // write-once: signing into a folder that already has a signed/ is refused and the copy is untouched
  rmSync(path.join(x.dir, 'prose.txt')); rmSync(path.join(x.dir, 'declaration.json')); rmSync(path.join(x.dir, 'signature.json'));
  const again = writeFlow({ root: x.root, name: 'f', proseText: PROSE, declaration: DECL, signedBy: 'hamr', signedAt: '2026-10-10T12:00:00Z', catalogue: CAT });
  assert.equal(again.ok, false);
  assert.match(again.reds.join('\n'), /"signed" already exists/);
  assert.equal(readFileSync(path.join(x.dir, 'signed', 'prose.txt'), 'utf8'), PROSE);
});

test('an old flow (no signed/ copy) still reads, and a red says there is no copy to compare', () => {
  const x = signed();
  rmSync(path.join(x.dir, 'signed'), { recursive: true });
  assert.equal(read(x.root).ok, true, 'a flow signed before am43 reads exactly as before');
  writeFileSync(path.join(x.dir, 'prose.txt'), PROSE.replace('cap $0.25', 'cap $0.30'));
  const t = read(x.root).reds.join('\n');
  assert.match(t, /prose\.txt does not match its signed hash/, 'the file-level red is kept');
  assert.match(t, /signed before amendment 43: no copy to compare/);
});

test('a job line changed', () => assert.match(edit('2. then read the chat message', '2. then read the chat note'), /line 2 changed/));
test("a line's guardrail changed", () => {
  const t = edit('guardrail: every number must point', 'guardrail: every figure must point');
  assert.match(t, /line 3's guardrail changed/);
  assert.doesNotMatch(t, /line 3 changed/);
});
test('a line removed', () => assert.match(edit('2. then read the chat message and work out which customer it is about.\n   guardrail: if more than one customer matches, ask me, do not pick\n', ''), /line 2 was removed/));
test('a prose edit that no longer parses is named with why', () => assert.match(edit('6. and send it once I accept.\n', ''), /no longer reads as a signed job \(.*line 6/));
test('a line added', () => assert.match(edit('6. and send it once I accept.\n', '6. and send it once I accept.\n7. then tidy up.\n'), /line 7 was added/));
test('the cap changed', () => assert.match(edit('cap $0.25', 'cap $0.30'), /the cap changed \(from \$0\.25 to \$0\.3\)/));
test("an ask's wait changed", () => assert.match(edit('5. ask: check', '5. ask 10m: check'), /the wait of the ask at line 5 changed \(from 30m to 10m\)/));
test('the send destination changed', () => assert.match(edit('to file:poc/m0/out', 'to file:poc/m0/elsewhere'), /the send destination at line 6 changed/));
test('an input changed', () => assert.match(edit('aging.csv', 'other.csv'), /the input "aging" changed/));
test('the redo cap changed', () => assert.match(edit('guardrail: cap $0.25 per run', 'guardrail: cap $0.25 per run\nguardrail: redo cap 2'), /the redo cap changed \(from 3 to 2\)/));
test('the plan changed (declaration.json)', () => {
  const x = signed();
  const d = JSON.parse(readFileSync(path.join(x.dir, 'declaration.json'), 'utf8'));
  d.steps[0].goal = `${d.steps[0].goal} (edited)`;
  writeFileSync(path.join(x.dir, 'declaration.json'), JSON.stringify(d, null, 2));
  const t = read(x.root).reds.join('\n');
  assert.match(t, /the plan changed/);
  assert.doesNotMatch(t, /line \d+/, 'prose unchanged: no line named');
});
test('a spacing-only edit is named, never dropped', () => assert.match(edit('1. When', '1.  When'), /prose\.txt changed in wording or spacing/));

test("a copy that does not match the signature is never compared against", () => {
  const x = signed();
  writeFileSync(path.join(x.dir, 'signed', 'prose.txt'), PROSE.replace('cap $0.25', 'cap $9.99')); // tampered copy
  writeFileSync(path.join(x.dir, 'prose.txt'), PROSE.replace('cap $0.25', 'cap $0.30'));
  const t = read(x.root).reds.join('\n');
  assert.match(t, /can't be trusted to compare/);
  assert.doesNotMatch(t, /the cap changed/, 'no comparison made against an untrusted copy');
});

test('a symlinked copy is refused, not followed', () => {
  const x = signed();
  rmSync(path.join(x.dir, 'signed', 'prose.txt'));
  const other = path.join(x.root, 'elsewhere.txt'); writeFileSync(other, PROSE);
  symlinkSync(other, path.join(x.dir, 'signed', 'prose.txt'));
  writeFileSync(path.join(x.dir, 'prose.txt'), PROSE.replace('cap $0.25', 'cap $0.30'));
  assert.match(read(x.root).reds.join('\n'), /can't be trusted to compare/);
});

// --- the panel doors say what changed, not only "does not pass its checks" ---
import { mkdirSync as mkdir2 } from 'node:fs';
import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();

test('the panel run door and the resume door say what changed in the signed files', async () => {
  const w = await world();
  const a = await w.signedFlow();
  const p = path.join(a.flowDir, 'prose.txt');
  writeFileSync(p, readFileSync(p, 'utf8').replace(/cap \$[0-9.]+/, 'cap $0.77'));
  const run = await w.post('/api/author/run', { flow: 'job2', inputs: w.inputs(), runId: 'r1' });
  assert.equal(run.status, 400);
  assert.match(run.json().refusals[0].say, /the cap changed/);
  mkdir2(path.join(a.flowDir, 'runs', 'r1'), { recursive: true });
  const res = await w.post('/api/author/resume-prepare', { flow: 'job2', runId: 'r1', capUsd: '0.05' });
  assert.equal(res.status, 400);
  assert.match(res.json().say, /the cap changed/);
});
