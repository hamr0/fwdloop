// M19 am6 to am9 at the drafter (docs/wiki/the-module-ladder.md): the plan the drafter saves has its card rows read from the signed plan (src/checkrows.js), the draft's ledger rows in its own log,
// and its Not checked items in the words of am8 item 2 and am9. Stub providers, $0. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { draft } from '../src/drafter.js';
import { RATES, MODEL } from './drafter-fixture.mjs';
import { callOf, router } from './m16-drafter-fixture.mjs';
import { walkProse } from './m16-drafter-fixture.mjs';

const NONE = callOf('submit_edits', { edits: [] });
const LEDGER_NONE = callOf('suggest_extra_checks', { extra: [] });
const PICKS = [{ line: 3, rule: 1, check: { rule: 'listItems', value: 3 } }, { line: 5, rule: 1, check: { rule: 'maxWords', value: 80 } }];
const WALK = (/** @type {string} */ s) => s.replace('guardrail: exactly 3 bullets', 'guardrail: exactly 3 list items').replace('guardrail: under 80 words', 'guardrail: at most 80 words; be friendly');
const aiDecl = () => ({
  steps: [
    { primitives: ['read'], reads: [], emits: 's1', fromLine: 1, close: { class: 'hitl' } },
    { primitives: [], reads: ['s1'], emits: 'a2', fromLine: 2, close: { class: 'hitl' } },
    { primitives: ['read'], reads: [], emits: 's3', fromLine: 3, close: { class: 'hitl' } },
    { primitives: [], reads: ['s3'], emits: 'a4', fromLine: 4, close: { class: 'hitl' } },
    { primitives: ['read'], reads: [], emits: 's5', fromLine: 5, close: { class: 'hitl' } },
    { primitives: [], reads: ['s5'], emits: 'a6', fromLine: 6, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['a6'], emits: 'sent', fromLine: 7, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 3: 'green', 5: 'softgreen' }, unjudgeable: {}, refused: [],
});
const go = (/** @type {any} */ prose) => draft({ proseText: prose, provider: router({ suggest_extra_checks: LEDGER_NONE, submit_edits: NONE, emit_declaration: callOf('emit_declaration', aiDecl()) }), rates: RATES, modelId: MODEL, checkList: true, offerQuestions: false, checkPicks: PICKS });

test('am6 item 1, am7 item 2: the saved card\'s pick row reads its plain words, from the signed plan (no quotes, no "you agreed")', async (t) => {
  const r = await go(walkProse(t, WALK));
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  const row = r.checkCard.rows.find((/** @type {any} */ x) => x.key === 'L3.~1');
  assert.equal(row?.text, 'exactly 3 list items', 'break: build the card from the block\'s row copies (cardOfBlock alone) and this reds');
  assert.equal(row?.by, 'you');
});

test('am6 item 1: the saved card draws no Not checked row among a line\'s rows; its Not checked rows are a list of their own, named by am9 item 1', async (t) => {
  const r = await go(walkProse(t, WALK));
  assert.equal(r.checkCard.rows.some((/** @type {any} */ x) => x.state === 'not-checked'), false);
  const nc = r.checkCard.notChecked.find((/** @type {any} */ x) => x.line === 5);
  assert.ok(nc, JSON.stringify(r.checkCard.notChecked));
  assert.match(nc.text, /^line 5: "be friendly" — /);
});

test('am8 item 1, am9 item 5: the draft\'s own log holds one ledger row per Not checked row; a rule\'s words are its own text', async (t) => {
  const r = await go(walkProse(t, WALK));
  const ledger = r.log.filter((/** @type {any} */ x) => x.kind === 'ledger');
  const want = r.declaration.checkList.filter((/** @type {any} */ x) => x.state === 'not-checked' && x.kind !== 'floor');
  assert.ok(want.length >= 1);
  assert.deepEqual(ledger.map((/** @type {any} */ x) => x.key).sort(), want.map((/** @type {any} */ x) => x.key).sort(), 'break: save no ledger rows and this reds');
  const rule = ledger.find((/** @type {any} */ x) => x.rowKind === 'rule');
  assert.deepEqual(rule?.words, ['be friendly']);
  assert.equal(rule?.phase, 'final');
});

test('am9 item 1: the plan\'s Not checked item for a `~` rule reads `line <n>: "<rule text>" — <reason>`', async (t) => {
  const r = await go(walkProse(t, WALK));
  const item = r.notChecked.find((/** @type {string} */ x) => x.includes('be friendly'));
  assert.ok(item, JSON.stringify(r.notChecked));
  assert.match(item, /^line 5: "be friendly" — \S/);
});
