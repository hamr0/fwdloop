// M4e amendment 9: the drafting card reads like a step card, step 0. Negatives (a) an old flow (no wallMs/calls) gets a real card-to-sign time and
// `at least n model calls`; a missing `at` reads time unknown, never 0. (b) line 1 is `0 · drafting`, bold h4, status in step-card form. (c) human checks.
// (d) one draft time for card, Map box and Audit header. (e) is a browser walk. $0.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { getRunAudit, getRunDetail } from '../src/panel/data.js';
import { loadCatalogue } from '../src/catalogue.js';
import { killChildrenAfter, world } from './m4e-world.mjs';

killChildrenAfter();
const PAGE = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
const CAT = loadCatalogue().primitives;
const cut = (name) => {
  const start = PAGE.indexOf(`\n  function ${name}(`) + 1;
  assert.ok(start > 0, `${name} not found`);
  return PAGE.slice(start, PAGE.indexOf('\n  }\n', start) + 5);
};
const { draftCardLines, draftLineText } = new Function(`var STEP_SIGN={done:"[✓]"};var signWords={"[✓]":"passed"};${['countWord', 'money', 'duration', 'draftFigures', 'draftCallsWord', 'stateWord', 'auditGroupHeaderParts', 'draftCardLines', 'draftLineText'].map(cut).join('\n')}\nreturn { draftCardLines, draftLineText };`)();
// an OLD row: no wallMs, no calls
const old = (kind, over = {}) => ({ kind, n: 0, at: '2026-10-06T10:00:00.000Z', model: 'deepseek-flash', costUsd: 0.01, spendComplete: true, verdict: 'green', hash: 'abcdef012345', gap: null, ...over });
const card = { kind: 'card', n: 0, at: '2026-10-06T09:58:00.000Z', card: { flowName: 'job2', job: 'x', capUsd: 0.25 } };
const sign = { kind: 'sign', n: 0, at: '2026-10-06T10:00:35.000Z', signedBy: 'hamr', hash: 'abcdef012345abcdef', flowHash: null };
const note = { kind: 'note', n: 1, at: '2026-10-06T09:59:00.000Z', text: 'n' };

async function draftOf(rows, valuesFiles = 0) {
  const w = await world();
  const { flowDir } = await w.signedFlow();
  const runDir = path.join(flowDir, 'runs', 'run-1');
  mkdirSync(runDir, { recursive: true });
  for (let i = 0; i < valuesFiles; i++) {
    writeFileSync(path.join(runDir, i === 0 ? 'signed-values.json' : `signed-values-r${i}.json`), JSON.stringify({ signedBy: 'hamr', at: 'x', values: { capUsd: 0.25 } }));
  }
  writeFileSync(path.join(flowDir, 'setup.jsonl'), `${rows.map((r) => JSON.stringify(r)).join('\n')}\n`);
  return { w, detail: getRunDetail({ root: w.root, flow: 'job2', runId: 'run-1', catalogue: CAT }), audit: getRunAudit({ root: w.root, flow: 'job2', runId: 'run-1' }) };
}

test('(a) an old flow (no wallMs, no calls) shows the card-to-sign time and "at least n model calls", never time unknown', async () => {
  const { detail } = await draftOf([card, old('draft'), old('change', { n: 1 }), sign]);
  const c = draftCardLines(detail.draft);
  assert.equal(c.lines[0], '2m35s · $0.0200 · at least 2 model calls · 1 human check · ✓');
  const one = draftCardLines((await draftOf([card, old('draft'), sign])).detail.draft);
  assert.match(one.lines[0], /at least 1 model call · /, 'one call is singular');
});

test('(a) a missing at on the card or the sign reads time unknown, never 0', async () => {
  for (const rows of [[{ ...card, at: undefined }, old('draft'), sign], [card, old('draft'), { ...sign, at: undefined }]]) {
    const l = draftCardLines((await draftOf(rows)).detail.draft).lines[0];
    assert.match(l, /^time unknown · /);
    assert.doesNotMatch(l, /^0/);
  }
});

test('(a) all rows recorded: "<n> model calls", exact', async () => {
  const { detail } = await draftOf([card, old('draft', { calls: 2 }), old('change', { n: 1, calls: 1 }), sign]);
  assert.match(draftCardLines(detail.draft).lines[0], / · 3 model calls · /);
});

test('(b) line 1 is `0 · drafting` with the status in step-card form: [✓] passed; plain not signed; bold h4 in the built card', async () => {
  const done = draftCardLines((await draftOf([card, old('draft'), sign])).detail.draft);
  assert.deepEqual([done.title, done.status], ['0 · drafting', '[✓] passed']);
  const un = draftCardLines((await draftOf([card, old('draft')])).detail.draft);
  assert.deepEqual([un.title, un.status, un.lines[0].endsWith('✓')], ['0 · drafting', 'not signed', false]);
  const built = cut('buildDraftCardEl');
  assert.match(built, /createElement\("h4"\)/);
  assert.match(built, /h4\.textContent = c\.title/);
  assert.match(cut('buildStepCardHeadEl'), /createElement\("h4"\)/, 'the same head shape as a step card');
  assert.deepEqual(draftCardLines({ present: false, why: 'no draft record' }), { title: '0 · drafting', status: null, passed: false, lines: ['no draft record'] });
});

test('(c) human checks = notes + sign (card not counted) + the run\'s signed-values rows; none = 1 human check', async () => {
  assert.match(draftCardLines((await draftOf([card, old('draft'), sign])).detail.draft).lines[0], / · 1 human check · /);
  assert.match(draftCardLines((await draftOf([card, old('draft'), note, { ...note, n: 2 }, sign])).detail.draft).lines[0], / · 3 human checks · /);
  const { detail } = await draftOf([card, old('draft'), note, sign], 2);
  assert.equal(detail.draft.humanChecks, 4);
});

test('(d) the card and the Audit header read the one draft time', async () => {
  const { detail, audit } = await draftOf([card, old('draft'), sign]);
  assert.equal(detail.draft.timeMs, audit.draft.summary.timeMs);
  assert.equal(detail.draft.timeMs, 155000);
  const header = draftLineText(audit.draft.summary);
  assert.equal(header, '[✓] passed · drafting · 2m35s · $0.0100 · at least 1 model call ✓');
  assert.ok(draftCardLines(detail.draft).lines[0].startsWith('2m35s · $0.0100 · at least 1 model call'), 'same time and model-calls words');
});
