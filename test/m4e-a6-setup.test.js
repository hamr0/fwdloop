// M4e amendment 6 item 4 + negatives (d) (e): at sign the draft's record is copied once into the flow folder as setup.jsonl; the Audit tab's
// Setup block reads it for every run of the flow. $0, fake provider. A real browser walk of the block at 1280/390/320 is still owed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  existsSync, mkdirSync, readFileSync, statSync, writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { draftToDir, signDraft, PANEL_DRAFTS_DIR } from '../src/authoring.js';
import { readFlow, writeFlow } from '../src/flow.js';
import { loadCatalogue } from '../src/catalogue.js';
import { readSetup, writeSetup, SETUP_FILE } from '../src/setup.js';
import { getRunAudit, NO_DRAFT_WORDS } from '../src/panel/data.js';
import { writeRunValues, valuesHash } from '../src/runvalues.js';
import { PROVIDER_SLOTS } from '../src/provider.js';
import {
  RATES, MODEL, job2Fixture, validArgs, fakeProvider, toolReply,
} from './drafter-fixture.mjs';

const CAT = loadCatalogue().primitives;
const KEY = 'sk-canary-A6-setup-5d2c7e19b4a8f3066d21';
const SLOT_ENV = PROVIDER_SLOTS.deepseek.envVar;

