// M4e amendment 8: the drafting card is four short lines (bareloop's shape). Negatives (a) no inputs/job lines/destination/plan id on the card,
// (b) the four lines for a signed flow, a red change before the sign, a retried draft, (c) unknown reads `unknown`, never 0. (d) is a browser walk. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { getRunDetail } from '../src/panel/data.js';
import { buildSetupRows } from '../src/setup.js';
import { loadCatalogue } from '../src/catalogue.js';
import { killChildrenAfter, world } from './m4e-world.mjs';
import { tmpdir } from 'node:os';

killChildrenAfter();
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const CAT = loadCatalogue().primitives;
const cut = (name) => {
  const start = PAGE.indexOf(`\n  function ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
const load = (...names) => new Function(`${names.map(cut).join('\n')}\nreturn { ${names.join(', ')} };`)();
const row = (kind, over = {}) => ({
  kind, n: 0, at: '2026-10-06T10:00:00.000Z', model: 'deepseek-flash', costUsd: 0.01, spendComplete: true, calls: 2, wallMs: 5000, verdict: 'green', hash: 'abcdef012345', gap: null, ...over,
});
const card = { kind: 'card', n: 0, at: '2026-10-06T09:59:00.000Z', card: { flowName: 'job2', job: 'SECRETJOB line', inputs: 'SECRETINPUT file', destination: 'SECRETDEST', capUsd: 0.25 } };
const sign = { kind: 'sign', n: 0, at: '2026-10-06T10:02:00.000Z', signedBy: 'hamr', hash: 'abcdef012345abcdef', flowHash: null };

async function draftOf(rows) {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  mkdirSync(path.join(flowDir, 'runs', 'run-1'), { recursive: true });
  writeFileSync(path.join(flowDir, 'setup.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }).draft;
}
// amendment 9 reshaped the card: the lines flattened here as `[title + status, line 2, line 3]` so amendment 8's "what happened" and unknown rules stay checked
const { draftCardLines: card9 } = new Function(`var STEP_SIGN={done:"[\u2713]"};var signWords={"[\u2713]":"passed"};${['countWord', 'money', 'duration', 'draftFigures', 'draftHumanWord', 'draftCallsWord', 'stateWord', 'draftCardLines'].map(cut).join('\n')}\nreturn { draftCardLines };`)();
const draftCardLines = (d) => { const c = card9(d); return c.status === null ? [c.title, ...c.lines] : [`${c.title} ${c.status}`, ...c.lines]; };

test('(b) a signed flow: drafting / done / time · $cost · n calls · ✓ / what happened', async () => {
  const d = await draftOf([card, row('draft'), { kind: 'note', n: 1, at: 'x', text: 'SECRETNOTE' }, row('change', { n: 1, calls: 3, wallMs: 7000, costUsd: 0.02 }), sign]);
  assert.deepEqual(draftCardLines(d), ['0 · drafting [✓] passed', '3m00s · $0.0300 · 5 model calls · 2 human checks · ✓', 'your card · drafting · your note · changing · signed (hamr)']);
});

test('(a) the card carries no inputs, job lines, destination, plan id or note text', async () => {
  const d = await draftOf([card, row('draft'), { kind: 'note', n: 1, at: 'x', text: 'SECRETNOTE' }, sign]);
  const text = draftCardLines(d).join('\n');
  assert.doesNotMatch(text, /SECRET|abcdef01|plan |destination|inputs|job/);
  assert.doesNotMatch(cut('buildDraftCardEl'), /\.rows|\.gap|\.action/, 'the card never reads the Draft rows');
});

test('(b) a red change before the sign: done, ✓, change red; a red first draft says draft red; no sign row says not signed with no mark', async () => {
  const red = await draftOf([card, row('draft'), row('change', { n: 1, verdict: 'red', hash: null }), sign]);
  const l = draftCardLines(red);
  assert.deepEqual([l[0], l[1].endsWith('✓'), l[2]], ['0 · drafting [✓] passed', true, 'your card · drafting · change red · signed (hamr)']);
  assert.match(draftCardLines(await draftOf([card, row('draft', { verdict: 'red', hash: null }), sign]))[2], /draft red/);
  const un = draftCardLines(await draftOf([card, row('draft')]));
  assert.equal(un[0], '0 · drafting not signed');
  assert.doesNotMatch(un[1], /✓/);
});

test('(b) a retried draft reads drafting (retry K of N), N = MAX_STRUCTURE_RETRIES; no field = no retry text, never retry 0', async () => {
  const d = await draftOf([card, row('draft', { structureRetries: 1 }), row('change', { n: 1, structureRetries: 2 }), sign]);
  assert.equal(draftCardLines(d)[2], 'your card · drafting (retry 1 of 2) · changing (retry 2 of 2) · signed (hamr)');
  const z = await draftOf([card, row('draft', { structureRetries: 0 }), row('draft', { structureRetries: null }), sign]);
  assert.doesNotMatch(draftCardLines(z)[2], /retry/);
});

test('(b) planRow copies structureRetries from the plan\'s log.json onto the Draft row; none recorded = null', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'fwdloop-a8-'));
  mkdirSync(path.join(dir, 'draft'));
  writeFileSync(path.join(dir, 'draft', 'log.json'), JSON.stringify({ ok: true, structureRetries: 1 }));
  writeFileSync(path.join(dir, 'draft', 'spec.hash'), 'abc\n');
  const rows = buildSetupRows({ sessionDir: dir, planDir: dir, hash: 'abc', signedBy: 'hamr', signedAt: 'x' });
  assert.equal(rows.find((r) => r.kind === 'draft').structureRetries, 1);
  writeFileSync(path.join(dir, 'draft', 'log.json'), JSON.stringify({ ok: true }));
  assert.equal(buildSetupRows({ sessionDir: dir, planDir: dir, hash: 'abc', signedBy: 'hamr', signedAt: 'x' }).find((r) => r.kind === 'draft').structureRetries, null);
});

test('(c) an unknown time, cost or call count reads unknown, never 0', async () => {
  const d = await draftOf([{ ...card, at: undefined }, row('draft', { costUsd: null, spendComplete: false, calls: null, wallMs: null }), sign]);
  const l = draftCardLines(d);
  assert.equal(l[1], 'time unknown · cost unknown · at least 1 model call · 1 human check · ✓');
  assert.doesNotMatch(l[1], /\b0\b|\$0/);
});

test('a flow with no draft record: drafting / no draft record, no figures', () => {
  assert.deepEqual(draftCardLines({ present: false, why: 'no draft record' }), ['0 · drafting', 'no draft record']);
});
