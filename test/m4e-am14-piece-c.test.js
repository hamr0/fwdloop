// M4e amendment 14 piece C (docs/wiki/the-module-ladder.md, "Amendment 14 — SIGNED"): item 5 the readout's sections line, item 6 the Start over row
// in the Audit Draft group. $0, no network: pure readout, then the real panel door with the test draft provider.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtempSync } from '../scripts/tmp-track.mjs';

import { buildReadout } from '../src/authoring.js';
import { buildSetupRows, writeSetup, SETUP_FILE } from '../src/setup.js';
import { getDraftBlock } from '../src/panel/data.js';
import { isFwdloopAlive } from '../src/liveness.js';
import { killChildrenAfter, until, world } from './m4e-world.mjs';

killChildrenAfter();

const step = (close) => ({ fromLine: 1, goal: 'g', primitives: ['read'], reads: ['a'], emits: 'x', close });
const readout = (steps) => buildReadout({
  declaration: { steps, inputFactsText: '', inputFacts: {} },
  arbiter: { capUsd: 0.5, sources: [{ role: 'a', path: '/x' }], asks: [], sends: [] },
  lines: [{ n: 1, text: 'g', guardrail: null }], name: 'f', modelId: 'm', costUsd: 0.01, rounds: 1, spendComplete: true,
}).split('\n');

test('(5) a step whose check names sections gets one fixed line in the check\'s order, with the word limit when set', () => {
  const t = readout([step({ class: 'softgreen', shape: { sections: ['How it matches the JD', 'Professional skills', 'Soft skills'], maxWords: 600 } })]);
  const i = t.findIndex((l) => l.startsWith('  1. '));
  assert.equal(t[i + 2], '     sections: How it matches the JD · Professional skills · Soft skills · under 600 words');
});

test('(5) sections without maxWords: no "under" part; a step with no sections gets no line', () => {
  const t = readout([step({ class: 'softgreen', shape: { sections: ['A', 'B'] } }), step({ class: 'hitl' }), step({ class: 'softgreen', shape: { maxWords: 50 } })]);
  assert.deepEqual(t.filter((l) => l.includes('sections:')), ['     sections: A · B']);
});

const settled = (w, id) => until(async () => { const j = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(j?.phase) ? j : null; });
const gone = (w, id) => until(() => {
  try { const p = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8')); return isFwdloopAlive(p.pid, p.procStart) !== true; } catch { return true; }
});

test('(6) a Start over POST naming the previous draft records startedOverFrom once; a plain draft or a made-up id records nothing; the setup row reads "start over"', async () => {
  const w = await world({ limit: 5 });
  const id = (await w.post('/api/author/draft', w.card())).json().draftId;
  await settled(w, id); await gone(w, id);
  assert.equal(existsSync(path.join(w.dir(id), 'started-over-from.json')), false, 'a plain first draft is not a start over');

  const so = await w.post('/api/author/draft', { ...w.card(), startedOverFrom: id });
  assert.equal(so.status, 202, so.text);
  const id2 = so.json().draftId;
  await settled(w, id2); await gone(w, id2);
  const rec = JSON.parse(readFileSync(path.join(w.dir(id2), 'started-over-from.json'), 'utf8'));
  assert.deepEqual(rec, { startedOverFrom: id });

  const fake = await w.post('/api/author/draft', { ...w.card(), startedOverFrom: 'd-0000000000-0000' });
  assert.equal(fake.status, 202, fake.text);
  const id3 = fake.json().draftId;
  await settled(w, id3); await gone(w, id3);
  assert.equal(existsSync(path.join(w.dir(id3), 'started-over-from.json')), false, 'an id that is no draft of this panel is ignored');

  // the setup rows of the start-over draft, and what Audit draws
  const rows = buildSetupRows({ sessionDir: w.dir(id2), planDir: path.join(w.dir(id2), 'draft'), hash: 'h', signedBy: 'hamr', signedAt: '2026-10-08T00:00:00.000Z' });
  assert.deepEqual(rows.map((r) => r.kind), ['card', 'startover', 'sign']);
  const flowDir = mkdtempSync(path.join(tmpdir(), 'fwdloop-am14c-'));
  mkdirSync(path.join(flowDir, 'runs', 'run-1'), { recursive: true });
  assert.equal(writeSetup({ flowDir, sessionDir: w.dir(id2), planDir: path.join(w.dir(id2), 'draft'), hash: 'h', signedBy: 'hamr', signedAt: '2026-10-08T00:00:00.000Z' }).ok, true);
  assert.ok(existsSync(path.join(flowDir, SETUP_FILE)));
  const block = getDraftBlock(flowDir, path.join(flowDir, 'runs', 'run-1'));
  assert.match(block.rows[1].action, /^start over · /);
  assert.ok(block.summary.usd > 0, 'the start-over draft\'s own spend is in the Draft group total, once');
});
