// M4d amendment 16 (docs/wiki/the-module-ladder.md): one shared pot. Drafting and the first run share the card's Cap $. $0, fake providers, the real panel.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { mkdtempSync } from '../scripts/tmp-track.mjs';
import { draft } from '../src/drafter.js';
import { draftingSpent, potSplit, usdText } from '../src/draftspend.js';
import { world, killChildrenAfter, until } from './m4e-world.mjs';
import { MODEL, job2Fixture, validArgs, fakeProvider, toolReply } from './drafter-fixture.mjs';

killChildrenAfter();
const BIG = { in: 0.003, out: 0.008 }; // one worst-case round = $0.224
const finish = async (w, over = {}) => {
  const id = (await w.post('/api/author/draft', w.card(over))).json().draftId;
  const j = await until(async () => { const v = (await w.get(`/api/author/${id}`)).json(); return ['green', 'red', 'stopped'].includes(v?.phase) ? v : null; });
  const pid = JSON.parse(readFileSync(path.join(w.dir(id), 'pid.json'), 'utf8'));
  const { isFwdloopAlive } = await import('../src/liveness.js');
  await until(() => isFwdloopAlive(pid.pid, pid.procStart) !== true);
  return { id, j };
};
/** Say the draft spent `usd` (the plan folder's final spend row), as a booked, priced draft. */
const setSpend = (w, id, row) => writeFileSync(path.join(w.dir(id), 'draft', 'spend.jsonl'), `${JSON.stringify({ kind: 'draft', model: 'fake-ticked', rounds: 1, calls: 1, spendComplete: true, ...row })}\n`);

// ---- item 1: one pot; the first run gets what is left
test('1: draftingSpent adds every plan folder (draft, each revise) of a job; potSplit gives the first run what is left, rounded down', () => {
  const s = mkdtempSync(path.join(tmpdir(), 'fwdloop-am16-'));
  for (const [d, usd] of [['draft', 0.03], ['draft-1', 0.02]]) { mkdirSync(path.join(s, d)); writeFileSync(path.join(s, d, 'spend.jsonl'), `${JSON.stringify({ kind: 'draft', costUsd: usd, spendComplete: true })}\n`); }
  const spent = draftingSpent(s);
  assert.deepEqual([Math.round(spent.usd * 1e4) / 1e4, spent.notPriced, spent.complete], [0.05, 0, true]);
  assert.equal(potSplit(0.5, spent).line, 'Cap $0.50 · drafting spent $0.05 · this run up to $0.45');
  assert.equal(potSplit(0.5, spent).leftUsd, 0.45);
});

test('1: Sign & run starts the first run with the cap that is LEFT, written as the run\'s own signed values; the signed flow keeps the card cap', async () => {
  const w = await world();
  const { id, j } = await finish(w);
  assert.equal(j.phase, 'green');
  setSpend(w, id, { costUsd: 0.05 });
  const prep = (await w.post(`/api/author/${id}/sign-prepare`, {})).json();
  assert.equal(prep.split.line, 'Cap $0.25 · drafting spent $0.05 · this run up to $0.20');
  const r = await w.post(`/api/author/${id}/sign`, { hash: j.hash });
  assert.equal(r.status, 202, r.text);
  const runDir = path.join(w.root, 'job2', 'runs', r.json().runId);
  const v = JSON.parse(readFileSync(path.join(runDir, 'signed-values.json'), 'utf8'));
  assert.equal(v.values.capUsd, 0.2);
  assert.match(readFileSync(path.join(w.root, 'job2', 'prose.txt'), 'utf8'), /cap \$0\.25 per run/);
});

// ---- item 2: each drafting round must fit what is left of the cap
test('2: a round must fit the REMAINING cap: Cap 0.50 with 0.40 already spent leaves 0.10, below a 0.224 round: refused at $0 in words', async () => {
  const fx = job2Fixture();
  const prose = fx.prose.replace('guardrail: cap $0.25 per run', 'guardrail: cap $0.50 per run');
  const p = fakeProvider([toolReply(validArgs())]);
  const r = await draft({ proseText: prose, provider: p, rates: BIG, modelId: MODEL, priorSpend: () => 0.4 });
  assert.equal(r.ok, false);
  assert.equal(p.calls.length, 0);
  assert.equal(r.reds[0], `Cap $0.50 less $0.40 already spent on drafting leaves $0.10, below one drafting round's worst case for ${MODEL}, $0.2240. Raise Cap $ or pick another model.`);
  const ok = await draft({ proseText: prose, provider: fakeProvider([toolReply(validArgs())]), rates: BIG, modelId: MODEL, priorSpend: () => 0.2 });
  assert.equal(ok.ok, true, JSON.stringify(ok.reds));
});

