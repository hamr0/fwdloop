// M19 P8 (F231): Drop and Add back on a shape row, $0. Pre-registered in docs/logs/FINDINGS.md (F231) before this harness was written.
// usage: node --test poc/m19-p8/run.mjs     (a real panel, the real `fwdloop draft` child with the test fake provider, the real POST /api/author/:id/row-edit; no key, no network)
// The expectations are computed here from the plan folders, never from the code under test. A scenario that fails prints FAIL and the test fails; nothing is refitted.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { draftingSpent } from '../../src/draftspend.js';
import { killChildrenAfter } from '../../test/m4e-world.mjs';
import { shapePlan, settle, childGone, readIn, readJsonIn, state } from '../../test/m19-s9-world.mjs';

killChildrenAfter();
const results = /** @type {[string, boolean, any][]} */ ([]);
const say = (/** @type {string} */ name, /** @type {boolean} */ ok, /** @type {any} */ detail) => { results.push([name, ok, detail]); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  ${JSON.stringify(detail)}`}`); };

// the signed list of a plan, read from its files: the checks of the list and every step's close
const listOf = (/** @type {any} */ w, /** @type {string} */ id, /** @type {string} */ plan) => { const d = readJsonIn(w, id, `${plan}/declaration.json`); return JSON.stringify([d.checkList, d.steps.map((/** @type {any} */ s) => [s.fromLine, s.close])]); };
const spendRow = (/** @type {any} */ w, /** @type {string} */ id, /** @type {string} */ plan) => JSON.parse(readIn(w, id, `${plan}/spend.jsonl`).trim().split('\n').at(-1) ?? '{}');
const names = (/** @type {any} */ w, /** @type {string} */ id) => readdirSync(w.dir(id)).sort();

