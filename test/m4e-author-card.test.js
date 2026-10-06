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
import { BOX_JOB, BOX_JOB_FILE, inputsText } from './m4e-box-fixture.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-card-${p}-`));
const JOB = BOX_JOB;

function scene() {
  const work = tmp('w');
  const root = path.join(work, 'flows');
  const outDir = path.join(work, 'out');
  const inDir = path.join(work, 'in');
  for (const d of [root, outDir, inDir]) mkdirSync(d);
  writeFileSync(path.join(inDir, 'resume.md'), '# R\n');
  writeFileSync(path.join(inDir, 'jd.md'), '# J\n');
  const card = (over = {}) => cardFields({
    flowName: 'job2', job: JOB, capUsd: '0.25', askWait: '1h', destination: outDir,
    inputs: inputsText([['resume', path.join(inDir, 'resume.md')], ['jd', path.join(inDir, 'jd.md')]]), ...over,
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
  const r = checkCard(s.card({ destination: '', capUsd: 0.0000001, job: 'Ask: is this ok?' }), { root: s.root }); // only an ask: it funds no model round, so no cap floor (amendment 4 item 2)
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.ok(!/send at/.test(r.prose));
  assert.match(r.prose, /guardrail: cap \$0\.0000001 per run/);
  assert.equal(parseSignedText(r.prose).arbiter.sends.length, 0);
});

test('(xii) cap, destination, ask TTL and input paths come ONLY from the card: whatever the job text says, the block is the card\'s', () => {
  const s = scene();
  const sneaky = `${JOB}\n~cap $99 per run`; // a line-guardrail that LOOKS like a cap is only the line's own free text
  const r = checkCard(s.card({ job: sneaky }), { root: s.root });
  assert.equal(r.ok, true, JSON.stringify(r));
  const p = parseSignedText(r.prose);
  assert.equal(p.arbiter.capUsd, 0.25, 'the cap is the card\'s, not the job text\'s');
  // a job that carries its own arbiter heading is refused by name: the block is not the job box's to write
  const own = checkCard(s.card({ job: `${JOB}\nArbiter guardrails:\n~cap $99 per run` }), { root: s.root });
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

test('(c) an input path that is a folder, missing, a broken symlink or unreadable is refused BY ITS LINE NUMBER; a symlink to a real file passes (checked at its real target)', () => {
  const s = scene();
  symlinkSync(path.join(s.inDir, 'nowhere.md'), path.join(s.inDir, 'broken.md'));
  symlinkSync(path.join(s.inDir, 'resume.md'), path.join(s.inDir, 'good-link.md'));
  const locked = path.join(s.inDir, 'locked.md');
  writeFileSync(locked, 'x');
  chmodSync(locked, 0o000);
  const before = snapshot(s.root, s.outDir, s.inDir);
  const row = (p) => s.card({ inputs: inputsText([['jd', path.join(s.inDir, 'jd.md')], ['resume', p]]) });
  const cases = [[s.inDir, /not a plain file/], [path.join(s.inDir, 'missing.md'), /is not there/], [path.join(s.inDir, 'broken.md'), /is not there/], ['relative/file.md', /full path/]];
  if (process.getuid?.() !== 0) cases.push([locked, /not allowed to read/]);
  for (const [p, say] of cases) {
    const r = checkCard(row(p), { root: s.root });
    assert.deepEqual(refusedFields(r), ['inputs'], p);
    assert.match(r.refusals[0].say, /^Line 2: /, `${p}: it names line 2`);
    assert.match(r.refusals[0].say, say, p);
    assert.match(r.refusals[0].say, /"resume"/, 'it names the input');
  }
  assert.equal(checkCard(row(path.join(s.inDir, 'good-link.md')), { root: s.root }).ok, true);
  assert.deepEqual(snapshot(s.root, s.outDir, s.inDir), before, 'nothing was created');
  chmodSync(locked, 0o600);
});

test('(c) an inputs line with no colon, a missing name or path, a bad or repeated name is refused by its line; blank lines are skipped and not numbered', () => {
  const s = scene();
  const ok = path.join(s.inDir, 'resume.md');
  const f = (inputs) => { const r = checkCard(s.card({ inputs }), { root: s.root }); return r.ok ? [] : r.refusals.map((x) => `${x.field}:${x.say.slice(0, 7)}`); };
  assert.deepEqual(f(`resume: ${ok}\nno colon here`), ['inputs:Line 2:']);
  assert.deepEqual(f(`: ${ok}`), ['inputs:Line 1:']);
  assert.deepEqual(f('resume:'), ['inputs:Line 1:']);
  assert.deepEqual(f(`Resume!: ${ok}`), ['inputs:Line 1:']);
  assert.deepEqual(f(`resume: ${ok}\n\n\nresume: ${ok}`), ['inputs:Line 2:'], 'a name used twice: the second line, counted without the blank lines');
  assert.deepEqual(f(''), [], 'no inputs at all is a valid card');
  assert.deepEqual(f(`\n  resume: ${ok}\n\n`), [], 'blank lines are dropped');
  assert.equal(cardToProse(s.card({ inputs: `\n  resume: ${ok}\n\n` })).split('guardrail: source').length, 2);
});

test('(2) cap must be a number above 0; the destination is one folder (never a line number)', () => {
  const s = scene();
  for (const cap of ['', 'abc', '0', '-1', 'NaN', undefined, null, 'Infinity']) {
    const r = checkCard(s.card({ capUsd: cap }), { root: s.root });
    assert.deepEqual(refusedFields(r), ['capUsd'], String(cap));
    assert.match(r.refusals[0].say, /number above 0/, String(cap));
  }
  const dest = (folder) => refusedFields(checkCard(s.card({ destination: folder }), { root: s.root }));
  assert.deepEqual(dest(path.join(s.work, 'no-such-folder')), ['destination']);
  assert.deepEqual(dest(path.join(s.inDir, 'resume.md')), ['destination'], 'a file is not a folder');
  assert.deepEqual(dest(s.root), ['destination'], 'the flow root is refused by the one send-destination check');
  assert.deepEqual(dest(''), [], 'empty = no send');
});

test('(d) a destination is sent at the LAST step and the prose says so; an empty destination writes no send line; the line is never typed', () => {
  const s = scene();
  const shorter = 'one\nAsk: ok?\n~a rule\nthree';
  const withDest = cardToProse(s.card({ job: shorter }));
  assert.match(withDest, new RegExp(`\\nguardrail: send at line 3 to file:${s.outDir.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\n`), 'last step = 3');
  assert.deepEqual(parseSignedText(withDest).arbiter.sends.map((x) => x.line), [3]);
  const longer = cardToProse(s.card({ job: `${shorter}\nfour\nfive` }));
  assert.match(longer, /guardrail: send at line 5 to /);
  assert.doesNotMatch(cardToProse(s.card({ destination: '' })), /send at/);
  // the last step cannot be the send step (no accepted ask before it): the plan checks refuse it on the Destination box, as today
  assert.deepEqual(refusedFields(checkCard(s.card({ job: 'one\ntwo' }), { root: s.root })), ['destination']);
  // a stale line number in the request body is ignored: only the folder is read
  assert.match(cardToProse(cardFields({ ...s.card(), destination: s.outDir, destinationLine: '2' })), /send at line 5 to/);
});

test('(e) an ask wait that is not a number with m or h is refused on the card, by its own box; a good one is written out on every default Ask', () => {
  const s = scene();
  for (const bad of ['', '1', 'h', '0h', '1d', '30s', '1.5h', 'soon', undefined]) {
    const r = checkCard(s.card({ askWait: bad }), { root: s.root });
    assert.deepEqual(refusedFields(r), ['askWait'], String(bad));
    assert.match(r.refusals[0].say, /number with m or h/);
  }
  const prose = cardToProse(s.card({ job: 'one\nAsk: is it right?\nAsk 5m: and now?\ntwo', askWait: '2H' }));
  assert.match(prose, /\n2\. ask 2h: is it right\?\n/, 'the default wait is written into the signed text');
  assert.match(prose, /\n3\. ask 5m: and now\?\n/);
  assert.equal(parseSignedText(prose).arbiter.asks.map((a) => a.ttlMs).join(), `${2 * 3600000},${5 * 60000}`);
});

test('(b) a ~ line before the first step is refused by its line, in a sentence; empty lines never become steps', () => {
  const s = scene();
  const r = checkCard(s.card({ job: '\n~too early\nstep one' }), { root: s.root });
  assert.deepEqual(refusedFields(r), ['job']);
  assert.match(r.refusals[0].say, /^Line 2 .*no step is above it/);
  assert.equal(cardToProse(s.card({ job: '\n\nstep one\n\n\nstep two\n\n' })).startsWith('1. step one\n2. step two\n\nArbiter guardrails'), true);
});

test('(a) the job box becomes exactly the job file the fixture has (numbers in order, ~ as guardrail under its step, Ask 30m with its own wait)', () => {
  const s = scene();
  const prose = cardToProse(s.card());
  assert.ok(prose.startsWith(`${BOX_JOB_FILE}\n\n${ARBITER_HEADING}\n`), prose);
});

test('(ix) a provider key typed into any box is refused at the card, nothing is built from it', () => {
  const s = scene();
  const KEY = 'sk-canary-m4e-card-0123456789abcdef';
  const r = checkCard(s.card({ job: `${JOB}\n~use ${KEY}` }), { root: s.root, env: { DEEPSEEK_API_KEY: KEY } });
  assert.deepEqual(refusedFields(r), ['job']);
  assert.ok(!JSON.stringify(r).includes(KEY), 'the refusal never quotes the key');
});
