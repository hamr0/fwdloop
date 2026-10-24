// borrowed-from: bareloop tests/learn-cards.test.js@v0.46.0 (8b3d815)
// Cross-run learnings, part 1: cards from a run's own record (ITEM33-BUILD.md rev 2, section 2).
// Real archived spines (tests/fixtures/learn), never authored ones; a test that edits a record says so.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCards, ALLOWED_KINDS, errorKinds, flaggedTokens, quoteLines, cardKey, cleanText } from '../src/learn.js';
import { FIX, loadRun, cardsOf } from './m8-learn-fixtures.js';

// questions (stageQuestionsByName) and TYPES_GENRE are bareloop wiring, not copied: the tests that need them are skipped below
const spec = JSON.parse(readFileSync(join(FIX, 'mvk2e4uy-spec.json'), 'utf8'));

test('mvk2e4uy: the typecheck red fixed on the 2nd try becomes one FIXED card, every field copied from the record', { skip: 'needs bareloop stagewords.js / TYPES_GENRE (wiring), not copied' }, () => {
  const r = loadRun('mvk2e4uy');
  const b = cardsOf('mvk2e4uy', { spec, questions });
  assert.equal(b.noise, null);
  assert.equal(b.cards.length, 1);
  const c = b.cards[0];
  assert.equal(c.kind, 'FIXED');
  assert.equal(c.job, 'pulselog-panel-strict');
  assert.equal(c.check, 'typecheck-target-zero-errors');
  assert.deepEqual(c.kinds, ['TS1003', 'TS2339']);
  assert.equal(c.model, 'deepseek-flash');
  assert.equal(c.date, '2026-10-22');
  assert.equal(c.meaning, 'src/checks.js has 0 type errors?', 'the code-owned catalogue sentence, never model text');
  assert.equal(c.stepId, 'final-strict-clean-and-tests');
  assert.match(c.stepAction ?? '', /^This is the final step and it owns the whole goal/);
  assert.equal(c.ended, 'green');
  assert.equal(c.nextCheck, 'no-suppressions', 'what came next: the next failing check');
  // It said: the arbiter's own lines, paths/prefixes stripped, at most 3
  assert.ok(c.said.length >= 1 && c.said.length <= 3);
  assert.ok(c.said.every((l) => !l.startsWith('close:') && !l.includes('/home/')), JSON.stringify(c.said));
  assert.match(c.said[0], /error TS2339: Property 'killed'/);
  // Fix touched + What changed: the PASSING try (iteration 2, seq 125), not the failing one (iteration 1, seq 102)
  assert.deepEqual(c.fixTouched, ['src/checks.js']);
  const passing = r.events.find((e) => e.type === 'attempt-diff' && e.seq === 125);
  const failing = r.events.find((e) => e.type === 'attempt-diff' && e.seq === 102);
  assert.equal(c.whatChanged?.files[0].diff, passing.files[0].diff);
  assert.notEqual(c.whatChanged?.files[0].diff, failing.files[0].diff);
  // the key: one line, no line numbers
  assert.equal(c.key, cardKey(c));
  assert.ok(!c.key.includes('\n'));
  assert.doesNotMatch(c.key, /\.js:\d|\(\d+,\d+\)/);
  assert.match(c.key, /card=mvk2e4uy:typecheck-target-zero-errors:fixed job=pulselog-panel-strict .* run=mvk2e4uy date=2026-10-22/);
});

test('Fix touched is the PASSING try only: the failing try before it is not folded in', () => {
  // the record is edited: the failing try's diff (seq 102) is moved to another file, and so is its audit row
  const r = loadRun('mvk2e4uy');
  const bad = r.events.find((e) => e.type === 'attempt-diff' && e.seq === 102);
  bad.files[0].path = 'src/other.js';
  const b = buildCards({ runid: 'mvk2e4uy', events: r.events, audit: [], workdir: r.workdir });
  assert.deepEqual(b.cards[0].fixTouched, ['src/checks.js']);
});

test('mvk2e4uy: the no-suppressions red sits on a PROSE comment, so it is CHECK-SUSPECT: listed, never a card', { skip: 'needs bareloop stagewords.js / TYPES_GENRE (wiring), not copied' }, () => {
  const b = cardsOf('mvk2e4uy', { spec, questions });
  assert.deepEqual(b.suspect.map((c) => c.check), ['no-suppressions']);
  assert.ok(!b.cards.some((c) => c.check === 'no-suppressions'));
  // the GREEN side of the same rule: put the hit in a JSDoc type position and it is an ordinary card.
  // (the record is edited here — every other byte is the archived one)
  const r = loadRun('mvk2e4uy');
  const oc = r.events.find((e) => e.type === 'outer-close');
  oc.gap = oc.gap.replace('* Escape hatch: any command that exits 0 is healthy.', '* @param {{ any: string }} opts');
  const b2 = buildCards({ runid: 'mvk2e4uy', events: r.events, audit: r.audit, workdir: r.workdir, questions });
  assert.equal(b2.suspect.length, 0);
  assert.ok(b2.cards.some((c) => c.check === 'no-suppressions' && c.kind === 'FIXED'));
});