// ---- item 3: the split is shown; refused at $0 when what is left cannot pay one run round
test('3: Sign & run is refused at $0 when what is left cannot pay one run round, naming the numbers and "Raise Cap $"; nothing is signed', async () => {
  const w = await world();
  const { id, j } = await finish(w); // the world's one round at its worst case is $0.05
  setSpend(w, id, { costUsd: 0.21 }); // cap 0.25 - 0.21 = 0.04 < 0.05
  for (const [url, body] of [[`/api/author/${id}/sign-prepare`, {}], [`/api/author/${id}/sign`, { hash: j.hash }]]) {
    const r = await w.post(url, body);
    assert.equal(r.status, 400, r.text);
    assert.equal(r.json().refused, 'pot-empty');
    assert.match(r.json().say, /^Cap \$0\.25 · drafting spent \$0\.21 · this run up to \$0\.04: not enough for one run round at its worst case, \$0\.05\. Raise Cap \$\.$/);
  }
  assert.equal(existsSync(path.join(w.root, 'job2')), false, 'nothing signed');
  assert.deepEqual(w.starts(), []);
});

// ---- item 4: a run that does not draft gets the whole cap
test('4: a first run with nothing spent on drafting gets the whole cap (no values file); the Run-a-signed-flow door never takes drafting off a cap', async () => {
  const w = await world();
  const { id, j } = await finish(w);
  setSpend(w, id, { costUsd: 0 });
  const r = await w.post(`/api/author/${id}/sign`, { hash: j.hash });
  assert.equal(r.status, 202, r.text);
  assert.equal(existsSync(path.join(w.root, 'job2', 'runs', r.json().runId, 'signed-values.json')), false);
  const src = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'panel', 'authorflows.js'), 'utf8');
  assert.doesNotMatch(src, /draftingSpent|potSplit/);
});

// ---- item 5: an unpriced drafting round counts at its worst case; Sign & run continues; the line says so
test('5: an unpriced round counts at its worst case, never $0; Sign & run continues and the split line says "at most ... (1 round not priced)"', async () => {
  const w = await world();
  const { id, j } = await finish(w);
  setSpend(w, id, { costUsd: null, rounds: 0, calls: 1, spendComplete: false });
  const prep = (await w.post(`/api/author/${id}/sign-prepare`, {})).json();
  assert.equal(prep.split.line, 'Cap $0.25 · drafting spent at most $0.05 · this run up to $0.20'.replace('at most $0.05', 'at most $0.05 (1 round not priced)'));
  assert.equal(prep.split.notPriced, 1);
  const r = await w.post(`/api/author/${id}/sign`, { hash: j.hash });
  assert.equal(r.status, 202, r.text);
  assert.equal(JSON.parse(readFileSync(path.join(w.root, 'job2', 'runs', r.json().runId, 'signed-values.json'), 'utf8')).values.capUsd, 0.2);
  assert.equal(usdText(0.5), '$0.50');
});

test('2 (door): a revise whose round cannot fit what is left of the cap is refused by the draft itself at $0, in the words', async () => {
  const w = await world();
  const { id, j } = await finish(w, { capUsd: '0.05' });
  assert.equal(j.phase, 'green');
  setSpend(w, id, { costUsd: 0.03 }); // 0.05 - 0.03 = 0.02 < one worst-case round of the fake draft provider ($0.0288)
  const r = await w.post(`/api/author/${id}/revise`, w.card({ capUsd: '0.05' }));
  assert.equal(r.status, 202, r.text);
  const v = await until(async () => { const x = (await w.get(`/api/author/${id}`)).json(); return x?.revises?.[0]?.phase === 'stopped' ? x : null; });
  assert.match(v.revises[0].say, /Cap \$0\.05 less \$0\.03 already spent on drafting leaves \$0\.02, below one drafting round's worst case for deepseek-flash, \$0\.0288\. Raise Cap \$ or pick another model\./);
  assert.match(v.revises[0].say, /^draft refused at \$0/);
});

test('3 (page): the first Sign click\'s split line is what the hint under the main button says; a refusal reaches the person in its own words', () => {
  const PAGE = readFileSync(path.join(path.dirname(new URL(import.meta.url).pathname), '..', 'src', 'panel', 'index.html'), 'utf8');
  assert.match(PAGE, /signInfo = \{hash: r\.body\.hash, flowName: r\.body\.flowName, capUsd: r\.body\.capUsd, runId: r\.body\.runId, split: r\.body\.split \|\| null\}/);
  assert.match(PAGE, /if\(mode === "new" && sessionLive && signInfo && signInfo\.split && signClickedOnce\) mainHint\.textContent = signInfo\.split\.line;/);
});