test('P8: Drop it, then Add back, through the panel route; then a Revise', async () => {
  const { w, id, g, calls, deny, allow } = await shapePlan();
  assert.equal(g.phase, 'green', JSON.stringify(g.reds ?? g));
  assert.ok(g.list.rows.some((r) => r.key === 'L3.~2' && r.by === 'you' && r.kind === 'shape'), 'fixture: a [you] shape row');
  const planA = g.plan;
  const listA = listOf(w, id, planA);
  const step = async (/** @type {string} */ op, /** @type {string} */ key, /** @type {string} */ from) => {
    const pid0 = readIn(w, id, 'pid.json');
    const spent0 = draftingSpent(w.dir(id)).usd;
    const calls0 = calls();
    const r = await w.post(`/api/author/${id}/row-edit`, { op, key });
    const s = r.status === 200 ? await settle(w, id) : null;
    return { r, s, plan: s?.plan, from, spentSame: draftingSpent(w.dir(id)).usd === spent0, callsSame: calls() === calls0, pidSame: readIn(w, id, 'pid.json') === pid0 };
  };
  deny();

  // 1. Drop
  const d = await step('drop', 'L3.~2', planA);
  const rowD = d.plan ? spendRow(w, id, d.plan) : {};
  say('1 Drop: 200 and a NEW plan', d.r.status === 200 && d.plan !== undefined && d.plan !== planA, [d.r.status, d.plan]);
  say('1 Drop: the new plan books costUsd 0, calls 0, rounds 0', rowD.costUsd === 0 && rowD.calls === 0 && rowD.rounds === 0, rowD);
  say('1 Drop: drafting spend unchanged, no provider call of any kind, no child started', d.spentSame && d.callsSame && d.pidSame, [d.spentSame, d.callsSame, d.pidSame]);

  // 2. the words and the record
  const notRows = d.s?.notChecked?.rows ?? [];
  const nc = notRows.find((/** @type {any} */ x) => x.text === 'status is one of in progress, closed, finished');
  say('2 after the Drop the rule is Not checked with "You dropped it."', nc?.why === 'You dropped it.', nc);
  say('2 the card names it restorable (an Add back key)', JSON.stringify(d.s?.list?.restorable?.map((/** @type {any} */ x) => x.key)) === '["L3.~2"]', d.s?.list?.restorable);
  const recD = d.plan ? readJsonIn(w, id, `${d.plan}/picks-record.json`) : {};
  say('2 the record holds a shapeDropped entry for rule 2', Array.isArray(recD.shapeDropped) && recD.shapeDropped.length === 1 && recD.shapeDropped[0].rule === 2, recD.shapeDropped);

  // 3. Add back
  const a = await step('add', 'L3.~2', d.plan ?? '');
  const rowA = a.plan ? spendRow(w, id, a.plan) : {};
  say('3 Add back: 200 and a NEW plan', a.r.status === 200 && a.plan !== undefined && a.plan !== d.plan, [a.r.status, a.plan]);
  say('3 Add back: costUsd 0, calls 0, rounds 0; spend unchanged; no provider call; no child', rowA.costUsd === 0 && rowA.calls === 0 && rowA.rounds === 0 && a.spentSame && a.callsSame && a.pidSame, [rowA, a.spentSame, a.callsSame, a.pidSame]);
  say('3 the signed list after Add back equals the list before the Drop, byte for byte', a.plan !== undefined && listOf(w, id, a.plan) === listA, null);
  const recA = a.plan ? readJsonIn(w, id, `${a.plan}/picks-record.json`) : {};
  say('3 the record holds no shapeDropped entry', recA.shapeDropped === undefined, recA.shapeDropped);

  // 5. the tag's refusal words, nothing written
  const nameA = names(w, id);
  const on = await w.post(`/api/author/${id}/row-edit`, { op: 'add', key: 'L3.~2' });
  say('5 Add back of a row that is not dropped: "that check is already on the card"', on.status === 409 && /^that check is already on the card\. Nothing was changed\.$/i.test(on.json()?.say ?? ''), on.json());
  say('5 that refusal wrote nothing', names(w, id).join() === nameA.join(), [nameA, names(w, id)]);
  const d2 = await step('drop', 'L3.~2', a.plan ?? '');
  const nameD2 = names(w, id);
  const twice = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'L3.~2' });
  say('5 a second Drop: "that check is already dropped"', twice.status === 409 && /^that check is already dropped\. Nothing was changed\.$/i.test(twice.json()?.say ?? ''), twice.json());
  say('5 that refusal wrote nothing', names(w, id).join() === nameD2.join(), [nameD2, names(w, id)]);

  // 4. a Revise after a Drop keeps it (a Revise is a draft: the fake provider may be called)
  allow();
  const card = readJsonIn(w, id, 'card.json');
  const rv = await w.post(`/api/author/${id}/revise`, { ...card, capUsd: Number(card.capUsd) + 1 });
  assert.equal(rv.status, 202, rv.text);
  await (async () => { const t0 = Date.now(); while ((await state(w, id)).plan === d2.plan && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50)); })();
  const rs = await settle(w, id);
  await childGone(w, id);
  const recR = readJsonIn(w, id, `${rs.plan}/picks-record.json`);
  const ncR = (rs.notChecked?.rows ?? []).find((/** @type {any} */ x) => x.text === 'status is one of in progress, closed, finished');
  say('4 a Revise after a Drop keeps it: the record has the entry and the rule reads "You dropped it."', rs.phase === 'green' && recR.shapeDropped?.length === 1 && ncR?.why === 'You dropped it.', [rs.phase, recR.shapeDropped, ncR]);
  // Add back on the revised plan (its folder carries the answers' marker, as the fixture says), then a Revise keeps nothing dropped
  writeFileSync(path.join(w.dir(id), `redraft-${rs.plan.replace('draft-', '')}.json`), `${JSON.stringify({ fromPlan: d2.plan, answers: [] })}\n`);
  deny();
  const ab = await step('add', 'L3.~2', rs.plan);
  assert.equal(ab.r.status, 200, ab.r.text);
  allow();
  const rv2 = await w.post(`/api/author/${id}/revise`, { ...card, capUsd: Number(card.capUsd) + 2 });
  assert.equal(rv2.status, 202, rv2.text);
  await (async () => { const t0 = Date.now(); while ((await state(w, id)).plan === ab.plan && Date.now() - t0 < 20000) await new Promise((r) => setTimeout(r, 50)); })();
  const rs2 = await settle(w, id);
  await childGone(w, id);
  const recR2 = readJsonIn(w, id, `${rs2.plan}/picks-record.json`);
  const rowR2 = rs2.list.rows.find((/** @type {any} */ x) => x.key === 'L3.~2');
  say('4 a Revise after Drop then Add back does not drop it', rs2.phase === 'green' && recR2.shapeDropped === undefined && rowR2?.state === 'built', [rs2.phase, recR2.shapeDropped, rowR2]);

  // 6. a plan whose log has no shape-map answer is not rebuilt, nothing is written, no call
  const planNow = rs2.plan;
  writeFileSync(path.join(w.dir(id), `redraft-${planNow.replace('draft-', '')}.json`), `${JSON.stringify({ fromPlan: rs.plan, answers: [] })}\n`);
  const logPath = `${planNow}/log.json`;
  const log = readJsonIn(w, id, logPath);
  log.log = log.log.filter((/** @type {any} */ e) => e.kind !== 'shape-map');
  writeFileSync(path.join(w.dir(id), logPath), `${JSON.stringify(log, null, 2)}\n`);
  deny();
  const names6 = names(w, id);
  const calls6 = calls();
  const six = await w.post(`/api/author/${id}/row-edit`, { op: 'drop', key: 'L3.~2' });
  say('6 no saved shape answer: the edit is refused with a plain sentence', six.status === 409 && typeof six.json()?.say === 'string' && /Nothing was changed\.$/.test(six.json().say), six.json());
  say('6 nothing written, no provider call', names(w, id).join() === names6.join() && calls() === calls6, null);

  const fails = results.filter(([, ok]) => !ok);
  console.log(`# P8: ${results.length - fails.length} PASS, ${fails.length} FAIL`);
  assert.equal(fails.length, 0, fails.map(([n]) => n).join(' | '));
});

