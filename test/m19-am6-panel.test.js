// M19 am6 to am9 through the panel's real HTTP door and a real `fwdloop draft` child (fake provider, $0): the card the panel draws is read from the signed plan, a Drop or an Add keeps it so and keeps the draft's ledger rows,
// a saved draft with the old words is drawn in the new ones, and a sign refuses a card that differs from the plan, naming the line. Each test names the break that turns it red.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { signDraft } from '../src/authoring.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';
import { BOX_JOB } from './m4e-box-fixture.mjs';

killChildrenAfter();
const JOB = BOX_JOB.replace('200ish each,', '200ish each,\n~ exactly 3 bullets');
const SUGGEST = JSON.stringify({ checks: [{ line: 3, guardrail: 1, rule: 'listItems', value: 3 }] });
const LEDGER = JSON.stringify({ extra: [{ line: 3, kind: 'phrase', phrase: 'Rust engineer', source: 'resume' }] });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const settle = (w, id, phases) => until(async () => { const j = await state(w, id); return phases.includes(j?.phase) ? j : null; });
const childGone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});
const read = (w, id, rel) => readFileSync(path.join(w.dir(id), rel), 'utf8');
async function greenPlan() {
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_SUGGEST: SUGGEST, FWDLOOP_TEST_DRAFT_LEDGER: LEDGER } });
  writeFileSync(path.join(w.inDir, 'resume.md'), '# Resume\n\nJo Doe, a Rust engineer for ten years.\n');
  const id = (await w.post('/api/author/draft', w.card({ job: JOB }))).json().draftId;
  await settle(w, id, ['questions-open']);
  await childGone(w, id);
  assert.equal((await w.post(`/api/author/${id}/answer`, { k: 1, choice: 'agree' })).status, 202);
  const g = await settle(w, id, ['green', 'red', 'stopped']);
  await childGone(w, id);
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  return { w, id, g };
}

test('the panel draws a pick row in its plain words, read from the plan; an Add keeps the card read from the plan', async () => {
  const { w, id, g } = await greenPlan();
  const pick = g.list.rows.find((/** @type {any} */ r) => r.by === 'you' && /list items/.test(r.text));
  assert.ok(pick, JSON.stringify(g.list.rows));
  assert.equal(pick.text, 'exactly 3 list items', 'break: draw the saved row copies (cardOfBlock text) and this reds');
  const sug = g.list.suggested[0];
  assert.equal((await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: sug.key })).status, 200);
  const after = await settle(w, id, ['green', 'red', 'stopped']);
  const row = after.list.rows.find((/** @type {any} */ r) => r.by === 'agent' && /Rust engineer/.test(r.text));
  assert.ok(row && row.drop === true, JSON.stringify(after.list.rows));
  assert.equal(after.list.rows.find((/** @type {any} */ r) => /list items/.test(r.text))?.text, 'exactly 3 list items');
});

test('a Drop or an Add keeps the draft\'s ledger rows in its new log (am8 item 1): the last row per key', async () => {
  const { w, id, g } = await greenPlan();
  const sug = g.list.suggested[0];
  await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: sug.key });
  const after = await settle(w, id, ['green', 'red', 'stopped']);
  const log = JSON.parse(read(w, id, `${after.plan}/log.json`));
  const decl = JSON.parse(read(w, id, `${after.plan}/declaration.json`));
  const want = decl.checkList.filter((/** @type {any} */ x) => x.state === 'not-checked' && x.kind !== 'floor' && x.kind !== 'ticket').map((/** @type {any} */ x) => x.key).sort();
  const got = [...new Set(log.log.filter((/** @type {any} */ x) => x.kind === 'ledger').map((/** @type {any} */ x) => x.key))].sort();
  assert.deepEqual(got, want, 'break: rebuild saves no ledger rows and this reds');
});

test('a saved draft whose card holds the old words is drawn in the plan\'s words (am6: rebuilt from the signed plan)', async () => {
  const { w, id, g } = await greenPlan();
  const file = path.join(w.dir(id), g.plan, 'log.json');
  const log = JSON.parse(readFileSync(file, 'utf8'));
  log.checkCard.rows = log.checkCard.rows.map((/** @type {any} */ r) => (/list items/.test(r.text) ? { ...r, text: '"exactly 3 bullets" -> exactly 3 list items (you agreed: exactly 3 list items)' } : r));
  delete log.checkCard.notChecked;
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  const again = await state(w, id);
  assert.equal(again.list.rows.find((/** @type {any} */ r) => /list items/.test(r.text))?.text, 'exactly 3 list items', 'break: draw the saved card rows as they are and this reds');
});

test('sign refuses a saved card that differs from the plan, naming the line (am6 item 3)', async () => {
  const { w, id, g } = await greenPlan();
  const dir = path.join(w.dir(id), g.plan);
  const file = path.join(dir, 'log.json');
  const log = JSON.parse(readFileSync(file, 'utf8'));
  const row = log.checkCard.rows.find((/** @type {any} */ r) => /list items/.test(r.text));
  row.text = 'at most 99 words';
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  const refused = signDraft({ dir, approve: g.hash, signedBy: 'tester', env: {}, sessionDir: w.dir(id) });
  assert.equal(refused.ok, false, 'break: skip planMatchesCard at sign and this greens');
  assert.match(/** @type {any} */ (refused).reds.join('|'), new RegExp(`line ${row.line}`));
  row.text = 'exactly 3 list items';
  writeFileSync(file, `${JSON.stringify(log, null, 2)}\n`);
  assert.equal(signDraft({ dir, approve: g.hash, signedBy: 'tester', env: {}, sessionDir: w.dir(id) }).ok, true);
});
