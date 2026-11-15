// M16 am4 (2)/(3), Done-when "Drop and Add cost $0 and call no AI", at the panel's real HTTP door for a CSV plan: POST /api/author/:id/row-edit on a saved plan folder that has an [agent] sheet row.
// test/m16-am4-sheet-rows.test.js proves the same at `rowEditPlan` (the pure rebuild); this proves the door around it: a new draft-N, a $0 / 0-call spend row, no draft child, no provider call.
// The session folder is the panel's own (a real draft of another job, through the fake provider), whose plan folder is then replaced with a CSV plan written by the real drafter (fake provider).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync, mkdirSync, cpSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draftToDir } from '../src/authoring.js';
import { draftingSpent } from '../src/draftspend.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { RATES, MODEL, fakeProvider, textReply, toolReply } from './drafter-fixture.mjs';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();
const HERE = path.dirname(fileURLToPath(import.meta.url));
const AGING_CSV = path.join(HERE, 'fixtures', 'm10b-sheets', 'aging.csv');
const ISO = [{ column: 'Due date', format: 'YYYY-MM-DD' }];
const BANDS = [{ name: 'Current', lte: 0 }, { name: '1-30', gte: 1, lte: 30 }, { name: '31-60', gte: 31, lte: 60 }, { name: '61-90', gte: 61, lte: 90 }, { name: '90+', gt: 90 }];
const PROSE = `1. Read the aging report
2. Put each invoice in its overdue bucket as of 2026-10-11: Current, 1-30, 31-60, 61-90, 90+,
   guardrail: every invoice appears exactly once; flag amounts over 500
3. ask 1h: check it with me
4. Write it out

Arbiter guardrails (belong to no line; human-signed, tighten-only):
guardrail: cap $0.25 per run
guardrail: send at line 4 to file:poc/m0/out
guardrail: source aging = file:${AGING_CSV}
`;
const CHECKS = [
  { id: 'nodup', rule: 'table', table: 'aging', op: 'noDuplicates', column: 'Invoice #', covers: [1] },
  { id: 'over', rule: 'cells', table: 'aging', claim: 'over', op: 'rows', where: [{ column: 'Amount', cmp: 'gt', value: 500 }], covers: [2] },
  { id: 'bands', rule: 'cells', table: 'aging', claim: 'bands', op: 'band', column: 'Due date', asOf: '2026-10-11', dateFormats: ISO, bands: BANDS, covers: [] },
];
const DECL = {
  steps: [
    { primitives: ['read'], reads: [], emits: 'aging_text', fromLine: 1, close: { class: 'hitl' } },
    { primitives: ['read'], reads: ['aging'], emits: 'bucket_assignment', fromLine: 2, close: { class: 'green', sheet: CHECKS } },
    { primitives: [], reads: ['bucket_assignment'], emits: 'human_ok', fromLine: 3, close: { class: 'hitl' } },
    { primitives: ['write'], reads: ['bucket_assignment', 'human_ok'], emits: 'bucket_report', fromLine: 4, close: { class: 'hitl' } },
  ],
  guardrailClasses: { 2: 'green' }, unjudgeable: {}, refused: [],
};
const reply = (text) => ({ ...textReply(text), usage: { inputTokens: 1000, outputTokens: 200 } });
const state = async (w, id) => (await w.get(`/api/author/${id}`)).json();
const read = (w, id, rel) => readFileSync(path.join(w.dir(id), rel), 'utf8');

