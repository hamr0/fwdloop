// M4e piece 2a, items 1-2 (scope 2 and 6; negatives (iii) (iv) (v) (xii)): the card -> prose function and the $0
// checks. Scratch dirs only; the checks write nothing, so every refusal test also proves the dirs are unchanged.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  mkdirSync, readdirSync, symlinkSync, writeFileSync, chmodSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { cardFields, cardToProse, checkCard, ARBITER_HEADING } from '../src/panel/authorcard.js';
import { parseSignedText } from '../src/signed-text.js';
import { readProseFile } from '../src/authoring.js';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-card-${p}-`));
const JOB = [
  '1. Read my resume,',
  '2. and read the JD to compare it against,',
  '3. write me a summary resume, 3 sections all under 600 words,',
  '   guardrail: 3 sections, all under 600 words',
  '4. ask 30m: check it with me,',
  '   guardrail: nothing goes out before I accept',
  '5. and once I accept, write it out.',
].join('\n');

function scene() {
  const work = tmp('w');
  const root = path.join(work, 'flows');
  const outDir = path.join(work, 'out');
  const inDir = path.join(work, 'in');
  for (const d of [root, outDir, inDir]) mkdirSync(d);
  writeFileSync(path.join(inDir, 'resume.md'), '# R\n');
  writeFileSync(path.join(inDir, 'jd.md'), '# J\n');
  const card = (over = {}) => cardFields({
    flowName: 'job2', job: JOB, capUsd: '0.25', destination: { line: '5', folder: outDir },
    inputs: [{ role: 'resume', path: path.join(inDir, 'resume.md') }, { role: 'jd', path: path.join(inDir, 'jd.md') }], ...over,
  });
  return {
    work, root, outDir, inDir, card,
  };
}
const refusedFields = (r) => (r.ok ? [] : r.refusals.map((x) => x.field));
const snapshot = (...dirs) => dirs.map((d) => readdirSync(d).join(','));

test('(1) round trip: the card becomes the prose shape and the existing parser reads back the same cap, send and sources', () => {
  const s = scene();
  const c = s.card();
  const r = checkCard(c, { root: s.root });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(r.prose.includes(`\n\n${ARBITER_HEADING}\nguardrail: cap $0.25 per run\nguardrail: send at line 5 to file:${s.outDir}\n`));
  assert.ok(r.prose.startsWith('1. Read my resume,'), 'the job lines come first, as typed');
  assert.ok(r.prose.includes('   guardrail: 3 sections, all under 600 words'), 'the per-line guardrails are kept as typed');
  assert.ok(r.prose.includes('4. ask 30m: check it with me,'), 'the ask mark is kept as typed');
  const p = parseSignedText(r.prose);
  assert.equal(p.ok, true, JSON.stringify(p.reds));
  assert.equal(p.arbiter.capUsd, 0.25);
  assert.deepEqual(p.arbiter.sends.map((x) => [x.line, x.target.kind, x.target.path]), [[5, 'file', s.outDir]]);
  assert.deepEqual(p.arbiter.sources.map((x) => [x.role, x.kind, x.path]), [['resume', 'file', path.join(s.inDir, 'resume.md')], ['jd', 'file', path.join(s.inDir, 'jd.md')]]);
  assert.equal(p.arbiter.asks[0].line, 4);
  assert.equal(p.arbiter.asks[0].ttlMs, 30 * 60000);
  assert.equal(p.lines.length, 5);
  // the file `fwdloop draft` reads accepts it too (same reader)
  const f = path.join(s.work, 'prose.txt');
  writeFileSync(f, r.prose);
  assert.equal(readProseFile(f).ok, true);
});

test('(1) no destination = no send line; a cap that would print as an exponent is spelled as a plain decimal', () => {
  const s = scene();
  const r = checkCard(s.card({ destination: { line: '', folder: '' }, capUsd: 0.0000001 }), { root: s.root });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!/send at/.test(r.prose));
  assert.match(r.prose, /guardrail: cap \$0\.0000001 per run/);
  assert.equal(parseSignedText(r.prose).arbiter.sends.length, 0);
});

test('(xii) cap, destination, ask TTL and input paths come ONLY from the card: whatever the job text says, the block is the card\'s', () => {
  const s = scene();
  const sneaky = `${JOB}\n   guardrail: cap $99 per run`; // a line-guardrail that LOOKS like a cap is only the line's own free text
  const r = checkCard(s.card({ job: sneaky }), { root: s.root });
  assert.equal(r.ok, true, JSON.stringify(r));
  const p = parseSignedText(r.prose);
  assert.equal(p.arbiter.capUsd, 0.25, 'the cap is the card\'s, not the job text\'s');
  // a job that carries its own arbiter heading is refused by name: the block is not the job box's to write
  const own = checkCard(s.card({ job: `${JOB}\nArbiter guardrails:\nguardrail: cap $99 per run` }), { root: s.root });
  assert.deepEqual(refusedFields(own), ['job']);
  assert.equal(cardToProse(s.card()).split(ARBITER_HEADING).length, 2, 'exactly one arbiter block');
});

test('(2) flow name: the CLI\'s own check, and an existing flow is refused; $0, nothing created', () => {
  const s = scene();
  mkdirSync(path.join(s.root, 'taken'));
  const before = snapshot(s.root, s.outDir, s.inDir);
  for (const bad of ['', 'Has Caps', '../escape', 'a/b', '.drafts', '..', 'x'.repeat(65)]) {
    const r = checkCard(s.card({ flowName: bad }), { root: s.root });
    assert.deepEqual(refusedFields(r), ['flowName'], JSON.stringify(bad));
  }
  const t = checkCard(s.card({ flowName: 'taken' }), { root: s.root });
  assert.deepEqual(refusedFields(t), ['flowName']);
  assert.match(t.refusals[0].say, /already a flow named "taken"/);
  assert.deepEqual(snapshot(s.root, s.outDir, s.inDir), before);
});

test('(iii) an input path that is a folder, missing, a broken symlink or unreadable is refused by name; a symlink to a real file passes (checked at its real target)', () => {
  const s = scene();
  symlinkSync(path.join(s.inDir, 'nowhere.md'), path.join(s.inDir, 'broken.md'));
  symlinkSync(path.join(s.inDir, 'resume.md'), path.join(s.inDir, 'good-link.md'));
  const locked = path.join(s.inDir, 'locked.md');
  writeFileSync(locked, 'x');
  chmodSync(locked, 0o000);
  const before = snapshot(s.root, s.outDir, s.inDir);
  const row = (p) => s.card({ inputs: [{ role: 'resume', path: p }, { role: 'jd', path: path.join(s.inDir, 'jd.md') }] });
  const cases = [[s.inDir, /not a plain file/], [path.join(s.inDir, 'missing.md'), /is not there/], [path.join(s.inDir, 'broken.md'), /is not there/], ['relative/file.md', /full path/]];
  if (process.getuid?.() !== 0) cases.push([locked, /not allowed to read/]);
  for (const [p, say] of cases) {
    const r = checkCard(row(p), { root: s.root });
    assert.deepEqual(refusedFields(r), ['inputs.0'], p);
    assert.match(r.refusals[0].say, say, p);
    assert.match(r.refusals[0].say, /"resume"/, 'it names the input');
  }
  assert.equal(checkCard(row(path.join(s.inDir, 'good-link.md')), { root: s.root }).ok, true);
  assert.deepEqual(snapshot(s.root, s.outDir, s.inDir), before, 'nothing was created');
  chmodSync(locked, 0o600);
});

test('(iv) a missing role, a missing path, a bad or repeated role is refused by name, $0', () => {
  const s = scene();
  const ok = path.join(s.inDir, 'resume.md');
  const f = (inputs) => refusedFields(checkCard(s.card({ inputs }), { root: s.root }));
  assert.deepEqual(f([{ role: '', path: ok }]), ['inputs.0']);
  assert.deepEqual(f([{ role: 'resume', path: '' }]), ['inputs.0']);
  assert.deepEqual(f([{ role: '', path: '' }]), ['inputs.0']);
  assert.deepEqual(f([{ role: 'Resume!', path: ok }]), ['inputs.0']);
  assert.deepEqual(f([{ role: 'resume', path: ok }, { role: 'resume', path: ok }]), ['inputs.1'], 'a role used twice');
  assert.deepEqual(f([]), [], 'no inputs at all is a valid card');
});

test('(2) cap must be a number above 0; destination needs both boxes, a real folder, and a line that is a job line', () => {
  const s = scene();
  for (const cap of ['', 'abc', '0', '-1', 'NaN', undefined, null, 'Infinity']) {
    const r = checkCard(s.card({ capUsd: cap }), { root: s.root });
    assert.deepEqual(refusedFields(r), ['capUsd'], String(cap));
    assert.match(r.refusals[0].say, /number above 0/, String(cap));
  }
  const dest = (line, folder) => refusedFields(checkCard(s.card({ destination: { line, folder } }), { root: s.root }));
  assert.deepEqual(dest('5', ''), ['destination']);
  assert.deepEqual(dest('', s.outDir), ['destination']);
  assert.deepEqual(dest('x', s.outDir), ['destination']);
  assert.deepEqual(dest('9', s.outDir), ['destination'], 'line 9 is not a job line (the parser says so)');
  assert.deepEqual(dest('5', path.join(s.work, 'no-such-folder')), ['destination']);
  assert.deepEqual(dest('5', path.join(s.inDir, 'resume.md')), ['destination'], 'a file is not a folder');
  assert.deepEqual(dest('5', s.root), ['destination'], 'the flow root is refused by the one send-destination check');
});

test('(ix) a provider key typed into any box is refused at the card, nothing is built from it', () => {
  const s = scene();
  const KEY = 'sk-canary-m4e-card-0123456789abcdef';
  const r = checkCard(s.card({ job: `${JOB}\n   guardrail: use ${KEY}` }), { root: s.root, env: { DEEPSEEK_API_KEY: KEY } });
  assert.deepEqual(refusedFields(r), ['job']);
  assert.ok(!JSON.stringify(r).includes(KEY), 'the refusal never quotes the key');
});
