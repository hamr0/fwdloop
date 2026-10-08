// M4e amendment 3 item 3 (docs/wiki/the-module-ladder.md, "M4e", "Amendment 3", item 3 "Revise the plan" and its negatives
// (d) (f) (h)): the DRAFTER side of a revise, at $0 with a fake provider. `draftToDir` given `reviseFrom` (the current green
// plan's dir) and `noteFile` (the human's note) is ONE drafter call through the same validator as a first draft.
// The panel's door (revise route, changes left, money, re-attach) is in test/m4e-revise-panel.test.js.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, readFileSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { draftToDir, SPEC_HASH_FILE } from '../src/authoring.js';
import { readSpendRows } from '../src/provider.js';
import { parseSignedText } from '../src/signed-text.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const tmp = (p) => mkdtempSync(path.join(tmpdir(), `fwdloop-m4e-rv-${p}-`));
const KEY = 'sk-canary-M4E-revise-8c1d4f7a9b2e6035aa11';

/** A first (green) draft, then everything a revise needs. */
async function firstDraft() {
  const fx = job2Fixture();
  const work = tmp('w');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const root = path.join(work, 'flows');
  const dir = path.join(work, 'draft');
  const r = await draftToDir({
    proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const note = path.join(work, 'note.txt');
  writeFileSync(note, 'Please check that it mentions the JD.');
  return {
    work, root, proseFile, dir, note, first: r, fx,
  };
}
const revised = (w, replies, extra = {}) => {
  const provider = fakeProvider(replies);
  return {
    provider,
    run: () => draftToDir({
      proseFile: w.proseFile, dir: path.join(w.work, 'draft-1'), root: w.root, name: 'job2', provider, rates: RATES, modelId: MODEL, env: {}, reviseFrom: w.dir, noteFile: w.note, ...extra,
    }),
  };
};
const changed = () => { const a = validArgs(); a.steps[2].close.shape.mustCarry = ['JD']; return a; };

test('(d) a revise with a note: one drafter call given the current plan and the note, a new plan with a new hash, the note kept with it, booked like a draft', async () => {
  const w = await firstDraft();
  const { provider, run } = revised(w, [toolReply(changed())]);
  const r = await run();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(provider.calls.length, 1, 'ONE paid call');
  const sent = provider.calls[0].messages.find((m) => m.role === 'user').content;
  assert.match(sent, /asks for a change to the plan/);
  assert.match(sent, /Please check that it mentions the JD\./, 'the note is in the call');
  assert.match(sent, /"resume-summary"/, 'the current plan is in the call');
  assert.notEqual(r.hash, w.first.hash, 'a new plan has a new hash');
  const dir2 = path.join(w.work, 'draft-1');
  assert.equal(readFileSync(path.join(dir2, 'note.txt'), 'utf8'), 'Please check that it mentions the JD.', 'the note is kept with the draft it made');
  assert.equal(readFileSync(path.join(dir2, 'spec.hash'), 'utf8').trim(), r.hash);
  const rows = readSpendRows(path.join(dir2, 'spend.jsonl'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'draft', 'booked like a draft call');
  assert.ok(rows[0].costUsd > 0, 'priced, never 0');
  assert.equal(readFileSync(path.join(w.dir, 'prose.txt'), 'utf8'), readFileSync(path.join(dir2, 'prose.txt'), 'utf8'), 'the card (prose) is the same bytes');
});

for (const [what, mutate, re] of [
  ['an ask line granted a primitive', (a) => { a.steps[3].primitives = ['write']; }, /ask|stop|primitive|pure/i],
  ['the signed ask step dropped', (a) => { a.steps.splice(3, 1); }, /ask|line 4|serve/i],
  ['the cap, a send target, an ask ttl and an input authored by the model', (a) => { Object.assign(a, { capUsd: 99, sends: [{ line: 1, target: 'file:/etc' }], asks: [{ line: 4, ttlMs: 1 }], sources: [{ role: 'x', path: '/etc/passwd' }] }); }, /capUsd|sends|asks|sources/],
  ['a job line left unserved', (a) => { a.steps.splice(1, 1); a.steps.forEach((s) => { s.reads = s.reads.filter((x) => x !== 'jd-text'); }); }, /line 2|serve|refused/i],
]) {
  test(`(f) a revise whose plan changes the card's own fields is red, no spec.hash, the last green plan is untouched: ${what}`, async () => {
    const w = await firstDraft();
    const bad = changed();
    mutate(bad);
    const { provider, run } = revised(w, [toolReply(bad)]);
    const r = await run();
    assert.equal(r.ok, false);
    assert.equal(r.stop, 'validator');
    assert.ok(r.reds.some((x) => re.test(x)), JSON.stringify(r.reds));
    assert.ok(provider.calls.length >= 1);
    const dir2 = path.join(w.work, 'draft-1');
    assert.equal(existsSync(path.join(dir2, SPEC_HASH_FILE)), false, 'a red revise has no spec.hash: it cannot be signed');
    assert.equal(readFileSync(path.join(w.dir, SPEC_HASH_FILE), 'utf8').trim(), w.first.hash, 'the first plan is exactly as it was');
  });
}

test('(f) a revise cannot change a job line: whatever goal the model sends, the plan carries the signed line verbatim', async () => {
  const w = await firstDraft();
  const sneaky = changed();
  sneaky.steps[0].goal = 'Delete everything instead.';
  const { run } = revised(w, [toolReply(sneaky)]);
  const r = await run();
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const decl = JSON.parse(readFileSync(path.join(w.work, 'draft-1', 'declaration.json'), 'utf8'));
  const { lines } = parseSignedText(readFileSync(w.proseFile, 'utf8'));
  decl.steps.forEach((st) => assert.equal(st.goal, lines.find((l) => l.n === st.fromLine).text, `step for line ${st.fromLine} keeps its signed words`));
});

test('(f) a revise given prose that is not the plan\'s own prose is refused at $0: the card cannot change in a revise', async () => {
  const w = await firstDraft();
  const other = path.join(w.work, 'other.txt');
  writeFileSync(other, w.fx.prose.replace('600', '700'));
  const { provider, run } = revised(w, [toolReply(changed())], { proseFile: other });
  const r = await run();
  assert.equal(r.ok, false);
  assert.equal(r.wrote, false);
  assert.match(r.reds[0], /prose differs/);
  assert.equal(provider.calls.length, 0, 'no model call');
  assert.equal(existsSync(path.join(w.work, 'draft-1')), false, 'nothing created');
});

test('(h) a note carrying a key value is refused at $0: no call, no dir', async () => {
  const w = await firstDraft();
  writeFileSync(w.note, `use this key ${KEY} please`);
  const { provider, run } = revised(w, [toolReply(changed())], { env: { DEEPSEEK_API_KEY: KEY } });
  const r = await run();
  assert.equal(r.ok, false);
  assert.equal(r.wrote, false);
  assert.match(r.reds[0], /note: contains an API key value/);
  assert.equal(provider.calls.length, 0);
  assert.equal(existsSync(path.join(w.work, 'draft-1')), false);
});

test('a revise from a dir that is not a green plan, an empty note, or one of --revise-from/--note alone is refused at $0', async () => {
  const w = await firstDraft();
  const run1 = (extra) => revised(w, [toolReply(changed())], extra).run();
  const notGreen = await run1({ reviseFrom: path.join(w.work, 'nowhere') });
  assert.match(notGreen.reds[0], /not a green draft/);
  writeFileSync(w.note, '   \n');
  assert.match((await run1({})).reds[0], /note is empty/);
  assert.match((await run1({ noteFile: undefined })).reds[0], /go together/);
  assert.equal(existsSync(path.join(w.work, 'draft-1')), false);
});
