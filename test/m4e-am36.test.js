// M4e amendment 36: at sign the drafter's "Not checked" list is written once into the sign row of the flow's setup.jsonl, word for word with
// its label; not signed, not in the hash. $0, fake provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { draftToDir, signDraft } from '../src/authoring.js';
import { readSetup } from '../src/setup.js';
import { NOT_CHECKED_LABEL } from '../src/checked.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

/** A CLI-shaped draft: one plan folder, no session folder. */
async function cliDraft(notChecked) {
  const fx = job2Fixture();
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-am36-'));
  const root = path.join(work, 'flows');
  const dir = path.join(work, 'plan');
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const args = validArgs();
  if (notChecked) args.notChecked = notChecked;
  const r = await draftToDir({
    proseFile, dir, root, name: 'job2', provider: fakeProvider([toolReply(args)]), rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  return { root, dir, r };
}
const sign = (d) => signDraft({
  dir: d.dir, approve: d.r.hash, signedBy: 'hamr', signedAt: '2026-10-09T12:00:00.000Z', env: {},
});
const signRow = (d) => readSetup(path.join(d.root, 'job2')).rows.find((x) => x.kind === 'sign');

// M17 am4 (C1) / am5 (D3): the AI's own notes are dropped; the sign row carries the list's Not checked lines, here the one ~ rule on the job's Ask line
const ASK_RULE_LINE = 'not checked \u00b7 "nothing goes out before I accept" \u2014 you judge it at the Ask';

test('the sign row carries notChecked {label, items} word for word; an AI note is not in it', async () => {
  const d = await cliDraft(['whether the tone suits the reader', '  the JD match  ']);
  const s = sign(d);
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  assert.deepEqual(signRow(d).notChecked, {
    label: NOT_CHECKED_LABEL,
    items: [ASK_RULE_LINE],
    by: { [ASK_RULE_LINE]: 'you' },
  });
});

test('a draft whose list has only the Ask line\'s rule records the label and that one line', async () => {
  const d = await cliDraft(null);
  assert.equal(sign(d).ok, true);
  assert.deepEqual(signRow(d).notChecked, { label: NOT_CHECKED_LABEL, items: [ASK_RULE_LINE], by: { [ASK_RULE_LINE]: 'you' } });
});

test('"Not checked" is not signed: editing it after the draft does not break the approved hash, and the signed files never carry it', async () => {
  const d = await cliDraft(['one thing']);
  writeFileSync(path.join(d.dir, 'not-checked.json'), JSON.stringify({ notChecked: ['a different thing'] }));
  const s = sign(d); // --approve is the draft's spec hash, taken before the edit
  assert.equal(s.ok, true, JSON.stringify(s.reds));
  assert.deepEqual(signRow(d).notChecked.items, ['a different thing']);
  for (const f of ['declaration.json', 'signature.json', 'prose.txt']) {
    assert.ok(!readFileSync(path.join(d.root, 'job2', f), 'utf8').includes('different thing'), `${f} never carries it`);
  }
});

test('an unreadable not-checked.json records an empty list, not a crash', async () => {
  const d = await cliDraft(['x']);
  writeFileSync(path.join(d.dir, 'not-checked.json'), 'not json');
  assert.equal(sign(d).ok, true);
  assert.deepEqual(signRow(d).notChecked.items, []);
});