/** A panel-shaped draft folder: card.json, draft/, card-1.json, draft-1/ (a revise), as `src/panel/author.js` lays it out (amendment 14). */
async function session() {
  const fx = job2Fixture();
  const work = mkdtempSync(path.join(tmpdir(), 'fwdloop-a6-setup-'));
  const root = path.join(work, 'flows');
  const dir = path.join(root, PANEL_DRAFTS_DIR, 'd-0000000001-abcd');
  mkdirSync(dir, { recursive: true });
  const proseFile = path.join(dir, 'prose.txt');
  writeFileSync(proseFile, fx.prose);
  const card = { flowName: 'job2', job: `read my resume ${KEY}`, destination: '/tmp/out', inputs: 'resume=/x', capUsd: 0.25, askWait: '1h' };
  writeFileSync(path.join(dir, 'card.json'), `${JSON.stringify(card, null, 2)}\n`);
  const first = await draftToDir({
    proseFile, dir: path.join(dir, 'draft'), root, name: 'job2', provider: fakeProvider([toolReply(validArgs())]), rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(first.ok, true, JSON.stringify(first.reds));
  // the revise's card (as submitted) carries the key (a hand-planted leak); the plan dir's prose is clean so sign's own plan-dir sweep passes and ONLY the setup scrub is under test
  writeFileSync(path.join(dir, 'card-1.json'), `${JSON.stringify({ ...card, job: `read my resume and the JD ${KEY}` }, null, 2)}\n`);
  const change = validArgs();
  change.steps[2].close.shape.mustCarry = ['JD'];
  const second = await draftToDir({
    proseFile, dir: path.join(dir, 'draft-1'), root, name: 'job2', provider: fakeProvider([toolReply(change)]), rates: RATES, modelId: MODEL, env: {},
  });
  assert.equal(second.ok, true, JSON.stringify(second.reds));
  return { root, dir, work, first, second };
}
const sign = (s, extra = {}) => signDraft({
  dir: path.join(s.dir, 'draft-1'), approve: s.second.hash, signedBy: 'hamr', signedAt: '2026-10-06T12:00:00.000Z', env: { [SLOT_ENV]: KEY }, sessionDir: s.dir, ...extra,
});
const flowDir = (s) => path.join(s.root, 'job2');

test('(d) after sign, setup.jsonl has the card, every draft and revise with its cost and verdict, each revise card as submitted, and the sign row; no note row; the flow still reads', async () => {
  const s = await session();
  const r = sign(s);
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.equal(r.setup.ok, true, JSON.stringify(r.setup));
  const setup = readSetup(flowDir(s));
  assert.equal(setup.present, true);
  assert.deepEqual(setup.rows.map((x) => x.kind), ['card', 'draft', 'card', 'revise', 'sign']);
  const [card, draft, card1, change, signRow] = setup.rows;
  assert.equal(card.card.flowName, 'job2');
  assert.equal(draft.verdict, 'green');
  assert.equal(draft.hash, s.first.hash);
  assert.equal(draft.model, MODEL);
  assert.ok(draft.costUsd > 0, 'priced, never 0');
  assert.equal(card1.n, 1);
  assert.match(card1.card.job, /read my resume and the JD/);
  assert.equal(change.hash, s.second.hash);
  assert.equal(change.verdict, 'green');
  assert.ok(change.costUsd > 0);
  assert.equal(signRow.hash, s.second.hash);
  assert.equal(signRow.at, '2026-10-06T12:00:00.000Z');
  assert.equal(signRow.signedBy, 'hamr');
  assert.equal(statSync(path.join(flowDir(s), SETUP_FILE)).mode & 0o777, 0o600);
  const read = readFlow({ root: s.root, name: 'job2', catalogue: CAT });
  assert.equal(read.ok, true, JSON.stringify(read.reds));
});

test('(d) writing setup.jsonl a second time is refused and changes nothing', async () => {
  const s = await session();
  assert.equal(sign(s).ok, true);
  const before = readFileSync(path.join(flowDir(s), SETUP_FILE), 'utf8');
  const again = writeSetup({
    flowDir: flowDir(s), sessionDir: s.dir, planDir: path.join(s.dir, 'draft-1'), hash: 'x', signedBy: 'someone', signedAt: '2030-01-01T00:00:00.000Z',
  });
  assert.equal(again.ok, false);
  assert.match(again.red, /already exists/);
  assert.equal(readFileSync(path.join(flowDir(s), SETUP_FILE), 'utf8'), before);
});

test('(e) no key value in setup.jsonl, though the key sat in the card and in a revise card', async () => {
  const s = await session();
  assert.equal(sign(s).ok, true);
  const text = readFileSync(path.join(flowDir(s), SETUP_FILE), 'utf8');
  assert.ok(!text.includes(KEY), 'the canary key never reaches setup.jsonl');
  assert.match(text, /read my resume/, 'the rest of the card is kept');
});

test('(d) Audit shows the Setup block first for run-1 and run-2; run-2 with its own signed values adds its Sign & run row; run-1 does not', async () => {
  const s = await session();
  const r = sign(s);
  assert.equal(r.ok, true);
  for (const id of ['run-1', 'run-2']) mkdirSync(path.join(flowDir(s), 'runs', id), { recursive: true });
  const flowRead = readFlow({ root: s.root, name: 'job2', catalogue: CAT });
  const rec = { flow: 'job2', flowSignatureHash: flowRead.signature.flow, runId: 'run-2', version: 0, values: { capUsd: 0.4, destination: '/tmp/elsewhere', askWaits: { 4: '30m' } } };
  const w = writeRunValues(path.join(flowDir(s), 'runs', 'run-2'), { ...rec, hash: valuesHash({ ...rec, runId: null }), signedBy: 'hamr', at: '2026-10-06T13:00:00.000Z' });
  assert.equal(w.ok, true, JSON.stringify(w));
  const a1 = getRunAudit({ root: s.root, flow: 'job2', runId: 'run-1' });
  const a2 = getRunAudit({ root: s.root, flow: 'job2', runId: 'run-2' });
  assert.equal(a1.draft.present, true);
  assert.equal(a1.draft.why, null);
  const actions = (a) => a.draft.rows.map((x) => x.action);
  assert.match(actions(a1)[0], /^card/);
  assert.match(actions(a1)[1], /^draft · deepseek-flash · plan /);
  assert.match(actions(a1)[3], /^revise 1 · deepseek-flash/);
  assert.match(actions(a1).at(-1), /^sign \(hamr\)/);
  assert.equal(a1.draft.rows.length, 5, 'run-1 has no Sign & run row of its own');
  assert.equal(a2.draft.rows.length, 6);
  assert.match(actions(a2).at(-1), /^Sign & run \(hamr\)/);
  assert.match(a2.draft.rows.at(-1).gap, /cap \$0\.4 · destination \/tmp\/elsewhere · ask waits line 4: 30m/);
  assert.deepEqual(a2.draft.rows.at(-1).gapWaits, [{ line: '4', wait: '30m', waitMs: 1_800_000 }], 'the page gets the wait typed, to format with plainWait');
  assert.ok(a1.draft.rows.every((x) => x.setup === true && typeof x.attempt === 'number'), 'the same row shape the run rows have');
});

test('(d) a flow signed before this says so in words', async () => {
  const s = await session();
  const planDir = path.join(s.dir, 'draft-1');
  const p = (f) => readFileSync(path.join(planDir, f), 'utf8');
  const w = writeFlow({
    root: s.root, name: 'job2', proseText: p('prose.txt'), declaration: JSON.parse(p('declaration.json')), signedBy: 'hamr', signedAt: '2026-10-06T12:00:00.000Z', catalogue: CAT,
  });
  assert.equal(w.ok, true, JSON.stringify(w.reds));
  mkdirSync(path.join(flowDir(s), 'runs', 'run-1'), { recursive: true });
  assert.ok(!existsSync(path.join(flowDir(s), SETUP_FILE)));
  const a = getRunAudit({ root: s.root, flow: 'job2', runId: 'run-1' });
  assert.equal(a.draft.present, false);
  assert.equal(a.draft.why, NO_DRAFT_WORDS);
  assert.equal(NO_DRAFT_WORDS, 'no draft record', 'amendment 7 item 2: Setup is renamed Draft everywhere');
});

test('a CLI sign (no session folder) records its one plan and the sign', async () => {
  const s = await session();
  const r = signDraft({
    dir: path.join(s.dir, 'draft-1'), approve: s.second.hash, signedBy: 'hamr', signedAt: '2026-10-06T12:00:00.000Z', env: {},
  });
  assert.equal(r.ok, true, JSON.stringify(r.reds));
  assert.deepEqual(readSetup(flowDir(s)).rows.map((x) => x.kind), ['draft', 'sign']);
});

test('(d) the page draws the Draft as the first Audit group, a normal card inside the filters, with the same row builder', () => {
  const page = readFileSync(new URL('../src/panel/index.html', import.meta.url), 'utf8');
  assert.ok(!page.includes('id="audit-setup"') && !page.includes('renderSetupBlock'), 'no separate Setup block any more');
  const at = page.indexOf('function renderAuditGroups');
  const body = page.slice(at, page.indexOf('\n  function renderAuditFlat', at));
  assert.match(body, /draftGroupFor\(result\)/);
  assert.match(body, /\(draftG \? \[draftG\] : \[\]\)\.concat\(/, 'the Draft group is FIRST');
  assert.match(body, /buildAuditRowEl\(r, false\)/, 'one row builder for the Draft and the run rows');
  assert.ok(page.indexOf('id="audit-content"') < page.indexOf('id="audit-groups"'), 'the groups (and so the Draft) sit inside the content with the filters above');
});