test('a run set aside as noise yields no card: provider-red, and a close that never spoke', () => {
  const a = cardsOf('battery-A3-mrnepkvq');
  assert.equal(a.noise, 'provider-red');
  assert.equal(a.cards.length, 0);
  const b = cardsOf('l2poc-B3-mrugee8z');
  assert.equal(b.noise, 'no-close-spoke');
  assert.equal(b.cards.length, 0);
  // a run with no job-end is not a run the learner may read
  const r = loadRun('mvk2e4uy');
  assert.equal(buildCards({ runid: 'x', events: r.events.filter((e) => e.type !== 'job-end') }).noise, 'no-job-end');
});

test('mshcpdg4: a typecheck red still failing at run end is a NEVER FIXED card; M8 am3: a NEVER FIXED card with no kind and no fix files is kept, not TOO-THIN', () => {
  const b = cardsOf('mshcpdg4');
  const stuck = b.cards.filter((c) => c.kind === 'NEVER_FIXED');
  // am3: bareloop dropped the thin `tree-changed` NEVER FIXED card (thin 1); fwdloop keeps it
  assert.deepEqual(stuck.map((c) => [c.check, c.kinds]), [['typecheck', ['TS2322']], ['tree-changed', ['other']]]);
  assert.equal(stuck[0].whatChanged, null, 'a never-fixed card has no passing try, so no What changed');
  assert.equal(b.thin, 0, 'am3: thin counts FIXED cards only; a NEVER FIXED card is never thin');
  // a FIXED `tree-changed` (kind other) is kept only because the audit names the files the passing try wrote
  const withAudit = cardsOf('mties136');
  // (am3: the run's NEVER FIXED `suite-green` card, thin, is kept too; before am3 it was counted in `thin`)
  assert.deepEqual(withAudit.cards.map((c) => [c.check, c.fixTouched.length > 0]), [['tree-changed', true], ['suite-green', false]]);
  assert.equal(withAudit.thin, 0);
  const noAudit = cardsOf('mties136', { audit: [] });
  assert.deepEqual(noAudit.cards.map((c) => [c.kind, c.check]), [['NEVER_FIXED', 'suite-green']], 'same record, no written files: the FIXED card is thin and dropped; the NEVER FIXED one stays');
  assert.equal(noAudit.thin, 1, 'only the FIXED card is counted thin');
});

test('a RUBRIC job: the writes to output/steps/<n>.json are read (the POC read none)', () => {
  const b = cardsOf('mvh72jo0');
  assert.equal(b.cards.length, 1);
  const c = b.cards[0];
  assert.equal(c.kind, 'FIXED');
  assert.equal(c.check, 'line-1-three-flights');
  assert.deepEqual(c.fixTouched, ['output/steps/1.json'], 'a rubric job writes outside src/: the card must still name the file');
  assert.equal(b.thin, 0, 'with no written file the same card would have been dropped as too thin');
  // and an attempt-diff of the fenced output file is read just as well (the record is edited: the diff event is added)
  const r = loadRun('mvh72jo0');
  const add = { type: 'attempt-diff', phase: 'step:write-flights-step-1', step: 'write-flights-step-1', iteration: 9, files: [{ path: 'output/steps/1.json', diff: '+{"ok":1}\n', truncated: false }], binary: [], truncated: false };
  const passIdx = r.events.findLastIndex((e) => e.type === 'check-run' && e.verdict === 'satisfied');
  const events = [...r.events.slice(0, passIdx), add, ...r.events.slice(passIdx)];
  const b2 = buildCards({ runid: 'mvh72jo0', events, audit: [], workdir: r.workdir });
  assert.deepEqual(b2.cards[0].fixTouched, ['output/steps/1.json']);
  assert.equal(b2.cards[0].whatChanged?.files[0].diff, '+{"ok":1}\n');
});