/** a session the panel made (real draft child, fake provider) whose plan folder now holds a green CSV plan with an [agent] sheet row (`bands`, covers none) */
async function csvSession() {
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-m16route-'));
  const proseFile = path.join(work, 'prose.txt');
  writeFileSync(proseFile, PROSE);
  const planned = path.join(work, 'draft');
  const root = path.join(work, 'flows');
  mkdirSync(root);
  const made = await draftToDir({ proseFile, dir: planned, root, name: 'aging', provider: fakeProvider([reply(JSON.stringify({ facts: [] })), toolReply(DECL)]), rates: RATES, modelId: MODEL, env: {}, slot: 'DEEPSEEK_API_KEY' });
  assert.equal(made.ok, true, JSON.stringify(made.reds));
  const logFile = path.join(work, 'provider-calls.log');
  const w = await world({ extraEnv: { FWDLOOP_TEST_DRAFT_LOG: logFile } });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  const g = await until(async () => { const j = await state(w, id); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  await until(() => { try { const p = JSON.parse(read(w, id, 'pid.json')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; } });
  rmSync(path.join(w.dir(id), 'draft'), { recursive: true, force: true });
  cpSync(planned, path.join(w.dir(id), 'draft'), { recursive: true });
  writeFileSync(path.join(w.dir(id), 'prose.txt'), PROSE);
  rmSync(logFile, { force: true }); // the calls the setup draft made are not the ones under test
  return { w, id, logFile };
}
const settleGreen = async (w, id) => { const j = await until(async () => { const s = await state(w, id); return ['green', 'red', 'stopped'].includes(s?.phase) ? s : null; }); assert.equal(j.phase, 'green', JSON.stringify(j.reds ?? j)); return j; };
const sheetKeys = (j) => j.list.rows.filter((r) => r.line === 2).map((r) => `${r.key}|${r.by}`);

test('CSV plan through the door: Drop of the [agent] sheet row, then Add, cost $0 and call no AI; Drop leaves it under Suggested, Add returns the plan it began as', async () => {
  const { w, id, logFile } = await csvSession();
  const g = await settleGreen(w, id);
  const orig = sheetKeys(g);
  assert.deepEqual(orig, ['L2.sheet.l2r2|you', 'L2.sheet.l2r1|you', 'L2.sheet.l2a1|agent'], JSON.stringify(g.list));
  assert.equal(g.list.suggested.length, 0);
  const spent = draftingSpent(w.dir(id)).usd;
  const pidBefore = existsSync(path.join(w.dir(id), 'pid.json')) ? read(w, id, 'pid.json') : null;
  const first = readFileSync(path.join(w.dir(id), g.plan, 'declaration.json'), 'utf8');

  const drop = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'L2.sheet.l2a1' });
  assert.equal(drop.status, 200, drop.text);
  const dropped = await settleGreen(w, id);
  assert.notEqual(dropped.plan, g.plan, 'break: write the old plan in place and this reds');
  assert.equal(readFileSync(path.join(w.dir(id), g.plan, 'declaration.json'), 'utf8'), first, 'the old plan is never touched');
  assert.deepEqual(sheetKeys(dropped), ['L2.sheet.l2r2|you', 'L2.sheet.l2r1|you']);
  assert.deepEqual(dropped.list.suggested.map((x) => [x.key, x.dropped === true]), [['L2.sheet.l2a1', true]], 'the dropped [agent] sheet row is offered back (Suggested, with Add)');
  const row = JSON.parse(readFileSync(path.join(w.dir(id), dropped.plan, 'spend.jsonl'), 'utf8').trim().split('\n').at(-1));
  assert.equal(row.costUsd, 0, 'break: book a cost on a Drop and this reds');
  assert.equal(row.calls, 0);
  assert.equal(row.rounds, 0);

  const add = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: 'L2.sheet.l2a1' });
  assert.equal(add.status, 200, add.text);
  const added = await settleGreen(w, id);
  assert.notEqual(added.plan, dropped.plan);
  assert.deepEqual(sheetKeys(added), orig, 'the sheet rows are where they were');
  assert.equal(added.list.suggested.length, 0);
  assert.equal(added.hash, g.hash, 'Drop then Add is the plan it began as');
  assert.equal(draftingSpent(w.dir(id)).usd, spent, 'both cost $0');
  assert.equal(existsSync(path.join(w.dir(id), 'pid.json')) ? read(w, id, 'pid.json') : null, pidBefore, 'no `fwdloop draft` child was started');
  assert.equal(existsSync(logFile), false, 'break: let a row edit reach the draft provider (the test provider logs every call) and this reds');
  // every new plan carries a $0 spend row and nothing else
  for (const p of [dropped.plan, added.plan]) assert.deepEqual(readFileSync(path.join(w.dir(id), p, 'spend.jsonl'), 'utf8').trim().split('\n').map((l) => [JSON.parse(l).costUsd, JSON.parse(l).calls]), [[0, 0]]);
  assert.ok(readdirSync(w.dir(id)).includes(`draft-${added.plan.replace('draft-', '')}`));
});