test('a resumed run (two legs, one id): a red in leg 1 fixed in leg 2 is one FIXED card', { skip: 'needs bareloop stagewords.js / TYPES_GENRE (wiring), not copied' }, () => {
  const r = loadRun('mvk2e4uy');
  const redIdx = r.events.findIndex((e) => e.type === 'close-verdict' && e.verdict === 'needs_revision' && /typecheck-target-zero-errors/.test(e.gap ?? ''));
  const events = [...r.events.slice(0, redIdx + 1), { type: 'leg-resume', leg: 2, after: 'died', seq: 999, ts: '2026-10-22T21:43:30.000Z' }, ...r.events.slice(redIdx + 1)];
  const b = buildCards({ runid: 'mvk2e4uy', events, audit: r.audit, workdir: r.workdir, questions });
  assert.equal(b.cards.length, 1);
  assert.equal(b.cards[0].kind, 'FIXED');
});

test('a secret in the person\'s repo is masked on the card (an append-only record must never hold it)', () => {
  const token = `ghp_${'a1B2c3D4e5F6g7H8i9J0'.repeat(2)}`;
  const r = loadRun('mvk2e4uy');
  // the record is edited: the token replaces the symbol name wherever the arbiter's words are recorded
  const events = JSON.parse(JSON.stringify(r.events).replaceAll("Property 'killed'", `Property '${token}'`));
  assert.ok(JSON.stringify(events).includes(token));
  const b = buildCards({ runid: 'mvk2e4uy', events, audit: r.audit, workdir: r.workdir });
  assert.match(b.cards[0].said[0], /Property '/, 'the edited line IS the card\'s first quoted line (so the test can fail)');
  assert.ok(!JSON.stringify(b).includes(token), 'the token must not survive anywhere on a card');
});

test('the error-kind extractor, on real quote shapes', () => {
  assert.deepEqual(errorKinds("src/a.js(1,2): error TS7006: Parameter 'x' implicitly has an 'any' type.").kinds, ['TS7006']);
  assert.deepEqual(errorKinds('close:   [cast] src/checks.js:143: const e = /** @type {X} */ (err);').kinds, ['[cast]']);
  assert.deepEqual(errorKinds('foo.py:3: error: Name "x" is not defined  [name-defined]').kinds, ['[name-defined]']);
  assert.deepEqual(errorKinds('nothing recognisable here').kinds, ['other']);
  // only the closed list of no-suppressions tags counts as a kind
  assert.deepEqual(errorKinds('close:   [bogus-tag] src/a.js:1: x').kinds, ['other']);
  assert.deepEqual(flaggedTokens("close:     src/checks.js(121,28): error TS2339: Property 'killed' does not exist"), ['does', 'exist', 'killed', 'not', 'property']);
  assert.deepEqual(quoteLines('close stage "x" failed:\nplain line\nsrc/a.js(1,2): error TS1: boom'), ['src/a.js(1,2): error TS1: boom'], 'lines with a path:line or a code come first');
});

test('the allowed kinds are exactly the no-suppressions ids of the TYPES genre (they cannot drift)', { skip: 'needs bareloop stagewords.js / TYPES_GENRE (wiring), not copied' }, () => {
  const ids = Object.values(TYPES_GENRE.languages).flatMap((l) => l.suppressions.map((s) => s.id));
  assert.deepEqual([...new Set(ids)].sort(), [...ALLOWED_KINDS].sort());
});

test('building the same run twice gives the same cards (a pure function of the record)', { skip: 'needs bareloop stagewords.js / TYPES_GENRE (wiring), not copied' }, () => {
  assert.deepEqual(cardsOf('mvk2e4uy', { spec, questions }), cardsOf('mvk2e4uy', { spec, questions }));
});

test('cleanText strips the patient and worktree prefixes in linear time: a 50000-character "/a/a/a/..." with no marker returns at once (the backtracking regexes took seconds)', () => {
  const t0 = performance.now();
  const long = '/a'.repeat(25000);
  assert.equal(cleanText(long, null), long);
  assert.equal(cleanText('/home/u/bareloop-patients/p1/src/a.js and /r/.bareloop/wt/s-1/b.js', null), 'src/a.js and /r/b.js');
  // a second prefix right after the first one's tail (the first ends at its "/") is still found
  assert.equal(cleanText('/bareloop-patients/x+/seg/bareloop-patients/y/z.js', null), 'segz.js');
  assert.ok(performance.now() - t0 < 300, `took ${performance.now() - t0} ms`);
});

test('errorKinds reads the files a quote names in linear time: a 50000-character run of path characters with no extension returns at once (the backtracking regex took seconds)', () => {
  const t0 = performance.now();
  assert.deepEqual(errorKinds('a'.repeat(50000)).files, []);
  assert.deepEqual(errorKinds('a/'.repeat(25000)).files, []);
  assert.deepEqual(errorKinds('see ./src/a.js, x/b.mjs and c.jsx').files, ['src/a.js', 'x/b.mjs']);
  assert.ok(performance.now() - t0 < 300, `took ${performance.now() - t0} ms`);
});
